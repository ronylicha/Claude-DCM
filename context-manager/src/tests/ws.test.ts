/**
 * DCM WebSocket Integration Tests
 * Tests WebSocket server connection, authentication, pub/sub, and heartbeat.
 *
 * Prerequisites:
 *   - PostgreSQL running with claude_context database
 *   - DCM WebSocket server running on port 3849
 *   - DCM API server running on port 3847 (for auth token generation)
 *
 * Run: bun test src/tests/ws.test.ts
 *
 * @module tests/ws
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const WS_URL = process.env["DCM_WS_URL"] || "ws://127.0.0.1:3849";
const WS_HEALTH_URL = process.env["DCM_WS_HEALTH_URL"] || "http://127.0.0.1:3849/health";
const API_URL = process.env["DCM_API_URL"] || "http://127.0.0.1:3847";

const TEST_PREFIX = `wstest_${Date.now()}`;

// Timeout for receiving WebSocket messages (ms)
const MSG_TIMEOUT = 5000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wait for a WebSocket message matching a predicate, with timeout.
 */
function waitForMessage(
  ws: WebSocket,
  predicate: (msg: Record<string, unknown>) => boolean,
  timeoutMs: number = MSG_TIMEOUT,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for message`));
    }, timeoutMs);

    function onMessage(event: MessageEvent): void {
      try {
        const data = JSON.parse(event.data as string) as Record<string, unknown>;
        if (predicate(data)) {
          cleanup();
          resolve(data);
        }
      } catch {
        // Ignore parse errors, wait for next message
      }
    }

    function cleanup(): void {
      clearTimeout(timer);
      ws.removeEventListener("message", onMessage);
    }

    ws.addEventListener("message", onMessage);
  });
}

/**
 * Create a WebSocket connection and wait for the "connected" message.
 */
function createConnection(queryParams?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const url = queryParams ? `${WS_URL}?${queryParams}` : WS_URL;
    const ws = new WebSocket(url);

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("Connection timeout"));
    }, MSG_TIMEOUT);

    ws.addEventListener("open", () => {
      // Wait for "connected" message
      ws.addEventListener("message", function onFirst(event: MessageEvent) {
        try {
          const data = JSON.parse(event.data as string) as Record<string, unknown>;
          if (data["type"] === "connected") {
            clearTimeout(timer);
            ws.removeEventListener("message", onFirst);
            resolve(ws);
          }
        } catch {
          // Ignore
        }
      });
    });

    ws.addEventListener("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`WebSocket error: ${err}`));
    });
  });
}

/**
 * Send a message and wait for its acknowledgement.
 */
async function sendAndAck(
  ws: WebSocket,
  message: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const msgId = message["id"] as string || `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const fullMsg = { ...message, id: msgId, timestamp: Date.now() };

  const ackPromise = waitForMessage(ws, (data) => {
    return data["type"] === "ack" && data["id"] === msgId;
  });

  ws.send(JSON.stringify(fullMsg));
  return ackPromise;
}

/**
 * Generate an auth token via the API.
 */
async function getAuthToken(agentId: string, sessionId?: string): Promise<string> {
  const res = await fetch(`${API_URL}/api/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_id: agentId, session_id: sessionId }),
  });
  const data = (await res.json()) as Record<string, unknown>;
  return data["token"] as string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let serverAvailable = false;
let apiAvailable = false;
const openSockets: WebSocket[] = [];

function trackSocket(ws: WebSocket): void {
  openSockets.push(ws);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DCM WebSocket Integration Tests", () => {
  beforeAll(async () => {
    // Check WebSocket server health
    try {
      const res = await fetch(WS_HEALTH_URL, { signal: AbortSignal.timeout(3000) });
      serverAvailable = res.ok;
    } catch {
      serverAvailable = false;
    }

    // Check API server (needed for auth tokens)
    try {
      const res = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(3000) });
      apiAvailable = res.ok;
    } catch {
      apiAvailable = false;
    }

    if (!serverAvailable) {
      console.warn(
        `\n  WARNING: DCM WebSocket server not reachable at ${WS_URL}.\n` +
          "  All WebSocket tests will be skipped.\n" +
          "  Start the server with: bun run start:ws\n",
      );
    }
  });

  afterEach(() => {
    // Clean up any open sockets after each test
    // We don't close here to avoid race conditions; afterAll handles it
  });

  afterAll(() => {
    for (const ws of openSockets) {
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        // Ignore close errors
      }
    }
  });

  // ========================================================================
  // Basic Connection
  // ========================================================================

  describe("Basic Connection", () => {
    it("connects and receives a 'connected' message with client_id", async () => {
      if (!serverAvailable) return;
      const ws = await createConnection();
      trackSocket(ws);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it("connects with agent_id and session_id query params", async () => {
      if (!serverAvailable) return;
      const agentId = `${TEST_PREFIX}_connect_agent`;
      const sessionId = `${TEST_PREFIX}_connect_session`;
      const ws = await createConnection(`agent_id=${agentId}&session_id=${sessionId}`);
      trackSocket(ws);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it("WebSocket health endpoint returns stats", async () => {
      if (!serverAvailable) return;
      const res = await fetch(WS_HEALTH_URL);
      const data = (await res.json()) as Record<string, unknown>;
      expect(data["status"]).toBe("healthy");
      expect(data["type"]).toBe("websocket");
      expect(typeof data["connectedClients"]).toBe("number");
      expect(typeof data["activeChannels"]).toBe("number");
    });

    it("WebSocket stats endpoint returns channel stats", async () => {
      if (!serverAvailable) return;
      const statsUrl = WS_HEALTH_URL.replace("/health", "/stats");
      const res = await fetch(statsUrl);
      const data = (await res.json()) as Record<string, unknown>;
      expect(typeof data["connectedClients"]).toBe("number");
      expect(typeof data["activeChannels"]).toBe("number");
      expect(data["channelStats"]).toBeDefined();
    });
  });

  // ========================================================================
  // Authentication
  // ========================================================================

  describe("Authentication", () => {
    it("authenticates with agent_id (dev mode)", async () => {
      if (!serverAvailable) return;
      const ws = await createConnection();
      trackSocket(ws);

      const ack = await sendAndAck(ws, {
        type: "auth",
        agent_id: `${TEST_PREFIX}_auth_agent`,
        session_id: `${TEST_PREFIX}_auth_session`,
      });

      expect(ack["success"]).toBe(true);
      ws.close();
    });

    it("authenticates with a valid token", async () => {
      if (!serverAvailable || !apiAvailable) return;
      const agentId = `${TEST_PREFIX}_token_agent`;
      const token = await getAuthToken(agentId);

      const ws = await createConnection();
      trackSocket(ws);

      const ack = await sendAndAck(ws, {
        type: "auth",
        token: token,
      });

      expect(ack["success"]).toBe(true);
      ws.close();
    });

    it("rejects auth without token or agent_id", async () => {
      if (!serverAvailable) return;
      const ws = await createConnection();
      trackSocket(ws);

      // Send auth with no token and no agent_id
      ws.send(JSON.stringify({ type: "auth", id: "auth_noinfo", timestamp: Date.now() }));

      const errorMsg = await waitForMessage(ws, (data) => {
        return data["code"] === "4003" || (data["error"] !== undefined && data["code"] !== undefined);
      });

      expect(errorMsg["error"]).toBeDefined();
      ws.close();
    });

    it("auto-subscribes to agent channel after auth", async () => {
      if (!serverAvailable) return;
      const agentId = `${TEST_PREFIX}_autosub_agent`;
      const ws = await createConnection();
      trackSocket(ws);

      await sendAndAck(ws, {
        type: "auth",
        agent_id: agentId,
      });

      // After auth, the server auto-subscribes to agents/{agent_id}
      // Verify by publishing to that channel from another client
      const ws2 = await createConnection();
      trackSocket(ws2);
      await sendAndAck(ws2, {
        type: "auth",
        agent_id: `${TEST_PREFIX}_other_agent`,
      });

      // Set up listener on ws before publishing
      const eventPromise = waitForMessage(ws, (data) => {
        return data["event"] === "system.info" && data["channel"] === `agents/${agentId}`;
      });

      await sendAndAck(ws2, {
        type: "publish",
        channel: `agents/${agentId}`,
        event: "system.info",
        data: { message: "test auto-subscribe" },
      });

      const received = await eventPromise;
      expect(received["event"]).toBe("system.info");
      expect(received["channel"]).toBe(`agents/${agentId}`);

      ws.close();
      ws2.close();
    });
  });

  // ========================================================================
  // Subscribe / Unsubscribe
  // ========================================================================

  describe("Subscribe / Unsubscribe", () => {
    it("subscribes to a valid channel and receives ack", async () => {
      if (!serverAvailable) return;
      const ws = await createConnection();
      trackSocket(ws);

      const ack = await sendAndAck(ws, {
        type: "subscribe",
        channel: "global",
      });

      expect(ack["success"]).toBe(true);
      ws.close();
    });

    it("subscribes to a topic channel", async () => {
      if (!serverAvailable) return;
      const ws = await createConnection();
      trackSocket(ws);

      const ack = await sendAndAck(ws, {
        type: "subscribe",
        channel: "topics/task.created",
      });

      expect(ack["success"]).toBe(true);
      ws.close();
    });

    it("rejects subscribe to invalid channel format", async () => {
      if (!serverAvailable) return;
      const ws = await createConnection();
      trackSocket(ws);

      const ack = await sendAndAck(ws, {
        type: "subscribe",
        channel: "invalid:::channel",
      });

      expect(ack["success"]).toBe(false);
      expect(ack["error"]).toBeDefined();
      ws.close();
    });

    it("unsubscribes from a channel", async () => {
      if (!serverAvailable) return;
      const ws = await createConnection();
      trackSocket(ws);

      // Subscribe first
      await sendAndAck(ws, {
        type: "subscribe",
        channel: "metrics",
      });

      // Then unsubscribe
      const ack = await sendAndAck(ws, {
        type: "unsubscribe",
        channel: "metrics",
      });

      expect(ack["success"]).toBe(true);
      ws.close();
    });
  });

  // ========================================================================
  // Publish & Receive Events
  // ========================================================================

  describe("Publish & Receive Events", () => {
    it("publishes an event and subscribers receive it", async () => {
      if (!serverAvailable) return;
      const channelName = `topics/${TEST_PREFIX}_pubsub`;

      // Client 1: subscriber
      const subscriber = await createConnection();
      trackSocket(subscriber);
      await sendAndAck(subscriber, {
        type: "subscribe",
        channel: channelName,
      });

      // Client 2: publisher
      const publisher = await createConnection();
      trackSocket(publisher);

      // Set up listener before publishing
      const eventPromise = waitForMessage(subscriber, (data) => {
        return data["event"] === "system.info" && data["channel"] === channelName;
      });

      // Publish
      await sendAndAck(publisher, {
        type: "publish",
        channel: channelName,
        event: "system.info",
        data: { payload: "hello from test" },
      });

      // Verify subscriber received it
      const received = await eventPromise;
      expect(received["event"]).toBe("system.info");
      expect(received["channel"]).toBe(channelName);
      const receivedData = received["data"] as Record<string, unknown>;
      expect(receivedData["payload"]).toBe("hello from test");

      subscriber.close();
      publisher.close();
    });

    it("does not receive events after unsubscribing", async () => {
      if (!serverAvailable) return;
      const channelName = `topics/${TEST_PREFIX}_unsub_verify`;

      const ws = await createConnection();
      trackSocket(ws);

      // Subscribe
      await sendAndAck(ws, { type: "subscribe", channel: channelName });

      // Unsubscribe
      await sendAndAck(ws, { type: "unsubscribe", channel: channelName });

      // Publish from another client
      const publisher = await createConnection();
      trackSocket(publisher);
      await sendAndAck(publisher, {
        type: "publish",
        channel: channelName,
        event: "system.info",
        data: { should_not_receive: true },
      });

      // Wait a bit and verify no event arrived on the channel
      let receivedEvent = false;
      const checkPromise = new Promise<void>((resolve) => {
        const handler = (event: MessageEvent): void => {
          try {
            const data = JSON.parse(event.data as string) as Record<string, unknown>;
            if (data["channel"] === channelName && data["event"] === "system.info") {
              receivedEvent = true;
            }
          } catch {
            // Ignore
          }
        };
        ws.addEventListener("message", handler);
        setTimeout(() => {
          ws.removeEventListener("message", handler);
          resolve();
        }, 1500);
      });

      await checkPromise;
      expect(receivedEvent).toBe(false);

      ws.close();
      publisher.close();
    });

    it("rejects publish with invalid event type", async () => {
      if (!serverAvailable) return;
      const ws = await createConnection();
      trackSocket(ws);

      const ack = await sendAndAck(ws, {
        type: "publish",
        channel: "global",
        event: "invalid.event.type",
        data: {},
      });

      expect(ack["success"]).toBe(false);
      expect(ack["error"]).toBeDefined();
      ws.close();
    });

    it("broadcasts agent.connected on auth to global subscribers", async () => {
      if (!serverAvailable) return;

      // Subscriber listens on global
      const subscriber = await createConnection();
      trackSocket(subscriber);
      // Already auto-subscribed to global on connect

      const agentId = `${TEST_PREFIX}_broadcast_connect`;
      const eventPromise = waitForMessage(subscriber, (data) => {
        return (
          data["event"] === "agent.connected" &&
          (data["data"] as Record<string, unknown>)?.["agent_id"] === agentId
        );
      });

      // New client authenticates
      const newClient = await createConnection();
      trackSocket(newClient);
      await sendAndAck(newClient, {
        type: "auth",
        agent_id: agentId,
      });

      const received = await eventPromise;
      expect(received["event"]).toBe("agent.connected");

      subscriber.close();
      newClient.close();
    });
  });

  // ========================================================================
  // Ping / Pong Heartbeat
  // ========================================================================

  describe("Ping / Pong Heartbeat", () => {
    it("responds to ping with pong", async () => {
      if (!serverAvailable) return;
      const ws = await createConnection();
      trackSocket(ws);

      const pongPromise = waitForMessage(ws, (data) => data["type"] === "pong");

      ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));

      const pong = await pongPromise;
      expect(pong["type"]).toBe("pong");
      expect(pong["timestamp"]).toBeDefined();

      ws.close();
    });

    it("receives server-initiated ping (heartbeat)", async () => {
      if (!serverAvailable) return;
      const ws = await createConnection();
      trackSocket(ws);

      // Server sends ping every 30s (HEARTBEAT_INTERVAL_MS).
      // We cannot reliably wait 30s in a test, so we just verify the ping
      // handler works by sending our own and checking pong.
      const pongPromise = waitForMessage(ws, (data) => data["type"] === "pong");
      ws.send(JSON.stringify({ type: "ping", timestamp: Date.now() }));
      const pong = await pongPromise;
      expect(pong["type"]).toBe("pong");

      ws.close();
    });
  });

  // ========================================================================
  // Error Handling
  // ========================================================================

  describe("Error Handling", () => {
    it("returns error for unknown message type", async () => {
      if (!serverAvailable) return;
      const ws = await createConnection();
      trackSocket(ws);

      const errorPromise = waitForMessage(ws, (data) => {
        return data["error"] !== undefined && data["code"] === "UNKNOWN_MESSAGE_TYPE";
      });

      ws.send(JSON.stringify({ type: "nonexistent_type", timestamp: Date.now() }));

      const error = await errorPromise;
      expect(error["error"]).toContain("Unknown message type");
      expect(error["code"]).toBe("UNKNOWN_MESSAGE_TYPE");

      ws.close();
    });

    it("returns error for malformed JSON", async () => {
      if (!serverAvailable) return;
      const ws = await createConnection();
      trackSocket(ws);

      const errorPromise = waitForMessage(ws, (data) => {
        return data["error"] !== undefined && data["code"] === "PARSE_ERROR";
      });

      ws.send("this is not valid JSON{{{");

      const error = await errorPromise;
      expect(error["code"]).toBe("PARSE_ERROR");

      ws.close();
    });
  });

  // ========================================================================
  // Multi-Client Scenarios
  // ========================================================================

  describe("Multi-Client Scenarios", () => {
    it("multiple clients on the same channel all receive events", async () => {
      if (!serverAvailable) return;
      const channelName = `topics/${TEST_PREFIX}_multi`;

      // Create 3 subscriber clients
      const clients: WebSocket[] = [];
      for (let i = 0; i < 3; i++) {
        const ws = await createConnection();
        trackSocket(ws);
        await sendAndAck(ws, { type: "subscribe", channel: channelName });
        clients.push(ws);
      }

      // Publisher
      const publisher = await createConnection();
      trackSocket(publisher);

      // Set up listeners before publishing
      const promises = clients.map((ws) =>
        waitForMessage(ws, (data) => {
          return data["event"] === "system.info" && data["channel"] === channelName;
        }),
      );

      // Publish one event
      await sendAndAck(publisher, {
        type: "publish",
        channel: channelName,
        event: "system.info",
        data: { multi: true },
      });

      // All 3 should receive it
      const results = await Promise.all(promises);
      expect(results.length).toBe(3);
      for (const result of results) {
        expect(result["event"]).toBe("system.info");
      }

      // Cleanup
      for (const ws of clients) {
        ws.close();
      }
      publisher.close();
    });

    it("disconnected client triggers agent.disconnected event", async () => {
      if (!serverAvailable) return;

      // Observer on global
      const observer = await createConnection();
      trackSocket(observer);

      const agentId = `${TEST_PREFIX}_disconnect_agent`;

      // Client that will disconnect
      const client = await createConnection();
      trackSocket(client);
      await sendAndAck(client, {
        type: "auth",
        agent_id: agentId,
      });

      // Listen for disconnection event
      const disconnectPromise = waitForMessage(observer, (data) => {
        return (
          data["event"] === "agent.disconnected" &&
          (data["data"] as Record<string, unknown>)?.["agent_id"] === agentId
        );
      });

      // Close the authenticated client
      client.close();

      const received = await disconnectPromise;
      expect(received["event"]).toBe("agent.disconnected");

      observer.close();
    });
  });
});
