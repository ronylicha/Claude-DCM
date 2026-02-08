# Claude Code integration guide

DCM integrates with Claude Code through two mechanisms: **shell hooks** that capture tool usage, manage compact recovery, and monitor context size in real time, and a **TypeScript SDK** for programmatic access to the REST API and WebSocket server.

This guide covers setup, configuration, and usage for both.

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Hooks setup](#hooks-setup)
  - [Configuration](#configuration)
  - [Hook reference](#hook-reference)
  - [Automated setup](#automated-setup)
- [Plugin installation](#plugin-installation)
- [DCM CLI](#dcm-cli)
- [TypeScript SDK](#typescript-sdk)
  - [REST client](#rest-client)
  - [WebSocket client](#websocket-client)
- [Data flow](#data-flow)
- [Environment variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- DCM API running on port 3847 (see [README](../README.md) for installation)
- `jq` installed on the host machine (`sudo apt install jq` or `brew install jq`)
- `curl` available in PATH
- Claude Code installed and configured

---

## Hooks setup

DCM uses Claude Code's hook system to capture tool invocations, save and restore context across compacts, broadcast agent results, and proactively monitor transcript size. Nine hooks work together across five event types:

| Hook | Event | Matcher | Purpose |
|------|-------|---------|---------|
| `track-action.sh` | PostToolUse | `*` | Records all tool actions to the API |
| `track-agent.sh` | PostToolUse | `Task` | Tracks agent spawning as subtasks |
| `monitor-context.sh` | PostToolUse | `*` | Proactive transcript size monitoring |
| `track-session.sh` | SessionStart | `startup` | Initializes the project/session/request/task chain |
| `post-compact-restore.sh` | SessionStart | `compact` | Restores context after compact |
| `pre-compact-save.sh` | PreCompact | `auto`, `manual` | Saves context snapshot before compact |
| `save-agent-result.sh` | SubagentStop | -- | Broadcasts agent results for cross-agent sharing |
| `track-session-end.sh` | SessionEnd | -- | Marks session as ended in the database |
| `track-agent-start.sh` | PostToolUse | `Task` | Alternative agent start tracking with richer metadata |
| `track-agent-end.sh` | SubagentStop | -- | Updates subtask status on agent completion |

**Legacy hooks** (not recommended, from SQLite era):

| Hook | Status | Notes |
|------|--------|-------|
| `track-usage.sh` | Deprecated | Original SQLite-based tracking, replaced by `track-action.sh` |
| `track-usage-wrapper.sh` | Deprecated | Wrapper for `track-usage.sh`, no longer needed |

### Configuration

The recommended way to configure hooks is through the automated setup script (see [Automated setup](#automated-setup)). If you prefer manual configuration, add the following to `~/.claude/settings.json`. Replace `/path/to/context-manager` with the actual install path.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/context-manager/hooks/track-action.sh",
            "timeout": 3
          }
        ]
      },
      {
        "matcher": "Task",
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/context-manager/hooks/track-agent.sh",
            "timeout": 3
          }
        ]
      },
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/context-manager/hooks/monitor-context.sh",
            "timeout": 2
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/context-manager/hooks/track-session.sh",
            "timeout": 5
          }
        ]
      },
      {
        "matcher": "compact",
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/context-manager/hooks/post-compact-restore.sh",
            "timeout": 8
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "auto",
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/context-manager/hooks/pre-compact-save.sh",
            "timeout": 5
          }
        ]
      },
      {
        "matcher": "manual",
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/context-manager/hooks/pre-compact-save.sh",
            "timeout": 5
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/context-manager/hooks/save-agent-result.sh",
            "timeout": 3
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "bash /path/to/context-manager/hooks/track-session-end.sh",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
```

All hooks follow a fire-and-forget pattern: short connect timeouts, bounded max execution times, errors silently ignored. They never block Claude Code.

### Hook reference

#### track-action.sh

Fires on every tool use. Reads JSON from stdin with the fields `tool_name`, `tool_input`, `session_id`, and `cwd`.

**Tool type detection.** The hook classifies each tool into one of four types:

| Type | Tools |
|------|-------|
| `builtin` | Read, Write, Edit, Bash, Glob, Grep, MultiEdit, NotebookEdit, WebFetch, WebSearch, and others |
| `agent` | Task, TaskCreate, TaskUpdate, TaskGet, TaskList, TaskOutput, TaskStop |
| `skill` | Skill (effective name extracted from `tool_input.skill`) |
| `mcp` | Any tool prefixed with `mcp__` |

**Effective name resolution.** For `Skill` tools, the hook extracts the skill name from `tool_input.skill`. For `Task` tools, it uses `tool_input.subagent_type`. This means the API receives the specific agent or skill name rather than a generic tool label.

**Payload sent to the API:**

```
POST /api/actions
{
  "tool_name": "<effective name>",
  "tool_type": "builtin | agent | skill | mcp",
  "input": "<tool_input, truncated to 2 KB>",
  "exit_code": 0,
  "session_id": "<session_id>",
  "project_path": "<cwd>"
}
```

Sessions and projects are auto-created by the API if they do not exist yet (upsert behavior).

#### track-agent.sh

Fires only on Task tool calls. Creates a subtask entry that represents an agent being spawned.

**Initialization chain.** If no task exists for the current session, the hook auto-creates the full hierarchy:

1. Finds or creates a project from the current working directory.
2. Creates a request with `prompt_type: "auto"`.
3. Creates a task in `running` status.
4. Caches the resulting `task_id` in `/tmp/.claude-context/{session_id}.json` for subsequent calls.

**Subtask creation.** Once a `task_id` is available, the hook creates a subtask:

```
POST /api/subtasks
{
  "task_id": "<cached or resolved task_id>",
  "agent_type": "<from tool_input.subagent_type>",
  "agent_id": "agent-<timestamp>-<random hex>",
  "description": "<from tool_input.description, max 500 chars>",
  "status": "running"
}
```

#### track-session.sh

Fires once at session start (matcher: `startup`). Creates the full resource chain in order:

1. **Project** -- created or fetched by path via `POST /api/projects`.
2. **Session** -- created with the Claude Code session ID via `POST /api/sessions`.
3. **Request** -- initial request with `prompt_type: "other"` via `POST /api/requests`.
4. **Task** -- wave 0 task in `running` status via `POST /api/tasks`.

All IDs are cached to `/tmp/.claude-context/{session_id}.json` so that `track-agent.sh` can find them without extra API calls.

#### pre-compact-save.sh

Fires before Claude compacts the conversation. Registered for both `auto` and `manual` PreCompact matchers, so it runs whether the user types `/compact` or Claude triggers an automatic compaction.

**What it saves.** The hook gathers state from multiple sources and posts a snapshot to the API:

1. **Active tasks** -- queries `GET /api/subtasks?status=running&limit=20` for running subtasks.
2. **Modified files** -- queries `GET /api/actions?limit=50&session_id=...` and extracts file paths from Edit and Write actions.
3. **Agent states** -- queries `GET /api/agent-contexts?limit=20` for agent context entries.
4. **Context summary** -- reads the last 50 lines of the transcript file and extracts assistant messages (capped at 500 characters).
5. **Cached session data** -- reads the project ID from `/tmp/.claude-context/{session_id}.json`.

**Payload sent to the API:**

```
POST /api/compact/save
{
  "session_id": "<session_id>",
  "trigger": "auto" | "manual",
  "context_summary": "<extracted summary>",
  "active_tasks": [...],
  "modified_files": [...],
  "key_decisions": [...],
  "agent_states": [...]
}
```

Timeouts: 1-second connect, 3-second max for the save request. Errors are silently ignored.

#### post-compact-restore.sh

Fires at session start with the `compact` matcher, meaning it runs only when a session resumes after compaction. This is the counterpart to `pre-compact-save.sh`.

**Restore strategy.** The hook tries two approaches in order:

1. `POST /api/compact/restore` with `session_id`, `agent_id`, `agent_type`, and `max_tokens: 3000`. The server generates a full context brief from the saved snapshot and recent activity.
2. If the first call returns no brief, falls back to `GET /api/compact/snapshot/{session_id}` and builds a minimal brief locally from the raw snapshot data (active tasks, modified files, agent states, key decisions).

**Context injection.** If a brief is obtained, the hook writes JSON to stdout in the format Claude Code expects:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "<restored context brief>"
  }
}
```

Claude Code reads this output and injects the `additionalContext` string into the conversation, so the model sees the restored state immediately after compact.

If neither restore call succeeds, the hook exits silently and Claude continues without injected context.

Timeouts: 2-second connect, 5-second max for the restore call, 3-second max for the snapshot fallback.

#### save-agent-result.sh

Fires on the SubagentStop event, after a subagent finishes execution.

**What it captures.** The hook reads the transcript file to extract:

- The last Task tool result (the subagent's output, capped at 1000 characters then truncated to 500 for storage).
- The last Task tool call to identify the `agent_type` and `description`.

**What it does.** Two actions run in parallel:

1. **Broadcasts a message** via `POST /api/messages` with topic `agent.completed`, making the result available to other agents through the messaging API and WebSocket server.

```
POST /api/messages
{
  "from_agent_id": "<agent_type>",
  "to_agent_id": null,
  "message_type": "agent.completed",
  "topic": "agent.completed",
  "payload": {
    "agent_type": "<agent_type>",
    "description": "<task description>",
    "result_summary": "<truncated result>"
  },
  "priority": 3
}
```

2. **Updates the subtask status** by querying `GET /api/subtasks?agent_type=...&status=running&limit=1` to find the matching subtask, then calling `PATCH /api/subtasks/{id}` with `status: "completed"` and the result summary.

Timeouts: 1-second connect, 2-second max per request. Both requests fire in parallel and complete independently.

#### monitor-context.sh

Fires on every PostToolUse event (matcher: `*`), but only performs a full check every 10th invocation to minimize overhead.

**Counter mechanism.** The hook maintains a call counter in `/tmp/.dcm-monitor-counter`. On each invocation it increments the counter and exits immediately unless the count is a multiple of 10.

**Transcript size thresholds.** On every 10th call, the hook checks the transcript file size:

| Zone | Size | Action |
|------|------|--------|
| Green | Under 500 KB | No action |
| Yellow | 500 KB to 800 KB | Logs a warning to `/tmp/dcm-monitor.log` |
| Red | Over 800 KB | Triggers a proactive context snapshot |

**Proactive snapshot.** When the transcript enters the red zone, the hook calls `POST /api/compact/save` with `trigger: "proactive"` and a context summary extracted from the last 50 lines of the transcript. This saves the current state so that if Claude auto-compacts shortly after, `post-compact-restore.sh` has fresh data to work with.

**Cooldown.** A 60-second cooldown prevents repeated snapshots. The timestamp of the last proactive snapshot is stored in `/tmp/.dcm-last-proactive`. If fewer than 60 seconds have elapsed since the last snapshot, the hook skips the save.

**Logging.** All significant events (warnings, alerts, errors) are appended to `/tmp/dcm-monitor.log`.

### Automated setup

The setup script auto-injects all DCM hooks into `~/.claude/settings.json` using a jq deep merge. Existing non-DCM hooks in the settings file are preserved.

```bash
cd context-manager
bash scripts/setup-hooks.sh
```

The script performs the following steps:

1. Verifies that `jq` is installed.
2. Creates `~/.claude/settings.json` if it does not exist.
3. Checks whether DCM hooks are already present. If so, exits unless `--force` is passed.
4. Backs up the current settings file to `~/.claude/settings.json.bak.<timestamp>`.
5. Builds the complete hook configuration with absolute paths to the hook scripts.
6. Merges the hooks into the existing settings using jq. The merge strategy strips any pre-existing DCM hook entries (matched by script name) before appending the new ones, so running the script twice does not create duplicates.
7. Validates the resulting JSON. If validation fails, the backup is restored automatically.

To force re-injection (for example after updating DCM):

```bash
bash scripts/setup-hooks.sh --force
```

The `dcm` CLI provides aliases for these operations:

```bash
./dcm hooks           # Same as bash scripts/setup-hooks.sh
./dcm hooks --force   # Same as bash scripts/setup-hooks.sh --force
./dcm unhook          # Remove all DCM hooks from settings.json (backs up first)
```

After any hook change, restart Claude Code for the new configuration to take effect.

---

## Plugin installation

As an alternative to global hooks injection, DCM can be installed as a Claude Code plugin. The plugin approach uses `hooks/hooks.json` with `${CLAUDE_PLUGIN_ROOT}` path variables, so hook script paths resolve automatically without hard-coded absolute paths.

**Plugin directory structure:**

```
context-manager/
  .claude-plugin/
    plugin.json          Plugin manifest (name, version, description)
  hooks/
    hooks.json           Plugin-native hook definitions
  agents/
    context-keeper.md    Agent for manual context inspection
```

**Installation via the Claude Code plugin system:**

```
/plugin marketplace add /path/to/Claude-DCM
/plugin install dcm@dcm-marketplace
```

Once installed, Claude Code discovers the plugin automatically and registers all hooks defined in `hooks/hooks.json`. The plugin provides the same hooks as the global setup (track-action, track-agent, monitor-context, track-session, post-compact-restore, pre-compact-save, save-agent-result, track-session-end) with the same timeouts.

The plugin also exposes the `context-keeper` agent, which can query DCM state, trigger manual snapshots, and display restored context on demand.

**When to use plugin vs global hooks.** Use the plugin approach when you want Claude Code to manage hook lifecycle automatically and avoid touching `~/.claude/settings.json`. Use the global hooks approach when you need more control over hook configuration or want to customize timeouts and matchers.

---

## DCM CLI

The `dcm` wrapper script (`context-manager/dcm`) provides a single entry point for all DCM operations. Run it from the `context-manager/` directory or add it to your PATH.

```bash
cd context-manager
./dcm <command> [options]
```

**Available commands:**

| Command | Description |
|---------|-------------|
| `install` | Full first-time setup: check prerequisites, install dependencies, configure environment, set up database, inject hooks |
| `start` | Start all DCM services (API on port 3847, WebSocket on port 3849, Dashboard on port 3848) |
| `stop` | Stop all DCM services |
| `restart` | Stop then start all services |
| `status` | Show health status of all services, database connection, and hook installation |
| `hooks` | Install or update Claude Code hooks (delegates to `scripts/setup-hooks.sh`) |
| `unhook` | Remove all DCM hooks from `~/.claude/settings.json` (backs up first) |
| `health` | Quick health check against the API |
| `logs <service>` | Tail logs for a service (`api`, `ws`, or `dashboard`) |
| `snapshot [session_id]` | Trigger a manual context snapshot. If no session ID is provided, uses the most recent cached session |
| `context <agent_id> [session_id]` | Get the context brief for an agent. Defaults to `orchestrator` if no agent ID is given |
| `db:setup` | Initialize the database schema |
| `db:reset` | Drop and recreate the database (prompts for confirmation) |
| `version` | Print DCM version |

**Examples:**

```bash
./dcm install                           # First-time setup
./dcm start                             # Start everything
./dcm status                            # Check what's running
./dcm context backend-laravel           # Get context for an agent
./dcm snapshot abc-123                   # Manual snapshot for a session
./dcm logs api                          # Tail API logs
./dcm unhook                            # Remove hooks from settings.json
```

---

## TypeScript SDK

The SDK provides typed clients for both the REST API and the WebSocket server. Source files are located in `context-manager/src/sdk/`.

```
src/sdk/
  index.ts      -- Package exports
  types.ts      -- Type definitions (DCMConfig, ActionInput, etc.)
  client.ts     -- DCMClient (REST)
  ws-client.ts  -- DCMWebSocket (real-time events)
```

Import everything from the SDK entry point:

```typescript
import { DCMClient, DCMWebSocket } from "./context-manager/src/sdk";
import type { ActionInput, MessageInput, DCMConfig } from "./context-manager/src/sdk";
```

### REST client

`DCMClient` wraps all REST endpoints with typed methods, automatic retries, and configurable timeouts.

#### Initialization

```typescript
const client = new DCMClient({
  apiUrl: "http://127.0.0.1:3847",
  timeout: 5000,    // Request timeout in ms (default: 5000)
  retries: 2,       // Retry count on failure (default: 2)
  authToken: "",    // Optional Bearer token
});
```

All config fields are optional. Defaults connect to `localhost:3847` with a 5-second timeout and 2 retries.

#### Health check

```typescript
const health = await client.health();
// { status: "healthy", database: { healthy: true } }

const ok = await client.isHealthy();
// true
```

#### Recording actions

```typescript
await client.recordAction({
  tool_name: "Read",
  tool_type: "builtin",
  input: "/src/components/App.tsx",
  exit_code: 0,
  session_id: "my-session",
  project_path: "/home/user/my-project",
});
```

The `ActionInput` type accepts these fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tool_name` | string | Yes | Name of the tool used |
| `tool_type` | `"builtin" \| "agent" \| "skill" \| "command" \| "mcp"` | Yes | Category of the tool |
| `input` | string | No | Tool input (truncated by hooks to 2 KB) |
| `output` | string | No | Tool output |
| `exit_code` | number | No | Exit code (0 = success) |
| `duration_ms` | number | No | Execution duration |
| `file_paths` | string[] | No | Files involved |
| `session_id` | string | No | Session identifier |
| `project_path` | string | No | Project root path |

#### Tool routing

Get intelligent tool suggestions based on keywords extracted from the user's request:

```typescript
const result = await client.suggestTool(["react", "component", "create"], {
  limit: 5,
  min_score: 0.3,
  tool_type: "agent",
});

for (const suggestion of result.suggestions) {
  console.log(`${suggestion.tool_name} (score: ${suggestion.score})`);
}
```

Submit feedback to improve routing accuracy over time:

```typescript
await client.routingFeedback("frontend-react", ["react", "component"], true);
```

#### Projects and sessions

```typescript
// Create a project (upsert by path)
const project = await client.createProject("/home/user/my-project", "my-project");

// Look up a project by its filesystem path
const found = await client.getProjectByPath("/home/user/my-project");

// Create a session
const session = await client.createSession({
  session_id: "abc-123",
  project_id: project.project.id,
  cwd: "/home/user/my-project",
});

// End a session
await client.endSession("abc-123");
```

#### Requests, tasks, and subtasks

```typescript
// Create a request (represents a user prompt)
const request = await client.createRequest(sessionId, "Add login page", projectId);

// Create a task (represents a wave of work)
const task = await client.createTask(request.request.id, "Wave 1 - Backend");

// Create a subtask (represents a delegated agent)
const subtask = await client.createSubtask({
  task_id: task.task.id,
  agent_type: "backend-laravel",
  description: "Create authentication controller",
  status: "running",
});

// Update subtask status when agent finishes
await client.updateSubtask(subtask.subtask.id, {
  status: "completed",
  result: { files_created: ["AuthController.php"] },
});
```

#### Inter-agent messaging

```typescript
// Send a message from one agent to another
await client.sendMessage({
  from_agent_id: "backend-laravel",
  to_agent_id: "frontend-react",
  topic: "api_endpoint_created",
  payload: {
    endpoint: "/api/users",
    methods: ["GET", "POST"],
    response_schema: { id: "string", email: "string" },
  },
  priority: 1,
  ttl_ms: 300000, // Expires after 5 minutes
});

// Poll messages for an agent
const messages = await client.getMessages("frontend-react", {
  topic: "api_endpoint_created",
  since: "2025-01-01T00:00:00Z",
});
```

#### Agent blocking

Coordinate dependencies between agents:

```typescript
// Block an agent until a dependency completes
await client.blockAgent("frontend-react", "backend-laravel", "Waiting for API types");

// Check if an agent is blocked
const blocked = await client.isBlocked("backend-laravel");

// Unblock when ready
await client.unblockAgent("frontend-react", "backend-laravel");
```

#### Context and compact recovery

```typescript
// Get context brief for an agent
const context = await client.getContext("backend-laravel", {
  session_id: "my-session",
  format: "brief",
  max_tokens: 2000,
});

// Restore context after a /compact
await client.restoreAfterCompact("my-session", "backend-laravel", "Summary of work done...");
```

### WebSocket client

`DCMWebSocket` provides real-time event streaming with automatic reconnection and channel-based subscriptions.

#### Connection

```typescript
const ws = new DCMWebSocket({
  wsUrl: "ws://127.0.0.1:3849",
  agentId: "my-agent",
  sessionId: "my-session",
  authToken: "", // Optional HMAC token for production
});

await ws.connect();
```

On connection, the client automatically sends an `auth` message and starts a ping interval every 25 seconds to keep the connection alive.

#### Channel subscriptions

```typescript
// Subscribe to channels
ws.subscribe("global");
ws.subscribe("sessions/my-session-id");
ws.subscribe("agents/backend-laravel");

// Unsubscribe
ws.unsubscribe("global");
```

#### Listening for events

Three patterns are available depending on how you want to filter events:

```typescript
// 1. Listen to a specific channel (auto-subscribes if needed)
const unsub = ws.on("global", (event) => {
  console.log(`[${event.channel}] ${event.event}:`, event.data);
});

// 2. Listen for a specific event type across all channels
ws.onEvent("action.created", (event) => {
  console.log("New action:", event.data.tool_name);
});

ws.onEvent("subtask.created", (event) => {
  console.log("Agent spawned:", event.data.agent_type);
});

// 3. Listen for every event
ws.onAny((event) => {
  console.log(`[${event.event}] on ${event.channel}`, event.data);
});
```

Each listener returns an unsubscribe function:

```typescript
const unsub = ws.onEvent("task.completed", handler);
// Later:
unsub();
```

#### Publishing events

```typescript
ws.publish("global", "custom.event", {
  message: "Something happened",
  source: "my-script",
});
```

#### Connection state

```typescript
ws.getState();  // "disconnected" | "connecting" | "connected" | "authenticated"
ws.isReady();   // true when connected or authenticated
```

#### Auto-reconnect

The client automatically reconnects on unexpected disconnections using exponential backoff:

- Starts at 1 second, doubles each attempt, caps at 30 seconds.
- Stops after 10 consecutive failures.
- Restores all channel subscriptions after reconnecting.
- Clean disconnects (code 1000) do not trigger reconnection.

#### Disconnecting

```typescript
ws.disconnect(); // Sends close code 1000, stops ping interval, clears timers
```

#### Available event types

| Category | Events |
|----------|--------|
| Tasks | `task.created`, `task.updated`, `task.completed`, `task.failed` |
| Subtasks | `subtask.created`, `subtask.updated`, `subtask.completed`, `subtask.failed` |
| Messages | `message.new`, `message.read`, `message.expired` |
| Agents | `agent.connected`, `agent.disconnected`, `agent.heartbeat`, `agent.blocked`, `agent.unblocked` |
| Sessions | `session.created`, `session.ended` |
| System | `metric.update`, `system.error` |

---

## Data flow

```
Claude Code Session
    |
    +-- Session starts (startup)
    |    \-- track-session.sh
    |         +-- POST /api/projects  (find or create project)
    |         +-- POST /api/sessions  (register session)
    |         +-- POST /api/requests  (initial request)
    |         +-- POST /api/tasks     (wave 0 task)
    |         \-- Cache IDs to /tmp/.claude-context/{session_id}.json
    |
    +-- User types a prompt, Claude processes...
    |    |
    |    +-- Uses Read tool
    |    |    +-- track-action.sh  --> POST /api/actions
    |    |    \-- monitor-context.sh (counter++, full check every 10th)
    |    |
    |    +-- Uses Write tool
    |    |    +-- track-action.sh  --> POST /api/actions
    |    |    \-- monitor-context.sh (counter++, full check every 10th)
    |    |
    |    +-- Uses Task tool (spawns agent)
    |    |    +-- track-action.sh  --> POST /api/actions
    |    |    +-- track-agent.sh   --> POST /api/subtasks
    |    |    \-- monitor-context.sh (counter++, full check every 10th)
    |    |
    |    +-- Uses Skill tool
    |    |    +-- track-action.sh  --> POST /api/actions (effective name = skill name)
    |    |    \-- monitor-context.sh (counter++, full check every 10th)
    |    |
    |    \-- Each action triggers:
    |         +-- Row inserted in PostgreSQL
    |         +-- Session counters updated
    |         +-- Keywords extracted for routing intelligence
    |         \-- NOTIFY --> WebSocket server --> Dashboard
    |
    +-- Subagent finishes
    |    \-- save-agent-result.sh
    |         +-- POST /api/messages  (broadcast agent.completed)
    |         \-- PATCH /api/subtasks/{id}  (mark completed)
    |
    +-- Context grows large (monitor detects >800 KB)
    |    \-- monitor-context.sh
    |         \-- POST /api/compact/save  (trigger=proactive, 60s cooldown)
    |
    +-- Compact triggered (auto or /compact)
    |    +-- pre-compact-save.sh (PreCompact)
    |    |    +-- GET /api/subtasks?status=running  (active tasks)
    |    |    +-- GET /api/actions?limit=50         (modified files)
    |    |    +-- GET /api/agent-contexts            (agent states)
    |    |    \-- POST /api/compact/save             (full snapshot)
    |    |
    |    \-- [Claude compacts the conversation]
    |
    +-- Session resumes after compact
    |    \-- post-compact-restore.sh (SessionStart, compact matcher)
    |         +-- POST /api/compact/restore  (get context brief)
    |         +-- Fallback: GET /api/compact/snapshot/{session_id}
    |         \-- Output JSON with hookSpecificOutput.additionalContext
    |              \-- Claude sees restored context immediately
    |
    \-- Dashboard (http://localhost:3848)
         +-- Real-time event stream
         +-- Session list with action counters
         +-- Agent activity and subtask tracking
         \-- Tool usage analytics and routing tester
```

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTEXT_MANAGER_URL` | `http://127.0.0.1:3847` | API URL used by hooks |

The hooks read this variable at runtime. Set it in your shell profile if the API runs on a non-default host or port:

```bash
export CONTEXT_MANAGER_URL="http://192.168.1.50:3847"
```

For the TypeScript SDK, pass the URL through the `DCMConfig` object:

```typescript
const client = new DCMClient({ apiUrl: "http://192.168.1.50:3847" });
const ws = new DCMWebSocket({ wsUrl: "ws://192.168.1.50:3849" });
```

---

## Troubleshooting

### Hooks are not sending data

1. Verify the API is running: `curl http://localhost:3847/health`
2. Check that the hook scripts are executable: `ls -la context-manager/hooks/*.sh`
3. Run a hook manually to see errors:
   ```bash
   echo '{"tool_name":"Read","tool_input":{},"session_id":"test","cwd":"/tmp"}' | bash context-manager/hooks/track-action.sh 0
   ```
4. Confirm `jq` is installed: `jq --version`

### Actions appear in the API but not on the dashboard

The dashboard receives events through the WebSocket server. Make sure the WebSocket process is running on port 3849 and that PostgreSQL `LISTEN/NOTIFY` is functioning:

```bash
# Check WebSocket server
curl -s http://localhost:3847/health | jq .websocket

# Test WebSocket connection
npx wscat -c ws://localhost:3849
```

### Agent subtasks are not tracked

`track-agent.sh` only fires when the `Task` tool is used. Verify the matcher in `settings.json` is set to `"Task"` (case-sensitive). Also confirm the cache directory `/tmp/.claude-context/` is writable.

### Context not restored after compact

1. Check that `pre-compact-save.sh` ran before compact. Look for a snapshot: `curl http://localhost:3847/api/compact/snapshot/<session_id>`
2. Check that `post-compact-restore.sh` is registered under `SessionStart` with matcher `"compact"`.
3. Test the restore endpoint directly:
   ```bash
   curl -s -X POST http://localhost:3847/api/compact/restore \
     -H "Content-Type: application/json" \
     -d '{"session_id":"<session_id>","agent_id":"orchestrator","agent_type":"orchestrator","max_tokens":3000}'
   ```
4. If the API returns no brief, the snapshot may not have been saved. Check `/tmp/dcm-monitor.log` for errors.

### Monitor hook not triggering snapshots

The monitor only runs a full check every 10th tool call. To verify it is counting:

```bash
cat /tmp/.dcm-monitor-counter
```

If the counter is not incrementing, the hook is not receiving input. Check that the PostToolUse matcher is set to `"*"` for `monitor-context.sh`.

The 60-second cooldown may also prevent repeated snapshots. Check the last trigger time:

```bash
cat /tmp/.dcm-last-proactive
```

Review the monitor log for warnings and alerts:

```bash
cat /tmp/dcm-monitor.log
```

### Agent results not shared

`save-agent-result.sh` fires on SubagentStop. It reads the transcript file to find the last Task tool result. If the transcript is not accessible or contains no Task results, the hook exits silently. Verify the hook is registered under `SubagentStop` in settings.json and that the transcript path is valid.

### SDK connection refused

Verify the API and WebSocket ports are open and not blocked by a firewall:

```bash
ss -tlnp | grep -E '3847|3849'
```

If running in Docker, confirm the ports are mapped in `docker-compose.yml`.
