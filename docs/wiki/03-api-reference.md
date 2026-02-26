# API Reference Summary

This document provides a comprehensive overview of all DCM API endpoints grouped by domain. For full OpenAPI specification, see `docs/openapi.yaml`.

## Base URL

```
http://127.0.0.1:3847
```

## Common Patterns

### Request Format

All POST/PUT/PATCH endpoints expect JSON:
```bash
curl -X POST http://127.0.0.1:3847/api/endpoint \
  -H "Content-Type: application/json" \
  -d '{"field": "value"}'
```

### Response Format

Successful responses (2xx):
```json
{
  "id": "uuid",
  "field": "value",
  "created_at": "2026-02-09T10:30:00.000Z"
}
```

Error responses (4xx, 5xx):
```json
{
  "error": "Error description",
  "message": "Detailed message",
  "code": "ERROR_CODE"
}
```

### Pagination

List endpoints support pagination via query parameters:
```
GET /api/endpoint?limit=50&offset=100
```

Response includes total count:
```json
{
  "items": [...],
  "total": 1234,
  "limit": 50,
  "offset": 100
}
```

### Filtering

Many endpoints support filtering:
```
GET /api/actions?session_id=abc123&tool_type=builtin
GET /api/messages?agent_id=backend-laravel&limit=20
```

## Health & Status

### GET /health

**Description:** System health check

**Response:**
```json
{
  "status": "healthy|unhealthy",
  "timestamp": "2026-02-09T10:30:00.000Z",
  "version": "3.0.0",
  "database": {
    "healthy": true,
    "latency_ms": 2
  },
  "features": {
    "phase1": "active",
    "phase2": "active",
    ...
  }
}
```

### GET /stats

**Description:** Database statistics

**Response:**
```json
{
  "projects": 5,
  "sessions": 123,
  "requests": 456,
  "tasks": 789,
  "subtasks": 1234,
  "actions": 5678,
  "messages": 234,
  "agent_contexts": 45,
  "timestamp": "2026-02-09T10:30:00.000Z"
}
```

## Projects API

Projects are root containers identified by working directory path.

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/projects | Create a new project |
| GET | /api/projects | List all projects |
| GET | /api/projects/:id | Get project by ID |
| GET | /api/projects/by-path | Get project by path (query: ?path=/abs/path) |
| DELETE | /api/projects/:id | Delete project (cascades to all child data) |

### POST /api/projects

**Body:**
```json
{
  "path": "/home/user/project",
  "name": "My Project",
  "metadata": {
    "language": "typescript",
    "framework": "next.js"
  }
}
```

**Response:**
```json
{
  "id": "uuid",
  "path": "/home/user/project",
  "name": "My Project",
  "created_at": "2026-02-09T10:30:00.000Z",
  "metadata": {...}
}
```

## Requests API

User prompts/requests within a project.

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/requests | Create a new request |
| GET | /api/requests | List all requests |
| GET | /api/requests/:id | Get request by ID |
| PATCH | /api/requests/:id | Update request (status, completed_at) |
| DELETE | /api/requests/:id | Delete request |

### POST /api/requests

**Body:**
```json
{
  "project_id": "uuid",
  "session_id": "session-abc123",
  "prompt": "Add authentication to the app",
  "prompt_type": "feature"
}
```

## Tasks API

Task lists (waves) within a request.

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/tasks | Create a new task list |
| GET | /api/tasks | List all tasks |
| GET | /api/tasks/:id | Get task by ID |
| PATCH | /api/tasks/:id | Update task (status, completed_at) |
| DELETE | /api/tasks/:id | Delete task |

### POST /api/tasks

**Body:**
```json
{
  "request_id": "uuid",
  "name": "Authentication Implementation",
  "wave_number": 1,
  "status": "pending"
}
```

## Subtasks API

Individual objectives assigned to agents.

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/subtasks | Create a new subtask |
| GET | /api/subtasks | List all subtasks |
| GET | /api/subtasks/:id | Get subtask by ID |
| PATCH | /api/subtasks/:id | Update subtask (status, result, blocked_by) |
| POST | /api/subtasks/close-session | Close all subtasks for a session |
| DELETE | /api/subtasks/:id | Delete subtask |

### POST /api/subtasks

**Body:**
```json
{
  "task_list_id": "uuid",
  "agent_type": "backend-laravel",
  "agent_id": "backend-laravel-123",
  "description": "Create User model and migration",
  "status": "pending"
}
```

### PATCH /api/subtasks/:id

**Body:**
```json
{
  "status": "completed",
  "result": {
    "files_created": ["app/Models/User.php"],
    "success": true
  }
}
```

## Actions API

Tool invocations with compressed input/output.

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/actions | Record a tool invocation |
| GET | /api/actions | List actions with pagination |
| GET | /api/actions/hourly | Get hourly action statistics |
| DELETE | /api/actions/:id | Delete action |
| DELETE | /api/actions/by-session/:session_id | Delete all actions for session |

### POST /api/actions

**Body:**
```json
{
  "subtask_id": "uuid",
  "tool_name": "Write",
  "tool_type": "builtin",
  "input": "base64-encoded-compressed",
  "output": "base64-encoded-compressed",
  "file_paths": ["/path/to/file.ts"],
  "exit_code": 0,
  "duration_ms": 45
}
```

### GET /api/actions

**Query params:**
- `limit` (default: 100, max: 500)
- `offset` (default: 0)
- `session_id` (filter by session)

**Response:**
```json
{
  "actions": [
    {
      "id": "uuid",
      "tool_name": "Write",
      "tool_type": "builtin",
      "exit_code": 0,
      "duration_ms": 45,
      "file_paths": ["/path/to/file.ts"],
      "created_at": "2026-02-09T10:30:00.000Z"
    }
  ],
  "total": 1234
}
```

## Routing API

Intelligent tool suggestion based on keywords.

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/routing/suggest | Get tool suggestions for keyword |
| GET | /api/routing/stats | Get routing statistics |
| POST | /api/routing/feedback | Submit feedback on suggestion |

### GET /api/routing/suggest

**Query params:**
- `keyword` (required): Search keyword
- `limit` (default: 5): Max suggestions

**Response:**
```json
{
  "suggestions": [
    {
      "tool_name": "Read",
      "tool_type": "builtin",
      "score": 0.95
    },
    {
      "tool_name": "Grep",
      "tool_type": "builtin",
      "score": 0.87
    }
  ]
}
```

### POST /api/routing/feedback

**Body:**
```json
{
  "keyword": "read file",
  "tool_name": "Read",
  "successful": true
}
```

## Sessions API

Claude Code sessions with statistics.

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/sessions | Create a new session |
| GET | /api/sessions | List all sessions |
| GET | /api/sessions/:id | Get session by ID |
| GET | /api/sessions/stats | Get session statistics |
| PATCH | /api/sessions/:id | Update session (ended_at, total_tools_used) |
| DELETE | /api/sessions/:id | Delete session |

### POST /api/sessions

**Body:**
```json
{
  "id": "session-abc123",
  "project_id": "uuid",
  "started_at": "2026-02-09T10:00:00.000Z"
}
```

## Messages API

Inter-agent pub/sub messaging.

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/messages | Send a message |
| GET | /api/messages | List all messages |
| GET | /api/messages/:agent_id | Get messages for agent |

### POST /api/messages

**Body:**
```json
{
  "from_agent_id": "backend-laravel",
  "to_agent_id": "frontend-react",
  "topic": "api_endpoint_created",
  "payload": {
    "endpoint": "/api/users",
    "method": "GET",
    "response_type": "User[]"
  },
  "priority": 5,
  "expires_at": "2026-02-09T11:00:00.000Z"
}
```

**Broadcast (to_agent_id = null):**
```json
{
  "from_agent_id": "orchestrator",
  "to_agent_id": null,
  "topic": "wave_transition",
  "payload": {
    "from_wave": 1,
    "to_wave": 2
  }
}
```

## Subscriptions API

Topic-based subscriptions for agents.

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/subscribe | Subscribe to a topic |
| GET | /api/subscriptions | List all subscriptions |
| GET | /api/subscriptions/:agent_id | Get agent's subscriptions |
| DELETE | /api/subscriptions/:id | Delete subscription |
| POST | /api/unsubscribe | Unsubscribe from topic |

### POST /api/subscribe

**Body:**
```json
{
  "agent_id": "frontend-react",
  "topic": "api_endpoint_created"
}
```

## Blocking API

Agent dependency management.

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/blocking | Block an agent |
| GET | /api/blocking/check | Check if agent is blocked (query: ?agent_id=...) |
| GET | /api/blocking/:agent_id | Get blocking relationships |
| DELETE | /api/blocking/:blocked_id | Delete blocking |
| POST | /api/unblock | Unblock an agent |

### POST /api/blocking

**Body:**
```json
{
  "blocking_agent_id": "backend-laravel",
  "blocked_agent_id": "frontend-react",
  "reason": "API endpoints not ready"
}
```

## Context API

Context brief generation and retrieval.

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/context/:agent_id | Get context for agent |
| POST | /api/context/generate | Generate context brief on demand |

### GET /api/context/:agent_id

**Query params:**
- `session_id` (required)
- `format` (default: brief): "brief" or "raw"
- `max_tokens` (default: 2000)
- `include_history` (default: true)
- `include_messages` (default: true)
- `include_blocking` (default: true)

**Response (brief):**
```json
{
  "id": "uuid",
  "agent_id": "backend-laravel",
  "agent_type": "backend-laravel",
  "session_id": "session-abc123",
  "brief": "# Context Brief for backend-laravel\n\n## Active Tasks\n...",
  "token_count": 1234,
  "sources": [
    {"type": "task", "id": "uuid", "relevance": 1.0},
    {"type": "message", "id": "uuid", "relevance": 0.8}
  ],
  "generated_at": "2026-02-09T10:30:00.000Z",
  "truncated": false
}
```

## Compact API

Context save/restore for compaction events.

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/compact/save | Save context snapshot before compact |
| POST | /api/compact/restore | Restore context after compact |
| GET | /api/compact/status/:session_id | Check if session is compacted |
| GET | /api/compact/snapshot/:session_id | Get saved snapshot |

### POST /api/compact/save

**Body:**
```json
{
  "session_id": "session-abc123",
  "trigger": "auto|manual|proactive",
  "context_summary": "Working on authentication feature",
  "active_tasks": ["uuid1", "uuid2"],
  "modified_files": ["/path/to/file.ts"],
  "key_decisions": ["Using JWT for auth"],
  "agent_states": {
    "backend-laravel": {
      "status": "running",
      "progress": "50%"
    }
  }
}
```

**Response:**
```json
{
  "id": "uuid",
  "saved_at": "2026-02-09T10:30:00.000Z"
}
```

### POST /api/compact/restore

**Body:**
```json
{
  "session_id": "session-abc123",
  "agent_id": "orchestrator",
  "agent_type": "orchestrator",
  "max_tokens": 2000
}
```

**Response:**
```json
{
  "additionalContext": "# Restored Context\n\n## Session Summary\n..."
}
```

## Dashboard API

Aggregated metrics for dashboard.

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/dashboard/kpis | Get all KPIs |

### GET /api/dashboard/kpis

**Response:**
```json
{
  "sessions": {
    "total": 123,
    "active": 5,
    "avg_duration_minutes": 45
  },
  "actions_24h": {
    "total": 5678,
    "success_rate": 0.95,
    "by_type": {
      "builtin": 3456,
      "agent": 1234,
      "skill": 789,
      "mcp": 199
    }
  },
  "agents": {
    "total_contexts": 45,
    "active_agents": 8,
    "by_type": {
      "backend-laravel": 3,
      "frontend-react": 2,
      "tech-lead": 1
    }
  },
  "subtasks": {
    "running": 12,
    "completed": 234,
    "failed": 5,
    "blocked": 2
  },
  "routing": {
    "total_keywords": 456,
    "total_tools": 123,
    "avg_score": 0.87
  }
}
```

## Agent Registry API

Agent catalog and enrichment.

| Method | Route | Description |
|--------|-------|-------------|
| GET | /api/registry | List all registered agents |
| GET | /api/registry/:agent_type | Get one agent scope |
| PUT | /api/registry/:agent_type | Upsert agent scope |
| POST | /api/registry/import | Bulk import agents |
| POST | /api/registry/enrich-context | Generate enriched context |
| GET | /api/registry/catalog | Get static catalog |

### GET /api/registry/catalog

**Response:**
```json
{
  "agents": [
    {
      "type": "backend-laravel",
      "name": "Laravel Backend Developer",
      "scope": "API, models, migrations, controllers",
      "skills": ["eloquent", "artisan", "tinker"]
    }
  ],
  "skills": [
    {
      "name": "clean-code",
      "category": "code-quality",
      "description": "Code review and refactoring"
    }
  ],
  "total_agents": 66,
  "total_skills": 226
}
```

## Orchestration API

Task decomposition and batch management.

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/orchestration/batch-submit | Submit batch of tasks |
| POST | /api/orchestration/batch/:id/complete | Complete batch |
| GET | /api/orchestration/batch/:id | Get batch status |
| GET | /api/orchestration/synthesis/:id | Get synthesis only |
| GET | /api/orchestration/conflicts/:id | Analyze conflicts |
| POST | /api/orchestration/craft-prompt | Craft scoped prompt |
| POST | /api/orchestration/decompose | Decompose task |

### POST /api/orchestration/decompose

**Body:**
```json
{
  "task_description": "Add user authentication",
  "context": {
    "stack": "Laravel + React",
    "current_features": ["user registration"]
  }
}
```

**Response:**
```json
{
  "subtasks": [
    {
      "agent_type": "backend-laravel",
      "description": "Create authentication routes",
      "wave": 1
    },
    {
      "agent_type": "frontend-react",
      "description": "Build login form component",
      "wave": 2
    }
  ]
}
```

## Wave Management API

Wave lifecycle management.

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/waves/:session_id/create | Create new wave |
| POST | /api/waves/:session_id/start | Start wave |
| POST | /api/waves/:session_id/transition | Transition to next wave |
| GET | /api/waves/:session_id/current | Get current wave |
| GET | /api/waves/:session_id/history | Get wave history |

### POST /api/waves/:session_id/create

**Body:**
```json
{
  "name": "Database Layer",
  "description": "Migrations, models, seeders"
}
```

## Token Tracking API

Context capacity monitoring.

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/tokens/track | Record token consumption (fire-and-forget) |
| GET | /api/capacity/:agent_id | Get capacity status |
| POST | /api/capacity/:agent_id/reset | Reset after compact |
| GET | /api/context/health/:agent_id | Combined health check |

### POST /api/tokens/track

**Body:**
```json
{
  "agent_id": "backend-laravel",
  "tokens_in": 1234,
  "tokens_out": 5678,
  "session_id": "session-abc123"
}
```

**Response:** 200 OK (< 5ms)

## Auth Token API

WebSocket authentication tokens.

| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/token | Generate WebSocket auth token |

### POST /api/auth/token

**Rate limit:** 10 requests per 15 minutes

**Body:**
```json
{
  "agent_id": "backend-laravel",
  "session_id": "session-abc123"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 3600
}
```

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| INVALID_INPUT | 400 | Request validation failed |
| NOT_FOUND | 404 | Resource not found |
| CONFLICT | 409 | Resource already exists |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Server error |
| DB_ERROR | 500 | Database operation failed |
| TIMEOUT | 504 | Request timeout |

## Rate Limits

| Endpoint | Limit | Window |
|----------|-------|--------|
| POST /api/auth/token | 10 | 15 minutes |
| All other endpoints | None | - |

## Next Steps

- [04-hooks-system.md](./04-hooks-system.md) - How hooks call these APIs
- [09-websocket.md](./09-websocket.md) - Real-time event streaming
- Full OpenAPI spec: `docs/openapi.yaml`

---

**API Version:** 3.0.0 (All 9 phases implemented)
