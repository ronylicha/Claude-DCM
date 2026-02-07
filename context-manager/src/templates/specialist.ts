/**
 * Specialist Template - For security-specialist, gdpr-dpo, accessibility-specialist, etc.
 * Phase 5 - Context Agent Integration
 * @module templates/specialist
 */

import type {
  AgentContextData,
  TemplateConfig,
  SubtaskContext,
  MessageContext,
} from "../context/types";

/** Template configuration for specialists */
export const specialistConfig: TemplateConfig = {
  category: "specialist",
  agentTypes: [
    "security-specialist",
    "gdpr-dpo",
    "legal-compliance",
    "accessibility-specialist",
    "seo-specialist",
    "i18n-specialist",
    "impact-analyzer",
    "n8n-specialist",
    "openapi-expert",
    "superpdp-expert",
  ],
  sections: [
    { name: "assignment", required: true, maxTokens: 300, enabled: true },
    { name: "domain_context", required: true, maxTokens: 300, enabled: true },
    { name: "scope", required: false, maxTokens: 200, enabled: true },
    { name: "messages", required: false, maxTokens: 200, enabled: true },
    { name: "guidelines", required: false, maxTokens: 200, enabled: true },
  ],
  sectionPriority: {
    assignment: 100,
    domain_context: 90,
    scope: 80,
    messages: 60,
    guidelines: 70,
  },
};

/**
 * Generate context brief for specialist agents
 * @param data - Agent context data
 * @param agentId - Agent ID
 * @param sessionId - Session ID
 * @returns Formatted markdown brief
 */
export function generateSpecialistBrief(
  data: AgentContextData,
  agentId: string,
  sessionId: string
): string {
  const sections: string[] = [];
  const specialization = detectSpecialization(agentId);

  // Header
  sections.push(`# Context Brief - Specialist (${specialization.name})`);
  sections.push(`**Agent**: ${agentId}`);
  sections.push(`**Session**: ${sessionId}`);
  sections.push(`**Generated**: ${new Date().toISOString()}`);
  sections.push("");

  // Assignment (current task)
  sections.push(`## Current Assignment`);
  const currentTask = data.tasks.find((t) => t.status === "running");
  const pendingTasks = data.tasks.filter((t) => t.status === "pending");

  if (currentTask) {
    sections.push(formatSpecialistTask(currentTask, specialization));
  } else if (pendingTasks.length > 0 && pendingTasks[0]) {
    sections.push(`**Next assignment**:`);
    sections.push(formatSpecialistTask(pendingTasks[0], specialization));
  } else {
    sections.push("No tasks currently assigned.");
  }
  sections.push("");

  // Domain-specific context
  sections.push(`## ${specialization.name} Context`);
  sections.push(formatDomainContext(specialization, data));
  sections.push("");

  // Scope (files/areas to focus on)
  const recentFiles = extractFilesFromHistory(data.history);
  if (recentFiles.length > 0) {
    sections.push(`## Scope of Analysis`);
    for (const file of recentFiles.slice(0, 8)) {
      sections.push(`- \`${file}\``);
    }
    sections.push("");
  }

  // Messages from orchestrator
  const relevantMessages = data.messages.filter(
    (m) =>
      m.priority >= 5 ||
      m.topic === "context.request" ||
      isOrchestratorMessage(m)
  );
  if (relevantMessages.length > 0) {
    sections.push(`## Messages`);
    for (const msg of relevantMessages.slice(0, 3)) {
      sections.push(formatMessageLine(msg));
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

  // Specialization-specific guidelines
  sections.push(`## ${specialization.name} Guidelines`);
  for (const guideline of specialization.guidelines) {
    sections.push(`- ${guideline}`);
  }
  sections.push("");

  // Instructions
  sections.push(`## Instructions`);
  sections.push(`1. Focus on ${specialization.focus}`);
  sections.push(`2. Document all findings`);
  sections.push(`3. Provide actionable recommendations`);
  sections.push(`4. Report critical issues immediately`);

  return sections.join("\n");
}

// Specialization types

interface Specialization {
  name: string;
  focus: string;
  guidelines: string[];
  keywords: string[];
}

const SPECIALIZATIONS: Record<string, Specialization> = {
  security: {
    name: "Security",
    focus: "vulnerabilities and security risks",
    guidelines: [
      "Check for OWASP Top 10 vulnerabilities",
      "Verify input validation and sanitization",
      "Review authentication and authorization",
      "Check for sensitive data exposure",
      "Audit dependency vulnerabilities",
    ],
    keywords: ["security", "vulnerability", "auth", "permission", "xss", "sql"],
  },
  gdpr: {
    name: "GDPR/Privacy",
    focus: "data protection compliance",
    guidelines: [
      "Verify consent mechanisms",
      "Check data retention policies",
      "Review data access controls",
      "Ensure right to deletion support",
      "Document data processing activities",
    ],
    keywords: ["gdpr", "privacy", "consent", "personal data", "dpo"],
  },
  accessibility: {
    name: "Accessibility",
    focus: "WCAG 2.1 compliance",
    guidelines: [
      "Check keyboard navigation",
      "Verify ARIA labels and roles",
      "Test color contrast ratios",
      "Ensure screen reader compatibility",
      "Validate form accessibility",
    ],
    keywords: ["a11y", "accessibility", "wcag", "aria", "screen reader"],
  },
  seo: {
    name: "SEO",
    focus: "search engine optimization",
    guidelines: [
      "Check meta tags and titles",
      "Verify structured data markup",
      "Review URL structure",
      "Analyze page performance",
      "Check mobile responsiveness",
    ],
    keywords: ["seo", "search", "meta", "sitemap", "schema"],
  },
  legal: {
    name: "Legal Compliance",
    focus: "regulatory compliance",
    guidelines: [
      "Verify terms of service",
      "Check cookie policies",
      "Review license compliance",
      "Audit third-party agreements",
      "Document compliance status",
    ],
    keywords: ["legal", "compliance", "contract", "license", "regulation"],
  },
  impact: {
    name: "Impact Analysis",
    focus: "change impact assessment",
    guidelines: [
      "Identify affected components",
      "Map dependencies",
      "Assess risk levels",
      "Document breaking changes",
      "Recommend mitigation strategies",
    ],
    keywords: ["impact", "analysis", "change", "dependency", "risk"],
  },
  default: {
    name: "Specialist",
    focus: "domain expertise",
    guidelines: [
      "Apply domain knowledge",
      "Document findings",
      "Provide recommendations",
      "Flag critical issues",
    ],
    keywords: [],
  },
};

function detectSpecialization(agentId: string): Specialization {
  const lowerAgent = agentId.toLowerCase();

  if (lowerAgent.includes("security")) return SPECIALIZATIONS["security"]!;
  if (lowerAgent.includes("gdpr") || lowerAgent.includes("dpo"))
    return SPECIALIZATIONS["gdpr"]!;
  if (lowerAgent.includes("accessibility") || lowerAgent.includes("a11y"))
    return SPECIALIZATIONS["accessibility"]!;
  if (lowerAgent.includes("seo")) return SPECIALIZATIONS["seo"]!;
  if (lowerAgent.includes("legal") || lowerAgent.includes("compliance"))
    return SPECIALIZATIONS["legal"]!;
  if (lowerAgent.includes("impact")) return SPECIALIZATIONS["impact"]!;

  return SPECIALIZATIONS["default"]!;
}

function formatSpecialistTask(
  task: SubtaskContext,
  spec: Specialization
): string {
  const lines: string[] = [];
  lines.push(`**Task**: ${task.description}`);
  lines.push(`**Status**: ${task.status.toUpperCase()}`);
  lines.push(`**Focus Area**: ${spec.focus}`);

  if (task.task_name) {
    lines.push(`**Parent Task**: ${task.task_name}`);
  }

  return lines.join("\n");
}

function formatDomainContext(
  spec: Specialization,
  data: AgentContextData
): string {
  const lines: string[] = [];

  // Add relevant context based on specialization
  lines.push(`Applying **${spec.name}** expertise to this session.`);

  // Count related tasks
  const relatedTasks = data.tasks.filter((t) =>
    spec.keywords.some((kw) => t.description.toLowerCase().includes(kw))
  );

  if (relatedTasks.length > 0) {
    lines.push(`Found ${relatedTasks.length} related tasks in scope.`);
  }

  // Add compliance note for GDPR
  if (spec.name === "GDPR/Privacy") {
    lines.push("");
    lines.push("**Compliance Requirements**: RGPD (mandatory)");
  }

  // Add security note
  if (spec.name === "Security") {
    lines.push("");
    lines.push("**Standards**: OWASP Top 10, HDS if health data");
  }

  return lines.join("\n");
}

function extractFilesFromHistory(
  history: AgentContextData["history"]
): string[] {
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

function isOrchestratorMessage(msg: MessageContext): boolean {
  const orchestrators = [
    "project-supervisor",
    "tech-lead",
    "step-orchestrator",
  ];
  return orchestrators.some((o) => msg.from_agent?.includes(o));
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

export default generateSpecialistBrief;
