/**
 * Pipeline API - HTTP handlers for pipeline lifecycle management
 * Manages creation, execution control, step updates, and querying of pipelines.
 * @module api/pipeline
 */

import type { Context } from "hono";
import { z } from "zod";
import {
  createPipeline,
  startPipeline,
  updateStepStatus,
  getPipeline,
  getPipelineSteps,
  listPipelines,
  pausePipeline,
  cancelPipeline,
} from "../pipeline";
import type { PipelineInput, StepStatus } from "../pipeline";
import { createLogger } from "../lib/logger";

const log = createLogger("Pipeline");

// ============================================
// Validation Schemas
// ============================================

/** Zod schema for pipeline creation input */
const CreatePipelineSchema = z.object({
  session_id: z.string().min(1),
  instructions: z.string().min(1),
  documents: z.array(z.object({
    name: z.string(),
    content: z.string(),
    type: z.enum(["markdown", "text", "json", "code"]),
  })).optional().default([]),
  target_files: z.array(z.string()).optional().default([]),
  target_directories: z.array(z.string()).optional().default([]),
  workspace: z.object({
    path: z.string().min(1, "workspace path is required"),
    git_repo_url: z.string().optional(),
    git_branch: z.string().optional(),
  }),
  config: z.object({
    max_retries: z.number().int().min(0).max(5).optional(),
    strategy: z.enum(["sequential", "adaptive"]).optional(),
    parallel_limit: z.number().int().min(1).max(10).optional(),
  }).optional(),
});

/** Zod schema for step status update */
const UpdateStepSchema = z.object({
  status: z.enum(["running", "completed", "failed", "skipped"]),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});

// ============================================
// Handlers
// ============================================

/**
 * POST /api/pipelines - Create a new pipeline from instructions and documents
 * @param c - Hono context
 */
export async function postCreatePipeline(c: Context): Promise<Response> {
  try {
    const body = await c.req.json();

    const parseResult = CreatePipelineSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const { session_id, instructions, documents, target_files, target_directories, workspace, config } =
      parseResult.data;

    // Build workspace config without undefined values (exactOptionalPropertyTypes compliance)
    const workspaceConfig: import("../pipeline/types").WorkspaceConfig = { path: workspace.path };
    if (workspace.git_repo_url) workspaceConfig.git_repo_url = workspace.git_repo_url;
    if (workspace.git_branch) workspaceConfig.git_branch = workspace.git_branch;

    const input: PipelineInput = {
      instructions,
      documents,
      target_files,
      target_directories,
      workspace: workspaceConfig,
    };

    log.info(`Creating pipeline: session=${session_id}, instructions=${instructions.slice(0, 80)}...`);

    const pipeline = await createPipeline(session_id, input, config as import("../pipeline/types").PipelineConfig | undefined);

    return c.json({ success: true, pipeline }, 201);
  } catch (error) {
    log.error("POST /api/pipelines error:", error);
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
 * POST /api/pipelines/:id/start - Start a pipeline that is ready or paused
 * @param c - Hono context
 */
export async function postStartPipeline(c: Context): Promise<Response> {
  try {
    const id = c.req.param("id");
    if (!id) {
      return c.json({ error: "Missing pipeline ID" }, 400);
    }

    log.info(`Starting pipeline: ${id}`);
    const pipeline = await startPipeline(id);

    return c.json({ success: true, pipeline });
  } catch (error) {
    log.error("POST /api/pipelines/:id/start error:", error);
    return c.json(
      {
        error: "Failed to start pipeline",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/pipelines/:id/pause - Pause a running pipeline
 * @param c - Hono context
 */
export async function postPausePipeline(c: Context): Promise<Response> {
  try {
    const id = c.req.param("id");
    if (!id) {
      return c.json({ error: "Missing pipeline ID" }, 400);
    }

    log.info(`Pausing pipeline: ${id}`);
    await pausePipeline(id);

    return c.json({ success: true });
  } catch (error) {
    log.error("POST /api/pipelines/:id/pause error:", error);
    return c.json(
      {
        error: "Failed to pause pipeline",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/pipelines/:id/cancel - Cancel a pipeline
 * @param c - Hono context
 */
export async function postCancelPipeline(c: Context): Promise<Response> {
  try {
    const id = c.req.param("id");
    if (!id) {
      return c.json({ error: "Missing pipeline ID" }, 400);
    }

    log.info(`Cancelling pipeline: ${id}`);
    await cancelPipeline(id);

    return c.json({ success: true });
  } catch (error) {
    log.error("POST /api/pipelines/:id/cancel error:", error);
    return c.json(
      {
        error: "Failed to cancel pipeline",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * PATCH /api/pipelines/:id/steps/:stepId - Update the status of a pipeline step
 * @param c - Hono context
 */
export async function patchStepStatus(c: Context): Promise<Response> {
  try {
    const stepId = c.req.param("stepId");
    if (!stepId) {
      return c.json({ error: "Missing step ID" }, 400);
    }

    const body = await c.req.json();

    const parseResult = UpdateStepSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const { status, result, error: stepError } = parseResult.data;

    log.info(`Updating step ${stepId}: status=${status}`);
    await updateStepStatus(stepId, status as StepStatus, result, stepError);

    return c.json({ success: true });
  } catch (error) {
    log.error("PATCH /api/pipelines/:id/steps/:stepId error:", error);
    return c.json(
      {
        error: "Failed to update step status",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * GET /api/pipelines - List pipelines with optional session_id and status filters
 * @param c - Hono context
 */
export async function getListPipelines(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.query("session_id");
    const status = c.req.query("status");

    const pipelines = await listPipelines(
      sessionId || undefined,
      status || undefined,
    );

    return c.json({ pipelines, count: pipelines.length });
  } catch (error) {
    log.error("GET /api/pipelines error:", error);
    return c.json(
      {
        error: "Failed to list pipelines",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * GET /api/pipelines/:id - Get pipeline detail with its steps
 * @param c - Hono context
 */
export async function getPipelineDetail(c: Context): Promise<Response> {
  try {
    const id = c.req.param("id");
    if (!id) {
      return c.json({ error: "Missing pipeline ID" }, 400);
    }

    const pipeline = await getPipeline(id);
    if (!pipeline) {
      return c.json({ error: "Pipeline not found" }, 404);
    }

    const steps = await getPipelineSteps(id);

    return c.json({ pipeline, steps });
  } catch (error) {
    log.error("GET /api/pipelines/:id error:", error);
    return c.json(
      {
        error: "Failed to fetch pipeline",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/pipelines/upload - Create a pipeline from multipart/form-data with file uploads
 * @param c - Hono context
 */
export async function postCreatePipelineWithFiles(c: Context): Promise<Response> {
  try {
    const body = await c.req.parseBody({ all: true });

    const sessionId = String(body["session_id"] ?? "");
    const instructions = String(body["instructions"] ?? "");
    const workspacePath = String(body["workspace_path"] ?? "");
    const gitRepoUrl = body["git_repo_url"] ? String(body["git_repo_url"]) : undefined;
    const gitBranch = body["git_branch"] ? String(body["git_branch"]) : undefined;

    if (!sessionId || !instructions) {
      return c.json({ error: "session_id and instructions are required" }, 400);
    }

    if (!workspacePath) {
      return c.json({ error: "workspace_path is required" }, 400);
    }

    // Parse uploaded files
    const documents: Array<{ name: string; content: string; type: "markdown" | "text" | "json" | "code" }> = [];

    // Handle single or multiple files
    const rawFiles = body["files"];
    const fileList = Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [];

    for (const file of fileList) {
      if (file instanceof File) {
        const content = await file.text();
        const name = file.name;
        const ext = name.split(".").pop()?.toLowerCase() ?? "";

        let type: "markdown" | "text" | "json" | "code" = "text";
        if (ext === "md" || ext === "markdown") type = "markdown";
        else if (ext === "json") type = "json";
        else if (["ts", "tsx", "js", "jsx", "py", "php", "sh", "sql"].includes(ext)) type = "code";

        documents.push({ name, content, type });
        log.info(`Uploaded file: ${name} (${type}, ${content.length} chars)`);
      }
    }

    // Parse optional JSON arrays from text fields
    let targetFiles: string[] = [];
    let targetDirectories: string[] = [];
    try {
      if (body["target_files"]) targetFiles = JSON.parse(String(body["target_files"]));
    } catch { /* ignore parse errors */ }
    try {
      if (body["target_directories"]) targetDirectories = JSON.parse(String(body["target_directories"]));
    } catch { /* ignore parse errors */ }

    // Build workspace config without undefined values (exactOptionalPropertyTypes compliance)
    const uploadWorkspaceConfig: import("../pipeline/types").WorkspaceConfig = { path: workspacePath };
    if (gitRepoUrl) uploadWorkspaceConfig.git_repo_url = gitRepoUrl;
    if (gitBranch) uploadWorkspaceConfig.git_branch = gitBranch;

    const input: PipelineInput = {
      instructions,
      documents,
      target_files: targetFiles,
      target_directories: targetDirectories,
      workspace: uploadWorkspaceConfig,
    };

    log.info(`Creating pipeline with files: session=${sessionId}, docs=${documents.length}, instructions=${instructions.slice(0, 80)}...`);

    const pipeline = await createPipeline(sessionId, input);

    return c.json({ success: true, pipeline }, 201);
  } catch (error) {
    log.error("POST /api/pipelines/upload error:", error);
    return c.json(
      {
        error: "Failed to create pipeline with files",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * GET /api/pipelines/:id/events - Get timeline events for a pipeline
 * @param c - Hono context
 */
export async function getPipelineEvents(c: Context): Promise<Response> {
  try {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Missing pipeline ID" }, 400);

    const sql = (await import("../db/client")).getDb();
    const events = await sql`
      SELECT id, pipeline_id, event_type, wave_number, step_order, agent_type, message, data, created_at
      FROM pipeline_events
      WHERE pipeline_id = ${id}
      ORDER BY created_at ASC
    `;

    return c.json({ events, count: events.length });
  } catch (error) {
    log.error("GET /api/pipelines/:id/events error:", error);
    return c.json({ error: "Failed to fetch events", message: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}

/**
 * GET /api/pipelines/:id/live - Get pipeline + all steps + recent events (optimized for live view)
 * @param c - Hono context
 */
export async function getPipelineLive(c: Context): Promise<Response> {
  try {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Missing pipeline ID" }, 400);

    const pipeline = await getPipeline(id);
    if (!pipeline) return c.json({ error: "Pipeline not found" }, 404);

    const steps = await getPipelineSteps(id);

    const sql = (await import("../db/client")).getDb();
    const events = await sql`
      SELECT event_type, wave_number, step_order, agent_type, message, created_at
      FROM pipeline_events
      WHERE pipeline_id = ${id}
      ORDER BY created_at DESC
      LIMIT 50
    `;

    // Group steps by wave
    const waves: Record<number, typeof steps> = {};
    for (const step of steps) {
      const wn = step.wave_number;
      if (!waves[wn]) waves[wn] = [];
      waves[wn].push(step);
    }

    return c.json({ pipeline, steps, waves, events, total_steps: steps.length });
  } catch (error) {
    log.error("GET /api/pipelines/:id/live error:", error);
    return c.json({ error: "Failed to fetch live data", message: error instanceof Error ? error.message : "Unknown error" }, 500);
  }
}

/**
 * GET /api/pipelines/:id/steps - Get pipeline steps, optionally filtered by wave_number
 * @param c - Hono context
 */
export async function getPipelineStepsList(c: Context): Promise<Response> {
  try {
    const id = c.req.param("id");
    if (!id) {
      return c.json({ error: "Missing pipeline ID" }, 400);
    }

    const waveParam = c.req.query("wave_number");
    const waveNumber = waveParam !== undefined && waveParam !== null && waveParam !== ""
      ? parseInt(waveParam, 10)
      : undefined;

    if (waveNumber !== undefined && isNaN(waveNumber)) {
      return c.json({ error: "Invalid wave_number: must be an integer" }, 400);
    }

    const steps = await getPipelineSteps(id, waveNumber);

    return c.json({ steps, count: steps.length });
  } catch (error) {
    log.error("GET /api/pipelines/:id/steps error:", error);
    return c.json(
      {
        error: "Failed to fetch pipeline steps",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

// ============================================
// Sprint Handlers
// ============================================

/**
 * GET /api/pipelines/:id/sprints - List all sprints for a pipeline
 * @param c - Hono context
 */
export async function getPipelineSprints(c: Context): Promise<Response> {
  try {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "Missing pipeline ID" }, 400);

    const sql = (await import("../db/client")).getDb();
    const sprints = await sql`
      SELECT * FROM pipeline_sprints WHERE pipeline_id = ${id} ORDER BY sprint_number ASC
    `;

    return c.json({ sprints, count: sprints.length });
  } catch (error) {
    log.error("GET sprints error:", error);
    return c.json({ error: "Failed to fetch sprints", message: error instanceof Error ? error.message : "Unknown" }, 500);
  }
}

/**
 * GET /api/pipelines/:id/sprints/:number/report - Get sprint detail with report
 * @param c - Hono context
 */
export async function getSprintReport(c: Context): Promise<Response> {
  try {
    const id = c.req.param("id");
    const num = c.req.param("number");
    if (!id || !num) return c.json({ error: "Missing params" }, 400);

    const sql = (await import("../db/client")).getDb();
    const [sprint] = await sql`
      SELECT * FROM pipeline_sprints WHERE pipeline_id = ${id} AND sprint_number = ${parseInt(num, 10)}
    `;
    if (!sprint) return c.json({ error: "Sprint not found" }, 404);

    return c.json({ sprint });
  } catch (error) {
    log.error("GET sprint report error:", error);
    return c.json({ error: "Failed to fetch sprint report", message: error instanceof Error ? error.message : "Unknown" }, 500);
  }
}
