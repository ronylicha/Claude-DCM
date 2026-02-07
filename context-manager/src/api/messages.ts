/**
 * Messages API - Inter-agent pub/sub communication
 * Phase 4 - POST/GET /api/messages endpoints
 * @module api/messages
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";

/** Valid message topics */
const VALID_TOPICS = [
  "task.created",
  "task.completed",
  "task.failed",
  "context.request",
  "context.response",
  "alert.blocking",
  "agent.heartbeat",
  "workflow.progress",
] as const;

type MessageTopic = (typeof VALID_TOPICS)[number];

/** Zod schema for message input validation */
const MessageInputSchema = z.object({
  from_agent: z.string().min(1, "from_agent is required"),
  to_agent: z.string().nullable().optional(), // null = broadcast
  topic: z.enum(VALID_TOPICS, {
    errorMap: () => ({ message: `topic must be one of: ${VALID_TOPICS.join(", ")}` }),
  }),
  content: z.record(z.unknown()).or(z.string()), // Accept object or string
  priority: z.number().int().min(0).max(10).default(0),
  ttl_seconds: z.number().int().min(1).max(86400).default(3600), // 1 second to 24 hours
  project_id: z.string().uuid().optional(),
});

type MessageInput = z.infer<typeof MessageInputSchema>;

/** Query params schema for GET messages */
const GetMessagesQuerySchema = z.object({
  since: z.string().datetime().optional(),
  topic: z.string().optional(),
  include_broadcasts: z.enum(["true", "false"]).default("true"),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

/** Database row type for messages */
interface MessageRow {
  id: string;
  project_id: string | null;
  from_agent_id: string | null;
  to_agent_id: string | null;
  message_type: string;
  topic: string | null;
  payload: Record<string, unknown>;
  priority: number;
  read_by: string[];
  created_at: string;
  expires_at: string | null;
}

/**
 * POST /api/messages - Publish a message
 * @param c - Hono context
 */
export async function postMessage(c: Context): Promise<Response> {
  try {
    const body = await c.req.json();

    // Validate input with Zod
    const parseResult = MessageInputSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Validation failed",
          details: parseResult.error.flatten().fieldErrors,
        },
        400
      );
    }

    const input: MessageInput = parseResult.data;
    const sql = getDb();

    // Calculate expires_at from ttl_seconds
    const expiresAt = new Date(Date.now() + input.ttl_seconds * 1000);

    // Prepare payload (ensure it's an object)
    const payload =
      typeof input.content === "string"
        ? { message: input.content }
        : input.content;

    // Insert the message
    const [message] = await sql<MessageRow[]>`
      INSERT INTO agent_messages (
        project_id,
        from_agent_id,
        to_agent_id,
        message_type,
        topic,
        payload,
        priority,
        expires_at
      ) VALUES (
        ${input.project_id ?? null},
        ${input.from_agent},
        ${input.to_agent ?? null},
        ${input.topic},
        ${input.topic},
        ${JSON.stringify(payload)}::jsonb,
        ${input.priority},
        ${expiresAt.toISOString()}
      )
      RETURNING
        id, project_id, from_agent_id, to_agent_id,
        message_type, topic, payload, priority,
        read_by, created_at, expires_at
    `;

    // Publish real-time event via PostgreSQL NOTIFY
    await publishEvent("global", "message.new", {
      id: message.id,
      from: message.from_agent_id,
      to: message.to_agent_id,
      topic: message.topic,
    });
    if (message.to_agent_id) {
      await publishEvent(`agents/${message.to_agent_id}`, "message.new", {
        id: message.id,
        from: message.from_agent_id,
        topic: message.topic,
        priority: message.priority,
      });
    }

    return c.json(
      {
        success: true,
        message: {
          id: message.id,
          from_agent: message.from_agent_id,
          to_agent: message.to_agent_id,
          topic: message.topic,
          priority: message.priority,
          created_at: message.created_at,
          expires_at: message.expires_at,
          is_broadcast: message.to_agent_id === null,
        },
      },
      201
    );
  } catch (error) {
    console.error("[API] POST /api/messages error:", error);
    return c.json(
      {
        error: "Failed to publish message",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

/**
 * GET /api/messages/:agent_id - Get messages for an agent
 * @param c - Hono context
 */
export async function getMessages(c: Context): Promise<Response> {
  try {
    const agentId = c.req.param("agent_id");

    if (!agentId) {
      return c.json({ error: "Missing agent_id parameter" }, 400);
    }

    // Parse and validate query params
    const queryParams = {
      since: c.req.query("since"),
      topic: c.req.query("topic"),
      include_broadcasts: c.req.query("include_broadcasts") ?? "true",
      limit: c.req.query("limit") ?? "100",
    };

    const parseResult = GetMessagesQuerySchema.safeParse(queryParams);
    if (!parseResult.success) {
      return c.json(
        {
          error: "Invalid query parameters",
          details: parseResult.error.flatten().fieldErrors,
        },
        400
      );
    }

    const query = parseResult.data;
    const sql = getDb();

    // Build the query with filters
    let messages: MessageRow[];

    const includeBroadcasts = query.include_broadcasts === "true";
    const sinceDate = query.since ? new Date(query.since) : null;

    if (query.topic && sinceDate) {
      // Filter by topic and since
      messages = await sql<MessageRow[]>`
        SELECT
          id, project_id, from_agent_id, to_agent_id,
          message_type, topic, payload, priority,
          read_by, created_at, expires_at
        FROM agent_messages
        WHERE (expires_at IS NULL OR expires_at > NOW())
          AND topic = ${query.topic}
          AND created_at > ${sinceDate.toISOString()}
          AND (
            to_agent_id = ${agentId}
            ${includeBroadcasts ? sql`OR to_agent_id IS NULL` : sql``}
          )
        ORDER BY priority DESC, created_at ASC
        LIMIT ${query.limit}
      `;
    } else if (query.topic) {
      // Filter by topic only
      messages = await sql<MessageRow[]>`
        SELECT
          id, project_id, from_agent_id, to_agent_id,
          message_type, topic, payload, priority,
          read_by, created_at, expires_at
        FROM agent_messages
        WHERE (expires_at IS NULL OR expires_at > NOW())
          AND topic = ${query.topic}
          AND (
            to_agent_id = ${agentId}
            ${includeBroadcasts ? sql`OR to_agent_id IS NULL` : sql``}
          )
        ORDER BY priority DESC, created_at ASC
        LIMIT ${query.limit}
      `;
    } else if (sinceDate) {
      // Filter by since only
      messages = await sql<MessageRow[]>`
        SELECT
          id, project_id, from_agent_id, to_agent_id,
          message_type, topic, payload, priority,
          read_by, created_at, expires_at
        FROM agent_messages
        WHERE (expires_at IS NULL OR expires_at > NOW())
          AND created_at > ${sinceDate.toISOString()}
          AND (
            to_agent_id = ${agentId}
            ${includeBroadcasts ? sql`OR to_agent_id IS NULL` : sql``}
          )
        ORDER BY priority DESC, created_at ASC
        LIMIT ${query.limit}
      `;
    } else {
      // No filters
      messages = await sql<MessageRow[]>`
        SELECT
          id, project_id, from_agent_id, to_agent_id,
          message_type, topic, payload, priority,
          read_by, created_at, expires_at
        FROM agent_messages
        WHERE (expires_at IS NULL OR expires_at > NOW())
          AND (
            to_agent_id = ${agentId}
            ${includeBroadcasts ? sql`OR to_agent_id IS NULL` : sql``}
          )
        ORDER BY priority DESC, created_at ASC
        LIMIT ${query.limit}
      `;
    }

    // Mark messages as read by this agent
    const messageIds = messages.map((m) => m.id);
    if (messageIds.length > 0) {
      await sql`
        UPDATE agent_messages
        SET read_by = array_append(
          CASE WHEN ${agentId} = ANY(read_by) THEN read_by
               ELSE read_by END,
          CASE WHEN ${agentId} = ANY(read_by) THEN NULL
               ELSE ${agentId} END
        )
        WHERE id = ANY(${messageIds})
          AND NOT (${agentId} = ANY(read_by))
      `;
    }

    // Count unread (messages not yet read by this agent)
    const [{ unread_count }] = await sql<[{ unread_count: number }]>`
      SELECT COUNT(*) as unread_count
      FROM agent_messages
      WHERE (expires_at IS NULL OR expires_at > NOW())
        AND (to_agent_id = ${agentId} OR to_agent_id IS NULL)
        AND NOT (${agentId} = ANY(read_by))
    `;

    return c.json({
      agent_id: agentId,
      messages: messages.map((m) => ({
        id: m.id,
        from_agent: m.from_agent_id,
        to_agent: m.to_agent_id,
        topic: m.topic,
        content: m.payload,
        priority: m.priority,
        is_broadcast: m.to_agent_id === null,
        already_read: m.read_by.includes(agentId),
        created_at: m.created_at,
        expires_at: m.expires_at,
      })),
      count: messages.length,
      unread_remaining: Number(unread_count),
    });
  } catch (error) {
    console.error("[API] GET /api/messages/:agent_id error:", error);
    return c.json(
      {
        error: "Failed to fetch messages",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500
    );
  }
}

export { VALID_TOPICS };
export type { MessageTopic, MessageInput };
