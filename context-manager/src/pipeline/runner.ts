/**
 * Pipeline Runner — Manages the lifecycle of a pipeline from creation
 * through wave-by-wave execution to completion and synthesis.
 *
 * Does NOT launch Claude Code agents directly. It provides the structured
 * plan that Claude Code reads and executes. Tracks state changes via DB
 * updates and emits WebSocket events through PostgreSQL NOTIFY.
 *
 * @module pipeline/runner
 */

import type {
  PipelineRow,
  PipelineStepRow,
  PipelineInput,
  StepStatus,
  PipelineSynthesis,
  PipelineStats,
  WaveSynthesis,
  StepSynthesis,
  TimelineEvent,
  PipelineError,
  PipelineConfig,
  DecisionContext,
} from "./types";
import { generatePlan } from "./planner";
import { makeDecision, analyzeWaveResults } from "./decisions";
import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";
import {
  generateId,
  calcDurationMs,
  nowISO,
  isTerminal,
  formatDuration,
} from "../lib/helpers";

const log = createLogger("Runner");

// ============================================
// Default Configuration
// ============================================

const DEFAULT_CONFIG: PipelineConfig = {
  max_retries: 3,
  strategy: "adaptive",
  parallel_limit: 4,
};

// ============================================
// Pipeline CRUD
// ============================================

/**
 * Create a new pipeline from user input.
 *
 * Generates an execution plan via the planner, persists the pipeline
 * and all its steps to the database, records a creation event, and
 * broadcasts a WebSocket notification.
 *
 * @param sessionId - Active session identifier
 * @param input - User instructions, documents, and scope targets
 * @param config - Optional configuration overrides
 * @returns The newly created pipeline row
 */
export async function createPipeline(
  sessionId: string,
  input: PipelineInput,
  config?: Partial<PipelineConfig>,
): Promise<PipelineRow> {
  const sql = getDb();
  const pipelineId = generateId("pipe");
  const mergedConfig: PipelineConfig = { ...DEFAULT_CONFIG, ...config };

  // Generate execution plan
  const plan = await generatePlan(input, sessionId);

  log.info(
    `Creating pipeline: id=${pipelineId}, session=${sessionId}, ` +
    `waves=${plan.waves.length}, steps=${plan.waves.reduce((s, w) => s + w.steps.length, 0)}`,
  );

  // Insert pipeline row
  const [pipeline] = await sql<PipelineRow[]>`
    INSERT INTO pipelines (id, session_id, name, status, input, plan, current_wave, config)
    VALUES (
      ${pipelineId},
      ${sessionId},
      ${plan.name},
      'ready',
      ${sql.json(input as any)},
      ${sql.json(plan as any)},
      0,
      ${sql.json(mergedConfig as any)}
    )
    RETURNING *
  `;

  if (!pipeline) {
    throw new Error(`Failed to insert pipeline ${pipelineId}`);
  }

  // Insert all steps from the plan
  for (const wave of plan.waves) {
    for (const stepDef of wave.steps) {
      await sql`
        INSERT INTO pipeline_steps (
          id, pipeline_id, wave_number, step_order, agent_type, description,
          skills, prompt, model, max_turns, status, retry_strategy, max_retries
        ) VALUES (
          ${generateId("step")},
          ${pipelineId},
          ${wave.number},
          ${stepDef.order},
          ${stepDef.agent_type},
          ${stepDef.description},
          ${stepDef.skills},
          ${stepDef.prompt},
          ${stepDef.model},
          ${stepDef.max_turns},
          'pending',
          ${stepDef.retry_strategy},
          ${stepDef.max_retries}
        )
      `;
    }
  }

  // Record creation event
  const totalSteps = plan.waves.reduce((s, w) => s + w.steps.length, 0);
  await recordEvent(sql, pipelineId, "pipeline_created", {
    session_id: sessionId,
    plan_id: plan.plan_id,
    total_waves: plan.waves.length,
    total_steps: totalSteps,
  });

  // Broadcast
  await publishEvent("global", "pipeline.created", {
    pipeline_id: pipelineId,
    session_id: sessionId,
    name: plan.name,
    total_waves: plan.waves.length,
    total_steps: totalSteps,
  });

  log.info(`Pipeline created: ${pipelineId} (${plan.name})`);
  return pipeline;
}

/**
 * Retrieve a single pipeline by ID.
 *
 * @param pipelineId - Pipeline identifier
 * @returns The pipeline row, or null if not found
 */
export async function getPipeline(pipelineId: string): Promise<PipelineRow | null> {
  const sql = getDb();
  const [row] = await sql<PipelineRow[]>`
    SELECT * FROM pipelines WHERE id = ${pipelineId}
  `;
  return row ?? null;
}

/**
 * Retrieve steps for a pipeline, optionally filtered by wave number.
 *
 * @param pipelineId - Pipeline identifier
 * @param waveNumber - Optional wave number filter
 * @returns Ordered list of pipeline step rows
 */
export async function getPipelineSteps(
  pipelineId: string,
  waveNumber?: number,
): Promise<PipelineStepRow[]> {
  const sql = getDb();

  if (waveNumber !== undefined) {
    return sql<PipelineStepRow[]>`
      SELECT * FROM pipeline_steps
      WHERE pipeline_id = ${pipelineId} AND wave_number = ${waveNumber}
      ORDER BY wave_number, step_order
    `;
  }

  return sql<PipelineStepRow[]>`
    SELECT * FROM pipeline_steps
    WHERE pipeline_id = ${pipelineId}
    ORDER BY wave_number, step_order
  `;
}

/**
 * List pipelines with optional filters.
 *
 * @param sessionId - Optional session filter
 * @param status - Optional status filter
 * @returns List of pipeline rows, newest first, max 50
 */
export async function listPipelines(
  sessionId?: string,
  status?: string,
): Promise<PipelineRow[]> {
  const sql = getDb();

  if (sessionId && status) {
    return sql<PipelineRow[]>`
      SELECT * FROM pipelines
      WHERE session_id = ${sessionId} AND status = ${status}
      ORDER BY created_at DESC LIMIT 50
    `;
  }
  if (sessionId) {
    return sql<PipelineRow[]>`
      SELECT * FROM pipelines
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC LIMIT 50
    `;
  }
  if (status) {
    return sql<PipelineRow[]>`
      SELECT * FROM pipelines
      WHERE status = ${status}
      ORDER BY created_at DESC LIMIT 50
    `;
  }

  return sql<PipelineRow[]>`
    SELECT * FROM pipelines
    ORDER BY created_at DESC LIMIT 50
  `;
}

// ============================================
// Pipeline State Transitions
// ============================================

/**
 * Start a pipeline that is in 'ready' or 'paused' state.
 *
 * Transitions to 'running', queues all steps in wave 0, records
 * an event, and broadcasts the start via WebSocket.
 *
 * @param pipelineId - Pipeline to start
 * @returns The updated pipeline row
 * @throws If pipeline is not in a startable state
 */
export async function startPipeline(pipelineId: string): Promise<PipelineRow> {
  const sql = getDb();
  const pipeline = await getPipeline(pipelineId);

  if (!pipeline) {
    throw new Error(`Pipeline not found: ${pipelineId}`);
  }
  if (pipeline.status !== "ready" && pipeline.status !== "paused") {
    throw new Error(
      `Cannot start pipeline ${pipelineId}: current status is '${pipeline.status}', expected 'ready' or 'paused'`,
    );
  }

  const now = nowISO();

  // Transition to running
  const [updated] = await sql<PipelineRow[]>`
    UPDATE pipelines
    SET status = 'running', started_at = COALESCE(started_at, ${now}), current_wave = 0, updated_at = ${now}
    WHERE id = ${pipelineId}
    RETURNING *
  `;

  if (!updated) {
    throw new Error(`Failed to update pipeline ${pipelineId}`);
  }

  // Queue all steps in wave 0
  await sql`
    UPDATE pipeline_steps
    SET status = 'queued'
    WHERE pipeline_id = ${pipelineId} AND wave_number = 0 AND status = 'pending'
  `;

  await recordEvent(sql, pipelineId, "pipeline_start", {
    wave: 0,
    message: "Pipeline started, wave 0 queued",
  });

  await publishEvent("global", "pipeline.started", {
    pipeline_id: pipelineId,
    session_id: updated.session_id,
    name: updated.name,
    current_wave: 0,
  });

  log.info(`Pipeline started: ${pipelineId}`);
  return updated;
}

/**
 * Pause a running pipeline.
 *
 * @param pipelineId - Pipeline to pause
 */
export async function pausePipeline(pipelineId: string): Promise<void> {
  const sql = getDb();
  const now = nowISO();

  const [updated] = await sql<PipelineRow[]>`
    UPDATE pipelines
    SET status = 'paused', updated_at = ${now}
    WHERE id = ${pipelineId} AND status = 'running'
    RETURNING *
  `;

  if (!updated) {
    throw new Error(`Cannot pause pipeline ${pipelineId}: not found or not running`);
  }

  await recordEvent(sql, pipelineId, "pipeline_paused", {
    wave: updated.current_wave,
    message: "Pipeline paused by user",
  });

  await publishEvent("global", "pipeline.paused", {
    pipeline_id: pipelineId,
    session_id: updated.session_id,
    current_wave: updated.current_wave,
  });

  log.info(`Pipeline paused: ${pipelineId}`);
}

/**
 * Cancel a pipeline. Delegates to completePipeline with 'cancelled' status.
 *
 * @param pipelineId - Pipeline to cancel
 */
export async function cancelPipeline(pipelineId: string): Promise<void> {
  await completePipeline(pipelineId, "cancelled");
}

// ============================================
// Step Status Updates
// ============================================

/**
 * Update the status of a pipeline step.
 *
 * Handles timestamp management, duration calculation, event recording,
 * and triggers wave progress evaluation when a step reaches a terminal state.
 *
 * @param stepId - Step identifier
 * @param status - New status for the step
 * @param result - Optional result payload from the agent
 * @param error - Optional error message if the step failed
 */
export async function updateStepStatus(
  stepId: string,
  status: StepStatus,
  result?: Record<string, unknown>,
  error?: string,
): Promise<void> {
  const sql = getDb();
  const now = nowISO();

  // Fetch current step to compute duration and get pipeline context
  const [currentStep] = await sql<PipelineStepRow[]>`
    SELECT * FROM pipeline_steps WHERE id = ${stepId}
  `;

  if (!currentStep) {
    throw new Error(`Step not found: ${stepId}`);
  }

  // Determine timestamps
  const startedAt = status === "running" ? now : currentStep.started_at;
  const completedAt = isTerminal(status) ? now : null;
  const durationMs = isTerminal(status)
    ? calcDurationMs(currentStep.started_at, now)
    : null;

  // Build the result JSONB value
  const resultJson = result
    ? sql.json(result as any)
    : currentStep.result
      ? sql.json(currentStep.result as any)
      : null;

  // Update the step row
  await sql`
    UPDATE pipeline_steps
    SET
      status = ${status},
      started_at = ${startedAt},
      completed_at = ${completedAt},
      duration_ms = ${durationMs},
      result = ${resultJson},
      error = ${error ?? currentStep.error}
    WHERE id = ${stepId}
  `;

  // Record event
  await recordEvent(sql, currentStep.pipeline_id, `step_${status}`, {
    wave: currentStep.wave_number,
    step: currentStep.step_order,
    agent_type: currentStep.agent_type,
    message: error
      ? `Step ${currentStep.agent_type} ${status}: ${error}`
      : `Step ${currentStep.agent_type} ${status}`,
  });

  // Broadcast
  await publishEvent("global", "pipeline.step.updated", {
    pipeline_id: currentStep.pipeline_id,
    step_id: stepId,
    wave_number: currentStep.wave_number,
    agent_type: currentStep.agent_type,
    status,
    duration_ms: durationMs,
  });

  log.debug(
    `Step updated: ${stepId} (${currentStep.agent_type}) -> ${status}` +
    (durationMs ? ` in ${formatDuration(durationMs)}` : ""),
  );

  // Evaluate wave progress when a step reaches a terminal state
  if (isTerminal(status)) {
    await evaluateWaveProgress(currentStep.pipeline_id, currentStep.wave_number);
  }
}

// ============================================
// Wave Progress Evaluation
// ============================================

/**
 * Evaluate whether all steps in the current wave have settled and
 * decide how to proceed: advance to next wave, retry failed steps,
 * skip them, or abort the pipeline.
 *
 * @param pipelineId - Pipeline identifier
 * @param waveNumber - Wave number to evaluate
 */
export async function evaluateWaveProgress(
  pipelineId: string,
  waveNumber: number,
): Promise<void> {
  const sql = getDb();

  // Fetch all steps in the current wave
  const waveSteps = await sql<PipelineStepRow[]>`
    SELECT * FROM pipeline_steps
    WHERE pipeline_id = ${pipelineId} AND wave_number = ${waveNumber}
    ORDER BY step_order
  `;

  // If any steps are still running or queued, wait
  const activeSteps = waveSteps.filter((s) => !isTerminal(s.status));
  if (activeSteps.length > 0) {
    log.debug(
      `Wave ${waveNumber}: ${activeSteps.length} steps still active, waiting`,
    );
    return;
  }

  // All steps settled -- analyze the wave
  const analysis = analyzeWaveResults(waveSteps);

  log.info(`Wave ${waveNumber} settled: ${analysis.summary}`);

  if (analysis.should_proceed) {
    // Record wave completion
    await recordEvent(sql, pipelineId, "wave_complete", {
      wave: waveNumber,
      message: analysis.summary,
    });

    // Advance to next wave
    const nextWave = waveNumber + 1;
    const nextWaveSteps = await sql<PipelineStepRow[]>`
      SELECT * FROM pipeline_steps
      WHERE pipeline_id = ${pipelineId} AND wave_number = ${nextWave}
    `;

    if (nextWaveSteps.length > 0) {
      // Update pipeline to next wave
      const now = nowISO();
      await sql`
        UPDATE pipelines
        SET current_wave = ${nextWave}, updated_at = ${now}
        WHERE id = ${pipelineId}
      `;

      // Queue next wave steps
      await sql`
        UPDATE pipeline_steps
        SET status = 'queued'
        WHERE pipeline_id = ${pipelineId} AND wave_number = ${nextWave} AND status = 'pending'
      `;

      await recordEvent(sql, pipelineId, "wave_start", {
        wave: nextWave,
        message: `Wave ${nextWave} started with ${nextWaveSteps.length} steps`,
      });

      await publishEvent("global", "pipeline.wave.started", {
        pipeline_id: pipelineId,
        wave_number: nextWave,
        total_steps: nextWaveSteps.length,
      });

      log.info(`Advanced to wave ${nextWave}: ${nextWaveSteps.length} steps queued`);
    } else {
      // No more waves -- pipeline is complete
      await completePipeline(pipelineId, "completed");
    }
  } else {
    // Wave has failures that need decisions
    await handleFailedSteps(pipelineId, waveNumber, analysis.failed_steps, waveSteps);
  }
}

// ============================================
// Failure Handling
// ============================================

/**
 * Process failed steps using the decision engine.
 * Applies retry, skip, or abort actions based on each decision.
 */
async function handleFailedSteps(
  pipelineId: string,
  waveNumber: number,
  failedSteps: PipelineStepRow[],
  allWaveSteps: PipelineStepRow[],
): Promise<void> {
  const sql = getDb();
  const pipeline = await getPipeline(pipelineId);
  if (!pipeline) return;

  for (const failedStep of failedSteps) {
    const decisionCtx: DecisionContext = {
      pipeline,
      current_wave: waveNumber,
      step: failedStep,
      all_steps_in_wave: allWaveSteps,
      previous_wave_results: [],
    };

    // Only set error if present (exactOptionalPropertyTypes compliance)
    if (failedStep.error !== null) {
      decisionCtx.error = failedStep.error;
    }

    const decision = makeDecision(decisionCtx);

    log.info(
      `Decision for ${failedStep.agent_type}: ${decision.action} -- ${decision.reason}`,
    );

    // Record decision event
    await recordEvent(sql, pipelineId, "decision", {
      wave: waveNumber,
      step: failedStep.step_order,
      agent_type: failedStep.agent_type,
      action: decision.action,
      message: decision.reason,
    });

    await publishEvent("global", "pipeline.decision", {
      pipeline_id: pipelineId,
      step_id: failedStep.id,
      agent_type: failedStep.agent_type,
      action: decision.action,
      reason: decision.reason,
    });

    switch (decision.action) {
      case "retry":
      case "retry_alt": {
        // Re-queue the step with incremented retry count
        const retryNow = nowISO();
        await sql`
          UPDATE pipeline_steps
          SET
            status = 'queued',
            retry_count = retry_count + 1,
            error = NULL,
            completed_at = NULL,
            duration_ms = NULL,
            started_at = ${retryNow}
          WHERE id = ${failedStep.id}
        `;

        await recordEvent(sql, pipelineId, "retry", {
          wave: waveNumber,
          step: failedStep.step_order,
          agent_type: failedStep.agent_type,
          message: `Retry ${failedStep.retry_count + 1}/${failedStep.max_retries}: ${decision.reason}`,
        });

        log.info(`Retrying step ${failedStep.agent_type} (attempt ${failedStep.retry_count + 1})`);
        break;
      }

      case "skip": {
        await sql`
          UPDATE pipeline_steps
          SET status = 'skipped'
          WHERE id = ${failedStep.id}
        `;

        log.info(`Skipped step ${failedStep.agent_type}: ${decision.reason}`);
        break;
      }

      case "abort": {
        log.error(`Aborting pipeline ${pipelineId}: ${decision.reason}`);
        await completePipeline(pipelineId, "failed");
        return;
      }

      case "pause": {
        await pausePipeline(pipelineId);
        return;
      }

      default: {
        // "proceed", "inject", "human" -- log and continue
        log.warn(`Unhandled decision action '${decision.action}', skipping step`);
        await sql`
          UPDATE pipeline_steps
          SET status = 'skipped'
          WHERE id = ${failedStep.id}
        `;
        break;
      }
    }
  }

  // After processing all failed steps, re-evaluate whether wave can proceed
  // (some steps may have been skipped, unlocking progression)
  const updatedSteps = await sql<PipelineStepRow[]>`
    SELECT * FROM pipeline_steps
    WHERE pipeline_id = ${pipelineId} AND wave_number = ${waveNumber}
    ORDER BY step_order
  `;

  const stillActive = updatedSteps.filter((s) => !isTerminal(s.status));
  if (stillActive.length === 0) {
    const reAnalysis = analyzeWaveResults(updatedSteps);
    if (reAnalysis.should_proceed) {
      await evaluateWaveProgress(pipelineId, waveNumber);
    }
  }
}

// ============================================
// Pipeline Completion
// ============================================

/**
 * Complete a pipeline with the given terminal status.
 *
 * Generates a synthesis report, persists the final state, records
 * a completion event, and broadcasts via WebSocket.
 *
 * @param pipelineId - Pipeline to complete
 * @param status - Terminal status: 'completed', 'failed', or 'cancelled'
 */
export async function completePipeline(
  pipelineId: string,
  status: "completed" | "failed" | "cancelled",
): Promise<void> {
  const sql = getDb();
  const now = nowISO();

  // Generate synthesis report
  const synthesis = await generateSynthesis(pipelineId);

  // Update pipeline to terminal state
  const [updated] = await sql<PipelineRow[]>`
    UPDATE pipelines
    SET
      status = ${status},
      completed_at = ${now},
      synthesis = ${sql.json(synthesis as any)},
      updated_at = ${now}
    WHERE id = ${pipelineId}
    RETURNING *
  `;

  if (!updated) {
    log.error(`Failed to complete pipeline ${pipelineId}: not found`);
    return;
  }

  await recordEvent(sql, pipelineId, "pipeline_complete", {
    status,
    summary: synthesis.summary,
  });

  await publishEvent("global", "pipeline.completed", {
    pipeline_id: pipelineId,
    session_id: updated.session_id,
    name: updated.name,
    status,
    summary: synthesis.summary,
    total_steps: synthesis.stats.total_steps,
    completed_steps: synthesis.stats.completed_steps,
    failed_steps: synthesis.stats.failed_steps,
    duration_ms: synthesis.stats.total_duration_ms,
  });

  log.info(`Pipeline ${status}: ${pipelineId} -- ${synthesis.summary}`);
}

// ============================================
// Synthesis Generation
// ============================================

/**
 * Generate a comprehensive synthesis report for a pipeline.
 *
 * Aggregates all step results, computes statistics, collects errors,
 * and builds a timeline from recorded events.
 *
 * @param pipelineId - Pipeline to synthesize
 * @returns Complete synthesis report
 */
async function generateSynthesis(pipelineId: string): Promise<PipelineSynthesis> {
  const sql = getDb();

  // Fetch pipeline metadata
  const pipeline = await getPipeline(pipelineId);
  const pipelineName = pipeline?.name ?? pipelineId;

  // Fetch all steps
  const allSteps = await sql<PipelineStepRow[]>`
    SELECT * FROM pipeline_steps
    WHERE pipeline_id = ${pipelineId}
    ORDER BY wave_number, step_order
  `;

  // Fetch all events for the timeline
  interface EventRow {
    event_type: string;
    data: Record<string, unknown>;
    created_at: string;
  }

  const events = await sql<EventRow[]>`
    SELECT event_type, data, created_at
    FROM pipeline_events
    WHERE pipeline_id = ${pipelineId}
    ORDER BY created_at ASC
  `;

  // Compute stats
  const completedSteps = allSteps.filter((s) => s.status === "completed");
  const failedSteps = allSteps.filter((s) => s.status === "failed");
  const skippedSteps = allSteps.filter((s) => s.status === "skipped");
  const totalRetries = allSteps.reduce((sum, s) => sum + s.retry_count, 0);

  const totalDurationMs = calcDurationMs(
    pipeline?.started_at,
    pipeline?.completed_at ?? nowISO(),
  );

  const agentsUsed = Array.from(new Set<string>(allSteps.map((s) => s.agent_type)));
  const skillsLoaded = Array.from(
    new Set<string>(allSteps.flatMap((s) => s.skills ?? [])),
  );

  // Aggregate files changed from step results
  const filesChanged: string[] = [];
  for (const step of allSteps) {
    const stepFiles = extractFilesFromResult(step.result);
    for (const file of stepFiles) {
      if (!filesChanged.includes(file)) {
        filesChanged.push(file);
      }
    }
  }

  // Build per-wave summaries
  const waveNumbers = Array.from(
    new Set<number>(allSteps.map((s) => s.wave_number)),
  ).sort((a, b) => a - b);

  const waves: WaveSynthesis[] = waveNumbers.map((wn) => {
    const waveSteps = allSteps.filter((s) => s.wave_number === wn);
    const waveName = pipeline?.plan?.waves.find((w) => w.number === wn)?.name ?? `Wave ${wn}`;
    const waveCompleted = waveSteps.filter((s) => s.status === "completed");
    const waveFailed = waveSteps.filter((s) => s.status === "failed");

    let waveStatus: string;
    if (waveFailed.length === 0) {
      waveStatus = "completed";
    } else if (waveCompleted.length > 0) {
      waveStatus = "partial";
    } else {
      waveStatus = "failed";
    }

    const waveDuration = waveSteps.reduce(
      (sum, s) => sum + (s.duration_ms ?? 0),
      0,
    );

    const stepSyntheses: StepSynthesis[] = waveSteps.map((s) => ({
      agent_type: s.agent_type,
      description: s.description ?? "",
      status: s.status,
      result_summary: extractSummaryFromResult(s.result),
      files_modified: extractFilesFromResult(s.result),
      duration_ms: s.duration_ms ?? 0,
      retries: s.retry_count,
      error: s.error,
    }));

    return {
      wave_number: wn,
      name: waveName,
      status: waveStatus,
      steps: stepSyntheses,
      duration_ms: waveDuration,
    };
  });

  // Collect errors
  const errors: PipelineError[] = failedSteps.map((s) => ({
    wave: s.wave_number,
    step: s.step_order,
    agent_type: s.agent_type,
    error: s.error ?? "Unknown error",
    timestamp: s.completed_at ?? s.created_at,
  }));

  // Build timeline from recorded events
  const timeline: TimelineEvent[] = events.map((e) => {
    const data: Record<string, unknown> = e.data ?? {};
    const waveVal = data["wave"];
    const stepVal = data["step"];
    const agentVal = data["agent_type"];
    const msgVal = data["message"];

    const entry: TimelineEvent = {
      timestamp: e.created_at,
      type: mapEventType(e.event_type),
      message: typeof msgVal === "string" ? msgVal : e.event_type,
    };

    if (typeof waveVal === "number") entry.wave = waveVal;
    if (typeof stepVal === "number") entry.step = stepVal;
    if (typeof agentVal === "string") entry.agent_type = agentVal;

    return entry;
  });

  // Determine overall synthesis status
  let synthesisStatus: PipelineSynthesis["status"];
  if (failedSteps.length === 0) {
    synthesisStatus = "success";
  } else if (completedSteps.length > 0) {
    synthesisStatus = "partial";
  } else {
    synthesisStatus = "failed";
  }

  // Build summary string
  const summary =
    `Pipeline ${pipelineName}: ${completedSteps.length}/${allSteps.length} steps completed` +
    (filesChanged.length > 0 ? `, ${filesChanged.length} files modified` : "") +
    ` in ${formatDuration(totalDurationMs)}`;

  const stats: PipelineStats = {
    total_waves: waveNumbers.length,
    total_steps: allSteps.length,
    completed_steps: completedSteps.length,
    failed_steps: failedSteps.length,
    skipped_steps: skippedSteps.length,
    total_retries: totalRetries,
    total_duration_ms: totalDurationMs,
    agents_used: agentsUsed,
    skills_loaded: skillsLoaded,
  };

  return {
    summary,
    status: synthesisStatus,
    waves,
    stats,
    files_changed: filesChanged,
    errors,
    timeline,
  };
}

// ============================================
// Internal Helpers
// ============================================

/**
 * Extract file paths from a step result's 'files' array.
 * Uses bracket notation for noPropertyAccessFromIndexSignature compliance.
 */
function extractFilesFromResult(result: Record<string, unknown> | null): string[] {
  if (!result) return [];
  const files = result["files"];
  if (!Array.isArray(files)) return [];

  const paths: string[] = [];
  for (const f of files) {
    if (typeof f === "string") paths.push(f);
  }
  return paths;
}

/**
 * Extract a summary string from a step result.
 * Uses bracket notation for noPropertyAccessFromIndexSignature compliance.
 */
function extractSummaryFromResult(result: Record<string, unknown> | null): string | null {
  if (!result) return null;
  const summary = result["summary"];
  return typeof summary === "string" ? summary : null;
}

/**
 * Record a pipeline event in the pipeline_events table.
 * Events are used for timeline reconstruction in the synthesis.
 */
async function recordEvent(
  sql: ReturnType<typeof getDb>,
  pipelineId: string,
  eventType: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await sql`
      INSERT INTO pipeline_events (pipeline_id, event_type, data)
      VALUES (${pipelineId}, ${eventType}, ${sql.json(data as any)})
    `;
  } catch (error) {
    log.warn(`Failed to record event '${eventType}' for pipeline ${pipelineId}:`, error);
  }
}

/**
 * Map raw event type strings to the TimelineEvent type union.
 * Falls back to 'pipeline_complete' for unrecognized types.
 */
function mapEventType(rawType: string): TimelineEvent["type"] {
  const validTypes: TimelineEvent["type"][] = [
    "pipeline_start", "wave_start", "wave_complete",
    "step_start", "step_complete", "step_fail",
    "retry", "decision", "pipeline_complete",
  ];

  if (validTypes.includes(rawType as TimelineEvent["type"])) {
    return rawType as TimelineEvent["type"];
  }

  // Map common variants generated by updateStepStatus
  if (rawType === "step_running") return "step_start";
  if (rawType === "step_failed") return "step_fail";
  if (rawType === "step_completed") return "step_complete";
  if (rawType === "step_skipped") return "step_complete";
  if (rawType === "pipeline_created") return "pipeline_start";
  if (rawType === "pipeline_paused") return "pipeline_start";

  return "pipeline_complete";
}
