/**
 * Cleanup Module - TTL-based message expiration
 * Phase 4 - Automatic cleanup of expired messages
 * @module cleanup
 */

import { getDb } from "./db/client";

/** Cleanup statistics */
interface CleanupStats {
  deletedMessages: number;
  deletedAt: string;
  durationMs: number;
}

/** Cleanup state */
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let lastCleanupStats: CleanupStats | null = null;

/**
 * Delete expired messages from agent_messages table
 * @returns Number of deleted messages
 */
export async function deleteExpiredMessages(): Promise<number> {
  const sql = getDb();

  const result = await sql`
    DELETE FROM agent_messages
    WHERE expires_at IS NOT NULL AND expires_at < NOW()
    RETURNING id
  `;

  return result.length;
}

/**
 * Run cleanup and record statistics
 * @returns Cleanup statistics
 */
export async function runCleanup(): Promise<CleanupStats> {
  const startTime = performance.now();

  try {
    const deletedMessages = await deleteExpiredMessages();
    const durationMs = Math.round(performance.now() - startTime);

    const stats: CleanupStats = {
      deletedMessages,
      deletedAt: new Date().toISOString(),
      durationMs,
    };

    lastCleanupStats = stats;

    if (deletedMessages > 0) {
      console.log(
        `[Cleanup] Deleted ${deletedMessages} expired messages in ${durationMs}ms`
      );
    }

    return stats;
  } catch (error) {
    console.error("[Cleanup] Error during cleanup:", error);
    throw error;
  }
}

/**
 * Start the cleanup interval
 * @param intervalMs - Interval in milliseconds (default: 60000 = 1 minute)
 */
export function startCleanupInterval(intervalMs: number = 60000): void {
  if (cleanupInterval) {
    console.warn("[Cleanup] Cleanup interval already running");
    return;
  }

  // Run immediately on start
  runCleanup().catch((error) => {
    console.error("[Cleanup] Initial cleanup failed:", error);
  });

  // Set up recurring cleanup
  cleanupInterval = setInterval(() => {
    runCleanup().catch((error) => {
      console.error("[Cleanup] Scheduled cleanup failed:", error);
    });
  }, intervalMs);

  console.log(`[Cleanup] Started cleanup interval (every ${intervalMs}ms)`);
}

/**
 * Stop the cleanup interval
 */
export function stopCleanupInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    console.log("[Cleanup] Stopped cleanup interval");
  }
}

/**
 * Get the last cleanup statistics
 * @returns Last cleanup stats or null if never run
 */
export function getLastCleanupStats(): CleanupStats | null {
  return lastCleanupStats;
}

/**
 * Check if cleanup is running
 * @returns true if cleanup interval is active
 */
export function isCleanupRunning(): boolean {
  return cleanupInterval !== null;
}

/**
 * Cleanup old read messages (messages read by all subscribers)
 * More aggressive cleanup for fully-consumed messages
 * @param maxAgeHours - Maximum age in hours for read messages (default: 24)
 * @returns Number of deleted messages
 */
export async function deleteOldReadMessages(maxAgeHours: number = 24): Promise<number> {
  const sql = getDb();

  // Delete messages that:
  // 1. Have been read (read_by is not empty)
  // 2. Are older than maxAgeHours
  // 3. Are broadcast messages (to_agent_id IS NULL) - targeted messages keep longer
  const result = await sql`
    DELETE FROM agent_messages
    WHERE array_length(read_by, 1) > 0
      AND to_agent_id IS NULL
      AND created_at < NOW() - INTERVAL '1 hour' * ${maxAgeHours}
    RETURNING id
  `;

  if (result.length > 0) {
    console.log(`[Cleanup] Deleted ${result.length} old read broadcast messages`);
  }

  return result.length;
}

/**
 * Get message statistics for monitoring
 * @returns Message count statistics
 */
export async function getMessageStats(): Promise<{
  total: number;
  expired: number;
  unread: number;
  byTopic: Record<string, number>;
}> {
  const sql = getDb();

  const [totalResult] = await sql<[{ count: number }]>`
    SELECT COUNT(*) as count FROM agent_messages
  `;

  const [expiredResult] = await sql<[{ count: number }]>`
    SELECT COUNT(*) as count FROM agent_messages
    WHERE expires_at IS NOT NULL AND expires_at < NOW()
  `;

  const [unreadResult] = await sql<[{ count: number }]>`
    SELECT COUNT(*) as count FROM agent_messages
    WHERE array_length(read_by, 1) IS NULL OR array_length(read_by, 1) = 0
  `;

  const topicCounts = await sql<{ topic: string; count: number }[]>`
    SELECT topic, COUNT(*) as count
    FROM agent_messages
    WHERE topic IS NOT NULL
    GROUP BY topic
    ORDER BY count DESC
  `;

  const byTopic: Record<string, number> = {};
  for (const row of topicCounts) {
    byTopic[row.topic] = Number(row.count);
  }

  return {
    total: Number(totalResult.count),
    expired: Number(expiredResult.count),
    unread: Number(unreadResult.count),
    byTopic,
  };
}

export type { CleanupStats };
