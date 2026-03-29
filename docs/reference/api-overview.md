# API Reference Overview

Complete list of all REST endpoints exposed by the DCM API server on port 3847.

**Base URL:** `http://127.0.0.1:3847`
**Transport:** JSON over HTTP
**Authentication:** None required (local-only service). WebSocket auth uses HMAC-SHA256 tokens in production.

For full request/response schemas, see the [OpenAPI spec](../api/openapi.yaml) or the [Swagger UI](../api/swagger.html).

---

## Conventions

| Convention | Detail |
|------------|--------|
| Content-Type | `application/json` for all request and response bodies |
| IDs | UUIDs generated server-side (except session IDs, which are client-provided) |
| Timestamps | ISO 8601 strings (`2026-03-28T14:30:00.000Z`) |
| Pagination | `?limit=` (default 100, max 100) and `?offset=` (default 0) |
| Deletion | Returns `204 No Content` with empty body |
| Creation | Returns `201 Created` with the created resource |

## Error format

```json
{
  "error": "Validation failed",
  "details": {
    "path": ["path is required"]
  }
}
```

| Code | Meaning |
|------|---------|
| 400 | Bad request or validation failure |
| 404 | Resource not found |
| 409 | Conflict (duplicate resource) |
| 429 | Rate limit exceeded (auth endpoint only) |
| 500 | Internal server error |
| 503 | Service unavailable (health check only) |

---

## Health and Stats (3 endpoints)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Service health check. Returns database connectivity, version, and enabled feature phases. Returns 503 if unhealthy. |
| GET | `/stats` | Global row counts across all tables. |
| GET | `/stats/tools-summary` | Counts of skills, commands, workflows, and plugins in `~/.claude`. Cached for 5 minutes. |

---

## Dashboard KPIs (1 endpoint)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dashboard/kpis` | Aggregated KPI metrics. Runs 7 parallel aggregation queries covering actions, sessions, agents, subtasks, and routing. |

---

## Projects (5 endpoints)

Projects represent monitored codebases, identified by their absolute filesystem path.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/projects` | Create or upsert a project. Body: `{path, name?, metadata?}`. |
| GET | `/api/projects` | List all projects with pagination. |
| GET | `/api/projects/by-path` | Look up a project by filesystem path. Query: `?path=`. |
| GET | `/api/projects/:id` | Get a single project with its recent requests and stats. |
| DELETE | `/api/projects/:id` | Delete a project and all associated data (cascade). |

---

## Sessions (6 endpoints)

Sessions represent Claude Code working sessions. The session ID is client-provided.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/sessions` | Create a new session. Body: `{id, project_id?, started_at?}`. |
| GET | `/api/sessions` | List sessions with optional filters: `?project_id=`, `?active_only=`, `?limit=`. |
| GET | `/api/sessions/stats` | Aggregate statistics across all sessions, grouped by project. |
| GET | `/api/sessions/:id` | Get a single session by ID. |
| PATCH | `/api/sessions/:id` | Update session fields (ended_at, tool counts). |
| DELETE | `/api/sessions/:id` | Delete a session. |

---

## Requests (5 endpoints)

User prompts that initiate work within a project.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/requests` | Create a request. Body: `{project_id, session_id, prompt, prompt_type?}`. |
| GET | `/api/requests` | List requests with pagination. |
| GET | `/api/requests/:id` | Get a single request. |
| PATCH | `/api/requests/:id` | Update request status or metadata. |
| DELETE | `/api/requests/:id` | Delete a request. |

---

## Tasks / Waves (5 endpoints)

Waves of objectives for each request. Each task_list represents one wave.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tasks` | Create a task (wave). Body: `{request_id, name?, wave_number?, status?}`. |
| GET | `/api/tasks` | List tasks with pagination. |
| GET | `/api/tasks/:id` | Get a single task. |
| PATCH | `/api/tasks/:id` | Update task status or metadata. |
| DELETE | `/api/tasks/:id` | Delete a task. |

---

## Subtasks (6 endpoints)

Agent assignments within a wave. Each subtask tracks one agent's work.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/subtasks` | Create a subtask. Body: `{task_list_id, agent_type, agent_id?, description}`. |
| POST | `/api/subtasks/close-session` | Close all running subtasks for a session. Body: `{session_id}`. |
| GET | `/api/subtasks` | List subtasks. Filters: `?status=`, `?agent_type=`, `?is_subagent=`, `?batch_id=`. |
| GET | `/api/subtasks/:id` | Get a single subtask. |
| PATCH | `/api/subtasks/:id` | Update subtask status, result, or blocked_by. |
| DELETE | `/api/subtasks/:id` | Delete a subtask. |

---

## Actions (5 endpoints)

Tool invocations recorded from hook scripts. Every Read, Write, Bash, Task, and Skill call is tracked here.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/actions` | Record a tool action. Body: `{tool_name, tool_type, session_id?, input?, exit_code?}`. |
| GET | `/api/actions` | List actions with filters: `?session_id=`, `?tool_type=`, `?limit=`, `?offset=`. |
| GET | `/api/actions/hourly` | Hourly action counts for charting. Filter: `?session_id=`. |
| DELETE | `/api/actions/:id` | Delete a single action. |
| DELETE | `/api/actions/by-session/:session_id` | Delete all actions for a session. |

---

## Messages (4 endpoints)

Inter-agent pub/sub messaging system.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/messages` | Publish a message. Body: `{from_agent_id, to_agent_id?, topic, payload}`. |
| GET | `/api/messages` | List all messages with pagination. |
| GET | `/api/messages/all` | Alias for GET `/api/messages`. |
| GET | `/api/messages/:agent_id` | Get messages for a specific agent. Filter: `?session_id=`. |

---

## Subscriptions (5 endpoints)

Topic subscriptions for inter-agent messaging.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/subscribe` | Subscribe an agent to a topic. Body: `{agent_id, topic}`. |
| POST | `/api/unsubscribe` | Unsubscribe an agent from a topic. Body: `{agent_id, topic}`. |
| GET | `/api/subscriptions` | List all subscriptions. |
| GET | `/api/subscriptions/:agent_id` | List subscriptions for a specific agent. |
| DELETE | `/api/subscriptions/:id` | Delete a subscription by ID. |

---

## Blocking (5 endpoints)

Agent dependency management. Prevents an agent from running until another completes.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/blocking` | Create a blocking relation. Body: `{blocking_agent_id, blocked_agent_id}`. |
| POST | `/api/unblock` | Remove a blocking relation. Body: `{agent_id, unblock_agent_id}`. |
| GET | `/api/blocking/check` | Check if an agent is blocked. Query: `?agent_id=`. |
| GET | `/api/blocking/:agent_id` | List all blocks involving an agent. |
| DELETE | `/api/blocking/:blocked_id` | Delete a blocking relation. |

---

## Routing (3 endpoints)

Intelligent tool suggestion based on keyword-to-tool scoring with feedback.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/routing/suggest` | Suggest tools for a keyword. Query: `?keyword=`, `?limit=`. |
| GET | `/api/routing/stats` | Routing intelligence statistics (total keywords, tools, mappings). |
| POST | `/api/routing/feedback` | Provide success/failure feedback. Body: `{keyword, tool_name, successful}`. |

---

## Hierarchy (2 endpoints)

Full project hierarchy tree views.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/hierarchy/:project_id` | Full hierarchical tree: project -> requests -> tasks -> subtasks. |
| GET | `/api/active-sessions` | List active sessions using the `v_active_agents` view. |

---

## Context (2 endpoints)

Context brief generation for agents.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/context/:agent_id` | Get context brief. Query: `?session_id=`, `?format=brief|raw`, `?max_tokens=`. |
| POST | `/api/context/generate` | Generate a context brief on demand. Body: `{session_id, agent_id, format?}`. |

---

## Compact (6 endpoints)

Context save/restore for compaction events.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/compact/save` | Save a context snapshot before compact. Body: `{session_id, trigger, context_summary?, active_tasks?}`. |
| POST | `/api/compact/restore` | Restore context after compact. Body: `{session_id, agent_id, agent_type?, max_tokens?}`. Returns `{additionalContext}`. |
| GET | `/api/compact/status/:session_id` | Check if a session has been compacted. |
| GET | `/api/compact/snapshot/:session_id` | Get the saved snapshot for a session. |
| GET | `/api/compact/raw-context/:session_id` | Get raw context data for a session (preemptive). |
| POST | `/api/compact/preemptive-summary` | Submit a preemptive context summary. Body: `{session_id, agent_id?, summary, context_tokens_at_trigger?}`. |
| GET | `/api/compact/preemptive/:session_id` | Get a preemptive summary for a session. |

---

## Agent Contexts (2 endpoints)

Agent state snapshots for recovery after compaction.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent-contexts` | List all agent contexts with stats. |
| GET | `/api/agent-contexts/stats` | Context KPI statistics. |

---

## Token Tracking (4 endpoints)

Token consumption monitoring and capacity prediction.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tokens/track` | Record token consumption (fire-and-forget, <5ms). Body: `{agent_id, tokens_in, tokens_out}`. |
| GET | `/api/capacity/:agent_id` | Get capacity status and exhaustion prediction. |
| POST | `/api/capacity/:agent_id/reset` | Reset capacity after a compact event. |
| GET | `/api/context/health/:agent_id` | Combined health, capacity, and recommendation. |

---

## Real-time Token Tracking (3 endpoints)

Real token data from Claude Code statusline (Phase 10).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tokens/realtime` | Receive real token data from statusline. |
| GET | `/api/tokens/projection/:session_id` | Token usage projection (5h/7d). |
| GET | `/api/tokens/calibration/:session_id` | Calibration ratio between real and estimated tokens. |

---

## Agent Registry (6 endpoints)

Agent catalog and scope management.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/registry` | List all registered agents. |
| GET | `/api/registry/catalog` | Static catalog of all known agents, skills, and commands. |
| GET | `/api/registry/:agent_type` | Get scope for a specific agent type. |
| PUT | `/api/registry/:agent_type` | Upsert agent scope definition. |
| POST | `/api/registry/import` | Bulk import agent definitions. Body: `{agents: [...]}`. |
| POST | `/api/registry/enrich-context` | Generate enriched context for an agent type. Body: `{agent_type, session_id?}`. |

---

## Orchestration (7 endpoints)

Batch task submission, synthesis, and conflict detection.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/orchestration/batch-submit` | Submit a batch of tasks. Body: `{session_id, tasks: [...]}`. |
| POST | `/api/orchestration/batch/:id/complete` | Complete a batch and generate synthesis. Body: `{results: [...]}`. |
| GET | `/api/orchestration/batch/:id` | Get batch status and associated subtasks. |
| GET | `/api/orchestration/synthesis/:id` | Get synthesis only (token-optimized). |
| GET | `/api/orchestration/conflicts/:id` | Analyze file conflicts between agents in a batch. |
| POST | `/api/orchestration/craft-prompt` | Craft a scoped prompt for a subagent. |
| POST | `/api/orchestration/decompose` | Decompose a task description into subtasks. |

---

## Wave Management (5 endpoints)

Wave lifecycle management for orchestrated execution.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/waves/:session_id/create` | Create a new wave. Body: `{name?, description?}`. |
| POST | `/api/waves/:session_id/start` | Start a specific wave. Body: `{wave_id}`. |
| POST | `/api/waves/:session_id/transition` | Force transition to the next wave. |
| GET | `/api/waves/:session_id/current` | Get the current active wave. |
| GET | `/api/waves/:session_id/history` | Get all waves for a session. |

---

## Agent Turns and Relaunch (3 endpoints)

Agent turn tracking and automatic relaunch (Phase 10).

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agents/track-turn` | Record an agent turn (for max_turns enforcement). |
| GET | `/api/agents/:agent_id/status` | Get agent status including turn count. |
| POST | `/api/agents/relaunch` | Relaunch an agent that exhausted its turns. |

---

## Cockpit (3 endpoints)

Aggregated control-panel views (Phase 10).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cockpit/global` | Global cockpit data across all sessions. |
| GET | `/api/cockpit/grid` | Grid view of all active agents. |
| GET | `/api/cockpit/:session_id` | Cockpit data for a specific session. |

---

## Orchestrator (3 endpoints)

Global orchestrator status and topology (Phase 11).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/orchestrator/topology` | Orchestrator topology view (inter-project coordination). |
| GET | `/api/orchestrator/status` | Orchestrator operational status. |
| GET | `/api/orchestrator/stats` | Orchestrator statistics. |

---

## Authentication (1 endpoint)

WebSocket token generation.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/token` | Generate an HMAC-SHA256 token for WebSocket auth. Body: `{agent_id, session_id?}`. Rate limited: 10 requests per 15 minutes. |

---

## Cleanup (1 endpoint)

TTL-based message cleanup stats.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cleanup/stats` | Last cleanup run statistics and message counts. |

---

## Endpoint count summary

| Category | Count |
|----------|-------|
| Health and Stats | 3 |
| Dashboard KPIs | 1 |
| Projects | 5 |
| Sessions | 6 |
| Requests | 5 |
| Tasks (Waves) | 5 |
| Subtasks | 6 |
| Actions | 5 |
| Messages | 4 |
| Subscriptions | 5 |
| Blocking | 5 |
| Routing | 3 |
| Hierarchy | 2 |
| Context | 2 |
| Compact | 7 |
| Agent Contexts | 2 |
| Token Tracking | 4 |
| Real-time Tokens | 3 |
| Agent Registry | 6 |
| Orchestration | 7 |
| Wave Management | 5 |
| Agent Turns | 3 |
| Cockpit | 3 |
| Orchestrator | 3 |
| Authentication | 1 |
| Cleanup | 1 |
| **Total** | **102** |
