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

/** Snapshot data structure stored in role_context */
interface SnapshotData {
  trigger?: string;
  saved_at?: string;
  context_summary?: string | null;
  active_tasks?: Array<{ id: string; description: string; status: string; agent_type?: string | undefined; parent_agent_id?: string | undefined }>;
  modified_files?: string[];
  key_decisions?: string[];
  agent_states?: Array<{ agent_id: string; agent_type: string; status: string; summary?: string | undefined }>;
  wave_state?: { current?: Record<string, unknown>; history?: unknown[] };
}

/**
 * Generate a Markdown brief from a saved snapshot (snapshot-first restore)
 */
function generateBriefFromSnapshot(snapshot: SnapshotData, compactSummary?: string): string {
  const sections: string[] = [];

  sections.push("# Context Restored After Compact\n");

  // Compact summary from Claude (if provided via hook)
  if (compactSummary) {
    sections.push("## Claude's Compact Summary\n");
    sections.push(compactSummary);
    sections.push("");
  }

  // Context summary from pre-compact
  if (snapshot.context_summary) {
    sections.push("## Previous Context\n");
    sections.push(snapshot.context_summary);
    sections.push("");
  }

  // Wave state
  if (snapshot.wave_state?.current && Object.keys(snapshot.wave_state.current).length > 0) {
    sections.push("## Wave State\n");
    const current = snapshot.wave_state.current;
    if (current["wave_number"] !== undefined) {
      sections.push(`Current wave: **${current["wave_number"]}** (${current["status"] || "unknown"})`);
    }
    if (current["total_tasks"]) {
      sections.push(`Tasks: ${current["completed_tasks"] || 0}/${current["total_tasks"]} completed, ${current["failed_tasks"] || 0} failed`);
    }
    if (Array.isArray(snapshot.wave_state.history) && snapshot.wave_state.history.length > 0) {
      sections.push(`\nWave history: ${snapshot.wave_state.history.length} waves recorded`);
    }
    sections.push("");
  }

  // Active tasks grouped by status
  if (snapshot.active_tasks && snapshot.active_tasks.length > 0) {
    sections.push("## Active Tasks\n");
    const byStatus: Record<string, typeof snapshot.active_tasks> = {};
    for (const task of snapshot.active_tasks) {
      const status = task.status || "unknown";
      if (!byStatus[status]) byStatus[status] = [];
      byStatus[status].push(task);
    }
    for (const [status, tasks] of Object.entries(byStatus)) {
      sections.push(`### ${status.charAt(0).toUpperCase() + status.slice(1)} (${tasks.length})`);
      for (const task of tasks) {
        const parent = task.parent_agent_id ? ` [subagent of ${task.parent_agent_id}]` : "";
        sections.push(`- [${task.agent_type || "unassigned"}] ${task.description}${parent}`);
      }
      sections.push("");
    }
  }

  // Key decisions
  if (snapshot.key_decisions && snapshot.key_decisions.length > 0) {
    sections.push("## Key Decisions\n");
    for (const decision of snapshot.key_decisions) {
      sections.push(`- ${decision}`);
    }
    sections.push("");
  }

  // Modified files
  if (snapshot.modified_files && snapshot.modified_files.length > 0) {
    sections.push("## Modified Files\n");
    for (const file of snapshot.modified_files) {
      sections.push(`- ${file}`);
    }
    sections.push("");
  }

  // Agent states
  if (snapshot.agent_states && snapshot.agent_states.length > 0) {
    sections.push("## Agent States\n");
    for (const agent of snapshot.agent_states) {
      sections.push(`- **${agent.agent_type}** (${agent.agent_id}): ${agent.status}${agent.summary ? ` — ${agent.summary}` : ""}`);
    }
    sections.push("");
  }

  return sections.join("\n");
}

/**
 * POST /api/compact/restore - Restore context after a compact operation
 *
 * Strategy: Snapshot-first
 * 1. Look for saved snapshot in DB for this session
 * 2. If found: generate brief from snapshot data
 * 3. If not found: fallback to generateContextBrief() with session-scoped query
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
        const existingRequests = (await tx`
          SELECT id, session_id, compacted_at
          FROM requests
          WHERE session_id = ${input.session_id}
          ORDER BY created_at DESC
          LIMIT 1
        `) as SessionMarkerRow[];

        if (existingRequests.length > 0) {
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

      log.info(`Session ${input.session_id} marked as compacted`);
    } catch (error) {
      log.warn("Could not mark session as compacted:", error);
    }

    // 2. Snapshot-first: look for saved snapshot
    let finalBrief = "";
    let sources: any[] = [];
    let tokenCount = 0;

    const snapshotResults = await sql`
      SELECT role_context, progress_summary, tools_used, last_updated
      FROM agent_contexts
      WHERE agent_id LIKE ${"compact-snapshot-" + input.session_id + "%"}
        AND agent_type = 'compact-snapshot'
      ORDER BY last_updated DESC
      LIMIT 1
    `;

    if (snapshotResults.length > 0) {
      // Snapshot found — generate brief from snapshot data
      const snapshotRow = snapshotResults[0]!;
      const snapshot = snapshotRow["role_context"] as SnapshotData;
      finalBrief = generateBriefFromSnapshot(snapshot, input.compact_summary);
      sources.push({
        type: "snapshot",
        id: "compact-snapshot",
        relevance: 1.0,
        summary: `Snapshot from ${snapshotRow["last_updated"]}`,
      });

      // Enrich with live data: running subtasks not in snapshot
      const liveSubtasks = await sql`
        SELECT s.description, s.status, s.agent_type, s.parent_agent_id
        FROM subtasks s
        JOIN task_lists tl ON s.task_list_id = tl.id
        JOIN requests r ON tl.request_id = r.id
        WHERE r.session_id = ${input.session_id}
          AND s.status IN ('running', 'pending', 'blocked')
        ORDER BY s.created_at DESC
        LIMIT 10
      `;

      if (liveSubtasks.length > 0) {
        const snapshotTaskIds = new Set((snapshot.active_tasks || []).map(t => t.id));
        const newTasks = liveSubtasks.filter((t: Record<string, unknown>) => !snapshotTaskIds.has(t["id"] as string));
        if (newTasks.length > 0) {
          finalBrief += "\n## Live Updates (post-snapshot)\n\n";
          for (const task of newTasks) {
            finalBrief += `- [${task["status"]}] ${task["agent_type"] || "unknown"}: ${task["description"]}\n`;
          }
        }
      }

      tokenCount = Math.ceil(finalBrief.length / 3.5);
      log.info(`Context restored from snapshot: ${tokenCount} tokens`);
    } else {
      // 3. No snapshot — fallback to generateContextBrief with session-scoped agent_id
      const agentId = `session-${input.session_id}`;
      const contextBrief = await generateContextBrief(
        agentId,
        input.agent_type ?? "developer",
        input.session_id,
        {
          maxTokens: input.max_tokens,
          includeHistory: true,
          historyLimit: 15,
          includeMessages: true,
          includeBlocking: true,
        }
      );

      finalBrief = contextBrief.brief;
      sources = contextBrief.sources;
      tokenCount = contextBrief.token_count;

      // Append compact summary if provided
      if (input.compact_summary) {
        finalBrief += "\n\n---\n";
        finalBrief += "## Previous Context Summary\n";
        finalBrief += input.compact_summary;
      }

      log.info(`Context restored via fallback: ${tokenCount} tokens, ${sources.length} sources`);
    }

    // 4. Return response
    const response: CompactRestoreResponse = {
      success: true,
      brief: finalBrief,
      sources,
      session_compacted: sessionCompacted,
      restored_at: new Date().toISOString(),
    };

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
    parent_agent_id: z.string().optional(),
  })).optional().default([]),
  modified_files: z.array(z.string()).optional().default([]),
  key_decisions: z.array(z.string()).optional().default([]),
  agent_states: z.array(z.object({
    agent_id: z.string(),
    agent_type: z.string(),
    status: z.string(),
    summary: z.string().optional(),
  })).optional().default([]),
  wave_state: z.record(z.string(), z.unknown()).optional(),
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
      wave_state: input.wave_state ?? null,
    };

    const compactId = `compact-snapshot-${input.session_id}-${Date.now()}`;
    await sql`
      INSERT INTO agent_contexts (
        project_id,
        agent_id,
        agent_type,
        session_id,
        compact_id,
        role_context,
        progress_summary,
        tools_used,
        last_updated
      ) VALUES (
        ${projectId ?? null},
        ${compactId},
        'compact-snapshot',
        ${input.session_id},
        ${compactId},
        ${sql.json(snapshotData as any)},
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

    const row = results[0]!;
    return c.json({
      session_id: sessionId,
      exists: true,
      snapshot: row["role_context"],
      summary: row["progress_summary"],
      modified_files: row["tools_used"],
      saved_at: row["last_updated"],
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
