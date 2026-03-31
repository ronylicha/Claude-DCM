/**
 * Pipeline Executor — Launches Claude CLI agents for queued steps.
 *
 * The executor is the "brain" that actually runs the pipeline:
 * 1. Finds queued steps for the current wave
 * 2. Launches each as a detached `claude -p` process in the workspace
 * 3. Streams agent output to DB for live dashboard viewing
 * 4. When an agent finishes, updates the step status
 * 5. Calls evaluateWaveProgress to advance to next wave
 *
 * All processes run in systemd scopes — they survive service restarts.
 *
 * @module pipeline/executor
 */

import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";
import type { PipelineRow, PipelineStepRow } from "./types";
import { updateStepStatus, getPipeline } from "./runner";

const log = createLogger("Executor");

// ============================================
// Main Entry: Execute Queued Steps
// ============================================

/**
 * Execute all queued steps for a pipeline's current wave.
 * Called by startPipeline and evaluateWaveProgress when a new wave begins.
 * Launches agents in parallel (within the same wave).
 */
export async function executeQueuedSteps(pipelineId: string): Promise<void> {
  const sql = getDb();

  const pipeline = await getPipeline(pipelineId);
  if (!pipeline || pipeline.status !== "running") {
    log.warn(`executeQueuedSteps: pipeline ${pipelineId} not running (${pipeline?.status})`);
    return;
  }

  const workspacePath = (pipeline["workspace_path"] as string) || "/tmp";

  // Get all queued steps for this pipeline
  const queuedSteps = await sql<PipelineStepRow[]>`
    SELECT * FROM pipeline_steps
    WHERE pipeline_id = ${pipelineId} AND status = 'queued'
    ORDER BY wave_number, step_order
  `;

  if (queuedSteps.length === 0) {
    log.debug(`No queued steps for pipeline ${pipelineId}`);
    return;
  }

  log.info(`Executing ${queuedSteps.length} queued step(s) for pipeline ${pipelineId} (wave ${pipeline.current_wave})`);

  // Launch all queued steps in parallel (within the same wave)
  for (const step of queuedSteps) {
    launchAgent(pipelineId, step, workspacePath).catch((error) => {
      log.error(`Failed to launch agent for step ${step.id}:`, error);
    });
  }
}

// ============================================
// Agent Launcher
// ============================================

/**
 * Launch a single agent via Claude CLI in the workspace directory.
 * Runs in a detached systemd scope so it survives service restarts.
 * Polls the output file for live streaming and completion.
 */
async function launchAgent(
  pipelineId: string,
  step: PipelineStepRow,
  workspacePath: string,
): Promise<void> {
  const { writeFile, readFile } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");

  const jobId = randomUUID().slice(0, 8);
  const tmpDir = "/tmp/dcm-executor";
  await Bun.spawn(["mkdir", "-p", tmpDir]).exited;

  const stepId = step.id;
  const agentType = step.agent_type;
  const prompt = step.prompt ?? step.description ?? "Execute the task";
  const model = step.model ?? "sonnet";

  log.info(`Agent launch: step=${stepId.slice(0, 8)} agent=${agentType} model=${model} job=${jobId}`);

  // Mark step as running
  await updateStepStatus(stepId, "running");

  // Write the agent prompt to a temp file
  const promptFile = `${tmpDir}/${jobId}.prompt`;
  const outputFile = `${tmpDir}/${jobId}.output`;
  const errorFile = `${tmpDir}/${jobId}.error`;
  const doneFile = `${tmpDir}/${jobId}.done`;
  const scriptFile = `${tmpDir}/${jobId}.sh`;
  const userFile = `${tmpDir}/${jobId}.user`;

  await writeFile(promptFile, prompt, "utf-8");

  // Build the user message for the agent
  const userMsg = `You are agent '${agentType}'. Execute the task described in the system prompt. Work in directory: ${workspacePath}. When done, summarize what you changed and list files modified.`;
  await writeFile(userFile, userMsg, "utf-8");

  // Resolve full model ID
  const modelId = resolveModelId(model);

  // Build the shell script (avoids escaping issues)
  const script = [
    "#!/bin/bash",
    `cd "${workspacePath}"`,
    `USER_MSG=$(cat "${userFile}")`,
    `claude -p "$USER_MSG" \\`,
    `  --system-prompt-file "${promptFile}" \\`,
    `  --model "${modelId}" \\`,
    `  --output-format text \\`,
    `  > "${outputFile}" 2> "${errorFile}"`,
    `echo $? > "${doneFile}"`,
  ].join("\n");

  await writeFile(scriptFile, script, "utf-8");
  await Bun.spawn(["chmod", "+x", scriptFile]).exited;

  // Broadcast agent start
  await publishEvent("global", "pipeline.step.started", {
    pipeline_id: pipelineId,
    step_id: stepId,
    agent_type: agentType,
    wave_number: step.wave_number,
    model: modelId,
    job_id: jobId,
  });

  // Launch in detached systemd scope (survives service restarts)
  Bun.spawn(
    ["systemd-run", "--user", "--scope", "--", "bash", scriptFile],
    { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
  );

  log.info(`Agent launched: ${agentType} job=${jobId}`);

  // Poll for completion (non-blocking, every 5s)
  const sql = getDb();
  let lastOutputSize = 0;

  const pollInterval = setInterval(async () => {
    try {
      // Stream new output chunks to DB for live viewing
      try {
        const currentOutput = await readFile(outputFile, "utf-8");
        if (currentOutput.length > lastOutputSize) {
          const newChunk = currentOutput.slice(lastOutputSize);
          lastOutputSize = currentOutput.length;

          // Store in planning_output for dashboard live view
          // Use high chunk_index so it doesn't collide with planner chunks
          const chunkIdx = 10000 + step.wave_number * 1000 + step.step_order * 100 + Math.floor(lastOutputSize / 500);
          await sql`
            INSERT INTO planning_output (pipeline_id, chunk, chunk_index)
            VALUES (${pipelineId}, ${`[${agentType}] ${newChunk}`}, ${chunkIdx})
          `.catch(() => {});

          await publishEvent("global", "pipeline.agent.output", {
            pipeline_id: pipelineId,
            step_id: stepId,
            agent_type: agentType,
            wave_number: step.wave_number,
            chunk: newChunk.slice(0, 1000),
          });
        }
      } catch {
        // Output file not ready yet — normal
      }

      // Check if done
      const doneExists = await Bun.file(doneFile).exists();
      if (!doneExists) return;

      clearInterval(pollInterval);

      const exitCode = (await readFile(doneFile, "utf-8").catch(() => "1")).trim();
      const fullOutput = await readFile(outputFile, "utf-8").catch(() => "");
      const stderr = await readFile(errorFile, "utf-8").catch(() => "");

      // Cleanup temp files
      for (const f of [promptFile, userFile, scriptFile, outputFile, errorFile, doneFile]) {
        Bun.spawn(["rm", "-f", f], { stdout: "ignore", stderr: "ignore" });
      }

      if (exitCode === "0" && fullOutput.trim()) {
        const filesChanged = extractFilesFromOutput(fullOutput);
        log.info(`Agent completed: ${agentType} job=${jobId} (${fullOutput.length} chars, ${filesChanged.length} files)`);

        await updateStepStatus(stepId, "completed", {
          summary: fullOutput.slice(0, 3000),
          files: filesChanged,
          output_length: fullOutput.length,
        });
      } else {
        const errorMsg = stderr.slice(0, 500) || `Agent exited with code ${exitCode}`;
        log.error(`Agent failed: ${agentType} job=${jobId}: ${errorMsg}`);
        await updateStepStatus(stepId, "failed", undefined, errorMsg);
      }
    } catch (error) {
      clearInterval(pollInterval);
      log.error(`Agent poll error for ${agentType} job=${jobId}:`, error);
      await updateStepStatus(stepId, "failed", undefined, error instanceof Error ? error.message : "Poll error").catch(() => {});
    }
  }, 5000);
}

// ============================================
// Recovery
// ============================================

/**
 * On startup, recover pipelines with queued or running steps:
 * - 'queued' steps: re-launch them (they never started)
 * - 'running' steps (old): mark as failed for retry
 */
export async function recoverRunningAgents(): Promise<void> {
  const sql = getDb();

  // 1. Find running pipelines with queued steps (executor died before launching)
  const pipelinesWithQueued = await sql<Array<{ pipeline_id: string }>>`
    SELECT DISTINCT ps.pipeline_id FROM pipeline_steps ps
    JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.status = 'queued' AND p.status = 'running'
  `;

  for (const row of pipelinesWithQueued) {
    const pid = row["pipeline_id"] as string;
    log.info(`Recovery: re-launching queued agents for pipeline ${pid.slice(0, 8)}`);
    executeQueuedSteps(pid).catch((err) => log.error(`Recovery execute failed for ${pid}:`, err));
  }

  // 2. Find stuck running steps (agent process died)
  const stuck = await sql<PipelineStepRow[]>`
    SELECT ps.* FROM pipeline_steps ps
    JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.status = 'running'
      AND p.status = 'running'
      AND ps.started_at < NOW() - INTERVAL '5 minutes'
  `;

  if (stuck.length === 0 && pipelinesWithQueued.length === 0) return;

  for (const step of stuck) {
    log.warn(`Recovery: marking step ${step.id.slice(0, 8)} (${step.agent_type}) as failed for retry`);
    await updateStepStatus(
      step.id,
      "failed",
      undefined,
      "Agent process lost after service restart",
    ).catch(() => {});
  }

  log.info(`Recovery: ${pipelinesWithQueued.length} pipeline(s) with queued steps, ${stuck.length} stuck agent(s)`);
}

// ============================================
// Helpers
// ============================================

/** Resolve short model name to full Claude model ID */
function resolveModelId(model: string): string {
  if (model.startsWith("claude-")) return model;
  switch (model) {
    case "opus": return "claude-opus-4-6";
    case "sonnet": return "claude-sonnet-4-6";
    case "haiku": return "claude-haiku-4-5-20251001";
    default: return `claude-${model}`;
  }
}

/** Extract file paths from agent output text */
function extractFilesFromOutput(output: string): string[] {
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
