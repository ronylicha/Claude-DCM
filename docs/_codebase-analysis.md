# DCM Codebase Analysis

**Generated:** 2026-02-09
**Version:** 3.0.0
**Project:** Distributed Context Manager for Claude Code

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [API Endpoints](#api-endpoints)
4. [Database Schema](#database-schema)
5. [Hooks System](#hooks-system)
6. [CLI Commands](#cli-commands)
7. [WebSocket System](#websocket-system)
8. [Dashboard Pages](#dashboard-pages)
9. [Project Structure](#project-structure)

---

## Project Overview

DCM (Distributed Context Manager) is a persistent memory system for Claude Code multi-agent sessions. It provides:

- **Context tracking**: Records every tool call, agent action, and session lifecycle event
- **Compact recovery**: Saves context snapshots before compaction and restores them afterward
- **Cross-agent sharing**: Real-time pub/sub messaging between agents
- **Intelligent routing**: Keyword-based tool suggestion with feedback-driven optimization
- **Real-time monitoring**: WebSocket events and Next.js dashboard

**Tech Stack:**
- Backend: Bun + Hono (HTTP) + Bun native WebSocket
- Database: PostgreSQL 16 with JSONB support
- Frontend: Next.js 16, React 19, Recharts, shadcn/ui
- Validation: Zod v4
- Languages: TypeScript, Bash

**Ports:**
- API Server: `3847`
- WebSocket Server: `3849`
- Dashboard: `3848`
- PostgreSQL: `5432`

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Code Session                          │
│  (Lifecycle hooks: PreCompact, SessionStart, PostToolUse, Stop) │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Bash Hooks
                         │ (curl → API)
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              DCM Services (Bun + PostgreSQL)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  REST API (3847)           WebSocket (3849)                   │
│  ├─ /api/sessions          ├─ Channel subscriptions           │
│  ├─ /api/projects          ├─ Real-time events               │
│  ├─ /api/actions           ├─ HMAC authentication            │
│  ├─ /api/messages          ├─ Message buffering              │
│  ├─ /api/compact/*         └─ LISTEN/NOTIFY bridge           │
│  └─ /api/context/*                                           │
│                                                                 │
│  PostgreSQL (5432)                                             │
│  ├─ 10 Tables (projects, sessions, actions, etc.)            │
│  ├─ 4 Views (v_actions_full, v_active_agents, etc.)          │
│  ├─ JSONB metadata on every table                            │
│  └─ Indexes optimized for common queries                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                         │
                         │ REST + WS
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│         DCM Dashboard (Next.js 16 on 3848)                      │
│                                                                 │
│  ├─ /dashboard      - KPIs, metrics, health                   │
│  ├─ /sessions       - Session browser                         │
│  ├─ /agents         - Agent contexts                          │
│  ├─ /messages       - Inter-agent messaging                   │
│  ├─ /projects       - Project hierarchy                       │
│  ├─ /actions        - Tool usage tracking                     │
│  ├─ /routing        - Intelligent routing                     │
│  ├─ /waves          - Task waves/batches                      │
│  ├─ /registry       - Agent registry                          │
│  ├─ /flows          - Task orchestration                      │
│  └─ /performance    - Performance metrics                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Endpoints

**Source:** `/home/rony/Assets Projets/Claude-DCM/context-manager/src/server.ts` (548 lines)

### Health & Status

| Method | Route | Handler | Query Params | Response |
|--------|-------|---------|--------------|----------|
| GET | `/health` | inline | - | `{status, timestamp, version, database, features}` |
| GET | `/stats` | `getDbStats()` | - | Database statistics |

### Projects API (Phase 3.1)

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| POST | `/api/projects` | `postProject()` | `{path, name, metadata?}` | `{id, path, name, created_at}` |
| GET | `/api/projects` | `getProjects()` | - | `{projects: Project[]}` |
| GET | `/api/projects/:id` | `getProjectById()` | - | `Project` |
| GET | `/api/projects/by-path` | `getProjectByPath()` | `?path=...` | `Project` |
| DELETE | `/api/projects/:id` | `deleteProject()` | - | `{success: boolean}` |

### Requests API (Phase 3.2)

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| POST | `/api/requests` | `postRequest()` | `{project_id, session_id, prompt, prompt_type?}` | `Request` |
| GET | `/api/requests` | `getRequests()` | - | `{requests: Request[]}` |
| GET | `/api/requests/:id` | `getRequestById()` | - | `Request` |
| PATCH | `/api/requests/:id` | `patchRequest()` | `{status?, completed_at?, metadata?}` | `Request` |
| DELETE | `/api/requests/:id` | `deleteRequest()` | - | `{success: boolean}` |

### Tasks API (Phase 3.3)

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| POST | `/api/tasks` | `postTask()` | `{request_id, name, wave_number?, status?}` | `Task` |
| GET | `/api/tasks` | `getTasks()` | - | `{tasks: Task[]}` |
| GET | `/api/tasks/:id` | `getTaskById()` | - | `Task` |
| PATCH | `/api/tasks/:id` | `patchTask()` | `{status?, completed_at?, metadata?}` | `Task` |
| DELETE | `/api/tasks/:id` | `deleteTask()` | - | `{success: boolean}` |

### Subtasks API (Phase 3.4)

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| POST | `/api/subtasks` | `postSubtask()` | `{task_list_id, agent_type, agent_id?, description}` | `Subtask` |
| GET | `/api/subtasks` | `getSubtasks()` | - | `{subtasks: Subtask[]}` |
| GET | `/api/subtasks/:id` | `getSubtaskById()` | - | `Subtask` |
| PATCH | `/api/subtasks/:id` | `patchSubtask()` | `{status?, result?, blocked_by?}` | `Subtask` |
| POST | `/api/subtasks/close-session` | `closeSessionSubtasks()` | `{session_id}` | `{closed: number}` |
| DELETE | `/api/subtasks/:id` | `deleteSubtask()` | - | `{success: boolean}` |

### Actions API (Phase 2) - Tool Tracking

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| POST | `/api/actions` | `postAction()` | `{subtask_id?, tool_name, tool_type, input?, output?, exit_code?, duration_ms?}` | `Action` |
| GET | `/api/actions` | `getActions()` | `?limit=&offset=&session_id=` | `{actions: Action[], total: number}` |
| GET | `/api/actions/hourly` | `getActionsHourly()` | `?session_id=` | `{hourly: HourlyStats[]}` |
| DELETE | `/api/actions/:id` | `deleteAction()` | - | `{success: boolean}` |
| DELETE | `/api/actions/by-session/:session_id` | `deleteActionsBySession()` | - | `{deleted: number}` |

### Routing API (Phase 2)

| Method | Route | Handler | Query Params | Response |
|--------|-------|---------|--------------|----------|
| GET | `/api/routing/suggest` | `suggestRouting()` | `?keyword=&limit=` | `{suggestions: {tool_name, score, type}[]}` |
| GET | `/api/routing/stats` | `getRoutingStats()` | - | `{total_keywords, total_tools, mappings}` |
| POST | `/api/routing/feedback` | `postRoutingFeedback()` | Body: `{keyword, tool_name, successful}` | `{updated: boolean}` |

### Sessions API (Phase 6)

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| POST | `/api/sessions` | `postSession()` | `{id, project_id?, started_at?, total_tools_used?}` | `Session` |
| GET | `/api/sessions` | `getSessions()` | - | `{sessions: Session[]}` |
| GET | `/api/sessions/:id` | `getSessionById()` | - | `Session` |
| GET | `/api/sessions/stats` | `getSessionsStats()` | - | `{total, active, avg_duration}` |
| PATCH | `/api/sessions/:id` | `patchSession()` | `{ended_at?, total_tools_used?}` | `Session` |
| DELETE | `/api/sessions/:id` | `deleteSession()` | - | `{success: boolean}` |

### Messages API (Phase 4) - Pub/Sub

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| POST | `/api/messages` | `postMessage()` | `{from_agent_id, to_agent_id?, topic, payload}` | `{id: uuid, created_at}` |
| GET | `/api/messages` | `getAllMessages()` | `?limit=&offset=` | `{messages: Message[]}` |
| GET | `/api/messages/:agent_id` | `getMessages()` | `?session_id=` | `{messages: Message[]}` |

### Subscriptions API (Phase 4)

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| POST | `/api/subscribe` | `postSubscription()` | `{agent_id, topic}` | `{id: uuid, created_at}` |
| GET | `/api/subscriptions` | `getSubscriptions()` | - | `{subscriptions: Subscription[]}` |
| GET | `/api/subscriptions/:agent_id` | `getAgentSubscriptions()` | - | `{subscriptions: Subscription[]}` |
| DELETE | `/api/subscriptions/:id` | `deleteSubscription()` | - | `{success: boolean}` |
| POST | `/api/unsubscribe` | `postUnsubscribe()` | `{agent_id, topic}` | `{success: boolean}` |

### Blocking API (Phase 4)

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| POST | `/api/blocking` | `postBlocking()` | `{blocking_agent_id, blocked_agent_id}` | `{id: uuid}` |
| GET | `/api/blocking/:agent_id` | `getBlocking()` | - | `{blocking: Block[]}` |
| GET | `/api/blocking/check` | `checkBlocking()` | `?agent_id=` | `{blocked: boolean}` |
| DELETE | `/api/blocking/:blocked_id` | `deleteBlocking()` | - | `{success: boolean}` |
| POST | `/api/unblock` | `postUnblock()` | `{agent_id, unblock_agent_id}` | `{success: boolean}` |

### Hierarchical View API (Phase 3.5)

| Method | Route | Handler | Query Params | Response |
|--------|-------|---------|--------------|----------|
| GET | `/api/hierarchy/:project_id` | `getHierarchy()` | - | `{project, requests, tasks, subtasks}` (nested tree) |
| GET | `/api/active-sessions` | `getActiveSessions()` | - | `{count, active_agents: Agent[]}` |

### Context API (Phase 5)

| Method | Route | Handler | Query Params | Response |
|--------|-------|---------|--------------|----------|
| GET | `/api/context/:agent_id` | `getContext()` | `?session_id=&format=brief\|raw&max_tokens=` | Context brief or full JSON |
| POST | `/api/context/generate` | `postContextGenerate()` | Body: `{session_id, agent_id, format?}` | Generated brief |

### Compact API (Phase 5)

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| POST | `/api/compact/save` | `postCompactSave()` | `{session_id, trigger, context_summary?, active_tasks?}` | `{id: uuid, saved_at}` |
| POST | `/api/compact/restore` | `postCompactRestore()` | `{session_id, agent_id, agent_type?, max_tokens?}` | `{additionalContext: string}` |
| GET | `/api/compact/status/:session_id` | `getCompactStatus()` | - | `{compacted: boolean, snapshot_id?}` |
| GET | `/api/compact/snapshot/:session_id` | `getCompactSnapshot()` | - | Snapshot data |

### Agent Contexts API

| Method | Route | Handler | Query Params | Response |
|--------|-------|---------|--------------|----------|
| GET | `/api/agent-contexts` | `getAgentContexts()` | - | `{contexts: AgentContext[]}` |
| GET | `/api/agent-contexts/stats` | `getAgentContextsStats()` | - | KPI statistics |

### Dashboard API

| Method | Route | Handler | Query Params | Response |
|--------|-------|---------|--------------|----------|
| GET | `/api/dashboard/kpis` | `getDashboardKpis()` | - | `{sessions, actions_24h, agents, subtasks, routing}` |

### Cleanup Stats API

| Method | Route | Handler | Response |
|--------|-------|---------|----------|
| GET | `/api/cleanup/stats` | inline handler | `{last_cleanup, messages, timestamp}` |

### Tools Summary API (Phase 7)

| Method | Route | Handler | Response |
|--------|-------|---------|----------|
| GET | `/stats/tools-summary` | `getToolsSummary()` | `{tools_used, unique_tools, by_type}` |

### Auth Token API (Phase 8)

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| POST | `/api/auth/token` | inline (rate limited) | `{agent_id, session_id?}` | `{token: string, expires_in: 3600}` |
| | | Rate limit: 10 req/15min | - | - |

### Token Tracking API (Phase 9)

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| POST | `/api/tokens/track` | `trackTokens()` | `{agent_id, tokens_in, tokens_out, session_id?}` | Fire-and-forget (< 5ms) |
| GET | `/api/capacity/:agent_id` | `getCapacity()` | - | `{current_tokens, capacity, percentage, prediction}` |
| POST | `/api/capacity/:agent_id/reset` | `resetCapacity()` | `{tokens_total?}` | `{reset: true}` |
| GET | `/api/context/health/:agent_id` | `getContextHealth()` | - | `{health, capacity, recommendation}` |

### Agent Registry API (Phase 9)

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| GET | `/api/registry` | `getRegistry()` | - | `{agents: AgentRegistry[]}` |
| GET | `/api/registry/:agent_type` | `getRegistryAgent()` | - | `AgentRegistry` |
| PUT | `/api/registry/:agent_type` | `putRegistryAgent()` | Full agent definition | `AgentRegistry` |
| POST | `/api/registry/import` | `postRegistryImport()` | `{agents: AgentRegistry[]}` | `{imported: number}` |
| POST | `/api/registry/enrich-context` | `postRegistryEnrichContext()` | `{agent_type, session_id?}` | Enhanced context brief |
| GET | `/api/registry/catalog` | `getCatalog()` | - | Static catalog of agents/skills |

### Orchestration API (Phase 9)

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| POST | `/api/orchestration/batch-submit` | `postBatchSubmit()` | `{session_id, tasks: SubtaskDef[]}` | `{batch_id: uuid}` |
| POST | `/api/orchestration/batch/:id/complete` | `postBatchComplete()` | `{results: Result[]}` | `{synthesis: string}` |
| GET | `/api/orchestration/batch/:id` | `getBatch()` | - | `{batch, subtasks}` |
| GET | `/api/orchestration/synthesis/:id` | `getSynthesis()` | - | Token-optimized synthesis only |
| GET | `/api/orchestration/conflicts/:id` | `getConflicts()` | - | Conflict analysis |
| POST | `/api/orchestration/craft-prompt` | `postCraftPrompt()` | Scope definition | Crafted prompt |
| POST | `/api/orchestration/decompose` | `postDecompose()` | `{task_description}` | Decomposed subtasks |

### Wave Management API (Phase 9)

| Method | Route | Handler | Body Schema | Response |
|--------|-------|---------|-------------|----------|
| POST | `/api/waves/:session_id/create` | `postWaveCreate()` | `{name?, description?}` | `Wave` |
| POST | `/api/waves/:session_id/start` | `postWaveStart()` | `{wave_id}` | `{started: true, wave_number}` |
| POST | `/api/waves/:session_id/transition` | `postWaveTransition()` | - | Transition to next wave |
| GET | `/api/waves/:session_id/current` | `getWaveCurrent()` | - | Current active `Wave` |
| GET | `/api/waves/:session_id/history` | `getWaveHistoryHandler()` | - | `{waves: Wave[]}` |

---

## Database Schema

**Location:** `/home/rony/Assets Projets/Claude-DCM/context-manager/src/db/schema.sql`

### Tables

#### `projects`
Project identifiers mapped by working directory (cwd).

```sql
id UUID PRIMARY KEY (generated)
path TEXT UNIQUE NOT NULL
name TEXT
created_at TIMESTAMPTZ DEFAULT NOW()
updated_at TIMESTAMPTZ DEFAULT NOW()
metadata JSONB DEFAULT '{}'
```

#### `requests`
User prompts/requests with hierarchical relationship to projects.

```sql
id UUID PRIMARY KEY (generated)
project_id UUID REFERENCES projects(id) ON DELETE CASCADE
session_id TEXT NOT NULL
prompt TEXT NOT NULL
prompt_type TEXT  -- feature, debug, explain, search, etc.
status TEXT DEFAULT 'active'  -- active, completed
created_at TIMESTAMPTZ DEFAULT NOW()
completed_at TIMESTAMPTZ
metadata JSONB DEFAULT '{}'
```

#### `task_lists` (Waves)
Waves of objectives for each request.

```sql
id UUID PRIMARY KEY (generated)
request_id UUID REFERENCES requests(id) ON DELETE CASCADE
name TEXT
wave_number INTEGER DEFAULT 0
status TEXT DEFAULT 'pending'  -- pending, running, completed
created_at TIMESTAMPTZ DEFAULT NOW()
completed_at TIMESTAMPTZ
```

#### `subtasks`
Objectives assigned to agents within a wave.

```sql
id UUID PRIMARY KEY (generated)
task_list_id UUID REFERENCES task_lists(id) ON DELETE CASCADE
agent_type TEXT  -- backend-laravel, frontend-react, etc.
agent_id TEXT    -- Instance ID of the agent
description TEXT
status TEXT DEFAULT 'pending'  -- pending, running, paused, blocked, completed, failed
blocked_by UUID[]  -- IDs of blocking subtasks
created_at TIMESTAMPTZ DEFAULT NOW()
started_at TIMESTAMPTZ
completed_at TIMESTAMPTZ
context_snapshot JSONB  -- Context snapshot at start
result JSONB  -- Execution result
```

#### `actions`
Tool invocations with compressed input/output.

```sql
id UUID PRIMARY KEY (generated)
subtask_id UUID REFERENCES subtasks(id) ON DELETE CASCADE
tool_name TEXT NOT NULL  -- Bash, Read, Write, Task, Skill, mcp__*, etc.
tool_type TEXT NOT NULL  -- builtin, agent, skill, command, mcp
input BYTEA  -- Compressed with pg_lz
output BYTEA  -- Compressed with pg_lz
file_paths TEXT[]
exit_code INTEGER DEFAULT 0
duration_ms INTEGER
created_at TIMESTAMPTZ DEFAULT NOW()
metadata JSONB DEFAULT '{}'
```

#### `keyword_tool_scores`
Routing intelligence - keyword-to-tool mappings with feedback-driven scores.

```sql
id SERIAL PRIMARY KEY
keyword TEXT NOT NULL
tool_name TEXT NOT NULL
tool_type TEXT NOT NULL
score REAL DEFAULT 1.0
usage_count INTEGER DEFAULT 1
success_count INTEGER DEFAULT 1
last_used TIMESTAMPTZ DEFAULT NOW()
UNIQUE(keyword, tool_name)
```

#### `agent_messages`
Inter-agent pub/sub messaging.

```sql
id UUID PRIMARY KEY (generated)
project_id UUID REFERENCES projects(id) ON DELETE CASCADE
from_agent_id TEXT
to_agent_id TEXT  -- NULL = broadcast
message_type TEXT NOT NULL  -- info, request, response, notification
topic TEXT  -- api_endpoint_created, schema_updated, etc.
payload JSONB NOT NULL
read_by TEXT[] DEFAULT '{}'
created_at TIMESTAMPTZ DEFAULT NOW()
expires_at TIMESTAMPTZ
```

#### `agent_contexts`
Agent contexts for recovery after compact.

```sql
id UUID PRIMARY KEY (generated)
project_id UUID REFERENCES projects(id) ON DELETE CASCADE
agent_id TEXT NOT NULL
agent_type TEXT NOT NULL
role_context JSONB NOT NULL  -- Role-specific context
skills_to_restore TEXT[]
tools_used TEXT[]
progress_summary TEXT
last_updated TIMESTAMPTZ DEFAULT NOW()
UNIQUE(project_id, agent_id)
```

#### `sessions`
Claude Code sessions with statistics (migrated from SQLite).

```sql
id TEXT PRIMARY KEY
project_id UUID REFERENCES projects(id)
started_at TIMESTAMPTZ DEFAULT NOW()
ended_at TIMESTAMPTZ
total_tools_used INTEGER DEFAULT 0
total_success INTEGER DEFAULT 0
total_errors INTEGER DEFAULT 0
```

### Indexes

**Performance Indexes:**
- `idx_requests_project` on `requests(project_id)`
- `idx_requests_session` on `requests(session_id)`
- `idx_requests_status` on `requests(status)`
- `idx_subtasks_status` on `subtasks(status)`
- `idx_subtasks_agent` on `subtasks(agent_type, agent_id)`
- `idx_subtasks_task_list` on `subtasks(task_list_id)`
- `idx_actions_tool` on `actions(tool_name)`
- `idx_actions_created` on `actions(created_at DESC)`
- `idx_actions_subtask` on `actions(subtask_id)`
- `idx_actions_tool_type` on `actions(tool_type)`
- `idx_messages_project` on `agent_messages(project_id)`
- `idx_messages_to` on `agent_messages(to_agent_id)`
- `idx_messages_topic` on `agent_messages(topic)`
- `idx_messages_created` on `agent_messages(created_at DESC)`
- `idx_keyword_scores` on `keyword_tool_scores(keyword)`
- `idx_keyword_tool` on `keyword_tool_scores(tool_name)`
- `idx_contexts_agent` on `agent_contexts(project_id, agent_type)`
- `idx_contexts_agent_id` on `agent_contexts(agent_id)`
- `idx_sessions_project` on `sessions(project_id)`
- `idx_sessions_started` on `sessions(started_at DESC)`

**JSONB GIN Indexes (for complex queries):**
- `idx_projects_metadata` on `projects USING GIN (metadata)`
- `idx_requests_metadata` on `requests USING GIN (metadata)`
- `idx_actions_metadata` on `actions USING GIN (metadata)`
- `idx_messages_payload` on `agent_messages USING GIN (payload)`
- `idx_contexts_role` on `agent_contexts USING GIN (role_context)`

### Views

#### `v_actions_full`
Complete action view with full hierarchy (action → subtask → task → request → project).

```sql
action_id, tool_name, tool_type, exit_code, duration_ms, file_paths, action_created_at,
subtask_id, agent_type, agent_id, subtask_description, subtask_status,
task_list_id, task_list_name, wave_number,
request_id, prompt, prompt_type, session_id,
project_id, project_path, project_name
```

#### `v_active_agents`
Currently running agents grouped by project.

```sql
subtask_id, project_id, project_name, project_path,
agent_type, agent_id, status, description, started_at, created_at,
session_id, request_id, actions_count
```
WHERE status IN ('running', 'paused', 'blocked')

#### `v_unread_messages`
Messages that haven't expired with project context.

```sql
agent_messages.* (all columns),
project_name
```

#### `v_project_stats`
Statistics aggregated by project.

```sql
project_id, project_name, path,
total_requests, total_subtasks, total_actions, successful_actions,
avg_duration_ms, last_activity
```

---

## Hooks System

**Configuration:** `/home/rony/Assets Projets/Claude-DCM/context-manager/hooks/hooks.json`
**Hook Scripts:** `/home/rony/Assets Projets/Claude-DCM/context-manager/hooks/*.sh` (16 scripts)

DCM integrates with Claude Code through its hooks system. Each hook fires on a lifecycle event and executes a bash script that curls the DCM API.

### Hook Events

#### `PostToolUse` - After every tool execution

**Matcher: `*` (all tools)**

1. **`track-action.sh`** (3s timeout)
   - Records tool invocation to `keyword_tool_scores` for routing intelligence
   - Tracks token consumption via `/api/tokens/track`
   - Detects tool type: builtin, agent, skill, mcp, command
   - Payload extracted from stdout hook data

2. **`track-agent.sh`** (3s timeout, Matcher: `Task`)
   - Records agent/subagent execution
   - Fires only when `tool_name == "Task"`
   - Updates subtask status

3. **`context-guardian.sh`** (2s timeout, Matcher: `*`)
   - Monitors context usage
   - Proactive sampling and health tracking

4. **`monitor-context.sh`** (2s timeout, Matcher: `*`)
   - Every 10th tool call checks transcript size
   - If >800KB, triggers early snapshot
   - Uses counter file `/tmp/.dcm-monitor-counter`
   - Cooldown: 60s between proactive snapshots (`/tmp/.dcm-last-proactive`)

#### `SessionStart` - When Claude Code starts

**Matcher: `startup`**

1. **`ensure-services.sh`** (10s timeout)
   - Checks if API is running on 3847
   - If not, starts API and WebSocket servers
   - Waits for health confirmation
   - Uses file-based locking to prevent race conditions

2. **`track-session.sh`** (5s timeout)
   - Records new session start
   - POST `/api/sessions`

**Matcher: `compact`**

1. **`post-compact-restore.sh`** (8s timeout)
   - Called after compact operation
   - Restores context brief from DCM
   - POST `/api/compact/restore`
   - Returns `additionalContext` for session injection

#### `PreCompact` - Before context compaction

**Matcher: `auto|manual`**

1. **`pre-compact-save.sh`** (5s timeout)
   - Saves session state snapshot
   - Collects: active tasks, modified files, key decisions, agent states
   - POST `/api/compact/save`
   - Pulls data from multiple endpoints to build snapshot

#### `Stop` - When Claude Code stops

1. **`context-stop-guard.sh`** (3s timeout)
   - Final cleanup
   - Session finalization

#### `SubagentStop` - When a subagent completes

1. **`save-agent-result.sh`** (3s timeout)
   - Broadcasts agent result via `/api/messages`
   - Posts final status and artifacts

#### `SessionEnd` - When session ends

1. **`track-session-end.sh`** (3s timeout)
   - Records session completion
   - PATCH `/api/sessions/:id` with `ended_at`

### Hook Environment Variables

```bash
CONTEXT_MANAGER_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
CLAUDE_PLUGIN_ROOT  # Set by Claude Code when running as plugin
```

### Hook Data Format (stdin)

Hooks receive JSON on stdin with:

```json
{
  "tool_name": "Read|Write|Task|Skill|mcp__*|...",
  "tool_input": { ... },
  "tool_output": { ... },
  "session_id": "session-uuid",
  "cwd": "/working/directory",
  "timestamp": "ISO-8601",
  "exit_code": 0
}
```

### Hook Output Format

Hooks must output JSON with `hookSpecificOutput.additionalContext` for SessionStart injection:

```json
{
  "hookSpecificOutput": {
    "additionalContext": "...<context brief to inject>..."
  }
}
```

### Hook Timeouts

- **PostToolUse tracking**: 3s (fire-and-forget)
- **Context monitoring**: 2s
- **Compact save**: 5s
- **Compact restore**: 8s
- **SessionStart ensure-services**: 10s
- **SessionStart track**: 5s
- **SessionEnd/SubagentStop**: 3s

### Monitor Threshold Logic

```
< 500 KB   → Green (OK)
500-800 KB → Yellow (log warning)
> 800 KB   → Red (trigger snapshot)
```

---

## CLI Commands

**Location:** `/home/rony/Assets Projets/Claude-DCM/context-manager/dcm` (bash script, 390 lines)

The `dcm` command is the single entry point for all DCM operations. Available commands:

### Installation & Setup

#### `dcm install`
One-command full setup:
1. Check prerequisites (bun, psql, jq, curl)
2. Install npm dependencies
3. Create `.env` from template
4. Set up database
5. Configure Claude Code hooks

**Output:**
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

#### `dcm hooks`
Install/update Claude Code hooks. Delegates to `scripts/setup-hooks.sh`.

#### `dcm unhook`
Remove all DCM hooks from Claude Code settings.json (with backup). Uses jq to filter matching hook entries.

### Service Management

#### `dcm start`
Start all three services (API, WebSocket, Dashboard).

- Checks if each service is already running
- Starts via `bun run` in background with nohup
- Saves PIDs to `/tmp/.dcm-pids/`
- Logs to `/tmp/dcm-*.log`

**Services started:**
- API: `bun run src/server.ts` (port 3847)
- WebSocket: `bun run src/websocket-server.ts` (port 3849)
- Dashboard: `bun run dev` in context-dashboard (port 3848)

#### `dcm stop`
Stop all services by PID or port.

- Checks PID files first
- Falls back to port-based kill (lsof)
- Removes PID files after stopping

#### `dcm restart`
Stop then start.

#### `dcm status`
Show health of all components:
- API health check via `/health`
- WebSocket port check
- Dashboard ping
- PostgreSQL connectivity
- Claude Code hooks installation status

**Output:**
```
DCM Status
  API (port 3847):       healthy (v3.0.0)
  WebSocket (port 3849):  running
  Dashboard (port 3848):  running
  PostgreSQL:             connected
  Claude Code hooks:      installed
```

#### `dcm health`
Quick health check. Calls `/health` endpoint and returns JSON.

#### `dcm logs [api|ws|dashboard]`
Tail service logs in real-time.

```bash
dcm logs api         # tail -f /tmp/dcm-api.log
dcm logs ws          # tail -f /tmp/dcm-ws.log
dcm logs dashboard   # tail -f /tmp/dcm-dashboard.log
```

### Database Commands

#### `dcm db:setup`
Initialize or reset database schema. Runs `scripts/setup-db.sh`.

#### `dcm db:reset`
**DESTRUCTIVE** - Drop and recreate database. Requires confirmation (type 'yes').

```bash
dcm db:reset
# WARNING: This will DROP and recreate the database!
# Are you sure? (type 'yes' to confirm): yes
# Database reset complete.
```

### Context Commands

#### `dcm snapshot [session_id]`
Manually trigger a context snapshot for a session.

```bash
dcm snapshot abc123def456
# Taking snapshot for session: abc123def456
# POST /api/compact/save { "session_id": "abc123def456", "trigger": "manual" }
```

#### `dcm context <agent_id> [session_id]`
Get the context brief for an agent in a session.

```bash
dcm context backend-laravel abc123def456
# GET /api/context/backend-laravel?session_id=abc123def456&format=brief
```

### Meta Commands

#### `dcm version` or `dcm -v` or `dcm --version`
Show version (currently 2.1.0).

#### `dcm help` or `dcm -h` or `dcm --help` or no args
Show usage information.

### Environment Variables

```bash
PORT=3847           # API port (default 3847)
WS_PORT=3849        # WebSocket port (default 3849)
DASHBOARD_PORT=3848 # Dashboard port (default 3848)
DB_USER=dcm         # PostgreSQL user
DB_NAME=claude_context  # Database name
```

---

## WebSocket System

**Locations:**
- Server: `/home/rony/Assets Projets/Claude-DCM/context-manager/src/websocket-server.ts`
- Types: `/home/rony/Assets Projets/Claude-DCM/context-manager/src/websocket/types.ts`
- Handlers: `/home/rony/Assets Projets/Claude-DCM/context-manager/src/websocket/handlers.ts`
- Auth: `/home/rony/Assets Projets/Claude-DCM/context-manager/src/websocket/auth.ts`
- Bridge: `/home/rony/Assets Projets/Claude-DCM/context-manager/src/websocket/bridge.ts`

### WebSocket Server

- **Port:** 3849
- **Protocol:** WebSocket (ws://)
- **Runtime:** Bun native WebSocket
- **Authentication:** HMAC tokens from `/api/auth/token`
- **Real-time bridge:** PostgreSQL LISTEN/NOTIFY → WebSocket broadcasts

### Channel Types

```typescript
type ChannelType = "agents" | "sessions" | "global" | "metrics" | "topics";

// Concrete channels:
"agents/{agent_id}"       // Agent-specific channel
"sessions/{session_id}"   // Session-specific channel
"global"                  // Broadcast to all
"metrics"                 // System metrics channel
"topics/{topic_name}"     // Topic-based channel
```

### Message Types (Client → Server)

#### Subscribe
```json
{
  "type": "subscribe",
  "channel": "sessions/abc123",
  "timestamp": 1707400000000,
  "id": "msg-uuid"
}
```

#### Unsubscribe
```json
{
  "type": "unsubscribe",
  "channel": "sessions/abc123",
  "timestamp": 1707400000000
}
```

#### Publish
```json
{
  "type": "publish",
  "channel": "sessions/abc123",
  "event": "subtask.completed",
  "data": { "subtask_id": "...", "status": "completed" },
  "timestamp": 1707400000000
}
```

#### Auth
```json
{
  "type": "auth",
  "agent_id": "backend-laravel",
  "session_id": "abc123",
  "token": "eyJ...",
  "timestamp": 1707400000000
}
```

#### Ping
```json
{
  "type": "ping",
  "timestamp": 1707400000000,
  "id": "ping-123"
}
```

### Event Types

**Task events:**
- `task.created` - New task/wave created
- `task.updated` - Task state changed
- `task.completed` - Task finished
- `task.failed` - Task failed

**Subtask events:**
- `subtask.created` - New subtask assigned
- `subtask.updated` - Subtask progress
- `subtask.completed` - Subtask done
- `subtask.failed` - Subtask failed
- `subtask.running` - Subtask started

**Message events:**
- `message.new` - New inter-agent message
- `message.read` - Message read
- `message.expired` - Message expired

**Agent events:**
- `agent.connected` - Agent connected
- `agent.disconnected` - Agent disconnected
- `agent.heartbeat` - Keepalive ping
- `agent.blocked` - Agent blocking another
- `agent.unblocked` - Agent unblocked

**Metric events:**
- `metric.update` - System metrics snapshot

**Session events:**
- `session.created` - New session started
- `session.ended` - Session completed

**System events:**
- `system.error` - System error occurred
- `system.info` - System information

### Server → Client Messages

#### Event
```json
{
  "channel": "sessions/abc123",
  "event": "subtask.completed",
  "data": { ... event data ... },
  "timestamp": 1707400000000
}
```

#### Ack
```json
{
  "type": "ack",
  "id": "msg-uuid",
  "success": true,
  "timestamp": 1707400000000
}
```

#### Error
```json
{
  "error": "Invalid channel",
  "code": "INVALID_CHANNEL",
  "details": { ... },
  "timestamp": 1707400000000
}
```

#### Connected
```json
{
  "type": "connected",
  "client_id": "client-uuid",
  "timestamp": 1707400000000
}
```

#### Pong
```json
{
  "type": "pong",
  "timestamp": 1707400000000
}
```

### Client State

Each WebSocket client maintains state:

```typescript
interface WSClientData {
  id: string;
  agent_id?: string;
  session_id?: string;
  subscriptions: Set<string>;  // Channels subscribed to
  authenticated: boolean;
  connectedAt: number;
  lastPing: number;
}
```

### Authentication Flow

1. Client obtains token via `POST /api/auth/token`
   ```bash
   curl -X POST http://127.0.0.1:3847/api/auth/token \
     -H "Content-Type: application/json" \
     -d '{"agent_id": "backend-laravel"}'
   ```

2. Response: `{token: "eyJ...", expires_in: 3600}`

3. Client connects and sends auth message:
   ```json
   {
     "type": "auth",
     "agent_id": "backend-laravel",
     "token": "eyJ..."
   }
   ```

4. Server validates HMAC signature and marks client as authenticated

### Real-time Bridge

PostgreSQL LISTEN/NOTIFY events are automatically bridged to WebSocket clients:

```sql
-- In database, trigger:
NOTIFY channel_name, json_payload;

-- Received by WebSocket server:
-- PostgreSQL client listens on all channels
-- Broadcasts matching events to subscribed WebSocket clients
```

### Example Usage (JavaScript)

```javascript
// Connect and subscribe
const ws = new WebSocket('ws://127.0.0.1:3849');

ws.onopen = () => {
  // Authenticate
  ws.send(JSON.stringify({
    type: 'auth',
    agent_id: 'backend-laravel',
    token: 'eyJ...',
    timestamp: Date.now()
  }));

  // Subscribe to session
  ws.send(JSON.stringify({
    type: 'subscribe',
    channel: 'sessions/abc123',
    timestamp: Date.now()
  }));
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.event === 'subtask.completed') {
    console.log('Subtask done:', message.data);
  }
};

// Send keepalive
setInterval(() => {
  ws.send(JSON.stringify({
    type: 'ping',
    timestamp: Date.now()
  }));
}, 30000);
```

---

## Dashboard Pages

**Framework:** Next.js 16 + React 19
**UI:** shadcn/ui + Recharts
**Port:** 3848
**Location:** `/home/rony/Assets Projets/Claude-DCM/context-dashboard/src/app/`

### Page Structure

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | `page.tsx` | Home/overview (redirects to /dashboard) |
| `/dashboard` | `dashboard/page.tsx` | Main KPI dashboard with real-time metrics |
| `/projects` | `projects/page.tsx` | Project browser and hierarchy |
| `/projects/[id]` | `projects/[id]/page.tsx` | Project detail view |
| `/sessions` | `sessions/page.tsx` | Session browser and timeline |
| `/sessions/[id]` | `sessions/[id]/page.tsx` | Session detail with activity log |
| `/agents` | `agents/page.tsx` | Agent contexts and status |
| `/agents/[id]` | `agents/[id]/page.tsx` | Agent detail with history |
| `/messages` | `messages/page.tsx` | Inter-agent messaging |
| `/actions` | `actions/page.tsx` | Tool usage tracking (if exists) |
| `/routing` | `routing/page.tsx` | Intelligent routing statistics |
| `/tools` | `tools/page.tsx` | Tools summary and usage |
| `/waves` | `waves/page.tsx` | Task waves and orchestration |
| `/flows` | `flows/page.tsx` | Task orchestration flows |
| `/registry` | `registry/page.tsx` | Agent registry catalog |
| `/compact` | `compact/page.tsx` | Compact operations and snapshots |
| `/context` | `context/page.tsx` | Context brief viewer |
| `/live` | `live/page.tsx` | Live activity feed (WebSocket) |
| `/performance` | `performance/page.tsx` | Performance metrics and health |

### Dashboard Page Example

**Path:** `src/app/dashboard/page.tsx`

**Components:**
- `HealthCard` - API and database health status
- `KPICard` - Reusable metric card with icon
- `SuccessRateBar` - Visual progress bar for success metrics
- `AgentDistributionCard` - Agent types histogram
- `SystemHealthCard` - Action rates and completion rates
- `RecentActivityCard` - Latest tool invocations
- `ActiveAgentsCard` - Currently running agents

**Data fetched via:**
- `/api/dashboard/kpis` - KPI aggregations (15s refresh)
- `/api/active-sessions` - Running agents (10s refresh)
- `/api/actions` - Recent actions (15s refresh)
- `/health` - API status (30s refresh)

**KPI Display:**
- Success Rate (24h)
- Actions/Hour
- Active Agents count
- Sessions count
- Subtasks (running/completed)
- Agent Contexts
- Routing Coverage (keywords/tools)
- Agent Distribution by type

### Layout & Navigation

**Location:** `src/app/layout.tsx`

**Components:**
- `Sidebar` - Left navigation with menu items
- `Header` - Top bar with theme toggle, search, notifications
- `GlobalSearch` - Quick search across sessions/projects/agents
- `NotificationCenter` - Real-time alert display
- `ThemeScript` - Dark/light mode support

### Key Components

**Location:** `src/components/`

**Dashboard-specific:**
- `dashboard/PremiumKPICard.tsx` - Advanced metrics card
- `dashboard/HealthGauge.tsx` - Health status gauge
- `dashboard/SystemPulseBar.tsx` - Real-time pulse indicator
- `dashboard/ActivityFeed.tsx` - Activity stream
- `dashboard/GlassChartTooltip.tsx` - Custom chart tooltip

**Charts (Recharts):**
- `charts/LineChart.tsx` - Time-series data
- `charts/AreaChart.tsx` - Area visualization
- `charts/BarChart.tsx` - Category comparison
- `charts/PieChart.tsx` - Distribution breakdown

**Filters:**
- `filters/DateRangeFilter.tsx` - Time range picker
- `filters/AgentFilter.tsx` - Agent selection
- `filters/StatusFilter.tsx` - Status filtering

**Shared UI:**
- `Card`, `Badge`, `Button`, `Input`, `Table`, `Tabs`, `Separator` (shadcn/ui)
- `PageContainer` - Page wrapper with title/description
- `ErrorBoundary` - Error fallback with reset
- `LoadingSpinner` - Generic loader
- `ExportButton` - Export data to CSV/JSON

### API Client

**Location:** `src/lib/api-client.ts`

TypeScript client with type-safe methods:

```typescript
apiClient.getHealth()
apiClient.getDashboardKPIs()
apiClient.getActiveSessions()
apiClient.getActions(limit, offset)
apiClient.getSessions()
apiClient.getSessionById(id)
apiClient.getMessages()
apiClient.getAgentContexts()
```

All methods use TanStack Query for caching and refetching.

### Query Provider

**Location:** `src/providers/query-provider.tsx`

TanStack Query setup with:
- 5-minute default staleTime
- Automatic retries on failure
- Persistent cache (localStorage)

### Hooks

**Location:** `src/hooks/`

- `useWebSocket.ts` - WebSocket connection management
- `useFilters.ts` - Filter state management

---

## Project Structure

```
/home/rony/Assets Projets/Claude-DCM/
├── README.md                           # Project overview and quick start
├── CHANGELOG.md                        # Version history
├── docker-compose.yml                  # Full stack Docker setup
│
├── context-manager/                    # Backend service
│   ├── dcm                             # CLI (390 lines) - main entry point
│   ├── src/
│   │   ├── server.ts                   # API (548 lines) - all 50+ routes
│   │   ├── websocket-server.ts         # WebSocket (97 lines)
│   │   ├── config.ts                   # Environment config
│   │   ├── context-generator.ts        # Context brief generation
│   │   ├── cleanup.ts                  # Expired message cleanup
│   │   ├── api/                        # 22 route handlers
│   │   │   ├── actions.ts
│   │   │   ├── agent-contexts.ts
│   │   │   ├── blocking.ts
│   │   │   ├── catalog.ts
│   │   │   ├── compact.ts
│   │   │   ├── context.ts
│   │   │   ├── dashboard.ts
│   │   │   ├── hierarchy.ts
│   │   │   ├── messages.ts
│   │   │   ├── orchestration-planner.ts
│   │   │   ├── orchestration.ts
│   │   │   ├── projects.ts
│   │   │   ├── registry.ts
│   │   │   ├── requests.ts
│   │   │   ├── routing.ts
│   │   │   ├── sessions.ts
│   │   │   ├── subscriptions.ts
│   │   │   ├── subtasks.ts
│   │   │   ├── tasks.ts
│   │   │   ├── tokens.ts
│   │   │   ├── tools-summary.ts
│   │   │   └── waves.ts
│   │   ├── db/
│   │   │   ├── client.ts               # PostgreSQL connection pool
│   │   │   ├── schema.sql              # 10 tables, 4 views, indexes
│   │   │   └── migrations/
│   │   │       └── 003_proactive_triage.sql
│   │   ├── websocket/
│   │   │   ├── server.ts               # WebSocket listener
│   │   │   ├── handlers.ts             # Message handlers
│   │   │   ├── auth.ts                 # HMAC authentication
│   │   │   ├── bridge.ts               # LISTEN/NOTIFY bridge
│   │   │   ├── types.ts                # Message/channel types
│   │   │   └── README.md
│   │   ├── middleware/
│   │   │   └── rate-limit.ts           # Rate limiting middleware
│   │   ├── lib/
│   │   │   └── logger.ts               # Logging utility
│   │   ├── templates/                  # Agent prompt templates
│   │   │   ├── developer.ts
│   │   │   ├── orchestrator.ts
│   │   │   ├── specialist.ts
│   │   │   └── validator.ts
│   │   ├── aggregation/
│   │   │   └── engine.ts               # Metric aggregation
│   │   ├── waves/
│   │   │   └── manager.ts              # Wave orchestration
│   │   ├── context/
│   │   │   └── types.ts                # Context type definitions
│   │   ├── data/
│   │   │   └── catalog.ts              # Static agent catalog data
│   │   ├── sdk/                        # SDK for external use
│   │   │   ├── client.ts
│   │   │   ├── ws-client.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   └── tests/
│   │       ├── api.test.ts
│   │       ├── cleanup.test.ts
│   │       ├── messages.test.ts
│   │       ├── orchestration-planner.test.ts
│   │       └── ws.test.ts
│   ├── hooks/                          # Claude Code hooks (16 scripts)
│   │   ├── hooks.json                  # Hook configuration
│   │   ├── track-action.sh             # Record all tool actions
│   │   ├── track-agent.sh              # Record agent execution
│   │   ├── track-session.sh            # Record session start
│   │   ├── track-session-end.sh        # Record session end
│   │   ├── pre-compact-save.sh         # Save context before compact
│   │   ├── post-compact-restore.sh     # Restore context after compact
│   │   ├── context-guardian.sh         # Monitor context health
│   │   ├── context-stop-guard.sh       # Cleanup on stop
│   │   ├── save-agent-result.sh        # Broadcast agent result
│   │   ├── monitor-context.sh          # Proactive snapshot trigger
│   │   ├── ensure-services.sh          # Auto-start services
│   │   ├── track-usage-wrapper.sh
│   │   ├── track-usage.sh
│   │   ├── track-agent-start.sh
│   │   ├── track-agent-end.sh
│   │   └── context-guardian.sh
│   ├── scripts/
│   │   ├── setup-db.sh                 # Database initialization
│   │   ├── setup-hooks.sh              # Hook installation
│   │   ├── backup-db.sh                # Database backup
│   │   ├── health-check.sh             # Service health check
│   │   ├── migrate-sqlite.ts           # SQLite→PostgreSQL migration
│   │   └── import-sessions.ts          # Session importer
│   ├── agents/
│   │   └── context-keeper.md           # Context agent documentation
│   ├── docs/
│   │   ├── openapi.yaml                # OpenAPI specification
│   │   ├── context-agent-guide.md      # Agent integration guide
│   │   └── migration-guide.md          # Migration documentation
│   ├── .claude-plugin/
│   │   └── plugin.json                 # Plugin manifest
│   ├── package.json                    # Dependencies (Hono, Zod, postgres)
│   ├── tsconfig.json                   # TypeScript config
│   ├── .env.example                    # Environment template
│   ├── .env                            # Environment (PostgreSQL credentials)
│   ├── README.md                       # Service documentation
│   ├── CLAUDE.md                       # Bun configuration notes
│   ├── Dockerfile                      # Container image
│   ├── docker-compose.yml              # Service orchestration
│   ├── context-manager-api.service     # systemd service file
│   ├── context-manager-ws.service      # systemd service file
│   └── install.sh                      # Installation script
│
├── context-dashboard/                  # Frontend dashboard
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx              # Root layout with sidebar/header
│   │   │   ├── page.tsx                # Home page
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx            # Main dashboard with KPIs
│   │   │   ├── projects/
│   │   │   │   ├── page.tsx            # Project list
│   │   │   │   └── [id]/page.tsx       # Project detail
│   │   │   ├── sessions/
│   │   │   │   ├── page.tsx            # Session browser
│   │   │   │   └── [id]/page.tsx       # Session timeline
│   │   │   ├── agents/
│   │   │   │   ├── page.tsx            # Agent contexts
│   │   │   │   └── [id]/page.tsx       # Agent detail
│   │   │   ├── messages/
│   │   │   │   └── page.tsx            # Message browser
│   │   │   ├── routing/
│   │   │   │   └── page.tsx            # Routing statistics
│   │   │   ├── tools/
│   │   │   │   └── page.tsx            # Tools summary
│   │   │   ├── actions/
│   │   │   │   └── page.tsx            # Action tracking (if added)
│   │   │   ├── waves/
│   │   │   │   └── page.tsx            # Wave orchestration
│   │   │   ├── flows/
│   │   │   │   └── page.tsx            # Flow visualization
│   │   │   ├── registry/
│   │   │   │   └── page.tsx            # Agent registry
│   │   │   ├── compact/
│   │   │   │   └── page.tsx            # Compact operations
│   │   │   ├── context/
│   │   │   │   └── page.tsx            # Context viewer
│   │   │   ├── live/
│   │   │   │   └── page.tsx            # Live activity (WebSocket)
│   │   │   ├── performance/
│   │   │   │   └── page.tsx            # Performance metrics
│   │   │   ├── globals.css
│   │   │   └── favicon.ico
│   │   ├── components/
│   │   │   ├── ui/                     # shadcn/ui primitives
│   │   │   │   ├── card.tsx
│   │   │   │   ├── button.tsx
│   │   │   │   ├── badge.tsx
│   │   │   │   ├── input.tsx
│   │   │   │   ├── table.tsx
│   │   │   │   ├── tabs.tsx
│   │   │   │   ├── skeleton.tsx
│   │   │   │   └── separator.tsx
│   │   │   ├── charts/                 # Recharts wrappers
│   │   │   │   ├── LineChart.tsx
│   │   │   │   ├── AreaChart.tsx
│   │   │   │   ├── BarChart.tsx
│   │   │   │   ├── PieChart.tsx
│   │   │   │   ├── KPICard.tsx
│   │   │   │   └── index.ts
│   │   │   ├── dashboard/              # Dashboard-specific
│   │   │   │   ├── HealthGauge.tsx
│   │   │   │   ├── PremiumKPICard.tsx
│   │   │   │   ├── SystemPulseBar.tsx
│   │   │   │   ├── ActivityFeed.tsx
│   │   │   │   ├── GlassChartTooltip.tsx
│   │   │   │   ├── constants.ts
│   │   │   │   ├── utils.tsx
│   │   │   │   └── index.ts
│   │   │   ├── filters/                # Filter components
│   │   │   │   ├── DateRangeFilter.tsx
│   │   │   │   ├── AgentFilter.tsx
│   │   │   │   ├── StatusFilter.tsx
│   │   │   │   └── index.ts
│   │   │   ├── Header.tsx              # Top navigation bar
│   │   │   ├── Sidebar.tsx             # Left sidebar navigation
│   │   │   ├── PageContainer.tsx       # Page wrapper
│   │   │   ├── GlobalSearch.tsx        # Global search
│   │   │   ├── ErrorBoundary.tsx       # Error handling
│   │   │   ├── LoadingSpinner.tsx      # Loader
│   │   │   ├── NotificationCenter.tsx  # Notifications
│   │   │   ├── ExportButton.tsx        # Export data
│   │   │   ├── ThemeScript.tsx         # Theme initialization
│   │   │   └── index.ts
│   │   ├── hooks/
│   │   │   ├── useWebSocket.ts         # WebSocket connection
│   │   │   └── useFilters.ts           # Filter state
│   │   ├── lib/
│   │   │   ├── api-client.ts           # REST client with types
│   │   │   ├── query-client.ts         # TanStack Query setup
│   │   │   ├── export.ts               # CSV/JSON export
│   │   │   └── utils.ts                # Helper functions
│   │   └── providers/
│   │       └── query-provider.tsx      # TanStack Query provider
│   ├── public/                         # Static assets
│   ├── package.json                    # Dependencies
│   ├── tsconfig.json
│   ├── next.config.ts
│   ├── tailwind.config.ts
│   ├── postcss.config.mjs
│   ├── components.json                 # shadcn/ui config
│   ├── Dockerfile
│   ├── start.sh                        # Startup script
│   └── README.md
│
├── docs/                               # Documentation
│   ├── API.md                          # API documentation
│   ├── ARCHITECTURE.md                 # System architecture
│   ├── DEPLOYMENT.md                   # Deployment guide
│   ├── INTEGRATION.md                  # Integration guide
│   ├── _codebase-analysis.md           # This file!
│   ├── assets/                         # SVG diagrams
│   │   ├── system-overview.svg
│   │   ├── architecture.svg
│   │   ├── database-schema.svg
│   │   ├── action-tracking.svg
│   │   ├── compact-sequence.svg
│   │   ├── hooks-flow.svg
│   │   ├── context-generation.svg
│   │   ├── cross-agent-sharing.svg
│   │   ├── integration-lifecycle.svg
│   │   ├── auto-start.svg
│   │   ├── key-features.svg
│   │   └── dcm-logo.svg
│   ├── api/                            # Generated API docs
│   ├── images/
│   └── wiki/
│
└── .github/                            # GitHub config (if exists)
```

### Key Dependencies

**Backend (context-manager):**
- `hono@^4.11.7` - HTTP framework
- `postgres@^3.4.8` - PostgreSQL driver (Bun.sql compatible)
- `zod@^4.3.6` - Schema validation
- `@types/bun` - Type definitions for Bun

**Frontend (context-dashboard):**
- `next@16.1.6` - React framework
- `react@19.2.3` - UI library
- `@tanstack/react-query@^5.90.20` - Data fetching & caching
- `recharts@^3.7.0` - Chart components
- `shadcn/ui` - Component library (via radix-ui)
- `tailwindcss@^4` - CSS utility framework
- `lucide-react@^0.563.0` - Icons

### Configuration Files

**Backend:**
- `.env.example` - Template for environment variables
- `tsconfig.json` - TypeScript configuration
- `package.json` - Dependency manifest
- `Dockerfile` - Container build config

**Frontend:**
- `next.config.ts` - Next.js configuration
- `tailwind.config.ts` - Tailwind CSS config
- `postcss.config.mjs` - PostCSS config
- `components.json` - shadcn/ui config
- `tsconfig.json` - TypeScript configuration
- `package.json` - Dependency manifest

---

## Summary

This codebase implements a sophisticated distributed context management system for multi-agent Claude Code sessions. Key architectural decisions include:

1. **Separation of concerns:** REST API, WebSocket server, and dashboard are independent services
2. **Event-driven design:** Hooks fire on lifecycle events and push data to the API
3. **LISTEN/NOTIFY bridge:** Real-time events bridge database notifications to WebSocket clients
4. **Lazy context generation:** Context briefs are generated on-demand, not cached
5. **Feedback-driven routing:** Tool suggestions improve through usage feedback
6. **Compact recovery:** Automatic snapshots ensure sessions survive context limits

The system is production-ready with proper error handling, rate limiting, validation, and monitoring across all layers.

---

**Document End**
