# Database Schema Reference

![Database Schema](../images/database-schema.png)

Complete schema for the DCM PostgreSQL database (`claude_context`).

**PostgreSQL version:** 16+
**Extension required:** `pgcrypto` (provides `gen_random_uuid()`)
**Schema file:** `context-manager/src/db/schema.sql`
**Schema version:** 4.0.0

---

## Tables

### projects

Monitored codebases, identified by their absolute filesystem path.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | UUID | PRIMARY KEY | `gen_random_uuid()` | Unique identifier |
| `path` | TEXT | UNIQUE, NOT NULL | -- | Absolute filesystem path |
| `name` | TEXT | -- | NULL | Human-readable project name |
| `created_at` | TIMESTAMPTZ | -- | `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | -- | `NOW()` | Last update (auto-trigger) |
| `metadata` | JSONB | -- | `'{}'` | Arbitrary key-value pairs |

**Trigger:** `update_projects_updated_at` sets `updated_at = NOW()` on every UPDATE.

---

### sessions

Claude Code session instances with aggregate statistics.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | TEXT | PRIMARY KEY | -- | Client-provided session identifier |
| `project_id` | UUID | FK -> projects(id) | NULL | Associated project |
| `started_at` | TIMESTAMPTZ | -- | `NOW()` | Session start time |
| `ended_at` | TIMESTAMPTZ | -- | NULL | Session end time (NULL = active) |
| `total_tools_used` | INTEGER | -- | 0 | Total tool calls in session |
| `total_success` | INTEGER | -- | 0 | Successful tool calls |
| `total_errors` | INTEGER | -- | 0 | Failed tool calls |

---

### requests

User prompts that initiate work. Each request belongs to a project and a session.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | UUID | PRIMARY KEY | `gen_random_uuid()` | Unique identifier |
| `project_id` | UUID | FK -> projects(id) ON DELETE CASCADE | -- | Parent project |
| `session_id` | TEXT | NOT NULL | -- | Associated session |
| `prompt` | TEXT | NOT NULL | -- | The user prompt text |
| `prompt_type` | TEXT | -- | NULL | Category: feature, debug, explain, search |
| `status` | TEXT | -- | `'active'` | Status: active, completed |
| `created_at` | TIMESTAMPTZ | -- | `NOW()` | Creation timestamp |
| `completed_at` | TIMESTAMPTZ | -- | NULL | Completion timestamp |
| `metadata` | JSONB | -- | `'{}'` | Arbitrary key-value pairs |

---

### task_lists

Waves of objectives for each request. Each task_list represents one execution wave.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | UUID | PRIMARY KEY | `gen_random_uuid()` | Unique identifier |
| `request_id` | UUID | FK -> requests(id) ON DELETE CASCADE | -- | Parent request |
| `name` | TEXT | -- | NULL | Wave name |
| `wave_number` | INTEGER | -- | 0 | Wave sequence number |
| `status` | TEXT | -- | `'pending'` | Status: pending, running, completed |
| `created_at` | TIMESTAMPTZ | -- | `NOW()` | Creation timestamp |
| `completed_at` | TIMESTAMPTZ | -- | NULL | Completion timestamp |

---

### orchestration_batches

Batches of tasks submitted together for parallel execution.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | UUID | PRIMARY KEY | `gen_random_uuid()` | Unique identifier |
| `session_id` | TEXT | NOT NULL | -- | Associated session |
| `wave_number` | INTEGER | NOT NULL, CHECK >= 0 | -- | Wave number |
| `status` | TEXT | -- | `'pending'` | Status: pending, running, completed, failed |
| `total_tasks` | INTEGER | -- | 0 | Total tasks in batch |
| `completed_tasks` | INTEGER | -- | 0 | Completed tasks |
| `failed_tasks` | INTEGER | -- | 0 | Failed tasks |
| `synthesis` | JSONB | -- | NULL | Aggregated results |
| `created_at` | TIMESTAMPTZ | -- | `NOW()` | Creation timestamp |
| `completed_at` | TIMESTAMPTZ | -- | NULL | Completion timestamp |

---

### subtasks

Individual agent assignments within a wave. Each subtask represents one agent's piece of work.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | UUID | PRIMARY KEY | `gen_random_uuid()` | Unique identifier |
| `task_list_id` | UUID | FK -> task_lists(id) ON DELETE CASCADE | -- | Parent wave |
| `agent_type` | TEXT | -- | NULL | Agent type (e.g., backend-laravel) |
| `agent_id` | TEXT | -- | NULL | Instance ID of the agent |
| `description` | TEXT | -- | NULL | Task description |
| `status` | TEXT | -- | `'pending'` | pending, running, paused, blocked, completed, failed |
| `blocked_by` | UUID[] | -- | NULL | IDs of blocking subtasks |
| `created_at` | TIMESTAMPTZ | -- | `NOW()` | Creation timestamp |
| `started_at` | TIMESTAMPTZ | -- | NULL | When execution began |
| `completed_at` | TIMESTAMPTZ | -- | NULL | When execution ended |
| `context_snapshot` | JSONB | -- | NULL | Context state at start |
| `result` | JSONB | -- | NULL | Execution result |
| `batch_id` | UUID | FK -> orchestration_batches(id) ON DELETE SET NULL | NULL | Parent batch |
| `priority` | INTEGER | -- | 5 | Priority level (higher = more important) |
| `retry_count` | INTEGER | -- | 0 | Number of retry attempts |
| `parent_agent_id` | TEXT | -- | NULL | Parent agent for hierarchy tracking |

---

### actions

Tool invocations. Every Read, Write, Bash, Task, Skill, and MCP call is recorded here.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | UUID | PRIMARY KEY | `gen_random_uuid()` | Unique identifier |
| `subtask_id` | UUID | FK -> subtasks(id) ON DELETE CASCADE | NULL | Parent subtask |
| `tool_name` | TEXT | NOT NULL | -- | Tool name (Read, Write, Bash, Task, etc.) |
| `tool_type` | TEXT | NOT NULL | -- | Type: builtin, agent, skill, command, mcp, blocked |
| `input` | BYTEA | -- | NULL | Compressed input (pg_lz) |
| `output` | BYTEA | -- | NULL | Compressed output (pg_lz) |
| `file_paths` | TEXT[] | -- | NULL | Files involved |
| `exit_code` | INTEGER | -- | 0 | Exit code (0 = success) |
| `duration_ms` | INTEGER | -- | NULL | Execution duration in milliseconds |
| `session_id` | TEXT | -- | NULL | Session for direct-tracked actions |
| `created_at` | TIMESTAMPTZ | -- | `NOW()` | Timestamp |
| `metadata` | JSONB | -- | `'{}'` | Arbitrary metadata |

---

### keyword_tool_scores

Routing intelligence. Tracks which tools work best for which keywords, refined by feedback.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | SERIAL | PRIMARY KEY | auto-increment | Unique identifier |
| `keyword` | TEXT | NOT NULL, UNIQUE(keyword, tool_name) | -- | Search keyword |
| `tool_name` | TEXT | NOT NULL | -- | Tool name |
| `tool_type` | TEXT | NOT NULL | -- | Tool type |
| `score` | REAL | -- | 1.0 | Relevance score |
| `usage_count` | INTEGER | -- | 1 | Times used |
| `success_count` | INTEGER | -- | 1 | Successful uses |
| `last_used` | TIMESTAMPTZ | -- | `NOW()` | Last usage time |

---

### agent_messages

Inter-agent pub/sub messaging.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | UUID | PRIMARY KEY | `gen_random_uuid()` | Unique identifier |
| `project_id` | UUID | FK -> projects(id) ON DELETE CASCADE | -- | Project scope |
| `from_agent_id` | TEXT | -- | NULL | Sender agent |
| `to_agent_id` | TEXT | -- | NULL | Recipient (NULL = broadcast) |
| `message_type` | TEXT | NOT NULL | -- | Type: info, request, response, notification |
| `topic` | TEXT | -- | NULL | Topic (e.g., api_endpoint_created) |
| `payload` | JSONB | NOT NULL | -- | Message content |
| `priority` | INTEGER | NOT NULL | 0 | Priority level |
| `read_by` | TEXT[] | -- | `'{}'` | Agent IDs that have read this message |
| `created_at` | TIMESTAMPTZ | -- | `NOW()` | Creation timestamp |
| `expires_at` | TIMESTAMPTZ | -- | NULL | Expiration time (cleanup removes expired) |

---

### agent_contexts

Agent state snapshots for recovery after compaction.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | UUID | PRIMARY KEY | `gen_random_uuid()` | Unique identifier |
| `project_id` | UUID | FK -> projects(id) ON DELETE CASCADE | -- | Project scope |
| `agent_id` | TEXT | NOT NULL, UNIQUE(project_id, agent_id) | -- | Agent instance ID |
| `agent_type` | TEXT | NOT NULL | -- | Agent type |
| `role_context` | JSONB | NOT NULL | -- | Role-specific context data |
| `skills_to_restore` | TEXT[] | -- | NULL | Skills to reload |
| `tools_used` | TEXT[] | -- | NULL | Tools this agent has used |
| `progress_summary` | TEXT | -- | NULL | Text summary of progress |
| `last_updated` | TIMESTAMPTZ | -- | `NOW()` | Last update (auto-trigger) |

**Trigger:** `update_contexts_updated_at` sets `last_updated = NOW()` on every UPDATE.

---

### agent_registry

Registry of available agent types with their scopes and constraints.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `agent_type` | TEXT | PRIMARY KEY | -- | Agent type identifier |
| `category` | TEXT | NOT NULL | -- | Category (backend, frontend, testing, etc.) |
| `display_name` | TEXT | -- | NULL | Human-readable name |
| `default_scope` | JSONB | NOT NULL | `'{}'` | Default scope definition |
| `allowed_tools` | TEXT[] | -- | NULL | Tools this agent may use |
| `forbidden_actions` | TEXT[] | -- | NULL | Actions this agent must not perform |
| `max_files` | INTEGER | -- | 5 | Maximum files the agent may touch |
| `wave_assignments` | INTEGER[] | -- | NULL | Waves this agent operates in |
| `recommended_model` | TEXT | -- | `'sonnet'` | Recommended Claude model |
| `created_at` | TIMESTAMPTZ | -- | `NOW()` | Registration timestamp |

---

### agent_capacity

Context window capacity tracking per agent.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `agent_id` | TEXT | PRIMARY KEY | -- | Agent instance ID |
| `session_id` | TEXT | -- | `''` | Associated session |
| `max_capacity` | INTEGER | -- | 200000 | Maximum token capacity |
| `current_usage` | INTEGER | -- | 0 | Current estimated usage |
| `consumption_rate` | REAL | -- | 0 | Tokens per tool call |
| `predicted_exhaustion_minutes` | REAL | -- | NULL | Predicted time to exhaustion |
| `last_compact_at` | TIMESTAMPTZ | -- | NULL | Last compaction time |
| `compact_count` | INTEGER | -- | 0 | Number of compactions |
| `zone` | TEXT | -- | `'green'` | Capacity zone: green, yellow, orange, red |
| `created_at` | TIMESTAMPTZ | -- | `NOW()` | Creation timestamp |
| `last_updated_at` | TIMESTAMPTZ | -- | `NOW()` | Last update timestamp |
| `real_input_tokens` | BIGINT | -- | 0 | Real input tokens (from statusline) |
| `real_output_tokens` | BIGINT | -- | 0 | Real output tokens (from statusline) |
| `model_id` | TEXT | -- | NULL | Claude model identifier |
| `source` | TEXT | -- | `'estimated'` | Data source: estimated or statusline |
| `last_statusline_at` | TIMESTAMPTZ | -- | NULL | Last statusline data timestamp |

---

### token_consumption

Per-tool-call token consumption records.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | UUID | PRIMARY KEY | `gen_random_uuid()` | Unique identifier |
| `agent_id` | TEXT | NOT NULL | -- | Agent instance ID |
| `session_id` | TEXT | NOT NULL | -- | Session ID |
| `tool_name` | TEXT | NOT NULL | -- | Tool that consumed tokens |
| `input_tokens` | INTEGER | NOT NULL | 0 | Input tokens consumed |
| `output_tokens` | INTEGER | NOT NULL | 0 | Output tokens consumed |
| `total_tokens` | INTEGER | NOT NULL | 0 | Total tokens consumed |
| `consumed_at` | TIMESTAMPTZ | -- | `NOW()` | Consumption timestamp |

---

### wave_states

Wave execution state tracking for orchestration.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | UUID | PRIMARY KEY | `gen_random_uuid()` | Unique identifier |
| `session_id` | TEXT | NOT NULL, UNIQUE(session_id, wave_number) | -- | Session ID |
| `wave_number` | INTEGER | NOT NULL, CHECK >= 0 | -- | Wave sequence number |
| `status` | TEXT | -- | `'pending'` | Status: pending, running, completed |
| `total_tasks` | INTEGER | -- | 0 | Total tasks in this wave |
| `completed_tasks` | INTEGER | -- | 0 | Completed tasks |
| `failed_tasks` | INTEGER | -- | 0 | Failed tasks |
| `started_at` | TIMESTAMPTZ | -- | NULL | Start timestamp |
| `completed_at` | TIMESTAMPTZ | -- | NULL | Completion timestamp |

---

### preemptive_summaries

Pre-generated context summaries produced before compaction by headless agents.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | UUID | PRIMARY KEY | `gen_random_uuid()` | Unique identifier |
| `session_id` | TEXT | NOT NULL | -- | Session ID |
| `agent_id` | TEXT | -- | NULL | Agent that generated the summary |
| `summary` | TEXT | NOT NULL | -- | Generated summary text |
| `source` | TEXT | -- | `'headless-agent'` | Generation source |
| `context_tokens_at_trigger` | BIGINT | -- | NULL | Token count when triggered |
| `status` | TEXT | -- | `'ready'` | Status: generating, ready, consumed |
| `created_at` | TIMESTAMPTZ | -- | `NOW()` | Creation timestamp |
| `consumed_at` | TIMESTAMPTZ | -- | NULL | When the summary was used |

---

### calibration_ratios

Calibration data between real token counts (from statusline) and estimated counts (from hooks).

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | UUID | PRIMARY KEY | `gen_random_uuid()` | Unique identifier |
| `session_id` | TEXT | NOT NULL | -- | Session ID |
| `ratio` | FLOAT | NOT NULL | 1.0 | Real/estimated ratio |
| `real_tokens` | BIGINT | NOT NULL | -- | Real token count |
| `estimated_tokens` | BIGINT | NOT NULL | -- | Estimated token count |
| `calculated_at` | TIMESTAMPTZ | -- | `NOW()` | Calculation timestamp |

---

### schema_version

Database migration tracking.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `version` | TEXT | PRIMARY KEY | -- | Version string |
| `applied_at` | TIMESTAMPTZ | -- | `NOW()` | When applied |

---

## Views

### v_actions_full

Complete action view with full hierarchy. Joins actions through subtasks, task_lists, requests, and projects.

**Key columns:** `action_id`, `tool_name`, `tool_type`, `exit_code`, `duration_ms`, `file_paths`, `action_created_at`, `subtask_id`, `agent_type`, `agent_id`, `subtask_description`, `subtask_status`, `task_list_id`, `task_list_name`, `wave_number`, `request_id`, `prompt`, `prompt_type`, `session_id`, `project_id`, `project_path`, `project_name`

**Use case:** Full audit trail queries, dashboard activity feeds.

---

### v_active_agents

Currently running agents with their hierarchy context.

**Filter:** `subtasks.status IN ('running', 'paused', 'blocked')`

**Key columns:** `subtask_id`, `priority`, `project_id`, `project_name`, `project_path`, `agent_type`, `agent_id`, `parent_agent_id`, `status`, `description`, `started_at`, `created_at`, `session_id`, `request_id`, `actions_count`

**Use case:** Dashboard agent monitoring, active session detection.

---

### v_unread_messages

Messages that have not expired, ordered by priority and creation time.

**Filter:** `expires_at IS NULL OR expires_at > NOW()`

**Key columns:** All columns from `agent_messages` plus `project_name` from the projects join.

**Use case:** Inter-agent message delivery, notification feeds.

---

### v_project_stats

Aggregated statistics per project.

**Key columns:** `project_id`, `project_name`, `path`, `total_requests`, `total_subtasks`, `total_actions`, `successful_actions`, `avg_duration_ms`, `last_activity`

**Use case:** Dashboard project cards, project comparison.

---

## Entity Relationships

```
project (path)
  |
  |-- 1:N --> session (project_id FK)
  |
  |-- 1:N --> request (project_id FK, session_id)
  |             |
  |             |-- 1:N --> task_list (request_id FK)
  |                           |
  |                           |-- 1:N --> subtask (task_list_id FK)
  |                                         |
  |                                         |-- 1:N --> action (subtask_id FK)
  |                                         |
  |                                         |-- N:1 --> orchestration_batch (batch_id FK)
  |
  |-- 1:N --> agent_message (project_id FK)
  |
  |-- 1:N --> agent_context (project_id FK)

orchestration_batch (session_id)
  |
  |-- 1:N --> subtask (batch_id FK)

wave_states (session_id, wave_number)

agent_capacity (agent_id)

token_consumption (agent_id, session_id)

keyword_tool_scores (keyword, tool_name)

preemptive_summaries (session_id)

calibration_ratios (session_id)

schema_version (version)
```

**Cascade deletions:** Deleting a project cascades through requests, task_lists, subtasks, actions, messages, and contexts. Deleting an orchestration batch sets `batch_id = NULL` on subtasks (SET NULL).

---

## Indexes

### B-tree indexes

| Table | Index name | Column(s) |
|-------|-----------|------------|
| requests | `idx_requests_project` | `project_id` |
| requests | `idx_requests_session` | `session_id` |
| requests | `idx_requests_status` | `status` |
| subtasks | `idx_subtasks_status` | `status` |
| subtasks | `idx_subtasks_agent` | `agent_type, agent_id` |
| subtasks | `idx_subtasks_task_list` | `task_list_id` |
| subtasks | `idx_subtasks_batch` | `batch_id` |
| subtasks | `idx_subtasks_parent` | `parent_agent_id` |
| subtasks | `idx_subtasks_priority` | `priority DESC` |
| actions | `idx_actions_tool` | `tool_name` |
| actions | `idx_actions_created` | `created_at DESC` |
| actions | `idx_actions_subtask` | `subtask_id` |
| actions | `idx_actions_tool_type` | `tool_type` |
| actions | `idx_actions_session_id` | `session_id, created_at DESC` |
| agent_messages | `idx_messages_project` | `project_id` |
| agent_messages | `idx_messages_to` | `to_agent_id` |
| agent_messages | `idx_messages_topic` | `topic` |
| agent_messages | `idx_messages_created` | `created_at DESC` |
| keyword_tool_scores | `idx_keyword_scores` | `keyword` |
| keyword_tool_scores | `idx_keyword_tool` | `tool_name` |
| agent_contexts | `idx_contexts_agent` | `project_id, agent_type` |
| agent_contexts | `idx_contexts_agent_id` | `agent_id` |
| sessions | `idx_sessions_project` | `project_id` |
| sessions | `idx_sessions_started` | `started_at DESC` |
| agent_registry | `idx_agent_registry_type` | `agent_type` |
| agent_registry | `idx_registry_category` | `category` |
| agent_capacity | `idx_agent_capacity_session` | `session_id` |
| agent_capacity | `idx_agent_capacity_zone` | `zone` |
| token_consumption | `idx_token_consumption_agent` | `agent_id` |
| token_consumption | `idx_token_consumption_session` | `session_id` |
| token_consumption | `idx_token_agent` | `agent_id, session_id, consumed_at DESC` |
| orchestration_batches | `idx_batches_session` | `session_id, created_at DESC` |
| orchestration_batches | `idx_batches_status` | `status` |
| wave_states | `idx_waves_session` | `session_id, wave_number` |
| preemptive_summaries | `idx_preemptive_session_status` | `session_id, status` |
| preemptive_summaries | `idx_preemptive_created` | `created_at DESC` |
| calibration_ratios | `idx_calibration_session` | `session_id, calculated_at DESC` |

### GIN indexes (JSONB)

| Table | Index name | Column |
|-------|-----------|--------|
| projects | `idx_projects_metadata` | `metadata` |
| requests | `idx_requests_metadata` | `metadata` |
| actions | `idx_actions_metadata` | `metadata` |
| agent_messages | `idx_messages_payload` | `payload` |
| agent_contexts | `idx_contexts_role` | `role_context` |

---

## Functions and Triggers

### update_updated_at_column()

Trigger function that sets the `updated_at` (or `last_updated`) column to `NOW()` on every UPDATE.

**Applied to:**

| Table | Trigger name | Column affected |
|-------|-------------|-----------------|
| projects | `update_projects_updated_at` | `updated_at` |
| agent_contexts | `update_contexts_updated_at` | `last_updated` |

---

## Migrations

Located in `context-manager/src/db/migrations/`:

| File | Description |
|------|-------------|
| `003_proactive_triage.sql` | Adds preemptive_summaries and calibration_ratios tables |
| `004_bugfix_constraints.sql` | Fixes constraint issues |
| `005_agent_hierarchy.sql` | Adds parent_agent_id to subtasks |
| `006_agent_turns_tracking.sql` | Adds turn tracking fields |
| `006_v4_context.sql` | Adds v4 context fields (real tokens, model_id) |
| `007_actions_session_id.sql` | Adds session_id column to actions table |

The main `schema.sql` uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`, making it idempotent and safe to re-run at any time.
