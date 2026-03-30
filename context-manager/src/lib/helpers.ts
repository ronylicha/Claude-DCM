/**
 * Shared Helpers — DRY utilities used across DCM modules
 * Single source of truth for common operations
 * @module lib/helpers
 */

// ============================================
// ID Generation
// ============================================

/** Generate a unique plan/pipeline ID */
export function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// ============================================
// Duration & Time
// ============================================

/** Calculate duration in ms between two ISO timestamps */
export function calcDurationMs(
  startedAt: string | null | undefined,
  completedAt: string | null | undefined,
): number {
  if (!startedAt || !completedAt) return 0;
  return Math.round(new Date(completedAt).getTime() - new Date(startedAt).getTime());
}

/** Format duration in ms to human-readable string */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${seconds}s`;
}

/** Get ISO timestamp for now */
export function nowISO(): string {
  return new Date().toISOString();
}

// ============================================
// Agent Detection & Classification
// ============================================

/** Complexity tier with model and turn budget */
export interface ComplexityTier {
  name: string;
  max_turns: number;
  model: string;
}

/** Canonical complexity tiers — single source of truth */
export const COMPLEXITY_TIERS: Record<string, ComplexityTier> = {
  trivial:  { name: "trivial",  max_turns: 3,  model: "haiku" },
  simple:   { name: "simple",   max_turns: 5,  model: "haiku" },
  moderate: { name: "moderate", max_turns: 10, model: "sonnet" },
  complex:  { name: "complex",  max_turns: 20, model: "sonnet" },
  expert:   { name: "expert",   max_turns: 30, model: "opus" },
};

/** Agent categories for routing */
export const AGENT_CATEGORIES = {
  orchestrator: ["project-supervisor", "tech-lead", "Plan"],
  researcher:   ["Explore", "websearch", "explore-codebase", "explore-docs"],
  developer:    ["Snipper", "frontend-react", "backend-laravel", "react-refine", "react-native-dev"],
  validator:    ["code-reviewer", "regression-guard", "qa-testing", "test-engineer", "test-runner"],
  specialist:   ["security-specialist", "performance-engineer", "database-admin", "designer-ui-ux"],
  writer:       ["technical-writer", "i18n-specialist"],
} as const;

/** Get category for an agent type */
export function getAgentCategory(agentType: string): string {
  for (const [category, agents] of Object.entries(AGENT_CATEGORIES)) {
    if ((agents as readonly string[]).includes(agentType)) return category;
  }
  return "developer";
}

/** Agents that are whitelisted (never blocked by skill gate) */
export const WHITELISTED_AGENTS = new Set([
  "Explore", "Plan", "impact-analyzer", "regression-guard", "code-reviewer",
]);

/** Keywords to agent type mapping for auto-detection */
export const AGENT_KEYWORDS: Record<string, string[]> = {
  "Explore":              ["explore", "find", "search", "scan", "investigate", "understand", "codebase"],
  "Snipper":              ["edit", "modify", "change", "update", "fix", "create file", "write code"],
  "frontend-react":       ["react", "component", "ui", "frontend", "tsx", "jsx", "css", "style", "dashboard"],
  "backend-laravel":      ["laravel", "php", "controller", "migration", "model", "artisan"],
  "supabase-backend":     ["supabase", "rls", "policy", "database", "schema", "sql"],
  "test-engineer":        ["test", "testing", "spec", "coverage", "assert", "expect", "jest", "vitest"],
  "security-specialist":  ["security", "vulnerability", "auth", "permission", "owasp"],
  "technical-writer":     ["document", "readme", "docs", "api doc", "changelog"],
  "code-reviewer":        ["review", "audit", "quality", "lint", "clean"],
  "performance-engineer": ["performance", "optimize", "cache", "latency", "profil"],
  "database-admin":       ["database", "postgres", "index", "query", "table"],
  "designer-ui-ux":       ["design", "ux", "wireframe", "mockup", "layout"],
  "devops-infra":         ["deploy", "docker", "ci", "cd", "pipeline", "infra"],
};

/** Match a description to the best agent types */
export function matchAgentTypes(description: string): string[] {
  const lower = description.toLowerCase();
  const matches: Array<{ agent: string; score: number }> = [];

  for (const [agent, keywords] of Object.entries(AGENT_KEYWORDS)) {
    const score = keywords.filter((kw) => lower.includes(kw)).length;
    if (score > 0) matches.push({ agent, score });
  }

  matches.sort((a, b) => b.score - a.score);
  return matches.map((m) => m.agent);
}

/** Keywords that indicate complexity levels */
const COMPLEXITY_KEYWORDS: Record<string, string[]> = {
  trivial:  ["fix typo", "rename", "update comment", "single line", "simple fix"],
  simple:   ["add field", "update config", "small change", "minor fix", "one file"],
  moderate: ["refactor", "implement", "create component", "add endpoint", "multi-file"],
  complex:  ["explore", "audit", "scan", "analyze", "investigate", "research", "debug"],
  expert:   ["architecture", "redesign", "migration", "security audit", "performance"],
};

/** Estimate task complexity from description and file count */
export function estimateComplexity(description: string, fileCount: number): ComplexityTier {
  const lower = description.toLowerCase();

  for (const tier of ["expert", "complex", "moderate", "simple", "trivial"] as const) {
    const keywords = COMPLEXITY_KEYWORDS[tier];
    const tierDef = COMPLEXITY_TIERS[tier];
    if (keywords && tierDef && keywords.some((kw) => lower.includes(kw))) {
      return tierDef;
    }
  }

  if (fileCount <= 1) return COMPLEXITY_TIERS["trivial"] ?? COMPLEXITY_TIERS["simple"]!;
  if (fileCount <= 3) return COMPLEXITY_TIERS["simple"] ?? COMPLEXITY_TIERS["moderate"]!;
  if (fileCount <= 8) return COMPLEXITY_TIERS["moderate"] ?? COMPLEXITY_TIERS["complex"]!;
  if (fileCount <= 15) return COMPLEXITY_TIERS["complex"] ?? COMPLEXITY_TIERS["expert"]!;
  return COMPLEXITY_TIERS["expert"]!;
}

// ============================================
// Domain to Skills Mapping
// ============================================

/** Domain keywords to required skills */
export const DOMAIN_SKILLS: Record<string, string[]> = {
  react:    ["react-best-practices", "vercel-react-best-practices"],
  nextjs:   ["nextjs-best-practices", "react-best-practices"],
  laravel:  ["laravel-expert", "api-design-principles"],
  database: ["postgresql", "sql-pro"],
  testing:  ["senior-qa", "tdd-orchestrator"],
  security: ["security-auditor", "vulnerability-scanner"],
  devops:   ["senior-devops", "docker-expert"],
  ui:       ["ui-ux-pro-max", "web-design-reviewer"],
  mobile:   ["react-native-design", "mobile-developer"],
};

/** Detect domains from a description */
export function detectDomains(description: string): string[] {
  const lower = description.toLowerCase();
  const domains: string[] = [];

  const domainKeywords: Record<string, string[]> = {
    react:    ["react", "component", "tsx", "jsx", "hook", "zustand", "tanstack"],
    nextjs:   ["next.js", "nextjs", "app router", "server component"],
    laravel:  ["laravel", "php", "eloquent", "artisan", "blade"],
    database: ["database", "postgres", "sql", "migration", "schema", "index"],
    testing:  ["test", "coverage", "spec", "jest", "vitest", "cypress"],
    security: ["security", "auth", "owasp", "vulnerability", "xss", "csrf"],
    devops:   ["deploy", "docker", "ci/cd", "pipeline", "kubernetes"],
    ui:       ["design", "ui", "ux", "styling", "tailwind", "css"],
    mobile:   ["react native", "expo", "mobile", "ios", "android"],
  };

  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      domains.push(domain);
    }
  }

  return domains;
}

/** Get skills for detected domains */
export function getSkillsForDomains(domains: string[]): string[] {
  const skills = new Set<string>(["workflow-clean-code"]);
  for (const domain of domains) {
    const domainSkills = DOMAIN_SKILLS[domain];
    if (domainSkills) {
      for (const skill of domainSkills) skills.add(skill);
    }
  }
  return Array.from(skills);
}

// ============================================
// Status Helpers
// ============================================

/** Check if a status represents a terminal state */
export function isTerminal(status: string): boolean {
  return ["completed", "failed", "cancelled", "skipped"].includes(status);
}

/** Check if a status represents an active state */
export function isActive(status: string): boolean {
  return ["running", "retrying", "queued"].includes(status);
}

// ============================================
// String Helpers
// ============================================

/** Truncate text to max chars with ellipsis */
export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.substring(0, maxChars - 3) + "...";
}

/** Convert a string to a URL-safe slug */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 64);
}
