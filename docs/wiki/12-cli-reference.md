# DCM CLI Reference

**Version:** 2.1.0
**Generated:** 2026-02-09
**Status:** Production Ready

## Overview

The `dcm` command-line interface is the single entry point for all DCM operations. It provides a unified interface for installation, service management, database operations, and debugging.

**Location:** `/home/rony/Assets Projets/Claude-DCM/context-manager/dcm` (bash script)

## Installation

Make the CLI executable and add to PATH (optional):

```bash
chmod +x /path/to/context-manager/dcm

# Optional: Add to PATH
echo 'export PATH="/path/to/context-manager:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

## Command Structure

```bash
dcm <command> [options]
```

## Core Commands

### `dcm install`

**Purpose:** One-command full setup for DCM.

**What it does:**
1. Checks prerequisites (bun, psql, jq, curl)
2. Installs npm dependencies via bun
3. Creates `.env` from `.env.example` template
4. Sets up PostgreSQL database schema
5. Installs Claude Code hooks

**Usage:**
```bash
dcm install
```

**Output:**
```
DCM Install - Full Setup

[1/5] Checking prerequisites...
  All prerequisites found.
[2/5] Installing dependencies...
  Dependencies installed.
[3/5] Configuring environment...
  Created .env from template.
  Edit /path/to/context-manager/.env with your database credentials.
[4/5] Setting up database...
  Database schema created.
[5/5] Installing Claude Code hooks...
  Hooks installed.

Installation complete!

Next: dcm start
```

**Prerequisites:**
- **bun**: JavaScript runtime (https://bun.sh)
- **psql**: PostgreSQL client
- **jq**: JSON processor
- **curl**: HTTP client

**Missing Prerequisites:**
```bash
# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install PostgreSQL
sudo apt install postgresql postgresql-client

# Install jq
sudo apt install jq
```

### `dcm start`

**Purpose:** Start all DCM services (API, WebSocket, Dashboard).

**What it does:**
1. Starts API server on port 3847
2. Starts WebSocket server on port 3849
3. Starts Dashboard on port 3848
4. Saves PIDs to `/tmp/.dcm-pids/`
5. Logs to `/tmp/dcm-*.log`

**Usage:**
```bash
dcm start
```

**Output:**
```
Starting DCM services...
  API server (port 3847)... started
  WebSocket server (port 3849)... started
  Dashboard (port 3848)... started

  API:       http://127.0.0.1:3847
  WebSocket: ws://127.0.0.1:3849
  Dashboard: http://127.0.0.1:3848
```

**Notes:**
- Services run in background via `nohup`
- If already running, shows "already running" status
- Uses file-based PID tracking in `/tmp/.dcm-pids/`

### `dcm stop`

**Purpose:** Stop all DCM services.

**What it does:**
1. Reads PID files from `/tmp/.dcm-pids/`
2. Kills processes by PID
3. Falls back to port-based kill via `lsof`
4. Removes PID files

**Usage:**
```bash
dcm stop
```

**Output:**
```
Stopping DCM services...
  api: stopped (pid 12345)
  ws: stopped (pid 12346)
  dashboard: stopped (pid 12347)
```

### `dcm restart`

**Purpose:** Restart all services (stop then start).

**Usage:**
```bash
dcm restart
```

Equivalent to:
```bash
dcm stop
dcm start
```

### `dcm status`

**Purpose:** Show health status of all components.

**What it checks:**
- API health via `/health` endpoint
- WebSocket port availability
- Dashboard accessibility
- PostgreSQL connectivity
- Claude Code hooks installation

**Usage:**
```bash
dcm status
```

**Output:**
```
DCM Status

  API (port 3847):       healthy (v3.0.0)
  WebSocket (port 3849): running
  Dashboard (port 3848): running
  PostgreSQL:            connected
  Claude Code hooks:     installed
```

**Status Indicators:**
- **healthy** (green) - Service running and responsive
- **not running** (red) - Service not responding
- **unknown** (yellow) - Cannot determine status

### `dcm health`

**Purpose:** Quick health check (JSON output).

**Usage:**
```bash
dcm health
```

**Output:**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-09T10:00:00.000Z",
  "version": "3.0.0",
  "database": {
    "healthy": true,
    "latency_ms": 2
  },
  "features": {
    "compact_recovery": true,
    "inter_agent_messaging": true,
    "wave_orchestration": true,
    "routing_intelligence": true,
    "agent_registry": true
  }
}
```

Pipe to `jq` for pretty printing:
```bash
dcm health | jq .
```

### `dcm version`

**Purpose:** Show CLI version.

**Usage:**
```bash
dcm version
# or
dcm -v
# or
dcm --version
```

**Output:**
```
DCM v2.1.0
```

### `dcm help`

**Purpose:** Show usage information.

**Usage:**
```bash
dcm help
# or
dcm -h
# or
dcm --help
# or
dcm  (no args)
```

## Service Management

### `dcm logs [service]`

**Purpose:** Tail service logs in real-time.

**Services:**
- `api` - API server logs
- `ws` - WebSocket server logs
- `dashboard` - Dashboard logs

**Usage:**
```bash
# API logs
dcm logs api

# WebSocket logs
dcm logs ws

# Dashboard logs
dcm logs dashboard
```

**Log Files:**
- `/tmp/dcm-api.log`
- `/tmp/dcm-ws.log`
- `/tmp/dcm-dashboard.log`

**Example:**
```bash
dcm logs api | grep ERROR
```

**Notes:**
- Uses `tail -f` for live streaming
- Press `Ctrl+C` to exit
- Logs rotate on service restart

## Database Commands

### `dcm db:setup`

**Purpose:** Initialize or reset database schema.

**What it does:**
1. Connects to PostgreSQL
2. Creates database if not exists
3. Runs schema.sql to create tables, views, indexes

**Usage:**
```bash
dcm db:setup
```

**Environment Variables:**
- `DB_USER` - PostgreSQL user (default: dcm)
- `DB_NAME` - Database name (default: claude_context)
- `DB_HOST` - Database host (default: localhost)
- `DB_PORT` - Database port (default: 5432)

**Notes:**
- Idempotent (safe to run multiple times)
- Uses `IF NOT EXISTS` clauses
- Delegates to `scripts/setup-db.sh`

### `dcm db:reset`

**Purpose:** Drop and recreate database (DESTRUCTIVE).

**What it does:**
1. Prompts for confirmation (type 'yes')
2. Drops existing database
3. Creates new database
4. Runs schema.sql

**Usage:**
```bash
dcm db:reset
```

**Interactive Prompt:**
```
WARNING: This will DROP and recreate the database!
Are you sure? (type 'yes' to confirm): yes
Database reset complete.
```

**Warning:**
- **DESTRUCTIVE** - All data will be lost
- Requires typing 'yes' to confirm
- Cannot be undone
- Creates automatic backup of settings.json before modification

## Hook Commands

### `dcm hooks`

**Purpose:** Install or update Claude Code hooks.

**What it does:**
1. Reads `hooks/hooks.json`
2. Merges hooks into `~/.config/ClaudeCode/settings.json`
3. Creates backup before modification
4. Uses `${CLAUDE_PLUGIN_ROOT}` for plugin-relative paths

**Usage:**
```bash
dcm hooks
```

**Output:**
```
Installing DCM hooks...
  Backup: ~/.config/ClaudeCode/settings.json.bak.20260209100000
  Hooks installed: 7 events
    PostToolUse: track-action, track-agent, monitor-context
    SessionStart: ensure-services, track-session, post-compact-restore
    PreCompact: pre-compact-save
    SubagentStop: save-agent-result
    SessionEnd: track-session-end
```

**Delegates to:** `scripts/setup-hooks.sh`

### `dcm unhook`

**Purpose:** Remove all DCM hooks from Claude Code settings.

**What it does:**
1. Creates timestamped backup of settings.json
2. Uses jq to filter out DCM hook entries
3. Cleans up empty arrays
4. Preserves non-DCM hooks

**Usage:**
```bash
dcm unhook
```

**Output:**
```
Removing DCM hooks from Claude Code settings...
DCM hooks removed.
```

**Backup Location:**
```
~/.config/ClaudeCode/settings.json.bak.20260209100000
```

**Note:** Preserves non-DCM hooks. Only removes hooks containing:
- `track-action`, `track-agent`, `monitor-context`
- `ensure-services`, `track-session`, `post-compact-restore`
- `pre-compact-save`, `save-agent-result`, `track-session-end`

## Context Commands

### `dcm snapshot [session_id]`

**Purpose:** Manually trigger a context snapshot for a session.

**What it does:**
1. Calls `POST /api/compact/save` with `trigger: "manual"`
2. Saves current session state to database
3. Returns snapshot ID

**Usage:**
```bash
# With explicit session ID
dcm snapshot abc123def456

# Auto-detect from cache
dcm snapshot
```

**Output:**
```json
{
  "id": "snapshot-uuid",
  "session_id": "abc123def456",
  "trigger": "manual",
  "saved_at": "2026-02-09T10:00:00Z"
}
```

**Auto-detection:**
If session_id not provided, searches `/tmp/.claude-context/*.json` for latest session.

### `dcm context <agent_id> [session_id]`

**Purpose:** Get the context brief for an agent in a session.

**What it does:**
1. Calls `GET /api/context/:agent_id?session_id=...&format=brief`
2. Returns token-optimized context brief

**Usage:**
```bash
# With explicit session ID
dcm context backend-laravel abc123def456

# Auto-detect session
dcm context backend-laravel

# Default agent (orchestrator)
dcm context
```

**Output:**
```json
{
  "agent_id": "backend-laravel",
  "session_id": "abc123def456",
  "context": "# Context Brief\n\n## Active Tasks\n- Create User CRUD endpoints\n- Add authentication middleware\n\n## Modified Files\n- app/Http/Controllers/UserController.php\n- routes/api.php\n\n## Key Decisions\n- Using Laravel Sanctum for auth\n- Implementing RESTful patterns\n",
  "tokens": 245,
  "generated_at": "2026-02-09T10:00:00Z"
}
```

## Environment Variables

Configure via `/path/to/context-manager/.env`:

```bash
# API Server
PORT=3847

# WebSocket Server
WS_PORT=3849

# Dashboard
DASHBOARD_PORT=3848

# Database
DB_USER=dcm
DB_NAME=claude_context
DB_HOST=localhost
DB_PORT=5432
DB_PASSWORD=your_password

# Context Manager
CONTEXT_MANAGER_URL=http://127.0.0.1:3847
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Command failed or invalid usage |

## PID Files

Service PIDs stored in `/tmp/.dcm-pids/`:
- `api.pid` - API server process ID
- `ws.pid` - WebSocket server process ID
- `dashboard.pid` - Dashboard process ID

## Log Files

Service logs stored in `/tmp/`:
- `dcm-api.log` - API server output
- `dcm-ws.log` - WebSocket server output
- `dcm-dashboard.log` - Dashboard output

## Advanced Usage

### Check Specific Service Health

```bash
curl http://localhost:3847/health | jq .
```

### Stop Specific Service

```bash
kill $(cat /tmp/.dcm-pids/api.pid)
```

### View Last 100 Log Lines

```bash
tail -100 /tmp/dcm-api.log
```

### Monitor Database Connections

```bash
watch -n 2 "dcm health | jq '.database'"
```

### Export Session Context

```bash
dcm context orchestrator session-123 > context-backup.json
```

### Batch Snapshot All Active Sessions

```bash
for session in $(curl -s http://localhost:3847/api/sessions | jq -r '.sessions[].id'); do
  dcm snapshot "$session"
done
```

## Troubleshooting

### Command Not Found

**Symptom:** `dcm: command not found`

**Solution:**
```bash
# Run from context-manager directory
cd /path/to/context-manager
./dcm <command>

# Or add to PATH
export PATH="/path/to/context-manager:$PATH"
```

### Services Won't Start

**Symptom:** `dcm start` reports "starting" but services don't respond.

**Solution:**
```bash
# Check logs for errors
dcm logs api
dcm logs ws
dcm logs dashboard

# Common issues:
# - Port already in use
# - Database not running
# - Missing environment variables
```

### Port Already in Use

**Symptom:** Service fails to start, log shows "EADDRINUSE".

**Solution:**
```bash
# Find process using port
lsof -i :3847

# Kill process
kill $(lsof -ti :3847)

# Or change port in .env
echo "PORT=3850" >> .env
```

### Database Connection Failed

**Symptom:** API health check shows `database.healthy: false`.

**Solution:**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql

# Verify credentials in .env
cat .env | grep DB_

# Test connection manually
psql -U dcm -d claude_context -c "SELECT 1"
```

### Hooks Not Installing

**Symptom:** `dcm hooks` succeeds but `dcm status` shows "not installed".

**Solution:**
```bash
# Check settings.json exists
ls -la ~/.config/ClaudeCode/settings.json

# Verify hooks were added
grep "track-action" ~/.config/ClaudeCode/settings.json

# Re-run with verbose output
bash -x ./scripts/setup-hooks.sh
```

### Snapshot Not Created

**Symptom:** `dcm snapshot` returns error.

**Solution:**
```bash
# Verify API is running
dcm status

# Check session exists
curl http://localhost:3847/api/sessions | jq '.sessions[].id'

# Try with explicit session ID
dcm snapshot <session-id>
```

## Examples

### First-Time Setup

```bash
# Clone repo and install
git clone <repo-url>
cd context-manager
dcm install
dcm start
dcm status
```

### Daily Operations

```bash
# Start services in the morning
dcm start

# Check everything is running
dcm status

# Monitor API logs
dcm logs api

# Stop services at end of day
dcm stop
```

### Debugging Session

```bash
# Get current session context
dcm context orchestrator

# Trigger manual snapshot
dcm snapshot

# Check health
dcm health | jq .

# View recent logs
dcm logs api | tail -50
```

### Database Maintenance

```bash
# Backup database (manual)
pg_dump -U dcm claude_context > backup.sql

# Reset database
dcm db:reset

# Restore from backup
psql -U dcm -d claude_context < backup.sql
```

### Hook Management

```bash
# Install hooks
dcm hooks

# Verify installation
dcm status

# Remove hooks temporarily
dcm unhook

# Re-install hooks
dcm hooks
```

## Integration with Scripts

The `dcm` CLI can be integrated into shell scripts:

```bash
#!/bin/bash
# ensure-dcm-running.sh

if ! dcm health &>/dev/null; then
  echo "DCM not running, starting..."
  dcm start
  sleep 3
fi

if dcm health &>/dev/null; then
  echo "DCM is ready"
else
  echo "Failed to start DCM"
  exit 1
fi
```

## API Equivalent Commands

For automation, CLI commands can be replaced with direct API calls:

| CLI Command | API Equivalent |
|-------------|----------------|
| `dcm health` | `GET /health` |
| `dcm snapshot <id>` | `POST /api/compact/save` |
| `dcm context <agent>` | `GET /api/context/:agent_id` |

Example:
```bash
# CLI
dcm context backend-laravel abc123

# API
curl "http://localhost:3847/api/context/backend-laravel?session_id=abc123&format=brief"
```

## Next Steps

- [13-configuration.md](./13-configuration.md) - Environment variables and configuration
- [14-troubleshooting.md](./14-troubleshooting.md) - Common issues and solutions
- [01-getting-started.md](./01-getting-started.md) - Installation walkthrough

---

**Status:** CLI stable since v2.0. Production-ready.
