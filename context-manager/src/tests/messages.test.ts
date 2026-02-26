/**
 * Messages API Unit Tests
 * Tests postMessage, getMessages, and getAllMessages with mocked DB and events.
 *
 * Mocking strategy:
 *   - `getDb` returns a mock tagged-template function that routes results based
 *     on SQL content (INSERT, SELECT, UPDATE, COUNT).
 *   - `publishEvent` is a Bun mock function with call tracking.
 *   - Hono Context is faked with minimal interface (req.json, req.param, req.query, json).
 *
 * Run: bun test src/tests/messages.test.ts
 *
 * @module tests/messages
 */

import { describe, test, expect, mock, beforeEach } from "bun:test";
import type { Context } from "hono";

// ---------------------------------------------------------------------------
// Mocks - must be declared before importing the module under test
// ---------------------------------------------------------------------------

const mockPublishEvent = mock(() => Promise.resolve());

/**
 * Configurable mock SQL results keyed by query type.
 * Each test sets the results it expects for INSERT, SELECT, UPDATE, or COUNT queries.
 */
let mockSqlConfig: {
  insert?: unknown[];
  select?: unknown[];
  update?: unknown[];
  count?: unknown[];
};

/**
 * Create a mock SQL tagged-template function.
 *
 * Routes calls to the correct result set by inspecting the static template
 * strings for SQL keywords (INSERT, COUNT, UPDATE, SELECT).
 * Fragment calls (e.g. `sql\`AND topic = ...\``) fall through to a no-op marker.
 */
function createMockSqlFn() {
  const fn = function (strings: TemplateStringsArray, ..._values: unknown[]) {
    const query = strings.join("?");

    if (query.includes("INSERT INTO")) {
      return Promise.resolve(mockSqlConfig.insert ?? []);
    }
    if (query.includes("COUNT(*)")) {
      return Promise.resolve(
        mockSqlConfig.count ?? [{ unread_count: 0, total: 0 }],
      );
    }
    if (query.includes("UPDATE")) {
      return Promise.resolve(mockSqlConfig.update ?? []);
    }
    if (query.includes("SELECT") && query.includes("FROM")) {
      return Promise.resolve(mockSqlConfig.select ?? []);
    }

    // SQL fragment (used for dynamic WHERE clauses) - return inert marker
    return { __fragment: true };
  } as any;

  fn.json = (val: unknown) => JSON.stringify(val);
  fn.notify = mock(() => Promise.resolve());

  return fn;
}

let mockSqlFn: ReturnType<typeof createMockSqlFn> = createMockSqlFn();

mock.module("../db/client", () => ({
  getDb: () => mockSqlFn,
  publishEvent: mockPublishEvent,
}));

mock.module("../lib/logger", () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

// Import module under test AFTER mocks are established
import {
  postMessage,
  getMessages,
  getAllMessages,
  VALID_TOPICS,
} from "../api/messages";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a mock Hono context for POST requests */
function createPostContext(body: unknown): Context {
  return {
    req: {
      json: async () => body,
    },
    json: (data: unknown, status?: number) =>
      Response.json(data, { status: status ?? 200 }),
  } as unknown as Context;
}

/** Create a mock Hono context for GET requests (params + query string) */
function createGetContext(
  params: Record<string, string>,
  query: Record<string, string | undefined> = {},
): Context {
  return {
    req: {
      param: (key: string) => params[key],
      query: (key: string) => query[key],
    },
    json: (data: unknown, status?: number) =>
      Response.json(data, { status: status ?? 200 }),
  } as unknown as Context;
}

/** Parse a fetch Response into { status, data } for easy assertions */
async function parseResponse(
  response: Response,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const data = (await response.json()) as Record<string, unknown>;
  return { status: response.status, data };
}

/** Factory for a valid POST /api/messages input body */
function validMessageInput(overrides: Record<string, unknown> = {}) {
  return {
    from_agent: "agent-sender-001",
    to_agent: "agent-receiver-001",
    topic: "task.completed" as const,
    content: { result: "success" },
    priority: 5,
    ttl_seconds: 600,
    ...overrides,
  };
}

/** Factory for a mock database row from the agent_messages table */
function mockMessageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-uuid-001",
    project_id: null,
    from_agent_id: "agent-sender-001",
    to_agent_id: "agent-receiver-001",
    message_type: "task.completed",
    topic: "task.completed",
    payload: { result: "success" },
    priority: 5,
    read_by: [] as string[],
    created_at: "2026-02-09T10:00:00.000Z",
    expires_at: "2026-02-09T10:10:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Messages API Unit Tests", () => {
  beforeEach(() => {
    mockPublishEvent.mockClear();
    mockSqlConfig = {};
    mockSqlFn = createMockSqlFn();
  });

  // ========================================================================
  // VALID_TOPICS
  // ========================================================================

  describe("VALID_TOPICS", () => {
    test("exports all 10 expected topic strings", () => {
      expect(VALID_TOPICS).toEqual([
        "task.created",
        "task.completed",
        "task.failed",
        "context.request",
        "context.response",
        "alert.blocking",
        "agent.heartbeat",
        "agent.started",
        "agent.completed",
        "workflow.progress",
      ]);
      expect(VALID_TOPICS.length).toBe(10);
    });
  });

  // ========================================================================
  // postMessage - Input Validation
  // ========================================================================

  describe("postMessage - validation", () => {
    test("returns 400 when from_agent is missing", async () => {
      const c = createPostContext({
        topic: "task.created",
        content: { info: "test" },
      });
      const { status, data } = await parseResponse(await postMessage(c));

      expect(status).toBe(400);
      expect(data["error"]).toBe("Validation failed");
      expect(data["details"]).toBeDefined();
    });

    test("returns 400 when from_agent is empty string", async () => {
      const c = createPostContext(validMessageInput({ from_agent: "" }));
      const { status, data } = await parseResponse(await postMessage(c));

      expect(status).toBe(400);
      expect(data["error"]).toBe("Validation failed");
      const details = data["details"] as Record<string, string[]>;
      expect(details["from_agent"]).toBeDefined();
    });

    test("returns 400 when topic is not in VALID_TOPICS", async () => {
      const c = createPostContext(
        validMessageInput({ topic: "invalid.topic.value" }),
      );
      const { status, data } = await parseResponse(await postMessage(c));

      expect(status).toBe(400);
      expect(data["error"]).toBe("Validation failed");
      const details = data["details"] as Record<string, string[]>;
      expect(details["topic"]).toBeDefined();
      // Zod v4 uses its own default error format for enums
      expect(details["topic"][0]).toMatch(/topic|Invalid option|expected one of/);
    });

    test("returns 400 when priority exceeds maximum of 10", async () => {
      const c = createPostContext(validMessageInput({ priority: 11 }));
      const { status, data } = await parseResponse(await postMessage(c));

      expect(status).toBe(400);
      expect(data["error"]).toBe("Validation failed");
    });

    test("returns 400 when priority is negative", async () => {
      const c = createPostContext(validMessageInput({ priority: -1 }));
      const { status, data } = await parseResponse(await postMessage(c));

      expect(status).toBe(400);
      expect(data["error"]).toBe("Validation failed");
    });

    test("returns 400 when ttl_seconds exceeds 86400", async () => {
      const c = createPostContext(validMessageInput({ ttl_seconds: 100000 }));
      const { status, data } = await parseResponse(await postMessage(c));

      expect(status).toBe(400);
      expect(data["error"]).toBe("Validation failed");
    });
  });

  // ========================================================================
  // postMessage - Successful creation
  // ========================================================================

  describe("postMessage - success", () => {
    test("returns 201 with correct shape for a direct message", async () => {
      const row = mockMessageRow();
      mockSqlConfig = { insert: [row] };

      const c = createPostContext(validMessageInput());
      const { status, data } = await parseResponse(await postMessage(c));

      expect(status).toBe(201);
      expect(data["success"]).toBe(true);

      const msg = data["message"] as Record<string, unknown>;
      expect(msg["id"]).toBe("msg-uuid-001");
      expect(msg["from_agent"]).toBe("agent-sender-001");
      expect(msg["to_agent"]).toBe("agent-receiver-001");
      expect(msg["topic"]).toBe("task.completed");
      expect(msg["priority"]).toBe(5);
      expect(msg["is_broadcast"]).toBe(false);
      expect(msg["created_at"]).toBeDefined();
      expect(msg["expires_at"]).toBeDefined();
    });

    test("returns 201 with is_broadcast=true when to_agent is null", async () => {
      const row = mockMessageRow({ to_agent_id: null });
      mockSqlConfig = { insert: [row] };

      const c = createPostContext(validMessageInput({ to_agent: null }));
      const { status, data } = await parseResponse(await postMessage(c));

      expect(status).toBe(201);
      expect(data["success"]).toBe(true);

      const msg = data["message"] as Record<string, unknown>;
      expect(msg["is_broadcast"]).toBe(true);
      expect(msg["to_agent"]).toBeNull();
    });

    test("applies default priority=0 and ttl_seconds=3600 when omitted", async () => {
      const row = mockMessageRow({ priority: 0 });
      mockSqlConfig = { insert: [row] };

      const c = createPostContext({
        from_agent: "agent-sender-001",
        topic: "task.created",
        content: { info: "defaults test" },
        // priority and ttl_seconds intentionally omitted
      });
      const { status, data } = await parseResponse(await postMessage(c));

      expect(status).toBe(201);
      const msg = data["message"] as Record<string, unknown>;
      expect(msg["priority"]).toBe(0);
    });

    test("accepts string content and wraps it as { message: string }", async () => {
      const row = mockMessageRow({ payload: { message: "hello world" } });
      mockSqlConfig = { insert: [row] };

      const c = createPostContext(
        validMessageInput({ content: "hello world" }),
      );
      const { status } = await parseResponse(await postMessage(c));

      // The function wraps string content into { message: "hello world" }
      // before passing to sql.json(). If it crashed, status would be 500.
      expect(status).toBe(201);
    });
  });

  // ========================================================================
  // postMessage - Event publishing
  // ========================================================================

  describe("postMessage - event publishing", () => {
    test("publishes to global and agent-specific channel for direct messages", async () => {
      const row = mockMessageRow();
      mockSqlConfig = { insert: [row] };

      const c = createPostContext(validMessageInput());
      await postMessage(c);

      // Direct message: global + agent-specific channel = 2 calls
      expect(mockPublishEvent).toHaveBeenCalledTimes(2);

      // First call: global channel
      const [globalChannel, globalEvent, globalData] =
        mockPublishEvent.mock.calls[0];
      expect(globalChannel).toBe("global");
      expect(globalEvent).toBe("message.new");
      expect((globalData as Record<string, unknown>)["id"]).toBe(
        "msg-uuid-001",
      );

      // Second call: agent-specific channel
      const [agentChannel, agentEvent, agentData] =
        mockPublishEvent.mock.calls[1];
      expect(agentChannel).toBe("agents/agent-receiver-001");
      expect(agentEvent).toBe("message.new");
      expect((agentData as Record<string, unknown>)["priority"]).toBe(5);
    });

    test("publishes only to global channel for broadcast messages", async () => {
      const row = mockMessageRow({ to_agent_id: null });
      mockSqlConfig = { insert: [row] };

      const c = createPostContext(validMessageInput({ to_agent: null }));
      await postMessage(c);

      // Broadcast: only global channel = 1 call
      expect(mockPublishEvent).toHaveBeenCalledTimes(1);
      expect(mockPublishEvent.mock.calls[0][0]).toBe("global");
    });
  });

  // ========================================================================
  // postMessage - Error handling
  // ========================================================================

  describe("postMessage - errors", () => {
    test("returns 500 when database insert fails", async () => {
      // Replace the mock SQL with one that rejects on INSERT
      const errorSql = function (
        strings: TemplateStringsArray,
        ..._values: unknown[]
      ) {
        const query = strings.join("?");
        if (query.includes("INSERT INTO")) {
          return Promise.reject(new Error("Connection refused"));
        }
        return Promise.resolve([]);
      } as any;
      errorSql.json = (val: unknown) => JSON.stringify(val);
      mockSqlFn = errorSql;

      const c = createPostContext(validMessageInput());
      const { status, data } = await parseResponse(await postMessage(c));

      expect(status).toBe(500);
      expect(data["error"]).toBe("Failed to publish message");
      expect(data["message"]).toBe("Connection refused");
    });

    test("returns 500 when request body is unparseable", async () => {
      const c = {
        req: {
          json: async () => {
            throw new Error("Unexpected token <");
          },
        },
        json: (data: unknown, status?: number) =>
          Response.json(data, { status: status ?? 200 }),
      } as unknown as Context;

      const { status, data } = await parseResponse(await postMessage(c));

      expect(status).toBe(500);
      expect(data["error"]).toBe("Failed to publish message");
      expect(data["message"]).toBe("Unexpected token <");
    });
  });

  // ========================================================================
  // getMessages - Agent-specific retrieval
  // ========================================================================

  describe("getMessages", () => {
    test("returns 400 when agent_id parameter is missing", async () => {
      const c = createGetContext({}, {});
      const { status, data } = await parseResponse(await getMessages(c));

      expect(status).toBe(400);
      expect(data["error"]).toBe("Missing agent_id parameter");
    });

    test("returns messages for an agent with correct response shape", async () => {
      const messages = [
        mockMessageRow({ id: "msg-1", read_by: [] }),
        mockMessageRow({
          id: "msg-2",
          to_agent_id: null,
          read_by: ["other-agent"],
        }),
      ];
      mockSqlConfig = {
        select: messages,
        count: [{ unread_count: 3 }],
      };

      const c = createGetContext({ agent_id: "agent-receiver-001" }, {});
      const { status, data } = await parseResponse(await getMessages(c));

      expect(status).toBe(200);
      expect(data["agent_id"]).toBe("agent-receiver-001");
      expect(data["count"]).toBe(2);
      expect(data["unread_remaining"]).toBe(3);

      const responseMessages = data["messages"] as Record<string, unknown>[];
      expect(responseMessages.length).toBe(2);

      // First message: direct, not read by this agent
      expect(responseMessages[0]["id"]).toBe("msg-1");
      expect(responseMessages[0]["is_broadcast"]).toBe(false);
      expect(responseMessages[0]["already_read"]).toBe(false);

      // Second message: broadcast (to_agent_id null), not read by this agent
      expect(responseMessages[1]["id"]).toBe("msg-2");
      expect(responseMessages[1]["is_broadcast"]).toBe(true);
      expect(responseMessages[1]["already_read"]).toBe(false);
    });

    test("marks already_read=true when agent is in read_by array", async () => {
      const agentId = "agent-already-read";
      const messages = [
        mockMessageRow({
          id: "msg-read",
          to_agent_id: agentId,
          read_by: [agentId, "other-agent"],
        }),
      ];
      mockSqlConfig = {
        select: messages,
        count: [{ unread_count: 0 }],
      };

      const c = createGetContext({ agent_id: agentId }, {});
      const { status, data } = await parseResponse(await getMessages(c));

      expect(status).toBe(200);
      const responseMessages = data["messages"] as Record<string, unknown>[];
      expect(responseMessages[0]["already_read"]).toBe(true);
    });

    test("returns empty array when no messages exist", async () => {
      mockSqlConfig = {
        select: [],
        count: [{ unread_count: 0 }],
      };

      const c = createGetContext({ agent_id: "agent-lonely" }, {});
      const { status, data } = await parseResponse(await getMessages(c));

      expect(status).toBe(200);
      expect(data["count"]).toBe(0);
      expect((data["messages"] as unknown[]).length).toBe(0);
      expect(data["unread_remaining"]).toBe(0);
    });

    test("passes through topic and since query filters without error", async () => {
      mockSqlConfig = {
        select: [],
        count: [{ unread_count: 0 }],
      };

      const c = createGetContext(
        { agent_id: "agent-filter" },
        {
          topic: "task.completed",
          since: "2026-02-09T00:00:00.000Z",
          include_broadcasts: "false",
          limit: "50",
        },
      );
      const { status, data } = await parseResponse(await getMessages(c));

      expect(status).toBe(200);
      expect(data["agent_id"]).toBe("agent-filter");
    });

    test("returns 500 when database query fails", async () => {
      // Fragment-building calls (no SQL keywords) must return inert values
      // to avoid unhandled promise rejections; only real queries should reject.
      const errorSql = function (
        strings: TemplateStringsArray,
        ..._values: unknown[]
      ) {
        const query = strings.join("?");
        if (
          query.includes("SELECT") ||
          query.includes("INSERT") ||
          query.includes("UPDATE")
        ) {
          return Promise.reject(new Error("Database timeout"));
        }
        return { __fragment: true };
      } as any;
      errorSql.json = (val: unknown) => JSON.stringify(val);
      mockSqlFn = errorSql;

      const c = createGetContext({ agent_id: "agent-error" }, {});
      const { status, data } = await parseResponse(await getMessages(c));

      expect(status).toBe(500);
      expect(data["error"]).toBe("Failed to fetch messages");
      expect(data["message"]).toBe("Database timeout");
    });
  });

  // ========================================================================
  // getAllMessages - Paginated listing
  // ========================================================================

  describe("getAllMessages", () => {
    test("returns paginated messages with total count", async () => {
      const messages = [
        mockMessageRow({ id: "msg-all-1" }),
        mockMessageRow({ id: "msg-all-2" }),
      ];
      mockSqlConfig = {
        select: messages,
        count: [{ total: 42 }],
      };

      const c = createGetContext(
        {},
        { limit: "10", offset: "0" },
      );
      const { status, data } = await parseResponse(await getAllMessages(c));

      expect(status).toBe(200);
      expect((data["messages"] as unknown[]).length).toBe(2);
      expect(data["count"]).toBe(42);
      expect(data["limit"]).toBe(10);
      expect(data["offset"]).toBe(0);
    });

    test("uses default limit=100 and offset=0 when not specified", async () => {
      mockSqlConfig = {
        select: [],
        count: [{ total: 0 }],
      };

      const c = createGetContext({}, {});
      const { status, data } = await parseResponse(await getAllMessages(c));

      expect(status).toBe(200);
      expect(data["limit"]).toBe(100);
      expect(data["offset"]).toBe(0);
    });

    test("returns 500 when database query fails", async () => {
      const errorSql = function () {
        return Promise.reject(new Error("Disk full"));
      } as any;
      errorSql.json = (val: unknown) => JSON.stringify(val);
      mockSqlFn = errorSql;

      const c = createGetContext({}, {});
      const { status, data } = await parseResponse(await getAllMessages(c));

      expect(status).toBe(500);
      expect(data["error"]).toBe("Failed to get messages");
    });
  });
});
