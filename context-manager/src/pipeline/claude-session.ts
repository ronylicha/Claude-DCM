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
  /** Optional override: skips the BRAINSTORM_SYSTEM_PROMPT template and uses this verbatim. */
  systemPromptOverride?: string;
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

interface DcmMetaPayload {
  action: "set_title" | "finalize" | string;
  title?: string;
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
    systemPromptOverride,
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
    // Build system prompt: use override if provided, otherwise expand the default template
    let systemPrompt = systemPromptOverride
      ? systemPromptOverride
      : BRAINSTORM_SYSTEM_PROMPT
          .replace("{projectName}", projectName)
          .replace("{workspacePath}", workspacePath)
          .replace("{epicTitle}", epicTitle)
          .replace("{epicDescription}", epicDescription.trim());

    // Inject project context if available
    try {
      const ctxSql = getDb();
      const epicRows = await ctxSql<Array<{ project_id: string }>>`
        SELECT project_id FROM project_epics WHERE id = ${epicId}
      `;
      const contextProjectId = epicRows[0]?.project_id;
      if (contextProjectId) {
        const { getProjectContextForAgent } = await import("./project-context");
        const projectContext = await getProjectContextForAgent(contextProjectId, epicDescription);
        if (projectContext) {
          systemPrompt += `\n\n# CONTEXTE DU PROJET\n${projectContext}`;
        }
      }
    } catch {
      // Context module not available or no context data — proceed without it
    }

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

    // Spawn the Claude CLI process with full tool access.
    // Claude needs to explore the codebase, read files, run commands to give
    // accurate responses about the project state.
    const proc = Bun.spawn(
      [
        "claude",
        "-p", userPrompt,
        "--system-prompt-file", systemPromptFile,
        "--model", modelId,
        "--output-format", "stream-json",
        "--max-turns", "30",
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
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

    // Resolve project_id for dcm-meta processing (set_title, finalize)
    let projectId: string | undefined;
    try {
      const epicRows = await sql<Array<{ project_id: string }>>`
        SELECT project_id FROM project_epics WHERE id = ${epicId}
      `;
      projectId = epicRows[0]?.project_id;
    } catch {
      // Non-critical: finalize will fall back gracefully
    }

    // Persist results and broadcast final events
    await handleSessionCompletion(sessionId, epicId, fullText, sql, projectId);

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

        // Extract and stream structured events from assistant content blocks
        if (event["type"] === "assistant") {
          const message = event["message"] as Record<string, unknown> | undefined;
          const blocks = message?.["content"] as Array<Record<string, unknown>> | undefined;
          if (!Array.isArray(blocks)) continue;

          for (const block of blocks) {
            const bt = block["type"] as string;

            if (bt === "text" && typeof block["text"] === "string") {
              const text = block["text"] as string;
              if (text.length > fullText.length) {
                const delta = text.slice(fullText.length);
                fullText = text;
                await publishEvent(
                  `epic-sessions/${sessionId}`,
                  "epic.session.stream",
                  { session_id: sessionId, chunk: delta, kind: "text", content: delta },
                ).catch(err => log.warn("publishEvent stream failed:", err));
              }
            } else if (bt === "tool_use") {
              // Stream tool actions for live visibility
              const name = block["name"] as string ?? "";
              const input = block["input"] as Record<string, unknown> ?? {};
              const detail = String(
                input["file_path"] ?? input["command"] ?? input["pattern"] ?? input["skill"] ?? input["description"] ?? "",
              ).slice(0, 120);

              // Special-case: Skill loads use the 'skill' kind
              if (name === "Skill") {
                await publishEvent(
                  `epic-sessions/${sessionId}`,
                  "epic.session.stream",
                  { session_id: sessionId, kind: "skill", name: input["skill"] ?? "" },
                ).catch(() => {});
              } else {
                await publishEvent(
                  `epic-sessions/${sessionId}`,
                  "epic.session.stream",
                  { session_id: sessionId, kind: "action", tool: name, detail, label: name },
                ).catch(() => {});
              }
            } else if (bt === "thinking") {
              await publishEvent(
                `epic-sessions/${sessionId}`,
                "epic.session.stream",
                { session_id: sessionId, kind: "thinking" },
              ).catch(() => {});
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
 * 1. Parse dcm-meta fenced blocks and apply side-effects (set_title, finalize).
 * 2. Parse dcm-task fenced blocks from the response.
 * 3. Insert proposed tasks into `epic_proposed_tasks`.
 * 4. Persist the assistant message into `epic_messages`.
 * 5. Update `epic_sessions` status back to 'waiting'.
 * 6. Broadcast the `epic.session.message` event.
 */
async function handleSessionCompletion(
  sessionId: string,
  epicId: string,
  fullText: string,
  sql: ReturnType<typeof getDb>,
  projectId?: string,
): Promise<void> {
  // ---- Process dcm-meta blocks ----
  const metaBlocks = extractDcmMeta(fullText);
  let titleWasSet = false;
  for (const meta of metaBlocks) {
    try {
      if (meta.action === "set_title" && meta.title) {
        await sql`
          UPDATE project_epics
          SET title = ${meta.title}, updated_at = now()
          WHERE id = ${epicId}
        `;
        await publishEvent(`epic-sessions/${sessionId}`, "epic.meta.set_title", {
          session_id: sessionId,
          epic_id: epicId,
          title: meta.title,
        });
        log.info(`Epic ${epicId.slice(0, 8)} title updated to: "${meta.title}"`);
        titleWasSet = true;
      } else if (meta.action === "finalize") {
        await handleAutoFinalize(sessionId, epicId, sql, projectId);
      }
    } catch (metaErr) {
      log.error(`Failed to process dcm-meta block (action=${meta.action}):`, metaErr);
    }
  }

  // Fallback: if Claude didn't emit set_title and epic is still "New Epic",
  // derive a title from the first user message (first sentence, max 60 chars)
  if (!titleWasSet) {
    try {
      const [currentEpic] = await sql<Array<{ title: string }>>`
        SELECT title FROM project_epics WHERE id = ${epicId}
      `;
      if (currentEpic?.title === "New Epic") {
        const [firstUserMsg] = await sql<Array<{ content: string }>>`
          SELECT content FROM epic_messages
          WHERE session_id = ${sessionId} AND role = 'user'
          ORDER BY created_at ASC LIMIT 1
        `;
        if (firstUserMsg?.content) {
          const derived = firstUserMsg.content
            .replace(/[\n\r]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 60);
          if (derived.length > 0) {
            await sql`
              UPDATE project_epics
              SET title = ${derived}, updated_at = now()
              WHERE id = ${epicId}
            `;
            log.info(`Epic ${epicId.slice(0, 8)} title derived from user message: "${derived}"`);
            await publishEvent(`epic-sessions/${sessionId}`, "epic.meta.set_title", {
              session_id: sessionId,
              epic_id: epicId,
              title: derived,
            });
          }
        }
      }
    } catch (fallbackErr) {
      log.warn(`Title fallback failed for epic ${epicId.slice(0, 8)}:`, fallbackErr);
    }
  }

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

  // Persist the full assistant message and capture the inserted row
  let messageId: string | null = null;
  let messageCreatedAt: string | null = null;
  try {
    const [inserted] = await sql<Array<{ id: string; created_at: string }>>`
      INSERT INTO epic_messages (session_id, role, content, content_type)
      VALUES (${sessionId}, 'assistant', ${fullText}, ${contentType})
      RETURNING id, created_at::text
    `;
    messageId = inserted?.id ?? null;
    messageCreatedAt = inserted?.created_at ?? null;
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

  // Broadcast final message event — keep payload small (PG NOTIFY 8KB limit).
  // Frontend refetches full messages via HTTP when it receives this event.
  await publishEvent(`epic-sessions/${sessionId}`, "epic.session.message", {
    session_id: sessionId,
    message_id: messageId,
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
// Internal: Parse dcm-meta Blocks
// ============================================

/**
 * Extract all ```dcm-meta ... ``` fenced code blocks from the response text
 * and parse their JSON payloads.
 *
 * Blocks with invalid JSON are skipped with a warning.
 */
function extractDcmMeta(text: string): DcmMetaPayload[] {
  const metas: DcmMetaPayload[] = [];
  const BLOCK_REGEX = /```dcm-meta\s*\n([\s\S]*?)\n```/g;

  let match: RegExpExecArray | null;
  while ((match = BLOCK_REGEX.exec(text)) !== null) {
    const raw = match[1]?.trim();
    if (!raw) continue;

    try {
      const payload = JSON.parse(raw) as DcmMetaPayload;
      if (!payload.action) {
        log.warn('dcm-meta block missing required "action" field — skipping');
        continue;
      }
      metas.push(payload);
    } catch (parseErr) {
      log.warn("Failed to parse dcm-meta block:", parseErr, "| raw:", raw.slice(0, 200));
    }
  }

  return metas;
}

// ============================================
// Internal: Auto-Finalize
// ============================================

/**
 * Handle the `finalize` dcm-meta action:
 * 1. Auto-approve all proposed tasks in 'proposed' status.
 * 2. Ensure the epic has a linked pipeline (ensureEpicPipeline).
 * 3. Insert pipeline_steps for each approved task.
 * 4. Mark proposed tasks as 'executing'.
 * 5. Publish epic.auto_finalized event.
 * 6. Mark the session as 'ended'.
 */
async function handleAutoFinalize(
  sessionId: string,
  epicId: string,
  sql: ReturnType<typeof getDb>,
  projectId?: string,
): Promise<void> {
  log.info(`Auto-finalizing epic ${epicId.slice(0, 8)} session ${sessionId.slice(0, 8)}`);

  // Fetch all proposed tasks for this session
  const proposedTasks = await sql<Array<{
    id: string;
    title: string;
    description: string | null;
    agent_type: string;
    wave_number: number;
    step_order: number;
    model: string;
    prompt: string | null;
    skills: string[];
  }>>`
    SELECT id, title, description, agent_type, wave_number, step_order, model, prompt, skills
    FROM epic_proposed_tasks
    WHERE session_id = ${sessionId} AND status = 'proposed'
  `;

  if (proposedTasks.length === 0) {
    log.info(`No proposed tasks to finalize for session ${sessionId.slice(0, 8)}`);
  } else {
    // Resolve epic project_id if not provided
    let resolvedProjectId = projectId;
    if (!resolvedProjectId) {
      const [epicRow] = await sql<Array<{ project_id: string }>>`
        SELECT project_id FROM project_epics WHERE id = ${epicId}
      `;
      resolvedProjectId = epicRow?.project_id;
    }

    if (!resolvedProjectId) {
      log.error(`Cannot finalize epic ${epicId}: project_id not found`);
    } else {
      const { ensureEpicPipeline } = await import("./epic-sync");
      const { pipeline_id: pipelineId } = await ensureEpicPipeline(epicId, resolvedProjectId);

      for (const task of proposedTasks) {
        try {
          // Auto-approve
          await sql`
            UPDATE epic_proposed_tasks
            SET status = 'approved', decided_at = now()
            WHERE id = ${task.id}
          `;

          // Insert pipeline step
          const [step] = await sql<Array<{ id: string }>>`
            INSERT INTO pipeline_steps (
              pipeline_id, wave_number, step_order, agent_type,
              description, skills, prompt, model, status
            ) VALUES (
              ${pipelineId},
              ${task.wave_number},
              ${task.step_order},
              ${task.agent_type},
              ${task.description ?? null},
              ${sql.array(task.skills)},
              ${task.prompt ?? null},
              ${task.model},
              'pending'
            )
            ON CONFLICT (pipeline_id, wave_number, step_order)
            DO UPDATE SET
              agent_type  = EXCLUDED.agent_type,
              description = EXCLUDED.description,
              skills      = EXCLUDED.skills,
              prompt      = EXCLUDED.prompt,
              model       = EXCLUDED.model,
              status      = 'pending'
            RETURNING id
          `;

          const stepId = step?.id;

          // Link step back to proposed task and mark as executing
          await sql`
            UPDATE epic_proposed_tasks
            SET status = 'executing', pipeline_step_id = ${stepId ?? null}
            WHERE id = ${task.id}
          `;
        } catch (taskErr) {
          log.error(`Failed to finalize task "${task.title}":`, taskErr);
        }
      }

      // Queue all pending steps for execution
      await sql`
        UPDATE pipeline_steps SET status = 'queued'
        WHERE pipeline_id = ${pipelineId} AND status = 'pending'
      `;

      // Notify pipeline dashboard of new steps
      await publishEvent("global", "pipeline.step.updated", {
        pipeline_id: pipelineId,
        source: "epic_finalize",
        tasks_added: proposedTasks.length,
      });

      log.info(
        `Finalized ${proposedTasks.length} task(s) for epic ${epicId.slice(0, 8)} → pipeline ${pipelineId.slice(0, 8)}`,
      );
    }
  }

  // Publish auto_finalized event
  await publishEvent(`epic-sessions/${sessionId}`, "epic.auto_finalized", {
    session_id: sessionId,
    epic_id: epicId,
    task_count: proposedTasks.length,
  });

  // End the session
  await sql`
    UPDATE epic_sessions
    SET status = 'ended', ended_at = now(), updated_at = now()
    WHERE id = ${sessionId}
  `;

  log.info(`Session ${sessionId.slice(0, 8)} ended after auto-finalize`);
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
