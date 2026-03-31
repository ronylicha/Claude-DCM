/**
 * LLM Provider Types — Extensible provider system
 * @module llm/types
 */

/** Chat message format (OpenAI-compatible) */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Chat completion request */
export interface ChatCompletionRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

/** Chat completion response */
export interface ChatCompletionResponse {
  content: string;
  model: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  provider: string;
  duration_ms: number;
}

/** Provider configuration from DB */
export interface LLMProviderRow {
  id: string;
  provider_key: string;
  display_name: string;
  base_url: string;
  endpoint_path: string;
  default_model: string;
  available_models: string[];
  api_key_encrypted: string | null;
  is_active: boolean;
  is_default: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Provider interface — implement for each LLM */
export interface LLMProvider {
  readonly key: string;
  readonly name: string;

  /** Call the chat completion API */
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

  /** Test if the API key is valid */
  testConnection(): Promise<{ ok: boolean; error?: string }>;
}
