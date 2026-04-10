/**
 * Project Board API - Kanban board and epic management for projects
 * Handles board view, epic CRUD, reordering, and status transitions.
 * @module api/project-board
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("API");

// ============================================
// Constants
// ============================================

const EPIC_STATUSES = ["backlog", "todo", "in_progress", "review", "done", "cancelled"] as const;
type EpicStatus = typeof EPIC_STATUSES[number];

const TRANSITION_TRIGGERS = ["manual", "pipeline_sync", "auto_complete"] as const;

// ============================================
// Validation Schemas
// ============================================

/** Schema for epic creation */
const CreateEpicSchema = z.object({
  title: z.string().min(1, "title is required"),
  description: z.string().optional(),
  status: z.enum(EPIC_STATUSES).optional().default("backlog"),
  priority: z.number().int().optional().default(0),
  pipeline_id: z.string().uuid().optional(),
  wave_start: z.number().int().min(0).optional(),
  wave_end: z.number().int().min(0).optional(),
  color: z.string().optional(),
  estimated_effort: z.enum(["xs", "s", "m", "l", "xl"]).optional(),
  tags: z.array(z.string()).optional().default([]),
});

/** Schema for epic partial update */
const PatchEpicSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(EPIC_STATUSES).optional(),
  priority: z.number().int().optional(),
  pipeline_id: z.string().uuid().nullable().optional(),
  wave_start: z.number().int().min(0).nullable().optional(),
  wave_end: z.number().int().min(0).nullable().optional(),
  color: z.string().nullable().optional(),
  estimated_effort: z.enum(["xs", "s", "m", "l", "xl"]).nullable().optional(),
  tags: z.array(z.string()).optional(),
});

/** Schema for epic reorder */
const ReorderEpicsSchema = z.object({
  epic_ids: z.array(z.string().uuid()).min(1, "epic_ids must be a non-empty array"),
  status: z.enum(EPIC_STATUSES),
});

/** Schema for epic transition */
const EpicTransitionSchema = z.object({
  to_status: z.enum(EPIC_STATUSES),
  trigger: z.enum(TRANSITION_TRIGGERS).optional().default("manual"),
});

// ============================================
// Row Types
// ============================================

interface EpicRow {
  id: string;
  project_id: string;
  pipeline_id: string | null;
  title: string;
  description: string | null;
  status: EpicStatus;
  priority: number;
  sort_order: number;
  wave_start: number | null;
  wave_end: number | null;
  color: string | null;
  estimated_effort: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface EpicWithProgress extends EpicRow {
  progress_pct: number | null;
  total_steps: number | null;
  completed_steps: number | null;
}

// ============================================
// Handlers
// ============================================

/**
 * GET /api/projects/:id/board
 * Returns board columns with epics grouped by status, pipeline links, and project stats.
 */
export async function getProjectBoard(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("id");
    if (!projectId) {
      return c.json({ error: "Missing project ID" }, 400);
    }

    const sql = getDb();

    // Fetch project
    const projectRows = await sql`
      SELECT id, path, name, status, description, git_repo_url, git_branch, created_at, updated_at, metadata
      FROM projects
      WHERE id = ${projectId}
    `;

    const project = projectRows[0];
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Fetch all epics for board columns (excluding cancelled), ordered by sort_order
    const epicRows = await sql<EpicWithProgress[]>`
      SELECT
        e.id, e.project_id, e.pipeline_id, e.title, e.description,
        e.status, e.priority, e.sort_order, e.wave_start, e.wave_end,
        e.color, e.estimated_effort, e.tags, e.created_at, e.updated_at, e.completed_at,
        vp.progress_pct, vp.total_steps, vp.completed_steps
      FROM project_epics e
      LEFT JOIN v_epic_progress vp ON vp.epic_id = e.id
      WHERE e.project_id = ${projectId}
        AND e.status != 'cancelled'
      ORDER BY e.sort_order ASC, e.created_at ASC
    `;

    // Group epics into board columns
    const board: Record<string, EpicWithProgress[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      review: [],
      done: [],
    };

    for (const epic of epicRows) {
      if (epic.status in board) {
        board[epic.status]!.push(epic);
      }
    }

    // Fetch linked pipelines
    const pipelineRows = await sql`
      SELECT id, status, created_at, updated_at
      FROM pipelines
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
    `;

    // Compute stats
    const totalEpics = epicRows.length;
    const doneCount = board["done"]!.length;
    const completionPct = totalEpics > 0
      ? Math.round((doneCount / totalEpics) * 100 * 10) / 10
      : 0;

    return c.json({
      project,
      board,
      stats: {
        total_epics: totalEpics,
        linked_pipelines: pipelineRows.length,
        completion_pct: completionPct,
      },
      pipelines: pipelineRows,
    });
  } catch (error) {
    log.error("GET /api/projects/:id/board error:", error);
    return c.json(
      {
        error: "Failed to fetch project board",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * GET /api/projects/:id/epics?status=xxx
 * Lists epics for a project, optionally filtered by status.
 * Joins v_epic_progress for progress data.
 */
export async function getProjectEpics(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("id");
    if (!projectId) {
      return c.json({ error: "Missing project ID" }, 400);
    }

    const sql = getDb();

    // Verify project exists
    const projectExists = await sql`SELECT id FROM projects WHERE id = ${projectId}`;
    if (projectExists.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    const statusFilter = c.req.query("status");

    // Validate status filter if provided
    if (statusFilter && !(EPIC_STATUSES as readonly string[]).includes(statusFilter)) {
      return c.json(
        { error: `Invalid status. Must be one of: ${EPIC_STATUSES.join(", ")}` },
        400,
      );
    }

    const epics = statusFilter
      ? await sql<EpicWithProgress[]>`
          SELECT
            e.id, e.project_id, e.pipeline_id, e.title, e.description,
            e.status, e.priority, e.sort_order, e.wave_start, e.wave_end,
            e.color, e.estimated_effort, e.tags, e.created_at, e.updated_at, e.completed_at,
            vp.progress_pct, vp.total_steps, vp.completed_steps
          FROM project_epics e
          LEFT JOIN v_epic_progress vp ON vp.epic_id = e.id
          WHERE e.project_id = ${projectId}
            AND e.status = ${statusFilter}
          ORDER BY e.sort_order ASC, e.created_at ASC
        `
      : await sql<EpicWithProgress[]>`
          SELECT
            e.id, e.project_id, e.pipeline_id, e.title, e.description,
            e.status, e.priority, e.sort_order, e.wave_start, e.wave_end,
            e.color, e.estimated_effort, e.tags, e.created_at, e.updated_at, e.completed_at,
            vp.progress_pct, vp.total_steps, vp.completed_steps
          FROM project_epics e
          LEFT JOIN v_epic_progress vp ON vp.epic_id = e.id
          WHERE e.project_id = ${projectId}
          ORDER BY e.sort_order ASC, e.created_at ASC
        `;

    return c.json({ epics, count: epics.length });
  } catch (error) {
    log.error("GET /api/projects/:id/epics error:", error);
    return c.json(
      {
        error: "Failed to fetch epics",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/projects/:id/epics
 * Creates a new epic under a project.
 * Computes sort_order as MAX(sort_order) + 1 for the target status column.
 */
export async function postProjectEpic(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("id");
    if (!projectId) {
      return c.json({ error: "Missing project ID" }, 400);
    }

    const raw = await c.req.json();

    const parseResult = CreateEpicSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        400,
      );
    }

    const body = parseResult.data;

    const sql = getDb();

    // Verify project exists
    const projectExists = await sql`SELECT id FROM projects WHERE id = ${projectId}`;
    if (projectExists.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Compute next sort_order for this status in this project
    const sortResult = await sql<{ max_sort: number | null }[]>`
      SELECT COALESCE(MAX(sort_order), -1) AS max_sort
      FROM project_epics
      WHERE project_id = ${projectId}
        AND status = ${body.status}
    `;
    const nextSortOrder = (sortResult[0]?.max_sort ?? -1) + 1;

    // Build nullable fields explicitly to satisfy postgres.js typing
    const epicRows = await sql<EpicRow[]>`
      INSERT INTO project_epics (
        project_id, pipeline_id, title, description, status, priority,
        sort_order, wave_start, wave_end, color, estimated_effort, tags
      )
      VALUES (
        ${projectId},
        ${body.pipeline_id ?? null},
        ${body.title},
        ${body.description ?? null},
        ${body.status},
        ${body.priority},
        ${nextSortOrder},
        ${body.wave_start ?? null},
        ${body.wave_end ?? null},
        ${body.color ?? null},
        ${body.estimated_effort ?? null},
        ${sql.array(body.tags)}
      )
      RETURNING
        id, project_id, pipeline_id, title, description, status, priority,
        sort_order, wave_start, wave_end, color, estimated_effort, tags,
        created_at, updated_at, completed_at
    `;

    const epic = epicRows[0];
    if (!epic) {
      return c.json({ error: "Failed to create epic" }, 500);
    }

    await publishEvent("projects", "epic.created", {
      id: epic.id,
      project_id: projectId,
      title: epic.title,
      status: epic.status,
    });

    return c.json({ success: true, epic }, 201);
  } catch (error) {
    log.error("POST /api/projects/:id/epics error:", error);
    return c.json(
      {
        error: "Failed to create epic",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * PATCH /api/projects/:id/epics/:epicId
 * Partially updates an epic. Inserts an epic_transitions row when status changes.
 * Sets completed_at when transitioning to 'done'.
 */
export async function patchProjectEpic(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("id");
    const epicId = c.req.param("epicId");

    if (!projectId || !epicId) {
      return c.json({ error: "Missing project ID or epic ID" }, 400);
    }

    const raw = await c.req.json();

    const parseResult = PatchEpicSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        400,
      );
    }

    const body = parseResult.data;

    const sql = getDb();

    // Fetch current epic to verify ownership and get current status
    const currentRows = await sql<EpicRow[]>`
      SELECT id, project_id, status
      FROM project_epics
      WHERE id = ${epicId} AND project_id = ${projectId}
    `;

    const current = currentRows[0];
    if (!current) {
      return c.json({ error: "Epic not found" }, 404);
    }

    const statusChanging = body.status !== undefined && body.status !== current.status;
    const transitioningToDone = statusChanging && body.status === "done";

    // Build SET clause dynamically — only include fields present in the payload
    const updatedRows = await sql<EpicRow[]>`
      UPDATE project_epics
      SET
        title            = COALESCE(${body.title ?? null}, title),
        description      = ${body.description !== undefined ? body.description : sql`description`},
        status           = COALESCE(${body.status ?? null}, status),
        priority         = COALESCE(${body.priority ?? null}, priority),
        pipeline_id      = ${body.pipeline_id !== undefined ? body.pipeline_id : sql`pipeline_id`},
        wave_start       = ${body.wave_start !== undefined ? body.wave_start : sql`wave_start`},
        wave_end         = ${body.wave_end !== undefined ? body.wave_end : sql`wave_end`},
        color            = ${body.color !== undefined ? body.color : sql`color`},
        estimated_effort = ${body.estimated_effort !== undefined ? body.estimated_effort : sql`estimated_effort`},
        tags             = ${body.tags !== undefined ? sql.array(body.tags) : sql`tags`},
        completed_at     = ${transitioningToDone ? sql`NOW()` : sql`completed_at`},
        updated_at       = NOW()
      WHERE id = ${epicId} AND project_id = ${projectId}
      RETURNING
        id, project_id, pipeline_id, title, description, status, priority,
        sort_order, wave_start, wave_end, color, estimated_effort, tags,
        created_at, updated_at, completed_at
    `;

    const updated = updatedRows[0];
    if (!updated) {
      return c.json({ error: "Epic not found or update failed" }, 404);
    }

    // Record status transition
    if (statusChanging) {
      await sql`
        INSERT INTO epic_transitions (epic_id, from_status, to_status, trigger)
        VALUES (${epicId}, ${current.status}, ${body.status!}, 'manual')
      `;
    }

    await publishEvent("projects", "epic.updated", {
      id: epicId,
      project_id: projectId,
      status: updated.status,
      status_changed: statusChanging,
    });

    return c.json({ success: true, epic: updated });
  } catch (error) {
    log.error("PATCH /api/projects/:id/epics/:epicId error:", error);
    return c.json(
      {
        error: "Failed to update epic",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * DELETE /api/projects/:id/epics/:epicId
 * Deletes an epic, verifying project ownership first.
 */
export async function deleteProjectEpic(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("id");
    const epicId = c.req.param("epicId");

    if (!projectId || !epicId) {
      return c.json({ error: "Missing project ID or epic ID" }, 400);
    }

    const sql = getDb();

    const deletedRows = await sql<{ id: string }[]>`
      DELETE FROM project_epics
      WHERE id = ${epicId} AND project_id = ${projectId}
      RETURNING id
    `;

    if (deletedRows.length === 0) {
      return c.json({ error: "Epic not found" }, 404);
    }

    await publishEvent("projects", "epic.deleted", {
      id: epicId,
      project_id: projectId,
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    log.error("DELETE /api/projects/:id/epics/:epicId error:", error);
    return c.json(
      {
        error: "Failed to delete epic",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/projects/:id/epics/reorder
 * Reassigns sort_order to the given epic_ids in the order provided for a target status column.
 * Body: { epic_ids: string[], status: EpicStatus }
 */
export async function postReorderEpics(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("id");
    if (!projectId) {
      return c.json({ error: "Missing project ID" }, 400);
    }

    const raw = await c.req.json();

    const parseResult = ReorderEpicsSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        400,
      );
    }

    const { epic_ids, status } = parseResult.data;

    const sql = getDb();

    // Verify project exists
    const projectExists = await sql`SELECT id FROM projects WHERE id = ${projectId}`;
    if (projectExists.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Update each epic's sort_order in a single transaction
    await sql.begin(async (tx: any) => {
      for (let i = 0; i < epic_ids.length; i++) {
        await tx`
          UPDATE project_epics
          SET sort_order = ${i}, updated_at = NOW()
          WHERE id = ${epic_ids[i]!}
            AND project_id = ${projectId}
            AND status = ${status}
        `;
      }
    });

    await publishEvent("projects", "epics.reordered", {
      project_id: projectId,
      status,
      epic_ids,
    });

    return c.json({ success: true, reordered: epic_ids.length });
  } catch (error) {
    log.error("POST /api/projects/:id/epics/reorder error:", error);
    return c.json(
      {
        error: "Failed to reorder epics",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/projects/:id/epics/:epicId/transition
 * Transitions an epic to a new status.
 * Inserts into epic_transitions and sets completed_at when transitioning to 'done'.
 * Body: { to_status: EpicStatus, trigger?: TransitionTrigger }
 */
export async function postEpicTransition(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("id");
    const epicId = c.req.param("epicId");

    if (!projectId || !epicId) {
      return c.json({ error: "Missing project ID or epic ID" }, 400);
    }

    const raw = await c.req.json();

    const parseResult = EpicTransitionSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        400,
      );
    }

    const { to_status, trigger } = parseResult.data;

    const sql = getDb();

    // Fetch current epic
    const currentRows = await sql<EpicRow[]>`
      SELECT id, project_id, status
      FROM project_epics
      WHERE id = ${epicId} AND project_id = ${projectId}
    `;

    const current = currentRows[0];
    if (!current) {
      return c.json({ error: "Epic not found" }, 404);
    }

    const fromStatus = current.status;
    const transitioningToDone = to_status === "done";

    // Perform transition atomically
    const [updatedEpic] = await sql.begin(async (tx: any) => {
      const updated = await tx<EpicRow[]>`
        UPDATE project_epics
        SET
          status       = ${to_status},
          completed_at = ${transitioningToDone ? sql`NOW()` : sql`completed_at`},
          updated_at   = NOW()
        WHERE id = ${epicId} AND project_id = ${projectId}
        RETURNING
          id, project_id, pipeline_id, title, description, status, priority,
          sort_order, wave_start, wave_end, color, estimated_effort, tags,
          created_at, updated_at, completed_at
      `;

      await tx`
        INSERT INTO epic_transitions (epic_id, from_status, to_status, trigger)
        VALUES (${epicId}, ${fromStatus}, ${to_status}, ${trigger})
      `;

      return updated;
    });

    if (!updatedEpic) {
      return c.json({ error: "Epic transition failed" }, 500);
    }

    await publishEvent("projects", "epic.transitioned", {
      id: epicId,
      project_id: projectId,
      from_status: fromStatus,
      to_status,
      trigger,
    });

    return c.json({
      success: true,
      epic: updatedEpic,
      transition: {
        from_status: fromStatus,
        to_status,
        trigger,
      },
    });
  } catch (error) {
    log.error("POST /api/projects/:id/epics/:epicId/transition error:", error);
    return c.json(
      {
        error: "Failed to transition epic",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}
