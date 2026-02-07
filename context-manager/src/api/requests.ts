/**
 * Requests API - Manage user requests (prompts)
 * Phase 3.2 - POST/GET /api/requests endpoints
 * @module api/requests
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";

/** Input schema for request creation */
export interface RequestInput {
  project_id: string;
  session_id: string;
  prompt: string;
  prompt_type?: string; // feature, debug, explain, search, etc.
  status?: string; // active, completed, failed, cancelled
  metadata?: Record<string, unknown>;
}

/** Request row from database */
interface RequestRow {
  id: string;
  project_id: string;
  session_id: string;
  prompt: string;
  prompt_type: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown>;
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

/** Valid prompt types */
const VALID_PROMPT_TYPES = ["feature", "debug", "explain", "search", "refactor", "test", "review", "other"] as const;

/** Valid request statuses */
const VALID_REQUEST_STATUSES = ["active", "completed", "failed", "cancelled"] as const;

/** Zod schema for request input validation */
const RequestInputSchema = z.object({
  project_id: z.string().uuid("project_id must be a valid UUID"),
  session_id: z.string().min(1, "session_id is required"),
  prompt: z.string().min(1, "prompt is required"),
  prompt_type: z.enum(VALID_PROMPT_TYPES).optional(),
  status: z.enum(VALID_REQUEST_STATUSES).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST /api/requests - Create a new user request
 * @param c - Hono context
 */
export async function postRequest(c: Context): Promise<Response> {
  try {
    const raw = await c.req.json();

    // Validate input with Zod
    const parseResult = RequestInputSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        400
      );
    }
    const body = parseResult.data;

    const sql = getDb();

    // Verify project exists
    const projectResults = await sql<{ id: string }[]>`
      SELECT id FROM projects WHERE id = ${body.project_id}
    `;

    if (!projectResults[0]) {
      return c.json(
        { error: `Project not found: ${body.project_id}` },
        404
      );
    }

    // Insert request
    const results = await sql<RequestRow[]>`
      INSERT INTO requests (
        project_id,
        session_id,
        prompt,
        prompt_type,
        status,
        metadata
      ) VALUES (
        ${body.project_id},
        ${body.session_id},
        ${body.prompt},
        ${body.prompt_type ?? null},
        ${body.status ?? "active"},
        ${sql.json(body.metadata ?? {})}
      )
      RETURNING id, project_id, session_id, prompt, prompt_type, status, created_at, completed_at, metadata
    `;

    const request = results[0];
    if (!request) {
      return c.json({ error: "Failed to create request" }, 500);
    }

    return c.json({
      success: true,
      request: {
        id: request.id,
        project_id: request.project_id,
        session_id: request.session_id,
        prompt: request.prompt,
        prompt_type: request.prompt_type,
        status: request.status,
        created_at: request.created_at,
        completed_at: request.completed_at,
        metadata: request.metadata,
      },
    }, 201);
  } catch (error) {
    console.error("[API] POST /api/requests error:", error);
    return c.json(
      {
        error: "Failed to create request",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/requests - List requests with pagination
 * Query params:
 *   - limit: max results (default: 100, max: 1000)
 *   - offset: pagination offset (default: 0)
 *   - project_id: filter by project
 *   - session_id: filter by session
 *   - status: filter by status
 * @param c - Hono context
 */
export async function getRequests(c: Context): Promise<Response> {
  try {
    const sql = getDb();
    const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 100);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);
    const projectId = c.req.query("project_id");
    const sessionId = c.req.query("session_id");
    const status = c.req.query("status");

    let requests: RequestRow[];

    if (projectId && sessionId && status) {
      requests = await sql<RequestRow[]>`
        SELECT id, project_id, session_id, prompt, prompt_type, status, created_at, completed_at, metadata
        FROM requests
        WHERE project_id = ${projectId} AND session_id = ${sessionId} AND status = ${status}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (projectId && sessionId) {
      requests = await sql<RequestRow[]>`
        SELECT id, project_id, session_id, prompt, prompt_type, status, created_at, completed_at, metadata
        FROM requests
        WHERE project_id = ${projectId} AND session_id = ${sessionId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (projectId) {
      requests = await sql<RequestRow[]>`
        SELECT id, project_id, session_id, prompt, prompt_type, status, created_at, completed_at, metadata
        FROM requests
        WHERE project_id = ${projectId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (sessionId) {
      requests = await sql<RequestRow[]>`
        SELECT id, project_id, session_id, prompt, prompt_type, status, created_at, completed_at, metadata
        FROM requests
        WHERE session_id = ${sessionId}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (status) {
      requests = await sql<RequestRow[]>`
        SELECT id, project_id, session_id, prompt, prompt_type, status, created_at, completed_at, metadata
        FROM requests
        WHERE status = ${status}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      requests = await sql<RequestRow[]>`
        SELECT id, project_id, session_id, prompt, prompt_type, status, created_at, completed_at, metadata
        FROM requests
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    return c.json({
      requests,
      count: requests.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[API] GET /api/requests error:", error);
    return c.json(
      {
        error: "Failed to fetch requests",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/requests/:id - Get request by ID with its tasks
 * @param c - Hono context
 */
export async function getRequestById(c: Context): Promise<Response> {
  try {
    const requestId = c.req.param("id");

    if (!requestId) {
      return c.json({ error: "Missing request ID" }, 400);
    }

    const sql = getDb();

    // Get request
    const requestResults = await sql<RequestRow[]>`
      SELECT id, project_id, session_id, prompt, prompt_type, status, created_at, completed_at, metadata
      FROM requests
      WHERE id = ${requestId}
    `;

    const request = requestResults[0];
    if (!request) {
      return c.json({ error: "Request not found" }, 404);
    }

    // Get associated task_lists (waves)
    const tasks = await sql<TaskRow[]>`
      SELECT id, request_id, name, wave_number, status, created_at, completed_at
      FROM task_lists
      WHERE request_id = ${requestId}
      ORDER BY wave_number ASC, created_at ASC
    `;

    return c.json({
      request: {
        ...request,
        tasks,
      },
    });
  } catch (error) {
    console.error("[API] GET /api/requests/:id error:", error);
    return c.json(
      {
        error: "Failed to fetch request",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * PATCH /api/requests/:id - Update request status
 * @param c - Hono context
 */
export async function patchRequest(c: Context): Promise<Response> {
  try {
    const requestId = c.req.param("id");

    if (!requestId) {
      return c.json({ error: "Missing request ID" }, 400);
    }

    const raw = await c.req.json();

    // Validate with Zod
    const PatchRequestSchema = z.object({
      status: z.enum(VALID_REQUEST_STATUSES).optional(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    }).refine((data) => data.status || data.metadata, {
      message: "No update fields provided",
    });

    const parseResult = PatchRequestSchema.safeParse(raw);
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
    let results: RequestRow[];
    if (body.status === "completed") {
      results = await sql<RequestRow[]>`
        UPDATE requests
        SET
          status = ${body.status},
          completed_at = NOW(),
          metadata = metadata || ${sql.json(body.metadata ?? {})}
        WHERE id = ${requestId}
        RETURNING id, project_id, session_id, prompt, prompt_type, status, created_at, completed_at, metadata
      `;
    } else if (body.status) {
      results = await sql<RequestRow[]>`
        UPDATE requests
        SET
          status = ${body.status},
          metadata = metadata || ${sql.json(body.metadata ?? {})}
        WHERE id = ${requestId}
        RETURNING id, project_id, session_id, prompt, prompt_type, status, created_at, completed_at, metadata
      `;
    } else if (body.metadata) {
      results = await sql<RequestRow[]>`
        UPDATE requests
        SET
          metadata = metadata || ${sql.json(body.metadata)}
        WHERE id = ${requestId}
        RETURNING id, project_id, session_id, prompt, prompt_type, status, created_at, completed_at, metadata
      `;
    } else {
      return c.json({ error: "No update fields provided" }, 400);
    }

    const request = results[0];
    if (!request) {
      return c.json({ error: "Request not found" }, 404);
    }

    return c.json({
      success: true,
      request,
    });
  } catch (error) {
    console.error("[API] PATCH /api/requests/:id error:", error);
    return c.json(
      {
        error: "Failed to update request",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * DELETE /api/requests/:id - Delete a request and all associated data (cascade)
 * @param c - Hono context
 */
export async function deleteRequest(c: Context): Promise<Response> {
  try {
    const requestId = c.req.param("id");

    if (!requestId) {
      return c.json({ error: "Missing request ID" }, 400);
    }

    const sql = getDb();

    const results = await sql<{ id: string }[]>`
      DELETE FROM requests WHERE id = ${requestId} RETURNING id
    `;

    if (results.length === 0) {
      return c.json({ error: "Request not found" }, 404);
    }

    // Publish real-time event
    await publishEvent("global", "request.deleted", {
      id: requestId,
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[API] DELETE /api/requests/:id error:", error);
    return c.json(
      {
        error: "Failed to delete request",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}
