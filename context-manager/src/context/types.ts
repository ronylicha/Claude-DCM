/**
 * Context Types - Type definitions for context management
 * Phase 5 - Context Agent Integration
 * @module context/types
 */

/** Agent type categories for template selection */
export type AgentCategory =
  | "orchestrator"
  | "developer"
  | "validator"
  | "specialist"
  | "researcher"
  | "writer";

/** Context brief output structure */
export interface ContextBrief {
  /** Unique brief ID */
  id: string;
  /** Agent ID this brief is for */
  agent_id: string;
  /** Agent type/category */
  agent_type: string;
  /** Session ID */
  session_id: string;
  /** Formatted markdown brief */
  brief: string;
  /** Token count estimate */
  token_count: number;
  /** Sources used to build the brief */
  sources: ContextSource[];
  /** Generation timestamp */
  generated_at: string;
  /** Whether brief was truncated */
  truncated: boolean;
}

/** Source of context information */
export interface ContextSource {
  /** Type of source */
  type: "task" | "message" | "blocking" | "history" | "session" | "project";
  /** Source ID */
  id: string;
  /** Relevance score (0-1) */
  relevance: number;
  /** Brief description of what was extracted */
  summary?: string;
}

/** Options for context generation */
export interface ContextGenerationOptions {
  /** Maximum tokens for the brief (default: 2000) */
  maxTokens?: number;
  /** Include historical actions (default: true) */
  includeHistory?: boolean;
  /** History limit (default: 10) */
  historyLimit?: number;
  /** Include unread messages (default: true) */
  includeMessages?: boolean;
  /** Include blocking info (default: true) */
  includeBlocking?: boolean;
  /** Project ID filter (optional) */
  projectId?: string;
}

/** Compact restore request input */
export interface CompactRestoreInput {
  /** Session ID to restore */
  session_id: string;
  /** Agent requesting the restore */
  agent_id: string;
  /** Summary from the compact operation */
  compact_summary?: string;
  /** Maximum tokens for restored context */
  max_tokens?: number;
}

/** Compact restore response */
export interface CompactRestoreResponse {
  /** Success status */
  success: boolean;
  /** Generated context brief */
  brief: string;
  /** Sources used */
  sources: ContextSource[];
  /** Session marked as compacted */
  session_compacted: boolean;
  /** Timestamp */
  restored_at: string;
}

/** Agent context data from database */
export interface AgentContextData {
  /** Assigned tasks (IN_PROGRESS subtasks) */
  tasks: SubtaskContext[];
  /** Unread messages */
  messages: MessageContext[];
  /** Current blockings */
  blockings: BlockingContext[];
  /** Recent action history */
  history: ActionContext[];
  /** Session info */
  session?: SessionContext | undefined;
  /** Project info */
  project?: ProjectContext | undefined;
}

/** Subtask context for brief */
export interface SubtaskContext {
  id: string;
  description: string;
  status: string;
  agent_type: string | null;
  created_at: string;
  started_at: string | null;
  blocked_by: string[] | null;
  task_name?: string;
  wave_number?: number;
}

/** Message context for brief */
export interface MessageContext {
  id: string;
  from_agent: string | null;
  topic: string | null;
  content: Record<string, unknown>;
  priority: number;
  created_at: string;
  is_broadcast: boolean;
}

/** Blocking context for brief */
export interface BlockingContext {
  id: string;
  blocked_by_agent: string;
  reason: string | null;
  created_at: string;
}

/** Action history context for brief */
export interface ActionContext {
  id: string;
  tool_name: string;
  tool_type: string;
  exit_code: number;
  duration_ms: number | null;
  file_paths: string[] | null;
  created_at: string;
}

/** Session context for brief */
export interface SessionContext {
  id: string;
  session_id: string;
  status: string;
  created_at: string;
  prompt?: string;
}

/** Project context for brief */
export interface ProjectContext {
  id: string;
  name: string | null;
  path: string;
}

/** Template configuration */
export interface TemplateConfig {
  /** Agent category this template handles */
  category: AgentCategory;
  /** Agent types that match this template */
  agentTypes: string[];
  /** Sections to include in brief */
  sections: TemplateSectionConfig[];
  /** Priority of sections (higher = first) */
  sectionPriority: Record<string, number>;
}

/** Template section configuration */
export interface TemplateSectionConfig {
  /** Section name */
  name: string;
  /** Whether section is required */
  required: boolean;
  /** Maximum tokens for this section */
  maxTokens?: number;
  /** Whether to include in brief */
  enabled: boolean;
}

/** Agent type to category mapping */
export const AGENT_CATEGORY_MAP: Record<string, AgentCategory> = {
  // Orchestrators
  "project-supervisor": "orchestrator",
  "tech-lead": "orchestrator",
  "step-orchestrator": "orchestrator",
  "fullstack-coordinator": "orchestrator",

  // Developers
  "backend-laravel": "developer",
  "frontend-react": "developer",
  "laravel-api": "developer",
  "database-admin": "developer",
  "react-native-dev": "developer",
  "react-native-ui": "developer",
  "react-native-api": "developer",
  "supabase-backend": "developer",
  "supabase-edge": "developer",
  "devops-infra": "developer",
  "migration-specialist": "developer",
  "performance-engineer": "developer",

  // Validators
  "qa-testing": "validator",
  "regression-guard": "validator",
  "validator": "validator",
  "code-reviewer": "validator",

  // Specialists
  "security-specialist": "specialist",
  "gdpr-dpo": "specialist",
  "legal-compliance": "specialist",
  "accessibility-specialist": "specialist",
  "seo-specialist": "specialist",
  "i18n-specialist": "specialist",
  "impact-analyzer": "specialist",

  // Researchers
  "explore-codebase": "researcher",
  "explore-docs": "researcher",
  "market-researcher": "researcher",
  "business-analyst": "researcher",

  // Writers
  "technical-writer": "writer",
  "fix-grammar": "writer",
  "customer-success": "writer",
  "product-manager": "writer",
};

/**
 * Get agent category from agent type
 * @param agentType - The agent type string
 * @returns The category or "developer" as default
 */
export function getAgentCategory(agentType: string): AgentCategory {
  return AGENT_CATEGORY_MAP[agentType] ?? "developer";
}
