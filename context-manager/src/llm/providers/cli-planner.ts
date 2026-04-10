/**
 * CLI-based LLM planner — spawns claude/codex/gemini CLI
 * Streams output chunks to DB for live viewing.
 * @module llm/providers/cli-planner
 */

import type { ChatCompletionRequest, ChatCompletionResponse, LLMProvider, LLMProviderRow } from "../types";
import { createLogger } from "../../lib/logger";
import { getDb, publishEvent } from "../../db/client";

const log = createLogger("CLIPlanner");

/** Extended request type carrying pipeline context for streaming */
interface CLIPlannerRequest extends ChatCompletionRequest {
  _pipeline_id?: string;
}

export class CLIPlannerProvider implements LLMProvider {
  readonly key: string;
  readonly name: string;
  private command: string;

  constructor(private readonly config: LLMProviderRow) {
    this.key = config.provider_key;
    this.name = config.display_name;
    const cliConfig = config.config as Record<string, unknown>;
    this.command = String(cliConfig["command"] ?? "claude");
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const startMs = performance.now();

    // Build the prompt from messages
    const systemMsg = request.messages.find(m => m.role === "system")?.content ?? "";
    const userMsg = request.messages.find(m => m.role === "user")?.content ?? "";

    // Write prompts to temp files (avoids shell escaping issues)
    const { writeFile, readFile } = await import("node:fs/promises");
    const { randomUUID } = await import("node:crypto");
    const jobId = randomUUID().slice(0, 8);
    const tmpDir = "/tmp/dcm-planner";
    await Bun.spawn(["mkdir", "-p", tmpDir]).exited;

    // Empty MCP config to prevent MCP servers from starting
    const emptyMcpFile = `${tmpDir}/empty-mcp.json`;
    await writeFile(emptyMcpFile, '{"mcpServers":{}}', "utf-8");

    const promptFile = `${tmpDir}/${jobId}.prompt`;
    const userFile = `${tmpDir}/${jobId}.user`;
    const scriptFile = `${tmpDir}/${jobId}.sh`;
    const outputFile = `${tmpDir}/${jobId}.output`;
    const errorFile = `${tmpDir}/${jobId}.error`;
    const doneFile = `${tmpDir}/${jobId}.done`;

    await writeFile(promptFile, systemMsg, "utf-8");
    await writeFile(userFile, userMsg, "utf-8");

    // Get pipeline_id from context if available (for streaming chunks to DB)
    const pipelineId = (request as CLIPlannerRequest)._pipeline_id;
    const model = request.model ?? this.config.default_model;

    log.info(`CLI planner (${this.command}): starting job ${jobId}, model=${model}`);

    // Write a shell script to avoid all escaping issues
    const scriptContent = this.buildScript(promptFile, userFile, outputFile, errorFile, doneFile, model);
    await writeFile(scriptFile, scriptContent, "utf-8");
    await Bun.spawn(["chmod", "+x", scriptFile]).exited;

    // Launch in separate systemd scope so it survives service restarts
    Bun.spawn(
      ["systemd-run", "--user", "--scope", "--", "bash", scriptFile],
      { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
    );

    const sql = getDb();

    // Register job in DB so the worker can recover it after service restart
    if (pipelineId) {
      await sql`
        INSERT INTO pipeline_jobs (pipeline_id, job_id, job_type, tmp_dir, status)
        VALUES (${pipelineId}, ${jobId}, 'planner', ${tmpDir}, 'running')
      `.catch(() => {});
    }

    let lastSize = 0;
    let chunkIndex = 0;
    const isStreamJson = this.command === "claude";

    // Poll the output file for new content + stream chunks to DB
    // The worker.ts also polls — this is a fast-path for when the service doesn't restart
    const fullOutput = await new Promise<string>((resolve, reject) => {
      const pollInterval = setInterval(async () => {
        try {
          // Check if done
          const doneExists = await Bun.file(doneFile).exists();

          // Read new output since last check
          try {
            const currentContent = await readFile(outputFile, "utf-8");
            if (currentContent.length > lastSize) {
              const prevSize = lastSize;
              lastSize = currentContent.length;
              if (isStreamJson) {
                // Parse new stream-json events into structured JSON chunks
                const newBytes = currentContent.slice(prevSize);
                const events = parseStreamEvents(newBytes);
                for (const evt of events) {
                  await storeChunk(sql, pipelineId, JSON.stringify(evt), chunkIndex++);
                }
              } else {
                const newChunk = currentContent.slice(prevSize);
                await storeChunk(sql, pipelineId, newChunk, chunkIndex++);
              }
            }
          } catch {
            // File not ready yet
          }

          if (doneExists) {
            clearInterval(pollInterval);
            const exitCode = (await readFile(doneFile, "utf-8").catch(() => "1")).trim();
            const rawOutput = await readFile(outputFile, "utf-8").catch(() => "");
            const output = isStreamJson ? extractStreamResult(rawOutput) : rawOutput;
            const stderr = await readFile(errorFile, "utf-8").catch(() => "");

            // Cleanup temp files
            for (const f of [outputFile, errorFile, doneFile]) {
              await Bun.spawn(["rm", "-f", f]).exited;
            }

            if (exitCode !== "0") {
              reject(new Error(`${this.name} failed (exit ${exitCode}): ${stderr.slice(0, 200)}`));
              return;
            }
            if (!output.trim()) {
              reject(new Error(`${this.name} returned empty output`));
              return;
            }
            resolve(output);
          }
        } catch (error) {
          clearInterval(pollInterval);
          reject(error);
        }
      }, 3000); // Poll every 3 seconds
    });

    // Cleanup prompt file
    await Bun.spawn(["rm", "-f", promptFile]).exited;

    const durationMs = Math.round(performance.now() - startMs);
    log.info(`CLI planner (${this.command}): completed in ${durationMs}ms, ${fullOutput.length} chars`);

    return {
      content: fullOutput,
      model: request.model ?? this.config.default_model,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      provider: this.key,
      duration_ms: durationMs,
    };
  }

  /** Build a shell script that runs the CLI and redirects output to files.
   *  All arguments are read from files — no shell escaping needed. */
  private buildScript(
    promptFile: string, userFile: string,
    outputFile: string, errorFile: string, doneFile: string,
    model: string,
  ): string {
    switch (this.command) {
      case "claude":
        return `#!/bin/bash
USER_MSG=$(cat "${userFile}")
stdbuf -oL -eL claude -p "$USER_MSG" --system-prompt-file "${promptFile}" --model "${model}" --output-format stream-json --max-turns 15 --tools "Read,Bash,Grep,Glob" --strict-mcp-config --mcp-config "/tmp/dcm-planner/empty-mcp.json" < /dev/null > "${outputFile}" 2> "${errorFile}"
echo $? > "${doneFile}"
`;
      case "codex":
        return `#!/bin/bash
USER_MSG=$(cat "${userFile}")
codex --quiet --model "${model}" -p "$USER_MSG" --system-prompt-file "${promptFile}" > "${outputFile}" 2> "${errorFile}"
echo $? > "${doneFile}"
`;
      case "gemini":
        return `#!/bin/bash
USER_MSG=$(cat "${userFile}")
gemini -p "$USER_MSG" --system-prompt-file "${promptFile}" --model "${model}" > "${outputFile}" 2> "${errorFile}"
echo $? > "${doneFile}"
`;
      default:
        return `#!/bin/bash
USER_MSG=$(cat "${userFile}")
${this.command} -p "$USER_MSG" --system-prompt-file "${promptFile}" > "${outputFile}" 2> "${errorFile}"
echo $? > "${doneFile}"
`;
    }
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    // testConnection doesn't need streaming
    try {
      // Check if the CLI binary exists
      const which = Bun.spawn(["which", this.command], { stdout: "pipe", stderr: "pipe" });
      const code = await which.exited;
      if (code !== 0) {
        return { ok: false, error: `${this.command} not found in PATH` };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: `Failed to check ${this.command}` };
    }
  }
}

/** Store a streaming chunk in DB and broadcast via WebSocket */
async function storeChunk(
  sql: ReturnType<typeof getDb>,
  pipelineId: string | undefined,
  text: string,
  index: number,
): Promise<void> {
  if (!pipelineId || !text.trim()) return;
  try {
    await sql`
      INSERT INTO planning_output (pipeline_id, chunk, chunk_index)
      VALUES (${pipelineId}, ${text}, ${index})
    `;
    await publishEvent("global", "pipeline.planning.chunk", {
      pipeline_id: pipelineId,
      chunk: text,
      chunk_index: index,
    });
  } catch {
    // Don't let DB errors break the stream
  }
}

/**
 * Parse new stream-json NDJSON lines into structured event objects.
 * Each event is stored as a separate JSON chunk in the DB for the dashboard
 * to render as distinct visual blocks.
 */
function parseStreamEvents(newContent: string): Array<Record<string, string>> {
  const events: Array<Record<string, string>> = [];
  for (const line of newContent.split("\n")) {
    if (!line.trim()) continue;
    try {
      const raw = JSON.parse(line) as Record<string, unknown>;
      const type = raw["type"] as string;

      if (type === "assistant") {
        const msg = raw["message"] as Record<string, unknown> | undefined;
        const blocks = msg?.["content"] as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(blocks)) continue;
        for (const block of blocks) {
          const bt = block["type"] as string;
          if (bt === "text" && block["text"]) {
            events.push({ kind: "text", content: block["text"] as string });
          } else if (bt === "tool_use") {
            const name = block["name"] as string ?? "";
            const input = block["input"] as Record<string, unknown> ?? {};
            if (name === "Skill") {
              events.push({ kind: "skill", name: String(input["skill"] ?? "") });
            } else if (name === "Agent") {
              events.push({
                kind: "agent",
                agent: String(input["subagent_type"] ?? ""),
                description: String(input["description"] ?? ""),
              });
            } else {
              const detail = actionDetail(name, input);
              events.push({ kind: "action", tool: name, label: detail.label, detail: detail.detail ?? "" });
            }
          } else if (bt === "thinking") {
            events.push({ kind: "thinking" });
          }
        }
      } else if (type === "system" && raw["subtype"] === "hook_started") {
        events.push({ kind: "system", label: String(raw["hook_name"] ?? "") });
      }
    } catch { continue; }
  }
  return events;
}

/** Extract a human-readable label + detail for a tool_use action. */
function actionDetail(name: string, input: Record<string, unknown>): { label: string; detail?: string } {
  switch (name) {
    case "Read": return { label: "Lecture", detail: String(input["file_path"] ?? "") };
    case "Write": return { label: "Écriture", detail: String(input["file_path"] ?? "") };
    case "Edit": return { label: "Modification", detail: String(input["file_path"] ?? "") };
    case "Grep": return { label: "Recherche", detail: String(input["pattern"] ?? "") };
    case "Glob": return { label: "Fichiers", detail: String(input["pattern"] ?? "") };
    case "Bash": return { label: "Commande", detail: String(input["command"] ?? "").slice(0, 100) };
    default: return { label: name };
  }
}

/**
 * Extract cumulative text from the last assistant event in stream-json NDJSON.
 * Used by extractStreamResult as fallback for plan text extraction.
 * Returns "" if no assistant event with text found yet.
 */
function extractStreamText(content: string): string {
  const lines = content.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event["type"] === "assistant") {
        const msg = event["message"] as Record<string, unknown> | undefined;
        const blocks = msg?.["content"] as Array<{ type: string; text?: string }> | undefined;
        if (Array.isArray(blocks)) {
          return blocks
            .filter(b => b.type === "text" && b.text)
            .map(b => b.text!)
            .join("");
        }
      }
    } catch { continue; }
  }
  return "";
}

/**
 * Extract final text from completed stream-json output.
 * Prioritizes the `result` event, falls back to last assistant text,
 * then raw output for non-stream formats.
 */
function extractStreamResult(output: string): string {
  const lines = output.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (event["type"] === "result" && typeof event["result"] === "string") {
        return event["result"];
      }
    } catch { continue; }
  }
  return extractStreamText(output) || output;
}
