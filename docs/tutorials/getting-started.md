# Getting Started with DCM

Set up the Distributed Context Manager from scratch in about 10 minutes. By the end of this tutorial you will have DCM running alongside Claude Code with persistent memory, pipeline orchestration, and a real-time monitoring dashboard.

---

## What you will build

A local DCM installation with five capabilities:

- **REST API** (port 3847) -- tracks every tool call, agent spawn, and session event across 143+ endpoints
- **WebSocket server** (port 3849) -- streams events in real time to the dashboard
- **Dashboard** (port 3848) -- 18-page monitoring UI for sessions, agents, pipelines, and analytics
- **Pipeline engine** -- submit instructions, get an AI-generated execution plan, and let DCM run it wave by wave
- **Redis cache** (port 6379) -- pub/sub messaging and fast lookups

---

## Prerequisites

| Tool | Minimum version | Check command |
|------|----------------|---------------|
| Bun | 1.x | `bun --version` |
| PostgreSQL | 16+ | `psql --version` |
| Node.js | 22+ (dashboard) | `node --version` |
| jq | any | `jq --version` |
| curl | any | `curl --version` |

Run this block to verify everything at once:

```bash
bun --version && psql --version && node --version && jq --version && curl --version
```

### Install missing tools

**Bun:**

```bash
curl -fsSL https://bun.sh/install | bash
```

**PostgreSQL 17:**

```bash
# Ubuntu/Debian
sudo apt update && sudo apt install -y postgresql-17 postgresql-client-17

# macOS
brew install postgresql@17
```

PostgreSQL 16 also works. The Docker setup ships with PostgreSQL 17 Alpine.

**Node.js 22:**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
```

---

## Step 1 -- Clone the repository

```bash
git clone https://github.com/ronylicha/Claude-DCM.git
cd Claude-DCM
```

All subsequent commands assume your working directory is `Claude-DCM/`.

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

Enter a password when prompted. You will need it for the `.env` file.

```bash
sudo -u postgres createdb -O dcm claude_context
```

Verify the connection:

```bash
psql -U dcm -d claude_context -h 127.0.0.1 -c "SELECT 1 AS connected;"
```

If you get a "peer authentication failed" error, edit `pg_hba.conf` to allow password authentication:

```bash
sudo -u postgres psql -c "SHOW hba_file;"
# Edit the file shown, change 'peer' to 'md5' for local connections
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

---

## Step 4 -- Apply the database schema

If the installer did not apply the schema automatically, run it manually:

```bash
psql -U dcm -d claude_context -h 127.0.0.1 -f src/db/schema.sql
```

Apply the pipeline and provider migrations:

```bash
psql -U dcm -d claude_context -h 127.0.0.1 -f src/db/migration-pipelines.sql
psql -U dcm -d claude_context -h 127.0.0.1 -f src/db/migration-pipeline-sprints.sql
psql -U dcm -d claude_context -h 127.0.0.1 -f src/db/migration-llm-providers.sql
psql -U dcm -d claude_context -h 127.0.0.1 -f src/db/migration-planner-settings.sql
psql -U dcm -d claude_context -h 127.0.0.1 -f src/db/migration-capacity-fields.sql
```

Verify the tables were created:

```bash
psql -U dcm -d claude_context -h 127.0.0.1 -c "\dt"
```

You should see 25+ tables including `pipelines`, `pipeline_steps`, `pipeline_events`, `pipeline_sprints`, `llm_providers`, `planning_output`, and `dcm_settings`.

---

## Step 5 -- Start the services

```bash
./dcm start
```

This launches three background processes:

| Process | Port | Stack |
|---------|------|-------|
| API Server | 3847 | Bun + Hono |
| WebSocket Server | 3849 | Bun native WS |
| Dashboard | 3848 | Next.js 16 |

---

## Step 6 -- Verify everything works

### Check overall status

```bash
./dcm status
```

Expected output:

```
DCM Status
  API (port 3847):       healthy (v2.1.0)
  WebSocket (port 3849):  running
  Dashboard (port 3848):  running (production)
  PostgreSQL:             connected
  Claude Code hooks:      installed
```

### Hit the health endpoint

```bash
curl -s http://127.0.0.1:3847/health | jq .
```

Expected output:

```json
{
  "status": "healthy",
  "timestamp": "2026-03-31T10:00:00.000Z",
  "version": "2.1.0",
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

Open [http://localhost:3848](http://localhost:3848) in your browser. You should see the DCM dashboard with health gauges and KPI cards.

### Send a test action

To confirm the full pipeline works (hook to API to database):

```bash
curl -s -X POST http://127.0.0.1:3847/api/actions \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "Test",
    "tool_type": "builtin",
    "session_id": "test-session-001"
  }' | jq .
```

Refresh the dashboard -- the action appears in the activity feed.

---

## Step 7 -- Verify Claude Code hooks

DCM hooks into Claude Code lifecycle events. The installer configured these in `~/.claude/settings.json`.

```bash
cat ~/.claude/settings.json | jq '.hooks'
```

You should see entries for `PreToolUse`, `PostToolUse`, `SessionStart`, `PreCompact`, `SubagentStop`, `Stop`, and `SessionEnd`.

Start a new Claude Code session. DCM automatically:

1. Detects the session via `track-session.sh`
2. Tracks every tool call via `track-action.sh`
3. Enforces skill loading via `skill-gate-enforce.sh`
4. Monitors context size via `context-guardian.sh`
5. Saves snapshots before compaction via `pre-compact-save.sh`
6. Restores context after compaction via `post-compact-restore.sh`
7. Blocks dangerous operations via `safety-gate.sh`
8. Provides skill routing suggestions via `suggest-skills.sh`

---

## Step 8 -- Create your first pipeline

Pipelines let DCM plan and execute complex tasks autonomously. Before creating a pipeline, you need an LLM provider configured.

### Configure an LLM provider

The dashboard Settings page lets you add API keys for cloud providers (MiniMax, ZhipuAI, Moonshot) or use local CLI providers (Claude CLI, Codex CLI, Gemini CLI) that authenticate through their own login flow.

```bash
# Example: set the active planner to Claude CLI (no API key needed)
curl -s -X POST http://127.0.0.1:3847/api/settings/planner \
  -H "Content-Type: application/json" \
  -d '{"provider_key": "claude-cli"}' | jq .
```

For cloud providers, configure the API key first:

```bash
curl -s -X POST http://127.0.0.1:3847/api/settings/providers/minimax/configure \
  -H "Content-Type: application/json" \
  -d '{"api_key": "your_minimax_api_key"}' | jq .
```

### Create the pipeline

```bash
curl -s -X POST http://127.0.0.1:3847/api/pipelines \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "pipeline-demo-001",
    "instructions": "Create a REST API with user authentication using JWT tokens",
    "workspace": {
      "path": "/tmp/dcm-demo"
    }
  }' | jq .
```

The pipeline engine will:

1. Call the configured LLM planner to generate a multi-wave execution plan
2. Create pipeline steps with agent assignments, skills, and prompts
3. Organize steps into sprints with objectives

### Start execution

```bash
curl -s -X POST http://127.0.0.1:3847/api/pipelines/<pipeline_id>/start | jq .
```

Replace `<pipeline_id>` with the ID returned in the creation response.

### Monitor in real time

Open the Pipeline page in the dashboard at `http://localhost:3848/pipeline`. You can watch:

- Live streaming output from the LLM planner
- Wave-by-wave execution progress
- Agent step status (pending, running, completed, failed)
- Sprint reports with objectives and git commits
- Decision engine actions on failures (retry, skip, alternate agent)

---

## Step 9 -- Set up Docker (alternative)

If you prefer containers over a local installation, Docker Compose brings up all five services with a single command.

```bash
cd Claude-DCM

cat > .env << 'EOF'
DB_PASSWORD=your_secure_password
WS_AUTH_SECRET=your_hmac_secret_at_least_32_chars
EOF

docker compose up -d
```

Docker maps the PostgreSQL container port to `5433` on the host by default to avoid conflicts with a locally installed PostgreSQL. All other ports remain the same (3847, 3848, 3849).

You still need to install hooks on the host:

```bash
cd context-manager && ./dcm hooks
```

See the [Deployment Guide](../howto/deployment.md) for full Docker configuration options.

---

## What to do next

- **Monitor live activity**: Open the dashboard at `http://localhost:3848` and watch events during a Claude Code session
- **Create a pipeline**: Use the Pipeline page to submit instructions and watch DCM plan and execute them
- **Configure providers**: Visit the Settings page to set up LLM providers for pipeline planning
- **Learn the API**: See the [API Reference](../reference/api-overview.md) for all 143+ endpoints
- **Deploy for production**: Follow the [Deployment Guide](../howto/deployment.md) for Docker, systemd, or manual setups
- **Troubleshoot issues**: Check the [Troubleshooting Guide](../howto/troubleshooting.md) if something is not working

---

## Quick reference

| Command | What it does |
|---------|-------------|
| `./dcm start` | Start all services |
| `./dcm stop` | Stop all services |
| `./dcm status` | Check health of all components |
| `./dcm logs api` | Tail API server logs |
| `./dcm restart` | Stop then start all services |
| `./dcm deploy` | Pull, rebuild, migrate, restart |
| `curl http://127.0.0.1:3847/health` | Direct API health check |
