/**
 * Subtasks API - Manage subtasks (objectives within a wave)
 * Phase 3.4 - POST/GET /api/subtasks endpoints
 * @module api/subtasks
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";
import { checkBatchCompletion } from "../aggregation/engine";

const log = createLogger("API");

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
  context_snapshot: z.record(z.string(), z.unknown()).optional(),
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
        started_at,
        blocked_by,
        context_snapshot
      ) VALUES (
        ${body.task_id},
        ${body.agent_type ?? null},
        ${body.agent_id ?? null},
        ${body.description},
        ${body.status ?? "pending"},
        ${body.status === "running" ? sql`NOW()` : null},
        ${body.blocked_by ?? []},
        ${body.context_snapshot ? sql.json(body.context_snapshot) : null}
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

    // Wire wave_states: create/increment wave total_tasks
    if (subtask.status === "running") {
      wireWaveState(sql, subtask.task_list_id, "created").catch(err =>
        log.error("Wave state wire error:", err)
      );
    }

    // Auto-populate agent_contexts table (awaited to prevent race conditions)
    if (subtask.agent_type && subtask.agent_id) {
      try {
        await populateAgentContext(sql, subtask);
      } catch (err) {
        log.error("Agent context auto-population error:", err);
      }
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
    log.error("POST /api/subtasks error:", error);
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
    log.error("GET /api/subtasks error:", error);
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
    log.error("GET /api/subtasks/:id error:", error);
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
      result: z.record(z.string(), z.unknown()).optional(),
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
          result = ${body.result ? sql.json(body.result) : null},
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
          result = ${sql.json(body.result)}
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

    // Wire wave_states: update completion counters
    if (body.status === "completed" || body.status === "failed") {
      wireWaveState(sql, subtask.task_list_id, body.status).catch(err =>
        log.error("Wave state wire error:", err)
      );
    }

    // Publish real-time event via PostgreSQL NOTIFY
    await publishEvent("global", `subtask.${body.status || "updated"}`, {
      id: subtask.id,
      task_list_id: subtask.task_list_id,
      agent_type: subtask.agent_type,
      agent_id: subtask.agent_id,
      status: subtask.status,
      description: subtask.description,
    });
    if (subtask.agent_type) {
      await publishEvent(`agents/${subtask.agent_type}`, `subtask.${body.status || "updated"}`, {
        id: subtask.id,
        task_list_id: subtask.task_list_id,
        agent_type: subtask.agent_type,
        agent_id: subtask.agent_id,
        status: subtask.status,
        description: subtask.description,
      });
    }

    // Emit agent.connected when subtask starts running
    if (body.status === "running" && subtask.agent_type) {
      await publishEvent("global", "agent.connected", {
        agent_id: subtask.agent_id || subtask.id,
        agent_type: subtask.agent_type,
        subtask_id: subtask.id,
        description: subtask.description,
      });
    }

    // Emit agent.disconnected + inter-agent message when subtask completes/fails
    if ((body.status === "completed" || body.status === "failed") && subtask.agent_type) {
      await publishEvent("global", "agent.disconnected", {
        agent_id: subtask.agent_id || subtask.id,
        agent_type: subtask.agent_type,
        subtask_id: subtask.id,
        status: body.status,
      });

      // Auto-send inter-agent message with result for other agents to consume
      broadcastAgentResult(sql, subtask, body.result).catch(err =>
        log.error("Inter-agent message error:", err)
      );
    }

    // Update agent_contexts when subtask completes or fails (fire and forget)
    if (subtask.agent_id && (body.status === "completed" || body.status === "failed")) {
      updateAgentContextOnComplete(sql, subtask, body.result).catch(err =>
        log.error("Agent context update error:", err)
      );
    }

    // Auto-complete parent task when all subtasks are done (fire and forget)
    if (body.status === "completed" || body.status === "failed") {
      checkBatchCompletion(subtask.task_list_id).catch(err =>
        log.error("Batch completion check error:", err)
      );
    }

    return c.json({
      success: true,
      subtask: {
        ...subtask,
        task_id: subtask.task_list_id,
      },
    });
  } catch (error) {
    log.error("PATCH /api/subtasks/:id error:", error);
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
 * Clean up agent_contexts when a subtask completes or fails.
 * Removes the row so completed agents do not appear as active.
 * Uses multiple match strategies for reliability.
 */
async function updateAgentContextOnComplete(
  sql: ReturnType<typeof getDb>,
  subtask: SubtaskRow,
  _result?: Record<string, unknown>
): Promise<void> {
  // Strategy 1: Delete by agent_id (exact match)
  if (subtask.agent_id) {
    const deleted = await sql`
      DELETE FROM agent_contexts
      WHERE agent_id = ${subtask.agent_id}
        AND agent_type != 'compact-snapshot'
      RETURNING id
    `;
    if (deleted.length > 0) return;
  }

  // Strategy 2: Delete by agent_type + subtask_id in role_context (fallback)
  if (subtask.agent_type) {
    await sql`
      DELETE FROM agent_contexts
      WHERE agent_type = ${subtask.agent_type}
        AND agent_type != 'compact-snapshot'
        AND role_context->>'subtask_id' = ${subtask.id}
      RETURNING id
    `;
  }
}

/**
 * Auto-populate agent_contexts when a subtask is created.
 * Upserts context data for the agent so it can be retrieved via GET /api/context/:agent_id.
 * Runs as fire-and-forget to not block subtask creation.
 */
async function populateAgentContext(
  sql: ReturnType<typeof getDb>,
  subtask: SubtaskRow
): Promise<void> {
  // Find project_id and session_id from the task chain
  interface ChainRow {
    project_id: string;
    session_id: string;
  }

  const chainResult = await sql<ChainRow[]>`
    SELECT r.project_id, r.session_id
    FROM task_lists t
    JOIN requests r ON t.request_id = r.id
    WHERE t.id = ${subtask.task_list_id}
    LIMIT 1
  `;

  if (!chainResult[0]?.project_id) return;

  const { project_id, session_id } = chainResult[0];

  // Gather recent tools used in this session for context
  interface ToolRow {
    tool_name: string;
  }

  const recentTools = await sql<ToolRow[]>`
    SELECT DISTINCT tool_name
    FROM actions
    WHERE metadata->>'session_id' = ${session_id}
    ORDER BY tool_name
    LIMIT 20
  `;

  const toolsUsed = recentTools.map(t => t.tool_name);

  // Build role context with session info
  const roleContext = {
    session_id,
    subtask_id: subtask.id,
    task_list_id: subtask.task_list_id,
    task_description: subtask.description,
    status: subtask.status,
    spawned_at: subtask.created_at,
    blocked_by: subtask.blocked_by ?? [],
  };

  // Upsert agent_contexts (UNIQUE on project_id, agent_id)
  await sql`
    INSERT INTO agent_contexts (project_id, agent_id, agent_type, role_context, tools_used, progress_summary)
    VALUES (
      ${project_id},
      ${subtask.agent_id},
      ${subtask.agent_type},
      ${sql.json(roleContext)},
      ${toolsUsed},
      ${subtask.description}
    )
    ON CONFLICT (project_id, agent_id) DO UPDATE SET
      agent_type = EXCLUDED.agent_type,
      role_context = EXCLUDED.role_context,
      tools_used = EXCLUDED.tools_used,
      progress_summary = EXCLUDED.progress_summary,
      last_updated = NOW()
  `;

  // Publish event for dashboard
  await publishEvent("global", "agent_context.created", {
    agent_id: subtask.agent_id,
    agent_type: subtask.agent_type,
    project_id,
    session_id,
  });
}

/**
 * Broadcast agent result as inter-agent message.
 * When an agent completes, its result is shared with all other running agents
 * of the same project so they can use the context.
 */
async function broadcastAgentResult(
  sql: ReturnType<typeof getDb>,
  subtask: SubtaskRow,
  result?: Record<string, unknown>
): Promise<void> {
  // Find project_id and session_id from chain
  interface ChainRow {
    project_id: string;
    session_id: string;
  }

  const chainResult = await sql<ChainRow[]>`
    SELECT r.project_id, r.session_id
    FROM task_lists t
    JOIN requests r ON t.request_id = r.id
    WHERE t.id = ${subtask.task_list_id}
    LIMIT 1
  `;

  if (!chainResult[0]?.project_id) return;

  const { project_id, session_id } = chainResult[0];

  // Build message payload with agent result summary
  const payload = {
    source_agent: subtask.agent_type,
    source_agent_id: subtask.agent_id,
    subtask_id: subtask.id,
    status: subtask.status,
    description: subtask.description,
    result_summary: result ? JSON.stringify(result).slice(0, 1000) : null,
    session_id,
    completed_at: subtask.completed_at,
  };

  // Insert broadcast message (to_agent_id = NULL means broadcast)
  await sql`
    INSERT INTO agent_messages (project_id, from_agent_id, to_agent_id, message_type, topic, payload, expires_at)
    VALUES (
      ${project_id},
      ${subtask.agent_type || 'system'},
      NULL,
      'notification',
      ${'agent.' + subtask.status},
      ${sql.json(payload)},
      NOW() + INTERVAL '1 hour'
    )
  `;

  // Publish real-time event so dashboard and other agents see it
  await publishEvent("global", "message.new", {
    from_agent: subtask.agent_type,
    to_agent: "broadcast",
    topic: 'agent.' + subtask.status,
    session_id,
    description: subtask.description,
  });
}

/**
 * Wire wave_states from subtask lifecycle events.
 * Creates wave_state row if needed, increments total_tasks on creation,
 * increments completed/failed counters on completion, auto-completes wave.
 */
async function wireWaveState(
  sql: ReturnType<typeof getDb>,
  taskListId: string,
  event: "created" | "completed" | "failed"
): Promise<void> {
  // Get session_id and wave_number from task chain
  const chain = await sql<{ session_id: string; wave_number: number }[]>`
    SELECT r.session_id, tl.wave_number
    FROM task_lists tl
    JOIN requests r ON tl.request_id = r.id
    WHERE tl.id = ${taskListId}
    LIMIT 1
  `;

  if (!chain[0]) return;
  const { session_id, wave_number } = chain[0];

  if (event === "created") {
    // Upsert wave_state and increment total_tasks
    await sql`
      INSERT INTO wave_states (session_id, wave_number, status, total_tasks, completed_tasks, failed_tasks, started_at)
      VALUES (${session_id}, ${wave_number}, 'running', 1, 0, 0, NOW())
      ON CONFLICT (session_id, wave_number) DO UPDATE SET
        total_tasks = wave_states.total_tasks + 1,
        status = CASE WHEN wave_states.status = 'pending' THEN 'running' ELSE wave_states.status END,
        started_at = COALESCE(wave_states.started_at, NOW())
    `;
  } else if (event === "completed") {
    await sql`
      UPDATE wave_states
      SET completed_tasks = completed_tasks + 1
      WHERE session_id = ${session_id} AND wave_number = ${wave_number}
    `;
  } else if (event === "failed") {
    await sql`
      UPDATE wave_states
      SET failed_tasks = failed_tasks + 1
      WHERE session_id = ${session_id} AND wave_number = ${wave_number}
    `;
  }

  // Check if all tasks done - auto-complete wave
  if (event === "completed" || event === "failed") {
    const waveResult = await sql<{ total_tasks: number; completed_tasks: number; failed_tasks: number }[]>`
      SELECT total_tasks, completed_tasks, failed_tasks
      FROM wave_states
      WHERE session_id = ${session_id} AND wave_number = ${wave_number}
    `;
    const wave = waveResult[0];
    if (wave && wave.completed_tasks + wave.failed_tasks >= wave.total_tasks && wave.total_tasks > 0) {
      const finalStatus = wave.failed_tasks > 0 ? "failed" : "completed";
      await sql`
        UPDATE wave_states
        SET status = ${finalStatus}, completed_at = NOW()
        WHERE session_id = ${session_id} AND wave_number = ${wave_number}
          AND status != ${finalStatus}
      `;
      await publishEvent("global", `wave.${finalStatus}`, {
        session_id,
        wave_number,
        completed_tasks: wave.completed_tasks,
        failed_tasks: wave.failed_tasks,
        total_tasks: wave.total_tasks,
      });
    }
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
    log.error("DELETE /api/subtasks/:id error:", error);
    return c.json(
      {
        error: "Failed to delete subtask",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * POST /api/subtasks/close-session - Close all running subtasks for a session
 * Called by track-session-end.sh to prevent orphan subtasks
 * @param c - Hono context
 */
export async function closeSessionSubtasks(c: Context): Promise<Response> {
  try {
    const body = await c.req.json();
    const sessionId = body.session_id;

    if (!sessionId) {
      return c.json({ error: "Missing session_id" }, 400);
    }

    const sql = getDb();

    // Close all running/paused/blocked subtasks linked to this session's requests
    const result = await sql`
      UPDATE subtasks
      SET status = 'completed', completed_at = NOW(),
          result = jsonb_build_object('reason', 'session_ended')
      WHERE status IN ('running', 'paused', 'blocked')
        AND task_list_id IN (
          SELECT tl.id FROM task_lists tl
          JOIN requests r ON tl.request_id = r.id
          WHERE r.session_id = ${sessionId}
        )
      RETURNING id, agent_type
    `;

    // Also clean up agent_contexts for these agents
    if (result.length > 0) {
      const agentTypes = [...new Set(result.map((r: { agent_type: string | null }) => r.agent_type).filter(Boolean))];
      for (const agentType of agentTypes) {
        await sql`
          DELETE FROM agent_contexts
          WHERE agent_type = ${agentType}
            AND agent_type != 'compact-snapshot'
            AND (role_context->>'status' IS NULL OR role_context->>'status' IN ('running', 'paused', 'blocked'))
        `;
      }

      log.info(`Closed ${result.length} orphan subtasks for session ${sessionId}`);
    }

    return c.json({
      closed: result.length,
      session_id: sessionId,
    });
  } catch (error) {
    log.error("POST /api/subtasks/close-session error:", error);
    return c.json({ error: "Failed to close session subtasks" }, 500);
  }
}
