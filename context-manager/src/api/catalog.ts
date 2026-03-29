/**
 * Catalog API — dynamic registry scanning ~/.claude/skills/ and plugins
 * @module api/catalog
 */

import type { Context } from "hono";
import { scanCatalog, type CatalogSkill, type CatalogAgent, type CatalogCommand } from "../data/catalog";
import { createLogger } from "../lib/logger";

const log = createLogger("API");

/**
 * GET /api/registry/catalog — browse discovered skills, agents, commands
 * Query params:
 *   - type: "skills" | "agents" | "commands" (omit for all)
 *   - search: free-text search across id, name, description
 *   - category: filter by category
 *   - source: "user" | "plugin"
 */
export async function getCatalog(c: Context): Promise<Response> {
  try {
    const type = c.req.query("type");
    const search = c.req.query("search")?.toLowerCase();
    const category = c.req.query("category");
    const source = c.req.query("source");

    const catalog = await scanCatalog();

    const filterItems = <T extends { id: string; name: string; description: string; category: string; source: string }>(
      items: T[]
    ): T[] => {
      let filtered = items;
      if (category) filtered = filtered.filter(i => i.category === category);
      if (source) filtered = filtered.filter(i => i.source === source);
      if (search) filtered = filtered.filter(i =>
        i.id.toLowerCase().includes(search) ||
        i.name.toLowerCase().includes(search) ||
        i.description.toLowerCase().includes(search)
      );
      return filtered;
    };

    const result: {
      agents?: CatalogAgent[];
      skills?: CatalogSkill[];
      commands?: CatalogCommand[];
    } = {};

    if (!type || type === "agents") result.agents = filterItems(catalog.agents);
    if (!type || type === "skills") result.skills = filterItems(catalog.skills);
    if (!type || type === "commands") result.commands = filterItems(catalog.commands);

    return c.json({
      ...result,
      counts: {
        agents: result.agents?.length ?? 0,
        skills: result.skills?.length ?? 0,
        commands: result.commands?.length ?? 0,
        total: (result.agents?.length ?? 0) + (result.skills?.length ?? 0) + (result.commands?.length ?? 0),
      },
    });
  } catch (error) {
    log.error("GET /api/registry/catalog error:", error);
    return c.json({ error: "Failed to fetch catalog" }, 500);
  }
}
