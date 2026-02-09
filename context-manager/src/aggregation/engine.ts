/**
 * Aggregation Engine - Combine agent results and detect conflicts
 * DCM v3.0 - Phase 3 Orchestration
 * @module aggregation/engine
 */

import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";
import { completeTask as completeWaveTask } from "../waves/manager";

const log = createLogger("AGGREGATION");

export interface Synthesis {
  summary: string;
  results: Array<{
    agent: string;
    status: string;
    files: string[];
    summary: string;
  }>;
  conflicts: Conflict[];
  files_changed: string[];
  next_wave_ready: boolean;
  tokens_saved: number;
}

export interface Conflict {
  type: "FILE_CONFLICT" | "DEPENDENCY_CONFLICT" | "API_CONFLICT";
  agents: string[];
  file?: string;
  description: string;
  severity: "warning" | "error";
}

interface SubtaskRow {
  id: string;
  agent_type: string | null;
  agent_id: string | null;
  description: string;
  status: string;
  result: Record<string, unknown> | null;
  blocked_by: string[] | null;
  completed_at: string | null;
}

/**
 * Aggregate results from all subtasks in a batch
 * Builds synthesis with summary, results, conflicts, and token savings
 */
export async function aggregateResults(batchId: string): Promise<Synthesis> {
  const sql = getDb();

  // Fetch all subtasks linked to this batch
  const subtasks = await sql<SubtaskRow[]>`
    SELECT id, agent_type, agent_id, description, status, result, blocked_by, completed_at
    FROM subtasks
    WHERE task_list_id = ${batchId}
    ORDER BY created_at ASC
  `;

  // Build results array
  const results = subtasks.map((st) => {
    const files = extractFilesFromResult(st.result);
    return {
      agent: st.agent_type || "unknown",
      status: st.status,
      files,
      summary: st.description.slice(0, 200),
    };
  });

  // Detect conflicts
  const conflicts = await detectConflicts(batchId);

  // Collect all unique files changed
  const filesChanged = [
    ...new Set(results.flatMap((r) => r.files)),
  ];

  // Calculate token savings
  const rawChars = subtasks.reduce((sum, st) => {
    const resultStr = st.result ? JSON.stringify(st.result) : "";
    return sum + st.description.length + resultStr.length;
  }, 0);

  const synthesisObj = {
    summary: "",
    results,
    conflicts,
    files_changed: filesChanged,
    next_wave_ready: false,
    tokens_saved: 0,
  };

  const synthesisChars = JSON.stringify(synthesisObj).length;
  const tokensSaved = Math.max(0, Math.round(rawChars / 4 - synthesisChars / 4));

  // Check if batch is complete and ready for next wave
  const nextWaveReady = await checkBatchCompletion(batchId);

  // Build summary string
  const completed = subtasks.filter((st) => st.status === "completed").length;
  const failed = subtasks.filter((st) => st.status === "failed").length;
  const total = subtasks.length;

  const summary = `Batch synthesis: ${completed}/${total} completed, ${failed} failed, ${filesChanged.length} files changed, ${conflicts.length} conflicts`;

  return {
    summary,
    results,
    conflicts,
    files_changed: filesChanged,
    next_wave_ready: nextWaveReady,
    tokens_saved: tokensSaved,
  };
}

/**
 * Detect conflicts across subtasks in a batch
 * Types: FILE_CONFLICT, DEPENDENCY_CONFLICT, API_CONFLICT
 */
export async function detectConflicts(batchId: string): Promise<Conflict[]> {
  const sql = getDb();

  const subtasks = await sql<SubtaskRow[]>`
    SELECT id, agent_type, agent_id, description, status, result, blocked_by
    FROM subtasks
    WHERE task_list_id = ${batchId}
  `;

  const conflicts: Conflict[] = [];

  // 1. FILE_CONFLICT: 2+ subtasks with overlapping files
  const fileMap = new Map<string, string[]>();

  for (const st of subtasks) {
    const files = extractFilesFromResult(st.result);
    for (const file of files) {
      if (!fileMap.has(file)) {
        fileMap.set(file, []);
      }
      fileMap.get(file)!.push(st.agent_type || st.id);
    }
  }

  for (const [file, agents] of fileMap.entries()) {
    if (agents.length > 1) {
      conflicts.push({
        type: "FILE_CONFLICT",
        agents: [...new Set(agents)],
        file,
        description: `Multiple agents modified ${file}`,
        severity: "warning",
      });
    }
  }

  // 2. DEPENDENCY_CONFLICT: subtask blocked by a failed subtask
  const failedIds = new Set(
    subtasks.filter((st) => st.status === "failed").map((st) => st.id)
  );

  for (const st of subtasks) {
    if (st.blocked_by && st.blocked_by.length > 0) {
      const blockedByFailed = st.blocked_by.filter((id) => failedIds.has(id));
      if (blockedByFailed.length > 0) {
        conflicts.push({
          type: "DEPENDENCY_CONFLICT",
          agents: [st.agent_type || st.id],
          description: `${st.agent_type || st.id} blocked by failed dependencies`,
          severity: "error",
        });
      }
    }
  }

  // 3. API_CONFLICT: failed subtasks with "breaking" or "contract" in description
  for (const st of subtasks) {
    if (
      st.status === "failed" &&
      (st.description.toLowerCase().includes("breaking") ||
        st.description.toLowerCase().includes("contract"))
    ) {
      conflicts.push({
        type: "API_CONFLICT",
        agents: [st.agent_type || st.id],
        description: `API contract violation: ${st.description.slice(0, 100)}`,
        severity: "error",
      });
    }
  }

  return conflicts;
}

/**
 * Check if all subtasks in batch are completed or failed
 * Updates batch completion counters if done
 */
export async function checkBatchCompletion(batchId: string): Promise<boolean> {
  const sql = getDb();

  const subtasks = await sql<SubtaskRow[]>`
    SELECT id, status
    FROM subtasks
    WHERE task_list_id = ${batchId}
  `;

  const allDone = subtasks.every(
    (st) => st.status === "completed" || st.status === "failed"
  );

  if (!allDone) {
    return false;
  }

  // Count completed and failed
  const completed = subtasks.filter((st) => st.status === "completed").length;
  const failed = subtasks.filter((st) => st.status === "failed").length;

  // Update task_lists (batch) completion counters
  await sql`
    UPDATE task_lists
    SET
      status = 'completed',
      completed_at = NOW()
    WHERE id = ${batchId}
  `;

  // Get parent context for cascade updates
  const parentInfo = await sql<{ request_id: string; wave_number: number; session_id: string }[]>`
    SELECT tl.request_id, tl.wave_number, r.session_id
    FROM task_lists tl
    JOIN requests r ON r.id = tl.request_id
    WHERE tl.id = ${batchId}
  `;

  // Update wave_states counters (fire and forget)
  if (parentInfo[0]) {
    completeWaveTask(parentInfo[0].session_id, parentInfo[0].wave_number, failed > 0).catch(err =>
      log.error("Wave state update error:", err)
    );
  }

  // Publish batch completion event
  await publishEvent("global", "batch.completed", {
    batch_id: batchId,
    total: subtasks.length,
    completed,
    failed,
  });

  // Auto-complete parent request if all tasks are done
  if (parentInfo[0]?.request_id) {
    checkRequestCompletion(parentInfo[0].request_id).catch(err =>
      log.error("Request completion check error:", err)
    );
  }

  return true;
}

/**
 * Check if all tasks in a request are completed or failed
 * Auto-completes the parent request when done
 */
export async function checkRequestCompletion(requestId: string): Promise<boolean> {
  const sql = getDb();

  const tasks = await sql<{ id: string; status: string }[]>`
    SELECT id, status FROM task_lists WHERE request_id = ${requestId}
  `;

  if (tasks.length === 0) return false;

  const allDone = tasks.every(
    (t) => t.status === "completed" || t.status === "failed"
  );

  if (!allDone) return false;

  const failed = tasks.filter((t) => t.status === "failed").length;
  const finalStatus = failed > 0 ? "failed" : "completed";

  await sql`
    UPDATE requests
    SET status = ${finalStatus}, completed_at = NOW()
    WHERE id = ${requestId} AND status != ${finalStatus}
  `;

  await publishEvent("global", "request.completed", {
    request_id: requestId,
    total_tasks: tasks.length,
    completed: tasks.length - failed,
    failed,
    status: finalStatus,
  });

  return true;
}

/**
 * Extract file paths from subtask result
 * Looks for common result keys: files, file_paths, changed_files
 */
function extractFilesFromResult(result: Record<string, unknown> | null): string[] {
  if (!result) return [];

  const files: string[] = [];

  // Common result keys
  const fileKeys = ["files", "file_paths", "changed_files", "modified_files"];

  for (const key of fileKeys) {
    const value = result[key];
    if (Array.isArray(value)) {
      files.push(...value.filter((v) => typeof v === "string"));
    }
  }

  return files;
}
