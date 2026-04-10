-- Project Context persistence — DCM v5.5.0
-- Stores structured context sections per project (summary, architecture, tech_stack, etc.)
-- Each section can be upserted independently and versioned via project.context_version.

-- Table pour stocker le contexte complet d'un projet
CREATE TABLE IF NOT EXISTS project_context (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    context_type TEXT NOT NULL, -- 'summary' | 'architecture' | 'tech_stack' | 'file_tree' | 'dependencies' | 'api_routes' | 'db_schema' | 'custom'
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT chk_context_type CHECK (
        context_type IN ('summary', 'architecture', 'tech_stack', 'file_tree', 'dependencies', 'api_routes', 'db_schema', 'custom')
    ),
    UNIQUE(project_id, context_type, title)
);

CREATE INDEX IF NOT EXISTS idx_project_context_project ON project_context(project_id);
CREATE INDEX IF NOT EXISTS idx_project_context_type ON project_context(context_type);

-- Trigger updated_at
DROP TRIGGER IF EXISTS update_project_context_updated_at ON project_context;
CREATE TRIGGER update_project_context_updated_at
    BEFORE UPDATE ON project_context FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Track last scan time per project
ALTER TABLE projects ADD COLUMN IF NOT EXISTS last_context_scan TIMESTAMPTZ;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS context_version INTEGER NOT NULL DEFAULT 0;

INSERT INTO schema_version (version) VALUES ('5.5.0') ON CONFLICT (version) DO NOTHING;
