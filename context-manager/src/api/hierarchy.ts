/**
 * Hierarchy API - Full project hierarchical view
 * @module api/hierarchy
 */

import type { Context } from "hono";
import { getDb } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("API");

// ============================================
// Type definitions for hierarchy
// ============================================

export interface ProjectRow {
  id: string;
  path: string;
  name: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface RequestRow {
  id: string;
  session_id: string;
  prompt: string;
  prompt_type: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

export interface TaskRow {
  id: string;
  request_id: string;
  name: string | null;
  wave_number: number;
  status: string;
  created_at: string;
  completed_at: string | null;
}

export interface SubtaskRow {
  id: string;
  task_list_id: string;
  agent_type: string | null;
  agent_id: string | null;
  parent_agent_id: string | null;
  description: string;
  status: string;
  blocked_by: string[] | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  result: Record<string, unknown> | null;
}

/**
 * GET /api/hierarchy/:project_id - Full hierarchical view
 * Returns: project -> requests -> tasks -> subtasks
 * Optimized: Uses a single JOIN query instead of N+1 separate queries
 */
export async function getHierarchy(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("project_id");

    if (!projectId) {
      return c.json({ error: "Missing project_id" }, 400);
    }

    const sql = getDb();

    // Single JOIN query to fetch the entire hierarchy at once
    const rows = await sql`
      SELECT
        p.id AS project_id,
        p.path AS project_path,
        p.name AS project_name,
        p.created_at AS project_created_at,
        p.updated_at AS project_updated_at,
        p.metadata AS project_metadata,
        r.id AS request_id,
        r.session_id,
        r.prompt,
        r.prompt_type,
        r.status AS request_status,
        r.created_at AS request_created_at,
        r.completed_at AS request_completed_at,
        r.metadata AS request_metadata,
        tl.id AS task_id,
        tl.name AS task_name,
        tl.wave_number,
        tl.status AS task_status,
        tl.created_at AS task_created_at,
        tl.completed_at AS task_completed_at,
        st.id AS subtask_id,
        st.task_list_id,
        st.agent_type,
        st.agent_id,
        st.parent_agent_id,
        st.description AS subtask_description,
        st.status AS subtask_status,
        st.blocked_by,
        st.created_at AS subtask_created_at,
        st.started_at AS subtask_started_at,
        st.completed_at AS subtask_completed_at,
        st.result AS subtask_result
      FROM projects p
      LEFT JOIN requests r ON r.project_id = p.id
      LEFT JOIN task_lists tl ON tl.request_id = r.id
      LEFT JOIN subtasks st ON st.task_list_id = tl.id
      WHERE p.id = ${projectId}
      ORDER BY r.created_at DESC, tl.wave_number ASC, tl.created_at ASC, st.created_at ASC
    `;

    if (rows.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    // Build the project from the first row
    const firstRow = rows[0]!;
    const project: ProjectRow = {
      id: firstRow['project_id'] as string,
      path: firstRow['project_path'] as string,
      name: firstRow['project_name'] as string | null,
      created_at: firstRow['project_created_at'] as string,
      updated_at: firstRow['project_updated_at'] as string,
      metadata: firstRow['project_metadata'] as Record<string, unknown>,
    };

    // Build nested structure from flat JOIN results
    const requestsMap = new Map<string, RequestRow & { tasks: Map<string, TaskRow & { subtasks: (SubtaskRow & { task_id: string })[] }> }>();
    let totalRequests = 0;
    let totalTasks = 0;
    let totalSubtasks = 0;

    for (const row of rows) {
      // Skip rows with no request (project with no requests)
      if (!row['request_id']) continue;

      const requestId = row['request_id'] as string;
      if (!requestsMap.has(requestId)) {
        totalRequests++;
        requestsMap.set(requestId, {
          id: requestId,
          session_id: row['session_id'] as string,
          prompt: row['prompt'] as string,
          prompt_type: row['prompt_type'] as string | null,
          status: row['request_status'] as string,
          created_at: row['request_created_at'] as string,
          completed_at: row['request_completed_at'] as string | null,
          metadata: row['request_metadata'] as Record<string, unknown>,
          tasks: new Map(),
        });
      }

      const request = requestsMap.get(requestId)!;

      // Skip rows with no task
      if (!row['task_id']) continue;

      const taskId = row['task_id'] as string;
      if (!request.tasks.has(taskId)) {
        totalTasks++;
        request.tasks.set(taskId, {
          id: taskId,
          request_id: requestId,
          name: row['task_name'] as string | null,
          wave_number: row['wave_number'] as number,
          status: row['task_status'] as string,
          created_at: row['task_created_at'] as string,
          completed_at: row['task_completed_at'] as string | null,
          subtasks: [],
        });
      }

      const task = request.tasks.get(taskId)!;

      // Skip rows with no subtask
      if (!row['subtask_id']) continue;

      totalSubtasks++;
      task.subtasks.push({
        id: row['subtask_id'] as string,
        task_list_id: row['task_list_id'] as string,
        task_id: taskId,
        agent_type: row['agent_type'] as string | null,
        agent_id: row['agent_id'] as string | null,
        parent_agent_id: row['parent_agent_id'] as string | null,
        description: row['subtask_description'] as string,
        status: row['subtask_status'] as string,
        blocked_by: row['blocked_by'] as string[] | null,
        created_at: row['subtask_created_at'] as string,
        started_at: row['subtask_started_at'] as string | null,
        completed_at: row['subtask_completed_at'] as string | null,
        result: row['subtask_result'] as Record<string, unknown> | null,
      });
    }

    // Convert Maps to arrays for JSON response
    const hierarchy = {
      ...project,
      requests: Array.from(requestsMap.values()).map((req) => ({
        id: req.id,
        session_id: req.session_id,
        prompt: req.prompt,
        prompt_type: req.prompt_type,
        status: req.status,
        created_at: req.created_at,
        completed_at: req.completed_at,
        metadata: req.metadata,
        tasks: Array.from(req.tasks.values()),
      })),
    };

    // Get stats from view (second query - lightweight)
    const statsResults = await sql`
      SELECT * FROM v_project_stats WHERE project_id = ${projectId}
    `;

    return c.json({
      hierarchy,
      stats: statsResults[0] ?? null,
      counts: {
        requests: totalRequests,
        tasks: totalTasks,
        subtasks: totalSubtasks,
      },
    });
  } catch (error) {
    log.error("GET /api/hierarchy/:project_id error:", error);
    return c.json(
      {
        error: "Failed to fetch hierarchy",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/active-sessions - List active sessions using v_active_agents view
 */
export async function getActiveSessions(c: Context): Promise<Response> {
  try {
    const sql = getDb();

    const activeAgents = await sql`
      SELECT * FROM v_active_agents
      ORDER BY started_at DESC
    `;

    return c.json({
      active_agents: activeAgents,
      count: activeAgents.length,
    });
  } catch (error) {
    log.error("GET /api/active-sessions error:", error);
    return c.json(
      {
        error: "Failed to fetch active sessions",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}
