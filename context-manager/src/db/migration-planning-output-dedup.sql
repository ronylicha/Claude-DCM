-- Deduplicate planning_output chunks
DELETE FROM planning_output a USING planning_output b
WHERE a.id > b.id AND a.pipeline_id = b.pipeline_id AND a.chunk_index = b.chunk_index;

-- Unique index to prevent future duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_planning_output_no_dup
ON planning_output (pipeline_id, chunk_index);
