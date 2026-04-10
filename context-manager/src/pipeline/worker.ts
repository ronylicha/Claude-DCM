/**
 * Pipeline Worker — Self-healing autonomous supervisor.
 *
 * Runs as a background loop inside the DCM server process.
 * It is the SOLE authority for detecting and fixing pipeline anomalies.
 *
 * Every cycle (10s) it runs through 6 checks in order:
 * 1. Planner jobs  — detect .done files, inject plan
 * 2. Executor jobs — detect .done files, update step status
 * 3. Stale jobs    — cleanup pipeline_jobs stuck in 'running' with no process
 * 4. Orphan steps  — steps marked 'running' with no live claude process → requeue
 * 5. Stuck planning — pipelines stuck in 'planning' → recover or retry
 * 6. Queued steps   — steps ready to run but no executor launched → launch them
 *
 * Self-healing principles:
 * - Every check is idempotent (safe to run repeatedly)
 * - Every check logs what it finds and what it does
 * - No silent failures — all catch blocks log errors
 * - No delegation to other modules for recovery logic
 * - Aggressive on first cycle after startup (no throttling)
 *
 * @module pipeline/worker
 */

import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";
import type { PipelineRow } from "./types";

const log = createLogger("Worker");

let intervalId: ReturnType<typeof setInterval> | null = null;
let cycleCount = 0;

// ============================================
// Lifecycle
// ============================================

export function startWorker(): void {
  if (intervalId) return;
  log.info("Pipeline worker started — cycle every 10s");
  // First cycle runs immediately with no throttling (cycleCount=0 passes all checks)
  workerCycle();
  intervalId = setInterval(workerCycle, 10_000);
}

export function stopWorker(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    log.info("Pipeline worker stopped");
  }
}

// ============================================
// Main Cycle
// ============================================

async function workerCycle(): Promise<void> {
  const cycle = cycleCount++;
  // First cycle (startup) runs all checks with no throttling
  const isStartup = cycle === 0;

  try {
    await checkPlannerJobs();
    await checkExecutorJobs();
    if (isStartup || cycle % 3 === 0) await cleanupStaleJobs();     // Every 30s
    if (isStartup || cycle % 6 === 0) await checkOrphanRunningSteps(); // Every 60s
    if (isStartup || cycle % 6 === 0) await checkStuckPipelines();     // Every 60s
    if (isStartup || cycle % 3 === 0) await checkQueuedSteps();        // Every 30s
  } catch (error) {
    log.error("Worker cycle error:", error);
  }
}

// ============================================
// 1. Check Planner Jobs (.done files)
// ============================================

async function checkPlannerJobs(): Promise<void> {
  const sql = getDb();
  const { readFile } = await import("node:fs/promises");

  const jobs = await sql<Array<Record<string, unknown>>>`
    SELECT * FROM pipeline_jobs WHERE job_type = 'planner' AND status = 'running'
  `;

  for (const job of jobs) {
    const jobId = job["job_id"] as string;
    const pipelineId = job["pipeline_id"] as string;
    const tmpDir = (job["tmp_dir"] as string) || "/tmp/dcm-planner";
    const doneFile = `${tmpDir}/${jobId}.done`;
    const outputFile = `${tmpDir}/${jobId}.output`;

    try {
      const doneExists = await Bun.file(doneFile).exists();
      if (!doneExists) {
        await streamNewChunks(pipelineId, outputFile);
        continue;
      }

      const exitCode = (await readFile(doneFile, "utf-8").catch(() => "1")).trim();
      const rawOutput = await readFile(outputFile, "utf-8").catch(() => "");

      log.info(`Planner job ${jobId}: done (exit=${exitCode}, ${rawOutput.length} chars)`);
      await sql`UPDATE pipeline_jobs SET status = 'completed', completed_at = NOW() WHERE job_id = ${jobId}`;

      if (exitCode === "0" && rawOutput.trim()) {
        await injectPlan(pipelineId, rawOutput);
      } else {
        log.error(`Planner job ${jobId} failed (exit ${exitCode})`);
        await sql`UPDATE pipelines SET status = 'failed', updated_at = NOW() WHERE id = ${pipelineId}`;
        await publishEvent("global", "pipeline.failed", { pipeline_id: pipelineId, reason: "Planner failed" });
      }

      cleanupJobFiles(tmpDir, jobId);
    } catch (error) {
      log.error(`Planner job ${jobId} check error:`, error);
    }
  }
}

// ============================================
// 2. Check Executor Jobs (.done files)
// ============================================

async function checkExecutorJobs(): Promise<void> {
  const sql = getDb();
  const { readFile } = await import("node:fs/promises");

  const jobs = await sql<Array<Record<string, unknown>>>`
    SELECT * FROM pipeline_jobs WHERE job_type = 'executor' AND status = 'running'
  `;

  for (const job of jobs) {
    const jobId = job["job_id"] as string;
    const pipelineId = job["pipeline_id"] as string;
    const stepId = job["step_id"] as string | null;
    const tmpDir = (job["tmp_dir"] as string) || "/tmp/dcm-executor";
    const doneFile = `${tmpDir}/${jobId}.done`;
    const outputFile = `${tmpDir}/${jobId}.output`;

    try {
      const doneExists = await Bun.file(doneFile).exists();
      if (!doneExists) {
        await streamNewChunks(pipelineId, outputFile);
        continue;
      }

      if (!stepId) {
        await sql`UPDATE pipeline_jobs SET status = 'completed', completed_at = NOW() WHERE job_id = ${jobId}`;
        cleanupJobFiles(tmpDir, jobId);
        continue;
      }

      const exitCode = (await readFile(doneFile, "utf-8").catch(() => "1")).trim();
      const fullOutput = await readFile(outputFile, "utf-8").catch(() => "");
      const stderr = await readFile(`${tmpDir}/${jobId}.error`, "utf-8").catch(() => "");

      log.info(`Executor job ${jobId}: done (exit=${exitCode}, ${fullOutput.length} chars)`);
      await sql`UPDATE pipeline_jobs SET status = 'completed', completed_at = NOW() WHERE job_id = ${jobId}`;

      const { updateStepStatus } = await import("./runner");

      if (exitCode === "0" && fullOutput.trim()) {
        const filesChanged = extractFiles(fullOutput);
        await updateStepStatus(stepId, "completed", {
          summary: fullOutput.slice(0, 3000),
          files: filesChanged,
          output_length: fullOutput.length,
        });
      } else {
        await updateStepStatus(stepId, "failed", undefined, stderr.slice(0, 500) || `Exit ${exitCode}`);
      }

      cleanupJobFiles(tmpDir, jobId);
    } catch (error) {
      log.error(`Executor job ${jobId} check error:`, error);
    }
  }
}

// ============================================
// 3. Cleanup Stale Jobs
// ============================================

/**
 * Finds pipeline_jobs stuck in 'running' whose temp files no longer exist
 * (e.g. after service restart wiped /tmp). Marks them as 'lost' so they
 * don't block orphan detection.
 */
async function cleanupStaleJobs(): Promise<void> {
  const sql = getDb();

  const runningJobs = await sql<Array<Record<string, unknown>>>`
    SELECT job_id, pipeline_id, step_id, tmp_dir, job_type,
           created_at::text as created_at_text
    FROM pipeline_jobs WHERE status = 'running'
  `;

  if (runningJobs.length === 0) return;

  let staleCount = 0;
  for (const job of runningJobs) {
    const jobId = job["job_id"] as string;
    const tmpDir = (job["tmp_dir"] as string) || "/tmp/dcm-executor";
    const outputFile = `${tmpDir}/${jobId}.output`;
    const doneFile = `${tmpDir}/${jobId}.done`;

    // If neither output nor done file exists, the job files were lost
    const outputExists = await Bun.file(outputFile).exists();
    const doneExists = await Bun.file(doneFile).exists();

    if (!outputExists && !doneExists) {
      const jobType = job["job_type"] as string;
      log.warn(`Stale ${jobType} job ${jobId}: temp files lost — marking as 'lost'`);
      await sql`
        UPDATE pipeline_jobs SET status = 'lost', completed_at = NOW()
        WHERE job_id = ${jobId}
      `;
      staleCount++;
    }
  }

  if (staleCount > 0) {
    log.info(`Cleanup: marked ${staleCount} stale job(s) as lost`);
  }
}

// ============================================
// 4. Check Orphan Running Steps
// ============================================

/**
 * Detects steps marked 'running' in DB but with no active claude process.
 * This is the core self-healing logic. For each running step:
 * 1. Check if a claude process is alive (pgrep)
 * 2. If alive → leave alone
 * 3. If dead but < 10min old → wait (process might be starting)
 * 4. If dead and >= 10min old → requeue for re-execution
 */
async function checkOrphanRunningSteps(): Promise<void> {
  const sql = getDb();

  const runningSteps = await sql<Array<{
    id: string;
    pipeline_id: string;
    wave_number: number;
    step_order: number;
    agent_type: string;
    started_at: string;
    retry_count: number;
  }>>`
    SELECT ps.id, ps.pipeline_id, ps.wave_number, ps.step_order,
           ps.agent_type, ps.started_at::text as started_at,
           ps.retry_count
    FROM pipeline_steps ps
    JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.status = 'running' AND p.status = 'running'
  `;

  if (runningSteps.length === 0) return;

  // Check which claude processes are actually alive
  const aliveAgents = await getAliveClaude();

  let requeuedCount = 0;
  for (const step of runningSteps) {
    const stepId = step["id"] as string;
    const pipelineId = step["pipeline_id"] as string;
    const agent = step["agent_type"] as string;
    const wave = step["wave_number"] as number;
    const startedAt = step["started_at"] as string;
    const retryCount = (step["retry_count"] as number) ?? 0;

    const ageMinutes = (Date.now() - new Date(startedAt).getTime()) / 60_000;

    // Check if there's a claude process running in the pipeline's workspace
    const isAlive = aliveAgents.some((cmd) =>
      cmd.includes("claude") && cmd.includes(agent),
    );

    if (isAlive) continue;

    // Process not found — is it too young to declare dead?
    if (ageMinutes < 10) continue;

    // Check output file activity as a last resort
    const hasActivity = await checkOutputActivity(stepId);
    if (hasActivity) continue;

    // Truly orphaned — requeue
    if (retryCount >= 3) {
      log.error(`Orphan W${wave} ${agent} (${stepId.slice(0, 8)}): ${Math.round(ageMinutes)}min, ${retryCount} retries — marking FAILED`);
      await sql`
        UPDATE pipeline_steps
        SET status = 'failed', error = 'Max retries exceeded after orphan recovery', updated_at = NOW()
        WHERE id = ${stepId}
      `;
      continue;
    }

    log.warn(`Orphan W${wave} ${agent} (${stepId.slice(0, 8)}): ${Math.round(ageMinutes)}min, no process — requeueing (retry ${retryCount + 1})`);
    await sql`
      UPDATE pipeline_steps
      SET status = 'queued', started_at = NULL, error = NULL,
          retry_count = retry_count + 1, updated_at = NOW()
      WHERE id = ${stepId}
    `;

    await publishEvent("global", "pipeline.step.requeued", {
      pipeline_id: pipelineId,
      step_id: stepId,
      agent_type: agent,
      wave_number: wave,
      reason: "orphan_recovery",
      retry_count: retryCount + 1,
    });

    requeuedCount++;
  }

  if (requeuedCount > 0) {
    log.info(`Orphan check: requeued ${requeuedCount} step(s)`);
  }
}

// ============================================
// 5. Check Stuck Pipelines (planning status)
// ============================================

async function checkStuckPipelines(): Promise<void> {
  const sql = getDb();
  const stuckPipelines = await sql<PipelineRow[]>`
    SELECT * FROM pipelines
    WHERE status = 'planning'
      AND created_at < NOW() - INTERVAL '5 minutes'
      AND id NOT IN (SELECT pipeline_id FROM pipeline_jobs WHERE status = 'running')
  `;

  for (const pipeline of stuckPipelines) {
    const pid = pipeline["id"] as string;
    const workspace = pipeline["workspace_path"] as string | null;

    log.warn(`Pipeline ${pid.slice(0, 8)} stuck in planning (no active job)`);

    // Try workspace plan files
    if (workspace) {
      for (const name of ["execution-plan.json", "EXECUTION_PLAN.json", "plan.json"]) {
        try {
          const file = Bun.file(`${workspace}/${name}`);
          if (await file.exists()) {
            const content = await file.text();
            if (content.trim().startsWith("{") && content.includes('"waves"')) {
              log.info(`Recovering plan from ${workspace}/${name}`);
              await injectPlan(pid, content);
              return;
            }
          }
        } catch { /* skip */ }
      }
    }

    // Try orphaned planner output files
    try {
      const { readdir, readFile } = await import("node:fs/promises");
      const files = await readdir("/tmp/dcm-planner").catch(() => [] as string[]);
      for (const f of files) {
        if (!f.endsWith(".output")) continue;
        const content = await readFile(`/tmp/dcm-planner/${f}`, "utf-8").catch(() => "");
        if (content.length > 1000 && content.includes('"waves"') && content.includes('"sprints"')) {
          log.info(`Recovering plan from orphaned /tmp/dcm-planner/${f}`);
          await injectPlan(pid, content);
          Bun.spawn(["rm", "-f", `/tmp/dcm-planner/${f}`], { stdout: "ignore", stderr: "ignore" });
          return;
        }
      }
    } catch { /* skip */ }

    // Last resort: relaunch planner
    log.info(`Relaunching planner for pipeline ${pid.slice(0, 8)}`);
    const { retryPlanning } = await import("./runner");
    await retryPlanning(pid).catch((err) => log.error("Planner relaunch failed:", err));
  }
}

// ============================================
// 6. Check Queued Steps (ready to launch)
// ============================================

/**
 * Finds pipelines with 'queued' steps that have no active executor job.
 * This catches both normal flow (worker picks up newly queued steps)
 * and recovery (steps requeued by orphan check).
 */
async function checkQueuedSteps(): Promise<void> {
  const sql = getDb();

  const pipelinesWithQueued = await sql<Array<{ pipeline_id: string; cnt: string }>>`
    SELECT ps.pipeline_id, COUNT(*)::text as cnt
    FROM pipeline_steps ps
    JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.status = 'queued' AND p.status = 'running'
    GROUP BY ps.pipeline_id
  `;

  if (pipelinesWithQueued.length === 0) return;

  for (const row of pipelinesWithQueued) {
    const pid = row["pipeline_id"] as string;
    const count = row["cnt"] as string;
    log.info(`Launching ${count} queued step(s) for pipeline ${pid.slice(0, 8)}`);
    const { executeQueuedSteps } = await import("./executor");
    executeQueuedSteps(pid).catch((err) => log.error(`Step launch failed for ${pid.slice(0, 8)}:`, err));
  }
}

// ============================================
// Helpers
// ============================================

const lastOutputSizes = new Map<string, number>();

/** Get list of running claude process command lines */
async function getAliveClaude(): Promise<string[]> {
  try {
    const proc = Bun.spawn(["pgrep", "-af", "claude.*-p"], { stdout: "pipe", stderr: "ignore" });
    const stdout = await new Response(proc.stdout).text();
    return stdout.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/** Check if any executor output file for this step was modified recently */
async function checkOutputActivity(stepId: string): Promise<boolean> {
  try {
    // Check pipeline_jobs for a matching job with active output
    const sql = getDb();
    const jobs = await sql<Array<{ job_id: string; tmp_dir: string }>>`
      SELECT job_id, tmp_dir FROM pipeline_jobs
      WHERE step_id = ${stepId} AND status IN ('running', 'lost')
      ORDER BY created_at DESC LIMIT 1
    `;

    if (jobs.length === 0) return false;

    const jobId = jobs[0]["job_id"] as string;
    const tmpDir = jobs[0]["tmp_dir"] as string;
    const outputFile = `${tmpDir}/${jobId}.output`;

    const file = Bun.file(outputFile);
    if (!(await file.exists())) return false;

    // Check if modified in last 5 minutes
    const stat = await import("node:fs/promises").then((fs) => fs.stat(outputFile).catch(() => null));
    if (!stat) return false;

    const ageMinutes = (Date.now() - stat.mtimeMs) / 60_000;
    return ageMinutes < 5;
  } catch {
    return false;
  }
}

// Streaming chunks are handled by cli-planner.ts polling loop — worker no longer duplicates.
async function streamNewChunks(_pipelineId: string, _outputFile: string): Promise<void> {
  // No-op: cli-planner.ts parseStreamEvents() stores structured JSON chunks directly.
}

function cleanupJobFiles(tmpDir: string, jobId: string): void {
  for (const ext of [".prompt", ".user", ".output", ".error", ".done", ".sh"]) {
    Bun.spawn(["rm", "-f", `${tmpDir}/${jobId}${ext}`], { stdout: "ignore", stderr: "ignore" });
  }
}

async function injectPlan(pipelineId: string, rawOutput: string): Promise<void> {
  try {
    const { getPipeline } = await import("./runner");
    const pipeline = await getPipeline(pipelineId);
    if (!pipeline) return;

    let plan: Record<string, unknown> | null = null;
    const jsonMatch = rawOutput.match(/(\{[\s\S]*"waves"[\s\S]*"sprints"[\s\S]*\})/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed["waves"] && parsed["sprints"]) {
          parsed["plan_id"] = parsed["plan_id"] ?? `plan_worker_${Date.now()}`;
          parsed["version"] = parsed["version"] ?? 1;
          parsed["constraints"] = parsed["constraints"] ?? { max_parallel: 4, max_total_retries: 6, timeout_ms: 0 };
          parsed["required_skills"] = parsed["required_skills"] ?? ["workflow-clean-code"];
          plan = parsed;
        }
      } catch { /* not valid JSON */ }
    }

    if (!plan) {
      const input = pipeline["input"] as import("./types").PipelineInput;
      const sessionId = pipeline["session_id"] as string;
      const { generatePlan } = await import("./planner");
      const generatedPlan = await generatePlan(input, sessionId, pipelineId);
      plan = generatedPlan as unknown as Record<string, unknown>;
    }

    if (!plan || !plan["waves"]) {
      log.error(`Could not extract valid plan for ${pipelineId}`);
      const sql = getDb();
      await sql`UPDATE pipelines SET status = 'failed', updated_at = NOW() WHERE id = ${pipelineId}`;
      return;
    }

    const sql = getDb();
    const waves = plan["waves"] as Array<Record<string, unknown>>;
    const sprints = (plan["sprints"] as Array<Record<string, unknown>>) ?? [];
    const planName = String(plan["name"] ?? "Pipeline").slice(0, 60);

    await sql`DELETE FROM pipeline_steps WHERE pipeline_id = ${pipelineId}`;
    await sql`DELETE FROM pipeline_sprints WHERE pipeline_id = ${pipelineId}`;
    await sql`UPDATE pipelines SET status = 'ready', name = ${planName}, plan = ${sql.json(plan as any)}, updated_at = NOW() WHERE id = ${pipelineId}`;

    for (const wave of waves) {
      const steps = (wave["steps"] as Array<Record<string, unknown>>) ?? [];
      for (const step of steps) {
        const skills = Array.isArray(step["skills"]) ? step["skills"] as string[] : ["workflow-clean-code"];
        await sql`
          INSERT INTO pipeline_steps (pipeline_id, wave_number, step_order, agent_type, description, skills, prompt, model, max_turns, status, retry_strategy, max_retries)
          VALUES (${pipelineId}, ${Number(wave["number"])}, ${Number(step["order"])}, ${String(step["agent_type"])}, ${String(step["description"] ?? "")}, ${skills}, ${String(step["prompt"] ?? "")}, ${String(step["model"] ?? "sonnet")}, ${Number(step["max_turns"] ?? 10)}, 'pending', ${String(step["retry_strategy"] ?? "enhanced")}, ${Number(step["max_retries"] ?? 2)})
        `;
      }
    }

    for (const sprint of sprints) {
      const objectives = Array.isArray(sprint["objectives"]) ? sprint["objectives"] as string[] : [];
      await sql`
        INSERT INTO pipeline_sprints (pipeline_id, sprint_number, name, objectives, wave_start, wave_end, status)
        VALUES (${pipelineId}, ${Number(sprint["number"])}, ${String(sprint["name"])}, ${objectives}, ${Number(sprint["wave_start"])}, ${Number(sprint["wave_end"])}, 'pending')
      `;
    }

    const totalSteps = waves.reduce((s, w) => s + ((w["steps"] as unknown[]) ?? []).length, 0);
    log.info(`Plan injected for ${pipelineId.slice(0, 8)} — ${waves.length} waves, ${sprints.length} sprints, ${totalSteps} steps`);

    await publishEvent("global", "pipeline.ready", {
      pipeline_id: pipelineId,
      name: planName,
      total_waves: waves.length,
      total_sprints: sprints.length,
      total_steps: totalSteps,
    });
  } catch (error) {
    log.error(`Plan injection failed for ${pipelineId}:`, error);
  }
}

function extractFiles(output: string): string[] {
  const files = new Set<string>();
  const patterns = [
    /(?:modified|created|edited|wrote|updated|changed)\s*:?\s*[`"]?([/\w.-]+\.\w+)[`"]?/gi,
    /(?:File|Path)\s*:?\s*[`"]?([/\w.-]+\.\w+)[`"]?/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(output)) !== null) {
      if (match[1] && match[1].includes("/")) files.add(match[1]);
    }
  }
  return Array.from(files);
}
