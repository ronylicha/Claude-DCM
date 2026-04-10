-- Epic Sessions & AI Messaging — DCM v5.4.0

-- ============================================
-- 1. TABLE: epic_sessions
-- ============================================
CREATE TABLE IF NOT EXISTS epic_sessions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    epic_id       UUID        NOT NULL REFERENCES project_epics(id) ON DELETE CASCADE,
    status        TEXT        NOT NULL DEFAULT 'active',
    model         TEXT        NOT NULL DEFAULT 'claude-opus-4-6',
    system_prompt TEXT,
    pid           INTEGER,
    auto_execute  BOOLEAN     NOT NULL DEFAULT false,
    token_count   INTEGER     NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ended_at      TIMESTAMPTZ,
    CONSTRAINT chk_epic_session_status CHECK (
        status IN ('active', 'thinking', 'waiting', 'ended', 'error')
    )
);

CREATE INDEX IF NOT EXISTS idx_epic_sessions_epic   ON epic_sessions(epic_id);
CREATE INDEX IF NOT EXISTS idx_epic_sessions_status ON epic_sessions(status);

DROP TRIGGER IF EXISTS update_epic_sessions_updated_at ON epic_sessions;
CREATE TRIGGER update_epic_sessions_updated_at
    BEFORE UPDATE ON epic_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 2. TABLE: epic_messages
-- ============================================
CREATE TABLE IF NOT EXISTS epic_messages (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   UUID        NOT NULL REFERENCES epic_sessions(id) ON DELETE CASCADE,
    role         TEXT        NOT NULL,
    content      TEXT        NOT NULL,
    content_type TEXT        NOT NULL DEFAULT 'text',
    metadata     JSONB       NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_epic_message_role CHECK (
        role IN ('user', 'assistant', 'system', 'tool_use', 'tool_result')
    ),
    CONSTRAINT chk_epic_message_content_type CHECK (
        content_type IN ('text', 'markdown', 'json', 'task_proposal')
    )
);

CREATE INDEX IF NOT EXISTS idx_epic_messages_session ON epic_messages(session_id, created_at ASC);

-- ============================================
-- 3. TABLE: epic_proposed_tasks
-- ============================================
CREATE TABLE IF NOT EXISTS epic_proposed_tasks (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       UUID        NOT NULL REFERENCES epic_sessions(id) ON DELETE CASCADE,
    epic_id          UUID        NOT NULL REFERENCES project_epics(id) ON DELETE CASCADE,
    title            TEXT        NOT NULL,
    description      TEXT,
    agent_type       TEXT        NOT NULL DEFAULT 'Snipper',
    wave_number      INTEGER     NOT NULL DEFAULT 0,
    step_order       INTEGER     NOT NULL DEFAULT 0,
    model            TEXT        NOT NULL DEFAULT 'sonnet',
    prompt           TEXT,
    skills           TEXT[]      NOT NULL DEFAULT '{}',
    status           TEXT        NOT NULL DEFAULT 'proposed',
    pipeline_step_id UUID        REFERENCES pipeline_steps(id) ON DELETE SET NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at       TIMESTAMPTZ,
    CONSTRAINT chk_epic_proposed_task_status CHECK (
        status IN ('proposed', 'approved', 'rejected', 'executing', 'completed', 'failed')
    )
);

CREATE INDEX IF NOT EXISTS idx_epic_proposed_tasks_session ON epic_proposed_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_epic_proposed_tasks_epic    ON epic_proposed_tasks(epic_id);

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE epic_sessions       IS 'Sessions IA attachees a un epic, avec suivi du processus et des tokens';
COMMENT ON TABLE epic_messages       IS 'Messages echanges dans une epic session (multi-role, multi-format)';
COMMENT ON TABLE epic_proposed_tasks IS 'Taches proposees par l IA dans une session, en attente de decision';

-- Schema version
INSERT INTO schema_version (version) VALUES ('5.4.0') ON CONFLICT (version) DO NOTHING;
