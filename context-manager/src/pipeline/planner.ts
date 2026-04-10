/**
 * Pipeline Planner — Uses the configured LLM provider to generate execution plans.
 *
 * Sends all context (instructions, documents, available agents/skills catalog)
 * to the configured planner provider (API or CLI) which produces a structured
 * JSON plan with waves, steps, sprints, and scoped prompts.
 *
 * No heuristic fallback: if the LLM fails or returns invalid JSON, the error
 * propagates so the caller can mark the pipeline as failed and let the user retry.
 *
 * @module pipeline/planner
 */

import type {
  PipelinePlan,
  PipelineInput,
} from "./types";
import { generateId, truncate } from "../lib/helpers";
import { createLogger } from "../lib/logger";

const log = createLogger("Planner");

// ============================================
// Constants
// ============================================

/** Maximum chars per document to include in the planner prompt */
const MAX_DOC_CHARS = 4000;

/** Path to the skill-index for agent/skill reference */
const SKILL_INDEX_PATH = new URL(
  "../../hooks/skill-advisor/skill-index.json",
  import.meta.url,
).pathname;

// ============================================
// Main Entry Point
// ============================================

/**
 * Generate a complete execution plan via the configured LLM planner provider.
 *
 * Sends all context (instructions, documents, available agents/skills)
 * to the planner provider which analyzes and produces a structured JSON plan
 * with as many waves and sprints as it deems necessary.
 *
 * @param input - User instructions, documents, and scope targets
 * @param _sessionId - Active session identifier
 * @param pipelineId - Pipeline ID, passed to CLI providers for streaming chunks
 * @returns A fully-formed PipelinePlan ready for execution
 * @throws {Error} If the LLM provider fails or returns invalid JSON
 */
export async function generatePlan(
  input: PipelineInput,
  _sessionId: string,
  pipelineId?: string,
): Promise<PipelinePlan> {
  const startMs = performance.now();
  log.info("Generating plan via LLM...");

  // 1. Load available agents/skills catalog
  const catalog = await loadCatalogReference();

  // 2. Build the mega-prompt
  const prompt = buildPlannerPrompt(input, catalog);

  // 3. Call the configured planner provider
  let rawOutput = await callClaudeHeadless(prompt, pipelineId);

  // 4. If output does not look like JSON, try workspace file recovery first
  if (!looksLikeJson(rawOutput)) {
    rawOutput = await tryRecoverPlanFromWorkspace(rawOutput, input);
  }

  // 5. Try to parse the plan. If parsing fails (invalid JSON, mixed markdown+JSON,
  // unescaped backslashes, text preamble, etc.), delegate to a fast LLM that
  // re-extracts and reformats the JSON, then retry parsing.
  let plan: PipelinePlan;
  try {
    plan = parsePlanOutput(rawOutput, input);
  } catch (firstError) {
    log.warn(`First parse attempt failed: ${(firstError as Error).message}`);
    log.info("Post-processing raw output with fast LLM to reformat JSON...");
    const reformatted = await postProcessWithLLM(rawOutput, pipelineId);
    try {
      plan = parsePlanOutput(reformatted, input);
      log.info("Plan parsed successfully after LLM reformatting");
    } catch (secondError) {
      log.error(`LLM reformat also failed: ${(secondError as Error).message}`);
      log.error(`Raw LLM output head: ${rawOutput.slice(0, 300)}`);
      log.error(`Reformatted output head: ${reformatted.slice(0, 300)}`);
      throw new Error(
        `Plan generation failed. Original: ${(firstError as Error).message}. ` +
        `After LLM reformat: ${(secondError as Error).message}`,
      );
    }
  }

  const elapsed = Math.round(performance.now() - startMs);
  log.info(
    `Plan generated: id=${plan.plan_id}, waves=${plan.waves.length}, ` +
    `sprints=${plan.sprints.length}, steps=${plan.waves.reduce((s, w) => s + w.steps.length, 0)}, ` +
    `took=${elapsed}ms`,
  );

  return plan;
}

// ============================================
// LLM Planner Call
// ============================================

/**
 * Call the configured planner provider to generate the plan.
 * Uses the LLM service getPlannerProvider() which respects dcm_settings.
 * Supports API providers (MiniMax, ZhipuAI, Moonshot) and CLI providers
 * (claude, codex, gemini) with streaming output.
 *
 * @param prompt - The full system prompt for plan generation
 * @param pipelineId - Pipeline ID for CLI streaming chunks
 * @throws {Error} If no provider is available or the call fails
 */
async function callClaudeHeadless(prompt: string, pipelineId?: string): Promise<string> {
  const { getPlannerProvider } = await import("../llm");
  const { provider, model } = await getPlannerProvider();

  log.info(`Planner: using ${provider.name}${model ? ` (model: ${model})` : ""}`);

  const request: import("../llm").ChatCompletionRequest & { _pipeline_id?: string } = {
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: "Generate the execution plan now. Output ONLY valid JSON, no markdown fences." },
    ],
    model: model ?? undefined,
    max_tokens: 65536,
    temperature: 0.7,
  };

  // Pass pipeline_id for CLI providers to stream chunks
  if (pipelineId) {
    request._pipeline_id = pipelineId;
  }

  const response = await provider.complete(request);
  log.info(`Planner: ${response.provider} responded in ${response.duration_ms}ms (${response.usage.total_tokens} tokens)`);
  return response.content;
}

// ============================================
// Post-Processing Helpers
// ============================================

/** Quick check if a string looks like it contains JSON */
function looksLikeJson(text: string): boolean {
  const trimmed = text.trim();
  // Direct JSON
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return true;
  // JSON in markdown fences
  if (trimmed.includes("```json") || trimmed.includes("```\n{")) return true;
  return false;
}

/**
 * If the planner wrote a JSON file in the workspace, read it.
 * Scans the raw output for file paths like "/path/to/plan.json"
 */
async function tryRecoverPlanFromWorkspace(rawOutput: string, input: PipelineInput): Promise<string> {
  // Look for JSON file references in the output
  const fileMatch = rawOutput.match(/`?([/\w.-]+\.json)`?/);
  if (!fileMatch?.[1]) return rawOutput;

  const filePath = fileMatch[1];
  try {
    const file = Bun.file(filePath);
    if (await file.exists()) {
      const content = await file.text();
      if (content.trim().startsWith("{")) {
        log.info(`Recovered plan from file: ${filePath} (${content.length} chars)`);
        return content;
      }
    }
  } catch {
    // File not readable — fall through
  }

  // Also check workspace directory for common plan file names
  const workspace = input.workspace?.path;
  if (workspace) {
    for (const name of ["execution-plan.json", "EXECUTION_PLAN.json", "plan.json"]) {
      try {
        const file = Bun.file(`${workspace}/${name}`);
        if (await file.exists()) {
          const content = await file.text();
          if (content.trim().startsWith("{")) {
            log.info(`Recovered plan from workspace: ${workspace}/${name} (${content.length} chars)`);
            return content;
          }
        }
      } catch {
        // Skip
      }
    }
  }

  return rawOutput;
}

/**
 * Post-process raw output with a fast LLM (Sonnet) to extract valid JSON.
 * Called when the planner output is text/mixed format instead of pure JSON.
 */
async function postProcessWithLLM(rawOutput: string, pipelineId?: string): Promise<string> {
  try {
    const { chatComplete } = await import("../llm");

    const response = await chatComplete({
      messages: [
        {
          role: "system",
          content: `Tu es un REFORMATTEUR/EXTRACTEUR de JSON strict. Tu recois le resultat brut d'un planificateur AI qui a genere un plan d'execution mais dont la sortie est invalide ou malformee.

Problemes frequents a corriger :
- Texte explicatif en prefixe ou suffixe du JSON ("J'ai analyse...", "Voici le plan:")
- Listes markdown (- **Item**) melangees avec du JSON
- Backslashes non echappes dans des strings (chemins de fichiers, regex)
- Caracteres de controle non echappes (sauts de ligne dans des strings)
- Blocs de code fences (\`\`\`json ... \`\`\`) autour du JSON
- Commentaires // ou /* */ invalides en JSON
- Virgules trainantes
- Guillemets simples au lieu de doubles
- JSON tronque (reconstruit la fin si possible)

TA MISSION :
1. Extraire la structure JSON du plan (waves, sprints, steps)
2. Corriger TOUTES les erreurs de syntaxe
3. Retourner un JSON 100% valide et parsable

STRUCTURE ATTENDUE :
{
  "name": "string",
  "waves": [{"number": 0, "name": "...", "steps": [...]}],
  "sprints": [...],
  "required_skills": [...],
  "constraints": {...}
}

REPONSE : UNIQUEMENT le JSON valide, rien d'autre. Pas de markdown, pas de texte explicatif, pas de fences \`\`\`. Commence par { et termine par }.`,
        },
        {
          role: "user",
          content: `Voici l'output brut du planificateur a reformater en JSON valide :\n\n${truncate(rawOutput, 30000)}`,
        },
      ],
      max_tokens: 65536,
      temperature: 0,
      _pipeline_id: pipelineId,
    } as import("../llm").ChatCompletionRequest & { _pipeline_id?: string });

    log.info(`Post-processor: reformatted ${rawOutput.length} → ${response.content.length} chars in ${response.duration_ms}ms`);
    return response.content;
  } catch (error) {
    log.error("LLM post-processing failed:", error);
    return rawOutput;
  }
}

// ============================================
// Prompt Construction
// ============================================

/**
 * Build the complete prompt that tells Opus what plan to produce.
 */
function buildPlannerPrompt(input: PipelineInput, catalog: string): string {
  const sections: string[] = [];

  sections.push(`Tu es un architecte logiciel senior. Ta mission : analyser un projet et produire un plan d'execution JSON ultra-detaille pour un pipeline d'agents AI.

Tu as acces a TOUS tes outils habituels (Bash, Read, Write, Grep, Glob, Agent, Skill, MCP servers, internet). Utilise-les librement pour comprendre le projet en profondeur.

# WORKFLOW

## Phase 1 — Exploration complete
Explore le projet en profondeur :
- Structure des dossiers, fichiers cles, configs
- Code source, schemas DB, API routes, composants
- README, documentation, git history si pertinent
- Charge les skills pertinents pour mieux comprendre la stack
- Utilise internet/MCP si tu as besoin de references
- Prends le temps qu'il faut — un plan bien informe vaut mieux qu'un plan bacle

## Phase 2 — Generation du plan JSON
Quand tu as une comprehension complete, produis le plan JSON.
- Ton DERNIER message doit contenir UNIQUEMENT le JSON
- Commence par { et termine par }
- Pas de texte avant/apres, pas de fences markdown
- Le JSON doit etre parsable par JSON.parse()

# REGLE UNIQUE ET ABSOLUE
Ta DERNIERE reponse textuelle doit etre le JSON du plan. Tout ce que tu fais avant (exploration, skills, recherche) est libre. Mais le dernier message = JSON pur.`);

  // Instructions
  sections.push(`\n# INSTRUCTIONS DE L'UTILISATEUR\n\n${input.instructions}`);

  // Documents
  if (input.documents && input.documents.length > 0) {
    sections.push("\n# DOCUMENTS FOURNIS\n");
    for (const doc of input.documents) {
      sections.push(`## ${doc.name} (${doc.type})\n\n${truncate(doc.content, MAX_DOC_CHARS)}\n`);
    }
  }

  // Scope
  if (input.target_files && input.target_files.length > 0) {
    sections.push(`\n# FICHIERS CIBLES\n${input.target_files.map(f => `- ${f}`).join("\n")}`);
  }
  if (input.target_directories && input.target_directories.length > 0) {
    sections.push(`\n# DOSSIERS CIBLES\n${input.target_directories.map(d => `- ${d}`).join("\n")}`);
  }

  // Workspace
  if (input.workspace) {
    sections.push(`\n# WORKSPACE\n- Dossier: ${input.workspace.path}`);
    if (input.workspace.git_repo_url) {
      sections.push(`- Git: ${input.workspace.git_repo_url} (branche: ${input.workspace.git_branch ?? "main"})`);
    }
  }

  // Catalog
  sections.push(`\n# CATALOGUE AGENTS & SKILLS DISPONIBLES\n\n${catalog}`);

  // Output schema
  sections.push(`\n# FORMAT DE SORTIE ATTENDU

Produis EXACTEMENT ce JSON (pas de markdown, pas de \`\`\`json, juste le JSON brut) :

{
  "name": "Nom court du plan (max 60 chars)",
  "waves": [
    {
      "number": 0,
      "name": "Nom de la wave",
      "steps": [
        {
          "order": 0,
          "agent_type": "type exact de l'agent (du catalogue)",
          "description": "Ce que cet agent doit faire",
          "skills": ["skill-1", "skill-2"],
          "prompt": "Le prompt COMPLET et DETAILLE pour l'agent. Inclure: contexte, objectif precis, fichiers a toucher, contraintes, format de retour attendu. Minimum 200 mots.",
          "model": "haiku|sonnet|opus",
          "max_turns": 5,
          "target_files": [],
          "target_directories": [],
          "retry_strategy": "enhanced",
          "max_retries": 2
        }
      ],
      "depends_on": [0],
      "on_failure": "continue|retry|abort",
      "parallel": true
    }
  ],
  "sprints": [
    {
      "number": 1,
      "name": "Nom du sprint",
      "objectives": ["Objectif 1 precis et mesurable", "Objectif 2"],
      "wave_start": 0,
      "wave_end": 1
    }
  ],
  "required_skills": ["skill-1", "skill-2"],
  "constraints": {
    "max_parallel": 4,
    "max_total_retries": 6,
    "timeout_ms": 0
  }
}

# REGLES POUR LE PLAN

## Dependances et parallelisme

Le runner execute les waves par numero. Les steps DANS une wave tournent en parallele.
\`depends_on\` = numeros des waves qui doivent finir AVANT celle-ci.

Pattern type pour maximiser le parallelisme :
- Wave 0 (Explore) → \`"depends_on": []\`
- Wave 1 (Backend) + Wave 2 (Frontend) → \`"depends_on": [0]\` → PARALLELES
- Wave 3 (Integration) → \`"depends_on": [1, 2]\` → attend les deux
- Wave 4 (Tests/Review) → \`"depends_on": [3]\`

## Structure des waves

1. **Wave 0 = Exploration** : agent Explore, analyse le codebase. depends_on: []
2. **Waves implementation** : agents specialises du catalogue. Paralleliser backend/frontend/DB si independants.
3. **Wave validation** : code-reviewer obligatoire. Depend de toutes les waves d'implementation.
4. **Waves optionnelles** : security, tests, performance si pertinent.
5. **on_failure** : "abort" (waves critiques), "retry" (implementation), "continue" (validation).

## Steps — regles

- **Modeles** : haiku (exploration/review), sonnet (implementation), opus (architecture complexe)
- **max_turns** : 3-5 (trivial), 5-10 (simple), 10-20 (modere), 20-30 (complexe)
- **Prompts AUTONOMES** : chaque agent ne connait PAS le plan global. Son prompt doit inclure :
  contexte du projet, objectif precis, fichiers a toucher, contraintes, format de retour. Min 200 mots.
- **Skills** : toujours "workflow-clean-code" + skills specifiques au domaine

## Sprints

Groupent les waves en livrables coherents (1 sprint = 1 commit potentiel).
Autant de sprints que necessaire. Objectifs precis et mesurables.

## EXHAUSTIVITE (CRITIQUE)

Le plan doit couvrir l'INTEGRALITE du travail demande. Ne PAS simplifier, ne PAS regrouper, ne PAS raccourcir.
- **Pas de limite** sur le nombre de waves, steps, ou sprints. 50 waves si necessaire.
- **1 step = 1 tache atomique** : un fichier a creer, un composant a implementer, un endpoint a coder.
  Ne jamais regrouper "creer les 10 endpoints" dans 1 step — faire 10 steps.
- **1 wave = 1 couche logique** : pas de wave "implementer tout le backend" — decouper en
  wave DB/migrations, wave models, wave controllers, wave services, wave routes, etc.
- **Chaque fichier a creer/modifier = 1 step dedie** avec son prompt autonome complet.
- **Le prompt de chaque step doit decrire precisement** : le nom du fichier, les imports, la structure,
  les methodes/fonctions, les types, les relations avec les autres fichiers.
- Pense "si un dev junior recoit ce step, peut-il l'implementer sans poser de question ?" — si non, detaille plus.
- Le plan est le blueprint complet du projet. Rien ne doit etre laisse a l'interpretation.`);

  return sections.join("\n");
}

// ============================================
// Output Parsing
// ============================================

/**
 * Sanitize common LLM JSON issues: unescaped backslashes inside string values.
 * The LLM sometimes outputs backslashes (file paths, regex) that are not valid JSON escapes.
 * This walks the string char-by-char and escapes lone backslashes inside string literals.
 */
function sanitizeJsonString(input: string): string {
  const out: string[] = [];
  let inString = false;
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out.push(ch as string);
      i++;
      continue;
    }
    // inside a string
    if (ch === '"') {
      inString = false;
      out.push(ch as string);
      i++;
      continue;
    }
    if (ch === "\\") {
      const next = input[i + 1];
      // Valid JSON escapes: " \ / b f n r t u
      if (next && '"\\/bfnrtu'.includes(next)) {
        out.push(ch as string, next as string);
        i += 2;
      } else {
        // Escape the lone backslash
        out.push("\\\\");
        i++;
      }
      continue;
    }
    // Unescaped control chars inside strings → escape them
    const code = (ch as string).charCodeAt(0);
    if (code < 0x20) {
      if (code === 0x0a) out.push("\\n");
      else if (code === 0x0d) out.push("\\r");
      else if (code === 0x09) out.push("\\t");
      else out.push(`\\u${code.toString(16).padStart(4, "0")}`);
      i++;
      continue;
    }
    out.push(ch as string);
    i++;
  }
  return out.join("");
}

/**
 * Parse the raw output from Claude Opus into a validated PipelinePlan.
 * Handles JSON extraction from potentially wrapped output.
 */
function parsePlanOutput(raw: string, input: PipelineInput): PipelinePlan {
  let jsonStr = raw.trim();

  // Strip outer markdown code fences if present.
  // The JSON may contain nested ``` fences inside string values (agent prompts
  // with bash/json code examples), so we must match the OUTERMOST fence pair
  // (first occurrence from start, last occurrence from end).
  if (jsonStr.startsWith("```")) {
    // Remove opening fence line (```json\n or ```\n)
    const firstNewline = jsonStr.indexOf("\n");
    if (firstNewline !== -1) {
      jsonStr = jsonStr.slice(firstNewline + 1);
    }
    // Remove trailing fence (last ``` in the string)
    const lastFence = jsonStr.lastIndexOf("```");
    if (lastFence !== -1) {
      jsonStr = jsonStr.slice(0, lastFence);
    }
    jsonStr = jsonStr.trim();
  }

  // Find the outermost JSON object: first { to its matching } via brace counting.
  // This handles cases where there's leading text or trailing text around the JSON.
  const firstBrace = jsonStr.indexOf("{");
  if (firstBrace !== -1) {
    let depth = 0;
    let lastBrace = -1;
    let inString = false;
    let escaped = false;
    for (let i = firstBrace; i < jsonStr.length; i++) {
      const ch = jsonStr[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { lastBrace = i; break; }
      }
    }
    if (lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    } else {
      // Fallback: use last } in the string
      const naiveLast = jsonStr.lastIndexOf("}");
      if (naiveLast > firstBrace) {
        jsonStr = jsonStr.substring(firstBrace, naiveLast + 1);
      }
    }
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch (parseError) {
    // Attempt to fix common LLM JSON issues: unescaped backslashes in strings
    log.warn(`Initial JSON parse failed: ${(parseError as Error).message}. Attempting sanitization...`);
    try {
      const sanitized = sanitizeJsonString(jsonStr);
      parsed = JSON.parse(sanitized) as Record<string, unknown>;
      log.info("JSON parsed successfully after sanitization");
    } catch (secondError) {
      log.error(`Failed to parse plan JSON even after sanitization: ${(secondError as Error).message}`);
      log.error(`Raw output (first 500 chars): ${raw.slice(0, 500)}`);
      throw new Error(`LLM returned invalid JSON: ${(parseError as Error).message}. Raw output: ${raw.slice(0, 200)}`);
    }
  }

  // Validate required fields
  if (!parsed["waves"] || !Array.isArray(parsed["waves"]) || (parsed["waves"] as unknown[]).length === 0) {
    throw new Error("LLM returned a plan with no waves");
  }

  const waves = parsed["waves"] as Array<Record<string, unknown>>;
  const sprints = (parsed["sprints"] as Array<Record<string, unknown>>) ?? [];
  const requiredSkills = (parsed["required_skills"] as string[]) ?? ["workflow-clean-code"];
  const constraints = (parsed["constraints"] as Record<string, unknown>) ?? {};

  // Build validated plan
  const plan: PipelinePlan = {
    plan_id: generateId("plan"),
    version: 1,
    name: String(parsed["name"] ?? buildPlanName(input.instructions)),
    waves: waves.map((w, idx) => ({
      number: Number(w["number"] ?? idx),
      name: String(w["name"] ?? `Wave ${idx}`),
      steps: Array.isArray(w["steps"])
        ? (w["steps"] as Array<Record<string, unknown>>).map((s, sIdx) => ({
            order: Number(s["order"] ?? sIdx),
            agent_type: String(s["agent_type"] ?? "Snipper"),
            description: String(s["description"] ?? ""),
            skills: Array.isArray(s["skills"]) ? (s["skills"] as string[]) : ["workflow-clean-code"],
            prompt: String(s["prompt"] ?? s["description"] ?? ""),
            model: String(s["model"] ?? "sonnet"),
            max_turns: Number(s["max_turns"] ?? 10),
            target_files: Array.isArray(s["target_files"]) ? (s["target_files"] as string[]) : (input.target_files ?? []),
            target_directories: Array.isArray(s["target_directories"]) ? (s["target_directories"] as string[]) : (input.target_directories ?? []),
            retry_strategy: (String(s["retry_strategy"] ?? "enhanced")) as "same" | "enhanced" | "alternate" | "decompose",
            max_retries: Number(s["max_retries"] ?? 2),
          }))
        : [],
      depends_on: Array.isArray(w["depends_on"]) ? (w["depends_on"] as number[]) : (idx > 0 ? [idx - 1] : []),
      on_failure: (String(w["on_failure"] ?? "continue")) as "abort" | "continue" | "retry",
    })),
    sprints: sprints.map((s, idx) => ({
      number: Number(s["number"] ?? idx + 1),
      name: String(s["name"] ?? `Sprint ${idx + 1}`),
      objectives: Array.isArray(s["objectives"]) ? (s["objectives"] as string[]) : [],
      wave_start: Number(s["wave_start"] ?? 0),
      wave_end: Number(s["wave_end"] ?? 0),
    })),
    required_skills: requiredSkills,
    constraints: {
      max_parallel: Number(constraints["max_parallel"] ?? 4),
      max_total_retries: Number(constraints["max_total_retries"] ?? 6),
      timeout_ms: Number(constraints["timeout_ms"] ?? 0),
    },
  };

  // If the LLM didn't produce sprints, generate minimal ones
  if (plan.sprints.length === 0 && plan.waves.length > 0) {
    if (plan.waves.length <= 2) {
      plan.sprints = [{ number: 1, name: "Full Pipeline", objectives: plan.waves.map(w => w.name), wave_start: 0, wave_end: plan.waves.length - 1 }];
    } else {
      plan.sprints = [
        { number: 1, name: "Discovery", objectives: ["Exploration du codebase"], wave_start: 0, wave_end: 0 },
        { number: 2, name: "Implementation", objectives: plan.waves.slice(1, -1).map(w => w.name), wave_start: 1, wave_end: plan.waves.length - 2 },
        { number: 3, name: "Quality", objectives: [plan.waves[plan.waves.length - 1]?.name ?? "Validation"], wave_start: plan.waves.length - 1, wave_end: plan.waves.length - 1 },
      ];
    }
  }

  return plan;
}

// ============================================
// Catalog Loading
// ============================================

/**
 * Load the skill-index.json to give Opus a reference of available agents/skills.
 * Falls back to a minimal list if file not found.
 */
async function loadCatalogReference(): Promise<string> {
  try {
    const file = Bun.file(SKILL_INDEX_PATH);
    if (!(await file.exists())) {
      log.warn(`Skill index not found at ${SKILL_INDEX_PATH}, using minimal catalog`);
      return getMinimalCatalog();
    }

    const raw = await file.text();
    const index = JSON.parse(raw) as Record<string, unknown>;
    const domains = index["domains"] as Record<string, Record<string, unknown>> | undefined;

    if (!domains) return getMinimalCatalog();

    // Build a concise summary for the planner
    const lines: string[] = [];
    for (const [domain, info] of Object.entries(domains)) {
      const agents = (info["agents"] as Record<string, string[]>)?.["recommended"] ?? [];
      const skills = (info["primary"] as string[]) ?? [];
      const keywords = (info["keywords"] as string[]) ?? [];
      lines.push(`## ${domain}`);
      lines.push(`Agents: ${agents.join(", ")}`);
      lines.push(`Skills: ${skills.join(", ")}`);
      lines.push(`Keywords: ${keywords.slice(0, 8).join(", ")}`);
      lines.push("");
    }

    return lines.join("\n");
  } catch (error) {
    log.warn("Failed to load skill index:", error);
    return getMinimalCatalog();
  }
}

/**
 * Minimal catalog when skill-index.json is not available.
 */
function getMinimalCatalog(): string {
  return `## Agents disponibles
- Explore : exploration et comprehension du codebase (haiku, 5 turns)
- Snipper : modifications de code rapides (sonnet, 10 turns)
- frontend-react : composants React, hooks, state (sonnet, 15 turns)
- backend-laravel : API Laravel, controllers, models (sonnet, 15 turns)
- backend-developer : APIs Node.js/Bun/Hono (sonnet, 15 turns)
- database-admin : schema PostgreSQL, migrations, index (sonnet, 10 turns)
- code-reviewer : revue de code, qualite, bugs (sonnet, 10 turns)
- test-engineer : tests unitaires, integration, e2e (sonnet, 10 turns)
- security-specialist : audit securite, OWASP (sonnet, 15 turns)
- performance-engineer : optimisation, profiling, cache (sonnet, 15 turns)
- designer-ui-ux : design system, accessibilite (sonnet, 15 turns)
- technical-writer : documentation, API docs (haiku, 5 turns)
- devops-infra : CI/CD, Docker, deploy (sonnet, 10 turns)
- qa-testing : QA, tests manuels, validation (haiku, 10 turns)
- impact-analyzer : analyse d'impact avant modification (sonnet, 10 turns)
- regression-guard : validation anti-regression (sonnet, 10 turns)

## Skills disponibles
- workflow-clean-code (toujours requis)
- react-best-practices, vercel-react-best-practices
- laravel-expert, api-design-principles
- postgresql, sql-pro
- senior-qa, tdd-orchestrator
- security-auditor, vulnerability-scanner
- senior-devops, docker-expert
- ui-ux-pro-max, web-design-reviewer
- typescript-expert, senior-architect`;
}

// ============================================
// Helpers
// ============================================

function buildPlanName(instructions: string): string {
  const firstLine = instructions.split("\n")[0] ?? instructions;
  const cleaned = firstLine.replace(/[^a-zA-Z0-9\s\u00C0-\u024F-]/g, "").trim();
  return truncate(cleaned, 60) || "Pipeline";
}
