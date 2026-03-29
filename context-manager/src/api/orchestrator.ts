import type { Context } from "hono";
import { getDb, getActiveSessionsWithCapacity } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("Orchestrator");

// GET /api/orchestrator/topology — Full topology for 3D visualization
export async function getOrchestratorTopology(c: Context) {
  const db = getDb();
  try {
    const [sessions, messages, conflicts, heartbeat] = await Promise.all([
      getActiveSessionsWithCapacity(15),
      // Recent cross-project messages (directives)
      db`
        SELECT from_agent_id, to_agent_id, topic, payload, created_at,
          (SELECT s.id FROM sessions s
           JOIN projects p ON s.project_id = p.id
           WHERE p.name = split_part(from_agent_id, '-', 1) LIMIT 1) as from_session,
          to_agent_id as to_session
        FROM agent_messages
        WHERE topic LIKE 'directive.%' OR topic LIKE 'orchestrator.%'
        ORDER BY created_at DESC
        LIMIT 50
      `,
      // File conflicts (2+ sessions editing same file in last 15 min)
      db`
        SELECT unnest(a.file_paths) as file_path,
          COUNT(DISTINCT a.session_id) as session_count,
          array_agg(DISTINCT a.session_id) as sessions,
          MAX(a.created_at) as detected_at
        FROM actions a
        WHERE a.file_paths IS NOT NULL
          AND a.tool_name IN ('Write', 'Edit', 'MultiEdit')
          AND a.created_at > NOW() - INTERVAL '15 minutes'
          AND a.session_id IS NOT NULL
        GROUP BY unnest(a.file_paths)
        HAVING COUNT(DISTINCT a.session_id) > 1
      `,
      // Latest orchestrator heartbeat
      db`
        SELECT payload, created_at FROM agent_messages
        WHERE from_agent_id = 'orchestrator-global' AND topic = 'orchestrator.heartbeat'
        ORDER BY created_at DESC LIMIT 1
      `.then(r => r[0]),
    ]);

    // Determine orchestrator status from heartbeat
    const isActive = heartbeat &&
      (Date.now() - new Date(heartbeat.created_at).getTime()) < 120000; // 2 min

    // Build edges from messages
    const edges = messages
      .filter(m => m.topic.startsWith('directive.'))
      .map(m => ({
        from_session: m.from_session || 'orchestrator-global',
        to_session: m.to_session || 'broadcast',
        type: m.topic.includes('stop') || m.topic.includes('conflict') ? 'conflict'
            : m.topic.includes('directive') ? 'directive' : 'info',
        topic: m.topic,
        message_preview: typeof m.payload === 'object'
          ? (m.payload.message || JSON.stringify(m.payload)).slice(0, 100)
          : String(m.payload).slice(0, 100),
        created_at: m.created_at,
      }));

    return c.json({
      orchestrator: {
        status: isActive ? 'active' : 'inactive',
        last_heartbeat: heartbeat?.created_at || null,
        total_directives: messages.filter(m => m.topic.startsWith('directive.')).length,
        total_conflicts: conflicts.length,
      },
      nodes: sessions.map(s => ({
        session_id: s.session_id,
        project_name: s.project_name || 'Unknown',
        used_percentage: Number(s.used_percentage),
        zone: s.zone,
        model_id: s.model_id,
        active_agents: Number(s.active_agents),
        last_action_at: s.last_action_at,
      })),
      edges,
      conflicts: conflicts.map(c => ({
        file_path: c.file_path,
        sessions: c.sessions,
        detected_at: c.detected_at,
        resolved: false,
      })),
    });
  } catch (error) {
    log.error("GET /api/orchestrator/topology error:", error);
    return c.json({ error: "Failed to get topology" }, 500);
  }
}

// GET /api/orchestrator/status — Quick status check
export async function getOrchestratorStatus(c: Context) {
  const db = getDb();
  try {
    const [heartbeat] = await db`
      SELECT payload, created_at FROM agent_messages
      WHERE from_agent_id = 'orchestrator-global' AND topic = 'orchestrator.heartbeat'
      ORDER BY created_at DESC LIMIT 1
    `;

    const isActive = heartbeat &&
      (Date.now() - new Date(heartbeat.created_at).getTime()) < 120000;

    return c.json({
      status: isActive ? 'active' : 'inactive',
      last_heartbeat: heartbeat?.created_at || null,
      payload: heartbeat?.payload || null,
    });
  } catch (error) {
    return c.json({ status: 'unknown', error: 'Failed to check status' }, 500);
  }
}
