/**
 * Blocking API - Agent blocking management
 * Phase 4 - POST/GET/DELETE /api/blocking endpoints
 * @module api/blocking
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";

/** Zod schema for blocking input validation */
const BlockingInputSchema = z.object({
  blocked_by: z.string().min(1, "blocked_by is required"),
  blocked_agent: z.string().min(1, "blocked_agent is required"),
  reason: z.string().max(500).optional(),
});

type BlockingInput = z.infer<typeof BlockingInputSchema>;

/** Database row type for blocked agents */
interface BlockedAgentRow {
  id: string;
  blocked_by: string;
  blocked_agent: string;
  reason: string | null;
  created_at: string;
}

/**
 * POST /api/blocking - Block an agent
 * @param c - Hono context
 */
export async function postBlocking(c: Context): Promise<Response> {
  try {
    const body = await c.req.json();

    // Validate input with Zod
    const parseResult = BlockingInputSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400
      );
    }

    const input: BlockingInput = parseResult.data;

    // Prevent self-blocking
    if (input.blocked_by === input.blocked_agent) {
      return c.json(
        { error: "An agent cannot block itself" },
        400
      );
    }

    const sql = getDb();

    // Upsert blocking record (update reason if already exists)
    const [blocked] = await sql<BlockedAgentRow[]>`
      INSERT INTO blocked_agents (blocked_by, blocked_agent, reason)
      VALUES (${input.blocked_by}, ${input.blocked_agent}, ${input.reason ?? null})
      ON CONFLICT (blocked_by, blocked_agent)
      DO UPDATE SET
        reason = EXCLUDED.reason
      RETURNING id, blocked_by, blocked_agent, reason, created_at
    `;

    // Publish real-time event via PostgreSQL NOTIFY
    await publishEvent(`agents/${blocked.blocked_agent}`, "agent.blocked", {
      by: blocked.blocked_by,
      reason: blocked.reason,
    });

    return c.json(
      {
        success: true,
        blocking: {
          id: blocked.id,
          blocked_by: blocked.blocked_by,
          blocked_agent: blocked.blocked_agent,
          reason: blocked.reason,
          created_at: blocked.created_at,
        },
      },
      201
    );
  } catch (error) {
    console.error("[API] POST /api/blocking error:", error);
    return c.json(
      {
        error: "Failed to block agent",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/blocking/:agent_id - Check if an agent is blocked
 * Returns all blocking relationships for the agent (both as blocker and blocked)
 * @param c - Hono context
 */
export async function getBlocking(c: Context): Promise<Response> {
  try {
    const agentId = c.req.param("agent_id");

    if (!agentId) {
      return c.json({ error: "Missing agent_id parameter" }, 400);
    }

    const sql = getDb();

    // Get all blocks where this agent is blocked by others
    const blockedBy = await sql<BlockedAgentRow[]>`
      SELECT id, blocked_by, blocked_agent, reason, created_at
      FROM blocked_agents
      WHERE blocked_agent = ${agentId}
      ORDER BY created_at DESC
    `;

    // Get all blocks where this agent is blocking others
    const blocking = await sql<BlockedAgentRow[]>`
      SELECT id, blocked_by, blocked_agent, reason, created_at
      FROM blocked_agents
      WHERE blocked_by = ${agentId}
      ORDER BY created_at DESC
    `;

    return c.json({
      agent_id: agentId,
      is_blocked: blockedBy.length > 0,
      blocked_by: blockedBy.map((b) => ({
        id: b.id,
        by_agent: b.blocked_by,
        reason: b.reason,
        since: b.created_at,
      })),
      is_blocking: blocking.length > 0,
      blocking: blocking.map((b) => ({
        id: b.id,
        agent: b.blocked_agent,
        reason: b.reason,
        since: b.created_at,
      })),
      summary: {
        blocked_by_count: blockedBy.length,
        blocking_count: blocking.length,
      },
    });
  } catch (error) {
    console.error("[API] GET /api/blocking/:agent_id error:", error);
    return c.json(
      {
        error: "Failed to check blocking status",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * DELETE /api/blocking/:blocked_id - Unblock an agent by blocking record ID
 * @param c - Hono context
 */
export async function deleteBlocking(c: Context): Promise<Response> {
  try {
    const blockedId = c.req.param("blocked_id");

    if (!blockedId) {
      return c.json({ error: "Missing blocked_id parameter" }, 400);
    }

    const sql = getDb();

    // Delete and return the deleted row
    const deleted = await sql<BlockedAgentRow[]>`
      DELETE FROM blocked_agents
      WHERE id = ${blockedId}
      RETURNING id, blocked_by, blocked_agent, reason
    `;

    if (deleted.length === 0) {
      return c.json({ error: "Blocking record not found" }, 404);
    }

    // Publish real-time event via PostgreSQL NOTIFY
    await publishEvent(`agents/${deleted[0].blocked_agent}`, "agent.unblocked", {
      by: deleted[0].blocked_by,
    });

    return c.json({
      success: true,
      unblocked: {
        id: deleted[0].id,
        blocked_by: deleted[0].blocked_by,
        blocked_agent: deleted[0].blocked_agent,
        reason: deleted[0].reason,
      },
    });
  } catch (error) {
    console.error("[API] DELETE /api/blocking/:blocked_id error:", error);
    return c.json(
      {
        error: "Failed to unblock agent",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * POST /api/unblock - Unblock by blocked_by and blocked_agent
 * Alternative to DELETE with ID
 * @param c - Hono context
 */
export async function postUnblock(c: Context): Promise<Response> {
  try {
    const body = await c.req.json();

    const schema = z.object({
      blocked_by: z.string().min(1),
      blocked_agent: z.string().min(1),
    });

    const parseResult = schema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400
      );
    }

    const { blocked_by, blocked_agent } = parseResult.data;
    const sql = getDb();

    const deleted = await sql<BlockedAgentRow[]>`
      DELETE FROM blocked_agents
      WHERE blocked_by = ${blocked_by} AND blocked_agent = ${blocked_agent}
      RETURNING id, blocked_by, blocked_agent, reason
    `;

    if (deleted.length === 0) {
      return c.json({ error: "Blocking record not found" }, 404);
    }

    // Publish real-time event via PostgreSQL NOTIFY
    await publishEvent(`agents/${deleted[0].blocked_agent}`, "agent.unblocked", {
      by: deleted[0].blocked_by,
    });

    return c.json({
      success: true,
      unblocked: {
        id: deleted[0].id,
        blocked_by: deleted[0].blocked_by,
        blocked_agent: deleted[0].blocked_agent,
        reason: deleted[0].reason,
      },
    });
  } catch (error) {
    console.error("[API] POST /api/unblock error:", error);
    return c.json(
      {
        error: "Failed to unblock agent",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/blocking/check - Check if a specific agent pair has a block
 * Query params: blocker, blocked
 * @param c - Hono context
 */
export async function checkBlocking(c: Context): Promise<Response> {
  try {
    const blocker = c.req.query("blocker");
    const blocked = c.req.query("blocked");

    if (!blocker || !blocked) {
      return c.json(
        { error: "Missing required query params: blocker and blocked" },
        400
      );
    }

    const sql = getDb();

    const [result] = await sql<[{ exists: boolean } | undefined]>`
      SELECT EXISTS(
        SELECT 1 FROM blocked_agents
        WHERE blocked_by = ${blocker} AND blocked_agent = ${blocked}
      ) as exists
    `;

    return c.json({
      blocker,
      blocked,
      is_blocked: result?.exists ?? false,
    });
  } catch (error) {
    console.error("[API] GET /api/blocking/check error:", error);
    return c.json(
      {
        error: "Failed to check blocking status",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * Check if agent is blocked (used internally)
 * @param blockedBy - The agent doing the blocking
 * @param blockedAgent - The agent being blocked
 * @returns true if blocked
 */
export async function isAgentBlocked(
  blockedBy: string,
  blockedAgent: string
): Promise<boolean> {
  const sql = getDb();

  const [result] = await sql<[{ exists: boolean }]>`
    SELECT EXISTS(
      SELECT 1 FROM blocked_agents
      WHERE blocked_by = ${blockedBy} AND blocked_agent = ${blockedAgent}
    ) as exists
  `;

  return result.exists;
}

export type { BlockingInput, BlockedAgentRow };
