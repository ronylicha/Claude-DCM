# Claude Code Integration Guide

DCM integrates with Claude Code through two mechanisms: **shell hooks** that capture tool usage in real time, and a **TypeScript SDK** for programmatic access to the REST API and WebSocket server.

This guide covers setup, configuration, and usage for both.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Hooks Setup](#hooks-setup)
  - [Configuration](#configuration)
  - [Hook Reference](#hook-reference)
  - [Automated Setup](#automated-setup)
- [TypeScript SDK](#typescript-sdk)
  - [REST Client](#rest-client)
  - [WebSocket Client](#websocket-client)
- [Data Flow](#data-flow)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

- DCM API running on port 3847 (see [README](../README.md) for installation)
- `jq` installed on the host machine (`sudo apt install jq` or `brew install jq`)
- `curl` available in PATH
- Claude Code installed and configured

---

## Hooks Setup

DCM uses Claude Code's hook system to capture every tool invocation without interfering with the session. Three hooks work together:

| Hook | Trigger | Purpose |
|------|---------|---------|
| `track-action.sh` | Every tool use (`*`) | Records all tool actions to the API |
| `track-agent.sh` | Task tool only | Tracks agent spawning as subtasks |
| `track-session.sh` | Session start | Initializes the project/session/request/task chain |
| `track-agent-start.sh` | Task tool (alt) | Alternative agent start tracking with richer metadata |
| `track-agent-end.sh` | Task completion | Updates subtask status on agent completion |
| `track-session-end.sh` | Session end | Marks session as ended in the database |

**Legacy hooks** (not recommended, from SQLite era):

| Hook | Status | Notes |
|------|--------|-------|
| `track-usage.sh` | Deprecated | Original SQLite-based tracking, replaced by `track-action.sh` |
| `track-usage-wrapper.sh` | Deprecated | Wrapper for `track-usage.sh`, no longer needed |

### Configuration

Add the following to `~/.claude/settings.json`. Replace `/path/to/context-manager` with the actual install path.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "(nohup bash /path/to/context-manager/hooks/track-session.sh >/dev/null 2>&1 &)"
      }
    ],
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
    ]
  }
}
```

All hooks follow a fire-and-forget pattern: 1-second connect timeout, 2-second max execution time, errors silently ignored. They never block Claude Code.

### Hook Reference

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

Fires once at session start. Creates the full resource chain in order:

1. **Project** -- created or fetched by path via `POST /api/projects`.
2. **Session** -- created with the Claude Code session ID via `POST /api/sessions`.
3. **Request** -- initial request with `prompt_type: "other"` via `POST /api/requests`.
4. **Task** -- wave 0 task in `running` status via `POST /api/tasks`.

All IDs are cached to `/tmp/.claude-context/{session_id}.json` so that `track-agent.sh` can find them without extra API calls.

### Automated Setup

Run the setup script to check dependencies and get copy-paste instructions:

```bash
cd context-manager
bash scripts/setup-hooks.sh
```

The script verifies that `jq` is installed, checks whether `~/.claude/settings.json` exists, and tells you if hooks are already configured.

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

### REST Client

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

#### Health Check

```typescript
const health = await client.health();
// { status: "healthy", database: { healthy: true } }

const ok = await client.isHealthy();
// true
```

#### Recording Actions

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

#### Tool Routing

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

#### Projects and Sessions

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

#### Requests, Tasks, and Subtasks

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

#### Inter-Agent Messaging

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

#### Agent Blocking

Coordinate dependencies between agents:

```typescript
// Block an agent until a dependency completes
await client.blockAgent("frontend-react", "backend-laravel", "Waiting for API types");

// Check if an agent is blocked
const blocked = await client.isBlocked("backend-laravel");

// Unblock when ready
await client.unblockAgent("frontend-react", "backend-laravel");
```

#### Context and Compact Recovery

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

### WebSocket Client

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

#### Channel Subscriptions

```typescript
// Subscribe to channels
ws.subscribe("global");
ws.subscribe("sessions/my-session-id");
ws.subscribe("agents/backend-laravel");

// Unsubscribe
ws.unsubscribe("global");
```

#### Listening for Events

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

#### Publishing Events

```typescript
ws.publish("global", "custom.event", {
  message: "Something happened",
  source: "my-script",
});
```

#### Connection State

```typescript
ws.getState();  // "disconnected" | "connecting" | "connected" | "authenticated"
ws.isReady();   // true when connected or authenticated
```

#### Auto-Reconnect

The client automatically reconnects on unexpected disconnections using exponential backoff:

- Starts at 1 second, doubles each attempt, caps at 30 seconds.
- Stops after 10 consecutive failures.
- Restores all channel subscriptions after reconnecting.
- Clean disconnects (code 1000) do not trigger reconnection.

#### Disconnecting

```typescript
ws.disconnect(); // Sends close code 1000, stops ping interval, clears timers
```

#### Available Event Types

| Category | Events |
|----------|--------|
| Tasks | `task.created`, `task.updated`, `task.completed`, `task.failed` |
| Subtasks | `subtask.created`, `subtask.updated`, `subtask.completed`, `subtask.failed` |
| Messages | `message.new`, `message.read`, `message.expired` |
| Agents | `agent.connected`, `agent.disconnected`, `agent.heartbeat`, `agent.blocked`, `agent.unblocked` |
| Sessions | `session.created`, `session.ended` |
| System | `metric.update`, `system.error` |

---

## Data Flow

```
Claude Code Session
    |
    +-- Session starts
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
    |    |    \-- track-action.sh --> POST /api/actions
    |    |
    |    +-- Uses Write tool
    |    |    \-- track-action.sh --> POST /api/actions
    |    |
    |    +-- Uses Task tool (spawns agent)
    |    |    +-- track-action.sh --> POST /api/actions
    |    |    \-- track-agent.sh  --> POST /api/subtasks
    |    |
    |    +-- Uses Skill tool
    |    |    \-- track-action.sh --> POST /api/actions (effective name = skill name)
    |    |
    |    \-- Each action triggers:
    |         +-- Row inserted in PostgreSQL
    |         +-- Session counters updated
    |         +-- Keywords extracted for routing intelligence
    |         \-- NOTIFY --> WebSocket server --> Dashboard
    |
    \-- Dashboard (http://localhost:3848)
         +-- Real-time event stream
         +-- Session list with action counters
         +-- Agent activity and subtask tracking
         \-- Tool usage analytics and routing tester
```

---

## Environment Variables

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

### SDK connection refused

Verify the API and WebSocket ports are open and not blocked by a firewall:

```bash
ss -tlnp | grep -E '3847|3849'
```

If running in Docker, confirm the ports are mapped in `docker-compose.yml`.
