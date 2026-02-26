/**
 * Agent Contexts API - Context KPIs and management
 * @module api/agent-contexts
 */

import type { Context } from "hono";
import { getDb } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("API");

/**
 * GET /api/agent-contexts - List all agent contexts with stats
 */
export async function getAgentContexts(c: Context): Promise<Response> {
  try {
    const sql = getDb();
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") ?? "100", 10) || 100, 1), 1000);
    const offset = Math.max(parseInt(c.req.query("offset") ?? "0", 10) || 0, 0);
    const agentType = c.req.query("agent_type");
    const status = c.req.query("status");

    const contexts = agentType && status
      ? await sql`
          SELECT * FROM agent_contexts
          WHERE agent_type = ${agentType}
            AND role_context->>'status' = ${status}
          ORDER BY last_updated DESC
          LIMIT ${limit} OFFSET ${offset}`
      : agentType
      ? await sql`
          SELECT * FROM agent_contexts
          WHERE agent_type = ${agentType}
          ORDER BY last_updated DESC
          LIMIT ${limit} OFFSET ${offset}`
      : status
      ? await sql`
          SELECT * FROM agent_contexts
          WHERE role_context->>'status' = ${status}
          ORDER BY last_updated DESC
          LIMIT ${limit} OFFSET ${offset}`
      : await sql`
          SELECT * FROM agent_contexts
          ORDER BY last_updated DESC
          LIMIT ${limit} OFFSET ${offset}`;

    const [{ total }] = await sql`SELECT COUNT(*) as total FROM agent_contexts`;

    // Stats
    const stats = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT agent_type) as unique_types,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'running') as running,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'completed') as completed,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'failed') as failed
      FROM agent_contexts`;

    const typeDistribution = await sql`
      SELECT agent_type, COUNT(*) as count,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'running') as running,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'completed') as completed
      FROM agent_contexts
      GROUP BY agent_type
      ORDER BY count DESC
      LIMIT 20`;

    return c.json({
      contexts,
      total: Number(total),
      limit,
      offset,
      stats: {
        total: Number(stats[0].total),
        unique_types: Number(stats[0].unique_types),
        running: Number(stats[0].running),
        completed: Number(stats[0].completed),
        failed: Number(stats[0].failed),
      },
      type_distribution: typeDistribution.map(t => ({
        agent_type: t.agent_type,
        count: Number(t.count),
        running: Number(t.running),
        completed: Number(t.completed),
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error("GET /api/agent-contexts error:", error);
    return c.json({ error: "Failed to get agent contexts" }, 500);
  }
}

/**
 * GET /api/agent-contexts/stats - Context KPIs
 */
export async function getAgentContextsStats(c: Context): Promise<Response> {
  try {
    const sql = getDb();

    const [overview] = await sql`
      SELECT
        COUNT(*) as total_contexts,
        COUNT(DISTINCT agent_type) as unique_agent_types,
        COUNT(DISTINCT project_id) as unique_projects,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'running') as active_agents,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'completed') as completed_agents,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'failed') as failed_agents,
        MIN(last_updated) as oldest_context,
        MAX(last_updated) as newest_context
      FROM agent_contexts`;

    const topTypes = await sql`
      SELECT agent_type, COUNT(*) as count,
        COUNT(*) FILTER (WHERE role_context->>'status' = 'running') as running
      FROM agent_contexts
      GROUP BY agent_type
      ORDER BY count DESC
      LIMIT 15`;

    const recentActivity = await sql`
      SELECT id, agent_id, agent_type, progress_summary,
        role_context->>'status' as status,
        role_context->>'spawned_at' as spawned_at,
        last_updated
      FROM agent_contexts
      ORDER BY last_updated DESC
      LIMIT 10`;

    const toolsUsed = await sql`
      SELECT unnest(tools_used) as tool, COUNT(*) as usage_count
      FROM agent_contexts
      WHERE tools_used IS NOT NULL AND array_length(tools_used, 1) > 0
      GROUP BY tool
      ORDER BY usage_count DESC
      LIMIT 20`;

    return c.json({
      overview: {
        total_contexts: Number(overview.total_contexts),
        unique_agent_types: Number(overview.unique_agent_types),
        unique_projects: Number(overview.unique_projects),
        active_agents: Number(overview.active_agents),
        completed_agents: Number(overview.completed_agents),
        failed_agents: Number(overview.failed_agents),
        oldest_context: overview.oldest_context,
        newest_context: overview.newest_context,
      },
      top_types: topTypes.map(t => ({
        agent_type: t.agent_type,
        count: Number(t.count),
        running: Number(t.running),
      })),
      recent_activity: recentActivity,
      tools_used: toolsUsed.map(t => ({
        tool: t.tool,
        usage_count: Number(t.usage_count),
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error("GET /api/agent-contexts/stats error:", error);
    return c.json({ error: "Failed to get context stats" }, 500);
  }
}
