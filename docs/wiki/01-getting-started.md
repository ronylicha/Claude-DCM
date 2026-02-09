# Getting Started with DCM

This guide walks you through installing and configuring DCM for your Claude Code environment.

## Prerequisites

Before installing DCM, ensure you have:

### Required Software

1. **Bun** (v1.0+)
   ```bash
   curl -fsSL https://bun.sh/install | bash
   # or on macOS:
   brew install oven-sh/bun/bun
   ```

2. **PostgreSQL 16**
   ```bash
   # Ubuntu/Debian
   sudo apt install postgresql-16 postgresql-client-16

   # macOS
   brew install postgresql@16
   brew services start postgresql@16

   # Arch Linux
   sudo pacman -S postgresql
   sudo systemctl start postgresql
   ```

3. **Claude Code**
   - Desktop app installed
   - Settings file at `~/.config/ClaudeCode/settings.json`

4. **Utilities** (usually pre-installed)
   ```bash
   # Check if available
   which jq curl psql
   ```

### System Requirements

- **OS:** Linux, macOS, or WSL2
- **Memory:** 512MB+ available RAM
- **Disk:** 100MB+ free space
- **Network:** Ports 3847, 3848, 3849 available

## Installation

### Step 1: Clone the Repository

```bash
cd ~/Projects  # or your preferred location
git clone <repository-url> Claude-DCM
cd Claude-DCM/context-manager
```

### Step 2: Install Dependencies

```bash
bun install
```

**Expected output:**
```
bun install v1.x.x
 + hono@4.11.7
 + postgres@3.4.8
 + zod@4.3.6
 ...
 10 packages installed
```

### Step 3: Configure Environment

The installer will create `.env` from `.env.example`, but you can customize it:

```bash
cp .env.example .env
nano .env  # or vim, code, etc.
```

**Key variables:**

```env
# Database
DB_HOST=127.0.0.1
DB_PORT=5432
DB_USER=dcm
DB_NAME=claude_context
DB_PASSWORD=dcm_secure_password_2025

# Server Ports
PORT=3847          # API server
WS_PORT=3849       # WebSocket server
DASHBOARD_PORT=3848 # Next.js dashboard

# CORS (comma-separated)
ALLOWED_ORIGINS=http://localhost:3848,http://127.0.0.1:3848

# Environment
NODE_ENV=development
```

### Step 4: One-Command Setup

```bash
./dcm install
```

This command performs:
1. ✅ Checks prerequisites (bun, psql, jq, curl)
2. ✅ Installs npm dependencies
3. ✅ Creates `.env` from template
4. ✅ Sets up PostgreSQL database and user
5. ✅ Runs schema migrations
6. ✅ Installs Claude Code hooks

**Expected output:**
```
===========================================
    DCM Install - Full Setup
===========================================

[1/5] Checking prerequisites...
  ✓ bun found (v1.x.x)
  ✓ psql found
  ✓ jq found
  ✓ curl found

[2/5] Installing dependencies...
  ✓ Dependencies installed

[3/5] Configuring environment...
  ✓ .env created

[4/5] Setting up database...
  ✓ Database 'claude_context' created
  ✓ User 'dcm' created
  ✓ Schema applied
  ✓ 10 tables created
  ✓ 4 views created

[5/5] Installing Claude Code hooks...
  ✓ Hooks installed to ~/.config/ClaudeCode/settings.json
  ✓ Backup saved to settings.json.backup.<timestamp>

===========================================
Installation complete! 🎉
===========================================

Next steps:
  1. Start services:    ./dcm start
  2. Check status:      ./dcm status
  3. View dashboard:    http://localhost:3848
```

## Starting DCM

### Start All Services

```bash
./dcm start
```

This starts three services:
- **API Server** (port 3847) - Hono HTTP API
- **WebSocket Server** (port 3849) - Real-time events
- **Dashboard** (port 3848) - Next.js frontend

**Expected output:**
```
Starting DCM services...
  ✓ API server started (PID: 12345) - http://127.0.0.1:3847
  ✓ WebSocket server started (PID: 12346) - ws://127.0.0.1:3849
  ✓ Dashboard started (PID: 12347) - http://localhost:3848

All services running. Use 'dcm logs' to view output.
```

### Verify Installation

```bash
./dcm status
```

**Expected output:**
```
===========================================
    DCM Status
===========================================

  API (port 3847):       ✓ healthy (v3.0.0)
  WebSocket (port 3849): ✓ running
  Dashboard (port 3848): ✓ running
  PostgreSQL:            ✓ connected
  Claude Code hooks:     ✓ installed (7 hooks)

All systems operational.
```

### Health Check

```bash
curl http://127.0.0.1:3847/health | jq
```

**Expected response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-09T10:30:00.000Z",
  "version": "3.0.0",
  "database": {
    "healthy": true,
    "latency_ms": 2
  },
  "features": {
    "phase1": "active",
    "phase2": "active",
    "phase3": "active",
    "phase4": "active",
    "phase5": "active",
    "phase6": "active",
    "phase7": "active",
    "phase8": "active",
    "phase9": "active"
  }
}
```

## Accessing the Dashboard

Open your browser to:
```
http://localhost:3848
```

You should see:
- KPI cards (sessions, actions, agents, etc.)
- Real-time activity feed
- System health indicators
- Navigation sidebar with all pages

## Testing with Claude Code

### 1. Start a Claude Code Session

Open Claude Code and start a new conversation.

### 2. Verify Hook Execution

```bash
# Watch API logs
./dcm logs api

# Or tail guardian log
tail -f /tmp/dcm-guardian.log
```

You should see hook executions after each tool use.

### 3. Test Context Tracking

Ask Claude to create a file:
```
Create a test.txt file with "Hello DCM"
```

Then check the API:
```bash
curl "http://127.0.0.1:3847/api/actions?limit=5" | jq
```

You should see the `Write` tool action recorded.

### 4. Test Compact Restore

Run a long conversation until compaction occurs. After compaction, check that context is restored:

```bash
# In Claude Code, after compaction
# Ask: "What were we working on?"
# Claude should have context from DCM's restored brief
```

## Troubleshooting

### Problem: API Won't Start

**Error:** `Failed to connect to database`

**Solution:**
```bash
# Check PostgreSQL is running
sudo systemctl status postgresql
# or on macOS
brew services list | grep postgresql

# Check credentials
psql -U dcm -d claude_context -h 127.0.0.1
# Enter password from .env

# If connection fails, recreate database
./dcm db:reset
```

### Problem: Hooks Not Firing

**Error:** No actions recorded in `/api/actions`

**Solution:**
```bash
# Check hooks are installed
cat ~/.config/ClaudeCode/settings.json | jq '.hooks'

# Reinstall hooks
./dcm hooks

# Restart Claude Code app
```

### Problem: Dashboard Blank Page

**Error:** Dashboard loads but shows no data

**Solution:**
```bash
# Check API is accessible from frontend
curl http://127.0.0.1:3847/health

# Check CORS settings in .env
echo $ALLOWED_ORIGINS

# Should include dashboard URL
ALLOWED_ORIGINS=http://localhost:3848,http://127.0.0.1:3848

# Restart API
./dcm restart
```

### Problem: Port Already in Use

**Error:** `Address already in use (port 3847)`

**Solution:**
```bash
# Find process using port
lsof -i :3847
# or
sudo netstat -tulpn | grep 3847

# Kill the process
kill -9 <PID>

# Or change port in .env
PORT=3850
./dcm restart
```

### Problem: Database Connection Timeout

**Error:** `Connection timeout after 10s`

**Solution:**
```bash
# Check PostgreSQL allows TCP connections
sudo nano /etc/postgresql/16/main/pg_hba.conf

# Add line:
host    claude_context    dcm    127.0.0.1/32    md5

# Restart PostgreSQL
sudo systemctl restart postgresql

# Test connection
psql -U dcm -d claude_context -h 127.0.0.1
```

### Problem: Hooks Timeout

**Error:** Hooks take >10s to execute

**Solution:**
```bash
# Check API latency
time curl http://127.0.0.1:3847/health

# If slow (>500ms), check database
psql -U dcm -d claude_context -c "VACUUM ANALYZE;"

# Check disk space
df -h

# Increase hook timeouts in hooks.json if needed
```

## Advanced Configuration

### Custom Database

Use an existing PostgreSQL instance:

```env
DB_HOST=postgres.example.com
DB_PORT=5432
DB_USER=myuser
DB_PASSWORD=mypassword
DB_NAME=dcm_production
```

Then run schema:
```bash
psql -U myuser -d dcm_production -h postgres.example.com -f src/db/schema.sql
```

### Multiple DCM Instances

Run multiple instances on different ports:

**Instance 1 (Project A):**
```bash
export PORT=3847
export WS_PORT=3849
export DASHBOARD_PORT=3848
export DB_NAME=claude_context_projecta
./dcm start
```

**Instance 2 (Project B):**
```bash
export PORT=3857
export WS_PORT=3859
export DASHBOARD_PORT=3858
export DB_NAME=claude_context_projectb
./dcm start
```

### systemd Service (Linux)

Install as system service:

```bash
sudo cp context-manager-api.service /etc/systemd/system/
sudo cp context-manager-ws.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable context-manager-api
sudo systemctl enable context-manager-ws
sudo systemctl start context-manager-api
sudo systemctl start context-manager-ws
```

### Docker Deployment

```bash
docker-compose up -d
```

This starts:
- PostgreSQL container
- DCM API container
- DCM WebSocket container
- Dashboard container

See [DEPLOYMENT.md](../DEPLOYMENT.md) for full Docker setup.

## Uninstallation

### Remove Hooks Only

```bash
./dcm unhook
```

This removes DCM hooks from `settings.json` but keeps the database and services.

### Full Uninstall

```bash
# Stop services
./dcm stop

# Remove database
dropdb -U dcm claude_context

# Remove database user
dropuser dcm

# Remove hooks
./dcm unhook

# Remove files
cd ..
rm -rf context-manager context-dashboard docs
```

## Next Steps

Now that DCM is installed:

1. **Learn the architecture:** [02-architecture.md](./02-architecture.md)
2. **Explore the API:** [03-api-reference.md](./03-api-reference.md)
3. **Understand hooks:** [04-hooks-system.md](./04-hooks-system.md)
4. **Configure Context Guardian:** [05-context-guardian.md](./05-context-guardian.md)

## Quick Reference

```bash
# Service management
dcm start         # Start all services
dcm stop          # Stop all services
dcm restart       # Restart all services
dcm status        # Show service status
dcm logs [api|ws|dashboard]  # Tail logs

# Database
dcm db:setup      # Initialize database
dcm db:reset      # DESTRUCTIVE: Drop and recreate

# Hooks
dcm hooks         # Install/update hooks
dcm unhook        # Remove all hooks

# Context
dcm snapshot <session_id>     # Manual snapshot
dcm context <agent_id> <session_id>  # Get context brief

# Meta
dcm version       # Show version
dcm help          # Show usage
```

---

**Installation complete!** DCM is now tracking your Claude Code sessions.
