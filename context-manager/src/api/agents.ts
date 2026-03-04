/**
 * Agents API - Track turns, relaunch agents
 * Phase 10 - Subagent iteration management
 * @module api/agents
 */

import type { Context } from "hono";
import { getDb } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("Agents");

/**
 * POST /api/agents/track-turn - Increment turns_used for a running agent
 * Body: { agent_id: string, session_id?: string }
 * Returns: { turns_used, max_turns, should_warn, should_stop }
 */
export async function trackAgentTurn(c: Context): Promise<Response> {
  try {
    const body = await c.req.json() as { agent_id: string; session_id?: string };

    if (!body.agent_id) {
      return c.json({ error: "Missing agent_id" }, 400);
    }

    const sql = getDb();

    const result = await sql`
      UPDATE subtasks
      SET turns_used = COALESCE(turns_used, 0) + 1
      WHERE agent_id = ${body.agent_id}
        AND status = 'running'
      RETURNING id, agent_type, turns_used, max_turns, retry_count
    `;

    if (result.length === 0) {
      return c.json({ error: "No running subtask found for agent_id" }, 404);
    }

    const row = result[0];
    const turnsUsed = Number(row.turns_used);
    const maxTurns = row.max_turns ? Number(row.max_turns) : null;

    const shouldWarn = maxTurns !== null && turnsUsed >= Math.floor(maxTurns * 0.8);
    const shouldStop = maxTurns !== null && turnsUsed >= maxTurns;

    return c.json({
      agent_id: body.agent_id,
      agent_type: row.agent_type,
      subtask_id: row.id,
      turns_used: turnsUsed,
      max_turns: maxTurns,
      retry_count: Number(row.retry_count),
      should_warn: shouldWarn,
      should_stop: shouldStop,
    });
  } catch (error) {
    log.error("POST /api/agents/track-turn error:", error);
    return c.json({ error: "Failed to track turn" }, 500);
  }
}

/**
 * GET /api/agents/:agent_id/status - Get agent iteration status
 */
export async function getAgentStatus(c: Context): Promise<Response> {
  try {
    const agentId = c.req.param("agent_id");
    const sql = getDb();

    const result = await sql`
      SELECT id, agent_type, agent_id, status, turns_used, max_turns,
             retry_count, description, last_relaunch_context,
             started_at, completed_at
      FROM subtasks
      WHERE agent_id = ${agentId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (result.length === 0) {
      return c.json({ error: "Agent not found" }, 404);
    }

    return c.json({ agent: result[0] });
  } catch (error) {
    log.error("GET /api/agents/:agent_id/status error:", error);
    return c.json({ error: "Failed to get agent status" }, 500);
  }
}

/**
 * POST /api/agents/relaunch - Prepare relaunch context for an exhausted agent
 * Body: { agent_id: string, partial_result?: string }
 * Returns: { should_relaunch, retry_count, relaunch_prompt, original_description }
 */
export async function relaunchAgent(c: Context): Promise<Response> {
  try {
    const body = await c.req.json() as {
      agent_id: string;
      partial_result?: string;
    };

    if (!body.agent_id) {
      return c.json({ error: "Missing agent_id" }, 400);
    }

    const sql = getDb();

    const result = await sql`
      SELECT id, agent_type, agent_id, description, turns_used, max_turns,
             retry_count, result, last_relaunch_context
      FROM subtasks
      WHERE agent_id = ${body.agent_id}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (result.length === 0) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const agent = result[0];
    const retryCount = Number(agent.retry_count);
    const maxRetries = 2;

    if (retryCount >= maxRetries) {
      return c.json({
        should_relaunch: false,
        reason: "max_retries_exceeded",
        retry_count: retryCount,
        max_retries: maxRetries,
        agent_type: agent.agent_type,
        description: agent.description,
      });
    }

    const partialResult = body.partial_result || "";
    const previousContext = (agent.last_relaunch_context as string) || "";
    const compactedContext = [
      previousContext ? `Previous attempt context: ${previousContext}` : "",
      partialResult ? `Partial result from attempt ${retryCount + 1}: ${partialResult}` : "",
    ].filter(Boolean).join("\n").slice(0, 2000);

    await sql`
      UPDATE subtasks
      SET retry_count = retry_count + 1,
          last_relaunch_context = ${compactedContext},
          status = 'failed',
          completed_at = NOW()
      WHERE id = ${agent.id}
    `;

    const relaunchPrompt = [
      `RELAUNCH (attempt ${retryCount + 2}/3) - Continue the following task:`,
      `Original task: ${agent.description}`,
      compactedContext ? `\nContext from previous attempt(s):\n${compactedContext}` : "",
      `\nContinue where the previous agent left off. Do NOT restart from scratch.`,
    ].filter(Boolean).join("\n");

    return c.json({
      should_relaunch: true,
      retry_count: retryCount + 1,
      max_retries: maxRetries,
      agent_type: agent.agent_type,
      original_description: agent.description,
      relaunch_prompt: relaunchPrompt,
      max_turns: agent.max_turns,
    });
  } catch (error) {
    log.error("POST /api/agents/relaunch error:", error);
    return c.json({ error: "Failed to prepare relaunch" }, 500);
  }
}
