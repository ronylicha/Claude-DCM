/**
 * Pipeline Planner — Auto-generates multi-wave execution plans
 * from user instructions and optional documents.
 *
 * Detects domains, matches agents, enriches from DB registry and
 * catalog, then builds an adaptive wave-based PipelinePlan.
 * @module pipeline/planner
 */

import type {
  PipelinePlan,
  PipelineWave,
  PipelineStepDef,
  PipelineInput,
  PipelineConstraints,
} from "./types";
import {
  generateId,
  matchAgentTypes,
  estimateComplexity,
  detectDomains,
  getSkillsForDomains,
  COMPLEXITY_TIERS,
  truncate,
} from "../lib/helpers";
import { getDb } from "../db/client";
import { createLogger } from "../lib/logger";
import { scanCatalog } from "../data/catalog";

const log = createLogger("Planner");

// ============================================
// Constants
// ============================================

/** Average time per agent turn in milliseconds */
const MS_PER_TURN = 3000;

/** Maximum chars to include per document excerpt in prompts */
const MAX_DOC_EXCERPT_CHARS = 2000;

/** Default agent types when no keyword match is found */
const DEFAULT_AGENTS = ["Explore", "Snipper"];

/** Agent registry row shape for the enrichment query */
interface AgentRegistryInfo {
  agent_type: string;
  category: string;
  recommended_model: string | null;
  wave_assignments: number[] | null;
}

/** Wave name constants */
const WAVE_NAMES: Record<string, string> = {
  exploration: "Exploration",
  implementation: "Implementation",
  validation: "Validation",
  security: "Security",
  testing: "Testing",
};

// ============================================
// Main Entry Point
// ============================================

/**
 * Generate a complete execution plan from user input.
 *
 * Detects domains and skills, matches agent types, enriches from
 * the DB agent_registry and filesystem catalog, then assembles
 * an adaptive multi-wave PipelinePlan.
 *
 * @param input - User instructions, documents, and scope targets
 * @param sessionId - Active session identifier for DB lookups
 * @returns A fully-formed PipelinePlan ready for execution
 */
export async function generatePlan(
  input: PipelineInput,
  _sessionId: string,
): Promise<PipelinePlan> {
  const startMs = performance.now();

  // 1. Aggregate text for domain detection
  const allText = buildDetectionText(input);
  const domains = detectDomains(allText);
  const requiredSkills = getSkillsForDomains(domains);

  log.info(`Domains detected: [${domains.join(", ")}], skills: ${requiredSkills.length}`);

  // 2. Match agent types from instructions
  let matchedAgents = matchAgentTypes(input.instructions);
  if (matchedAgents.length === 0) {
    matchedAgents = [...DEFAULT_AGENTS];
    log.info("No agent keyword match, defaulting to Explore + Snipper");
  }

  // 3. Enrich from DB agent_registry
  const registryMap = await fetchRegistryInfo(matchedAgents);

  // 4. Enrich from filesystem catalog
  const catalogSkills = await findCatalogSkills(domains);
  const mergedSkills = deduplicateSkills([...requiredSkills, ...catalogSkills]);

  // 5. Build adaptive waves
  const waves = buildWaves(input, matchedAgents, registryMap, mergedSkills, domains);

  // 6. Assemble the plan
  const constraints: PipelineConstraints = {
    max_parallel: 4,
    max_total_retries: 6,
    timeout_ms: 0,
  };

  const totalDuration = waves.reduce((sum, w) => sum + estimateWaveDuration(w), 0);

  const plan: PipelinePlan = {
    plan_id: generateId("plan"),
    version: 1,
    name: buildPlanName(input.instructions),
    estimated_duration_ms: totalDuration,
    waves,
    required_skills: mergedSkills,
    constraints,
  };

  const elapsed = Math.round(performance.now() - startMs);
  log.info(
    `Plan generated: id=${plan.plan_id}, waves=${waves.length}, ` +
    `steps=${waves.reduce((s, w) => s + w.steps.length, 0)}, ` +
    `est=${totalDuration}ms, took=${elapsed}ms`,
  );

  return plan;
}

// ============================================
// Wave Construction
// ============================================

/**
 * Build the ordered list of waves based on detected agents and domains.
 * Always starts with Exploration and ends with Validation.
 * Optionally adds Security and Testing waves when relevant.
 */
function buildWaves(
  input: PipelineInput,
  matchedAgents: string[],
  registryMap: Map<string, AgentRegistryInfo>,
  skills: string[],
  domains: string[],
): PipelineWave[] {
  const waves: PipelineWave[] = [];
  let waveNumber = 0;

  // Wave 0: Exploration (always present)
  waves.push({
    number: waveNumber,
    name: WAVE_NAMES["exploration"] ?? "Exploration",
    steps: [
      buildStep(0, "Explore", "Explore and understand the codebase relevant to the task", input, skills, registryMap, undefined),
    ],
    depends_on: [],
    on_failure: "continue",
  });
  waveNumber++;

  // Wave 1: Implementation (matched agents, parallel)
  const implementationAgents = matchedAgents.filter((a) => a !== "Explore" && a !== "code-reviewer");
  if (implementationAgents.length === 0) {
    implementationAgents.push("Snipper");
  }

  const implSteps = implementationAgents.map((agent, idx) =>
    buildStep(
      idx,
      agent,
      `Implement changes using ${agent}: ${truncate(input.instructions, 120)}`,
      input,
      skills,
      registryMap,
      "Results from exploration wave are available as context.",
    ),
  );

  waves.push({
    number: waveNumber,
    name: WAVE_NAMES["implementation"] ?? "Implementation",
    steps: implSteps,
    depends_on: [0],
    on_failure: "retry",
  });
  waveNumber++;

  // Wave 2: Validation (always present)
  waves.push({
    number: waveNumber,
    name: WAVE_NAMES["validation"] ?? "Validation",
    steps: [
      buildStep(
        0,
        "code-reviewer",
        "Review all changes made in the implementation wave",
        input,
        skills,
        registryMap,
        "Implementation wave completed. Review all modifications for correctness.",
      ),
    ],
    depends_on: [waveNumber - 1],
    on_failure: "continue",
  });
  waveNumber++;

  // Conditional Wave: Security
  if (domains.includes("security")) {
    waves.push({
      number: waveNumber,
      name: WAVE_NAMES["security"] ?? "Security",
      steps: [
        buildStep(
          0,
          "security-specialist",
          "Audit changes for security vulnerabilities and OWASP compliance",
          input,
          skills,
          registryMap,
          "Implementation and review waves completed. Perform security audit.",
        ),
      ],
      depends_on: [waveNumber - 1],
      on_failure: "continue",
    });
    waveNumber++;
  }

  // Conditional Wave: Testing
  if (domains.includes("testing")) {
    waves.push({
      number: waveNumber,
      name: WAVE_NAMES["testing"] ?? "Testing",
      steps: [
        buildStep(
          0,
          "test-engineer",
          "Write or update tests covering the implemented changes",
          input,
          skills,
          registryMap,
          "Implementation and review waves completed. Ensure test coverage.",
        ),
      ],
      depends_on: [waveNumber - 1],
      on_failure: "continue",
    });
  }

  return waves;
}

// ============================================
// Step Construction
// ============================================

/**
 * Build a single pipeline step definition with scoped prompt.
 */
function buildStep(
  order: number,
  agentType: string,
  description: string,
  input: PipelineInput,
  skills: string[],
  registryMap: Map<string, AgentRegistryInfo>,
  previousWaveContext: string | undefined,
): PipelineStepDef {
  const registryInfo = registryMap.get(agentType);
  const complexity = estimateComplexity(
    input.instructions,
    (input.target_files?.length ?? 0) + (input.target_directories?.length ?? 0),
  );

  const model = registryInfo?.recommended_model ?? complexity.model;
  const maxTurns = resolveMaxTurns(agentType, complexity.max_turns);

  const prompt = buildStepPrompt(description, agentType, input, previousWaveContext);

  return {
    order,
    agent_type: agentType,
    description,
    skills: filterSkillsForAgent(agentType, skills),
    prompt,
    model,
    max_turns: maxTurns,
    target_files: input.target_files ?? [],
    target_directories: input.target_directories ?? [],
    retry_strategy: "enhanced",
    max_retries: 2,
  };
}

/**
 * Resolve max_turns for a given agent type.
 * Exploration and review agents get reduced budgets.
 */
function resolveMaxTurns(agentType: string, baseTurns: number): number {
  const moderateTurns = COMPLEXITY_TIERS["moderate"]?.max_turns ?? 10;
  const simpleTurns = COMPLEXITY_TIERS["simple"]?.max_turns ?? 5;
  const overrides: Record<string, number> = {
    "Explore": Math.min(baseTurns, moderateTurns),
    "code-reviewer": Math.min(baseTurns, simpleTurns),
    "security-specialist": moderateTurns,
    "test-engineer": moderateTurns,
  };
  return overrides[agentType] ?? baseTurns;
}

/**
 * Filter the global skill list to only those relevant for a given agent type.
 * Always includes workflow-clean-code.
 */
function filterSkillsForAgent(agentType: string, allSkills: string[]): string[] {
  const agentDomainMap: Record<string, string[]> = {
    "frontend-react":      ["react-best-practices", "vercel-react-best-practices", "ui-ux-pro-max"],
    "backend-laravel":     ["laravel-expert", "api-design-principles"],
    "supabase-backend":    ["postgresql", "sql-pro"],
    "database-admin":      ["postgresql", "sql-pro"],
    "security-specialist": ["security-auditor", "vulnerability-scanner"],
    "test-engineer":       ["senior-qa", "tdd-orchestrator"],
    "devops-infra":        ["senior-devops", "docker-expert"],
    "designer-ui-ux":      ["ui-ux-pro-max", "web-design-reviewer"],
  };

  const relevant = agentDomainMap[agentType];
  if (!relevant) {
    // For generic agents (Explore, Snipper, etc.), return workflow skill only
    return allSkills.filter((s) => s === "workflow-clean-code");
  }

  const filtered = allSkills.filter(
    (s) => s === "workflow-clean-code" || relevant.includes(s),
  );

  return filtered.length > 0 ? filtered : ["workflow-clean-code"];
}

// ============================================
// Prompt Building
// ============================================

/**
 * Build a structured, scoped prompt for a pipeline step.
 *
 * Includes the task header, instructions, document excerpts,
 * scope constraints, previous wave context, and completion instructions.
 *
 * @param description - Step-level task description
 * @param agentType - Agent type that will execute this step
 * @param input - Original pipeline input with instructions and documents
 * @param previousWaveContext - Optional summary from a completed wave
 * @returns Assembled prompt string
 */
export function buildStepPrompt(
  description: string,
  agentType: string,
  input: PipelineInput,
  previousWaveContext?: string,
): string {
  const sections: string[] = [];

  // Header
  sections.push(`# Task for ${agentType}`);
  sections.push("");

  // Instructions
  sections.push("## Instructions");
  sections.push("");
  sections.push(input.instructions);
  sections.push("");

  // Step-specific description
  sections.push("## Step Objective");
  sections.push("");
  sections.push(description);
  sections.push("");

  // Document excerpts
  if (input.documents && input.documents.length > 0) {
    sections.push("## Reference Documents");
    sections.push("");
    for (const doc of input.documents) {
      sections.push(`### ${doc.name} (${doc.type})`);
      sections.push("");
      sections.push(truncate(doc.content, MAX_DOC_EXCERPT_CHARS));
      sections.push("");
    }
  }

  // Scope constraints
  sections.push("## Scope Constraints");
  sections.push("");

  const targetFiles = input.target_files ?? [];
  const targetDirs = input.target_directories ?? [];

  if (targetFiles.length > 0) {
    sections.push("**Target Files** (focus on these files):");
    for (const f of targetFiles) {
      sections.push(`- \`${f}\``);
    }
    sections.push("");
  }

  if (targetDirs.length > 0) {
    sections.push("**Target Directories** (stay within these boundaries):");
    for (const d of targetDirs) {
      sections.push(`- \`${d}\``);
    }
    sections.push("");
  }

  if (targetFiles.length === 0 && targetDirs.length === 0) {
    sections.push("No explicit file targets. Work only on files directly relevant to the task.");
    sections.push("");
  }

  sections.push("**Rules**:");
  sections.push("- Do NOT scan the entire codebase");
  sections.push("- Do NOT explore files outside the target scope");
  sections.push("- Do NOT create files unless absolutely necessary");
  sections.push("");

  // Previous wave context
  if (previousWaveContext) {
    sections.push("## Previous Wave Context");
    sections.push("");
    sections.push(previousWaveContext);
    sections.push("");
  }

  // Completion instructions
  sections.push("## Completion");
  sections.push("");
  sections.push("When done, provide a concise summary of:");
  sections.push("1. What was changed or discovered");
  sections.push("2. Files modified (if any)");
  sections.push("3. Any issues or blockers encountered");

  return sections.join("\n");
}

// ============================================
// Duration Estimation
// ============================================

/**
 * Estimate the wall-clock duration for a wave in milliseconds.
 * Based on step count multiplied by average turn time and max_turns.
 * Parallel steps use the maximum, not the sum.
 *
 * @param wave - The pipeline wave to estimate
 * @returns Estimated duration in milliseconds
 */
export function estimateWaveDuration(wave: PipelineWave): number {
  if (wave.steps.length === 0) return 0;

  // Parallel execution: duration = max step duration, not sum
  const stepDurations = wave.steps.map(
    (step) => step.max_turns * MS_PER_TURN,
  );

  return Math.max(...stepDurations);
}

// ============================================
// DB & Catalog Enrichment
// ============================================

/**
 * Fetch agent registry info for a list of agent types.
 * Returns a Map for O(1) lookup. Gracefully handles DB errors.
 */
async function fetchRegistryInfo(
  agentTypes: string[],
): Promise<Map<string, AgentRegistryInfo>> {
  const result = new Map<string, AgentRegistryInfo>();
  if (agentTypes.length === 0) return result;

  try {
    const sql = getDb();
    const rows = await sql<AgentRegistryInfo[]>`
      SELECT agent_type, category, recommended_model, wave_assignments
      FROM agent_registry
      WHERE agent_type = ANY(${agentTypes})
    `;

    for (const row of rows) {
      result.set(row.agent_type, row);
    }

    log.debug(`Registry enrichment: ${result.size}/${agentTypes.length} agents found`);
  } catch (error) {
    log.warn("Agent registry lookup failed, proceeding without enrichment:", error);
  }

  return result;
}

/**
 * Scan the filesystem catalog for additional skills matching detected domains.
 */
async function findCatalogSkills(domains: string[]): Promise<string[]> {
  if (domains.length === 0) return [];

  try {
    const { skills } = await scanCatalog();

    // Map domain names to catalog categories
    const categoryMap: Record<string, string> = {
      react: "frontend",
      nextjs: "frontend",
      laravel: "php",
      database: "database",
      testing: "testing",
      security: "security",
      devops: "devops",
      ui: "design",
      mobile: "mobile",
    };

    const targetCategories = new Set(
      domains.map((d) => categoryMap[d]).filter(Boolean),
    );

    const matched = skills
      .filter((s) => targetCategories.has(s.category))
      .map((s) => s.id)
      .slice(0, 10); // Cap to avoid prompt bloat

    log.debug(`Catalog enrichment: ${matched.length} additional skills from ${targetCategories.size} categories`);
    return matched;
  } catch (error) {
    log.warn("Catalog scan failed, proceeding without catalog enrichment:", error);
    return [];
  }
}

// ============================================
// Internal Helpers
// ============================================

/**
 * Aggregate all textual content from input for domain detection.
 */
function buildDetectionText(input: PipelineInput): string {
  const parts = [input.instructions];

  if (input.documents) {
    for (const doc of input.documents) {
      parts.push(truncate(doc.content, MAX_DOC_EXCERPT_CHARS));
    }
  }

  return parts.join(" ");
}

/**
 * Generate a short plan name from the first ~60 chars of instructions.
 */
function buildPlanName(instructions: string): string {
  const firstLine = instructions.split("\n")[0] ?? instructions;
  const cleaned = firstLine.replace(/[^a-zA-Z0-9\s-]/g, "").trim();
  return truncate(cleaned, 60) || "Unnamed Plan";
}

/**
 * Deduplicate a skill list while preserving order.
 */
function deduplicateSkills(skills: string[]): string[] {
  return Array.from(new Set(skills));
}
