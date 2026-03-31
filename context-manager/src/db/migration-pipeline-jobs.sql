-- Pipeline Jobs tracking — DCM v5.6.0
-- Tracks CLI planner/executor jobs for recovery after service restart

CREATE TABLE IF NOT EXISTS pipeline_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    step_id UUID REFERENCES pipeline_steps(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL,
    job_type TEXT NOT NULL DEFAULT 'planner',
    tmp_dir TEXT NOT NULL DEFAULT '/tmp/dcm-planner',
    status TEXT NOT NULL DEFAULT 'running',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_status ON pipeline_jobs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_pipeline ON pipeline_jobs(pipeline_id);

COMMENT ON TABLE pipeline_jobs IS 'Tracks detached CLI jobs for recovery after service restarts';

INSERT INTO schema_version (version) VALUES ('5.6.0') ON CONFLICT (version) DO NOTHING;
