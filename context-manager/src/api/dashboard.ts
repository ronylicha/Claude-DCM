/**
 * Dashboard API - Aggregated metrics
 * @module api/dashboard
 */

import type { Context } from "hono";
import { getDb } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("API");

/**
 * GET /api/dashboard/kpis - Dashboard KPI aggregation
 * Returns aggregated metrics for dashboard visualization
 */
export async function getDashboardKpis(c: Context): Promise<Response> {
  try {
    const sql = getDb();

    const [
      actionStats24h,
      sessionStats,
      agentContextStats,
      subtaskStats,
      routingStats,
      actionsPerHour,
      topAgentTypes,
    ] = await Promise.all([
      sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE exit_code = 0) as success,
          COUNT(DISTINCT tool_name) as unique_tools,
          COUNT(DISTINCT metadata->>'session_id') as active_sessions
        FROM actions
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `,
      sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE ended_at IS NULL AND started_at > NOW() - INTERVAL '24 hours') as active,
          ROUND(COALESCE(AVG(total_tools_used), 0)::numeric, 1) as avg_tools
        FROM sessions
      `,
      sql`
        SELECT
          COUNT(*) as total,
          COUNT(DISTINCT agent_type) as unique_types
        FROM agent_contexts
      `,
      sql`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'running') as running,
          COUNT(*) FILTER (WHERE status = 'failed') as failed
        FROM subtasks
      `,
      sql`
        SELECT
          COUNT(DISTINCT keyword) as keywords,
          COUNT(DISTINCT tool_name) as tools,
          COUNT(*) as mappings
        FROM keyword_tool_scores
      `,
      sql`
        SELECT
          ROUND(COUNT(*)::numeric / GREATEST(
            EXTRACT(EPOCH FROM (NOW() - MIN(created_at))) / 3600, 1
          ), 1) as avg_per_hour
        FROM actions
        WHERE created_at > NOW() - INTERVAL '24 hours'
      `,
      sql`
        SELECT agent_type, COUNT(*) as count
        FROM agent_contexts
        GROUP BY agent_type
        ORDER BY count DESC
        LIMIT 8
      `,
    ]);

    const total24h = Number(actionStats24h[0]?.total ?? 0);
    const success24h = Number(actionStats24h[0]?.success ?? 0);

    return c.json({
      actions_24h: {
        total: total24h,
        success: success24h,
        success_rate: total24h > 0 ? Math.round((success24h / total24h) * 100) : 0,
        unique_tools: Number(actionStats24h[0]?.unique_tools ?? 0),
        active_sessions: Number(actionStats24h[0]?.active_sessions ?? 0),
        avg_per_hour: Number(actionsPerHour[0]?.avg_per_hour ?? 0),
      },
      sessions: {
        total: Number(sessionStats[0]?.total ?? 0),
        active: Number(sessionStats[0]?.active ?? 0),
        avg_tools_per_session: Number(sessionStats[0]?.avg_tools ?? 0),
      },
      agents: {
        contexts_total: Number(agentContextStats[0]?.total ?? 0),
        unique_types: Number(agentContextStats[0]?.unique_types ?? 0),
        top_types: topAgentTypes.map((r: Record<string, unknown>) => ({
          agent_type: r.agent_type as string,
          count: Number(r.count),
        })),
      },
      subtasks: {
        total: Number(subtaskStats[0]?.total ?? 0),
        completed: Number(subtaskStats[0]?.completed ?? 0),
        running: Number(subtaskStats[0]?.running ?? 0),
        failed: Number(subtaskStats[0]?.failed ?? 0),
        completion_rate: Number(subtaskStats[0]?.total ?? 0) > 0
          ? Math.round((Number(subtaskStats[0]?.completed ?? 0) / Number(subtaskStats[0]?.total ?? 0)) * 100)
          : 0,
      },
      routing: {
        keywords: Number(routingStats[0]?.keywords ?? 0),
        tools: Number(routingStats[0]?.tools ?? 0),
        mappings: Number(routingStats[0]?.mappings ?? 0),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error("GET /api/dashboard/kpis error:", error);
    return c.json(
      {
        error: "Failed to get dashboard KPIs",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}
