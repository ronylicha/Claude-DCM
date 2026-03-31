/**
 * Settings API — LLM provider configuration
 * @module api/settings
 */

import type { Context } from "hono";
import { z } from "zod";
import { listProviders, configureProvider, deactivateProvider, testProvider, setPlannerProvider } from "../llm";
import { createLogger } from "../lib/logger";

const log = createLogger("Settings");

const ConfigureProviderSchema = z.object({
  api_key: z.string().optional(),
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

/** GET /api/settings/planner — Get planner configuration */
export async function getPlannerSettings(c: Context): Promise<Response> {
  try {
    const sql = (await import("../db/client")).getDb();
    const [setting] = await sql`SELECT value FROM dcm_settings WHERE key = 'planner'`;
    const providers = await listProviders();
    const plannerProviders = providers.filter(p => p.has_key || p.provider_key.endsWith("-cli"));

    return c.json({
      current: setting?.["value"] ?? { provider_key: null },
      available_planners: plannerProviders,
    });
  } catch (error) {
    log.error("GET planner settings error:", error);
    return c.json({ error: "Failed to get planner settings", message: error instanceof Error ? error.message : "Unknown" }, 500);
  }
}

/** POST /api/settings/planner — Set planner provider + model */
export async function postPlannerSettings(c: Context): Promise<Response> {
  try {
    const body = await c.req.json() as { provider_key: string; model?: string };
    if (!body.provider_key) return c.json({ error: "provider_key required" }, 400);

    await setPlannerProvider(body.provider_key, body.model);
    return c.json({ success: true, message: `Planner set to ${body.provider_key}${body.model ? ` (${body.model})` : ""}` });
  } catch (error) {
    log.error("POST planner settings error:", error);
    return c.json({ error: "Failed to set planner", message: error instanceof Error ? error.message : "Unknown" }, 500);
  }
}
