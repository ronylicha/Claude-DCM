/**
 * Orchestrator Template - For project-supervisor, tech-lead, step-orchestrator
 * Phase 5 - Context Agent Integration
 * @module templates/orchestrator
 */

import type {
  AgentContextData,
  TemplateConfig,
  SubtaskContext,
  MessageContext,
  BlockingContext,
} from "../context/types";

/** Template configuration for orchestrators */
export const orchestratorConfig: TemplateConfig = {
  category: "orchestrator",
  agentTypes: [
    "project-supervisor",
    "tech-lead",
    "step-orchestrator",
    "fullstack-coordinator",
  ],
  sections: [
    { name: "mission", required: true, maxTokens: 200, enabled: true },
    { name: "active_tasks", required: true, maxTokens: 400, enabled: true },
    { name: "blocked_agents", required: true, maxTokens: 300, enabled: true },
    { name: "pending_decisions", required: false, maxTokens: 300, enabled: true },
    { name: "messages", required: false, maxTokens: 400, enabled: true },
    { name: "progress_summary", required: false, maxTokens: 200, enabled: true },
  ],
  sectionPriority: {
    mission: 100,
    active_tasks: 90,
    blocked_agents: 85,
    pending_decisions: 70,
    messages: 60,
    progress_summary: 50,
  },
};

/**
 * Generate context brief for orchestrator agents
 * @param data - Agent context data
 * @param agentId - Agent ID
 * @param sessionId - Session ID
 * @returns Formatted markdown brief
 */
export function generateOrchestratorBrief(
  data: AgentContextData,
  agentId: string,
  sessionId: string
): string {
  const sections: string[] = [];

  // Header
  sections.push(`# Context Brief - Orchestrator`);
  sections.push(`**Agent**: ${agentId}`);
  sections.push(`**Session**: ${sessionId}`);
  sections.push(`**Generated**: ${new Date().toISOString()}`);
  sections.push("");

  // Mission/Project section
  if (data.project) {
    sections.push(`## Mission`);
    sections.push(`**Project**: ${data.project.name ?? "Unnamed"}`);
    sections.push(`**Path**: \`${data.project.path}\``);
    if (data.session?.prompt) {
      sections.push(`**Current Request**: ${truncateText(data.session.prompt, 200)}`);
    }
    sections.push("");
  }

  // Active Tasks section (critical for orchestrators)
  sections.push(`## Active Tasks (${data.tasks.length})`);
  if (data.tasks.length === 0) {
    sections.push("No active tasks assigned.");
  } else {
    const tasksByStatus = groupTasksByStatus(data.tasks);

    // Running tasks first
    if (tasksByStatus.running.length > 0) {
      sections.push(`### Running (${tasksByStatus.running.length})`);
      for (const task of tasksByStatus.running.slice(0, 5)) {
        sections.push(formatTaskLine(task));
      }
    }

    // Blocked tasks (high priority for orchestrators)
    if (tasksByStatus.blocked.length > 0) {
      sections.push(`### Blocked (${tasksByStatus.blocked.length})`);
      for (const task of tasksByStatus.blocked.slice(0, 5)) {
        sections.push(formatTaskLine(task, true));
      }
    }

    // Pending tasks
    if (tasksByStatus.pending.length > 0) {
      sections.push(`### Pending (${tasksByStatus.pending.length})`);
      for (const task of tasksByStatus.pending.slice(0, 3)) {
        sections.push(formatTaskLine(task));
      }
      if (tasksByStatus.pending.length > 3) {
        sections.push(`... and ${tasksByStatus.pending.length - 3} more pending tasks`);
      }
    }
  }
  sections.push("");

  // Blocked Agents section (critical for orchestrators)
  sections.push(`## Blocked Agents (${data.blockings.length})`);
  if (data.blockings.length === 0) {
    sections.push("No agents currently blocked.");
  } else {
    for (const blocking of data.blockings.slice(0, 5)) {
      sections.push(formatBlockingLine(blocking));
    }
    if (data.blockings.length > 5) {
      sections.push(`... and ${data.blockings.length - 5} more blockings`);
    }
  }
  sections.push("");

  // High-priority Messages section
  const highPriorityMessages = data.messages.filter((m) => m.priority >= 5);
  const regularMessages = data.messages.filter((m) => m.priority < 5);

  sections.push(`## Messages`);
  if (highPriorityMessages.length > 0) {
    sections.push(`### High Priority (${highPriorityMessages.length})`);
    for (const msg of highPriorityMessages.slice(0, 3)) {
      sections.push(formatMessageLine(msg));
    }
  }
  if (regularMessages.length > 0) {
    sections.push(`### Recent (${regularMessages.length})`);
    for (const msg of regularMessages.slice(0, 3)) {
      sections.push(formatMessageLine(msg));
    }
  }
  if (data.messages.length === 0) {
    sections.push("No unread messages.");
  }
  sections.push("");

  // Progress Summary
  sections.push(`## Progress Summary`);
  const stats = calculateProgressStats(data);
  sections.push(`- **Tasks**: ${stats.completed}/${stats.total} completed (${stats.percentage}%)`);
  sections.push(`- **Blocked**: ${stats.blocked} tasks need attention`);
  sections.push(`- **Active Workers**: ${stats.activeAgents} agents in progress`);
  sections.push("");

  // Instructions for orchestrator
  sections.push(`## Instructions`);
  sections.push(`1. Review blocked tasks and resolve blockers`);
  sections.push(`2. Prioritize high-priority messages`);
  sections.push(`3. Coordinate agents to maximize throughput`);
  sections.push(`4. Escalate critical issues to user if needed`);

  return sections.join("\n");
}

// Helper functions

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function groupTasksByStatus(tasks: SubtaskContext[]): {
  running: SubtaskContext[];
  blocked: SubtaskContext[];
  pending: SubtaskContext[];
  other: SubtaskContext[];
} {
  return {
    running: tasks.filter((t) => t.status === "running"),
    blocked: tasks.filter((t) => t.status === "blocked"),
    pending: tasks.filter((t) => t.status === "pending"),
    other: tasks.filter((t) => !["running", "blocked", "pending"].includes(t.status)),
  };
}

function formatTaskLine(task: SubtaskContext, showBlockers = false): string {
  let line = `- [${task.status.toUpperCase()}] ${truncateText(task.description, 80)}`;
  if (task.agent_type) {
    line += ` (@${task.agent_type})`;
  }
  if (task.wave_number !== undefined) {
    line += ` [Wave ${task.wave_number}]`;
  }
  if (showBlockers && task.blocked_by && task.blocked_by.length > 0) {
    line += ` - Blocked by: ${task.blocked_by.slice(0, 2).join(", ")}`;
    if (task.blocked_by.length > 2) {
      line += ` +${task.blocked_by.length - 2} more`;
    }
  }
  return line;
}

function formatBlockingLine(blocking: BlockingContext): string {
  let line = `- **Blocked by**: ${blocking.blocked_by_agent}`;
  if (blocking.reason) {
    line += ` - ${truncateText(blocking.reason, 50)}`;
  }
  return line;
}

function formatMessageLine(msg: MessageContext): string {
  const from = msg.from_agent ?? "system";
  const topic = msg.topic ?? "general";
  const priority = msg.priority >= 5 ? "[HIGH]" : "";
  const content = typeof msg.content === "object"
    ? JSON.stringify(msg.content).slice(0, 60)
    : String(msg.content).slice(0, 60);
  return `- ${priority} **${from}** (${topic}): ${content}...`;
}

function calculateProgressStats(data: AgentContextData): {
  total: number;
  completed: number;
  blocked: number;
  percentage: number;
  activeAgents: number;
} {
  const total = data.tasks.length;
  const completed = data.tasks.filter((t) => t.status === "completed").length;
  const blocked = data.tasks.filter((t) => t.status === "blocked").length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  const activeAgents = new Set(
    data.tasks.filter((t) => t.status === "running").map((t) => t.agent_type)
  ).size;

  return { total, completed, blocked, percentage, activeAgents };
}

export default generateOrchestratorBrief;
