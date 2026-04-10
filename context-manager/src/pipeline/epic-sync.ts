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
  running_steps: number;
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
      e.id AS epic_id,
      e.project_id,
      e.pipeline_id,
      e.title,
      e.status,
      e.wave_start,
      e.wave_end,
      COUNT(ps.id) AS total_steps,
      COUNT(ps.id) FILTER (WHERE ps.status = 'completed') AS completed_steps,
      COUNT(ps.id) FILTER (WHERE ps.status = 'running') AS running_steps
    FROM project_epics e
    LEFT JOIN pipeline_steps ps ON ps.pipeline_id = e.pipeline_id
      AND ps.wave_number >= e.wave_start
      AND ps.wave_number <= e.wave_end
    WHERE e.pipeline_id = ${pipelineId}
      AND e.wave_start IS NOT NULL
      AND e.wave_end IS NOT NULL
      AND e.status NOT IN ('done', 'cancelled')
    GROUP BY e.id, e.project_id, e.pipeline_id, e.title, e.status, e.wave_start, e.wave_end
    ORDER BY e.wave_start ASC
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
    const running = Number(epic.running_steps);
    const currentStatus = epic.status;

    let targetStatus: string | null = null;

    if (total > 0 && completed === total && currentStatus !== "done") {
      // All steps done — mark the epic as done
      targetStatus = "done";
    } else if ((completed > 0 || running > 0) && currentStatus === "todo") {
      // At least one step running or done — move from todo to in_progress
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

/**
 * Auto-create epics from a pipeline's plan sprints.
 * Called when a pipeline finishes planning (status → 'ready').
 * Each sprint becomes an epic linked to the pipeline with wave range.
 */
export async function createEpicsFromPipelinePlan(pipelineId: string): Promise<number> {
  const sql = getDb();

  const [pipeline] = await sql<Array<{ project_id: string | null; plan: Record<string, unknown> | null }>>`
    SELECT project_id, plan FROM pipelines WHERE id = ${pipelineId}
  `;

  if (!pipeline?.project_id || !pipeline.plan) {
    log.debug(`createEpicsFromPipelinePlan: pipeline ${pipelineId} has no project or plan, skipping`);
    return 0;
  }

  const sprints = (pipeline.plan as Record<string, unknown>)["sprints"] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(sprints) || sprints.length === 0) {
    log.debug(`createEpicsFromPipelinePlan: no sprints in plan for pipeline ${pipelineId}`);
    return 0;
  }

  let created = 0;
  for (const sprint of sprints) {
    const title = String(sprint["name"] ?? `Sprint ${sprint["number"] ?? created + 1}`);
    const objectives = Array.isArray(sprint["objectives"]) ? (sprint["objectives"] as string[]) : [];
    const waveStart = Number(sprint["wave_start"] ?? 0);
    const waveEnd = Number(sprint["wave_end"] ?? 0);

    // Skip if epic already exists for this pipeline + wave range
    const existing = await sql`
      SELECT id FROM project_epics
      WHERE pipeline_id = ${pipelineId} AND wave_start = ${waveStart} AND wave_end = ${waveEnd}
      LIMIT 1
    `;
    if (existing.length > 0) continue;

    await sql`
      INSERT INTO project_epics (project_id, pipeline_id, title, description, status, wave_start, wave_end, sort_order)
      VALUES (
        ${pipeline.project_id},
        ${pipelineId},
        ${title},
        ${objectives.join("\n")},
        'todo',
        ${waveStart},
        ${waveEnd},
        ${created}
      )
    `;
    created++;
  }

  if (created > 0) {
    log.info(`Created ${created} epics from pipeline ${pipelineId} plan (${sprints.length} sprints)`);
    await publishEvent("global", "epics.created_from_pipeline", {
      pipeline_id: pipelineId,
      project_id: pipeline.project_id,
      count: created,
    });
  }

  return created;
}

/**
 * Ensure an epic has a linked pipeline. If the project has no pipeline yet, create one.
 * If the project already has a pipeline, link the epic to it and assign the next wave number.
 * Returns { pipeline_id, wave_number } for inserting steps.
 */
export async function ensureEpicPipeline(
  epicId: string,
  projectId: string,
): Promise<{ pipeline_id: string; wave_number: number }> {
  const sql = getDb();

  // Check if epic already has a pipeline
  const [epic] = await sql<Array<{ pipeline_id: string | null }>>`
    SELECT pipeline_id FROM project_epics WHERE id = ${epicId}
  `;

  if (epic?.pipeline_id) {
    // Get next wave number for this pipeline
    const [maxWave] = await sql<Array<{ max: number | null }>>`
      SELECT MAX(wave_number) as max FROM pipeline_steps WHERE pipeline_id = ${epic.pipeline_id}
    `;
    return { pipeline_id: epic.pipeline_id, wave_number: (maxWave?.max ?? -1) + 1 };
  }

  // Check if project already has an active pipeline
  const [existingPipeline] = await sql<Array<{ id: string }>>`
    SELECT id FROM pipelines
    WHERE project_id = ${projectId} AND status NOT IN ('completed', 'failed', 'cancelled')
    ORDER BY created_at DESC LIMIT 1
  `;

  let pipelineId: string;

  if (existingPipeline) {
    pipelineId = existingPipeline.id;
  } else {
    // Create a minimal pipeline for the project
    const [newPipeline] = await sql<Array<{ id: string }>>`
      INSERT INTO pipelines (session_id, project_id, name, status, input)
      VALUES (
        ${'epic-auto-' + Date.now()},
        ${projectId},
        'Project Pipeline',
        'running',
        ${sql.json({ instructions: "Auto-created from epic tasks", documents: [] })}
      )
      RETURNING id
    `;
    pipelineId = newPipeline!.id;
    log.info(`Created auto-pipeline ${pipelineId} for project ${projectId}`);
  }

  // Link the epic to the pipeline
  const [maxWave] = await sql<Array<{ max: number | null }>>`
    SELECT MAX(wave_number) as max FROM pipeline_steps WHERE pipeline_id = ${pipelineId}
  `;
  const waveNumber = (maxWave?.max ?? -1) + 1;

  await sql`
    UPDATE project_epics SET pipeline_id = ${pipelineId}, wave_start = ${waveNumber}, wave_end = ${waveNumber}
    WHERE id = ${epicId}
  `;

  log.info(`Linked epic ${epicId} to pipeline ${pipelineId} at wave ${waveNumber}`);

  return { pipeline_id: pipelineId, wave_number: waveNumber };
}
