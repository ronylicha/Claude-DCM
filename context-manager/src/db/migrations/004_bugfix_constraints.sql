-- DCM v3.0.1 - Bugfix: Missing constraints, indexes, CASCADE
-- Migration: 004_bugfix_constraints.sql

-- Fix: sessions.project_id missing ON DELETE CASCADE
-- (Cannot ALTER existing FK constraint, must drop and recreate)
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_project_id_fkey;
ALTER TABLE sessions ADD CONSTRAINT sessions_project_id_fkey 
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

-- Fix: subtasks.batch_id missing ON DELETE SET NULL (from migration 003)
ALTER TABLE subtasks DROP CONSTRAINT IF EXISTS subtasks_batch_id_fkey;
ALTER TABLE subtasks ADD CONSTRAINT subtasks_batch_id_fkey 
  FOREIGN KEY (batch_id) REFERENCES orchestration_batches(id) ON DELETE SET NULL;

-- Fix: Missing indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_agent_capacity_session ON agent_capacity(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_capacity_zone ON agent_capacity(zone);
CREATE INDEX IF NOT EXISTS idx_token_consumption_agent ON token_consumption(agent_id);
CREATE INDEX IF NOT EXISTS idx_token_consumption_session ON token_consumption(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_registry_type ON agent_registry(agent_type);

-- Fix: wave_states missing check constraints
ALTER TABLE wave_states ADD CONSTRAINT chk_wave_number_positive CHECK (wave_number >= 0);
ALTER TABLE orchestration_batches ADD CONSTRAINT chk_wave_number_positive CHECK (wave_number >= 0);

-- Fix: agent_capacity.session_id default '' should be NULL-able
-- Keep backwards compat: don't change default, but allow NULL
ALTER TABLE agent_capacity ALTER COLUMN session_id DROP NOT NULL;

-- Schema version
INSERT INTO schema_version (version) VALUES ('3.0.1')
ON CONFLICT (version) DO NOTHING;
