/**
 * Project Analyzer — Automatic codebase exploration and epic/pipeline generation.
 *
 * Spawns a Claude CLI process in the project's working directory to produce a
 * structured JSON analysis of the codebase. The analysis is then used to:
 *   - Create a pipeline linked to the project (status='ready')
 *   - Create project epics from completed, in-progress, and planned features
 *   - Update the project's description and analyze_status in metadata
 *
 * @module pipeline/project-analyzer
 */

import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("ProjectAnalyzer");

// ============================================
// Types
// ============================================

interface ProjectRow {
  id: string;
  path: string;
  name: string | null;
  description: string | null;
  metadata: Record<string, unknown>;
}

interface FeatureEntry {
  title: string;
  description: string;
  files: string[];
}

interface AnalysisReport {
  project_summary: string;
  tech_stack: string[];
  completed_features: FeatureEntry[];
  in_progress_features: FeatureEntry[];
  planned_features: FeatureEntry[];
  architecture: {
    patterns: string[];
    entry_points: string[];
  };
}

// ============================================
// System Prompt
// ============================================

const ANALYZER_SYSTEM_PROMPT = `Tu es un analyste de codebase expert. Explore le projet dans le repertoire courant et produis un rapport JSON.

WORKFLOW :
1. Lis les fichiers cles : package.json, README, config files, entry points
2. Explore la structure des dossiers (ls, find)
3. Identifie les features implementees, en cours, et planifiees
4. Produis le JSON

IMPORTANT :
- Reponds UNIQUEMENT avec du JSON valide
- Commence par { et termine par }
- Sois exhaustif dans l'identification des features

FORMAT :
{
  "project_summary": "string",
  "tech_stack": ["string"],
  "completed_features": [{"title":"string","description":"string","files":["string"]}],
  "in_progress_features": [{"title":"string","description":"string","files":["string"]}],
  "planned_features": [{"title":"string","description":"string","files":["string"]}],
  "architecture": {"patterns":["string"],"entry_points":["string"]}
}`;

// ============================================
// Main: analyzeProject
// ============================================

/**
 * Analyze a single project by spawning Claude CLI in its directory.
 *
 * Flow:
 *  1. Fetch project (path, name) from DB — 404-safe, logs and returns on miss
 *  2. Verify the path exists on disk via Bun.file().exists()
 *  3. Set metadata.analyze_status = 'running'
 *  4. Spawn `claude -p "..." --model claude-sonnet-4-6 --output-format text --max-turns 10`
 *     with the project path as CWD, capturing full stdout
 *  5. Parse the JSON report from stdout
 *  6. Insert a pipeline (status='ready') derived from the analysis
 *  7. Insert project epics for each feature category
 *  8. Update project description + set analyze_status = 'done'
 *  9. Publish 'project.analyzed' event
 *
 * On JSON parse failure: log error, set analyze_status='error', return without throwing.
 */
export async function analyzeProject(projectId: string): Promise<void> {
  const sql = getDb();

  // 1. Fetch project
  const rows = await sql<ProjectRow[]>`
    SELECT id, path, name, description, metadata
    FROM projects
    WHERE id = ${projectId}
  `;

  const project = rows[0];
  if (!project) {
    log.warn(`analyzeProject: project not found id=${projectId}`);
    return;
  }

  // 2. Verify path exists (it's a directory, not a file)
  const { stat: fsStat } = await import("node:fs/promises");
  const pathExists = await fsStat(project.path).then(s => s.isDirectory()).catch(() => false);
  if (!pathExists) {
    log.warn(`analyzeProject: path does not exist project=${projectId} path=${project.path}`);
    await sql`
      UPDATE projects
      SET metadata = jsonb_set(
            COALESCE(metadata, '{}'::jsonb),
            '{analyze_status}',
            '"error"'
          ),
          updated_at = now()
      WHERE id = ${projectId}
    `;
    return;
  }

  // 3. Set analyze_status = 'running'
  await sql`
    UPDATE projects
    SET metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{analyze_status}',
          '"running"'
        ),
        updated_at = now()
    WHERE id = ${projectId}
  `;

  log.info(`analyzeProject: starting analysis project=${projectId} path=${project.path}`);

  const { writeFile } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");

  const tmpDir = "/tmp/dcm-planner";
  await Bun.spawn(["mkdir", "-p", tmpDir]).exited;

  const emptyMcpFile = `${tmpDir}/empty-mcp.json`;
  await writeFile(emptyMcpFile, '{"mcpServers":{}}', "utf-8");

  const jobId = randomUUID().slice(0, 8);
  const userPrompt =
    `Analyze this codebase and produce a JSON report following the format in the system prompt. ` +
    `Be thorough: explore package.json, README, source directories, config files, and identify ` +
    `all features (completed, in progress, and planned). Job: ${jobId}`;

  try {
    // 4. Spawn Claude CLI — CWD = project path, output-format text (not stream-json)
    const proc = Bun.spawn(
      [
        "claude",
        "-p", userPrompt,
        "--system-prompt", ANALYZER_SYSTEM_PROMPT,
        "--model", "claude-sonnet-4-6",
        "--output-format", "text",
        "--max-turns", "20",
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: project.path,
      },
    );

    // Read full stdout into a string
    const rawOutput = await readFullStream(proc.stdout as ReadableStream<Uint8Array>);

    // Drain stderr for diagnostics
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      let stderrText = "";
      if (proc.stderr) {
        stderrText = await new Response(proc.stderr as ReadableStream).text().catch(() => "");
      }
      if (stderrText.trim()) {
        log.warn(
          `analyzeProject: claude exited ${exitCode} project=${projectId}: ${stderrText.slice(0, 300)}`,
        );
      }
    }

    // 5. Parse the JSON report — extract JSON block if surrounded by prose
    const report = parseAnalysisReport(rawOutput);

    if (!report) {
      log.error(
        `analyzeProject: failed to parse JSON output for project=${projectId}. ` +
        `Raw output (first 500 chars): ${rawOutput.slice(0, 500)}`,
      );
      await setAnalyzeStatus(projectId, "error");
      return;
    }

    log.info(
      `analyzeProject: parsed report project=${projectId} ` +
      `completed=${report.completed_features.length} ` +
      `in_progress=${report.in_progress_features.length} ` +
      `planned=${report.planned_features.length}`,
    );

    // 6. Create a pipeline for this project derived from the analysis
    const pipelinePlan = buildPlanFromReport(report);
    const pipelineInput = {
      instructions: `Auto-generated from codebase analysis of ${project.name ?? projectId}`,
      context: {
        tech_stack: report.tech_stack,
        architecture: report.architecture,
        source: "project-analyzer",
      },
    };

    const pipelineRows = await sql<{ id: string }[]>`
      INSERT INTO pipelines (project_id, name, status, input, plan)
      VALUES (
        ${projectId},
        ${"Analysis: " + (project.name ?? projectId)},
        'ready',
        ${sql.json(pipelineInput as import("postgres").JSONValue)},
        ${sql.json(pipelinePlan as import("postgres").JSONValue)}
      )
      RETURNING id
    `;

    const pipelineId = pipelineRows[0]?.id ?? null;

    // 7 & 8. Insert epics per feature category — skip features with empty title
    const epicInserts: Array<{ title: string; description: string; status: string; sort_order: number }> = [];

    const isValidFeature = (f: { title?: string; description?: string }): boolean =>
      typeof f?.title === "string" && f.title.trim().length > 0;

    let order = 0;
    for (const f of (report.completed_features ?? []).filter(isValidFeature)) {
      epicInserts.push({ title: f.title.trim(), description: (f.description ?? "").trim(), status: "done", sort_order: order++ });
    }
    for (const f of (report.in_progress_features ?? []).filter(isValidFeature)) {
      epicInserts.push({ title: f.title.trim(), description: (f.description ?? "").trim(), status: "in_progress", sort_order: order++ });
    }
    for (const f of (report.planned_features ?? []).filter(isValidFeature)) {
      epicInserts.push({ title: f.title.trim(), description: (f.description ?? "").trim(), status: "todo", sort_order: order++ });
    }

    if (epicInserts.length === 0) {
      log.warn(`analyzeProject: report parsed but no valid features found project=${projectId}`);
    }

    let epicsCreated = 0;
    if (epicInserts.length > 0) {
      const insertedEpics = await sql<{ id: string }[]>`
        INSERT INTO project_epics
          (project_id, pipeline_id, title, description, status, sort_order)
        SELECT * FROM ${sql(
          epicInserts.map((e) => ({
            project_id: projectId,
            pipeline_id: pipelineId,
            title: e.title,
            description: e.description,
            status: e.status,
            sort_order: e.sort_order,
          })),
        )}
        RETURNING id
      `;
      epicsCreated = insertedEpics.length;
    }

    // 9. Update project description + analyze_status = 'done'
    await sql`
      UPDATE projects
      SET
        description = ${report.project_summary},
        metadata    = jsonb_set(
                        COALESCE(metadata, '{}'::jsonb),
                        '{analyze_status}',
                        '"done"'
                      ),
        updated_at  = now()
      WHERE id = ${projectId}
    `;

    // 10. Publish event
    await publishEvent("global", "project.analyzed", {
      project_id: projectId,
      pipeline_id: pipelineId,
      epics_created: epicsCreated,
      tech_stack: report.tech_stack,
      completed: report.completed_features.length,
      in_progress: report.in_progress_features.length,
      planned: report.planned_features.length,
    });

    log.info(
      `analyzeProject: done project=${projectId} pipeline=${pipelineId} epics_created=${epicsCreated}`,
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Unknown error";
    log.error(`analyzeProject: unexpected error project=${projectId}: ${errMsg}`);
    await setAnalyzeStatus(projectId, "error").catch(() => {});
  }
}

// ============================================
// Main: analyzeAllProjects
// ============================================

/**
 * Analyze all projects that either have no analyze_status='done' in metadata
 * or have no epics linked to them.
 *
 * Processes sequentially to avoid saturating the Claude API rate limit.
 *
 * @returns Stats: { analyzed, skipped, errors }
 */
export async function analyzeAllProjects(): Promise<{
  analyzed: number;
  skipped: number;
  errors: number;
}> {
  const sql = getDb();

  // Projects without analyze_status='done' OR with zero epics
  const candidates = await sql<{ id: string; analyze_status: string | null; epic_count: string }[]>`
    SELECT
      p.id,
      p.metadata->>'analyze_status' AS analyze_status,
      COUNT(pe.id) AS epic_count
    FROM projects p
    LEFT JOIN project_epics pe ON pe.project_id = p.id
    GROUP BY p.id, p.metadata
    HAVING
      p.metadata->>'analyze_status' IS DISTINCT FROM 'done'
      OR COUNT(pe.id) = 0
    ORDER BY p.created_at ASC
  `;

  log.info(`analyzeAllProjects: found ${candidates.length} candidate(s) to analyze`);

  let analyzed = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of candidates) {
    // Skip projects currently being analyzed (avoid double-processing)
    if (row.analyze_status === "running") {
      log.info(`analyzeAllProjects: skipping project=${row.id} (already running)`);
      skipped++;
      continue;
    }

    try {
      await analyzeProject(row.id);

      // Re-read the analyze_status to determine outcome
      const check = await sql<{ analyze_status: string | null }[]>`
        SELECT metadata->>'analyze_status' AS analyze_status
        FROM projects
        WHERE id = ${row.id}
      `;
      const finalStatus = check[0]?.analyze_status ?? null;
      if (finalStatus === "done") {
        analyzed++;
      } else {
        errors++;
      }
    } catch (err) {
      log.error(`analyzeAllProjects: error on project=${row.id}:`, err);
      errors++;
    }
  }

  log.info(`analyzeAllProjects: complete analyzed=${analyzed} skipped=${skipped} errors=${errors}`);
  return { analyzed, skipped, errors };
}

// ============================================
// Internal Helpers
// ============================================

/**
 * Read the full content of a ReadableStream<Uint8Array> and return as string.
 */
async function readFullStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
    }
    // Flush the decoder
    result += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return result;
}

/**
 * Extract and parse a JSON object from raw Claude output text.
 *
 * Claude may wrap the JSON in prose or code fences; this function tries:
 *   1. Direct JSON.parse on the trimmed output
 *   2. First ```json ... ``` fenced block
 *   3. The largest { ... } substring (greedy, works for most cases)
 */
function parseAnalysisReport(raw: string): AnalysisReport | null {
  const trimmed = raw.trim();

  // Attempt 1: direct parse
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as AnalysisReport;
    } catch {
      // fall through
    }
  }

  // Attempt 2: fenced code block  ```json ... ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as AnalysisReport;
    } catch {
      // fall through
    }
  }

  // Attempt 3: extract largest { ... } block
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as AnalysisReport;
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * Build a minimal pipeline plan object from the analysis report.
 * Sprints correspond to feature categories, enabling epic sync via postSyncEpicsFromPipeline.
 */
function buildPlanFromReport(report: AnalysisReport): Record<string, unknown> {
  const sprints: Array<{ name: string; description: string; wave_start: number; wave_end: number }> = [];

  let waveIndex = 1;

  for (const f of report.completed_features) {
    sprints.push({ name: f.title, description: f.description, wave_start: waveIndex, wave_end: waveIndex });
    waveIndex++;
  }
  for (const f of report.in_progress_features) {
    sprints.push({ name: f.title, description: f.description, wave_start: waveIndex, wave_end: waveIndex });
    waveIndex++;
  }
  for (const f of report.planned_features) {
    sprints.push({ name: f.title, description: f.description, wave_start: waveIndex, wave_end: waveIndex });
    waveIndex++;
  }

  return {
    project_summary: report.project_summary,
    tech_stack: report.tech_stack,
    architecture: report.architecture,
    sprints,
    generated_by: "project-analyzer",
    generated_at: new Date().toISOString(),
  };
}

/**
 * Set the analyze_status field in project metadata. Fire-and-forget safe.
 */
async function setAnalyzeStatus(projectId: string, status: "error" | "done" | "running"): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE projects
    SET metadata = jsonb_set(
          COALESCE(metadata, '{}'::jsonb),
          '{analyze_status}',
          ${`"${status}"`}::jsonb
        ),
        updated_at = now()
    WHERE id = ${projectId}
  `;
}
