/**
 * PostgreSQL Database Client using postgres.js
 * @module db/client
 */

import postgres from "postgres";
import { config, getDatabaseUrl } from "../config";
import { createLogger } from "../lib/logger";

const log = createLogger("DB");

/** Database connection instance */
let sql: postgres.Sql | null = null;

/**
 * Get or create the database connection
 * Uses postgres.js for reliable PostgreSQL connection
 */
export function getDb(): postgres.Sql {
  if (!sql) {
    sql = postgres(getDatabaseUrl(), {
      max: config.database.maxConnections,
      idle_timeout: 30,
      connect_timeout: 10,
      onnotice: () => {}, // Suppress notices
    });
  }
  return sql;
}

/**
 * Close the database connection gracefully
 */
export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = null;
    log.info("Connection closed");
  }
}

/**
 * Test database connectivity
 * @returns true if connection successful
 */
export async function testConnection(): Promise<boolean> {
  try {
    const db = getDb();
    const result = await db`SELECT 1 as connected`;
    return result[0]?.["connected"] === 1;
  } catch (error) {
    log.error("Connection test failed:", error);
    return false;
  }
}

/**
 * Test database connectivity with retries (for startup race conditions)
 * PostgreSQL may still be starting when systemd launches DCM services.
 * @param maxRetries - Number of retry attempts (default: 10)
 * @param delayMs - Base delay between retries in ms (default: 2000)
 * @returns true if connection successful within retry window
 */
export async function testConnectionWithRetry(maxRetries = 10, delayMs = 2000): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const connected = await testConnection();
    if (connected) return true;

    if (attempt < maxRetries) {
      const wait = Math.min(delayMs * attempt, 10000);
      log.info(`Database not ready, retrying in ${wait}ms (attempt ${attempt}/${maxRetries})...`);
      await new Promise(r => setTimeout(r, wait));
      // Reset connection pool so postgres.js reconnects
      if (sql) {
        await sql.end().catch(() => {});
        sql = null;
      }
    }
  }
  return false;
}

/**
 * Execute a health check query
 * @returns Health check result with timing
 */
export async function healthCheck(): Promise<{
  healthy: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = performance.now();
  try {
    const db = getDb();
    await db`SELECT 1`;
    return {
      healthy: true,
      latencyMs: Math.round(performance.now() - start),
    };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Math.round(performance.now() - start),
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get database statistics
 */
export async function getDbStats(): Promise<{
  projectCount: number;
  requestCount: number;
  actionCount: number;
  messageCount: number;
}> {
  const db = getDb();

  const [projects] = await db`SELECT COUNT(*) as count FROM projects`;
  const [requests] = await db`SELECT COUNT(*) as count FROM requests`;
  const [actions] = await db`SELECT COUNT(*) as count FROM actions`;
  const [messages] = await db`SELECT COUNT(*) as count FROM agent_messages`;

  return {
    projectCount: Number(projects?.["count"] ?? 0),
    requestCount: Number(requests?.["count"] ?? 0),
    actionCount: Number(actions?.["count"] ?? 0),
    messageCount: Number(messages?.["count"] ?? 0),
  };
}

/**
 * Compress data using Bun's native compression
 * @param data - String data to compress
 * @returns Compressed buffer
 */
export function compressData(data: string): Buffer {
  return Buffer.from(Bun.gzipSync(new TextEncoder().encode(data)));
}

// Export getDb as sql for convenience
export { getDb as sql };

/**
 * Publish a real-time event via PostgreSQL NOTIFY
 * @param channel - DCM channel (e.g., "global", "agents/backend-laravel")
 * @param event - Event type (e.g., "task.created", "message.new")
 * @param data - Event payload
 */
export async function publishEvent(channel: string, event: string, data: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const payload = JSON.stringify({ channel, event, data, timestamp: Date.now() });
  // PostgreSQL NOTIFY has 8000 byte payload limit
  const truncated = payload.length > 7900
    ? JSON.stringify({ channel, event, data: { id: data["id"], truncated: true }, timestamp: Date.now() })
    : payload;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await db.notify('dcm_events', truncated);
      return;
    } catch (error) {
      if (attempt === 0) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }
      log.error("Failed to publish event after retry:", error);
    }
  }
}

/**
 * Query active sessions with best capacity data (1 row per session).
 * Deduplicates agent_capacity: prefers statusline over estimated.
 * @param inactivityMinutes — include sessions with activity within this window
 */
export async function getActiveSessionsWithCapacity(inactivityMinutes = 15) {
  const db = getDb();
  return db.unsafe(`
    SELECT
      s.id as session_id,
      p.name as project_name,
      p.path as project_path,
      s.project_id,
      s.started_at,
      COALESCE(NULLIF(ac.model_id, ''), 'unknown') as model_id,
      COALESCE(ROUND((ac.current_usage::numeric / NULLIF(ac.max_capacity, 0) * 100), 1), 0) as used_percentage,
      COALESCE(ac.zone, 'green') as zone,
      COALESCE(ac.consumption_rate, 0) as consumption_rate,
      COALESCE(ac.current_usage, 0) as current_usage,
      COALESCE(ac.max_capacity, 200000) as max_capacity,
      ac.predicted_exhaustion_minutes,
      COALESCE(ac.source, 'estimated') as source,
      (SELECT COUNT(*) FROM subtasks st
       JOIN task_lists tl ON st.task_list_id = tl.id
       JOIN requests r ON tl.request_id = r.id
       WHERE r.session_id = s.id AND st.status = 'running') as active_agents
    FROM sessions s
    LEFT JOIN projects p ON s.project_id = p.id
    LEFT JOIN (
      SELECT DISTINCT ON (session_id)
        session_id, model_id, current_usage, max_capacity, zone,
        consumption_rate, predicted_exhaustion_minutes, source
      FROM agent_capacity
      ORDER BY session_id,
        CASE WHEN source = 'statusline' AND current_usage > 0 THEN 0 ELSE 1 END,
        current_usage DESC NULLS LAST,
        last_updated_at DESC NULLS LAST
    ) ac ON ac.session_id = s.id
    WHERE s.ended_at IS NULL
      OR EXISTS (SELECT 1 FROM actions a WHERE a.session_id = s.id AND a.created_at > NOW() - INTERVAL '${inactivityMinutes} minutes')
    ORDER BY s.started_at DESC
  `);
}
