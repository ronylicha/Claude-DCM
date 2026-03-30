#!/usr/bin/env bun
/**
 * engine.ts — AI Skill Advisor Engine
 *
 * Called in background by analyze.sh. Reads the user prompt,
 * calls Haiku to determine optimal skills, writes advisor-reco.json.
 *
 * Usage: bun engine.ts <input-file-path>
 * The input file contains the raw JSON from the UserPromptSubmit hook.
 */

import { readFile, writeFile, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
// @ts-expect-error — module exists at runtime but has no type declarations
import { generateTextCC } from "../claude-code-ai/claude";

const SKILL_INDEX_PATH = join(import.meta.dir, "skill-index.json");
const SKILL_GATE_ROOT = "/tmp/claude-skill-gate";
const DCM_API_URL = process.env["CONTEXT_MANAGER_URL"] || "http://127.0.0.1:3847";
const DCM_TIMEOUT_MS = 1500;

// Rate limit: skip if last analysis was < 8 seconds ago
const MIN_INTERVAL_MS = 8_000;

interface DcmSuggestion {
	tool_name: string;
	tool_type: string;
	score: number;
	usage_count: number;
	success_rate: number;
	keyword_matches: string[];
}

interface DcmRoutingResponse {
	keywords: string[];
	suggestions: DcmSuggestion[];
	count: number;
}

async function queryDcmRouting(
	keywords: string[],
	toolType?: string,
): Promise<DcmSuggestion[]> {
	if (keywords.length === 0) return [];
	const params = new URLSearchParams({
		keywords: keywords.join(","),
		limit: "10",
		min_score: "0.3",
	});
	if (toolType) params.set("tool_type", toolType);

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), DCM_TIMEOUT_MS);
		const res = await fetch(`${DCM_API_URL}/api/routing/suggest?${params}`, {
			signal: controller.signal,
		});
		clearTimeout(timeout);
		if (!res.ok) return [];
		const data = (await res.json()) as DcmRoutingResponse;
		return data.suggestions || [];
	} catch {
		return [];
	}
}

async function sendDcmFeedback(
	toolName: string,
	keywords: string[],
	chosen: boolean,
): Promise<void> {
	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 500);
		await fetch(`${DCM_API_URL}/api/routing/feedback`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ tool_name: toolName, keywords, chosen }),
			signal: controller.signal,
		});
		clearTimeout(timeout);
	} catch {
		// fire-and-forget
	}
}

function extractKeywords(prompt: string): string[] {
	const stopWords = new Set([
		"le", "la", "les", "un", "une", "des", "du", "de", "dans", "pour",
		"avec", "par", "sur", "qui", "que", "est", "sont", "fait", "faire",
		"the", "and", "for", "are", "but", "not", "you", "all", "any", "can",
		"this", "that", "from", "have", "been", "will", "just", "also", "moi",
		"nous", "vous", "etre", "donc", "tout", "tres", "bien", "aussi",
	]);
	return prompt
		.toLowerCase()
		.replace(/[^a-zA-Z0-9àâäéèêëïîôùûüç\s-]/g, " ")
		.split(/\s+/)
		.filter((w) => w.length >= 4 && !stopWords.has(w))
		.slice(0, 15);
}

interface AdvisorReco {
	timestamp: string;
	prompt_hash: string;
	complexity: "trivial" | "simple" | "medium" | "large";
	needs_orchestrate: boolean;
	orchestrate_tier: string | null;
	orchestrate_template: string | null;
	required_skills: Array<{
		skill: string;
		reason: string;
		priority: "mandatory" | "recommended";
	}>;
	recommended_agents: Array<{
		agent: string;
		reason: string;
		for_domain: string;
	}>;
	alternative_agents: string[];
	domains_detected: string[];
	summary: string;
}

function hashPrompt(prompt: string): string {
	return createHash("sha256").update(prompt).digest("hex").slice(0, 8);
}

async function getLoadedSkills(sessionId: string): Promise<string[]> {
	const skillsFile = join(SKILL_GATE_ROOT, sessionId, "skills.log");
	try {
		const content = await readFile(skillsFile, "utf-8");
		return content
			.split("\n")
			.filter((l) => l.trim() && !l.startsWith("#"))
			.map((l) => l.trim());
	} catch {
		return [];
	}
}

async function shouldSkipRateLimit(sessionDir: string): Promise<boolean> {
	const recoFile = join(sessionDir, "advisor-reco.json");
	try {
		const s = await stat(recoFile);
		return Date.now() - s.mtimeMs < MIN_INTERVAL_MS;
	} catch {
		return false;
	}
}

function buildSystemPrompt(
	skillIndex: string,
	loadedSkills: string[],
	dcmSkills: DcmSuggestion[],
	dcmAgents: DcmSuggestion[],
): string {
	const dcmSection =
		dcmSkills.length > 0 || dcmAgents.length > 0
			? `\n\nDCM ROUTING (learned from real usage — PRIORITIZE these):\nSkills from DCM: ${dcmSkills.map((s) => `${s.tool_name} (score:${s.score}, usage:${s.usage_count}, success:${s.success_rate}%)`).join(", ") || "none"}\nAgents from DCM: ${dcmAgents.map((a) => `${a.tool_name} (score:${a.score}, usage:${a.usage_count}, success:${a.success_rate}%)`).join(", ") || "none"}\nWhen DCM suggests a tool with score >= 0.8, make it "mandatory". DCM scores come from REAL usage data.`
			: "";

	return `You are a Skill & Agent Advisor for Claude Code. Analyze the user's request and determine:
1. The optimal skills to load
2. The BEST specialized agents (subagent_type) for each sub-task

SKILL RULES:
- "workflow-clean-code" is ALWAYS mandatory for any code modification task
- For each detected domain, recommend the primary skill as "mandatory" + 1-2 complementary as "recommended"
- If 3+ domains are involved OR complexity is "large", set needs_orchestrate=true
- If a matching workflow template exists for the detected domains, recommend it
- For trivial tasks (typo, rename, single line), return complexity="trivial" with minimal skills and agents
- For simple questions/research with no code changes, return complexity="trivial" with empty arrays
- Validate ALL names against the provided index ONLY — do NOT invent names

AGENT RULES (CRITICAL):
- Each domain in the index has "agents.recommended" and "agents.alternatives"
- For each detected domain, pick the BEST agent from "agents.recommended" — put it in recommended_agents
- Gather ALL agents from "agents.alternatives" across detected domains into alternative_agents
- recommended_agents = the IDEAL agents to use (will be ENFORCED — wrong agent = BLOCKED)
- alternative_agents = acceptable fallbacks (will be ALLOWED without warning)
- Any agent NOT in either list for the detected domains will be BLOCKED
- When multiple domains overlap, include agents from all relevant domains

DELEGATION SCOPING RULES (include in summary when complexity >= medium):
- Each subagent must receive: 1 file, 1 action, minimal context
- Prompts to subagents must be < 200 words, focused, with explicit deliverable
- Never ask a subagent to "explore and implement" — split into separate agents

Return ONLY valid JSON, no markdown, no explanation, no code fences.

LOADED SKILLS (already active, do NOT recommend again):
${loadedSkills.length > 0 ? loadedSkills.join(", ") : "(none)"}
${dcmSection}

SKILL & AGENT INDEX:
${skillIndex}`;
}

function buildUserPrompt(prompt: string, cwd: string): string {
	return `Analyze this user request and return skill + agent recommendations as JSON.

USER REQUEST: "${prompt.slice(0, 2000)}"
WORKING DIRECTORY: "${cwd}"

Return JSON with this EXACT schema (no extra fields):
{
  "complexity": "trivial" | "simple" | "medium" | "large",
  "needs_orchestrate": boolean,
  "orchestrate_tier": null | "TIER_0" | "TIER_1" | "TIER_2" | "TIER_3",
  "orchestrate_template": null | "template-name-from-index",
  "required_skills": [{"skill": "exact-name-from-index", "reason": "brief reason", "priority": "mandatory" | "recommended"}],
  "recommended_agents": [{"agent": "exact-subagent_type-from-index", "reason": "why this agent", "for_domain": "domain-name"}],
  "alternative_agents": ["other-acceptable-agent-names"],
  "domains_detected": ["domain-name-from-index"],
  "summary": "one-line summary in French"
}`;
}

function validateSkillNames(
	reco: AdvisorReco,
	validSkills: Set<string>,
): AdvisorReco {
	reco.required_skills = reco.required_skills.filter((s) =>
		validSkills.has(s.skill),
	);
	return reco;
}

interface DomainEntry {
	primary: string[];
	complementary: string[];
	agents: { recommended: string[]; alternatives: string[] };
}

function extractValidSkills(skillIndex: Record<string, unknown>): Set<string> {
	const skills = new Set<string>();
	const domains = (skillIndex as { domains: Record<string, DomainEntry> }).domains;
	for (const domain of Object.values(domains)) {
		for (const s of domain.primary) skills.add(s);
		for (const s of domain.complementary) skills.add(s);
	}
	skills.add("workflow-clean-code");
	skills.add("workflow-review-code");
	skills.add("orchestrate");
	return skills;
}

function extractValidAgents(skillIndex: Record<string, unknown>): Set<string> {
	const agents = new Set<string>();
	const domains = (skillIndex as { domains: Record<string, DomainEntry> }).domains;
	for (const domain of Object.values(domains)) {
		for (const a of domain.agents.recommended) agents.add(a);
		for (const a of domain.agents.alternatives) agents.add(a);
	}
	// Always allow meta/orchestration agents
	for (const a of [
		"step-orchestrator", "project-supervisor", "tech-lead", "impact-analyzer",
		"regression-guard", "code-reviewer", "code-explorer", "Explore", "Plan",
		"Snipper", "fullstack-developer", "fullstack-coordinator",
	]) {
		agents.add(a);
	}
	return agents;
}

function validateAgentNames(reco: AdvisorReco, validAgents: Set<string>): AdvisorReco {
	reco.recommended_agents = (reco.recommended_agents || []).filter((a) =>
		validAgents.has(a.agent),
	);
	reco.alternative_agents = (reco.alternative_agents || []).filter((a) =>
		validAgents.has(a),
	);
	return reco;
}

function parseAIResponse(text: string): AdvisorReco | null {
	// Strip markdown code fences if present
	let cleaned = text.trim();
	if (cleaned.startsWith("```")) {
		cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
	}

	try {
		const parsed = JSON.parse(cleaned);

		// Validate required fields
		if (
			!parsed.complexity ||
			typeof parsed.needs_orchestrate !== "boolean" ||
			!Array.isArray(parsed.required_skills)
		) {
			return null;
		}

		return parsed as AdvisorReco;
	} catch {
		return null;
	}
}

async function main() {
	const inputFile = process.argv[2];
	if (!inputFile) {
		process.exit(1);
	}

	let rawInput: string;
	try {
		rawInput = await readFile(inputFile, "utf-8");
	} catch {
		process.exit(1);
	}

	let input: { session_id?: string; prompt?: string; cwd?: string };
	try {
		input = JSON.parse(rawInput);
	} catch {
		process.exit(1);
	}

	const sessionId = input.session_id;
	const prompt = input.prompt;
	const cwd = input.cwd || process.cwd();

	if (!sessionId || !prompt) {
		process.exit(1);
	}

	const sessionDir = join(SKILL_GATE_ROOT, sessionId);

	// Rate limit check
	if (await shouldSkipRateLimit(sessionDir)) {
		process.exit(0);
	}

	// Load skill index
	let skillIndexRaw: string;
	let skillIndex: Record<string, unknown>;
	try {
		skillIndexRaw = await readFile(SKILL_INDEX_PATH, "utf-8");
		skillIndex = JSON.parse(skillIndexRaw);
	} catch {
		// No index = can't advise, exit silently
		process.exit(0);
	}

	const loadedSkills = await getLoadedSkills(sessionId);
	const validSkills = extractValidSkills(skillIndex);
	const validAgents = extractValidAgents(skillIndex);

	// --- STEP 1: Query DCM routing API (learned scores) ---
	const keywords = extractKeywords(prompt);
	const [dcmSkills, dcmAgents] = await Promise.all([
		queryDcmRouting(keywords, "skill"),
		queryDcmRouting(keywords, "agent"),
	]);

	const systemPrompt = buildSystemPrompt(skillIndexRaw, loadedSkills, dcmSkills, dcmAgents);
	const userPrompt = buildUserPrompt(prompt, cwd);

	let aiResponse: string;
	try {
		aiResponse = await generateTextCC({
			prompt: userPrompt,
			system: systemPrompt,
			model: "haiku",
		});
	} catch {
		// API failure = exit silently, fallback to static rules
		process.exit(0);
	}

	let reco = parseAIResponse(aiResponse);
	if (!reco) {
		process.exit(0);
	}

	// Validate skill and agent names against index
	reco = validateSkillNames(reco, validSkills);
	reco = validateAgentNames(reco, validAgents);

	// Filter out already-loaded skills from recommendations
	reco.required_skills = reco.required_skills.filter(
		(s) => !loadedSkills.includes(s.skill),
	);

	// Add metadata + DCM data
	reco.timestamp = new Date().toISOString();
	reco.prompt_hash = hashPrompt(prompt);

	// Enrich with DCM routing data for transparency
	const dcmData = {
		dcm_skills: dcmSkills.map((s) => ({
			tool: s.tool_name,
			score: s.score,
			usage: s.usage_count,
			success_rate: s.success_rate,
		})),
		dcm_agents: dcmAgents.map((a) => ({
			tool: a.tool_name,
			score: a.score,
			usage: a.usage_count,
			success_rate: a.success_rate,
		})),
		dcm_keywords: keywords,
	};
	(reco as unknown as Record<string, unknown>)["dcm_routing"] = dcmData;

	// Send positive feedback to DCM for chosen skills/agents (fire-and-forget)
	const feedbackPromises: Promise<void>[] = [];
	for (const skill of reco.required_skills) {
		if (skill.priority === "mandatory") {
			feedbackPromises.push(sendDcmFeedback(skill.skill, keywords, true));
		}
	}
	for (const agent of reco.recommended_agents) {
		feedbackPromises.push(sendDcmFeedback(agent.agent, keywords, true));
	}
	Promise.allSettled(feedbackPromises); // don't await

	// Write to DCM API (primary) + local file (fallback)
	try {
		await fetch(`${DCM_API_URL}/api/skill-gate/${sessionId}/advisor`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(reco),
		});
	} catch {
		// API unavailable — fall through to local file
	}

	// Local file fallback (for environments without DCM API running)
	const recoPath = join(sessionDir, "advisor-reco.json");
	const tmpPath = `${recoPath}.tmp`;
	try {
		await writeFile(tmpPath, JSON.stringify(reco, null, 2));
		await rename(tmpPath, recoPath);
	} catch {
		// Write failure = continue silently
	}
}

main().catch(() => process.exit(0));
