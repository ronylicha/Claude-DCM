# DCM Configuration Reference

**Version:** 3.0.0
**Generated:** 2026-02-09
**Status:** Production Ready

## Overview

DCM configuration is managed through environment variables defined in the `.env` file. This document provides a comprehensive reference for all configuration options.

**Configuration File:** `/path/to/context-manager/.env`

**Template:** `/path/to/context-manager/.env.example`

## Quick Start

```bash
# Copy template
cp .env.example .env

# Edit with your values
nano .env
```

## Required Variables

These variables **must** be set for DCM to function.

### Database Connection

```bash
# PostgreSQL username
DB_USER=your_user

# PostgreSQL password
DB_PASSWORD=your_secure_password
```

**Validation:**
- `DB_USER` cannot be empty
- `DB_PASSWORD` cannot be empty
- Server will not start without these

### WebSocket Authentication (Production)

```bash
# HMAC secret for WebSocket token signing
# Generate with: openssl rand -hex 32
WS_AUTH_SECRET=your_hmac_secret_here
```

**Validation:**
- **Required** in production (`NODE_ENV=production`)
- **Optional** in development (warning only)
- Must be at least 32 characters in production
- Used for signing WebSocket authentication tokens

**Generate Secure Secret:**
```bash
openssl rand -hex 32
```

## Database Configuration

```bash
# PostgreSQL host (default: localhost)
DB_HOST=localhost

# PostgreSQL port (default: 5432)
DB_PORT=5432

# Database name (default: claude_context)
DB_NAME=claude_context

# Connection pool size (default: 10)
DB_MAX_CONNECTIONS=10
```

### Database Settings

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `DB_HOST` | string | `localhost` | PostgreSQL server hostname or IP |
| `DB_PORT` | number | `5432` | PostgreSQL server port |
| `DB_NAME` | string | `claude_context` | Database name |
| `DB_USER` | string | (required) | Database username |
| `DB_PASSWORD` | string | (required) | Database password |
| `DB_MAX_CONNECTIONS` | number | `10` | Max concurrent connections in pool |

**Connection URL Format:**
```
postgresql://DB_USER:DB_PASSWORD@DB_HOST:DB_PORT/DB_NAME
```

## Server Configuration

### API Server

```bash
# API server host (default: 127.0.0.1)
HOST=127.0.0.1

# API server port (default: 3847)
PORT=3847
```

| Variable | Type | Default | Range | Description |
|----------|------|---------|-------|-------------|
| `HOST` | string | `127.0.0.1` | Valid IP | Bind address for API server |
| `PORT` | number | `3847` | 1-65535 | HTTP API port |

**Access:** `http://${HOST}:${PORT}`

### WebSocket Server

```bash
# WebSocket server port (default: 3849)
WS_PORT=3849
```

| Variable | Type | Default | Range | Description |
|----------|------|---------|-------|-------------|
| `WS_PORT` | number | `3849` | 1-65535 | WebSocket server port |

**Access:** `ws://127.0.0.1:${WS_PORT}`

### Dashboard

```bash
# Dashboard port (default: 3848)
DASHBOARD_PORT=3848
```

**Note:** Dashboard port is configured in `context-dashboard/` directory, not context-manager.

## Application Settings

### Message TTL

```bash
# Message time-to-live in milliseconds (default: 3600000 = 1 hour)
MESSAGE_TTL_MS=3600000
```

**Purpose:** How long inter-agent messages are retained before expiration.

**Values:**
- `3600000` - 1 hour (default)
- `7200000` - 2 hours
- `86400000` - 24 hours
- `0` - Never expire (not recommended)

### Healthcheck Interval

```bash
# Healthcheck interval in milliseconds (default: 30000 = 30s)
HEALTHCHECK_INTERVAL_MS=30000
```

**Purpose:** How often the `/health` endpoint refreshes database status.

**Recommended:** 30000ms (30 seconds)

### Database Retry Policy

```bash
# Maximum retries for database operations (default: 3)
MAX_DB_RETRIES=3
```

**Purpose:** How many times to retry failed database operations before giving up.

**Recommended:** 3

## Cleanup Configuration

Controls automatic cleanup of stale data.

```bash
# Cleanup thresholds and intervals

# Hours before session/agent considered stale (default: 0.5 = 30 minutes)
CLEANUP_STALE_HOURS=0.5

# Minutes without activity before considered inactive (default: 10)
CLEANUP_INACTIVE_MINUTES=10

# Max age for compact snapshots in hours (default: 24)
CLEANUP_SNAPSHOT_MAX_HOURS=24

# Cleanup run interval in milliseconds (default: 60000 = 1 minute)
CLEANUP_INTERVAL_MS=60000

# Max age for read broadcast messages in hours (default: 24)
CLEANUP_READ_MSG_MAX_HOURS=24
```

### Cleanup Settings Reference

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CLEANUP_STALE_HOURS` | float | `0.5` | Hours before session/agent is stale |
| `CLEANUP_INACTIVE_MINUTES` | number | `10` | Minutes without activity = inactive |
| `CLEANUP_SNAPSHOT_MAX_HOURS` | number | `24` | Max age for compact snapshots |
| `CLEANUP_INTERVAL_MS` | number | `60000` | How often cleanup runs (ms) |
| `CLEANUP_READ_MSG_MAX_HOURS` | number | `24` | Max age for read messages |

**Cleanup Process:**
1. Runs every `CLEANUP_INTERVAL_MS`
2. Deletes messages older than `CLEANUP_READ_MSG_MAX_HOURS` that are marked as read
3. Archives snapshots older than `CLEANUP_SNAPSHOT_MAX_HOURS`
4. Marks sessions inactive after `CLEANUP_INACTIVE_MINUTES`

## CORS Configuration

```bash
# Comma-separated list of allowed origins (optional)
# Default: http://localhost:3848,http://127.0.0.1:3848
ALLOWED_ORIGINS=http://localhost:3848,https://yourdomain.com
```

**Purpose:** Control which origins can access the API via browser.

**Values:**
- **Comma-separated list**: `http://localhost:3848,https://app.example.com`
- **Wildcard** (not recommended): `*`
- **Default**: `http://localhost:3848,http://127.0.0.1:3848`

**Example (Production):**
```bash
ALLOWED_ORIGINS=https://dcm.example.com,https://dashboard.example.com
```

**Security Note:** Never use `*` in production. Always whitelist specific origins.

## Environment Modes

```bash
# Environment mode (default: production)
NODE_ENV=production
```

**Values:**
- `production` - Strict validation, secure defaults
- `development` - Relaxed validation, verbose logging

**Differences:**

| Feature | Production | Development |
|---------|-----------|-------------|
| WS_AUTH_SECRET | Required, ≥32 chars | Optional (warning) |
| Logging Level | INFO | DEBUG |
| Error Details | Minimal | Full stack traces |
| CORS | Strict whitelist | Permissive |

## Hook Configuration

Hook timeouts are **not** configurable via environment variables. They are hardcoded in `hooks/hooks.json`.

**Default Timeouts:**
- PostToolUse tracking: 3000ms (3s)
- Context monitoring: 2000ms (2s)
- Compact save: 5000ms (5s)
- Compact restore: 8000ms (8s)
- SessionStart ensure-services: 10000ms (10s)

**To modify:** Edit `context-manager/hooks/hooks.json` directly.

## Context Manager URL

Used by hooks to communicate with the API.

```bash
# Context Manager API URL (default: http://127.0.0.1:3847)
CONTEXT_MANAGER_URL=http://127.0.0.1:3847
```

**Purpose:** Hooks use this to determine where to send API requests.

**Customization:**
```bash
# Custom port
CONTEXT_MANAGER_URL=http://127.0.0.1:9000

# Remote server
CONTEXT_MANAGER_URL=https://dcm.example.com
```

## Monitor Thresholds

Context monitoring thresholds are hardcoded in `hooks/monitor-context.sh`.

**Hardcoded Values:**
- Green (OK): < 500KB
- Yellow (warning): 500KB - 800KB
- Red (snapshot): > 800KB

**To modify:** Edit `context-manager/hooks/monitor-context.sh` and change `THRESHOLD_YELLOW` and `THRESHOLD_RED`.

## Full Configuration Example

```bash
# .env - Production Configuration

# Database (REQUIRED)
DB_HOST=postgres.example.com
DB_PORT=5432
DB_NAME=claude_context_prod
DB_USER=dcm_prod
DB_PASSWORD=super_secure_password_here
DB_MAX_CONNECTIONS=20

# API Server
HOST=0.0.0.0
PORT=3847

# WebSocket Server
WS_PORT=3849

# Application
MESSAGE_TTL_MS=7200000
HEALTHCHECK_INTERVAL_MS=30000
MAX_DB_RETRIES=5
NODE_ENV=production

# Auth (REQUIRED in production)
WS_AUTH_SECRET=a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6

# CORS
ALLOWED_ORIGINS=https://dcm.example.com,https://dashboard.example.com

# Cleanup
CLEANUP_STALE_HOURS=1.0
CLEANUP_INACTIVE_MINUTES=30
CLEANUP_SNAPSHOT_MAX_HOURS=72
CLEANUP_INTERVAL_MS=300000
CLEANUP_READ_MSG_MAX_HOURS=48

# Context Manager
CONTEXT_MANAGER_URL=http://127.0.0.1:3847
```

## Dashboard Configuration

Dashboard has its own environment variables in `context-dashboard/.env.local`:

```bash
# Next.js Public Variables
NEXT_PUBLIC_API_URL=http://localhost:3847
NEXT_PUBLIC_WS_URL=ws://localhost:3849
```

**Note:** Variables prefixed with `NEXT_PUBLIC_` are exposed to the browser.

## Validation

Configuration is validated on server startup via `validateConfig()` in `src/config.ts`.

**Validation Checks:**
1. `DB_USER` is not empty
2. `DB_PASSWORD` is not empty
3. `WS_AUTH_SECRET` present in production
4. `WS_AUTH_SECRET` ≥32 chars in production
5. `PORT` and `WS_PORT` in range 1-65535
6. `DB_MAX_CONNECTIONS` ≥ 1

**Failure Behavior:**
- Production: Server exits with error
- Development: Warning logged, server continues

## Loading Order

1. Bun automatically loads `.env` from current working directory
2. `src/config.ts` reads `process.env` variables
3. `validateConfig()` runs on server startup
4. Defaults applied for missing optional variables

## Security Best Practices

### 1. Database Credentials

```bash
# ❌ Bad
DB_USER=postgres
DB_PASSWORD=password123

# ✅ Good
DB_USER=dcm_prod_user
DB_PASSWORD=$(pwgen -s 32 1)
```

### 2. WebSocket Secret

```bash
# ❌ Bad
WS_AUTH_SECRET=secret

# ✅ Good
WS_AUTH_SECRET=$(openssl rand -hex 32)
```

### 3. CORS Origins

```bash
# ❌ Bad (allows all origins)
ALLOWED_ORIGINS=*

# ✅ Good
ALLOWED_ORIGINS=https://dcm.example.com
```

### 4. File Permissions

```bash
# Restrict .env to owner only
chmod 600 .env

# Verify
ls -la .env
# Output: -rw------- 1 user user 456 Feb 9 10:00 .env
```

### 5. Never Commit .env

```bash
# .gitignore
.env
.env.*
!.env.example
```

## Troubleshooting

### Configuration Not Loaded

**Symptom:** Server uses default values instead of `.env` values.

**Cause:** `.env` file not in working directory or not readable.

**Solution:**
```bash
# Verify .env exists
ls -la .env

# Check file permissions
chmod 644 .env

# Test manual load
export $(cat .env | xargs)
bun run src/server.ts
```

### Database Connection Failed

**Symptom:** `DB_USER environment variable is required`

**Solution:**
```bash
# Check .env has DB_USER and DB_PASSWORD
grep DB_USER .env
grep DB_PASSWORD .env

# Test connection manually
psql -U $DB_USER -d $DB_NAME -c "SELECT 1"
```

### Port Already in Use

**Symptom:** `EADDRINUSE: Address already in use`

**Solution:**
```bash
# Change port in .env
echo "PORT=3850" >> .env

# Or kill existing process
kill $(lsof -ti :3847)
```

### WS_AUTH_SECRET Too Short

**Symptom:** `WS_AUTH_SECRET must be at least 32 characters`

**Solution:**
```bash
# Generate new secret
openssl rand -hex 32

# Add to .env
echo "WS_AUTH_SECRET=$(openssl rand -hex 32)" >> .env
```

## Configuration Migration

### From SQLite to PostgreSQL

Old SQLite configuration is no longer used. Remove these variables:

```bash
# ❌ Deprecated (SQLite)
SQLITE_PATH=./data/claude_context.db

# ✅ Required (PostgreSQL)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=claude_context
DB_USER=dcm
DB_PASSWORD=secure_password
```

## Next Steps

- [12-cli-reference.md](./12-cli-reference.md) - CLI commands
- [14-troubleshooting.md](./14-troubleshooting.md) - Common issues
- [01-getting-started.md](./01-getting-started.md) - Installation guide

---

**Status:** Configuration system stable since v2.0. Production-ready.
