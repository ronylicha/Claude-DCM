import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("TokensRealtime");

// Schema for statusline data
const realtimeTokenSchema = z.object({
  session_id: z.string().min(1),
  agent_id: z.string().optional().default("orchestrator"),
  total_input_tokens: z.number().int().min(0),
  total_output_tokens: z.number().int().min(0),
  context_window_size: z.number().int().min(1),
  used_percentage: z.number().min(0).max(100),
  model_id: z.string().optional().default("unknown"),
});

// EMA smoothing factor
const EMA_ALPHA = 0.3;

// Zone calculation (same thresholds as tokens.ts)
function calculateZone(usagePercent: number): string {
  if (usagePercent >= 95) return "critical";
  if (usagePercent >= 85) return "red";
  if (usagePercent >= 70) return "orange";
  if (usagePercent >= 50) return "yellow";
  return "green";
}

// Cooldown tracking for preemptive summarization (in-memory)
const summarizationCooldowns = new Map<string, number>();
const SUMMARIZATION_COOLDOWN_MS = 120_000; // 2 minutes

export async function postTokensRealtime(c: Context) {
  const body = await c.req.json();
  const parsed = realtimeTokenSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);
  }

  const {
    session_id,
    agent_id,
    total_input_tokens,
    total_output_tokens,
    context_window_size,
    used_percentage,
    model_id,
  } = parsed.data;
  const total_tokens = total_input_tokens + total_output_tokens;
  const zone = calculateZone(used_percentage);

  log.info(`Realtime: session=${session_id.slice(0,8)} model=${model_id} tokens=${total_tokens} window=${context_window_size} pct=${used_percentage}%`);

  const db = getDb();

  try {
    // 1. Get previous state for EMA calculation
    const [existing] = await db`
      SELECT current_usage, consumption_rate, zone, last_statusline_at
      FROM agent_capacity
      WHERE agent_id = ${agent_id}
    `;

    // Calculate EMA consumption rate
    let newRate = 0;
    if (existing?.last_statusline_at) {
      const elapsed =
        (Date.now() - new Date(existing.last_statusline_at).getTime()) / 60000; // minutes
      if (elapsed > 0) {
        const delta = total_tokens - (existing.current_usage || 0);
        const instantRate = Math.max(0, delta) / elapsed; // tokens per minute
        const previousRate = existing.consumption_rate || 0;
        newRate = EMA_ALPHA * instantRate + (1 - EMA_ALPHA) * previousRate;
      }
    }

    // Calculate predicted exhaustion
    const remainingTokens = context_window_size - total_tokens;
    const predictedMinutes = newRate > 0 ? remainingTokens / newRate : null;

    // 2. Upsert agent_capacity with real data
    await db`
      INSERT INTO agent_capacity (
        agent_id, session_id, max_capacity, current_usage, consumption_rate,
        predicted_exhaustion_minutes, zone, real_input_tokens, real_output_tokens,
        model_id, source, last_statusline_at, last_updated_at
      ) VALUES (
        ${agent_id}, ${session_id}, ${context_window_size}, ${total_tokens}, ${newRate},
        ${predictedMinutes}, ${zone}, ${total_input_tokens}, ${total_output_tokens},
        ${model_id}, 'statusline', NOW(), NOW()
      )
      ON CONFLICT (agent_id) DO UPDATE SET
        session_id = EXCLUDED.session_id,
        max_capacity = EXCLUDED.max_capacity,
        current_usage = EXCLUDED.current_usage,
        consumption_rate = EXCLUDED.consumption_rate,
        predicted_exhaustion_minutes = EXCLUDED.predicted_exhaustion_minutes,
        zone = EXCLUDED.zone,
        real_input_tokens = EXCLUDED.real_input_tokens,
        real_output_tokens = EXCLUDED.real_output_tokens,
        model_id = EXCLUDED.model_id,
        source = EXCLUDED.source,
        last_statusline_at = NOW(),
        last_updated_at = NOW()
    `;

    // 3. Check for threshold crossing and publish events
    const previousZone = existing?.zone || "green";

    // Broadcast capacity update via WebSocket
    await publishEvent("global", "capacity.update", {
      session_id,
      agent_id,
      used_percentage,
      zone,
      consumption_rate: newRate,
      predicted_exhaustion_minutes: predictedMinutes,
      real_tokens: {
        input: total_input_tokens,
        output: total_output_tokens,
        total: total_tokens,
      },
      context_window_size,
      model_id,
      source: "statusline",
    });

    // Threshold crossing notification
    if (previousZone !== zone) {
      const thresholds: Record<string, number> = {
        yellow: 50,
        orange: 70,
        red: 85,
        critical: 95,
      };
      const threshold = thresholds[zone];
      if (threshold !== undefined) {
        await publishEvent("global", "capacity.threshold", {
          session_id,
          agent_id,
          threshold,
          zone,
          previous_zone: previousZone,
          used_percentage,
          action:
            zone === "red" ? "preemptive_summary_triggered" : "warning",
        });
      }
    }

    // 4. Trigger preemptive summarization at 85%+
    let summarization_triggered = false;
    if (used_percentage >= 85) {
      const lastTrigger = summarizationCooldowns.get(session_id) || 0;
      if (Date.now() - lastTrigger > SUMMARIZATION_COOLDOWN_MS) {
        // Check no summary already generating
        const [generating] = await db`
          SELECT id FROM preemptive_summaries
          WHERE session_id = ${session_id} AND status = 'generating'
          LIMIT 1
        `;

        if (!generating) {
          // Mark as generating
          await db`
            INSERT INTO preemptive_summaries (session_id, agent_id, summary, source, context_tokens_at_trigger, status)
            VALUES (${session_id}, ${agent_id}, '', 'headless-agent', ${total_tokens}, 'generating')
          `;

          summarizationCooldowns.set(session_id, Date.now());
          summarization_triggered = true;

          // Launch headless summarization in background
          const scriptPath = `${import.meta.dir}/../../scripts/preemptive-summarize.sh`;
          Bun.spawn(["bash", scriptPath], {
            env: {
              ...process.env,
              SESSION_ID: session_id,
              TOKENS_USED: String(total_tokens),
              DCM_API_URL: `http://127.0.0.1:${process.env["PORT"] || "3847"}`,
            },
            stdout: "ignore",
            stderr: "ignore",
          });

          await publishEvent("global", "summary.status", {
            session_id,
            status: "generating",
            context_tokens_at_trigger: total_tokens,
          });
        }
      }
    }

    // 5. Update calibration ratio
    // Compare real tokens (from statusline) vs estimated tokens (from token_consumption table)
    const [estimatedSum] = await db`
      SELECT COALESCE(SUM(total_tokens), 0) as estimated
      FROM token_consumption
      WHERE session_id = ${session_id}
    `;

    const estimatedTokens = Number(estimatedSum?.estimated || 0);
    if (estimatedTokens > 0 && total_tokens > 0) {
      const ratio = total_tokens / estimatedTokens;
      await db`
        INSERT INTO calibration_ratios (session_id, ratio, real_tokens, estimated_tokens)
        VALUES (${session_id}, ${ratio}, ${total_tokens}, ${estimatedTokens})
      `;
    }

    return c.json({
      ok: true,
      zone,
      used_percentage,
      predicted_exhaustion_minutes: predictedMinutes,
      consumption_rate: newRate,
      summarization_triggered,
    });
  } catch (error) {
    log.error("POST /api/tokens/realtime error:", error);
    return c.json({ error: "Failed to track tokens" }, 500);
  }
}

// GET /api/tokens/projection/:session_id — Project token availability for 5h and 7d
export async function getTokenProjection(c: Context) {
  const session_id = c.req.param("session_id");
  const db = getDb();

  try {
    // Get all active capacities for this session
    const capacities = await db`
      SELECT agent_id, current_usage, max_capacity, consumption_rate, zone, model_id, source
      FROM agent_capacity
      WHERE session_id = ${session_id}
      ORDER BY current_usage DESC
    `;

    if (capacities.length === 0) {
      return c.json({ error: "No capacity data for session" }, 404);
    }

    // Aggregate: use the main orchestrator or highest usage agent
    const main = capacities[0];
    const remaining = main.max_capacity - main.current_usage;
    const rate = main.consumption_rate || 0;

    function project(periodMinutes: number) {
      if (rate <= 0) return { total_tokens: remaining, compactions: 0 };

      const usableAfterCompact = main.max_capacity * 0.80;
      const minutesUntilCompact = remaining / rate;
      let totalTokens = remaining;
      let compactions = 0;
      let timeLeft = periodMinutes - minutesUntilCompact;

      while (timeLeft > 0) {
        compactions++;
        totalTokens += usableAfterCompact;
        const minutesPerCycle = usableAfterCompact / rate;
        timeLeft -= minutesPerCycle;
      }

      return { total_tokens: Math.round(totalTokens), compactions };
    }

    const projection_5h = project(300);
    const projection_7d = project(10080);

    return c.json({
      session_id,
      agent_id: main.agent_id,
      model_id: main.model_id,
      current: {
        usage: main.current_usage,
        max: main.max_capacity,
        remaining,
        zone: main.zone,
        rate,
      },
      projection_5h,
      projection_7d,
    });
  } catch (error) {
    log.error("GET /api/tokens/projection error:", error);
    return c.json({ error: "Failed to project tokens" }, 500);
  }
}

// GET /api/tokens/calibration/:session_id — Latest calibration ratio
export async function getTokenCalibration(c: Context) {
  const session_id = c.req.param("session_id");
  const db = getDb();

  try {
    const [latest] = await db`
      SELECT ratio, real_tokens, estimated_tokens, calculated_at
      FROM calibration_ratios
      WHERE session_id = ${session_id}
      ORDER BY calculated_at DESC
      LIMIT 1
    `;

    if (!latest) {
      return c.json({
        ratio: 1.0,
        source: "default",
        message: "No calibration data yet",
      });
    }

    return c.json({
      ratio: latest.ratio,
      real_tokens: latest.real_tokens,
      estimated_tokens: latest.estimated_tokens,
      calculated_at: latest.calculated_at,
      source: "calibrated",
    });
  } catch (error) {
    log.error("GET /api/tokens/calibration error:", error);
    return c.json({ error: "Failed to get calibration" }, 500);
  }
}
