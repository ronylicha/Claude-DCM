#!/usr/bin/env bun
/**
 * build-index.ts — Generates skill-index.json from docs
 * Run: bun scripts/skill-advisor/build-index.ts
 * Re-run whenever skills are added/removed.
 */

import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUTPUT = join(import.meta.dir, "skill-index.json");

interface SkillEntry {
	primary: string[];
	complementary: string[];
	keywords: string[];
	agents: {
		recommended: string[];
		alternatives: string[];
	};
}

interface WorkflowTemplate {
	domains: string[];
	complexity: string;
	pipeline: string;
}

// Curated domain-to-skills mapping (top skills per domain)
// Each domain includes recommended agents (BLOCK if wrong) and alternatives (allowed)
const DOMAIN_SKILLS: Record<string, SkillEntry> = {
	"backend-laravel": {
		primary: ["laravel-expert", "laravel-api"],
		complementary: [
			"api-design-principles",
			"laravel-security-audit",
			"laravel-validation",
		],
		keywords: [
			"laravel",
			"php",
			"eloquent",
			"migration",
			"artisan",
			"blade",
			"controller",
			"middleware",
			"sanctum",
			"livewire",
			"filament",
			"inertia",
		],
		agents: {
			recommended: ["backend-laravel", "laravel-api"],
			alternatives: ["fullstack-developer", "fullstack-coordinator"],
		},
	},
	"backend-node": {
		primary: ["typescript-expert", "nestjs-best-practices"],
		complementary: ["api-design-principles", "express-patterns"],
		keywords: [
			"node",
			"express",
			"nestjs",
			"fastify",
			"koa",
			"typescript backend",
		],
		agents: {
			recommended: ["backend-developer", "developer-kit-typescript:nestjs-backend-development-expert"],
			alternatives: ["fullstack-developer"],
		},
	},
	"backend-python": {
		primary: ["python-pro", "django-pro"],
		complementary: ["fastapi-pro", "api-design-principles"],
		keywords: ["python", "django", "flask", "fastapi", "celery", "gunicorn"],
		agents: {
			recommended: ["backend-developer"],
			alternatives: ["fullstack-developer"],
		},
	},
	react: {
		primary: ["react-best-practices", "react-dev"],
		complementary: [
			"react-architecture-patterns",
			"react-state-management",
			"tailwind-patterns",
		],
		keywords: [
			"react",
			"component",
			"hook",
			"useState",
			"useEffect",
			"jsx",
			"tsx",
			"vite",
			"zustand",
			"tanstack",
			"redux",
		],
		agents: {
			recommended: ["frontend-react", "expert-react-frontend-engineer"],
			alternatives: ["react-refine", "fullstack-developer", "fullstack-coordinator"],
		},
	},
	nextjs: {
		primary: ["nextjs-best-practices", "vercel-react-best-practices"],
		complementary: [
			"react-best-practices",
			"core-web-vitals",
			"seo-audit",
		],
		keywords: [
			"next.js",
			"nextjs",
			"app router",
			"server component",
			"server action",
			"middleware next",
			"vercel",
		],
		agents: {
			recommended: ["expert-nextjs-developer", "nextjs-architecture-expert"],
			alternatives: ["frontend-react", "expert-react-frontend-engineer"],
		},
	},
	"react-native": {
		primary: ["react-native-design", "mobile-developer"],
		complementary: ["react-best-practices", "accessibility"],
		keywords: [
			"react native",
			"expo",
			"ios",
			"android",
			"mobile",
			"native module",
			"navigation",
		],
		agents: {
			recommended: ["react-native-dev", "react-native-ui"],
			alternatives: ["mobile-developer", "react-native-api", "mobile-fullstack"],
		},
	},
	flutter: {
		primary: ["flutter-expert"],
		complementary: ["mobile-developer", "dart-pro"],
		keywords: [
			"flutter",
			"dart",
			"widget",
			"cupertino",
			"material design",
		],
		agents: {
			recommended: ["mobile-developer"],
			alternatives: [],
		},
	},
	database: {
		primary: ["postgresql", "sql-pro"],
		complementary: [
			"database-architect",
			"database-optimizer",
			"prisma",
		],
		keywords: [
			"migration",
			"sql",
			"table",
			"column",
			"index",
			"query",
			"postgresql",
			"mysql",
			"sqlite",
			"prisma",
			"drizzle",
			"schema",
			"seed",
		],
		agents: {
			recommended: ["database-admin", "migration-specialist"],
			alternatives: ["supabase-backend"],
		},
	},
	supabase: {
		primary: ["supabase-best-practices"],
		complementary: ["postgresql", "supabase-rls", "supabase-edge"],
		keywords: [
			"supabase",
			"rls",
			"row level security",
			"supabase auth",
			"supabase storage",
			"realtime",
			"edge function",
		],
		agents: {
			recommended: ["supabase-backend", "supabase-edge", "supabase-realtime"],
			alternatives: ["database-admin", "supabase-storage", "supabase-realtime-optimizer"],
		},
	},
	api: {
		primary: ["api-design-principles"],
		complementary: ["api-documenter", "graphql", "openapi"],
		keywords: [
			"endpoint",
			"api",
			"rest",
			"graphql",
			"route",
			"swagger",
			"openapi",
			"postman",
			"webhook",
		],
		agents: {
			recommended: ["laravel-api", "backend-architect"],
			alternatives: ["backend-laravel", "backend-developer", "integration-specialist"],
		},
	},
	testing: {
		primary: ["senior-qa", "tdd-orchestrator"],
		complementary: [
			"test-automator",
			"smart-test",
			"e2e-testing-patterns",
			"playwright",
		],
		keywords: [
			"test",
			"spec",
			"jest",
			"vitest",
			"phpunit",
			"playwright",
			"cypress",
			"e2e",
			"tdd",
			"coverage",
			"mock",
		],
		agents: {
			recommended: ["qa-testing", "test-engineer", "test-runner"],
			alternatives: ["test-generator"],
		},
	},
	security: {
		primary: ["security-auditor", "vulnerability-scanner"],
		complementary: [
			"security-compliance",
			"security-threat-model",
			"api-security-best-practices",
		],
		keywords: [
			"auth",
			"jwt",
			"oauth",
			"csrf",
			"xss",
			"injection",
			"permission",
			"role",
			"rbac",
			"encryption",
			"owasp",
			"pentest",
		],
		agents: {
			recommended: ["security-specialist", "security-auditor"],
			alternatives: ["gdpr-dpo", "legal-compliance"],
		},
	},
	devops: {
		primary: ["senior-devops", "docker-expert"],
		complementary: [
			"kubernetes-architect",
			"terraform-pro",
			"ci-cd-pipeline",
		],
		keywords: [
			"deploy",
			"docker",
			"ci/cd",
			"pipeline",
			"kubernetes",
			"terraform",
			"github action",
			"nginx",
			"caddy",
			"ssl",
		],
		agents: {
			recommended: ["devops-infra", "deployment-engineer"],
			alternatives: ["devops-troubleshooter", "cloud-architect", "kubernetes-specialist"],
		},
	},
	performance: {
		primary: ["core-web-vitals", "performance-engineer"],
		complementary: [
			"web-performance-optimization",
			"react-performance",
			"caching-patterns",
		],
		keywords: [
			"performance",
			"optimize",
			"cache",
			"lazy",
			"bundle",
			"lighthouse",
			"lcp",
			"cls",
			"ttfb",
			"profiling",
		],
		agents: {
			recommended: ["performance-engineer", "react-performance-optimizer"],
			alternatives: [],
		},
	},
	"ui-ux": {
		primary: ["ui-ux-pro-max", "web-design-reviewer"],
		complementary: ["accessibility", "design-system", "tailwind-patterns"],
		keywords: [
			"design",
			"ui",
			"ux",
			"wireframe",
			"mockup",
			"figma",
			"prototype",
			"user experience",
			"responsive",
		],
		agents: {
			recommended: ["designer-ui-ux", "ux-researcher"],
			alternatives: ["accessibility-specialist", "cli-ui-designer"],
		},
	},
	seo: {
		primary: ["seo-audit", "programmatic-seo"],
		complementary: [
			"seo-content-planner",
			"core-web-vitals",
			"schema-markup",
		],
		keywords: [
			"seo",
			"meta",
			"sitemap",
			"schema",
			"crawl",
			"ranking",
			"backlink",
			"keyword",
			"search engine",
		],
		agents: {
			recommended: ["seo-specialist"],
			alternatives: ["content-marketer"],
		},
	},
	documentation: {
		primary: ["api-documenter", "readme"],
		complementary: [
			"writing-clearly-and-concisely",
			"humanizer",
			"mermaid-diagrams",
		],
		keywords: [
			"documentation",
			"docs",
			"readme",
			"jsdoc",
			"phpdoc",
			"swagger",
			"guide",
			"tutorial",
		],
		agents: {
			recommended: ["technical-writer"],
			alternatives: ["fix-grammar"],
		},
	},
	"ai-ml": {
		primary: ["ai-engineer", "rag-engineer"],
		complementary: [
			"langchain",
			"llamaindex",
			"agent-development",
			"ml-engineer",
		],
		keywords: [
			"llm",
			"ai",
			"ml",
			"rag",
			"embedding",
			"vector",
			"langchain",
			"agent",
			"fine-tuning",
			"prompt",
			"openai",
			"anthropic",
		],
		agents: {
			recommended: ["backend-developer", "integration-specialist"],
			alternatives: ["fullstack-developer"],
		},
	},
	architecture: {
		primary: ["senior-architect", "design-patterns-expert"],
		complementary: [
			"software-architecture",
			"microservices",
			"event-sourcing-architect",
			"ddd",
		],
		keywords: [
			"architecture",
			"pattern",
			"solid",
			"ddd",
			"clean architecture",
			"microservice",
			"monolith",
			"refactor",
			"modular",
		],
		agents: {
			recommended: ["systems-architect", "code-architect", "microservices-architect"],
			alternatives: ["tech-lead"],
		},
	},
	i18n: {
		primary: ["i18n", "localization"],
		complementary: ["i18next", "react-intl"],
		keywords: [
			"i18n",
			"translation",
			"locale",
			"rtl",
			"pluralization",
			"internationalization",
			"localization",
		],
		agents: {
			recommended: ["i18n-specialist"],
			alternatives: ["frontend-react"],
		},
	},
	workflow: {
		primary: ["workflow-clean-code", "workflow-review-code"],
		complementary: ["orchestrate", "tdd-orchestrator", "default-workflow"],
		keywords: [
			"workflow",
			"orchestrate",
			"pipeline",
			"automation",
			"ci",
			"quality",
		],
		agents: {
			recommended: ["step-orchestrator", "project-supervisor"],
			alternatives: ["tech-lead"],
		},
	},
};

const WORKFLOW_TEMPLATES: Record<string, WorkflowTemplate> = {
	"feature-dev": {
		domains: ["backend", "frontend", "testing"],
		complexity: "medium",
		pipeline:
			"business-analyst → tech-lead → backend → frontend → qa",
	},
	"api-contract": {
		domains: ["backend", "api", "frontend"],
		complexity: "medium",
		pipeline: "tech-lead → backend → validator → frontend → qa",
	},
	"frontend-spa": {
		domains: ["ui-ux", "react", "performance", "testing"],
		complexity: "medium",
		pipeline: "designer → frontend → accessibility → performance → qa",
	},
	"frontend-ssr": {
		domains: ["ui-ux", "nextjs", "seo", "performance"],
		complexity: "medium",
		pipeline: "designer → frontend → seo → performance → qa",
	},
	"mobile-app": {
		domains: ["ui-ux", "react-native", "testing"],
		complexity: "medium",
		pipeline: "product → designer → react-native → qa",
	},
	"db-postgresql": {
		domains: ["database", "devops", "security"],
		complexity: "medium",
		pipeline: "tech-lead → database → migration → devops → security",
	},
	"security-audit": {
		domains: ["security"],
		complexity: "medium",
		pipeline: "security → reviewer → qa",
	},
	"performance-audit": {
		domains: ["performance", "database", "devops"],
		complexity: "medium",
		pipeline: "performance → database → devops → qa",
	},
	"seo-audit": {
		domains: ["seo", "performance"],
		complexity: "medium",
		pipeline: "seo → performance → accessibility → writer",
	},
	"seo-content": {
		domains: ["seo", "documentation"],
		complexity: "simple",
		pipeline: "market → product → seo → writer",
	},
	"landing-page": {
		domains: ["ui-ux", "react", "seo"],
		complexity: "medium",
		pipeline: "market → product → designer → frontend → seo",
	},
	"ai-feature": {
		domains: ["ai-ml", "backend", "testing", "security"],
		complexity: "large",
		pipeline: "business-analyst → tech-lead → backend → integration → qa → security",
	},
	"rag-pipeline": {
		domains: ["ai-ml", "database", "backend"],
		complexity: "large",
		pipeline: "tech-lead → database → backend → integration → qa",
	},
	"contract-validation": {
		domains: ["backend", "react", "testing"],
		complexity: "medium",
		pipeline: "tech-lead → backend → validator → frontend → qa",
	},
	"deploy-staging": {
		domains: ["devops", "testing", "security"],
		complexity: "medium",
		pipeline: "devops → qa → security",
	},
	"deploy-production": {
		domains: ["devops", "security"],
		complexity: "large",
		pipeline: "devops → security",
	},
	"n8n-automation": {
		domains: ["ai-ml", "devops"],
		complexity: "medium",
		pipeline: "tech-lead → n8n → integration → qa",
	},
};

// Complexity detection heuristics for the AI prompt
const COMPLEXITY_HINTS = {
	trivial: "typo, rename, 1 line fix, comment change",
	simple: "1-3 files, single domain, clear logic, no API/DB changes",
	medium:
		"4-10 files, 1-2 domains, API or DB changes, feature addition",
	large:
		"10+ files, 3+ domains, architectural change, multi-layer, new system",
};

const index = {
	version: "1.0.0",
	generated: new Date().toISOString(),
	domains: DOMAIN_SKILLS,
	workflow_templates: WORKFLOW_TEMPLATES,
	complexity_hints: COMPLEXITY_HINTS,
	orchestrate_rules: {
		force_orchestrate_when: [
			"3+ domains detected",
			"complexity is large",
			"task mentions 'refactor', 'migrate', 'rewrite' across multiple layers",
			"task requires both frontend and backend changes with DB migration",
		],
		orchestrate_tiers: {
			TIER_0: "Simple/atomic task, direct execution",
			TIER_1: "Template-based, use existing workflow template",
			TIER_2: "Plan-based, generate Master Plan first",
			TIER_3: "Custom workflow, requires human validation",
		},
	},
};

await writeFile(OUTPUT, JSON.stringify(index, null, 2));
const stats = JSON.stringify(index).length;
console.log(
	`Generated skill-index.json (${(stats / 1024).toFixed(1)}KB, ${Object.keys(DOMAIN_SKILLS).length} domains, ${Object.keys(WORKFLOW_TEMPLATES).length} templates)`,
);
