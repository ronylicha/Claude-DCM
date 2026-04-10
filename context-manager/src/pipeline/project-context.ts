/**
 * Project Context Manager
 *
 * Builds and persists structured project context by spawning Claude CLI to
 * analyse the codebase. Sections are stored in the `project_context` table
 * and can be retrieved as a formatted string ready for injection into agent
 * system prompts.
 *
 * Also provides filesystem watching via inotifywait: detected changes are
 * debounced for 30 seconds before triggering a full context rebuild.
 *
 * @module pipeline/project-context
 */

import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("ProjectContext");

// ============================================
// Types
// ============================================

interface ProjectRow {
  id: string;
  path: string;
  name: string | null;
}

interface ContextSection {
  type: string;
  title: string;
  content: string;
}

interface ContextReport {
  sections: ContextSection[];
}

interface ProjectContextRow {
  id: string;
  project_id: string;
  context_type: string;
  title: string;
  content: string;
  metadata: Record<string, unknown>;
  version: number;
  updated_at: string;
}

// ============================================
// Filesystem watcher state
// ============================================

/** Map<projectId, inotifywait subprocess> */
const watchers = new Map<string, ReturnType<typeof Bun.spawn>>();

/** Map<projectId, debounce timer> */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Directories to ignore during filesystem watching */
const IGNORED_DIRS = ["node_modules", ".git", ".next", "dist", "build", "__pycache__"];

const DEBOUNCE_MS = 30_000; // 30 seconds

// ============================================
// System Prompt
// ============================================

const CONTEXT_SYSTEM_PROMPT = `Tu es un analyste de code. Explore le projet dans le repertoire courant et produis un rapport structuré JSON.

WORKFLOW :
1. Lis les fichiers clés : package.json, composer.json, go.mod, requirements.txt, README
2. Explore la structure des dossiers principaux (src, app, lib, etc.)
3. Identifie les routes/endpoints API si applicables
4. Identifie les tables/models de base de données si applicables
5. Produis le JSON ci-dessous

IMPORTANT :
- Reponds UNIQUEMENT avec du JSON valide
- Commence par { et termine par }
- Chaque section "content" doit être un texte clair et concis (pas de JSON imbriqué)

FORMAT OBLIGATOIRE :
{
  "sections": [
    { "type": "summary",      "title": "Project Summary",   "content": "Description courte du projet et de son objectif principal." },
    { "type": "architecture", "title": "Architecture",      "content": "Patterns (MVC, microservices, etc.), couches applicatives, points d'entrée principaux." },
    { "type": "tech_stack",   "title": "Tech Stack",        "content": "Langages, frameworks, versions, outils de build." },
    { "type": "file_tree",    "title": "File Tree",         "content": "Structure principale des dossiers avec leur rôle (ex: src/api → handlers HTTP)." },
    { "type": "dependencies", "title": "Key Dependencies",  "content": "Packages/librairies critiques et leur usage." },
    { "type": "api_routes",   "title": "API Routes",        "content": "Endpoints principaux avec méthode et description. Mettre 'N/A' si aucune API." },
    { "type": "db_schema",    "title": "Database Schema",   "content": "Tables ou models principaux avec colonnes clés. Mettre 'N/A' si pas de BDD." }
  ]
}`;

// ============================================
// Internal helpers
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
    result += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  return result;
}

/**
 * Extract and parse a ContextReport JSON object from raw Claude output.
 * Handles direct JSON, fenced code blocks, and {…} substring extraction.
 */
function parseContextReport(raw: string): ContextReport | null {
  const trimmed = raw.trim();

  // Attempt 1: direct parse
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as ContextReport;
    } catch {
      // fall through
    }
  }

  // Attempt 2: fenced code block  ```json … ```
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as ContextReport;
    } catch {
      // fall through
    }
  }

  // Attempt 3: extract largest { … } block
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as ContextReport;
    } catch {
      // fall through
    }
  }

  return null;
}

/**
 * Determine which context_types are most relevant given a task description.
 * Returns null when all sections should be included (no keyword match).
 */
function prioritiseSections(
  rows: ProjectContextRow[],
  taskDescription: string,
): ProjectContextRow[] {
  if (!taskDescription.trim()) return rows;

  const task = taskDescription.toLowerCase();

  const priority: string[] = [];

  if (/\bapi\b|endpoint|route|http|rest|graphql/.test(task)) priority.push("api_routes");
  if (/\bdb\b|database|schema|table|model|migration|sql|postgres|mysql/.test(task)) priority.push("db_schema");
  if (/\barch(itecture)?\b|pattern|layer|service|domain/.test(task)) priority.push("architecture");
  if (/\bstack\b|framework|language|version|tech/.test(task)) priority.push("tech_stack");
  if (/\bdep(endenc)?(ies|y)\b|package|library|npm|composer|pip/.test(task)) priority.push("dependencies");
  if (/\bfile|folder|directory|struct|tree/.test(task)) priority.push("file_tree");

  if (priority.length === 0) return rows;

  // Put prioritised sections first, then the rest
  const prioritySet = new Set(priority);
  const first = rows.filter((r) => prioritySet.has(r.context_type));
  const rest = rows.filter((r) => !prioritySet.has(r.context_type));

  return [...first, ...rest];
}

// ============================================
// Public API
// ============================================

/**
 * Build (or rebuild) the full project context by spawning Claude CLI.
 *
 * Flow:
 *  1. Fetch project (id, path) from DB
 *  2. Spawn `claude -p "…" --system-prompt "…"` with CWD = project path
 *  3. Parse the JSON report
 *  4. UPSERT each section into project_context (ON CONFLICT: increment version)
 *  5. UPDATE projects SET last_context_scan, context_version = context_version + 1
 *  6. Publish 'project.context.updated' event
 */
export async function buildProjectContext(projectId: string): Promise<void> {
  const sql = getDb();

  // 1. Fetch project
  const rows = await sql<ProjectRow[]>`
    SELECT id, path, name FROM projects WHERE id = ${projectId}
  `;
  const project = rows[0];
  if (!project) {
    log.warn(`buildProjectContext: project not found id=${projectId}`);
    return;
  }

  // Verify path exists
  const pathExists = await Bun.file(project.path).exists().catch(() => false);
  if (!pathExists) {
    log.warn(`buildProjectContext: path not found project=${projectId} path=${project.path}`);
    return;
  }

  log.info(`buildProjectContext: start project=${projectId} path=${project.path}`);

  const { writeFile } = await import("node:fs/promises");
  const { randomUUID } = await import("node:crypto");

  const tmpDir = "/tmp/dcm-planner";
  await Bun.spawn(["mkdir", "-p", tmpDir]).exited;

  const emptyMcpFile = `${tmpDir}/empty-mcp.json`;
  await writeFile(emptyMcpFile, '{"mcpServers":{}}', "utf-8");

  const jobId = randomUUID().slice(0, 8);
  const userPrompt =
    `Explore this codebase and produce the structured JSON context report as described in the system prompt. ` +
    `Be thorough: read package.json / README / config files, explore main source directories. Job: ${jobId}`;

  let report: ContextReport | null = null;

  try {
    const proc = Bun.spawn(
      [
        "claude",
        "-p", userPrompt,
        "--system-prompt", CONTEXT_SYSTEM_PROMPT,
        "--model", "claude-sonnet-4-6",
        "--output-format", "text",
        "--max-turns", "10",
        "--tools", "Read,Bash,Grep,Glob",
        "--strict-mcp-config",
        "--mcp-config", emptyMcpFile,
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        cwd: project.path,
      },
    );

    const rawOutput = await readFullStream(proc.stdout as ReadableStream<Uint8Array>);

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderrText = proc.stderr
        ? await new Response(proc.stderr as ReadableStream).text().catch(() => "")
        : "";
      if (stderrText.trim()) {
        log.warn(
          `buildProjectContext: claude exited ${exitCode} project=${projectId}: ${stderrText.slice(0, 300)}`,
        );
      }
    }

    report = parseContextReport(rawOutput);
  } catch (error) {
    log.error(
      `buildProjectContext: spawn error project=${projectId}:`,
      error instanceof Error ? error.message : error,
    );
    return;
  }

  if (!report) {
    log.error(`buildProjectContext: failed to parse JSON report project=${projectId}`);
    return;
  }

  const validTypes = new Set([
    "summary", "architecture", "tech_stack", "file_tree",
    "dependencies", "api_routes", "db_schema", "custom",
  ]);

  // 4. UPSERT each section
  let upserted = 0;
  for (const section of report.sections) {
    const sectionType = validTypes.has(section.type) ? section.type : "custom";
    const title = (section.title ?? "").trim() || sectionType;
    const content = (section.content ?? "").trim();

    if (!content) continue;

    await sql`
      INSERT INTO project_context (project_id, context_type, title, content, version)
      VALUES (
        ${projectId},
        ${sectionType},
        ${title},
        ${content},
        1
      )
      ON CONFLICT (project_id, context_type, title) DO UPDATE SET
        content    = EXCLUDED.content,
        version    = project_context.version + 1,
        updated_at = now()
    `;
    upserted++;
  }

  // 5. Update projects scan metadata
  await sql`
    UPDATE projects
    SET
      last_context_scan = now(),
      context_version   = context_version + 1,
      updated_at        = now()
    WHERE id = ${projectId}
  `;

  // 6. Publish event
  await publishEvent("global", "project.context.updated", {
    project_id: projectId,
    sections_upserted: upserted,
  });

  log.info(
    `buildProjectContext: done project=${projectId} sections_upserted=${upserted}`,
  );
}

/**
 * Retrieve all context sections for a project and compose a formatted string
 * ready for injection into an agent system prompt.
 *
 * When taskDescription is provided, relevant sections are listed first
 * (keyword-based heuristic: "api" → api_routes, "db" → db_schema, etc.).
 */
export async function getProjectContextForAgent(
  projectId: string,
  taskDescription: string = "",
): Promise<string> {
  const sql = getDb();

  const rows = await sql<ProjectContextRow[]>`
    SELECT id, project_id, context_type, title, content, metadata, version, updated_at
    FROM project_context
    WHERE project_id = ${projectId}
    ORDER BY context_type ASC
  `;

  if (rows.length === 0) {
    return `[No project context available for project ${projectId}. Run POST /api/projects/${projectId}/context/refresh to generate it.]`;
  }

  const ordered = prioritiseSections(rows, taskDescription);

  const lines: string[] = [
    `# Project Context (${rows.length} sections)`,
    "",
  ];

  for (const row of ordered) {
    lines.push(`## ${row.title}`);
    lines.push(`*Type: ${row.context_type} | Version: ${row.version} | Updated: ${row.updated_at}*`);
    lines.push("");
    lines.push(row.content);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Start watching a project directory for filesystem changes.
 *
 * Uses inotifywait (Linux inotify-tools) in recursive mode.
 * Changes are debounced for 30 seconds before triggering buildProjectContext.
 * Ignores node_modules, .git, .next, dist, build, __pycache__.
 *
 * A project can only have one active watcher; calling again replaces the previous one.
 */
export async function watchProjectChanges(projectId: string): Promise<void> {
  // Stop any existing watcher for this project
  stopWatching(projectId);

  const sql = getDb();

  const rows = await sql<ProjectRow[]>`
    SELECT id, path FROM projects WHERE id = ${projectId}
  `;
  const project = rows[0];
  if (!project) {
    log.warn(`watchProjectChanges: project not found id=${projectId}`);
    return;
  }

  const pathExists = await Bun.file(project.path).exists().catch(() => false);
  if (!pathExists) {
    log.warn(`watchProjectChanges: path not found project=${projectId} path=${project.path}`);
    return;
  }

  // Build --exclude regex: match any path segment containing an ignored dir name
  const excludePattern = `(${IGNORED_DIRS.join("|")})`;

  log.info(`watchProjectChanges: starting watcher project=${projectId} path=${project.path}`);

  const proc = Bun.spawn(
    [
      "inotifywait",
      "--monitor",        // keep running after first event
      "--recursive",
      "--event", "modify,create,delete",
      "--format", "%w%f",
      "--exclude", excludePattern,
      project.path,
    ],
    {
      stdout: "pipe",
      stderr: "ignore",
    },
  );

  watchers.set(projectId, proc);

  // Consume stdout line-by-line asynchronously
  (async () => {
    if (!proc.stdout) return;

    const reader = (proc.stdout as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          log.debug(`watchProjectChanges: change detected project=${projectId} file=${trimmed}`);

          // Debounce: reset the timer on each detected change
          const existing = debounceTimers.get(projectId);
          if (existing) clearTimeout(existing);

          const timer = setTimeout(() => {
            debounceTimers.delete(projectId);
            log.info(`watchProjectChanges: debounce elapsed, rebuilding context project=${projectId}`);
            buildProjectContext(projectId).catch((err) => {
              log.error(`watchProjectChanges: buildProjectContext failed project=${projectId}:`, err);
            });
          }, DEBOUNCE_MS);

          debounceTimers.set(projectId, timer);
        }
      }
    } catch {
      // Process was killed or stdout closed — exit silently
    } finally {
      reader.releaseLock();
      watchers.delete(projectId);
      log.info(`watchProjectChanges: watcher exited project=${projectId}`);
    }
  })();
}

/**
 * Stop the inotifywait watcher for a given project, if any.
 * Also cancels any pending debounce timer.
 */
export function stopWatching(projectId: string): void {
  const timer = debounceTimers.get(projectId);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(projectId);
  }

  const proc = watchers.get(projectId);
  if (proc) {
    try {
      proc.kill();
    } catch {
      // Already dead — ignore
    }
    watchers.delete(projectId);
    log.info(`stopWatching: watcher stopped project=${projectId}`);
  }
}
