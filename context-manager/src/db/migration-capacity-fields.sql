-- Extended capacity fields — DCM v5.5.0

ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS model_name TEXT;
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS version TEXT;
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS cache_creation_tokens BIGINT DEFAULT 0;
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS cache_read_tokens BIGINT DEFAULT 0;
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS cost_usd DOUBLE PRECISION DEFAULT 0;
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS duration_ms BIGINT DEFAULT 0;
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS api_duration_ms BIGINT DEFAULT 0;
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS lines_added INTEGER DEFAULT 0;
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS lines_removed INTEGER DEFAULT 0;
ALTER TABLE agent_capacity ADD COLUMN IF NOT EXISTS exceeds_200k BOOLEAN DEFAULT false;

INSERT INTO schema_version (version) VALUES ('5.5.0') ON CONFLICT (version) DO NOTHING;
