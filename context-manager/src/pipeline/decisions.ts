/**
 * Decision Engine — Analyzes agent results and decides what to do next
 * Pure functions only: no DB calls, no side effects.
 * @module pipeline/decisions
 */

import type {
  Decision,
  DecisionContext,
  RetryStrategy,
  PipelineStepRow,
} from "./types.ts";
import { getAgentCategory } from "../lib/helpers.ts";
import { createLogger } from "../lib/logger.ts";

const log = createLogger("Decisions");

// ============================================
// Types
// ============================================

export interface WaveAnalysis {
  all_completed: boolean;
  success_rate: number;
  should_proceed: boolean;
  failed_steps: PipelineStepRow[];
  completed_steps: PipelineStepRow[];
  summary: string;
}

// ============================================
// Alternate Agent Mapping
// ============================================

const ALTERNATE_AGENTS: Record<string, string> = {
  "Snipper": "frontend-react",
  "frontend-react": "Snipper",
  "backend-laravel": "Snipper",
  "Explore": "explore-codebase",
  "code-reviewer": "qa-testing",
};

// ============================================
// Error Classification
// ============================================

function errorSuggestsTimeout(error: string): boolean {
  const lower = error.toLowerCase();
  return lower.includes("timeout") || lower.includes("max_turns");
}

function errorSuggestsNotFound(error: string): boolean {
  const lower = error.toLowerCase();
  return lower.includes("not found") || lower.includes("file");
}

function errorSuggestsPermission(error: string): boolean {
  const lower = error.toLowerCase();
  return lower.includes("permission") || lower.includes("auth");
}

// ============================================
// Core Decision Function
// ============================================

/**
 * Analyze the current pipeline context and return a decision.
 * Pure function -- no DB calls, no side effects.
 */
export function makeDecision(context: DecisionContext): Decision {
  const { step, all_steps_in_wave } = context;
  const error = context.error ?? step.error ?? "";

  // 1. Step completed successfully
  if (step.status === "completed") {
    log.debug("Step completed", step.agent_type, step.id);
    return { action: "proceed", reason: "Step completed" };
  }

  // 2. Step failed, retries remaining
  if (step.status === "failed" && step.retry_count < step.max_retries) {
    if (errorSuggestsPermission(error)) {
      log.warn("Permission/auth error, pausing pipeline", step.agent_type);
      return {
        action: "pause",
        reason: `Permission/auth error requires human intervention: ${error}`,
      };
    }

    let retryStrategy: RetryStrategy = "enhanced";
    let reason: string;

    if (errorSuggestsTimeout(error)) {
      retryStrategy = "enhanced";
      reason = `Timeout/max_turns reached, retrying with enhanced context (attempt ${step.retry_count + 1}/${step.max_retries})`;
    } else if (errorSuggestsNotFound(error)) {
      retryStrategy = "same";
      reason = `File/resource not found (possibly transient), retrying same config (attempt ${step.retry_count + 1}/${step.max_retries})`;
    } else {
      retryStrategy = "enhanced";
      reason = `Step failed, retrying with enhanced prompt (attempt ${step.retry_count + 1}/${step.max_retries})`;
    }

    log.info("Retrying step", step.agent_type, retryStrategy, reason);
    return { action: "retry", retry_strategy: retryStrategy, reason };
  }

  // 3. Step failed, no retries remaining
  if (step.status === "failed") {
    const category = getAgentCategory(step.agent_type);

    if (category === "validator") {
      log.info("Validator step exhausted retries, skipping", step.agent_type);
      return {
        action: "skip",
        reason: `Validation step '${step.agent_type}' failed after ${step.max_retries} retries, continuing pipeline`,
      };
    }

    if (category === "researcher") {
      log.warn("Researcher step exhausted retries, aborting", step.agent_type);
      return {
        action: "abort",
        reason: `Exploration step '${step.agent_type}' failed after ${step.max_retries} retries, cannot proceed without required information`,
      };
    }

    // Check sibling steps in the same wave
    const siblingSteps = all_steps_in_wave.filter((s) => s.id !== step.id);
    const siblingsCompleted = siblingSteps.filter((s) => s.status === "completed");

    if (siblingSteps.length > 0 && siblingsCompleted.length > 0) {
      log.info("Other parallel steps succeeded, skipping failed step", step.agent_type);
      return {
        action: "skip",
        reason: `Step '${step.agent_type}' failed but ${siblingsCompleted.length}/${siblingSteps.length} sibling steps succeeded`,
      };
    }

    if (siblingSteps.length === 0) {
      log.error("Only step in wave failed, aborting", step.agent_type);
      return {
        action: "abort",
        reason: `Critical step '${step.agent_type}' failed with no fallback (only step in wave)`,
      };
    }

    // All siblings also failed
    log.error("All steps in wave failed, aborting", step.agent_type);
    return {
      action: "abort",
      reason: `Step '${step.agent_type}' and all sibling steps failed`,
    };
  }

  // 4. Wave-level evaluation (when step itself is not the trigger)
  const waveAnalysis = analyzeWaveResults(all_steps_in_wave);
  if (waveAnalysis.all_completed) {
    log.info("All wave steps completed");
    return { action: "proceed", reason: "All steps in wave completed successfully" };
  }
  if (waveAnalysis.should_proceed) {
    log.info("Wave partial success, proceeding", waveAnalysis.summary);
    return { action: "proceed", reason: waveAnalysis.summary };
  }

  log.warn("Wave majority failed", waveAnalysis.summary);
  return { action: "abort", reason: waveAnalysis.summary };
}

// ============================================
// Alternate Agent
// ============================================

/**
 * Returns an alternative agent type to try when the original fails.
 * Returns null if no alternate is known.
 */
export function getAlternateAgent(failedAgentType: string): string | null {
  return ALTERNATE_AGENTS[failedAgentType] ?? null;
}

// ============================================
// Model Upgrade
// ============================================

/**
 * Decide whether upgrading the LLM model might help a failing step.
 * Returns the recommended model or indicates no upgrade is warranted.
 */
export function shouldRetryWithDifferentModel(
  step: PipelineStepRow,
): { should: boolean; model: string } {
  if (step.model === "haiku" && step.retry_count > 0) {
    log.info("Upgrading model from haiku to sonnet", step.agent_type);
    return { should: true, model: "sonnet" };
  }
  if (step.model === "sonnet" && step.retry_count > 1) {
    log.info("Upgrading model from sonnet to opus", step.agent_type);
    return { should: true, model: "opus" };
  }
  return { should: false, model: step.model };
}

// ============================================
// Wave Analysis
// ============================================

/**
 * Analyze all steps in a wave and produce an aggregate assessment.
 * Determines whether the pipeline should proceed based on success rate.
 */
export function analyzeWaveResults(steps: PipelineStepRow[]): WaveAnalysis {
  if (steps.length === 0) {
    return {
      all_completed: true,
      success_rate: 1,
      should_proceed: true,
      failed_steps: [],
      completed_steps: [],
      summary: "Empty wave, nothing to evaluate",
    };
  }

  const completed = steps.filter((s) => s.status === "completed");
  const failed = steps.filter((s) => s.status === "failed");
  const skipped = steps.filter((s) => s.status === "skipped");
  const settled = completed.length + failed.length + skipped.length;

  const allCompleted = failed.length === 0 && settled === steps.length;
  const successRate = settled > 0 ? (completed.length + skipped.length) / settled : 0;
  const shouldProceed = allCompleted || successRate > 0.5;

  let summary: string;
  if (allCompleted) {
    summary = `Wave complete: ${completed.length} succeeded, ${skipped.length} skipped`;
  } else if (shouldProceed) {
    summary = `Partial success (${Math.round(successRate * 100)}%): ${completed.length} completed, ${failed.length} failed, ${skipped.length} skipped — proceeding`;
  } else {
    summary = `Too many failures (${Math.round(successRate * 100)}% success): ${completed.length} completed, ${failed.length} failed, ${skipped.length} skipped — aborting`;
  }

  return {
    all_completed: allCompleted,
    success_rate: successRate,
    should_proceed: shouldProceed,
    failed_steps: failed,
    completed_steps: completed,
    summary,
  };
}
