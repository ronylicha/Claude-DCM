# DCM - Distributed Context Manager

<!-- TODO: Add project logo -->
<!-- ![DCM Logo](docs/assets/logo.png) -->

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/runtime-Bun-f9f1e1.svg)](https://bun.sh)
[![PostgreSQL 16](https://img.shields.io/badge/database-PostgreSQL%2016-336791.svg)](https://www.postgresql.org/)

**Persistent context, compact recovery, and cross-agent sharing for Claude Code multi-agent sessions.**

---

## What is DCM?

DCM (Distributed Context Manager) is a backend service that gives Claude Code sessions persistent memory. When Claude Code runs multi-agent workflows, each agent operates in isolation with a finite context window. DCM solves this by tracking every tool call, saving context snapshots before compaction, restoring them afterward, and sharing results across agents in real time.

DCM integrates with Claude Code through its hooks system. Lightweight bash scripts fire on key lifecycle events -- session start, tool use, agent completion, compaction -- and report to a local API backed by PostgreSQL. When Claude's context window fills up and the conversation compacts, DCM injects a context brief so the session picks up where it left off without losing track of active tasks, modified files, or key decisions.

The system consists of three services: a REST API for tracking and context management, a WebSocket server for real-time event streaming, and a Next.js dashboard for monitoring. All three can be started with a single command, or auto-launched when Claude Code starts via the plugin system.

## Key Features

- **Compact save/restore** -- Automatically saves context snapshots before compaction and restores them afterward, so sessions never lose track of work in progress
- **Cross-agent sharing** -- When a subagent finishes, its result is broadcast so other agents can access it through the context API
- **Proactive monitoring** -- Monitors transcript size every 10th tool call and triggers early snapshots when nearing the context limit
- **Real-time event streaming** -- WebSocket server with LISTEN/NOTIFY bridge for live activity feeds
- **Tool and session tracking** -- Records every tool invocation, agent delegation, and session lifecycle event
- **Routing intelligence** -- Keyword-based tool suggestion with feedback-driven weight adjustment
- **Inter-agent messaging** -- Pub/sub messaging system for agent coordination
- **Auto-start services** -- In both CLI and plugin mode, DCM auto-launches when Claude Code starts a session
- **Monitoring dashboard** -- Next.js UI with live activity feeds, session timelines, agent statistics, and tool analytics

## Architecture Overview



| Component         | Stack                                      | Port | Description                                         |
| ----------------- | ------------------------------------------ | ---- | --------------------------------------------------- |
| **DCM API**       | Bun, Hono, Bun.sql, Zod                    | 3847 | REST API, compact save/restore, routing intelligence |
| **DCM WebSocket** | Bun native WS, LISTEN/NOTIFY               | 3849 | Real-time events, HMAC auth, auto-reconnect          |
| **DCM Dashboard** | Next.js 16, React 19, Recharts, shadcn/ui  | 3848 | Monitoring UI with live activity feed                |
| **PostgreSQL**    | PostgreSQL 16                               | 5432 | 10 tables, 4 views, JSONB metadata                   |

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) 1.x
- [PostgreSQL](https://www.postgresql.org/) 16+
-  and  (standard on most Linux/macOS systems)
- [Node.js](https://nodejs.org/) 22+ (for the dashboard only)

### One-command install



Restart Claude Code to pick up the new hooks. From that point on, DCM tracks every session automatically.

### Auto-start via plugin

When installed as a Claude Code plugin, DCM auto-launches its services the moment Claude Code starts a session. No manual  needed.



On the next Claude Code session, the  hook detects that DCM is not running, starts the API and WebSocket servers, and waits for health confirmation -- all within the SessionStart hook timeout.

**Prerequisite**: PostgreSQL must be running before Claude Code starts. Using systemd to manage PostgreSQL is recommended so it starts at boot.

## Installation Methods

| Feature                      | CLI Mode ()                    | Plugin Mode (auto-discovery)                     |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------ |
| **Setup**                    |  then           | Symlink into              |
| **Hook injection**           | Merges into         | Plugin's  loaded by Claude Code |
| **Service startup**          |  or auto via ensure-services.sh | Auto via  on SessionStart    |
| **Hook paths**               | Absolute paths to hooks directory            |  variable paths    |
| **Scope**                    | Global (all projects)                        | Per-plugin                                       |
| **Uninstall**                |                                | Remove the symlink                               |

Both modes include the  hook, which auto-starts DCM services if they are not already running when a Claude Code session begins.

## How It Works

DCM uses Claude Code's hooks system to track and manage context. All hooks are fire-and-forget with short timeouts -- they never block Claude.



### Compact save/restore

When Claude's context window fills up, the conversation compacts. Without DCM, agents lose track of what happened before. DCM handles this automatically:

1. **Before compact**:  saves active tasks, modified files, agent states, and key decisions to the database
2. **After compact**:  fetches a context brief and injects it back into the session via 
3. **Proactive monitoring**:  runs every 10th tool call; if the transcript exceeds 800 KB, it triggers an early snapshot so data is saved even if compaction happens unexpectedly

### Cross-agent sharing

When a subagent finishes,  broadcasts its result as a message. Other agents pick this up through the context API, preventing work from getting siloed.

## Auto-Start Feature

In both CLI and plugin installation modes, the  hook runs on every  event. It performs the following:

1. **Health check** -- Calls  on the API. If healthy, exits immediately (no-op).
2. **Lock acquisition** -- Creates a lock file to prevent concurrent auto-starts when multiple Claude sessions launch simultaneously.
3. **PostgreSQL check** -- Verifies PostgreSQL is reachable via /var/run/postgresql:5432 - accepting connections. If not, logs a warning and exits gracefully.
4. **Service start** -- Launches the API and WebSocket servers as background processes.
5. **Readiness wait** -- Polls the health endpoint for up to 5 seconds until the API confirms healthy status.

The hook is idempotent: if services are already running, it exits in under 50 ms. If PostgreSQL is not available, it skips startup without error.

**Recommended setup**: Configure PostgreSQL to start at boot via systemd so it is always available when Claude Code launches:



## CLI Commands

| Command          | Description                                           |
| ---------------- | ----------------------------------------------------- |
|     | Full setup: dependencies, database, hooks             |
|       | Start API + WebSocket + Dashboard                     |
|        | Stop all DCM services                                 |
|     | Restart all services                                  |
|      | Health check for all components                       |
|       | Install or update Claude Code hooks                   |
|      | Remove DCM hooks from        |
|  | Tail logs for a service (, , or ) |
|    | Trigger a manual context snapshot                     |
|     | Get context brief for an agent                        |
|      | Quick API health check (JSON output)                  |
|    | Initialize database schema                            |
|    | Drop and recreate database (destructive)              |
|     | Show DCM version                                      |

## Documentation

| Document                                                         | Description                                     |
| ---------------------------------------------------------------- | ----------------------------------------------- |
| [](docs/ARCHITECTURE.md)                   | System design, data flow, database schema, ADRs |
| [](docs/API.md)                                     | Full API reference with examples                |
| [](docs/INTEGRATION.md)                     | Claude Code hooks setup, SDK usage              |
| [](docs/DEPLOYMENT.md)                       | Docker, systemd, manual deployment guides       |
| [](context-manager/openapi.yaml)   | OpenAPI 3.0 specification                       |

## Dashboard

<!-- TODO: Add dashboard screenshot -->
<!-- ![DCM Dashboard](docs/assets/dashboard-screenshot.png) -->

The monitoring dashboard is available at  and updates in real time via WebSocket.

| Page               | Features                                                                 |
| ------------------ | ------------------------------------------------------------------------ |
| **Dashboard**      | Health gauge, KPI cards with sparklines, area/bar charts, activity feed  |
| **Live Activity**  | Real-time event stream, agent topology grid                              |
| **Sessions**       | Session list with filters, search, tool counters                         |
| **Session Detail** | Timeline view with request cards and task items                          |
| **Projects**       | Project list with KPIs, search                                           |
| **Agents**         | Agent statistics, active agents, type distribution                       |
| **Tools**          | Tool usage analytics, type distribution, success rates                   |
| **Routing**        | Keyword-tool mappings, routing tester with live feedback                 |
| **Messages**       | Inter-agent message history with expandable payloads                     |
| **Context**        | Agent context browser with stats and type distribution                   |

Built with shadcn/ui, Radix UI, and Tailwind CSS. Dark mode with glassmorphism cards.

## Configuration

Copy  to  and edit:



| Variable           | Default          | Description                                            |
| ------------------ | ---------------- | ------------------------------------------------------ |
|           |       | PostgreSQL host                                        |
|           |            | PostgreSQL port                                        |
|           |  | Database name                                          |
|           | *(required)*     | Database user                                          |
|       | *(required)*     | Database password                                      |
|              |            | API server port                                        |
|           |            | WebSocket server port                                  |
|    |            | Dashboard port                                         |
|    | --               | HMAC secret for WebSocket auth (required in production)|
|          |      | External host for dashboard API URLs                   |
|          |      | Environment ( enforces WS auth)            |

## Tests

bun test v1.3.6 (d530ed99)
bun test v1.3.6 (d530ed99)
bun test v1.3.6 (d530ed99)

## Contributing

1. Fork the repository
2. Create a feature branch ()
3. Make your changes and add tests
4. Run the test suite (bun test v1.3.6 (d530ed99))
5. Commit your changes (Sur la branche feature/my-feature
Modifications qui ne seront pas validées :
  (utilisez "git add <fichier>..." pour mettre à jour ce qui sera validé)
  (utilisez "git restore <fichier>..." pour annuler les modifications dans le répertoire de travail)
	modifié :         docs/ARCHITECTURE.md

Fichiers non suivis:
  (utilisez "git add <fichier>..." pour inclure dans ce qui sera validé)
	B{Lock
	D
	D[Exit]
	G{pg_isready?}
	K
	LISTEN dcm_events
	M
	No
	N{API
	Yes
	global
	metrics
	parse
	pg_notify('dcm_events', json)

aucune modification n'a été ajoutée à la validation (utilisez "git add" ou "git commit -a"))
6. Push to the branch ()
7. Open a Pull Request

Please ensure all tests pass and follow the existing code style.

## License

MIT
