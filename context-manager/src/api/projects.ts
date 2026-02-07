/**
 * Projects API - Manage projects (identified by cwd)
 * Phase 3.1 - POST/GET /api/projects endpoints
 * @module api/projects
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";

/** Input schema for project creation */
export interface ProjectInput {
  path: string;
  name?: string;
  metadata?: Record<string, unknown>;
}

/** Project row from database */
interface ProjectRow {
  id: string;
  path: string;
  name: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

/** Zod schema for project input validation */
const ProjectInputSchema = z.object({
  path: z.string().min(1, "path is required"),
  name: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST /api/projects - Create or get project by path
 * Creates a new project or returns existing one if path already exists
 * @param c - Hono context
 */
export async function postProject(c: Context): Promise<Response> {
  try {
    const raw = await c.req.json();

    // Validate input with Zod
    const parseResult = ProjectInputSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        400
      );
    }
    const body = parseResult.data;

    // Normalize path (remove trailing slash)
    const normalizedPath = body.path.replace(/\/+$/, "");

    const sql = getDb();

    // Use INSERT ON CONFLICT to handle upsert
    const results = await sql<ProjectRow[]>`
      INSERT INTO projects (path, name, metadata)
      VALUES (
        ${normalizedPath},
        ${body.name ?? null},
        ${sql.json(body.metadata ?? {})}
      )
      ON CONFLICT (path) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, projects.name),
        metadata = projects.metadata || EXCLUDED.metadata,
        updated_at = NOW()
      RETURNING id, path, name, created_at, updated_at, metadata
    `;

    const project = results[0];
    if (!project) {
      return c.json({ error: "Failed to create project" }, 500);
    }

    return c.json({
      success: true,
      project: {
        id: project.id,
        path: project.path,
        name: project.name,
        created_at: project.created_at,
        updated_at: project.updated_at,
        metadata: project.metadata,
      },
    }, 201);
  } catch (error) {
    console.error("[API] POST /api/projects error:", error);
    return c.json(
      {
        error: "Failed to create project",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/projects - List all projects with pagination
 * Query params:
 *   - limit: max results (default: 100, max: 1000)
 *   - offset: pagination offset (default: 0)
 * @param c - Hono context
 */
export async function getProjects(c: Context): Promise<Response> {
  try {
    const sql = getDb();
    const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 100);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);

    const projects = await sql<ProjectRow[]>`
      SELECT id, path, name, created_at, updated_at, metadata
      FROM projects
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    // Get total count for pagination
    const countResult = await sql<{ count: string }[]>`SELECT COUNT(*) as count FROM projects`;
    const total = countResult[0] ? parseInt(countResult[0].count, 10) : 0;

    return c.json({
      projects,
      count: projects.length,
      total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[API] GET /api/projects error:", error);
    return c.json(
      {
        error: "Failed to fetch projects",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/projects/:id - Get project by ID with its requests
 * @param c - Hono context
 */
export async function getProjectById(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("id");

    if (!projectId) {
      return c.json({ error: "Missing project ID" }, 400);
    }

    const sql = getDb();

    // Get project
    const projectResults = await sql<ProjectRow[]>`
      SELECT id, path, name, created_at, updated_at, metadata
      FROM projects
      WHERE id = ${projectId}
    `;

    const project = projectResults[0];
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Get associated requests
    const requests = await sql`
      SELECT id, session_id, prompt, prompt_type, status, created_at, completed_at, metadata
      FROM requests
      WHERE project_id = ${projectId}
      ORDER BY created_at DESC
      LIMIT 50
    `;

    // Get project stats
    const statsResults = await sql`
      SELECT * FROM v_project_stats WHERE project_id = ${projectId}
    `;

    return c.json({
      project: {
        ...project,
        requests,
        stats: statsResults[0] ?? null,
      },
    });
  } catch (error) {
    console.error("[API] GET /api/projects/:id error:", error);
    return c.json(
      {
        error: "Failed to fetch project",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/projects/by-path - Get project by path
 * Query params:
 *   - path: project path (required)
 * @param c - Hono context
 */
export async function getProjectByPath(c: Context): Promise<Response> {
  try {
    const path = c.req.query("path");

    if (!path) {
      return c.json({ error: "Missing query parameter: path" }, 400);
    }

    const normalizedPath = path.replace(/\/+$/, "");
    const sql = getDb();

    const projectResults = await sql<ProjectRow[]>`
      SELECT id, path, name, created_at, updated_at, metadata
      FROM projects
      WHERE path = ${normalizedPath}
    `;

    const project = projectResults[0];
    if (!project) {
      return c.json({ error: "Project not found" }, 404);
    }

    return c.json({ project });
  } catch (error) {
    console.error("[API] GET /api/projects/by-path error:", error);
    return c.json(
      {
        error: "Failed to fetch project",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * DELETE /api/projects/:id - Delete a project and all associated data (cascade)
 * @param c - Hono context
 */
export async function deleteProject(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("id");

    if (!projectId) {
      return c.json({ error: "Missing project ID" }, 400);
    }

    const sql = getDb();

    const results = await sql<{ id: string }[]>`
      DELETE FROM projects WHERE id = ${projectId} RETURNING id
    `;

    if (results.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Publish real-time event
    await publishEvent("global", "project.deleted", {
      id: projectId,
    });

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[API] DELETE /api/projects/:id error:", error);
    return c.json(
      {
        error: "Failed to delete project",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}
