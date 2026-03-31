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

  // 4. If output is not valid JSON, check for a written file in workspace
  if (!looksLikeJson(rawOutput)) {
    rawOutput = await tryRecoverPlanFromWorkspace(rawOutput, input);
  }

  // 5. If still not valid JSON, post-process with a fast LLM to extract the plan
  if (!looksLikeJson(rawOutput)) {
    log.info("Raw output is not JSON — post-processing with fast LLM to extract plan...");
    rawOutput = await postProcessWithLLM(rawOutput, pipelineId);
  }

  // 6. Parse the JSON response (throws on invalid output)
  const plan = parsePlanOutput(rawOutput, input);

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
    max_tokens: 16384,
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
          content: `Tu es un extracteur JSON. Tu recois le resultat brut d'un planificateur AI qui a genere un plan d'execution.
Le plan peut etre dans un fichier mentionne, dans du texte libre, dans des blocs de code, ou en JSON direct.

Ta seule tache : extraire le JSON du plan et le retourner PROPREMENT.
- Si le plan est deja en JSON valide, retourne-le tel quel
- Si le plan est dans du texte, extrait la structure JSON
- Si le plan mentionne qu'il a ecrit un fichier, reconstruit le JSON a partir des informations disponibles

Retourne UNIQUEMENT le JSON valide du plan, rien d'autre. Pas de texte, pas de markdown.`,
        },
        {
          role: "user",
          content: `Voici l'output brut du planificateur. Extrait le JSON du plan:\n\n${truncate(rawOutput, 15000)}`,
        },
      ],
      max_tokens: 16384,
      temperature: 0,
      _pipeline_id: pipelineId,
    } as import("../llm").ChatCompletionRequest & { _pipeline_id?: string });

    log.info(`Post-processor: extracted ${response.content.length} chars in ${response.duration_ms}ms`);
    return response.content;
  } catch (error) {
    log.error("Post-processing failed:", error);
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

  sections.push(`Tu es un architecte logiciel expert. Tu dois produire un plan d'execution structure pour un pipeline d'agents AI.

Tu recois des instructions, des documents optionnels, et un catalogue d'agents/skills disponibles.
Tu dois analyser le travail demande et produire un plan JSON detaille avec des waves, des steps, et des sprints.

# IMPORTANT
- Reponds UNIQUEMENT avec un bloc JSON valide (pas de texte avant/apres)
- Le JSON doit etre parsable directement
- Sois exhaustif dans le decoupage : autant de sprints et waves que necessaire
- Chaque step doit avoir un prompt detaille et scope pour l'agent qui l'executera
- Les sprints groupent les waves logiquement (1 sprint = 1 livrable coherent)
- Un sprint peut contenir 1 a N waves`);

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

## Execution et dependances (CRITIQUE)

Le runner execute les waves dans l'ordre de leur numero. Les steps DANS une wave sont lances en parallele.
Le champ \`depends_on\` d'une wave contient les numeros des waves qui DOIVENT etre terminees AVANT que cette wave puisse demarrer.

Exemples de patterns :
- Wave 0 (Explore) → pas de dependance : \`"depends_on": []\`
- Wave 1 (Backend) depend de l'exploration : \`"depends_on": [0]\`
- Wave 2 (Frontend) depend aussi de l'exploration mais PAS du backend → \`"depends_on": [0]\` → les waves 1 et 2 tournent EN PARALLELE
- Wave 3 (Integration) depend du backend ET du frontend : \`"depends_on": [1, 2]\` → attend que les deux soient finies
- Wave 4 (Tests) depend de l'integration : \`"depends_on": [3]\`

Tu dois identifier les dependances reelles et maximiser le parallelisme :
- Si deux waves sont independantes (ex: backend et frontend), elles doivent avoir les memes depends_on pour tourner en parallele
- Si une wave a besoin du resultat d'une autre, elle doit la lister dans depends_on
- Le \`"parallel": true\` indique que les steps DANS cette wave peuvent tourner en parallele

## Waves et steps

1. **Wave 0 TOUJOURS = Exploration** : un agent Explore qui analyse le codebase et comprend le contexte. depends_on: []
2. **Waves d'implementation** : utilise les agents les plus pertinents du catalogue. Plusieurs waves paralleles si les domaines sont independants (ex: backend et frontend).
3. **Wave de validation** : toujours inclure un code-reviewer. depend de TOUTES les waves d'implementation.
4. **Waves optionnelles** : security-specialist, test-engineer, performance-engineer selon le besoin. Apres la validation.
5. **on_failure** : "abort" pour les waves critiques (exploration, setup DB), "retry" pour l'implementation, "continue" pour la validation/tests.
6. **Pas de wave vide** : chaque wave doit avoir au moins 1 step.

## Sprints

Les sprints groupent les waves en livrables coherents. Chaque sprint = un commit git potentiel.
- Un sprint peut contenir 1 a N waves
- Autant de sprints que necessaire (pas forcement 3)
- Objectifs precis et mesurables pour chaque sprint

## Steps

1. **Modeles** : haiku pour exploration/review simple, sonnet pour implementation, opus pour architecture complexe
2. **max_turns** : 3-5 pour trivial, 5-10 pour simple, 10-20 pour modere, 20-30 pour complexe
3. **Prompts** : DETAILLES et SCOPES. Chaque prompt doit etre autonome — l'agent ne connait PAS le plan global. Inclure le contexte, l'objectif precis, les fichiers a toucher, les contraintes, et le format de retour attendu. Minimum 200 mots.
4. **Skills** : toujours inclure "workflow-clean-code" + les skills specifiques au domaine de l'agent`);

  return sections.join("\n");
}

// ============================================
// Output Parsing
// ============================================

/**
 * Parse the raw output from Claude Opus into a validated PipelinePlan.
 * Handles JSON extraction from potentially wrapped output.
 */
function parsePlanOutput(raw: string, input: PipelineInput): PipelinePlan {
  let jsonStr = raw.trim();

  // Strip markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch?.[1]) {
    jsonStr = fenceMatch[1].trim();
  }

  // Try to find JSON object boundaries
  const firstBrace = jsonStr.indexOf("{");
  const lastBrace = jsonStr.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  } catch (parseError) {
    log.error(`Failed to parse plan JSON: ${(parseError as Error).message}`);
    log.error(`Raw output (first 500 chars): ${raw.slice(0, 500)}`);
    throw new Error(`LLM returned invalid JSON: ${(parseError as Error).message}. Raw output: ${raw.slice(0, 200)}`);
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
