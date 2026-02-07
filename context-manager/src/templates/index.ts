/**
 * Templates Index - Export all templates
 * Phase 5 - Context Agent Integration
 * @module templates
 */

export { generateOrchestratorBrief, orchestratorConfig } from "./orchestrator";
export { generateDeveloperBrief, developerConfig } from "./developer";
export { generateValidatorBrief, validatorConfig } from "./validator";
export { generateSpecialistBrief, specialistConfig } from "./specialist";

import type { AgentContextData, AgentCategory } from "../context/types";
import { getAgentCategory } from "../context/types";
import { generateOrchestratorBrief } from "./orchestrator";
import { generateDeveloperBrief } from "./developer";
import { generateValidatorBrief } from "./validator";
import { generateSpecialistBrief } from "./specialist";

/** Template generator function type */
type TemplateGenerator = (
  data: AgentContextData,
  agentId: string,
  sessionId: string
) => string;

/** Map of categories to their template generators */
const TEMPLATE_GENERATORS: Record<AgentCategory, TemplateGenerator> = {
  orchestrator: generateOrchestratorBrief,
  developer: generateDeveloperBrief,
  validator: generateValidatorBrief,
  specialist: generateSpecialistBrief,
  researcher: generateDeveloperBrief, // Use developer template for researchers
  writer: generateSpecialistBrief, // Use specialist template for writers
};

/**
 * Get the appropriate template generator for an agent type
 * @param agentType - The agent type string
 * @returns The template generator function
 */
export function getTemplateGenerator(agentType: string): TemplateGenerator {
  const category = getAgentCategory(agentType);
  return TEMPLATE_GENERATORS[category];
}

/**
 * Generate brief using appropriate template
 * @param agentType - The agent type string
 * @param data - Agent context data
 * @param agentId - Agent ID
 * @param sessionId - Session ID
 * @returns Formatted markdown brief
 */
export function generateBrief(
  agentType: string,
  data: AgentContextData,
  agentId: string,
  sessionId: string
): string {
  const generator = getTemplateGenerator(agentType);
  return generator(data, agentId, sessionId);
}
