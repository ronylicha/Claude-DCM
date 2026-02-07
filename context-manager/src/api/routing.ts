/**
 * Routing API - Suggest tools based on keywords
 * Phase 2.4 - GET /api/routing/suggest endpoint
 * @module api/routing
 */

import type { Context } from "hono";
import { getDb } from "../db/client";

/** Tool suggestion result */
export interface ToolSuggestion {
  tool_name: string;
  tool_type: string;
  score: number;
  usage_count: number;
  success_rate: number;
  keyword_matches: string[];
}

/**
 * GET /api/routing/suggest - Suggest tools based on keywords
 * Query params:
 *   - keywords: comma-separated list of keywords
 *   - limit: max results (default: 10, max: 50)
 *   - min_score: minimum score threshold (default: 0.5)
 *   - tool_type: filter by tool type (optional)
 *
 * @param c - Hono context
 */
export async function suggestRouting(c: Context): Promise<Response> {
  try {
    const keywordsParam = c.req.query("keywords");

    if (!keywordsParam) {
      return c.json(
        { error: "Missing required query parameter: keywords" },
        400
      );
    }

    // Parse keywords
    const keywords = keywordsParam
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter((k) => k.length > 0);

    if (keywords.length === 0) {
      return c.json(
        { error: "No valid keywords provided" },
        400
      );
    }

    const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 50);
    const minScore = parseFloat(c.req.query("min_score") ?? "0.5");
    const toolType = c.req.query("tool_type");

    const sql = getDb();

    // Query for matching tools with aggregated scores
    // This mimics the behavior of routing-suggest.sh
    let results;

    if (toolType) {
      results = await sql`
        WITH keyword_matches AS (
          SELECT
            tool_name,
            tool_type,
            keyword,
            score,
            usage_count,
            success_count
          FROM keyword_tool_scores
          WHERE keyword = ANY(${keywords})
            AND tool_type = ${toolType}
            AND score >= ${minScore}
        )
        SELECT
          tool_name,
          tool_type,
          ROUND(AVG(score)::numeric, 3) as avg_score,
          SUM(usage_count) as total_usage,
          SUM(success_count) as total_success,
          ARRAY_AGG(DISTINCT keyword) as matched_keywords,
          COUNT(DISTINCT keyword) as keyword_match_count
        FROM keyword_matches
        GROUP BY tool_name, tool_type
        ORDER BY
          keyword_match_count DESC,
          avg_score DESC,
          total_usage DESC
        LIMIT ${limit}
      `;
    } else {
      results = await sql`
        WITH keyword_matches AS (
          SELECT
            tool_name,
            tool_type,
            keyword,
            score,
            usage_count,
            success_count
          FROM keyword_tool_scores
          WHERE keyword = ANY(${keywords})
            AND score >= ${minScore}
        )
        SELECT
          tool_name,
          tool_type,
          ROUND(AVG(score)::numeric, 3) as avg_score,
          SUM(usage_count) as total_usage,
          SUM(success_count) as total_success,
          ARRAY_AGG(DISTINCT keyword) as matched_keywords,
          COUNT(DISTINCT keyword) as keyword_match_count
        FROM keyword_matches
        GROUP BY tool_name, tool_type
        ORDER BY
          keyword_match_count DESC,
          avg_score DESC,
          total_usage DESC
        LIMIT ${limit}
      `;
    }

    // Format response
    const suggestions: ToolSuggestion[] = results.map((r: Record<string, unknown>) => ({
      tool_name: r.tool_name as string,
      tool_type: r.tool_type as string,
      score: Number(r.avg_score),
      usage_count: Number(r.total_usage),
      success_rate: Number(r.total_usage) > 0
        ? Math.round((Number(r.total_success) / Number(r.total_usage)) * 100)
        : 0,
      keyword_matches: r.matched_keywords as string[],
    }));

    // Compatibility format for shell scripts (like routing-suggest.sh)
    const compatOutput = suggestions
      .map((s) => `${s.tool_name}|${s.tool_type}|${s.score}`)
      .join("\n");

    return c.json({
      keywords,
      suggestions,
      count: suggestions.length,
      // Legacy format for shell compatibility
      compat_output: compatOutput,
    });
  } catch (error) {
    console.error("[API] GET /api/routing/suggest error:", error);
    return c.json(
      {
        error: "Failed to suggest routing",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/routing/stats - Get routing statistics
 * @param c - Hono context
 */
export async function getRoutingStats(c: Context): Promise<Response> {
  try {
    const sql = getDb();

    // Get overall statistics
    const [totals] = await sql`
      SELECT
        COUNT(*) as total_records,
        COUNT(DISTINCT keyword) as unique_keywords,
        COUNT(DISTINCT tool_name) as unique_tools,
        ROUND(AVG(score)::numeric, 3) as avg_score,
        ROUND(AVG(usage_count)::numeric, 1) as avg_usage
      FROM keyword_tool_scores
    `;

    // Get top tools by score
    const topByScore = await sql`
      SELECT tool_name, tool_type, ROUND(AVG(score)::numeric, 3) as avg_score
      FROM keyword_tool_scores
      GROUP BY tool_name, tool_type
      ORDER BY avg_score DESC
      LIMIT 10
    `;

    // Get top tools by usage
    const topByUsage = await sql`
      SELECT tool_name, tool_type, SUM(usage_count) as total_usage
      FROM keyword_tool_scores
      GROUP BY tool_name, tool_type
      ORDER BY total_usage DESC
      LIMIT 10
    `;

    // Get tool type distribution
    const typeDistribution = await sql`
      SELECT tool_type, COUNT(DISTINCT tool_name) as tool_count
      FROM keyword_tool_scores
      GROUP BY tool_type
      ORDER BY tool_count DESC
    `;

    return c.json({
      totals: {
        total_records: Number(totals.total_records),
        unique_keywords: Number(totals.unique_keywords),
        unique_tools: Number(totals.unique_tools),
        avg_score: Number(totals.avg_score),
        avg_usage: Number(totals.avg_usage),
      },
      top_by_score: topByScore,
      top_by_usage: topByUsage,
      type_distribution: typeDistribution,
    });
  } catch (error) {
    console.error("[API] GET /api/routing/stats error:", error);
    return c.json(
      {
        error: "Failed to get routing stats",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * POST /api/routing/feedback - Update routing scores based on user feedback
 * @param c - Hono context
 */
export async function postRoutingFeedback(c: Context): Promise<Response> {
  try {
    const body = await c.req.json() as {
      tool_name: string;
      keywords: string[];
      chosen: boolean; // true if user chose this tool, false if rejected
    };

    if (!body.tool_name || !body.keywords || body.keywords.length === 0) {
      return c.json(
        { error: "Missing required fields: tool_name and keywords" },
        400
      );
    }

    const sql = getDb();
    const scoreAdjustment = body.chosen ? 0.2 : -0.1;

    // Update scores for all matching keywords
    for (const keyword of body.keywords) {
      await sql`
        UPDATE keyword_tool_scores
        SET
          score = GREATEST(0.1, LEAST(5.0, score + ${scoreAdjustment})),
          last_used = NOW()
        WHERE keyword = ${keyword.toLowerCase()}
          AND tool_name = ${body.tool_name}
      `;
    }

    return c.json({
      success: true,
      message: `Updated ${body.keywords.length} keyword scores for ${body.tool_name}`,
      adjustment: scoreAdjustment,
    });
  } catch (error) {
    console.error("[API] POST /api/routing/feedback error:", error);
    return c.json(
      {
        error: "Failed to process feedback",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}
