# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [2.6.1] - 2026-04-03

### Changed

- **GitHub Pages site** — Complete overhaul of `index.html` to reflect v2.6.x.
  - Hero: updated tagline, description, and version badge (v1.3.0 → v2.6.1)
  - Stats: 143+ endpoints, 6 LLM providers, 26+ tables, 18 dashboard pages, 5 services
  - Features: 12 cards covering Pipeline Engine, Sprint System, LLM Providers, Live Streaming, Smart Recovery, Guard & Observations, Docker, Bundled Assets
  - Architecture: 5-service diagram (added Pipeline Engine + Redis)
  - Dashboard preview: updated sidebar with Pipelines, Sprints, Settings pages
  - Tech stack: added Redis, Three.js, Remotion
  - Quick Start: added Docker option alongside native install
  - New SVG logo (network constellation) replacing emoji favicon

### Added

- **Changelog section** on GitHub Pages site — displays v2.1.0 through v2.6.0 releases with links to full CHANGELOG.md

## [2.6.0] - 2026-04-03

### Fixed

- **Systemd PATH auto-detection** — `build_service_path()` detects binary locations for `claude`, `bun`, `node`, `npm`, `npx`, `git`, `curl`, `psql`, `jq`, `codex`, `gemini` and injects them into `Environment=PATH=` in all 3 service templates. Fixes `claude: command not found` when pipeline planner runs via systemd.
- **WatchdogSec=0** — Disabled in API service template (was 600s, caused kills without sd_notify).
- **Pipeline planning failure** — Root cause was missing PATH in systemd preventing `claude` CLI from being found.

### Changed

- **Service templates** — All 3 templates (`dcm-api`, `dcm-ws`, `dcm-dashboard`) now include `Environment=PATH=__SERVICE_PATH__`.
- **`setup-supervisor.sh`** — `template_service()` replaces `__SERVICE_PATH__` with auto-detected PATH. Also checks `~/.local/bin`, `~/.bun/bin`, `~/.cargo/bin` as fallbacks.

## [2.5.0] - 2026-04-01

### Added

- **Bundled Agents, Skills, Rules & CLAUDE.md** — DCM ships with all referenced assets.
  - 65 agent definitions (`.md` files) covering all `subagent_type` values used in prompts
  - 58 skill packages (folders with `SKILL.md`, references, steps) for all domain skills
  - 5 command definitions for slash commands
  - 9 rule files (backend-laravel, database, development, devops-cicd, frontend-react, mobile-react-native, protection-workflow, security, testing)
  - `CLAUDE.md.template` — complete orchestration rules installed as `~/.claude/CLAUDE.md` on first install
  - `dcm install` step 5d: `install_bundled_assets()` copies agents/skills/commands/rules to `~/.claude/`
  - Agents and skills are only installed if not already present (no overwrite)
  - Rules are always updated (DCM is the source of truth)
  - CLAUDE.md is only installed if no user file exists

### Changed

- **`dcm` CLI** — v2.4.0 with `install_bundled_assets` function in install workflow.

## [2.4.0] - 2026-04-01

### Added

- **Guard Observation Processing** — Guards now feed improvements back into the pipeline.
  - Guard prompt enriched: outputs structured `OBSERVATIONS:` list with `PRIORITY: HIGH|MEDIUM|LOW`
  - `processGuardObservations()` extracts observations from PASS guards
  - HIGH/MEDIUM priority → injects a new improvement wave with dedicated steps
  - LOW priority → logged only, no action taken
  - `detectAgentForObservation()` routes observations to the right agent type (qa-testing, security-specialist, performance-engineer, frontend-react, backend-laravel, etc.)
  - Idempotent: `guard_observations_processed` event prevents double-processing
  - Improvement steps are `pending` until `findReadyWaves()` picks them up

### Changed

- **Guard prompt** — Now requires structured output: `GUARD_STATUS`, `OBSERVATIONS`, `PRIORITY` fields.
  - FAIL = blocking errors (syntax, missing files, regressions)
  - PASS + OBSERVATIONS = functional code with improvement opportunities

## [2.3.0] - 2026-04-01

### Added

- **Self-healing Pipeline Worker** — Complete rewrite of the worker as an autonomous supervisor.
  - 6 checks per cycle: planner jobs, executor jobs, stale jobs, orphan steps, stuck planning, queued steps
  - First cycle after startup runs ALL checks immediately (no throttling)
  - Detects orphan `running` steps with no active Claude process → auto-requeues
  - Cleanup of stale `pipeline_jobs` whose temp files were lost after restart
  - Retry limit (max 3) prevents infinite requeue loops → marks as `failed`
  - Single `pgrep -af` call per cycle instead of one per step

- **`step_id` column on `pipeline_jobs`** — Links jobs to specific pipeline steps for precise tracking.

### Changed

- **Worker startup** — All checks run on cycle 0 (immediate), replacing the fragile `import().then()` pattern.
- **Orphan detection** — Moved from `executor.ts` (never called) into the worker's main cycle.
- **Stale job cleanup** — New check marks `pipeline_jobs` as `lost` when temp files are missing.
- **`checkQueuedSteps`** — No longer filters by active executor jobs (stale jobs blocked relaunches).

### Fixed

- **Watchdog killing DCM API** — `WatchdogSec=600` required `sd_notify` keepalives that were never sent. Disabled (`WatchdogSec=0`).
- **`step_id` column missing** — Migration defined it but table pre-existed without it. Added `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
- **`recoverRunningAgents()` never called** — Exported but never imported at startup. Now integrated directly in worker cycle.
- **Silent SQL errors** — Worker catch blocks swallowed `step_id` column errors, making orphan detection silently fail.

## [2.2.0] - 2026-04-01

### Added

- **Pipeline Worker** — Intelligent background supervisor (10s cycle loop).
  - Monitors planner/executor jobs via `pipeline_jobs` DB table
  - Auto-detects completed `.done` files and injects plans / updates steps
  - Recovers stuck pipelines from workspace files or orphaned outputs
  - Relaunches queued steps without active executor processes
  - Replaces fragile setInterval pollers with resilient DB-tracked jobs

- **Job Tracking Table** (`pipeline_jobs`) — Persistent tracking of all CLI jobs.
  - Links `job_id` to `pipeline_id` and `step_id`
  - Stores `tmp_dir` for file recovery after service restart
  - Worker picks up running jobs on startup

- **DCM Deploy Step 5** — Auto rebuilds skill index + imports agent registry post-restart.

### Changed

- **Server startup** — Uses `startWorker()` instead of separate recovery functions.
- **CLIPlannerProvider** — Registers jobs in DB before launching.
- **Executor** — Registers jobs in DB before launching agents.

## [2.1.0] - 2026-03-31

### Added

- **Pipeline Engine** — Full AI-powered pipeline orchestrator with waves, steps, sprints, and dependencies.
  - `pipeline/planner.ts` — LLM-powered plan generation (calls Opus/Sonnet/API providers)
  - `pipeline/runner.ts` — Wave-by-wave lifecycle management with sprint tracking
  - `pipeline/executor.ts` — Launches Claude CLI agents in detached systemd scopes
  - `pipeline/decisions.ts` — Pure-logic retry/fallback/skip/abort decision engine
  - Post-processor: extracts JSON from any LLM output format (text, files, mixed)
  - Workspace file recovery: reads plan from JSON files written by agents

- **Parallel Wave Execution** — Dependency-aware scheduling via `depends_on` graph.
  - `findReadyWaves()` queues ALL waves whose deps are satisfied at once
  - Backend + frontend waves run in parallel when they share the same parent
  - Pipeline completes only when no active AND no ready waves remain

- **Regression Guard** — Auto-injected after each implementation wave.
  - Verifies files exist, imports valid, structure matches plan
  - Runs as Sonnet agent (fast, 5 turns max)
  - Skipped for explore/review/guard waves

- **LLM Provider System** — 6 providers with extensible architecture.
  - API: MiniMax M2.7, ZhipuAI GLM-5, Moonshot Kimi K2.5
  - CLI: Claude (Opus/Sonnet), Codex (GPT-5.4), Gemini (3.1-pro)
  - `BaseLLMProvider` abstract class with SSE streaming support
  - `CLIPlannerProvider` with detached systemd scopes + file-based polling
  - Provider-specific fixes: ZhipuAI reasoning_content, MiniMax `<think>` stripping, Moonshot temperature

- **Sprint System** — Auto-generated sprints with git integration.
  - Planner generates sprints from wave groups
  - Auto `git commit` at end of each sprint
  - AI-evaluated sprint reports (Sonnet checks objectives)
  - Sprint timeline component in dashboard

- **Live Streaming** — Real-time LLM output during planning and execution.
  - `planning_output` table for incremental chunks
  - API providers: SSE streaming with `stream: true`
  - CLI providers: file polling with chunk detection
  - Dashboard: terminal-style live viewer with auto-scroll

- **Settings Page** — LLM provider management in dashboard.
  - Provider cards with API key input, model selector, test button
  - Planner config: radio buttons (single selection) + model dropdown
  - CLI providers: no API key needed, install status check
  - Configure model without re-entering API key

- **Pipeline Dashboard** — Full execution visualization.
  - Pipeline list with status badges, action menu (start/pause/cancel/delete/retry)
  - Pipeline detail: wave stepper, all waves expanded, step cards
  - Planning live view: terminal output during plan generation
  - Sprint timeline with expandable objective cards
  - Synthesis panel with stats, files, errors, timeline

- **Workspace & Git** — Pipeline workspace management.
  - Required workspace path for pipeline creation
  - Server-side directory browser (`GET /api/fs/browse`)
  - Git integration: clone/pull on start, commit per sprint
  - GitHub connection: `GET /api/git/status` with org listing

- **File Upload** — Document attachment for pipeline planning.
  - Drag-and-drop + file picker in creation dialog
  - Client-side file reading (JSON, not FormData)
  - Supports .md, .txt, .json, code files

- **Docker Support** — Full containerized deployment.
  - PostgreSQL 17, Redis 7 with custom ports (avoid conflicts)
  - `dcm docker:up/down/logs/reset` commands
  - `.env.example` with all configurable ports

- **Smart Recovery** — Auto-recover after service restarts.
  - `recoverStuckPlanners()` relaunches planning workers on startup
  - `recoverRunningAgents()` checks process liveness via `pgrep`
  - Activity-based health checks (output file modification time)
  - 1h timeout before re-queuing (Opus can take 10min+)

- **Full HookInput Data** — Complete token/cost tracking from Claude Code.
  - Parses ALL HookInput fields: model, context_window, cost, cache, lines, version
  - 10 new columns on `agent_capacity` table
  - Cockpit displays cost ($), +lines/-lines, cache tokens
  - Capacity row selection: prefers rows with actual usage > 0

- **Database Tables** — `pipelines`, `pipeline_steps`, `pipeline_events`, `pipeline_sprints`, `planning_output`, `llm_providers`, `dcm_settings`

- **TypeScript Strict Compliance** — 651 type errors fixed across 40+ files.

### Changed

- **Planner** — Rewritten from keyword heuristics to LLM-powered (no fallback).
- **Cockpit** — Prefers capacity rows with `current_usage > 0` over empty statusline.
- **DCM CLI** — v2.3.0 with `deploy`, `docker:*` commands, skill index build, agent registry import.
- **NavigationRail** — Added Pipeline and Settings links.
- **Package versions** — Both packages bumped to 2.1.0.

### Removed

- **Heuristic fallback plan** — `buildFallbackPlan()` and `autoGenerateSprints()` deleted.
- **`buildStepPrompt` re-export** — Removed from barrel exports.

## [1.5.0] - 2026-03-31

### Added

- **Skill Gate API** — 5 new endpoints with dynamic enforcement via PostgreSQL.
- **`session_skills` + `session_workflow_state` tables** — persistent PostgreSQL storage.
- **`skill-gate-enforce.sh`** — unified PreToolUse hook.
- **3-layer routing** — skills + agents + catalog in parallel.
- **Skill Advisor + DCM integration** — queries DCM routing before Haiku.

### Changed

- **`track-action.sh`** — registers skills in `session_skills`.
- **`track-session.sh`** — initializes `session_workflow_state`.
- **`setup-hooks.sh`** — auto-detects dev vs deploy path.

### Removed

- 7 custom scripts migrated to DCM.
