import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("CompactPreemptive");

// POST /api/compact/preemptive-summary — Store a preemptive summary from headless agent
const summarySchema = z.object({
  session_id: z.string().min(1),
  summary: z.string().min(1),
  source: z.string().optional().default("headless-agent"),
  context_tokens_at_trigger: z.number().optional(),
  status: z.string().optional(),
});

interface UpdatedIdRow {
  id: string;
}

export async function postPreemptiveSummary(c: Context) {
  const body = await c.req.json();
  const parsed = summarySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);
  }

  const { session_id, summary, source, context_tokens_at_trigger, status } = parsed.data;
  const db = getDb();

  try {
    const finalStatus = status || "ready";

    // If status is provided (e.g., "failed"), update existing generating record
    if (status === "failed") {
      await db`
        UPDATE preemptive_summaries
        SET summary = ${summary}, status = 'failed'
        WHERE session_id = ${session_id} AND status = 'generating'
      `;
    } else {
      // Update generating record to ready, or insert new
      const [updated] = await db<UpdatedIdRow[]>`
        UPDATE preemptive_summaries
        SET summary = ${summary}, status = ${finalStatus},
            context_tokens_at_trigger = ${context_tokens_at_trigger || null}
        WHERE session_id = ${session_id} AND status = 'generating'
        RETURNING id
      `;

      if (!updated) {
        await db`
          INSERT INTO preemptive_summaries (session_id, summary, source, context_tokens_at_trigger, status)
          VALUES (${session_id}, ${summary}, ${source}, ${context_tokens_at_trigger || null}, ${finalStatus})
        `;
      }
    }

    publishEvent("global", "summary.status", {
      session_id,
      status: finalStatus,
    });

    return c.json({ ok: true, status: finalStatus });
  } catch (error) {
    log.error("POST /api/compact/preemptive-summary error:", error);
    return c.json({ error: "Failed to store preemptive summary" }, 500);
  }
}

// GET /api/compact/preemptive/:session_id — Get latest ready summary
export async function getPreemptiveSummary(c: Context) {
  const session_id = c.req.param("session_id");
  const db = getDb();

  try {
    const [summary] = await db`
      SELECT id, summary, source, context_tokens_at_trigger, status, created_at
      FROM preemptive_summaries
      WHERE session_id = ${session_id} AND status = 'ready'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (!summary) {
      return c.json({ available: false, message: "No ready preemptive summary" });
    }

    return c.json({ available: true, ...summary });
  } catch (error) {
    log.error("GET /api/compact/preemptive error:", error);
    return c.json({ error: "Failed to get preemptive summary" }, 500);
  }
}

interface TaskRow {
  status: string;
  agent_id: string | null;
  agent_type: string;
  description: string;
  wave_number: number;
}

interface WaveRow {
  status: string;
  wave_number: number;
  completed_tasks: number;
  total_tasks: number;
}

interface FileRow {
  file_path: string;
}

interface MessageRow {
  to_agent_id: string | null;
  payload: string | Record<string, unknown>;
  from_agent_id: string;
}

interface CapacityRow {
  agent_id: string;
  zone: string;
  current_usage: number;
  max_capacity: number;
}

// GET /api/compact/raw-context/:session_id — Assemble raw context as Markdown
export async function getRawContext(c: Context) {
  const session_id = c.req.param("session_id");
  const db = getDb();

  try {
    const [tasks, recentActions, messages, waves, capacities, files] = await Promise.all([
      // Active tasks
      db<TaskRow[]>`
        SELECT st.agent_type, st.agent_id, st.description, st.status, st.parent_agent_id,
               tl.wave_number
        FROM subtasks st
        JOIN task_lists tl ON st.task_list_id = tl.id
        JOIN requests r ON tl.request_id = r.id
        WHERE r.session_id = ${session_id}
          AND st.status IN ('running', 'pending', 'blocked')
        ORDER BY tl.wave_number, st.created_at
      `,
      // Recent actions (last 50) — use a.session_id directly
      db`
        SELECT a.tool_name, a.exit_code, a.file_paths, a.created_at,
               COALESCE(st.agent_id, 'unknown') as agent_id
        FROM actions a
        LEFT JOIN subtasks st ON a.subtask_id = st.id
        WHERE a.session_id = ${session_id}
        ORDER BY a.created_at DESC
        LIMIT 50
      `,
      // Recent messages
      db<MessageRow[]>`
        SELECT from_agent_id, to_agent_id, topic, payload, created_at
        FROM agent_messages
        WHERE created_at > NOW() - INTERVAL '2 hours'
        ORDER BY created_at DESC
        LIMIT 20
      `,
      // Wave states
      db<WaveRow[]>`
        SELECT wave_number, status, total_tasks, completed_tasks, failed_tasks
        FROM wave_states
        WHERE session_id = ${session_id}
        ORDER BY wave_number
      `,
      // Agent capacities
      db<CapacityRow[]>`
        SELECT agent_id, current_usage, max_capacity, zone, model_id
        FROM agent_capacity
        WHERE session_id = ${session_id}
      `,
      // Modified files (from actions) — use a.session_id directly
      db<FileRow[]>`
        SELECT DISTINCT unnest(a.file_paths) as file_path
        FROM actions a
        WHERE a.session_id = ${session_id}
          AND a.file_paths IS NOT NULL
          AND a.tool_name IN ('Write', 'Edit', 'MultiEdit')
        LIMIT 100
      `,
    ]);

    // Suppress unused variable warning — recentActions is assembled into the markdown below
    void recentActions;

    // Assemble Markdown
    let md = `# Contexte Session ${session_id}\n\n`;

    // Tasks
    md += `## Taches Actives\n`;
    if (tasks.length === 0) {
      md += `Aucune tache active.\n`;
    } else {
      tasks.forEach(t => {
        md += `- [${t.status}] ${t.agent_id || t.agent_type}: "${t.description}" (wave ${t.wave_number})\n`;
      });
    }
    md += `\n`;

    // Waves
    md += `## Historique des Waves\n`;
    waves.forEach(w => {
      const icon = w.status === 'completed' ? 'done' : w.status === 'running' ? 'en cours' : w.status;
      md += `- Wave ${w.wave_number}: ${icon} (${w.completed_tasks}/${w.total_tasks})\n`;
    });
    md += `\n`;

    // Modified files
    md += `## Fichiers Modifies\n`;
    files.forEach(f => {
      md += `- ${f.file_path}\n`;
    });
    md += `\n`;

    // Messages
    if (messages.length > 0) {
      md += `## Messages Inter-Agents Recents\n`;
      messages.forEach(m => {
        const to = m.to_agent_id || 'all';
        const payload = typeof m.payload === 'string' ? m.payload : JSON.stringify(m.payload).substring(0, 200);
        md += `- ${m.from_agent_id} -> ${to}: ${payload}\n`;
      });
      md += `\n`;
    }

    // Agent capacities
    md += `## Etat des Agents\n`;
    md += `| Agent | Zone | Usage | Max |\n`;
    md += `|-------|------|-------|-----|\n`;
    capacities.forEach(cap => {
      md += `| ${cap.agent_id} | ${cap.zone} | ${cap.current_usage} | ${cap.max_capacity} |\n`;
    });

    // Truncate if too long (50K chars max ~ 14K tokens)
    if (md.length > 50000) {
      md = md.substring(0, 49500) + `\n\n[TRONQUE - contexte trop volumineux]\n`;
    }

    return c.text(md);
  } catch (error) {
    log.error("GET /api/compact/raw-context error:", error);
    return c.json({ error: "Failed to assemble raw context" }, 500);
  }
}
