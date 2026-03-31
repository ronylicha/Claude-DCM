/**
 * Base LLM Provider — Common logic for OpenAI-compatible APIs
 * @module llm/base-provider
 */

import type { ChatCompletionRequest, ChatCompletionResponse, LLMProvider, LLMProviderRow } from "./types";
import { createLogger } from "../lib/logger";
import { getDb, publishEvent } from "../db/client";

const log = createLogger("LLM");

/**
 * Base provider for OpenAI-compatible chat APIs.
 * Handles HTTP calls, auth, error handling. Subclasses override
 * `buildHeaders()` and `transformResponse()` for provider-specific needs.
 */
export abstract class BaseLLMProvider implements LLMProvider {
  abstract readonly key: string;
  abstract readonly name: string;

  constructor(protected readonly config: LLMProviderRow) {}

  /** Build the full URL for chat completions */
  protected buildUrl(): string {
    const base = this.config.base_url.replace(/\/+$/, "");
    const path = this.config.endpoint_path.startsWith("/")
      ? this.config.endpoint_path
      : `/${this.config.endpoint_path}`;
    return `${base}${path}`;
  }

  /** Build request headers. Override for provider-specific headers. */
  protected buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.config.api_key_encrypted ?? ""}`,
    };
  }

  /** Build the request body. Override for provider-specific fields. */
  protected buildBody(request: ChatCompletionRequest): Record<string, unknown> {
    const providerConfig = this.config.config ?? {};
    return {
      model: request.model ?? this.config.default_model,
      messages: request.messages,
      temperature: request.temperature ?? (providerConfig["temperature"] as number | undefined) ?? 0.7,
      max_tokens: request.max_tokens ?? 4096,
      stream: false,
    };
  }

  /** Extract content from the API response. Override for non-standard formats. */
  protected extractContent(data: Record<string, unknown>): string {
    const choices = data["choices"] as Array<Record<string, unknown>> | undefined;
    const firstChoice = choices?.[0];
    const message = firstChoice?.["message"] as Record<string, unknown> | undefined;
    return String(message?.["content"] ?? "");
  }

  /** Extract token usage from the API response. */
  protected extractUsage(data: Record<string, unknown>): ChatCompletionResponse["usage"] {
    const usage = data["usage"] as Record<string, unknown> | undefined;
    return {
      prompt_tokens: Number(usage?.["prompt_tokens"] ?? 0),
      completion_tokens: Number(usage?.["completion_tokens"] ?? 0),
      total_tokens: Number(usage?.["total_tokens"] ?? 0),
    };
  }

  async complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = this.buildUrl();
    const headers = this.buildHeaders();
    const body = this.buildBody(request);
    const startMs = performance.now();
    const pipelineId = (request as ChatCompletionRequest & { _pipeline_id?: string })._pipeline_id;

    // Use streaming when we have a pipeline_id (for live output)
    if (pipelineId) {
      return this.completeStreaming(url, headers, body, startMs, pipelineId);
    }

    // Non-streaming (test, simple calls)
    log.info(`${this.name}: calling ${url} (model: ${body["model"]})`);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error(`${this.name}: API error ${response.status}: ${errorText.slice(0, 300)}`);
      throw new Error(`${this.name} API error (${response.status}): ${errorText.slice(0, 200)}`);
    }

    const data = await response.json() as Record<string, unknown>;
    const durationMs = Math.round(performance.now() - startMs);

    const result: ChatCompletionResponse = {
      content: this.extractContent(data),
      model: String(data["model"] ?? body["model"]),
      usage: this.extractUsage(data),
      provider: this.key,
      duration_ms: durationMs,
    };

    log.info(`${this.name}: completed in ${durationMs}ms (${result.usage.total_tokens} tokens)`);
    return result;
  }

  /** Streaming completion — sends chunks to DB + WebSocket for live viewing */
  private async completeStreaming(
    url: string,
    headers: Record<string, string>,
    body: Record<string, unknown>,
    startMs: number,
    pipelineId: string,
  ): Promise<ChatCompletionResponse> {
    // Enable streaming in the request body
    body["stream"] = true;
    log.info(`${this.name}: streaming call to ${url} (model: ${body["model"]})`);

    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error(`${this.name}: streaming API error ${response.status}: ${errorText.slice(0, 300)}`);
      throw new Error(`${this.name} API error (${response.status}): ${errorText.slice(0, 200)}`);
    }

    if (!response.body) {
      throw new Error(`${this.name}: no response body for streaming`);
    }

    const sql = getDb();
    const contentParts: string[] = [];
    let chunkIndex = 0;
    let lineBuffer = "";
    const decoder = new TextDecoder();
    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        lineBuffer += decoder.decode(value, { stream: true });
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          // SSE format: "data: {...}" or "data: [DONE]"
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") continue;

          try {
            const chunk = JSON.parse(payload) as Record<string, unknown>;
            const choices = chunk["choices"] as Array<Record<string, unknown>> | undefined;
            const delta = choices?.[0]?.["delta"] as Record<string, unknown> | undefined;
            const text = String(delta?.["content"] ?? "");
            // Some providers also stream reasoning
            const reasoning = String(delta?.["reasoning_content"] ?? "");
            const output = text || reasoning;

            if (output) {
              contentParts.push(output);
              // Store chunk for live dashboard viewing
              try {
                await sql`
                  INSERT INTO planning_output (pipeline_id, chunk, chunk_index)
                  VALUES (${pipelineId}, ${output}, ${chunkIndex++})
                `;
                await publishEvent("global", "pipeline.planning.chunk", {
                  pipeline_id: pipelineId,
                  chunk: output,
                  chunk_index: chunkIndex - 1,
                });
              } catch {
                // Don't let DB errors break the stream
              }
            }
          } catch {
            // Ignore unparseable lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const durationMs = Math.round(performance.now() - startMs);
    const fullContent = contentParts.join("");

    log.info(`${this.name}: streaming completed in ${durationMs}ms, ${fullContent.length} chars, ${chunkIndex} chunks`);

    return {
      content: fullContent,
      model: String(body["model"]),
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      provider: this.key,
      duration_ms: durationMs,
    };
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await this.complete({
        messages: [{ role: "user", content: "Say OK in one word" }],
        max_tokens: 5000,
      });
      return { ok: result.content.length > 0 };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }
}
