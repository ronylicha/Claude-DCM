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
  const userMsg = `Tu es l'agent '${agentType}' dans un pipeline d'orchestration DCM.

INSTRUCTIONS:
1. Lis attentivement le system prompt — il contient ta tache precise
2. Travaille dans le dossier: ${workspacePath}
3. Execute la tache completement — pas de TODO, pas de placeholder, code complet et fonctionnel
4. Ne demande JAMAIS confirmation — agis directement
5. Si tu dois installer des dependances, fais-le

QUAND TU AS FINI, fournis:
- Resume de ce que tu as fait (2-3 phrases)
- Liste des fichiers crees ou modifies (chemins complets)
- Problemes rencontres (le cas echeant)`;
  await writeFile(userFile, userMsg, "utf-8");

  // Resolve full model ID
  const modelId = resolveModelId(model);

  // Build the shell script — echo pipe fixes stdin, stream-json for live output
  const script = [
    "#!/bin/bash",
    `cd "${workspacePath}"`,
    `USER_MSG=$(cat "${userFile}")`,
    `echo "" | claude -p "$USER_MSG" \\`,
    `  --system-prompt-file "${promptFile}" \\`,
    `  --model "${modelId}" \\`,
    `  --output-format stream-json \\`,
    `  > "${outputFile}" 2> "${errorFile}"`,
    `echo $? > "${doneFile}"`,
  ].join("\n");

  await writeFile(scriptFile, script, "utf-8");
  await Bun.spawn(["chmod", "+x", scriptFile]).exited;

  // Register job in DB for worker recovery
  const sql2 = getDb();
  await sql2`
    INSERT INTO pipeline_jobs (pipeline_id, step_id, job_id, job_type, tmp_dir, status)
    VALUES (${pipelineId}, ${stepId}, ${jobId}, 'executor', ${tmpDir}, 'running')
  `.catch(() => {});

  // Broadcast agent start
  await publishEvent("global", "pipeline.step.started", {
    pipeline_id: pipelineId,
    step_id: stepId,
    agent_type: agentType,
    wave_number: step.wave_number,
    model: modelId,
    job_id: jobId,
  });

  // Launch directly (systemd-run breaks the echo pipe)
  Bun.spawn(
    ["bash", scriptFile],
    { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
  );

  log.info(`Agent launched: ${agentType} job=${jobId}`);

  // Poll for completion (non-blocking, every 5s)
  const sql = getDb();
  let lastOutputSize = 0;

  const pollInterval = setInterval(async () => {
    try {
      // Stream structured output events for live dashboard viewing
      try {
        const currentOutput = await readFile(outputFile, "utf-8");
        if (currentOutput.length > lastOutputSize) {
          const newBytes = currentOutput.slice(lastOutputSize);
          lastOutputSize = currentOutput.length;

          // Parse stream-json NDJSON lines into structured events
          const events: Array<Record<string, string>> = [];
          for (const line of newBytes.split("\n")) {
            if (!line.trim()) continue;
            try {
              const raw = JSON.parse(line) as Record<string, unknown>;
              if (raw["type"] === "assistant") {
                const msg = raw["message"] as Record<string, unknown> | undefined;
                const blocks = msg?.["content"] as Array<Record<string, unknown>> | undefined;
                if (!Array.isArray(blocks)) continue;
                for (const block of blocks) {
                  const bt = block["type"] as string;
                  if (bt === "text" && block["text"]) {
                    events.push({ kind: "text", agent: agentType, content: (block["text"] as string).slice(0, 500) });
                  } else if (bt === "tool_use") {
                    const name = block["name"] as string ?? "";
                    const input = block["input"] as Record<string, unknown> ?? {};
                    const detail = String(input["file_path"] ?? input["command"] ?? input["pattern"] ?? input["skill"] ?? "").slice(0, 100);
                    events.push({ kind: "action", agent: agentType, tool: name, detail });
                  }
                }
              }
            } catch { continue; }
          }

          // Store structured events for step output modal
          for (const evt of events) {
            const chunkIdx = 10000 + step.wave_number * 1000 + step.step_order * 100 + Math.floor(lastOutputSize / 500);
            await sql`
              INSERT INTO planning_output (pipeline_id, chunk, chunk_index)
              VALUES (${pipelineId}, ${JSON.stringify(evt)}, ${chunkIdx})
      ON CONFLICT (pipeline_id, chunk_index) DO NOTHING
            `.catch(() => {});
          }

          // Broadcast for real-time dashboard
          if (events.length > 0) {
            await publishEvent("global", "pipeline.agent.output", {
              pipeline_id: pipelineId,
              step_id: stepId,
              agent_type: agentType,
              wave_number: step.wave_number,
              events,
            });
          }
        }
      } catch {
        // Output file not ready yet — normal
      }

      // Check if done
      const doneExists = await Bun.file(doneFile).exists();
      if (!doneExists) return;

      clearInterval(pollInterval);

      const exitCode = (await readFile(doneFile, "utf-8").catch(() => "1")).trim();
      const rawOutput = await readFile(outputFile, "utf-8").catch(() => "");
      const stderr = await readFile(errorFile, "utf-8").catch(() => "");

      // Extract final text from stream-json NDJSON
      let fullOutput = rawOutput;
      if (rawOutput.includes('"type":"result"')) {
        const lines = rawOutput.split("\n");
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const evt = JSON.parse(lines[i]?.trim() ?? "") as Record<string, unknown>;
            if (evt["type"] === "result" && typeof evt["result"] === "string") {
              fullOutput = evt["result"] as string;
              break;
            }
          } catch { continue; }
        }
      }

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
 * - 'running' steps: check if agent process is still alive (via /tmp/dcm-executor/*.done)
 *   If done file exists → process finished, collect result
 *   If no done file AND started > 30min ago → truly stuck, re-queue for retry
 *   Otherwise → still running, leave alone
 */
export async function recoverRunningAgents(): Promise<void> {
  log.info("Recovery: checking for orphaned running agents...");
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

  // 2. Find running steps — check if they're truly stuck (30min timeout)
  const runningSteps = await sql<PipelineStepRow[]>`
    SELECT ps.* FROM pipeline_steps ps
    JOIN pipelines p ON p.id = ps.pipeline_id
    WHERE ps.status = 'running'
      AND p.status = 'running'
  `;

  let recoveredCount = 0;
  for (const step of runningSteps) {
    const startedAt = step.started_at ? new Date(step.started_at).getTime() : 0;
    const ageMinutes = (Date.now() - startedAt) / 60000;

    // Check if any claude process is still active for this agent type
    const isActive = await checkAgentProcessAlive(step.agent_type);
    if (isActive) {
      log.debug(`Recovery: step ${step.id.slice(0, 8)} (${step.agent_type}) running for ${Math.round(ageMinutes)}min — process alive, leaving alone`);
      continue;
    }

    if (ageMinutes < 60) {
      // Under 1h and no process found — check if output files exist and are growing
      const hasActivity = await checkOutputFileActivity(step.agent_type);
      if (hasActivity) {
        log.debug(`Recovery: step ${step.id.slice(0, 8)} (${step.agent_type}) running for ${Math.round(ageMinutes)}min — output files active`);
        continue;
      }
    }

    // No process, no activity, or over 1h — truly stuck, re-queue
    log.warn(`Recovery: step ${step.id.slice(0, 8)} (${step.agent_type}) stuck for ${Math.round(ageMinutes)}min (no active process) — re-queuing`);
    await sql`
      UPDATE pipeline_steps
      SET status = 'queued', retry_count = retry_count + 1, error = NULL, started_at = NULL, completed_at = NULL
      WHERE id = ${step.id}
    `;
    recoveredCount++;
  }

  if (recoveredCount > 0 || pipelinesWithQueued.length > 0) {
    log.info(`Recovery: ${pipelinesWithQueued.length} pipeline(s) with queued steps, ${recoveredCount} agent(s) re-queued`);

    // Re-launch any re-queued steps
    if (recoveredCount > 0) {
      const affectedPipelines = new Set(runningSteps.map(s => s.pipeline_id));
      for (const pid of affectedPipelines) {
        executeQueuedSteps(pid).catch((err) => log.error(`Recovery re-launch failed for ${pid}:`, err));
      }
    }
  }
}

// ============================================
// Helpers
// ============================================

/** Check if a claude process is running for a given agent type */
async function checkAgentProcessAlive(agentType: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["pgrep", "-f", `claude.*${agentType}`], { stdout: "pipe", stderr: "ignore" });
    const code = await proc.exited;
    return code === 0;
  } catch {
    return false;
  }
}

/** Check if output files in /tmp/dcm-executor/ were modified recently (< 5min) */
async function checkOutputFileActivity(_agentType: string): Promise<boolean> {
  try {
    // Check if any .output file in executor dir was modified in last 5 minutes
    const proc = Bun.spawn(
      ["find", "/tmp/dcm-executor", "-name", "*.output", "-mmin", "-5", "-type", "f"],
      { stdout: "pipe", stderr: "ignore" },
    );
    const stdout = await new Response(proc.stdout).text();
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

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
