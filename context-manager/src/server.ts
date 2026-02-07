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
import { postSubtask, getSubtasks, getSubtaskById, patchSubtask, deleteSubtask } from "./api/subtasks";
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
import { postCompactRestore, getCompactStatus } from "./api/compact";
import { getContext, postContextGenerate } from "./api/context";
// Phase 6 - Sessions Management
import { postSession, getSessions, getSessionById, patchSession, getSessionsStats, deleteSession } from "./api/sessions";
// Phase 7 - Tools Summary
import { getToolsSummary } from "./api/tools-summary";
// Phase 8 - WebSocket Auth
import { generateToken } from "./websocket/auth";

// Validate configuration at startup
validateConfig();

// Create Hono app
const app = new Hono();

// Middleware
app.use("*", cors());
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
    version: "1.8.0", // Phase 8 - WebSocket Auth & Delivery
    database: dbHealth,
    features: {
      phase1: "database",
      phase2: "routing",
      phase3: "hierarchy",
      phase4: "pubsub",
      phase5: "context",
      phase6: "sessions",
      phase7: "tools-summary",
      phase8: "websocket-auth", // NEW
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

// POST /api/compact/restore - Restore context after compact operation
// Body: { session_id, agent_id, agent_type?, compact_summary?, max_tokens? }
app.post("/api/compact/restore", postCompactRestore);

// GET /api/compact/status/:session_id - Check if session is compacted
app.get("/api/compact/status/:session_id", getCompactStatus);

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
app.get("/api/blocking/:agent_id", getBlocking);
app.delete("/api/blocking/:blocked_id", deleteBlocking);
app.post("/api/unblock", postUnblock);
app.get("/api/blocking/check", checkBlocking);

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
 */
app.post("/api/auth/token", async (c) => {
  try {
    const body = await c.req.json() as { agent_id: string; session_id?: string };
    if (!body.agent_id) {
      return c.json({ error: "Missing agent_id" }, 400);
    }
    const token = generateToken(body.agent_id, body.session_id);
    return c.json({ token, expires_in: 3600 });
  } catch (error) {
    return c.json({ error: "Failed to generate token" }, 500);
  }
});

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
