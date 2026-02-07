# DCM - Distributed Context Manager

Centralized context management for Claude Code multi-agent architecture. Tracks every tool invocation, agent delegation, and session in real-time with a premium monitoring dashboard.

## Architecture

```
                         ┌──────────────────┐
                         │  PostgreSQL 16    │
                         │  claude_context   │
                         │  12 tables        │
                         └────────┬─────────┘
                                  │
                    LISTEN/NOTIFY │ bridge
                  ┌───────────────┼───────────────┐
                  │               │               │
         ┌────────▼───────┐ ┌────▼────────┐ ┌────▼────────────┐
         │   DCM API       │ │  DCM WS     │ │  DCM Dashboard   │
         │   Bun + Hono    │ │  Bun + ws   │ │  Next.js 16      │
         │   Port 3847     │ │  Port 3849  │ │  Port 3848       │
         │   50+ endpoints │ │  Real-time  │ │  Glassmorphism   │
         └────────┬────────┘ └─────────────┘ └──────────────────┘
                  │
    ┌─────────────┼─────────────┐
    │             │             │
┌───▼───┐   ┌────▼────┐   ┌───▼────┐
│ Hooks │   │  SDK    │   │ cURL   │
│ (bash)│   │  (TS)   │   │        │
└───────┘   └─────────┘   └────────┘
```

| Component | Stack | Port | Description |
|-----------|-------|------|-------------|
| **DCM API** | Bun, Hono, postgres.js, Zod | 3847 | REST API - 50+ endpoints, CRUD, routing intelligence |
| **DCM WebSocket** | Bun, ws, LISTEN/NOTIFY | 3849 | Real-time events, HMAC auth, auto-reconnect |
| **DCM Dashboard** | Next.js 16, React 19, Recharts, shadcn/ui | 3848 | Premium monitoring with glassmorphism UI |
| **PostgreSQL** | PostgreSQL 16 | 5432 | 12 tables, 4 views, 15+ indexes, JSONB metadata |

## Quick Start

### Docker (recommended)

```bash
git clone git@github.com:ronylicha/Claude-DCM.git
cd Claude-DCM

# Configure
cp context-manager/.env.example .env
# Edit .env: set DB_PASSWORD and WS_AUTH_SECRET

# Start all 4 services
docker compose up -d

# Verify
curl http://localhost:3847/health
open http://localhost:3848
```

### One-Command Installer

```bash
cd context-manager
chmod +x install.sh
./install.sh
```

### Manual Installation

```bash
# Prerequisites: Bun 1.x, Node.js 22+, PostgreSQL 16+

# 1. Database
createdb claude_context
psql claude_context < context-manager/src/db/schema.sql

# 2. API Server
cd context-manager
cp .env.example .env    # Edit with your credentials
bun install
bun run src/server.ts

# 3. WebSocket Server (separate terminal)
cd context-manager
bun run src/websocket-server.ts

# 4. Dashboard (separate terminal)
cd context-dashboard
cp .env.example .env.local
npm install && npm run build && npm start
```

## How It Works

### Data Flow

Every tool Claude Code uses is automatically tracked:

```
Claude Code Session
  │
  ├─ Read, Write, Bash, Grep...     ──→ track-action.sh ──→ POST /api/actions
  │                                       │
  │                                       ├─ Store action in PostgreSQL
  │                                       ├─ Auto-create/update session
  │                                       ├─ Auto-create project
  │                                       ├─ Extract keywords → routing scores
  │                                       └─ NOTIFY → WebSocket → Dashboard
  │
  └─ Task (agent delegation)         ──→ track-agent.sh  ──→ POST /api/subtasks
                                          │
                                          ├─ Auto-create request→task chain
                                          ├─ Create subtask (agent_type, status)
                                          └─ NOTIFY → WebSocket → Dashboard
```

### Database Schema

```
projects ──→ requests ──→ task_lists ──→ subtasks ──→ actions
    │                                                    │
    └── sessions (auto-created)        keyword_tool_scores (routing)
                                       agent_messages (pub/sub)
                                       agent_contexts (compact/restore)
```

| Table | Purpose |
|-------|---------|
| `projects` | Project registry by filesystem path |
| `requests` | User prompts with session tracking |
| `task_lists` | Waves/groups of objectives |
| `subtasks` | Agent delegation with status tracking |
| `actions` | Every tool invocation (compressed I/O) |
| `sessions` | Session lifecycle with counters |
| `keyword_tool_scores` | Routing intelligence weights |
| `agent_messages` | Inter-agent pub/sub messaging |
| `agent_contexts` | Context snapshots for compact/restore |

## Claude Code Integration

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "command": "/path/to/context-manager/hooks/track-action.sh"
      },
      {
        "matcher": "Task",
        "command": "/path/to/context-manager/hooks/track-agent.sh"
      }
    ]
  }
}
```

Hooks are fire-and-forget (2s timeout) and never block Claude Code.

## API Overview

Full specification: [`context-manager/openapi.yaml`](context-manager/openapi.yaml) | Detailed docs: [`docs/API.md`](docs/API.md)

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Service health + feature phases |
| `GET` | `/api/stats` | Global statistics |
| **Projects** | | |
| `POST` | `/api/projects` | Create/upsert project |
| `GET` | `/api/projects` | List projects |
| `GET` | `/api/projects/by-path` | Lookup by filesystem path |
| **Sessions** | | |
| `GET` | `/api/sessions` | List sessions (with counters) |
| `GET` | `/api/sessions/stats` | Session statistics |
| **Tracking** | | |
| `POST` | `/api/actions` | Log tool action (auto-creates session) |
| `GET` | `/api/actions` | List actions with filters |
| `GET` | `/api/actions/hourly` | 24h hourly distribution |
| **Hierarchy** | | |
| `POST` | `/api/requests` | Create user request |
| `POST` | `/api/tasks` | Create task/wave |
| `POST` | `/api/subtasks` | Create subtask (agent delegation) |
| `GET` | `/api/hierarchy/:project_id` | Full project hierarchy |
| **Routing** | | |
| `GET` | `/api/routing/suggest` | Keyword-based tool suggestions |
| `POST` | `/api/routing/feedback` | Submit routing feedback |
| **Messaging** | | |
| `POST` | `/api/messages` | Send inter-agent message |
| `GET` | `/api/messages/:agent_id` | Poll messages for agent |
| **Context** | | |
| `GET` | `/api/context/:agent_id` | Generate context brief |
| `POST` | `/api/compact/restore` | Restore after compact |
| **Auth** | | |
| `POST` | `/api/auth/token` | Generate HMAC WebSocket token |

### WebSocket Protocol

```javascript
// Connect
const ws = new WebSocket("ws://localhost:3849");

// Subscribe to channels
ws.send(JSON.stringify({
  type: "subscribe",
  channels: ["global", "agents/backend-laravel"]
}));

// Receive real-time events
ws.onmessage = (msg) => {
  const event = JSON.parse(msg.data);
  // { event: "action.created", channel: "global", data: {...}, timestamp: 123 }
};
```

**Event Types:** `action.created`, `task.created/updated/completed/failed`, `subtask.created/updated/completed/failed`, `session.created/ended`, `message.new`, `agent.connected/disconnected`, `metric.update`

**Authentication (production):**
```bash
TOKEN=$(curl -s -X POST http://localhost:3847/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "my-agent"}' | jq -r .token)

wscat -c "ws://localhost:3849?token=$TOKEN"
```

## Client SDK

```typescript
import { DCMClient } from "./context-manager/src/sdk/client";
import { DCMWebSocketClient } from "./context-manager/src/sdk/ws-client";

// REST client
const client = new DCMClient("http://localhost:3847");
await client.recordAction({
  tool_name: "Read", tool_type: "builtin",
  session_id: "my-session", exit_code: 0
});
const suggestions = await client.suggestTool(["react", "component"]);

// WebSocket client (auto-reconnect, exponential backoff)
const ws = new DCMWebSocketClient("ws://localhost:3849", {
  channels: ["global"],
  onEvent: (event) => console.log(event),
});
await ws.connect();
ws.onEvent("action.created", (data) => console.log(data.tool_name));
```

## Dashboard

Premium monitoring UI at `http://localhost:3848` with real-time updates via WebSocket.

| Page | Features |
|------|----------|
| **Dashboard** | Health gauge, KPI cards with sparklines, area/bar charts, live activity feed |
| **Live Activity** | Real-time event stream, semi-circle gauges, agent topology grid |
| **Sessions** | Session list with filters, sort, search, tool counters |
| **Session Detail** | Timeline view with request cards and task items |
| **Projects** | Project list with KPIs, search, delete |
| **Project Detail** | Project-specific sessions and metrics |
| **Agents** | Agent statistics, active agents, type distribution |
| **Agent Detail** | Per-agent task history and metrics |
| **Tools** | Tool usage analytics, type distribution, success rates |
| **Routing** | Keyword-tool mappings, routing tester with live feedback |
| **Messages** | Inter-agent message history with expandable payloads |

**Design System:** Glassmorphism cards, 8 CSS animations, dark mode (oklch), responsive grids, shadcn/ui + Radix UI + Tailwind CSS 4

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `claude_context` | Database name |
| `DB_USER` | `dcm` | Database user |
| `DB_PASSWORD` | *required* | Database password |
| `PORT` | `3847` | API server port |
| `WS_PORT` | `3849` | WebSocket server port |
| `WS_AUTH_SECRET` | - | HMAC secret for WS auth (required in production) |
| `DASHBOARD_PORT` | `3848` | Dashboard port |
| `DCM_HOST` | `127.0.0.1` | External host for dashboard API URLs |
| `NODE_ENV` | `production` | Environment (dev mode allows bare WS auth) |

## Architecture Decisions

| ADR | Decision | Rationale |
|-----|----------|-----------|
| 001 | PostgreSQL LISTEN/NOTIFY over polling | Near-zero latency, no polling overhead |
| 002 | HMAC-SHA256 for WS auth | Stateless tokens, no external dependencies |
| 003 | Single npm package for SDK | Simpler distribution and versioning |
| 004 | Bun-first, Node.js compatible | Performance + broad compatibility |
| 005 | At-least-once delivery (3 retries, 5s ack) | Reliability without exactly-once complexity |
| 006 | Dev mode allows bare agent_id | Easier development, strict auth in production |
| 007 | JSONB for metadata columns | Flexible schema, indexed queries |
| 008 | Separate WS server process | Independent scaling, cleaner architecture |

## Tests

```bash
cd context-manager
bun test                    # Run all (123 tests)
bun test src/tests/api      # API tests (101 tests)
bun test src/tests/ws       # WebSocket tests (22 tests)
```

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System design, data flow, database schema, ADRs |
| [`docs/API.md`](docs/API.md) | Full API reference with examples |
| [`docs/INTEGRATION.md`](docs/INTEGRATION.md) | Claude Code hooks setup, SDK usage |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Docker, systemd, manual deployment guides |
| [`context-manager/openapi.yaml`](context-manager/openapi.yaml) | OpenAPI 3.0 specification |

## License

MIT
