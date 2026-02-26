/**
 * Compact API - Context restoration after compact operations
 * Phase 5 - Context Agent Integration
 * POST /api/compact/restore endpoint
 * @module api/compact
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb } from "../db/client";
import { generateContextBrief } from "../context-generator";
import type { CompactRestoreResponse } from "../context/types";
import { createLogger } from "../lib/logger";

const log = createLogger("Compact");

/** Zod schema for compact restore input validation */
const CompactRestoreInputSchema = z.object({
  session_id: z.string().min(1, "session_id is required"),
  agent_id: z.string().min(1, "agent_id is required"),
  agent_type: z.string().optional().default("developer"),
  compact_summary: z.string().optional(),
  max_tokens: z.number().int().min(100).max(8000).optional().default(2000),
});

type CompactRestoreInput = z.infer<typeof CompactRestoreInputSchema>;

/** Database row for session marker */
interface SessionMarkerRow {
  id: string;
  session_id: string;
  compacted_at: string | null;
}

/**
 * POST /api/compact/restore - Restore context after a compact operation
 *
 * Called by context-keeper agent after a compact event to:
 * 1. Mark the session as compacted
 * 2. Retrieve relevant context from the database
 * 3. Generate a context brief to inject
 * 4. Return the formatted brief
 *
 * @param c - Hono context
 */
export async function postCompactRestore(c: Context): Promise<Response> {
  try {
    const body = await c.req.json();

    // Validate input with Zod
    const parseResult = CompactRestoreInputSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400
      );
    }

    const input: CompactRestoreInput = parseResult.data;
    const sql = getDb();

    log.info(
      `Restoring context for agent=${input.agent_id}, session=${input.session_id}`
    );

    // 1. Mark session as compacted + reset capacity in a single transaction
    let sessionCompacted = false;
    try {
      await sql.begin(async (tx: any) => {
        // Try to find existing request for this session
        const existingRequests = (await tx`
          SELECT id, session_id, compacted_at
          FROM requests
          WHERE session_id = ${input.session_id}
          ORDER BY created_at DESC
          LIMIT 1
        `) as SessionMarkerRow[];

        if (existingRequests.length > 0) {
          // Update existing request with compact timestamp (COALESCE for NULL metadata)
          await tx`
            UPDATE requests
            SET
              metadata = COALESCE(metadata, '{}'::jsonb) || ${tx.json({
                compacted_at: new Date().toISOString(),
                compact_summary: input.compact_summary ?? null,
                compact_agent: input.agent_id,
              })}
            WHERE session_id = ${input.session_id}
          `;
          sessionCompacted = true;
        }

        // Reset capacity within the same transaction
        await tx`
          UPDATE agent_capacity
          SET
            current_usage = GREATEST(ROUND(current_usage * 0.2), 0),
            zone = 'green',
            compact_count = compact_count + 1,
            last_compact_at = NOW(),
            last_updated_at = NOW()
          WHERE agent_id = ${input.agent_id}
        `;
      });

      // Log the compact event
      log.info(
        `Session ${input.session_id} marked as compacted`
      );
    } catch (error) {
      log.warn(
        "Could not mark session as compacted:",
        error
      );
      // Continue anyway - we can still generate the brief
    }

    // 2. Generate context brief for the agent
    const contextBrief = await generateContextBrief(
      input.agent_id,
      input.agent_type ?? "developer",
      input.session_id,
      {
        maxTokens: input.max_tokens,
        includeHistory: true,
        historyLimit: 15, // More history after compact
        includeMessages: true,
        includeBlocking: true,
      }
    );

    // 3. Optionally append the compact summary if provided
    let finalBrief = contextBrief.brief;
    if (input.compact_summary) {
      finalBrief += "\n\n---\n";
      finalBrief += "## Previous Context Summary\n";
      finalBrief += input.compact_summary;
    }

    // 4. context.generated message removed - was never consumed by any agent
    // Context is delivered via additionalContext in the hook response

    // 5. Return response
    const response: CompactRestoreResponse = {
      success: true,
      brief: finalBrief,
      sources: contextBrief.sources,
      session_compacted: sessionCompacted,
      restored_at: new Date().toISOString(),
    };

    log.info(
      `Context restored: ${contextBrief.token_count} tokens, ${contextBrief.sources.length} sources`
    );

    return c.json(response, 200);
  } catch (error) {
    log.error("POST /api/compact/restore error:", error);
    return c.json(
      {
        error: "Failed to restore context",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/compact/status/:session_id - Check if session is compacted
 * @param c - Hono context
 */
export async function getCompactStatus(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("session_id");

    if (!sessionId) {
      return c.json({ error: "Missing session_id parameter" }, 400);
    }

    const sql = getDb();

    // Check if session has been compacted
    interface RequestMetadata {
      id: string;
      session_id: string;
      metadata: {
        compacted_at?: string;
        compact_summary?: string;
        compact_agent?: string;
      };
    }

    const results = await sql<RequestMetadata[]>`
      SELECT id, session_id, metadata
      FROM requests
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const request = results[0];
    if (!request) {
      return c.json({
        session_id: sessionId,
        exists: false,
        compacted: false,
      });
    }

    const compactedAt = request.metadata?.compacted_at;
    const compactSummary = request.metadata?.compact_summary;

    return c.json({
      session_id: sessionId,
      exists: true,
      compacted: !!compactedAt,
      compacted_at: compactedAt ?? null,
      compact_summary: compactSummary ?? null,
      compact_agent: request.metadata?.compact_agent ?? null,
    });
  } catch (error) {
    log.error("GET /api/compact/status error:", error);
    return c.json(
      {
        error: "Failed to get compact status",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * POST /api/compact/save - Save context snapshot before a compact operation
 *
 * Called by PreCompact hook to persist the current session state
 * so it can be restored after Claude compacts the context window.
 *
 * @param c - Hono context
 */
const CompactSaveInputSchema = z.object({
  session_id: z.string().min(1, "session_id is required"),
  trigger: z.enum(["auto", "manual", "proactive"]).default("auto"),
  context_summary: z.string().optional(),
  active_tasks: z.array(z.object({
    id: z.string(),
    description: z.string(),
    status: z.string(),
    agent_type: z.string().optional(),
  })).optional().default([]),
  modified_files: z.array(z.string()).optional().default([]),
  key_decisions: z.array(z.string()).optional().default([]),
  agent_states: z.array(z.object({
    agent_id: z.string(),
    agent_type: z.string(),
    status: z.string(),
    summary: z.string().optional(),
  })).optional().default([]),
});

export async function postCompactSave(c: Context): Promise<Response> {
  try {
    const body = await c.req.json();

    const parseResult = CompactSaveInputSchema.safeParse(body);
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

    log.info(
      `Saving snapshot for session=${input.session_id}, trigger=${input.trigger}`
    );

    // 1. Find session's project
    interface SessionRow {
      project_id: string | null;
    }
    const sessions = await sql<SessionRow[]>`
      SELECT project_id FROM sessions WHERE id = ${input.session_id} LIMIT 1
    `;
    const projectId = sessions[0]?.project_id;

    // 2. Store snapshot in agent_contexts with a special "compact-snapshot" type
    const snapshotData = {
      trigger: input.trigger,
      saved_at: new Date().toISOString(),
      context_summary: input.context_summary ?? null,
      active_tasks: input.active_tasks,
      modified_files: input.modified_files,
      key_decisions: input.key_decisions,
      agent_states: input.agent_states,
    };

    // INSERT each compact as a separate row for full history
    // agent_id includes timestamp to avoid UNIQUE conflict on (project_id, agent_id)
    const compactId = `compact-snapshot-${input.session_id}-${Date.now()}`;
    await sql`
      INSERT INTO agent_contexts (
        project_id,
        agent_id,
        agent_type,
        role_context,
        progress_summary,
        tools_used,
        last_updated
      ) VALUES (
        ${projectId ?? null},
        ${compactId},
        'compact-snapshot',
        ${sql.json(snapshotData)},
        ${input.context_summary ?? "Pre-compact snapshot"},
        ${sql.array(input.modified_files)},
        NOW()
      )
    `;

    // 3. Also mark the request as having a pending compact
    await sql`
      UPDATE requests
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${sql.json({
        compact_snapshot_at: new Date().toISOString(),
        compact_trigger: input.trigger,
      })}
      WHERE session_id = ${input.session_id}
    `;

    log.info(
      `Snapshot saved: ${input.active_tasks.length} tasks, ${input.modified_files.length} files, ${input.key_decisions.length} decisions`
    );

    return c.json({
      success: true,
      snapshot: {
        session_id: input.session_id,
        trigger: input.trigger,
        tasks_count: input.active_tasks.length,
        files_count: input.modified_files.length,
        decisions_count: input.key_decisions.length,
        agents_count: input.agent_states.length,
      },
      saved_at: new Date().toISOString(),
    }, 201);
  } catch (error) {
    log.error("POST /api/compact/save error:", error);
    return c.json(
      {
        error: "Failed to save compact snapshot",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/compact/snapshot/:session_id - Get the latest saved snapshot
 * @param c - Hono context
 */
export async function getCompactSnapshot(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("session_id");

    if (!sessionId) {
      return c.json({ error: "Missing session_id parameter" }, 400);
    }

    const sql = getDb();

    const results = await sql`
      SELECT role_context, progress_summary, tools_used, last_updated
      FROM agent_contexts
      WHERE agent_id LIKE ${"compact-snapshot-" + sessionId + "%"}
        AND agent_type = 'compact-snapshot'
      ORDER BY last_updated DESC
      LIMIT 1
    `;

    if (results.length === 0) {
      return c.json({
        session_id: sessionId,
        exists: false,
        snapshot: null,
      });
    }

    const row = results[0];
    // TODO(schema): tools_used column is repurposed for modified_files in compact snapshots.
    // Once schema is migrated to a dedicated snapshot_files column, update this query accordingly.
    return c.json({
      session_id: sessionId,
      exists: true,
      snapshot: row.role_context,
      summary: row.progress_summary,
      modified_files: row.tools_used,
      saved_at: row.last_updated,
    });
  } catch (error) {
    log.error("GET /api/compact/snapshot error:", error);
    return c.json(
      {
        error: "Failed to get compact snapshot",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

export { CompactRestoreInputSchema, CompactSaveInputSchema };
