/**
 * LLM Service — Registry and facade for LLM providers
 * @module llm/service
 */

import type { ChatCompletionRequest, ChatCompletionResponse, LLMProvider, LLMProviderRow } from "./types";
import { MiniMaxProvider } from "./providers/minimax";
import { ZhipuAIProvider } from "./providers/zhipuai";
import { MoonshotProvider } from "./providers/moonshot";
import { getDb } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("LLMService");

/** Provider class constructor type */
type ProviderConstructor = new (config: LLMProviderRow) => LLMProvider;

/** Registry of provider implementations */
const PROVIDER_REGISTRY: Record<string, ProviderConstructor> = {
  minimax: MiniMaxProvider,
  zhipuai: ZhipuAIProvider,
  moonshot: MoonshotProvider,
};

/**
 * Register a new provider implementation.
 * Call this to add support for additional LLMs.
 */
export function registerProvider(key: string, constructor: ProviderConstructor): void {
  PROVIDER_REGISTRY[key] = constructor;
  log.info(`Provider registered: ${key}`);
}

/**
 * Get the default active provider, or a specific one by key.
 */
export async function getProvider(providerKey?: string): Promise<LLMProvider> {
  const sql = getDb();

  let row: LLMProviderRow | undefined;

  if (providerKey) {
    const rows = await sql<LLMProviderRow[]>`
      SELECT * FROM llm_providers WHERE provider_key = ${providerKey} AND is_active = true
    `;
    row = rows[0];
  } else {
    // Get default provider
    const rows = await sql<LLMProviderRow[]>`
      SELECT * FROM llm_providers WHERE is_default = true AND is_active = true
    `;
    row = rows[0];

    // Fallback: first active provider
    if (!row) {
      const fallback = await sql<LLMProviderRow[]>`
        SELECT * FROM llm_providers WHERE is_active = true ORDER BY created_at LIMIT 1
      `;
      row = fallback[0];
    }
  }

  if (!row) {
    throw new Error(providerKey
      ? `Provider '${providerKey}' not found or not active`
      : "No active LLM provider configured. Go to Settings to add an API key.");
  }

  const Constructor = PROVIDER_REGISTRY[row.provider_key];
  if (!Constructor) {
    throw new Error(`No implementation registered for provider '${row.provider_key}'`);
  }

  return new Constructor(row);
}

/**
 * List all providers with their status (hides API keys).
 */
export async function listProviders(): Promise<Array<Omit<LLMProviderRow, "api_key_encrypted"> & { has_key: boolean }>> {
  const sql = getDb();
  const rows = await sql<LLMProviderRow[]>`SELECT * FROM llm_providers ORDER BY display_name`;
  return rows.map((r) => ({
    id: r.id,
    provider_key: r.provider_key,
    display_name: r.display_name,
    base_url: r.base_url,
    endpoint_path: r.endpoint_path,
    default_model: r.default_model,
    available_models: r.available_models,
    is_active: r.is_active,
    is_default: r.is_default,
    config: r.config,
    created_at: r.created_at,
    updated_at: r.updated_at,
    has_key: r.api_key_encrypted !== null && r.api_key_encrypted.length > 0,
  }));
}

/**
 * Save API key and activate a provider.
 */
export async function configureProvider(
  providerKey: string,
  apiKey: string,
  options?: { model?: string; setDefault?: boolean },
): Promise<void> {
  const sql = getDb();

  // If setting as default, unset others first
  if (options?.setDefault) {
    await sql`UPDATE llm_providers SET is_default = false WHERE is_default = true`;
  }

  await sql`
    UPDATE llm_providers
    SET
      api_key_encrypted = ${apiKey},
      is_active = true,
      is_default = COALESCE(${options?.setDefault ?? false}, is_default),
      default_model = COALESCE(${options?.model ?? null}, default_model),
      updated_at = NOW()
    WHERE provider_key = ${providerKey}
  `;

  log.info(`Provider configured: ${providerKey} (default: ${options?.setDefault ?? false})`);
}

/**
 * Deactivate a provider (keeps key for reactivation).
 */
export async function deactivateProvider(providerKey: string): Promise<void> {
  const sql = getDb();
  await sql`UPDATE llm_providers SET is_active = false, is_default = false WHERE provider_key = ${providerKey}`;
  log.info(`Provider deactivated: ${providerKey}`);
}

/**
 * Complete a chat using the default or specified provider.
 * This is the main entry point for the planner.
 */
export async function chatComplete(
  request: ChatCompletionRequest,
  providerKey?: string,
): Promise<ChatCompletionResponse> {
  const provider = await getProvider(providerKey);
  return provider.complete(request);
}

/**
 * Test a provider's API key.
 */
export async function testProvider(providerKey: string): Promise<{ ok: boolean; error?: string }> {
  const provider = await getProvider(providerKey);
  return provider.testConnection();
}
