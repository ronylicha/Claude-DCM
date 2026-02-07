/**
 * DCM API Integration Tests
 * Tests all core REST API endpoints against a running server.
 *
 * Prerequisites:
 *   - PostgreSQL running with claude_context database
 *   - DCM API server running on port 3847
 *
 * Run: bun test src/tests/api.test.ts
 *
 * @module tests/api
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const BASE_URL = process.env["DCM_API_URL"] || "http://127.0.0.1:3847";

/** Shared state across ordered tests */
const state: {
  serverAvailable: boolean;
  projectId: string;
  requestId: string;
  taskId: string;
  subtaskId: string;
  actionId: string;
  sessionId: string;
  messageId: string;
  subscriptionId: string;
  blockingId: string;
} = {
  serverAvailable: false,
  projectId: "",
  requestId: "",
  taskId: "",
  subtaskId: "",
  actionId: "",
  sessionId: "",
  messageId: "",
  subscriptionId: "",
  blockingId: "",
};

// Unique prefix to avoid collisions with real data
const TEST_PREFIX = `test_${Date.now()}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: Record<string, unknown> }> {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

function skip(testName: string): void {
  if (!state.serverAvailable) {
    console.log(`  [SKIP] ${testName} -- server not reachable at ${BASE_URL}`);
  }
}

// ---------------------------------------------------------------------------
// Health & Connectivity
// ---------------------------------------------------------------------------

describe("DCM API Integration Tests", () => {
  beforeAll(async () => {
    try {
      const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
      state.serverAvailable = res.ok;
    } catch {
      state.serverAvailable = false;
    }
    if (!state.serverAvailable) {
      console.warn(
        `\n  WARNING: DCM API not reachable at ${BASE_URL}.\n` +
          "  All integration tests will be skipped.\n" +
          "  Start the server with: bun run start:api\n",
      );
    }
  });

  // ========================================================================
  // Health & Stats
  // ========================================================================

  describe("Health & Stats", () => {
    it("GET /health returns healthy status", async () => {
      if (!state.serverAvailable) return skip("GET /health");
      const { status, data } = await api("GET", "/health");
      expect(status).toBe(200);
      expect(data["status"]).toBe("healthy");
      expect(data["version"]).toBeDefined();
      expect(data["database"]).toBeDefined();
      expect(data["features"]).toBeDefined();
    });

    it("GET /stats returns database statistics", async () => {
      if (!state.serverAvailable) return skip("GET /stats");
      const { status, data } = await api("GET", "/stats");
      expect(status).toBe(200);
      expect(data["timestamp"]).toBeDefined();
      expect(typeof data["projectCount"]).toBe("number");
    });
  });

  // ========================================================================
  // Projects
  // ========================================================================

  describe("Projects API", () => {
    it("POST /api/projects creates a project", async () => {
      if (!state.serverAvailable) return skip("POST /api/projects");
      const { status, data } = await api("POST", "/api/projects", {
        path: `/tmp/${TEST_PREFIX}/my-project`,
        name: `Test Project ${TEST_PREFIX}`,
        metadata: { test: true },
      });
      expect(status).toBe(201);
      expect(data["success"]).toBe(true);
      const project = data["project"] as Record<string, unknown>;
      expect(project["id"]).toBeDefined();
      expect(project["path"]).toBe(`/tmp/${TEST_PREFIX}/my-project`);
      state.projectId = project["id"] as string;
    });

    it("POST /api/projects with missing path returns 400", async () => {
      if (!state.serverAvailable) return skip("POST /api/projects missing path");
      const { status, data } = await api("POST", "/api/projects", {});
      expect(status).toBe(400);
      expect(data["error"]).toBeDefined();
    });

    it("POST /api/projects upserts existing project", async () => {
      if (!state.serverAvailable) return skip("POST /api/projects upsert");
      const { status, data } = await api("POST", "/api/projects", {
        path: `/tmp/${TEST_PREFIX}/my-project`,
        name: `Test Project ${TEST_PREFIX} Updated`,
      });
      expect(status).toBe(201);
      const project = data["project"] as Record<string, unknown>;
      expect(project["id"]).toBe(state.projectId);
    });

    it("GET /api/projects lists projects with pagination", async () => {
      if (!state.serverAvailable) return skip("GET /api/projects");
      const { status, data } = await api("GET", "/api/projects?limit=10&offset=0");
      expect(status).toBe(200);
      expect(Array.isArray(data["projects"])).toBe(true);
      expect(typeof data["total"]).toBe("number");
      expect(typeof data["count"]).toBe("number");
    });

    it("GET /api/projects/:id returns project with requests", async () => {
      if (!state.serverAvailable || !state.projectId) return skip("GET /api/projects/:id");
      const { status, data } = await api("GET", `/api/projects/${state.projectId}`);
      expect(status).toBe(200);
      const project = data["project"] as Record<string, unknown>;
      expect(project["id"]).toBe(state.projectId);
      expect(project["requests"]).toBeDefined();
    });

    it("GET /api/projects/:id with invalid UUID returns 500", async () => {
      if (!state.serverAvailable) return skip("GET /api/projects/:id invalid");
      const { status } = await api("GET", "/api/projects/not-a-uuid");
      // postgres.js will likely throw on invalid UUID format
      expect(status).toBeGreaterThanOrEqual(400);
    });

    it("GET /api/projects/by-path returns project by path", async () => {
      if (!state.serverAvailable) return skip("GET /api/projects/by-path");
      const encodedPath = encodeURIComponent(`/tmp/${TEST_PREFIX}/my-project`);
      const { status, data } = await api("GET", `/api/projects/by-path?path=${encodedPath}`);
      expect(status).toBe(200);
      const project = data["project"] as Record<string, unknown>;
      expect(project["id"]).toBe(state.projectId);
    });

    it("GET /api/projects/by-path without path returns 400", async () => {
      if (!state.serverAvailable) return skip("GET /api/projects/by-path missing");
      const { status, data } = await api("GET", "/api/projects/by-path");
      expect(status).toBe(400);
      expect(data["error"]).toBeDefined();
    });

    it("GET /api/projects/by-path with unknown path returns 404", async () => {
      if (!state.serverAvailable) return skip("GET /api/projects/by-path 404");
      const { status } = await api("GET", "/api/projects/by-path?path=/nonexistent/path/xyz");
      expect(status).toBe(404);
    });
  });

  // ========================================================================
  // Sessions
  // ========================================================================

  describe("Sessions API", () => {
    it("POST /api/sessions creates a session", async () => {
      if (!state.serverAvailable) return skip("POST /api/sessions");
      state.sessionId = `${TEST_PREFIX}_session_001`;
      const { status, data } = await api("POST", "/api/sessions", {
        id: state.sessionId,
        project_id: state.projectId || undefined,
      });
      expect(status).toBe(201);
      expect(data["id"]).toBe(state.sessionId);
    });

    it("POST /api/sessions with missing id returns 400", async () => {
      if (!state.serverAvailable) return skip("POST /api/sessions missing id");
      const { status, data } = await api("POST", "/api/sessions", {});
      expect(status).toBe(400);
      expect(data["error"]).toBeDefined();
    });

    it("POST /api/sessions with duplicate id returns 409", async () => {
      if (!state.serverAvailable || !state.sessionId) return skip("POST /api/sessions duplicate");
      const { status, data } = await api("POST", "/api/sessions", {
        id: state.sessionId,
      });
      expect(status).toBe(409);
      expect(data["error"]).toContain("already exists");
    });

    it("GET /api/sessions lists sessions", async () => {
      if (!state.serverAvailable) return skip("GET /api/sessions");
      const { status, data } = await api("GET", "/api/sessions?limit=10");
      expect(status).toBe(200);
      expect(Array.isArray(data["sessions"])).toBe(true);
      expect(typeof data["total"]).toBe("number");
    });

    it("GET /api/sessions with active_only filter", async () => {
      if (!state.serverAvailable) return skip("GET /api/sessions active_only");
      const { status, data } = await api("GET", "/api/sessions?active_only=true");
      expect(status).toBe(200);
      expect(Array.isArray(data["sessions"])).toBe(true);
    });

    it("GET /api/sessions/:id returns session details", async () => {
      if (!state.serverAvailable || !state.sessionId) return skip("GET /api/sessions/:id");
      const { status, data } = await api("GET", `/api/sessions/${state.sessionId}`);
      expect(status).toBe(200);
      expect(data["id"]).toBe(state.sessionId);
      expect(data["requests"]).toBeDefined();
    });

    it("GET /api/sessions/:id with unknown id returns 404", async () => {
      if (!state.serverAvailable) return skip("GET /api/sessions/:id 404");
      const { status } = await api("GET", "/api/sessions/nonexistent-session-id");
      expect(status).toBe(404);
    });

    it("PATCH /api/sessions/:id updates session", async () => {
      if (!state.serverAvailable || !state.sessionId) return skip("PATCH /api/sessions/:id");
      const { status, data } = await api("PATCH", `/api/sessions/${state.sessionId}`, {
        total_tools_used: 5,
        total_success: 4,
        total_errors: 1,
      });
      expect(status).toBe(200);
      expect(data["total_tools_used"]).toBe(5);
    });

    it("PATCH /api/sessions/:id with no fields returns 400", async () => {
      if (!state.serverAvailable || !state.sessionId) return skip("PATCH /api/sessions/:id empty");
      const { status, data } = await api("PATCH", `/api/sessions/${state.sessionId}`, {});
      expect(status).toBe(400);
      expect(data["error"]).toBeDefined();
    });

    it("GET /api/sessions/stats returns statistics", async () => {
      if (!state.serverAvailable) return skip("GET /api/sessions/stats");
      const { status, data } = await api("GET", "/api/sessions/stats");
      expect(status).toBe(200);
      expect(data["overview"]).toBeDefined();
      expect(data["by_project"]).toBeDefined();
    });
  });

  // ========================================================================
  // Requests
  // ========================================================================

  describe("Requests API", () => {
    it("POST /api/requests creates a request", async () => {
      if (!state.serverAvailable || !state.projectId) return skip("POST /api/requests");
      const { status, data } = await api("POST", "/api/requests", {
        project_id: state.projectId,
        session_id: state.sessionId || `${TEST_PREFIX}_fallback_session`,
        prompt: "Implement OAuth2 authentication",
        prompt_type: "feature",
        metadata: { priority: "high" },
      });
      expect(status).toBe(201);
      expect(data["success"]).toBe(true);
      const request = data["request"] as Record<string, unknown>;
      expect(request["id"]).toBeDefined();
      expect(request["status"]).toBe("active");
      state.requestId = request["id"] as string;
    });

    it("POST /api/requests with missing fields returns 400", async () => {
      if (!state.serverAvailable) return skip("POST /api/requests missing fields");
      const { status } = await api("POST", "/api/requests", { project_id: state.projectId });
      expect(status).toBe(400);
    });

    it("POST /api/requests with invalid prompt_type returns 400", async () => {
      if (!state.serverAvailable || !state.projectId) return skip("POST /api/requests bad type");
      const { status, data } = await api("POST", "/api/requests", {
        project_id: state.projectId,
        session_id: "test",
        prompt: "test",
        prompt_type: "invalid_type",
      });
      expect(status).toBe(400);
      expect(data["error"]).toContain("Invalid prompt_type");
    });

    it("POST /api/requests with nonexistent project returns 404", async () => {
      if (!state.serverAvailable) return skip("POST /api/requests bad project");
      const { status } = await api("POST", "/api/requests", {
        project_id: "00000000-0000-0000-0000-000000000000",
        session_id: "test",
        prompt: "test",
      });
      expect(status).toBe(404);
    });

    it("GET /api/requests lists requests with filters", async () => {
      if (!state.serverAvailable) return skip("GET /api/requests");
      const { status, data } = await api("GET", `/api/requests?project_id=${state.projectId}&limit=10`);
      expect(status).toBe(200);
      expect(Array.isArray(data["requests"])).toBe(true);
      expect(data["count"]).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/requests/:id returns request with tasks", async () => {
      if (!state.serverAvailable || !state.requestId) return skip("GET /api/requests/:id");
      const { status, data } = await api("GET", `/api/requests/${state.requestId}`);
      expect(status).toBe(200);
      const request = data["request"] as Record<string, unknown>;
      expect(request["id"]).toBe(state.requestId);
      expect(request["tasks"]).toBeDefined();
    });

    it("PATCH /api/requests/:id updates status", async () => {
      if (!state.serverAvailable || !state.requestId) return skip("PATCH /api/requests/:id");
      const { status, data } = await api("PATCH", `/api/requests/${state.requestId}`, {
        status: "completed",
        metadata: { completed_reason: "test" },
      });
      expect(status).toBe(200);
      expect(data["success"]).toBe(true);
      const request = data["request"] as Record<string, unknown>;
      expect(request["status"]).toBe("completed");
      expect(request["completed_at"]).toBeDefined();
    });

    it("PATCH /api/requests/:id with invalid status returns 400", async () => {
      if (!state.serverAvailable || !state.requestId) return skip("PATCH /api/requests/:id bad status");
      const { status, data } = await api("PATCH", `/api/requests/${state.requestId}`, {
        status: "invalid_status",
      });
      expect(status).toBe(400);
      expect(data["error"]).toContain("Invalid status");
    });
  });

  // ========================================================================
  // Tasks
  // ========================================================================

  describe("Tasks API", () => {
    it("POST /api/tasks creates a task", async () => {
      if (!state.serverAvailable || !state.requestId) return skip("POST /api/tasks");
      const { status, data } = await api("POST", "/api/tasks", {
        request_id: state.requestId,
        name: `Wave 0 - ${TEST_PREFIX}`,
        wave_number: 0,
      });
      expect(status).toBe(201);
      expect(data["success"]).toBe(true);
      const task = data["task"] as Record<string, unknown>;
      expect(task["id"]).toBeDefined();
      expect(task["wave_number"]).toBe(0);
      expect(task["status"]).toBe("pending");
      state.taskId = task["id"] as string;
    });

    it("POST /api/tasks auto-increments wave_number", async () => {
      if (!state.serverAvailable || !state.requestId) return skip("POST /api/tasks auto-wave");
      const { status, data } = await api("POST", "/api/tasks", {
        request_id: state.requestId,
        name: `Auto Wave - ${TEST_PREFIX}`,
      });
      expect(status).toBe(201);
      const task = data["task"] as Record<string, unknown>;
      expect(task["wave_number"]).toBe(1); // auto-incremented from 0
    });

    it("POST /api/tasks with missing request_id returns 400", async () => {
      if (!state.serverAvailable) return skip("POST /api/tasks missing request_id");
      const { status } = await api("POST", "/api/tasks", { name: "test" });
      expect(status).toBe(400);
    });

    it("POST /api/tasks with invalid status returns 400", async () => {
      if (!state.serverAvailable || !state.requestId) return skip("POST /api/tasks bad status");
      const { status, data } = await api("POST", "/api/tasks", {
        request_id: state.requestId,
        status: "invalid",
      });
      expect(status).toBe(400);
      expect(data["error"]).toContain("Invalid status");
    });

    it("POST /api/tasks with nonexistent request returns 404", async () => {
      if (!state.serverAvailable) return skip("POST /api/tasks bad request");
      const { status } = await api("POST", "/api/tasks", {
        request_id: "00000000-0000-0000-0000-000000000000",
      });
      expect(status).toBe(404);
    });

    it("GET /api/tasks lists tasks with filters", async () => {
      if (!state.serverAvailable) return skip("GET /api/tasks");
      const { status, data } = await api("GET", `/api/tasks?request_id=${state.requestId}`);
      expect(status).toBe(200);
      expect(Array.isArray(data["tasks"])).toBe(true);
      expect(data["count"]).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/tasks with status filter", async () => {
      if (!state.serverAvailable) return skip("GET /api/tasks status filter");
      const { status, data } = await api("GET", "/api/tasks?status=pending");
      expect(status).toBe(200);
      expect(Array.isArray(data["tasks"])).toBe(true);
    });

    it("GET /api/tasks/:id returns task with subtasks", async () => {
      if (!state.serverAvailable || !state.taskId) return skip("GET /api/tasks/:id");
      const { status, data } = await api("GET", `/api/tasks/${state.taskId}`);
      expect(status).toBe(200);
      const task = data["task"] as Record<string, unknown>;
      expect(task["id"]).toBe(state.taskId);
      expect(task["subtasks"]).toBeDefined();
    });

    it("GET /api/tasks/:id with unknown id returns 404", async () => {
      if (!state.serverAvailable) return skip("GET /api/tasks/:id 404");
      const { status } = await api("GET", "/api/tasks/00000000-0000-0000-0000-000000000000");
      expect(status).toBe(404);
    });

    it("PATCH /api/tasks/:id updates status to running", async () => {
      if (!state.serverAvailable || !state.taskId) return skip("PATCH /api/tasks/:id running");
      const { status, data } = await api("PATCH", `/api/tasks/${state.taskId}`, {
        status: "running",
      });
      expect(status).toBe(200);
      expect(data["success"]).toBe(true);
      const task = data["task"] as Record<string, unknown>;
      expect(task["status"]).toBe("running");
    });

    it("PATCH /api/tasks/:id updates status to completed", async () => {
      if (!state.serverAvailable || !state.taskId) return skip("PATCH /api/tasks/:id completed");
      const { status, data } = await api("PATCH", `/api/tasks/${state.taskId}`, {
        status: "completed",
      });
      expect(status).toBe(200);
      const task = data["task"] as Record<string, unknown>;
      expect(task["status"]).toBe("completed");
      expect(task["completed_at"]).toBeDefined();
    });

    it("PATCH /api/tasks/:id with no fields returns 400", async () => {
      if (!state.serverAvailable || !state.taskId) return skip("PATCH /api/tasks/:id empty");
      const { status, data } = await api("PATCH", `/api/tasks/${state.taskId}`, {});
      expect(status).toBe(400);
      expect(data["error"]).toContain("No update fields");
    });
  });

  // ========================================================================
  // Subtasks
  // ========================================================================

  describe("Subtasks API", () => {
    it("POST /api/subtasks creates a subtask", async () => {
      if (!state.serverAvailable || !state.taskId) return skip("POST /api/subtasks");
      const { status, data } = await api("POST", "/api/subtasks", {
        task_id: state.taskId,
        description: `Create migration oauth_tokens - ${TEST_PREFIX}`,
        agent_type: "backend-laravel",
        agent_id: `agent_${TEST_PREFIX}`,
      });
      expect(status).toBe(201);
      expect(data["success"]).toBe(true);
      const subtask = data["subtask"] as Record<string, unknown>;
      expect(subtask["id"]).toBeDefined();
      expect(subtask["status"]).toBe("pending");
      expect(subtask["task_id"]).toBe(state.taskId);
      state.subtaskId = subtask["id"] as string;
    });

    it("POST /api/subtasks with missing fields returns 400", async () => {
      if (!state.serverAvailable) return skip("POST /api/subtasks missing fields");
      const { status } = await api("POST", "/api/subtasks", { task_id: state.taskId });
      expect(status).toBe(400);
    });

    it("POST /api/subtasks with invalid status returns 400", async () => {
      if (!state.serverAvailable || !state.taskId) return skip("POST /api/subtasks bad status");
      const { status, data } = await api("POST", "/api/subtasks", {
        task_id: state.taskId,
        description: "test",
        status: "invalid",
      });
      expect(status).toBe(400);
      expect(data["error"]).toContain("Invalid status");
    });

    it("POST /api/subtasks with nonexistent task returns 404", async () => {
      if (!state.serverAvailable) return skip("POST /api/subtasks bad task");
      const { status } = await api("POST", "/api/subtasks", {
        task_id: "00000000-0000-0000-0000-000000000000",
        description: "test",
      });
      expect(status).toBe(404);
    });

    it("GET /api/subtasks lists subtasks with filters", async () => {
      if (!state.serverAvailable) return skip("GET /api/subtasks");
      const { status, data } = await api("GET", `/api/subtasks?task_id=${state.taskId}`);
      expect(status).toBe(200);
      expect(Array.isArray(data["subtasks"])).toBe(true);
      expect(data["count"]).toBeGreaterThanOrEqual(1);
    });

    it("GET /api/subtasks with agent_type filter", async () => {
      if (!state.serverAvailable) return skip("GET /api/subtasks agent_type");
      const { status, data } = await api("GET", "/api/subtasks?agent_type=backend-laravel");
      expect(status).toBe(200);
      expect(Array.isArray(data["subtasks"])).toBe(true);
    });

    it("GET /api/subtasks/:id returns subtask with actions", async () => {
      if (!state.serverAvailable || !state.subtaskId) return skip("GET /api/subtasks/:id");
      const { status, data } = await api("GET", `/api/subtasks/${state.subtaskId}`);
      expect(status).toBe(200);
      const subtask = data["subtask"] as Record<string, unknown>;
      expect(subtask["id"]).toBe(state.subtaskId);
      expect(subtask["actions"]).toBeDefined();
    });

    it("PATCH /api/subtasks/:id updates status to running", async () => {
      if (!state.serverAvailable || !state.subtaskId) return skip("PATCH /api/subtasks/:id running");
      const { status, data } = await api("PATCH", `/api/subtasks/${state.subtaskId}`, {
        status: "running",
        agent_id: `agent_${TEST_PREFIX}_running`,
      });
      expect(status).toBe(200);
      expect(data["success"]).toBe(true);
      const subtask = data["subtask"] as Record<string, unknown>;
      expect(subtask["status"]).toBe("running");
      expect(subtask["started_at"]).toBeDefined();
    });

    it("PATCH /api/subtasks/:id updates status to completed with result", async () => {
      if (!state.serverAvailable || !state.subtaskId) return skip("PATCH /api/subtasks/:id completed");
      const { status, data } = await api("PATCH", `/api/subtasks/${state.subtaskId}`, {
        status: "completed",
        result: { files_created: 2, migration: "2026_01_30_create_oauth_tokens" },
      });
      expect(status).toBe(200);
      const subtask = data["subtask"] as Record<string, unknown>;
      expect(subtask["status"]).toBe("completed");
      expect(subtask["completed_at"]).toBeDefined();
      expect(subtask["result"]).toBeDefined();
    });

    it("PATCH /api/subtasks/:id with no fields returns 400", async () => {
      if (!state.serverAvailable || !state.subtaskId) return skip("PATCH /api/subtasks/:id empty");
      const { status, data } = await api("PATCH", `/api/subtasks/${state.subtaskId}`, {});
      expect(status).toBe(400);
      expect(data["error"]).toContain("No update fields");
    });
  });

  // ========================================================================
  // Actions
  // ========================================================================

  describe("Actions API", () => {
    it("POST /api/actions records an action", async () => {
      if (!state.serverAvailable) return skip("POST /api/actions");
      const { status, data } = await api("POST", "/api/actions", {
        tool_name: "Edit",
        tool_type: "builtin",
        input: "Edit the migration file for OAuth tokens",
        output: "File edited successfully",
        exit_code: 0,
        duration_ms: 150,
        file_paths: ["/app/migrations/create_oauth_tokens.php"],
        subtask_id: state.subtaskId || undefined,
        session_id: state.sessionId || undefined,
        project_path: `/tmp/${TEST_PREFIX}/my-project`,
      });
      expect(status).toBe(201);
      expect(data["success"]).toBe(true);
      const action = data["action"] as Record<string, unknown>;
      expect(action["id"]).toBeDefined();
      expect(action["tool_name"]).toBe("Edit");
      expect(typeof action["keywords_extracted"]).toBe("number");
      state.actionId = action["id"] as string;
    });

    it("POST /api/actions with missing fields returns 400", async () => {
      if (!state.serverAvailable) return skip("POST /api/actions missing fields");
      const { status } = await api("POST", "/api/actions", { tool_name: "Edit" });
      expect(status).toBe(400);
    });

    it("POST /api/actions with invalid tool_type returns 400", async () => {
      if (!state.serverAvailable) return skip("POST /api/actions bad type");
      const { status, data } = await api("POST", "/api/actions", {
        tool_name: "test",
        tool_type: "invalid_type",
      });
      expect(status).toBe(400);
      expect(data["error"]).toContain("Invalid tool_type");
    });

    it("GET /api/actions lists actions", async () => {
      if (!state.serverAvailable) return skip("GET /api/actions");
      const { status, data } = await api("GET", "/api/actions?limit=10");
      expect(status).toBe(200);
      expect(Array.isArray(data["actions"])).toBe(true);
    });

    it("GET /api/actions with tool_type filter", async () => {
      if (!state.serverAvailable) return skip("GET /api/actions tool_type");
      const { status, data } = await api("GET", "/api/actions?tool_type=builtin");
      expect(status).toBe(200);
      expect(Array.isArray(data["actions"])).toBe(true);
    });

    it("GET /api/actions with tool_name filter", async () => {
      if (!state.serverAvailable) return skip("GET /api/actions tool_name");
      const { status, data } = await api("GET", "/api/actions?tool_name=Edit");
      expect(status).toBe(200);
      expect(Array.isArray(data["actions"])).toBe(true);
    });

    it("GET /api/actions/hourly returns hourly counts", async () => {
      if (!state.serverAvailable) return skip("GET /api/actions/hourly");
      const { status, data } = await api("GET", "/api/actions/hourly");
      expect(status).toBe(200);
      expect(Array.isArray(data["data"])).toBe(true);
      expect(data["period"]).toBe("24h");
    });
  });

  // ========================================================================
  // Messages (Pub/Sub)
  // ========================================================================

  describe("Messages API", () => {
    it("POST /api/messages publishes a message", async () => {
      if (!state.serverAvailable) return skip("POST /api/messages");
      const { status, data } = await api("POST", "/api/messages", {
        from_agent: `agent_${TEST_PREFIX}_sender`,
        to_agent: `agent_${TEST_PREFIX}_receiver`,
        topic: "task.completed",
        content: { task_id: state.taskId, result: "success" },
        priority: 5,
        ttl_seconds: 600,
        project_id: state.projectId || undefined,
      });
      expect(status).toBe(201);
      expect(data["success"]).toBe(true);
      const message = data["message"] as Record<string, unknown>;
      expect(message["id"]).toBeDefined();
      expect(message["is_broadcast"]).toBe(false);
      state.messageId = message["id"] as string;
    });

    it("POST /api/messages publishes a broadcast message", async () => {
      if (!state.serverAvailable) return skip("POST /api/messages broadcast");
      const { status, data } = await api("POST", "/api/messages", {
        from_agent: `agent_${TEST_PREFIX}_broadcaster`,
        to_agent: null,
        topic: "task.created",
        content: { info: "new task available" },
      });
      expect(status).toBe(201);
      const message = data["message"] as Record<string, unknown>;
      expect(message["is_broadcast"]).toBe(true);
    });

    it("POST /api/messages with invalid topic returns 400", async () => {
      if (!state.serverAvailable) return skip("POST /api/messages bad topic");
      const { status, data } = await api("POST", "/api/messages", {
        from_agent: "test",
        topic: "invalid.topic",
        content: {},
      });
      expect(status).toBe(400);
      expect(data["error"]).toBe("Validation failed");
    });

    it("POST /api/messages with missing from_agent returns 400", async () => {
      if (!state.serverAvailable) return skip("POST /api/messages missing from_agent");
      const { status } = await api("POST", "/api/messages", {
        topic: "task.created",
        content: {},
      });
      expect(status).toBe(400);
    });

    it("GET /api/messages/:agent_id returns messages for agent", async () => {
      if (!state.serverAvailable) return skip("GET /api/messages/:agent_id");
      const agentId = `agent_${TEST_PREFIX}_receiver`;
      const { status, data } = await api("GET", `/api/messages/${agentId}`);
      expect(status).toBe(200);
      expect(data["agent_id"]).toBe(agentId);
      expect(Array.isArray(data["messages"])).toBe(true);
      expect(typeof data["unread_remaining"]).toBe("number");
    });

    it("GET /api/messages/:agent_id with topic filter", async () => {
      if (!state.serverAvailable) return skip("GET /api/messages/:agent_id topic");
      const agentId = `agent_${TEST_PREFIX}_receiver`;
      const { status, data } = await api("GET", `/api/messages/${agentId}?topic=task.completed`);
      expect(status).toBe(200);
      expect(Array.isArray(data["messages"])).toBe(true);
    });

    it("GET /api/messages/:agent_id with include_broadcasts=false", async () => {
      if (!state.serverAvailable) return skip("GET /api/messages no broadcasts");
      const agentId = `agent_${TEST_PREFIX}_receiver`;
      const { status, data } = await api(
        "GET",
        `/api/messages/${agentId}?include_broadcasts=false`,
      );
      expect(status).toBe(200);
      expect(Array.isArray(data["messages"])).toBe(true);
    });
  });

  // ========================================================================
  // Routing
  // ========================================================================

  describe("Routing API", () => {
    it("GET /api/routing/suggest returns suggestions for keywords", async () => {
      if (!state.serverAvailable) return skip("GET /api/routing/suggest");
      const { status, data } = await api("GET", "/api/routing/suggest?keywords=migration,oauth");
      expect(status).toBe(200);
      expect(Array.isArray(data["keywords"])).toBe(true);
      expect(Array.isArray(data["suggestions"])).toBe(true);
      expect(data["compat_output"]).toBeDefined();
    });

    it("GET /api/routing/suggest without keywords returns 400", async () => {
      if (!state.serverAvailable) return skip("GET /api/routing/suggest missing keywords");
      const { status, data } = await api("GET", "/api/routing/suggest");
      expect(status).toBe(400);
      expect(data["error"]).toContain("keywords");
    });

    it("GET /api/routing/suggest with tool_type filter", async () => {
      if (!state.serverAvailable) return skip("GET /api/routing/suggest tool_type");
      const { status, data } = await api(
        "GET",
        "/api/routing/suggest?keywords=test&tool_type=builtin",
      );
      expect(status).toBe(200);
      expect(Array.isArray(data["suggestions"])).toBe(true);
    });

    it("GET /api/routing/stats returns routing statistics", async () => {
      if (!state.serverAvailable) return skip("GET /api/routing/stats");
      const { status, data } = await api("GET", "/api/routing/stats");
      expect(status).toBe(200);
      expect(data["totals"]).toBeDefined();
      expect(data["top_by_score"]).toBeDefined();
      expect(data["top_by_usage"]).toBeDefined();
      expect(data["type_distribution"]).toBeDefined();
    });

    it("POST /api/routing/feedback updates scores", async () => {
      if (!state.serverAvailable) return skip("POST /api/routing/feedback");
      const { status, data } = await api("POST", "/api/routing/feedback", {
        tool_name: "Edit",
        keywords: ["migration", "oauth"],
        chosen: true,
      });
      expect(status).toBe(200);
      expect(data["success"]).toBe(true);
      expect(data["adjustment"]).toBe(0.2);
    });

    it("POST /api/routing/feedback with missing fields returns 400", async () => {
      if (!state.serverAvailable) return skip("POST /api/routing/feedback missing fields");
      const { status } = await api("POST", "/api/routing/feedback", { tool_name: "Edit" });
      expect(status).toBe(400);
    });
  });

  // ========================================================================
  // Hierarchy
  // ========================================================================

  describe("Hierarchy API", () => {
    it("GET /api/hierarchy/:project_id returns full hierarchy", async () => {
      if (!state.serverAvailable || !state.projectId) return skip("GET /api/hierarchy");
      const { status, data } = await api("GET", `/api/hierarchy/${state.projectId}`);
      expect(status).toBe(200);
      expect(data["hierarchy"]).toBeDefined();
      expect(data["stats"]).toBeDefined();
      expect(data["counts"]).toBeDefined();
      const hierarchy = data["hierarchy"] as Record<string, unknown>;
      expect(hierarchy["id"]).toBe(state.projectId);
      expect(Array.isArray(hierarchy["requests"])).toBe(true);
    });

    it("GET /api/hierarchy/:project_id with unknown project returns 404", async () => {
      if (!state.serverAvailable) return skip("GET /api/hierarchy 404");
      const { status } = await api("GET", "/api/hierarchy/00000000-0000-0000-0000-000000000000");
      expect(status).toBe(404);
    });

    it("GET /api/active-sessions returns active agents", async () => {
      if (!state.serverAvailable) return skip("GET /api/active-sessions");
      const { status, data } = await api("GET", "/api/active-sessions");
      expect(status).toBe(200);
      expect(Array.isArray(data["active_agents"])).toBe(true);
      expect(typeof data["count"]).toBe("number");
    });
  });

  // ========================================================================
  // Subscriptions
  // ========================================================================

  describe("Subscriptions API", () => {
    it("POST /api/subscribe creates a subscription", async () => {
      if (!state.serverAvailable) return skip("POST /api/subscribe");
      const { status, data } = await api("POST", "/api/subscribe", {
        agent_id: `agent_${TEST_PREFIX}_subscriber`,
        topic: "task.created",
      });
      expect(status).toBe(201);
      expect(data["success"]).toBe(true);
      const sub = data["subscription"] as Record<string, unknown>;
      expect(sub["id"]).toBeDefined();
      state.subscriptionId = sub["id"] as string;
    });

    it("POST /api/subscribe with invalid topic returns 400", async () => {
      if (!state.serverAvailable) return skip("POST /api/subscribe bad topic");
      const { status, data } = await api("POST", "/api/subscribe", {
        agent_id: "test",
        topic: "invalid.topic.here",
      });
      expect(status).toBe(400);
      expect(data["error"]).toBe("Validation failed");
    });

    it("GET /api/subscriptions lists all subscriptions", async () => {
      if (!state.serverAvailable) return skip("GET /api/subscriptions");
      const { status, data } = await api("GET", "/api/subscriptions");
      expect(status).toBe(200);
      expect(Array.isArray(data["subscriptions"])).toBe(true);
    });

    it("GET /api/subscriptions with agent_id filter", async () => {
      if (!state.serverAvailable) return skip("GET /api/subscriptions agent_id");
      const { status, data } = await api(
        "GET",
        `/api/subscriptions?agent_id=agent_${TEST_PREFIX}_subscriber`,
      );
      expect(status).toBe(200);
      expect(Array.isArray(data["subscriptions"])).toBe(true);
    });

    it("GET /api/subscriptions/:agent_id returns agent subscriptions", async () => {
      if (!state.serverAvailable) return skip("GET /api/subscriptions/:agent_id");
      const agentId = `agent_${TEST_PREFIX}_subscriber`;
      const { status, data } = await api("GET", `/api/subscriptions/${agentId}`);
      expect(status).toBe(200);
      expect(data["agent_id"]).toBe(agentId);
      expect(Array.isArray(data["subscriptions"])).toBe(true);
      expect(Array.isArray(data["topics"])).toBe(true);
    });

    it("POST /api/unsubscribe removes subscription by agent and topic", async () => {
      if (!state.serverAvailable) return skip("POST /api/unsubscribe");
      // First subscribe to a topic we can unsubscribe from
      await api("POST", "/api/subscribe", {
        agent_id: `agent_${TEST_PREFIX}_unsub`,
        topic: "task.failed",
      });
      const { status, data } = await api("POST", "/api/unsubscribe", {
        agent_id: `agent_${TEST_PREFIX}_unsub`,
        topic: "task.failed",
      });
      expect(status).toBe(200);
      expect(data["success"]).toBe(true);
    });

    it("DELETE /api/subscriptions/:id removes subscription", async () => {
      if (!state.serverAvailable || !state.subscriptionId) return skip("DELETE /api/subscriptions/:id");
      const { status, data } = await api("DELETE", `/api/subscriptions/${state.subscriptionId}`);
      expect(status).toBe(200);
      expect(data["success"]).toBe(true);
    });

    it("DELETE /api/subscriptions/:id with unknown id returns 404", async () => {
      if (!state.serverAvailable) return skip("DELETE /api/subscriptions/:id 404");
      const { status } = await api("DELETE", "/api/subscriptions/00000000-0000-0000-0000-000000000000");
      expect(status).toBe(404);
    });
  });

  // ========================================================================
  // Blocking
  // ========================================================================

  describe("Blocking API", () => {
    it("POST /api/blocking blocks an agent", async () => {
      if (!state.serverAvailable) return skip("POST /api/blocking");
      const { status, data } = await api("POST", "/api/blocking", {
        blocked_by: `agent_${TEST_PREFIX}_blocker`,
        blocked_agent: `agent_${TEST_PREFIX}_blocked`,
        reason: "Waiting for migration to complete",
      });
      expect(status).toBe(201);
      expect(data["success"]).toBe(true);
      const blocking = data["blocking"] as Record<string, unknown>;
      expect(blocking["id"]).toBeDefined();
      state.blockingId = blocking["id"] as string;
    });

    it("POST /api/blocking prevents self-blocking", async () => {
      if (!state.serverAvailable) return skip("POST /api/blocking self-block");
      const { status, data } = await api("POST", "/api/blocking", {
        blocked_by: "same-agent",
        blocked_agent: "same-agent",
      });
      expect(status).toBe(400);
      expect(data["error"]).toContain("cannot block itself");
    });

    it("GET /api/blocking/:agent_id returns blocking relationships", async () => {
      if (!state.serverAvailable) return skip("GET /api/blocking/:agent_id");
      const agentId = `agent_${TEST_PREFIX}_blocked`;
      const { status, data } = await api("GET", `/api/blocking/${agentId}`);
      expect(status).toBe(200);
      expect(data["agent_id"]).toBe(agentId);
      expect(data["is_blocked"]).toBe(true);
      expect(Array.isArray(data["blocked_by"])).toBe(true);
      expect(data["summary"]).toBeDefined();
    });

    it("GET /api/blocking/check checks specific blocking pair", async () => {
      if (!state.serverAvailable) return skip("GET /api/blocking/check");
      const blocker = `agent_${TEST_PREFIX}_blocker`;
      const blocked = `agent_${TEST_PREFIX}_blocked`;
      const { status, data } = await api(
        "GET",
        `/api/blocking/check?blocker=${blocker}&blocked=${blocked}`,
      );
      expect(status).toBe(200);
      expect(data["is_blocked"]).toBe(true);
    });

    it("GET /api/blocking/check without params returns 400", async () => {
      if (!state.serverAvailable) return skip("GET /api/blocking/check missing params");
      const { status } = await api("GET", "/api/blocking/check");
      expect(status).toBe(400);
    });

    it("POST /api/unblock unblocks by agent pair", async () => {
      if (!state.serverAvailable) return skip("POST /api/unblock");
      // Create a new blocking to unblock
      await api("POST", "/api/blocking", {
        blocked_by: `agent_${TEST_PREFIX}_unblock_blocker`,
        blocked_agent: `agent_${TEST_PREFIX}_unblock_blocked`,
      });
      const { status, data } = await api("POST", "/api/unblock", {
        blocked_by: `agent_${TEST_PREFIX}_unblock_blocker`,
        blocked_agent: `agent_${TEST_PREFIX}_unblock_blocked`,
      });
      expect(status).toBe(200);
      expect(data["success"]).toBe(true);
    });

    it("DELETE /api/blocking/:blocked_id removes blocking", async () => {
      if (!state.serverAvailable || !state.blockingId) return skip("DELETE /api/blocking/:blocked_id");
      const { status, data } = await api("DELETE", `/api/blocking/${state.blockingId}`);
      expect(status).toBe(200);
      expect(data["success"]).toBe(true);
    });

    it("DELETE /api/blocking/:blocked_id with unknown id returns 404", async () => {
      if (!state.serverAvailable) return skip("DELETE /api/blocking/:blocked_id 404");
      const { status } = await api("DELETE", "/api/blocking/00000000-0000-0000-0000-000000000000");
      expect(status).toBe(404);
    });
  });

  // ========================================================================
  // Context
  // ========================================================================

  describe("Context API", () => {
    it("GET /api/context/:agent_id returns context for agent", async () => {
      if (!state.serverAvailable) return skip("GET /api/context/:agent_id");
      const agentId = `agent_${TEST_PREFIX}_sender`;
      const { status, data } = await api(
        "GET",
        `/api/context/${agentId}?session_id=${state.sessionId}&format=brief`,
      );
      expect(status).toBe(200);
      expect(data["agent_id"]).toBe(agentId);
    });

    it("GET /api/context/:agent_id with format=raw", async () => {
      if (!state.serverAvailable) return skip("GET /api/context/:agent_id raw");
      const agentId = `agent_${TEST_PREFIX}_sender`;
      const { status, data } = await api(
        "GET",
        `/api/context/${agentId}?session_id=${state.sessionId}&format=raw`,
      );
      expect(status).toBe(200);
      expect(data["agent_id"]).toBe(agentId);
      if (data["data"]) {
        const ctx = data["data"] as Record<string, unknown>;
        expect(ctx["tasks"]).toBeDefined();
        expect(ctx["messages"]).toBeDefined();
      }
    });

    it("POST /api/context/generate generates a context brief", async () => {
      if (!state.serverAvailable) return skip("POST /api/context/generate");
      const { status, data } = await api("POST", "/api/context/generate", {
        agent_id: `agent_${TEST_PREFIX}_sender`,
        session_id: state.sessionId || `${TEST_PREFIX}_fallback`,
        agent_type: "developer",
        max_tokens: 1000,
      });
      expect(status).toBe(201);
      expect(data["success"]).toBe(true);
      const brief = data["brief"] as Record<string, unknown>;
      expect(brief["id"]).toBeDefined();
      expect(typeof brief["token_count"]).toBe("number");
    });

    it("POST /api/context/generate with missing fields returns 400", async () => {
      if (!state.serverAvailable) return skip("POST /api/context/generate missing");
      const { status } = await api("POST", "/api/context/generate", {
        agent_id: "test",
      });
      expect(status).toBe(400);
    });
  });

  // ========================================================================
  // Compact
  // ========================================================================

  describe("Compact API", () => {
    it("POST /api/compact/restore restores context after compact", async () => {
      if (!state.serverAvailable) return skip("POST /api/compact/restore");
      const { status, data } = await api("POST", "/api/compact/restore", {
        session_id: state.sessionId || `${TEST_PREFIX}_compact_session`,
        agent_id: `agent_${TEST_PREFIX}_compact`,
        agent_type: "developer",
        compact_summary: "Previous context: OAuth2 feature implementation",
        max_tokens: 1500,
      });
      expect(status).toBe(200);
      expect(data["success"]).toBe(true);
      expect(typeof data["brief"]).toBe("string");
      expect(Array.isArray(data["sources"])).toBe(true);
    });

    it("POST /api/compact/restore with missing fields returns 400", async () => {
      if (!state.serverAvailable) return skip("POST /api/compact/restore missing");
      const { status, data } = await api("POST", "/api/compact/restore", {
        session_id: "test",
      });
      expect(status).toBe(400);
      expect(data["error"]).toBe("Validation failed");
    });

    it("GET /api/compact/status/:session_id returns compact status", async () => {
      if (!state.serverAvailable) return skip("GET /api/compact/status");
      const { status, data } = await api(
        "GET",
        `/api/compact/status/${state.sessionId || "nonexistent"}`,
      );
      expect(status).toBe(200);
      expect(data["session_id"]).toBeDefined();
      expect(typeof data["compacted"]).toBe("boolean");
    });
  });

  // ========================================================================
  // Cleanup Stats
  // ========================================================================

  describe("Cleanup Stats API", () => {
    it("GET /api/cleanup/stats returns cleanup statistics", async () => {
      if (!state.serverAvailable) return skip("GET /api/cleanup/stats");
      const { status, data } = await api("GET", "/api/cleanup/stats");
      expect(status).toBe(200);
      expect(data["messages"]).toBeDefined();
      expect(data["timestamp"]).toBeDefined();
    });
  });

  // ========================================================================
  // Tools Summary
  // ========================================================================

  describe("Tools Summary API", () => {
    it("GET /stats/tools-summary returns tools counts", async () => {
      if (!state.serverAvailable) return skip("GET /stats/tools-summary");
      const { status, data } = await api("GET", "/stats/tools-summary");
      expect(status).toBe(200);
      expect(typeof data["skills"]).toBe("number");
      expect(typeof data["commands"]).toBe("number");
      expect(typeof data["workflows"]).toBe("number");
      expect(typeof data["plugins"]).toBe("number");
      expect(data["cached_at"]).toBeDefined();
    });
  });

  // ========================================================================
  // Auth Token
  // ========================================================================

  describe("Auth Token API", () => {
    it("POST /api/auth/token generates a WebSocket auth token", async () => {
      if (!state.serverAvailable) return skip("POST /api/auth/token");
      const { status, data } = await api("POST", "/api/auth/token", {
        agent_id: `agent_${TEST_PREFIX}_auth`,
        session_id: state.sessionId,
      });
      expect(status).toBe(200);
      expect(typeof data["token"]).toBe("string");
      expect(data["expires_in"]).toBe(3600);
      // Token format: base64url.hex_signature
      const token = data["token"] as string;
      expect(token.split(".").length).toBe(2);
    });

    it("POST /api/auth/token with missing agent_id returns 400", async () => {
      if (!state.serverAvailable) return skip("POST /api/auth/token missing agent_id");
      const { status, data } = await api("POST", "/api/auth/token", {});
      expect(status).toBe(400);
      expect(data["error"]).toContain("Missing agent_id");
    });
  });
});
