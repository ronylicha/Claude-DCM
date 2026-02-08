# DCM Deployment Guide

Complete reference for deploying the Distributed Context Manager. Four methods are documented, from fully containerized to bare-metal with systemd. Pick the one that fits your environment.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Method 1: Docker Compose (Recommended)](#method-1-docker-compose-recommended)
- [Method 2: One-Command Installer](#method-2-one-command-installer)
- [Method 3: Manual Installation](#method-3-manual-installation)
- [Method 4: Systemd Services](#method-4-systemd-services)
- [Claude Code Hooks Integration](#claude-code-hooks-integration)
- [Health Checks](#health-checks)
- [Environment Variables Reference](#environment-variables-reference)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Dependency     | Version | Used By           | Install                                        |
|----------------|---------|-------------------|-------------------------------------------------|
| Bun            | 1.x     | API, WebSocket    | `curl -fsSL https://bun.sh/install \| bash`     |
| Node.js        | 22+     | Dashboard         | Via nvm or system package                       |
| PostgreSQL     | 16+     | Database          | `sudo apt install postgresql postgresql-client`  |
| jq             | any     | Hook scripts      | `sudo apt install jq`                           |
| Docker + Compose | 24+  | Method 1 only     | [docs.docker.com](https://docs.docker.com/get-docker/) |

Verify your setup:

```bash
bun --version        # 1.x
node --version       # v22+
psql --version       # 16+
jq --version         # any
docker --version     # 24+ (Method 1 only)
```

---

## Method 1: Docker Compose (Recommended)

The fastest path. A single `docker-compose.yml` at the project root brings up all four services.

### Steps

```bash
# Clone the repository
git clone git@github.com:ronylicha/Claude-DCM.git
cd Claude-DCM

# Create the .env file
cp context-manager/.env.example .env
```

Edit `.env` and set at minimum:

```dotenv
DB_PASSWORD=your_secure_password
WS_AUTH_SECRET=$(openssl rand -hex 32)
```

Start everything:

```bash
docker compose up -d
```

Verify:

```bash
curl http://localhost:3847/health
# Expected: {"status":"healthy", ...}

# Open the dashboard
xdg-open http://localhost:3848    # Linux
open http://localhost:3848         # macOS
```

### What Docker Compose runs

| Service          | Image               | Port | Role                              |
|------------------|----------------------|------|-----------------------------------|
| `postgres`       | postgres:16-alpine   | 5432 | Database with schema auto-init    |
| `dcm-api`        | oven/bun:1 (built)   | 3847 | REST API (Bun + Hono)             |
| `dcm-ws`         | oven/bun:1 (built)   | 3849 | WebSocket server (Bun)            |
| `dcm-dashboard`  | node:22-alpine (built) | 3848 | Next.js monitoring dashboard    |

The PostgreSQL schema is applied automatically on first boot via the `docker-entrypoint-initdb.d` mount. The API and WebSocket containers wait for PostgreSQL to pass its health check before starting.

### Stopping and cleaning up

```bash
# Stop all services (data persists in the pgdata volume)
docker compose down

# Stop and remove all data
docker compose down -v
```

---

## Method 2: One-Command Installer

An interactive script that handles everything on a bare-metal machine. It requires PostgreSQL to already be running and accessible.

```bash
cd context-manager
chmod +x install.sh
./install.sh
```

### What the installer does

| Step | Action                                                  |
|------|---------------------------------------------------------|
| 1    | Checks prerequisites: `bun`, `psql`, `jq`              |
| 2    | Runs `bun install` for API/WS dependencies              |
| 3    | Copies `.env.example` to `.env` (prompts for editing)   |
| 4    | Creates the PostgreSQL database and applies the schema  |
| 5    | Starts the API temporarily to verify it responds healthy|
| 6    | Configures Claude Code hooks                            |

After the installer finishes, start the servers manually or set up systemd (see Method 4).

```bash
# Terminal 1 -- API
bun run src/server.ts

# Terminal 2 -- WebSocket
bun run src/websocket-server.ts
```

The installer does **not** set up the dashboard. See the dashboard steps in Method 3 below.

---

## Method 3: Manual Installation

Full control, step by step.

### Step 1: Database

```bash
# Create a PostgreSQL user (if needed)
sudo -u postgres createuser --pwprompt dcm

# Create the database
createdb -U dcm claude_context

# Apply the schema
psql -U dcm -d claude_context -f context-manager/src/db/schema.sql
```

Alternatively, use the provided setup script:

```bash
cd context-manager
cp .env.example .env
# Edit .env with your database credentials
bash scripts/setup-db.sh
```

### Step 2: API Server

```bash
cd context-manager
cp .env.example .env
# Edit .env -- set DB_PASSWORD and WS_AUTH_SECRET at minimum
bun install
bun run src/server.ts
```

The API listens on `PORT` (default 3847). Confirm it started:

```bash
curl http://127.0.0.1:3847/health
```

### Step 3: WebSocket Server

Open a separate terminal:

```bash
cd context-manager
bun run src/websocket-server.ts
```

The WebSocket server listens on `WS_PORT` (default 3849). It connects to the same database and uses PostgreSQL LISTEN/NOTIFY for real-time event bridging.

### Step 4: Dashboard

Open a third terminal:

```bash
cd context-dashboard
cp .env.example .env.local
# Edit .env.local if the API runs on a non-default host/port
npm install
npm run build
npm start
```

The dashboard listens on port 3848. It needs two environment variables pointing to the API and WebSocket:

```dotenv
NEXT_PUBLIC_API_URL=http://127.0.0.1:3847
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:3849
```

---

## Method 4: Systemd Services

For long-running servers. Three unit files are provided in the repository. Each one applies security hardening (`NoNewPrivileges`, `ProtectSystem=strict`, `PrivateTmp`) and memory limits.

### Service overview

| Unit File                          | Memory Limit | Restart Policy | Dependency              |
|------------------------------------|--------------|----------------|--------------------------|
| `context-manager-api.service`      | 512 MB       | on-failure     | postgresql.service        |
| `context-manager-ws.service`       | 128 MB (High: 96 MB) | on-failure | context-manager-api |
| `context-dashboard.service`        | 512 MB       | always         | context-manager-api       |

The WebSocket service uses `BindsTo=context-manager-api.service`, which means it stops automatically if the API service is stopped.

### Installation

Before copying the unit files, edit them to match your system paths. The defaults point to `/home/rony/.claude/services/context-manager` and use `bun` at the nvm-managed path. Adjust `WorkingDirectory`, `ExecStart`, `EnvironmentFile`, and `User` as needed.

```bash
# Copy unit files
sudo cp context-manager/context-manager-api.service /etc/systemd/system/
sudo cp context-manager/context-manager-ws.service /etc/systemd/system/
sudo cp context-dashboard/context-dashboard.service /etc/systemd/system/

# Reload systemd, enable, and start
sudo systemctl daemon-reload
sudo systemctl enable --now context-manager-api context-manager-ws context-dashboard
```

### Managing the services

```bash
# Check status
sudo systemctl status context-manager-api
sudo systemctl status context-manager-ws
sudo systemctl status context-dashboard

# View logs
sudo journalctl -u context-manager-api -f
sudo journalctl -u context-manager-ws -f
sudo journalctl -u context-dashboard -f

# Restart a single service
sudo systemctl restart context-manager-api

# Stop everything
sudo systemctl stop context-manager-api context-manager-ws context-dashboard
```

---

## Claude Code Hooks Integration

DCM tracks Claude Code activity through PostToolUse and SessionStart hooks. The installer can set these up, or you can configure them manually.

Add the following to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/context-manager/hooks/track-action.sh \"$TOOL_EXIT_CODE\""
          }
        ]
      },
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/context-manager/hooks/track-agent.sh"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "(nohup bash /path/to/context-manager/hooks/track-session.sh >/dev/null 2>&1 &)"
          }
        ]
      }
    ]
  }
}
```

Replace `/path/to/context-manager` with the actual absolute path to your `context-manager` directory.

Make sure the hook scripts are executable:

```bash
chmod +x context-manager/hooks/*.sh
```

---

## Health Checks

### Individual service checks

```bash
# API -- returns JSON with status, version, and database health
curl http://localhost:3847/health

# WebSocket -- returns connected client count
curl http://localhost:3849/health

# Dashboard -- returns HTTP 200 when running
curl -s -o /dev/null -w "%{http_code}" http://localhost:3848/

# PostgreSQL -- checks if the server accepts connections
pg_isready -h localhost -p 5432
```

### All-in-one health check script

A comprehensive script is provided at `context-manager/scripts/health-check.sh`. It checks all four components and exits with code 0 when everything is healthy, or 1 if any service is down.

```bash
bash context-manager/scripts/health-check.sh
```

Use `--quiet` to suppress output (useful in cron jobs or monitoring):

```bash
bash context-manager/scripts/health-check.sh --quiet
```

### Expected healthy response from the API

```json
{
  "status": "healthy",
  "version": "2.0.0",
  "database": {
    "healthy": true
  }
}
```

---

## Environment Variables Reference

### API and WebSocket (`context-manager/.env`)

| Variable              | Default          | Required | Description                         |
|-----------------------|------------------|----------|-------------------------------------|
| `DB_HOST`             | `localhost`      | No       | PostgreSQL host                     |
| `DB_PORT`             | `5432`           | No       | PostgreSQL port                     |
| `DB_NAME`             | `claude_context` | No       | Database name                       |
| `DB_USER`             | --               | **Yes**  | Database user (required, no default) |
| `DB_PASSWORD`         | --               | **Yes**  | Database password                   |
| `DB_MAX_CONNECTIONS`  | `10`             | No       | Connection pool size                |
| `HOST`                | `127.0.0.1`      | No       | API bind address                    |
| `PORT`                | `3847`           | No       | API server port                     |
| `WS_PORT`             | `3849`           | No       | WebSocket server port               |
| `WS_AUTH_SECRET`      | --               | Prod     | HMAC-SHA256 secret for WS tokens    |
| `MESSAGE_TTL_MS`      | `3600000`        | No       | Message time-to-live (1 hour)       |
| `HEALTHCHECK_INTERVAL_MS` | `30000`      | No       | Internal health check interval      |
| `MAX_DB_RETRIES`      | `3`              | No       | Database connection retry attempts  |
| `NODE_ENV`            | `production`     | No       | Environment mode                    |

### Dashboard (`context-dashboard/.env.local`)

| Variable              | Default                     | Required | Description                  |
|-----------------------|-----------------------------|----------|------------------------------|
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:3847`     | No       | REST API URL for the client  |
| `NEXT_PUBLIC_WS_URL`  | `ws://127.0.0.1:3849`       | No       | WebSocket URL for the client |

### Docker Compose only (root `.env`)

| Variable          | Default      | Description                                      |
|-------------------|--------------|--------------------------------------------------|
| `DCM_HOST`        | `127.0.0.1`  | External hostname baked into the dashboard build  |
| `DASHBOARD_PORT`  | `3848`       | Host port mapped to the dashboard container       |

### Generating WS_AUTH_SECRET

```bash
openssl rand -hex 32
```

---

## Troubleshooting

### API will not start

| Symptom                          | Cause                          | Fix                                                   |
|----------------------------------|--------------------------------|-------------------------------------------------------|
| `DB_PASSWORD required` error     | Missing environment variable   | Set `DB_PASSWORD` in `.env`                           |
| Connection refused on port 5432  | PostgreSQL not running         | `sudo systemctl start postgresql` or `pg_isready`     |
| Port 3847 already in use         | Another process on the port    | `ss -tlnp \| grep 3847` to find it, then stop or change `PORT` |
| Schema errors on startup         | Schema not applied             | Run `psql -d claude_context -f context-manager/src/db/schema.sql` |

### WebSocket shows no events

| Symptom                          | Cause                                | Fix                                                     |
|----------------------------------|--------------------------------------|---------------------------------------------------------|
| Clients connect but get nothing  | LISTEN/NOTIFY bridge not running     | Check WS logs: `journalctl -u context-manager-ws -f`   |
| "LISTEN/NOTIFY active" missing   | WS cannot reach database             | Verify `DB_HOST` and `DB_PASSWORD` in `.env`            |
| Auth token rejected              | Mismatched `WS_AUTH_SECRET`          | Ensure API and WS share the same `.env` file            |

### Dashboard returns 500 errors

| Symptom                    | Cause                               | Fix                                              |
|----------------------------|--------------------------------------|--------------------------------------------------|
| 500 on all pages           | Stale build or missing dependencies  | `cd context-dashboard && npm run build && npm start` |
| "Failed to fetch" in UI   | API URL wrong in `.env.local`        | Verify `NEXT_PUBLIC_API_URL` points to a running API |
| Blank page                 | Static assets not copied             | Rebuild: `npm run build`                         |

### Sessions not appearing in the dashboard

| Symptom                         | Cause                               | Fix                                                    |
|---------------------------------|--------------------------------------|--------------------------------------------------------|
| No data after using Claude Code | Hooks not configured                 | Add hooks to `~/.claude/settings.json` (see above)     |
| Hooks configured but no data    | Hook scripts not executable          | `chmod +x context-manager/hooks/*.sh`                  |
| Hooks run but API rejects them  | API not reachable from hooks         | Verify API is running: `curl http://127.0.0.1:3847/health` |

### Manual hook test

Send a synthetic event to verify the pipeline end to end:

```bash
echo '{"tool_name":"Test","tool_input":"{}","session_id":"test-session","cwd":"/tmp"}' \
  | bash context-manager/hooks/track-action.sh
```

If the API is running, the session should appear in the dashboard within seconds.

### Systemd services fail to start

```bash
# Check the journal for the failing service
sudo journalctl -u context-manager-api --no-pager -n 50

# Common fixes:
# 1. Wrong path to bun -- update ExecStart in the unit file
# 2. .env file not readable -- check EnvironmentFile path and permissions
# 3. ProtectHome=read-only blocking writes -- update ReadWritePaths
```

After editing a unit file, always reload:

```bash
sudo systemctl daemon-reload
sudo systemctl restart context-manager-api
```

---

## Database Backup

A backup script is provided at `context-manager/scripts/backup-db.sh`:

```bash
bash context-manager/scripts/backup-db.sh
```

For scheduled backups via cron:

```cron
0 2 * * * /path/to/context-manager/scripts/backup-db.sh >> /var/log/dcm-backup.log 2>&1
```

---

## Port Summary

| Port | Service     | Protocol   |
|------|-------------|------------|
| 3847 | REST API    | HTTP       |
| 3848 | Dashboard   | HTTP       |
| 3849 | WebSocket   | WS         |
| 5432 | PostgreSQL  | TCP        |

All ports are configurable through environment variables.
