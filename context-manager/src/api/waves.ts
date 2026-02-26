/**
 * Waves API - HTTP handlers for wave state management
 * Wraps waves/manager.ts functions as Hono route handlers
 * @module api/waves
 */

import type { Context } from "hono";
import {
  getCurrentWave,
  getWaveHistory,
  transitionToNextWave,
  getOrCreateWave,
  startWave,
} from "../waves/manager";
import { createLogger } from "../lib/logger";

const log = createLogger("API");

/**
 * GET /api/waves/:session_id/current - Get current active wave
 */
export async function getWaveCurrent(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("session_id");
    if (!sessionId) {
      return c.json({ error: "Missing session_id" }, 400);
    }

    const wave = await getCurrentWave(sessionId);
    if (!wave) {
      return c.json({ error: "No active wave found for session" }, 404);
    }

    return c.json({ wave });
  } catch (error) {
    log.error("GET /api/waves/:session_id/current error:", error);
    return c.json({
      error: "Failed to get current wave",
      message: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
}

/**
 * GET /api/waves/:session_id/history - Get all waves for a session
 */
export async function getWaveHistoryHandler(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("session_id");
    if (!sessionId) {
      return c.json({ error: "Missing session_id" }, 400);
    }

    const waves = await getWaveHistory(sessionId);

    return c.json({
      waves,
      count: waves.length,
    });
  } catch (error) {
    log.error("GET /api/waves/:session_id/history error:", error);
    return c.json({
      error: "Failed to get wave history",
      message: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
}

/**
 * POST /api/waves/:session_id/transition - Force transition to next wave
 */
export async function postWaveTransition(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("session_id");
    if (!sessionId) {
      return c.json({ error: "Missing session_id" }, 400);
    }

    const nextWave = await transitionToNextWave(sessionId);
    if (!nextWave) {
      return c.json({ error: "No next wave available or current wave not completed" }, 404);
    }

    return c.json({
      success: true,
      wave: nextWave,
    });
  } catch (error) {
    log.error("POST /api/waves/:session_id/transition error:", error);
    return c.json({
      error: "Failed to transition wave",
      message: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
}

/**
 * POST /api/waves/:session_id/create - Create a new wave
 * Body: { wave_number: number }
 */
export async function postWaveCreate(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("session_id");
    if (!sessionId) {
      return c.json({ error: "Missing session_id" }, 400);
    }

    const body = await c.req.json() as { wave_number?: number };
    if (body.wave_number === undefined || body.wave_number === null) {
      return c.json({ error: "Missing wave_number in body" }, 400);
    }

    const wave = await getOrCreateWave(sessionId, body.wave_number);

    return c.json({
      success: true,
      wave,
    }, 201);
  } catch (error) {
    log.error("POST /api/waves/:session_id/create error:", error);
    return c.json({
      error: "Failed to create wave",
      message: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
}

/**
 * POST /api/waves/:session_id/start - Start a specific wave
 * Body: { wave_number: number }
 */
export async function postWaveStart(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("session_id");
    if (!sessionId) {
      return c.json({ error: "Missing session_id" }, 400);
    }

    const body = await c.req.json() as { wave_number?: number };
    if (body.wave_number === undefined || body.wave_number === null) {
      return c.json({ error: "Missing wave_number in body" }, 400);
    }

    const wave = await startWave(sessionId, body.wave_number);

    return c.json({
      success: true,
      wave,
    });
  } catch (error) {
    log.error("POST /api/waves/:session_id/start error:", error);
    return c.json({
      error: "Failed to start wave",
      message: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
}
