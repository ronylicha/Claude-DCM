-- DCM v3.2.0 - Agent Turns Tracking: turns_used, max_turns, relaunch support
-- Migration: 006_agent_turns_tracking.sql

-- Add turns tracking columns to subtasks
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS turns_used INTEGER DEFAULT 0;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS max_turns INTEGER;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS last_relaunch_context TEXT;

-- Index for fast lookup of running agents by agent_id
CREATE INDEX IF NOT EXISTS idx_subtasks_agent_id_status ON subtasks(agent_id, status);

-- Update schema version
INSERT INTO schema_version (version) VALUES ('3.2.0')
ON CONFLICT (version) DO NOTHING;

COMMENT ON COLUMN subtasks.turns_used IS 'Number of tool calls consumed by this agent';
COMMENT ON COLUMN subtasks.max_turns IS 'Maximum turns budget for this agent (from complexity tier)';
COMMENT ON COLUMN subtasks.last_relaunch_context IS 'Compacted context from previous attempt for relaunch';
