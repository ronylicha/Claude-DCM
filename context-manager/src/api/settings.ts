/**
 * Settings API — LLM provider configuration
 * @module api/settings
 */

import type { Context } from "hono";
import { z } from "zod";
import { listProviders, configureProvider, deactivateProvider, testProvider } from "../llm";
import { createLogger } from "../lib/logger";

const log = createLogger("Settings");

const ConfigureProviderSchema = z.object({
  api_key: z.string().min(1, "API key is required"),
  model: z.string().optional(),
  set_default: z.boolean().optional(),
});

/** GET /api/settings/providers — List all LLM providers */
export async function getProviders(c: Context): Promise<Response> {
  try {
    const providers = await listProviders();
    return c.json({ providers });
  } catch (error) {
    log.error("GET /api/settings/providers error:", error);
    return c.json({ error: "Failed to list providers", message: error instanceof Error ? error.message : "Unknown" }, 500);
  }
}

/** POST /api/settings/providers/:key/configure — Set API key + activate */
export async function postConfigureProvider(c: Context): Promise<Response> {
  try {
    const key = c.req.param("key");
    if (!key) return c.json({ error: "Missing provider key" }, 400);

    const body = await c.req.json();
    const result = ConfigureProviderSchema.safeParse(body);
    if (!result.success) return c.json({ error: "Validation failed", details: result.error.flatten().fieldErrors }, 400);

    const { api_key, model, set_default } = result.data;
    await configureProvider(key, api_key, {
      ...(model !== undefined ? { model } : {}),
      ...(set_default !== undefined ? { setDefault: set_default } : {}),
    });

    log.info(`Provider configured: ${key}`);
    return c.json({ success: true, message: `Provider ${key} configured and activated` });
  } catch (error) {
    log.error("POST configure provider error:", error);
    return c.json({ error: "Failed to configure provider", message: error instanceof Error ? error.message : "Unknown" }, 500);
  }
}

/** POST /api/settings/providers/:key/test — Test API key */
export async function postTestProvider(c: Context): Promise<Response> {
  try {
    const key = c.req.param("key");
    if (!key) return c.json({ error: "Missing provider key" }, 400);

    const result = await testProvider(key);
    return c.json(result);
  } catch (error) {
    log.error("POST test provider error:", error);
    return c.json({ ok: false, error: error instanceof Error ? error.message : "Unknown" });
  }
}

/** POST /api/settings/providers/:key/deactivate — Deactivate provider */
export async function postDeactivateProvider(c: Context): Promise<Response> {
  try {
    const key = c.req.param("key");
    if (!key) return c.json({ error: "Missing provider key" }, 400);

    await deactivateProvider(key);
    return c.json({ success: true });
  } catch (error) {
    log.error("POST deactivate provider error:", error);
    return c.json({ error: "Failed to deactivate", message: error instanceof Error ? error.message : "Unknown" }, 500);
  }
}
