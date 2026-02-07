/**
 * Subscriptions API - Topic subscription management
 * Phase 4 - POST/GET/DELETE /api/subscribe endpoints
 * @module api/subscriptions
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb } from "../db/client";
import { VALID_TOPICS } from "./messages";

/** Zod schema for subscription input validation */
const SubscriptionInputSchema = z.object({
  agent_id: z.string().min(1, "agent_id is required"),
  topic: z.enum(VALID_TOPICS, {
    errorMap: () => ({ message: `topic must be one of: ${VALID_TOPICS.join(", ")}` }),
  }),
  callback_url: z.string().url().optional(),
});

type SubscriptionInput = z.infer<typeof SubscriptionInputSchema>;

/** Database row type for subscriptions */
interface SubscriptionRow {
  id: string;
  agent_id: string;
  topic: string;
  callback_url: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * POST /api/subscribe - Subscribe to a topic
 * Uses upsert to handle re-subscription with updated callback_url
 * @param c - Hono context
 */
export async function postSubscription(c: Context): Promise<Response> {
  try {
    const body = await c.req.json();

    // Validate input with Zod
    const parseResult = SubscriptionInputSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400
      );
    }

    const input: SubscriptionInput = parseResult.data;
    const sql = getDb();

    // Upsert subscription (create or update callback_url)
    const [subscription] = await sql<SubscriptionRow[]>`
      INSERT INTO subscriptions (agent_id, topic, callback_url)
      VALUES (${input.agent_id}, ${input.topic}, ${input.callback_url ?? null})
      ON CONFLICT (agent_id, topic)
      DO UPDATE SET
        callback_url = EXCLUDED.callback_url,
        updated_at = NOW()
      RETURNING id, agent_id, topic, callback_url, created_at, updated_at
    `;

    return c.json(
      {
        success: true,
        subscription: {
          id: subscription.id,
          agent_id: subscription.agent_id,
          topic: subscription.topic,
          callback_url: subscription.callback_url,
          created_at: subscription.created_at,
          updated_at: subscription.updated_at,
        },
      },
      201
    );
  } catch (error) {
    console.error("[API] POST /api/subscribe error:", error);
    return c.json(
      {
        error: "Failed to create subscription",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/subscriptions - List all subscriptions (optionally filtered)
 * @param c - Hono context
 */
export async function getSubscriptions(c: Context): Promise<Response> {
  try {
    const agentId = c.req.query("agent_id");
    const topic = c.req.query("topic");
    const sql = getDb();

    let subscriptions: SubscriptionRow[];

    if (agentId && topic) {
      subscriptions = await sql<SubscriptionRow[]>`
        SELECT id, agent_id, topic, callback_url, created_at, updated_at
        FROM subscriptions
        WHERE agent_id = ${agentId} AND topic = ${topic}
        ORDER BY created_at DESC
      `;
    } else if (agentId) {
      subscriptions = await sql<SubscriptionRow[]>`
        SELECT id, agent_id, topic, callback_url, created_at, updated_at
        FROM subscriptions
        WHERE agent_id = ${agentId}
        ORDER BY created_at DESC
      `;
    } else if (topic) {
      subscriptions = await sql<SubscriptionRow[]>`
        SELECT id, agent_id, topic, callback_url, created_at, updated_at
        FROM subscriptions
        WHERE topic = ${topic}
        ORDER BY created_at DESC
      `;
    } else {
      subscriptions = await sql<SubscriptionRow[]>`
        SELECT id, agent_id, topic, callback_url, created_at, updated_at
        FROM subscriptions
        ORDER BY created_at DESC
        LIMIT 1000
      `;
    }

    return c.json({
      subscriptions,
      count: subscriptions.length,
    });
  } catch (error) {
    console.error("[API] GET /api/subscriptions error:", error);
    return c.json(
      {
        error: "Failed to fetch subscriptions",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/subscriptions/:agent_id - Get subscriptions for a specific agent
 * @param c - Hono context
 */
export async function getAgentSubscriptions(c: Context): Promise<Response> {
  try {
    const agentId = c.req.param("agent_id");

    if (!agentId) {
      return c.json({ error: "Missing agent_id parameter" }, 400);
    }

    const sql = getDb();

    const subscriptions = await sql<SubscriptionRow[]>`
      SELECT id, agent_id, topic, callback_url, created_at, updated_at
      FROM subscriptions
      WHERE agent_id = ${agentId}
      ORDER BY topic ASC
    `;

    return c.json({
      agent_id: agentId,
      subscriptions,
      topics: subscriptions.map((s) => s.topic),
      count: subscriptions.length,
    });
  } catch (error) {
    console.error("[API] GET /api/subscriptions/:agent_id error:", error);
    return c.json(
      {
        error: "Failed to fetch agent subscriptions",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * DELETE /api/subscriptions/:id - Unsubscribe by subscription ID
 * @param c - Hono context
 */
export async function deleteSubscription(c: Context): Promise<Response> {
  try {
    const subscriptionId = c.req.param("id");

    if (!subscriptionId) {
      return c.json({ error: "Missing subscription id parameter" }, 400);
    }

    const sql = getDb();

    // Delete and return the deleted row
    const deleted = await sql<SubscriptionRow[]>`
      DELETE FROM subscriptions
      WHERE id = ${subscriptionId}
      RETURNING id, agent_id, topic
    `;

    if (deleted.length === 0) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    return c.json({
      success: true,
      deleted: {
        id: deleted[0].id,
        agent_id: deleted[0].agent_id,
        topic: deleted[0].topic,
      },
    });
  } catch (error) {
    console.error("[API] DELETE /api/subscriptions/:id error:", error);
    return c.json(
      {
        error: "Failed to delete subscription",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * DELETE /api/unsubscribe - Unsubscribe by agent_id and topic
 * @param c - Hono context
 */
export async function postUnsubscribe(c: Context): Promise<Response> {
  try {
    const body = await c.req.json();

    const schema = z.object({
      agent_id: z.string().min(1),
      topic: z.string().min(1),
    });

    const parseResult = schema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400
      );
    }

    const { agent_id, topic } = parseResult.data;
    const sql = getDb();

    const deleted = await sql<SubscriptionRow[]>`
      DELETE FROM subscriptions
      WHERE agent_id = ${agent_id} AND topic = ${topic}
      RETURNING id, agent_id, topic
    `;

    if (deleted.length === 0) {
      return c.json({ error: "Subscription not found" }, 404);
    }

    return c.json({
      success: true,
      deleted: {
        id: deleted[0].id,
        agent_id: deleted[0].agent_id,
        topic: deleted[0].topic,
      },
    });
  } catch (error) {
    console.error("[API] POST /api/unsubscribe error:", error);
    return c.json(
      {
        error: "Failed to unsubscribe",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * Get subscribers for a topic (used internally for notifications)
 * @param topic - The topic to get subscribers for
 * @returns Array of subscriptions
 */
export async function getTopicSubscribers(topic: string): Promise<SubscriptionRow[]> {
  const sql = getDb();

  return sql<SubscriptionRow[]>`
    SELECT id, agent_id, topic, callback_url, created_at, updated_at
    FROM subscriptions
    WHERE topic = ${topic}
  `;
}

export type { SubscriptionInput, SubscriptionRow };
