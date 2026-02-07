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

    console.log(
      `[Compact] Restoring context for agent=${input.agent_id}, session=${input.session_id}`
    );

    // 1. Mark session as compacted (create marker if needed)
    let sessionCompacted = false;
    try {
      // Try to find existing request for this session
      const existingRequests = await sql<SessionMarkerRow[]>`
        SELECT id, session_id, compacted_at
        FROM requests
        WHERE session_id = ${input.session_id}
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (existingRequests.length > 0) {
        // Update existing request with compact timestamp
        await sql`
          UPDATE requests
          SET
            metadata = metadata || ${JSON.stringify({
              compacted_at: new Date().toISOString(),
              compact_summary: input.compact_summary ?? null,
              compact_agent: input.agent_id,
            })}::jsonb
          WHERE session_id = ${input.session_id}
        `;
        sessionCompacted = true;
      }

      // Log the compact event
      console.log(
        `[Compact] Session ${input.session_id} marked as compacted`
      );
    } catch (error) {
      console.warn(
        "[Compact] Could not mark session as compacted:",
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

    // 4. Publish context.generated event (for pub/sub integration)
    try {
      await sql`
        INSERT INTO agent_messages (
          from_agent_id,
          to_agent_id,
          message_type,
          topic,
          payload,
          priority,
          expires_at
        ) VALUES (
          'context-manager',
          ${input.agent_id},
          'context.generated',
          'context.generated',
          ${JSON.stringify({
            session_id: input.session_id,
            agent_id: input.agent_id,
            brief_id: contextBrief.id,
            token_count: contextBrief.token_count,
            truncated: contextBrief.truncated,
            sources_count: contextBrief.sources.length,
          })}::jsonb,
          5,
          ${new Date(Date.now() + 3600000).toISOString()}
        )
      `;
    } catch (error) {
      console.warn("[Compact] Could not publish context.generated event:", error);
      // Non-critical - continue
    }

    // 5. Return response
    const response: CompactRestoreResponse = {
      success: true,
      brief: finalBrief,
      sources: contextBrief.sources,
      session_compacted: sessionCompacted,
      restored_at: new Date().toISOString(),
    };

    console.log(
      `[Compact] Context restored: ${contextBrief.token_count} tokens, ${contextBrief.sources.length} sources`
    );

    return c.json(response, 200);
  } catch (error) {
    console.error("[API] POST /api/compact/restore error:", error);
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
    console.error("[API] GET /api/compact/status error:", error);
    return c.json(
      {
        error: "Failed to get compact status",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

export { CompactRestoreInputSchema };
