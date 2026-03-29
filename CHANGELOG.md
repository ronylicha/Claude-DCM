# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/)
and this project adheres to [Semantic Versioning](https://semver.org/).

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

[1.1.0]: https://github.com/ronylicha/Claude-DCM/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ronylicha/Claude-DCM/releases/tag/v1.0.0
