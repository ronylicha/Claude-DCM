/**
 * Sessions API - Manage Claude Code sessions
 * @module api/sessions
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("API");

interface SessionRow {
  id: string;
  project_id: string | null;
  started_at: string;
  ended_at: string | null;
  total_tools_used: number;
  total_success: number;
  total_errors: number;
}

interface CreateSessionBody {
  id: string;
  project_id?: string;
  started_at?: string;
  ended_at?: string;
  total_tools_used?: number;
  total_success?: number;
  total_errors?: number;
}

/** Zod schema for session creation validation */
const CreateSessionSchema = z.object({
  id: z.string().min(1, "id is required"),
  project_id: z.string().uuid().optional(),
  started_at: z.string().datetime().optional(),
  ended_at: z.string().datetime().optional(),
  total_tools_used: z.number().int().min(0).optional(),
  total_success: z.number().int().min(0).optional(),
  total_errors: z.number().int().min(0).optional(),
});

/**
 * POST /api/sessions - Create a new session
 */
export async function postSession(c: Context) {
  try {
    const raw = await c.req.json();

    // Validate input with Zod
    const parseResult = CreateSessionSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        400
      );
    }
    const body = parseResult.data;

    const sql = getDb();

    // Check if session already exists
    const existing = await sql<SessionRow[]>`
      SELECT id FROM sessions WHERE id = ${body.id}
    `;

    if (existing.length > 0) {
      return c.json({ error: "Session already exists", id: body.id }, 409);
    }

    const result = await sql<SessionRow[]>`
      INSERT INTO sessions (
        id,
        project_id,
        started_at,
        ended_at,
        total_tools_used,
        total_success,
        total_errors
      ) VALUES (
        ${body.id},
        ${body.project_id ?? null},
        ${body.started_at ? new Date(body.started_at) : new Date()},
        ${body.ended_at ? new Date(body.ended_at) : null},
        ${body.total_tools_used ?? 0},
        ${body.total_success ?? 0},
        ${body.total_errors ?? 0}
      )
      RETURNING *
    `;

    const created = result[0]!;

    // Publish real-time event via PostgreSQL NOTIFY
    await publishEvent("global", "session.created", {
      id: created.id,
      session_id: body.id,
    });

    return c.json(created, 201);
  } catch (error) {
    log.error("POST /api/sessions error:", error);
    return c.json(
      {
        error: "Failed to create session",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/sessions - List sessions with optional filters
 * Query params: project_id, limit, offset, active_only
 */
export async function getSessions(c: Context) {
  try {
    const sql = getDb();
    const projectId = c.req.query("project_id");
    const limit = Math.min(parseInt(c.req.query("limit") || "50", 10), 100);
    const offset = parseInt(c.req.query("offset") || "0");
    const activeOnly = c.req.query("active_only") === "true";

    let sessions: SessionRow[];

    if (projectId) {
      if (activeOnly) {
        sessions = await sql<SessionRow[]>`
          SELECT * FROM sessions
          WHERE project_id = ${projectId} AND (ended_at IS NULL OR ended_at > NOW() - INTERVAL '30 minutes')
          ORDER BY started_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else {
        sessions = await sql<SessionRow[]>`
          SELECT * FROM sessions
          WHERE project_id = ${projectId}
          ORDER BY started_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      }
    } else {
      if (activeOnly) {
        sessions = await sql<SessionRow[]>`
          SELECT * FROM sessions
          WHERE (ended_at IS NULL OR ended_at > NOW() - INTERVAL '30 minutes')
          ORDER BY started_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      } else {
        sessions = await sql<SessionRow[]>`
          SELECT * FROM sessions
          ORDER BY started_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `;
      }
    }

    // Get total count
    const countResult = await sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM sessions
      ${projectId ? sql`WHERE project_id = ${projectId}` : sql``}
    `;

    return c.json({
      sessions,
      total: parseInt(countResult[0]?.count || "0"),
      limit,
      offset,
    });
  } catch (error) {
    log.error("GET /api/sessions error:", error);
    return c.json(
      {
        error: "Failed to fetch sessions",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/sessions/:id - Get a specific session
 */
export async function getSessionById(c: Context) {
  try {
    const id = c.req.param("id");
    const sql = getDb();

    const sessions = await sql<SessionRow[]>`
      SELECT * FROM sessions WHERE id = ${id}
    `;

    if (sessions.length === 0) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Get associated requests
    const requests = await sql`
      SELECT id, prompt, prompt_type, status, created_at
      FROM requests
      WHERE session_id = ${id}
      ORDER BY created_at DESC
      LIMIT 20
    `;

    return c.json({
      ...sessions[0],
      requests,
    });
  } catch (error) {
    log.error("GET /api/sessions/:id error:", error);
    return c.json(
      {
        error: "Failed to fetch session",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * PATCH /api/sessions/:id - Update a session
 */
export async function patchSession(c: Context) {
  try {
    const id = c.req.param("id");
    const body = await c.req.json<Partial<CreateSessionBody>>();
    const sql = getDb();

    // Check if session exists
    const existing = await sql<SessionRow[]>`
      SELECT id FROM sessions WHERE id = ${id}
    `;

    if (existing.length === 0) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Build update query dynamically
    const updates: string[] = [];
    const values: unknown[] = [];

    if (body.ended_at !== undefined) {
      updates.push("ended_at");
      values.push(body.ended_at ? new Date(body.ended_at) : null);
    }
    if (body.total_tools_used !== undefined) {
      updates.push("total_tools_used");
      values.push(body.total_tools_used);
    }
    if (body.total_success !== undefined) {
      updates.push("total_success");
      values.push(body.total_success);
    }
    if (body.total_errors !== undefined) {
      updates.push("total_errors");
      values.push(body.total_errors);
    }

    if (updates.length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    // Update fields — ended_at=null explicitly sets it to NULL (reactivation)
    const result = await sql<SessionRow[]>`
      UPDATE sessions SET
        ended_at = ${body.ended_at === null ? null : body.ended_at !== undefined ? new Date(body.ended_at) : sql`ended_at`},
        total_tools_used = COALESCE(${body.total_tools_used ?? null}, total_tools_used),
        total_success = COALESCE(${body.total_success ?? null}, total_success),
        total_errors = COALESCE(${body.total_errors ?? null}, total_errors)
      WHERE id = ${id}
      RETURNING *
    `;

    // Publish real-time event via PostgreSQL NOTIFY
    if (body.ended_at) {
      await publishEvent("global", "session.ended", { id });
    }

    return c.json(result[0]);
  } catch (error) {
    log.error("PATCH /api/sessions/:id error:", error);
    return c.json(
      {
        error: "Failed to update session",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/sessions/stats - Get sessions statistics
 */
export async function getSessionsStats(c: Context) {
  try {
    const sql = getDb();

    const stats = await sql`
      SELECT
        COUNT(*) as total_sessions,
        COUNT(CASE WHEN ended_at IS NULL OR ended_at > NOW() - INTERVAL '30 minutes' THEN 1 END) as active_sessions,
        SUM(total_tools_used) as total_tools,
        SUM(total_success) as total_success,
        SUM(total_errors) as total_errors,
        AVG(total_tools_used) as avg_tools_per_session,
        MIN(started_at) as oldest_session,
        MAX(started_at) as newest_session
      FROM sessions
    `;

    const projectStats = await sql`
      SELECT
        p.name as project_name,
        p.path as project_path,
        COUNT(s.id) as session_count,
        SUM(s.total_tools_used) as total_tools
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      GROUP BY p.id, p.name, p.path
      ORDER BY session_count DESC
      LIMIT 10
    `;

    return c.json({
      overview: stats[0],
      by_project: projectStats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error("GET /api/sessions/stats error:", error);
    return c.json(
      {
        error: "Failed to fetch sessions stats",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * DELETE /api/sessions/:id - Delete a session
 * @param c - Hono context
 */
export async function deleteSession(c: Context) {
  try {
    const id = c.req.param("id");

    if (!id) {
      return c.json({ error: "Missing session ID" }, 400);
    }

    const sql = getDb();

    const results = await sql<{ id: string }[]>`
      DELETE FROM sessions WHERE id = ${id} RETURNING id
    `;

    if (results.length === 0) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Publish real-time event
    await publishEvent("global", "session.deleted", {
      id,
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    log.error("DELETE /api/sessions/:id error:", error);
    return c.json(
      {
        error: "Failed to delete session",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}
