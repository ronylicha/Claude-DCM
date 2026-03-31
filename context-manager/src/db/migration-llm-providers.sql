-- LLM Providers — DCM v5.3.0

CREATE TABLE IF NOT EXISTS llm_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_key TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    base_url TEXT NOT NULL,
    endpoint_path TEXT NOT NULL DEFAULT '/chat/completions',
    default_model TEXT NOT NULL,
    available_models TEXT[] NOT NULL DEFAULT '{}',
    api_key_encrypted TEXT,
    is_active BOOLEAN NOT NULL DEFAULT false,
    is_default BOOLEAN NOT NULL DEFAULT false,
    config JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_llm_providers_key ON llm_providers(provider_key);
CREATE INDEX IF NOT EXISTS idx_llm_providers_active ON llm_providers(is_active);

-- Seed the 3 providers (without API keys — user adds them later)
INSERT INTO llm_providers (provider_key, display_name, base_url, endpoint_path, default_model, available_models, config) VALUES
  ('minimax', 'MiniMax', 'https://api.minimax.io/v1', '/chat/completions', 'MiniMax-M2.7', ARRAY['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5'], '{"temperature": 1.0}'::jsonb),
  ('zhipuai', 'ZhipuAI (GLM)', 'https://api.z.ai/api', '/paas/v4/chat/completions', 'glm-5-turbo', ARRAY['glm-5', 'glm-5-turbo', 'glm-4.7', 'glm-4.7-flash'], '{}'::jsonb),
  ('moonshot', 'Moonshot (Kimi)', 'https://api.moonshot.ai/v1', '/chat/completions', 'kimi-k2.5', ARRAY['kimi-k2.5', 'kimi-k2-thinking'], '{}'::jsonb)
ON CONFLICT (provider_key) DO NOTHING;

DROP TRIGGER IF EXISTS update_llm_providers_updated_at ON llm_providers;
CREATE TRIGGER update_llm_providers_updated_at BEFORE UPDATE ON llm_providers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE llm_providers IS 'LLM provider configurations with encrypted API keys';

INSERT INTO schema_version (version) VALUES ('5.3.0') ON CONFLICT (version) DO NOTHING;
