# How to Deploy DCM

Four deployment methods, from simplest to most robust. Docker Compose is the recommended approach for most setups.

---

## Method 1 -- Docker Compose (recommended)

Docker Compose brings up all five services (PostgreSQL, Redis, API, WebSocket, Dashboard) in containers with a single command.

### Configure

Create a `.env` file at the project root:

```bash
cd Claude-DCM
cat > .env << 'EOF'
DB_USER=dcm
DB_PASSWORD=your_secure_password_here
WS_AUTH_SECRET=your_hmac_secret_at_least_32_chars
EOF
```

Generate the HMAC secret:

```bash
openssl rand -hex 32
```

### Start

```bash
docker compose up -d
```

### Verify

```bash
curl http://localhost:3847/health | jq .
```

Open the dashboard: http://localhost:3848

### Services overview

| Container | Image | Port (host:container) | Role |
|-----------|-------|------|------|
| `postgres` | postgres:17-alpine | 5433:5432 | Database with auto-schema init |
| `redis` | redis:7-alpine | 6380:6379 | Pub/sub and cache |
| `dcm-api` | Built from `context-manager/Dockerfile` | 3847:3847 | REST API + pipeline engine |
| `dcm-ws` | Built from `context-manager/Dockerfile` | 3849:3849 | WebSocket server |
| `dcm-dashboard` | Built from `context-dashboard/Dockerfile` | 3848:3848 | Next.js dashboard |

PostgreSQL schema is applied automatically on first boot via the `docker-entrypoint-initdb.d` mount. The `schema.sql` file is idempotent and safe to re-run.

The default PostgreSQL host port is `5433` (not `5432`) to avoid conflicts with a locally installed PostgreSQL. Inside the containers, PostgreSQL listens on port `5432` as usual.

### Volumes

| Volume | Purpose |
|--------|---------|
| `dcm-pgdata` | PostgreSQL data persistence |
| `dcm-redis` | Redis data persistence |

Data persists across `docker compose down` and `docker compose up`. Only `docker compose down -v` removes volume data.

### Hooks with Docker

Docker runs the servers in containers, but Claude Code hooks run on the host. You still need to configure them:

```bash
cd context-manager
./dcm hooks
```

Hook scripts use `curl` to call the API at `http://127.0.0.1:3847` by default. Docker Compose maps this port to the host, so hooks work without additional configuration.

### Stop

```bash
# Stop services (data persists in volumes)
docker compose down

# Stop and remove all data
docker compose down -v
```

### Custom port mapping

Override default ports via environment variables:

```bash
API_PORT=4847 WS_PORT=4849 DASHBOARD_PORT=4848 docker compose up -d
```

Note: Docker Compose uses `API_PORT` (not `PORT`) for the host-side API port mapping.

### Custom host for dashboard API/WS URLs

The dashboard bakes API and WebSocket URLs at build time. If the API is not on `127.0.0.1`:

```bash
DCM_HOST=192.168.1.100 docker compose up -d --build
```

### Environment variables for Docker Compose

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_USER` | `dcm` | PostgreSQL user |
| `DB_PASSWORD` | `dcm_secret` | PostgreSQL password (change for production) |
| `DB_NAME` | `claude_context` | Database name |
| `DB_PORT` | `5433` | Host port for PostgreSQL |
| `REDIS_PORT` | `6380` | Host port for Redis |
| `API_PORT` | `3847` | Host port for API |
| `WS_PORT` | `3849` | Host port for WebSocket |
| `WS_AUTH_SECRET` | `dcm_ws_secret` | HMAC secret (change for production) |
| `DASHBOARD_PORT` | `3848` | Host port for Dashboard |
| `DCM_HOST` | `127.0.0.1` | Host address baked into dashboard build |

---

## Method 2 -- DCM CLI (development)

The `dcm` CLI script manages the full lifecycle without containers.

### Install and start

```bash
cd Claude-DCM/context-manager
./dcm install
./dcm start
```

### Verify

```bash
./dcm status
```

### Stop

```bash
./dcm stop
```

### Where things live

| Artifact | Location |
|----------|----------|
| PID files | `/tmp/.dcm-pids/api.pid`, `ws.pid`, `dashboard.pid` |
| API logs | `/tmp/dcm-api.log` |
| WebSocket logs | `/tmp/dcm-ws.log` |
| Dashboard logs | `/tmp/dcm-dashboard.log` |
| Lock file | `/tmp/.dcm-autostart.lock` |

### Auto-start on session

DCM can start automatically when a Claude Code session begins. The `ensure-services.sh` hook fires on `SessionStart` and launches services if they are not already running.

For this to work, PostgreSQL must be available at boot:

```bash
sudo systemctl enable postgresql
```

### Deploy updates

Pull latest code, rebuild, apply migrations, and restart:

```bash
./dcm deploy
```

---

## Method 3 -- Systemd (production without Docker)

Three unit files provide security hardening, memory limits, automatic restarts, and journal logging.

### Unit file overview

| Unit | Memory limit | Restart policy | Depends on |
|------|-------------|----------------|------------|
| `context-manager-api.service` | 512 MB | on-failure | postgresql.service |
| `context-manager-ws.service` | 128 MB | on-failure | context-manager-api |
| `context-dashboard.service` | 4 GB | always | context-manager-api |

### Install

Before copying, edit the unit files to match your system. The defaults assume:

- Working directory: the project installation path
- User: your user account
- Bun binary path from your Bun installation

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

### Manage

```bash
# Check status
sudo systemctl status context-manager-api

# View logs
sudo journalctl -u context-manager-api -f

# Restart one service
sudo systemctl restart context-manager-api

# Stop everything
sudo systemctl stop context-manager-api context-manager-ws context-dashboard
```

### DCM supervisor integration

The `dcm` CLI includes a supervisor mode that manages systemd services:

```bash
./dcm supervisor status     # Show systemd service status
./dcm supervisor restart    # Restart all via systemd
./dcm supervisor enable     # Enable auto-start on boot
./dcm supervisor disable    # Disable auto-start
./dcm supervisor reload     # Re-template and restart after update
./dcm supervisor uninstall  # Remove supervisor completely
```

### Security hardening

The unit files include:

- `NoNewPrivileges=true`
- `ProtectSystem=strict`
- `PrivateTmp=true`
- `NODE_ENV=production`
- Memory limits via `MemoryMax`

---

## Method 4 -- Manual (debugging)

Run each service directly for debugging or custom setups.

### Terminal 1 -- API server

```bash
cd Claude-DCM/context-manager
bun run src/server.ts
```

### Terminal 2 -- WebSocket server

```bash
cd Claude-DCM/context-manager
bun run src/websocket-server.ts
```

### Terminal 3 -- Dashboard

```bash
cd Claude-DCM/context-dashboard
npm install
npm run build
npm start
```

### Background mode (without systemd)

```bash
cd Claude-DCM/context-manager
nohup bun run src/server.ts > /tmp/dcm-api.log 2>&1 &
nohup bun run src/websocket-server.ts > /tmp/dcm-ws.log 2>&1 &
```

---

## Environment Variable Configuration

All backend configuration is done through `context-manager/.env`. Bun loads it automatically.

Copy the example:

```bash
cp context-manager/.env.example context-manager/.env
```

See the full [Environment Variables Reference](../reference/environment-variables.md) for every available setting.

### Minimum required

```bash
DB_USER=dcm
DB_PASSWORD=your_secure_password
```

### Recommended for production

```bash
DB_USER=dcm
DB_PASSWORD=strong_random_password
WS_AUTH_SECRET=output_of_openssl_rand_hex_32
NODE_ENV=production
HOST=127.0.0.1
LOG_LEVEL=warn
```

---

## Production Checklist

### Database

- [ ] PostgreSQL 16+ is running with `systemctl enable postgresql`
- [ ] Database `claude_context` exists with schema applied
- [ ] Pipeline migrations are applied (pipelines, sprints, providers, planner settings, capacity fields)
- [ ] `DB_USER` and `DB_PASSWORD` are set in `.env`
- [ ] Connection pooling is configured (`DB_MAX_CONNECTIONS=20` or higher)
- [ ] Regular backups are scheduled

### Security

- [ ] `WS_AUTH_SECRET` is set to a strong random value (`openssl rand -hex 32`)
- [ ] `NODE_ENV=production` is set (enforces WebSocket authentication)
- [ ] `HOST=127.0.0.1` (do not bind to `0.0.0.0` unless behind a reverse proxy)
- [ ] `ALLOWED_ORIGINS` is set to your dashboard URL only
- [ ] Firewall restricts access to ports 3847, 3848, 3849

### LLM Providers

- [ ] At least one LLM provider is configured for pipeline planning
- [ ] API keys for cloud providers are set via the Settings page or API
- [ ] CLI providers have their respective CLIs installed and authenticated

### Monitoring

- [ ] Health check is accessible: `curl http://127.0.0.1:3847/health`
- [ ] Logs are being written (check `/tmp/dcm-api.log` or `journalctl`)
- [ ] Dashboard is accessible at `http://localhost:3848`

### Hooks

- [ ] Claude Code hooks are installed: `./dcm status` shows "hooks: installed"
- [ ] Hook scripts are executable: `ls -la context-manager/hooks/*.sh`

---

## How to Update

### Docker deployment

```bash
cd Claude-DCM
git pull origin main

# Rebuild and restart containers
docker compose down
docker compose build --no-cache
docker compose up -d
```

### CLI or manual deployment

```bash
cd Claude-DCM/context-manager

# One-command update
./dcm deploy
```

Or manually:

```bash
cd Claude-DCM
git pull origin main

cd context-manager
bun install

# Apply schema and migrations (all are idempotent)
psql -U dcm -d claude_context -h 127.0.0.1 -f src/db/schema.sql

# Restart services
./dcm restart

# Re-install hooks
./dcm hooks
```

### Systemd deployment

```bash
cd Claude-DCM
git pull origin main
cd context-manager
bun install

psql -U dcm -d claude_context -h 127.0.0.1 -f src/db/schema.sql

sudo systemctl restart context-manager-api context-manager-ws context-dashboard
```

### Database migrations

The main `schema.sql` uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`, making it idempotent and safe to re-run.

For specific migrations, check the `src/db/` directory:

```bash
ls context-manager/src/db/migration-*.sql
ls context-manager/src/db/migrations/
```

Apply migrations in order:

```bash
psql -U dcm -d claude_context -h 127.0.0.1 -f context-manager/src/db/migration-pipelines.sql
psql -U dcm -d claude_context -h 127.0.0.1 -f context-manager/src/db/migration-pipeline-sprints.sql
psql -U dcm -d claude_context -h 127.0.0.1 -f context-manager/src/db/migration-llm-providers.sql
psql -U dcm -d claude_context -h 127.0.0.1 -f context-manager/src/db/migration-planner-settings.sql
psql -U dcm -d claude_context -h 127.0.0.1 -f context-manager/src/db/migration-capacity-fields.sql
```

---

## Uninstall

### Step 1 -- Remove hooks

```bash
./dcm unhook
```

### Step 2 -- Stop services

```bash
# Docker
docker compose down -v

# CLI
./dcm stop

# Systemd
sudo systemctl stop context-manager-api context-manager-ws context-dashboard
sudo systemctl disable context-manager-api context-manager-ws context-dashboard
sudo rm /etc/systemd/system/context-manager-*.service /etc/systemd/system/context-dashboard.service
sudo systemctl daemon-reload
```

### Step 3 -- Clean up temporary files

```bash
rm -rf /tmp/.dcm-pids /tmp/.dcm-autostart.lock /tmp/.dcm-monitor-counter /tmp/.dcm-last-proactive
rm -f /tmp/dcm-api.log /tmp/dcm-ws.log /tmp/dcm-dashboard.log
rm -rf /tmp/.claude-context/
```

### Step 4 -- Remove database (optional)

```bash
psql -U postgres -c "DROP DATABASE IF EXISTS claude_context;"
psql -U postgres -c "DROP USER IF EXISTS dcm;"
```

### Step 5 -- Remove the repository

```bash
rm -rf /path/to/Claude-DCM
```
