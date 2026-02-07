/**
 * Subtasks API - Manage subtasks (objectives within a wave)
 * Phase 3.4 - POST/GET /api/subtasks endpoints
 * @module api/subtasks
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";

/** Input schema for subtask creation */
export interface SubtaskInput {
  task_id: string; // Maps to task_list_id
  description: string;
  agent_type?: string;
  agent_id?: string;
  status?: string; // pending, running, paused, blocked, completed, failed
  blocked_by?: string[]; // UUIDs of blocking subtasks
  context_snapshot?: Record<string, unknown>;
}

/** Subtask row from database */
interface SubtaskRow {
  id: string;
  task_list_id: string;
  agent_type: string | null;
  agent_id: string | null;
  description: string;
  status: string;
  blocked_by: string[] | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  context_snapshot: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
}

/** Action row from database */
interface ActionRow {
  id: string;
  tool_name: string;
  tool_type: string;
  exit_code: number;
  duration_ms: number | null;
  file_paths: string[] | null;
  created_at: string;
}

/** Valid subtask statuses */
const VALID_SUBTASK_STATUSES = ["pending", "running", "paused", "blocked", "completed", "failed"] as const;

/** Zod schema for subtask input validation */
const SubtaskInputSchema = z.object({
  task_id: z.string().uuid("task_id must be a valid UUID"),
  description: z.string().min(1, "description is required"),
  agent_type: z.string().optional(),
  agent_id: z.string().optional(),
  status: z.enum(VALID_SUBTASK_STATUSES).optional(),
  blocked_by: z.array(z.string().uuid()).optional(),
  context_snapshot: z.record(z.unknown()).optional(),
});

/**
 * POST /api/subtasks - Create a new subtask
 * @param c - Hono context
 */
export async function postSubtask(c: Context): Promise<Response> {
  try {
    const raw = await c.req.json();

    // Validate input with Zod
    const parseResult = SubtaskInputSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        400
      );
    }
    const body = parseResult.data;

    const sql = getDb();

    // Verify task exists
    const taskResults = await sql<{ id: string }[]>`
      SELECT id FROM task_lists WHERE id = ${body.task_id}
    `;

    if (!taskResults[0]) {
      return c.json(
        { error: `Task not found: ${body.task_id}` },
        404
      );
    }

    // Validate blocked_by UUIDs if provided
    if (body.blocked_by && body.blocked_by.length > 0) {
      const blockers = await sql<{ id: string }[]>`
        SELECT id FROM subtasks WHERE id = ANY(${body.blocked_by})
      `;
      if (blockers.length !== body.blocked_by.length) {
        return c.json(
          { error: "One or more blocking subtask IDs not found" },
          400
        );
      }
    }

    // Insert subtask
    const results = await sql<SubtaskRow[]>`
      INSERT INTO subtasks (
        task_list_id,
        agent_type,
        agent_id,
        description,
        status,
        blocked_by,
        context_snapshot
      ) VALUES (
        ${body.task_id},
        ${body.agent_type ?? null},
        ${body.agent_id ?? null},
        ${body.description},
        ${body.status ?? "pending"},
        ${body.blocked_by ?? []},
        ${body.context_snapshot ? JSON.stringify(body.context_snapshot) : null}
      )
      RETURNING
        id,
        task_list_id,
        agent_type,
        agent_id,
        description,
        status,
        blocked_by,
        created_at,
        started_at,
        completed_at,
        context_snapshot,
        result
    `;

    const subtask = results[0];
    if (!subtask) {
      return c.json({ error: "Failed to create subtask" }, 500);
    }

    // Publish real-time event via PostgreSQL NOTIFY
    await publishEvent("global", "subtask.created", {
      id: subtask.id,
      task_list_id: subtask.task_list_id,
      agent_type: subtask.agent_type,
      status: subtask.status,
    });
    if (subtask.agent_type) {
      await publishEvent(`agents/${subtask.agent_type}`, "subtask.created", {
        id: subtask.id,
        task_list_id: subtask.task_list_id,
        agent_type: subtask.agent_type,
        status: subtask.status,
      });
    }

    return c.json({
      success: true,
      subtask: {
        id: subtask.id,
        task_id: subtask.task_list_id,
        task_list_id: subtask.task_list_id,
        agent_type: subtask.agent_type,
        agent_id: subtask.agent_id,
        description: subtask.description,
        status: subtask.status,
        blocked_by: subtask.blocked_by,
        created_at: subtask.created_at,
        started_at: subtask.started_at,
        completed_at: subtask.completed_at,
        context_snapshot: subtask.context_snapshot,
        result: subtask.result,
      },
    }, 201);
  } catch (error) {
    console.error("[API] POST /api/subtasks error:", error);
    return c.json(
      {
        error: "Failed to create subtask",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/subtasks - List subtasks with pagination
 * Query params:
 *   - limit: max results (default: 100, max: 1000)
 *   - offset: pagination offset (default: 0)
 *   - task_id: filter by task (task_list_id)
 *   - status: filter by status
 *   - agent_type: filter by agent type
 * @param c - Hono context
 */
export async function getSubtasks(c: Context): Promise<Response> {
  try {
    const sql = getDb();
    const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 100);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);
    const taskId = c.req.query("task_id");
    const status = c.req.query("status");
    const agentType = c.req.query("agent_type");

    let subtasks: SubtaskRow[];

    if (taskId && status && agentType) {
      subtasks = await sql<SubtaskRow[]>`
        SELECT
          id, task_list_id, agent_type, agent_id, description, status,
          blocked_by, created_at, started_at, completed_at, context_snapshot, result
        FROM subtasks
        WHERE task_list_id = ${taskId} AND status = ${status} AND agent_type = ${agentType}
        ORDER BY created_at ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (taskId && status) {
      subtasks = await sql<SubtaskRow[]>`
        SELECT
          id, task_list_id, agent_type, agent_id, description, status,
          blocked_by, created_at, started_at, completed_at, context_snapshot, result
        FROM subtasks
        WHERE task_list_id = ${taskId} AND status = ${status}
        ORDER BY created_at ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (taskId && agentType) {
      subtasks = await sql<SubtaskRow[]>`
        SELECT
          id, task_list_id, agent_type, agent_id, description, status,
          blocked_by, created_at, started_at, completed_at, context_snapshot, result
        FROM subtasks
        WHERE task_list_id = ${taskId} AND agent_type = ${agentType}
        ORDER BY created_at ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (taskId) {
      subtasks = await sql<SubtaskRow[]>`
        SELECT
          id, task_list_id, agent_type, agent_id, description, status,
          blocked_by, created_at, started_at, completed_at, context_snapshot, result
        FROM subtasks
        WHERE task_list_id = ${taskId}
        ORDER BY created_at ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (status) {
      subtasks = await sql<SubtaskRow[]>`
        SELECT
          id, task_list_id, agent_type, agent_id, description, status,
          blocked_by, created_at, started_at, completed_at, context_snapshot, result
        FROM subtasks
        WHERE status = ${status}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (agentType) {
      subtasks = await sql<SubtaskRow[]>`
        SELECT
          id, task_list_id, agent_type, agent_id, description, status,
          blocked_by, created_at, started_at, completed_at, context_snapshot, result
        FROM subtasks
        WHERE agent_type = ${agentType}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      subtasks = await sql<SubtaskRow[]>`
        SELECT
          id, task_list_id, agent_type, agent_id, description, status,
          blocked_by, created_at, started_at, completed_at, context_snapshot, result
        FROM subtasks
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    return c.json({
      subtasks: subtasks.map((s) => ({
        ...s,
        task_id: s.task_list_id, // Alias for convenience
      })),
      count: subtasks.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[API] GET /api/subtasks error:", error);
    return c.json(
      {
        error: "Failed to fetch subtasks",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/subtasks/:id - Get subtask by ID with its actions
 * @param c - Hono context
 */
export async function getSubtaskById(c: Context): Promise<Response> {
  try {
    const subtaskId = c.req.param("id");

    if (!subtaskId) {
      return c.json({ error: "Missing subtask ID" }, 400);
    }

    const sql = getDb();

    // Get subtask
    const subtaskResults = await sql<SubtaskRow[]>`
      SELECT
        id, task_list_id, agent_type, agent_id, description, status,
        blocked_by, created_at, started_at, completed_at, context_snapshot, result
      FROM subtasks
      WHERE id = ${subtaskId}
    `;

    const subtask = subtaskResults[0];
    if (!subtask) {
      return c.json({ error: "Subtask not found" }, 404);
    }

    // Get associated actions
    const actions = await sql<ActionRow[]>`
      SELECT
        id, tool_name, tool_type, exit_code, duration_ms, file_paths, created_at
      FROM actions
      WHERE subtask_id = ${subtaskId}
      ORDER BY created_at ASC
    `;

    return c.json({
      subtask: {
        ...subtask,
        task_id: subtask.task_list_id,
        actions,
      },
    });
  } catch (error) {
    console.error("[API] GET /api/subtasks/:id error:", error);
    return c.json(
      {
        error: "Failed to fetch subtask",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * PATCH /api/subtasks/:id - Update subtask status/result
 * @param c - Hono context
 */
export async function patchSubtask(c: Context): Promise<Response> {
  try {
    const subtaskId = c.req.param("id");

    if (!subtaskId) {
      return c.json({ error: "Missing subtask ID" }, 400);
    }

    const raw = await c.req.json();

    // Validate with Zod
    const PatchSubtaskSchema = z.object({
      status: z.enum(VALID_SUBTASK_STATUSES).optional(),
      result: z.record(z.unknown()).optional(),
      agent_id: z.string().optional(),
      blocked_by: z.array(z.string().uuid()).optional(),
    }).refine((data) => data.status || data.result || data.agent_id || data.blocked_by, {
      message: "No update fields provided",
    });

    const parseResult = PatchSubtaskSchema.safeParse(raw);
    if (!parseResult.success) {
      const issues = parseResult.error.issues;
      const refinementError = issues.find((i) => i.code === "custom");
      if (refinementError) {
        return c.json({ error: refinementError.message }, 400);
      }
      return c.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        400
      );
    }
    const body = parseResult.data;
    const sql = getDb();

    // Build update based on status transition
    let results: SubtaskRow[];

    if (body.status === "running") {
      results = await sql<SubtaskRow[]>`
        UPDATE subtasks
        SET
          status = ${body.status},
          agent_id = COALESCE(${body.agent_id ?? null}, agent_id),
          started_at = COALESCE(started_at, NOW())
        WHERE id = ${subtaskId}
        RETURNING id, task_list_id, agent_type, agent_id, description, status,
          blocked_by, created_at, started_at, completed_at, context_snapshot, result
      `;
    } else if (body.status === "completed" || body.status === "failed") {
      results = await sql<SubtaskRow[]>`
        UPDATE subtasks
        SET
          status = ${body.status},
          result = ${body.result ? JSON.stringify(body.result) : null},
          completed_at = NOW()
        WHERE id = ${subtaskId}
        RETURNING id, task_list_id, agent_type, agent_id, description, status,
          blocked_by, created_at, started_at, completed_at, context_snapshot, result
      `;
    } else if (body.status === "blocked" && body.blocked_by) {
      results = await sql<SubtaskRow[]>`
        UPDATE subtasks
        SET
          status = ${body.status},
          blocked_by = ${body.blocked_by}
        WHERE id = ${subtaskId}
        RETURNING id, task_list_id, agent_type, agent_id, description, status,
          blocked_by, created_at, started_at, completed_at, context_snapshot, result
      `;
    } else if (body.status) {
      results = await sql<SubtaskRow[]>`
        UPDATE subtasks
        SET
          status = ${body.status},
          blocked_by = COALESCE(${body.blocked_by ?? null}, blocked_by)
        WHERE id = ${subtaskId}
        RETURNING id, task_list_id, agent_type, agent_id, description, status,
          blocked_by, created_at, started_at, completed_at, context_snapshot, result
      `;
    } else if (body.result) {
      results = await sql<SubtaskRow[]>`
        UPDATE subtasks
        SET
          result = ${JSON.stringify(body.result)}
        WHERE id = ${subtaskId}
        RETURNING id, task_list_id, agent_type, agent_id, description, status,
          blocked_by, created_at, started_at, completed_at, context_snapshot, result
      `;
    } else {
      results = await sql<SubtaskRow[]>`
        UPDATE subtasks
        SET
          agent_id = COALESCE(${body.agent_id ?? null}, agent_id),
          blocked_by = COALESCE(${body.blocked_by ?? null}, blocked_by)
        WHERE id = ${subtaskId}
        RETURNING id, task_list_id, agent_type, agent_id, description, status,
          blocked_by, created_at, started_at, completed_at, context_snapshot, result
      `;
    }

    const subtask = results[0];
    if (!subtask) {
      return c.json({ error: "Subtask not found" }, 404);
    }

    // Publish real-time event via PostgreSQL NOTIFY
    await publishEvent("global", `subtask.${body.status || "updated"}`, {
      id: subtask.id,
      task_list_id: subtask.task_list_id,
      agent_type: subtask.agent_type,
      status: subtask.status,
    });
    if (subtask.agent_type) {
      await publishEvent(`agents/${subtask.agent_type}`, `subtask.${body.status || "updated"}`, {
        id: subtask.id,
        task_list_id: subtask.task_list_id,
        agent_type: subtask.agent_type,
        status: subtask.status,
      });
    }

    return c.json({
      success: true,
      subtask: {
        ...subtask,
        task_id: subtask.task_list_id,
      },
    });
  } catch (error) {
    console.error("[API] PATCH /api/subtasks/:id error:", error);
    return c.json(
      {
        error: "Failed to update subtask",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * DELETE /api/subtasks/:id - Delete a subtask and all associated actions (cascade)
 * @param c - Hono context
 */
export async function deleteSubtask(c: Context): Promise<Response> {
  try {
    const subtaskId = c.req.param("id");

    if (!subtaskId) {
      return c.json({ error: "Missing subtask ID" }, 400);
    }

    const sql = getDb();

    const results = await sql<{ id: string; task_list_id: string; agent_type: string | null }[]>`
      DELETE FROM subtasks WHERE id = ${subtaskId}
      RETURNING id, task_list_id, agent_type
    `;

    if (results.length === 0) {
      return c.json({ error: "Subtask not found" }, 404);
    }

    const deleted = results[0];

    // Publish real-time event
    await publishEvent("global", "subtask.deleted", {
      id: subtaskId,
      task_list_id: deleted.task_list_id,
      agent_type: deleted.agent_type,
    });
    if (deleted.agent_type) {
      await publishEvent(`agents/${deleted.agent_type}`, "subtask.deleted", {
        id: subtaskId,
        task_list_id: deleted.task_list_id,
      });
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[API] DELETE /api/subtasks/:id error:", error);
    return c.json(
      {
        error: "Failed to delete subtask",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}
