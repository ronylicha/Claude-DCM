/**
 * Bridge between Database Events and WebSocket
 * Uses PostgreSQL LISTEN/NOTIFY for real-time event delivery
 * @module websocket/bridge
 */

import { getDb } from "../db/client";
import { broadcast } from "./handlers";
import type { MetricSnapshot, EventType } from "./types";

// ============================================
// PostgreSQL LISTEN/NOTIFY Bridge
// ============================================

let metricsInterval: ReturnType<typeof setInterval> | null = null;
let listenSubscription: { unlisten: () => Promise<void> } | null = null;

/**
 * Start listening to PostgreSQL NOTIFY events on the dcm_events channel
 * Uses a dedicated connection as required by PostgreSQL for LISTEN
 */
async function startListening(): Promise<void> {
  const sql = getDb();
  const subscription = await sql.listen("dcm_events", (payload: string) => {
    try {
      const { channel, event, data } = JSON.parse(payload);
      broadcast(channel, event as EventType, data);
      // Also broadcast to global if not already global
      if (channel !== "global") {
        broadcast("global", event as EventType, data);
      }
    } catch (error) {
      console.error("[Bridge] Failed to parse NOTIFY payload:", error);
    }
  });
  listenSubscription = subscription;
  console.log("[Bridge] Listening for dcm_events via PostgreSQL NOTIFY");
}

/**
 * Start the database bridge
 * Replaces the old 500ms polling mechanism with PostgreSQL LISTEN/NOTIFY
 */
export function startDatabaseBridge(): void {
  console.log("[WS Bridge] Starting database bridge (LISTEN/NOTIFY mode)...");

  startListening()
    .then(() => {
      // Broadcast metrics every 5 seconds (metrics don't come from NOTIFY)
      metricsInterval = setInterval(broadcastMetrics, 5000);

      console.log("[WS Bridge] Database bridge started (LISTEN/NOTIFY active)");
    })
    .catch((error) => {
      console.error("[WS Bridge] Failed to start LISTEN/NOTIFY:", error);
    });
}

/**
 * Stop the database bridge
 */
export async function stopDatabaseBridge(): Promise<void> {
  if (listenSubscription) {
    try {
      await listenSubscription.unlisten();
      listenSubscription = null;
      console.log("[WS Bridge] Stopped listening for dcm_events");
    } catch (error) {
      console.error("[WS Bridge] Error stopping LISTEN:", error);
    }
  }
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
  }
  console.log("[WS Bridge] Database bridge stopped");
}

// ============================================
// Metrics Broadcasting
// ============================================

async function broadcastMetrics(): Promise<void> {
  try {
    const metrics = await getMetricSnapshot();
    broadcast("metrics", "metric.update", metrics);
  } catch (error) {
    console.error("[WS Bridge] Failed to broadcast metrics:", error);
  }
}

async function getMetricSnapshot(): Promise<MetricSnapshot> {
  const sql = getDb();

  // Get counts in parallel
  const [
    activeSessionsResult,
    activeAgentsResult,
    taskStatsResult,
    messageStatsResult,
    actionsStatsResult,
  ] = await Promise.all([
    // Active sessions (requests with status 'in_progress')
    sql`SELECT COUNT(*) as count FROM requests WHERE status = 'in_progress'`,

    // Active agents (subtasks with status 'running')
    sql`SELECT COUNT(DISTINCT agent_id) as count FROM subtasks WHERE status = 'running' AND agent_id IS NOT NULL`,

    // Task stats
    sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '1 hour') as completed_last_hour,
        COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000) FILTER (WHERE completed_at IS NOT NULL), 0) as avg_duration_ms
      FROM task_lists
    `,

    // Message stats
    sql`SELECT COUNT(*) as count FROM agent_messages WHERE created_at > NOW() - INTERVAL '1 hour'`,

    // Actions per minute (last 5 minutes average)
    sql`
      SELECT
        COALESCE(COUNT(*)::float / 5, 0) as actions_per_minute
      FROM actions
      WHERE created_at > NOW() - INTERVAL '5 minutes'
    `,
  ]);

  return {
    active_sessions: Number(activeSessionsResult[0]?.count ?? 0),
    active_agents: Number(activeAgentsResult[0]?.count ?? 0),
    pending_tasks: Number(taskStatsResult[0]?.pending ?? 0),
    running_tasks: Number(taskStatsResult[0]?.running ?? 0),
    completed_tasks_last_hour: Number(taskStatsResult[0]?.completed_last_hour ?? 0),
    messages_last_hour: Number(messageStatsResult[0]?.count ?? 0),
    actions_per_minute: Number(actionsStatsResult[0]?.actions_per_minute ?? 0),
    avg_task_duration_ms: Number(taskStatsResult[0]?.avg_duration_ms ?? 0),
    timestamp: Date.now(),
  };
}

// ============================================
// Manual Event Publishing (kept for backward compatibility)
// ============================================

/**
 * Publish an event from the API layer
 * Used by API handlers to broadcast events immediately
 */
export function publishEvent(
  channel: string,
  event: EventType,
  data: unknown
): void {
  broadcast(channel, event, data);
}

/**
 * Publish a task event
 */
export function publishTaskEvent(
  event: "task.created" | "task.updated" | "task.completed" | "task.failed",
  taskId: string,
  data: unknown,
  sessionId?: string
): void {
  broadcast("global", event, { task_id: taskId, ...data as object });
  if (sessionId) {
    broadcast(`sessions/${sessionId}`, event, { task_id: taskId, ...data as object });
  }
}

/**
 * Publish a subtask event
 */
export function publishSubtaskEvent(
  event: "subtask.created" | "subtask.updated" | "subtask.completed" | "subtask.failed",
  subtaskId: string,
  data: unknown,
  agentId?: string,
  sessionId?: string
): void {
  const eventData = { subtask_id: subtaskId, ...data as object };
  broadcast("global", event, eventData);

  if (agentId) {
    broadcast(`agents/${agentId}`, event, eventData);
  }
  if (sessionId) {
    broadcast(`sessions/${sessionId}`, event, eventData);
  }
}

/**
 * Publish a message event
 */
export function publishMessageEvent(
  event: "message.new" | "message.read" | "message.expired",
  messageId: number,
  data: unknown,
  fromAgent: string,
  toAgent: string
): void {
  const eventData = { message_id: messageId, ...data as object };
  broadcast("global", event, eventData);
  broadcast(`agents/${fromAgent}`, event, eventData);
  if (toAgent !== fromAgent) {
    broadcast(`agents/${toAgent}`, event, eventData);
  }
}
