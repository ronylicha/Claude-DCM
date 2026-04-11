-- Add missing updated_at column to pipeline_steps
-- Referenced by worker.checkOrphanRunningSteps and other UPDATE paths
-- that expect updated_at to track when a row was last modified.

ALTER TABLE pipeline_steps
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Auto-update trigger (reuses shared update_updated_at_column() function
-- already defined for other tables like epic_sessions, projects, pipelines).
DROP TRIGGER IF EXISTS update_pipeline_steps_updated_at ON pipeline_steps;
CREATE TRIGGER update_pipeline_steps_updated_at
BEFORE UPDATE ON pipeline_steps
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Backfill existing rows with a sensible value (latest of started/completed/created)
UPDATE pipeline_steps
   SET updated_at = COALESCE(completed_at, started_at, created_at)
 WHERE updated_at IS NULL OR updated_at = created_at;

CREATE INDEX IF NOT EXISTS idx_pipeline_steps_updated_at
  ON pipeline_steps (updated_at DESC);
