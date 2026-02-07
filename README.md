# DCM - Distributed Context Manager

Centralized context management service for Claude Code multi-agent architecture. Provides REST API, real-time WebSocket events, intelligent routing, and a premium monitoring dashboard.

## Architecture

```
                    +-------------------+
                    |    PostgreSQL 16   |
                    |   claude_context   |
                    +--------+----------+
                             |
              +--------------+--------------+
              |                             |
     +--------v--------+          +--------v--------+
     |    DCM API       |          |   DCM WebSocket  |
     |  Bun + Hono      |          |  Bun + ws        |
     |  Port 3847       |          |  Port 3849       |
     +--------+---------+          +--------+---------+
              |                             |
              |    LISTEN/NOTIFY            |
              +-----------------------------+
              |
     +--------v--------+
     |  DCM Dashboard   |
     |  Next.js 16      |
     |  Port 3848       |
     +-----------------+
```

### Components

| Component | Stack | Port | Description |
|-----------|-------|------|-------------|
| **DCM API** | Bun, Hono, PostgreSQL | 3847 | REST API with 50+ endpoints |
| **DCM WebSocket** | Bun, ws | 3849 | Real-time events via LISTEN/NOTIFY |
| **DCM Dashboard** | Next.js 16, React 19, Recharts, shadcn/ui | 3848 | Premium monitoring UI |
| **PostgreSQL** | PostgreSQL 16 | 5432 | Persistent storage |

## Quick Start

### Docker (recommended)

```bash
# Clone
git clone git@github.com:ronylicha/Claude-DCM.git
cd Claude-DCM

# Configure
cp context-manager/.env.example .env
# Edit .env with your DB_PASSWORD and WS_AUTH_SECRET

# Start all services
docker compose up -d

# Verify
curl http://localhost:3847/health
open http://localhost:3848
```

### Manual Installation

```bash
# Prerequisites: Bun 1.x, Node.js 22+, PostgreSQL 16+

# 1. Database
createdb claude_context
psql claude_context < context-manager/src/db/schema.sql

# 2. API Server
cd context-manager
cp .env.example .env
# Edit .env with your credentials
bun install
bun run src/server.ts

# 3. WebSocket Server (separate terminal)
cd context-manager
bun run src/websocket-server.ts

# 4. Dashboard (separate terminal)
cd context-dashboard
cp .env.example .env.local
npm install
npm run build
npm start
```

### One-Command Installer

```bash
cd context-manager
chmod +x install.sh
./install.sh
```

This sets up PostgreSQL, installs dependencies, configures systemd services, and starts everything.

## API Overview

Full specification: [`context-manager/openapi.yaml`](context-manager/openapi.yaml)

### Core Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | System health + feature phases |
| GET | `/api/stats` | Global statistics |
| GET | `/api/projects` | List projects |
| POST | `/api/projects` | Create project |
| GET | `/api/sessions/active` | Active sessions with agents |
| POST | `/api/requests` | Track user request |
| POST | `/api/tasks` | Create task/wave |
| POST | `/api/subtasks` | Create subtask |
| POST | `/api/actions` | Log tool action |
| POST | `/api/messages` | Send inter-agent message |
| GET | `/api/messages/poll` | Poll messages for agent |
| POST | `/api/routing/suggest` | Get tool suggestions |
| POST | `/api/routing/feedback` | Submit routing feedback |
| GET | `/api/context/:sessionId` | Generate context brief |
| POST | `/api/auth/token` | Generate HMAC WebSocket token |
| DELETE | `/api/projects/:id` | Delete project |
| DELETE | `/api/sessions/:id` | Delete session |

### WebSocket Protocol

Connect to `ws://localhost:3849` with optional HMAC token authentication.

```javascript
// Subscribe to channels
ws.send(JSON.stringify({
  type: "subscribe",
  channels: ["global", "session:abc123"]
}));

// Receive events
ws.onmessage = (msg) => {
  const event = JSON.parse(msg.data);
  // { event: "task.completed", channel: "global", data: {...}, timestamp: 123 }
};
```

**Event Types:**
- `task.created`, `task.updated`, `task.completed`, `task.failed`
- `subtask.created`, `subtask.updated`, `subtask.completed`, `subtask.failed`
- `message.new`, `message.read`, `message.expired`
- `agent.connected`, `agent.disconnected`, `agent.heartbeat`, `agent.blocked`, `agent.unblocked`
- `session.created`, `session.ended`
- `metric.update`, `system.error`

**Authentication (production):**
```bash
# Generate token
TOKEN=$(curl -s -X POST http://localhost:3847/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "my-agent"}' | jq -r .token)

# Connect with token
wscat -c "ws://localhost:3849?token=$TOKEN"
```

## Dashboard

The dashboard provides real-time monitoring with a premium glassmorphism UI.

### Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Health gauge, KPI cards with sparklines, area/bar charts, live activity feed |
| **Live Activity** | Real-time event stream, semi-circle gauges, agent topology grid |
| **Sessions** | Session list with filters, sort, search |
| **Sessions Detail** | Timeline view with request cards and task items |
| **Projects** | Project list with KPIs, search, delete |
| **Projects Detail** | Project-specific sessions and metrics |
| **Agents** | Agent statistics, active agents, type distribution |
| **Agents Detail** | Per-agent task history and metrics |
| **Tools** | Tool usage analytics, type distribution, success rates |
| **Routing** | Keyword-tool mappings, routing tester with feedback |
| **Messages** | Inter-agent message history with expandable payloads |

### Design System

- **Glassmorphism** cards with backdrop blur
- **8 CSS animations**: fade-in, slide-in, scale-in, pulse-glow, shimmer, count-up, float, stagger
- **Dark mode** with oklch color system
- **Responsive** grid layouts (sm/md/lg breakpoints)
- **Semantic status** indicators with glow effects
- Built on **shadcn/ui** + Radix UI + Tailwind CSS 4

## Claude Code Integration

### Hooks Setup

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

### Client SDK

```typescript
import { DCMClient } from "./context-manager/src/sdk/client";
import { DCMWebSocketClient } from "./context-manager/src/sdk/ws-client";

// REST client
const client = new DCMClient("http://localhost:3847");
const health = await client.getHealth();
const projects = await client.listProjects();

// WebSocket client (auto-reconnect)
const ws = new DCMWebSocketClient("ws://localhost:3849", {
  channels: ["global"],
  onEvent: (event) => console.log(event),
});
await ws.connect();
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `claude_context` | Database name |
| `DB_USER` | `dcm` | Database user |
| `DB_PASSWORD` | *required* | Database password |
| `PORT` | `3847` | API server port |
| `WS_PORT` | `3849` | WebSocket server port |
| `WS_AUTH_SECRET` | - | HMAC secret for WS auth |
| `DASHBOARD_PORT` | `3848` | Dashboard port |
| `DCM_HOST` | `127.0.0.1` | External host for dashboard API URLs |
| `NODE_ENV` | `production` | Environment |

### Systemd Services

Service files are provided for systemd deployment:

```bash
# Copy service files
sudo cp context-manager/context-manager-api.service /etc/systemd/system/
sudo cp context-manager/context-manager-ws.service /etc/systemd/system/
sudo cp context-dashboard/context-dashboard.service /etc/systemd/system/

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable --now context-manager-api context-manager-ws context-dashboard
```

## Database Schema

PostgreSQL with 12 tables:

- `projects` - Project registry (by cwd path)
- `requests` - User prompts/requests
- `tasks` - Task/wave tracking
- `subtasks` - Subtask delegation tracking
- `actions` - Tool execution logging
- `messages` - Inter-agent pub/sub messages
- `subscriptions` - Topic subscriptions
- `blocking_queue` - Agent blocking coordination
- `sessions` - Session metadata
- `context_snapshots` - Context preservation
- `keyword_tool_scores` - Routing intelligence weights
- `routing_feedback` - User feedback on suggestions

## Architecture Decisions

| ADR | Decision | Rationale |
|-----|----------|-----------|
| ADR-001 | PostgreSQL LISTEN/NOTIFY over polling | Near-zero latency, no polling overhead |
| ADR-002 | HMAC-SHA256 for WS auth | No external dependencies, stateless tokens |
| ADR-003 | Single npm package for SDK | Simpler distribution and versioning |
| ADR-004 | Bun-first, Node.js compatible | Performance + broad compatibility |
| ADR-005 | At-least-once delivery (3 retries, 5s ack) | Reliability without complexity of exactly-once |
| ADR-006 | Dev mode allows bare agent_id | Easier development, strict auth in production |

## Tests

```bash
cd context-manager
bun test                    # Run all tests
bun test src/tests/api      # API tests (101 tests)
bun test src/tests/ws       # WebSocket tests (22 tests)
```

## License

MIT
