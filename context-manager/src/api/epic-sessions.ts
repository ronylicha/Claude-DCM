/**
 * Epic Sessions API - AI-powered session management for project epics
 * Handles session lifecycle, message exchange, task proposals, and pipeline integration.
 * @module api/epic-sessions
 */

import type { Context } from "hono";
import { z } from "zod";
import { getDb, publishEvent } from "../db/client";
import { createLogger } from "../lib/logger";
import { spawnClaudeSession, killSession } from "../pipeline/claude-session";

const log = createLogger("API");

// ============================================
// Validation Schemas
// ============================================

/** Schema for starting an epic session */
const StartEpicSessionSchema = z.object({
  model: z.string().optional().default("claude-opus-4-6"),
  auto_execute: z.boolean().optional().default(false),
  system_context: z.string().optional(),
});

/** Schema for starting an epic chat (chat as entry point) */
const StartEpicChatSchema = z.object({
  initial_message: z.string().optional(),
  model: z.string().optional().default("claude-opus-4-6"),
});

/** Schema for sending a message */
const SendMessageSchema = z.object({
  content: z.string().min(1, "content is required"),
});

// ============================================
// Type Definitions
// ============================================

interface EpicRow {
  id: string;
  project_id: string;
  pipeline_id: string | null;
  title: string;
  description: string | null;
}

interface ProjectRow {
  id: string;
  path: string;
  name: string | null;
}

interface EpicSessionRow {
  id: string;
  epic_id: string;
  status: string;
  model: string;
  system_prompt: string | null;
  pid: number | null;
  auto_execute: boolean;
  token_count: number;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

interface EpicMessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  content_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface ProposedTaskRow {
  id: string;
  session_id: string;
  epic_id: string;
  title: string;
  description: string | null;
  agent_type: string;
  wave_number: number;
  step_order: number;
  model: string;
  prompt: string | null;
  skills: string[];
  status: string;
  pipeline_step_id: string | null;
  created_at: string;
  decided_at: string | null;
}

// ============================================
// Handlers
// ============================================

/**
 * POST /api/projects/:projectId/epics/:epicId/session
 * Start a new AI session for an epic.
 */
export async function startEpicSession(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("projectId");
    const epicId = c.req.param("epicId");

    const raw = await c.req.json();
    const parseResult = StartEpicSessionSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        400,
      );
    }
    const body = parseResult.data;

    const sql = getDb();

    // Verify epic exists and belongs to the project
    const epics = await sql<EpicRow[]>`
      SELECT id, project_id, pipeline_id, title, description
      FROM project_epics
      WHERE id = ${epicId} AND project_id = ${projectId}
    `;

    if (epics.length === 0) {
      return c.json({ error: "Epic not found or does not belong to this project" }, 404);
    }

    const epic = epics[0]!;

    // Verify no active session already exists for this epic
    const activeSessions = await sql<{ id: string }[]>`
      SELECT id FROM epic_sessions
      WHERE epic_id = ${epicId}
        AND status IN ('active', 'thinking', 'waiting')
    `;

    if (activeSessions.length > 0) {
      return c.json(
        { error: "An active session already exists for this epic", session_id: activeSessions[0]!.id },
        409,
      );
    }

    // Retrieve project path for workspace
    const projects = await sql<ProjectRow[]>`
      SELECT id, path, name FROM projects WHERE id = ${projectId}
    `;

    if (projects.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    const project = projects[0]!;

    // INSERT epic_sessions
    const sessions = await sql<EpicSessionRow[]>`
      INSERT INTO epic_sessions (epic_id, status, model, system_prompt, auto_execute)
      VALUES (
        ${epicId},
        'active',
        ${body.model},
        ${body.system_context ?? null},
        ${body.auto_execute}
      )
      RETURNING *
    `;

    const session = sessions[0]!;

    // INSERT initial system message
    await sql`
      INSERT INTO epic_messages (session_id, role, content, content_type)
      VALUES (
        ${session.id},
        'system',
        ${"Session started for epic: " + epic.title},
        'text'
      )
    `;

    await publishEvent("epic-sessions", "epic.session.created", {
      session_id: session.id,
      epic_id: epicId,
      project_id: projectId,
      workspace_path: project.path,
    });

    log.info(`Epic session created: ${session.id} for epic ${epicId}`);

    return c.json({ success: true, session }, 201);
  } catch (error) {
    log.error("POST /api/projects/:projectId/epics/:epicId/session error:", error);
    return c.json(
      {
        error: "Failed to start epic session",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/projects/:projectId/epic-chat
 * Create a new epic with a linked session and optionally fire Claude immediately.
 * The chat is the ENTRY POINT: the epic is created with a placeholder title that
 * Claude will update via a dcm-meta block once it deduces a descriptive name.
 */
export async function startEpicChat(c: Context): Promise<Response> {
  try {
    const projectId = c.req.param("projectId");

    const raw = await c.req.json().catch(() => ({}));
    const parseResult = StartEpicChatSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        400,
      );
    }
    const body = parseResult.data;

    const sql = getDb();

    // Verify the project exists
    const projects = await sql<ProjectRow[]>`
      SELECT id, path, name FROM projects WHERE id = ${projectId}
    `;

    if (projects.length === 0) {
      return c.json({ error: "Project not found" }, 404);
    }

    const project = projects[0]!;

    // Create a placeholder epic
    const epics = await sql<EpicRow[]>`
      INSERT INTO project_epics (project_id, title, status)
      VALUES (${projectId}, 'New Epic', 'in_progress')
      RETURNING id, project_id, pipeline_id, title, description
    `;

    const epic = epics[0]!;

    // System prompt with dcm-meta instructions
    const systemPrompt =
      `Tu es un Tech Lead senior. L'utilisateur te decrit un besoin pour son projet.\n\n` +
      `WORKFLOW :\n` +
      `1. Discute et clarifie le besoin\n` +
      `2. Propose une approche technique\n` +
      `3. Quand le plan est clair, cree les taches\n\n` +
      `Pour creer une tache, emets ce format (un par tache) :\n\n` +
      `\`\`\`dcm-task\n` +
      `{"action":"create_task","title":"...","description":"...","agent_type":"Snipper","model":"sonnet","wave_number":0,"step_order":0,"skills":["workflow-clean-code"],"prompt":"Prompt complet pour l'agent..."}\n` +
      `\`\`\`\n\n` +
      `Tu peux creer plusieurs taches dans un message.\n\n` +
      `INSTRUCTIONS SUPPLEMENTAIRES :\n` +
      `- Au cours de la conversation, deduis un titre descriptif pour cet epic.\n` +
      `  Quand tu as un titre, emets un bloc : \`\`\`dcm-meta\n{"action":"set_title","title":"Le titre"}\`\`\`\n` +
      `- Quand l'utilisateur te dit que c'est bon ou que tu as assez d'info,\n` +
      `  cree les taches via les blocs dcm-task habituels puis emets : \`\`\`dcm-meta\n{"action":"finalize"}\`\`\`\n` +
      `- Le bloc finalize declenche la creation des taches dans le pipeline et le lancement de l'implementation.\n\n` +
      `Projet: ${project.name ?? projectId}\n` +
      `Workspace: ${project.path}`;

    // Create the session linked to the new epic
    const sessions = await sql<EpicSessionRow[]>`
      INSERT INTO epic_sessions (epic_id, status, model, system_prompt, auto_execute)
      VALUES (${epic.id}, 'active', ${body.model}, ${systemPrompt}, false)
      RETURNING *
    `;

    const session = sessions[0]!;

    await publishEvent("epic-sessions", "epic.session.created", {
      session_id: session.id,
      epic_id: epic.id,
      project_id: projectId,
      workspace_path: project.path,
      entry_point: "chat",
    });

    log.info(`Epic chat created: epic=${epic.id} session=${session.id} project=${projectId}`);

    // If an initial message is provided, insert it and spawn Claude immediately
    if (body.initial_message) {
      await sql`
        INSERT INTO epic_messages (session_id, role, content, content_type)
        VALUES (${session.id}, 'user', ${body.initial_message}, 'text')
      `;

      // Load the freshly inserted message as conversation history
      const conversationHistory = await sql<EpicMessageRow[]>`
        SELECT id, session_id, role, content, content_type, metadata, created_at
        FROM epic_messages
        WHERE session_id = ${session.id}
        ORDER BY created_at ASC
      `;

      spawnClaudeSession({
        sessionId: session.id,
        epicId: epic.id,
        projectName: project.name ?? "",
        epicTitle: epic.title,
        epicDescription: "",
        workspacePath: project.path,
        conversationHistory,
        userMessage: body.initial_message,
        model: body.model,
        systemPromptOverride: systemPrompt,
      }).catch((err) => {
        log.error(`spawnClaudeSession failed for chat session ${session.id}:`, err);
      });
    }

    return c.json({ success: true, epic, session }, 201);
  } catch (error) {
    log.error("POST /api/projects/:projectId/epic-chat error:", error);
    return c.json(
      {
        error: "Failed to start epic chat",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/epic-sessions/:sessionId/message
 * Send a user message and trigger AI processing.
 */
export async function sendMessage(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("sessionId");

    const raw = await c.req.json();
    const parseResult = SendMessageSchema.safeParse(raw);
    if (!parseResult.success) {
      return c.json(
        { error: "Validation failed", details: parseResult.error.flatten().fieldErrors },
        400,
      );
    }
    const body = parseResult.data;

    const sql = getDb();

    // Verify session exists and is not ended
    const sessions = await sql<EpicSessionRow[]>`
      SELECT * FROM epic_sessions WHERE id = ${sessionId}
    `;

    if (sessions.length === 0) {
      return c.json({ error: "Session not found" }, 404);
    }

    const session = sessions[0]!;

    if (session.status === "ended") {
      return c.json({ error: "Session has ended" }, 409);
    }

    // Insert user message
    await sql`
      INSERT INTO epic_messages (session_id, role, content, content_type)
      VALUES (${sessionId}, 'user', ${body.content}, 'text')
    `;

    // Load full conversation history ordered by creation time
    const conversationHistory = await sql<EpicMessageRow[]>`
      SELECT id, session_id, role, content, content_type, metadata, created_at
      FROM epic_messages
      WHERE session_id = ${sessionId}
      ORDER BY created_at ASC
    `;

    // Load epic and project info
    const epicRows = await sql<EpicRow[]>`
      SELECT e.id, e.project_id, e.pipeline_id, e.title, e.description,
             p.path AS project_path, p.name AS project_name
      FROM project_epics e
      JOIN projects p ON p.id = e.project_id
      WHERE e.id = ${session.epic_id}
    `;

    if (epicRows.length === 0) {
      return c.json({ error: "Epic not found" }, 404);
    }

    const epicInfo = epicRows[0] as EpicRow & { project_path: string; project_name: string };

    // Spawn AI session asynchronously
    spawnClaudeSession({
      sessionId,
      epicId: session.epic_id,
      projectName: epicInfo.project_name ?? "",
      epicTitle: epicInfo.title,
      epicDescription: epicInfo.description ?? "",
      workspacePath: epicInfo.project_path,
      conversationHistory,
      userMessage: body.content,
      model: session.model,
    }).catch((err) => {
      log.error(`spawnClaudeSession failed for session ${sessionId}:`, err);
    });

    log.info(`Message sent to epic session ${sessionId}`);

    return c.json({ success: true });
  } catch (error) {
    log.error("POST /api/epic-sessions/:sessionId/message error:", error);
    return c.json(
      {
        error: "Failed to send message",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/epic-sessions/:sessionId/end
 * Terminate an active epic session.
 */
export async function endSession(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("sessionId");

    const sql = getDb();

    const sessions = await sql<EpicSessionRow[]>`
      SELECT id, epic_id FROM epic_sessions WHERE id = ${sessionId}
    `;

    if (sessions.length === 0) {
      return c.json({ error: "Session not found" }, 404);
    }

    const session = sessions[0]!;

    // Kill the running process if any
    killSession(sessionId);

    // Mark session as ended
    await sql`
      UPDATE epic_sessions
      SET status = 'ended', ended_at = now()
      WHERE id = ${sessionId}
    `;

    await publishEvent("epic-sessions", "epic.session.ended", {
      session_id: sessionId,
      epic_id: session.epic_id,
    });

    log.info(`Epic session ended: ${sessionId}`);

    return c.json({ success: true });
  } catch (error) {
    log.error("POST /api/epic-sessions/:sessionId/end error:", error);
    return c.json(
      {
        error: "Failed to end session",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * GET /api/epic-sessions/:sessionId
 * Get session detail with message and task counts.
 */
export async function getSession(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("sessionId");

    const sql = getDb();

    const rows = await sql<Array<EpicSessionRow & { message_count: string; task_count: string }>>`
      SELECT
        s.*,
        COUNT(DISTINCT m.id) AS message_count,
        COUNT(DISTINCT t.id) AS task_count
      FROM epic_sessions s
      LEFT JOIN epic_messages m ON m.session_id = s.id
      LEFT JOIN epic_proposed_tasks t ON t.session_id = s.id
      WHERE s.id = ${sessionId}
      GROUP BY s.id
    `;

    if (rows.length === 0) {
      return c.json({ error: "Session not found" }, 404);
    }

    const { message_count, task_count, ...session } = rows[0]!;

    return c.json({
      session,
      message_count: parseInt(message_count, 10),
      task_count: parseInt(task_count, 10),
    });
  } catch (error) {
    log.error("GET /api/epic-sessions/:sessionId error:", error);
    return c.json(
      {
        error: "Failed to fetch session",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * GET /api/epic-sessions/:sessionId/messages
 * List all messages and proposed tasks for a session.
 */
export async function getMessages(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("sessionId");

    const sql = getDb();

    const sessions = await sql<{ id: string }[]>`
      SELECT id FROM epic_sessions WHERE id = ${sessionId}
    `;

    if (sessions.length === 0) {
      return c.json({ error: "Session not found" }, 404);
    }

    const [messages, proposedTasks] = await Promise.all([
      sql<EpicMessageRow[]>`
        SELECT id, session_id, role, content, content_type, metadata, created_at
        FROM epic_messages
        WHERE session_id = ${sessionId}
        ORDER BY created_at ASC
      `,
      sql<ProposedTaskRow[]>`
        SELECT id, session_id, epic_id, title, description, agent_type,
               wave_number, step_order, model, prompt, skills, status,
               pipeline_step_id, created_at, decided_at
        FROM epic_proposed_tasks
        WHERE session_id = ${sessionId}
        ORDER BY created_at ASC
      `,
    ]);

    return c.json({ messages, proposed_tasks: proposedTasks });
  } catch (error) {
    log.error("GET /api/epic-sessions/:sessionId/messages error:", error);
    return c.json(
      {
        error: "Failed to fetch messages",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/epic-sessions/:sessionId/tasks/:taskId/approve
 * Approve a proposed task and link it to a pipeline step.
 */
export async function approveTask(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("sessionId");
    const taskId = c.req.param("taskId");

    const sql = getDb();

    // Verify task belongs to session and is in proposed state
    const tasks = await sql<ProposedTaskRow[]>`
      SELECT * FROM epic_proposed_tasks
      WHERE id = ${taskId} AND session_id = ${sessionId}
    `;

    if (tasks.length === 0) {
      return c.json({ error: "Task not found for this session" }, 404);
    }

    const task = tasks[0]!;

    // Mark task as approved
    await sql`
      UPDATE epic_proposed_tasks
      SET status = 'approved', decided_at = now()
      WHERE id = ${taskId}
    `;

    // Retrieve epic to check for an existing pipeline
    const epics = await sql<{ id: string; pipeline_id: string | null; project_id: string }[]>`
      SELECT id, pipeline_id, project_id FROM project_epics WHERE id = ${task.epic_id}
    `;

    if (epics.length === 0) {
      return c.json({ error: "Epic not found" }, 404);
    }

    const epic = epics[0]!;

    let pipelineId = epic.pipeline_id;

    // If no pipeline exists for this epic, create a minimal one
    if (!pipelineId) {
      const pipelineInput = {
        instructions: `Pipeline for epic: ${task.title}`,
        documents: [],
        target_files: [],
        target_directories: [],
        workspace: { path: "" },
      };

      const newPipelines = await sql<{ id: string }[]>`
        INSERT INTO pipelines (session_id, name, status, input)
        VALUES (
          ${sessionId},
          ${"Epic: " + task.title},
          'ready',
          ${sql.json(pipelineInput as unknown as import("postgres").JSONValue)}
        )
        RETURNING id
      `;

      pipelineId = newPipelines[0]!.id;

      // Link the new pipeline to the epic
      await sql`
        UPDATE project_epics SET pipeline_id = ${pipelineId} WHERE id = ${task.epic_id}
      `;
    }

    // INSERT pipeline step from proposed task data
    const steps = await sql<{ id: string }[]>`
      INSERT INTO pipeline_steps (
        pipeline_id, wave_number, step_order, agent_type,
        description, skills, prompt, model, status
      ) VALUES (
        ${pipelineId},
        ${task.wave_number},
        ${task.step_order},
        ${task.agent_type},
        ${task.description ?? null},
        ${sql.array(task.skills)},
        ${task.prompt ?? null},
        ${task.model},
        'pending'
      )
      ON CONFLICT (pipeline_id, wave_number, step_order)
      DO UPDATE SET
        agent_type  = EXCLUDED.agent_type,
        description = EXCLUDED.description,
        skills      = EXCLUDED.skills,
        prompt      = EXCLUDED.prompt,
        model       = EXCLUDED.model,
        status      = 'pending'
      RETURNING id
    `;

    const stepId = steps[0]!.id;

    // Link pipeline step back to the proposed task
    await sql`
      UPDATE epic_proposed_tasks
      SET pipeline_step_id = ${stepId}
      WHERE id = ${taskId}
    `;

    await publishEvent("epic-sessions", "epic.task.approved", {
      session_id: sessionId,
      task_id: taskId,
      pipeline_step_id: stepId,
      epic_id: task.epic_id,
    });

    log.info(`Task approved: ${taskId} → pipeline_step ${stepId}`);

    // Return updated task
    const updatedTasks = await sql<ProposedTaskRow[]>`
      SELECT * FROM epic_proposed_tasks WHERE id = ${taskId}
    `;

    return c.json({ success: true, task: updatedTasks[0], pipeline_step_id: stepId });
  } catch (error) {
    log.error("POST /api/epic-sessions/:sessionId/tasks/:taskId/approve error:", error);
    return c.json(
      {
        error: "Failed to approve task",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/epic-sessions/:sessionId/tasks/:taskId/reject
 * Reject a proposed task.
 */
export async function rejectTask(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("sessionId");
    const taskId = c.req.param("taskId");

    const sql = getDb();

    const tasks = await sql<{ id: string; epic_id: string }[]>`
      SELECT id, epic_id FROM epic_proposed_tasks
      WHERE id = ${taskId} AND session_id = ${sessionId}
    `;

    if (tasks.length === 0) {
      return c.json({ error: "Task not found for this session" }, 404);
    }

    await sql`
      UPDATE epic_proposed_tasks
      SET status = 'rejected', decided_at = now()
      WHERE id = ${taskId}
    `;

    await publishEvent("epic-sessions", "epic.task.rejected", {
      session_id: sessionId,
      task_id: taskId,
      epic_id: tasks[0]!.epic_id,
    });

    log.info(`Task rejected: ${taskId}`);

    return c.json({ success: true });
  } catch (error) {
    log.error("POST /api/epic-sessions/:sessionId/tasks/:taskId/reject error:", error);
    return c.json(
      {
        error: "Failed to reject task",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}

/**
 * POST /api/epic-sessions/:sessionId/execute-all
 * Queue all approved tasks for execution.
 */
export async function executeAllApproved(c: Context): Promise<Response> {
  try {
    const sessionId = c.req.param("sessionId");

    const sql = getDb();

    const sessions = await sql<{ id: string }[]>`
      SELECT id FROM epic_sessions WHERE id = ${sessionId}
    `;

    if (sessions.length === 0) {
      return c.json({ error: "Session not found" }, 404);
    }

    // Fetch all approved tasks that have a linked pipeline step
    const approvedTasks = await sql<Array<{ id: string; epic_id: string; pipeline_step_id: string }>>`
      SELECT t.id, t.epic_id, t.pipeline_step_id
      FROM epic_proposed_tasks t
      WHERE t.session_id = ${sessionId}
        AND t.status = 'approved'
        AND t.pipeline_step_id IS NOT NULL
    `;

    if (approvedTasks.length === 0) {
      return c.json({ success: true, queued: 0, message: "No approved tasks with pipeline steps to execute" });
    }

    const stepIds = approvedTasks.map((t) => t.pipeline_step_id);

    // Update pipeline steps to queued
    await sql`
      UPDATE pipeline_steps
      SET status = 'queued'
      WHERE id = ANY(${sql.array(stepIds)}::uuid[])
    `;

    // Update proposed tasks to executing
    const taskIds = approvedTasks.map((t) => t.id);
    await sql`
      UPDATE epic_proposed_tasks
      SET status = 'executing'
      WHERE id = ANY(${sql.array(taskIds)}::uuid[])
    `;

    // Publish executing event for each task
    for (const task of approvedTasks) {
      await publishEvent("epic-sessions", "epic.task.executing", {
        session_id: sessionId,
        task_id: task.id,
        epic_id: task.epic_id,
        pipeline_step_id: task.pipeline_step_id,
      });
    }

    log.info(`Queued ${approvedTasks.length} tasks for session ${sessionId}`);

    return c.json({ success: true, queued: approvedTasks.length });
  } catch (error) {
    log.error("POST /api/epic-sessions/:sessionId/execute-all error:", error);
    return c.json(
      {
        error: "Failed to execute approved tasks",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
}
