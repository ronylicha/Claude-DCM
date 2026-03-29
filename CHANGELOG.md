# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Inter-project orchestrator with 3D topology visualization** — full v4.1 orchestrator that coordinates across multiple projects with a live 3D constellation view (`6bd6567`)
- **Native Bun orchestrator process** — replaces claude headless; starts automatically with the server (`4f951fc`)
- **Proactive info sharing and architecture broadcasts** — orchestrator now pushes relevant context to agents proactively (`cf950fb`)
- **Cockpit multi-monitor, real-time tokens, M3 design system, pre-emptive compaction** — major v4 dashboard overhaul (`0506cbe`)
- **3D topology Neural Constellation theme** — redesigned cockpit topology with constellation-style visualization (`3a85acd`)
- **Agent turns tracking and relaunch system** — `turns_used`, `max_turns`, `last_relaunch_context` columns on subtasks; dedicated API endpoints; hooks for iteration tracking and auto-relaunch (`12b57a9`, `86aa5af`, `22a3f3d`, `26ed441`, `e0bf5bc`)
- **Skill auto-suggestion hook** — `suggest-skills.sh` registered on UserPromptSubmit to recommend relevant skills automatically (`f918c38`, `31d85b6`)
- **`max_turns` wiring** — Agent tool input now propagates `max_turns` through to subtask creation (`fc08acb`)
- **Systemd user-level supervisor** — auto-start on boot, crash recovery, and automatic restart on update (`f2415b4`)
- **`statusline-dcm.sh` hook** — real-time token tracking displayed in terminal status line (`c3692f5`)
- **Message detail modal** — view full message content in a dedicated modal (`c839256`)
- **Real Recharts consumption chart** in cockpit, replacing placeholder (`39c0755`)

### Changed

- **Cockpit consolidation** — live, waves, and flows pages merged into a single cockpit view; 3 redundant pages removed (`9fed85a`)
- **Messages: removed read/unread status** — simplified message model by dropping useless read/unread tracking (`c839256`)
- **Dashboard switched to production mode** (`e23465b`)
- **API: return individual agents from `v_active_agents` view** instead of grouped results (`a02d2ca`)
- **Cockpit displays model name** (Opus/Sonnet/Haiku) instead of raw `model_id` (`6f20ee2`)
- **Active session detection** — uses recent activity timestamp instead of `ended_at IS NULL` across all endpoints (`645bda4`, `b3f48cc`, `16fea74`)
- **Actions schema** — added `session_id` column, resolved `subtask_id` references; all queries now use `actions.session_id` directly instead of broken subtask JOIN chains (`b285d25`, `d351a11`)
- **M3 color tokens** applied in `@layer base`; cockpit shows all active sessions (`3d2cba0`)
- **Exhaustive audit** — aligned all dashboard pages with real API data, removed fake data and fixed labels (`17e85a0`, `4b07718`)
- **Hook tool matcher renamed** from "Task" to "Agent" to match Claude Code rename (`7ed7867`)

### Fixed

- **Cockpit WebGL stability** (grouped, oldest to newest):
  - Replaced WebGL 3D with SVG topology to eliminate context loss (`942afb1`)
  - Added WebGL context loss handler, DPR limiter, and dynamic imports (`62e5592`)
  - Lazy-load 3D topology on click to prevent premature WebGL context allocation (`14d7eb5`)
  - Removed missing font references from 3D topology (`eb25397`)
  - Fixed 3D navigation and agent detection in LivePanel (`bb28a4f`)
  - Fixed WebGL Context Lost on first load and suppressed Clock warning (`e8ee743`)
- **Cockpit data handling**:
  - Guard against undefined `agent.id` in CockpitLivePanel (`6273e03`)
  - Support both v4 `active_sessions` and legacy `active_agents` in CockpitLivePanel (`a98da1b`)
  - Poll session grid every 8s even with WebSocket connected (`1b42353`)
  - Handle null `model_id` in SessionMiniCockpit (`054f5e9`)
  - Qualify `st.status` in FILTER to resolve column ambiguity (`2a622e6`)
  - Zoom view works without capacity data, defaults to green (`26f9848`)
  - Show sessions active in last 30min, not just `ended_at IS NULL` (`16fea74`)
  - Detect active sessions by recent activity (`645bda4`)
- **Orchestrator SQL fixes**:
  - Fixed SQL `unnest` syntax in proactive queries (`08ea788`)
  - Fixed SQL interval syntax and use `db.json()` for JSONB inserts (`fdc0a94`)
  - Always populate `to_agent_id` in messages (`22530be`)
- **Token tracking**:
  - Fixed `model_id` persistence with proper SELECT and NULL-to-TEXT cast (`291530b`)
  - Detect `model_id` from transcript path instead of env vars (`e69d637`)
  - Detect `model_id` and set correct `max_capacity` per model (`ddaaa5c`)
- **Messages**: handle null `from_agent_id` in color hash (`b8604a9`)
- **Performance page**: show actions by tool when `duration_ms` unavailable (`edddf0c`)
- **Supervisor**: add DB connection retry to survive boot race condition (`27cd593`)

### Documentation

- Added implementation plan for skill suggestion and agent relaunch (`b6488b9`)

---

## [3.1.0] - 2026-02-28

### Added

- Single version source across all packages (`e6a7e19`)
- Agent hierarchy with parent-child relationships (`e6a7e19`)
- Compact snapshot-first restore for session reactivation (`e6a7e19`)
- Safety gate for critical operations (`37a67cb`)
- Terminal dashboard for quick status overview (`37a67cb`)
- Monitored agent template and enhanced agents UI (`37a67cb`)
- Wave pipeline hooks wiring (`5eb82d9`)

### Fixed

- Invalid Date on compact frequency chart X-axis (`447abd7`)
- Compact history data mapping (`5eb82d9`)
- Waves and Flows pages now theme-aware for light/dark mode (`312324b`)

### Documentation

- Updated README with v3.1.0 features (`54a53f6`)

---

## [3.0.0] - 2026-02-28

_Codebase Excellence Initiative — systematic refactoring to improve code quality, maintainability, and operational visibility._

### Added

- Structured logger module (`src/lib/logger.ts`) with `createLogger()` factory and LOG_LEVEL support
- Cleanup configuration in `src/config.ts` centralizing magic numbers with environment variable overrides
- API modules extracted from server.ts: `api/agent-contexts.ts`, `api/dashboard.ts`, `api/hierarchy.ts`
- Dashboard components: HealthGauge, PremiumKPICard, GlassChartTooltip, ActivityFeed, SystemPulseBar
- Unit test suites for messages API and cleanup module
- OpenAPI 3.1 specification (`openapi.yaml`)
- Registry catalog: static data, API endpoint, 3-tab dashboard
- Context guardian 4-layer defense
- Auto-start dashboard with browser open on session start
- Circuit breaker pattern (resolved 72+ bugs across hooks, API, schema)

### Changed

- Extracted inline route handlers from `server.ts` (1057 to 530 lines, -527 LOC)
- Extracted 5 inline components from `dashboard/page.tsx` (932 to 424 lines, -508 LOC)
- Refactored SQL in `routing.ts`: 4 near-identical branches consolidated into 1 dynamic query
- Logger migration across 26 files (~160 `console.log` calls replaced with structured logger)
- Improved token estimation ratio (4 to 3.5 chars/token) with named constant
- Fixed `as any` type assertions in `registry.ts` and `actions.ts`
- Lifecycle cascade: auto-complete tasks/requests, wave sync

### Removed

- Dead code: `decompressData()` function from `db/client.ts`
- Empty directories: `src/pubsub/` and `src/utils/`

### Fixed

- NULL array bug in `read_by` column handling (`messages.ts`) — race condition where `NOT ANY(NULL)` caused silent filtering
- DB migrations 003-004 and merge conflict in ensure-services

---

[Unreleased]: https://github.com/ronylicha/Claude-DCM/compare/3.1.0...HEAD
[3.1.0]: https://github.com/ronylicha/Claude-DCM/compare/3.0.0...3.1.0
[3.0.0]: https://github.com/ronylicha/Claude-DCM/releases/tag/3.0.0
