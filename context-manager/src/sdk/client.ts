/**
 * DCM REST API Client
 * Provides typed methods for all DCM API endpoints
 */

import type { DCMConfig, ActionInput, ToolSuggestion, SubtaskInput, MessageInput, SessionInput } from "./types";

const DEFAULT_CONFIG: Required<DCMConfig> = {
  apiUrl: "http://127.0.0.1:3847",
  wsUrl: "ws://127.0.0.1:3849",
  timeout: 5000,
  retries: 2,
  authToken: "",
  agentId: "",
  sessionId: "",
};

export class DCMClient {
  private config: Required<DCMConfig>;

  constructor(config?: DCMConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= this.config.retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
        
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (this.config.authToken) {
          headers["Authorization"] = `Bearer ${this.config.authToken}`;
        }

        const response = await fetch(`${this.config.apiUrl}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          const error = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(`DCM API ${method} ${path}: ${response.status} - ${JSON.stringify(error)}`);
        }
        
        return await response.json() as T;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < this.config.retries) {
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        }
      }
    }
    throw lastError!;
  }

  // ==================== Health ====================
  
  async health(): Promise<{ status: string; database: { healthy: boolean } }> {
    return this.request("GET", "/health");
  }

  async isHealthy(): Promise<boolean> {
    try {
      const h = await this.health();
      return h.status === "healthy";
    } catch {
      return false;
    }
  }

  // ==================== Actions ====================
  
  async recordAction(action: ActionInput): Promise<{ success: boolean; action: { id: string } }> {
    return this.request("POST", "/api/actions", action);
  }

  async getActions(opts?: { tool_name?: string; tool_type?: string; limit?: number; offset?: number }): Promise<{ actions: unknown[]; count: number }> {
    const params = new URLSearchParams();
    if (opts?.tool_name) params.set("tool_name", opts.tool_name);
    if (opts?.tool_type) params.set("tool_type", opts.tool_type);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    const qs = params.toString();
    return this.request("GET", `/api/actions${qs ? "?" + qs : ""}`);
  }

  // ==================== Routing ====================
  
  async suggestTool(keywords: string[], opts?: { limit?: number; min_score?: number; tool_type?: string }): Promise<{ suggestions: ToolSuggestion[]; count: number }> {
    const params = new URLSearchParams({ keywords: keywords.join(",") });
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.min_score) params.set("min_score", String(opts.min_score));
    if (opts?.tool_type) params.set("tool_type", opts.tool_type);
    return this.request("GET", `/api/routing/suggest?${params}`);
  }

  async routingFeedback(tool_name: string, keywords: string[], chosen: boolean): Promise<{ success: boolean }> {
    return this.request("POST", "/api/routing/feedback", { tool_name, keywords, chosen });
  }

  // ==================== Projects ====================
  
  async createProject(path: string, name?: string): Promise<{ project: { id: string } }> {
    return this.request("POST", "/api/projects", { path, name });
  }

  async getProjectByPath(path: string): Promise<{ project: { id: string; path: string } }> {
    return this.request("GET", `/api/projects/by-path?path=${encodeURIComponent(path)}`);
  }

  // ==================== Sessions ====================
  
  async createSession(input: SessionInput): Promise<{ session: { id: string } }> {
    return this.request("POST", "/api/sessions", input);
  }

  async getSession(id: string): Promise<{ session: unknown }> {
    return this.request("GET", `/api/sessions/${id}`);
  }

  async endSession(id: string): Promise<{ session: unknown }> {
    return this.request("PATCH", `/api/sessions/${id}`, { ended_at: new Date().toISOString() });
  }

  // ==================== Requests ====================
  
  async createRequest(sessionId: string, prompt: string, projectId: string): Promise<{ request: { id: string } }> {
    return this.request("POST", "/api/requests", { session_id: sessionId, prompt, project_id: projectId });
  }

  // ==================== Tasks ====================
  
  async createTask(requestId: string, name?: string): Promise<{ task: { id: string; wave_number: number } }> {
    return this.request("POST", "/api/tasks", { request_id: requestId, name });
  }

  async updateTask(id: string, updates: { status?: string; completed_at?: string }): Promise<{ task: unknown }> {
    return this.request("PATCH", `/api/tasks/${id}`, updates);
  }

  // ==================== Subtasks ====================
  
  async createSubtask(input: SubtaskInput): Promise<{ subtask: { id: string } }> {
    return this.request("POST", "/api/subtasks", input);
  }

  async updateSubtask(id: string, updates: { status?: string; result?: unknown }): Promise<{ subtask: unknown }> {
    return this.request("PATCH", `/api/subtasks/${id}`, updates);
  }

  async getSubtasks(opts?: { task_id?: string; status?: string; agent_type?: string }): Promise<{ subtasks: unknown[]; count: number }> {
    const params = new URLSearchParams();
    if (opts?.task_id) params.set("task_id", opts.task_id);
    if (opts?.status) params.set("status", opts.status);
    if (opts?.agent_type) params.set("agent_type", opts.agent_type);
    const qs = params.toString();
    return this.request("GET", `/api/subtasks${qs ? "?" + qs : ""}`);
  }

  // ==================== Messages ====================
  
  async sendMessage(input: MessageInput): Promise<{ message: { id: string } }> {
    return this.request("POST", "/api/messages", input);
  }

  async getMessages(agentId: string, opts?: { topic?: string; since?: string }): Promise<{ messages: unknown[] }> {
    const params = new URLSearchParams();
    if (opts?.topic) params.set("topic", opts.topic);
    if (opts?.since) params.set("since", opts.since);
    const qs = params.toString();
    return this.request("GET", `/api/messages/${agentId}${qs ? "?" + qs : ""}`);
  }

  // ==================== Subscriptions ====================
  
  async subscribe(agentId: string, topic: string): Promise<{ subscription: { id: string } }> {
    return this.request("POST", "/api/subscribe", { agent_id: agentId, topic });
  }

  async unsubscribe(agentId: string, topic: string): Promise<{ success: boolean }> {
    return this.request("POST", "/api/unsubscribe", { agent_id: agentId, topic });
  }

  // ==================== Blocking ====================
  
  async blockAgent(blockerId: string, blockedId: string, reason?: string): Promise<{ blocking: { id: string } }> {
    return this.request("POST", "/api/blocking", { blocker_agent_id: blockerId, blocked_agent_id: blockedId, reason });
  }

  async unblockAgent(blockerId: string, blockedId: string): Promise<{ success: boolean }> {
    return this.request("POST", "/api/unblock", { blocker_agent_id: blockerId, blocked_agent_id: blockedId });
  }

  async isBlocked(agentId: string): Promise<boolean> {
    try {
      const result = await this.request<{ is_blocked: boolean }>("GET", `/api/blocking/check?agent_id=${agentId}`);
      return result.is_blocked;
    } catch {
      return false;
    }
  }

  // ==================== Context ====================
  
  async getContext(agentId: string, opts?: { session_id?: string; format?: "brief" | "raw"; max_tokens?: number }): Promise<unknown> {
    const params = new URLSearchParams();
    if (opts?.session_id) params.set("session_id", opts.session_id);
    if (opts?.format) params.set("format", opts.format);
    if (opts?.max_tokens) params.set("max_tokens", String(opts.max_tokens));
    const qs = params.toString();
    return this.request("GET", `/api/context/${agentId}${qs ? "?" + qs : ""}`);
  }

  async restoreAfterCompact(sessionId: string, agentId: string, summary?: string): Promise<unknown> {
    return this.request("POST", "/api/compact/restore", { session_id: sessionId, agent_id: agentId, compact_summary: summary });
  }

  // ==================== Auth ====================
  
  async getToken(agentId: string, sessionId?: string): Promise<{ token: string; expires_in: number }> {
    return this.request("POST", "/api/auth/token", { agent_id: agentId, session_id: sessionId });
  }

  // ==================== Hierarchy ====================
  
  async getHierarchy(projectId: string): Promise<unknown> {
    return this.request("GET", `/api/hierarchy/${projectId}`);
  }
}
