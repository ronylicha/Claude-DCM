# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [1.3.0] - 2026-03-29

### Added

- **SVG/CSS topology replaces Three.js** — no more WebGL context loss, no heavy 3D dependencies. Pure SVG with CSS animations: rotating core ring, animated dash-flow connections, usage ring arcs per session node, click-to-inspect detail card. M3 color tokens throughout. (`757093f`)
- **Statusline Notification hook** — registered `statusline-dcm.sh` on the `Notification` event in Claude Code settings. Pushes real token data (model_id, context_window_size, used_percentage) from Claude Code to DCM in real time. (`9ecb1b5`)
- **KPI chips** in cockpit summary bar — compact M3 chip-style indicators for sessions, agents, and tokens. (`757093f`)

### Changed

- **Cockpit layout redesigned** — topology always visible (no toggle), KPI chips row at top, sessions grid below, live activity at bottom. (`757093f`)
- **DRY: shared session query** — extracted `getActiveSessionsWithCapacity()` in `db/client.ts`. Replaces 3 duplicate DISTINCT ON subqueries across cockpit, orchestrator, and topology endpoints. (`4d9ba53`)
- **Capacity dedup** — DISTINCT ON (session_id) subquery prefers statusline over estimated, then highest current_usage, then most recent. Eliminates all duplicate session rows. (`a2eab7b`, `5bc8b98`)

### Fixed

- **Duplicate sessions in grid and topology** — sessions appeared 2-3 times due to multiple agent_capacity rows per session. Fixed with DISTINCT ON subquery + TS-level dedup. (`82ee354`, `e4c122f`)
- **model_id not showing** — was missing from the `context` block in grid response. Added to response builder. (`dba5f80`)
- **Empty model_id string** — COALESCE didn't catch empty strings. Now uses NULLIF. (`b253c8b`)
- **Statusline hook never fired** — was registered in hooks.json but not in Claude Code settings.json `Notification` event. (`9ecb1b5`)
- **Context window default** — fallback to 200K for Sonnet/Haiku; Opus sends real 1M via statusline. (`e1bc4a0`)

### Removed

- **OrchestratorTopology3D.tsx** — 651 lines deleted. Three.js, @react-three/fiber, @react-three/drei no longer needed for topology. (`85e1a4e`)

---

## [1.2.0] - 2026-03-29

### Added

- **Dynamic skill/agent/command registry** — the catalog now scans `~/.claude/skills/`, `~/.claude/agents/`, and `~/.claude/commands/` at runtime instead of reading from a hardcoded list. Discovers 1200+ skills, 100+ agents, and 20+ commands from whatever the user has installed. Results are cached for 60 seconds. (`8220016`, `6fb9cf1`)
- **10 AI-generated illustrations** in documentation, one per doc page plus architecture, cockpit, orchestration, and hero banner images. (`d32e5b2`)

### Changed

- **Skill classification rewritten** — old regex matched too broadly (98 skills in "design" including billing, monorepo, tmux). New ID-prefix rules put skills where they belong. Added 7 new categories: business, gamedev, communication, integrations, languages, blockchain, automation. Design dropped from 98 to 15 entries. (`93d252b`)
- **Documentation cleaned up** — removed 48 outdated files (wiki, old API docs, design plans, orphan images). Kept 6 Diataxis docs. Net: -23,720 lines. (`293e520`)
- **README updated** — 11 pages (not 12), registry description made generic, hero banner and illustrations added, documentation table with links to all 6 docs. (`df05f8c`, `d32e5b2`)

### Fixed

- **Registry showed 81 skills instead of 1200+** — replaced the 1787-line static `catalog.ts` with a 252-line filesystem scanner. (`8220016`)
- **Agents not detected (0)** — added `scanAgents()` to read `~/.claude/agents/*.md`. (`6fb9cf1`)
- **Commands only 3 instead of 21** — `scanCommands()` now recurses into subdirectories. (`6fb9cf1`)

### Removed

- **Static catalog data file** — 1787 lines of hardcoded agent/skill/command entries replaced by dynamic scan. (`8220016`)
- **48 outdated doc files** — wiki (16 files), old API docs, design plans, orphan images/SVGs. (`293e520`)

### Dependencies

- hono 4.11.10 → 4.12.7, next 16.1.6 → 16.1.7 (Dependabot PR #13)

---

## [1.1.0] - 2026-03-29

### Added

- **Metrics drawer in cockpit** — sliding panel surfaces token consumption, session KPIs, and model distribution directly inside the cockpit; replaces the standalone `/dashboard` page (`377f906`)

### Changed

- **Entropy reduction** — deleted 7 dead files and deduplicated 16 helper functions across the codebase (`d769393`)
- **Dashboard page removed** — the `/dashboard` route is gone; all metrics now live in the cockpit metrics drawer (`377f906`)

### Fixed

- **README accuracy** — corrected dashboard page count from 14 to 12 to reflect reality (`5e27122`)

---

## [1.0.0] - 2026-03-29

_First production release. The entire DCM (Developer Cockpit Manager) system, built from the ground up to give real-time observability and orchestration for Claude Code multi-agent sessions._

### Added

#### Core Platform
- Bun + Hono server with PostgreSQL persistence and WebSocket real-time layer
- Structured logger with `LOG_LEVEL` support, replacing all raw `console.log` calls
- Centralized configuration in `src/config.ts` with environment variable overrides
- OpenAPI 3.1 specification (`openapi.yaml`) documenting every endpoint
- Circuit breaker pattern across hooks, API, and schema layers

#### Cockpit (Single-Page Control Center)
- Multi-monitor cockpit consolidating live view, waves pipeline, and flows into one page
- Real-time token consumption chart (Recharts) with model-aware capacity tracking
- M3 (Material Design 3) design system with full light/dark theme support
- 3D Neural Constellation topology (SVG-based, replacing earlier WebGL implementation)
- Session mini-cockpit cards showing model name (Opus/Sonnet/Haiku), token usage, and activity
- Pre-emptive compaction alerts when sessions approach context limits
- Zoom view with graceful fallback when capacity data is unavailable
- Message detail modal for viewing full message content

#### Orchestrator
- Inter-project orchestrator coordinating across multiple Claude Code projects
- Native Bun orchestrator process (replaces `claude headless`), auto-started with the server
- Proactive info sharing and architecture broadcasts to push context to agents automatically
- SQL-backed message routing with `to_agent_id` always populated

#### Agent Tracking and Hooks
- Agent turns tracking (`turns_used`, `max_turns`, `last_relaunch_context`) with dedicated API endpoints
- Auto-relaunch system: hooks detect when a subagent hits `max_turns` and restart it with context
- `max_turns` propagation from Agent tool input through to subtask creation
- Skill auto-suggestion hook (`suggest-skills.sh`) on `UserPromptSubmit`
- `statusline-dcm.sh` hook for real-time token tracking in the terminal status line
- Hook tool matcher aligned to "Agent" (matching Claude Code rename from "Task")

#### Supervisor
- Systemd user-level supervisor for auto-start on boot, crash recovery, and automatic restart on update
- Dashboard switched to production mode (no more dev server in daily use)
- Database connection retry to survive boot race conditions

#### Dashboard Pages (12 pages)
- Sessions, Agents, Subtasks, Actions, Messages, Tokens, Performance, Flows, Waves, Alerts, Registry, Settings
- All pages aligned with real API data (no fake/placeholder data)
- Premium components: HealthGauge, PremiumKPICard, GlassChartTooltip, ActivityFeed, SystemPulseBar

#### API and Data Layer
- Active session detection based on recent activity timestamp (not `ended_at IS NULL`)
- `v_active_agents` view returning individual agents instead of grouped results
- `actions.session_id` column with direct queries (no broken subtask JOIN chains)
- Agent hierarchy with parent-child relationships
- Compact snapshot-first restore for session reactivation
- Safety gate for critical operations

#### Developer Experience
- Auto-start dashboard with browser open on session start
- Context guardian 4-layer defense for context window management
- Registry catalog with static data, API endpoint, and 3-tab dashboard view
- Wave pipeline hooks wiring for multi-wave orchestration workflows

### Changed

- Extracted inline route handlers from `server.ts` (-527 LOC) into dedicated API modules
- Extracted 5 inline components from the dashboard page (-508 LOC) into standalone files
- Consolidated 4 near-identical SQL branches in routing into 1 dynamic query
- Improved token estimation ratio from 4 to 3.5 chars/token
- M3 color tokens applied in `@layer base` across all components
- Lifecycle cascade: auto-complete tasks and requests, wave sync
- Messages model simplified by removing unused read/unread tracking

### Removed

- Dead code: `decompressData()` from `db/client.ts`
- Empty directories: `src/pubsub/` and `src/utils/`
- 3 redundant pages (standalone live, waves, flows) after cockpit consolidation

### Fixed

- WebGL stability: replaced WebGL 3D with SVG topology, added context loss handling, lazy-loading, DPR limiter, and removed missing font references
- Token tracking: `model_id` persistence with proper SELECT/NULL cast, detection from transcript path, correct `max_capacity` per model
- Orchestrator SQL: `unnest` syntax, interval syntax, `db.json()` for JSONB inserts
- Cockpit data: guards for undefined `agent.id` and null `model_id`, v4/legacy API compat, 8s polling fallback, column ambiguity in FILTER clause
- Messages: null `from_agent_id` color hash handling
- Performance page: actions-by-tool display when `duration_ms` unavailable
- NULL array bug in `read_by` column causing silent message filtering
- DB migrations 003-004 and merge conflict resolution

[1.3.0]: https://github.com/ronylicha/Claude-DCM/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/ronylicha/Claude-DCM/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/ronylicha/Claude-DCM/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ronylicha/Claude-DCM/releases/tag/v1.0.0
