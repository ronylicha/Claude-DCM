/**
 * Distributed Context Manager - Main Server
 * HTTP API using Hono + WebSocket support via Bun
 * @module server
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { config, validateConfig } from "./config";
import { createLogger } from "./lib/logger";
import { getDb, closeDb, testConnection, healthCheck, getDbStats } from "./db/client";
import { postAction, getActions, getActionsHourly, deleteAction, deleteActionsBySession } from "./api/actions";
import { suggestRouting, getRoutingStats, postRoutingFeedback } from "./api/routing";
import { postProject, getProjects, getProjectById, getProjectByPath, deleteProject } from "./api/projects";
import { postRequest, getRequests, getRequestById, patchRequest, deleteRequest } from "./api/requests";
import { postTask, getTasks, getTaskById, patchTask, deleteTask } from "./api/tasks";
import { postSubtask, getSubtasks, getSubtaskById, patchSubtask, deleteSubtask, closeSessionSubtasks } from "./api/subtasks";
// Phase 4 - Inter-agent communication
import { postMessage, getMessages, getAllMessages } from "./api/messages";
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
// Dashboard, Hierarchy, and Agent Contexts APIs
import { getDashboardKpis } from "./api/dashboard";
import { getHierarchy, getActiveSessions } from "./api/hierarchy";
import { getAgentContexts, getAgentContextsStats } from "./api/agent-contexts";
// Phase 6 - Sessions Management
import { postSession, getSessions, getSessionById, patchSession, getSessionsStats, deleteSession } from "./api/sessions";
// Phase 7 - Tools Summary
import { getToolsSummary } from "./api/tools-summary";
// Phase 8 - WebSocket Auth
import { generateToken, isValidAgentId, isValidSessionId } from "./websocket/auth";
// Rate limiting
import { rateLimit, rateLimitPresets } from "./middleware/rate-limit";
// Phase 9 - DCM v3.0 Proactive Triage Station
import { trackTokens, getCapacity, resetCapacity, getContextHealth } from "./api/tokens";
import { getRegistry, getRegistryAgent, putRegistryAgent, postRegistryImport, postRegistryEnrichContext } from "./api/registry";
import { getCatalog } from "./api/catalog";
import { postBatchSubmit, getBatch, getSynthesis, getConflicts, postBatchComplete } from "./api/orchestration";
import { postCraftPrompt, postDecompose } from "./api/orchestration-planner";
import { getWaveCurrent, getWaveHistoryHandler, postWaveTransition, postWaveCreate, postWaveStart } from "./api/waves";

// Initialize logger after imports
const log = createLogger("Server");

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
      log.warn("Rejected empty origin");
      return null;
    }
    
    // Check against allowed origins
    if (allowedOrigins.includes(origin) || allowedOrigins.includes("*")) {
      return origin;
    }
    
    // In development, allow localhost variations but log warning
    if (process.env["NODE_ENV"] !== "production") {
      if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/)) {
        log.warn(`Allowing origin ${origin} in development mode`);
        return origin;
      }
    }
    
    log.warn(`Rejected origin: ${origin}`);
    return null;  // Properly reject the origin
  },
  credentials: true,
};

app.use("*", cors(corsConfig));
app.use("*", logger());

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
      phase1: "active",
      phase2: "active",
      phase3: "active",
      phase4: "active",
      phase5: "active",
      phase6: "active",
      phase7: "active",
      phase8: "active",
      phase9: "active",
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

app.get("/api/dashboard/kpis", getDashboardKpis);

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
app.get("/api/hierarchy/:project_id", getHierarchy);

/**
 * GET /api/active-sessions - List active sessions using v_active_agents view
 */
app.get("/api/active-sessions", getActiveSessions);

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
app.get("/api/agent-contexts", getAgentContexts);

// GET /api/agent-contexts/stats - Context KPIs
app.get("/api/agent-contexts/stats", getAgentContextsStats);

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
app.get("/api/messages", getAllMessages);
app.get("/api/messages/all", getAllMessages);
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
    log.error("GET /api/cleanup/stats error:", error);
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
      log.error("Token generation validation error:", validationError);
      return c.json({
        error: "Invalid request parameters"
      }, 400);
    }
  } catch (error) {
    // Log full error server-side
    log.error("POST /api/auth/token error:", error);
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

// GET /api/context/health/:agent_id - Combined health + capacity + recommendation
app.get("/api/context/health/:agent_id", getContextHealth);

// ============================================
// Agent Registry API - Phase 9 (DCM v3.0)
// ============================================

// GET /api/registry - List all registered agents
app.get("/api/registry", getRegistry);

// POST /api/registry/import - Bulk import agents
app.post("/api/registry/import", postRegistryImport);

// POST /api/registry/enrich-context - Generate enriched context for agent
app.post("/api/registry/enrich-context", postRegistryEnrichContext);

// GET /api/registry/catalog - Static catalog of all known agents, skills, and commands
app.get("/api/registry/catalog", getCatalog);

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

// POST /api/orchestration/craft-prompt - Craft scoped prompt for subagent
app.post("/api/orchestration/craft-prompt", postCraftPrompt);

// POST /api/orchestration/decompose - Decompose task into subtasks
app.post("/api/orchestration/decompose", postDecompose);

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
  log.info("Starting...");
  log.info(`Config: API port ${config.server.port}, WS port ${config.websocket.port}`);

  // Test database connection
  const connected = await testConnection();
  if (!connected) {
    log.error("Failed to connect to database. Exiting.");
    process.exit(1);
  }
  log.info("Database connected");

  // Start message cleanup interval (every 60 seconds)
  startCleanupInterval(60000);
  log.info("Message cleanup started");

  // Start HTTP server with Bun
  const server = Bun.serve({
    hostname: config.server.host,
    port: config.server.port,
    fetch: app.fetch,
    // WebSocket support (Phase 8)
    websocket: {
      open(_ws) {
        log.info("Client connected");
      },
      message(_ws, _message) {
        // WebSocket handling delegated to dedicated websocket-server.ts (port 3849)
      },
      close(_ws) {
        log.info("Client disconnected");
      },
    },
  });

  log.info(`HTTP server listening on http://${config.server.host}:${config.server.port}`);

  // Setup graceful shutdown
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down gracefully...`);
    server.stop();
    await closeDb();
    log.info("Shutdown complete");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Healthcheck interval
  setInterval(async () => {
    const health = await healthCheck();
    if (!health.healthy) {
      log.warn(`Healthcheck failed: ${health.error}`);
    }
  }, config.app.healthcheckIntervalMs);

  return server;
}

// Start the server
startServer().catch((error) => {
  log.error("Fatal error:", error);
  process.exit(1);
});

export { app, startServer };
