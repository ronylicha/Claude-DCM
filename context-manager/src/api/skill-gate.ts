/**
 * Skill Gate API — Enforcement, tracking, and status for the skill-gate system
 * DCM v4.2 — Dynamic resolution via skill-index.json + advisor reco + catalog
 * @module api/skill-gate
 */

import type { Context } from "hono";
import { getDb } from "../db/client";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Cached skill index (loaded once, refreshed every 5 min)
let skillIndex: SkillIndex | null = null;
let skillIndexLoadedAt = 0;
const INDEX_TTL_MS = 300_000;

interface DomainEntry {
  primary: string[];
  complementary: string[];
  keywords: string[];
  agents: { recommended: string[]; alternatives: string[] };
}

interface SkillIndex {
  domains: Record<string, DomainEntry>;
  workflow_templates: Record<string, unknown>;
}

// File extension → domain mapping (dynamic, derived from skill-index keywords)
const EXT_DOMAIN_MAP: Record<string, string> = {
  ".php": "backend-laravel",
  ".blade.php": "backend-laravel",
  ".tsx": "react",
  ".jsx": "react",
  ".vue": "nextjs",
  ".sql": "database",
  ".prisma": "database",
  ".test.ts": "testing",
  ".test.tsx": "testing",
  ".spec.ts": "testing",
  ".spec.tsx": "testing",
  ".test.php": "testing",
  ".dart": "flutter",
  ".swift": "react-native",
  ".kt": "react-native",
  ".py": "backend-python",
  ".go": "backend-node",
  ".rs": "backend-node",
  ".tf": "devops",
  ".yml": "devops",
  ".yaml": "devops",
  ".Dockerfile": "devops",
};

// Whitelisted file patterns (no skill required)
const WHITELIST_EXTS = [".md", ".txt", ".json", ".toml", ".ini", ".cfg", ".conf", ".log", ".sh", ".env", ".lock"];
const WHITELIST_PATHS = [".claude/", "node_modules/", "vendor/", ".git/", "dist/", "build/", ".next/"];

// Agent whitelist (analysis/exploration agents, never blocked)
const AGENT_WHITELIST = new Set([
  "Explore", "Plan", "impact-analyzer", "regression-guard",
  "code-reviewer", "code-explorer", "tech-lead", "project-supervisor",
  "feature-dev:code-explorer", "feature-dev:code-reviewer", "feature-dev:code-architect",
]);

async function loadSkillIndex(): Promise<SkillIndex | null> {
  if (skillIndex && Date.now() - skillIndexLoadedAt < INDEX_TTL_MS) return skillIndex;

  const paths = [
    join(__dirname, "../../hooks/skill-advisor/skill-index.json"),
    join(process.env["HOME"] || "/home/user", ".claude/scripts/skill-advisor/skill-index.json"),
  ];

  for (const p of paths) {
    try {
      const raw = await readFile(p, "utf-8");
      skillIndex = JSON.parse(raw) as SkillIndex;
      skillIndexLoadedAt = Date.now();
      return skillIndex;
    } catch { /* try next */ }
  }
  return null;
}

function detectDomainFromFile(filePath: string): string | null {
  if (!filePath) return null;
  const lower = filePath.toLowerCase();

  // Check whitelist (no enforcement needed)
  for (const ext of WHITELIST_EXTS) {
    if (lower.endsWith(ext)) return null;
  }
  for (const pathPart of WHITELIST_PATHS) {
    if (lower.includes(pathPart)) return null;
  }

  // Check migration patterns
  if (lower.includes("migration") || lower.includes("migrate")) return "database";

  // Match by extension
  for (const [ext, domain] of Object.entries(EXT_DOMAIN_MAP)) {
    if (lower.endsWith(ext)) return domain;
  }

  // .ts files: check path for frontend indicators
  if (lower.endsWith(".ts")) {
    if (/\/(component|page|hook|screen|src\/ui|src\/app|src\/features)\//.test(lower)) {
      return "react";
    }
  }

  return null;
}

function findDomainForAgent(agentType: string, index: SkillIndex): string | null {
  for (const [domain, entry] of Object.entries(index.domains)) {
    if (entry.agents.recommended.includes(agentType) || entry.agents.alternatives.includes(agentType)) {
      return domain;
    }
  }
  return null;
}

// ============================================
// POST /api/skill-gate/:session_id/skills
// ============================================

export async function postSkill(c: Context): Promise<Response> {
  const sessionId = c.req.param("session_id");
  const body = await c.req.json().catch(() => ({})) as { skill?: string };
  const skill = body.skill;

  if (!sessionId || !skill) {
    return c.json({ error: "session_id and skill required" }, 400);
  }

  const sql = getDb();

  await sql`
    INSERT INTO session_skills (session_id, skill_name)
    VALUES (${sessionId}, ${skill})
    ON CONFLICT (session_id, skill_name) DO NOTHING
  `;

  // Update skills_loaded count
  const countRows = await sql`
    SELECT COUNT(*)::int as count FROM session_skills WHERE session_id = ${sessionId}
  `;
  const count = countRows[0]?.["count"] ?? 0;

  await sql`
    INSERT INTO session_workflow_state (session_id, skills_loaded)
    VALUES (${sessionId}, ${count})
    ON CONFLICT (session_id) DO UPDATE SET skills_loaded = ${count}
  `;

  return c.json({ success: true, skill, skills_loaded: count }, 201);
}

// ============================================
// POST /api/skill-gate/:session_id/workflow
// ============================================

export async function postWorkflow(c: Context): Promise<Response> {
  const sessionId = c.req.param("session_id");
  const body = await c.req.json().catch(() => ({})) as { flag?: string; value?: unknown };

  if (!sessionId || !body.flag) {
    return c.json({ error: "session_id and flag required" }, 400);
  }

  const sql = getDb();

  // Ensure row exists
  await sql`
    INSERT INTO session_workflow_state (session_id)
    VALUES (${sessionId})
    ON CONFLICT (session_id) DO NOTHING
  `;

  // Update the specific flag
  switch (body.flag) {
    case "init":
      // Already created above
      break;
    case "impact_analyzer":
      await sql`UPDATE session_workflow_state SET impact_analyzer = ${Boolean(body.value)} WHERE session_id = ${sessionId}`;
      break;
    case "regression_guard":
      await sql`UPDATE session_workflow_state SET regression_guard = ${Boolean(body.value)} WHERE session_id = ${sessionId}`;
      break;
    case "task_size":
      await sql`UPDATE session_workflow_state SET task_size = ${String(body.value)} WHERE session_id = ${sessionId}`;
      break;
    default:
      return c.json({ error: `Unknown flag: ${body.flag}` }, 400);
  }

  return c.json({ success: true, flag: body.flag });
}

// ============================================
// POST /api/skill-gate/:session_id/advisor
// ============================================

export async function postAdvisor(c: Context): Promise<Response> {
  const sessionId = c.req.param("session_id");
  const body = await c.req.json().catch(() => null);

  if (!sessionId || !body) {
    return c.json({ error: "session_id and advisor reco body required" }, 400);
  }

  const sql = getDb();

  await sql`
    INSERT INTO session_workflow_state (session_id, advisor_reco, advisor_updated_at)
    VALUES (${sessionId}, ${sql.json(body)}, NOW())
    ON CONFLICT (session_id) DO UPDATE SET
      advisor_reco = ${sql.json(body)},
      advisor_updated_at = NOW()
  `;

  return c.json({ success: true });
}

// ============================================
// GET /api/skill-gate/:session_id/status
// ============================================

export async function getStatus(c: Context): Promise<Response> {
  const sessionId = c.req.param("session_id");
  if (!sessionId) return c.json({ error: "session_id required" }, 400);

  const sql = getDb();

  const skills = await sql`
    SELECT skill_name, loaded_at FROM session_skills
    WHERE session_id = ${sessionId} ORDER BY loaded_at
  `;

  const workflows = await sql`
    SELECT * FROM session_workflow_state WHERE session_id = ${sessionId}
  `;
  const workflow = workflows[0] || null;

  return c.json({
    session_id: sessionId,
    skills: skills.map((s: Record<string, unknown>) => s["skill_name"]),
    skills_count: skills.length,
    workflow: workflow ? {
      task_size: workflow["task_size"],
      impact_analyzer: workflow["impact_analyzer"],
      regression_guard: workflow["regression_guard"],
      skills_loaded: workflow["skills_loaded"],
    } : null,
    advisor: workflow?.["advisor_reco"] || null,
    advisor_fresh: workflow?.["advisor_updated_at"]
      ? Date.now() - new Date(workflow["advisor_updated_at"] as string).getTime() < 300_000
      : false,
  });
}

// ============================================
// GET /api/skill-gate/:session_id/check
// ============================================

export async function checkGate(c: Context): Promise<Response> {
  const sessionId = c.req.param("session_id");
  const toolType = c.req.query("tool_type"); // "edit" | "agent"
  const filePath = c.req.query("file_path") || "";
  const subagentType = c.req.query("subagent_type") || "";

  if (!sessionId) return c.json({ decision: "approve" });
  if (!toolType) return c.json({ decision: "approve" });

  const sql = getDb();

  // Load session skills
  const skillRows = await sql`
    SELECT skill_name FROM session_skills WHERE session_id = ${sessionId}
  `;
  const loadedSkills = new Set(skillRows.map((r: Record<string, unknown>) => r["skill_name"] as string));

  // Load workflow state + advisor (freshness check in SQL to avoid clock skew)
  const workflows = await sql`
    SELECT *,
      (advisor_updated_at IS NOT NULL AND advisor_updated_at > NOW() - INTERVAL '5 minutes') AS advisor_fresh
    FROM session_workflow_state WHERE session_id = ${sessionId}
  `;
  const workflow = workflows[0] || null;
  const reco = workflow?.["advisor_reco"] as Record<string, unknown> | null;
  const recoFresh = Boolean(workflow?.["advisor_fresh"]);

  // ---- 1. Base skill check (absolute rule) ----
  if (!loadedSkills.has("workflow-clean-code")) {
    return c.json({
      decision: "block",
      reason: "Le skill obligatoire 'workflow-clean-code' n'est pas charge. Invoque Skill('workflow-clean-code') AVANT toute action.",
      missing_skills: ["workflow-clean-code"],
    });
  }

  // ---- 2. Agent whitelist (exploration agents never blocked) ----
  if (toolType === "agent" && AGENT_WHITELIST.has(subagentType)) {
    return c.json({ decision: "approve" });
  }

  // ---- 3. Advisor-based enforcement (priority if fresh) ----
  if (reco && recoFresh) {
    const requiredSkills = (reco["required_skills"] as Array<{ skill: string; reason: string; priority: string }>) || [];
    const missingMandatory = requiredSkills
      .filter(s => s.priority === "mandatory" && !loadedSkills.has(s.skill));

    if (missingMandatory.length > 0) {
      const recommended = requiredSkills.filter(s => s.priority === "recommended");
      return c.json({
        decision: "block",
        reason: `SKILL-ADVISOR: Skills obligatoires manquants: ${missingMandatory.map(s => s.skill).join(", ")}. Charge-les via Skill() AVANT de continuer.`,
        missing_skills: missingMandatory.map(s => s.skill),
        recommended_skills: recommended.map(s => ({ skill: s.skill, reason: s.reason })),
      });
    }

    // Agent enforcement via advisor
    if (toolType === "agent" && subagentType) {
      const recommendedAgents = (reco["recommended_agents"] as Array<{ agent: string; reason: string; for_domain: string }>) || [];
      const alternativeAgents = (reco["alternative_agents"] as string[]) || [];

      if (recommendedAgents.length > 0) {
        const allAllowed = [
          ...recommendedAgents.map(a => a.agent),
          ...alternativeAgents,
        ];
        if (!allAllowed.includes(subagentType)) {
          return c.json({
            decision: "block",
            reason: `SKILL-ADVISOR: L'agent '${subagentType}' n'est PAS optimal. Agents recommandes: ${recommendedAgents.map(a => `${a.agent} (${a.reason})`).join(", ")}. Rappel: 1 agent = 1 fichier = 1 action, prompt < 200 mots.`,
            recommended_agents: recommendedAgents,
            alternative_agents: alternativeAgents,
          });
        }
      }
    }

    // Advisor says approve
    return c.json({ decision: "approve" });
  }

  // ---- 4. Fallback: dynamic resolution via skill-index.json ----
  const index = await loadSkillIndex();
  if (!index) {
    // No index available — only base skill enforced (already passed)
    return c.json({ decision: "approve" });
  }

  if (toolType === "edit") {
    const domain = detectDomainFromFile(filePath);
    if (domain && index.domains[domain]) {
      const primarySkills = index.domains[domain].primary;
      const hasAny = primarySkills.some(s => loadedSkills.has(s));
      if (!hasAny) {
        return c.json({
          decision: "block",
          reason: `Domaine '${domain}' detecte (fichier: ${filePath}). Charge au moins un skill: ${primarySkills.join(" ou ")}. Invoque Skill() AVANT de modifier ce fichier.`,
          missing_skills: primarySkills,
          domain,
        });
      }
    }
  }

  if (toolType === "agent" && subagentType) {
    const domain = findDomainForAgent(subagentType, index);
    if (domain && index.domains[domain]) {
      const primarySkills = index.domains[domain].primary;
      const hasAny = primarySkills.some(s => loadedSkills.has(s));
      if (!hasAny) {
        return c.json({
          decision: "block",
          reason: `Agent '${subagentType}' (domaine: ${domain}). Charge au moins un skill: ${primarySkills.join(" ou ")}. Invoque Skill() AVANT de deleguer.`,
          missing_skills: primarySkills,
          domain,
        });
      }
    }
  }

  return c.json({ decision: "approve" });
}
