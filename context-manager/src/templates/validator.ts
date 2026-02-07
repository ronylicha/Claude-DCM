/**
 * Validator Template - For qa-testing, regression-guard, code-reviewer, validator
 * Phase 5 - Context Agent Integration
 * @module templates/validator
 */

import type {
  AgentContextData,
  TemplateConfig,
  SubtaskContext,
  ActionContext,
  MessageContext,
} from "../context/types";

/** Template configuration for validators */
export const validatorConfig: TemplateConfig = {
  category: "validator",
  agentTypes: [
    "qa-testing",
    "regression-guard",
    "validator",
    "code-reviewer",
  ],
  sections: [
    { name: "validation_target", required: true, maxTokens: 300, enabled: true },
    { name: "changes_to_review", required: true, maxTokens: 400, enabled: true },
    { name: "baselines", required: false, maxTokens: 200, enabled: true },
    { name: "previous_issues", required: false, maxTokens: 200, enabled: true },
    { name: "messages", required: false, maxTokens: 150, enabled: true },
    { name: "checklist", required: false, maxTokens: 150, enabled: true },
  ],
  sectionPriority: {
    validation_target: 100,
    changes_to_review: 95,
    baselines: 80,
    previous_issues: 70,
    messages: 50,
    checklist: 60,
  },
};

/**
 * Generate context brief for validator agents
 * @param data - Agent context data
 * @param agentId - Agent ID
 * @param sessionId - Session ID
 * @returns Formatted markdown brief
 */
export function generateValidatorBrief(
  data: AgentContextData,
  agentId: string,
  sessionId: string
): string {
  const sections: string[] = [];

  // Header
  sections.push(`# Context Brief - Validator`);
  sections.push(`**Agent**: ${agentId}`);
  sections.push(`**Session**: ${sessionId}`);
  sections.push(`**Generated**: ${new Date().toISOString()}`);
  sections.push("");

  // Validation Target (what to validate)
  sections.push(`## Validation Target`);
  const currentTask = data.tasks.find((t) => t.status === "running");
  const pendingTasks = data.tasks.filter((t) => t.status === "pending");

  if (currentTask) {
    sections.push(formatValidationTask(currentTask));
  } else if (pendingTasks.length > 0 && pendingTasks[0]) {
    sections.push(`**Next validation task**:`);
    sections.push(formatValidationTask(pendingTasks[0]));
  } else {
    sections.push("No validation tasks currently assigned.");
  }
  sections.push("");

  // Changes to Review (files modified by developers)
  sections.push(`## Changes to Review`);
  const modifiedFiles = extractModifiedFiles(data.history);
  if (modifiedFiles.length > 0) {
    sections.push(`Files recently modified:`);
    for (const file of modifiedFiles.slice(0, 10)) {
      sections.push(`- \`${file.path}\` (${file.action})`);
    }
  } else {
    sections.push("No file changes detected in recent history.");
  }
  sections.push("");

  // Previous Issues (from failed actions)
  const failedActions = data.history.filter((a) => a.exit_code !== 0);
  if (failedActions.length > 0) {
    sections.push(`## Previous Issues (${failedActions.length})`);
    for (const action of failedActions.slice(0, 5)) {
      sections.push(formatFailedAction(action));
    }
    sections.push("");
  }

  // Completed validations in session
  const completedValidations = data.tasks.filter(
    (t) => t.status === "completed" && isValidationTask(t)
  );
  if (completedValidations.length > 0) {
    sections.push(`## Completed Validations (${completedValidations.length})`);
    for (const task of completedValidations.slice(0, 3)) {
      sections.push(`- [DONE] ${truncateText(task.description, 60)}`);
    }
    sections.push("");
  }

  // Messages (especially from developers requesting review)
  const reviewRequests = data.messages.filter(
    (m) =>
      m.topic === "task.completed" ||
      m.topic === "context.request" ||
      (m.from_agent && isDevAgent(m.from_agent))
  );
  if (reviewRequests.length > 0) {
    sections.push(`## Review Requests`);
    for (const msg of reviewRequests.slice(0, 3)) {
      sections.push(formatReviewRequest(msg));
    }
    sections.push("");
  }

  // Project context
  if (data.project) {
    sections.push(`## Project`);
    sections.push(`- **Name**: ${data.project.name ?? "Unnamed"}`);
    sections.push(`- **Path**: \`${data.project.path}\``);
    sections.push("");
  }

  // Validation Checklist
  sections.push(`## Validation Checklist`);
  sections.push(`- [ ] Code compiles without errors`);
  sections.push(`- [ ] Tests pass (unit, integration)`);
  sections.push(`- [ ] No regression from baseline`);
  sections.push(`- [ ] Security checks pass`);
  sections.push(`- [ ] Performance acceptable`);
  sections.push("");

  // Instructions
  sections.push(`## Instructions`);
  sections.push(`1. Review all changed files`);
  sections.push(`2. Run validation suite`);
  sections.push(`3. Compare against baselines`);
  sections.push(`4. Report issues with clear descriptions`);
  sections.push(`5. Approve or request changes`);

  return sections.join("\n");
}

// Helper functions

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + "...";
}

function formatValidationTask(task: SubtaskContext): string {
  const lines: string[] = [];
  lines.push(`**Target**: ${task.description}`);
  lines.push(`**Status**: ${task.status.toUpperCase()}`);

  if (task.task_name) {
    lines.push(`**Parent Task**: ${task.task_name}`);
  }
  if (task.wave_number !== undefined) {
    lines.push(`**Wave**: ${task.wave_number}`);
  }
  if (task.agent_type) {
    lines.push(`**Requested by**: @${task.agent_type}`);
  }

  return lines.join("\n");
}

interface FileChange {
  path: string;
  action: "created" | "modified" | "deleted" | "read";
}

function extractModifiedFiles(history: ActionContext[]): FileChange[] {
  const fileChanges = new Map<string, FileChange>();

  for (const action of history) {
    if (!action.file_paths) continue;

    const actionType = inferActionType(action.tool_name);
    for (const path of action.file_paths) {
      // Prefer write actions over read actions
      const existing = fileChanges.get(path);
      if (!existing || actionType !== "read") {
        fileChanges.set(path, { path, action: actionType });
      }
    }
  }

  return Array.from(fileChanges.values());
}

function inferActionType(
  toolName: string
): "created" | "modified" | "deleted" | "read" {
  const lowerTool = toolName.toLowerCase();

  if (lowerTool.includes("write") || lowerTool.includes("create")) {
    return "created";
  }
  if (lowerTool.includes("edit") || lowerTool.includes("update")) {
    return "modified";
  }
  if (lowerTool.includes("delete") || lowerTool.includes("remove")) {
    return "deleted";
  }
  return "read";
}

function formatFailedAction(action: ActionContext): string {
  const files = action.file_paths?.slice(0, 2).join(", ") ?? "unknown";
  return `- **${action.tool_name}** failed (exit: ${action.exit_code}) - ${files}`;
}

function isValidationTask(task: SubtaskContext): boolean {
  const desc = task.description.toLowerCase();
  return (
    desc.includes("test") ||
    desc.includes("review") ||
    desc.includes("validate") ||
    desc.includes("check") ||
    desc.includes("audit")
  );
}

function isDevAgent(agentId: string): boolean {
  const devAgents = [
    "backend-laravel",
    "frontend-react",
    "laravel-api",
    "database-admin",
    "react-native-dev",
    "supabase-backend",
    "devops-infra",
  ];
  return devAgents.some((a) => agentId.includes(a));
}

function formatReviewRequest(msg: MessageContext): string {
  const from = msg.from_agent ?? "unknown";
  const content =
    typeof msg.content === "object"
      ? JSON.stringify(msg.content).slice(0, 60)
      : String(msg.content).slice(0, 60);
  return `- From **${from}**: ${content}...`;
}

export default generateValidatorBrief;
