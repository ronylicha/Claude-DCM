/**
 * Base LLM Provider — Common logic for OpenAI-compatible APIs
 * @module llm/base-provider
 */

import type { ChatCompletionRequest, ChatCompletionResponse, LLMProvider, LLMProviderRow } from "./types";
import { createLogger } from "../lib/logger";

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

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const result = await this.complete({
        messages: [{ role: "user", content: "Say OK" }],
        max_tokens: 10,
      });
      return { ok: result.content.length > 0 };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }
}
