/**
 * Cleanup Module - TTL-based message expiration + stale record cleanup
 * Phase 4 - Automatic cleanup of expired messages, orphaned agents/sessions
 * @module cleanup
 */

import { config } from "./config";
import { getDb } from "./db/client";
import { createLogger } from "./lib/logger";

const log = createLogger("Cleanup");

/** Cleanup statistics */
interface CleanupStats {
  deletedMessages: number;
  closedSessions: number;
  deletedAgentContexts: number;
  failedSubtasks: number;
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
 * Close orphaned sessions (ended_at IS NULL) that have no recent activity.
 * Only closes if: started > maxAgeHours ago AND no actions in last inactiveMinutes.
 * This avoids killing long-running but still-active sessions.
 * @param maxAgeHours - Minimum age in hours (default: 0.5)
 * @param inactiveMinutes - No activity for this many minutes (default: 10)
 * @returns Number of closed sessions
 */
export async function closeOrphanedSessions(maxAgeHours: number = config.cleanup.staleThresholdHours, inactiveMinutes: number = config.cleanup.inactiveMinutes): Promise<number> {
  const sql = getDb();

  const result = await sql`
    UPDATE sessions s
    SET ended_at = NOW()
    WHERE s.ended_at IS NULL
      AND s.started_at < NOW() - INTERVAL '1 hour' * ${maxAgeHours}
      AND NOT EXISTS (
        SELECT 1 FROM actions a
        JOIN subtasks st ON a.subtask_id = st.id
        JOIN task_lists tl ON st.task_list_id = tl.id
        JOIN requests r ON tl.request_id = r.id
        WHERE r.session_id = s.id
          AND a.created_at > NOW() - INTERVAL '1 minute' * ${inactiveMinutes}
      )
    RETURNING id
  `;

  if (result.length > 0) {
    log.info(`Closed ${result.length} orphaned sessions (older than ${maxAgeHours}h, inactive ${inactiveMinutes}min)`);
  }

  return result.length;
}

/**
 * Delete stale agent_contexts where role_context.status is still 'running'
 * but last_updated is older than maxAgeHours AND no recent activity.
 * @param maxAgeHours - Minimum age in hours (default: 0.5)
 * @param inactiveMinutes - No activity for this many minutes (default: 10)
 * @returns Number of deleted agent contexts
 */
export async function deleteStaleAgentContexts(maxAgeHours: number = config.cleanup.staleThresholdHours, inactiveMinutes: number = config.cleanup.inactiveMinutes): Promise<number> {
  const sql = getDb();

  const result = await sql`
    DELETE FROM agent_contexts ac
    WHERE (
      ac.role_context->>'status' IN ('running', 'paused', 'blocked')
      OR ac.role_context->>'status' IS NULL
    )
    AND ac.last_updated < NOW() - INTERVAL '1 hour' * ${maxAgeHours}
    AND ac.agent_type != 'compact-snapshot'
    AND NOT EXISTS (
      SELECT 1 FROM subtasks st
      JOIN actions a ON a.subtask_id = st.id
      WHERE st.agent_id = ac.agent_id
        AND st.status = 'running'
        AND a.created_at > NOW() - INTERVAL '1 minute' * ${inactiveMinutes}
    )
    RETURNING id, agent_id, agent_type
  `;

  if (result.length > 0) {
    log.info(`Deleted ${result.length} stale agent contexts (older than ${maxAgeHours}h, inactive ${inactiveMinutes}min)`);
  }

  return result.length;
}

/**
 * Mark stuck subtasks as failed, but only if they have no recent activity.
 * A subtask with recent actions is still alive even if started long ago.
 * @param maxAgeHours - Minimum age in hours (default: 0.5)
 * @param inactiveMinutes - No activity for this many minutes (default: 10)
 * @returns Number of failed subtasks
 */
export async function failStuckSubtasks(maxAgeHours: number = config.cleanup.staleThresholdHours, inactiveMinutes: number = config.cleanup.inactiveMinutes): Promise<number> {
  const sql = getDb();

  const result = await sql`
    UPDATE subtasks st
    SET
      status = 'failed',
      completed_at = NOW(),
      result = jsonb_build_object('error', 'Timed out: no completion event received')
    WHERE st.status IN ('running', 'paused', 'blocked')
      AND st.started_at < NOW() - INTERVAL '1 hour' * ${maxAgeHours}
      AND NOT EXISTS (
        SELECT 1 FROM actions a
        WHERE a.subtask_id = st.id
          AND a.created_at > NOW() - INTERVAL '1 minute' * ${inactiveMinutes}
      )
    RETURNING id, agent_type
  `;

  if (result.length > 0) {
    log.info(`Failed ${result.length} stuck subtasks (older than ${maxAgeHours}h, inactive ${inactiveMinutes}min)`);
  }

  return result.length;
}

/**
 * Delete old compact snapshots from agent_contexts
 * These are created by pre-compact-save but never used by context restoration
 * @param maxAgeHours - Maximum age in hours (default: 24)
 * @returns Number of deleted snapshots
 */
export async function deleteOldCompactSnapshots(maxAgeHours: number = config.cleanup.snapshotMaxAgeHours): Promise<number> {
  const sql = getDb();

  const result = await sql`
    DELETE FROM agent_contexts
    WHERE agent_type = 'compact-snapshot'
      AND last_updated < NOW() - INTERVAL '1 hour' * ${maxAgeHours}
    RETURNING id
  `;

  if (result.length > 0) {
    log.info(`Deleted ${result.length} old compact snapshots (older than ${maxAgeHours}h)`);
  }

  return result.length;
}

/**
 * Run cleanup and record statistics
 * @returns Cleanup statistics
 */
export async function runCleanup(): Promise<CleanupStats> {
  const startTime = performance.now();

  try {
    const [deletedMessages, closedSessions, deletedAgentContexts, failedSubtasks] =
      await Promise.all([
        deleteExpiredMessages(),
        closeOrphanedSessions(),  // 30min instead of 2h - sessions rarely last that long
        deleteStaleAgentContexts(),
        failStuckSubtasks(),
      ]);

    // Run less frequent cleanup (snapshots) only every ~10 runs
    // Use a simple modulo on the minute to approximate
    const minute = new Date().getMinutes();
    if (minute % 10 === 0) {
      await deleteOldCompactSnapshots();
    }

    const durationMs = Math.round(performance.now() - startTime);

    const stats: CleanupStats = {
      deletedMessages,
      closedSessions,
      deletedAgentContexts,
      failedSubtasks,
      deletedAt: new Date().toISOString(),
      durationMs,
    };

    lastCleanupStats = stats;

    const totalCleaned = deletedMessages + closedSessions + deletedAgentContexts + failedSubtasks;
    if (totalCleaned > 0) {
      log.info(
        `Cleaned ${totalCleaned} records in ${durationMs}ms ` +
        `(msgs:${deletedMessages} sessions:${closedSessions} agents:${deletedAgentContexts} subtasks:${failedSubtasks})`
      );
    }

    return stats;
  } catch (error) {
    log.error("Error during cleanup:", error);
    throw error;
  }
}

/**
 * Start the cleanup interval
 * @param intervalMs - Interval in milliseconds (default: 60000 = 1 minute)
 */
export function startCleanupInterval(intervalMs: number = config.cleanup.intervalMs): void {
  if (cleanupInterval) {
    log.warn("Cleanup interval already running");
    return;
  }

  // Run immediately on start
  runCleanup().catch((error) => {
    log.error("Initial cleanup failed:", error);
  });

  // Set up recurring cleanup
  cleanupInterval = setInterval(() => {
    runCleanup().catch((error) => {
      log.error("Scheduled cleanup failed:", error);
    });
  }, intervalMs);

  log.info(`Started cleanup interval (every ${intervalMs}ms)`);
}

/**
 * Stop the cleanup interval
 */
export function stopCleanupInterval(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    log.info("Stopped cleanup interval");
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
export async function deleteOldReadMessages(maxAgeHours: number = config.cleanup.readMessageMaxAgeHours): Promise<number> {
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
    log.info(`Deleted ${result.length} old read broadcast messages`);
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
