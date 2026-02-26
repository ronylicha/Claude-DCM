import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("Tokens");

/** Characters per token for estimation (must match context-generator.ts) */
const CHARS_PER_TOKEN = 3.5;

// ==================== Schemas ====================

const trackTokensSchema = z.object({
  agent_id: z.string().min(1),
  session_id: z.string().min(1),
  tool_name: z.string(),
  input_size: z.number().int().min(0).optional().default(0),
  output_size: z.number().int().min(0).optional().default(0),
});

// ==================== Helpers ====================

function calculateZone(usagePercent: number): string {
  if (usagePercent >= 95) return "critical";
  if (usagePercent >= 85) return "red";
  if (usagePercent >= 70) return "orange";
  if (usagePercent >= 50) return "yellow";
  return "green";
}

function formatDuration(minutes: number): string {
  if (!isFinite(minutes) || minutes < 0) return "∞";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded}m`;
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

// ==================== Handlers ====================

export async function trackTokens(c: Context) {
  const body = await c.req.json();
  const parsed = trackTokensSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);
  }

  const { agent_id, session_id, tool_name, input_size, output_size } = parsed.data;
  const sql = getDb();

  // Estimate tokens
  const estimatedTokens = Math.min(Math.ceil((input_size + output_size) / CHARS_PER_TOKEN), 50000);

  try {
    // Get current capacity data
    let [capacity] = await sql`
      SELECT current_usage, max_capacity, consumption_rate, last_compact_at, session_id
      FROM agent_capacity
      WHERE agent_id = ${agent_id}
    `;

    // If no capacity entry exists, create one with defaults
    if (!capacity) {
      const [created] = await sql`
        INSERT INTO agent_capacity (agent_id, session_id, current_usage, max_capacity, consumption_rate, zone)
        VALUES (${agent_id}, ${session_id}, 0, 200000, 0, 'green')
        ON CONFLICT (agent_id) DO UPDATE SET session_id = ${session_id}
        RETURNING current_usage, max_capacity, consumption_rate, last_compact_at, session_id
      `;
      capacity = created;
    }

    if (!capacity) {
      return c.json({ error: "Failed to initialize agent capacity" }, 500);
    }

    const maxCapacity = capacity['max_capacity'] || 200000;
    const previousRate = capacity['consumption_rate'] || 0;
    const currentUsage = (capacity['current_usage'] || 0) + estimatedTokens;

    // Calculate consumption rate using EMA
    const instantRate = estimatedTokens; // tokens per call
    const newRate = 0.3 * instantRate + 0.7 * previousRate;

    // Calculate zone
    const usagePercent = (currentUsage / maxCapacity) * 100;
    const zone = calculateZone(usagePercent);

    // Predict exhaustion
    const remainingTokens = maxCapacity - currentUsage;
    const predictedMinutes = newRate > 0 ? remainingTokens / newRate : Infinity;

    // Upsert agent_capacity
    await sql`
      INSERT INTO agent_capacity (
        agent_id,
        session_id,
        current_usage,
        max_capacity,
        consumption_rate,
        zone,
        predicted_exhaustion_minutes,
        last_updated_at
      ) VALUES (
        ${agent_id},
        ${session_id},
        ${currentUsage},
        ${maxCapacity},
        ${newRate},
        ${zone},
        ${isFinite(predictedMinutes) ? predictedMinutes : null},
        NOW()
      )
      ON CONFLICT (agent_id) DO UPDATE SET
        session_id = ${session_id},
        current_usage = ${currentUsage},
        consumption_rate = ${newRate},
        zone = ${zone},
        predicted_exhaustion_minutes = ${isFinite(predictedMinutes) ? predictedMinutes : null},
        last_updated_at = NOW()
    `;

    // Insert token consumption record
    await sql`
      INSERT INTO token_consumption (
        agent_id, session_id, tool_name,
        input_tokens, output_tokens, total_tokens
      ) VALUES (
        ${agent_id}, ${session_id}, ${tool_name},
        ${Math.ceil(input_size / CHARS_PER_TOKEN)}, ${Math.ceil(output_size / CHARS_PER_TOKEN)}, ${estimatedTokens}
      )
    `;

    // Publish event if zone is orange or worse
    if (["orange", "red", "critical"].includes(zone)) {
      await publishEvent("global", "capacity.warning", {
        agent_id,
        session_id,
        zone,
        usage_percent: Math.round(usagePercent),
        remaining_tokens: remainingTokens,
        predicted_minutes: isFinite(predictedMinutes) ? Math.round(predictedMinutes) : -1,
      });
    }

    return c.body(null, 204);
  } catch (error) {
    log.error("Error tracking tokens:", error);
    return c.json({ error: "Failed to track tokens" }, 500);
  }
}

export async function getCapacity(c: Context) {
  const agentId = c.req.param("agent_id");

  if (!agentId) {
    return c.json({ error: "Agent ID required" }, 400);
  }

  const sql = getDb();

  try {
    const [capacity] = await sql`
      SELECT
        agent_id,
        current_usage,
        max_capacity,
        consumption_rate,
        zone,
        predicted_exhaustion_minutes,
        compact_count,
        last_compact_at,
        last_updated_at
      FROM agent_capacity
      WHERE agent_id = ${agentId}
    `;

    if (!capacity) {
      return c.json({ error: "Agent capacity not found" }, 404);
    }

    // Calculate shouldIntervene
    const isHighZone = ["orange", "red", "critical"].includes(capacity['zone']);
    const cooldownElapsed = !capacity['last_compact_at'] ||
      (Date.now() - new Date(capacity['last_compact_at']).getTime()) > 120000; // 120s
    const shouldIntervene = isHighZone && cooldownElapsed;

    // Format minutes_remaining
    const minutesRemaining = capacity['predicted_exhaustion_minutes']
      ? formatDuration(capacity['predicted_exhaustion_minutes'])
      : "∞";

    const usagePercent = Math.round((capacity['current_usage'] / capacity['max_capacity']) * 100);

    return c.json({
      agent_id: capacity['agent_id'],
      current_usage: capacity['current_usage'],
      max_capacity: capacity['max_capacity'],
      usage_percent: usagePercent,
      consumption_rate: Math.round(capacity['consumption_rate'] * 100) / 100,
      zone: capacity['zone'],
      minutes_remaining: minutesRemaining,
      shouldIntervene,
      compact_count: capacity['compact_count'],
      last_compact_at: capacity['last_compact_at'],
      last_updated_at: capacity['last_updated_at'],
    });
  } catch (error) {
    log.error("Error fetching capacity:", error);
    return c.json({ error: "Failed to fetch capacity" }, 500);
  }
}

// Server start time for uptime calculation
const SERVER_START = Date.now();

export async function getContextHealth(c: Context) {
  const agentId = c.req.param("agent_id");

  if (!agentId) {
    return c.json({ error: "Agent ID required" }, 400);
  }

  const sql = getDb();

  try {
    // Fetch capacity in one query (may not exist yet)
    const [capacity] = await sql`
      SELECT
        current_usage, max_capacity, consumption_rate, zone,
        predicted_exhaustion_minutes, compact_count, last_compact_at, last_updated_at
      FROM agent_capacity
      WHERE agent_id = ${agentId}
    `;

    // Server health
    const uptimeSeconds = Math.round((Date.now() - SERVER_START) / 1000);

    // Capacity data (defaults if agent not tracked yet)
    const zone = capacity?.['zone'] || "green";
    const usagePercent = capacity
      ? Math.round((capacity['current_usage'] / capacity['max_capacity']) * 100)
      : 0;
    const minutesRemaining = capacity?.['predicted_exhaustion_minutes']
      ? formatDuration(capacity['predicted_exhaustion_minutes'])
      : "∞";

    // Cooldown check for shouldIntervene
    const isHighZone = ["orange", "red", "critical"].includes(zone);
    const cooldownElapsed = !capacity?.['last_compact_at'] ||
      (Date.now() - new Date(capacity['last_compact_at']).getTime()) > 120000;

    // Recommendation
    let action: string;
    let message: string;
    if (["red", "critical"].includes(zone)) {
      action = "compact";
      message = `Context at ${usagePercent}%. Run /compact NOW.`;
    } else if (zone === "orange") {
      action = "save";
      message = `Context at ${usagePercent}%. Consider /compact soon.`;
    } else if (zone === "yellow") {
      action = "warn";
      message = `Context at ${usagePercent}%. Monitor closely.`;
    } else {
      action = "none";
      message = "Context usage normal.";
    }

    return c.json({
      server: { status: "ok", uptime_seconds: uptimeSeconds },
      capacity: {
        zone,
        usage_percent: usagePercent,
        minutes_remaining: minutesRemaining,
        current_usage: capacity?.['current_usage'] || 0,
        max_capacity: capacity?.['max_capacity'] || 200000,
        compact_count: capacity?.['compact_count'] || 0,
      },
      recommendation: { action, message },
      shouldCompact: isHighZone && cooldownElapsed,
    });
  } catch (error) {
    log.error("Error fetching context health:", error);
    return c.json({
      server: { status: "degraded", uptime_seconds: Math.round((Date.now() - SERVER_START) / 1000) },
      capacity: { zone: "unknown", usage_percent: 0, minutes_remaining: "∞" },
      recommendation: { action: "none", message: "Health check failed" },
      shouldCompact: false,
    });
  }
}

export async function resetCapacity(c: Context) {
  const agentId = c.req.param("agent_id");

  if (!agentId) {
    return c.json({ error: "Agent ID required" }, 400);
  }

  const sql = getDb();

  try {
    const [current] = await sql`
      SELECT current_usage, max_capacity, compact_count
      FROM agent_capacity
      WHERE agent_id = ${agentId}
    `;

    if (!current) {
      return c.json({ error: "Agent capacity not found" }, 404);
    }

    // Reset to 20% of previous usage (context restored)
    const newUsage = Math.round(current['current_usage'] * 0.2);
    const newCompactCount = (current['compact_count'] || 0) + 1;

    const [updated] = await sql`
      UPDATE agent_capacity
      SET
        current_usage = ${newUsage},
        zone = 'green',
        compact_count = ${newCompactCount},
        last_compact_at = NOW(),
        last_updated_at = NOW()
      WHERE agent_id = ${agentId}
      RETURNING
        agent_id,
        current_usage,
        max_capacity,
        consumption_rate,
        zone,
        predicted_exhaustion_minutes,
        compact_count,
        last_compact_at,
        last_updated_at
    `;

    if (!updated) {
      return c.json({ error: "Failed to reset capacity" }, 500);
    }

    const usagePercent = Math.round((updated['current_usage'] / updated['max_capacity']) * 100);
    const minutesRemaining = updated['predicted_exhaustion_minutes']
      ? formatDuration(updated['predicted_exhaustion_minutes'])
      : "∞";

    return c.json({
      agent_id: updated['agent_id'],
      current_usage: updated['current_usage'],
      max_capacity: updated['max_capacity'],
      usage_percent: usagePercent,
      consumption_rate: Math.round(updated['consumption_rate'] * 100) / 100,
      zone: updated['zone'],
      minutes_remaining: minutesRemaining,
      shouldIntervene: false,
      compact_count: updated['compact_count'],
      last_compact_at: updated['last_compact_at'],
      last_updated_at: updated['last_updated_at'],
    });
  } catch (error) {
    log.error("Error resetting capacity:", error);
    return c.json({ error: "Failed to reset capacity" }, 500);
  }
}
