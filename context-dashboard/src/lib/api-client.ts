const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:3847";

// ============================================
// API Response Types - Matching Backend
// ============================================

export interface HealthResponse {
  status: "healthy" | "unhealthy";
  timestamp: string;
  version: string;
  database: {
    healthy: boolean;
    latencyMs: number;
    error?: string;
  };
  features: {
    phase1: string;
    phase2: string;
    phase3: string;
    phase4: string;
    phase5: string;
    phase6: string;
    phase7: string;
    phase8: string;
  };
}

export interface StatsResponse {
  projectCount: number;
  requestCount: number;
  actionCount: number;
  messageCount: number;
  timestamp: string;
}

export interface Project {
  id: string;
  path: string;
  name: string | null;
  created_at: string;
  updated_at: string;
  metadata: Record<string, unknown>;
}

export interface ProjectsResponse {
  projects: Project[];
  count: number;
  total: number;
  limit: number;
  offset: number;
}

export interface Request {
  id: string;
  project_id: string;
  session_id: string;
  prompt: string;
  prompt_type: string | null;
  status: "pending" | "running" | "completed" | "failed";
  created_at: string;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

export interface Task {
  id: string;
  request_id: string;
  name: string | null;
  wave_number: number;
  status: "pending" | "running" | "completed" | "failed";
  created_at: string;
  completed_at: string | null;
}

export interface Subtask {
  id: string;
  task_id: string;
  task_list_id: string;
  agent_type: string | null;
  agent_id: string | null;
  description: string;
  status: "pending" | "running" | "paused" | "blocked" | "completed" | "failed";
  blocked_by: string[] | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  context_snapshot: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
}

export interface SubtasksResponse {
  subtasks: Subtask[];
  count: number;
  limit: number;
  offset: number;
}

export interface Action {
  id: string;
  tool_name: string;
  tool_type: string;
  exit_code: number;
  duration_ms: number | null;
  file_paths: string[];
  created_at: string;
  // Extended fields (may not always be present)
  project_id?: string;
  session_id?: string;
  agent_id?: string | null;
  input_hash?: string | null;
  success?: boolean;
  metadata?: Record<string, unknown>;
}

// Alias for backward compatibility
export type ActionItem = Action;

export interface ActionsResponse {
  actions: Action[];
  count: number;
  limit: number;
  offset: number;
}

export interface Message {
  id: string;
  session_id: string;
  from_agent: string;
  to_agent: string;
  message_type: string;
  payload: Record<string, unknown>;
  created_at: string;
  read_at: string | null;
  expires_at: string | null;
  // Legacy fields for backward compatibility with conversation view
  role?: "user" | "assistant" | "system";
  content?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

// Inter-agent messages (for message queue/bus)
export interface InterAgentMessage {
  id: string;
  project_id: string;
  from_agent_id: string;
  to_agent_id: string;
  message_type: "info" | "request" | "response" | "notification";
  topic: string;
  payload: Record<string, unknown>;
  read_by: string[];
  created_at: string;
  expires_at: string | null;
}

export interface InterAgentMessagesResponse {
  messages: InterAgentMessage[];
  count: number;
}

export interface Subscription {
  id: string;
  agent_id: string;
  event_type: string;
  filter: Record<string, unknown> | null;
  created_at: string;
}

export interface Blocking {
  id: string;
  blocker_id: string;
  blocked_id: string;
  reason: string | null;
  created_at: string;
}

export interface RoutingSuggestion {
  tool_name: string;
  tool_type: string;
  score: number;
  usage_count: number;
  last_used: string | null;
}

export interface RoutingStats {
  totals: {
    total_records: number;
    unique_keywords: number;
    unique_tools: number;
    avg_score: number;
    avg_usage: number;
  };
  top_by_score: Array<{
    tool_name: string;
    tool_type: string;
    avg_score: number;
  }>;
  top_by_usage: Array<{
    tool_name: string;
    tool_type: string;
    total_usage: number;
  }>;
  type_distribution: Array<{
    tool_type: string;
    tool_count: number;
  }>;
}

// Alias for backward compatibility with old pages
export interface RoutingStatsResponse {
  total_keywords: number;
  top_tools: Array<{
    tool_name: string;
    tool_type: string;
    usage_count: number;
    avg_score: number;
  }>;
  recent_feedback_count: number;
}

export interface ActiveAgent {
  subtask_id: string;
  agent_type: string;
  agent_id: string;
  description: string;
  started_at: string | null;
  created_at: string;
  project_path?: string;
  project_name?: string;
  request_id?: string;
  session_id: string;
  actions_count?: number;
}

export interface ActiveSessionsResponse {
  active_agents: ActiveAgent[];
  count: number;
}

export interface HierarchyResponse {
  hierarchy: Project & {
    requests: (Request & {
      tasks: (Task & {
        subtasks: Subtask[];
      })[];
    })[];
  };
  stats: Record<string, unknown> | null;
  counts: {
    requests: number;
    tasks: number;
    subtasks: number;
  };
}

export interface ContextBrief {
  session_id: string;
  agent_id: string;
  agent_type: string;
  format: "brief" | "raw";
  content: string;
  generated_at: string;
  token_estimate: number;
}

export interface CompactStatus {
  session_id: string;
  is_compacted: boolean;
  last_activity: string | null;
  message_count: number;
}

export interface CleanupStats {
  last_cleanup: {
    timestamp: string;
    expired_deleted?: number;
    read_deleted?: number;
    deleted_count?: number;
  } | null;
  messages: {
    total: number;
    unread?: number;
    expired?: number;
    by_type?: Record<string, number>;
  };
  timestamp: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Session types - Phase 6 API
export interface Session {
  id: string;
  project_id: string | null;
  started_at: string;
  ended_at: string | null;
  total_tools_used: number;
  total_success: number;
  total_errors: number;
  // Computed fields
  status?: "active" | "completed" | "failed";
  requests?: Request[];
}

export interface SessionsResponse {
  sessions: Session[];
  total: number;
  limit: number;
  offset: number;
}

export interface SessionsStats {
  overview: {
    total_sessions: number;
    active_sessions: number;
    total_tools: number;
    total_success: number;
    total_errors: number;
    avg_tools_per_session: number;
    oldest_session: string | null;
    newest_session: string | null;
  };
  by_project: Array<{
    project_name: string | null;
    project_path: string | null;
    session_count: number;
    total_tools: number;
  }>;
  timestamp: string;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  category: string;
  skills: string[];
  created_at: string;
}

export interface Tool {
  id: string;
  name: string;
  type: "skill" | "command" | "workflow" | "plugin";
  description: string;
  invocation: string;
  usage_count: number;
}

export interface RoutingRule {
  id: string;
  keywords: string[];
  tool_id: string;
  weight: number;
  created_at: string;
}

export interface DashboardKPIs {
  actions_24h: {
    total: number;
    success: number;
    success_rate: number;
    unique_tools: number;
    active_sessions: number;
    avg_per_hour: number;
  };
  sessions: {
    total: number;
    active: number;
    avg_tools_per_session: number;
  };
  agents: {
    contexts_total: number;
    unique_types: number;
    top_types: Array<{ agent_type: string; count: number }>;
  };
  subtasks: {
    total: number;
    completed: number;
    running: number;
    failed: number;
    completion_rate: number;
  };
  routing: {
    keywords: number;
    tools: number;
    mappings: number;
  };
  timestamp: string;
}

export interface ActionsHourlyResponse {
  data: Array<{ hour: string; count: number }>;
  period: "24h";
}

export interface ToolsSummaryResponse {
  skills: number;
  commands: number;
  workflows: number;
  plugins: number;
  cached_at: string;
  from_cache?: boolean;
}

// Agent Contexts (agent_contexts table)
export interface AgentContext {
  id: string;
  project_id: string;
  agent_id: string;
  agent_type: string;
  role_context: {
    status: string;
    spawned_at: string;
    subtask_id?: string;
    completed_at?: string;
    task_description?: string;
    session_id?: string;
    blocked_by?: string[];
    task_list_id?: string;
  };
  skills_to_restore: string[] | null;
  tools_used: string[];
  progress_summary: string;
  last_updated: string;
}

export interface AgentContextsResponse {
  contexts: AgentContext[];
  total: number;
  stats: {
    total: number;
    unique_types: number;
    running: number;
    completed: number;
    failed: number;
  };
  type_distribution: Array<{
    agent_type: string;
    count: number;
    running: number;
    completed: number;
  }>;
}

export interface AgentContextsStatsResponse {
  overview: {
    total_contexts: number;
    unique_agent_types: number;
    unique_projects: number;
    active_agents: number;
    completed_agents: number;
    failed_agents: number;
    oldest_context: string | null;
    newest_context: string | null;
  };
  top_types: Array<{
    agent_type: string;
    count: number;
    running: number;
  }>;
  tools_used: Array<{
    tool: string;
    usage_count: number;
  }>;
  recent_activity: Array<{
    id: string;
    agent_id: string;
    agent_type: string;
    progress_summary: string;
    status: string;
    spawned_at: string;
    last_updated: string;
  }>;
  timestamp: string;
}

// Token tracking
export interface AgentCapacity {
  agent_id: string;
  current_usage: number;
  max_capacity: number;
  usage_percent: number;
  consumption_rate: number;
  zone: "green" | "yellow" | "orange" | "red" | "critical";
  minutes_remaining: string;
  shouldIntervene: boolean;
  compact_count: number;
  last_compact_at: string | null;
  last_updated_at: string | null;
}

// Agent registry
export interface AgentRegistryEntry {
  agent_type: string;
  category: string;
  display_name: string | null;
  default_scope: Record<string, unknown>;
  allowed_tools: string[] | null;
  forbidden_actions: string[] | null;
  max_files: number | null;
  wave_assignments: number[] | null;
  recommended_model: string | null;
  created_at: string;
}

// Orchestration batch
export interface OrchestrationBatch {
  id: string;
  session_id: string;
  wave_number: number;
  status: "pending" | "running" | "completed" | "failed";
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  synthesis: Record<string, unknown> | null;
  created_at: string;
  completed_at: string | null;
}

// Wave state
export interface WaveState {
  id: string;
  session_id: string;
  wave_number: number;
  status: "pending" | "running" | "completed" | "failed" | "blocked";
  total_tasks: number;
  completed_tasks: number;
  failed_tasks: number;
  started_at: string | null;
  completed_at: string | null;
}

// Compact snapshot
export interface CompactEvent {
  id: string;
  session_id: string;
  agent_type: string;
  trigger: string;
  snapshot: Record<string, unknown>;
  summary: string;
  created_at: string;
}

// Registry catalog types
export interface CatalogAgent { id: string; name: string; description: string; category: string; tools: string[] }
export interface CatalogSkill { id: string; name: string; description: string; category: string }
export interface CatalogCommand { id: string; name: string; description: string; category: string }
export interface CatalogResponse { agents?: CatalogAgent[]; skills?: CatalogSkill[]; commands?: CatalogCommand[]; counts: { agents: number; skills: number; commands: number } }

// ============================================
// API Error
// ============================================

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ============================================
// Fetch wrapper
// ============================================

async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    let errorData: unknown;
    try {
      errorData = await response.json();
    } catch {
      errorData = await response.text();
    }
    throw new ApiError(response.status, response.statusText, errorData);
  }

  // Handle 204 No Content (DELETE responses)
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

// ============================================
// API Client - Matching Backend Endpoints
// ============================================

export const apiClient = {
  // ==========================================
  // Health & Stats (no /api prefix)
  // ==========================================
  getHealth: () => apiFetch<HealthResponse>("/health"),
  getStats: () => apiFetch<StatsResponse>("/stats"),
  getDashboardKPIs: () => apiFetch<DashboardKPIs>("/api/dashboard/kpis"),
  getToolsSummary: () => apiFetch<ToolsSummaryResponse>("/stats/tools-summary"),

  // ==========================================
  // Projects - /api/projects
  // ==========================================
  getProjects: async (page = 1, limit = 20): Promise<PaginatedResponse<Project>> => {
    const resp = await apiFetch<ProjectsResponse>(`/api/projects?limit=${limit}&offset=${(page - 1) * limit}`);
    return {
      data: resp.projects,
      total: resp.total,
      page,
      limit,
      totalPages: Math.ceil(resp.total / limit),
    };
  },
  getProjectsRaw: (page = 1, limit = 20) =>
    apiFetch<ProjectsResponse>(`/api/projects?limit=${limit}&offset=${(page - 1) * limit}`),
  getProject: (id: string) => apiFetch<Project>(`/api/projects/${id}`),
  getProjectByPath: (path: string) =>
    apiFetch<Project>(`/api/projects/by-path?path=${encodeURIComponent(path)}`),
  createProject: (data: { path: string; name?: string; metadata?: Record<string, unknown> }) =>
    apiFetch<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteProject: (id: string) => apiFetch<void>(`/api/projects/${id}`, { method: "DELETE" }),

  // ==========================================
  // Requests - /api/requests
  // ==========================================
  getRequests: async (params?: { project_id?: string; session_id?: string; status?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.project_id) searchParams.set("project_id", params.project_id);
    if (params?.session_id) searchParams.set("session_id", params.session_id);
    if (params?.status) searchParams.set("status", params.status);
    const query = searchParams.toString();
    const response = await apiFetch<{ requests: Request[]; count: number; limit: number; offset: number }>(
      `/api/requests${query ? `?${query}` : ""}`
    );
    return response.requests;
  },
  getRequest: (id: string) => apiFetch<Request>(`/api/requests/${id}`),
  createRequest: (data: {
    project_id: string;
    session_id: string;
    prompt: string;
    prompt_type?: string;
    metadata?: Record<string, unknown>;
  }) =>
    apiFetch<Request>("/api/requests", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateRequest: (id: string, data: { status?: string; completed_at?: string; metadata?: Record<string, unknown> }) =>
    apiFetch<Request>(`/api/requests/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteRequest: (id: string) => apiFetch<void>(`/api/requests/${id}`, { method: "DELETE" }),

  // ==========================================
  // Tasks - /api/tasks
  // ==========================================
  getTasks: (params?: { request_id?: string; status?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.request_id) searchParams.set("request_id", params.request_id);
    if (params?.status) searchParams.set("status", params.status);
    const query = searchParams.toString();
    return apiFetch<Task[]>(`/api/tasks${query ? `?${query}` : ""}`);
  },
  getTask: (id: string) => apiFetch<Task>(`/api/tasks/${id}`),
  createTask: (data: {
    request_id: string;
    name?: string;
    wave_number: number;
  }) =>
    apiFetch<Task>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateTask: (id: string, data: { status?: string; completed_at?: string }) =>
    apiFetch<Task>(`/api/tasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteTask: (id: string) => apiFetch<void>(`/api/tasks/${id}`, { method: "DELETE" }),

  // ==========================================
  // Subtasks - /api/subtasks
  // ==========================================
  getSubtasks: (params?: {
    task_list_id?: string;
    agent_id?: string;
    agent_type?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.task_list_id) searchParams.set("task_list_id", params.task_list_id);
    if (params?.agent_id) searchParams.set("agent_id", params.agent_id);
    if (params?.agent_type) searchParams.set("agent_type", params.agent_type);
    if (params?.status) searchParams.set("status", params.status);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.offset) searchParams.set("offset", params.offset.toString());
    const query = searchParams.toString();
    return apiFetch<SubtasksResponse>(`/api/subtasks${query ? `?${query}` : ""}`);
  },
  getSubtask: (id: string) => apiFetch<Subtask>(`/api/subtasks/${id}`),
  createSubtask: (data: {
    task_list_id: string;
    description: string;
    agent_type?: string;
    agent_id?: string;
    blocked_by?: string[];
  }) =>
    apiFetch<Subtask>("/api/subtasks", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateSubtask: (
    id: string,
    data: {
      status?: string;
      agent_id?: string;
      started_at?: string;
      completed_at?: string;
      result?: Record<string, unknown>;
    }
  ) =>
    apiFetch<Subtask>(`/api/subtasks/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteSubtask: (id: string) => apiFetch<void>(`/api/subtasks/${id}`, { method: "DELETE" }),

  // ==========================================
  // Actions - /api/actions
  // ==========================================
  getActions: (limit = 100, offset = 0, toolType?: string) => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (toolType && toolType !== "all") params.set("tool_type", toolType);
    return apiFetch<ActionsResponse>(`/api/actions?${params}`);
  },
  getActionsHourly: () => apiFetch<ActionsHourlyResponse>("/api/actions/hourly"),
  createAction: (data: {
    project_id: string;
    session_id: string;
    tool_name: string;
    tool_type: string;
    agent_id?: string;
    duration_ms?: number;
    success?: boolean;
    metadata?: Record<string, unknown>;
  }) =>
    apiFetch<Action>("/api/actions", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteAction: (id: string) => apiFetch<void>(`/api/actions/${id}`, { method: "DELETE" }),

  // ==========================================
  // Routing - /api/routing
  // ==========================================
  suggestRouting: (keywords: string[]) =>
    apiFetch<{ suggestions: RoutingSuggestion[] }>(
      `/api/routing/suggest?keywords=${encodeURIComponent(keywords.join(","))}`
    ),
  getRoutingStats: async (): Promise<RoutingStats & { total_routings: number; unique_tools: number; top_tools: Array<{ tool_name: string; tool_type: string; usage_count: number; avg_score: number }> }> => {
    const resp = await apiFetch<RoutingStats>("/api/routing/stats");
    // Add legacy fields for backward compatibility
    return {
      ...resp,
      total_routings: resp.totals.total_records,
      unique_tools: resp.totals.unique_tools,
      top_tools: resp.top_by_usage.map((t) => ({
        tool_name: t.tool_name,
        tool_type: t.tool_type,
        usage_count: t.total_usage,
        avg_score: resp.top_by_score.find((s) => s.tool_name === t.tool_name)?.avg_score ?? 0,
      })),
    };
  },
  getRoutingStatsRaw: () => apiFetch<RoutingStats>("/api/routing/stats"),
  submitRoutingFeedback: (data: {
    keywords: string[];
    selected_tool: string;
    tool_type: string;
    was_helpful: boolean;
  }) =>
    apiFetch<{ success: boolean }>("/api/routing/feedback", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ==========================================
  // Hierarchy - /api/hierarchy
  // ==========================================
  getHierarchy: (projectId: string) =>
    apiFetch<HierarchyResponse>(`/api/hierarchy/${projectId}`),

  // ==========================================
  // Active Sessions - /api/active-sessions
  // ==========================================
  getActiveSessions: () =>
    apiFetch<ActiveSessionsResponse>("/api/active-sessions"),

  // ==========================================
  // Context - /api/context
  // ==========================================
  getContext: (
    agentId: string,
    params?: {
      session_id?: string;
      agent_type?: string;
      format?: "brief" | "raw";
      max_tokens?: number;
    }
  ) => {
    const searchParams = new URLSearchParams();
    if (params?.session_id) searchParams.set("session_id", params.session_id);
    if (params?.agent_type) searchParams.set("agent_type", params.agent_type);
    if (params?.format) searchParams.set("format", params.format);
    if (params?.max_tokens) searchParams.set("max_tokens", params.max_tokens.toString());
    const query = searchParams.toString();
    return apiFetch<ContextBrief>(`/api/context/${agentId}${query ? `?${query}` : ""}`);
  },
  generateContext: (data: {
    session_id: string;
    agent_id: string;
    agent_type?: string;
    max_tokens?: number;
  }) =>
    apiFetch<ContextBrief>("/api/context/generate", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // ==========================================
  // Compact - /api/compact
  // ==========================================
  restoreCompact: (data: {
    session_id: string;
    agent_id: string;
    agent_type?: string;
    compact_summary?: string;
    max_tokens?: number;
  }) =>
    apiFetch<ContextBrief>("/api/compact/restore", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  getCompactStatus: (sessionId: string) =>
    apiFetch<CompactStatus>(`/api/compact/status/${sessionId}`),

  // ==========================================
  // Messages - /api/messages
  // ==========================================
  getMessages: (agentId: string) => apiFetch<Message[]>(`/api/messages/${agentId}`),
  sendMessage: (data: {
    session_id: string;
    from_agent: string;
    to_agent: string;
    message_type: string;
    payload: Record<string, unknown>;
    ttl_seconds?: number;
  }) =>
    apiFetch<Message>("/api/messages", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Inter-agent messages
  getInterAgentMessages: (agentId = "all") =>
    apiFetch<InterAgentMessagesResponse>(`/api/messages/${agentId}`),
  markMessageAsRead: (messageId: string, agentId: string) =>
    apiFetch<{ success: boolean }>(`/api/messages/${messageId}/read`, {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
    }),

  // ==========================================
  // Subscriptions - /api/subscriptions
  // ==========================================
  getSubscriptions: () => apiFetch<Subscription[]>("/api/subscriptions"),
  getAgentSubscriptions: (agentId: string) =>
    apiFetch<Subscription[]>(`/api/subscriptions/${agentId}`),
  subscribe: (data: {
    agent_id: string;
    event_type: string;
    filter?: Record<string, unknown>;
  }) =>
    apiFetch<Subscription>("/api/subscribe", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  unsubscribe: (data: { agent_id: string; event_type: string }) =>
    apiFetch<{ success: boolean }>("/api/unsubscribe", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteSubscription: (id: string) =>
    apiFetch<{ success: boolean }>(`/api/subscriptions/${id}`, {
      method: "DELETE",
    }),

  // ==========================================
  // Blocking - /api/blocking
  // ==========================================
  getBlocking: (agentId: string) => apiFetch<Blocking[]>(`/api/blocking/${agentId}`),
  checkBlocking: (blockerId: string, blockedId: string) =>
    apiFetch<{ is_blocked: boolean }>(
      `/api/blocking/check?blocker_id=${encodeURIComponent(blockerId)}&blocked_id=${encodeURIComponent(blockedId)}`
    ),
  block: (data: { blocker_id: string; blocked_id: string; reason?: string }) =>
    apiFetch<Blocking>("/api/blocking", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  unblock: (data: { blocker_id: string; blocked_id: string }) =>
    apiFetch<{ success: boolean }>("/api/unblock", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  deleteBlocking: (blockedId: string) =>
    apiFetch<{ success: boolean }>(`/api/blocking/${blockedId}`, {
      method: "DELETE",
    }),

  // ==========================================
  // Cleanup - /api/cleanup
  // ==========================================
  getCleanupStats: () => apiFetch<CleanupStats>("/api/cleanup/stats"),

  // ==========================================
  // Legacy endpoints - kept for backward compatibility
  // ==========================================
  getAgents: (page = 1, limit = 50) =>
    apiFetch<PaginatedResponse<Agent>>(`/api/agents?page=${page}&limit=${limit}`),
  getAgent: (id: string) => apiFetch<Agent>(`/api/agents/${id}`),
  getTools: (page = 1, limit = 50) =>
    apiFetch<PaginatedResponse<Tool>>(`/api/tools?page=${page}&limit=${limit}`),
  getTool: (id: string) => apiFetch<Tool>(`/api/tools/${id}`),
  getSessions: (page = 1, limit = 20) =>
    apiFetch<PaginatedResponse<Session>>(`/api/sessions?page=${page}&limit=${limit}`),
  getSession: (id: string) => apiFetch<Session>(`/api/sessions/${id}`),
  getSessionsByProject: (projectId: string) =>
    apiFetch<Session[]>(`/api/projects/${projectId}/sessions`),
  deleteSession: (id: string) => apiFetch<void>(`/api/sessions/${id}`, { method: "DELETE" }),

  // ==========================================
  // Agent Contexts - /api/agent-contexts
  // ==========================================
  getAgentContexts: (limit = 100, offset = 0) =>
    apiFetch<AgentContextsResponse>(`/api/agent-contexts?limit=${limit}&offset=${offset}`),
  getAgentContextStats: () =>
    apiFetch<AgentContextsStatsResponse>(`/api/agent-contexts/stats`),

  // ==========================================
  // Auth - /api/auth
  // ==========================================
  getAuthToken: (agentId: string, sessionId?: string) =>
    apiFetch<{ token: string; expires_in: number }>("/api/auth/token", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, session_id: sessionId }),
    }),

  // ==========================================
  // Token Tracking - /api/capacity
  // ==========================================
  getCapacity: (agentId: string) =>
    apiFetch<AgentCapacity>(`/api/capacity/${agentId}`),

  // ==========================================
  // Agent Registry - /api/registry
  // ==========================================
  getRegistry: (params?: { category?: string; limit?: number; offset?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.category) searchParams.set("category", params.category);
    if (params?.limit) searchParams.set("limit", params.limit.toString());
    if (params?.offset) searchParams.set("offset", params.offset.toString());
    const query = searchParams.toString();
    return apiFetch<{ agents: AgentRegistryEntry[]; total: number }>(
      `/api/registry${query ? `?${query}` : ""}`
    );
  },
  getRegistryAgent: (agentType: string) =>
    apiFetch<{ agent: AgentRegistryEntry }>(`/api/registry/${agentType}`),
  getRegistryCatalog: (params?: { type?: string; search?: string; category?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.type) searchParams.set("type", params.type);
    if (params?.search) searchParams.set("search", params.search);
    if (params?.category) searchParams.set("category", params.category);
    const query = searchParams.toString();
    return apiFetch<CatalogResponse>(`/api/registry/catalog${query ? `?${query}` : ""}`);
  },

  // ==========================================
  // Orchestration - /api/orchestration
  // ==========================================
  getBatch: (batchId: string) =>
    apiFetch<{ batch: OrchestrationBatch & { subtasks: unknown[] } }>(
      `/api/orchestration/batch/${batchId}`
    ),
  getSynthesis: (batchId: string) =>
    apiFetch<Record<string, unknown>>(`/api/orchestration/synthesis/${batchId}`),
  getConflicts: (batchId: string) =>
    apiFetch<{ conflicts: unknown[]; conflict_count: number }>(
      `/api/orchestration/conflicts/${batchId}`
    ),

  // ==========================================
  // Waves - /api/waves
  // ==========================================
  getWaveCurrent: (sessionId: string) =>
    apiFetch<{ wave: WaveState }>(`/api/waves/${sessionId}/current`),
  getWaveHistory: (sessionId: string) =>
    apiFetch<{ waves: WaveState[]; count: number }>(`/api/waves/${sessionId}/history`),

  // ==========================================
  // Compact Snapshots - /api/agent-contexts
  // ==========================================
  getCompactSnapshots: (sessionId?: string) => {
    const searchParams = new URLSearchParams({ agent_type: "compact-snapshot" });
    if (sessionId) searchParams.set("session_id", sessionId);
    return apiFetch<{ snapshots: CompactEvent[] }>(
      `/api/agent-contexts?${searchParams}`
    );
  },
};

export default apiClient;
