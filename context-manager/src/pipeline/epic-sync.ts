/**
 * Epic Sync — Automatically transitions epic statuses based on pipeline step progress.
 *
 * Logic:
 *   - For each epic with wave_start/wave_end linked to a pipeline, count completed
 *     vs total pipeline_steps in that wave range.
 *   - 100% completed and status != 'done'    → set 'done', record transition
 *   - >0%  completed and status == 'todo'    → set 'in_progress', record transition
 *
 * Called by the pipeline executor after each wave completes, or on-demand via API.
 * @module pipeline/epic-sync
 */

import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("EpicSync");

// ============================================
// DB row interfaces
// ============================================

interface EpicWithProgress {
  epic_id: string;
  project_id: string;
  pipeline_id: string;
  title: string;
  status: string;
  wave_start: number;
  wave_end: number;
  total_steps: number;
  completed_steps: number;
}

interface TransitionRecord {
  epicId: string;
  title: string;
  fromStatus: string;
  toStatus: string;
}

// ============================================
// Core function
// ============================================

/**
 * Synchronise epic statuses for all epics linked to the given pipeline.
 *
 * Transitions applied:
 *   todo       → in_progress   when at least one step is completed (>0%)
 *   in_progress / backlog → done  when all steps are completed (100%)
 *
 * Each transition is:
 *   1. Written to project_epics (status, completed_at if done)
 *   2. Recorded in epic_transitions (trigger='pipeline_sync')
 *   3. Published as a real-time event
 *
 * @param pipelineId - UUID of the pipeline to process
 */
export async function syncEpicStatusFromPipeline(pipelineId: string): Promise<void> {
  const sql = getDb();

  // Query all epics linked to this pipeline that have wave bounds defined.
  // For each epic, compute the completed vs total step count via the
  // v_epic_progress view (already maintained by the DB schema).
  //
  // We query the view directly to stay consistent with the canonical
  // progress calculation used elsewhere (dashboard, etc.).
  const epics = await sql<EpicWithProgress[]>`
    SELECT
      ep.epic_id,
      ep.project_id,
      ep.pipeline_id,
      ep.title,
      ep.status,
      ep.wave_start,
      ep.wave_end,
      ep.total_steps,
      ep.completed_steps
    FROM v_epic_progress ep
    WHERE ep.pipeline_id = ${pipelineId}
      AND ep.wave_start  IS NOT NULL
      AND ep.wave_end    IS NOT NULL
      AND ep.status      NOT IN ('done', 'cancelled')
    ORDER BY ep.wave_start ASC
  `;

  if (epics.length === 0) {
    log.debug(`syncEpicStatusFromPipeline: no eligible epics for pipeline ${pipelineId}`);
    return;
  }

  log.info(`EpicSync: processing ${epics.length} epics for pipeline ${pipelineId}`);

  const transitions: TransitionRecord[] = [];

  for (const epic of epics) {
    const total = Number(epic.total_steps);
    const completed = Number(epic.completed_steps);
    const currentStatus = epic.status;

    let targetStatus: string | null = null;

    if (total > 0 && completed === total && currentStatus !== "done") {
      // All steps done — mark the epic as done
      targetStatus = "done";
    } else if (completed > 0 && currentStatus === "todo") {
      // At least one step done — move from todo to in_progress
      targetStatus = "in_progress";
    }

    if (!targetStatus) {
      continue; // No transition needed
    }

    // Apply the transition atomically
    const isDone = targetStatus === "done";

    await sql`
      UPDATE project_epics
      SET
        status       = ${targetStatus},
        updated_at   = NOW(),
        completed_at = ${isDone ? sql`NOW()` : sql`completed_at`}
      WHERE id = ${epic.epic_id}
    `;

    // Record the transition history
    await sql`
      INSERT INTO epic_transitions (epic_id, from_status, to_status, trigger)
      VALUES (${epic.epic_id}, ${currentStatus}, ${targetStatus}, 'pipeline_sync')
    `;

    transitions.push({
      epicId: epic.epic_id,
      title: epic.title,
      fromStatus: currentStatus,
      toStatus: targetStatus,
    });

    log.info(
      `Epic transitioned: id=${epic.epic_id} title="${epic.title}" ${currentStatus} → ${targetStatus} (${completed}/${total} steps)`,
    );

    // Publish real-time event for each transition
    await publishEvent("global", "epic.status_changed", {
      epic_id: epic.epic_id,
      project_id: epic.project_id,
      pipeline_id: pipelineId,
      title: epic.title,
      from_status: currentStatus,
      to_status: targetStatus,
      completed_steps: completed,
      total_steps: total,
    });
  }

  if (transitions.length > 0) {
    log.info(
      `EpicSync complete: pipeline=${pipelineId} transitions=${transitions.length} ` +
        `(${transitions.map((t) => `"${t.title}" ${t.fromStatus}→${t.toStatus}`).join(", ")})`,
    );
  } else {
    log.debug(`EpicSync: no transitions needed for pipeline ${pipelineId}`);
  }
}
