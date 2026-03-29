# Skill Auto-Suggestion & Subagent Relaunch Implementation Plan

> **Status:** IMPLEMENTED (all 9 tasks completed)
> **Implemented:** 2026-03-29
> **Version:** 1.1.0

**Goal:** Two features: (A) automatic skill suggestion via UserPromptSubmit hook, (B) subagent iteration tracking + auto-relaunch with compacted context.

**Architecture:** Feature A uses UserPromptSubmit hook to intercept prompts, extract keywords, and query the existing routing API (`GET /api/routing/suggest`). Feature B adds `turns_used`/`max_turns` columns to subtasks, an API endpoint for tracking turns, and a SubagentStop hook for relaunching exhausted agents with compacted context.

**Tech Stack:** Bash (hooks), TypeScript/Hono (API), PostgreSQL (migrations), Bun (runtime)

---

## Implementation Summary

| Task | File | Status |
|------|------|--------|
| 1. suggest-skills.sh | `hooks/suggest-skills.sh` | Done |
| 2. Register in hooks.json | `hooks/hooks.json` | Done |
| 3. DB migration | `src/db/migrations/006_agent_turns_tracking.sql` | Done |
| 4. Agents API | `src/api/agents.ts` + `src/server.ts` | Done |
| 5. track-agent-turns.sh | `hooks/track-agent-turns.sh` | Done |
| 6. relaunch-agent.sh | `hooks/relaunch-agent.sh` | Done |
| 7. Register hooks | `hooks/hooks.json` | Done |
| 8. Wire max_turns | `hooks/track-agent-start.sh` + `src/api/subtasks.ts` | Done |
| 9. Integration test | Manual verification | Done |

## Decision Log

| Decision | Alternatives | Reason |
|----------|-------------|--------|
| Hook UserPromptSubmit + existing routing API | Dedicated NLP endpoint | API already exists |
| Simple keyword extraction | NLP/embeddings | YAGNI + 500ms budget |
| Auto-invoke at score >= 0.8 | Always auto-invoke | Balance automation/control |
| 3-5 skills max | Unlimited | Avoid noise |
| PostToolUse tracking + API | WebSocket push | Simpler |
| Relaunch with new agent + context | Resume same agent | Can't inject compacted context on resume |
| Max 2 relaunches (3 attempts) | 1 or 3 | Cost/persistence balance |
| Rate limit every 3rd call | Every call | Reduce API load |
| turns_used column in subtasks | Separate table | Simplicity, related data |
