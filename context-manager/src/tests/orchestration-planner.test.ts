/**
 * Orchestration Planner Tests
 * Tests craft-prompt, decompose endpoints, and pure helper functions.
 *
 * Unit tests run without a server; integration tests require a running DCM API.
 *
 * Run: bun test src/tests/orchestration-planner.test.ts
 * @module tests/orchestration-planner
 */

import { describe, it, expect, beforeAll } from "bun:test";
import {
  estimateComplexity,
  buildScopeSection,
  COMPLEXITY_TIERS,
} from "../api/orchestration-planner";

const BASE_URL = process.env["DCM_API_URL"] || "http://127.0.0.1:3847";

let serverAvailable = false;

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
    signal: AbortSignal.timeout(5000),
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const text = await res.text();
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    return { status: res.status, data };
  } catch {
    return { status: res.status, data: { raw: text } };
  }
}

beforeAll(async () => {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    serverAvailable = res.ok;
  } catch {
    serverAvailable = false;
  }
  if (!serverAvailable) {
    console.log(`[INFO] DCM server not available at ${BASE_URL}, skipping integration tests`);
  }
});

// ---------------------------------------------------------------------------
// Unit Tests: estimateComplexity (pure function, no server needed)
// ---------------------------------------------------------------------------

describe("estimateComplexity", () => {
  it("returns trivial for single-file fix", () => {
    const result = estimateComplexity("fix typo in readme", 1);
    expect(result.name).toBe("trivial");
    expect(result.max_turns).toBe(3);
    expect(result.model).toBe("haiku");
  });

  it("returns simple for small change", () => {
    const result = estimateComplexity("add field to config", 2);
    expect(result.name).toBe("simple");
    expect(result.max_turns).toBe(5);
  });

  it("returns moderate for refactor task", () => {
    const result = estimateComplexity("refactor the auth module", 5);
    expect(result.name).toBe("moderate");
    expect(result.max_turns).toBe(10);
  });

  it("returns complex for exploration task", () => {
    const result = estimateComplexity("explore and analyze the codebase", 10);
    expect(result.name).toBe("complex");
    expect(result.max_turns).toBe(20);
  });

  it("returns expert for architecture task", () => {
    const result = estimateComplexity("redesign the architecture for scalability", 20);
    expect(result.name).toBe("expert");
    expect(result.max_turns).toBe(30);
    expect(result.model).toBe("opus");
  });

  it("falls back to file count when no keywords match", () => {
    expect(estimateComplexity("do something unusual", 0).name).toBe("trivial");
    expect(estimateComplexity("do something unusual", 1).name).toBe("trivial");
    expect(estimateComplexity("do something unusual", 3).name).toBe("simple");
    expect(estimateComplexity("do something unusual", 5).name).toBe("moderate");
    expect(estimateComplexity("do something unusual", 10).name).toBe("complex");
    expect(estimateComplexity("do something unusual", 20).name).toBe("expert");
  });
});

// ---------------------------------------------------------------------------
// Unit Tests: buildScopeSection (pure function, no server needed)
// ---------------------------------------------------------------------------

describe("buildScopeSection", () => {
  it("includes target files in output", () => {
    const result = buildScopeSection(
      ["src/server.ts", "src/api/foo.ts"],
      [],
    );
    expect(result).toContain("src/server.ts");
    expect(result).toContain("src/api/foo.ts");
    expect(result).toContain("ONLY touch these files");
  });

  it("includes target directories in output", () => {
    const result = buildScopeSection([], ["src/api/", "src/lib/"]);
    expect(result).toContain("src/api/");
    expect(result).toContain("src/lib/");
    expect(result).toContain("stay within these boundaries");
  });

  it("shows warning when no targets specified", () => {
    const result = buildScopeSection([], []);
    expect(result).toContain("WARNING");
    expect(result).toContain("No target files or directories");
  });

  it("includes agent scope constraints when provided", () => {
    const scope = {
      agent_type: "test-agent",
      category: "developer" as const,
      display_name: "Test Agent",
      default_scope: {},
      allowed_tools: ["Read", "Grep"],
      forbidden_actions: ["Write", "Delete"],
      max_files: 3,
      wave_assignments: [1],
      recommended_model: "sonnet",
    };
    const result = buildScopeSection(["file.ts"], [], scope);
    expect(result).toContain("Max Files");
    expect(result).toContain("3");
    expect(result).toContain("Forbidden Actions");
    expect(result).toContain("Write, Delete");
    expect(result).toContain("Allowed Tools");
    expect(result).toContain("Read, Grep");
  });

  it("always includes rules section", () => {
    const result = buildScopeSection([], []);
    expect(result).toContain("Do NOT scan the entire codebase");
    expect(result).toContain("Do NOT explore files outside");
    expect(result).toContain("Complete your task");
  });
});

// ---------------------------------------------------------------------------
// Integration Tests: craft-prompt endpoint (requires running server)
// ---------------------------------------------------------------------------

describe("POST /api/orchestration/craft-prompt", () => {
  it("returns crafted prompt with target files", async () => {
    if (!serverAvailable) return;

    const { status, data } = await api("POST", "/api/orchestration/craft-prompt", {
      task_description: "Fix the typo in server.ts",
      agent_type: "Snipper",
      target_files: ["src/server.ts"],
    });

    expect(status).toBe(200);
    expect(data.crafted_prompt).toBeDefined();
    expect(typeof data.crafted_prompt).toBe("string");
    expect((data.crafted_prompt as string)).toContain("src/server.ts");
    expect(data.max_turns).toBeGreaterThan(0);
    expect(data.model).toBeDefined();
    expect(data.complexity).toBeDefined();
    expect(data.scope_directives).toBeDefined();
  });

  it("handles unknown agent type gracefully", async () => {
    if (!serverAvailable) return;

    const { status, data } = await api("POST", "/api/orchestration/craft-prompt", {
      task_description: "Some task",
      agent_type: "nonexistent-agent-xyz",
      target_files: ["file.ts"],
    });

    expect(status).toBe(200);
    expect(data.crafted_prompt).toBeDefined();
    expect(data.complexity).toBeDefined();
  });

  it("validates required fields", async () => {
    if (!serverAvailable) return;

    const { status } = await api("POST", "/api/orchestration/craft-prompt", {});
    expect(status).toBe(400);
  });

  it("estimates complexity per tier correctly", async () => {
    if (!serverAvailable) return;

    // Trivial
    const trivial = await api("POST", "/api/orchestration/craft-prompt", {
      task_description: "fix typo in readme",
      agent_type: "Snipper",
      target_files: ["README.md"],
    });
    expect(trivial.data.complexity).toBe("trivial");

    // Complex
    const complex = await api("POST", "/api/orchestration/craft-prompt", {
      task_description: "explore and investigate the auth system",
      agent_type: "Explore",
      target_directories: ["src/"],
    });
    expect(complex.data.complexity).toBe("complex");
  });
});

// ---------------------------------------------------------------------------
// Integration Tests: decompose endpoint (requires running server)
// ---------------------------------------------------------------------------

describe("POST /api/orchestration/decompose", () => {
  it("always produces explore + validate steps", async () => {
    if (!serverAvailable) return;

    const { status, data } = await api("POST", "/api/orchestration/decompose", {
      task_description: "Add a new API endpoint for users",
    });

    expect(status).toBe(200);
    expect(data.plan_id).toBeDefined();
    expect(Array.isArray(data.subtasks)).toBe(true);

    const subtasks = data.subtasks as Array<{ wave: number; agent_type: string }>;

    // Wave 0: explore
    const wave0 = subtasks.filter((s) => s.wave === 0);
    expect(wave0.length).toBeGreaterThanOrEqual(1);
    expect(wave0[0].agent_type).toBe("Explore");

    // Wave 2: validation
    const wave2 = subtasks.filter((s) => s.wave === 2);
    expect(wave2.length).toBeGreaterThanOrEqual(1);
  });

  it("matches backend keywords to relevant agents", async () => {
    if (!serverAvailable) return;

    const { data } = await api("POST", "/api/orchestration/decompose", {
      task_description: "Write tests for the user controller",
    });

    const subtasks = data.subtasks as Array<{ agent_type: string }>;
    const agentTypes = subtasks.map((s) => s.agent_type);
    expect(agentTypes).toContain("test-engineer");
  });

  it("enforces budget constraints", async () => {
    if (!serverAvailable) return;

    const { data } = await api("POST", "/api/orchestration/decompose", {
      task_description: "Redesign the architecture of the entire system",
      constraints: { max_total_turns: 15, max_parallel: 2 },
    });

    const plan = data.execution_plan as { total_turns: number };
    expect(plan.total_turns).toBeLessThanOrEqual(15);
  });

  it("respects max_parallel constraint", async () => {
    if (!serverAvailable) return;

    const { data } = await api("POST", "/api/orchestration/decompose", {
      task_description: "Implement react frontend components with tests and documentation",
      constraints: { max_parallel: 2 },
    });

    const waves = (data.execution_plan as { waves: Array<{ parallel: number }> }).waves;
    for (const wave of waves) {
      expect(wave.parallel).toBeLessThanOrEqual(2);
    }
  });

  it("builds correct dependency graph", async () => {
    if (!serverAvailable) return;

    const { data } = await api("POST", "/api/orchestration/decompose", {
      task_description: "Add a new feature",
    });

    const subtasks = data.subtasks as Array<{ step: number; wave: number; depends_on: number[] }>;

    // Wave 0 tasks have no dependencies
    const wave0 = subtasks.filter((s) => s.wave === 0);
    for (const t of wave0) {
      expect(t.depends_on).toEqual([]);
    }

    // Wave 1+ tasks depend on wave 0
    const wave1 = subtasks.filter((s) => s.wave === 1);
    for (const t of wave1) {
      expect(t.depends_on.length).toBeGreaterThan(0);
      expect(t.depends_on[0]).toBe(0); // depends on explore step
    }

    // Wave 2 tasks depend on wave 1
    const wave2 = subtasks.filter((s) => s.wave === 2);
    for (const t of wave2) {
      expect(t.depends_on.length).toBeGreaterThan(0);
    }
  });

  it("validates required fields", async () => {
    if (!serverAvailable) return;

    const { status } = await api("POST", "/api/orchestration/decompose", {});
    expect(status).toBe(400);
  });
});
