/**
 * Orchestration Planner API - Craft scoped prompts and decompose tasks
 * DCM as the true orchestrator brain: scope injection before subagent launch
 * @module api/orchestration-planner
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("OrcPlanner");

// ============================================
// Types
// ============================================

/** Agent registry row (subset needed for prompt crafting) */
interface AgentRegistryRow {
  agent_type: string;
  category: string;
  display_name: string | null;
  default_scope: Record<string, unknown>;
  allowed_tools: string[] | null;
  forbidden_actions: string[] | null;
  max_files: number | null;
  wave_assignments: number[] | null;
  recommended_model: string | null;
}

/** Previous wave result row */
interface PreviousResultRow {
  agent_type: string | null;
  description: string;
  result: Record<string, unknown> | null;
  status: string;
}

/** Complexity tier definition */
interface ComplexityTier {
  name: string;
  max_turns: number;
  model: string;
}

// ============================================
// Complexity Estimation (pure functions)
// ============================================

const COMPLEXITY_TIERS: Record<string, ComplexityTier> = {
  trivial: { name: "trivial", max_turns: 3, model: "haiku" },
  simple: { name: "simple", max_turns: 5, model: "haiku" },
  moderate: { name: "moderate", max_turns: 10, model: "sonnet" },
  complex: { name: "complex", max_turns: 20, model: "sonnet" },
  expert: { name: "expert", max_turns: 30, model: "opus" },
};

/** Keywords that indicate higher complexity */
const COMPLEXITY_KEYWORDS: Record<string, string[]> = {
  trivial: ["fix typo", "rename", "update comment", "single line", "simple fix"],
  simple: ["add field", "update config", "small change", "minor fix", "one file"],
  moderate: ["refactor", "implement", "create component", "add endpoint", "multi-file"],
  complex: ["explore", "audit", "scan", "analyze", "investigate", "research", "debug"],
  expert: ["architecture", "redesign", "migration", "security audit", "performance"],
};

/**
 * Estimate task complexity from description and file count.
 * Pure function - no DB or LLM calls.
 */
export function estimateComplexity(
  description: string,
  targetFileCount: number,
  agentScope?: AgentRegistryRow | null,
): ComplexityTier {
  const lower = description.toLowerCase();

  // Check keywords from highest to lowest
  for (const tier of ["expert", "complex", "moderate", "simple", "trivial"] as const) {
    const keywords = COMPLEXITY_KEYWORDS[tier];
    if (keywords.some((kw) => lower.includes(kw))) {
      return COMPLEXITY_TIERS[tier];
    }
  }

  // Fallback: estimate by file count
  if (targetFileCount <= 1) return COMPLEXITY_TIERS.trivial;
  if (targetFileCount <= 3) return COMPLEXITY_TIERS.simple;
  if (targetFileCount <= 8) return COMPLEXITY_TIERS.moderate;
  if (targetFileCount <= 15) return COMPLEXITY_TIERS.complex;
  return COMPLEXITY_TIERS.expert;
}

// ============================================
// Prompt Building (pure functions)
// ============================================

/**
 * Build the MANDATORY scope constraints block for the prompt.
 */
export function buildScopeSection(
  targetFiles: string[],
  targetDirectories: string[],
  agentScope?: AgentRegistryRow | null,
): string {
  const lines: string[] = [];

  lines.push("## MANDATORY Scope Constraints");
  lines.push("");

  if (targetFiles.length > 0) {
    lines.push("**Target Files** (ONLY touch these files):");
    for (const f of targetFiles) {
      lines.push(`- \`${f}\``);
    }
    lines.push("");
  }

  if (targetDirectories.length > 0) {
    lines.push("**Target Directories** (stay within these boundaries):");
    for (const d of targetDirectories) {
      lines.push(`- \`${d}\``);
    }
    lines.push("");
  }

  if (targetFiles.length === 0 && targetDirectories.length === 0) {
    lines.push("**WARNING**: No target files or directories specified. Work ONLY on files directly relevant to the task.");
    lines.push("");
  }

  if (agentScope) {
    if (agentScope.max_files) {
      lines.push(`**Max Files**: Do not modify more than ${agentScope.max_files} files.`);
    }
    if (agentScope.forbidden_actions && agentScope.forbidden_actions.length > 0) {
      lines.push(`**Forbidden Actions**: ${agentScope.forbidden_actions.join(", ")}`);
    }
    if (agentScope.allowed_tools && agentScope.allowed_tools.length > 0) {
      lines.push(`**Allowed Tools**: ${agentScope.allowed_tools.join(", ")}`);
    }
  }

  lines.push("");
  lines.push("**Rules**:");
  lines.push("- Do NOT scan the entire codebase");
  lines.push("- Do NOT explore files outside the target scope");
  lines.push("- Do NOT create files unless absolutely necessary");
  lines.push("- Complete your task and report results concisely");

  return lines.join("\n");
}

/**
 * Build context section from previous wave results.
 */
function buildContextSection(previousResults: PreviousResultRow[]): string {
  if (previousResults.length === 0) return "";

  const lines: string[] = [];
  lines.push("## Previous Wave Context");
  lines.push("");
  lines.push(`${previousResults.length} task(s) completed in previous wave(s):`);
  lines.push("");

  for (const r of previousResults) {
    const agent = r.agent_type ?? "unknown";
    const status = r.status === "completed" ? "done" : r.status;
    lines.push(`- **${agent}** (${status}): ${r.description}`);
    if (r.result) {
      const summary = r.result["summary"] ?? r.result["files"] ?? null;
      if (summary) {
        lines.push(`  Result: ${typeof summary === "string" ? summary : JSON.stringify(summary)}`);
      }
    }
  }

  return lines.join("\n");
}

/**
 * Assemble the final prompt from all sections.
 */
function assemblePrompt(
  taskDescription: string,
  agentType: string,
  scopeSection: string,
  contextSection: string,
  agentScope?: AgentRegistryRow | null,
): string {
  const parts: string[] = [];

  // Role header
  const displayName = agentScope?.display_name ?? agentType;
  parts.push(`# Task for ${displayName}`);
  parts.push("");

  // Task description
  parts.push("## Task");
  parts.push("");
  parts.push(taskDescription);
  parts.push("");

  // Scope constraints (MANDATORY)
  parts.push(scopeSection);
  parts.push("");

  // Previous wave context (if any)
  if (contextSection) {
    parts.push(contextSection);
    parts.push("");
  }

  // Completion instructions
  parts.push("## Completion");
  parts.push("");
  parts.push("When done, provide a concise summary of:");
  parts.push("1. What was changed/found");
  parts.push("2. Files modified (if any)");
  parts.push("3. Any issues or blockers encountered");

  return parts.join("\n");
}

// ============================================
// Zod Schemas
// ============================================

const CraftPromptInputSchema = z.object({
  task_description: z.string().min(1, "task_description is required"),
  agent_type: z.string().min(1, "agent_type is required"),
  session_id: z.string().optional(),
  target_files: z.array(z.string()).optional().default([]),
  target_directories: z.array(z.string()).optional().default([]),
  context_budget_tokens: z.number().int().min(100).optional(),
  wave_number: z.number().int().min(0).optional(),
});

const DecomposeInputSchema = z.object({
  task_description: z.string().min(1, "task_description is required"),
  session_id: z.string().optional(),
  constraints: z.object({
    max_parallel: z.number().int().min(1).max(5).optional().default(3),
    max_total_turns: z.number().int().min(5).max(200).optional().default(50),
  }).optional().default({}),
});

// ============================================
// Decomposition helpers
// ============================================

/** Agent matching keywords for decomposition */
const AGENT_KEYWORDS: Record<string, string[]> = {
  "Explore": ["explore", "find", "search", "scan", "investigate", "understand", "codebase"],
  "Snipper": ["edit", "modify", "change", "update", "fix", "create file", "write code"],
  "frontend-react": ["react", "component", "ui", "frontend", "tsx", "jsx", "css", "style"],
  "backend-laravel": ["laravel", "php", "controller", "migration", "model", "artisan"],
  "supabase-backend": ["supabase", "rls", "policy", "database", "schema", "sql"],
  "test-engineer": ["test", "testing", "spec", "coverage", "assert", "expect", "jest", "vitest"],
  "security-specialist": ["security", "vulnerability", "auth", "permission", "owasp"],
  "docs-writer": ["document", "readme", "docs", "api doc", "changelog"],
  "code-reviewer": ["review", "audit", "quality", "lint", "clean"],
  "performance-engineer": ["performance", "optimize", "cache", "latency", "profil"],
};

/**
 * Match task description to agent types using keyword heuristics.
 */
function matchAgentTypes(description: string): string[] {
  const lower = description.toLowerCase();
  const matches: Array<{ agent: string; score: number }> = [];

  for (const [agent, keywords] of Object.entries(AGENT_KEYWORDS)) {
    const score = keywords.filter((kw) => lower.includes(kw)).length;
    if (score > 0) {
      matches.push({ agent, score });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.map((m) => m.agent);
}

// ============================================
// API Handlers
// ============================================

/**
 * POST /api/orchestration/craft-prompt - Craft a scoped prompt for a subagent
 */
export async function postCraftPrompt(c: Context): Promise<Response> {
  try {
    const raw = await c.req.json();

    const parseResult = CraftPromptInputSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const input = parseResult.data;
    const sql = getDb();

    // 1. Fetch agent scope from registry (graceful if not found)
    let agentScope: AgentRegistryRow | null = null;
    try {
      const results = await sql<AgentRegistryRow[]>`
        SELECT agent_type, category, display_name, default_scope,
               allowed_tools, forbidden_actions, max_files,
               wave_assignments, recommended_model, created_at
        FROM agent_registry
        WHERE agent_type = ${input.agent_type}
      `;
      agentScope = results[0] ?? null;
    } catch {
      // Registry lookup failed - proceed without scope
      log.warn(`Registry lookup failed for ${input.agent_type}, proceeding without scope`);
    }

    // 2. Estimate complexity
    const targetFileCount = input.target_files.length + input.target_directories.length;
    const complexity = estimateComplexity(input.task_description, targetFileCount, agentScope);

    // Override model from registry if available
    const model = agentScope?.recommended_model ?? complexity.model;

    // 3. Fetch previous wave results if applicable
    let previousResults: PreviousResultRow[] = [];

    if (input.wave_number !== undefined && input.wave_number > 0 && input.session_id) {
      const previousWave = input.wave_number - 1;
      try {
        previousResults = await sql<PreviousResultRow[]>`
          SELECT s.agent_type, s.description, s.result, s.status
          FROM subtasks s
          JOIN task_lists t ON s.task_list_id = t.id
          JOIN requests r ON t.request_id = r.id
          WHERE r.session_id = ${input.session_id}
            AND s.status = 'completed'
            AND EXISTS (
              SELECT 1 FROM agent_registry ar
              WHERE ar.agent_type = s.agent_type
                AND ${previousWave} = ANY(ar.wave_assignments)
            )
          ORDER BY s.completed_at ASC
          LIMIT 10
        `;
      } catch {
        // Previous results lookup failed - proceed without context
        log.warn(`Previous wave results lookup failed for session ${input.session_id}`);
      }
    }

    // 4. Build prompt sections
    const scopeSection = buildScopeSection(
      input.target_files,
      input.target_directories,
      agentScope,
    );
    const contextSection = buildContextSection(previousResults);

    // 5. Assemble final prompt
    const craftedPrompt = assemblePrompt(
      input.task_description,
      input.agent_type,
      scopeSection,
      contextSection,
      agentScope,
    );

    // 6. Apply token budget if specified (truncate prompt if too long)
    let finalPrompt = craftedPrompt;
    if (input.context_budget_tokens) {
      // Rough estimate: 1 token ≈ 4 chars
      const maxChars = input.context_budget_tokens * 4;
      if (finalPrompt.length > maxChars) {
        finalPrompt = finalPrompt.substring(0, maxChars) + "\n\n[... truncated to fit budget]";
      }
    }

    log.info(
      `Crafted prompt: agent=${input.agent_type}, complexity=${complexity.name}, ` +
      `turns=${complexity.max_turns}, model=${model}, chars=${finalPrompt.length}`,
    );

    return c.json({
      crafted_prompt: finalPrompt,
      max_turns: complexity.max_turns,
      model,
      complexity: complexity.name,
      scope_directives: {
        target_files: input.target_files,
        target_directories: input.target_directories,
        max_files: agentScope?.max_files ?? null,
        forbidden_actions: agentScope?.forbidden_actions ?? null,
      },
    });
  } catch (error) {
    log.error("POST /api/orchestration/craft-prompt error:", error);
    return c.json(
      {
        error: "Failed to craft prompt",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/orchestration/decompose - Decompose a complex task into subtasks
 */
export async function postDecompose(c: Context): Promise<Response> {
  try {
    const raw = await c.req.json();

    const parseResult = DecomposeInputSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const input = parseResult.data;
    const maxParallel = input.constraints.max_parallel;
    const maxTotalTurns = input.constraints.max_total_turns;

    // Build subtask list
    const subtasks: Array<{
      step: number;
      wave: number;
      agent_type: string;
      description: string;
      max_turns: number;
      model: string;
      depends_on: number[];
    }> = [];

    let stepCounter = 0;

    // Wave 0: Exploration (always present)
    subtasks.push({
      step: stepCounter++,
      wave: 0,
      agent_type: "Explore",
      description: `Explore and understand the codebase relevant to: ${input.task_description}`,
      max_turns: 8,
      model: "sonnet",
      depends_on: [],
    });

    // Wave 1: Implementation steps (based on keyword matching)
    const matchedAgents = matchAgentTypes(input.task_description);
    const implementationAgents = matchedAgents.length > 0
      ? matchedAgents.slice(0, maxParallel)
      : ["Snipper"]; // Default to Snipper if no match

    const exploreStep = 0;
    for (const agent of implementationAgents) {
      const complexity = estimateComplexity(input.task_description, 3, null);
      subtasks.push({
        step: stepCounter++,
        wave: 1,
        agent_type: agent,
        description: `Implement: ${input.task_description}`,
        max_turns: complexity.max_turns,
        model: complexity.model,
        depends_on: [exploreStep],
      });
    }

    // Wave 2: Validation (always present)
    const implementationSteps = subtasks
      .filter((s) => s.wave === 1)
      .map((s) => s.step);

    subtasks.push({
      step: stepCounter++,
      wave: 2,
      agent_type: "code-reviewer",
      description: `Review and validate changes from: ${input.task_description}`,
      max_turns: 5,
      model: "haiku",
      depends_on: implementationSteps,
    });

    // Budget enforcement: if total turns exceed max, scale down proportionally
    const totalTurns = subtasks.reduce((sum, s) => sum + s.max_turns, 0);
    if (totalTurns > maxTotalTurns) {
      const scaleFactor = maxTotalTurns / totalTurns;
      for (const subtask of subtasks) {
        subtask.max_turns = Math.max(2, Math.round(subtask.max_turns * scaleFactor));
      }
    }

    // Build execution plan grouped by wave
    const waveMap = new Map<number, typeof subtasks>();
    for (const s of subtasks) {
      if (!waveMap.has(s.wave)) {
        waveMap.set(s.wave, []);
      }
      waveMap.get(s.wave)!.push(s);
    }

    const waves = Array.from(waveMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([waveNum, tasks]) => ({
        wave: waveNum,
        parallel: tasks.length,
        tasks: tasks.map((t) => t.step),
      }));

    // Generate plan ID
    const planId = `plan_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    log.info(
      `Decomposed task: plan=${planId}, subtasks=${subtasks.length}, waves=${waves.length}, ` +
      `total_turns=${subtasks.reduce((s, t) => s + t.max_turns, 0)}`,
    );

    return c.json({
      plan_id: planId,
      subtasks,
      execution_plan: {
        waves,
        total_turns: subtasks.reduce((s, t) => s + t.max_turns, 0),
        max_parallel: maxParallel,
      },
    });
  } catch (error) {
    log.error("POST /api/orchestration/decompose error:", error);
    return c.json(
      {
        error: "Failed to decompose task",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

export { CraftPromptInputSchema, DecomposeInputSchema, COMPLEXITY_TIERS, COMPLEXITY_KEYWORDS, AGENT_KEYWORDS };
