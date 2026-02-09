/**
 * Catalog API - Static registry of all known agents, skills, and commands
 * Provides searchable, filterable access to the Claude Code ecosystem catalog.
 * @module api/catalog
 */

import type { Context } from "hono";
import { agents, skills, commands } from "../data/catalog";
import { createLogger } from "../lib/logger";

const log = createLogger("API");

/**
 * GET /api/registry/catalog - Browse the full agent/skill/command catalog
 * Query params:
 *   - type: "agents" | "skills" | "commands" (omit for all)
 *   - search: free-text search across id, name, description
 *   - category: filter by category
 * @param c - Hono context
 */
export async function getCatalog(c: Context): Promise<Response> {
  try {
    const type = c.req.query("type");
    const search = c.req.query("search")?.toLowerCase();
    const category = c.req.query("category");

    let result: {
      agents?: typeof agents;
      skills?: typeof skills;
      commands?: typeof commands;
    } = {};

    if (!type || type === "agents") {
      let filtered = agents;
      if (category) filtered = filtered.filter((a) => a.category === category);
      if (search)
        filtered = filtered.filter(
          (a) =>
            a.id.toLowerCase().includes(search) ||
            a.name.toLowerCase().includes(search) ||
            a.description.toLowerCase().includes(search)
        );
      result.agents = filtered;
    }

    if (!type || type === "skills") {
      let filtered = skills;
      if (category) filtered = filtered.filter((s) => s.category === category);
      if (search)
        filtered = filtered.filter(
          (s) =>
            s.id.toLowerCase().includes(search) ||
            s.name.toLowerCase().includes(search) ||
            s.description.toLowerCase().includes(search)
        );
      result.skills = filtered;
    }

    if (!type || type === "commands") {
      let filtered = commands;
      if (category) filtered = filtered.filter((cmd) => cmd.category === category);
      if (search)
        filtered = filtered.filter(
          (cmd) =>
            cmd.id.toLowerCase().includes(search) ||
            cmd.name.toLowerCase().includes(search) ||
            cmd.description.toLowerCase().includes(search)
        );
      result.commands = filtered;
    }

    return c.json({
      ...result,
      counts: {
        agents: result.agents?.length ?? 0,
        skills: result.skills?.length ?? 0,
        commands: result.commands?.length ?? 0,
      },
    });
  } catch (error) {
    log.error("GET /api/registry/catalog error:", error);
    return c.json({ error: "Failed to fetch catalog" }, 500);
  }
}
