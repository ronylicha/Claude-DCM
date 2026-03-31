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

    // Write system prompt to temp file
    const { writeFile, unlink } = await import("node:fs/promises");
    const { randomUUID } = await import("node:crypto");
    const jobId = randomUUID().slice(0, 8);
    const tmpDir = "/tmp/dcm-planner";
    await Bun.spawn(["mkdir", "-p", tmpDir]).exited;

    const promptFile = `${tmpDir}/${jobId}.prompt`;
    await writeFile(promptFile, systemMsg, "utf-8");

    // Get pipeline_id from context if available (for streaming chunks to DB)
    const pipelineId = (request as CLIPlannerRequest)._pipeline_id;

    log.info(`CLI planner (${this.command}): starting job ${jobId}`);

    // Build CLI command based on the tool
    const args = this.buildCliArgs(promptFile, userMsg, request.model);

    log.info(`CLI planner: ${this.command} ${args.join(" ").slice(0, 100)}...`);

    // Spawn the process with stdout piped for streaming
    const proc = Bun.spawn([this.command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    // Stream stdout chunks to DB and collect full output
    const contentParts: string[] = [];
    let chunkIndex = 0;
    const sql = getDb();
    const decoder = new TextDecoder();

    const reader = proc.stdout.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        if (text) {
          contentParts.push(text);
          await storeChunk(sql, pipelineId, text, chunkIndex++);
        }
      }
    } finally {
      reader.releaseLock();
    }

    const exitCode = await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    const fullOutput = contentParts.join("");

    // Cleanup temp file
    await unlink(promptFile).catch(() => {});

    const durationMs = Math.round(performance.now() - startMs);

    if (exitCode !== 0) {
      log.error(`CLI planner (${this.command}): failed (exit ${exitCode}): ${stderr.slice(0, 300)}`);
      throw new Error(`${this.name} failed (exit ${exitCode}): ${stderr.slice(0, 200)}`);
    }

    if (!fullOutput.trim()) {
      throw new Error(`${this.name} returned empty output`);
    }

    log.info(`CLI planner (${this.command}): completed in ${durationMs}ms, ${fullOutput.length} chars`);

    return {
      content: fullOutput,
      model: request.model ?? this.config.default_model,
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      provider: this.key,
      duration_ms: durationMs,
    };
  }

  private buildCliArgs(promptFile: string, userMsg: string, model?: string): string[] {
    switch (this.command) {
      case "claude":
        // text output with no tools — Claude can only produce text, no file writes
        return [
          "-p", userMsg,
          "--system-prompt-file", promptFile,
          "--model", model ?? this.config.default_model,
          "--output-format", "text",
          "--allowedTools", "",
        ];
      case "codex":
        return [
          "--quiet",
          "--model", model ?? this.config.default_model,
          "-p", userMsg,
          "--system-prompt-file", promptFile,
        ];
      case "gemini":
        return [
          "-p", userMsg,
          "--system-prompt-file", promptFile,
          "--model", model ?? this.config.default_model,
        ];
      default:
        return ["-p", userMsg, "--system-prompt-file", promptFile];
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
