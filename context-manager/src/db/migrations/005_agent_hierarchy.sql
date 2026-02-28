-- DCM v3.1.0 - Agent Hierarchy: parent_agent_id, session/compact tracking
-- Migration: 005_agent_hierarchy.sql

-- Add parent_agent_id to subtasks for agent/subagent hierarchy
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS parent_agent_id TEXT;

-- Add session_id and compact_id to agent_contexts for snapshot lookups
ALTER TABLE agent_contexts ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE agent_contexts ADD COLUMN IF NOT EXISTS compact_id TEXT;

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_subtasks_parent ON subtasks(parent_agent_id);
CREATE INDEX IF NOT EXISTS idx_contexts_session ON agent_contexts(session_id);
CREATE INDEX IF NOT EXISTS idx_contexts_compact ON agent_contexts(compact_id);

-- Recreate v_active_agents view with parent_agent_id
DROP VIEW IF EXISTS v_active_agents;
CREATE VIEW v_active_agents AS
SELECT
    s.id AS subtask_id,
    p.id AS project_id,
    p.name AS project_name,
    p.path AS project_path,
    s.agent_type,
    s.agent_id,
    s.parent_agent_id,
    s.status,
    s.description,
    s.started_at,
    s.created_at,
    r.session_id,
    r.id AS request_id,
    COUNT(a.id) AS actions_count
FROM subtasks s
JOIN task_lists tl ON s.task_list_id = tl.id
JOIN requests r ON tl.request_id = r.id
LEFT JOIN projects p ON r.project_id = p.id
LEFT JOIN actions a ON a.subtask_id = s.id
WHERE s.status IN ('running', 'paused', 'blocked')
GROUP BY s.id, p.id, p.name, p.path, s.agent_type, s.agent_id, s.parent_agent_id,
         s.status, s.description, s.started_at, s.created_at, r.session_id, r.id;
