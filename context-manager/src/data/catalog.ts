/**
 * Dynamic catalog scanner — discovers agents, skills, and commands
 * from the user's ~/.claude/ directory at runtime.
 *
 * Replaces the old 1787-line static catalog with a filesystem scan.
 * Results are cached for 60s to avoid excessive I/O.
 * @module data/catalog
 */

import { readdir, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { createLogger } from "../lib/logger";

const log = createLogger("Catalog");

const HOME = process.env.HOME || "/home/" + (process.env.USER || "user");
const CLAUDE_DIR = join(HOME, ".claude");
const SKILLS_DIR = join(CLAUDE_DIR, "skills");
const PLUGINS_CACHE_DIR = join(CLAUDE_DIR, "plugins", "cache");
const COMMANDS_DIR = join(CLAUDE_DIR, "commands");
const AGENTS_DIR = join(CLAUDE_DIR, "agents");

// ============================================
// Types
// ============================================

export interface CatalogItem {
  id: string;
  name: string;
  description: string;
  category: string;
  source: "user" | "plugin";
  plugin?: string;
}

export type CatalogAgent = CatalogItem & { tools: string[] };
export type CatalogSkill = CatalogItem;
export type CatalogCommand = CatalogItem;

// ============================================
// Cache
// ============================================

let cachedSkills: CatalogSkill[] = [];
let cachedAgents: CatalogAgent[] = [];
let cachedCommands: CatalogCommand[] = [];
let lastScanAt = 0;
const CACHE_TTL_MS = 60_000;

// ============================================
// Parsing helpers
// ============================================

function parseYamlFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Handle multi-line description with >
    if (value === ">" || value === "|") value = "";
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
      value = value.slice(1, -1);
    if (key && value) result[key] = value;
  }
  return result;
}

function extractDescriptionFromMd(content: string): string {
  // Try frontmatter first
  const fm = parseYamlFrontmatter(content);
  if (fm.description) return fm.description.slice(0, 200);

  // Fallback: first non-heading paragraph
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("---")) continue;
    return trimmed.slice(0, 200);
  }
  return "";
}

function categorizeSkill(id: string, desc: string): string {
  const text = `${id} ${desc}`.toLowerCase();
  if (/laravel|php|wordpress/.test(text)) return "php";
  if (/react|next|vue|svelte|angular|frontend/.test(text)) return "frontend";
  if (/python|django|flask|fastapi/.test(text)) return "python";
  if (/typescript|nestjs|node|bun|express/.test(text)) return "typescript";
  if (/flutter|react.native|ios|android|mobile|expo/.test(text)) return "mobile";
  if (/docker|kubernetes|devops|ci.cd|deploy|infra/.test(text)) return "devops";
  if (/security|audit|owasp|pentest|vulnerability/.test(text)) return "security";
  if (/database|sql|postgres|mongo|redis/.test(text)) return "database";
  if (/seo|marketing|content|email|social/.test(text)) return "marketing";
  if (/ai|ml|llm|agent|rag|embedding|training/.test(text)) return "ai";
  if (/test|qa|tdd|e2e|jest|playwright/.test(text)) return "testing";
  if (/doc|readme|changelog|writing/.test(text)) return "documentation";
  if (/design|ui|ux|figma|css|tailwind/.test(text)) return "design";
  if (/git|pr|commit|review|code.review/.test(text)) return "workflow";
  if (/bio|chem|med|health|clinical|pharma/.test(text)) return "science";
  if (/automat|zapier|n8n|webhook/.test(text)) return "automation";
  return "general";
}

// ============================================
// Directory scanning
// ============================================

async function safeLs(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function safeReadFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

async function scanUserSkills(): Promise<CatalogSkill[]> {
  const entries = await safeLs(SKILLS_DIR);
  const results: CatalogSkill[] = [];

  for (const entry of entries) {
    const skillDir = join(SKILLS_DIR, entry);
    const skillFile = join(skillDir, "SKILL.md");
    const content = await safeReadFile(skillFile);

    const fm = parseYamlFrontmatter(content);
    const name = fm.name || entry;
    const description = fm.description || extractDescriptionFromMd(content) || entry;

    results.push({
      id: entry,
      name,
      description: description.slice(0, 200),
      category: categorizeSkill(entry, description),
      source: "user",
    });
  }

  return results;
}

async function scanPluginSkills(): Promise<CatalogSkill[]> {
  const results: CatalogSkill[] = [];
  const publishers = await safeLs(PLUGINS_CACHE_DIR);

  for (const publisher of publishers) {
    const publisherDir = join(PLUGINS_CACHE_DIR, publisher);
    const plugins = await safeLs(publisherDir);

    for (const plugin of plugins) {
      const pluginDir = join(publisherDir, plugin);
      const versions = await safeLs(pluginDir);

      for (const version of versions) {
        const skillsDir = join(pluginDir, version, "skills");
        const skillEntries = await safeLs(skillsDir);

        for (const skillEntry of skillEntries) {
          const skillFile = join(skillsDir, skillEntry, "SKILL.md");
          const content = await safeReadFile(skillFile);
          if (!content) continue;

          const fm = parseYamlFrontmatter(content);
          const name = fm.name || skillEntry;
          const description = fm.description || extractDescriptionFromMd(content) || skillEntry;
          const qualifiedId = `${plugin}:${skillEntry}`;

          // Avoid duplicates (multiple versions)
          if (!results.some(r => r.id === qualifiedId)) {
            results.push({
              id: qualifiedId,
              name,
              description: description.slice(0, 200),
              category: categorizeSkill(skillEntry, description),
              source: "plugin",
              plugin: `${publisher}/${plugin}`,
            });
          }
        }
      }
    }
  }

  return results;
}

async function scanCommands(): Promise<CatalogCommand[]> {
  const results: CatalogCommand[] = [];

  async function scanDir(dir: string, prefix: string) {
    const entries = await safeLs(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      if (entry.endsWith(".md")) {
        const content = await safeReadFile(fullPath);
        const fm = parseYamlFrontmatter(content);
        const id = prefix ? `${prefix}:${entry.replace(/\.md$/, "")}` : entry.replace(/\.md$/, "");
        results.push({
          id,
          name: fm.name || id,
          description: (fm.description || extractDescriptionFromMd(content) || id).slice(0, 200),
          category: "command",
          source: "user",
        });
      } else {
        // Recurse into subdirectories
        try {
          const stat = await import("node:fs/promises").then(m => m.stat(fullPath));
          if (stat.isDirectory()) await scanDir(fullPath, prefix ? `${prefix}/${entry}` : entry);
        } catch { /* not a directory */ }
      }
    }
  }

  await scanDir(COMMANDS_DIR, "");
  return results;
}

async function scanAgents(): Promise<CatalogAgent[]> {
  const entries = await safeLs(AGENTS_DIR);
  const results: CatalogAgent[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const content = await safeReadFile(join(AGENTS_DIR, entry));
    const fm = parseYamlFrontmatter(content);
    const id = entry.replace(/\.md$/, "");

    results.push({
      id,
      name: fm.name || id,
      description: (fm.description || extractDescriptionFromMd(content) || id).slice(0, 200),
      category: categorizeSkill(id, fm.description || ""),
      source: "user",
      tools: [],
    });
  }

  return results;
}

// ============================================
// Public API
// ============================================

export async function scanCatalog(): Promise<{
  skills: CatalogSkill[];
  agents: CatalogAgent[];
  commands: CatalogCommand[];
}> {
  const now = Date.now();
  if (now - lastScanAt < CACHE_TTL_MS && cachedSkills.length > 0) {
    return { skills: cachedSkills, agents: cachedAgents, commands: cachedCommands };
  }

  log.info("Scanning skills catalog...");
  const t0 = Date.now();

  const [userSkills, pluginSkills, cmds, agts] = await Promise.all([
    scanUserSkills(),
    scanPluginSkills(),
    scanCommands(),
    scanAgents(),
  ]);

  cachedSkills = [...userSkills, ...pluginSkills];
  cachedCommands = cmds;
  cachedAgents = agts;
  lastScanAt = now;

  log.info(`Catalog scanned: ${cachedSkills.length} skills, ${cachedAgents.length} agents, ${cachedCommands.length} commands in ${Date.now() - t0}ms`);

  return { skills: cachedSkills, agents: cachedAgents, commands: cachedCommands };
}

// Legacy exports for backward compatibility
export const agents: CatalogAgent[] = [];
export const skills: CatalogSkill[] = [];
export const commands: CatalogCommand[] = [];
