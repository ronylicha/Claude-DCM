/**
 * Tasks API - Manage task lists (waves)
 * Phase 3.3 - POST/GET /api/tasks endpoints
 * Maps to task_lists table in the database
 * @module api/tasks
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("API");

/** Input schema for task creation */
export interface TaskInput {
  request_id: string;
  name?: string;
  wave_number?: number;
  status?: string; // pending, running, completed, failed
}

/** Task row from database */
interface TaskRow {
  id: string;
  request_id: string;
  name: string | null;
  wave_number: number;
  status: string;
  created_at: string;
  completed_at: string | null;
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
  result: Record<string, unknown> | null;
}

/** Valid task statuses */
const VALID_TASK_STATUSES = ["pending", "running", "completed", "failed", "blocked"] as const;

/** Zod schema for task input validation */
const TaskInputSchema = z.object({
  request_id: z.string().uuid("request_id must be a valid UUID"),
  name: z.string().optional(),
  wave_number: z.number().int().min(0).optional(),
  status: z.enum(VALID_TASK_STATUSES).optional(),
});

/**
 * POST /api/tasks - Create a new task (wave)
 * @param c - Hono context
 */
export async function postTask(c: Context): Promise<Response> {
  try {
    const raw = await c.req.json();

    // Validate input with Zod
    const parseResult = TaskInputSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        400
      );
    }
    const body = parseResult.data;

    const sql = getDb();

    // Verify request exists
    const requestResults = await sql<{ id: string }[]>`
      SELECT id FROM requests WHERE id = ${body.request_id}
    `;

    if (!requestResults[0]) {
      return c.json(
        { error: `Request not found: ${body.request_id}` },
        404
      );
    }

    // Get next wave number if not provided
    let waveNumber = body.wave_number;
    if (waveNumber === undefined || waveNumber === null) {
      const maxWaveResults = await sql<{ next_wave: number }[]>`
        SELECT COALESCE(MAX(wave_number), -1) + 1 as next_wave
        FROM task_lists
        WHERE request_id = ${body.request_id}
      `;
      waveNumber = maxWaveResults[0]?.next_wave ?? 0;
    }

    // Insert task
    const results = await sql<TaskRow[]>`
      INSERT INTO task_lists (
        request_id,
        name,
        wave_number,
        status
      ) VALUES (
        ${body.request_id},
        ${body.name ?? `Wave ${waveNumber}`},
        ${waveNumber},
        ${body.status ?? "pending"}
      )
      RETURNING id, request_id, name, wave_number, status, created_at, completed_at
    `;

    const task = results[0];
    if (!task) {
      return c.json({ error: "Failed to create task" }, 500);
    }

    // Publish real-time event via PostgreSQL NOTIFY
    await publishEvent("global", "task.created", {
      id: task.id,
      request_id: task.request_id,
      wave_number: task.wave_number,
      status: task.status,
    });

    return c.json({
      success: true,
      task: {
        id: task.id,
        request_id: task.request_id,
        name: task.name,
        wave_number: task.wave_number,
        status: task.status,
        created_at: task.created_at,
        completed_at: task.completed_at,
      },
    }, 201);
  } catch (error) {
    log.error("POST /api/tasks error:", error);
    return c.json(
      {
        error: "Failed to create task",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/tasks - List tasks with pagination
 * Query params:
 *   - limit: max results (default: 100, max: 1000)
 *   - offset: pagination offset (default: 0)
 *   - request_id: filter by request
 *   - status: filter by status
 * @param c - Hono context
 */
export async function getTasks(c: Context): Promise<Response> {
  try {
    const sql = getDb();
    const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 100);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);
    const requestId = c.req.query("request_id");
    const status = c.req.query("status");

    let tasks: TaskRow[];

    if (requestId && status) {
      tasks = await sql<TaskRow[]>`
        SELECT id, request_id, name, wave_number, status, created_at, completed_at
        FROM task_lists
        WHERE request_id = ${requestId} AND status = ${status}
        ORDER BY wave_number ASC, created_at ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (requestId) {
      tasks = await sql<TaskRow[]>`
        SELECT id, request_id, name, wave_number, status, created_at, completed_at
        FROM task_lists
        WHERE request_id = ${requestId}
        ORDER BY wave_number ASC, created_at ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (status) {
      tasks = await sql<TaskRow[]>`
        SELECT id, request_id, name, wave_number, status, created_at, completed_at
        FROM task_lists
        WHERE status = ${status}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      tasks = await sql<TaskRow[]>`
        SELECT id, request_id, name, wave_number, status, created_at, completed_at
        FROM task_lists
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    return c.json({
      tasks,
      count: tasks.length,
      limit,
      offset,
    });
  } catch (error) {
    log.error("GET /api/tasks error:", error);
    return c.json(
      {
        error: "Failed to fetch tasks",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/tasks/:id - Get task by ID with its subtasks
 * @param c - Hono context
 */
export async function getTaskById(c: Context): Promise<Response> {
  try {
    const taskId = c.req.param("id");

    if (!taskId) {
      return c.json({ error: "Missing task ID" }, 400);
    }

    const sql = getDb();

    // Get task
    const taskResults = await sql<TaskRow[]>`
      SELECT id, request_id, name, wave_number, status, created_at, completed_at
      FROM task_lists
      WHERE id = ${taskId}
    `;

    const task = taskResults[0];
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    // Get associated subtasks
    const subtasks = await sql<SubtaskRow[]>`
      SELECT
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
        result
      FROM subtasks
      WHERE task_list_id = ${taskId}
      ORDER BY created_at ASC
    `;

    return c.json({
      task: {
        ...task,
        subtasks,
      },
    });
  } catch (error) {
    log.error("GET /api/tasks/:id error:", error);
    return c.json(
      {
        error: "Failed to fetch task",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * PATCH /api/tasks/:id - Update task status
 * @param c - Hono context
 */
export async function patchTask(c: Context): Promise<Response> {
  try {
    const taskId = c.req.param("id");

    if (!taskId) {
      return c.json({ error: "Missing task ID" }, 400);
    }

    const raw = await c.req.json();

    // Validate with Zod
    const PatchTaskSchema = z.object({
      status: z.enum(VALID_TASK_STATUSES).optional(),
      name: z.string().optional(),
    }).refine((data) => data.status || data.name, {
      message: "No update fields provided",
    });

    const parseResult = PatchTaskSchema.safeParse(raw);
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

    // Build update query dynamically
    let results: TaskRow[];
    if (body.status === "completed") {
      results = await sql<TaskRow[]>`
        UPDATE task_lists
        SET
          status = ${body.status},
          name = COALESCE(${body.name ?? null}, name),
          completed_at = NOW()
        WHERE id = ${taskId}
        RETURNING id, request_id, name, wave_number, status, created_at, completed_at
      `;
    } else if (body.status) {
      results = await sql<TaskRow[]>`
        UPDATE task_lists
        SET
          status = ${body.status},
          name = COALESCE(${body.name ?? null}, name)
        WHERE id = ${taskId}
        RETURNING id, request_id, name, wave_number, status, created_at, completed_at
      `;
    } else {
      results = await sql<TaskRow[]>`
        UPDATE task_lists
        SET
          name = ${body.name ?? null}
        WHERE id = ${taskId}
        RETURNING id, request_id, name, wave_number, status, created_at, completed_at
      `;
    }

    const task = results[0];
    if (!task) {
      return c.json({ error: "Task not found" }, 404);
    }

    // Publish real-time event via PostgreSQL NOTIFY
    await publishEvent("global", `task.${body.status || "updated"}`, {
      id: task.id,
      request_id: task.request_id,
      wave_number: task.wave_number,
      status: task.status,
    });


    return c.json({
      success: true,
      task,
    });
  } catch (error) {
    log.error("PATCH /api/tasks/:id error:", error);
    return c.json(
      {
        error: "Failed to update task",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * DELETE /api/tasks/:id - Delete a task and all associated subtasks (cascade)
 * @param c - Hono context
 */
export async function deleteTask(c: Context): Promise<Response> {
  try {
    const taskId = c.req.param("id");

    if (!taskId) {
      return c.json({ error: "Missing task ID" }, 400);
    }

    const sql = getDb();

    const results = await sql<{ id: string; request_id: string; wave_number: number }[]>`
      DELETE FROM task_lists WHERE id = ${taskId}
      RETURNING id, request_id, wave_number
    `;

    if (results.length === 0) {
      return c.json({ error: "Task not found" }, 404);
    }

    // Publish real-time event
    await publishEvent("global", "task.deleted", {
      id: taskId,
      request_id: results[0].request_id,
      wave_number: results[0].wave_number,
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    log.error("DELETE /api/tasks/:id error:", error);
    return c.json(
      {
        error: "Failed to delete task",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}
