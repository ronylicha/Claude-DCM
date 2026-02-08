# DCM - Distributed Context Manager

Context management for Claude Code multi-agent sessions. Tracks tool usage, agent delegation, and sessions in real-time -- and now handles compact save/restore so agents don't lose context when the conversation window fills up.

## Architecture

```
                         ┌──────────────────┐
                         │  PostgreSQL 16    │
                         │  claude_context   │
                         │  10 tables        │
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

| Component         | Stack                                     | Port | Description                                          |
| ----------------- | ----------------------------------------- | ---- | ---------------------------------------------------- |
| **DCM API**       | Bun, Hono, Bun.sql, Zod                   | 3847 | REST API, compact save/restore, routing intelligence |
| **DCM WebSocket** | Bun native WS, LISTEN/NOTIFY              | 3849 | Real-time events, HMAC auth, auto-reconnect          |
| **DCM Dashboard** | Next.js 16, React 19, Recharts, shadcn/ui | 3848 | Monitoring UI with live activity feed                |
| **PostgreSQL**    | PostgreSQL 16                             | 5432 | 10 tables, 4 views, 20+ indexes, JSONB metadata      |

## Quick start

### DCM CLI (recommended)

The `dcm` CLI handles everything: dependencies, database, hooks, and services.

```bash
git clone git@github.com:ronylicha/Claude-DCM.git
cd Claude-DCM/context-manager

# One command: installs deps, creates DB, injects Claude Code hooks
./dcm install

# Start API + WebSocket + Dashboard
./dcm start

# Check everything is running
./dcm status
```

That's it. The installer auto-injects hooks into `~/.claude/settings.json` (with backup) so Claude Code starts tracking immediately. Restart Claude Code to pick up the new hooks.

### Docker

```bash
cp context-manager/.env.example .env
# Edit .env: set DB_PASSWORD and WS_AUTH_SECRET

docker compose up -d

curl http://localhost:3847/health
```

With Docker, you still need to run `./dcm hooks` to inject hooks into your Claude Code settings.

### Manual setup

```bash
# Prerequisites: Bun 1.x, Node.js 22+, PostgreSQL 16+, jq

# 1. Database
createdb claude_context
psql claude_context < context-manager/src/db/schema.sql

# 2. API Server
cd context-manager
cp .env.example .env    # Edit with your credentials
bun install
bun run src/server.ts

# 3. WebSocket Server (separate terminal)
bun run src/websocket-server.ts

# 4. Dashboard (separate terminal)
cd ../context-dashboard
cp .env.example .env.local
npm install && npm run build && npm start

# 5. Install hooks
cd ../context-manager
./scripts/setup-hooks.sh
```

### As a Claude Code plugin

If you prefer plugin auto-discovery over global hooks injection:

```bash
# Copy or symlink context-manager/ into your plugins directory
ln -s /path/to/Claude-DCM/context-manager ~/.claude/plugins/dcm
```

The `.claude-plugin/plugin.json` manifest and `hooks/hooks.json` handle registration automatically. Claude Code picks up the hooks on next restart.

## How it works

### Hooks

DCM uses Claude Code hooks to track and manage context automatically. All hooks are fire-and-forget with short timeouts -- they never block Claude.

```
Claude Code Session
  │
  ├─ Any tool call         → track-action.sh      → POST /api/actions
  ├─ Task (agent spawn)    → track-agent.sh       → POST /api/subtasks
  ├─ Any tool call (1/10)  → monitor-context.sh   → checks transcript size
  │
  ├─ Before compact        → pre-compact-save.sh  → POST /api/compact/save
  ├─ After compact         → post-compact-restore.sh → injects context back
  │
  ├─ Agent finishes        → save-agent-result.sh → POST /api/messages (broadcast)
  ├─ Session start         → track-session.sh     → creates session record
  └─ Session end           → track-session-end.sh → cleanup
```

### Compact save/restore

When Claude's context window fills up, it compacts the conversation. Without DCM, agents lose track of what happened before. DCM fixes this:

1. **Before compact**: `pre-compact-save.sh` saves active tasks, modified files, agent states, and key decisions to the database
2. **After compact**: `post-compact-restore.sh` fetches a context brief and injects it back into the session via `additionalContext`
3. **Proactive monitoring**: `monitor-context.sh` runs every 10th tool call. If the transcript exceeds 800KB, it triggers an early snapshot -- so even if compact happens unexpectedly, the data is already saved

### Cross-agent sharing

When a subagent finishes, `save-agent-result.sh` broadcasts its result as a message. Other agents can pick this up through the context API, so work doesn't get siloed.

### Database schema

```
projects ──→ requests ──→ task_lists ──→ subtasks ──→ actions
    │                                                    │
    └── sessions (auto-created)        keyword_tool_scores (routing)
                                       agent_messages (pub/sub)
                                       agent_contexts (compact/restore)
```

| Table                 | Purpose                                |
| --------------------- | -------------------------------------- |
| `projects`            | Project registry by filesystem path    |
| `requests`            | User prompts with session tracking     |
| `task_lists`          | Waves/groups of objectives             |
| `subtasks`            | Agent delegation with status tracking  |
| `actions`             | Every tool invocation (compressed I/O) |
| `sessions`            | Session lifecycle with counters        |
| `keyword_tool_scores` | Routing intelligence weights           |
| `agent_messages`      | Inter-agent pub/sub messaging          |
| `agent_contexts`      | Context snapshots for compact/restore  |

## Claude Code integration

Hooks are injected automatically by `dcm install` or `dcm hooks`. You can also run the setup script directly:

```bash
./scripts/setup-hooks.sh          # inject hooks
./scripts/setup-hooks.sh --force  # re-inject (idempotent)
```

The script merges DCM hooks into your existing `~/.claude/settings.json` without touching non-DCM hooks. It backs up the file before any change.

To remove all DCM hooks:

```bash
./dcm unhook
```

### DCM CLI commands

```
dcm install     Full setup: deps + database + hooks
dcm start       Start API + WebSocket + Dashboard
dcm stop        Stop all services
dcm restart     Restart all services
dcm status      Health check for all components
dcm hooks       Install/update Claude Code hooks
dcm unhook      Remove DCM hooks from settings.json
dcm logs api    Tail API server logs (also: ws, dashboard)
dcm snapshot    Trigger a manual context snapshot
dcm context     Get context brief for an agent
dcm health      Quick API health check
dcm db:setup    Initialize database schema
dcm db:reset    Drop and recreate database (destructive)
```

## API overview

Full specification: [`context-manager/openapi.yaml`](context-manager/openapi.yaml) | Detailed docs: [`docs/API.md`](docs/API.md)

### Core endpoints

| Method        | Endpoint                            | Description                            |
| ------------- | ----------------------------------- | -------------------------------------- |
| `GET`         | `/health`                           | Service health + feature phases        |
| `GET`         | `/api/stats`                        | Global statistics                      |
| **Projects**  |                                     |                                        |
| `POST`        | `/api/projects`                     | Create/upsert project                  |
| `GET`         | `/api/projects`                     | List projects                          |
| `GET`         | `/api/projects/by-path`             | Lookup by filesystem path              |
| **Sessions**  |                                     |                                        |
| `GET`         | `/api/sessions`                     | List sessions (with counters)          |
| `GET`         | `/api/sessions/stats`               | Session statistics                     |
| **Tracking**  |                                     |                                        |
| `POST`        | `/api/actions`                      | Log tool action (auto-creates session) |
| `GET`         | `/api/actions`                      | List actions with filters              |
| `GET`         | `/api/actions/hourly`               | 24h hourly distribution                |
| **Hierarchy** |                                     |                                        |
| `POST`        | `/api/requests`                     | Create user request                    |
| `POST`        | `/api/tasks`                        | Create task/wave                       |
| `POST`        | `/api/subtasks`                     | Create subtask (agent delegation)      |
| `GET`         | `/api/hierarchy/:project_id`        | Full project hierarchy                 |
| **Routing**   |                                     |                                        |
| `GET`         | `/api/routing/suggest`              | Keyword-based tool suggestions         |
| `POST`        | `/api/routing/feedback`             | Submit routing feedback                |
| **Messaging** |                                     |                                        |
| `POST`        | `/api/messages`                     | Send inter-agent message               |
| `GET`         | `/api/messages/:agent_id`           | Poll messages for agent                |
| **Context**   |                                     |                                        |
| `GET`         | `/api/context/:agent_id`            | Generate context brief                 |
| `POST`        | `/api/compact/save`                 | Save pre-compact snapshot              |
| `GET`         | `/api/compact/snapshot/:session_id` | Retrieve saved snapshot                |
| `POST`        | `/api/compact/restore`              | Restore context after compact          |
| **Auth**      |                                     |                                        |
| `POST`        | `/api/auth/token`                   | Generate HMAC WebSocket token          |

### WebSocket protocol

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

## Client SDK (TypeScript)

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

Monitoring UI at `http://localhost:3848`, updated in real-time via WebSocket.

| Page               | Features                                                                     |
| ------------------ | ---------------------------------------------------------------------------- |
| **Dashboard**      | Health gauge, KPI cards with sparklines, area/bar charts, live activity feed |
| **Live Activity**  | Real-time event stream, semi-circle gauges, agent topology grid              |
| **Sessions**       | Session list with filters, sort, search, tool counters                       |
| **Session Detail** | Timeline view with request cards and task items                              |
| **Projects**       | Project list with KPIs, search, delete                                       |
| **Project Detail** | Project-specific sessions and metrics                                        |
| **Agents**         | Agent statistics, active agents, type distribution                           |
| **Agent Detail**   | Per-agent task history and metrics                                           |
| **Tools**          | Tool usage analytics, type distribution, success rates                       |
| **Routing**        | Keyword-tool mappings, routing tester with live feedback                     |
| **Messages**       | Inter-agent message history with expandable payloads                         |
| **Context**        | Agent context browser with stats and type distribution                       |

Built with shadcn/ui, Radix UI, Tailwind CSS 4. Glassmorphism cards, dark mode (oklch), responsive.

## Configuration

| Variable         | Default          | Description                                      |
| ---------------- | ---------------- | ------------------------------------------------ |
| `DB_HOST`        | `localhost`      | PostgreSQL host                                  |
| `DB_PORT`        | `5432`           | PostgreSQL port                                  |
| `DB_NAME`        | `claude_context` | Database name                                    |
| `DB_USER`        | *required*       | Database user                                    |
| `DB_PASSWORD`    | *required*       | Database password                                |
| `PORT`           | `3847`           | API server port                                  |
| `WS_PORT`        | `3849`           | WebSocket server port                            |
| `WS_AUTH_SECRET` | -                | HMAC secret for WS auth (required in production) |
| `DASHBOARD_PORT` | `3848`           | Dashboard port                                   |
| `DCM_HOST`       | `127.0.0.1`      | External host for dashboard API URLs             |
| `NODE_ENV`       | `production`     | Environment (dev mode allows bare WS auth)       |

## Architecture decisions

| ADR | Decision                                   | Rationale                                     |
| --- | ------------------------------------------ | --------------------------------------------- |
| 001 | PostgreSQL LISTEN/NOTIFY over polling      | Near-zero latency, no polling overhead        |
| 002 | HMAC-SHA256 for WS auth                    | Stateless tokens, no external dependencies    |
| 003 | Single npm package for SDK                 | Simpler distribution and versioning           |
| 004 | Bun-first, Node.js compatible              | Performance + broad compatibility             |
| 005 | At-least-once delivery (3 retries, 5s ack) | Reliability without exactly-once complexity   |
| 006 | Dev mode allows bare agent_id              | Easier development, strict auth in production |
| 007 | JSONB for metadata columns                 | Flexible schema, indexed queries              |
| 008 | Separate WS server process                 | Independent scaling, cleaner architecture     |

## Tests

```bash
cd context-manager
bun test                    # Run all (123 tests)
bun test src/tests/api      # API tests (101 tests)
bun test src/tests/ws       # WebSocket tests (22 tests)
```

## Documentation

| Document                                                       | Description                                     |
| -------------------------------------------------------------- | ----------------------------------------------- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)                 | System design, data flow, database schema, ADRs |
| [`docs/API.md`](docs/API.md)                                   | Full API reference with examples                |
| [`docs/INTEGRATION.md`](docs/INTEGRATION.md)                   | Claude Code hooks setup, SDK usage              |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)                     | Docker, systemd, manual deployment guides       |
| [`context-manager/openapi.yaml`](context-manager/openapi.yaml) | OpenAPI 3.0 specification                       |

## License

MIT
