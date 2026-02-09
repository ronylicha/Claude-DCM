# DCM Architecture

Distributed Context Manager -- the observability, coordination, and context-preservation backbone for Claude Code multi-agent sessions.

DCM captures every tool call, agent spawn, and inter-agent message produced by Claude Code, stores them in PostgreSQL, and streams them in real time to a monitoring dashboard. It also provides intelligent routing suggestions, compact-aware context restoration, and proactive context monitoring to prevent data loss during automatic compaction events.

---

## Table of Contents

- [System Overview](#system-overview)
- [Components](#components)
  - [API Server](#api-server)
  - [WebSocket Server](#websocket-server)
  - [Dashboard](#dashboard)
  - [PostgreSQL](#postgresql)
- [Database Schema](#database-schema)
  - [Tables](#tables)
  - [Views](#views)
  - [Indexes](#indexes)
  - [Entity Relationships](#entity-relationships)
- [Hook System](#hook-system)
  - [Hook Lifecycle](#hook-lifecycle)
  - [SessionStart Hooks](#sessionstart-hooks)
  - [PostToolUse Hooks](#posttooluse-hooks)
  - [PreCompact Hooks](#precompact-hooks)
  - [SubagentStop Hooks](#subagentstop-hooks)
  - [SessionEnd Hooks](#sessionend-hooks)
- [Auto-Start Mechanism](#auto-start-mechanism)
- [Data Flow](#data-flow)
  - [Action Tracking](#action-tracking)
  - [Agent Tracking](#agent-tracking)
  - [Compact Save and Restore](#compact-save-and-restore)
  - [Real-Time Event Delivery](#real-time-event-delivery)
- [Context Generation](#context-generation)
- [WebSocket Protocol](#websocket-protocol)
  - [Authentication](#authentication)
  - [Channels](#channels)
  - [Client Messages](#client-messages)
  - [Server Messages](#server-messages)
  - [Delivery Guarantees](#delivery-guarantees)
  - [Heartbeat and Cleanup](#heartbeat-and-cleanup)
- [API Surface](#api-surface)
- [Architecture Decision Records](#architecture-decision-records)

---

## System Overview

<p align="center">
  <img src="assets/system-overview.svg" alt="DCM System Overview" width="1000"/>
</p>

Four processes collaborate to form the DCM system:

| Component | Stack | Port | Role |
|-----------|-------|------|------|
| **API Server** | Bun + Hono | 3847 | REST API with 60+ endpoints. Receives hook data, serves the dashboard, manages all CRUD operations. |
| **WebSocket Server** | Bun native WebSocket | 3849 | Real-time event bridge. Listens to PostgreSQL NOTIFY, forwards events to subscribed clients. |
| **Dashboard** | Next.js 16, React 19, shadcn/ui, Recharts | 3848 | Glassmorphism monitoring UI with 11 pages for sessions, agents, tools, routing, and messages. |
| **PostgreSQL** | PostgreSQL 16 + pgcrypto | 5432 | Persistent storage with 10 tables, 4 views, 20+ indexes. LISTEN/NOTIFY serves as the event bus. |

Nine hook scripts bridge Claude Code to the DCM system, covering the full session lifecycle from startup through compaction and shutdown.

---

## Components

### API Server

The API server is the single write entry point for all data. It runs on Bun with the Hono framework on port 3847.

**Responsibilities:**

- Accept tool-action payloads from `track-action.sh` and insert them into the `actions` table.
- Auto-upsert sessions and projects on every action so tracking works without manual setup.
- Extract keywords from tool names and inputs, then update `keyword_tool_scores` for routing intelligence.
- Fire `pg_notify('dcm_events', json)` after writes so the WebSocket bridge can push events without polling.
- Serve CRUD endpoints for the full hierarchy: projects, requests, task lists, subtasks, actions.
- Provide inter-agent pub/sub (messages, subscriptions, blocking queue).
- Generate HMAC-SHA256 tokens for WebSocket authentication.
- Save and restore compact snapshots for context preservation across compaction events.
- Serve dashboard KPI aggregations via parallel SQL queries.
- Run a periodic cleanup job (every 60 seconds) to expire old messages.

**Key source files:**

| File | Purpose |
|------|---------|
| `src/server.ts` | Main server, route registration, Hono app |
| `src/api/actions.ts` | Action tracking endpoints |
| `src/api/compact.ts` | Compact save/restore logic |
| `src/api/dashboard.ts` | Dashboard statistics endpoints |
| `src/api/hierarchy.ts` | Hierarchy tree endpoints |
| `src/api/agent-contexts.ts` | Agent context management |
| `src/context-generator.ts` | Context brief generation engine |
| `src/routing.ts` | Routing intelligence queries |
| `src/cleanup.ts` | TTL-based cleanup jobs |
| `src/config.ts` | Centralized configuration |
| `src/lib/logger.ts` | Structured logging with `createLogger()` |

### WebSocket Server

A separate Bun process on port 3849. It maintains persistent connections with dashboard clients and SDK consumers, relaying events as they happen.

**Responsibilities:**

- Run a PostgreSQL `LISTEN dcm_events` subscription on a dedicated connection.
- Parse incoming NOTIFY payloads (JSON) and route them to the correct WebSocket channel.
- Maintain a client registry and channel subscription map.
- Enforce HMAC-SHA256 authentication for production deployments.
- Provide at-least-once delivery for critical events (task, subtask, message) via a retry queue.
- Send heartbeat pings every 30 seconds and clean up dead connections after 60 seconds of silence.
- Broadcast metric snapshots (5 parallel aggregation queries) every 5 seconds.

**Key source files:**

| File | Purpose |
|------|---------|
| `src/websocket-server.ts` | Main WS server, connection handling |
| `src/websocket/channels.ts` | Channel subscription management |
| `src/websocket/auth.ts` | HMAC-SHA256 token validation |
| `src/websocket/metrics.ts` | Real-time metric aggregation |

### Dashboard

A Next.js 16 application with React 19, providing a real-time monitoring interface.

**Design system:**

- Glassmorphism cards with backdrop blur
- 8 CSS animations (fade-in, slide-in, scale-in, pulse-glow, shimmer, count-up, float, stagger)
- Dark mode with oklch color system
- Responsive grid layouts (sm/md/lg breakpoints)
- Built on shadcn/ui + Radix UI + Tailwind CSS 4

**Pages:**

| Page | Content |
|------|---------|
| Dashboard | Health gauge, KPI cards with sparklines, area/bar charts, live activity feed |
| Live Activity | Real-time event stream, semi-circle gauges, agent topology grid |
| Sessions | Session list with filters, sort, search |
| Session Detail | Timeline view with request cards and task items |
| Projects | Project list with KPIs, search, delete |
| Project Detail | Project-specific sessions and metrics |
| Agents | Agent statistics, active agents, type distribution |
| Agent Detail | Per-agent task history and metrics |
| Tools | Tool usage analytics, type distribution, success rates |
| Routing | Keyword-tool mappings, routing tester with feedback |
| Messages | Inter-agent message history with expandable payloads |

**Extracted components** (from Codebase Excellence Initiative):

| Component | Purpose |
|-----------|---------|
| `HealthGauge` | System health indicator with gauge visualization |
| `PremiumKPICard` | Metric card with glass morphism styling |
| `GlassChartTooltip` | Enhanced tooltip for chart interactions |
| `ActivityFeed` | Real-time activity log component |
| `SystemPulseBar` | Status indicator with pulse animation |

### PostgreSQL

PostgreSQL 16 serves as both the durable store and the event bus (via LISTEN/NOTIFY). The `pgcrypto` extension provides `gen_random_uuid()` for all primary keys.

**Database name:** `claude_context`

---

## Database Schema

<p align="center">
  <img src="assets/database-schema.svg" alt="Database Schema ERD" width="1000"/>
</p>

### Tables

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `projects` | `path`, `metadata` (JSONB) | Identified by filesystem path (cwd) |
| `sessions` | `project_id` (FK), `total_tools_used`, `total_success`, `total_errors` | Claude Code session instance |
| `requests` | `session_id` (FK), `project_id` (FK), `prompt_type`, `status` | User prompt that initiates work |
| `task_lists` | `request_id` (FK), `wave_number`, `status` | Wave of objectives |
| `subtasks` | `task_list_id` (FK), `agent_type`, `agent_id`, `blocked_by`, `context_snapshot` (JSONB) | Individual agent assignment |
| `actions` | `subtask_id` (FK), `tool_name`, `tool_type`, `input`, `output`, `exit_code` | Single tool invocation |
| `agent_messages` | `from_agent_id`, `to_agent_id`, `topic`, `payload` (JSONB), `expires_at`, `read_by` (text[]) | Inter-agent pub/sub messages |
| `agent_contexts` | `project_id` (FK), `agent_type`, `agent_id`, `role_context` (JSONB), `skills_to_restore`, `tools_used` (JSONB) | Agent state and compact snapshots |
| `keyword_tool_scores` | `keyword`, `tool_name`, `score`, `usage_count`, `success_count` | Routing intelligence weights |
| `schema_version` | `version`, `applied_at` | Database migration tracking |

### Views

| View | Description |
|------|-------------|
| `v_actions_full` | Full JOIN across actions, subtasks, task_lists, requests, sessions, projects |
| `v_active_agents` | Subtasks with `status = 'running'`, joined to task hierarchy |
| `v_unread_messages` | Messages where `read_by` is empty or NULL |
| `v_project_stats` | Aggregated project-level session and action counts |

### Indexes

| Table | Indexed Columns | Type |
|-------|----------------|------|
| `requests` | `project_id`, `session_id`, `status` | btree |
| `subtasks` | `status`, `(agent_type, agent_id)`, `task_list_id` | btree |
| `actions` | `tool_name`, `created_at DESC`, `subtask_id`, `tool_type` | btree |
| `agent_messages` | `project_id`, `to_agent_id`, `topic`, `created_at DESC` | btree |
| `keyword_tool_scores` | `keyword`, `tool_name` | btree |
| `agent_contexts` | `(project_id, agent_type)`, `agent_id` | btree |
| `sessions` | `project_id`, `started_at DESC` | btree |
| `projects` | `metadata` | GIN |
| `requests` | `metadata` | GIN |
| `actions` | `metadata` | GIN |
| `agent_messages` | `payload` | GIN |
| `agent_contexts` | `role_context` | GIN |

### Entity Relationships

```
project                          # Identified by filesystem path (cwd)
  -> session                     # Claude Code session instance
  -> request                     # User prompt that initiates work
    -> task_list                 # Wave of objectives (wave_number)
      -> subtask                 # Individual agent assignment
        -> action                # Single tool invocation
```

**Triggers:**

| Trigger | Table | Effect |
|---------|-------|--------|
| `update_projects_updated_at` | `projects` | Sets `updated_at = NOW()` on update |
| `update_contexts_updated_at` | `agent_contexts` | Sets `last_updated = NOW()` on update |

---

## Hook System

All hooks are defined in `context-manager/hooks/hooks.json` (plugin mode) or injected into `~/.claude/settings.json` (global mode).

### Hook Lifecycle

<p align="center">
  <img src="assets/hooks-flow.svg" alt="Hook Lifecycle" width="1000"/>
</p>

### SessionStart Hooks

**Matcher: `startup`** -- Fires when a new Claude Code session begins.

| Script | Timeout | Purpose |
|--------|---------|---------|
| `ensure-services.sh` | 10s | Auto-start DCM services if not running (see [Auto-Start Mechanism](#auto-start-mechanism)). |
| `track-session.sh` | 5s | Initialize the session hierarchy: create project (by cwd), session, request, and task. Cache IDs in `/tmp/.claude-context/{session_id}.json` for subsequent hooks. |

**Matcher: `compact`** -- Fires when a session resumes after a compaction event.

| Script | Timeout | Purpose |
|--------|---------|---------|
| `post-compact-restore.sh` | 8s | Restore context after compact. Calls `POST /api/compact/restore` to generate a brief, then outputs JSON with `additionalContext` so Claude sees the restored context immediately. Falls back to raw snapshot data if the brief generation fails. |

### PostToolUse Hooks

**Matcher: `*`** -- Fires after every tool invocation.

| Script | Timeout | Purpose |
|--------|---------|---------|
| `track-action.sh` | 3s | Record the tool call in the `actions` table. Extracts `tool_name`, `tool_type`, `input`, `exit_code`, and fires `POST /api/actions` as fire-and-forget. Classifies tools into types: `builtin`, `agent`, `skill`, `mcp`. |
| `monitor-context.sh` | 2s | Proactive context monitoring. Increments a counter file (`/tmp/.dcm-monitor-counter`); on every 10th call, checks transcript size. Below 500KB: no action. 500-800KB: log warning. Above 800KB: trigger a proactive snapshot via `POST /api/compact/save` with a 60-second cooldown between snapshots. |

**Matcher: `Task`** -- Fires only when the Task tool is used (agent delegation).

| Script | Timeout | Purpose |
|--------|---------|---------|
| `track-agent.sh` | 3s | Create a subtask entry for the delegated agent. Reads cached `task_id` from `/tmp/.claude-context/{session_id}.json` to avoid repeated lookups. If no request/task chain exists, creates one automatically. |

### PreCompact Hooks

**Matchers: `auto`, `manual`** -- Fires before Claude compacts the context window.

| Script | Timeout | Purpose |
|--------|---------|---------|
| `pre-compact-save.sh` | 5s | Save a full context snapshot to DCM before compact occurs. Gathers data from multiple sources: active tasks from the API, modified files from recent actions, agent states from agent contexts, and a summary from the transcript tail. Posts the assembled snapshot to `POST /api/compact/save`. |

### SubagentStop Hooks

**No matcher (fires for all subagent stops).**

| Script | Timeout | Purpose |
|--------|---------|---------|
| `save-agent-result.sh` | 3s | When a subagent finishes, extracts its result from the transcript. Broadcasts an `agent.completed` message via `POST /api/messages` so other agents can access it. Also updates the corresponding subtask status to `completed` via `PATCH /api/subtasks/{id}`. |

### SessionEnd Hooks

**No matcher (fires on session termination).**

| Script | Timeout | Purpose |
|--------|---------|---------|
| `track-session-end.sh` | 3s | Closes the session by setting `ended_at` via `PATCH /api/sessions/{id}`. Cleans up the cache file from `/tmp/.claude-context/`. |

---

## Auto-Start Mechanism

<p align="center">
  <img src="assets/auto-start.svg" alt="Auto-Start Sequence" width="1000"/>
</p>

The `ensure-services.sh` script runs on every `SessionStart` event and guarantees that DCM services are available before any other hook fires. The script is fully idempotent -- if services are already running, it exits immediately with no side effects.

**Execution flow:**

1. **Health check** -- `GET /health` with 1-second timeout. If healthy, exit immediately.
2. **Lock file** -- Acquire `/tmp/.dcm-autostart.lock`. Stale locks (>30s) are auto-removed.
3. **PostgreSQL check** -- `pg_isready` to verify database availability. If down, warn and exit.
4. **Service launch** -- Start API and WS servers via `nohup`. PIDs saved to `/tmp/.dcm-pids/`.
5. **Readiness poll** -- Poll `/health` for up to 5 seconds.
6. **Lock release** -- Via `trap` on EXIT.

**Logs:** `/tmp/dcm-api.log` and `/tmp/dcm-ws.log`

---

## Data Flow

### Action Tracking

<p align="center">
  <img src="assets/action-tracking.svg" alt="Action Tracking Data Flow" width="1000"/>
</p>

**Tool type classification** (performed by the hook):

| Pattern | Type |
|---------|------|
| Read, Write, Edit, MultiEdit, Bash, Glob, Grep, etc. | `builtin` |
| Task | `agent` |
| Skill | `skill` |
| `mcp__*` | `mcp` |

For `Skill` and `Task` tools, the hook extracts the effective name from the input JSON (the skill name or the subagent type) to provide meaningful tracking granularity.

### Agent Tracking

When the `Task` tool is used (agent delegation), `track-agent.sh` creates a subtask entry. If no request/task chain exists for the current session, the script creates one automatically.

**Cache file:** `/tmp/.claude-context/{session_id}.json` stores `project_id`, `request_id`, and `task_id` for fast lookups.

### Compact Save and Restore

<p align="center">
  <img src="assets/compact-sequence.svg" alt="Compact Save/Restore Sequence" width="1000"/>
</p>

**Snapshot storage**: Snapshots are stored in the `agent_contexts` table with `agent_type = 'compact-snapshot'` and `agent_id = 'compact-snapshot-{session_id}'`. This reuses existing infrastructure with the UPSERT pattern (`ON CONFLICT DO UPDATE`).

**Three snapshot triggers**:

| Trigger | Source | When |
|---------|--------|------|
| `proactive` | `monitor-context.sh` | Transcript exceeds 800KB (with 60s cooldown) |
| `auto` | `pre-compact-save.sh` | Claude auto-compacts the context window |
| `manual` | `pre-compact-save.sh` | User manually triggers compact via `/compact` |

### Real-Time Event Delivery

The WebSocket bridge replaces polling with PostgreSQL's built-in pub/sub mechanism.

**Flow:** `INSERT/UPDATE` in PostgreSQL -> `NOTIFY dcm_events` (JSON payload) -> WebSocket server `LISTEN` -> Parse and route to channels (`global`, `agent:{id}`, `session:{id}`, `metrics`) -> Client WebSocket frames -> Dashboard live updates.

---

## Context Generation

<p align="center">
  <img src="assets/context-generation.svg" alt="Context Brief Generation" width="1000"/>
</p>

The context generator (`src/context-generator.ts`) assembles a markdown brief from multiple data sources, each weighted by relevance:

**Data sources and relevance scoring:**

| Source | Relevance | Description |
|--------|-----------|-------------|
| Running tasks | 1.0 | Currently executing subtasks assigned to the agent |
| Pending/blocked tasks | 0.8 | Tasks waiting for execution or dependencies |
| High-priority messages | 1.0 | Unread messages with priority >= 5 |
| Normal messages | 0.6 | Standard unread messages |
| Active blockings | 0.9 | Unresolved blocking dependencies |
| Action history | 0.7 | Recent tool calls for context |
| Session info | 0.8 | Current session state |
| Project info | 0.7 | Project identification |

**Default generation options:**

| Option | Default | Description |
|--------|---------|-------------|
| `max_tokens` | 2000 | Maximum token budget for the brief (1 token ~ 3.5 chars) |
| `include_history` | true | Include recent action history |
| `history_limit` | 10 (15 after compact) | Number of recent actions to include |
| `include_messages` | true | Include unread messages |
| `include_blockings` | true | Include blocking dependencies |

**Truncation strategy**: When the brief exceeds the token budget, lines are removed from the end while preserving all section headers (lines starting with `##`). A truncation notice is appended.

---

## WebSocket Protocol

### Authentication

The WebSocket server uses HMAC-SHA256 tokens. The token format is `{client_id}:{timestamp}:{signature}` where the signature is `HMAC-SHA256(client_id:timestamp, WS_HMAC_SECRET)`.

**Token flow:**

1. Client requests a token: `POST /api/auth/ws-token` with `{ "client_id": "..." }`.
2. API returns `{ "token": "...", "expires_at": "..." }`.
3. Client connects to `ws://localhost:3849` or sends an `auth` message after connection.

**Dev mode exception:** When `NODE_ENV` is not `production`, clients can authenticate with a bare `client_id` in the `auth` message, without a token. This simplifies local development.

### Channels

| Channel Pattern | Example | Description |
|-----------------|---------|-------------|
| `global` | `global` | All events. Every client auto-subscribes on connection. |
| `agent:{id}` | `agent:backend-laravel` | Events for a specific agent. Auto-subscribed on auth. |
| `session:{id}` | `session:abc-123` | Events scoped to a session. Auto-subscribed on auth if `session_id` provided. |
| `metrics` | `metrics` | Metric snapshots emitted every 5 seconds. |
| `topic:{name}` | `topic:deployments` | Custom topic channels for inter-agent coordination. |

### Client Messages

| Type | Fields | Description |
|------|--------|-------------|
| `subscribe` | `channel`, `client_id`, `session_id` | Subscribe to a channel. Server responds with `ack`. |
| `unsubscribe` | `channel`, `client_id`, `session_id` | Unsubscribe from a channel. Server responds with `ack`. |
| `publish` | `channel`, `event_type`, `data`, `client_id`, `session_id` | Publish an event to a channel. Validated against allowed event types. |
| `auth` | `token`, `client_id`, `agent_id`, `session_id`, `agent_type` | Authenticate. Triggers auto-subscribe to agent/session channels. |
| `ping` | `timestamp` | Client keepalive. Server responds with `pong`. |
| `ack` | `message_id` | Client acknowledges receipt of a tracked message. |

### Server Messages

| Type | Fields | Description |
|------|--------|-------------|
| `connected` | `client_id`, `channels` | Sent immediately after WebSocket upgrade. |
| `ack` | `id`, `action`, `channel`, `success` | Response to subscribe/unsubscribe/publish/auth. |
| `pong` | `timestamp` | Response to client ping. |
| `error` | `code`, `message`, `action`, `details` | Error notification (auth failure, parse error, invalid channel). |
| *(event)* | `id`, `type`, `data`, `channel`, `timestamp` | Event payload. `type` is one of the EventType values below. |

**Event types:**

| Event Type | Description |
|------------|-------------|
| `action.created` | New tool action recorded |
| `session.created` | New session registered |
| `session.updated` | Session updated (e.g., ended) |
| `subtask.created` | New agent subtask created |
| `subtask.updated` | Subtask status changed |
| `message.created` | New inter-agent message |
| `context.updated` | Agent context updated |
| `metrics` | Periodic metric snapshot |
| `system.info` | System information broadcast |

### Delivery Guarantees

Critical events (`subtask.created`, `subtask.updated`, `message.created`) use at-least-once delivery:

1. The server tracks each sent message in a `pendingAcks` map, keyed by `message_id`.
2. Clients should respond with an `ack` message containing the `message_id`.
3. Every 2 seconds, the server checks for unacknowledged messages older than 5 seconds and retries.
4. After 3 failed attempts, the message is dropped from the retry queue.

Non-critical events (metrics, agent heartbeats, system info) use fire-and-forget delivery.

### Heartbeat and Cleanup

- **Ping interval:** Server sends a `ping` to every client every 30 seconds.
- **Dead timeout:** Clients that have not responded to a ping within 60 seconds are disconnected and removed from all channel subscriptions.
- **Subscription restore:** When an authenticated agent reconnects, its previous channel subscriptions are automatically restored from an in-memory map.

---

## API Surface

The API exposes 60+ endpoints organized by domain. Below is the complete routing table as registered in `src/server.ts`.

### Health and Status

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | System health, database status, feature phase list |
| GET | `/api/stats` | Global aggregate statistics |
| GET | `/api/tools-stats` | Tool usage analytics (counts, types, success rates) |
| GET | `/api/dashboard-summary` | Aggregated KPI metrics for the dashboard (7 parallel queries) |

### Projects

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects` | Create or upsert a project (by path) |
| GET | `/api/projects` | List all projects |
| GET | `/api/projects/by-path` | Find project by filesystem path |
| GET | `/api/projects/:id` | Get project by ID |
| DELETE | `/api/projects/:id` | Delete project and cascade |

### Requests

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/requests` | Create a user request |
| GET | `/api/requests` | List requests (filterable by session, project, status) |
| GET | `/api/requests/:id` | Get request by ID |
| PATCH | `/api/requests/:id` | Update request status |
| DELETE | `/api/requests/:id` | Delete request |

### Tasks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tasks` | Create a task list (wave) |
| GET | `/api/tasks` | List tasks |
| GET | `/api/tasks/:id` | Get task by ID |
| PATCH | `/api/tasks/:id` | Update task status |
| DELETE | `/api/tasks/:id` | Delete task |

### Subtasks

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/subtasks` | Create a subtask (agent assignment) |
| GET | `/api/subtasks` | List subtasks (filterable by status, agent_type) |
| GET | `/api/subtasks/:id` | Get subtask by ID |
| PATCH | `/api/subtasks/:id` | Update subtask status/result |
| DELETE | `/api/subtasks/:id` | Delete subtask |

### Actions

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/actions` | Log a tool action (primary hook endpoint) |
| GET | `/api/actions` | List actions (filterable) |
| GET | `/api/actions/hourly` | Hourly action distribution |
| DELETE | `/api/actions/:id` | Delete a single action |
| DELETE | `/api/actions/session/:sessionId` | Bulk delete by session |

### Hierarchy

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/hierarchy/tree` | Full tree: project -> requests -> tasks -> subtasks (single JOIN query) |
| GET | `/api/hierarchy/active-agents` | Currently running agents via `v_active_agents` view |

### Routing Intelligence

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/routing/suggest` | Get tool suggestions for a keyword |
| GET | `/api/routing/stats` | Routing statistics |
| POST | `/api/routing/feedback` | Submit feedback on a suggestion |

### Context and Compact

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/context/brief` | Generate a context brief for an agent |
| POST | `/api/context/brief` | Generate context brief on demand |
| POST | `/api/compact/save` | Save context snapshot before compact |
| POST | `/api/compact/restore` | Restore agent context after compact |
| GET | `/api/compact/status/:sessionId` | Check compact status for a session |
| GET | `/api/compact/snapshot/:sessionId` | Get saved snapshot for a session |

### Agent Contexts

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent-contexts` | List all agent contexts with stats (filterable by agent_type, status) |
| GET | `/api/agent-contexts/summary` | Agent context KPIs: overview, top types, recent activity, tools used |

### Sessions

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sessions` | Create/upsert a session |
| GET | `/api/sessions` | List sessions |
| GET | `/api/sessions/stats` | Session aggregate statistics |
| GET | `/api/sessions/:id` | Get session by ID |
| PATCH | `/api/sessions/:id` | Update session |
| DELETE | `/api/sessions/:id` | Delete session |

### Inter-Agent Communication

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/messages` | Send a message (direct or broadcast) |
| GET | `/api/messages` | List all messages (for dashboard, paginated) |
| GET | `/api/messages/poll` | Poll messages for an agent |
| POST | `/api/subscriptions` | Subscribe to a topic |
| GET | `/api/subscriptions` | List all subscriptions |
| GET | `/api/subscriptions/:agentId` | List agent subscriptions |
| DELETE | `/api/subscriptions/:id` | Delete subscription |
| POST | `/api/subscriptions/unsubscribe` | Unsubscribe from a topic |
| POST | `/api/blockings` | Block an agent (coordination) |
| GET | `/api/blockings/check` | Check if an agent is blocked |
| GET | `/api/blockings/:agentId` | Get blocking details for an agent |
| DELETE | `/api/blockings/:id` | Delete blocking |
| POST | `/api/blockings/unblock` | Unblock an agent |

### Cleanup

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cleanup/stats` | Last cleanup stats and message statistics |

### Authentication

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/ws-token` | Generate an HMAC-SHA256 WebSocket token |

---

## Architecture Decision Records

### ADR-001: Bun over Node.js

**Context:** The runtime choice affects performance, developer experience, and deployment complexity. DCM hooks run on every tool call in Claude Code, so latency matters.

**Decision:** Target Bun as the primary runtime. Use Bun-native APIs (`Bun.serve()`, `Bun.sql`, `WebSocket`) for maximum performance.

**Consequences:**
- Significant performance gains from Bun's optimized HTTP and WebSocket handling.
- Native TypeScript execution without a separate build step or transpilation.
- Direct PostgreSQL support via `Bun.sql` without external driver libraries.
- Hook scripts remain portable bash and are runtime-agnostic.
- Bun is less mature than Node.js, but the API surface used by DCM is stable.

### ADR-002: Hono over Express

**Context:** The HTTP framework must be lightweight, type-safe, and compatible with Bun's native server.

**Decision:** Use Hono, a lightweight web framework designed for edge runtimes and fully compatible with `Bun.serve()`.

**Consequences:**
- Sub-millisecond routing overhead via Hono's trie-based router.
- Full TypeScript support with typed request/response handlers.
- Built-in middleware (CORS, logging) without external dependencies.
- Smaller bundle and memory footprint compared to Express.
- Hono's `fetch` handler integrates directly with `Bun.serve()`.

### ADR-003: PostgreSQL over SQLite

**Context:** DCM originated with SQLite but needed concurrent write support from multiple hook processes, real-time event delivery, and JSONB for semi-structured data.

**Decision:** Migrate to PostgreSQL 16 with JSONB columns and LISTEN/NOTIFY for the event bus.

**Consequences:**
- Concurrent writes from multiple Claude Code sessions without lock contention.
- LISTEN/NOTIFY eliminates polling for real-time event delivery (see ADR-004).
- JSONB columns with GIN indexes enable flexible metadata without schema migrations.
- PostgreSQL is a heavier dependency than SQLite, requiring a running server process.
- The `pgcrypto` extension provides `gen_random_uuid()` for all primary keys.

### ADR-004: PostgreSQL LISTEN/NOTIFY for Real-Time Events

**Context:** The WebSocket bridge needs to know when new data arrives in the database so it can push events to connected clients.

**Decision:** Use PostgreSQL's built-in `LISTEN`/`NOTIFY` mechanism instead of interval-based polling.

**Consequences:**
- Near-zero latency between a database write and WebSocket event delivery.
- No wasted queries during idle periods.
- Requires a dedicated PostgreSQL connection for the `LISTEN` subscription.
- NOTIFY payloads are limited to 8000 bytes, which is sufficient for event metadata (full data is fetched separately if needed).

### ADR-005: Separate WebSocket Server Process

**Context:** The WebSocket server and the REST API have different scaling characteristics and failure modes.

**Decision:** Run the WebSocket server as a separate Bun process on its own port (3849), rather than embedding it in the API server (3847).

**Consequences:**
- Independent scaling: the WS server scales by connection count while the API scales by request throughput.
- Isolated failure domains: a crash in the WS server does not affect API availability.
- Slightly more complex deployment (two processes instead of one).
- Both processes share the same codebase and database connection configuration.

### ADR-006: HMAC-SHA256 for WebSocket Authentication

**Context:** WebSocket connections need authentication, especially in production environments.

**Decision:** Use HMAC-SHA256 tokens with a shared secret. Token format: `{client_id}:{timestamp}:{signature}`.

**Consequences:**
- Stateless validation -- no database lookup needed to verify a token.
- No external dependencies (no JWT library, no OAuth provider).
- Tokens are time-limited (1 hour TTL) and contain the `client_id` and optional `session_id`.
- The shared secret (`WS_HMAC_SECRET` env var) must be kept secure.
- Dev mode allows bare `client_id` without tokens for faster iteration.

### ADR-007: JSONB for Flexible Metadata

**Context:** Several entities (projects, requests, actions, messages, agent contexts) carry semi-structured data that varies by use case.

**Decision:** Use PostgreSQL JSONB columns with GIN indexes for these fields.

**Consequences:**
- No schema migrations needed when metadata shapes evolve.
- GIN indexes enable efficient queries against JSONB contents.
- Compact snapshot data (`role_context` in `agent_contexts`) can store arbitrary structures.
- Slightly higher storage cost compared to normalized columns (acceptable given the flexibility).

### ADR-008: At-Least-Once Delivery for Critical Events

**Context:** Task and message events must not be silently lost, but exactly-once semantics add substantial complexity.

**Decision:** Implement at-least-once delivery with 3 retries and a 5-second acknowledgment timeout. Only for `subtask.created`, `subtask.updated`, and `message.created` events.

**Consequences:**
- Clients may receive duplicate events and should handle them idempotently (each event carries a unique `message_id`).
- Non-critical events (metrics, heartbeats) use fire-and-forget for lower overhead.
- The retry queue is in-memory; pending messages are lost if the WebSocket server restarts.

### ADR-009: Hook-Based Auto-Start with Lock File

**Context:** DCM services need to be running before hooks can send data. Manual startup creates friction and is easily forgotten.

**Decision:** The `ensure-services.sh` hook auto-starts DCM services on every `SessionStart` event, using a lock file to prevent race conditions.

**Consequences:**
- Zero-friction startup: Claude Code sessions automatically have DCM available.
- Lock file prevents thundering herd when multiple sessions start simultaneously.
- PostgreSQL must be running independently (ensure-services.sh checks but does not start it).
- Startup adds up to 10 seconds to the first session start (timeout budget for the hook).
- Subsequent sessions see near-zero latency (health check returns immediately).
