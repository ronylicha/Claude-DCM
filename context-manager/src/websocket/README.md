# DCM WebSocket Server

Real-time event streaming for the Distributed Context Manager, built on Bun native WebSocket.

Runs on port **3849** alongside the API server (3847) and dashboard (3848). Events flow from PostgreSQL LISTEN/NOTIFY through the bridge layer and out to all subscribed clients.

## Connection

    ws://127.0.0.1:3849?agent_id=<agent_id>&session_id=<session_id>

Both query parameters are optional. On connection, the server assigns a unique client ID and auto-subscribes the client to the `global` channel.

Upgrade paths: `/` or `/ws`.

## Channels

| Channel | Pattern | Description |
|---------|---------|-------------|
| `global` | -- | All events, auto-subscribed on connect |
| `metrics` | -- | KPI snapshots every 5 seconds |
| `agents/{id}` | `agents/backend-laravel` | Agent-scoped events, auto-subscribed on auth |
| `sessions/{id}` | `sessions/abc123` | Session-scoped events, auto-subscribed on auth |
| `topics/{topic}` | `topics/deployments` | Arbitrary topic-based grouping |

Agent channels are private: subscribing to another agent's channel requires authentication.

## Events

| Category | Events |
|----------|--------|
| Task | `task.created`, `task.updated`, `task.completed`, `task.failed` |
| Subtask | `subtask.created`, `subtask.updated`, `subtask.completed`, `subtask.failed`, `subtask.running` |
| Message | `message.new`, `message.read`, `message.expired` |
| Agent | `agent.connected`, `agent.disconnected`, `agent.heartbeat`, `agent.blocked`, `agent.unblocked` |
| Session | `session.created`, `session.ended` |
| Metric | `metric.update` |
| System | `system.error`, `system.info` |

Task, subtask, and message events use at-least-once delivery with retry (up to 3 attempts, 5s ack timeout).

## Wire Protocol

### Client to Server

Subscribe to a channel:

    { "type": "subscribe", "channel": "metrics", "id": "sub-1", "timestamp": 1706000000000 }

Unsubscribe:

    { "type": "unsubscribe", "channel": "metrics", "id": "unsub-1", "timestamp": 1706000000000 }

Publish an event to a channel:

    {
      "type": "publish",
      "channel": "agents/frontend",
      "event": "message.new",
      "data": { "content": "hello" },
      "id": "pub-1",
      "timestamp": 1706000000000
    }

Authenticate (token required in production, agent_id alone accepted in dev):

    {
      "type": "auth",
      "agent_id": "my-agent",
      "session_id": "sess-1",
      "token": "...",
      "timestamp": 1706000000000
    }

Keepalive ping:

    { "type": "ping", "timestamp": 1706000000000 }

Acknowledge a tracked message:

    { "type": "ack", "message_id": "msg_abc123", "timestamp": 1706000000000 }

### Server to Client

Connection confirmation:

    { "type": "connected", "client_id": "ws_m1abc_x7k9f2", "timestamp": 1706000000000 }

Event delivery:

    {
      "id": "msg_abc123",
      "channel": "global",
      "event": "task.completed",
      "data": { "task_id": "...", "status": "completed" },
      "timestamp": 1706000000000
    }

Operation acknowledgment:

    { "type": "ack", "id": "sub-1", "success": true, "timestamp": 1706000000000 }

Pong:

    { "type": "pong", "timestamp": 1706000000000 }

Error:

    { "error": "Invalid channel format: bad/channel/path", "code": "INVALID_CHANNEL", "timestamp": 1706000000000 }

## Client Examples

### TypeScript -- Connect, Subscribe, Handle Events

```typescript
const ws = new WebSocket("ws://127.0.0.1:3849?agent_id=my-agent&session_id=sess-1");

ws.onopen = () => {
  // Authenticate (required for private channel access)
  ws.send(JSON.stringify({
    type: "auth",
    agent_id: "my-agent",
    session_id: "sess-1",
    timestamp: Date.now(),
  }));

  // Subscribe to metrics
  ws.send(JSON.stringify({
    type: "subscribe",
    channel: "metrics",
    id: "sub-metrics",
    timestamp: Date.now(),
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.type) {
    case "connected":
      console.log("Connected as", msg.client_id);
      break;
    case "ack":
      console.log("Ack:", msg.id, msg.success);
      break;
    case "ping":
      ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
      break;
    default:
      if (msg.event) {
        console.log("[" + msg.channel + "] " + msg.event, msg.data);
        // Acknowledge tracked messages
        if (msg.id) {
          ws.send(JSON.stringify({ type: "ack", message_id: msg.id, timestamp: Date.now() }));
        }
      }
  }
};
```

### TypeScript -- Publish an Event

```typescript
ws.send(JSON.stringify({
  type: "publish",
  channel: "agents/backend-laravel",
  event: "message.new",
  data: { content: "Migration complete", priority: 1 },
  id: "pub-1",
  timestamp: Date.now(),
}));
```

## Dashboard Integration

The Next.js dashboard (port 3848) connects via React hooks defined in `src/hooks/useWebSocket.ts`:

| Hook | Purpose |
|------|---------|
| `useWebSocket({ channels, onEvent })` | Manages connection lifecycle and channel subscriptions |
| `useRealtimeMetrics()` | Subscribes to the `metrics` channel, returns live KPI data |
| `useRealtimeEvents()` | Subscribes to the event stream for the `/live` page |
| `useAgentChannel(agentId)` | Subscribes to a specific agent channel |

The dashboard pages `/live` (event stream with filtering) and `/dashboard` (KPI cards) consume these hooks.

## HTTP Endpoints

The WebSocket server also serves two HTTP endpoints on the same port:

| Endpoint | Response |
|----------|----------|
| `GET /health` | Server status, connected client count, active channels, channel subscriber counts |
| `GET /stats` | Connected clients, active channels, channel stats, pending delivery count |

## Authentication

HMAC-SHA256 tokens with 1-hour TTL. Token format: `base64url(payload).signature`.

- **Development**: `agent_id` alone is accepted without a token.
- **Production**: A valid token is required (`WS_AUTH_SECRET` env var must be set).

On successful auth, the server auto-subscribes the client to `agents/{agent_id}` and `sessions/{session_id}`, and restores any previous subscriptions from a prior connection.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `WS_PORT` | `3849` | WebSocket server port |
| `HOST` | `127.0.0.1` | Bind address |
| `WS_AUTH_SECRET` | `dcm-dev-secret-change-me` | HMAC signing secret |

## Internals

| File | Role |
|------|------|
| `server.ts` | Bun.serve setup, HTTP upgrade, heartbeat loop (30s interval, 60s timeout) |
| `handlers.ts` | Client registry, channel management, message routing, delivery retry |
| `bridge.ts` | PostgreSQL LISTEN/NOTIFY to WebSocket bridge, metrics polling (5s) |
| `auth.ts` | HMAC-SHA256 token generation and validation |
| `types.ts` | TypeScript types for channels, events, and wire protocol |
| `index.ts` | Module re-exports |
