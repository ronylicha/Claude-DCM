# WebSocket Server - Phase 8

Real-time communication system for the Context Dashboard and inter-agent messaging.

## Architecture

```
                    +-----------------+
                    |   Dashboard     |
                    |  (port 3848)    |
                    +--------+--------+
                             |
                             | WebSocket
                             |
                    +--------v--------+
                    |   WS Server     |
                    |  (port 3849)    |
                    +--------+--------+
                             |
              +--------------+--------------+
              |                             |
     +--------v--------+           +--------v--------+
     |   API Server    |           |    Database     |
     |  (port 3847)    |           |   (PostgreSQL)  |
     +-----------------+           +-----------------+
```

## Quick Start

### Start WebSocket Server Only

```bash
cd ~/.claude/services/context-manager
bun run ws
```

### Start Both API and WebSocket Servers

```bash
cd ~/.claude/services/context-manager
bun run start
# Or
bun run dev:all
```

### Start API Server Only

```bash
bun run dev
```

## Channels

| Channel | Description | Example |
|---------|-------------|---------|
| `global` | System-wide broadcasts | All events |
| `metrics` | KPI updates (every 5s) | Performance metrics |
| `agents/{agent_id}` | Agent-specific messages | `agents/backend-laravel` |
| `sessions/{session_id}` | Session events | `sessions/abc123` |
| `topics/{topic}` | Topic-based messages | `topics/deployments` |

## Events

### Task Events
- `task.created` - New task added to queue
- `task.updated` - Task status changed
- `task.completed` - Task finished successfully
- `task.failed` - Task failed

### Subtask Events
- `subtask.created` - New subtask created
- `subtask.updated` - Subtask in progress
- `subtask.completed` - Subtask finished
- `subtask.failed` - Subtask failed

### Message Events
- `message.new` - New inter-agent message
- `message.read` - Message was read
- `message.expired` - Message TTL expired

### Agent Events
- `agent.connected` - Agent joined
- `agent.disconnected` - Agent left
- `agent.heartbeat` - Agent keepalive

### Metric Events
- `metric.update` - Real-time KPI snapshot

## Client Usage

### JavaScript/TypeScript

```typescript
// Connect
const ws = new WebSocket('ws://127.0.0.1:3849?agent_id=my-agent&session_id=abc123');

// On connected
ws.onopen = () => {
  // Subscribe to a channel
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'global',
    id: 'sub-1',
    timestamp: Date.now()
  }));

  // Authenticate (optional, for private channels)
  ws.send(JSON.stringify({
    type: 'auth',
    agent_id: 'my-agent',
    session_id: 'abc123',
    timestamp: Date.now()
  }));
};

// Handle events
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  if (data.event) {
    console.log(`Event: ${data.event}`, data.data);
  }
};

// Publish an event
ws.send(JSON.stringify({
  type: 'publish',
  channel: 'agents/other-agent',
  event: 'message.new',
  data: { content: 'Hello!' },
  id: 'pub-1',
  timestamp: Date.now()
}));

// Keepalive ping
setInterval(() => {
  ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
}, 25000);
```

### React Hook (Dashboard)

```typescript
import { useWebSocket, useRealtimeMetrics } from '@/hooks/useWebSocket';

// Basic connection
const { connected, lastMessage, send } = useWebSocket({
  channels: ['global'],
  onEvent: (event) => console.log(event)
});

// Real-time metrics
const { metrics, connected } = useRealtimeMetrics();
// metrics: { active_sessions, active_agents, actions_per_minute, ... }
```

## API Endpoints

### Health Check
```
GET http://127.0.0.1:3849/health
```

Response:
```json
{
  "status": "healthy",
  "type": "websocket",
  "port": 3849,
  "connectedClients": 5,
  "activeChannels": 3,
  "channelStats": {
    "global": 5,
    "metrics": 2
  },
  "timestamp": "2026-01-30T12:00:00.000Z"
}
```

### Stats
```
GET http://127.0.0.1:3849/stats
```

## Message Format

### Client to Server

```typescript
// Subscribe
{ type: 'subscribe', channel: 'global', id: 'msg-1', timestamp: 1234567890 }

// Unsubscribe
{ type: 'unsubscribe', channel: 'global', id: 'msg-2', timestamp: 1234567890 }

// Publish
{
  type: 'publish',
  channel: 'agents/target',
  event: 'message.new',
  data: { ... },
  id: 'msg-3',
  timestamp: 1234567890
}

// Auth
{ type: 'auth', agent_id: 'my-agent', session_id: 'abc123', timestamp: 1234567890 }

// Ping
{ type: 'ping', timestamp: 1234567890 }
```

### Server to Client

```typescript
// Connected
{ type: 'connected', client_id: 'ws_abc123_def456', timestamp: 1234567890 }

// Event
{
  channel: 'global',
  event: 'task.completed',
  data: { task_id: '...', status: 'completed' },
  timestamp: 1234567890
}

// Ack
{ type: 'ack', id: 'msg-1', success: true, timestamp: 1234567890 }

// Pong
{ type: 'pong', timestamp: 1234567890 }

// Error
{ error: 'Invalid channel', code: 'INVALID_CHANNEL', timestamp: 1234567890 }
```

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `WS_PORT` | 3849 | WebSocket server port |
| `HOST` | 127.0.0.1 | Bind address |

## Files

| File | Description |
|------|-------------|
| `src/websocket/types.ts` | TypeScript type definitions |
| `src/websocket/handlers.ts` | Connection/message handlers |
| `src/websocket/bridge.ts` | Database to WebSocket bridge |
| `src/websocket/server.ts` | Bun WebSocket server |
| `src/websocket-server.ts` | Entry point |

## Dashboard Integration

The dashboard uses these hooks in `src/hooks/useWebSocket.ts`:

- `useWebSocket()` - Basic WebSocket connection
- `useRealtimeMetrics()` - Subscribe to metrics channel
- `useRealtimeEvents()` - Subscribe to event stream
- `useAgentChannel()` - Agent-specific communication

Pages updated:
- `/live` - Real-time event stream with filtering
- `/dashboard` - Live KPI cards with WebSocket indicator
