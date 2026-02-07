/**
 * Tools Summary API - Count skills, commands, workflows, plugins
 * @module api/tools-summary
 */

import type { Context } from "hono";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

// ============================================
// Types
// ============================================

interface ToolsSummaryResponse {
  skills: number;
  commands: number;
  workflows: number;
  plugins: number;
  cached_at: string;
}

interface CacheEntry {
  data: ToolsSummaryResponse;
  expires_at: number;
}

// ============================================
// Cache Configuration
// ============================================

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cache: CacheEntry | null = null;

// ============================================
// Helper Functions
// ============================================

const CLAUDE_DIR = join(process.env.HOME || "", ".claude");

/**
 * Count skills by finding directories with SKILL.md
 */
async function countSkills(): Promise<number> {
  const skillsDir = join(CLAUDE_DIR, "skills");

  try {
    const entries = await readdir(skillsDir, { withFileTypes: true });
    let count = 0;

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillFile = Bun.file(join(skillsDir, entry.name, "SKILL.md"));
        if (await skillFile.exists()) {
          count++;
        }
      }
    }

    return count;
  } catch (error) {
    console.warn("[tools-summary] Failed to count skills:", error);
    return 0;
  }
}

/**
 * Count commands by finding .md files in commands/ recursively
 */
async function countCommands(): Promise<number> {
  const commandsDir = join(CLAUDE_DIR, "commands");

  try {
    return await countMdFilesRecursive(commandsDir);
  } catch (error) {
    console.warn("[tools-summary] Failed to count commands:", error);
    return 0;
  }
}

/**
 * Recursively count .md files in a directory
 */
async function countMdFilesRecursive(dir: string): Promise<number> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    let count = 0;

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        count += await countMdFilesRecursive(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        count++;
      }
    }

    return count;
  } catch {
    return 0;
  }
}

/**
 * Count workflow templates (.yaml files)
 */
async function countWorkflows(): Promise<number> {
  const templatesDir = join(CLAUDE_DIR, "skills", "workflow", "templates");

  try {
    const entries = await readdir(templatesDir, { withFileTypes: true });
    return entries.filter(e => e.isFile() && e.name.endsWith(".yaml")).length;
  } catch (error) {
    console.warn("[tools-summary] Failed to count workflows:", error);
    return 0;
  }
}

/**
 * Count plugins from installed_plugins.json
 * Format: { version: 2, plugins: { "name@marketplace": [...] } }
 */
async function countPlugins(): Promise<number> {
  const pluginsFile = Bun.file(join(CLAUDE_DIR, "plugins", "installed_plugins.json"));

  try {
    if (!(await pluginsFile.exists())) {
      return 0;
    }

    const content = await pluginsFile.json();

    // Handle v2 format with { version, plugins: {...} }
    if (content && typeof content === "object" && "plugins" in content) {
      const plugins = content.plugins;
      if (typeof plugins === "object" && plugins !== null) {
        return Object.keys(plugins).length;
      }
    }

    // Handle array format (legacy)
    if (Array.isArray(content)) {
      return content.length;
    }

    // Handle simple object format (keys are plugin names)
    if (typeof content === "object" && content !== null) {
      return Object.keys(content).length;
    }

    return 0;
  } catch (error) {
    console.warn("[tools-summary] Failed to count plugins:", error);
    return 0;
  }
}

/**
 * Fetch all counts and build the summary
 */
async function fetchToolsSummary(): Promise<ToolsSummaryResponse> {
  const [skills, commands, workflows, plugins] = await Promise.all([
    countSkills(),
    countCommands(),
    countWorkflows(),
    countPlugins(),
  ]);

  return {
    skills,
    commands,
    workflows,
    plugins,
    cached_at: new Date().toISOString(),
  };
}

// ============================================
// API Handler
// ============================================

/**
 * GET /stats/tools-summary - Get tools summary with caching
 */
export async function getToolsSummary(c: Context) {
  try {
    const now = Date.now();

    // Check cache
    if (cache && cache.expires_at > now) {
      return c.json({
        ...cache.data,
        from_cache: true,
      });
    }

    // Fetch fresh data
    const data = await fetchToolsSummary();

    // Update cache
    cache = {
      data,
      expires_at: now + CACHE_TTL_MS,
    };

    return c.json({
      ...data,
      from_cache: false,
    });
  } catch (error) {
    console.error("[API] GET /stats/tools-summary error:", error);
    return c.json(
      {
        error: "Failed to fetch tools summary",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * Clear the cache (useful for testing or manual refresh)
 */
export function clearToolsSummaryCache(): void {
  cache = null;
}
