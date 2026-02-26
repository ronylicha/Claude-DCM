/**
 * Context API - Get context for agents
 * Phase 5 - Context Agent Integration
 * GET /api/context/:agent_id endpoint
 * @module api/context
 */

import type { Context } from "hono";
import { z } from "zod";
import { generateContextBrief, getAgentContextData } from "../context-generator";
import { createLogger } from "../lib/logger";

const log = createLogger("Context");

/** Query params schema for GET context */
const GetContextQuerySchema = z.object({
  session_id: z.string().optional(),
  agent_type: z.string().optional(),
  format: z.enum(["brief", "raw"]).default("brief"),
  max_tokens: z.coerce.number().int().min(100).max(8000).default(2000),
  include_history: z.enum(["true", "false"]).default("true"),
  include_messages: z.enum(["true", "false"]).default("true"),
  include_blocking: z.enum(["true", "false"]).default("true"),
  history_limit: z.coerce.number().int().min(1).max(50).default(10),
});

/**
 * GET /api/context/:agent_id - Get current context for an agent
 *
 * Returns either:
 * - format=brief (default): Formatted markdown brief ready to inject
 * - format=raw: Raw context data (tasks, messages, blockings, history)
 *
 * @param c - Hono context
 */
export async function getContext(c: Context): Promise<Response> {
  try {
    const agentId = c.req.param("agent_id");

    if (!agentId) {
      return c.json({ error: "Missing agent_id parameter" }, 400);
    }

    // Parse and validate query params
    const queryParams = {
      session_id: c.req.query("session_id"),
      agent_type: c.req.query("agent_type"),
      format: c.req.query("format") ?? "brief",
      max_tokens: c.req.query("max_tokens") ?? "2000",
      include_history: c.req.query("include_history") ?? "true",
      include_messages: c.req.query("include_messages") ?? "true",
      include_blocking: c.req.query("include_blocking") ?? "true",
      history_limit: c.req.query("history_limit") ?? "10",
    };

    const parseResult = GetContextQuerySchema.safeParse(queryParams);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Invalid query parameters",
          details: parseResult.error.flatten().fieldErrors,
        },
        400
      );
    }

    const query = parseResult.data;

    // Determine session ID (use provided or try to find active one)
    const sessionId = query.session_id ?? await findActiveSession(agentId);

    if (!sessionId) {
      return c.json({
        error: "No active session found",
        agent_id: agentId,
        context: null,
        message: "No active session found for this agent",
      }, 404);
    }

    // Determine agent type
    const agentType = query.agent_type ?? inferAgentType(agentId);

    // Build options
    const options = {
      maxTokens: query.max_tokens,
      includeHistory: query.include_history === "true",
      historyLimit: query.history_limit,
      includeMessages: query.include_messages === "true",
      includeBlocking: query.include_blocking === "true",
    };

    if (query.format === "raw") {
      // Return raw context data
      const data = await getAgentContextData(agentId, sessionId, options);

      return c.json({
        agent_id: agentId,
        session_id: sessionId,
        agent_type: agentType,
        data: {
          tasks: data.tasks,
          messages: data.messages,
          blockings: data.blockings,
          history: data.history,
          session: data.session,
          project: data.project,
        },
        counts: {
          tasks: data.tasks.length,
          messages: data.messages.length,
          blockings: data.blockings.length,
          history: data.history.length,
        },
      });
    }

    // Generate formatted brief
    const brief = await generateContextBrief(
      agentId,
      agentType,
      sessionId,
      options
    );

    return c.json({
      agent_id: agentId,
      session_id: sessionId,
      agent_type: agentType,
      brief: {
        id: brief.id,
        content: brief.brief,
        token_count: brief.token_count,
        truncated: brief.truncated,
        generated_at: brief.generated_at,
      },
      sources: brief.sources,
    });
  } catch (error) {
    log.error("GET /api/context/:agent_id error:", error);
    return c.json(
      {
        error: "Failed to get context",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * POST /api/context/generate - Generate context brief on demand
 * More flexible than GET - allows specifying all parameters in body
 *
 * @param c - Hono context
 */
export async function postContextGenerate(c: Context): Promise<Response> {
  try {
    const body = await c.req.json() as {
      agent_id: string;
      session_id: string;
      agent_type?: string;
      max_tokens?: number;
      include_history?: boolean;
      history_limit?: number;
      include_messages?: boolean;
      include_blocking?: boolean;
      project_id?: string;
    };

    // Validate required fields
    if (!body.agent_id) {
      return c.json({ error: "Missing required field: agent_id" }, 400);
    }

    if (!body.session_id) {
      return c.json({ error: "Missing required field: session_id" }, 400);
    }

    const agentType = body.agent_type ?? inferAgentType(body.agent_id);

    const brief = await generateContextBrief(
      body.agent_id,
      agentType,
      body.session_id,
      {
        maxTokens: body.max_tokens ?? 2000,
        includeHistory: body.include_history ?? true,
        historyLimit: body.history_limit ?? 10,
        includeMessages: body.include_messages ?? true,
        includeBlocking: body.include_blocking ?? true,
        ...(body.project_id ? { projectId: body.project_id } : {}),
      }
    );

    return c.json({
      success: true,
      brief: {
        id: brief.id,
        agent_id: brief.agent_id,
        agent_type: brief.agent_type,
        session_id: brief.session_id,
        content: brief.brief,
        token_count: brief.token_count,
        truncated: brief.truncated,
        generated_at: brief.generated_at,
      },
      sources: brief.sources,
    }, 201);
  } catch (error) {
    log.error("POST /api/context/generate error:", error);
    return c.json(
      {
        error: "Failed to generate context",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * Find an active session for an agent
 */
async function findActiveSession(agentId: string): Promise<string | null> {
  try {
    const { getDb } = await import("../db/client");
    const sql = getDb();

    // Try to find a session where this agent has running tasks
    interface SessionRow {
      session_id: string;
    }

    const results = await sql<SessionRow[]>`
      SELECT DISTINCT r.session_id
      FROM requests r
      JOIN task_lists t ON t.request_id = r.id
      JOIN subtasks s ON s.task_list_id = t.id
      WHERE (s.agent_id = ${agentId} OR s.agent_type = ${agentId})
        AND s.status IN ('running', 'pending', 'paused')
        AND r.status != 'completed'
      ORDER BY r.created_at DESC
      LIMIT 1
    `;

    return results[0]?.session_id ?? null;
  } catch (error) {
    log.error("Error finding active session:", error);
    return null;
  }
}

/**
 * Infer agent type from agent ID
 */
function inferAgentType(agentId: string): string {
  // Remove common prefixes/suffixes
  const normalized = agentId
    .replace(/^agent[-_]/, "")
    .replace(/[-_]\d+$/, "")
    .replace(/[-_]worker$/, "");

  // Map common patterns
  const typePatterns: Record<string, string> = {
    supervisor: "project-supervisor",
    lead: "tech-lead",
    orchestrator: "step-orchestrator",
    backend: "backend-laravel",
    frontend: "frontend-react",
    database: "database-admin",
    qa: "qa-testing",
    test: "qa-testing",
    security: "security-specialist",
    gdpr: "gdpr-dpo",
    seo: "seo-specialist",
    validator: "validator",
    reviewer: "code-reviewer",
  };

  for (const [pattern, type] of Object.entries(typePatterns)) {
    if (normalized.toLowerCase().includes(pattern)) {
      return type;
    }
  }

  // Default to developer
  return "developer";
}

export { GetContextQuerySchema };
