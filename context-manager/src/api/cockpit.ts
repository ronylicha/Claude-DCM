import type { Context } from "hono";
import { getDb, getActiveSessionsWithCapacity } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("Cockpit");

// GET /api/cockpit/global — Aggregated data for StatusBar (all sessions)
export async function getCockpitGlobal(c: Context) {
  const db = getDb();
  try {
    // Parallel queries
    const [sessions, agents, capacities, summaries] = await Promise.all([
      // Active sessions count + by model
      db`
        SELECT
          COUNT(*) as total_active,
          COUNT(*) FILTER (WHERE ac.model_id LIKE '%opus%') as opus_count,
          COUNT(*) FILTER (WHERE ac.model_id LIKE '%sonnet%') as sonnet_count,
          COUNT(*) FILTER (WHERE ac.model_id LIKE '%haiku%') as haiku_count
        FROM sessions s
        LEFT JOIN (
          SELECT DISTINCT ON (session_id) session_id, model_id
          FROM agent_capacity
          ORDER BY session_id,
            CASE WHEN source = 'statusline' THEN 0 ELSE 1 END,
            last_updated_at DESC NULLS LAST
        ) ac ON ac.session_id = s.id
        WHERE s.ended_at IS NULL
          OR EXISTS (SELECT 1 FROM actions a WHERE a.session_id = s.id AND a.created_at > NOW() - INTERVAL '15 minutes')
      `,
      // Agent summary
      db`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'running') as running,
          COUNT(*) FILTER (WHERE status = 'blocked') as blocked,
          COUNT(*) FILTER (WHERE status = 'completed') as completed
        FROM subtasks
        WHERE status IN ('running', 'blocked', 'completed', 'pending')
          AND created_at > NOW() - INTERVAL '24 hours'
      `,
      // Per-session capacity (include sessions without statusline data)
      db`
        SELECT DISTINCT ON (s.id)
          s.id as session_id,
          p.name as project_name,
          p.path as project_path,
          s.started_at,
          COALESCE(NULLIF(best_ac.model_id, ''), 'unknown') as model_id,
          COALESCE(ROUND((best_ac.current_usage::numeric / NULLIF(best_ac.max_capacity, 0) * 100), 1), 0) as used_percentage,
          COALESCE(best_ac.zone, 'green') as zone,
          best_ac.predicted_exhaustion_minutes,
          COALESCE(best_ac.consumption_rate, 0) as consumption_rate,
          COALESCE(best_ac.current_usage, 0) as current_usage,
          COALESCE(best_ac.max_capacity, 200000) as max_capacity,
          COALESCE(best_ac.source, 'estimated') as source,
          (SELECT COUNT(*) FROM subtasks st
           JOIN task_lists tl ON st.task_list_id = tl.id
           JOIN requests r ON tl.request_id = r.id
           WHERE r.session_id = s.id AND st.status = 'running') as agents_count,
          (SELECT MAX(ws.wave_number) FROM wave_states ws
           WHERE ws.session_id = s.id AND ws.status = 'running') as current_wave
        FROM sessions s
        LEFT JOIN projects p ON s.project_id = p.id
        LEFT JOIN (
          SELECT DISTINCT ON (session_id)
            session_id, model_id, current_usage, max_capacity, zone,
            predicted_exhaustion_minutes, consumption_rate, source
          FROM agent_capacity
          ORDER BY session_id,
            CASE WHEN source = 'statusline' THEN 0 ELSE 1 END,
            last_updated_at DESC NULLS LAST
        ) best_ac ON best_ac.session_id = s.id
        WHERE s.ended_at IS NULL
          OR EXISTS (SELECT 1 FROM actions a WHERE a.session_id = s.id AND a.created_at > NOW() - INTERVAL '15 minutes')
        ORDER BY s.id, s.started_at DESC
      `,
      // Summaries status
      db`
        SELECT
          COUNT(*) FILTER (WHERE status = 'generating') as generating,
          COUNT(*) FILTER (WHERE status = 'ready') as ready
        FROM preemptive_summaries
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `,
    ]);

    const s = sessions[0];
    const a = agents[0];
    const sm = summaries[0];

    // Deduplicate capacities by session_id — keep statusline over estimated
    const capMap = new Map<string, typeof capacities[0]>();
    for (const cap of capacities) {
      const existing = capMap.get(cap.session_id);
      if (!existing || (cap.source === 'statusline' && existing.source !== 'statusline')) {
        capMap.set(cap.session_id, cap);
      }
    }
    const dedupedCapacities = Array.from(capMap.values());

    return c.json({
      sessions: {
        total_active: Number(s?.total_active || 0),
        by_model: {
          opus: Number(s?.opus_count || 0),
          sonnet: Number(s?.sonnet_count || 0),
          haiku: Number(s?.haiku_count || 0),
        },
      },
      agents: {
        total: Number(a?.total || 0),
        running: Number(a?.running || 0),
        blocked: Number(a?.blocked || 0),
        completed: Number(a?.completed || 0),
      },
      tokens: {
        total_consumed: dedupedCapacities.reduce((sum, cap) => sum + Number(cap.current_usage || 0), 0),
        total_rate: dedupedCapacities.reduce((sum, cap) => sum + Number(cap.consumption_rate || 0), 0),
        by_session: dedupedCapacities.map(cap => ({
          session_id: cap.session_id,
          project_name: cap.project_name,
          model_id: cap.model_id,
          used_percentage: Number(cap.used_percentage || 0),
          zone: cap.zone,
          predicted_exhaustion_minutes: cap.predicted_exhaustion_minutes,
          agents_count: Number(cap.agents_count || 0),
          current_wave: cap.current_wave,
        })),
      },
      summaries: {
        generating: Number(sm?.generating || 0),
        ready: Number(sm?.ready || 0),
      },
    });
  } catch (error) {
    log.error("GET /api/cockpit/global error:", error);
    return c.json({ error: "Failed to get global cockpit data" }, 500);
  }
}

// GET /api/cockpit/grid — Mini-cockpit data for all active sessions
export async function getCockpitGrid(c: Context) {
  const db = getDb();
  try {
    const sessions = await getActiveSessionsWithCapacity(15);

    const sessionIds = sessions.map(s => s.session_id);

    if (sessionIds.length === 0) return c.json({ sessions: [] });

    const [waves, agentStats, lastActions, sparklines, summaries] = await Promise.all([
      // 1. Current wave per session
      db`
        SELECT DISTINCT ON (session_id) session_id, wave_number, status, total_tasks, completed_tasks
        FROM wave_states
        WHERE session_id = ANY(${sessionIds}) AND status IN ('running', 'pending')
        ORDER BY session_id, wave_number ASC
      `,
      // 2. Agent stats per session
      db`
        SELECT r.session_id,
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE st.status = 'running') as running,
          COUNT(*) FILTER (WHERE st.status = 'blocked') as blocked
        FROM subtasks st
        JOIN task_lists tl ON st.task_list_id = tl.id
        JOIN requests r ON tl.request_id = r.id
        WHERE r.session_id = ANY(${sessionIds})
          AND st.status IN ('running', 'blocked', 'pending')
        GROUP BY r.session_id
      `,
      // 3. Last action per session
      db`
        SELECT DISTINCT ON (a.session_id)
          a.session_id, a.tool_name, a.file_paths, a.created_at,
          COALESCE(st.agent_id, 'unknown') as agent_id
        FROM actions a
        LEFT JOIN subtasks st ON a.subtask_id = st.id
        WHERE a.session_id = ANY(${sessionIds})
        ORDER BY a.session_id, a.created_at DESC
      `,
      // 4. Sparkline data (all sessions at once)
      db`
        SELECT a.session_id,
          date_trunc('minute', a.created_at) -
          (EXTRACT(minute FROM a.created_at)::int % 5) * INTERVAL '1 minute' as bucket,
          COUNT(*) as count
        FROM actions a
        WHERE a.session_id = ANY(${sessionIds})
          AND a.created_at > NOW() - INTERVAL '1 hour'
        GROUP BY a.session_id, bucket
        ORDER BY a.session_id, bucket
      `,
      // 5. Latest preemptive summary per session
      db`
        SELECT DISTINCT ON (session_id) session_id, status
        FROM preemptive_summaries
        WHERE session_id = ANY(${sessionIds})
        ORDER BY session_id, created_at DESC
      `,
    ]);

    const waveMap = new Map(waves.map(w => [w.session_id, w]));
    const agentMap = new Map(agentStats.map(a => [a.session_id, a]));
    const actionMap = new Map(lastActions.map(a => [a.session_id, a]));
    const summaryMap = new Map(summaries.map(s => [s.session_id, s]));

    const now = Date.now();
    const sparklineMap = new Map<string, number[]>();
    for (const sess of sessions) {
      const points = new Array(12).fill(0);
      const rows = sparklines.filter(r => r.session_id === sess.session_id);
      rows.forEach(r => {
        const idx = Math.floor((now - new Date(r.bucket).getTime()) / 300000);
        if (idx >= 0 && idx < 12) points[11 - idx] = Number(r.count);
      });
      sparklineMap.set(sess.session_id, points);
    }

    const result = sessions.map(sess => {
      const wave = waveMap.get(sess.session_id);
      const stats = agentMap.get(sess.session_id);
      const lastAction = actionMap.get(sess.session_id);
      const sparkline = sparklineMap.get(sess.session_id) || new Array(12).fill(0);
      const summary = summaryMap.get(sess.session_id)?.status || 'none';

      return {
        session_id: sess.session_id,
        project_name: sess.project_name,
        project_path: sess.project_path,
        model_id: sess.model_id,
        started_at: sess.started_at,
        context: {
          used_percentage: Number(sess.used_percentage || 0),
          current_usage: Number(sess.current_usage || 0),
          context_window_size: Number(sess.max_capacity || 200000),
          zone: sess.zone || 'green',
          consumption_rate: Number(sess.consumption_rate || 0),
          predicted_exhaustion_minutes: sess.predicted_exhaustion_minutes,
          source: sess.source || 'estimated',
          model_id: sess.model_id || 'unknown',
        },
        wave: wave ? {
          current_number: wave.wave_number,
          completed: Number(wave.completed_tasks || 0),
          total: Number(wave.total_tasks || 0),
          status: wave.status,
        } : null,
        agents: {
          total: Number(stats?.total || 0),
          running: Number(stats?.running || 0),
          blocked: Number(stats?.blocked || 0),
          last_action: lastAction ? {
            agent_id: lastAction.agent_id,
            tool_name: lastAction.tool_name,
            file_path: lastAction.file_paths?.[0],
            timestamp: lastAction.created_at,
          } : null,
        },
        sparkline,
        preemptive_summary: { status: summary },
      };
    });

    return c.json({ sessions: result });
  } catch (error) {
    log.error("GET /api/cockpit/grid error:", error);
    return c.json({ error: "Failed to get cockpit grid" }, 500);
  }
}

// GET /api/cockpit/:session_id — Full cockpit data for one session (zoom view)
export async function getCockpitSession(c: Context) {
  const session_id = c.req.param("session_id");
  const db = getDb();
  try {
    const [capacity, waves, agents, summaryStatus] = await Promise.all([
      db`SELECT current_usage, max_capacity, zone, consumption_rate, predicted_exhaustion_minutes, model_id, source FROM agent_capacity WHERE session_id = ${session_id} ORDER BY current_usage DESC LIMIT 1`.then(r => r[0]),
      db`SELECT wave_number, status, total_tasks, completed_tasks, failed_tasks, started_at, completed_at FROM wave_states WHERE session_id = ${session_id} ORDER BY wave_number ASC`,
      db`
        SELECT st.*, r.session_id
        FROM subtasks st
        JOIN task_lists tl ON st.task_list_id = tl.id
        JOIN requests r ON tl.request_id = r.id
        WHERE r.session_id = ${session_id}
        ORDER BY st.created_at DESC
      `,
      db`
        SELECT status, created_at FROM preemptive_summaries
        WHERE session_id = ${session_id}
        ORDER BY created_at DESC LIMIT 1
      `.then(r => r[0]),
    ]);

    // Default capacity if no data yet
    const cap = capacity || { current_usage: 0, max_capacity: 200000, zone: 'green', consumption_rate: 0, predicted_exhaustion_minutes: null, model_id: 'unknown', source: 'estimated' };

    const usedPct = cap.max_capacity > 0
      ? (cap.current_usage / cap.max_capacity * 100)
      : 0;

    return c.json({
      context: {
        current_usage: cap.current_usage,
        context_window_size: cap.max_capacity,
        used_percentage: Math.round(usedPct * 10) / 10,
        zone: cap.zone,
        consumption_rate: cap.consumption_rate,
        predicted_exhaustion_minutes: cap.predicted_exhaustion_minutes,
        model_id: cap.model_id,
        source: cap.source,
        preemptive_summary: summaryStatus ? {
          status: summaryStatus.status,
          created_at: summaryStatus.created_at,
        } : { status: 'none' },
      },
      waves: {
        current: waves.find(w => w.status === 'running') || null,
        pipeline: waves.map(w => ({
          wave_number: w.wave_number,
          status: w.status,
          total_tasks: w.total_tasks,
          completed_tasks: w.completed_tasks,
          failed_tasks: w.failed_tasks,
          started_at: w.started_at,
          completed_at: w.completed_at,
        })),
      },
      agents: {
        total: agents.length,
        running: agents.filter(a => a.status === 'running').length,
        blocked: agents.filter(a => a.status === 'blocked').length,
        completed: agents.filter(a => a.status === 'completed').length,
        failed: agents.filter(a => a.status === 'failed').length,
        list: agents.map(a => ({
          id: a.id,
          agent_type: a.agent_type,
          agent_id: a.agent_id,
          parent_agent_id: a.parent_agent_id,
          status: a.status,
          description: a.description,
          started_at: a.started_at,
        })),
      },
    });
  } catch (error) {
    log.error("GET /api/cockpit/:session_id error:", error);
    return c.json({ error: "Failed to get session cockpit data" }, 500);
  }
}
