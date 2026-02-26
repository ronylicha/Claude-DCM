/**
 * Developer Template - For backend-laravel, frontend-react, database-admin, etc.
 * Phase 5 - Context Agent Integration
 * @module templates/developer
 */

import type {
  AgentContextData,
  TemplateConfig,
  SubtaskContext,
  ActionContext,
  MessageContext,
} from "../context/types";

/** Template configuration for developers */
export const developerConfig: TemplateConfig = {
  category: "developer",
  agentTypes: [
    "backend-laravel",
    "frontend-react",
    "laravel-api",
    "database-admin",
    "react-native-dev",
    "react-native-ui",
    "react-native-api",
    "supabase-backend",
    "supabase-edge",
    "devops-infra",
    "migration-specialist",
    "performance-engineer",
    "react-refine",
    "supabase-realtime",
    "supabase-storage",
  ],
  sections: [
    { name: "current_task", required: true, maxTokens: 300, enabled: true },
    { name: "context_files", required: true, maxTokens: 300, enabled: true },
    { name: "recent_actions", required: false, maxTokens: 250, enabled: true },
    { name: "messages", required: false, maxTokens: 200, enabled: true },
    { name: "blockers", required: false, maxTokens: 150, enabled: true },
    { name: "constraints", required: false, maxTokens: 200, enabled: true },
  ],
  sectionPriority: {
    current_task: 100,
    context_files: 90,
    recent_actions: 70,
    messages: 60,
    blockers: 80,
    constraints: 50,
  },
};

/**
 * Generate context brief for developer agents
 * @param data - Agent context data
 * @param agentId - Agent ID
 * @param sessionId - Session ID
 * @returns Formatted markdown brief
 */
export function generateDeveloperBrief(
  data: AgentContextData,
  agentId: string,
  sessionId: string
): string {
  const sections: string[] = [];

  // Header
  sections.push(`# Context Brief - Developer`);
  sections.push(`**Agent**: ${agentId}`);
  sections.push(`**Session**: ${sessionId}`);
  sections.push(`**Generated**: ${new Date().toISOString()}`);
  sections.push("");

  // Current Task (most important for developers)
  sections.push(`## Current Task`);
  const currentTask = data.tasks.find((t) => t.status === "running");
  const pendingTasks = data.tasks.filter((t) => t.status === "pending");

  if (currentTask) {
    sections.push(formatTaskDetails(currentTask));
  } else if (pendingTasks.length > 0 && pendingTasks[0]) {
    sections.push(`**Next task to pick up**:`);
    sections.push(formatTaskDetails(pendingTasks[0]));
  } else {
    sections.push("No tasks currently assigned.");
  }
  sections.push("");

  // Context Files (from recent actions)
  sections.push(`## Relevant Files`);
  const recentFiles = extractRecentFiles(data.history);
  if (recentFiles.length > 0) {
    for (const file of recentFiles.slice(0, 8)) {
      sections.push(`- \`${file}\``);
    }
  } else {
    sections.push("No recent file interactions recorded.");
  }
  sections.push("");

  // Recent Actions (for continuity)
  sections.push(`## Recent Actions (last ${Math.min(data.history.length, 5)})`);
  if (data.history.length === 0) {
    sections.push("No recent actions.");
  } else {
    for (const action of data.history.slice(0, 5)) {
      sections.push(formatActionLine(action));
    }
  }
  sections.push("");

  // Blockers (important for developers to know what's waiting)
  if (data.blockings.length > 0) {
    sections.push(`## Blockers`);
    for (const blocking of data.blockings.slice(0, 3)) {
      sections.push(`- Blocked by **${blocking.blocked_by_agent}**`);
      if (blocking.reason) {
        sections.push(`  Reason: ${truncateText(blocking.reason, 80)}`);
      }
    }
    sections.push("");
  }

  // Messages from orchestrator or other agents
  const relevantMessages = data.messages.filter(
    (m) =>
      m.topic === "task.created" ||
      m.topic === "context.request" ||
      m.priority >= 5
  );
  if (relevantMessages.length > 0) {
    sections.push(`## Messages`);
    for (const msg of relevantMessages.slice(0, 3)) {
      sections.push(formatMessageLine(msg));
    }
    sections.push("");
  }

  // Project context (brief)
  if (data.project) {
    sections.push(`## Project`);
    sections.push(`- **Name**: ${data.project.name ?? "Unnamed"}`);
    sections.push(`- **Path**: \`${data.project.path}\``);
    sections.push("");
  }

  // Instructions
  sections.push(`## Instructions`);
  sections.push(`1. Focus on the current task`);
  sections.push(`2. Use recent files as context`);
  sections.push(`3. Report completion via task update`);
  sections.push(`4. Signal blockers if encountered`);

  return sections.join("\n");
}

// Helper functions

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function formatTaskDetails(task: SubtaskContext): string {
  const lines: string[] = [];
  lines.push(`**Description**: ${task.description}`);
  lines.push(`**Status**: ${task.status.toUpperCase()}`);

  if (task.task_name) {
    lines.push(`**Parent Task**: ${task.task_name}`);
  }
  if (task.wave_number !== undefined) {
    lines.push(`**Wave**: ${task.wave_number}`);
  }
  if (task.blocked_by && task.blocked_by.length > 0) {
    lines.push(`**Depends on**: ${task.blocked_by.join(", ")}`);
  }
  if (task.started_at) {
    const duration = getDurationSince(new Date(task.started_at));
    lines.push(`**Duration**: ${duration}`);
  }

  return lines.join("\n");
}

function extractRecentFiles(history: ActionContext[]): string[] {
  const files = new Set<string>();

  for (const action of history) {
    if (action.file_paths) {
      for (const path of action.file_paths) {
        files.add(path);
      }
    }
  }

  return Array.from(files);
}

function formatActionLine(action: ActionContext): string {
  const status = action.exit_code === 0 ? "[OK]" : `[ERR:${action.exit_code}]`;
  const duration = action.duration_ms
    ? ` (${action.duration_ms}ms)`
    : "";
  const files = action.file_paths?.slice(0, 2).join(", ") ?? "";
  const filesInfo = files ? ` - ${files}` : "";

  return `- ${status} **${action.tool_name}**${duration}${filesInfo}`;
}

function formatMessageLine(msg: MessageContext): string {
  const from = msg.from_agent ?? "system";
  const priority = msg.priority >= 5 ? "[!]" : "";
  const content =
    typeof msg.content === "object"
      ? JSON.stringify(msg.content).slice(0, 50)
      : String(msg.content).slice(0, 50);
  return `- ${priority} From **${from}**: ${content}...`;
}

function getDurationSince(startDate: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - startDate.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "< 1 min";
  if (diffMins < 60) return `${diffMins} min`;
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  return `${hours}h ${mins}m`;
}

export default generateDeveloperBrief;
