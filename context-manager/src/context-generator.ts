/**
 * Context Generator - Generates context briefs for agents
 * Phase 5 - Context Agent Integration
 * @module context-generator
 */

import { createLogger } from "./lib/logger";
import { getDb } from "./db/client";
import { generateBrief } from "./templates";
import type {
  ContextBrief,
  ContextSource,
  ContextGenerationOptions,
  AgentContextData,
  SubtaskContext,
  MessageContext,
  BlockingContext,
  ActionContext,
  SessionContext,
  ProjectContext,
} from "./context/types";

const log = createLogger("ContextGenerator");

/** Characters per token for estimation (optimized for English text/code) */
const CHARS_PER_TOKEN = 3.5;

/** Default options for context generation */
const DEFAULT_OPTIONS: Required<ContextGenerationOptions> = {
  maxTokens: 2000,
  includeHistory: true,
  historyLimit: 10,
  includeMessages: true,
  includeBlocking: true,
  projectId: "",
};

/**
 * Generate a context brief for an agent
 * @param agentId - Agent ID to generate brief for
 * @param agentType - Agent type (e.g., "backend-laravel", "tech-lead")
 * @param sessionId - Session ID for context
 * @param options - Generation options
 * @returns Generated context brief
 */
export async function generateContextBrief(
  agentId: string,
  agentType: string,
  sessionId: string,
  options: ContextGenerationOptions = {}
): Promise<ContextBrief> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sources: ContextSource[] = [];

  // Fetch all context data
  const data = await fetchAgentContextData(
    agentId,
    sessionId,
    opts,
    sources
  );

  // Generate brief using appropriate template
  let brief = generateBrief(agentType, data, agentId, sessionId);

  // Estimate token count
  let tokenCount = Math.ceil(brief.length / CHARS_PER_TOKEN);
  let truncated = false;

  // Truncate if exceeds max tokens
  if (tokenCount > opts.maxTokens) {
    const maxChars = opts.maxTokens * CHARS_PER_TOKEN;
    brief = truncateBrief(brief, maxChars);
    tokenCount = opts.maxTokens;
    truncated = true;
  }

  return {
    id: crypto.randomUUID(),
    agent_id: agentId,
    agent_type: agentType,
    session_id: sessionId,
    brief,
    token_count: tokenCount,
    sources,
    generated_at: new Date().toISOString(),
    truncated,
  };
}

/**
 * Fetch all context data for an agent
 */
async function fetchAgentContextData(
  agentId: string,
  sessionId: string,
  options: Required<ContextGenerationOptions>,
  sources: ContextSource[]
): Promise<AgentContextData> {
  const sql = getDb();

  // 1. Fetch assigned tasks (subtasks with agent_id or agent_type matching)
  const tasks = await fetchAgentTasks(sql, agentId, sessionId, sources);

  // 2. Fetch unread messages
  const messages = options.includeMessages
    ? await fetchAgentMessages(sql, agentId, sources)
    : [];

  // 3. Fetch blockings
  const blockings = options.includeBlocking
    ? await fetchAgentBlockings(sql, agentId, sources)
    : [];

  // 4. Fetch action history
  const history = options.includeHistory
    ? await fetchAgentHistory(sql, agentId, options.historyLimit, sources)
    : [];

  // 5. Fetch session info
  const session = await fetchSessionInfo(sql, sessionId, sources);

  // 6. Fetch project info
  const project = options.projectId
    ? await fetchProjectInfo(sql, options.projectId, sources)
    : session
    ? await fetchProjectFromSession(sql, session.id, sources)
    : undefined;

  return {
    tasks,
    messages,
    blockings,
    history,
    session,
    project,
  };
}

/**
 * Fetch tasks assigned to an agent
 */
async function fetchAgentTasks(
  sql: ReturnType<typeof getDb>,
  agentId: string,
  _sessionId: string, // Prefixed with _ to indicate unused
  sources: ContextSource[]
): Promise<SubtaskContext[]> {
  try {
    interface TaskRow {
      id: string;
      description: string;
      status: string;
      agent_type: string | null;
      agent_id: string | null;
      created_at: string;
      started_at: string | null;
      blocked_by: string[] | null;
      task_name: string | null;
      wave_number: number | null;
    }

    const tasks = await sql<TaskRow[]>`
      SELECT
        s.id,
        s.description,
        s.status,
        s.agent_type,
        s.agent_id,
        s.created_at,
        s.started_at,
        s.blocked_by,
        t.name as task_name,
        t.wave_number
      FROM subtasks s
      LEFT JOIN task_lists t ON s.task_list_id = t.id
      LEFT JOIN requests r ON t.request_id = r.id
      WHERE (s.agent_id = ${agentId} OR s.agent_type = ${agentId})
        AND s.status IN ('pending', 'running', 'blocked', 'paused')
      ORDER BY
        CASE s.status
          WHEN 'running' THEN 1
          WHEN 'blocked' THEN 2
          WHEN 'paused' THEN 3
          WHEN 'pending' THEN 4
        END,
        s.created_at ASC
      LIMIT 20
    `;

    for (const task of tasks) {
      sources.push({
        type: "task",
        id: task.id,
        relevance: task.status === "running" ? 1.0 : 0.8,
        summary: `Task: ${task.description.slice(0, 50)}`,
      });
    }

    return tasks.map((t): SubtaskContext => ({
      id: t.id,
      description: t.description,
      status: t.status,
      agent_type: t.agent_type,
      created_at: t.created_at,
      started_at: t.started_at,
      blocked_by: t.blocked_by,
      ...(t.task_name !== null ? { task_name: t.task_name } : {}),
      ...(t.wave_number !== null ? { wave_number: t.wave_number } : {}),
    }));
  } catch (error) {
    log.error("Error fetching tasks:", error);
    return [];
  }
}

/**
 * Fetch unread messages for an agent
 */
async function fetchAgentMessages(
  sql: ReturnType<typeof getDb>,
  agentId: string,
  sources: ContextSource[]
): Promise<MessageContext[]> {
  try {
    interface MessageRow {
      id: string;
      from_agent_id: string | null;
      to_agent_id: string | null;
      topic: string | null;
      payload: Record<string, unknown>;
      priority: number;
      created_at: string;
    }

    const messages = await sql<MessageRow[]>`
      SELECT
        id,
        from_agent_id,
        to_agent_id,
        topic,
        payload,
        priority,
        created_at
      FROM agent_messages
      WHERE (to_agent_id = ${agentId} OR to_agent_id IS NULL)
        AND NOT (${agentId} = ANY(read_by))
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY priority DESC, created_at ASC
      LIMIT 20
    `;

    for (const msg of messages) {
      sources.push({
        type: "message",
        id: msg.id,
        relevance: msg.priority >= 5 ? 1.0 : 0.6,
        summary: `Message from ${msg.from_agent_id ?? "system"}`,
      });
    }

    return messages.map((m) => ({
      id: m.id,
      from_agent: m.from_agent_id,
      topic: m.topic,
      content: m.payload,
      priority: m.priority,
      created_at: m.created_at,
      is_broadcast: m.to_agent_id === null,
    }));
  } catch (error) {
    log.error("Error fetching messages:", error);
    return [];
  }
}

/**
 * Fetch blockings for an agent
 */
async function fetchAgentBlockings(
  sql: ReturnType<typeof getDb>,
  agentId: string,
  sources: ContextSource[]
): Promise<BlockingContext[]> {
  try {
    interface BlockingRow {
      id: string;
      blocked_by_agent: string;
      reason: string | null;
      created_at: string;
    }

    const blockings = await sql<BlockingRow[]>`
      SELECT
        id,
        blocked_by_agent,
        reason,
        created_at
      FROM agent_blockings
      WHERE blocked_agent = ${agentId}
        AND resolved_at IS NULL
      ORDER BY created_at DESC
      LIMIT 10
    `;

    for (const blocking of blockings) {
      sources.push({
        type: "blocking",
        id: blocking.id,
        relevance: 0.9,
        summary: `Blocked by ${blocking.blocked_by_agent}`,
      });
    }

    return blockings;
  } catch (error) {
    log.error("Error fetching blockings:", error);
    return [];
  }
}

/**
 * Fetch action history for an agent
 */
async function fetchAgentHistory(
  sql: ReturnType<typeof getDb>,
  agentId: string,
  limit: number,
  sources: ContextSource[]
): Promise<ActionContext[]> {
  try {
    interface ActionRow {
      id: string;
      tool_name: string;
      tool_type: string;
      exit_code: number;
      duration_ms: number | null;
      file_paths: string[] | null;
      created_at: string;
    }

    const actions = await sql<ActionRow[]>`
      SELECT
        a.id,
        a.tool_name,
        a.tool_type,
        a.exit_code,
        a.duration_ms,
        a.file_paths,
        a.created_at
      FROM actions a
      JOIN subtasks s ON a.subtask_id = s.id
      WHERE s.agent_id = ${agentId} OR s.agent_type = ${agentId}
      ORDER BY a.created_at DESC
      LIMIT ${limit}
    `;

    if (actions.length > 0) {
      sources.push({
        type: "history",
        id: "actions",
        relevance: 0.7,
        summary: `${actions.length} recent actions`,
      });
    }

    return actions;
  } catch (error) {
    log.error("Error fetching history:", error);
    return [];
  }
}

/**
 * Fetch session info
 */
async function fetchSessionInfo(
  sql: ReturnType<typeof getDb>,
  sessionId: string,
  sources: ContextSource[]
): Promise<SessionContext | undefined> {
  try {
    interface RequestRow {
      id: string;
      session_id: string;
      status: string;
      created_at: string;
      prompt: string;
    }

    const results = await sql<RequestRow[]>`
      SELECT
        id,
        session_id,
        status,
        created_at,
        prompt
      FROM requests
      WHERE session_id = ${sessionId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const session = results[0];
    if (session) {
      sources.push({
        type: "session",
        id: session.id,
        relevance: 0.8,
        summary: `Session ${sessionId}`,
      });

      return {
        id: session.id,
        session_id: session.session_id,
        status: session.status,
        created_at: session.created_at,
        prompt: session.prompt,
      };
    }

    return undefined;
  } catch (error) {
    log.error("Error fetching session:", error);
    return undefined;
  }
}

/**
 * Fetch project info by ID
 */
async function fetchProjectInfo(
  sql: ReturnType<typeof getDb>,
  projectId: string,
  sources: ContextSource[]
): Promise<ProjectContext | undefined> {
  try {
    interface ProjectRow {
      id: string;
      name: string | null;
      path: string;
    }

    const results = await sql<ProjectRow[]>`
      SELECT id, name, path
      FROM projects
      WHERE id = ${projectId}
    `;

    const project = results[0];
    if (project) {
      sources.push({
        type: "project",
        id: project.id,
        relevance: 0.7,
        summary: `Project ${project.name ?? project.path}`,
      });

      return project;
    }

    return undefined;
  } catch (error) {
    log.error("Error fetching project:", error);
    return undefined;
  }
}

/**
 * Fetch project from session (via request)
 */
async function fetchProjectFromSession(
  sql: ReturnType<typeof getDb>,
  requestId: string,
  sources: ContextSource[]
): Promise<ProjectContext | undefined> {
  try {
    interface ProjectRow {
      id: string;
      name: string | null;
      path: string;
    }

    const results = await sql<ProjectRow[]>`
      SELECT p.id, p.name, p.path
      FROM projects p
      JOIN requests r ON r.project_id = p.id
      WHERE r.id = ${requestId}
    `;

    const project = results[0];
    if (project) {
      sources.push({
        type: "project",
        id: project.id,
        relevance: 0.7,
        summary: `Project ${project.name ?? project.path}`,
      });

      return project;
    }

    return undefined;
  } catch (error) {
    log.error("Error fetching project from session:", error);
    return undefined;
  }
}

/**
 * Truncate brief while preserving structure
 */
function truncateBrief(brief: string, maxChars: number): string {
  if (brief.length <= maxChars) return brief;

  const lines = brief.split("\n");
  const result: string[] = [];
  let currentLength = 0;

  for (const line of lines) {
    // Always include headers
    if (line.startsWith("#")) {
      if (currentLength + line.length + 1 <= maxChars) {
        result.push(line);
        currentLength += line.length + 1;
      }
      continue;
    }

    // Add content lines if space permits
    if (currentLength + line.length + 1 <= maxChars - 50) {
      result.push(line);
      currentLength += line.length + 1;
    } else {
      break;
    }
  }

  // Add truncation notice
  result.push("");
  result.push("---");
  result.push("*[Brief truncated due to token limit]*");

  return result.join("\n");
}

/**
 * Get context data for an agent (without generating brief)
 * Useful for the GET /api/context/:agent_id endpoint
 */
export async function getAgentContextData(
  agentId: string,
  sessionId: string,
  options: ContextGenerationOptions = {}
): Promise<AgentContextData> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const sources: ContextSource[] = []; // Not used but required by fetchAgentContextData

  return fetchAgentContextData(agentId, sessionId, opts, sources);
}

export { DEFAULT_OPTIONS };
