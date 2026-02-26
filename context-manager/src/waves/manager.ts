/**
 * Wave State Machine Manager
 * DCM v3.0 - Phase 3 Orchestration
 * @module waves/manager
 */

import { getDb, publishEvent } from "../db/client";

export interface WaveState {
  id: string;
  session_id: string;
  wave_number: number;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  started_at: string | null;
  completed_at: string | null;
}

/**
 * Get or create a wave state (upsert)
 * Returns existing wave or creates new one with pending status
 */
export async function getOrCreateWave(
  sessionId: string,
  waveNumber: number
): Promise<WaveState> {
  const sql = getDb();

  const results = await sql<WaveState[]>`
    INSERT INTO wave_states (session_id, wave_number, status, total_tasks, completed_tasks, failed_tasks)
    VALUES (${sessionId}, ${waveNumber}, 'pending', 0, 0, 0)
    ON CONFLICT (session_id, wave_number) DO UPDATE SET
      session_id = EXCLUDED.session_id
    RETURNING id, session_id, wave_number, status, total_tasks, completed_tasks, failed_tasks,
      started_at, completed_at
  `;

  const wave = results[0];
  if (!wave) {
    throw new Error(`Failed to create wave ${waveNumber} for session ${sessionId}`);
  }
  return wave;
}

/**
 * Start a wave - transition to running status
 * Publishes wave.transitioned event
 */
export async function startWave(
  sessionId: string,
  waveNumber: number
): Promise<WaveState> {
  const sql = getDb();

  // Get previous wave number
  const previousWave = waveNumber - 1;

  const results = await sql<WaveState[]>`
    UPDATE wave_states
    SET
      status = 'running',
      started_at = COALESCE(started_at, NOW())
    WHERE session_id = ${sessionId} AND wave_number = ${waveNumber}
    RETURNING id, session_id, wave_number, status, total_tasks, completed_tasks, failed_tasks,
      started_at, completed_at
  `;

  const wave = results[0];

  if (!wave) {
    throw new Error(`Wave ${waveNumber} not found for session ${sessionId}`);
  }

  // Publish transition event
  await publishEvent("global", "wave.transitioned", {
    session_id: sessionId,
    from: previousWave,
    to: waveNumber,
    status: "running",
  });

  return wave;
}

/**
 * Complete a task within a wave
 * Increments completed_tasks or failed_tasks counter
 * Transitions wave if all tasks are done
 */
export async function completeTask(
  sessionId: string,
  waveNumber: number,
  failed: boolean
): Promise<WaveState> {
  const sql = getDb();

  // Increment the appropriate counter
  const results = failed
    ? await sql<WaveState[]>`
        UPDATE wave_states
        SET failed_tasks = failed_tasks + 1
        WHERE session_id = ${sessionId} AND wave_number = ${waveNumber}
        RETURNING id, session_id, wave_number, status, total_tasks, completed_tasks, failed_tasks,
          started_at, completed_at
      `
    : await sql<WaveState[]>`
        UPDATE wave_states
        SET completed_tasks = completed_tasks + 1
        WHERE session_id = ${sessionId} AND wave_number = ${waveNumber}
        RETURNING id, session_id, wave_number, status, total_tasks, completed_tasks, failed_tasks,
          started_at, completed_at
      `;

  const wave = results[0];

  if (!wave) {
    throw new Error(`Wave ${waveNumber} not found for session ${sessionId}`);
  }

  // Check if all tasks are done
  const allDone = wave.completed_tasks + wave.failed_tasks >= wave.total_tasks;

  if (allDone) {
    // Determine final status
    const hasCriticalFailures = wave.failed_tasks > 0;
    const finalStatus = hasCriticalFailures ? "failed" : "completed";

    // Transition wave
    const finalResults = await sql<WaveState[]>`
      UPDATE wave_states
      SET
        status = ${finalStatus},
        completed_at = NOW()
      WHERE session_id = ${sessionId} AND wave_number = ${waveNumber}
      RETURNING id, session_id, wave_number, status, total_tasks, completed_tasks, failed_tasks,
        started_at, completed_at
    `;

    const finalWave = finalResults[0] ?? wave;

    // Publish completion event
    await publishEvent("global", `wave.${finalStatus}`, {
      session_id: sessionId,
      wave_number: waveNumber,
      completed_tasks: finalWave.completed_tasks,
      failed_tasks: finalWave.failed_tasks,
      total_tasks: finalWave.total_tasks,
      duration_ms: calculateDuration(finalWave.started_at, finalWave.completed_at),
    });

    return finalWave;
  }

  return wave;
}

/**
 * Get the currently running wave for a session
 * Returns the running wave or latest pending wave
 */
export async function getCurrentWave(sessionId: string): Promise<WaveState | null> {
  const sql = getDb();

  // Try to find running wave first
  const runningResults = await sql<WaveState[]>`
    SELECT id, session_id, wave_number, status, total_tasks, completed_tasks, failed_tasks,
      started_at, completed_at
    FROM wave_states
    WHERE session_id = ${sessionId} AND status = 'running'
    ORDER BY wave_number DESC
    LIMIT 1
  `;

  if (runningResults.length > 0 && runningResults[0]) {
    return runningResults[0];
  }

  // Fallback to latest pending wave
  const pendingResults = await sql<WaveState[]>`
    SELECT id, session_id, wave_number, status, total_tasks, completed_tasks, failed_tasks,
      started_at, completed_at
    FROM wave_states
    WHERE session_id = ${sessionId} AND status = 'pending'
    ORDER BY wave_number DESC
    LIMIT 1
  `;

  return pendingResults[0] ?? null;
}

/**
 * Get wave history for a session
 * Returns all waves ordered by wave_number
 * Falls back to synthesizing from task_lists if wave_states is empty
 */
export async function getWaveHistory(sessionId: string): Promise<WaveState[]> {
  const sql = getDb();

  const results = await sql<WaveState[]>`
    SELECT id, session_id, wave_number, status, total_tasks, completed_tasks, failed_tasks,
      started_at, completed_at
    FROM wave_states
    WHERE session_id = ${sessionId}
    ORDER BY wave_number ASC
  `;

  if (results.length > 0) return results;

  // Fallback: synthesize wave data from task_lists for sessions without wave_states
  const synthesized = await sql<WaveState[]>`
    SELECT
      gen_random_uuid()::text as id,
      r.session_id,
      tl.wave_number,
      CASE
        WHEN COUNT(*) FILTER (WHERE tl.status IN ('pending', 'running')) > 0 THEN 'running'
        WHEN COUNT(*) FILTER (WHERE tl.status = 'failed') > 0 THEN 'failed'
        ELSE 'completed'
      END as status,
      COUNT(*)::int as total_tasks,
      COUNT(*) FILTER (WHERE tl.status = 'completed')::int as completed_tasks,
      COUNT(*) FILTER (WHERE tl.status = 'failed')::int as failed_tasks,
      MIN(tl.created_at) as started_at,
      MAX(tl.completed_at) as completed_at
    FROM task_lists tl
    JOIN requests r ON r.id = tl.request_id
    WHERE r.session_id = ${sessionId}
    GROUP BY r.session_id, tl.wave_number
    ORDER BY tl.wave_number ASC
  `;

  return synthesized;
}

/**
 * Transition to next wave
 * Finds current completed wave and starts the next one
 * Returns new wave or null if no more waves
 */
export async function transitionToNextWave(sessionId: string): Promise<WaveState | null> {
  const sql = getDb();

  // Find latest completed wave
  const completedResults = await sql<WaveState[]>`
    SELECT wave_number
    FROM wave_states
    WHERE session_id = ${sessionId} AND status = 'completed'
    ORDER BY wave_number DESC
    LIMIT 1
  `;

  const lastCompletedWave = completedResults[0];
  if (!lastCompletedWave) {
    return null;
  }

  const lastCompleted = lastCompletedWave.wave_number;
  const nextWaveNumber = lastCompleted + 1;

  // Check if next wave exists
  const nextResults = await sql<WaveState[]>`
    SELECT id, session_id, wave_number, status, total_tasks, completed_tasks, failed_tasks,
      started_at, completed_at
    FROM wave_states
    WHERE session_id = ${sessionId} AND wave_number = ${nextWaveNumber}
    LIMIT 1
  `;

  if (nextResults.length === 0) {
    return null;
  }

  // Start next wave
  return await startWave(sessionId, nextWaveNumber);
}

/**
 * Calculate duration between two timestamps
 * Returns readable duration string (no long decimals)
 */
function calculateDuration(
  startedAt: string | null,
  completedAt: string | null
): number {
  if (!startedAt || !completedAt) return 0;

  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  return Math.round(end - start);
}
