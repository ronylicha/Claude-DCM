-- Project Epics & Board — DCM v5.3.0

-- ============================================
-- 1. pipelines.project_id
-- ============================================
ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pipelines_project ON pipelines(project_id);

-- ============================================
-- 2. projects — status, description, git fields
-- ============================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS git_repo_url TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS git_branch TEXT DEFAULT 'main';

ALTER TABLE projects DROP CONSTRAINT IF EXISTS chk_project_status;
ALTER TABLE projects ADD CONSTRAINT chk_project_status
    CHECK (status IN ('active', 'archived', 'completed'));

-- ============================================
-- 3. TABLE: project_epics
-- ============================================
CREATE TABLE IF NOT EXISTS project_epics (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    pipeline_id      UUID        REFERENCES pipelines(id) ON DELETE SET NULL,
    title            TEXT        NOT NULL,
    description      TEXT,
    status           TEXT        NOT NULL DEFAULT 'backlog',
    priority         INTEGER     NOT NULL DEFAULT 0,
    sort_order       INTEGER     NOT NULL DEFAULT 0,
    wave_start       INTEGER,
    wave_end         INTEGER,
    color            TEXT,
    estimated_effort TEXT,
    tags             TEXT[]      NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at     TIMESTAMPTZ,
    CONSTRAINT chk_epic_status CHECK (
        status IN ('backlog', 'todo', 'in_progress', 'review', 'done', 'cancelled')
    ),
    CONSTRAINT chk_epic_effort CHECK (
        estimated_effort IS NULL OR estimated_effort IN ('xs', 's', 'm', 'l', 'xl')
    ),
    CONSTRAINT chk_epic_waves CHECK (
        (wave_start IS NULL AND wave_end IS NULL)
        OR (wave_start IS NOT NULL AND wave_end IS NOT NULL AND wave_end >= wave_start AND wave_start >= 0)
    )
);

CREATE INDEX IF NOT EXISTS idx_project_epics_project    ON project_epics(project_id);
CREATE INDEX IF NOT EXISTS idx_project_epics_pipeline   ON project_epics(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_project_epics_status     ON project_epics(status);
CREATE INDEX IF NOT EXISTS idx_project_epics_sort       ON project_epics(project_id, status, sort_order);

-- ============================================
-- 4. TABLE: epic_transitions
-- ============================================
CREATE TABLE IF NOT EXISTS epic_transitions (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    epic_id     UUID        NOT NULL REFERENCES project_epics(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status   TEXT        NOT NULL,
    trigger     TEXT        NOT NULL DEFAULT 'manual',
    metadata    JSONB       NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_transition_trigger CHECK (
        trigger IN ('manual', 'pipeline_sync', 'auto_complete')
    )
);

CREATE INDEX IF NOT EXISTS idx_epic_transitions_epic ON epic_transitions(epic_id, created_at DESC);

-- ============================================
-- 5. Trigger updated_at sur project_epics
-- ============================================
DROP TRIGGER IF EXISTS update_project_epics_updated_at ON project_epics;
CREATE TRIGGER update_project_epics_updated_at
    BEFORE UPDATE ON project_epics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 6. VIEW: v_project_board
-- COUNT epics par status par projet
-- ============================================
CREATE OR REPLACE VIEW v_project_board AS
SELECT
    p.id                                                                          AS project_id,
    p.name                                                                        AS project_name,
    p.path                                                                        AS project_path,
    p.status                                                                      AS project_status,
    COUNT(e.id)                                                                   AS total_epics,
    COUNT(e.id) FILTER (WHERE e.status = 'backlog')                               AS backlog_count,
    COUNT(e.id) FILTER (WHERE e.status = 'todo')                                  AS todo_count,
    COUNT(e.id) FILTER (WHERE e.status = 'in_progress')                           AS in_progress_count,
    COUNT(e.id) FILTER (WHERE e.status = 'review')                                AS review_count,
    COUNT(e.id) FILTER (WHERE e.status = 'done')                                  AS done_count,
    COUNT(e.id) FILTER (WHERE e.status = 'cancelled')                             AS cancelled_count
FROM projects p
LEFT JOIN project_epics e ON e.project_id = p.id
GROUP BY p.id, p.name, p.path, p.status;

-- ============================================
-- 7. VIEW: v_epic_progress
-- Progression % par epic basee sur pipeline_steps
-- ============================================
CREATE OR REPLACE VIEW v_epic_progress AS
SELECT
    e.id                                                                 AS epic_id,
    e.project_id,
    e.pipeline_id,
    e.title,
    e.status,
    e.wave_start,
    e.wave_end,
    COUNT(ps.id)                                                         AS total_steps,
    COUNT(ps.id) FILTER (WHERE ps.status = 'completed')                  AS completed_steps,
    CASE
        WHEN COUNT(ps.id) = 0 THEN 0
        ELSE ROUND(
            (COUNT(ps.id) FILTER (WHERE ps.status = 'completed'))::NUMERIC
            / COUNT(ps.id)::NUMERIC * 100,
            1
        )
    END                                                                  AS progress_pct
FROM project_epics e
LEFT JOIN pipeline_steps ps
    ON  ps.pipeline_id = e.pipeline_id
    AND e.wave_start   IS NOT NULL
    AND e.wave_end     IS NOT NULL
    AND ps.wave_number BETWEEN e.wave_start AND e.wave_end
GROUP BY e.id, e.project_id, e.pipeline_id, e.title, e.status, e.wave_start, e.wave_end;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE project_epics    IS 'Epics de projet avec suivi kanban et lien optionnel vers un pipeline';
COMMENT ON TABLE epic_transitions IS 'Historique des transitions de statut des epics';
COMMENT ON VIEW  v_project_board  IS 'Tableau kanban agrege par projet avec comptage par statut';
COMMENT ON VIEW  v_epic_progress  IS 'Progression des epics basee sur les pipeline_steps de la plage de waves';

-- Schema version
INSERT INTO schema_version (version) VALUES ('5.3.0') ON CONFLICT (version) DO NOTHING;
