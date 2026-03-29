# Getting Started with DCM

Set up the Distributed Context Manager from scratch in about 10 minutes. By the end of this tutorial, you will have DCM running alongside Claude Code with persistent memory, compact recovery, and a real-time monitoring dashboard.

---

## What you will build

A local DCM installation with three services:

- **REST API** (port 3847) -- tracks every tool call, agent spawn, and session event
- **WebSocket server** (port 3849) -- streams events in real time
- **Dashboard** (port 3848) -- monitoring UI for sessions, agents, and waves

---

## Prerequisites

Before starting, make sure the following tools are installed on your machine.

| Tool | Minimum version | Check command |
|------|----------------|---------------|
| Bun | 1.x | `bun --version` |
| PostgreSQL | 16 | `psql --version` |
| jq | any | `jq --version` |
| curl | any | `curl --version` |
| lsof | any | `lsof -v` |
| Node.js | 22+ (dashboard only) | `node --version` |

Run this block to verify everything at once:

```bash
bun --version && psql --version && jq --version && curl --version && node --version
```

Expected output (version numbers may differ):

```
1.2.4
psql (PostgreSQL) 16.6 (Ubuntu 16.6-0ubuntu0.24.04.1)
jq-1.7.1
curl 8.5.0 (x86_64-pc-linux-gnu)
v22.12.0
```

### Install missing tools

**Bun:**

```bash
curl -fsSL https://bun.sh/install | bash
```

**PostgreSQL 16:**

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y postgresql-16 postgresql-client-16

# macOS
brew install postgresql@16
```

**jq:**

```bash
# Ubuntu/Debian
sudo apt install -y jq

# macOS
brew install jq
```

---

## Step 1 -- Clone the repository

```bash
git clone https://github.com/ronylicha/Claude-DCM.git
cd Claude-DCM
```

Your working directory is now `Claude-DCM/`. All subsequent commands assume this location.

---

## Step 2 -- Set up PostgreSQL

Make sure PostgreSQL is running:

```bash
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

Create a dedicated database user and database:

```bash
sudo -u postgres createuser --pwprompt dcm
```

When prompted, enter a password. Remember it -- you will need it for the `.env` file.

```bash
sudo -u postgres createdb -O dcm claude_context
```

Verify the connection:

```bash
psql -U dcm -d claude_context -h 127.0.0.1 -c "SELECT 1 AS connected;"
```

Expected output:

```
 connected
-----------
         1
(1 row)
```

If you get a "peer authentication failed" error, edit `pg_hba.conf` to allow password authentication for local connections:

```bash
# Find pg_hba.conf location
sudo -u postgres psql -c "SHOW hba_file;"

# Edit the file (change "peer" to "md5" for local connections)
sudo nano /etc/postgresql/16/main/pg_hba.conf
```

Change the line:

```
local   all   all   peer
```

to:

```
local   all   all   md5
```

Then restart PostgreSQL:

```bash
sudo systemctl restart postgresql
```

---

## Step 3 -- Install DCM

Navigate to the context-manager directory and run the installer:

```bash
cd context-manager
./dcm install
```

The installer performs five steps:

```
DCM Install - Full Setup
[1/5] Checking prerequisites...
[2/5] Installing dependencies...
[3/5] Configuring environment...
[4/5] Setting up database...
[5/5] Installing Claude Code hooks...
Installation complete!
Next: dcm start
```

If step 3 created a `.env` file from the template, edit it now:

```bash
nano .env
```

Set your database credentials:

```
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=claude_context
DB_USER=dcm
DB_PASSWORD=your_password_here
```

Save and close.

---

## Step 4 -- Apply the database schema

If the installer did not apply the schema automatically (check the output of step 4), run it manually:

```bash
psql -U dcm -d claude_context -h 127.0.0.1 -f src/db/schema.sql
```

Expected output ends with:

```
INSERT 0 1
INSERT 0 0
```

Verify the tables were created:

```bash
psql -U dcm -d claude_context -h 127.0.0.1 -c "\dt"
```

You should see 19 tables:

```
                    List of relations
 Schema |          Name           | Type  | Owner
--------+-------------------------+-------+-------
 public | actions                 | table | dcm
 public | agent_capacity          | table | dcm
 public | agent_contexts          | table | dcm
 public | agent_messages          | table | dcm
 public | agent_registry          | table | dcm
 public | calibration_ratios      | table | dcm
 public | keyword_tool_scores     | table | dcm
 public | orchestration_batches   | table | dcm
 public | preemptive_summaries    | table | dcm
 public | projects                | table | dcm
 public | requests                | table | dcm
 public | schema_version          | table | dcm
 public | sessions                | table | dcm
 public | subtasks                | table | dcm
 public | task_lists              | table | dcm
 public | token_consumption       | table | dcm
 public | wave_states             | table | dcm
(17 rows)
```

---

## Step 5 -- Start the services

```bash
./dcm start
```

This launches three background processes. You will see:

```
Starting DCM services...
  API server starting on port 3847...
  WebSocket server starting on port 3849...
  Dashboard starting on port 3848...
All services started.
```

---

## Step 6 -- Verify everything works

### Check overall status

```bash
./dcm status
```

Expected output:

```
DCM Status
  API (port 3847):       healthy (v3.1.0)
  WebSocket (port 3849):  running
  Dashboard (port 3848):  running
  PostgreSQL:             connected
  Claude Code hooks:      installed
```

### Hit the health endpoint directly

```bash
curl -s http://127.0.0.1:3847/health | jq .
```

Expected output:

```json
{
  "status": "healthy",
  "timestamp": "2026-03-28T10:00:00.000Z",
  "version": "3.1.0",
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

### Open the dashboard

Open [http://localhost:3848](http://localhost:3848) in your browser. You should see the DCM dashboard with health gauges and empty KPI cards.

### Send a test event

To confirm the full pipeline works (hook to API to database), send a synthetic action:

```bash
curl -s -X POST http://127.0.0.1:3847/api/actions \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "Test",
    "tool_type": "builtin",
    "session_id": "test-session-001"
  }' | jq .
```

Expected response:

```json
{
  "id": "a1b2c3d4-...",
  "tool_name": "Test",
  "tool_type": "builtin",
  "created_at": "2026-03-28T10:00:01.000Z"
}
```

Refresh the dashboard -- the action should appear in the activity feed.

---

## Step 7 -- Verify hooks in Claude Code

DCM works by hooking into Claude Code lifecycle events. The installer configured these hooks in `~/.claude/settings.json`.

Verify the hooks are registered:

```bash
cat ~/.claude/settings.json | jq '.hooks'
```

You should see entries for `PreToolUse`, `PostToolUse`, `SessionStart`, `PreCompact`, `SubagentStop`, `Stop`, and `SessionEnd`.

Now start a new Claude Code session. DCM will automatically:

1. Detect the session via `track-session.sh`
2. Track every tool call via `track-action.sh`
3. Monitor context size via `context-guardian.sh`
4. Save snapshots before compaction via `pre-compact-save.sh`
5. Restore context after compaction via `post-compact-restore.sh`
6. Block dangerous operations via `safety-gate.sh`

---

## What to do next

- **View live activity**: Open the dashboard at `http://localhost:3848` and watch events flow in during a Claude Code session.
- **Monitor from the terminal**: Run `bash hooks/dashboard.sh --watch` for a terminal-based view.
- **Learn the API**: See the [API Overview](../reference/api-overview.md) for all 86+ endpoints.
- **Deploy for production**: Follow the [Deployment Guide](../howto/deployment.md) for Docker, systemd, or manual setups.
- **Troubleshoot issues**: Check the [Troubleshooting Guide](../howto/troubleshooting.md) if something is not working.

---

## Quick reference

| Command | What it does |
|---------|-------------|
| `./dcm start` | Start all services |
| `./dcm stop` | Stop all services |
| `./dcm status` | Check health of all components |
| `./dcm logs api` | Tail API server logs |
| `./dcm restart` | Stop then start all services |
| `curl http://127.0.0.1:3847/health` | Direct API health check |
