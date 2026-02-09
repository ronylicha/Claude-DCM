/**
 * Orchestration API - Batch task orchestration and synthesis
 * Manages wave-based task execution and inter-agent coordination
 * @module api/orchestration
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";

/** Zod schema for batch submission input validation */
const BatchSubmitInputSchema = z.object({
  session_id: z.string().min(1, "session_id is required"),
  wave_number: z.number().int().min(0),
  tasks: z.array(z.object({
    description: z.string().min(1),
    agent_type: z.string().min(1),
    priority: z.number().int().min(1).max(10).optional().default(5),
    task_id: z.string().uuid("task_id must be a valid UUID"),
  })).min(1, "At least one task is required"),
});

type BatchSubmitInput = z.infer<typeof BatchSubmitInputSchema>;

/** Database row for orchestration_batches */
interface BatchRow {
  id: string;
  session_id: string;
  wave_number: number;
  status: string;
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  synthesis: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}

/** Database row for subtasks */
interface SubtaskRow {
  id: string;
  task_list_id: string;
  batch_id: string | null;
  agent_type: string | null;
  agent_id: string | null;
  description: string;
  status: string;
  priority: number;
  retry_count: number;
  result: Record<string, unknown> | null;
  context_snapshot: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/**
 * POST /api/orchestration/batch-submit - Create a batch of tasks for wave execution
 * @param c - Hono context
 */
export async function postBatchSubmit(c: Context): Promise<Response> {
  try {
    const body = await c.req.json();

    const parseResult = BatchSubmitInputSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400
      );
    }

    const input: BatchSubmitInput = parseResult.data;
    const sql = getDb();

    console.log(
      `[Orchestration] Submitting batch: session=${input.session_id}, wave=${input.wave_number}, tasks=${input.tasks.length}`
    );

    // 1. Create orchestration_batches row
    const batchResults = await sql<BatchRow[]>`
      INSERT INTO orchestration_batches (
        session_id,
        wave_number,
        status,
        total_tasks
      ) VALUES (
        ${input.session_id},
        ${input.wave_number},
        'pending',
        ${input.tasks.length}
      )
      RETURNING id, session_id, wave_number, status, total_tasks, completed_tasks, failed_tasks, synthesis, created_at, completed_at
    `;

    const batch = batchResults[0];
    if (!batch) {
      return c.json({ error: "Failed to create batch" }, 500);
    }

    // 2. Create subtasks for each task, linking batch_id
    const subtaskIds: string[] = [];

    for (const task of input.tasks) {
      const subtaskResults = await sql<SubtaskRow[]>`
        INSERT INTO subtasks (
          task_list_id,
          batch_id,
          agent_type,
          description,
          status,
          priority
        ) VALUES (
          ${task.task_id},
          ${batch.id},
          ${task.agent_type},
          ${task.description},
          'pending',
          ${task.priority ?? 5}
        )
        RETURNING id
      `;

      if (subtaskResults[0]) {
        subtaskIds.push(subtaskResults[0].id);
      }
    }

    // 3. Publish event "batch.created"
    await publishEvent("global", "batch.created", {
      batch_id: batch.id,
      session_id: batch.session_id,
      wave_number: batch.wave_number,
      total_tasks: batch.total_tasks,
      subtask_ids: subtaskIds,
    });

    console.log(
      `[Orchestration] Batch created: id=${batch.id}, subtasks=${subtaskIds.length}`
    );

    // 4. Return batch with subtask IDs
    return c.json({
      success: true,
      batch: {
        id: batch.id,
        session_id: batch.session_id,
        wave_number: batch.wave_number,
        status: batch.status,
        total_tasks: batch.total_tasks,
        completed_tasks: batch.completed_tasks,
        failed_tasks: batch.failed_tasks,
        created_at: batch.created_at,
        subtask_ids: subtaskIds,
      },
    }, 201);
  } catch (error) {
    console.error("[API] POST /api/orchestration/batch-submit error:", error);
    return c.json(
      {
        error: "Failed to create batch",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/orchestration/batch/:id - Get batch status with all subtasks
 * @param c - Hono context
 */
export async function getBatch(c: Context): Promise<Response> {
  try {
    const batchId = c.req.param("id");

    if (!batchId) {
      return c.json({ error: "Missing batch ID" }, 400);
    }

    const sql = getDb();

    // Get batch
    const batchResults = await sql<BatchRow[]>`
      SELECT id, session_id, wave_number, status, total_tasks, completed_tasks, failed_tasks, synthesis, created_at, completed_at
      FROM orchestration_batches
      WHERE id = ${batchId}
    `;

    const batch = batchResults[0];
    if (!batch) {
      return c.json({ error: "Batch not found" }, 404);
    }

    // Get all subtasks for this batch
    const subtasks = await sql<SubtaskRow[]>`
      SELECT id, task_list_id, batch_id, agent_type, agent_id, description, status, priority, retry_count, result, context_snapshot, created_at, started_at, completed_at
      FROM subtasks
      WHERE batch_id = ${batchId}
      ORDER BY priority DESC, created_at ASC
    `;

    return c.json({
      batch: {
        id: batch.id,
        session_id: batch.session_id,
        wave_number: batch.wave_number,
        status: batch.status,
        total_tasks: batch.total_tasks,
        completed_tasks: batch.completed_tasks,
        failed_tasks: batch.failed_tasks,
        synthesis: batch.synthesis,
        created_at: batch.created_at,
        completed_at: batch.completed_at,
        subtasks: subtasks.map(s => ({
          id: s.id,
          task_list_id: s.task_list_id,
          agent_type: s.agent_type,
          agent_id: s.agent_id,
          description: s.description,
          status: s.status,
          priority: s.priority,
          retry_count: s.retry_count,
          result: s.result,
          created_at: s.created_at,
          started_at: s.started_at,
          completed_at: s.completed_at,
        })),
      },
    });
  } catch (error) {
    console.error("[API] GET /api/orchestration/batch/:id error:", error);
    return c.json(
      {
        error: "Failed to fetch batch",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/orchestration/synthesis/:id - Get synthesis JSONB (optimized for token savings)
 * @param c - Hono context
 */
export async function getSynthesis(c: Context): Promise<Response> {
  try {
    const batchId = c.req.param("id");

    if (!batchId) {
      return c.json({ error: "Missing batch ID" }, 400);
    }

    const sql = getDb();

    const results = await sql<{ synthesis: Record<string, unknown> | null }[]>`
      SELECT synthesis
      FROM orchestration_batches
      WHERE id = ${batchId}
    `;

    if (results.length === 0) {
      return c.json({ error: "Batch not found" }, 404);
    }

    const batch = results[0];
    if (!batch) {
      return c.json({ error: "Batch not found" }, 404);
    }
    if (!batch.synthesis) {
      return c.json({ error: "Synthesis not available yet" }, 404);
    }

    return c.json(batch.synthesis);
  } catch (error) {
    console.error("[API] GET /api/orchestration/synthesis/:id error:", error);
    return c.json(
      {
        error: "Failed to fetch synthesis",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/orchestration/conflicts/:id - Analyze batch subtasks for conflicts
 * @param c - Hono context
 */
export async function getConflicts(c: Context): Promise<Response> {
  try {
    const batchId = c.req.param("id");

    if (!batchId) {
      return c.json({ error: "Missing batch ID" }, 400);
    }

    const sql = getDb();

    // Get all subtasks for this batch
    const subtasks = await sql<SubtaskRow[]>`
      SELECT id, task_list_id, agent_type, agent_id, description, status, result, context_snapshot
      FROM subtasks
      WHERE batch_id = ${batchId}
      ORDER BY created_at ASC
    `;

    if (subtasks.length === 0) {
      return c.json({ error: "Batch not found or has no subtasks" }, 404);
    }

    const conflicts: Array<{
      type: string;
      severity: string;
      agents: string[];
      description: string;
      files?: string[];
    }> = [];

    // 1. File conflicts: 2+ agents modifying same file
    const fileMap = new Map<string, Set<string>>();

    for (const subtask of subtasks) {
      const files: string[] = [];

      // Check result.files
      if (subtask.result && Array.isArray(subtask.result['files'])) {
        files.push(...(subtask.result['files'] as string[]));
      }

      // Check context_snapshot for file references
      if (subtask.context_snapshot && Array.isArray(subtask.context_snapshot['modified_files'])) {
        files.push(...(subtask.context_snapshot['modified_files'] as string[]));
      }

      // Track which agents touched which files
      for (const file of files) {
        if (!fileMap.has(file)) {
          fileMap.set(file, new Set());
        }
        if (subtask.agent_type) {
          fileMap.get(file)!.add(subtask.agent_type);
        }
      }
    }

    // Find files modified by multiple agents
    for (const [file, agents] of fileMap.entries()) {
      if (agents.size > 1) {
        conflicts.push({
          type: "file_conflict",
          severity: "high",
          agents: Array.from(agents),
          description: `Multiple agents modified the same file: ${file}`,
          files: [file],
        });
      }
    }

    // 2. Dependency conflicts: Agent B depends on A, but A failed
    const failedAgents = new Set(
      subtasks
        .filter(s => s.status === "failed")
        .map(s => s.agent_type)
        .filter((a): a is string => !!a)
    );

    for (const subtask of subtasks) {
      if (subtask.status === "blocked" && failedAgents.size > 0) {
        // Check if blocked by a failed agent (simplified: checks if any blocker failed)
        const possibleConflict = Array.from(failedAgents).some(failedAgent => {
          return subtask.description.toLowerCase().includes(failedAgent.toLowerCase());
        });

        if (possibleConflict) {
          conflicts.push({
            type: "dependency_conflict",
            severity: "critical",
            agents: [subtask.agent_type ?? "unknown"],
            description: `Subtask "${subtask.description}" blocked, but dependencies may have failed`,
          });
        }
      }
    }

    return c.json({
      batch_id: batchId,
      conflicts,
      conflict_count: conflicts.length,
    });
  } catch (error) {
    console.error("[API] GET /api/orchestration/conflicts/:id error:", error);
    return c.json(
      {
        error: "Failed to analyze conflicts",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * POST /api/orchestration/batch/:id/complete - Mark batch as complete and generate synthesis
 * @param c - Hono context
 */
export async function postBatchComplete(c: Context): Promise<Response> {
  try {
    const batchId = c.req.param("id");

    if (!batchId) {
      return c.json({ error: "Missing batch ID" }, 400);
    }

    const sql = getDb();

    // Get batch and all subtasks
    const batchResults = await sql<BatchRow[]>`
      SELECT id, session_id, wave_number, status, total_tasks, completed_tasks, failed_tasks
      FROM orchestration_batches
      WHERE id = ${batchId}
    `;

    const batch = batchResults[0];
    if (!batch) {
      return c.json({ error: "Batch not found" }, 404);
    }

    const subtasks = await sql<SubtaskRow[]>`
      SELECT id, agent_type, agent_id, description, status, result, created_at, completed_at
      FROM subtasks
      WHERE batch_id = ${batchId}
      ORDER BY created_at ASC
    `;

    // Count completed and failed
    const completedCount = subtasks.filter(s => s.status === "completed").length;
    const failedCount = subtasks.filter(s => s.status === "failed").length;

    // Collect all modified files
    const filesChanged = new Set<string>();
    for (const subtask of subtasks) {
      if (subtask.result && Array.isArray(subtask.result['files'])) {
        for (const file of subtask.result['files'] as string[]) {
          filesChanged.add(file);
        }
      }
    }

    // Generate synthesis
    const results = subtasks.map(s => ({
      agent: s.agent_type ?? "unknown",
      agent_id: s.agent_id ?? null,
      status: s.status,
      files: (s.result && Array.isArray(s.result['files'])) ? s.result['files'] : [],
      summary: s.description,
      duration_ms: s.started_at && s.completed_at
        ? Math.round(new Date(s.completed_at).getTime() - new Date(s.started_at).getTime())
        : null,
    }));

    const conflicts: string[] = [];
    const fileMap = new Map<string, number>();
    for (const result of results) {
      for (const file of result.files) {
        fileMap.set(file as string, (fileMap.get(file as string) ?? 0) + 1);
      }
    }
    for (const [file, count] of fileMap.entries()) {
      if (count > 1) {
        conflicts.push(`File conflict: ${file} modified by ${count} agents`);
      }
    }

    const totalDurationMs = results.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0);
    const avgDurationMs = results.length > 0 ? Math.round(totalDurationMs / results.length) : 0;

    const synthesis = {
      summary: `Wave ${batch.wave_number}: ${completedCount}/${batch.total_tasks} tasks completed. ${filesChanged.size} files modified, ${conflicts.length} conflicts.`,
      results,
      conflicts,
      files_changed: Array.from(filesChanged),
      next_wave_ready: failedCount === 0 && completedCount === batch.total_tasks,
      tokens_saved: Math.round(filesChanged.size * 500 + completedCount * 200),
      stats: {
        total_tasks: batch.total_tasks,
        completed: completedCount,
        failed: failedCount,
        files_modified: filesChanged.size,
        avg_duration_ms: avgDurationMs,
        total_duration_ms: Math.round(totalDurationMs),
      },
    };

    // Update batch
    await sql`
      UPDATE orchestration_batches
      SET
        status = 'completed',
        completed_tasks = ${completedCount},
        failed_tasks = ${failedCount},
        synthesis = ${sql.json(synthesis)},
        completed_at = NOW()
      WHERE id = ${batchId}
    `;

    // Publish event
    await publishEvent("global", "batch.completed", {
      batch_id: batchId,
      session_id: batch.session_id,
      wave_number: batch.wave_number,
      completed_tasks: completedCount,
      failed_tasks: failedCount,
      next_wave_ready: synthesis.next_wave_ready,
    });

    console.log(
      `[Orchestration] Batch completed: id=${batchId}, ${completedCount}/${batch.total_tasks} tasks, ${filesChanged.size} files, ${Math.round(totalDurationMs / 1000)}s`
    );

    return c.json({
      success: true,
      synthesis,
    });
  } catch (error) {
    console.error("[API] POST /api/orchestration/batch/:id/complete error:", error);
    return c.json(
      {
        error: "Failed to complete batch",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

export { BatchSubmitInputSchema };
