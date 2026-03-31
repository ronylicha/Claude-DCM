-- Pipeline Sprints & Workspace — DCM v5.2.0

-- Add workspace and git columns to pipelines
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS workspace_path TEXT;
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS git_repo_url TEXT;
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS git_branch TEXT DEFAULT 'main';
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS git_initialized BOOLEAN NOT NULL DEFAULT false;

-- Sprint tracking table
CREATE TABLE IF NOT EXISTS pipeline_sprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    sprint_number INTEGER NOT NULL,
    name TEXT NOT NULL,
    objectives TEXT[] NOT NULL DEFAULT '{}',
    wave_start INTEGER NOT NULL,
    wave_end INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    commit_sha TEXT,
    pr_url TEXT,
    report JSONB,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_sprint_status CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
    CONSTRAINT chk_sprint_waves CHECK (wave_start >= 0 AND wave_end >= wave_start),
    UNIQUE(pipeline_id, sprint_number)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_sprints_pipeline ON pipeline_sprints(pipeline_id, sprint_number);
CREATE INDEX IF NOT EXISTS idx_pipeline_sprints_status ON pipeline_sprints(status);

COMMENT ON TABLE pipeline_sprints IS 'Sprint tracking within pipelines with git integration';

INSERT INTO schema_version (version) VALUES ('5.2.0') ON CONFLICT (version) DO NOTHING;
