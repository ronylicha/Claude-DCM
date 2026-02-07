/**
 * Actions API - Track tool usage
 * Phase 2.3 - POST /api/actions endpoint
 * @module api/actions
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, compressData, publishEvent } from "../db/client";

/** Input schema for action tracking */
export interface ActionInput {
  tool_name: string;
  tool_type: string; // builtin, agent, skill, command, mcp
  input?: string;
  output?: string;
  exit_code?: number;
  duration_ms?: number;
  file_paths?: string[];
  subtask_id?: string;
  session_id?: string;
  project_path?: string;
}

/** Keywords extraction configuration */
const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "shall", "can", "to", "of", "in",
  "for", "on", "with", "at", "by", "from", "as", "or", "and", "but",
  "if", "then", "else", "when", "where", "how", "all", "each", "every",
  "both", "few", "more", "most", "other", "some", "such", "no", "nor",
  "not", "only", "own", "same", "so", "than", "too", "very", "just",
  "also", "now", "here", "there", "this", "that", "these", "those",
  "file", "path", "true", "false", "null", "undefined", "error", "ok",
]);

/**
 * Extract meaningful keywords from text
 * @param text - Input text to extract keywords from
 * @param maxKeywords - Maximum number of keywords to extract
 * @returns Array of unique keywords
 */
export function extractKeywords(text: string, maxKeywords: number = 10): string[] {
  if (!text) return [];

  // Normalize and tokenize
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\-_\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && t.length < 30);

  // Count frequency
  const freq = new Map<string, number>();
  for (const token of tokens) {
    if (!STOP_WORDS.has(token)) {
      freq.set(token, (freq.get(token) || 0) + 1);
    }
  }

  // Sort by frequency and take top keywords
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords)
    .map(([word]) => word);
}

/**
 * Update keyword_tool_scores for routing intelligence
 * @param keywords - Keywords to associate with tool
 * @param toolName - Name of the tool used
 * @param toolType - Type of the tool
 * @param success - Whether the action was successful
 */
async function updateKeywordScores(
  keywords: string[],
  toolName: string,
  toolType: string,
  success: boolean
): Promise<void> {
  const sql = getDb();
  const scoreIncrement = success ? 0.1 : -0.05; // Reward success, slightly penalize failure

  for (const keyword of keywords) {
    await sql`
      INSERT INTO keyword_tool_scores (keyword, tool_name, tool_type, score, usage_count, success_count, last_used)
      VALUES (${keyword}, ${toolName}, ${toolType}, 1.0, 1, ${success ? 1 : 0}, NOW())
      ON CONFLICT (keyword, tool_name)
      DO UPDATE SET
        score = GREATEST(0.1, LEAST(5.0, keyword_tool_scores.score + ${scoreIncrement})),
        usage_count = keyword_tool_scores.usage_count + 1,
        success_count = keyword_tool_scores.success_count + ${success ? 1 : 0},
        last_used = NOW()
    `;
  }
}

/** Valid tool types */
const VALID_TOOL_TYPES = ["builtin", "agent", "skill", "command", "mcp"] as const;

/** Zod schema for action input validation */
const ActionInputSchema = z.object({
  tool_name: z.string().min(1, "tool_name is required"),
  tool_type: z.enum(VALID_TOOL_TYPES),
  input: z.string().optional(),
  output: z.string().optional(),
  exit_code: z.number().int().optional(),
  duration_ms: z.number().int().min(0).optional(),
  file_paths: z.array(z.string()).optional(),
  subtask_id: z.string().uuid().optional(),
  session_id: z.string().optional(),
  project_path: z.string().optional(),
});

/**
 * POST /api/actions - Record a tool action
 * @param c - Hono context
 */
export async function postAction(c: Context): Promise<Response> {
  try {
    const raw = await c.req.json();

    // Validate input with Zod
    const parseResult = ActionInputSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        400
      );
    }
    const body = parseResult.data;

    const sql = getDb();

    // Compress input/output if large (> 1KB)
    let compressedInput: Buffer | null = null;
    let compressedOutput: Buffer | null = null;

    if (body.input && body.input.length > 1024) {
      compressedInput = compressData(body.input);
    }
    if (body.output && body.output.length > 1024) {
      compressedOutput = compressData(body.output);
    }

    // Insert action record
    const [action] = await sql`
      INSERT INTO actions (
        subtask_id,
        tool_name,
        tool_type,
        input,
        output,
        file_paths,
        exit_code,
        duration_ms,
        metadata
      ) VALUES (
        ${body.subtask_id || null},
        ${body.tool_name},
        ${body.tool_type},
        ${compressedInput || (body.input ? Buffer.from(body.input) : null)},
        ${compressedOutput || (body.output ? Buffer.from(body.output) : null)},
        ${body.file_paths || []},
        ${body.exit_code ?? 0},
        ${body.duration_ms || null},
        ${sql.json({
          session_id: body.session_id,
          project_path: body.project_path,
          compressed_input: !!compressedInput,
          compressed_output: !!compressedOutput,
        })}
      )
      RETURNING id, tool_name, tool_type, exit_code, duration_ms, created_at
    `;

    // Extract keywords from input for routing intelligence
    const success = (body.exit_code ?? 0) === 0;
    const keywords = extractKeywords(body.input || "", 10);

    if (keywords.length > 0) {
      await updateKeywordScores(keywords, body.tool_name, body.tool_type, success);
    }

    // Auto-upsert session when session_id is present
    if (body.session_id) {
      try {
        // Find or create project if project_path is provided
        let projectId: string | null = null;
        if (body.project_path) {
          const [project] = await sql`
            INSERT INTO projects (path, name)
            VALUES (${body.project_path}, ${body.project_path.split("/").pop() || "unknown"})
            ON CONFLICT (path) DO UPDATE SET updated_at = NOW()
            RETURNING id
          `;
          projectId = project?.id ?? null;
        }

        // Upsert session with counter increment
        await sql`
          INSERT INTO sessions (id, project_id, started_at, total_tools_used, total_success, total_errors)
          VALUES (
            ${body.session_id},
            ${projectId},
            NOW(),
            1,
            ${success ? 1 : 0},
            ${success ? 0 : 1}
          )
          ON CONFLICT (id) DO UPDATE SET
            project_id = COALESCE(EXCLUDED.project_id, sessions.project_id),
            total_tools_used = sessions.total_tools_used + 1,
            total_success = sessions.total_success + ${success ? 1 : 0},
            total_errors = sessions.total_errors + ${success ? 0 : 1}
        `;
      } catch (sessionErr) {
        // Non-blocking: session tracking failure should not break action recording
        console.error("[API] Session auto-upsert error:", sessionErr);
      }
    }

    // Publish real-time event via PostgreSQL NOTIFY
    await publishEvent("global", "action.created", {
      id: action.id,
      tool_name: action.tool_name,
      tool_type: action.tool_type,
      exit_code: action.exit_code,
      session_id: body.session_id,
    });

    return c.json({
      success: true,
      action: {
        id: action.id,
        tool_name: action.tool_name,
        tool_type: action.tool_type,
        exit_code: action.exit_code,
        duration_ms: action.duration_ms,
        created_at: action.created_at,
        session_id: body.session_id,
        keywords_extracted: keywords.length,
      },
    }, 201);
  } catch (error) {
    console.error("[API] POST /api/actions error:", error);
    return c.json(
      {
        error: "Failed to record action",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/actions/hourly - Get hourly action counts for last 24h
 * @param c - Hono context
 */
export async function getActionsHourly(c: Context): Promise<Response> {
  try {
    const sql = getDb();

    const results = await sql`
      SELECT
        date_trunc('hour', created_at) as hour,
        COUNT(*) as count
      FROM actions
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY date_trunc('hour', created_at)
      ORDER BY hour ASC
    `;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = results.map((row: any) => ({
      hour: row.hour instanceof Date ? row.hour.toISOString() : String(row.hour),
      count: Number(row.count),
    }));

    return c.json({
      data,
      period: "24h",
    });
  } catch (error) {
    console.error("[API] GET /api/actions/hourly error:", error);
    return c.json(
      {
        error: "Failed to fetch hourly actions",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/actions - List recent actions
 * @param c - Hono context
 */
export async function getActions(c: Context): Promise<Response> {
  try {
    const sql = getDb();
    const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10), 100);
    const offset = parseInt(c.req.query("offset") ?? "0", 10);
    const toolType = c.req.query("tool_type");
    const toolName = c.req.query("tool_name");

    let actions;

    if (toolType && toolName) {
      actions = await sql`
        SELECT id, tool_name, tool_type, exit_code, duration_ms, file_paths, created_at, metadata->>'session_id' as session_id
        FROM actions
        WHERE tool_type = ${toolType} AND tool_name = ${toolName}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (toolType) {
      actions = await sql`
        SELECT id, tool_name, tool_type, exit_code, duration_ms, file_paths, created_at, metadata->>'session_id' as session_id
        FROM actions
        WHERE tool_type = ${toolType}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else if (toolName) {
      actions = await sql`
        SELECT id, tool_name, tool_type, exit_code, duration_ms, file_paths, created_at, metadata->>'session_id' as session_id
        FROM actions
        WHERE tool_name = ${toolName}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    } else {
      actions = await sql`
        SELECT id, tool_name, tool_type, exit_code, duration_ms, file_paths, created_at, metadata->>'session_id' as session_id
        FROM actions
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `;
    }

    return c.json({
      actions,
      count: actions.length,
      limit,
      offset,
    });
  } catch (error) {
    console.error("[API] GET /api/actions error:", error);
    return c.json(
      {
        error: "Failed to fetch actions",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * DELETE /api/actions/:id - Delete a single action
 * @param c - Hono context
 */
export async function deleteAction(c: Context): Promise<Response> {
  try {
    const actionId = c.req.param("id");

    if (!actionId) {
      return c.json({ error: "Missing action ID" }, 400);
    }

    const sql = getDb();

    const results = await sql<{ id: string }[]>`
      DELETE FROM actions WHERE id = ${actionId} RETURNING id
    `;

    if (results.length === 0) {
      return c.json({ error: "Action not found" }, 404);
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("[API] DELETE /api/actions/:id error:", error);
    return c.json(
      {
        error: "Failed to delete action",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * DELETE /api/actions/by-session/:session_id - Bulk delete actions by session
 * Deletes all actions that have metadata.session_id matching the given session
 * @param c - Hono context
 */
export async function deleteActionsBySession(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("session_id");

    if (!sessionId) {
      return c.json({ error: "Missing session_id" }, 400);
    }

    const sql = getDb();

    const results = await sql<{ count: string }[]>`
      WITH deleted AS (
        DELETE FROM actions
        WHERE metadata->>'session_id' = ${sessionId}
        RETURNING id
      )
      SELECT COUNT(*) as count FROM deleted
    `;

    const deletedCount = parseInt(results[0]?.count ?? "0", 10);

    // Publish real-time event
    await publishEvent("global", "actions.bulk_deleted", {
      session_id: sessionId,
      deleted_count: deletedCount,
    });

    return c.json({
      success: true,
      deleted_count: deletedCount,
      session_id: sessionId,
    });
  } catch (error) {
    console.error("[API] DELETE /api/actions/by-session/:session_id error:", error);
    return c.json(
      {
        error: "Failed to delete actions by session",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}
