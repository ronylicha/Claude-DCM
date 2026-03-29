# DCM -- Distributed Context Manager

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT"/></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f9f1e1.svg" alt="Bun"/></a>
  <a href="https://www.postgresql.org/"><img src="https://img.shields.io/badge/database-PostgreSQL%2014+-336791.svg" alt="PostgreSQL 14+"/></a>
  <a href="https://hono.dev"><img src="https://img.shields.io/badge/framework-Hono-ff6633.svg" alt="Hono"/></a>
  <img src="https://img.shields.io/badge/version-3.1.0-green.svg" alt="v3.1.0"/>
</p>

<p align="center">
  <strong>Persistent memory, compact recovery, multi-agent orchestration, agent hierarchy, and safety enforcement for Claude Code sessions.</strong>
</p>

---

DCM is a persistent memory and orchestration layer for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). It hooks into Claude's lifecycle events -- every tool call, every agent launch, every compaction -- and maintains a complete picture of what is happening across multi-agent sessions. When context compaction occurs, DCM saves the session state beforehand and restores it afterward, so Claude picks up exactly where it left off.

The system consists of three services: a **REST API** (86+ endpoints across 11 development phases) backed by PostgreSQL, a **WebSocket server** for real-time event streaming, and a **Next.js dashboard** for live monitoring and debugging.

## Table of Contents

- [The Problem](#the-problem)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Architecture Overview](#architecture-overview)
- [Environment Variables](#environment-variables)
- [Available Scripts](#available-scripts)
- [Testing](#testing)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## The Problem

Claude Code sessions hit a hard limit: the **context window**. When a conversation grows too large, Claude triggers **compaction** -- compressing the conversation history to free space. Without external help, this means:

- **Active tasks vanish.** Agents lose track of what they were building, which files they modified, and what decisions they made.
- **Agents work in silos.** A backend agent finishes an API endpoint, but the frontend agent has no idea it exists.
- **No visibility.** There is no way to see what is happening across a multi-agent session -- which agents are running, what tools they are calling, or whether things are going well.
- **Manual recovery.** After each compact, users must re-explain the entire project state from memory.
- **No safety net.** Subagents can execute destructive operations (`rm -rf`, `DROP DATABASE`, `.env` access) without any preventive gate.

DCM solves all of these by sitting alongside Claude Code as a **persistent memory layer** with real-time monitoring, automatic context recovery, inter-agent communication, and safety enforcement.

## Key Features

### Safety Gate -- Preventive Blocking

A `PreToolUse` hook intercepts dangerous operations **before** they execute:

| Pattern | What It Blocks | Example |
|---------|----------------|---------|
| Filesystem destruction | `rm -rf /`, `rm -rf ~`, `rm -rf /home` | Recursive deletion of system directories |
| Database destruction | `DROP DATABASE`, `DROP TABLE`, `TRUNCATE TABLE` | Destructive SQL statements |
| Secret exposure | `cat .env`, `head .env`, direct `.env` writes | Accidental secret leakage |
| Resource exhaustion | Fork bombs, `dd if=/dev/zero of=/dev/` | System-level denial of service |

Blocked operations are logged to the API and displayed in the dashboard Safety Gate section.

### Context Guardian -- 4-Layer Defense

| Layer | Mechanism | Frequency | Latency | What It Does |
|-------|-----------|-----------|---------|--------------|
| 1. Local Monitor | `context-guardian.sh` | Every tool call | <10ms | Checks transcript file size locally. Color-coded zones (green/yellow/orange/red). |
| 2. API Health Check | `monitor-context.sh` | Every 5th call | 25-100ms | Queries the API for capacity metrics. Triggers proactive snapshot if usage >80%. |
| 3. Stop Guard | `context-stop-guard.sh` | On Stop event | <100ms | Blocks session termination if running tasks exist. |
| 4. Compact Save/Restore | `pre-compact-save.sh` + `post-compact-restore.sh` | Each compaction | 500ms-2s | Saves full snapshot before compact, restores via `additionalContext` injection after. |

### Compact Save/Restore Lifecycle

When Claude's context window fills up:

1. **PreCompact** -- DCM collects active tasks, modified files, agent states, key decisions, wave state, and a 3000-character summary, then saves them as a snapshot in PostgreSQL.
2. **Compaction** -- Claude compresses the conversation. Without DCM, everything before this point is gone.
3. **SessionStart (compact)** -- DCM uses a **snapshot-first** restore strategy: loads the saved snapshot, generates a structured Markdown brief (tasks by status, decisions, wave progress, modified files, agent states), and injects it via `additionalContext` so Claude resumes with full awareness of prior work.

### Subagent Monitoring and Agent Hierarchy

DCM tracks the full lifecycle of every subagent with parent/child hierarchy:

| Event | Hook | What Is Tracked |
|-------|------|-----------------|
| Agent spawned | `track-agent-start.sh` | agent_id, type, description, session, parent_agent_id |
| Tool call | `track-action.sh` | tool_name, type, input, exit_code, token consumption |
| Agent completed | `track-agent-end.sh` | status update, cache cleanup |
| Agent result | `save-agent-result.sh` | result summary broadcast, batch completion check |
| Operation blocked | `safety-gate.sh` | blocked command, reason, session context |

### Inter-Agent Communication

Agents coordinate through a built-in pub/sub messaging system with topics, subscriptions, blocking dependencies, and automatic result broadcasting when subagents finish.

### Wave Orchestration

Complex work is decomposed into **waves** -- sequential execution phases where subtasks within each wave run in parallel. The API supports task decomposition, batch submission, conflict detection, and result synthesis.

### Real-Time Dashboard

The monitoring dashboard at `http://localhost:3848` provides 12 pages of live visibility:

| Page | What It Shows |
|------|---------------|
| **Dashboard** | Health gauge, KPI cards, agent distribution, activity feed |
| **Sessions** | Session browser with filters, tool counters, timeline |
| **Agents** | Main/Subagent split, parent links, animated cards, Safety Gate |
| **Messages** | Inter-agent message history with expandable payloads |
| **Cockpit** | Real-time session cockpit with 3D topology |
| **Compact** | Compact operations and snapshot history |
| **Performance** | API response times, success rates, system health |
| **Tools** | Tool usage statistics and distribution |
| **Context** | Context brief viewer and generation |
| **Projects** | Project hierarchy browser with drill-down |
| **Routing** | Keyword-to-tool mappings, routing tester |
| **Registry** | Agent catalog browser (66+ agents, 226+ skills) |

Built with Next.js 16, React 19, shadcn/ui, Recharts, TanStack Query, Three.js, and Tailwind CSS 4. Full light/dark mode with glassmorphism cards.

### Intelligent Routing

DCM learns which tools work best for which tasks through a feedback-driven keyword scoring system. Scores adjust dynamically based on success rates.

---

## Tech Stack

### Backend (API + WebSocket)

| Technology | Version | Role |
|------------|---------|------|
| [Bun](https://bun.sh) | 1.x | Runtime, package manager, test runner |
| [Hono](https://hono.dev) | 4.x | HTTP framework (API server) |
| [PostgreSQL](https://www.postgresql.org/) | 14+ | Persistent storage (19 tables, 4 views) |
| [Zod](https://zod.dev) | 4.x | Input validation on all endpoints |
| TypeScript | 5.x | Type safety |

### Dashboard

| Technology | Version | Role |
|------------|---------|------|
| [Next.js](https://nextjs.org/) | 16.x | React framework, SSR |
| [React](https://react.dev/) | 19.x | UI library |
| [TanStack Query](https://tanstack.com/query) | 5.x | Server state management |
| [Recharts](https://recharts.org/) | 3.x | Charts and gauges |
| [Three.js](https://threejs.org/) | 0.183.x | 3D topology visualization |
| [Tailwind CSS](https://tailwindcss.com/) | 4.x | Styling |
| [shadcn/ui](https://ui.shadcn.com/) | -- | Component library (Radix primitives) |
| [Lucide](https://lucide.dev/) | -- | Icons |

### Infrastructure

| Technology | Role |
|------------|------|
| WebSocket (Bun native) | Real-time event streaming with HMAC auth |
| PostgreSQL LISTEN/NOTIFY | Event bridge to WebSocket |
| systemd user services | Process supervision, auto-restart, boot start |
| Docker Compose | Containerized deployment |
| Bash hooks | Claude Code lifecycle integration |

---

## Prerequisites

Before installing DCM, make sure the following are available on your system.

| Dependency | Minimum Version | Purpose | Install |
|------------|----------------|---------|---------|
| **PostgreSQL** | 14+ | Database | `sudo apt install postgresql postgresql-client` |
| **Bun** | 1.x | API + WS runtime, package manager | `curl -fsSL https://bun.sh/install \| bash` |
| **Node.js** | 22+ | Dashboard (Next.js) | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt install -y nodejs` |
| **Git** | 2.x | Cloning the repo | `sudo apt install git` |
| **jq** | 1.6+ | JSON parsing in hooks | `sudo apt install jq` |
| **curl** | 7.x | HTTP calls from hooks | `sudo apt install curl` |

Verify everything is installed:

```bash
bun --version        # Expected: 1.x.x
psql --version       # Expected: 14+
node --version       # Expected: v22.x.x
git --version        # Expected: 2.x.x
jq --version         # Expected: jq-1.6+
curl --version       # Expected: 7.x.x+
```

Make sure PostgreSQL is running and accessible:

```bash
sudo systemctl enable postgresql
sudo systemctl start postgresql
sudo systemctl status postgresql
```

---

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/ronylicha/Claude-DCM.git
cd Claude-DCM
```

### 2. Install backend dependencies

```bash
cd context-manager
bun install
```

### 3. Install dashboard dependencies

```bash
cd ../context-dashboard
npm install
cd ../context-manager
```

### 4. Create the PostgreSQL database and user

```bash
# Connect as the postgres superuser
sudo -u postgres psql

# Inside the psql shell:
CREATE USER dcm WITH PASSWORD 'your_secure_password_here';
CREATE DATABASE claude_context OWNER dcm;
GRANT ALL PRIVILEGES ON DATABASE claude_context TO dcm;
\q
```

### 5. Configure environment variables

```bash
# From the context-manager directory
cp .env.example .env
```

Edit `.env` with your database credentials:

```bash
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=claude_context
DB_USER=dcm
DB_PASSWORD=your_secure_password_here
PORT=3847
WS_PORT=3849
DASHBOARD_PORT=3848
```

### 6. Run database migrations

```bash
# Apply the schema (19 tables, 4 views, 25+ indexes)
bash scripts/setup-db.sh
```

### 7. Install Claude Code hooks

```bash
bash scripts/setup-hooks.sh
```

This merges DCM hook entries into `~/.claude/settings.json`, enabling lifecycle tracking across all Claude Code sessions.

### 8. Start all services

```bash
./dcm start
```

This launches three processes:
- **API Server** on port `3847` (Bun + Hono)
- **WebSocket Server** on port `3849` (Bun native WS)
- **Dashboard** on port `3848` (Next.js 16)

### 9. Verify everything is running

```bash
./dcm status
```

Expected output:

```
DCM Status

  Supervisor:          not installed (nohup mode)
  API (port 3847):       healthy (v3.1.0)
  WebSocket (port 3849):  running
  Dashboard (port 3848):  running
  PostgreSQL:             connected
  Claude Code hooks:      installed
```

Direct health check:

```bash
curl http://127.0.0.1:3847/health | jq .
```

Open the dashboard in your browser: [http://localhost:3848](http://localhost:3848)

### One-Command Install (Alternative)

If you prefer a guided setup that handles all of the above (dependencies, database, hooks, and optional systemd supervisor):

```bash
cd context-manager
./dcm install
```

---

## Architecture Overview

### System Architecture

```
+-----------------------------------------------------------------------------+
|                           CLAUDE CODE SESSION                                |
|                                                                              |
|  PreToolUse --- safety-gate.sh -------- BLOCK dangerous ops --> DCM API      |
|  PreToolUse --- track-agent-start.sh -- Log agent spawn ------> DCM API      |
|  PostToolUse -- track-action.sh ------- Log all tools --------> DCM API      |
|  PostToolUse -- track-agent-end.sh ---- Mark completed -------> DCM API      |
|  PostToolUse -- context-guardian.sh --- Monitor context -------- (local)      |
|  PreCompact --- pre-compact-save.sh --- Save snapshot --------> DCM API      |
|  SubagentStop - save-agent-result.sh -- Broadcast result -----> DCM API      |
|  SessionStart - post-compact-restore.sh  Restore context <----- DCM API      |
|                                                                              |
+--------------------------------------+---------------------------------------+
                                       | HTTP / curl (fire-and-forget)
                                       v
+------------------------------------------------------------------------------+
|                        DCM API Server (Bun + Hono)                           |
|                              Port 3847                                       |
|                                                                              |
|  86+ REST endpoints across 11 phases: actions, subtasks, messages,           |
|  compact, routing, orchestration, waves, registry, tokens, cockpit,          |
|  dashboard KPIs, agent turns, preemptive summaries                           |
|                                                                              |
|  PostgreSQL 14+: 19 tables, 4 views, JSONB metadata, 25+ indexes            |
+--------------+-------------------------------+-------------------------------+
               | LISTEN/NOTIFY                 | HTTP
               v                               v
+--------------------------+     +---------------------------------------------+
|   WebSocket Server       |     |   Next.js Dashboard                         |
|   Port 3849              |     |   Port 3848                                 |
|                          |     |                                             |
|   Real-time events       |     |   12 pages: Dashboard, Agents, Sessions,    |
|   HMAC auth              |---->|   Cockpit, Compact, Performance, Tools,     |
|   Channel subscriptions  |     |   Context, Projects, Messages, Routing,     |
|                          |     |   Registry                                  |
+--------------------------+     +---------------------------------------------+
```

### Service Architecture

| Service | Stack | Port | Role |
|---------|-------|------|------|
| **DCM API** | Bun + Hono + Zod | 3847 | REST API, compact save/restore, routing, orchestration, safety tracking |
| **WebSocket** | Bun native WS + LISTEN/NOTIFY | 3849 | Real-time event streaming, HMAC auth, channel subscriptions |
| **Dashboard** | Next.js 16 + React 19 + Recharts + Three.js | 3848 | 12-page monitoring UI with live activity feed |
| **PostgreSQL** | PostgreSQL 14+ | 5432 | 19 tables, 4 views, JSONB metadata, GIN indexes |

### Data Flow

```
Claude Code hooks (bash scripts)
        |
        | curl POST (fire-and-forget, <5ms)
        v
    DCM API (Hono)
        |
        | Parameterized SQL queries
        v
    PostgreSQL
        |
        | LISTEN/NOTIFY
        v
    WebSocket Server
        |
        | ws:// push
        v
    Next.js Dashboard (browser)
```

### Directory Structure

```
Claude-DCM/
|-- context-manager/           # Backend: API + WebSocket + hooks
|   |-- src/
|   |   |-- api/               # 27 API route modules (one per resource)
|   |   |-- db/                # Database client, schema.sql, migrations/
|   |   |-- lib/               # Logger, utilities
|   |   |-- middleware/         # Rate limiting, CORS
|   |   |-- templates/         # Context brief templates
|   |   |-- tests/             # Bun test suites
|   |   |-- waves/             # Wave state machine
|   |   |-- websocket/         # WS server, auth, bridge
|   |   |-- server.ts          # API entry point
|   |   |-- websocket-server.ts # WS entry point
|   |   +-- config.ts          # Centralized configuration
|   |-- hooks/                 # 20+ bash hook scripts
|   |-- scripts/               # setup-db, setup-hooks, setup-supervisor
|   |-- systemd/               # Service unit files (dcm.target, *.service)
|   |-- agents/                # Monitored agent templates
|   |-- dcm                    # CLI entry point (bash)
|   +-- package.json
|-- context-dashboard/         # Frontend: Next.js 16 dashboard
|   |-- src/
|   |   |-- app/               # 14 page routes (App Router)
|   |   +-- components/        # React components (shadcn/ui)
|   +-- package.json
|-- docker-compose.yml         # Containerized deployment
|-- docs/                      # Wiki, API docs, analysis
+-- README.md
```

### Database Schema (19 Tables, 4 Views)

**Core hierarchy:**

| Table | Purpose |
|-------|---------|
| `projects` | Projects identified by working directory |
| `requests` | User prompts linked to a project |
| `task_lists` | Waves of objectives for a request |
| `subtasks` | Agent tasks within a wave (with parent/child hierarchy) |
| `actions` | Tool invocations with compressed input/output |
| `sessions` | Claude Code session tracking |

**Communication:**

| Table | Purpose |
|-------|---------|
| `agent_messages` | Pub/sub inter-agent messages |
| `agent_contexts` | Agent recovery snapshots for compact operations |

**Orchestration:**

| Table | Purpose |
|-------|---------|
| `orchestration_batches` | Batch submission and progress tracking |
| `wave_states` | Wave execution state machine |

**Intelligence:**

| Table | Purpose |
|-------|---------|
| `keyword_tool_scores` | Routing intelligence (keyword-to-tool scoring) |
| `agent_registry` | Agent type catalog (scope, tools, constraints) |
| `agent_capacity` | Real-time context capacity tracking per agent |
| `token_consumption` | Token usage per agent per session |
| `calibration_ratios` | Real vs estimated token calibration |
| `preemptive_summaries` | Pre-generated summaries before compaction |

**Infrastructure:**

| Table | Purpose |
|-------|---------|
| `schema_version` | Migration tracking |

**Views:**

| View | Purpose |
|------|---------|
| `v_actions_full` | Actions with full project hierarchy (JOIN across 5 tables) |
| `v_active_agents` | Currently running/paused/blocked agents |
| `v_unread_messages` | Unexpired unread messages |
| `v_project_stats` | Aggregated statistics per project |

---

## Environment Variables

Configure in `context-manager/.env`. Bun loads the file automatically.

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `DB_USER` | PostgreSQL username | `dcm` |
| `DB_PASSWORD` | PostgreSQL password | `your_secure_password` |

### Optional (with defaults)

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `127.0.0.1` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `claude_context` | Database name |
| `DB_MAX_CONNECTIONS` | `10` | Connection pool size |
| `HOST` | `127.0.0.1` | API server bind address |
| `PORT` | `3847` | API server port |
| `WS_PORT` | `3849` | WebSocket server port |
| `DASHBOARD_PORT` | `3848` | Dashboard dev server port |
| `WS_AUTH_SECRET` | -- | HMAC secret for WebSocket auth (required in production, min 32 chars) |
| `NODE_ENV` | `development` | Environment (`production` enforces WS auth) |
| `ALLOWED_ORIGINS` | `http://localhost:3848,http://127.0.0.1:3848` | CORS allowed origins (comma-separated) |
| `MESSAGE_TTL_MS` | `3600000` | Message time-to-live (1 hour) |
| `HEALTHCHECK_INTERVAL_MS` | `30000` | Internal healthcheck interval (30s) |
| `MAX_DB_RETRIES` | `3` | Database connection retries on startup |
| `CLEANUP_STALE_HOURS` | `0.5` | Stale session threshold |
| `CLEANUP_INACTIVE_MINUTES` | `10` | Inactive session threshold |
| `CLEANUP_SNAPSHOT_MAX_HOURS` | `24` | Snapshot retention period |
| `CLEANUP_INTERVAL_MS` | `60000` | Cleanup job interval |
| `CLEANUP_READ_MSG_MAX_HOURS` | `24` | Read message retention period |
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`) |

---

## Available Scripts

### dcm CLI (primary interface)

Run from the `context-manager/` directory:

```bash
# Full setup: prerequisites check, deps, database, hooks, supervisor
./dcm install

# Service management
./dcm start              # Start API + WebSocket + Dashboard
./dcm stop               # Stop all services
./dcm restart            # Stop then start
./dcm status             # Health check for all components
./dcm health             # Quick API health check (JSON output)

# Log viewing
./dcm logs api           # Tail API server logs
./dcm logs ws            # Tail WebSocket server logs
./dcm logs dashboard     # Tail Dashboard logs

# Hook management
./dcm hooks              # Install/update Claude Code hooks in settings.json
./dcm unhook             # Remove all DCM hooks (with backup)

# Database management
./dcm db:setup           # Initialize database schema
./dcm db:reset           # Drop and recreate database (destructive, requires confirmation)

# Context operations
./dcm snapshot <session_id>              # Trigger a manual context snapshot
./dcm context <agent_id> [session_id]    # Get context brief for an agent

# Systemd supervisor
./dcm supervisor status     # Show supervisor and service status
./dcm supervisor logs       # Follow all service logs (journalctl)
./dcm supervisor restart    # Restart all via systemd
./dcm supervisor enable     # Enable auto-start on boot
./dcm supervisor disable    # Disable auto-start
./dcm supervisor reload     # Re-template and restart after update
./dcm supervisor uninstall  # Remove supervisor completely

# Meta
./dcm version            # Show version
./dcm help               # Show all commands
```

### bun scripts (backend)

Run from the `context-manager/` directory:

```bash
bun run dev              # Start API server with --watch (auto-reload)
bun run start            # Start API + WebSocket servers
bun run start:api        # Start API server only
bun run start:ws         # Start WebSocket server only
bun test                 # Run test suite
bun test --watch         # Run tests in watch mode
bun run setup:db         # Initialize database schema
bun run setup:hooks      # Install Claude Code hooks
bun run install:full     # Install deps + setup DB + install hooks
bun run backup           # Backup database
bun run health           # Run health check script
bun run typecheck        # TypeScript type checking (tsc --noEmit)
```

### npm scripts (dashboard)

Run from the `context-dashboard/` directory:

```bash
npm run dev              # Start dev server on port 3848
npm run build            # Production build
npm run start            # Start production server
npm run lint             # ESLint
```

### Terminal Dashboard

```bash
bash hooks/dashboard.sh              # Snapshot view with KPIs and active agents
bash hooks/dashboard.sh --watch      # Auto-refresh every 2 seconds
bash hooks/dashboard.sh --json       # Raw JSON output (for scripting)
bash hooks/dashboard.sh --clean      # Clean data older than 7 days
```

---

## Testing

DCM uses Bun's built-in test runner. All tests are in `context-manager/src/tests/`.

### Run the full test suite

```bash
cd context-manager
bun test
```

### Run tests in watch mode

```bash
bun test --watch
```

### Run a specific test file

```bash
bun test src/tests/api.test.ts
bun test src/tests/messages.test.ts
bun test src/tests/cleanup.test.ts
bun test src/tests/orchestration-planner.test.ts
bun test src/tests/ws.test.ts
```

### Test suites

| File | Coverage |
|------|----------|
| `api.test.ts` | API endpoint integration tests |
| `messages.test.ts` | Inter-agent messaging |
| `cleanup.test.ts` | Cleanup and retention logic |
| `orchestration-planner.test.ts` | Task decomposition and planning |
| `ws.test.ts` | WebSocket server and event streaming |

### Test all hooks

A utility script validates that all hooks execute without error:

```bash
bash hooks/test-all-hooks.sh
```

---

## Deployment

DCM supports four deployment methods, from simplest to most production-ready.

### Method 1: dcm CLI (recommended for local development)

The quickest path to a running system:

```bash
cd context-manager
./dcm install    # Full setup (deps, DB, hooks, optional supervisor)
./dcm start      # Start all services
./dcm status     # Verify
```

Services run via `nohup` in the background. Logs are written to `/tmp/dcm-api.log`, `/tmp/dcm-ws.log`, and `/tmp/dcm-dashboard.log`.

### Method 2: Docker Compose (recommended for isolated environments)

A `docker-compose.yml` at the repository root defines all four services (PostgreSQL, API, WebSocket, Dashboard):

```bash
# Set required environment variables
export DB_PASSWORD="your_secure_password"
export WS_AUTH_SECRET="$(openssl rand -hex 32)"

# Start all services
docker compose up -d

# Verify
docker compose ps
curl http://127.0.0.1:3847/health | jq .

# View logs
docker compose logs -f dcm-api
docker compose logs -f dcm-ws
docker compose logs -f dcm-dashboard

# Stop
docker compose down

# Stop and remove data
docker compose down -v
```

The PostgreSQL container automatically initializes the schema from `context-manager/src/db/schema.sql` on first run. Data persists in a named Docker volume (`pgdata`).

### Method 3: Systemd Supervisor (recommended for production on Linux)

The supervisor sets up systemd user services that auto-restart on failure and start on boot:

```bash
cd context-manager

# Install supervisor (included in `dcm install`, or run manually)
bash scripts/setup-supervisor.sh install

# Manage via dcm
./dcm supervisor status       # Check all services
./dcm supervisor logs         # Follow logs via journalctl
./dcm supervisor enable       # Enable auto-start on login
./dcm supervisor disable      # Disable auto-start
./dcm supervisor restart      # Restart all services
./dcm supervisor reload       # Re-template after config change
./dcm supervisor uninstall    # Remove everything

# Or manage directly via systemctl
systemctl --user status dcm.target
systemctl --user status dcm-api
systemctl --user status dcm-ws
systemctl --user status dcm-dashboard
systemctl --user restart dcm.target
journalctl --user -u dcm-api -f
```

The supervisor creates three service units under `~/.config/systemd/user/`:

| Unit | Description |
|------|-------------|
| `dcm.target` | Groups all DCM services |
| `dcm-api.service` | API server with health check, 512M memory limit |
| `dcm-ws.service` | WebSocket server |
| `dcm-dashboard.service` | Next.js dashboard |

Features: auto-restart on crash (`RestartSec=5`), boot start via `WantedBy=default.target`, rate limiting (`StartLimitBurst=5`), watchdog (`WatchdogSec=120`), journal logging.

### Method 4: Manual (for custom setups)

Start each service in a separate terminal or process manager:

```bash
# Terminal 1: API Server
cd context-manager
DB_USER=dcm DB_PASSWORD=your_password bun run src/server.ts

# Terminal 2: WebSocket Server
cd context-manager
DB_USER=dcm DB_PASSWORD=your_password bun run src/websocket-server.ts

# Terminal 3: Dashboard
cd context-dashboard
npm run dev
```

---

## Troubleshooting

### "DB_USER environment variable is required"

The API server requires `DB_USER` and `DB_PASSWORD` to be set. Create a `.env` file in the `context-manager/` directory:

```bash
cp .env.example .env
# Edit .env with your database credentials
```

### API server starts but database reports "unhealthy"

PostgreSQL is not running or the credentials are wrong:

```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Test connection manually
psql -h 127.0.0.1 -U dcm -d claude_context -c "SELECT 1;"

# If the database doesn't exist yet
sudo -u postgres createdb claude_context
sudo -u postgres psql -c "CREATE USER dcm WITH PASSWORD 'your_password';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE claude_context TO dcm;"
```

### Port already in use

Another process is using port 3847, 3849, or 3848:

```bash
# Find what's using the port
lsof -i :3847
lsof -i :3849
lsof -i :3848

# Kill the process
kill $(lsof -ti :3847)

# Or change ports in .env
PORT=3857
WS_PORT=3859
DASHBOARD_PORT=3858
```

### Hooks not firing / not installed

Verify hooks are present in Claude Code settings:

```bash
cat ~/.claude/settings.json | jq '.hooks'
```

If missing, reinstall:

```bash
cd context-manager
./dcm hooks
```

### Dashboard shows "Failed to fetch" or CORS errors

The API server is either not running or the dashboard URL is not in the allowed origins:

```bash
# Check API is running
curl http://127.0.0.1:3847/health

# If using a non-default host/port, add it to .env
ALLOWED_ORIGINS=http://localhost:3848,http://your-host:3848
```

### WebSocket connection refused

The WebSocket server runs separately from the API:

```bash
# Check WS server is running
lsof -i :3849

# Start it if missing
cd context-manager
bun run src/websocket-server.ts
```

### "WS_AUTH_SECRET is not set" warning

In development this is a warning. In production (`NODE_ENV=production`) it is a fatal error. Generate a secret:

```bash
echo "WS_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
```

### Schema migration errors

If the schema is outdated, re-run setup:

```bash
cd context-manager
bash scripts/setup-db.sh
```

For a clean reset (destroys all data):

```bash
./dcm db:reset
```

### Supervisor services failing

Check logs via journalctl:

```bash
journalctl --user -u dcm-api --no-pager --lines 50
journalctl --user -u dcm-ws --no-pager --lines 50
journalctl --user -u dcm-dashboard --no-pager --lines 50
```

Reload after config changes:

```bash
./dcm supervisor reload
```

---

## Contributing

### Development Setup

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Install dependencies:
   ```bash
   cd context-manager && bun install
   cd ../context-dashboard && npm install
   ```
4. Set up the database: `cd ../context-manager && ./dcm db:setup`
5. Start services: `./dcm start`
6. Make changes and add tests
7. Run the test suite: `bun test`
8. Commit with conventional format: `git commit -m "feat: add my feature"`
9. Push and open a Pull Request

### Git Workflow

- **main**: production branch, protected
- **feature/xxx**: new features
- **fix/xxx**: bug fixes

### Conventional Commits

All commit messages follow the format:

```
type(scope): description

Types: feat, fix, refactor, docs, test, chore, perf, excellence
Scope: api, ws, dashboard, hooks, db, cli, schema
```

Examples:

```
feat(api): add preemptive summary endpoint
fix(hooks): handle missing session_id in track-action
refactor(dashboard): extract agent card component
docs(readme): update architecture diagram
```

### Extension Points

| What | Where |
|------|-------|
| Add agent types | `src/data/catalog.ts` |
| Create prompt templates | `src/templates/` |
| Add custom hooks | `hooks/` |
| Customize safety gate rules | `hooks/safety-gate.sh` |
| Create monitored agents | `agents/monitored-agent-template.md` |
| Extend the schema | `src/db/migrations/` |
| Add dashboard pages | `../context-dashboard/src/app/` |

See the full [Contributing Guide](docs/wiki/15-contributing.md) for code style and PR process.

---

## Documentation

| Resource | Description |
|----------|-------------|
| [Wiki](docs/wiki/) | 16-page technical documentation covering every subsystem |
| [API Docs (Swagger UI)](docs/api/swagger.html) | Interactive API reference |
| [OpenAPI Spec](docs/api/openapi.yaml) | Machine-readable API specification |
| [Codebase Analysis](docs/_codebase-analysis.md) | Complete technical analysis |

---

## License

MIT
