/**
 * Agent Registry API - CRUD operations for agent scopes and metadata
 * @module api/registry
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";

/** Valid agent categories */
const AGENT_CATEGORIES = ["orchestrator", "developer", "validator", "specialist", "researcher", "writer"] as const;

/** Database row for agent_registry */
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
  created_at: string;
}

/** Zod schema for agent registry input */
const AgentRegistryInputSchema = z.object({
  agent_type: z.string().min(1, "agent_type is required"),
  category: z.enum(AGENT_CATEGORIES),
  display_name: z.string().optional(),
  default_scope: z.record(z.string(), z.unknown()).optional().default({}),
  allowed_tools: z.array(z.string()).optional(),
  forbidden_actions: z.array(z.string()).optional(),
  max_files: z.number().int().min(1).optional().default(5),
  wave_assignments: z.array(z.number().int()).optional(),
  recommended_model: z.string().optional().default("sonnet"),
});

/**
 * GET /api/registry - List all agents
 * Query params:
 *   - category: filter by category
 *   - limit: max results (default: 100)
 *   - offset: pagination offset (default: 0)
 * @param c - Hono context
 */
export async function getRegistry(c: Context): Promise<Response> {
  try {
    const sql = getDb();
    const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 200);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);
    const category = c.req.query("category");

    let agents: AgentRegistryRow[];

    if (category) {
      agents = await sql<AgentRegistryRow[]>`
        SELECT
          agent_type, category, display_name, default_scope,
          allowed_tools, forbidden_actions, max_files,
          wave_assignments, recommended_model, created_at
        FROM agent_registry
        WHERE category = ${category}
        ORDER BY agent_type ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      agents = await sql<AgentRegistryRow[]>`
        SELECT
          agent_type, category, display_name, default_scope,
          allowed_tools, forbidden_actions, max_files,
          wave_assignments, recommended_model, created_at
        FROM agent_registry
        ORDER BY category ASC, agent_type ASC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    // Get total count
    const countResult = category
      ? await sql<{ count: number }[]>`SELECT COUNT(*) as count FROM agent_registry WHERE category = ${category}`
      : await sql<{ count: number }[]>`SELECT COUNT(*) as count FROM agent_registry`;

    const totalCount = Number(countResult[0]?.count ?? 0);

    return c.json({
      agents,
      count: agents.length,
      total: totalCount,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[API] GET /api/registry error:", error);
    return c.json(
      {
        error: "Failed to fetch agents",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/registry/:agent_type - Get one agent scope
 * @param c - Hono context
 */
export async function getRegistryAgent(c: Context): Promise<Response> {
  try {
    const agentType = c.req.param("agent_type");

    if (!agentType) {
      return c.json({ error: "Missing agent_type parameter" }, 400);
    }

    const sql = getDb();

    const results = await sql<AgentRegistryRow[]>`
      SELECT
        agent_type, category, display_name, default_scope,
        allowed_tools, forbidden_actions, max_files,
        wave_assignments, recommended_model, created_at
      FROM agent_registry
      WHERE agent_type = ${agentType}
    `;

    const agent = results[0];
    if (!agent) {
      return c.json({ error: "Agent not found" }, 404);
    }

    return c.json({ agent });
  } catch (error) {
    console.error("[API] GET /api/registry/:agent_type error:", error);
    return c.json(
      {
        error: "Failed to fetch agent",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * PUT /api/registry/:agent_type - Update agent scope (upsert)
 * @param c - Hono context
 */
export async function putRegistryAgent(c: Context): Promise<Response> {
  try {
    const agentType = c.req.param("agent_type");

    if (!agentType) {
      return c.json({ error: "Missing agent_type parameter" }, 400);
    }

    const raw = await c.req.json();

    // Add agent_type from URL param
    const body = { ...raw, agent_type: agentType };

    // Validate input with Zod
    const parseResult = AgentRegistryInputSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400
      );
    }

    const input = parseResult.data;
    const sql = getDb();

    // Upsert agent
    const results = await sql<AgentRegistryRow[]>`
      INSERT INTO agent_registry (
        agent_type,
        category,
        display_name,
        default_scope,
        allowed_tools,
        forbidden_actions,
        max_files,
        wave_assignments,
        recommended_model
      ) VALUES (
        ${input.agent_type},
        ${input.category},
        ${input.display_name ?? null},
        ${sql.json(input.default_scope as any)},
        ${input.allowed_tools ? sql.array(input.allowed_tools) : null},
        ${input.forbidden_actions ? sql.array(input.forbidden_actions) : null},
        ${input.max_files},
        ${input.wave_assignments ? sql.array(input.wave_assignments) : null},
        ${input.recommended_model}
      )
      ON CONFLICT (agent_type) DO UPDATE SET
        category = EXCLUDED.category,
        display_name = EXCLUDED.display_name,
        default_scope = EXCLUDED.default_scope,
        allowed_tools = EXCLUDED.allowed_tools,
        forbidden_actions = EXCLUDED.forbidden_actions,
        max_files = EXCLUDED.max_files,
        wave_assignments = EXCLUDED.wave_assignments,
        recommended_model = EXCLUDED.recommended_model
      RETURNING
        agent_type, category, display_name, default_scope,
        allowed_tools, forbidden_actions, max_files,
        wave_assignments, recommended_model, created_at
    `;

    const agent = results[0];
    if (!agent) {
      return c.json({ error: "Failed to upsert agent" }, 500);
    }

    // Publish event
    await publishEvent("global", "registry.updated", {
      agent_type: agent.agent_type,
      category: agent.category,
    });

    return c.json({
      success: true,
      agent,
    });
  } catch (error) {
    console.error("[API] PUT /api/registry/:agent_type error:", error);
    return c.json(
      {
        error: "Failed to update agent",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * POST /api/registry/import - Bulk import agents
 * Input: { agents: Array<AgentRegistryInput> }
 * @param c - Hono context
 */
export async function postRegistryImport(c: Context): Promise<Response> {
  try {
    const raw = await c.req.json();

    // Validate bulk input
    const BulkImportSchema = z.object({
      agents: z.array(AgentRegistryInputSchema).min(1, "At least one agent required"),
    });

    const parseResult = BulkImportSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400
      );
    }

    const { agents } = parseResult.data;
    const sql = getDb();

    let importedCount = 0;
    const errors: Array<{ agent_type: string; error: string }> = [];

    // Import each agent
    for (const input of agents) {
      try {
        await sql`
          INSERT INTO agent_registry (
            agent_type,
            category,
            display_name,
            default_scope,
            allowed_tools,
            forbidden_actions,
            max_files,
            wave_assignments,
            recommended_model
          ) VALUES (
            ${input.agent_type},
            ${input.category},
            ${input.display_name ?? null},
            ${sql.json(input.default_scope as any)},
            ${input.allowed_tools ? sql.array(input.allowed_tools) : null},
            ${input.forbidden_actions ? sql.array(input.forbidden_actions) : null},
            ${input.max_files},
            ${input.wave_assignments ? sql.array(input.wave_assignments) : null},
            ${input.recommended_model}
          )
          ON CONFLICT (agent_type) DO UPDATE SET
            category = EXCLUDED.category,
            display_name = EXCLUDED.display_name,
            default_scope = EXCLUDED.default_scope,
            allowed_tools = EXCLUDED.allowed_tools,
            forbidden_actions = EXCLUDED.forbidden_actions,
            max_files = EXCLUDED.max_files,
            wave_assignments = EXCLUDED.wave_assignments,
            recommended_model = EXCLUDED.recommended_model
        `;
        importedCount++;
      } catch (error) {
        errors.push({
          agent_type: input.agent_type,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Publish event
    await publishEvent("global", "registry.bulk_import", {
      total: agents.length,
      imported: importedCount,
      failed: errors.length,
    });

    return c.json({
      success: true,
      imported: importedCount,
      total: agents.length,
      errors: errors.length > 0 ? errors : undefined,
    }, 201);
  } catch (error) {
    console.error("[API] POST /api/registry/import error:", error);
    return c.json(
      {
        error: "Failed to import agents",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * POST /api/registry/enrich-context - Generate enriched context for an agent
 * Input: { agent_type, subtask_id?, session_id?, wave_number? }
 * Returns: { scope, previous_results, enriched_context_markdown }
 * @param c - Hono context
 */
export async function postRegistryEnrichContext(c: Context): Promise<Response> {
  try {
    const raw = await c.req.json();

    // Validate input
    const EnrichContextSchema = z.object({
      agent_type: z.string().min(1, "agent_type is required"),
      subtask_id: z.string().uuid().optional(),
      session_id: z.string().optional(),
      wave_number: z.number().int().min(0).optional(),
    });

    const parseResult = EnrichContextSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400
      );
    }

    const input = parseResult.data;
    const sql = getDb();

    // 1. Fetch agent scope from registry
    const registryResults = await sql<AgentRegistryRow[]>`
      SELECT
        agent_type, category, display_name, default_scope,
        allowed_tools, forbidden_actions, max_files,
        wave_assignments, recommended_model, created_at
      FROM agent_registry
      WHERE agent_type = ${input.agent_type}
    `;

    const agentScope = registryResults[0];
    if (!agentScope) {
      return c.json({ error: "Agent not found in registry" }, 404);
    }

    // 2. Fetch previous wave results if wave_number is specified
    interface SubtaskResultRow {
      id: string;
      agent_type: string | null;
      description: string;
      result: Record<string, unknown> | null;
      completed_at: string | null;
    }

    let previousResults: SubtaskResultRow[] = [];

    if (input.wave_number !== undefined && input.wave_number > 0) {
      // Get completed subtasks from wave N-1
      const previousWave = input.wave_number - 1;

      // Find subtasks from previous wave in the same session or task list
      if (input.session_id) {
        previousResults = await sql<SubtaskResultRow[]>`
          SELECT
            s.id, s.agent_type, s.description, s.result, s.completed_at
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
          LIMIT 20
        `;
      } else if (input.subtask_id) {
        // Find subtasks from same task list
        previousResults = await sql<SubtaskResultRow[]>`
          SELECT
            s.id, s.agent_type, s.description, s.result, s.completed_at
          FROM subtasks s
          WHERE s.task_list_id = (
            SELECT task_list_id FROM subtasks WHERE id = ${input.subtask_id}
          )
            AND s.status = 'completed'
            AND EXISTS (
              SELECT 1 FROM agent_registry ar
              WHERE ar.agent_type = s.agent_type
                AND ${previousWave} = ANY(ar.wave_assignments)
            )
          ORDER BY s.completed_at ASC
          LIMIT 20
        `;
      }
    }

    // 3. Build enriched context markdown
    const sections: string[] = [];

    // Scope section
    sections.push("# Agent Scope\n");
    sections.push(`**Agent Type**: ${agentScope.agent_type}`);
    sections.push(`**Category**: ${agentScope.category}`);
    sections.push(`**Max Files**: ${agentScope.max_files ?? 5}`);

    if (agentScope.wave_assignments && agentScope.wave_assignments.length > 0) {
      sections.push(`**Wave Assignments**: ${agentScope.wave_assignments.join(", ")}`);
    }

    if (agentScope.allowed_tools && agentScope.allowed_tools.length > 0) {
      sections.push(`\n**Allowed Tools**: ${agentScope.allowed_tools.join(", ")}`);
    }

    if (agentScope.forbidden_actions && agentScope.forbidden_actions.length > 0) {
      sections.push(`\n**Forbidden Actions**: ${agentScope.forbidden_actions.join(", ")}`);
    }

    // Default scope details
    if (Object.keys(agentScope.default_scope).length > 0) {
      sections.push("\n## Scope Details\n");
      sections.push("```json");
      sections.push(JSON.stringify(agentScope.default_scope, null, 2));
      sections.push("```");
    }

    // Previous wave results section
    if (previousResults.length > 0) {
      sections.push("\n---\n");
      sections.push("# Previous Wave Results\n");
      sections.push(`Found ${previousResults.length} completed task(s) from wave ${(input.wave_number ?? 1) - 1}:\n`);

      for (const result of previousResults) {
        sections.push(`## ${result.agent_type ?? "Unknown"} - ${result.description}`);
        sections.push(`*Completed at: ${result.completed_at}*\n`);

        if (result.result) {
          sections.push("```json");
          sections.push(JSON.stringify(result.result, null, 2));
          sections.push("```\n");
        }
      }
    }

    const enrichedContextMarkdown = sections.join("\n");

    return c.json({
      success: true,
      scope: {
        agent_type: agentScope.agent_type,
        category: agentScope.category,
        display_name: agentScope.display_name,
        max_files: agentScope.max_files,
        allowed_tools: agentScope.allowed_tools,
        forbidden_actions: agentScope.forbidden_actions,
        wave_assignments: agentScope.wave_assignments,
        default_scope: agentScope.default_scope,
      },
      previous_results: previousResults.map((r) => ({
        id: r.id,
        agent_type: r.agent_type,
        description: r.description,
        result: r.result,
        completed_at: r.completed_at,
      })),
      enriched_context_markdown: enrichedContextMarkdown,
    });
  } catch (error) {
    console.error("[API] POST /api/registry/enrich-context error:", error);
    return c.json(
      {
        error: "Failed to enrich context",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

export { AgentRegistryInputSchema };
