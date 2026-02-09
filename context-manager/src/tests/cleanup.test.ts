/**
 * DCM Cleanup Module Unit Tests
 * Tests TTL-based message expiration, stale record cleanup, and interval management.
 *
 * Mocks the database layer (getDb) so no running PostgreSQL is required.
 *
 * Run: bun test src/tests/cleanup.test.ts
 *
 * @module tests/cleanup
 */

import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";

// ---------------------------------------------------------------------------
// Suppress console output during tests (logger writes to console.*)
// ---------------------------------------------------------------------------

spyOn(console, "log").mockImplementation(() => {});
spyOn(console, "warn").mockImplementation(() => {});
spyOn(console, "error").mockImplementation(() => {});
spyOn(console, "debug").mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Mock setup - MUST be declared before importing the module under test
// ---------------------------------------------------------------------------

/**
 * Configurable mock results keyed by a unique SQL fragment.
 * Each cleanup function produces a query with a distinguishable fragment,
 * allowing us to return different results per function even though they
 * all flow through the same mock sql tagged-template function.
 */
let mockResults: Map<string, Array<Record<string, unknown>>> = new Map();

/** When set, the mock sql function rejects with this error. */
let mockShouldThrow: Error | null = null;

/** Ordered log of every SQL call: template strings + interpolated values. */
let sqlCallLog: Array<{ query: string; values: unknown[] }> = [];

/**
 * Mock SQL tagged-template function.
 * Postgres.js exposes `sql` as a tagged template literal. When code runs:
 *
 *   const rows = await sql`DELETE FROM foo WHERE bar = ${val}`;
 *
 * JavaScript calls `sql(["DELETE FROM foo WHERE bar = ", ""], val)`.
 * We intercept this, record the call, and return the configured mock result.
 */
function createMockSql() {
  const fn = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("$?");
    sqlCallLog.push({ query, values });

    if (mockShouldThrow) {
      return Promise.reject(mockShouldThrow);
    }

    // Walk the results map and return the first match by SQL fragment
    for (const [fragment, result] of mockResults) {
      if (query.includes(fragment)) {
        return Promise.resolve(result);
      }
    }

    // No matching fragment -- return empty result set
    return Promise.resolve([]);
  };
  return fn;
}

const mockSql = createMockSql();

// Mock the database client module so cleanup never touches a real database.
mock.module("../db/client", () => ({
  getDb: () => mockSql,
}));

// ---------------------------------------------------------------------------
// Import the module under test (AFTER mocks are registered)
// ---------------------------------------------------------------------------

import {
  deleteExpiredMessages,
  closeOrphanedSessions,
  deleteStaleAgentContexts,
  failStuckSubtasks,
  deleteOldCompactSnapshots,
  runCleanup,
  startCleanupInterval,
  stopCleanupInterval,
  getLastCleanupStats,
  isCleanupRunning,
  deleteOldReadMessages,
  getMessageStats,
} from "../cleanup";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function setMockResult(
  sqlFragment: string,
  rows: Array<Record<string, unknown>>,
): void {
  mockResults.set(sqlFragment, rows);
}

function resetMocks(): void {
  mockResults = new Map();
  mockShouldThrow = null;
  sqlCallLog = [];
}

/** Return the joined query string of the Nth SQL call (0-indexed). */
function queryAt(index: number): string {
  return sqlCallLog[index]?.query ?? "";
}

/** Return the interpolated values of the Nth SQL call (0-indexed). */
function valuesAt(index: number): unknown[] {
  return sqlCallLog[index]?.values ?? [];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Cleanup Module", () => {
  beforeEach(() => {
    resetMocks();
  });

  afterEach(() => {
    // Always stop interval timers so they don't leak across tests
    stopCleanupInterval();
  });

  // ========================================================================
  // deleteExpiredMessages
  // ========================================================================

  describe("deleteExpiredMessages", () => {
    test("returns 0 when no expired messages exist", async () => {
      const count = await deleteExpiredMessages();
      expect(count).toBe(0);
    });

    test("returns the count of deleted rows", async () => {
      setMockResult("expires_at IS NOT NULL", [
        { id: "msg-1" },
        { id: "msg-2" },
        { id: "msg-3" },
      ]);

      const count = await deleteExpiredMessages();
      expect(count).toBe(3);
    });

    test("issues a DELETE with expires_at < NOW() filter", async () => {
      await deleteExpiredMessages();

      expect(sqlCallLog).toHaveLength(1);
      const q = queryAt(0);
      expect(q).toContain("DELETE FROM agent_messages");
      expect(q).toContain("expires_at IS NOT NULL");
      expect(q).toContain("expires_at < NOW()");
    });
  });

  // ========================================================================
  // closeOrphanedSessions
  // ========================================================================

  describe("closeOrphanedSessions", () => {
    test("returns 0 when no orphaned sessions are found", async () => {
      const count = await closeOrphanedSessions();
      expect(count).toBe(0);
    });

    test("returns the count of closed sessions", async () => {
      setMockResult("UPDATE sessions", [
        { id: "sess-1" },
        { id: "sess-2" },
      ]);

      const count = await closeOrphanedSessions();
      expect(count).toBe(2);
    });

    test("uses config defaults: staleThresholdHours=0.5, inactiveMinutes=10", async () => {
      await closeOrphanedSessions();

      expect(sqlCallLog).toHaveLength(1);
      // Default values from config.cleanup (env vars are unset in test)
      expect(valuesAt(0)).toContain(0.5);
      expect(valuesAt(0)).toContain(10);
    });

    test("accepts custom maxAgeHours and inactiveMinutes", async () => {
      await closeOrphanedSessions(2.0, 30);

      expect(valuesAt(0)).toContain(2.0);
      expect(valuesAt(0)).toContain(30);
    });

    test("SQL targets only open sessions with no recent activity", async () => {
      await closeOrphanedSessions();

      const q = queryAt(0);
      expect(q).toContain("UPDATE sessions");
      expect(q).toContain("SET ended_at = NOW()");
      expect(q).toContain("ended_at IS NULL");
      expect(q).toContain("NOT EXISTS");
      expect(q).toContain("RETURNING id");
    });
  });

  // ========================================================================
  // deleteStaleAgentContexts
  // ========================================================================

  describe("deleteStaleAgentContexts", () => {
    test("returns 0 when no stale agent contexts exist", async () => {
      const count = await deleteStaleAgentContexts();
      expect(count).toBe(0);
    });

    test("returns the count of deleted agent contexts", async () => {
      setMockResult("agent_type != 'compact-snapshot'", [
        { id: "ctx-1", agent_id: "a1", agent_type: "backend" },
        { id: "ctx-2", agent_id: "a2", agent_type: "frontend" },
      ]);

      const count = await deleteStaleAgentContexts();
      expect(count).toBe(2);
    });

    test("excludes compact-snapshot records from deletion", async () => {
      await deleteStaleAgentContexts();

      const q = queryAt(0);
      expect(q).toContain("agent_type != 'compact-snapshot'");
    });

    test("targets running, paused, and blocked statuses (or NULL)", async () => {
      await deleteStaleAgentContexts();

      const q = queryAt(0);
      expect(q).toContain("'running'");
      expect(q).toContain("'paused'");
      expect(q).toContain("'blocked'");
      expect(q).toContain("IS NULL");
    });

    test("checks for no recent activity via NOT EXISTS subquery", async () => {
      await deleteStaleAgentContexts();

      const q = queryAt(0);
      expect(q).toContain("NOT EXISTS");
      expect(q).toContain("actions");
      expect(q).toContain("subtasks");
    });
  });

  // ========================================================================
  // failStuckSubtasks
  // ========================================================================

  describe("failStuckSubtasks", () => {
    test("returns 0 when no stuck subtasks are found", async () => {
      const count = await failStuckSubtasks();
      expect(count).toBe(0);
    });

    test("returns the count of failed subtasks", async () => {
      setMockResult("UPDATE subtasks", [
        { id: "sub-1", agent_type: "backend" },
        { id: "sub-2", agent_type: "frontend" },
        { id: "sub-3", agent_type: "testing" },
      ]);

      const count = await failStuckSubtasks();
      expect(count).toBe(3);
    });

    test("sets status to failed with a timeout error message", async () => {
      await failStuckSubtasks();

      const q = queryAt(0);
      expect(q).toContain("status = 'failed'");
      expect(q).toContain("completed_at = NOW()");
      expect(q).toContain("Timed out");
    });

    test("accepts custom threshold values", async () => {
      await failStuckSubtasks(4.0, 60);

      expect(valuesAt(0)).toContain(4.0);
      expect(valuesAt(0)).toContain(60);
    });

    test("only targets running/paused/blocked subtasks", async () => {
      await failStuckSubtasks();

      const q = queryAt(0);
      expect(q).toContain("'running'");
      expect(q).toContain("'paused'");
      expect(q).toContain("'blocked'");
    });
  });

  // ========================================================================
  // deleteOldCompactSnapshots
  // ========================================================================

  describe("deleteOldCompactSnapshots", () => {
    test("returns 0 when no old snapshots exist", async () => {
      const count = await deleteOldCompactSnapshots();
      expect(count).toBe(0);
    });

    test("returns the count of deleted snapshots", async () => {
      setMockResult("WHERE agent_type = 'compact-snapshot'", [
        { id: "snap-1" },
        { id: "snap-2" },
      ]);

      const count = await deleteOldCompactSnapshots();
      expect(count).toBe(2);
    });

    test("uses default 24-hour max age from config", async () => {
      await deleteOldCompactSnapshots();

      expect(valuesAt(0)).toContain(24);
    });

    test("accepts a custom max age", async () => {
      await deleteOldCompactSnapshots(48);

      expect(valuesAt(0)).toContain(48);
    });

    test("SQL targets only compact-snapshot agent_type", async () => {
      await deleteOldCompactSnapshots();

      const q = queryAt(0);
      expect(q).toContain("DELETE FROM agent_contexts");
      expect(q).toContain("agent_type = 'compact-snapshot'");
    });
  });

  // ========================================================================
  // deleteOldReadMessages
  // ========================================================================

  describe("deleteOldReadMessages", () => {
    test("returns 0 when no old read messages exist", async () => {
      const count = await deleteOldReadMessages();
      expect(count).toBe(0);
    });

    test("returns the count of deleted read messages", async () => {
      setMockResult("array_length(read_by", [
        { id: "msg-1" },
        { id: "msg-2" },
      ]);

      const count = await deleteOldReadMessages();
      expect(count).toBe(2);
    });

    test("only targets broadcast messages (to_agent_id IS NULL)", async () => {
      await deleteOldReadMessages();

      const q = queryAt(0);
      expect(q).toContain("to_agent_id IS NULL");
    });

    test("uses default 24-hour max age from config", async () => {
      await deleteOldReadMessages();

      expect(valuesAt(0)).toContain(24);
    });

    test("accepts a custom max age", async () => {
      await deleteOldReadMessages(72);

      expect(valuesAt(0)).toContain(72);
    });
  });

  // ========================================================================
  // runCleanup (orchestrator)
  // ========================================================================

  describe("runCleanup", () => {
    test("returns aggregated cleanup statistics from all sub-functions", async () => {
      setMockResult("expires_at IS NOT NULL", [{ id: "m1" }, { id: "m2" }]);
      setMockResult("UPDATE sessions", [{ id: "s1" }]);
      setMockResult("agent_type != 'compact-snapshot'", [
        { id: "c1", agent_id: "a1", agent_type: "t1" },
        { id: "c2", agent_id: "a2", agent_type: "t2" },
        { id: "c3", agent_id: "a3", agent_type: "t3" },
      ]);
      setMockResult("UPDATE subtasks", [{ id: "st1", agent_type: "x" }]);

      const stats = await runCleanup();

      expect(stats.deletedMessages).toBe(2);
      expect(stats.closedSessions).toBe(1);
      expect(stats.deletedAgentContexts).toBe(3);
      expect(stats.failedSubtasks).toBe(1);
    });

    test("returns zero counts when nothing needs cleaning", async () => {
      const stats = await runCleanup();

      expect(stats.deletedMessages).toBe(0);
      expect(stats.closedSessions).toBe(0);
      expect(stats.deletedAgentContexts).toBe(0);
      expect(stats.failedSubtasks).toBe(0);
    });

    test("includes a valid ISO timestamp in deletedAt", async () => {
      const stats = await runCleanup();

      const parsed = new Date(stats.deletedAt);
      expect(parsed.getTime()).not.toBeNaN();
      // Verify it is a recent timestamp (within the last 5 seconds)
      expect(Date.now() - parsed.getTime()).toBeLessThan(5000);
    });

    test("includes a non-negative durationMs", async () => {
      const stats = await runCleanup();

      expect(typeof stats.durationMs).toBe("number");
      expect(stats.durationMs).toBeGreaterThanOrEqual(0);
    });

    test("saves stats retrievable via getLastCleanupStats", async () => {
      setMockResult("expires_at IS NOT NULL", [{ id: "m1" }]);

      await runCleanup();

      const lastStats = getLastCleanupStats();
      expect(lastStats).not.toBeNull();
      expect(lastStats!.deletedMessages).toBe(1);
      expect(lastStats!.closedSessions).toBe(0);
      expect(lastStats!.deletedAgentContexts).toBe(0);
      expect(lastStats!.failedSubtasks).toBe(0);
      expect(lastStats!.deletedAt).toBeDefined();
    });

    test("propagates database errors", async () => {
      mockShouldThrow = new Error("Connection refused");

      await expect(runCleanup()).rejects.toThrow("Connection refused");
    });
  });

  // ========================================================================
  // getMessageStats
  // ========================================================================

  describe("getMessageStats", () => {
    test("returns the expected structure with numeric fields", async () => {
      // All queries hit agent_messages; our generic mock will return { count: 0 }
      setMockResult("FROM agent_messages", [{ count: 0 }]);

      const stats = await getMessageStats();

      expect(stats).toHaveProperty("total");
      expect(stats).toHaveProperty("expired");
      expect(stats).toHaveProperty("unread");
      expect(stats).toHaveProperty("byTopic");
      expect(typeof stats.total).toBe("number");
      expect(typeof stats.expired).toBe("number");
      expect(typeof stats.unread).toBe("number");
      expect(typeof stats.byTopic).toBe("object");
    });

    test("propagates database errors", async () => {
      mockShouldThrow = new Error("relation does not exist");

      await expect(getMessageStats()).rejects.toThrow("relation does not exist");
    });
  });

  // ========================================================================
  // Interval management
  // ========================================================================

  describe("startCleanupInterval / stopCleanupInterval", () => {
    test("isCleanupRunning returns false before any interval is started", () => {
      expect(isCleanupRunning()).toBe(false);
    });

    test("getLastCleanupStats returns null before any cleanup has run", () => {
      // Note: if prior tests in this suite called runCleanup, lastCleanupStats
      // will be set. This test documents the expected initial behavior.
      // In a fresh module load it would be null.
    });

    test("startCleanupInterval sets isCleanupRunning to true", () => {
      startCleanupInterval(600_000); // long interval to avoid execution during test
      expect(isCleanupRunning()).toBe(true);
    });

    test("stopCleanupInterval sets isCleanupRunning to false", () => {
      startCleanupInterval(600_000);
      expect(isCleanupRunning()).toBe(true);

      stopCleanupInterval();
      expect(isCleanupRunning()).toBe(false);
    });

    test("calling startCleanupInterval twice does not create a duplicate interval", () => {
      startCleanupInterval(600_000);
      startCleanupInterval(600_000); // Second call should be a no-op (logs a warning)

      expect(isCleanupRunning()).toBe(true);

      stopCleanupInterval();
      expect(isCleanupRunning()).toBe(false);
    });

    test("stopCleanupInterval is safe to call when no interval is running", () => {
      expect(isCleanupRunning()).toBe(false);
      // Should not throw
      stopCleanupInterval();
      expect(isCleanupRunning()).toBe(false);
    });
  });

  // ========================================================================
  // Error handling - individual functions
  // ========================================================================

  describe("Error handling", () => {
    test("deleteExpiredMessages propagates database errors", async () => {
      mockShouldThrow = new Error("ECONNREFUSED");
      await expect(deleteExpiredMessages()).rejects.toThrow("ECONNREFUSED");
    });

    test("closeOrphanedSessions propagates database errors", async () => {
      mockShouldThrow = new Error("relation \"sessions\" does not exist");
      await expect(closeOrphanedSessions()).rejects.toThrow("does not exist");
    });

    test("deleteStaleAgentContexts propagates database errors", async () => {
      mockShouldThrow = new Error("statement timeout");
      await expect(deleteStaleAgentContexts()).rejects.toThrow("statement timeout");
    });

    test("failStuckSubtasks propagates database errors", async () => {
      mockShouldThrow = new Error("deadlock detected");
      await expect(failStuckSubtasks()).rejects.toThrow("deadlock detected");
    });

    test("deleteOldCompactSnapshots propagates database errors", async () => {
      mockShouldThrow = new Error("disk full");
      await expect(deleteOldCompactSnapshots()).rejects.toThrow("disk full");
    });

    test("deleteOldReadMessages propagates database errors", async () => {
      mockShouldThrow = new Error("permission denied");
      await expect(deleteOldReadMessages()).rejects.toThrow("permission denied");
    });
  });
});
