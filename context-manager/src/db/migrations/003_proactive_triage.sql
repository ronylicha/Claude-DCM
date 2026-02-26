-- DCM v3.0 - Proactive Triage Station
-- Migration: 003_proactive_triage.sql
-- Created: 2026-02-09
--
-- New tables: token_consumption, agent_capacity, agent_registry,
--             orchestration_batches, wave_states
-- Altered tables: subtasks (add batch_id, priority, retry_count)

-- ============================================
-- TABLE: token_consumption
-- Suivi consommation tokens par agent
-- ============================================
CREATE TABLE IF NOT EXISTS token_consumption (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    consumed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_agent ON token_consumption(agent_id, session_id, consumed_at DESC);

-- ============================================
-- TABLE: agent_capacity
-- Capacite contexte par agent
-- ============================================
CREATE TABLE IF NOT EXISTS agent_capacity (
    agent_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL DEFAULT '',
    max_capacity INTEGER DEFAULT 200000,
    current_usage INTEGER DEFAULT 0,
    consumption_rate REAL DEFAULT 0,
    predicted_exhaustion_minutes REAL,
    last_compact_at TIMESTAMPTZ,
    compact_count INTEGER DEFAULT 0,
    zone TEXT DEFAULT 'green',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE: agent_registry
-- Registre des agents avec scopes par defaut
-- ============================================
CREATE TABLE IF NOT EXISTS agent_registry (
    agent_type TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    display_name TEXT,
    default_scope JSONB NOT NULL DEFAULT '{}',
    allowed_tools TEXT[],
    forbidden_actions TEXT[],
    max_files INTEGER DEFAULT 5,
    wave_assignments INTEGER[],
    recommended_model TEXT DEFAULT 'sonnet',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_registry_category ON agent_registry(category);

-- ============================================
-- TABLE: orchestration_batches
-- Batch de taches soumis par l'orchestrateur
-- ============================================
CREATE TABLE IF NOT EXISTS orchestration_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    wave_number INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    total_tasks INTEGER DEFAULT 0,
    completed_tasks INTEGER DEFAULT 0,
    failed_tasks INTEGER DEFAULT 0,
    synthesis JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_batches_session ON orchestration_batches(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batches_status ON orchestration_batches(status);

-- ============================================
-- TABLE: wave_states
-- Etat des waves par session
-- ============================================
CREATE TABLE IF NOT EXISTS wave_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    wave_number INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    total_tasks INTEGER DEFAULT 0,
    completed_tasks INTEGER DEFAULT 0,
    failed_tasks INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    UNIQUE(session_id, wave_number)
);

CREATE INDEX IF NOT EXISTS idx_waves_session ON wave_states(session_id, wave_number);

-- ============================================
-- ALTER: subtasks
-- Add batch_id, priority, retry_count
-- ============================================
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES orchestration_batches(id);
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 5;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_subtasks_batch ON subtasks(batch_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_priority ON subtasks(priority DESC);

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE token_consumption IS 'Token consumption tracking per agent per tool call';
COMMENT ON TABLE agent_capacity IS 'Real-time capacity tracking with exhaustion prediction';
COMMENT ON TABLE agent_registry IS 'Agent type registry with default scopes and constraints';
COMMENT ON TABLE orchestration_batches IS 'Batch task submissions from orchestrator';
COMMENT ON TABLE wave_states IS 'Wave state machine tracking per session';

-- Schema version
INSERT INTO schema_version (version) VALUES ('3.0.0')
ON CONFLICT (version) DO NOTHING;
