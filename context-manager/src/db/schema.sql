-- Distributed Context Manager - Schema PostgreSQL
-- Version: 3.1.0
-- Created: 2026-01-30
-- Updated: 2026-02-28

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- TABLE: projects
-- Projets (identifies par cwd)
-- ============================================
CREATE TABLE IF NOT EXISTS projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    path TEXT UNIQUE NOT NULL,
    name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- ============================================
-- TABLE: requests
-- Demandes utilisateur (prompts)
-- ============================================
CREATE TABLE IF NOT EXISTS requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    prompt TEXT NOT NULL,
    prompt_type TEXT,  -- feature, debug, explain, search, etc.
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'
);

-- ============================================
-- TABLE: task_lists
-- Listes de taches (waves d'objectifs)
-- ============================================
CREATE TABLE IF NOT EXISTS task_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id UUID REFERENCES requests(id) ON DELETE CASCADE,
    name TEXT,
    wave_number INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- ============================================
-- TABLE: orchestration_batches
-- Batches d'orchestration par wave
-- ============================================
CREATE TABLE IF NOT EXISTS orchestration_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    wave_number INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    total_tasks INTEGER DEFAULT 0,
    completed_tasks INTEGER DEFAULT 0,
    failed_tasks INTEGER DEFAULT 0,
    synthesis JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT chk_batch_wave_positive CHECK (wave_number >= 0)
);

-- ============================================
-- TABLE: subtasks
-- Sous-taches (objectifs dans une wave)
-- ============================================
CREATE TABLE IF NOT EXISTS subtasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_list_id UUID REFERENCES task_lists(id) ON DELETE CASCADE,
    agent_type TEXT,  -- backend-laravel, frontend-react, etc.
    agent_id TEXT,    -- ID unique de l'instance d'agent
    description TEXT,
    status TEXT DEFAULT 'pending',  -- pending, running, paused, blocked, completed, failed
    blocked_by UUID[],  -- IDs des subtasks bloquantes
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    context_snapshot JSONB,  -- Snapshot du contexte au demarrage
    result JSONB,
    batch_id UUID REFERENCES orchestration_batches(id) ON DELETE SET NULL,
    priority INTEGER DEFAULT 5,
    retry_count INTEGER DEFAULT 0,
    parent_agent_id TEXT
);

-- ============================================
-- TABLE: actions
-- Actions (appels d'outils)
-- ============================================
CREATE TABLE IF NOT EXISTS actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subtask_id UUID REFERENCES subtasks(id) ON DELETE CASCADE,
    tool_name TEXT NOT NULL,
    tool_type TEXT NOT NULL,  -- builtin, agent, skill, command, mcp
    input BYTEA,  -- Compresse avec pg_lz
    output BYTEA, -- Compresse avec pg_lz
    file_paths TEXT[],
    exit_code INTEGER DEFAULT 0,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- ============================================
-- TABLE: keyword_tool_scores
-- Tracking des keywords (migration de SQLite)
-- ============================================
CREATE TABLE IF NOT EXISTS keyword_tool_scores (
    id SERIAL PRIMARY KEY,
    keyword TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_type TEXT NOT NULL,
    score REAL DEFAULT 1.0,
    usage_count INTEGER DEFAULT 1,
    success_count INTEGER DEFAULT 1,
    last_used TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(keyword, tool_name)
);

-- ============================================
-- TABLE: agent_messages
-- Messages inter-agents (pub/sub)
-- ============================================
CREATE TABLE IF NOT EXISTS agent_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    from_agent_id TEXT,
    to_agent_id TEXT,  -- NULL = broadcast
    message_type TEXT NOT NULL,  -- info, request, response, notification
    topic TEXT,  -- api_endpoint_created, schema_updated, etc.
    payload JSONB NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    read_by TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

-- ============================================
-- TABLE: agent_contexts
-- Contextes d'agents (pour reprise apres compact)
-- ============================================
CREATE TABLE IF NOT EXISTS agent_contexts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    agent_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    role_context JSONB NOT NULL,  -- Contexte specifique au role
    skills_to_restore TEXT[],
    tools_used TEXT[],
    progress_summary TEXT,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(project_id, agent_id)
);

-- ============================================
-- TABLE: sessions
-- Sessions Claude Code
-- ============================================
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    project_id UUID REFERENCES projects(id),
    started_at TIMESTAMPTZ DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    total_tools_used INTEGER DEFAULT 0,
    total_success INTEGER DEFAULT 0,
    total_errors INTEGER DEFAULT 0
);

-- ============================================
-- TABLE: agent_registry
-- Registre des types d'agents disponibles
-- ============================================
CREATE TABLE IF NOT EXISTS agent_registry (
    agent_type TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    display_name TEXT,
    default_scope JSONB NOT NULL DEFAULT '{}',
    allowed_tools TEXT[],
    forbidden_actions TEXT[],
    max_files INTEGER DEFAULT 5,
    wave_assignments INTEGER[],
    recommended_model TEXT DEFAULT 'sonnet',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE: agent_capacity
-- Suivi de la capacite contexte des agents
-- ============================================
CREATE TABLE IF NOT EXISTS agent_capacity (
    agent_id TEXT PRIMARY KEY,
    session_id TEXT DEFAULT '',
    max_capacity INTEGER DEFAULT 200000,
    current_usage INTEGER DEFAULT 0,
    consumption_rate REAL DEFAULT 0,
    predicted_exhaustion_minutes REAL,
    last_compact_at TIMESTAMPTZ,
    compact_count INTEGER DEFAULT 0,
    zone TEXT DEFAULT 'green',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE: token_consumption
-- Consommation de tokens par agent
-- ============================================
CREATE TABLE IF NOT EXISTS token_consumption (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    consumed_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLE: wave_states
-- Etats des waves d'orchestration
-- ============================================
CREATE TABLE IF NOT EXISTS wave_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id TEXT NOT NULL,
    wave_number INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    total_tasks INTEGER DEFAULT 0,
    completed_tasks INTEGER DEFAULT 0,
    failed_tasks INTEGER DEFAULT 0,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    UNIQUE(session_id, wave_number),
    CONSTRAINT chk_wave_number_positive CHECK (wave_number >= 0)
);

-- ============================================
-- INDEXES pour performances
-- ============================================

-- Requests indexes
CREATE INDEX IF NOT EXISTS idx_requests_project ON requests(project_id);
CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);

-- Subtasks indexes
CREATE INDEX IF NOT EXISTS idx_subtasks_status ON subtasks(status);
CREATE INDEX IF NOT EXISTS idx_subtasks_agent ON subtasks(agent_type, agent_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_task_list ON subtasks(task_list_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_batch ON subtasks(batch_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_parent ON subtasks(parent_agent_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_priority ON subtasks(priority DESC);

-- Actions indexes
CREATE INDEX IF NOT EXISTS idx_actions_tool ON actions(tool_name);
CREATE INDEX IF NOT EXISTS idx_actions_created ON actions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_actions_subtask ON actions(subtask_id);
CREATE INDEX IF NOT EXISTS idx_actions_tool_type ON actions(tool_type);

-- Messages indexes
CREATE INDEX IF NOT EXISTS idx_messages_project ON agent_messages(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_to ON agent_messages(to_agent_id);
CREATE INDEX IF NOT EXISTS idx_messages_topic ON agent_messages(topic);
CREATE INDEX IF NOT EXISTS idx_messages_created ON agent_messages(created_at DESC);

-- Keyword scores indexes
CREATE INDEX IF NOT EXISTS idx_keyword_scores ON keyword_tool_scores(keyword);
CREATE INDEX IF NOT EXISTS idx_keyword_tool ON keyword_tool_scores(tool_name);

-- Contexts indexes
CREATE INDEX IF NOT EXISTS idx_contexts_agent ON agent_contexts(project_id, agent_type);
CREATE INDEX IF NOT EXISTS idx_contexts_agent_id ON agent_contexts(agent_id);

-- Sessions indexes
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);

-- Agent registry indexes
CREATE INDEX IF NOT EXISTS idx_agent_registry_type ON agent_registry(agent_type);
CREATE INDEX IF NOT EXISTS idx_registry_category ON agent_registry(category);

-- Agent capacity indexes
CREATE INDEX IF NOT EXISTS idx_agent_capacity_session ON agent_capacity(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_capacity_zone ON agent_capacity(zone);

-- Token consumption indexes
CREATE INDEX IF NOT EXISTS idx_token_consumption_agent ON token_consumption(agent_id);
CREATE INDEX IF NOT EXISTS idx_token_consumption_session ON token_consumption(session_id);
CREATE INDEX IF NOT EXISTS idx_token_agent ON token_consumption(agent_id, session_id, consumed_at DESC);

-- Orchestration batches indexes
CREATE INDEX IF NOT EXISTS idx_batches_session ON orchestration_batches(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batches_status ON orchestration_batches(status);

-- Wave states indexes
CREATE INDEX IF NOT EXISTS idx_waves_session ON wave_states(session_id, wave_number);

-- ============================================
-- JSONB GIN Indexes pour requetes complexes
-- ============================================
CREATE INDEX IF NOT EXISTS idx_projects_metadata ON projects USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_requests_metadata ON requests USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_actions_metadata ON actions USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_messages_payload ON agent_messages USING GIN (payload);
CREATE INDEX IF NOT EXISTS idx_contexts_role ON agent_contexts USING GIN (role_context);

-- ============================================
-- FUNCTIONS utilitaires
-- ============================================

-- Fonction pour mettre a jour updated_at automatiquement
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger sur projects
DROP TRIGGER IF EXISTS update_projects_updated_at ON projects;
CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger sur agent_contexts
DROP TRIGGER IF EXISTS update_contexts_updated_at ON agent_contexts;
CREATE TRIGGER update_contexts_updated_at
    BEFORE UPDATE ON agent_contexts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- VIEWS pour navigation hierarchique
-- ============================================

-- Vue complete d'une action avec sa hierarchie
CREATE OR REPLACE VIEW v_actions_full AS
SELECT
    a.id AS action_id,
    a.tool_name,
    a.tool_type,
    a.exit_code,
    a.duration_ms,
    a.file_paths,
    a.created_at AS action_created_at,
    s.id AS subtask_id,
    s.agent_type,
    s.agent_id,
    s.description AS subtask_description,
    s.status AS subtask_status,
    tl.id AS task_list_id,
    tl.name AS task_list_name,
    tl.wave_number,
    r.id AS request_id,
    r.prompt,
    r.prompt_type,
    r.session_id,
    p.id AS project_id,
    p.path AS project_path,
    p.name AS project_name
FROM actions a
LEFT JOIN subtasks s ON a.subtask_id = s.id
LEFT JOIN task_lists tl ON s.task_list_id = tl.id
LEFT JOIN requests r ON tl.request_id = r.id
LEFT JOIN projects p ON r.project_id = p.id;

-- Vue des agents actifs par projet
CREATE OR REPLACE VIEW v_active_agents AS
SELECT
    s.id AS subtask_id,
    s.priority,
    p.id AS project_id,
    p.name AS project_name,
    p.path AS project_path,
    s.agent_type,
    s.agent_id,
    s.parent_agent_id,
    s.status,
    s.description,
    s.started_at,
    s.created_at,
    r.session_id,
    r.id AS request_id,
    COUNT(a.id) AS actions_count
FROM subtasks s
JOIN task_lists tl ON s.task_list_id = tl.id
JOIN requests r ON tl.request_id = r.id
LEFT JOIN projects p ON r.project_id = p.id
LEFT JOIN actions a ON a.subtask_id = s.id
WHERE s.status IN ('running', 'paused', 'blocked')
GROUP BY s.id, s.priority, p.id, p.name, p.path, s.agent_type, s.agent_id, s.parent_agent_id, s.status, s.description, s.started_at, s.created_at, r.session_id, r.id;

-- Vue des messages non lus
CREATE OR REPLACE VIEW v_unread_messages AS
SELECT
    m.id,
    m.project_id,
    m.from_agent_id,
    m.to_agent_id,
    m.message_type,
    m.topic,
    m.payload,
    m.priority,
    m.read_by,
    m.created_at,
    m.expires_at,
    p.name AS project_name
FROM agent_messages m
JOIN projects p ON m.project_id = p.id
WHERE m.expires_at IS NULL OR m.expires_at > NOW()
ORDER BY m.priority DESC, m.created_at DESC;

-- Vue des statistiques par projet
CREATE OR REPLACE VIEW v_project_stats AS
SELECT
    p.id AS project_id,
    p.name AS project_name,
    p.path,
    COUNT(DISTINCT r.id) AS total_requests,
    COUNT(DISTINCT s.id) AS total_subtasks,
    COUNT(DISTINCT a.id) AS total_actions,
    COUNT(DISTINCT CASE WHEN a.exit_code = 0 THEN a.id END) AS successful_actions,
    COALESCE(AVG(a.duration_ms), 0) AS avg_duration_ms,
    MAX(a.created_at) AS last_activity
FROM projects p
LEFT JOIN requests r ON r.project_id = p.id
LEFT JOIN task_lists tl ON tl.request_id = r.id
LEFT JOIN subtasks s ON s.task_list_id = tl.id
LEFT JOIN actions a ON a.subtask_id = s.id
GROUP BY p.id, p.name, p.path;

-- ============================================
-- Commentaires sur les tables
-- ============================================
COMMENT ON TABLE projects IS 'Projets identifies par leur chemin (cwd)';
COMMENT ON TABLE requests IS 'Demandes utilisateur (prompts) avec hierarchie vers projet';
COMMENT ON TABLE task_lists IS 'Waves de taches pour une demande';
COMMENT ON TABLE subtasks IS 'Sous-taches assignees aux agents';
COMMENT ON TABLE actions IS 'Actions/appels outils avec input/output compresses';
COMMENT ON TABLE keyword_tool_scores IS 'Scores de routing intelligent par keyword';
COMMENT ON TABLE agent_messages IS 'Messages pub/sub inter-agents';
COMMENT ON TABLE agent_contexts IS 'Contextes pour reprise apres compact';
COMMENT ON TABLE sessions IS 'Sessions Claude Code avec statistiques';
COMMENT ON TABLE agent_registry IS 'Registre des types d agents disponibles';
COMMENT ON TABLE agent_capacity IS 'Suivi capacite contexte des agents';
COMMENT ON TABLE token_consumption IS 'Consommation de tokens par agent';
COMMENT ON TABLE wave_states IS 'Etats des waves d orchestration';
COMMENT ON TABLE orchestration_batches IS 'Batches d orchestration par wave';

-- Schema version
CREATE TABLE IF NOT EXISTS schema_version (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO schema_version (version) VALUES ('3.1.0')
ON CONFLICT (version) DO NOTHING;
