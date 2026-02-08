# DCM Deployment Guide

Comprehensive guide for deploying the Distributed Context Manager (DCM). DCM provides persistent context, cross-agent sharing, and compact recovery for Claude Code multi-agent sessions.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Installation Methods](#installation-methods)
  - [Method A: DCM CLI (recommended for manual control)](#method-a-dcm-cli-recommended-for-manual-control)
  - [Method B: Plugin Mode (recommended for auto-start)](#method-b-plugin-mode-recommended-for-auto-start)
  - [Method C: Docker Compose](#method-c-docker-compose)
  - [Method D: Systemd Services (production)](#method-d-systemd-services-production)
- [Auto-Start Behavior](#auto-start-behavior)
- [Configuration](#configuration)
- [Ports](#ports)
- [Health Checks](#health-checks)
- [Logs](#logs)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)

---

## Prerequisites

The following tools must be installed on your system before deploying DCM.

| Dependency | Version | Purpose | Install |
|------------|---------|---------|---------|
| **Bun** | 1.x+ | Runs API and WebSocket servers | `curl -fsSL https://bun.sh/install \| bash` |
| **PostgreSQL** | 16+ | Primary data store | `sudo apt install postgresql postgresql-client` |
| **jq** | any | JSON processing in hook scripts | `sudo apt install jq` |
| **curl** | any | Health checks and HTTP calls in hooks | `sudo apt install curl` |
| **lsof** | any | Port detection during start/stop | `sudo apt install lsof` |

Verify your setup:

```bash
bun --version      # expect 1.x
psql --version     # expect 16+
jq --version       # any version
curl --version     # any version
lsof -v            # any version
```

Optional dependencies:

| Dependency | Version | Purpose |
|------------|---------|---------|
| Node.js | 22+ | Dashboard (Next.js) |
| Docker + Compose | 24+ | Method C only |

---

## Installation Methods

### Method A: DCM CLI (recommended for manual control)

The `dcm` CLI script at `context-manager/dcm` provides the simplest path from zero to running. It handles dependency installation, database setup, hook injection, and service lifecycle management.

#### Step 1: Clone and install

```bash
git clone git@github.com:ronylicha/Claude-DCM.git
cd Claude-DCM/context-manager
./dcm install
```

The `install` command performs five steps automatically:

1. Checks prerequisites (bun, psql, jq, curl)
2. Runs `bun install` for API and WebSocket dependencies
3. Creates `.env` from `.env.example` if it does not exist
4. Runs the database setup script (creates database and applies schema)
5. Injects DCM hooks into `~/.claude/settings.json`

#### Step 2: Configure environment

Edit the `.env` file with your database credentials:

```bash
# Edit context-manager/.env
DB_USER=your_user
DB_PASSWORD=your_secure_password
```

#### Step 3: Start services

```bash
./dcm start
```

This launches the API server, WebSocket server, and Dashboard (if the `context-dashboard` directory exists) as background processes. PID files are stored in `/tmp/.dcm-pids/`.

#### Step 4: Verify

```bash
./dcm status
```

Expected output shows all services as healthy/running.

#### CLI Command Reference

| Command | Description |
|---------|-------------|
| `dcm install` | Full setup: dependencies, database, hooks |
| `dcm start` | Start all services as background processes |
| `dcm stop` | Stop all services (PID files + port fallback) |
| `dcm restart` | Stop then start |
| `dcm status` | Health status of all components |
| `dcm health` | Quick API health check (JSON output) |
| `dcm hooks` | Install/update Claude Code hooks |
| `dcm unhook` | Remove DCM hooks from Claude Code settings |
| `dcm logs api\|ws\|dashboard` | Tail service logs |
| `dcm snapshot [session_id]` | Trigger a manual context snapshot |
| `dcm context <agent_id> [session_id]` | Get context brief for an agent |
| `dcm db:setup` | Initialize database schema |
| `dcm db:reset` | Drop and recreate database (destructive) |
| `dcm version` | Print version |

---

### Method B: Plugin Mode (recommended for auto-start)

Plugin mode integrates DCM directly into Claude Code's plugin system. Services start automatically at every session without manual intervention.

#### How it works

DCM includes a plugin manifest at `context-manager/.claude-plugin/plugin.json`. When Claude Code discovers this plugin, it registers all hooks from `context-manager/hooks/hooks.json` automatically using `${CLAUDE_PLUGIN_ROOT}` for path resolution. The `ensure-services.sh` hook triggers on every `SessionStart(startup)` event to start services if they are not already running.

#### Installation

Place or symlink the `context-manager` directory where Claude Code discovers plugins:

```bash
# Option 1: Symlink into your project
ln -s /path/to/Claude-DCM/context-manager .claude-plugin-dcm

# Option 2: Reference via Claude Code plugin commands
# (depends on your Claude Code version)
```

#### Prerequisites for Plugin Mode

Even in Plugin Mode, the following must be pre-configured:

1. **Dependencies installed**: Run `bun install` inside `context-manager/` at least once
2. **Environment file**: A valid `.env` must exist in `context-manager/`
3. **Database ready**: PostgreSQL must be running and the schema applied
4. **PostgreSQL auto-start**: Enable PostgreSQL to start at boot:

```bash
sudo systemctl enable postgresql
```

#### What the plugin registers

The `hooks.json` file registers hooks for six Claude Code events:

| Event | Hook Script | Timeout | Purpose |
|-------|-------------|---------|---------|
| `SessionStart(startup)` | `ensure-services.sh` | 10s | Auto-start API and WS if not running |
| `SessionStart(startup)` | `track-session.sh` | 5s | Create session hierarchy |
| `SessionStart(compact)` | `post-compact-restore.sh` | 8s | Restore context after compaction |
| `PostToolUse(*)` | `track-action.sh` | 3s | Track tool usage |
| `PostToolUse(Task)` | `track-agent.sh` | 3s | Track agent spawns |
| `PostToolUse(*)` | `monitor-context.sh` | 2s | Proactive transcript size monitoring |
| `PreCompact(auto\|manual)` | `pre-compact-save.sh` | 5s | Save snapshot before compaction |
| `SubagentStop` | `save-agent-result.sh` | 3s | Save agent results for cross-agent sharing |
| `SessionEnd` | `track-session-end.sh` | 3s | Session cleanup |

No manual editing of `~/.claude/settings.json` is required in Plugin Mode.

---

### Method C: Docker Compose

Docker Compose brings up all four services (PostgreSQL, API, WebSocket, Dashboard) in containers. A `docker-compose.yml` is provided at the project root.

#### Step 1: Configure

```bash
git clone git@github.com:ronylicha/Claude-DCM.git
cd Claude-DCM
```

Create a `.env` file at the project root:

```dotenv
DB_USER=dcm
DB_PASSWORD=your_secure_password
WS_AUTH_SECRET=$(openssl rand -hex 32)
```

#### Step 2: Start

```bash
docker compose up -d
```

#### Step 3: Verify

```bash
curl http://localhost:3847/health
```

#### Services started by Docker Compose

| Service | Image | Port | Role |
|---------|-------|------|------|
| `postgres` | postgres:16-alpine | 5432 | Database with auto-schema init |
| `dcm-api` | oven/bun:1 (built) | 3847 | REST API (Bun + Hono) |
| `dcm-ws` | oven/bun:1 (built) | 3849 | WebSocket server (Bun) |
| `dcm-dashboard` | node:22-alpine (built) | 3848 | Next.js monitoring dashboard |

The PostgreSQL schema is applied automatically on first boot via the `docker-entrypoint-initdb.d` mount. The API and WebSocket containers wait for PostgreSQL to pass its health check before starting.

#### Hooks with Docker Compose

Docker Compose only starts the servers. You still need to configure Claude Code hooks separately using either:

- `./dcm hooks` (CLI mode hook injection), or
- Plugin Mode (if using Claude Code plugin discovery)

#### Stop and clean up

```bash
# Stop services (data persists in the pgdata volume)
docker compose down

# Stop and remove all data
docker compose down -v
```

---

### Method D: Systemd Services (production)

For long-running production servers. Three unit files are provided in the repository with security hardening (`NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`) and memory limits.

#### Service overview

| Unit File | Memory Limit | Restart Policy | Depends On |
|-----------|-------------|----------------|------------|
| `context-manager-api.service` | 512 MB | on-failure | postgresql.service |
| `context-manager-ws.service` | 128 MB | on-failure | context-manager-api |
| `context-dashboard.service` | 512 MB | always | context-manager-api |

#### Installation

Before copying the unit files, edit them to match your system paths. The defaults assume:
- Working directory: `/home/rony/.claude/services/context-manager`
- Bun binary: nvm-managed path
- User: `rony`

Adjust `WorkingDirectory`, `ExecStart`, `EnvironmentFile`, and `User` as needed.

```bash
# Copy unit files
sudo cp context-manager/context-manager-api.service /etc/systemd/system/
sudo cp context-manager/context-manager-ws.service /etc/systemd/system/
sudo cp context-dashboard/context-dashboard.service /etc/systemd/system/

# Reload, enable, and start
sudo systemctl daemon-reload
sudo systemctl enable --now context-manager-api context-manager-ws context-dashboard
```

#### Managing systemd services

```bash
# Check status
sudo systemctl status context-manager-api

# View logs
sudo journalctl -u context-manager-api -f

# Restart a single service
sudo systemctl restart context-manager-api

# Stop everything
sudo systemctl stop context-manager-api context-manager-ws context-dashboard
```

---

## Auto-Start Behavior

This section explains how `ensure-services.sh` works. This is the mechanism that makes DCM start automatically without manual intervention.

### When it triggers

The `ensure-services.sh` script is registered as a `SessionStart(startup)` hook. It executes at the beginning of **every Claude Code session**, whether you use CLI Mode or Plugin Mode. The hook runs before Claude Code begins processing your first prompt.

### What it does (step by step)

```
SessionStart
    |
    v
[1] Check lock file (/tmp/.dcm-autostart.lock)
    |--- Lock exists and < 30s old? Wait for other instance, then exit
    |--- Lock exists and > 30s old? Remove stale lock, continue
    |--- No lock? Continue
    |
    v
[2] Quick health check: curl http://127.0.0.1:3847/health
    |--- API responds "healthy"? Exit immediately (nothing to do)
    |--- No response? Continue to start services
    |
    v
[3] Acquire lock (write PID to /tmp/.dcm-autostart.lock)
    |
    v
[4] Check PostgreSQL: pg_isready
    |--- Not ready? Log warning, exit (cannot start without database)
    |--- Ready? Continue
    |
    v
[5] Start API server if not responding
    |   nohup bun run src/server.ts > /tmp/dcm-api.log 2>&1 &
    |
    v
[6] Start WebSocket server if port not in use
    |   nohup bun run src/websocket-server.ts > /tmp/dcm-ws.log 2>&1 &
    |
    v
[7] Wait for API to become healthy (up to 5 seconds, polling every 0.5s)
    |
    v
[8] Release lock, exit
```

### Key properties

- **Idempotent**: If services are already running, the script exits immediately after the health check in step 2. There is no performance penalty for sessions that start when DCM is already up.

- **Race-condition safe**: A lock file at `/tmp/.dcm-autostart.lock` prevents multiple concurrent Claude Code sessions from trying to start services simultaneously. If a lock exists and is less than 30 seconds old, the script waits for the first instance to finish starting. Stale locks (older than 30 seconds) are automatically cleaned up.

- **PostgreSQL dependency**: The script checks that PostgreSQL is accepting connections before attempting to start the API. If PostgreSQL is down, the script logs a warning and exits without starting anything. To ensure PostgreSQL is always available:

```bash
sudo systemctl enable postgresql
```

- **Timeout**: The hook has a 10-second timeout configured in `hooks.json`. The API readiness wait loop accounts for up to 5 seconds of that budget.

- **Graceful degradation**: If the API does not become healthy within 5 seconds, the script logs a warning to stderr but exits with code 0 so it does not block Claude Code from starting.

### Log output

Auto-start events are logged to stderr as JSON:

```json
{"status": "dcm-autostarted", "api_port": 3847, "ws_port": 3849}
```

If PostgreSQL is unavailable:

```json
{"warning": "DCM auto-start skipped: PostgreSQL not available"}
```

---

## Configuration

### Environment Variables

All configuration is done through the `context-manager/.env` file. Bun loads `.env` automatically at startup.

Copy the example file to get started:

```bash
cp context-manager/.env.example context-manager/.env
```

#### Database (required)

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DB_HOST` | `localhost` | No | PostgreSQL host |
| `DB_PORT` | `5432` | No | PostgreSQL port |
| `DB_NAME` | `claude_context` | No | Database name |
| `DB_USER` | -- | **Yes** | Database user (no default) |
| `DB_PASSWORD` | -- | **Yes** | Database password |
| `DB_MAX_CONNECTIONS` | `10` | No | Connection pool size |

#### API Server

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `HOST` | `127.0.0.1` | No | API bind address |
| `PORT` | `3847` | No | API server port |

#### WebSocket Server

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `WS_PORT` | `3849` | No | WebSocket server port |
| `WS_AUTH_SECRET` | -- | Production | HMAC-SHA256 secret for WebSocket token auth |

Generate a secret with:

```bash
openssl rand -hex 32
```

#### Application

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `MESSAGE_TTL_MS` | `3600000` | No | Message time-to-live (1 hour) |
| `HEALTHCHECK_INTERVAL_MS` | `30000` | No | Internal health check interval |
| `MAX_DB_RETRIES` | `3` | No | Database connection retry attempts |
| `NODE_ENV` | `production` | No | Environment mode |

#### Dashboard (`context-dashboard/.env.local`)

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:3847` | No | REST API URL for the client |
| `NEXT_PUBLIC_WS_URL` | `ws://127.0.0.1:3849` | No | WebSocket URL for the client |

#### Docker Compose only (root `.env`)

| Variable | Default | Description |
|----------|---------|-------------|
| `DCM_HOST` | `127.0.0.1` | Hostname baked into the dashboard build |
| `DASHBOARD_PORT` | `3848` | Host port mapped to the dashboard container |

---

## Ports

| Port | Service | Protocol | Configurable Via |
|------|---------|----------|------------------|
| 3847 | REST API | HTTP | `PORT` |
| 3849 | WebSocket | WS | `WS_PORT` |
| 3848 | Dashboard | HTTP | `DASHBOARD_PORT` |
| 5432 | PostgreSQL | TCP | `DB_PORT` |

All services bind to `127.0.0.1` by default. Change `HOST` to `0.0.0.0` to expose externally (Docker Compose does this automatically).

---

## Health Checks

### Individual service checks

```bash
# API - returns JSON with status, version, and database health
curl http://127.0.0.1:3847/health

# WebSocket - check if port is listening
lsof -i :3849

# Dashboard - returns HTTP 200 when running
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3848/

# PostgreSQL - check if accepting connections
pg_isready -h 127.0.0.1 -p 5432
```

### Expected healthy API response

```json
{
  "status": "healthy",
  "version": "2.1.0",
  "database": {
    "healthy": true
  }
}
```

### Using the DCM CLI

```bash
# JSON health output
./dcm health

# Full status of all components
./dcm status
```

---

## Logs

When running via the DCM CLI or auto-start, services write logs to `/tmp`:

| Log File | Service | Created By |
|----------|---------|------------|
| `/tmp/dcm-api.log` | REST API (Bun + Hono) | `dcm start` or `ensure-services.sh` |
| `/tmp/dcm-ws.log` | WebSocket server | `dcm start` or `ensure-services.sh` |
| `/tmp/dcm-dashboard.log` | Next.js dashboard | `dcm start` |

### Viewing logs

```bash
# Tail a specific service log
./dcm logs api
./dcm logs ws
./dcm logs dashboard

# Or directly
tail -f /tmp/dcm-api.log
```

### Systemd logs

When running via systemd, logs go to the journal instead:

```bash
sudo journalctl -u context-manager-api -f
sudo journalctl -u context-manager-ws -f
sudo journalctl -u context-dashboard -f
```

### Hook-related temporary files

| File | Purpose |
|------|---------|
| `/tmp/.dcm-autostart.lock` | Lock file for concurrent auto-start prevention |
| `/tmp/.dcm-pids/api.pid` | API server PID |
| `/tmp/.dcm-pids/ws.pid` | WebSocket server PID |
| `/tmp/.dcm-pids/dashboard.pid` | Dashboard PID |
| `/tmp/.dcm-monitor-counter` | Counter for proactive context monitoring (every 10th call) |
| `/tmp/.dcm-last-proactive` | Cooldown timestamp for proactive snapshots (60s interval) |
| `/tmp/.claude-context/*.json` | Cached session context data |

---

## Troubleshooting

### API will not start

| Symptom | Cause | Fix |
|---------|-------|-----|
| `DB_PASSWORD required` error | Missing env variable | Set `DB_PASSWORD` in `context-manager/.env` |
| `DB_USER required` error | Missing env variable | Set `DB_USER` in `context-manager/.env` |
| Connection refused on port 5432 | PostgreSQL not running | `sudo systemctl start postgresql` |
| Port 3847 already in use | Another process on port | `lsof -ti :3847` to identify, then stop it or change `PORT` |
| Schema errors on startup | Schema not applied | `psql -U <user> -d claude_context -f context-manager/src/db/schema.sql` |

### Auto-start not working

| Symptom | Cause | Fix |
|---------|-------|-----|
| Services not starting at session begin | Hooks not installed | Run `./dcm hooks` or use Plugin Mode |
| "PostgreSQL not available" warning | PostgreSQL not running at boot | `sudo systemctl enable postgresql` |
| Stale lock prevents startup | Previous auto-start crashed | `rm -f /tmp/.dcm-autostart.lock` |
| Auto-start too slow (timeout) | Bun cold start or DB slow | Check `/tmp/dcm-api.log` for startup errors |
| Hook scripts not executable | Permissions issue | `chmod +x context-manager/hooks/*.sh` |

### WebSocket issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Clients connect but receive nothing | LISTEN/NOTIFY not active | Check `/tmp/dcm-ws.log` for DB connection errors |
| WebSocket auth rejected | Mismatched secret | Ensure API and WS share the same `.env` file |
| Port 3849 not listening | WS server failed to start | Check `/tmp/dcm-ws.log` |

### Dashboard issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| 500 errors on all pages | Stale build | Rebuild: `cd context-dashboard && npm run build && npm start` |
| "Failed to fetch" in UI | Wrong API URL | Verify `NEXT_PUBLIC_API_URL` in `context-dashboard/.env.local` |
| Blank page | Static assets missing | Rebuild: `npm run build` |

### Sessions not tracked

| Symptom | Cause | Fix |
|---------|-------|-----|
| No data in dashboard | Hooks not configured | Run `./dcm hooks` or verify Plugin Mode is active |
| Hooks configured but no data | Scripts not executable | `chmod +x context-manager/hooks/*.sh` |
| Hooks run but API rejects | API unreachable from hooks | `curl http://127.0.0.1:3847/health` |

### Manual hook test

Send a synthetic event to verify the full pipeline:

```bash
echo '{"tool_name":"Test","tool_input":"{}","session_id":"test-session","cwd":"/tmp"}' \
  | bash context-manager/hooks/track-action.sh
```

If the API is running, the session should appear in the dashboard within seconds.

### Systemd services fail

```bash
# Check journal for the failing service
sudo journalctl -u context-manager-api --no-pager -n 50

# Common fixes:
# 1. Wrong path to bun - update ExecStart in the unit file
# 2. .env not readable - check EnvironmentFile path and permissions
# 3. ProtectHome blocking writes - update ReadWritePaths

# After editing a unit file:
sudo systemctl daemon-reload
sudo systemctl restart context-manager-api
```

---

## Uninstall

### Step 1: Remove hooks from Claude Code

```bash
./dcm unhook
```

This removes all DCM hook entries from `~/.claude/settings.json` while preserving other settings. A timestamped backup is created automatically.

### Step 2: Stop services

```bash
# If using DCM CLI
./dcm stop

# If using Docker Compose
docker compose down -v

# If using systemd
sudo systemctl stop context-manager-api context-manager-ws context-dashboard
sudo systemctl disable context-manager-api context-manager-ws context-dashboard
sudo rm /etc/systemd/system/context-manager-*.service /etc/systemd/system/context-dashboard.service
sudo systemctl daemon-reload
```

### Step 3: Clean up temporary files

```bash
rm -rf /tmp/.dcm-pids /tmp/.dcm-autostart.lock /tmp/.dcm-monitor-counter /tmp/.dcm-last-proactive
rm -f /tmp/dcm-api.log /tmp/dcm-ws.log /tmp/dcm-dashboard.log
```

### Step 4: Remove database (optional)

```bash
psql -U <your_user> -c "DROP DATABASE IF EXISTS claude_context;"
```

### Step 5: Remove the repository

```bash
rm -rf /path/to/Claude-DCM
```
