/**
 * SDK Type Definitions
 */

export interface DCMConfig {
  apiUrl?: string;
  wsUrl?: string;
  timeout?: number;
  retries?: number;
  authToken?: string;
  agentId?: string;
  sessionId?: string;
}

export interface ActionInput {
  tool_name: string;
  tool_type: "builtin" | "agent" | "skill" | "command" | "mcp";
  input?: string;
  output?: string;
  exit_code?: number;
  duration_ms?: number;
  file_paths?: string[];
  session_id?: string;
  project_path?: string;
}

export interface ToolSuggestion {
  tool_name: string;
  tool_type: string;
  score: number;
  usage_count: number;
  success_rate: number;
  keyword_matches: string[];
}

export interface SubtaskInput {
  task_id: string;
  agent_type: string;
  agent_id?: string;
  description: string;
  status?: string;
  blocked_by?: string[];
}

export interface MessageInput {
  from_agent_id: string;
  to_agent_id?: string;
  topic: string;
  payload: Record<string, unknown>;
  priority?: number;
  ttl_ms?: number;
}

export interface SessionInput {
  session_id: string;
  project_id: string;
  cwd?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface WSEvent {
  id: string;
  channel: string;
  event: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export type EventHandler = (event: WSEvent) => void;
