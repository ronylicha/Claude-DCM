-- Pipeline Engine Tables — DCM v5.1.0
-- Migration: Add pipelines, pipeline_steps, pipeline_events tables

-- ============================================
-- TABLE: pipelines
-- Execution pipelines with auto-generated plans
-- ============================================
CREATE TABLE IF NOT EXISTS pipelines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    name TEXT,
    status TEXT NOT NULL DEFAULT 'planning',
    input JSONB NOT NULL,
    plan JSONB,
    current_wave INTEGER NOT NULL DEFAULT 0,
    config JSONB NOT NULL DEFAULT '{"max_retries": 2, "strategy": "adaptive", "parallel_limit": 5}',
    synthesis JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_pipeline_status CHECK (
        status IN ('planning', 'ready', 'running', 'paused', 'completed', 'failed', 'cancelled')
    )
);

-- ============================================
-- TABLE: pipeline_steps
-- Individual agent steps within pipeline waves
-- ============================================
CREATE TABLE IF NOT EXISTS pipeline_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    wave_number INTEGER NOT NULL,
    step_order INTEGER NOT NULL,
    agent_type TEXT NOT NULL,
    description TEXT,
    skills TEXT[],
    prompt TEXT,
    model TEXT NOT NULL DEFAULT 'sonnet',
    max_turns INTEGER NOT NULL DEFAULT 10,
    status TEXT NOT NULL DEFAULT 'pending',
    subtask_id UUID REFERENCES subtasks(id) ON DELETE SET NULL,
    result JSONB,
    error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    retry_strategy TEXT NOT NULL DEFAULT 'enhanced',
    max_retries INTEGER NOT NULL DEFAULT 2,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_step_status CHECK (
        status IN ('pending', 'queued', 'running', 'completed', 'failed', 'retrying', 'skipped', 'blocked')
    ),
    CONSTRAINT chk_step_wave CHECK (wave_number >= 0),
    CONSTRAINT chk_step_order CHECK (step_order >= 0),
    UNIQUE(pipeline_id, wave_number, step_order)
);

-- ============================================
-- TABLE: pipeline_events
-- Timeline events for pipeline execution
-- ============================================
CREATE TABLE IF NOT EXISTS pipeline_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    wave_number INTEGER,
    step_order INTEGER,
    agent_type TEXT,
    message TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX IF NOT EXISTS idx_pipelines_session ON pipelines(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipelines_status ON pipelines(status);

CREATE INDEX IF NOT EXISTS idx_pipeline_steps_pipeline ON pipeline_steps(pipeline_id, wave_number, step_order);
CREATE INDEX IF NOT EXISTS idx_pipeline_steps_status ON pipeline_steps(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_steps_subtask ON pipeline_steps(subtask_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_events_pipeline ON pipeline_events(pipeline_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pipeline_events_type ON pipeline_events(event_type);

CREATE INDEX IF NOT EXISTS idx_pipelines_input ON pipelines USING GIN (input);
CREATE INDEX IF NOT EXISTS idx_pipelines_plan ON pipelines USING GIN (plan);

-- ============================================
-- TRIGGER: auto-update updated_at on pipelines
-- ============================================
DROP TRIGGER IF EXISTS update_pipelines_updated_at ON pipelines;
CREATE TRIGGER update_pipelines_updated_at
    BEFORE UPDATE ON pipelines
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE pipelines IS 'Execution pipelines with auto-generated multi-wave plans';
COMMENT ON TABLE pipeline_steps IS 'Individual agent steps within pipeline waves';
COMMENT ON TABLE pipeline_events IS 'Timeline events tracking pipeline execution history';

-- Schema version
INSERT INTO schema_version (version) VALUES ('5.1.0')
ON CONFLICT (version) DO NOTHING;
