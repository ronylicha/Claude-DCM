/**
 * Claude Session — Interactive Claude CLI sessions for epic brainstorming.
 *
 * Manages ephemeral Claude CLI processes for interactive epic planning:
 * - Each user message spawns a new short-lived `claude -p` process
 * - Streams assistant tokens to connected WebSocket clients in real-time
 * - Extracts structured dcm-task proposals from the response text
 * - Persists messages and proposed tasks to PostgreSQL
 *
 * Sessions are stateless at the process level: conversation history is
 * reconstructed from `epic_messages` and injected into each spawn call.
 * `--max-turns 1` + `--tools ""` keeps the process predictable and fast.
 *
 * @module pipeline/claude-session
 */

import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("ClaudeSession");

// ============================================
// Active Sessions Registry
// ============================================

/**
 * In-memory registry of running Claude CLI processes keyed by sessionId.
 * Only one process per session can be active at a time.
 */
const activeSessions = new Map<string, { proc: ReturnType<typeof Bun.spawn>; pid: number }>();

// ============================================
// System Prompt Template
// ============================================

const BRAINSTORM_SYSTEM_PROMPT = `Tu es un Tech Lead senior. L'utilisateur te decrit un besoin pour son projet.

WORKFLOW :
1. Discute et clarifie le besoin
2. Propose une approche technique
3. Quand le plan est clair, cree les taches

Pour creer une tache, emets ce format (un par tache) :

\`\`\`dcm-task
{"action":"create_task","title":"...","description":"...","agent_type":"Snipper","model":"sonnet","wave_number":0,"step_order":0,"skills":["workflow-clean-code"],"prompt":"Prompt complet pour l'agent..."}
\`\`\`

Tu peux creer plusieurs taches dans un message.

Projet: {projectName}
Workspace: {workspacePath}
Epic: {epicTitle}
{epicDescription}`;

// ============================================
// Types
// ============================================

export interface SpawnClaudeSessionParams {
  sessionId: string;
  epicId: string;
  projectName: string;
  epicTitle: string;
  epicDescription: string;
  workspacePath: string;
  conversationHistory: Array<{ role: string; content: string }>;
  userMessage: string;
  model: string;
}

interface DcmTaskPayload {
  action: string;
  title: string;
  description?: string;
  agent_type?: string;
  model?: string;
  wave_number?: number;
  step_order?: number;
  skills?: string[];
  prompt?: string;
}

// ============================================
// Main: Spawn Claude Session
// ============================================

/**
 * Spawn a Claude CLI process for a single interactive turn in an epic session.
 *
 * Kills any existing process for `sessionId`, builds prompts from history,
 * streams assistant tokens via WebSocket, then persists the full response
 * (and any dcm-task proposals) to the database.
 *
 * Errors are caught, logged, and written to DB as error status rather than
 * thrown — the caller does not need to wrap this in try/catch.
 */
export async function spawnClaudeSession(params: SpawnClaudeSessionParams): Promise<void> {
  const {
    sessionId,
    epicId,
    projectName,
    epicTitle,
    epicDescription,
    workspacePath,
    conversationHistory,
    userMessage,
    model,
  } = params;

  // Kill any previously active process for this session
  await killSession(sessionId);

  const { writeFile } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");

  const jobId = randomUUID().slice(0, 8);
  const tmpDir = "/tmp/dcm-planner";

  // Ensure tmp directory and shared empty-mcp.json exist
  await Bun.spawn(["mkdir", "-p", tmpDir]).exited;
  const emptyMcpFile = `${tmpDir}/empty-mcp.json`;
  await writeFile(emptyMcpFile, '{"mcpServers":{}}', "utf-8");

  const systemPromptFile = `${tmpDir}/session-${jobId}.system`;

  try {
    // Build system prompt from template
    const systemPrompt = BRAINSTORM_SYSTEM_PROMPT
      .replace("{projectName}", projectName)
      .replace("{workspacePath}", workspacePath)
      .replace("{epicTitle}", epicTitle)
      .replace("{epicDescription}", epicDescription.trim());

    await writeFile(systemPromptFile, systemPrompt, "utf-8");

    // Build user prompt: history + new message
    const userPrompt = buildUserPrompt(conversationHistory, userMessage);

    const sql = getDb();

    // Mark session as thinking and persist the user message
    await sql`
      UPDATE epic_sessions
      SET status = 'thinking', updated_at = now()
      WHERE id = ${sessionId}
    `;

    await sql`
      INSERT INTO epic_messages (session_id, role, content, content_type)
      VALUES (${sessionId}, 'user', ${userMessage}, 'text')
    `;

    await publishEvent(`epic-sessions/${sessionId}`, "epic.session.status", {
      session_id: sessionId,
      status: "thinking",
    });

    const modelId = resolveModelId(model);

    log.info(`Spawning Claude session: session=${sessionId.slice(0, 8)} model=${modelId} job=${jobId}`);

    // Spawn the Claude CLI process.
    // Bun.spawn uses execFile semantics (array args, no shell) — safe against injection.
    // --tools ""        disables all tools (pure conversational, no filesystem access needed)
    // --max-turns 1     one turn per HTTP request; history is injected via the user prompt
    // --strict-mcp-config + empty mcp.json  prevents MCP servers from starting
    const proc = Bun.spawn(
      [
        "claude",
        "-p", userPrompt,
        "--system-prompt-file", systemPromptFile,
        "--model", modelId,
        "--output-format", "stream-json",
        "--max-turns", "1",
        "--tools", "",
        "--strict-mcp-config",
        "--mcp-config", emptyMcpFile,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: workspacePath,
      },
    );

    const pid = proc.pid ?? 0;
    activeSessions.set(sessionId, { proc, pid });

    await sql`
      UPDATE epic_sessions
      SET pid = ${pid}, updated_at = now()
      WHERE id = ${sessionId}
    `;

    // Stream stdout and collect the full assistant text
    const fullText = await streamOutput(proc, sessionId);

    // Persist results and broadcast final events
    await handleSessionCompletion(sessionId, epicId, fullText, sql);

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    log.error(`Session ${sessionId.slice(0, 8)} failed:`, errMsg);

    try {
      const sql = getDb();
      await sql`
        UPDATE epic_sessions
        SET status = 'error', updated_at = now()
        WHERE id = ${sessionId}
      `;
      await publishEvent(`epic-sessions/${sessionId}`, "epic.session.error", {
        session_id: sessionId,
        error: errMsg,
      });
    } catch (dbErr) {
      log.error("Failed to persist session error state:", dbErr);
    }
  } finally {
    // Always clean up the system prompt temp file
    Bun.spawn(["rm", "-f", systemPromptFile], { stdout: "ignore", stderr: "ignore" });
    activeSessions.delete(sessionId);
  }
}

// ============================================
// Kill Session
// ============================================

/**
 * Terminate the active Claude CLI process for `sessionId`, if any.
 *
 * Sends SIGTERM first, then escalates to SIGKILL after 2 seconds if the
 * process is still alive. Updates `epic_sessions.status` to 'ended'.
 */
export async function killSession(sessionId: string): Promise<void> {
  const entry = activeSessions.get(sessionId);
  if (!entry) return;

  const { proc, pid } = entry;
  log.info(`Killing session ${sessionId.slice(0, 8)} (pid=${pid})`);

  try {
    proc.kill("SIGTERM");

    // Allow up to 2 seconds for graceful termination
    const gracefulExit = await Promise.race([
      proc.exited,
      new Promise<null>(resolve => setTimeout(() => resolve(null), 2000)),
    ]);

    if (gracefulExit === null) {
      try {
        proc.kill("SIGKILL");
      } catch {
        // Process may have exited in the narrow window between check and SIGKILL
      }
    }
  } catch (err) {
    log.warn(`Error signalling session ${sessionId.slice(0, 8)}:`, err);
  }

  activeSessions.delete(sessionId);

  try {
    const sql = getDb();
    await sql`
      UPDATE epic_sessions
      SET status = 'ended', ended_at = now(), updated_at = now()
      WHERE id = ${sessionId} AND status != 'ended'
    `;
  } catch (dbErr) {
    log.error("Failed to persist session kill state:", dbErr);
  }
}

// ============================================
// Is Session Alive
// ============================================

/**
 * Returns true if a Claude CLI process is currently active for `sessionId`.
 * Checks the in-memory registry only — does not verify OS process health.
 */
export function isSessionAlive(sessionId: string): boolean {
  return activeSessions.has(sessionId);
}

// ============================================
// Internal: Stream Output
// ============================================

/**
 * Read the stdout of a Claude CLI process line by line (stream-json NDJSON).
 *
 * Publishes streaming text deltas via publishEvent for real-time WebSocket
 * delivery. Returns the full accumulated assistant text once the process exits.
 */
async function streamOutput(
  proc: ReturnType<typeof Bun.spawn>,
  sessionId: string,
): Promise<string> {
  if (!proc.stdout) {
    log.warn(`Session ${sessionId.slice(0, 8)}: no stdout pipe`);
    return "";
  }

  const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Retain the incomplete trailing line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(line) as Record<string, unknown>;
        } catch {
          // Non-JSON line (e.g. diagnostic stderr mixed in) — skip silently
          continue;
        }

        // Extract and stream text from assistant content blocks
        if (event["type"] === "assistant") {
          const message = event["message"] as Record<string, unknown> | undefined;
          const blocks = message?.["content"] as Array<Record<string, unknown>> | undefined;
          if (!Array.isArray(blocks)) continue;

          for (const block of blocks) {
            if (block["type"] === "text" && typeof block["text"] === "string") {
              const text = block["text"] as string;
              // Publish only the delta since the last known position
              if (text.length > fullText.length) {
                const delta = text.slice(fullText.length);
                fullText = text;

                await publishEvent(
                  `epic-sessions/${sessionId}`,
                  "epic.session.stream",
                  { chunk: delta, session_id: sessionId },
                ).catch(err => log.warn("publishEvent stream failed:", err));
              }
            }
          }
        }

        // The `result` event carries the final cumulative assistant text
        if (event["type"] === "result" && typeof event["result"] === "string") {
          fullText = event["result"] as string;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Drain any partial line remaining after EOF
  if (buffer.trim()) {
    try {
      const event = JSON.parse(buffer) as Record<string, unknown>;
      if (event["type"] === "result" && typeof event["result"] === "string") {
        fullText = event["result"] as string;
      }
    } catch {
      // Incomplete JSON fragment — ignore
    }
  }

  // Wait for full process exit; capture stderr for diagnostics
  const exitCode = await proc.exited;
  if (exitCode !== 0 && exitCode !== null) {
    let stderrText = "";
    if (proc.stderr) {
      try {
        stderrText = await new Response(proc.stderr as ReadableStream).text();
      } catch {
        // Non-critical: stderr read failed
      }
    }
    if (stderrText.trim()) {
      log.warn(
        `Session ${sessionId.slice(0, 8)} exited ${exitCode}: ${stderrText.slice(0, 300)}`,
      );
    }
  }

  return fullText;
}

// ============================================
// Internal: Handle Completion
// ============================================

/**
 * After the Claude process exits:
 * 1. Parse dcm-task fenced blocks from the response.
 * 2. Insert proposed tasks into `epic_proposed_tasks`.
 * 3. Persist the assistant message into `epic_messages`.
 * 4. Update `epic_sessions` status back to 'waiting'.
 * 5. Broadcast the `epic.session.message` event.
 */
async function handleSessionCompletion(
  sessionId: string,
  epicId: string,
  fullText: string,
  sql: ReturnType<typeof getDb>,
): Promise<void> {
  const tasks = extractDcmTasks(fullText);
  const hasProposals = tasks.length > 0;
  const contentType = hasProposals ? "task_proposal" : "text";

  // Rough token estimate: 1 token ≈ 4 characters
  const estimatedTokens = Math.ceil(fullText.length / 4);

  // Persist each proposed task and broadcast individual proposal events
  for (const task of tasks) {
    try {
      await sql`
        INSERT INTO epic_proposed_tasks (
          session_id, epic_id, title, description,
          agent_type, wave_number, step_order, model,
          prompt, skills
        ) VALUES (
          ${sessionId},
          ${epicId},
          ${task.title},
          ${task.description ?? null},
          ${task.agent_type ?? "Snipper"},
          ${task.wave_number ?? 0},
          ${task.step_order ?? 0},
          ${task.model ?? "sonnet"},
          ${task.prompt ?? null},
          ${sql.array(task.skills ?? ["workflow-clean-code"])}
        )
      `;

      await publishEvent(`epic-sessions/${sessionId}`, "epic.task.proposed", {
        session_id: sessionId,
        epic_id: epicId,
        task_title: task.title,
      });
    } catch (taskErr) {
      log.error(`Failed to persist proposed task "${task.title}":`, taskErr);
    }
  }

  // Persist the full assistant message
  try {
    await sql`
      INSERT INTO epic_messages (session_id, role, content, content_type)
      VALUES (${sessionId}, 'assistant', ${fullText}, ${contentType})
    `;
  } catch (msgErr) {
    log.error(
      `Failed to persist assistant message for session ${sessionId.slice(0, 8)}:`,
      msgErr,
    );
  }

  // Restore session to 'waiting' and accumulate token usage
  await sql`
    UPDATE epic_sessions
    SET
      status = 'waiting',
      token_count = token_count + ${estimatedTokens},
      updated_at = now()
    WHERE id = ${sessionId}
  `;

  // Broadcast final message event for WebSocket consumers
  await publishEvent(`epic-sessions/${sessionId}`, "epic.session.message", {
    session_id: sessionId,
    role: "assistant",
    content_type: contentType,
    has_tasks: hasProposals,
    task_count: tasks.length,
    token_count: estimatedTokens,
  });

  log.info(
    `Session ${sessionId.slice(0, 8)} complete: ${fullText.length} chars, ` +
    `${tasks.length} task(s) proposed, ~${estimatedTokens} tokens`,
  );
}

// ============================================
// Internal: Parse dcm-task Blocks
// ============================================

/**
 * Extract all ```dcm-task ... ``` fenced code blocks from the response text
 * and parse their JSON payloads.
 *
 * Blocks with missing `title` or invalid JSON are skipped with a warning.
 */
function extractDcmTasks(text: string): DcmTaskPayload[] {
  const tasks: DcmTaskPayload[] = [];
  const BLOCK_REGEX = /```dcm-task\s*\n([\s\S]*?)\n```/g;

  let match: RegExpExecArray | null;
  while ((match = BLOCK_REGEX.exec(text)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    try {
      const payload = JSON.parse(raw) as DcmTaskPayload;
      if (!payload.title) {
        log.warn('dcm-task block missing required "title" field — skipping');
        continue;
      }
      tasks.push(payload);
    } catch (parseErr) {
      log.warn("Failed to parse dcm-task block:", parseErr, "| raw:", raw.slice(0, 200));
    }
  }

  return tasks;
}

// ============================================
// Internal: Build User Prompt
// ============================================

/**
 * Format conversation history + the new user message into a single string
 * for the `-p` argument of `claude`.
 *
 * History is rendered as a plain dialogue transcript so the model has
 * prior context without relying on stateful multi-turn CLI sessions.
 */
function buildUserPrompt(
  history: Array<{ role: string; content: string }>,
  newMessage: string,
): string {
  if (history.length === 0) {
    return newMessage;
  }

  const lines: string[] = [];
  for (const msg of history) {
    const label = msg.role === "assistant" ? "Assistant" : "User";
    lines.push(`[${label}]: ${msg.content.trim()}`);
  }

  return `${lines.join("\n\n")}\n\n[User]: ${newMessage}`;
}

// ============================================
// Internal: Resolve Model ID
// ============================================

/**
 * Expand short model aliases (opus, sonnet, haiku) to full Claude model IDs.
 * Strings already containing "claude-" are returned as-is.
 */
function resolveModelId(model: string): string {
  if (model.startsWith("claude-")) return model;
  switch (model) {
    case "opus":   return "claude-opus-4-6";
    case "sonnet": return "claude-sonnet-4-6";
    case "haiku":  return "claude-haiku-4-5-20251001";
    default:       return `claude-${model}`;
  }
}
