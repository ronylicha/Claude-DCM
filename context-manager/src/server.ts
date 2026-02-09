/**
 * Distributed Context Manager - Main Server
 * HTTP API using Hono + WebSocket support via Bun
 * @module server
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config, validateConfig } from "./config";
import { getDb, closeDb, testConnection, healthCheck, getDbStats } from "./db/client";
import { postAction, getActions, getActionsHourly, deleteAction, deleteActionsBySession } from "./api/actions";
import { suggestRouting, getRoutingStats, postRoutingFeedback } from "./api/routing";
import { postProject, getProjects, getProjectById, getProjectByPath, deleteProject } from "./api/projects";
import { postRequest, getRequests, getRequestById, patchRequest, deleteRequest } from "./api/requests";
import { postTask, getTasks, getTaskById, patchTask, deleteTask } from "./api/tasks";
import { postSubtask, getSubtasks, getSubtaskById, patchSubtask, deleteSubtask, closeSessionSubtasks } from "./api/subtasks";
// Phase 4 - Inter-agent communication
import { postMessage, getMessages } from "./api/messages";
import {
  postSubscription,
  getSubscriptions,
  getAgentSubscriptions,
  deleteSubscription,
  postUnsubscribe,
} from "./api/subscriptions";
import {
  postBlocking,
  getBlocking,
  deleteBlocking,
  postUnblock,
  checkBlocking,
} from "./api/blocking";
import {
  startCleanupInterval,
  stopCleanupInterval,
  getLastCleanupStats,
  getMessageStats,
} from "./cleanup";
// Phase 5 - Context Agent Integration
import { postCompactRestore, getCompactStatus, postCompactSave, getCompactSnapshot } from "./api/compact";
import { getContext, postContextGenerate } from "./api/context";
// Phase 6 - Sessions Management
import { postSession, getSessions, getSessionById, patchSession, getSessionsStats, deleteSession } from "./api/sessions";
// Phase 7 - Tools Summary
import { getToolsSummary } from "./api/tools-summary";
// Phase 8 - WebSocket Auth
import { generateToken, isValidAgentId, isValidSessionId } from "./websocket/auth";
// Rate limiting
import { rateLimit, rateLimitPresets } from "./middleware/rate-limit";
// Phase 9 - DCM v3.0 Proactive Triage Station
import { trackTokens, getCapacity, resetCapacity } from "./api/tokens";
import { getRegistry, getRegistryAgent, putRegistryAgent, postRegistryImport, postRegistryEnrichContext } from "./api/registry";
import { postBatchSubmit, getBatch, getSynthesis, getConflicts, postBatchComplete } from "./api/orchestration";
import { getWaveCurrent, getWaveHistoryHandler, postWaveTransition, postWaveCreate, postWaveStart } from "./api/waves";

// Validate configuration at startup
validateConfig();

// Create Hono app
const app = new Hono();

// Middleware - Configure CORS based on environment
const allowedOrigins = process.env["ALLOWED_ORIGINS"]?.split(",") || [
  "http://localhost:3848",  // Dashboard in development
  "http://127.0.0.1:3848",  // Dashboard alternative
];

// In production, only allow configured origins. In dev, be more permissive but still log warnings
const corsConfig = {
  origin: (origin: string | undefined) => {
    // Allow requests with no origin (e.g., mobile apps, curl, Postman)
    if (origin === undefined) return origin;
    
    // Reject empty string origins
    if (origin === "") {
      console.warn("[CORS] Rejected empty origin");
      return null;
    }
    
    // Check against allowed origins
    if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
      return origin;
    }
    
    // In development, allow localhost variations but log warning
    if (process.env["NODE_ENV"] !== "production") {
      if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/)) {
        console.warn(`[CORS] Allowing origin ${origin} in development mode`);
        return origin;
      }
    }
    
    console.warn(`[CORS] Rejected origin: ${origin}`);
    return null;  // Properly reject the origin
  },
  credentials: true,
};

app.use("*", cors(corsConfig));
app.use("*", logger());

// ============================================
// Type definitions for hierarchy
// ============================================

interface ProjectRow {
  id: string;
  path: string;
  name: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

interface RequestRow {
  id: string;
  session_id: string;
  prompt: string;
  prompt_type: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

interface TaskRow {
  id: string;
  request_id: string;
  name: string | null;
  wave_number: number;
  status: string;
  created_at: string;
  completed_at: string | null;
}

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

// ============================================
// Health & Status Endpoints
// ============================================

app.get("/health", async (c) => {
  const dbHealth = await healthCheck();
  const status = dbHealth.healthy ? "healthy" : "unhealthy";

  return c.json({
    status,
    timestamp: new Date().toISOString(),
    version: "3.0.0",
    database: dbHealth,
    features: {
      phase1: "database",
      phase2: "routing",
      phase3: "hierarchy",
      phase4: "pubsub",
      phase5: "context",
      phase6: "sessions",
      phase7: "tools-summary",
      phase8: "websocket-auth",
      phase9: "proactive-triage",
    },
  }, dbHealth.healthy ? 200 : 503);
});

app.get("/stats", async (c) => {
  try {
    const stats = await getDbStats();
    return c.json({
      ...stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return c.json({
      error: "Failed to get stats",
      message: error instanceof Error ? error.message : "Unknown error",
    }, 500);
  }
});

// ============================================
// Dashboard KPIs - Aggregated metrics
// ============================================

app.get("/api/dashboard/kpis", async (c) => {
  try {
    const sql = getDb();

    const [
      actionStats24h,
      sessionStats,
      agentContextStats,
      subtaskStats,
      routingStats,
      actionsPerHour,
      topAgentTypes,
    ] = await Promise.all([
      sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE exit_code = 0) as success,
          COUNT(DISTINCT tool_name) as unique_tools,
          COUNT(DISTINCT metadata->>'session_id') as active_sessions
        FROM actions
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `,
      sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE ended_at IS NULL AND started_at > NOW() - INTERVAL '24 hours') as active,
          ROUND(COALESCE(AVG(total_tools_used), 0)::numeric, 1) as avg_tools
        FROM sessions
      `,
      sql`
        SELECT
          COUNT(*) as total,
          COUNT(DISTINCT agent_type) as unique_types
        FROM agent_contexts
      `,
      sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'running') as running,
          COUNT(*) FILTER (WHERE status = 'failed') as failed
        FROM subtasks
      `,
      sql`
        SELECT
          COUNT(DISTINCT keyword) as keywords,
          COUNT(DISTINCT tool_name) as tools,
          COUNT(*) as mappings
        FROM keyword_tool_scores
      `,
      sql`
        SELECT
          ROUND(COUNT(*)::numeric / GREATEST(
            EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 3600, 1
          ), 1) as avg_per_hour
        FROM actions
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `,
      sql`
        SELECT agent_type, COUNT(*) as count
        FROM agent_contexts
        GROUP BY agent_type
        ORDER BY count DESC
        LIMIT 8
      `,
    ]);

    const total24h = Number(actionStats24h[0]?.total ?? 0);
    const success24h = Number(actionStats24h[0]?.success ?? 0);

    return c.json({
      actions_24h: {
        total: total24h,
        success: success24h,
        success_rate: total24h > 0 ? Math.round((success24h / total24h) * 100) : 0,
        unique_tools: Number(actionStats24h[0]?.unique_tools ?? 0),
        active_sessions: Number(actionStats24h[0]?.active_sessions ?? 0),
        avg_per_hour: Number(actionsPerHour[0]?.avg_per_hour ?? 0),
      },
      sessions: {
        total: Number(sessionStats[0]?.total ?? 0),
        active: Number(sessionStats[0]?.active ?? 0),
        avg_tools_per_session: Number(sessionStats[0]?.avg_tools ?? 0),
      },
      agents: {
        contexts_total: Number(agentContextStats[0]?.total ?? 0),
        unique_types: Number(agentContextStats[0]?.unique_types ?? 0),
        top_types: topAgentTypes.map((r: Record<string, unknown>) => ({
          agent_type: r.agent_type as string,
          count: Number(r.count),
        })),
      },
      subtasks: {
        total: Number(subtaskStats[0]?.total ?? 0),
        completed: Number(subtaskStats[0]?.completed ?? 0),
        running: Number(subtaskStats[0]?.running ?? 0),
        failed: Number(subtaskStats[0]?.failed ?? 0),
        completion_rate: Number(subtaskStats[0]?.total ?? 0) > 0
          ? Math.round((Number(subtaskStats[0]?.completed ?? 0) / Number(subtaskStats[0]?.total ?? 0)) * 100)
          : 0,
      },
      routing: {
        keywords: Number(routingStats[0]?.keywords ?? 0),
        tools: Number(routingStats[0]?.tools ?? 0),
        mappings: Number(routingStats[0]?.mappings ?? 0),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GET /api/dashboard/kpis error:", error);
    return c.json(
      {
        error: "Failed to get dashboard KPIs",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// ============================================
// Projects API - Phase 3.1 IMPLEMENTED
// ============================================

app.post("/api/projects", postProject);
app.get("/api/projects", getProjects);
app.get("/api/projects/by-path", getProjectByPath);
app.get("/api/projects/:id", getProjectById);
app.delete("/api/projects/:id", deleteProject);

// ============================================
// Requests API - Phase 3.2 IMPLEMENTED
// ============================================

app.post("/api/requests", postRequest);
app.get("/api/requests", getRequests);
app.get("/api/requests/:id", getRequestById);
app.patch("/api/requests/:id", patchRequest);
app.delete("/api/requests/:id", deleteRequest);

// ============================================
// Tasks API - Phase 3.3 IMPLEMENTED
// ============================================

app.post("/api/tasks", postTask);
app.get("/api/tasks", getTasks);
app.get("/api/tasks/:id", getTaskById);
app.patch("/api/tasks/:id", patchTask);
app.delete("/api/tasks/:id", deleteTask);

// ============================================
// Subtasks API - Phase 3.4 IMPLEMENTED
// ============================================

app.post("/api/subtasks", postSubtask);
app.post("/api/subtasks/close-session", closeSessionSubtasks);
app.get("/api/subtasks", getSubtasks);
app.get("/api/subtasks/:id", getSubtaskById);
app.patch("/api/subtasks/:id", patchSubtask);
app.delete("/api/subtasks/:id", deleteSubtask);

// ============================================
// Actions API (tracking) - Phase 2 IMPLEMENTED
// ============================================

app.post("/api/actions", postAction);
app.get("/api/actions", getActions);
app.get("/api/actions/hourly", getActionsHourly);
app.delete("/api/actions/:id", deleteAction);
app.delete("/api/actions/by-session/:session_id", deleteActionsBySession);

// ============================================
// Routing suggestion API - Phase 2 IMPLEMENTED
// ============================================

app.get("/api/routing/suggest", suggestRouting);
app.get("/api/routing/stats", getRoutingStats);
app.post("/api/routing/feedback", postRoutingFeedback);

// ============================================
// Hierarchical View API - Phase 3.5 IMPLEMENTED
// ============================================

/**
 * GET /api/hierarchy/:project_id - Full hierarchical view
 * Returns: project -> requests -> tasks -> subtasks
 * Optimized: Uses a single JOIN query instead of N+1 separate queries
 */
app.get("/api/hierarchy/:project_id", async (c) => {
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
    const firstRow = rows[0];
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
        task_id: row['task_list_id'] as string,
        agent_type: row['agent_type'] as string | null,
        agent_id: row['agent_id'] as string | null,
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
    console.error("[API] GET /api/hierarchy/:project_id error:", error);
    return c.json(
      {
        error: "Failed to fetch hierarchy",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

/**
 * GET /api/active-sessions - List active sessions using v_active_agents view
 */
app.get("/api/active-sessions", async (c) => {
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
    console.error("[API] GET /api/active-sessions error:", error);
    return c.json(
      {
        error: "Failed to fetch active sessions",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// ============================================
// Context API - Phase 5 IMPLEMENTED
// ============================================

// GET /api/context/:agent_id - Get current context for an agent
// Query params: session_id, agent_type, format (brief|raw), max_tokens, include_*
app.get("/api/context/:agent_id", getContext);

// POST /api/context/generate - Generate context brief on demand
app.post("/api/context/generate", postContextGenerate);

// POST /api/compact/save - Save context snapshot before compact (PreCompact hook)
// Body: { session_id, trigger, context_summary?, active_tasks?, modified_files?, key_decisions?, agent_states? }
app.post("/api/compact/save", postCompactSave);

// POST /api/compact/restore - Restore context after compact operation
// Body: { session_id, agent_id, agent_type?, compact_summary?, max_tokens? }
app.post("/api/compact/restore", postCompactRestore);

// GET /api/compact/status/:session_id - Check if session is compacted
app.get("/api/compact/status/:session_id", getCompactStatus);

// GET /api/compact/snapshot/:session_id - Get saved snapshot for a session
app.get("/api/compact/snapshot/:session_id", getCompactSnapshot);


// ============================================
// Agent Contexts API
// ============================================

// GET /api/agent-contexts - List all agent contexts with stats
app.get("/api/agent-contexts", async (c) => {
  try {
    const sql = getDb();
    const limit = Number(c.req.query("limit") ?? "100");
    const offset = Number(c.req.query("offset") ?? "0");
    const agentType = c.req.query("agent_type");
    const status = c.req.query("status");

    const contexts = agentType && status
      ? await sql`
          SELECT * FROM agent_contexts
          WHERE agent_type = ${agentType}
            AND role_context->>'status' = ${status}
          ORDER BY last_updated DESC
          LIMIT ${limit} OFFSET ${offset}`
      : agentType
      ? await sql`
          SELECT * FROM agent_contexts
          WHERE agent_type = ${agentType}
          ORDER BY last_updated DESC
          LIMIT ${limit} OFFSET ${offset}`
      : status
      ? await sql`
          SELECT * FROM agent_contexts
          WHERE role_context->>'status' = ${status}
          ORDER BY last_updated DESC
          LIMIT ${limit} OFFSET ${offset}`
      : await sql`
          SELECT * FROM agent_contexts
          ORDER BY last_updated DESC
          LIMIT ${limit} OFFSET ${offset}`;

    const [{ total }] = await sql`SELECT COUNT(*) as total FROM agent_contexts`;

    // Stats
    const stats = await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT agent_type) as unique_types,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'running') as running,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'completed') as completed,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'failed') as failed
      FROM agent_contexts`;

    const typeDistribution = await sql`
      SELECT agent_type, COUNT(*) as count,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'running') as running,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'completed') as completed
      FROM agent_contexts
      GROUP BY agent_type
      ORDER BY count DESC
      LIMIT 20`;

    return c.json({
      contexts,
      total: Number(total),
      limit,
      offset,
      stats: {
        total: Number(stats[0].total),
        unique_types: Number(stats[0].unique_types),
        running: Number(stats[0].running),
        completed: Number(stats[0].completed),
        failed: Number(stats[0].failed),
      },
      type_distribution: typeDistribution.map(t => ({
        agent_type: t.agent_type,
        count: Number(t.count),
        running: Number(t.running),
        completed: Number(t.completed),
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GET /api/agent-contexts error:", error);
    return c.json({ error: "Failed to get agent contexts" }, 500);
  }
});

// GET /api/agent-contexts/stats - Context KPIs
app.get("/api/agent-contexts/stats", async (c) => {
  try {
    const sql = getDb();

    const [overview] = await sql`
      SELECT
        COUNT(*) as total_contexts,
        COUNT(DISTINCT agent_type) as unique_agent_types,
        COUNT(DISTINCT project_id) as unique_projects,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'running') as active_agents,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'completed') as completed_agents,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'failed') as failed_agents,
        MIN(last_updated) as oldest_context,
        MAX(last_updated) as newest_context
      FROM agent_contexts`;

    const topTypes = await sql`
      SELECT agent_type, COUNT(*) as count,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'running') as running
      FROM agent_contexts
      GROUP BY agent_type
      ORDER BY count DESC
      LIMIT 15`;

    const recentActivity = await sql`
      SELECT id, agent_id, agent_type, progress_summary,
        role_context->>'status' as status,
        role_context->>'spawned_at' as spawned_at,
        last_updated
      FROM agent_contexts
      ORDER BY last_updated DESC
      LIMIT 10`;

    const toolsUsed = await sql`
      SELECT unnest(tools_used) as tool, COUNT(*) as usage_count
      FROM agent_contexts
      WHERE tools_used IS NOT NULL AND array_length(tools_used, 1) > 0
      GROUP BY tool
      ORDER BY usage_count DESC
      LIMIT 20`;

    return c.json({
      overview: {
        total_contexts: Number(overview.total_contexts),
        unique_agent_types: Number(overview.unique_agent_types),
        unique_projects: Number(overview.unique_projects),
        active_agents: Number(overview.active_agents),
        completed_agents: Number(overview.completed_agents),
        failed_agents: Number(overview.failed_agents),
        oldest_context: overview.oldest_context,
        newest_context: overview.newest_context,
      },
      top_types: topTypes.map(t => ({
        agent_type: t.agent_type,
        count: Number(t.count),
        running: Number(t.running),
      })),
      recent_activity: recentActivity,
      tools_used: toolsUsed.map(t => ({
        tool: t.tool,
        usage_count: Number(t.usage_count),
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GET /api/agent-contexts/stats error:", error);
    return c.json({ error: "Failed to get context stats" }, 500);
  }
});

// ============================================
// Sessions API - Phase 6 IMPLEMENTED
// ============================================

app.post("/api/sessions", postSession);
app.get("/api/sessions", getSessions);
app.get("/api/sessions/stats", getSessionsStats);
app.get("/api/sessions/:id", getSessionById);
app.patch("/api/sessions/:id", patchSession);
app.delete("/api/sessions/:id", deleteSession);

// ============================================
// Messages API (pub/sub) - Phase 4 IMPLEMENTED
// ============================================

app.post("/api/messages", postMessage);

// GET /api/messages - Get all messages (for dashboard)
app.get("/api/messages", async (c) => {
  try {
    const sql = getDb();
    const limit = Number(c.req.query("limit") ?? "100");
    const offset = Number(c.req.query("offset") ?? "0");
    const messages = await sql`
      SELECT id, project_id, from_agent_id, to_agent_id,
        message_type, topic, payload, priority,
        read_by, created_at, expires_at
      FROM agent_messages
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}`;
    const [{ total }] = await sql`SELECT COUNT(*) as total FROM agent_messages`;
    return c.json({ messages, count: Number(total), limit, offset });
  } catch (error) {
    console.error("[API] GET /api/messages error:", error);
    return c.json({ error: "Failed to get messages" }, 500);
  }
});

app.get("/api/messages/:agent_id", getMessages);

// ============================================
// Subscriptions API - Phase 4 IMPLEMENTED
// ============================================

app.post("/api/subscribe", postSubscription);
app.get("/api/subscriptions", getSubscriptions);
app.get("/api/subscriptions/:agent_id", getAgentSubscriptions);
app.delete("/api/subscriptions/:id", deleteSubscription);
app.post("/api/unsubscribe", postUnsubscribe);

// ============================================
// Blocking API - Phase 4 IMPLEMENTED
// ============================================

app.post("/api/blocking", postBlocking);
app.get("/api/blocking/check", checkBlocking);
app.get("/api/blocking/:agent_id", getBlocking);
app.delete("/api/blocking/:blocked_id", deleteBlocking);
app.post("/api/unblock", postUnblock);

// ============================================
// Cleanup Stats API - Phase 4 IMPLEMENTED
// ============================================

app.get("/api/cleanup/stats", async (c) => {
  try {
    const lastCleanup = getLastCleanupStats();
    const messageStats = await getMessageStats();

    return c.json({
      last_cleanup: lastCleanup,
      messages: messageStats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[API] GET /api/cleanup/stats error:", error);
    return c.json(
      {
        error: "Failed to get cleanup stats",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
});

// ============================================
// Tools Summary API - Phase 7 IMPLEMENTED
// ============================================

app.get("/stats/tools-summary", getToolsSummary);

// ============================================
// Auth Token API - Phase 8 IMPLEMENTED
// ============================================

/**
 * POST /api/auth/token - Generate a WebSocket auth token for an agent
 * Body: { agent_id: string, session_id?: string }
 * Returns: { token: string, expires_in: number }
 * Rate limited: 10 requests per 15 minutes per IP
 */
app.post("/api/auth/token", rateLimit(rateLimitPresets.auth), async (c) => {
  try {
    const body = await c.req.json() as { agent_id: string; session_id?: string };
    
    // Validate agent_id is provided
    if (!body.agent_id) {
      return c.json({ error: "Missing agent_id" }, 400);
    }
    
    // Validate agent_id format using shared validation
    if (!isValidAgentId(body.agent_id)) {
      return c.json({ 
        error: "Invalid agent_id format. Must be alphanumeric with hyphens/underscores, max 64 characters" 
      }, 400);
    }
    
    // Validate session_id format if provided using shared validation
    if (body.session_id && !isValidSessionId(body.session_id)) {
      return c.json({ 
        error: "Invalid session_id format. Must be alphanumeric with hyphens/underscores, max 128 characters" 
      }, 400);
    }
    
    try {
      const token = generateToken(body.agent_id, body.session_id);
      return c.json({ token, expires_in: 3600 });
    } catch (validationError) {
      // Log detailed error server-side, return generic message to client
      console.error("[API] Token generation validation error:", validationError);
      return c.json({ 
        error: "Invalid request parameters" 
      }, 400);
    }
  } catch (error) {
    // Log full error server-side
    console.error("[API] POST /api/auth/token error:", error);
    // Return generic error to client to avoid information disclosure
    return c.json({ 
      error: "Failed to generate token"
    }, 500);
  }
});

// ============================================
// Token Tracking API - Phase 9 (DCM v3.0)
// ============================================

// POST /api/tokens/track - Record token consumption (fire-and-forget, <5ms)
app.post("/api/tokens/track", trackTokens);

// GET /api/capacity/:agent_id - Get capacity status + prediction
app.get("/api/capacity/:agent_id", getCapacity);

// POST /api/capacity/:agent_id/reset - Reset after compact
app.post("/api/capacity/:agent_id/reset", resetCapacity);

// ============================================
// Agent Registry API - Phase 9 (DCM v3.0)
// ============================================

// GET /api/registry - List all registered agents
app.get("/api/registry", getRegistry);

// POST /api/registry/import - Bulk import agents
app.post("/api/registry/import", postRegistryImport);

// POST /api/registry/enrich-context - Generate enriched context for agent
app.post("/api/registry/enrich-context", postRegistryEnrichContext);

// GET /api/registry/:agent_type - Get one agent scope
app.get("/api/registry/:agent_type", getRegistryAgent);

// PUT /api/registry/:agent_type - Upsert agent scope
app.put("/api/registry/:agent_type", putRegistryAgent);

// ============================================
// Orchestration API - Phase 9 (DCM v3.0)
// ============================================

// POST /api/orchestration/batch-submit - Submit batch of tasks
app.post("/api/orchestration/batch-submit", postBatchSubmit);

// POST /api/orchestration/batch/:id/complete - Complete batch + generate synthesis
app.post("/api/orchestration/batch/:id/complete", postBatchComplete);

// GET /api/orchestration/batch/:id - Get batch status + subtasks
app.get("/api/orchestration/batch/:id", getBatch);

// GET /api/orchestration/synthesis/:id - Get synthesis only (token-optimized)
app.get("/api/orchestration/synthesis/:id", getSynthesis);

// GET /api/orchestration/conflicts/:id - Analyze conflicts
app.get("/api/orchestration/conflicts/:id", getConflicts);

// ============================================
// Wave Management API - Phase 9 (DCM v3.0)
// ============================================

// POST /api/waves/:session_id/create - Create a new wave
app.post("/api/waves/:session_id/create", postWaveCreate);

// POST /api/waves/:session_id/start - Start a specific wave
app.post("/api/waves/:session_id/start", postWaveStart);

// POST /api/waves/:session_id/transition - Force transition to next wave
app.post("/api/waves/:session_id/transition", postWaveTransition);

// GET /api/waves/:session_id/current - Current active wave
app.get("/api/waves/:session_id/current", getWaveCurrent);

// GET /api/waves/:session_id/history - All waves for session
app.get("/api/waves/:session_id/history", getWaveHistoryHandler);

// ============================================
// Server Startup
// ============================================

async function startServer() {
  console.log("[Context Manager] Starting...");
  console.log(`[Context Manager] Config: API port ${config.server.port}, WS port ${config.websocket.port}`);

  // Test database connection
  const connected = await testConnection();
  if (!connected) {
    console.error("[Context Manager] Failed to connect to database. Exiting.");
    process.exit(1);
  }
  console.log("[Context Manager] Database connected");

  // Start message cleanup interval (every 60 seconds)
  startCleanupInterval(60000);
  console.log("[Context Manager] Message cleanup started");

  // Start HTTP server with Bun
  const server = Bun.serve({
    hostname: config.server.host,
    port: config.server.port,
    fetch: app.fetch,
    // WebSocket support (Phase 8)
    websocket: {
      open(_ws) {
        console.log("[WS] Client connected");
      },
      message(_ws, _message) {
        // WebSocket handling delegated to dedicated websocket-server.ts (port 3849)
      },
      close(_ws) {
        console.log("[WS] Client disconnected");
      },
    },
  });

  console.log(`[Context Manager] HTTP server listening on http://${config.server.host}:${config.server.port}`);

  // Setup graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`[Context Manager] Received ${signal}, shutting down gracefully...`);
    server.stop();
    await closeDb();
    console.log("[Context Manager] Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Healthcheck interval
  setInterval(async () => {
    const health = await healthCheck();
    if (!health.healthy) {
      console.warn(`[Context Manager] Healthcheck failed: ${health.error}`);
    }
  }, config.app.healthcheckIntervalMs);

  return server;
}

// Start the server
startServer().catch((error) => {
  console.error("[Context Manager] Fatal error:", error);
  process.exit(1);
});

export { app, startServer };
