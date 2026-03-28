/**
 * DCM Global Orchestrator — Inter-project coordination
 *
 * Runs as a background loop inside the DCM server process.
 * Deterministic logic (no LLM needed): detects conflicts, broadcasts
 * architecture decisions, forces compaction, sends directives.
 *
 * Lifecycle: starts when server boots, stops when server stops.
 * Cycle: every 30 seconds.
 */

import { getDb, publishEvent } from "./db/client";
import { createLogger } from "./lib/logger";

const log = createLogger("Orchestrator");

const CYCLE_INTERVAL_MS = 30_000; // 30 seconds
const INACTIVITY_THRESHOLD_MIN = 15;
const COMPACTION_THRESHOLD_PCT = 85;

// Architecture-sensitive file patterns
const ARCH_FILE_PATTERNS = [
  'schema.sql', 'migrations/', 'server.ts', 'package.json',
  'docker-compose', 'CLAUDE.md', '.types.ts', 'api-client.ts',
];

let intervalId: ReturnType<typeof setInterval> | null = null;
let cycleCount = 0;
let idleCycles = 0;
let totalDirectives = 0;
let totalConflicts = 0;
let startedAt: Date | null = null;

/**
 * Main orchestration cycle — runs every 30s
 */
async function orchestratorCycle() {
  const db = getDb();
  cycleCount++;

  try {
    // 1. Get active sessions
    const sessions = await db`
      SELECT s.id as session_id, p.name as project_name, p.path as project_path,
        COALESCE(ac.model_id, 'unknown') as model_id,
        COALESCE(ROUND((ac.current_usage::numeric / NULLIF(ac.max_capacity, 0) * 100), 1), 0) as used_percentage,
        COALESCE(ac.zone, 'green') as zone,
        COALESCE(ac.max_capacity, 200000) as max_capacity,
        COALESCE(ac.current_usage, 0) as current_usage
      FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      LEFT JOIN agent_capacity ac ON ac.session_id = s.id
      WHERE s.ended_at IS NULL
        OR EXISTS (SELECT 1 FROM actions a WHERE a.session_id = s.id AND a.created_at > NOW() - INTERVAL '1 minute' * ${INACTIVITY_THRESHOLD_MIN})
    `;

    if (sessions.length === 0) {
      idleCycles++;
      return;
    }
    idleCycles = 0;

    // 2. Detect file conflicts (2+ sessions editing same file)
    const conflicts = await db`
      SELECT unnest(a.file_paths) as file_path,
        COUNT(DISTINCT a.session_id) as session_count,
        array_agg(DISTINCT a.session_id) as sessions
      FROM actions a
      WHERE a.file_paths IS NOT NULL
        AND a.tool_name IN ('Write', 'Edit', 'MultiEdit')
        AND a.created_at > NOW() - INTERVAL '15 minutes'
        AND a.session_id IS NOT NULL
      GROUP BY unnest(a.file_paths)
      HAVING COUNT(DISTINCT a.session_id) > 1
    `;

    // 3. Handle conflicts — send directives
    for (const conflict of conflicts) {
      totalConflicts++;
      const sessionNames = [];
      for (const sid of conflict.sessions) {
        const s = sessions.find(s => s.session_id === sid);
        sessionNames.push(s?.project_name || sid.slice(0, 8));
      }

      await db`
        INSERT INTO agent_messages (from_agent_id, to_agent_id, message_type, topic, payload, priority, expires_at)
        VALUES (
          'orchestrator-global', NULL, 'notification', 'directive.conflict',
          ${db.json({
            action: 'conflict',
            message: `Conflit fichier: ${conflict.file_path} modifie par ${sessionNames.join(' et ')}`,
            file: conflict.file_path,
            sessions: conflict.sessions,
          })},
          9, NOW() + INTERVAL '5 minutes'
        )
      `;
      totalDirectives++;
      log.info(`CONFLICT: ${conflict.file_path} edited by ${sessionNames.join(', ')}`);
    }

    // 4. Detect architecture changes (sensitive files modified recently)
    const archChanges = await db`
      SELECT DISTINCT a.session_id, unnest(a.file_paths) as file_path, a.tool_name
      FROM actions a
      WHERE a.file_paths IS NOT NULL
        AND a.tool_name IN ('Write', 'Edit', 'MultiEdit')
        AND a.created_at > NOW() - INTERVAL '2 minutes'
        AND a.session_id IS NOT NULL
    `;

    for (const change of archChanges) {
      const isArchFile = ARCH_FILE_PATTERNS.some(p => change.file_path.includes(p));
      if (!isArchFile) continue;

      const sourceSession = sessions.find(s => s.session_id === change.session_id);
      const sourceName = sourceSession?.project_name || change.session_id.slice(0, 8);

      // Only broadcast once per file per cycle (check recent messages)
      const [existing] = await db`
        SELECT id FROM agent_messages
        WHERE from_agent_id = 'orchestrator-global'
          AND topic = 'directive.architecture'
          AND payload->>'file' = ${change.file_path}
          AND created_at > NOW() - INTERVAL '5 minutes'
        LIMIT 1
      `;
      if (existing) continue;

      await db`
        INSERT INTO agent_messages (from_agent_id, to_agent_id, message_type, topic, payload, priority, expires_at)
        VALUES (
          'orchestrator-global', NULL, 'notification', 'directive.architecture',
          ${db.json({
            action: 'architecture',
            message: `${sourceName} a modifie ${change.file_path}`,
            file: change.file_path,
            source_session: change.session_id,
          })},
          7, NOW() + INTERVAL '10 minutes'
        )
      `;
      totalDirectives++;
      log.info(`ARCH: ${sourceName} modified ${change.file_path}`);
    }

    // 5. Check for sessions approaching compaction threshold
    for (const session of sessions) {
      const pct = Number(session.used_percentage);
      if (pct < COMPACTION_THRESHOLD_PCT) continue;

      // Check if preemptive summary already generating
      const [existing] = await db`
        SELECT id FROM preemptive_summaries
        WHERE session_id = ${session.session_id}
          AND (status = 'generating' OR (status = 'ready' AND created_at > NOW() - INTERVAL '10 minutes'))
        LIMIT 1
      `;
      if (existing) continue;

      // Send compaction directive
      await db`
        INSERT INTO agent_messages (from_agent_id, to_agent_id, message_type, topic, payload, priority, expires_at)
        VALUES (
          'orchestrator-global', ${session.session_id}, 'notification', 'directive.compact',
          ${db.json({
            action: 'compact',
            message: `Session ${session.project_name} a ${pct}% de contexte — compaction recommandee`,
            used_percentage: pct,
          })},
          8, NOW() + INTERVAL '5 minutes'
        )
      `;
      totalDirectives++;
      log.info(`COMPACT: ${session.project_name} at ${pct}%`);
    }

    // 6. Proactive info sharing — broadcast recent activity summary every 5 cycles (~2.5min)
    if (cycleCount % 5 === 0 && sessions.length > 1) {
      // Gather recent actions per session
      const recentActivity = await db`
        SELECT a.session_id,
          COUNT(*) as action_count,
          COUNT(DISTINCT unnest) as files_touched,
          array_agg(DISTINCT a.tool_name ORDER BY a.tool_name) FILTER (WHERE a.tool_name NOT IN ('Read','Glob','Grep')) as write_tools
        FROM actions a, unnest(COALESCE(a.file_paths, ARRAY[]::text[]))
        WHERE a.session_id IS NOT NULL
          AND a.created_at > NOW() - INTERVAL '3 minutes'
        GROUP BY a.session_id
      `;

      for (const activity of recentActivity) {
        const session = sessions.find(s => s.session_id === activity.session_id);
        if (!session) continue;

        const otherSessions = sessions.filter(s => s.session_id !== activity.session_id);
        if (otherSessions.length === 0) continue;

        // Only broadcast if meaningful activity (writes, not just reads)
        const writeTools = activity.write_tools || [];
        if (writeTools.length === 0) continue;

        // Send to each other session
        for (const target of otherSessions) {
          await db`
            INSERT INTO agent_messages (from_agent_id, to_agent_id, message_type, topic, payload, priority, expires_at)
            VALUES (
              'orchestrator-global', ${target.session_id}, 'notification', 'directive.info',
              ${db.json({
                action: 'info',
                message: `${session.project_name}: ${activity.action_count} actions, ${activity.files_touched} fichiers (${writeTools.join(', ')})`,
                source_session: activity.session_id,
                source_project: session.project_name,
              })},
              3, NOW() + INTERVAL '5 minutes'
            )
          `;
          totalDirectives++;
        }
      }

      if (recentActivity.length > 0) {
        log.info(`INFO: Broadcast activity from ${recentActivity.length} sessions`);
      }
    }

    // 7. Share new architecture artifacts every 10 cycles (~5min)
    if (cycleCount % 10 === 0 && sessions.length > 1) {
      // Find recently created/modified key files
      const keyFiles = await db`
        SELECT DISTINCT a.session_id, unnest(a.file_paths) as file_path
        FROM actions a
        WHERE a.file_paths IS NOT NULL
          AND a.tool_name IN ('Write', 'Edit', 'MultiEdit')
          AND a.created_at > NOW() - INTERVAL '5 minutes'
          AND a.session_id IS NOT NULL
          AND (
            unnest(a.file_paths) LIKE '%schema%'
            OR unnest(a.file_paths) LIKE '%migration%'
            OR unnest(a.file_paths) LIKE '%types.ts'
            OR unnest(a.file_paths) LIKE '%api-client%'
            OR unnest(a.file_paths) LIKE '%server.ts'
            OR unnest(a.file_paths) LIKE '%package.json'
            OR unnest(a.file_paths) LIKE '%docker%'
            OR unnest(a.file_paths) LIKE '%CLAUDE.md'
          )
      `;

      for (const file of keyFiles) {
        const session = sessions.find(s => s.session_id === file.session_id);
        if (!session) continue;

        // Check not already broadcast
        const [existing] = await db`
          SELECT id FROM agent_messages
          WHERE from_agent_id = 'orchestrator-global'
            AND topic = 'directive.architecture'
            AND payload->>'file' = ${file.file_path}
            AND created_at > NOW() - INTERVAL '10 minutes'
          LIMIT 1
        `;
        if (existing) continue;

        await db`
          INSERT INTO agent_messages (from_agent_id, to_agent_id, message_type, topic, payload, priority, expires_at)
          VALUES (
            'orchestrator-global', NULL, 'notification', 'directive.architecture',
            ${db.json({
              action: 'architecture',
              message: `${session.project_name} a modifie ${file.file_path.split('/').pop()}`,
              file: file.file_path,
              source_session: file.session_id,
              source_project: session.project_name,
            })},
            7, NOW() + INTERVAL '10 minutes'
          )
        `;
        totalDirectives++;
        log.info(`ARCH: ${session.project_name} modified ${file.file_path.split('/').pop()}`);
      }
    }

    // 8. Publish heartbeat
    await db`
      INSERT INTO agent_messages (from_agent_id, to_agent_id, message_type, topic, payload, priority, expires_at)
      VALUES (
        'orchestrator-global', NULL, 'notification', 'orchestrator.heartbeat',
        ${db.json({
          timestamp: new Date().toISOString(),
          active_sessions: sessions.length,
          directives_sent: totalDirectives,
          conflicts_detected: totalConflicts,
          cycle: cycleCount,
          uptime_seconds: startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 1000) : 0,
        })},
        0, NOW() + INTERVAL '1 minute'
      )
    `;

    // Broadcast via WebSocket
    publishEvent("global", "orchestrator.heartbeat", {
      status: "active",
      active_sessions: sessions.length,
      directives_sent: totalDirectives,
      conflicts_detected: totalConflicts,
    });

  } catch (error) {
    log.error("Orchestrator cycle error:", error);
  }
}

/**
 * Start the orchestrator background loop
 */
export function startOrchestrator() {
  if (intervalId) {
    log.info("Orchestrator already running");
    return;
  }

  startedAt = new Date();
  cycleCount = 0;
  idleCycles = 0;
  totalDirectives = 0;
  totalConflicts = 0;

  log.info("Orchestrator started — cycle every 30s");

  // Run first cycle immediately
  orchestratorCycle();

  // Then every 30s
  intervalId = setInterval(orchestratorCycle, CYCLE_INTERVAL_MS);
}

/**
 * Stop the orchestrator
 */
export function stopOrchestrator() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    startedAt = null;
    log.info("Orchestrator stopped");
  }
}

/**
 * Get orchestrator runtime stats
 */
export function getOrchestratorStats() {
  return {
    running: intervalId !== null,
    started_at: startedAt?.toISOString() || null,
    cycle_count: cycleCount,
    idle_cycles: idleCycles,
    total_directives: totalDirectives,
    total_conflicts: totalConflicts,
    uptime_seconds: startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 1000) : 0,
  };
}
