# DCM API Reference

Complete reference for the Distributed Context Manager REST API.

**Version:** 2.0.0
**Base URL:** `http://localhost:3847`
**Transport:** JSON over HTTP
**Authentication:** None required for REST (HMAC tokens for WebSocket only)

---

## Table of Contents

- [Conventions](#conventions)
- [Error Format](#error-format)
- [Health and Stats](#health-and-stats)
- [Projects](#projects)
- [Requests (User Prompts)](#requests-user-prompts)
- [Tasks (Waves)](#tasks-waves)
- [Subtasks](#subtasks)
- [Actions (Tool Tracking)](#actions-tool-tracking)
- [Sessions](#sessions)
- [Routing Intelligence](#routing-intelligence)
- [Messages (Inter-Agent Pub/Sub)](#messages-inter-agent-pubsub)
- [Subscriptions](#subscriptions)
- [Blocking (Coordination)](#blocking-coordination)
- [Context](#context)
- [Compact / Restore](#compact--restore)
- [Hierarchy](#hierarchy)
- [Authentication](#authentication)
- [Cleanup Stats](#cleanup-stats)

---

## Conventions

All endpoints follow these patterns:

| Convention | Detail |
|---|---|
| Content-Type | `application/json` for request and response bodies |
| IDs | UUIDs generated server-side unless stated otherwise |
| Timestamps | ISO 8601 strings (`2025-06-15T14:30:00.000Z`) |
| Pagination | `?limit=` (default 100, max 100) and `?offset=` (default 0) |
| Deletion | Returns `204 No Content` with empty body on success |
| Creation | Returns `201 Created` with the created resource |

---

## Error Format

All errors return a JSON body with an `error` field. Validation errors include a `details` object.

```json
{
  "error": "Validation failed",
  "details": {
    "path": ["path is required"]
  }
}
```

**Standard error codes:**

| Code | Meaning |
|---|---|
| `400` | Bad request / validation failure |
| `404` | Resource not found |
| `409` | Conflict (duplicate) |
| `500` | Internal server error |

---

## Health and Stats

### GET /health

Service health check. Returns database connectivity status and enabled feature phases.

```bash
curl http://localhost:3847/health
```

**Response `200`** (healthy) or **`503`** (unhealthy):

```json
{
  "status": "healthy",
  "timestamp": "2025-06-15T14:30:00.000Z",
  "version": "1.8.0",
  "database": {
    "healthy": true,
    "latency_ms": 2
  },
  "features": {
    "phase1": "database",
    "phase2": "routing",
    "phase3": "hierarchy",
    "phase4": "pubsub",
    "phase5": "context",
    "phase6": "sessions",
    "phase7": "tools-summary",
    "phase8": "websocket-auth"
  }
}
```

---

### GET /stats

Global statistics across all tables.

```bash
curl http://localhost:3847/stats
```

**Response `200`:**

```json
{
  "projects": 12,
  "requests": 84,
  "tasks": 156,
  "subtasks": 423,
  "actions": 2891,
  "sessions": 37,
  "messages": 64,
  "timestamp": "2025-06-15T14:30:00.000Z"
}
```

---

### GET /stats/tools-summary

Counts of skills, commands, workflows, and plugins installed in `~/.claude`. Results are cached for 5 minutes.

```bash
curl http://localhost:3847/stats/tools-summary
```

**Response `200`:**

```json
{
  "skills": 42,
  "commands": 18,
  "workflows": 7,
  "plugins": 3,
  "cached_at": "2025-06-15T14:30:00.000Z",
  "from_cache": false
}
```

---

## Dashboard KPIs

### GET /api/dashboard/kpis

Aggregated KPI metrics for the dashboard. Returns 24-hour action stats, session counts, agent context distribution, subtask completion rates, and routing intelligence stats. Runs 7 parallel aggregation queries.

```bash
curl http://localhost:3847/api/dashboard/kpis
```

**Response `200`:**

```json
{
  "actions_24h": {
    "total": 156,
    "success": 150,
    "success_rate": 96,
    "unique_tools": 12,
    "active_sessions": 2,
    "avg_per_hour": 6.5
  },
  "sessions": {
    "total": 37,
    "active": 2,
    "avg_tools_per_session": 78.1
  },
  "agents": {
    "contexts_total": 42,
    "unique_types": 8,
    "top_types": [
      {"agent_type": "backend-laravel", "count": 12}
    ]
  },
  "subtasks": {
    "total": 423,
    "completed": 380,
    "running": 15,
    "failed": 28,
    "completion_rate": 90
  },
  "routing": {
    "keywords": 340,
    "tools": 68,
    "mappings": 1250
  },
  "timestamp": "2025-06-15T14:30:00.000Z"
}
```

---

## Agent Contexts

### GET /api/agent-contexts

List all agent context snapshots with filtering and stats.

```bash
curl "http://localhost:3847/api/agent-contexts?agent_type=backend-laravel&limit=20"
```

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `agent_type` | string | - | Filter by agent type |
| `status` | string | - | Filter by status (from `role_context.status`) |
| `limit` | integer | 100 | Max results (capped at 100) |
| `offset` | integer | 0 | Pagination offset |

**Response `200`:**

```json
{
  "contexts": [ ... ],
  "total": 42,
  "limit": 20,
  "offset": 0,
  "stats": {
    "total": 42,
    "unique_types": 8,
    "running": 3,
    "completed": 35,
    "failed": 4
  },
  "type_distribution": [
    {"agent_type": "backend-laravel", "count": 12, "running": 1, "completed": 10}
  ],
  "timestamp": "2025-06-15T14:30:00.000Z"
}
```

---

### GET /api/agent-contexts/stats

Detailed agent context statistics including top types, recent activity, and tool usage.

```bash
curl http://localhost:3847/api/agent-contexts/stats
```

**Response `200`:**

```json
{
  "overview": {
    "total_contexts": 42,
    "unique_agent_types": 8,
    "unique_projects": 3,
    "active_agents": 3,
    "completed_agents": 35,
    "failed_agents": 4,
    "oldest_context": "2025-05-01T10:00:00.000Z",
    "newest_context": "2025-06-15T14:30:00.000Z"
  },
  "top_types": [ ... ],
  "recent_activity": [ ... ],
  "tools_used": [
    {"tool": "Read", "usage_count": 245}
  ],
  "timestamp": "2025-06-15T14:30:00.000Z"
}
```

---

## Projects

Projects represent monitored codebases, identified by their filesystem path.

### POST /api/projects

Create a new project or update an existing one if the path already exists (upsert).

```bash
curl -X POST http://localhost:3847/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/home/user/my-project",
    "name": "My Project",
    "metadata": {"language": "typescript"}
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `path` | string | Yes | Absolute filesystem path. Trailing slashes are stripped. |
| `name` | string | No | Human-readable project name |
| `metadata` | object | No | Arbitrary key-value pairs |

**Response `201`:**

```json
{
  "success": true,
  "project": {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "path": "/home/user/my-project",
    "name": "My Project",
    "created_at": "2025-06-15T14:30:00.000Z",
    "updated_at": "2025-06-15T14:30:00.000Z",
    "metadata": {"language": "typescript"}
  }
}
```

**Error codes:** `400` validation failure, `500` server error

---

### GET /api/projects

List all projects with pagination.

```bash
curl "http://localhost:3847/api/projects?limit=10&offset=0"
```

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 100 | Max results (capped at 100) |
| `offset` | integer | 0 | Pagination offset |

**Response `200`:**

```json
{
  "projects": [
    {
      "id": "a1b2c3d4-...",
      "path": "/home/user/my-project",
      "name": "My Project",
      "created_at": "2025-06-15T14:30:00.000Z",
      "updated_at": "2025-06-15T14:30:00.000Z",
      "metadata": {}
    }
  ],
  "count": 1,
  "total": 12,
  "limit": 10,
  "offset": 0
}
```

---

### GET /api/projects/:id

Get a single project by ID, including its recent requests and stats.

```bash
curl http://localhost:3847/api/projects/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Response `200`:**

```json
{
  "project": {
    "id": "a1b2c3d4-...",
    "path": "/home/user/my-project",
    "name": "My Project",
    "created_at": "2025-06-15T14:30:00.000Z",
    "updated_at": "2025-06-15T14:30:00.000Z",
    "metadata": {},
    "requests": [
      {
        "id": "...",
        "session_id": "20250615_143000_abc123",
        "prompt": "Add user authentication",
        "prompt_type": "feature",
        "status": "active",
        "created_at": "2025-06-15T14:30:00.000Z",
        "completed_at": null,
        "metadata": {}
      }
    ],
    "stats": {
      "project_id": "a1b2c3d4-...",
      "total_requests": 5,
      "total_tasks": 12,
      "total_subtasks": 38
    }
  }
}
```

**Error codes:** `400` missing ID, `404` not found

---

### GET /api/projects/by-path

Look up a project by its filesystem path.

```bash
curl "http://localhost:3847/api/projects/by-path?path=/home/user/my-project"
```

**Query parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `path` | string | Yes | Exact filesystem path |

**Response `200`:**

```json
{
  "project": {
    "id": "a1b2c3d4-...",
    "path": "/home/user/my-project",
    "name": "My Project",
    "created_at": "2025-06-15T14:30:00.000Z",
    "updated_at": "2025-06-15T14:30:00.000Z",
    "metadata": {}
  }
}
```

**Error codes:** `400` missing path, `404` not found

---

### DELETE /api/projects/:id

Delete a project and all associated data (cascade).

```bash
curl -X DELETE http://localhost:3847/api/projects/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Response:** `204 No Content` (empty body)

**Error codes:** `404` not found

**WebSocket event:** `project.deleted` on channel `global`

---

## Requests (User Prompts)

Requests represent individual user prompts or instructions within a session.

### POST /api/requests

Create a new request.

```bash
curl -X POST http://localhost:3847/api/requests \
  -H "Content-Type: application/json" \
  -d '{
    "project_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "session_id": "20250615_143000_abc123",
    "prompt": "Add user authentication with JWT",
    "prompt_type": "feature"
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `project_id` | UUID | Yes | Parent project ID (must exist) |
| `session_id` | string | Yes | Claude Code session identifier |
| `prompt` | string | Yes | The user prompt text |
| `prompt_type` | enum | No | One of: `feature`, `debug`, `explain`, `search`, `refactor`, `test`, `review`, `other` |
| `status` | enum | No | One of: `active`, `completed`, `failed`, `cancelled`. Default: `active` |
| `metadata` | object | No | Arbitrary key-value pairs |

**Response `201`:**

```json
{
  "success": true,
  "request": {
    "id": "f1e2d3c4-...",
    "project_id": "a1b2c3d4-...",
    "session_id": "20250615_143000_abc123",
    "prompt": "Add user authentication with JWT",
    "prompt_type": "feature",
    "status": "active",
    "created_at": "2025-06-15T14:30:00.000Z",
    "completed_at": null,
    "metadata": {}
  }
}
```

**Error codes:** `400` validation, `404` project not found

---

### GET /api/requests

List requests with optional filters.

```bash
curl "http://localhost:3847/api/requests?project_id=a1b2c3d4-...&status=active&limit=20"
```

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `project_id` | UUID | - | Filter by project |
| `session_id` | string | - | Filter by session |
| `status` | enum | - | Filter by status |
| `limit` | integer | 100 | Max results (capped at 100) |
| `offset` | integer | 0 | Pagination offset |

**Response `200`:**

```json
{
  "requests": [ ... ],
  "count": 5,
  "limit": 20,
  "offset": 0
}
```

---

### GET /api/requests/:id

Get a single request with its associated tasks (waves).

```bash
curl http://localhost:3847/api/requests/f1e2d3c4-...
```

**Response `200`:**

```json
{
  "request": {
    "id": "f1e2d3c4-...",
    "project_id": "a1b2c3d4-...",
    "session_id": "20250615_143000_abc123",
    "prompt": "Add user authentication with JWT",
    "prompt_type": "feature",
    "status": "active",
    "created_at": "2025-06-15T14:30:00.000Z",
    "completed_at": null,
    "metadata": {},
    "tasks": [
      {
        "id": "...",
        "request_id": "f1e2d3c4-...",
        "name": "Wave 0",
        "wave_number": 0,
        "status": "completed",
        "created_at": "...",
        "completed_at": "..."
      }
    ]
  }
}
```

---

### PATCH /api/requests/:id

Update a request's status or metadata. Setting status to `completed` automatically sets `completed_at`.

```bash
curl -X PATCH http://localhost:3847/api/requests/f1e2d3c4-... \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | enum | No* | `active`, `completed`, `failed`, or `cancelled` |
| `metadata` | object | No* | Merged with existing metadata |

*At least one field is required.

**Response `200`:**

```json
{
  "success": true,
  "request": { ... }
}
```

**Error codes:** `400` no fields or invalid status, `404` not found

---

### DELETE /api/requests/:id

Delete a request and all associated tasks/subtasks (cascade).

```bash
curl -X DELETE http://localhost:3847/api/requests/f1e2d3c4-...
```

**Response:** `204 No Content`

**WebSocket event:** `request.deleted` on channel `global`

---

## Tasks (Waves)

Tasks represent execution waves within a request. They map to the `task_lists` database table.

### POST /api/tasks

Create a new task (wave). If `wave_number` is omitted, it auto-increments from the highest existing wave.

```bash
curl -X POST http://localhost:3847/api/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "f1e2d3c4-...",
    "name": "Wave 1 - Backend",
    "wave_number": 1,
    "status": "pending"
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `request_id` | UUID | Yes | Parent request ID (must exist) |
| `name` | string | No | Human-readable label. Default: `Wave {N}` |
| `wave_number` | integer | No | Wave index (>= 0). Auto-assigned if omitted. |
| `status` | enum | No | `pending`, `running`, `completed`, `failed`, or `blocked`. Default: `pending` |

**Response `201`:**

```json
{
  "success": true,
  "task": {
    "id": "b2c3d4e5-...",
    "request_id": "f1e2d3c4-...",
    "name": "Wave 1 - Backend",
    "wave_number": 1,
    "status": "pending",
    "created_at": "2025-06-15T14:30:00.000Z",
    "completed_at": null
  }
}
```

**WebSocket event:** `task.created` on channel `global`

**Error codes:** `400` validation, `404` request not found

---

### GET /api/tasks

List tasks with optional filters.

```bash
curl "http://localhost:3847/api/tasks?request_id=f1e2d3c4-...&status=running"
```

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `request_id` | UUID | - | Filter by parent request |
| `status` | enum | - | Filter by status |
| `limit` | integer | 100 | Max results (capped at 100) |
| `offset` | integer | 0 | Pagination offset |

**Response `200`:**

```json
{
  "tasks": [ ... ],
  "count": 3,
  "limit": 100,
  "offset": 0
}
```

---

### GET /api/tasks/:id

Get a single task with all its subtasks.

```bash
curl http://localhost:3847/api/tasks/b2c3d4e5-...
```

**Response `200`:**

```json
{
  "task": {
    "id": "b2c3d4e5-...",
    "request_id": "f1e2d3c4-...",
    "name": "Wave 1 - Backend",
    "wave_number": 1,
    "status": "running",
    "created_at": "...",
    "completed_at": null,
    "subtasks": [
      {
        "id": "...",
        "task_list_id": "b2c3d4e5-...",
        "agent_type": "backend-laravel",
        "agent_id": "agent-backend-01",
        "description": "Create User model",
        "status": "completed",
        "blocked_by": null,
        "created_at": "...",
        "started_at": "...",
        "completed_at": "...",
        "result": {"files_modified": ["app/Models/User.php"]}
      }
    ]
  }
}
```

---

### PATCH /api/tasks/:id

Update a task's status or name. Setting status to `completed` automatically sets `completed_at`.

```bash
curl -X PATCH http://localhost:3847/api/tasks/b2c3d4e5-... \
  -H "Content-Type: application/json" \
  -d '{"status": "completed"}'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | enum | No* | `pending`, `running`, `completed`, `failed`, or `blocked` |
| `name` | string | No* | Updated display name |

*At least one field is required.

**WebSocket event:** `task.{status}` on channel `global` (e.g., `task.completed`)

---

### DELETE /api/tasks/:id

Delete a task and all associated subtasks (cascade).

```bash
curl -X DELETE http://localhost:3847/api/tasks/b2c3d4e5-...
```

**Response:** `204 No Content`

**WebSocket event:** `task.deleted` on channel `global`

---

## Subtasks

Subtasks represent individual units of work assigned to agents within a wave.

### POST /api/subtasks

Create a new subtask.

```bash
curl -X POST http://localhost:3847/api/subtasks \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "b2c3d4e5-...",
    "description": "Create migration for users table",
    "agent_type": "backend-laravel",
    "agent_id": "agent-backend-01",
    "status": "pending",
    "blocked_by": [],
    "context_snapshot": {"wave": 1, "priority": "high"}
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `task_id` | UUID | Yes | Parent task ID (must exist) |
| `description` | string | Yes | What the subtask should accomplish |
| `agent_type` | string | No | Agent role (e.g., `backend-laravel`, `frontend-react`) |
| `agent_id` | string | No | Specific agent instance ID |
| `status` | enum | No | `pending`, `running`, `paused`, `blocked`, `completed`, or `failed`. Default: `pending` |
| `blocked_by` | UUID[] | No | IDs of subtasks that must complete first |
| `context_snapshot` | object | No | Snapshot of relevant context at creation time |

**Response `201`:**

```json
{
  "success": true,
  "subtask": {
    "id": "c3d4e5f6-...",
    "task_id": "b2c3d4e5-...",
    "task_list_id": "b2c3d4e5-...",
    "agent_type": "backend-laravel",
    "agent_id": "agent-backend-01",
    "description": "Create migration for users table",
    "status": "pending",
    "blocked_by": [],
    "created_at": "2025-06-15T14:30:00.000Z",
    "started_at": null,
    "completed_at": null,
    "context_snapshot": {"wave": 1, "priority": "high"},
    "result": null
  }
}
```

**WebSocket events:**
- `subtask.created` on channel `global`
- `subtask.created` on channel `agents/{agent_type}` (if agent_type is set)

**Error codes:** `400` validation or invalid blocked_by IDs, `404` task not found

---

### GET /api/subtasks

List subtasks with optional filters.

```bash
curl "http://localhost:3847/api/subtasks?task_id=b2c3d4e5-...&status=running&agent_type=backend-laravel"
```

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `task_id` | UUID | - | Filter by parent task |
| `status` | enum | - | Filter by status |
| `agent_type` | string | - | Filter by agent type |
| `limit` | integer | 100 | Max results (capped at 100) |
| `offset` | integer | 0 | Pagination offset |

**Response `200`:**

```json
{
  "subtasks": [
    {
      "id": "c3d4e5f6-...",
      "task_list_id": "b2c3d4e5-...",
      "task_id": "b2c3d4e5-...",
      "agent_type": "backend-laravel",
      "description": "Create migration for users table",
      "status": "running",
      ...
    }
  ],
  "count": 1,
  "limit": 100,
  "offset": 0
}
```

---

### GET /api/subtasks/:id

Get a single subtask with its associated actions (tool calls).

```bash
curl http://localhost:3847/api/subtasks/c3d4e5f6-...
```

**Response `200`:**

```json
{
  "subtask": {
    "id": "c3d4e5f6-...",
    "task_list_id": "b2c3d4e5-...",
    "task_id": "b2c3d4e5-...",
    "agent_type": "backend-laravel",
    "agent_id": "agent-backend-01",
    "description": "Create migration for users table",
    "status": "completed",
    "blocked_by": null,
    "created_at": "...",
    "started_at": "...",
    "completed_at": "...",
    "context_snapshot": {},
    "result": {"files_modified": ["database/migrations/..."]},
    "actions": [
      {
        "id": "...",
        "tool_name": "Write",
        "tool_type": "builtin",
        "exit_code": 0,
        "duration_ms": 45,
        "file_paths": ["database/migrations/2025_06_15_create_users_table.php"],
        "created_at": "..."
      }
    ]
  }
}
```

---

### PATCH /api/subtasks/:id

Update a subtask. Status transitions trigger automatic timestamp updates:
- `running` sets `started_at` (if not already set)
- `completed` or `failed` sets `completed_at`

```bash
curl -X PATCH http://localhost:3847/api/subtasks/c3d4e5f6-... \
  -H "Content-Type: application/json" \
  -d '{
    "status": "completed",
    "result": {"files_modified": ["app/Models/User.php"], "lines_added": 45}
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `status` | enum | No* | `pending`, `running`, `paused`, `blocked`, `completed`, or `failed` |
| `result` | object | No* | Outcome data (typically set on completion) |
| `agent_id` | string | No* | Assign or reassign an agent |
| `blocked_by` | UUID[] | No* | Update blocking dependencies |

*At least one field is required.

**WebSocket events:**
- `subtask.{status}` on channel `global`
- `subtask.{status}` on channel `agents/{agent_type}` (if agent_type is set)

---

### DELETE /api/subtasks/:id

Delete a subtask and all associated actions (cascade).

```bash
curl -X DELETE http://localhost:3847/api/subtasks/c3d4e5f6-...
```

**Response:** `204 No Content`

**WebSocket events:** `subtask.deleted` on channels `global` and `agents/{agent_type}`

---

## Actions (Tool Tracking)

Actions record individual tool invocations (Read, Write, Bash, Grep, Task, etc.). They also feed the routing intelligence system by extracting keywords from input text.

### POST /api/actions

Log a tool action. Automatically upserts the session and project if `session_id` and `project_path` are provided.

```bash
curl -X POST http://localhost:3847/api/actions \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "Read",
    "tool_type": "builtin",
    "input": "Reading file /home/user/project/src/index.ts",
    "output": "File contents...",
    "exit_code": 0,
    "duration_ms": 12,
    "file_paths": ["/home/user/project/src/index.ts"],
    "session_id": "20250615_143000_abc123",
    "project_path": "/home/user/project"
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `tool_name` | string | Yes | Name of the tool (e.g., `Read`, `Write`, `Bash`, `Task`) |
| `tool_type` | enum | Yes | One of: `builtin`, `agent`, `skill`, `command`, `mcp` |
| `input` | string | No | Tool input (compressed if > 1KB) |
| `output` | string | No | Tool output (compressed if > 1KB) |
| `exit_code` | integer | No | Exit code. Default: `0` |
| `duration_ms` | integer | No | Execution time in milliseconds |
| `file_paths` | string[] | No | Files involved in the action |
| `subtask_id` | UUID | No | Link to a specific subtask |
| `session_id` | string | No | Session ID (triggers auto-upsert of session) |
| `project_path` | string | No | Project path (triggers auto-upsert of project) |

**Response `201`:**

```json
{
  "success": true,
  "action": {
    "id": "d4e5f6a7-...",
    "tool_name": "Read",
    "tool_type": "builtin",
    "exit_code": 0,
    "duration_ms": 12,
    "created_at": "2025-06-15T14:30:00.000Z",
    "session_id": "20250615_143000_abc123",
    "keywords_extracted": 4
  }
}
```

**Side effects:**
- Extracts keywords from `input` and updates routing intelligence scores
- Auto-upserts session and project if `session_id`/`project_path` are provided
- Increments session counters (`total_tools_used`, `total_success`/`total_errors`)

**WebSocket event:** `action.created` on channel `global`

---

### GET /api/actions

List recent actions with optional filters.

```bash
curl "http://localhost:3847/api/actions?tool_type=builtin&tool_name=Read&limit=20"
```

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `tool_type` | enum | - | Filter by type (`builtin`, `agent`, `skill`, `command`, `mcp`) |
| `tool_name` | string | - | Filter by tool name |
| `limit` | integer | 100 | Max results (capped at 100) |
| `offset` | integer | 0 | Pagination offset |

**Response `200`:**

```json
{
  "actions": [
    {
      "id": "d4e5f6a7-...",
      "tool_name": "Read",
      "tool_type": "builtin",
      "exit_code": 0,
      "duration_ms": 12,
      "file_paths": ["/home/user/project/src/index.ts"],
      "created_at": "2025-06-15T14:30:00.000Z",
      "session_id": "20250615_143000_abc123"
    }
  ],
  "count": 1,
  "limit": 20,
  "offset": 0
}
```

---

### GET /api/actions/hourly

Hourly action distribution for the last 24 hours.

```bash
curl http://localhost:3847/api/actions/hourly
```

**Response `200`:**

```json
{
  "data": [
    {"hour": "2025-06-15T13:00:00.000Z", "count": 42},
    {"hour": "2025-06-15T14:00:00.000Z", "count": 67}
  ],
  "period": "24h"
}
```

---

### DELETE /api/actions/:id

Delete a single action by ID.

```bash
curl -X DELETE http://localhost:3847/api/actions/d4e5f6a7-...
```

**Response:** `204 No Content`

---

### DELETE /api/actions/by-session/:session_id

Bulk delete all actions associated with a session.

```bash
curl -X DELETE http://localhost:3847/api/actions/by-session/20250615_143000_abc123
```

**Response `200`:**

```json
{
  "success": true,
  "deleted_count": 156,
  "session_id": "20250615_143000_abc123"
}
```

**WebSocket event:** `actions.bulk_deleted` on channel `global`

---

## Sessions

Sessions represent Claude Code working sessions.

### POST /api/sessions

Create a new session. The `id` is client-provided (typically the Claude Code session ID).

```bash
curl -X POST http://localhost:3847/api/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "id": "20250615_143000_abc123",
    "project_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "started_at": "2025-06-15T14:30:00.000Z"
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Unique session identifier |
| `project_id` | UUID | No | Associated project |
| `started_at` | ISO datetime | No | Session start time. Default: now |
| `ended_at` | ISO datetime | No | Session end time |
| `total_tools_used` | integer | No | Initial tool count. Default: `0` |
| `total_success` | integer | No | Initial success count. Default: `0` |
| `total_errors` | integer | No | Initial error count. Default: `0` |

**Response `201`:**

```json
{
  "id": "20250615_143000_abc123",
  "project_id": "a1b2c3d4-...",
  "started_at": "2025-06-15T14:30:00.000Z",
  "ended_at": null,
  "total_tools_used": 0,
  "total_success": 0,
  "total_errors": 0
}
```

**Error codes:** `400` validation, `409` session already exists

**WebSocket event:** `session.created` on channel `global`

---

### GET /api/sessions

List sessions with optional filters.

```bash
curl "http://localhost:3847/api/sessions?project_id=a1b2c3d4-...&active_only=true&limit=10"
```

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `project_id` | UUID | - | Filter by project |
| `active_only` | `true`/`false` | `false` | Only sessions where `ended_at` is null |
| `limit` | integer | 50 | Max results (capped at 100) |
| `offset` | integer | 0 | Pagination offset |

**Response `200`:**

```json
{
  "sessions": [ ... ],
  "total": 37,
  "limit": 10,
  "offset": 0
}
```

---

### GET /api/sessions/stats

Aggregate statistics across all sessions.

```bash
curl http://localhost:3847/api/sessions/stats
```

**Response `200`:**

```json
{
  "overview": {
    "total_sessions": 37,
    "active_sessions": 2,
    "total_tools": 2891,
    "total_success": 2750,
    "total_errors": 141,
    "avg_tools_per_session": 78.1,
    "oldest_session": "2025-05-01T10:00:00.000Z",
    "newest_session": "2025-06-15T14:30:00.000Z"
  },
  "by_project": [
    {
      "project_name": "My Project",
      "project_path": "/home/user/my-project",
      "session_count": 12,
      "total_tools": 945
    }
  ],
  "timestamp": "2025-06-15T14:30:00.000Z"
}
```

---

### GET /api/sessions/:id

Get a single session with its recent requests.

```bash
curl http://localhost:3847/api/sessions/20250615_143000_abc123
```

**Response `200`:**

```json
{
  "id": "20250615_143000_abc123",
  "project_id": "a1b2c3d4-...",
  "started_at": "2025-06-15T14:30:00.000Z",
  "ended_at": null,
  "total_tools_used": 156,
  "total_success": 150,
  "total_errors": 6,
  "requests": [
    {
      "id": "...",
      "prompt": "Add user authentication",
      "prompt_type": "feature",
      "status": "active",
      "created_at": "..."
    }
  ]
}
```

---

### PATCH /api/sessions/:id

Update session fields.

```bash
curl -X PATCH http://localhost:3847/api/sessions/20250615_143000_abc123 \
  -H "Content-Type: application/json" \
  -d '{"ended_at": "2025-06-15T16:00:00.000Z"}'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `ended_at` | ISO datetime | No* | Mark session as ended |
| `total_tools_used` | integer | No* | Override tool count |
| `total_success` | integer | No* | Override success count |
| `total_errors` | integer | No* | Override error count |

*At least one field is required.

**WebSocket event:** `session.ended` on channel `global` (when `ended_at` is set)

---

### DELETE /api/sessions/:id

Delete a session.

```bash
curl -X DELETE http://localhost:3847/api/sessions/20250615_143000_abc123
```

**Response:** `204 No Content`

**WebSocket event:** `session.deleted` on channel `global`

---

## Routing Intelligence

The routing system learns which tools work best for given keywords. It builds a weighted keyword-to-tool mapping that improves over time.

### GET /api/routing/suggest

Suggest tools based on keywords. Returns matches sorted by keyword match count, then by score, then by usage.

```bash
curl "http://localhost:3847/api/routing/suggest?keywords=database,migration,schema&limit=5&tool_type=agent"
```

**Query parameters:**

| Param | Type | Required | Default | Description |
|---|---|---|---|---|
| `keywords` | string | Yes | - | Comma-separated keywords |
| `limit` | integer | No | 10 | Max suggestions (capped at 50) |
| `min_score` | float | No | 0.5 | Minimum score threshold |
| `tool_type` | enum | No | - | Filter by type: `builtin`, `agent`, `skill`, `command`, `mcp` |

**Response `200`:**

```json
{
  "keywords": ["database", "migration", "schema"],
  "suggestions": [
    {
      "tool_name": "database-admin",
      "tool_type": "agent",
      "score": 3.2,
      "usage_count": 45,
      "success_rate": 93,
      "keyword_matches": ["database", "migration", "schema"]
    },
    {
      "tool_name": "migration-specialist",
      "tool_type": "agent",
      "score": 2.8,
      "usage_count": 22,
      "success_rate": 91,
      "keyword_matches": ["migration", "schema"]
    }
  ],
  "count": 2,
  "compat_output": "database-admin|agent|3.2\nmigration-specialist|agent|2.8"
}
```

---

### GET /api/routing/stats

Overall routing intelligence statistics.

```bash
curl http://localhost:3847/api/routing/stats
```

**Response `200`:**

```json
{
  "totals": {
    "total_records": 1250,
    "unique_keywords": 340,
    "unique_tools": 68,
    "avg_score": 1.45,
    "avg_usage": 3.7
  },
  "top_by_score": [
    {"tool_name": "Read", "tool_type": "builtin", "avg_score": 3.8}
  ],
  "top_by_usage": [
    {"tool_name": "Read", "tool_type": "builtin", "total_usage": 892}
  ],
  "type_distribution": [
    {"tool_type": "builtin", "tool_count": 8},
    {"tool_type": "agent", "tool_count": 42}
  ]
}
```

---

### POST /api/routing/feedback

Submit feedback on a routing suggestion. Positive feedback (`chosen: true`) increases the score by 0.2; negative feedback decreases it by 0.1. Scores are clamped between 0.1 and 5.0.

```bash
curl -X POST http://localhost:3847/api/routing/feedback \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "database-admin",
    "keywords": ["database", "migration"],
    "chosen": true
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `tool_name` | string | Yes | The tool being rated |
| `keywords` | string[] | Yes | Keywords associated with the suggestion |
| `chosen` | boolean | Yes | `true` = user chose this tool, `false` = rejected |

**Response `200`:**

```json
{
  "success": true,
  "message": "Updated 2 keyword scores for database-admin",
  "adjustment": 0.2
}
```

---

## Messages (Inter-Agent Pub/Sub)

Agents communicate through a message bus. Messages have topics, priorities, and time-to-live. Expired messages are automatically cleaned up.

### POST /api/messages

Publish a message. Set `to_agent` to `null` for broadcasts.

```bash
curl -X POST http://localhost:3847/api/messages \
  -H "Content-Type: application/json" \
  -d '{
    "from_agent": "project-supervisor",
    "to_agent": "backend-laravel",
    "topic": "task.created",
    "content": {"task_id": "b2c3d4e5-...", "description": "Create User model"},
    "priority": 5,
    "ttl_seconds": 3600
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `from_agent` | string | Yes | Sender agent ID |
| `to_agent` | string/null | No | Recipient agent ID. `null` = broadcast to all. |
| `topic` | enum | Yes | See valid topics below |
| `content` | object/string | Yes | Message payload |
| `priority` | integer | No | 0-10 (higher = more urgent). Default: `0` |
| `ttl_seconds` | integer | No | Time-to-live in seconds (1-86400). Default: `3600` |
| `project_id` | UUID | No | Associated project |

**Valid topics:**

| Topic | Description |
|---|---|
| `task.created` | New task assigned |
| `task.completed` | Task finished successfully |
| `task.failed` | Task failed |
| `context.request` | Requesting context from another agent |
| `context.response` | Responding with context data |
| `alert.blocking` | Agent is blocked |
| `agent.heartbeat` | Agent liveness signal |
| `workflow.progress` | Workflow progress update |

**Response `201`:**

```json
{
  "success": true,
  "message": {
    "id": "e5f6a7b8-...",
    "from_agent": "project-supervisor",
    "to_agent": "backend-laravel",
    "topic": "task.created",
    "priority": 5,
    "created_at": "2025-06-15T14:30:00.000Z",
    "expires_at": "2025-06-15T15:30:00.000Z",
    "is_broadcast": false
  }
}
```

**WebSocket events:**
- `message.new` on channel `global`
- `message.new` on channel `agents/{to_agent}` (if targeted)

---

### GET /api/messages

List all messages across all agents (dashboard endpoint). Returns messages ordered by creation date, newest first.

```bash
curl "http://localhost:3847/api/messages?limit=50&offset=0"
```

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 100 | Max results (capped at 100) |
| `offset` | integer | 0 | Pagination offset |

**Response `200`:**

```json
{
  "messages": [ ... ],
  "count": 64,
  "limit": 50,
  "offset": 0
}
```

---

### GET /api/messages/:agent_id

Retrieve messages for an agent. Messages are automatically marked as read upon retrieval.

```bash
curl "http://localhost:3847/api/messages/backend-laravel?topic=task.created&limit=10"
```

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `since` | ISO datetime | - | Only messages after this timestamp |
| `topic` | string | - | Filter by topic |
| `include_broadcasts` | `true`/`false` | `true` | Include broadcast messages |
| `limit` | integer | 100 | Max results (capped at 1000) |

**Response `200`:**

```json
{
  "agent_id": "backend-laravel",
  "messages": [
    {
      "id": "e5f6a7b8-...",
      "from_agent": "project-supervisor",
      "to_agent": "backend-laravel",
      "topic": "task.created",
      "content": {"task_id": "b2c3d4e5-...", "description": "Create User model"},
      "priority": 5,
      "is_broadcast": false,
      "already_read": false,
      "created_at": "2025-06-15T14:30:00.000Z",
      "expires_at": "2025-06-15T15:30:00.000Z"
    }
  ],
  "count": 1,
  "unread_remaining": 3
}
```

---

## Subscriptions

Agents subscribe to topics to receive targeted notifications.

### POST /api/subscribe

Subscribe an agent to a topic. Uses upsert: re-subscribing updates the callback URL.

```bash
curl -X POST http://localhost:3847/api/subscribe \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "backend-laravel",
    "topic": "task.created"
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `agent_id` | string | Yes | Agent identifier |
| `topic` | enum | Yes | One of the valid message topics |
| `callback_url` | URL | No | Optional webhook URL for notifications |

**Response `201`:**

```json
{
  "success": true,
  "subscription": {
    "id": "f6a7b8c9-...",
    "agent_id": "backend-laravel",
    "topic": "task.created",
    "callback_url": null,
    "created_at": "2025-06-15T14:30:00.000Z",
    "updated_at": "2025-06-15T14:30:00.000Z"
  }
}
```

---

### GET /api/subscriptions

List all subscriptions with optional filters.

```bash
curl "http://localhost:3847/api/subscriptions?agent_id=backend-laravel"
```

**Query parameters:**

| Param | Type | Description |
|---|---|---|
| `agent_id` | string | Filter by agent |
| `topic` | string | Filter by topic |

**Response `200`:**

```json
{
  "subscriptions": [
    {
      "id": "f6a7b8c9-...",
      "agent_id": "backend-laravel",
      "topic": "task.created",
      "callback_url": null,
      "created_at": "...",
      "updated_at": "..."
    }
  ],
  "count": 1
}
```

---

### GET /api/subscriptions/:agent_id

Get all subscriptions for a specific agent.

```bash
curl http://localhost:3847/api/subscriptions/backend-laravel
```

**Response `200`:**

```json
{
  "agent_id": "backend-laravel",
  "subscriptions": [ ... ],
  "topics": ["task.created", "task.completed"],
  "count": 2
}
```

---

### DELETE /api/subscriptions/:id

Remove a subscription by its ID.

```bash
curl -X DELETE http://localhost:3847/api/subscriptions/f6a7b8c9-...
```

**Response `200`:**

```json
{
  "success": true,
  "deleted": {
    "id": "f6a7b8c9-...",
    "agent_id": "backend-laravel",
    "topic": "task.created"
  }
}
```

**Error codes:** `404` subscription not found

---

### POST /api/unsubscribe

Remove a subscription by agent ID and topic (alternative to delete by ID).

```bash
curl -X POST http://localhost:3847/api/unsubscribe \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "backend-laravel",
    "topic": "task.created"
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `agent_id` | string | Yes | Agent identifier |
| `topic` | string | Yes | Topic to unsubscribe from |

**Response `200`:**

```json
{
  "success": true,
  "deleted": {
    "id": "f6a7b8c9-...",
    "agent_id": "backend-laravel",
    "topic": "task.created"
  }
}
```

---

## Blocking (Coordination)

The blocking system prevents agents from running concurrently when they would conflict. An agent can block another agent, and the blocked agent should wait before proceeding.

### POST /api/blocking

Block an agent. Uses upsert: blocking an already-blocked pair updates the reason.

```bash
curl -X POST http://localhost:3847/api/blocking \
  -H "Content-Type: application/json" \
  -d '{
    "blocked_by": "database-admin",
    "blocked_agent": "backend-laravel",
    "reason": "Migration in progress, wait for schema changes"
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `blocked_by` | string | Yes | Agent doing the blocking |
| `blocked_agent` | string | Yes | Agent being blocked (cannot be same as `blocked_by`) |
| `reason` | string | No | Human-readable explanation (max 500 chars) |

**Response `201`:**

```json
{
  "success": true,
  "blocking": {
    "id": "a7b8c9d0-...",
    "blocked_by": "database-admin",
    "blocked_agent": "backend-laravel",
    "reason": "Migration in progress, wait for schema changes",
    "created_at": "2025-06-15T14:30:00.000Z"
  }
}
```

**WebSocket event:** `agent.blocked` on channel `agents/{blocked_agent}`

**Error codes:** `400` self-blocking or validation failure

---

### GET /api/blocking/:agent_id

Get all blocking relationships for an agent (both directions: who blocks them, and who they block).

```bash
curl http://localhost:3847/api/blocking/backend-laravel
```

**Response `200`:**

```json
{
  "agent_id": "backend-laravel",
  "is_blocked": true,
  "blocked_by": [
    {
      "id": "a7b8c9d0-...",
      "by_agent": "database-admin",
      "reason": "Migration in progress",
      "since": "2025-06-15T14:30:00.000Z"
    }
  ],
  "is_blocking": false,
  "blocking": [],
  "summary": {
    "blocked_by_count": 1,
    "blocking_count": 0
  }
}
```

---

### GET /api/blocking/check

Check whether a specific agent pair has an active block.

```bash
curl "http://localhost:3847/api/blocking/check?blocker=database-admin&blocked=backend-laravel"
```

**Query parameters:**

| Param | Type | Required | Description |
|---|---|---|---|
| `blocker` | string | Yes | The blocking agent |
| `blocked` | string | Yes | The blocked agent |

**Response `200`:**

```json
{
  "blocker": "database-admin",
  "blocked": "backend-laravel",
  "is_blocked": true
}
```

---

### DELETE /api/blocking/:blocked_id

Remove a blocking record by its ID.

```bash
curl -X DELETE http://localhost:3847/api/blocking/a7b8c9d0-...
```

**Response `200`:**

```json
{
  "success": true,
  "unblocked": {
    "id": "a7b8c9d0-...",
    "blocked_by": "database-admin",
    "blocked_agent": "backend-laravel",
    "reason": "Migration in progress"
  }
}
```

**WebSocket event:** `agent.unblocked` on channel `agents/{blocked_agent}`

---

### POST /api/unblock

Remove a blocking record by the agent pair (alternative to delete by ID).

```bash
curl -X POST http://localhost:3847/api/unblock \
  -H "Content-Type: application/json" \
  -d '{
    "blocked_by": "database-admin",
    "blocked_agent": "backend-laravel"
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `blocked_by` | string | Yes | The blocking agent |
| `blocked_agent` | string | Yes | The blocked agent |

**Response `200`:**

```json
{
  "success": true,
  "unblocked": {
    "id": "a7b8c9d0-...",
    "blocked_by": "database-admin",
    "blocked_agent": "backend-laravel",
    "reason": "Migration in progress"
  }
}
```

**WebSocket event:** `agent.unblocked` on channel `agents/{blocked_agent}`

---

## Context

Generate context briefs for agents. Briefs are formatted markdown summaries of the agent's current tasks, messages, and blocking status, ready for injection into a prompt.

### GET /api/context/:agent_id

Get the current context for an agent. Returns either a formatted markdown brief or raw structured data.

```bash
curl "http://localhost:3847/api/context/backend-laravel?format=brief&session_id=20250615_143000_abc123&max_tokens=2000"
```

**Query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `session_id` | string | Auto-detected | Session to pull context from |
| `agent_type` | string | Inferred from ID | Agent role for template selection |
| `format` | `brief`/`raw` | `brief` | `brief` = markdown, `raw` = JSON data |
| `max_tokens` | integer | 2000 | Maximum token budget (100-8000) |
| `include_history` | `true`/`false` | `true` | Include recent action history |
| `include_messages` | `true`/`false` | `true` | Include pending messages |
| `include_blocking` | `true`/`false` | `true` | Include blocking status |
| `history_limit` | integer | 10 | Max history entries (1-50) |

**Response `200` (format=brief):**

```json
{
  "agent_id": "backend-laravel",
  "session_id": "20250615_143000_abc123",
  "agent_type": "backend-laravel",
  "brief": {
    "id": "ctx-abc123",
    "content": "## Context Brief for backend-laravel\n\n### Active Tasks\n- Create User model (running)\n...",
    "token_count": 450,
    "truncated": false,
    "generated_at": "2025-06-15T14:30:00.000Z"
  },
  "sources": ["tasks", "messages", "blocking", "history"]
}
```

**Response `200` (format=raw):**

```json
{
  "agent_id": "backend-laravel",
  "session_id": "20250615_143000_abc123",
  "agent_type": "backend-laravel",
  "data": {
    "tasks": [ ... ],
    "messages": [ ... ],
    "blockings": [ ... ],
    "history": [ ... ],
    "session": { ... },
    "project": { ... }
  },
  "counts": {
    "tasks": 3,
    "messages": 1,
    "blockings": 0,
    "history": 10
  }
}
```

---

### POST /api/context/generate

Generate a context brief on demand with full control over parameters.

```bash
curl -X POST http://localhost:3847/api/context/generate \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "backend-laravel",
    "session_id": "20250615_143000_abc123",
    "agent_type": "backend-laravel",
    "max_tokens": 3000,
    "include_history": true,
    "history_limit": 15
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `agent_id` | string | Yes | Agent identifier |
| `session_id` | string | Yes | Session to pull context from |
| `agent_type` | string | No | Agent role. Inferred from ID if omitted. |
| `max_tokens` | integer | No | Token budget. Default: `2000` |
| `include_history` | boolean | No | Include action history. Default: `true` |
| `history_limit` | integer | No | Max history items. Default: `10` |
| `include_messages` | boolean | No | Include messages. Default: `true` |
| `include_blocking` | boolean | No | Include blocking info. Default: `true` |
| `project_id` | UUID | No | Scope to a specific project |

**Response `201`:**

```json
{
  "success": true,
  "brief": {
    "id": "ctx-def456",
    "agent_id": "backend-laravel",
    "agent_type": "backend-laravel",
    "session_id": "20250615_143000_abc123",
    "content": "## Context Brief ...",
    "token_count": 680,
    "truncated": false,
    "generated_at": "2025-06-15T14:30:00.000Z"
  },
  "sources": ["tasks", "messages", "history"]
}
```

---

## Compact / Restore

Context restoration after a Claude Code `/compact` operation. Allows agents to recover their working context from the database.

### POST /api/compact/restore

Restore context after a compact event. Marks the session as compacted, generates a fresh context brief, and optionally appends the previous compact summary.

```bash
curl -X POST http://localhost:3847/api/compact/restore \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "20250615_143000_abc123",
    "agent_id": "backend-laravel",
    "agent_type": "backend-laravel",
    "compact_summary": "Was working on Wave 2 - user auth. Migration complete, model pending.",
    "max_tokens": 3000
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | Yes | Session being restored |
| `agent_id` | string | Yes | Agent requesting restoration |
| `agent_type` | string | No | Agent role. Default: `developer` |
| `compact_summary` | string | No | Summary from before the compact (appended to brief) |
| `max_tokens` | integer | No | Token budget (100-8000). Default: `2000` |

**Response `200`:**

```json
{
  "success": true,
  "brief": "## Context Brief for backend-laravel\n\n### Active Tasks\n...\n\n---\n## Previous Context Summary\nWas working on Wave 2...",
  "sources": ["tasks", "messages", "blocking", "history"],
  "session_compacted": true,
  "restored_at": "2025-06-15T14:30:00.000Z"
}
```

---

### GET /api/compact/status/:session_id

Check whether a session has been compacted.

```bash
curl http://localhost:3847/api/compact/status/20250615_143000_abc123
```

**Response `200`:**

```json
{
  "session_id": "20250615_143000_abc123",
  "exists": true,
  "compacted": true,
  "compacted_at": "2025-06-15T15:00:00.000Z",
  "compact_summary": "Was working on Wave 2...",
  "compact_agent": "backend-laravel"
}
```

If the session has never been compacted:

```json
{
  "session_id": "20250615_143000_abc123",
  "exists": true,
  "compacted": false,
  "compacted_at": null,
  "compact_summary": null,
  "compact_agent": null
}
```

---

### POST /api/compact/save

Save a pre-compact context snapshot. Called by the PreCompact hook before Claude auto-compacts.

```bash
curl -X POST http://localhost:3847/api/compact/save \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "abc-123",
    "trigger": "auto",
    "context_summary": "Working on authentication module...",
    "active_tasks": [
      {"id": "1", "description": "Implement login", "status": "in_progress"}
    ],
    "modified_files": ["src/auth.ts", "src/routes.ts"],
    "key_decisions": ["Using JWT over session cookies"],
    "agent_states": [
      {"agent_id": "backend-1", "agent_type": "backend-laravel", "status": "running", "summary": "Creating auth controller"}
    ]
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `session_id` | string | Yes | Session identifier |
| `trigger` | `"auto" \| "manual" \| "proactive"` | No | What triggered the save (default: `auto`) |
| `context_summary` | string | No | Brief summary of current work |
| `active_tasks` | array | No | List of active tasks with id, description, status, agent_type |
| `modified_files` | string[] | No | Files modified in this session |
| `key_decisions` | string[] | No | Important decisions made |
| `agent_states` | array | No | Current agent states with agent_id, agent_type, status, summary |

**Response `201`:**

```json
{
  "status": "success",
  "snapshot_id": "uuid",
  "session_id": "abc-123",
  "trigger": "auto"
}
```

Stores in `agent_contexts` table with `agent_type='compact-snapshot'` and `agent_id='compact-snapshot-{session_id}'`. Uses upsert (`ON CONFLICT DO UPDATE`) so each session has at most one snapshot.

---

### GET /api/compact/snapshot/:session_id

Retrieve a saved compact snapshot by session ID.

```bash
curl http://localhost:3847/api/compact/snapshot/abc-123
```

**Response `200`:**

```json
{
  "status": "success",
  "snapshot": {
    "session_id": "abc-123",
    "trigger": "auto",
    "context_summary": "Working on authentication module...",
    "active_tasks": [...],
    "modified_files": [...],
    "key_decisions": [...],
    "agent_states": [...],
    "saved_at": "2025-02-08T10:30:00.000Z"
  }
}
```

**Response `404`:**

```json
{
  "status": "not_found",
  "message": "No compact snapshot found for session abc-123"
}
```

---

## Hierarchy

### GET /api/hierarchy/:project_id

Full hierarchical view of a project: project -> requests -> tasks -> subtasks. Uses a single optimized JOIN query.

```bash
curl http://localhost:3847/api/hierarchy/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

**Response `200`:**

```json
{
  "hierarchy": {
    "id": "a1b2c3d4-...",
    "path": "/home/user/my-project",
    "name": "My Project",
    "created_at": "...",
    "updated_at": "...",
    "metadata": {},
    "requests": [
      {
        "id": "f1e2d3c4-...",
        "session_id": "20250615_143000_abc123",
        "prompt": "Add user authentication",
        "prompt_type": "feature",
        "status": "active",
        "created_at": "...",
        "completed_at": null,
        "metadata": {},
        "tasks": [
          {
            "id": "b2c3d4e5-...",
            "request_id": "f1e2d3c4-...",
            "name": "Wave 0",
            "wave_number": 0,
            "status": "completed",
            "created_at": "...",
            "completed_at": "...",
            "subtasks": [
              {
                "id": "c3d4e5f6-...",
                "task_list_id": "b2c3d4e5-...",
                "task_id": "b2c3d4e5-...",
                "agent_type": "backend-laravel",
                "agent_id": "agent-01",
                "description": "Create migration",
                "status": "completed",
                "blocked_by": null,
                "created_at": "...",
                "started_at": "...",
                "completed_at": "...",
                "result": {}
              }
            ]
          }
        ]
      }
    ]
  },
  "stats": {
    "project_id": "a1b2c3d4-...",
    "total_requests": 5,
    "total_tasks": 12,
    "total_subtasks": 38
  },
  "counts": {
    "requests": 5,
    "tasks": 12,
    "subtasks": 38
  }
}
```

**Error codes:** `400` missing project_id, `404` project not found

---

### GET /api/active-sessions

List currently active agents across all sessions (from the `v_active_agents` database view).

```bash
curl http://localhost:3847/api/active-sessions
```

**Response `200`:**

```json
{
  "active_agents": [
    {
      "agent_id": "agent-backend-01",
      "agent_type": "backend-laravel",
      "session_id": "20250615_143000_abc123",
      "status": "running",
      "started_at": "2025-06-15T14:35:00.000Z"
    }
  ],
  "count": 1
}
```

---

## Authentication

### POST /api/auth/token

Generate an HMAC-SHA256 token for WebSocket authentication. Tokens expire after 1 hour.

```bash
curl -X POST http://localhost:3847/api/auth/token \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "backend-laravel",
    "session_id": "20250615_143000_abc123"
  }'
```

**Request body:**

| Field | Type | Required | Description |
|---|---|---|---|
| `agent_id` | string | Yes | Agent requesting the token |
| `session_id` | string | No | Optional session scope |

**Response `200`:**

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_in": 3600
}
```

**Usage:** Connect to WebSocket with the token as a query parameter:

```bash
wscat -c "ws://localhost:3849?token=eyJhbGciOiJIUzI1NiIs..."
```

**Error codes:** `400` missing agent_id, `500` token generation failure

---

## Cleanup Stats

### GET /api/cleanup/stats

Statistics about automatic message cleanup (expired messages, read messages).

```bash
curl http://localhost:3847/api/cleanup/stats
```

**Response `200`:**

```json
{
  "last_cleanup": {
    "expired_deleted": 12,
    "read_deleted": 5,
    "ran_at": "2025-06-15T14:29:00.000Z"
  },
  "messages": {
    "total": 64,
    "expired": 0,
    "active": 64
  },
  "timestamp": "2025-06-15T14:30:00.000Z"
}
```

---

## Data Model Overview

The API operates on this entity hierarchy:

```
Project
  |-- Session (1:N)
  |-- Request (1:N)
        |-- Task / Wave (1:N)
              |-- Subtask (1:N)
                    |-- Action (1:N)

Messages (agent-to-agent, independent)
Subscriptions (agent-to-topic)
Blocking (agent-to-agent coordination)
Keyword-Tool Scores (routing intelligence)
```

All delete operations cascade: deleting a project removes all its requests, tasks, subtasks, and actions.

---

## WebSocket Events Reference

Events emitted through PostgreSQL LISTEN/NOTIFY and delivered via the WebSocket server on port `3849`:

| Event | Channel | Trigger |
|---|---|---|
| `action.created` | `global` | New action logged |
| `actions.bulk_deleted` | `global` | Bulk action deletion |
| `task.created` | `global` | New task created |
| `task.completed` | `global` | Task completed |
| `task.updated` | `global` | Task status changed |
| `task.deleted` | `global` | Task deleted |
| `subtask.created` | `global`, `agents/{type}` | New subtask created |
| `subtask.completed` | `global`, `agents/{type}` | Subtask completed |
| `subtask.updated` | `global`, `agents/{type}` | Subtask status changed |
| `subtask.deleted` | `global`, `agents/{type}` | Subtask deleted |
| `message.new` | `global`, `agents/{to_agent}` | New message published |
| `agent.blocked` | `agents/{blocked_agent}` | Agent blocked |
| `agent.unblocked` | `agents/{blocked_agent}` | Agent unblocked |
| `session.created` | `global` | New session created |
| `session.ended` | `global` | Session ended |
| `session.deleted` | `global` | Session deleted |
| `project.deleted` | `global` | Project deleted |
| `request.deleted` | `global` | Request deleted |
