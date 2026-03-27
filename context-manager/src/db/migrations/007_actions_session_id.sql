-- DCM v4.1 Migration: Add session_id to actions table
-- Fix: actions were orphaned (subtask_id NULL) because track-action.sh
-- never resolved the active subtask. The cleanup then thought sessions
-- were inactive and closed them.
--
-- Root cause chain:
--   track-action.sh sends action WITHOUT subtask_id
--   → action.subtask_id = NULL
--   → cleanup JOIN subtasks ON a.subtask_id = st.id misses it
--   → cleanup thinks session is inactive → closes it
--
-- Fix:
--   1. Add session_id column to actions (direct, no JOIN needed)
--   2. track-action.sh resolves subtask_id from cache AND sends session_id
--   3. cleanup uses session_id as fallback when subtask_id is NULL
-- Version: 4.1.0
-- Date: 2026-03-27

-- 1. Add session_id column
ALTER TABLE actions ADD COLUMN IF NOT EXISTS session_id TEXT;

-- 2. Index for cleanup and session-based queries
CREATE INDEX IF NOT EXISTS idx_actions_session_id
  ON actions(session_id, created_at DESC);

-- 3. Backfill from metadata JSONB (existing actions stored session_id there)
UPDATE actions
SET session_id = metadata->>'session_id'
WHERE session_id IS NULL
  AND metadata->>'session_id' IS NOT NULL
  AND metadata->>'session_id' != '';

-- 4. Backfill from subtask chain for linked actions
UPDATE actions a
SET session_id = r.session_id
FROM subtasks st
JOIN task_lists tl ON st.task_list_id = tl.id
JOIN requests r ON tl.request_id = r.id
WHERE a.subtask_id = st.id
  AND a.session_id IS NULL;

-- 5. Update schema version
INSERT INTO schema_version (version) VALUES ('4.1.0')
ON CONFLICT (version) DO NOTHING;
