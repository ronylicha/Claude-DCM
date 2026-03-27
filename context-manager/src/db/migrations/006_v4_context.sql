-- DCM v4.0 Migration: Real-time tokens, preemptive summaries, calibration
-- Migration: 006_v4_context.sql
-- Created: 2026-03-27

-- ============================================
-- ALTER: agent_capacity
-- Add real token tracking columns (statusline source)
-- ============================================
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS real_input_tokens BIGINT DEFAULT 0;
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS real_output_tokens BIGINT DEFAULT 0;
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS model_id TEXT;
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'estimated';  -- 'estimated' | 'statusline'
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS last_statusline_at TIMESTAMPTZ;

-- ============================================
-- CREATE: preemptive_summaries
-- Pre-generated context summaries before compaction
-- ============================================
CREATE TABLE IF NOT EXISTS preemptive_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    agent_id TEXT,
    summary TEXT NOT NULL,
    source TEXT DEFAULT 'headless-agent',
    context_tokens_at_trigger BIGINT,
    status TEXT DEFAULT 'ready',  -- 'generating' | 'ready' | 'consumed'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    consumed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_preemptive_session_status
    ON preemptive_summaries(session_id, status);

CREATE INDEX IF NOT EXISTS idx_preemptive_created
    ON preemptive_summaries(created_at DESC);

COMMENT ON TABLE preemptive_summaries IS 'Pre-generated context summaries before compaction via headless agent';

-- ============================================
-- CREATE: calibration_ratios
-- Real vs estimated token ratio for sub-agent calibration
-- ============================================
CREATE TABLE IF NOT EXISTS calibration_ratios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    ratio FLOAT NOT NULL DEFAULT 1.0,
    real_tokens BIGINT NOT NULL,
    estimated_tokens BIGINT NOT NULL,
    calculated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_calibration_session
    ON calibration_ratios(session_id, calculated_at DESC);

COMMENT ON TABLE calibration_ratios IS 'Calibration ratio between real (statusline) and estimated (hooks) tokens';

-- ============================================
-- Update schema version
-- ============================================
INSERT INTO schema_version (version) VALUES ('4.0.0')
ON CONFLICT (version) DO NOTHING;
