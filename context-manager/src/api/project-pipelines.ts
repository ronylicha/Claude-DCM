/**
 * Project-scoped Pipeline & Project API handlers
 * Endpoints:
 *   GET  /api/projects/:id/pipelines   — list pipelines for a project
 *   POST /api/projects/:id/pipelines   — create pipeline attached to a project
 *   POST /api/projects/:id/sync-epics  — sync epics from a pipeline plan
 *   PATCH /api/projects/:id            — partial update of a project
 *   POST /api/projects/:id/analyze     — trigger codebase analysis for one project
 *   POST /api/projects/analyze-all     — trigger codebase analysis for all pending projects
 * @module api/project-pipelines
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";
import { analyzeProject, analyzeAllProjects } from "../pipeline/project-analyzer";

const log = createLogger("ProjectPipelines");

// ============================================
// Validation Schemas
// ============================================

/** Schema for POST /api/projects/:id/pipelines */
const CreateProjectPipelineSchema = z.object({
  name: z.string().optional(),
  instructions: z.string().min(1, "instructions is required"),
  documents: z
    .array(
      z.object({
        name: z.string(),
        content: z.string(),
        type: z.enum(["markdown", "text", "json", "code"]),
      }),
    )
    .optional()
    .default([]),
  workspace: z
    .object({
      path: z.string().min(1),
    })
    .optional(),
  target_files: z.array(z.string()).optional().default([]),
  target_directories: z.array(z.string()).optional().default([]),
});

/** Schema for POST /api/projects/:id/sync-epics */
const SyncEpicsSchema = z.object({
  pipeline_id: z.string().uuid("pipeline_id must be a valid UUID"),
  strategy: z.enum(["replace", "merge"]),
});

/** Schema for PATCH /api/projects/:id */
const PatchProjectSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(["active", "archived", "completed"]).optional(),
  description: z.string().optional(),
  git_repo_url: z.string().url().optional(),
  git_branch: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// ============================================
// DB row interfaces
// ============================================

interface PipelineRow {
  id: string;
  session_id: string;
  project_id: string | null;
  name: string | null;
  status: string;
  input: Record<string, unknown>;
  plan: {
    sprints?: Array<{
      name: string;
      wave_start: number;
      wave_end: number;
    }>;
  } | null;
  created_at: string;
  updated_at: string;
}

interface EpicRow {
  id: string;
  project_id: string;
  pipeline_id: string | null;
  title: string;
  status: string;
  wave_start: number | null;
  wave_end: number | null;
  created_at: string;
}

interface ProjectRow {
  id: string;
  path: string;
  name: string | null;
  status: string;
  description: string | null;
  git_repo_url: string | null;
  git_branch: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

// ============================================
// Handlers
// ============================================

/**
 * GET /api/projects/:id/pipelines
 * List all pipelines associated with a project.
 * Returns { pipelines, count }
 */
export async function getProjectPipelines(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("id");
    if (!projectId) {
      return c.json({ error: "Missing project ID" }, 400);
    }

    const sql = getDb();

    // Verify project exists
    const projectCheck = await sql<{ id: string }[]>`
      SELECT id FROM projects WHERE id = ${projectId}
    `;
    if (projectCheck.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    const pipelines = await sql<PipelineRow[]>`
      SELECT
        id, session_id, project_id, name, status, input,
        plan, created_at, updated_at
      FROM pipelines
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
    `;

    return c.json({ pipelines, count: pipelines.length });
  } catch (error) {
    log.error("GET /api/projects/:id/pipelines error:", error);
    return c.json(
      {
        error: "Failed to list project pipelines",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/projects/:id/pipelines
 * Create a new pipeline attached to the given project.
 * Body: { name?, instructions, documents?, workspace?, target_files?, target_directories? }
 * Returns { success, pipeline }
 */
export async function postProjectPipeline(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("id");
    if (!projectId) {
      return c.json({ error: "Missing project ID" }, 400);
    }

    const raw = await c.req.json();
    const parseResult = CreateProjectPipelineSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const body = parseResult.data;

    const sql = getDb();

    // Verify project exists
    const projectCheck = await sql<{ id: string }[]>`
      SELECT id FROM projects WHERE id = ${projectId}
    `;
    if (projectCheck.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Build the pipeline input JSONB payload
    const input: Record<string, unknown> = {
      instructions: body.instructions,
      documents: body.documents,
      target_files: body.target_files,
      target_directories: body.target_directories,
    };
    if (body.workspace) {
      input["workspace"] = body.workspace;
    }

    const results = await sql<PipelineRow[]>`
      INSERT INTO pipelines (project_id, name, status, input)
      VALUES (
        ${projectId},
        ${body.name ?? null},
        'planning',
        ${sql.json(input as import("postgres").JSONValue)}
      )
      RETURNING id, session_id, project_id, name, status, input, plan, created_at, updated_at
    `;

    const pipeline = results[0];
    if (!pipeline) {
      return c.json({ error: "Failed to create pipeline" }, 500);
    }

    await publishEvent("global", "pipeline.created", {
      id: pipeline.id,
      project_id: projectId,
      status: pipeline.status,
    });

    log.info(`Pipeline created: ${pipeline.id} for project ${projectId}`);

    return c.json({ success: true, pipeline }, 201);
  } catch (error) {
    log.error("POST /api/projects/:id/pipelines error:", error);
    return c.json(
      {
        error: "Failed to create pipeline",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/projects/:id/sync-epics
 * Synchronise epics from a pipeline's plan (plan.sprints[]).
 * Each sprint in the plan produces one epic (title = sprint.name, wave_start, wave_end).
 * strategy=replace: DELETE existing epics for this pipeline then INSERT all.
 * strategy=merge:   INSERT only the epics whose title is not yet present for this pipeline.
 * Returns { success, created, epics }
 */
export async function postSyncEpicsFromPipeline(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("id");
    if (!projectId) {
      return c.json({ error: "Missing project ID" }, 400);
    }

    const raw = await c.req.json();
    const parseResult = SyncEpicsSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const { pipeline_id, strategy } = parseResult.data;

    const sql = getDb();

    // Verify project exists
    const projectCheck = await sql<{ id: string }[]>`
      SELECT id FROM projects WHERE id = ${projectId}
    `;
    if (projectCheck.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Fetch the pipeline and its plan
    const pipelineRows = await sql<PipelineRow[]>`
      SELECT id, project_id, plan
      FROM pipelines
      WHERE id = ${pipeline_id} AND project_id = ${projectId}
    `;
    const pipeline = pipelineRows[0];
    if (!pipeline) {
      return c.json(
        { error: "Pipeline not found or does not belong to this project" },
        404,
      );
    }

    const sprints = pipeline.plan?.sprints;
    if (!sprints || sprints.length === 0) {
      return c.json(
        { error: "Pipeline has no plan with sprints yet. Run planning first." },
        422,
      );
    }

    // Normalise sprints: keep only those with valid wave bounds
    const validSprints = sprints.filter(
      (s) =>
        typeof s.name === "string" &&
        s.name.trim().length > 0 &&
        typeof s.wave_start === "number" &&
        typeof s.wave_end === "number" &&
        s.wave_end >= s.wave_start &&
        s.wave_start >= 0,
    );

    if (validSprints.length === 0) {
      return c.json(
        { error: "No valid sprints with wave_start/wave_end found in pipeline plan" },
        422,
      );
    }

    let created = 0;
    let epics: EpicRow[] = [];

    if (strategy === "replace") {
      // Delete all existing epics tied to this pipeline, then bulk-insert
      await sql`
        DELETE FROM project_epics
        WHERE project_id = ${projectId} AND pipeline_id = ${pipeline_id}
      `;

      if (validSprints.length > 0) {
        // Build values for bulk insert via postgres.js array syntax
        const insertedEpics = await sql<EpicRow[]>`
          INSERT INTO project_epics (project_id, pipeline_id, title, wave_start, wave_end, status)
          SELECT * FROM ${sql(
            validSprints.map((sprint, idx) => ({
              project_id: projectId,
              pipeline_id: pipeline_id,
              title: sprint.name.trim(),
              wave_start: sprint.wave_start,
              wave_end: sprint.wave_end,
              status: "todo",
              sort_order: idx,
            })),
          )}
          RETURNING id, project_id, pipeline_id, title, status, wave_start, wave_end, created_at
        `;
        created = insertedEpics.length;
        epics = insertedEpics;
      }
    } else {
      // strategy === "merge": only insert titles not already present for this pipeline
      const existingRows = await sql<{ title: string }[]>`
        SELECT title FROM project_epics
        WHERE project_id = ${projectId} AND pipeline_id = ${pipeline_id}
      `;
      const existingTitles = new Set(existingRows.map((r) => r.title));

      const newSprints = validSprints.filter(
        (s) => !existingTitles.has(s.name.trim()),
      );

      if (newSprints.length > 0) {
        const insertedEpics = await sql<EpicRow[]>`
          INSERT INTO project_epics (project_id, pipeline_id, title, wave_start, wave_end, status)
          SELECT * FROM ${sql(
            newSprints.map((sprint, idx) => ({
              project_id: projectId,
              pipeline_id: pipeline_id,
              title: sprint.name.trim(),
              wave_start: sprint.wave_start,
              wave_end: sprint.wave_end,
              status: "todo",
              sort_order: existingTitles.size + idx,
            })),
          )}
          RETURNING id, project_id, pipeline_id, title, status, wave_start, wave_end, created_at
        `;
        created = insertedEpics.length;
        epics = insertedEpics;
      }

      // Return all epics for this pipeline after merge
      const allEpics = await sql<EpicRow[]>`
        SELECT id, project_id, pipeline_id, title, status, wave_start, wave_end, created_at
        FROM project_epics
        WHERE project_id = ${projectId} AND pipeline_id = ${pipeline_id}
        ORDER BY sort_order ASC, created_at ASC
      `;
      epics = allEpics;
    }

    await publishEvent("global", "epics.synced", {
      project_id: projectId,
      pipeline_id,
      strategy,
      created,
    });

    log.info(
      `Epics synced: project=${projectId} pipeline=${pipeline_id} strategy=${strategy} created=${created}`,
    );

    return c.json({ success: true, created, epics });
  } catch (error) {
    log.error("POST /api/projects/:id/sync-epics error:", error);
    return c.json(
      {
        error: "Failed to sync epics",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * PATCH /api/projects/:id
 * Partial update of a project (name, status, description, git fields, metadata).
 * Only the fields present in the body are updated.
 * Returns { success, project }
 */
export async function patchProject(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("id");
    if (!projectId) {
      return c.json({ error: "Missing project ID" }, 400);
    }

    const raw = await c.req.json();
    const parseResult = PatchProjectSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400,
      );
    }
    const body = parseResult.data;

    // Reject empty patches
    if (Object.keys(body).length === 0) {
      return c.json({ error: "No fields to update" }, 400);
    }

    const sql = getDb();

    // Verify project exists
    const existing = await sql<ProjectRow[]>`
      SELECT id FROM projects WHERE id = ${projectId}
    `;
    if (existing.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Build dynamic SET clause: only include provided fields
    // postgres.js does not support dynamic SET helpers, so we use individual
    // conditional UPDATEs via a single SQL statement with CASE expressions.
    // This keeps the query a single round-trip and atomically updates all fields.
    const results = await sql<ProjectRow[]>`
      UPDATE projects SET
        name        = CASE WHEN ${body.name        !== undefined}::bool THEN ${body.name        ?? null} ELSE name        END,
        status      = CASE WHEN ${body.status      !== undefined}::bool THEN ${body.status      ?? null} ELSE status      END,
        description = CASE WHEN ${body.description !== undefined}::bool THEN ${body.description ?? null} ELSE description END,
        git_repo_url= CASE WHEN ${body.git_repo_url !== undefined}::bool THEN ${body.git_repo_url ?? null} ELSE git_repo_url END,
        git_branch  = CASE WHEN ${body.git_branch  !== undefined}::bool THEN ${body.git_branch  ?? null} ELSE git_branch  END,
        metadata    = CASE WHEN ${body.metadata    !== undefined}::bool
                          THEN metadata || ${sql.json((body.metadata ?? {}) as import("postgres").JSONValue)}
                          ELSE metadata
                     END,
        updated_at  = NOW()
      WHERE id = ${projectId}
      RETURNING id, path, name, status, description, git_repo_url, git_branch, metadata, created_at, updated_at
    `;

    const project = results[0];
    if (!project) {
      return c.json({ error: "Failed to update project" }, 500);
    }

    await publishEvent("global", "project.updated", {
      id: projectId,
      fields: Object.keys(body),
    });

    log.info(`Project updated: ${projectId} fields=[${Object.keys(body).join(", ")}]`);

    return c.json({ success: true, project });
  } catch (error) {
    log.error("PATCH /api/projects/:id error:", error);
    return c.json(
      {
        error: "Failed to update project",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/projects/:id/analyze
 * Trigger an automatic codebase analysis for a single project.
 * The analysis runs asynchronously in the background — this handler
 * returns 202 immediately and fires analyzeProject() without awaiting it.
 * Clients can poll the project's metadata.analyze_status ('running'|'done'|'error').
 * Returns { success, project_id, message }
 */
export async function analyzeProjectHandler(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("id");
    if (!projectId) {
      return c.json({ error: "Missing project ID" }, 400);
    }

    const sql = getDb();

    // Verify project exists before firing off the background task
    const check = await sql<{ id: string; analyze_status: string | null }[]>`
      SELECT id, metadata->>'analyze_status' AS analyze_status
      FROM projects
      WHERE id = ${projectId}
    `;
    if (check.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    if (check[0]?.analyze_status === "running") {
      return c.json(
        { error: "Analysis already running for this project", project_id: projectId },
        409,
      );
    }

    // Fire-and-forget: do not await so the HTTP response is immediate
    analyzeProject(projectId).catch((err) => {
      log.error(`Background analyzeProject failed for ${projectId}:`, err);
    });

    log.info(`POST /api/projects/${projectId}/analyze: analysis triggered`);

    return c.json(
      {
        success: true,
        project_id: projectId,
        message: "Analysis started. Poll metadata.analyze_status for progress.",
      },
      202,
    );
  } catch (error) {
    log.error("POST /api/projects/:id/analyze error:", error);
    return c.json(
      {
        error: "Failed to trigger analysis",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/projects/analyze-all
 * Trigger codebase analysis for all projects that do not yet have
 * analyze_status='done' or have no epics.
 * Runs sequentially in the background to avoid overloading the Claude rate limit.
 * Returns { success, message } immediately (202), with stats published via event.
 */
export async function analyzeAllProjectsHandler(c: Context): Promise<Response> {
  try {
    // Fire-and-forget sequential processing
    analyzeAllProjects()
      .then(({ analyzed, skipped, errors }) => {
        log.info(
          `analyzeAllProjects completed: analyzed=${analyzed} skipped=${skipped} errors=${errors}`,
        );
        return publishEvent("global", "projects.analyze-all.completed", {
          analyzed,
          skipped,
          errors,
        });
      })
      .catch((err) => {
        log.error("Background analyzeAllProjects failed:", err);
      });

    return c.json(
      {
        success: true,
        message:
          "Bulk analysis started. Projects without analyze_status=done will be processed sequentially.",
      },
      202,
    );
  } catch (error) {
    log.error("POST /api/projects/analyze-all error:", error);
    return c.json(
      {
        error: "Failed to trigger bulk analysis",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}
