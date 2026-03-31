/**
 * Pipeline Worker — Intelligent job supervisor.
 *
 * Runs as a background loop inside the DCM server process.
 * Every 10 seconds it:
 * 1. Checks for planner jobs whose .done file appeared → parses and injects plan
 * 2. Checks for executor jobs whose .done file appeared → updates step status
 * 3. Checks for stuck pipelines in 'planning' → recovers from workspace files
 * 4. Checks for queued steps without active processes → relaunches them
 *
 * This replaces the fragile setInterval pollers inside CLIPlannerProvider
 * and executor.ts with a single resilient supervisor loop.
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

/** Start the worker loop (called from server startup) */
export function startWorker(): void {
  if (intervalId) return;
  log.info("Pipeline worker started — cycle every 10s");
  workerCycle();
  intervalId = setInterval(workerCycle, 10_000);
}

/** Stop the worker loop */
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
  cycleCount++;
  try {
    await checkPlannerJobs();
    await checkExecutorJobs();
    await checkStuckPipelines();
    await checkQueuedSteps();
  } catch (error) {
    log.error("Worker cycle error:", error);
  }
}

// ============================================
// 1. Check Planner Jobs
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

      // Cleanup temp files
      for (const ext of [".prompt", ".user", ".output", ".error", ".done", ".sh"]) {
        Bun.spawn(["rm", "-f", `${tmpDir}/${jobId}${ext}`], { stdout: "ignore", stderr: "ignore" });
      }
    } catch (error) {
      log.error(`Worker: planner job ${jobId} check error:`, error);
    }
  }
}

// ============================================
// 2. Check Executor Jobs
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

      if (!stepId) continue;

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

      for (const ext of [".prompt", ".user", ".output", ".error", ".done", ".sh"]) {
        Bun.spawn(["rm", "-f", `${tmpDir}/${jobId}${ext}`], { stdout: "ignore", stderr: "ignore" });
      }
    } catch (error) {
      log.error(`Worker: executor job ${jobId} check error:`, error);
    }
  }
}

// ============================================
// 3. Check Stuck Pipelines
// ============================================

async function checkStuckPipelines(): Promise<void> {
  if (cycleCount % 6 !== 0) return; // Every 60s

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

    log.warn(`Worker: pipeline ${pid.slice(0, 8)} stuck in planning (no active job)`);

    // Check workspace for plan JSON files
    if (workspace) {
      for (const name of ["execution-plan.json", "EXECUTION_PLAN.json", "plan.json"]) {
        try {
          const file = Bun.file(`${workspace}/${name}`);
          if (await file.exists()) {
            const content = await file.text();
            if (content.trim().startsWith("{") && content.includes('"waves"')) {
              log.info(`Worker: recovering plan from ${workspace}/${name}`);
              await injectPlan(pid, content);
              return;
            }
          }
        } catch { /* skip */ }
      }
    }

    // Check /tmp/dcm-planner/ for orphaned outputs
    try {
      const { readdir, readFile } = await import("node:fs/promises");
      const files = await readdir("/tmp/dcm-planner").catch(() => [] as string[]);
      for (const f of files) {
        if (!f.endsWith(".output")) continue;
        const content = await readFile(`/tmp/dcm-planner/${f}`, "utf-8").catch(() => "");
        if (content.length > 1000 && content.includes('"waves"') && content.includes('"sprints"')) {
          log.info(`Worker: recovering plan from orphaned /tmp/dcm-planner/${f}`);
          await injectPlan(pid, content);
          // Clean the orphaned file
          Bun.spawn(["rm", "-f", `/tmp/dcm-planner/${f}`], { stdout: "ignore", stderr: "ignore" });
          return;
        }
      }
    } catch { /* skip */ }

    // Last resort: relaunch planner
    log.info(`Worker: relaunching planner for pipeline ${pid.slice(0, 8)}`);
    const { retryPlanning } = await import("./runner");
    await retryPlanning(pid).catch((err) => log.error("Relaunch failed:", err));
  }
}

// ============================================
// 4. Check Queued Steps
// ============================================

async function checkQueuedSteps(): Promise<void> {
  if (cycleCount % 3 !== 0) return; // Every 30s

  const sql = getDb();
  const pipelinesWithQueued = await sql<Array<{ pipeline_id: string }>>`
    SELECT DISTINCT ps.pipeline_id FROM pipeline_steps ps
    JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.status = 'queued' AND p.status = 'running'
    AND ps.pipeline_id NOT IN (
      SELECT pipeline_id FROM pipeline_jobs WHERE job_type = 'executor' AND status = 'running'
    )
  `;

  for (const row of pipelinesWithQueued) {
    const pid = row["pipeline_id"] as string;
    log.info(`Worker: relaunching queued steps for pipeline ${pid.slice(0, 8)}`);
    const { executeQueuedSteps } = await import("./executor");
    executeQueuedSteps(pid).catch((err) => log.error(`Worker relaunch failed:`, err));
  }
}

// ============================================
// Helpers
// ============================================

const lastOutputSizes = new Map<string, number>();

async function streamNewChunks(pipelineId: string, outputFile: string): Promise<void> {
  try {
    const { readFile } = await import("node:fs/promises");
    const content = await readFile(outputFile, "utf-8").catch(() => "");
    const lastSize = lastOutputSizes.get(outputFile) ?? 0;

    if (content.length > lastSize && content.length > 0) {
      const newChunk = content.slice(lastSize);
      lastOutputSizes.set(outputFile, content.length);

      const sql = getDb();
      const chunkIndex = Math.floor(content.length / 200);
      await sql`
        INSERT INTO planning_output (pipeline_id, chunk, chunk_index)
        VALUES (${pipelineId}, ${newChunk.slice(0, 5000)}, ${chunkIndex})
      `.catch(() => {});

      await publishEvent("global", "pipeline.planning.chunk", {
        pipeline_id: pipelineId,
        chunk: newChunk.slice(0, 1000),
        chunk_index: chunkIndex,
      });
    }
  } catch { /* ignore */ }
}

async function injectPlan(pipelineId: string, rawOutput: string): Promise<void> {
  try {
    const { getPipeline } = await import("./runner");
    const pipeline = await getPipeline(pipelineId);
    if (!pipeline) return;

    // Extract JSON from any format
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
      // Try post-processor LLM
      const input = pipeline["input"] as import("./types").PipelineInput;
      const sessionId = pipeline["session_id"] as string;
      const { generatePlan } = await import("./planner");
      const generatedPlan = await generatePlan(input, sessionId, pipelineId);
      plan = generatedPlan as unknown as Record<string, unknown>;
    }

    if (!plan || !plan["waves"]) {
      log.error(`Worker: could not extract valid plan for ${pipelineId}`);
      const sql = getDb();
      await sql`UPDATE pipelines SET status = 'failed', updated_at = NOW() WHERE id = ${pipelineId}`;
      return;
    }

    // Inject into DB
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
    log.info(`Worker: plan injected for ${pipelineId.slice(0, 8)} — ${waves.length} waves, ${sprints.length} sprints, ${totalSteps} steps`);

    await publishEvent("global", "pipeline.ready", {
      pipeline_id: pipelineId,
      name: planName,
      total_waves: waves.length,
      total_sprints: sprints.length,
      total_steps: totalSteps,
    });
  } catch (error) {
    log.error(`Worker: plan injection failed for ${pipelineId}:`, error);
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
