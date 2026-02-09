# DCM API Documentation

Complete OpenAPI 3.1 specification and interactive Swagger UI documentation for the Distributed Context Manager API.

## Files

- **`openapi.yaml`** - Complete OpenAPI 3.1 specification with all 77+ endpoints, schemas, and examples
- **`swagger.html`** - Standalone Swagger UI HTML page for interactive API exploration
- **`README.md`** - This file

## Quick Start

### Option 1: View in Browser (Recommended)

Simply open the `swagger.html` file in your web browser:

```bash
# Open directly
open swagger.html  # macOS
xdg-open swagger.html  # Linux
start swagger.html  # Windows

# Or with a specific browser
firefox swagger.html
google-chrome swagger.html
```

**Note:** The HTML file loads the OpenAPI spec from `./openapi.yaml`, so both files must be in the same directory.

### Option 2: Serve via DCM API

If the DCM API server is running, you can access the docs at:

```
http://127.0.0.1:3847/docs/api/swagger.html
```

### Option 3: Use with Swagger Editor

Visit [editor.swagger.io](https://editor.swagger.io) and import the `openapi.yaml` file.

## API Overview

### Base URL
```
http://127.0.0.1:3847
```

### Key Endpoints

#### Health & Status
- `GET /health` - Health check with database status
- `GET /stats` - Database statistics

#### Core Resources
- **Projects** (`/api/projects`) - Working directory management
- **Sessions** (`/api/sessions`) - Claude Code session tracking
- **Requests** (`/api/requests`) - User prompts/requests
- **Tasks** (`/api/tasks`) - Task lists (waves)
- **Subtasks** (`/api/subtasks`) - Agent objectives within waves
- **Actions** (`/api/actions`) - Tool invocation tracking

#### Context Management
- **Context** (`/api/context/*`) - Context generation and retrieval
- **Compact** (`/api/compact/*`) - Context compaction operations
- **AgentContexts** (`/api/agent-contexts`) - Agent context management

#### Inter-Agent Communication
- **Messages** (`/api/messages`) - Pub/sub messaging
- **Subscriptions** (`/api/subscribe`, `/api/subscriptions`) - Topic subscriptions
- **Blocking** (`/api/blocking`) - Agent blocking relationships

#### Intelligence & Orchestration
- **Routing** (`/api/routing/*`) - Intelligent tool suggestions
- **Orchestration** (`/api/orchestration/*`) - Batch task orchestration
- **Waves** (`/api/waves/:session_id/*`) - Wave state management
- **Registry** (`/api/registry`) - Agent registry and catalog

#### Advanced Features
- **Tokens** (`/api/tokens/track`, `/api/capacity/*`) - Token consumption tracking
- **Auth** (`/api/auth/token`) - WebSocket authentication tokens
- **Hierarchy** (`/api/hierarchy/:project_id`) - Full project hierarchy view
- **Tools** (`/stats/tools-summary`) - Tool usage statistics

## API Features

### Request/Response Format
- All endpoints accept and return JSON
- Content-Type: `application/json`
- UTF-8 encoding

### Pagination
Most list endpoints support pagination:
- `limit` - Maximum results (default: 100, max: 100)
- `offset` - Skip N results (default: 0)

Example:
```
GET /api/sessions?limit=50&offset=100
```

### Filtering
Many endpoints support query parameter filtering:
```
GET /api/actions?session_id=abc123&limit=20
GET /api/subtasks?status=running&agent_type=backend-laravel
```

### Error Responses

#### 400 Bad Request
```json
{
  "error": "Validation failed",
  "details": {
    "field_name": ["error message"]
  }
}
```

#### 404 Not Found
```json
{
  "error": "Resource not found"
}
```

#### 500 Internal Server Error
```json
{
  "error": "Failed to perform operation",
  "message": "Detailed error message"
}
```

## Common Workflows

### 1. Track a New Session

```bash
# Create or get project
POST /api/projects
{
  "path": "/home/user/my-project",
  "name": "My Project"
}

# Create session
POST /api/sessions
{
  "id": "session-uuid",
  "project_id": "project-uuid"
}

# Track actions
POST /api/actions
{
  "tool_name": "Read",
  "tool_type": "builtin",
  "session_id": "session-uuid"
}
```

### 2. Context Compact Recovery

```bash
# Before compact (PreCompact hook)
POST /api/compact/save
{
  "session_id": "session-uuid",
  "trigger": "auto",
  "context_summary": "Summary of current work..."
}

# After compact (SessionStart hook)
POST /api/compact/restore
{
  "session_id": "session-uuid",
  "agent_id": "agent-uuid",
  "agent_type": "developer"
}
```

### 3. Inter-Agent Messaging

```bash
# Subscribe to topic
POST /api/subscribe
{
  "agent_id": "backend-agent",
  "topic": "task.completed"
}

# Publish message
POST /api/messages
{
  "from_agent": "frontend-agent",
  "to_agent": "backend-agent",
  "topic": "task.completed",
  "content": {"status": "success", "result": {...}}
}

# Get messages
GET /api/messages/backend-agent?session_id=session-uuid
```

### 4. Batch Orchestration

```bash
# Submit batch
POST /api/orchestration/batch-submit
{
  "session_id": "session-uuid",
  "wave_number": 1,
  "tasks": [
    {
      "description": "Implement user authentication",
      "agent_type": "backend-laravel",
      "task_id": "task-uuid"
    }
  ]
}

# Check batch status
GET /api/orchestration/batch/{batch_id}

# Complete batch
POST /api/orchestration/batch/{batch_id}/complete
{
  "results": [...]
}
```

## Testing with curl

### Health Check
```bash
curl http://127.0.0.1:3847/health
```

### Create Project
```bash
curl -X POST http://127.0.0.1:3847/api/projects \
  -H "Content-Type: application/json" \
  -d '{"path": "/home/user/test-project", "name": "Test Project"}'
```

### List Sessions
```bash
curl http://127.0.0.1:3847/api/sessions?limit=10
```

### Track Action
```bash
curl -X POST http://127.0.0.1:3847/api/actions \
  -H "Content-Type: application/json" \
  -d '{
    "tool_name": "Read",
    "tool_type": "builtin",
    "session_id": "test-session"
  }'
```

## Authentication

Currently, the DCM API does not require authentication for HTTP endpoints.

For WebSocket connections, obtain a token from:
```bash
POST /api/auth/token
{
  "agent_id": "my-agent"
}
```

Rate limit: 10 requests per 15 minutes.

## WebSocket API

WebSocket server runs on port **3849** (ws://127.0.0.1:3849).

### Connection Flow
1. Get auth token from `POST /api/auth/token`
2. Connect to ws://127.0.0.1:3849
3. Send auth message with token
4. Subscribe to channels
5. Receive real-time events

See the main documentation for full WebSocket protocol details.

## Development

### Validating the OpenAPI Spec

```bash
# Using swagger-cli
npx @apidevtools/swagger-cli validate openapi.yaml

# Using openapi-generator
npx @openapitools/openapi-generator-cli validate -i openapi.yaml
```

### Generating Client SDKs

```bash
# Generate TypeScript client
npx @openapitools/openapi-generator-cli generate \
  -i openapi.yaml \
  -g typescript-axios \
  -o ./generated/typescript

# Generate Python client
npx @openapitools/openapi-generator-cli generate \
  -i openapi.yaml \
  -g python \
  -o ./generated/python
```

## API Tags

All endpoints are organized by functional tags:

- **Health** - Service health and status
- **Dashboard** - KPI aggregations
- **Projects** - Project management
- **Sessions** - Session tracking
- **Requests** - User requests
- **Tasks** - Task waves
- **Subtasks** - Agent objectives
- **Actions** - Tool tracking
- **Routing** - Intelligent routing
- **Context** - Context management
- **Compact** - Compaction operations
- **Messages** - Inter-agent messaging
- **Subscriptions** - Topic subscriptions
- **Blocking** - Agent blocking
- **AgentContexts** - Agent contexts
- **Hierarchy** - Hierarchical views
- **Tokens** - Token tracking
- **Registry** - Agent registry
- **Orchestration** - Batch orchestration
- **Waves** - Wave management
- **Auth** - Authentication
- **Tools** - Tool statistics
- **Cleanup** - Cleanup stats

## Resources

- [DCM GitHub Repository](https://github.com/ronylicha/Claude-DCM)
- [DCM Dashboard](http://127.0.0.1:3848)
- [OpenAPI 3.1 Specification](https://spec.openapis.org/oas/v3.1.0)
- [Swagger UI Documentation](https://swagger.io/tools/swagger-ui/)

## Support

For issues, questions, or contributions, please visit the GitHub repository or open an issue.

## License

MIT License - See LICENSE file in the repository root.
