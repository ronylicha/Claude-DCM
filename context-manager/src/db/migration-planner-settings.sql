-- Planner Settings & Streaming — DCM v5.4.0

-- Add planner configuration to llm_providers
ALTER TABLE llm_providers ADD COLUMN IF NOT EXISTS can_plan BOOLEAN NOT NULL DEFAULT true;

-- Add CLI-based planners
INSERT INTO llm_providers (provider_key, display_name, base_url, endpoint_path, default_model, available_models, config, can_plan) VALUES
  ('claude-cli', 'Claude CLI (Opus)', 'cli://claude', '-p', 'claude-opus-4-6', ARRAY['claude-opus-4-6', 'claude-sonnet-4-6'], '{"type": "cli", "command": "claude"}'::jsonb, true),
  ('codex-cli', 'Codex CLI (OpenAI)', 'cli://codex', '-p', 'gpt-5.4', ARRAY['gpt-5.4', 'gpt-5.3-codex', 'gpt-5.3-codex-spark', 'gpt-5.4-mini'], '{"type": "cli", "command": "codex"}'::jsonb, true),
  ('gemini-cli', 'Gemini CLI (Google)', 'cli://gemini', '-p', 'gemini-3.1-pro', ARRAY['gemini-3.1-pro', 'gemini-3.0-pro', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'], '{"type": "cli", "command": "gemini"}'::jsonb, true)
ON CONFLICT (provider_key) DO NOTHING;

-- CLI providers are always active (no API key needed — auth via CLI login)
UPDATE llm_providers SET is_active = true WHERE provider_key IN ('claude-cli', 'codex-cli', 'gemini-cli');

-- Planner settings (which provider to use for planning)
CREATE TABLE IF NOT EXISTS dcm_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO dcm_settings (key, value) VALUES
  ('planner', '{"provider_key": null, "timeout_ms": 0}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Planning output log (for live streaming)
CREATE TABLE IF NOT EXISTS planning_output (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_id UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    chunk TEXT NOT NULL,
    chunk_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planning_output_pipeline ON planning_output(pipeline_id, chunk_index);

COMMENT ON TABLE planning_output IS 'Live streaming chunks from LLM planner output';
COMMENT ON TABLE dcm_settings IS 'Global DCM configuration key-value store';

INSERT INTO schema_version (version) VALUES ('5.4.0') ON CONFLICT (version) DO NOTHING;
