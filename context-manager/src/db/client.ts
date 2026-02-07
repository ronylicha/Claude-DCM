/**
 * PostgreSQL Database Client using postgres.js
 * @module db/client
 */

import postgres from "postgres";
import { config, getDatabaseUrl } from "../config";

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
    console.log("[DB] Connection closed");
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
    return result[0]?.connected === 1;
  } catch (error) {
    console.error("[DB] Connection test failed:", error);
    return false;
  }
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
    projectCount: Number(projects?.count ?? 0),
    requestCount: Number(requests?.count ?? 0),
    actionCount: Number(actions?.count ?? 0),
    messageCount: Number(messages?.count ?? 0),
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

/**
 * Decompress data
 * @param data - Compressed buffer
 * @returns Decompressed string
 */
export function decompressData(data: Buffer): string {
  return new TextDecoder().decode(Bun.gunzipSync(data));
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
  try {
    const db = getDb();
    const payload = JSON.stringify({ channel, event, data, timestamp: Date.now() });
    // PostgreSQL NOTIFY has 8000 byte payload limit
    const truncated = payload.length > 7900
      ? JSON.stringify({ channel, event, data: { id: data.id, truncated: true }, timestamp: Date.now() })
      : payload;
    await db.notify('dcm_events', truncated);
  } catch (error) {
    console.error("[DB] Failed to publish event:", error);
  }
}
