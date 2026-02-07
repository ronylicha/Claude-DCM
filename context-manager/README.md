# Distributed Context Manager (DCM)

Centralized context management service for Claude Code multi-agent architecture. Replaces the legacy SQLite system with a distributed PostgreSQL backend, REST API (Hono on Bun), and real-time WebSocket event delivery.

## Architecture

```
                                    +------------------+
                                    |  Dashboard Next  |
                                    |   (port 3848)    |
                                    +--------+---------+
                                             |
              +------------------------------+------------------------------+
              |                              |                              |
              v                              v                              v
    +---------+---------+          +---------+---------+          +--------+--------+
    |  API REST (Hono)  |          |  WebSocket (Bun)  |          |    Hooks CLI    |
    |    (port 3847)    |          |    (port 3849)    |          | (track-usage)   |
    +---------+---------+          +---------+---------+          +--------+--------+
              |                              |                              |
              +------------------------------+------------------------------+
                                             |
                                    +--------v--------+
                                    |   PostgreSQL    |
                                    | (claude_context)|
                                    +-----------------+
```

**API Server (port 3847)** -- Hono HTTP framework on Bun. Handles all REST endpoints for project/task management, inter-agent messaging, routing intelligence, context generation, and session tracking.

**WebSocket Server (port 3849)** -- Bun native WebSocket. Provides real-time event delivery with channel-based pub/sub, HMAC-SHA256 authentication, at-least-once message delivery, and automatic reconnection support via PostgreSQL LISTEN/NOTIFY bridge.

**PostgreSQL** -- Single source of truth. Stores projects, requests, task lists, subtasks, actions, messages, subscriptions, blocking relationships, sessions, and keyword routing scores.

## Features

| Phase | Feature | Status |
|-------|---------|--------|
| 1 | PostgreSQL database with full schema | Done |
| 2 | Action tracking + Intelligent keyword routing | Done |
| 3 | Hierarchy: Project > Request > Task > Subtask | Done |
| 4 | Pub/Sub inter-agent (messages, subscriptions, blocking) | Done |
| 5 | Context Agent Integration (templates, compact restore) | Done |
| 6 | Session management | Done |
| 7 | Tools summary (skills, commands, workflows, plugins) | Done |
| 8 | WebSocket auth + real-time delivery | Done |

## Prerequisites

- **Bun** >= 1.0 -- JavaScript runtime ([install](https://bun.sh/install))
- **PostgreSQL** >= 14 -- Database
- **jq** -- JSON processor (used by install script)

## Quick Start

### Automated Installation

```bash
cd ~/.claude/services/context-manager
chmod +x install.sh
./install.sh
```

The script checks prerequisites, installs dependencies, creates the `.env` file, sets up the database schema, verifies the server, and configures Claude Code hooks.

### Manual Installation

```bash
# 1. Install dependencies
bun install

# 2. Create and configure environment
cp .env.example .env
# Edit .env with your PostgreSQL credentials

# 3. Create database and apply schema
createdb claude_context
psql claude_context < src/db/schema.sql

# 4. Start the servers
bun run start:api   # API on port 3847
bun run start:ws    # WebSocket on port 3849
```

### Verify

```bash
curl http://127.0.0.1:3847/health  # API health
curl http://127.0.0.1:3849/health  # WebSocket health
```

## Configuration

All configuration is via environment variables. Bun loads `.env` automatically.

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `claude_context` | Database name |
| `DB_USER` | *(required)* | Database user |
| `DB_PASSWORD` | *(required)* | Database password |
| `DB_MAX_CONNECTIONS` | `10` | Connection pool size |
| `HOST` | `127.0.0.1` | Server bind address |
| `PORT` | `3847` | API server port |
| `WS_PORT` | `3849` | WebSocket server port |
| `MESSAGE_TTL_MS` | `3600000` | Message expiration (1h) |
| `HEALTHCHECK_INTERVAL_MS` | `30000` | Health check interval |
| `MAX_DB_RETRIES` | `3` | Max DB operation retries |
| `WS_AUTH_SECRET` | `dcm-dev-secret-change-me` | HMAC secret for WS tokens |
| `NODE_ENV` | `development` | Environment mode |

## npm Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `bun run --watch src/server.ts` | API with hot reload |
| `start` | API + WS servers | Both servers |
| `start:api` | `bun run src/server.ts` | API server only |
| `start:ws` | `bun run src/websocket-server.ts` | WebSocket server only |
| `test` | `bun test` | Run all tests |
| `test:watch` | `bun test --watch` | Tests with watch mode |
| `typecheck` | `bun x tsc --noEmit` | TypeScript type checking |
| `setup:db` | `bash scripts/setup-db.sh` | Setup database |
| `setup:hooks` | `bash scripts/setup-hooks.sh` | Setup Claude Code hooks |
| `health` | `bash scripts/health-check.sh` | Health check script |

## API Overview

The API exposes 50 endpoints across 13 modules. Full specification available in [`openapi.yaml`](./openapi.yaml).

### Health and Stats

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Service health with DB latency |
| GET | `/stats` | Aggregate counts |

### Projects

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/projects` | Create/upsert project by path |
| GET | `/api/projects` | List with pagination |
| GET | `/api/projects/:id` | Details with requests and stats |
| GET | `/api/projects/by-path?path=...` | Lookup by filesystem path |

### Requests

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/requests` | Create a user prompt/request |
| GET | `/api/requests` | List with filters |
| GET | `/api/requests/:id` | Details with task lists |
| PATCH | `/api/requests/:id` | Update status/metadata |

### Tasks (Waves)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/tasks` | Create a wave (auto-increment wave_number) |
| GET | `/api/tasks` | List with filters |
| GET | `/api/tasks/:id` | Details with subtasks |
| PATCH | `/api/tasks/:id` | Update status/name |

### Subtasks

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/subtasks` | Create subtask for an agent |
| GET | `/api/subtasks` | List with filters |
| GET | `/api/subtasks/:id` | Details with actions |
| PATCH | `/api/subtasks/:id` | Update status/result/blocking |

### Actions (Tracking)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/actions` | Record a tool invocation |
| GET | `/api/actions` | List with filters |
| GET | `/api/actions/hourly` | Hourly breakdown (24h) |

### Routing (Intelligence)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/routing/suggest?keywords=...` | Tool suggestions by keywords |
| GET | `/api/routing/stats` | Routing statistics |
| POST | `/api/routing/feedback` | Score adjustment |

### Hierarchy

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/hierarchy/:project_id` | Full project tree |
| GET | `/api/active-sessions` | Currently active agents |

### Sessions

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/sessions` | Create session |
| GET | `/api/sessions` | List with filters |
| GET | `/api/sessions/stats` | Aggregate statistics |
| GET | `/api/sessions/:id` | Details with requests |
| PATCH | `/api/sessions/:id` | Update counters/end time |

### Messages (Pub/Sub)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/messages` | Publish (direct or broadcast) |
| GET | `/api/messages/:agent_id` | Retrieve and auto-mark as read |

### Subscriptions

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/subscribe` | Subscribe to a topic |
| GET | `/api/subscriptions` | List all subscriptions |
| GET | `/api/subscriptions/:agent_id` | Agent's subscriptions |
| DELETE | `/api/subscriptions/:id` | Remove by ID |
| POST | `/api/unsubscribe` | Remove by agent + topic |

### Blocking (Coordination)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/blocking` | Block an agent |
| GET | `/api/blocking/:agent_id` | Blocking relationships |
| DELETE | `/api/blocking/:blocked_id` | Remove by record ID |
| POST | `/api/unblock` | Remove by agent pair |
| GET | `/api/blocking/check?blocker=...&blocked=...` | Check specific pair |

### Context

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/context/:agent_id` | Get brief or raw context |
| POST | `/api/context/generate` | Generate context on demand |

### Compact

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/compact/restore` | Restore context after compact |
| GET | `/api/compact/status/:session_id` | Check compact status |

### Other

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/cleanup/stats` | Message cleanup stats |
| GET | `/stats/tools-summary` | Skills/commands/workflows/plugins count |
| POST | `/api/auth/token` | Generate WebSocket auth token |

## WebSocket Protocol

### Connection

```javascript
const ws = new WebSocket('ws://127.0.0.1:3849?agent_id=my-agent&session_id=session-123');

ws.onopen = () => {
  // Authenticate (required for private channels)
  ws.send(JSON.stringify({
    type: 'auth',
    id: 'auth-1',
    agent_id: 'backend-laravel',
    session_id: 'session-123',
    timestamp: Date.now()
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.type, data);
};
```

### Token-Based Authentication

```bash
# 1. Get a token from the API
TOKEN=$(curl -s -X POST http://127.0.0.1:3847/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"agent_id":"my-agent"}' | jq -r '.token')

# 2. Use it during WebSocket auth
ws.send(JSON.stringify({ type: 'auth', token: TOKEN, timestamp: Date.now() }));
```

### Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `auth` | Client -> Server | Authenticate with token or agent_id |
| `subscribe` | Client -> Server | Subscribe to a channel |
| `unsubscribe` | Client -> Server | Unsubscribe from a channel |
| `publish` | Client -> Server | Publish event to a channel |
| `ping` | Client -> Server | Keepalive ping |
| `connected` | Server -> Client | Connection established with client_id |
| `ack` | Server -> Client | Acknowledgement of a message |
| `pong` | Server -> Client | Keepalive response |
| `event` | Server -> Client | Incoming event from a subscribed channel |
| `error` | Server -> Client | Error message with code |

### Channels

| Channel | Description | Auth Required |
|---------|-------------|---------------|
| `global` | All events (auto-subscribed) | No |
| `metrics` | Performance metrics (every 5s) | No |
| `agents/{agent_id}` | Agent-specific events | Yes (own channel) |
| `sessions/{session_id}` | Session-specific events | Yes |
| `topics/{topic}` | Topic-based filtering | No |

### Event Types

Tasks: `task.created`, `task.updated`, `task.completed`, `task.failed`
Subtasks: `subtask.created`, `subtask.updated`, `subtask.completed`, `subtask.failed`
Messages: `message.new`, `message.read`, `message.expired`
Agents: `agent.connected`, `agent.disconnected`, `agent.heartbeat`, `agent.blocked`, `agent.unblocked`
Sessions: `session.created`, `session.ended`
Metrics: `metric.update`
System: `system.error`, `system.info`

## SDK Usage

The project includes a TypeScript SDK client for programmatic access.

```typescript
import { DCMClient } from './src/sdk/client';
import { DCMWebSocketClient } from './src/sdk/ws-client';

// REST client
const client = new DCMClient('http://127.0.0.1:3847');
const project = await client.createProject('/path/to/project', 'My Project');
const tasks = await client.listTasks({ request_id: 'uuid' });

// WebSocket client
const ws = new DCMWebSocketClient('ws://127.0.0.1:3849');
await ws.connect('my-agent', 'session-123');
ws.subscribe('global');
ws.on('task.completed', (data) => console.log('Task done:', data));
```

## Docker Deployment

```bash
# Start all services (PostgreSQL + API + WebSocket)
DB_PASSWORD=your_secure_password docker compose up -d

# Check health
curl http://127.0.0.1:3847/health

# View logs
docker compose logs -f dcm-api dcm-ws
```

The `docker-compose.yml` includes:
- **postgres**: PostgreSQL 16 Alpine with auto-applied schema
- **dcm-api**: API server (port 3847)
- **dcm-ws**: WebSocket server (port 3849)

## systemd Deployment

```bash
# Copy service files
sudo cp context-manager-api.service /etc/systemd/system/
sudo cp context-manager-ws.service /etc/systemd/system/

# Enable and start
sudo systemctl enable context-manager-api context-manager-ws
sudo systemctl start context-manager-api context-manager-ws

# Check status
sudo systemctl status context-manager-api
sudo systemctl status context-manager-ws
```

## Context Templates

The DCM generates context briefs tailored to each agent type:

| Category | Agents | Template Focus |
|----------|--------|----------------|
| orchestrator | project-supervisor, tech-lead | Global view, active tasks, blockers |
| developer | backend-*, frontend-*, database-* | Code context, tests, technical docs |
| validator | qa-testing, security-*, regression-guard | Validation criteria, tests to run |
| specialist | *-specialist, *-expert | Domain-specific best practices |

## Claude Code Hooks

The `track-usage.sh` hook automatically records tool usage:

```json
{
  "hooks": {
    "PostToolUse": [
      "~/.claude/services/context-manager/hooks/track-usage.sh"
    ]
  }
}
```

Environment variables consumed by the hook:
- `CLAUDE_TOOL_NAME` -- Tool name
- `CLAUDE_TOOL_INPUT` -- Input (truncated to 10KB)
- `CLAUDE_TOOL_OUTPUT` -- Output (truncated to 10KB)
- `CLAUDE_EXIT_CODE` -- Exit code
- `CLAUDE_SESSION_ID` -- Session ID
- `CLAUDE_PROJECT_PATH` -- Project path

## Testing

```bash
# Run all tests
bun test

# Run API integration tests (requires running server + database)
bun test src/tests/api.test.ts

# Run WebSocket tests (requires running API + WS servers)
bun test src/tests/ws.test.ts

# Watch mode
bun test --watch
```

Tests are integration tests that run against live servers. Start both servers before running tests:

```bash
bun run start:api &
bun run start:ws &
bun test
```

## Project Structure

```
context-manager/
  src/
    server.ts              # API entry point (Hono on Bun)
    websocket-server.ts    # WebSocket entry point
    config.ts              # Environment configuration
    cleanup.ts             # Expired message cleanup
    context-generator.ts   # Context brief generation
    api/                   # REST API handlers
      actions.ts           #   Tool tracking
      blocking.ts          #   Agent blocking
      compact.ts           #   Compact restore
      context.ts           #   Context retrieval
      messages.ts          #   Pub/sub messaging
      projects.ts          #   Project management
      requests.ts          #   User requests
      routing.ts           #   Intelligent routing
      sessions.ts          #   Session management
      subscriptions.ts     #   Topic subscriptions
      subtasks.ts          #   Subtask management
      tasks.ts             #   Task (wave) management
      tools-summary.ts     #   Tools counting
    context/
      types.ts             # Context type definitions
    db/
      client.ts            # PostgreSQL client (postgres.js)
      schema.sql           # Database schema
    sdk/
      client.ts            # REST SDK client
      ws-client.ts         # WebSocket SDK client
      index.ts             # SDK exports
      types.ts             # SDK types
    templates/             # Context brief templates
      index.ts             #   Template router
      developer.ts         #   Developer agent template
      orchestrator.ts      #   Orchestrator template
      specialist.ts        #   Specialist template
      validator.ts         #   Validator template
    websocket/
      server.ts            # WS server with heartbeat
      handlers.ts          # Message handlers + broadcast
      bridge.ts            # PostgreSQL LISTEN/NOTIFY bridge
      auth.ts              # HMAC-SHA256 token auth
      types.ts             # WS type definitions
      index.ts             # WS exports
    tests/
      api.test.ts          # API integration tests
      ws.test.ts           # WebSocket integration tests
  hooks/
    track-usage.sh         # Claude Code PostToolUse hook
  scripts/
    setup-db.sh            # Database setup
    setup-hooks.sh         # Hook configuration
  openapi.yaml             # OpenAPI 3.0 specification
  docker-compose.yml       # Docker deployment
  Dockerfile               # Container image
  package.json
  tsconfig.json
```

## Troubleshooting

### Database connection fails

```bash
pg_isready -h localhost -p 5432
psql -U $DB_USER -d claude_context -c "SELECT 1;"
```

### WebSocket not responding

```bash
lsof -i :3849
curl http://127.0.0.1:3849/health
```

### Hooks not tracking

```bash
# Test manually
CLAUDE_TOOL_NAME=Test CLAUDE_TOOL_TYPE=builtin \
  ~/.claude/services/context-manager/hooks/track-usage.sh

# Check API
curl http://127.0.0.1:3847/api/actions?limit=1
```

### Tests skipping

If tests output `[SKIP]` messages, ensure both servers are running:

```bash
bun run start:api &
bun run start:ws &
bun test
```

## License

MIT
