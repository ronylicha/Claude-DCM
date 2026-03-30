/**
 * Stats API - Aggregated analytics for the statistics page
 * @module api/stats
 */

import type { Context } from "hono";
import { getDb } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("API");

type Period = "day" | "week" | "month" | "year" | "all";
type Granularity = "hour" | "day" | "week" | "month";

function getStartDate(period: Period): Date | null {
  const now = new Date();
  switch (period) {
    case "day":
      return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    case "week":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "month":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "year":
      return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
    case "all":
      return null;
  }
}

function getPrevStartDate(period: Period): Date | null {
  const now = new Date();
  switch (period) {
    case "day":
      return new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    case "week":
      return new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    case "month":
      return new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    case "year":
      return new Date(now.getTime() - 2 * 365 * 24 * 60 * 60 * 1000);
    case "all":
      return null;
  }
}

/**
 * GET /api/stats/overview - Global KPI aggregation with period comparison
 */
export async function getStatsOverview(c: Context): Promise<Response> {
  try {
    const sql = getDb();
    const period = (c.req.query("period") ?? "month") as Period;
    const startDate = getStartDate(period);
    const prevStartDate = getPrevStartDate(period);

    const [
      tokenTotals,
      tokensByDay,
      sessionStats,
      actionStats,
      agentStats,
      prevTokenTotals,
      prevSessionStats,
      prevActionStats,
    ] = await Promise.all([
      startDate
        ? sql`
          SELECT
            COALESCE(SUM(input_tokens), 0) as input,
            COALESCE(SUM(output_tokens), 0) as output,
            COALESCE(SUM(total_tokens), 0) as total
          FROM token_consumption
          WHERE consumed_at >= ${startDate}
        `
        : sql`
          SELECT
            COALESCE(SUM(input_tokens), 0) as input,
            COALESCE(SUM(output_tokens), 0) as output,
            COALESCE(SUM(total_tokens), 0) as total
          FROM token_consumption
        `,

      startDate
        ? sql`
          SELECT
            date_trunc('day', consumed_at) as date,
            SUM(input_tokens) as input,
            SUM(output_tokens) as output,
            SUM(total_tokens) as total
          FROM token_consumption
          WHERE consumed_at >= ${startDate}
          GROUP BY date_trunc('day', consumed_at)
          ORDER BY date ASC
        `
        : sql`
          SELECT
            date_trunc('day', consumed_at) as date,
            SUM(input_tokens) as input,
            SUM(output_tokens) as output,
            SUM(total_tokens) as total
          FROM token_consumption
          GROUP BY date_trunc('day', consumed_at)
          ORDER BY date ASC
        `,

      startDate
        ? sql`
          SELECT
            COUNT(*) as total,
            ROUND(AVG(EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)::numeric, 0) as avg_duration_ms,
            ROUND(COALESCE(AVG(total_tools_used), 0)::numeric, 1) as avg_tools_used
          FROM sessions
          WHERE started_at >= ${startDate}
        `
        : sql`
          SELECT
            COUNT(*) as total,
            ROUND(AVG(EXTRACT(EPOCH FROM (ended_at - started_at)) * 1000)::numeric, 0) as avg_duration_ms,
            ROUND(COALESCE(AVG(total_tools_used), 0)::numeric, 1) as avg_tools_used
          FROM sessions
        `,

      startDate
        ? sql`
          SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE exit_code = 0) as success,
            ROUND(AVG(duration_ms)::numeric, 0) as avg_duration_ms,
            COUNT(DISTINCT tool_name) as unique_tools
          FROM actions
          WHERE created_at >= ${startDate}
        `
        : sql`
          SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE exit_code = 0) as success,
            ROUND(AVG(duration_ms)::numeric, 0) as avg_duration_ms,
            COUNT(DISTINCT tool_name) as unique_tools
          FROM actions
        `,

      startDate
        ? sql`
          WITH session_agent_counts AS (
            SELECT session_id, COUNT(DISTINCT agent_id) as agent_count
            FROM subtasks
            WHERE created_at >= ${startDate}
            GROUP BY session_id
          )
          SELECT
            COUNT(DISTINCT agent_id) as total_used,
            (
              SELECT agent_type FROM subtasks
              WHERE created_at >= ${startDate}
              GROUP BY agent_type
              ORDER BY COUNT(*) DESC
              LIMIT 1
            ) as top_agent,
            ROUND(COALESCE(AVG(s.total_tools_used), 0)::numeric, 1) as avg_subtasks_per_session
          FROM subtasks st
          JOIN sessions s ON s.id = st.session_id
          WHERE st.created_at >= ${startDate}
        `
        : sql`
          WITH session_agent_counts AS (
            SELECT session_id, COUNT(DISTINCT agent_id) as agent_count
            FROM subtasks
            GROUP BY session_id
          )
          SELECT
            COUNT(DISTINCT agent_id) as total_used,
            (
              SELECT agent_type FROM subtasks
              GROUP BY agent_type
              ORDER BY COUNT(*) DESC
              LIMIT 1
            ) as top_agent,
            ROUND(COALESCE(AVG(s.total_tools_used), 0)::numeric, 1) as avg_subtasks_per_session
          FROM subtasks st
          JOIN sessions s ON s.id = st.session_id
        `,

      prevStartDate && startDate
        ? sql`
          SELECT COALESCE(SUM(total_tokens), 0) as total
          FROM token_consumption
          WHERE consumed_at >= ${prevStartDate} AND consumed_at < ${startDate}
        `
        : sql`SELECT 0 as total`,

      prevStartDate && startDate
        ? sql`
          SELECT COUNT(*) as total
          FROM sessions
          WHERE started_at >= ${prevStartDate} AND started_at < ${startDate}
        `
        : sql`SELECT 0 as total`,

      prevStartDate && startDate
        ? sql`
          SELECT COUNT(*) as total
          FROM actions
          WHERE created_at >= ${prevStartDate} AND created_at < ${startDate}
        `
        : sql`SELECT 0 as total`,
    ]);

    const totalActions = Number(actionStats[0]?.total ?? 0);
    const successActions = Number(actionStats[0]?.success ?? 0);
    const currentTokens = Number(tokenTotals[0]?.total ?? 0);
    const prevTokens = Number(prevTokenTotals[0]?.total ?? 0);
    const currentSessions = Number(sessionStats[0]?.total ?? 0);
    const prevSessions = Number(prevSessionStats[0]?.total ?? 0);
    const currentActionsTotal = Number(actionStats[0]?.total ?? 0);
    const prevActionsTotal = Number(prevActionStats[0]?.total ?? 0);

    return c.json({
      period,
      tokens: {
        total: currentTokens,
        input: Number(tokenTotals[0]?.input ?? 0),
        output: Number(tokenTotals[0]?.output ?? 0),
        byDay: tokensByDay.map((r: Record<string, unknown>) => ({
          date: r.date instanceof Date ? r.date.toISOString() : r.date,
          input: Number(r.input),
          output: Number(r.output),
          total: Number(r.total),
        })),
      },
      sessions: {
        total: currentSessions,
        avgDuration: Number(sessionStats[0]?.avg_duration_ms ?? 0),
        avgToolsUsed: Number(sessionStats[0]?.avg_tools_used ?? 0),
      },
      actions: {
        total: totalActions,
        successRate: totalActions > 0 ? Math.round((successActions / totalActions) * 100) : 0,
        avgDuration: Number(actionStats[0]?.avg_duration_ms ?? 0),
        uniqueTools: Number(actionStats[0]?.unique_tools ?? 0),
      },
      agents: {
        totalUsed: Number(agentStats[0]?.total_used ?? 0),
        topAgent: agentStats[0]?.top_agent ?? null,
        avgSubtasksPerSession: Number(agentStats[0]?.avg_subtasks_per_session ?? 0),
      },
      comparison: {
        tokensDelta: prevTokens > 0 ? Math.round(((currentTokens - prevTokens) / prevTokens) * 100) : 0,
        sessionsDelta: prevSessions > 0 ? Math.round(((currentSessions - prevSessions) / prevSessions) * 100) : 0,
        actionsDelta: prevActionsTotal > 0 ? Math.round(((currentActionsTotal - prevActionsTotal) / prevActionsTotal) * 100) : 0,
      },
    });
  } catch (error) {
    log.error("GET /api/stats/overview error:", error);
    return c.json(
      {
        error: "Failed to get stats overview",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/stats/tokens - Detailed token consumption with variable granularity
 */
export async function getStatsTokens(c: Context): Promise<Response> {
  try {
    const sql = getDb();
    const period = (c.req.query("period") ?? "month") as Period;
    const granularity = (c.req.query("granularity") ?? "day") as Granularity;
    const startDate = getStartDate(period);

    const truncExpr = granularity === "hour"
      ? "hour"
      : granularity === "week"
        ? "week"
        : granularity === "month"
          ? "month"
          : "day";

    const [timeSeries, byAgent, byTool, byModel, totals] = await Promise.all([
      startDate
        ? sql`
          SELECT
            date_trunc(${truncExpr}, consumed_at) as date,
            SUM(input_tokens) as input_tokens,
            SUM(output_tokens) as output_tokens,
            SUM(total_tokens) as total_tokens
          FROM token_consumption
          WHERE consumed_at >= ${startDate}
          GROUP BY date_trunc(${truncExpr}, consumed_at)
          ORDER BY date ASC
        `
        : sql`
          SELECT
            date_trunc(${truncExpr}, consumed_at) as date,
            SUM(input_tokens) as input_tokens,
            SUM(output_tokens) as output_tokens,
            SUM(total_tokens) as total_tokens
          FROM token_consumption
          GROUP BY date_trunc(${truncExpr}, consumed_at)
          ORDER BY date ASC
        `,

      startDate
        ? sql`
          WITH totals AS (
            SELECT COALESCE(SUM(total_tokens), 0) as grand_total
            FROM token_consumption
            WHERE consumed_at >= ${startDate}
          )
          SELECT
            ac.agent_type,
            COALESCE(SUM(tc.total_tokens), 0) as total_tokens,
            CASE WHEN t.grand_total > 0
              THEN ROUND((COALESCE(SUM(tc.total_tokens), 0)::numeric / t.grand_total) * 100, 1)
              ELSE 0
            END as percentage
          FROM token_consumption tc
          JOIN agent_capacity ac ON ac.agent_id = tc.agent_id AND ac.session_id = tc.session_id
          CROSS JOIN totals t
          WHERE tc.consumed_at >= ${startDate}
          GROUP BY ac.agent_type, t.grand_total
          ORDER BY total_tokens DESC
          LIMIT 20
        `
        : sql`
          WITH totals AS (
            SELECT COALESCE(SUM(total_tokens), 0) as grand_total
            FROM token_consumption
          )
          SELECT
            ac.agent_type,
            COALESCE(SUM(tc.total_tokens), 0) as total_tokens,
            CASE WHEN t.grand_total > 0
              THEN ROUND((COALESCE(SUM(tc.total_tokens), 0)::numeric / t.grand_total) * 100, 1)
              ELSE 0
            END as percentage
          FROM token_consumption tc
          JOIN agent_capacity ac ON ac.agent_id = tc.agent_id AND ac.session_id = tc.session_id
          CROSS JOIN totals t
          GROUP BY ac.agent_type, t.grand_total
          ORDER BY total_tokens DESC
          LIMIT 20
        `,

      startDate
        ? sql`
          WITH totals AS (
            SELECT COALESCE(SUM(total_tokens), 0) as grand_total
            FROM token_consumption
            WHERE consumed_at >= ${startDate}
          )
          SELECT
            tc.tool_name,
            COALESCE(SUM(tc.total_tokens), 0) as total_tokens,
            CASE WHEN t.grand_total > 0
              THEN ROUND((COALESCE(SUM(tc.total_tokens), 0)::numeric / t.grand_total) * 100, 1)
              ELSE 0
            END as percentage
          FROM token_consumption tc
          CROSS JOIN totals t
          WHERE tc.consumed_at >= ${startDate}
            AND tc.tool_name IS NOT NULL
          GROUP BY tc.tool_name, t.grand_total
          ORDER BY total_tokens DESC
          LIMIT 20
        `
        : sql`
          WITH totals AS (
            SELECT COALESCE(SUM(total_tokens), 0) as grand_total
            FROM token_consumption
          )
          SELECT
            tc.tool_name,
            COALESCE(SUM(tc.total_tokens), 0) as total_tokens,
            CASE WHEN t.grand_total > 0
              THEN ROUND((COALESCE(SUM(tc.total_tokens), 0)::numeric / t.grand_total) * 100, 1)
              ELSE 0
            END as percentage
          FROM token_consumption tc
          CROSS JOIN totals t
          WHERE tc.tool_name IS NOT NULL
          GROUP BY tc.tool_name, t.grand_total
          ORDER BY total_tokens DESC
          LIMIT 20
        `,

      startDate
        ? sql`
          WITH totals AS (
            SELECT COALESCE(SUM(total_tokens), 0) as grand_total
            FROM token_consumption
            WHERE consumed_at >= ${startDate}
          )
          SELECT
            ac.model_id,
            COALESCE(SUM(tc.total_tokens), 0) as total_tokens,
            CASE WHEN t.grand_total > 0
              THEN ROUND((COALESCE(SUM(tc.total_tokens), 0)::numeric / t.grand_total) * 100, 1)
              ELSE 0
            END as percentage
          FROM token_consumption tc
          JOIN agent_capacity ac ON ac.agent_id = tc.agent_id AND ac.session_id = tc.session_id
          CROSS JOIN totals t
          WHERE tc.consumed_at >= ${startDate}
            AND ac.model_id IS NOT NULL
          GROUP BY ac.model_id, t.grand_total
          ORDER BY total_tokens DESC
        `
        : sql`
          WITH totals AS (
            SELECT COALESCE(SUM(total_tokens), 0) as grand_total
            FROM token_consumption
          )
          SELECT
            ac.model_id,
            COALESCE(SUM(tc.total_tokens), 0) as total_tokens,
            CASE WHEN t.grand_total > 0
              THEN ROUND((COALESCE(SUM(tc.total_tokens), 0)::numeric / t.grand_total) * 100, 1)
              ELSE 0
            END as percentage
          FROM token_consumption tc
          JOIN agent_capacity ac ON ac.agent_id = tc.agent_id AND ac.session_id = tc.session_id
          CROSS JOIN totals t
          WHERE ac.model_id IS NOT NULL
          GROUP BY ac.model_id, t.grand_total
          ORDER BY total_tokens DESC
        `,

      startDate
        ? sql`
          SELECT
            COALESCE(SUM(input_tokens), 0) as input,
            COALESCE(SUM(output_tokens), 0) as output,
            COALESCE(SUM(total_tokens), 0) as total
          FROM token_consumption
          WHERE consumed_at >= ${startDate}
        `
        : sql`
          SELECT
            COALESCE(SUM(input_tokens), 0) as input,
            COALESCE(SUM(output_tokens), 0) as output,
            COALESCE(SUM(total_tokens), 0) as total
          FROM token_consumption
        `,
    ]);

    return c.json({
      data: timeSeries.map((r: Record<string, unknown>) => ({
        date: r.date instanceof Date ? r.date.toISOString() : r.date,
        input_tokens: Number(r.input_tokens),
        output_tokens: Number(r.output_tokens),
        total_tokens: Number(r.total_tokens),
      })),
      byAgent: byAgent.map((r: Record<string, unknown>) => ({
        agent_type: r.agent_type as string,
        total_tokens: Number(r.total_tokens),
        percentage: Number(r.percentage),
      })),
      byTool: byTool.map((r: Record<string, unknown>) => ({
        tool_name: r.tool_name as string,
        total_tokens: Number(r.total_tokens),
        percentage: Number(r.percentage),
      })),
      byModel: byModel.map((r: Record<string, unknown>) => ({
        model_id: r.model_id as string,
        total_tokens: Number(r.total_tokens),
        percentage: Number(r.percentage),
      })),
      totals: {
        input: Number(totals[0]?.input ?? 0),
        output: Number(totals[0]?.output ?? 0),
        total: Number(totals[0]?.total ?? 0),
      },
    });
  } catch (error) {
    log.error("GET /api/stats/tokens error:", error);
    return c.json(
      {
        error: "Failed to get token stats",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/stats/activity - GitHub-style activity heatmap
 */
export async function getStatsActivity(c: Context): Promise<Response> {
  try {
    const sql = getDb();
    const period = (c.req.query("period") ?? "year") as Period;
    const startDate = getStartDate(period) ?? new Date(0);

    const [dailyCounts, hourlyDist, weekdayDist] = await Promise.all([
      sql`
        SELECT
          to_char(created_at, 'YYYY-MM-DD') as date,
          COUNT(*) as count
        FROM actions
        WHERE created_at >= ${startDate}
        GROUP BY to_char(created_at, 'YYYY-MM-DD')
        ORDER BY date ASC
      `,

      sql`
        SELECT
          EXTRACT(HOUR FROM created_at)::int as hour,
          COUNT(*) as count
        FROM actions
        WHERE created_at >= ${startDate}
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY hour ASC
      `,

      sql`
        SELECT
          EXTRACT(DOW FROM created_at)::int as day,
          COUNT(*) as count
        FROM actions
        WHERE created_at >= ${startDate}
        GROUP BY EXTRACT(DOW FROM created_at)
        ORDER BY day ASC
      `,
    ]);

    const countMap = new Map<string, number>();
    for (const row of dailyCounts as Array<{ date: string; count: string | number }>) {
      countMap.set(row.date, Number(row.count));
    }

    const counts = Array.from(countMap.values());
    const maxCount = counts.length > 0 ? Math.max(...counts) : 0;

    function getLevel(count: number): 0 | 1 | 2 | 3 | 4 {
      if (count === 0 || maxCount === 0) return 0;
      const ratio = count / maxCount;
      if (ratio <= 0.25) return 1;
      if (ratio <= 0.5) return 2;
      if (ratio <= 0.75) return 3;
      return 4;
    }

    const heatmap: Array<{ date: string; count: number; level: 0 | 1 | 2 | 3 | 4 }> = [];
    const now = new Date();
    const daysBack = period === "year" ? 365 : period === "month" ? 30 : period === "week" ? 7 : 1;
    for (let i = daysBack - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().slice(0, 10);
      const count = countMap.get(dateStr) ?? 0;
      heatmap.push({ date: dateStr, count, level: getLevel(count) });
    }

    const activeDays = heatmap.filter((d) => d.count > 0).length;

    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;

    for (let i = heatmap.length - 1; i >= 0; i--) {
      if (heatmap[i].count > 0) {
        if (i === heatmap.length - 1 || heatmap[i + 1].count > 0 || currentStreak === 0) {
          currentStreak++;
        }
      } else {
        if (currentStreak > 0 && i === heatmap.length - 1) {
          currentStreak = 0;
        }
        break;
      }
    }

    for (const day of heatmap) {
      if (day.count > 0) {
        tempStreak++;
        if (tempStreak > longestStreak) longestStreak = tempStreak;
      } else {
        tempStreak = 0;
      }
    }

    const hourlyFull = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0 }));
    for (const row of hourlyDist as Array<{ hour: number; count: string | number }>) {
      hourlyFull[row.hour].count = Number(row.count);
    }

    const weekdayFull = Array.from({ length: 7 }, (_, d) => ({ day: d, count: 0 }));
    for (const row of weekdayDist as Array<{ day: number; count: string | number }>) {
      weekdayFull[row.day].count = Number(row.count);
    }

    return c.json({
      heatmap,
      byHour: hourlyFull,
      byDayOfWeek: weekdayFull,
      streak: {
        current: currentStreak,
        longest: longestStreak,
      },
      totalDays: heatmap.length,
      activeDays,
    });
  } catch (error) {
    log.error("GET /api/stats/activity error:", error);
    return c.json(
      {
        error: "Failed to get activity stats",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/stats/agents - Agent leaderboard with detailed metrics
 */
export async function getStatsAgents(c: Context): Promise<Response> {
  try {
    const sql = getDb();
    const period = (c.req.query("period") ?? "month") as Period;
    const limit = Math.min(Number(c.req.query("limit") ?? 20), 100);
    const startDate = getStartDate(period);
    const prevStartDate = getPrevStartDate(period);

    const [leaderboard, prevPeriodCounts, totalTypes] = await Promise.all([
      startDate
        ? sql`
          WITH agent_stats AS (
            SELECT
              st.agent_type,
              COUNT(*) FILTER (WHERE st.status = 'completed') as tasks_completed,
              COUNT(*) FILTER (WHERE st.status = 'failed') as tasks_failed,
              COUNT(*) as tasks_total,
              AVG(
                EXTRACT(EPOCH FROM (st.completed_at - st.started_at)) * 1000
              ) FILTER (WHERE st.completed_at IS NOT NULL AND st.started_at IS NOT NULL) as avg_duration_ms
            FROM subtasks st
            WHERE st.created_at >= ${startDate}
            GROUP BY st.agent_type
          ),
          agent_tokens AS (
            SELECT
              ac.agent_type,
              COALESCE(SUM(tc.total_tokens), 0) as total_tokens
            FROM token_consumption tc
            JOIN agent_capacity ac ON ac.agent_id = tc.agent_id AND ac.session_id = tc.session_id
            WHERE tc.consumed_at >= ${startDate}
            GROUP BY ac.agent_type
          )
          SELECT
            s.agent_type,
            s.tasks_completed,
            s.tasks_failed,
            s.tasks_total,
            ROUND(s.avg_duration_ms::numeric, 0) as avg_duration_ms,
            COALESCE(t.total_tokens, 0) as total_tokens
          FROM agent_stats s
          LEFT JOIN agent_tokens t ON t.agent_type = s.agent_type
          ORDER BY s.tasks_completed DESC
          LIMIT ${limit}
        `
        : sql`
          WITH agent_stats AS (
            SELECT
              st.agent_type,
              COUNT(*) FILTER (WHERE st.status = 'completed') as tasks_completed,
              COUNT(*) FILTER (WHERE st.status = 'failed') as tasks_failed,
              COUNT(*) as tasks_total,
              AVG(
                EXTRACT(EPOCH FROM (st.completed_at - st.started_at)) * 1000
              ) FILTER (WHERE st.completed_at IS NOT NULL AND st.started_at IS NOT NULL) as avg_duration_ms
            FROM subtasks st
            GROUP BY st.agent_type
          ),
          agent_tokens AS (
            SELECT
              ac.agent_type,
              COALESCE(SUM(tc.total_tokens), 0) as total_tokens
            FROM token_consumption tc
            JOIN agent_capacity ac ON ac.agent_id = tc.agent_id AND ac.session_id = tc.session_id
            GROUP BY ac.agent_type
          )
          SELECT
            s.agent_type,
            s.tasks_completed,
            s.tasks_failed,
            s.tasks_total,
            ROUND(s.avg_duration_ms::numeric, 0) as avg_duration_ms,
            COALESCE(t.total_tokens, 0) as total_tokens
          FROM agent_stats s
          LEFT JOIN agent_tokens t ON t.agent_type = s.agent_type
          ORDER BY s.tasks_completed DESC
          LIMIT ${limit}
        `,

      prevStartDate && startDate
        ? sql`
          SELECT agent_type, COUNT(*) FILTER (WHERE status = 'completed') as tasks_completed
          FROM subtasks
          WHERE created_at >= ${prevStartDate} AND created_at < ${startDate}
          GROUP BY agent_type
        `
        : sql`SELECT NULL as agent_type, 0 as tasks_completed WHERE false`,

      sql`
        SELECT COUNT(DISTINCT agent_type) as total
        FROM subtasks
      `,
    ]);

    const prevMap = new Map<string, number>();
    for (const row of prevPeriodCounts as Array<{ agent_type: string; tasks_completed: string | number }>) {
      if (row.agent_type) {
        prevMap.set(row.agent_type as string, Number(row.tasks_completed));
      }
    }

    function getTrend(agentType: string, current: number): "up" | "down" | "stable" {
      const prev = prevMap.get(agentType) ?? 0;
      if (current > prev * 1.05) return "up";
      if (current < prev * 0.95) return "down";
      return "stable";
    }

    function getCategory(agentType: string): string {
      const categories: Record<string, string> = {
        "frontend-react": "frontend",
        "backend-laravel": "backend",
        "database-admin": "database",
        "qa-testing": "testing",
        "devops-infra": "devops",
        "tech-lead": "architecture",
        "project-supervisor": "architecture",
        "impact-analyzer": "analysis",
        "regression-guard": "analysis",
        "security-specialist": "security",
      };
      return categories[agentType] ?? "general";
    }

    function getDisplayName(agentType: string): string {
      return agentType
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }

    return c.json({
      leaderboard: leaderboard.map((r: Record<string, unknown>) => {
        const agentType = r.agent_type as string;
        const completed = Number(r.tasks_completed);
        const total = Number(r.tasks_total);
        return {
          agent_type: agentType,
          display_name: getDisplayName(agentType),
          category: getCategory(agentType),
          tasks_completed: completed,
          tasks_failed: Number(r.tasks_failed),
          success_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
          total_tokens: Number(r.total_tokens),
          avg_duration_ms: Number(r.avg_duration_ms ?? 0),
          trend: getTrend(agentType, completed),
        };
      }),
      totalAgentTypes: Number(totalTypes[0]?.total ?? 0),
    });
  } catch (error) {
    log.error("GET /api/stats/agents error:", error);
    return c.json(
      {
        error: "Failed to get agent stats",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}
