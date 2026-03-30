-- Migration: Add Skill Gate tables
-- Part of DCM v4.2 — Skill Gate integration
-- Run: psql $DB_NAME < src/db/migrations/add-skill-gate.sql

-- 1. Skills loaded per session
CREATE TABLE IF NOT EXISTS session_skills (
    session_id TEXT NOT NULL,
    skill_name TEXT NOT NULL,
    loaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, skill_name)
);
CREATE INDEX IF NOT EXISTS idx_session_skills_session ON session_skills(session_id);
CREATE INDEX IF NOT EXISTS idx_session_skills_name    ON session_skills(skill_name);

-- 2. Workflow state per session
CREATE TABLE IF NOT EXISTS session_workflow_state (
    session_id         TEXT PRIMARY KEY,
    task_size          TEXT NOT NULL DEFAULT 'unknown',
    impact_analyzer    BOOLEAN NOT NULL DEFAULT false,
    regression_guard   BOOLEAN NOT NULL DEFAULT false,
    skills_loaded      INTEGER NOT NULL DEFAULT 0,
    advisor_reco       JSONB,
    advisor_updated_at TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Schema version
INSERT INTO schema_version (version) VALUES ('4.2.0')
ON CONFLICT (version) DO NOTHING;
