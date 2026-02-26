# Changelog

## [Unreleased] - Codebase Excellence Initiative

Systematic refactoring to improve code quality, maintainability, and operational visibility across the DCM platform.

### Wave 0: Foundation
#### Added
- Structured logger module (`src/lib/logger.ts`) with `createLogger()` factory and LOG_LEVEL support
- Cleanup configuration in `src/config.ts` centralizing magic numbers with environment variable overrides

#### Removed
- Dead code: `decompressData()` function from `db/client.ts` (compressData retained)
- Empty directories: `src/pubsub/` and `src/utils/`

**Commit**: `47e51e3` - excellence(wave-0): foundation - logger, config, dead code cleanup

---

### Wave 1: Data Fixes
#### Fixed
- **CRITICAL**: NULL array bug in `read_by` column handling (`messages.ts`)
  - Fixed race condition where `NOT ANY(NULL) = NULL` caused silent filtering issues

#### Changed
- Refactored SQL in `routing.ts`: 4 near-identical branches → 1 dynamic query (-50 LOC)
- Simplified mark-as-read UPDATE to direct `array_append`
- Wired all cleanup magic numbers through `config.ts` with environment variable overrides

**Files**: `messages.ts`, `cleanup.ts`, `config.ts`

**Commit**: `c14a6f6` - excellence(wave-1): fix read_by NULL bug, refactor SQL, wire cleanup config

---

### Wave 2: Structural Refactoring
#### Changed
- **2A**: Extracted inline route handlers from `server.ts` (1057 → 530 lines, -527 LOC)
  - Dashboard stats, hierarchy, and agent-contexts moved to dedicated API modules
  - Main server file now focused on registration and initialization

- **2B**: Refactored `routing.ts` SQL
  - Consolidated 3 duplicate query branches into 1 dynamic query builder pattern

- **2C**: Logger migration across 26 files
  - Replaced ~160 `console.log/warn/error` calls with structured logger
  - All `src/` files now use `createLogger(tag)` from `lib/logger.ts`
  - SDK files intentionally excluded (preserve user-facing output)

- **2D**: Type safety improvements
  - Fixed `as any` type assertions in `registry.ts` and `actions.ts`
  - Replaced untyped variables with proper Zod validation

**Files**: 26 files modified (server.ts, routing.ts, API modules, websocket handlers, cleanup)

**Commit**: `b5f43dd` - excellence(wave-2): structural refactoring - extract handlers, SQL dedup, logger migration, fix types

---

### Wave 3: Dashboard & Schema
#### Changed
- **3A**: Extracted 5 inline components from `dashboard/page.tsx` (932 → 424 lines, -508 LOC)
  - `HealthGauge` - System health indicator with gauge visualization
  - `PremiumKPICard` - Metric card with glass morphism styling
  - `GlassChartTooltip` - Enhanced tooltip for chart interactions
  - `ActivityFeed` - Real-time activity log component
  - `SystemPulseBar` - Status indicator with pulse animation
  - Extracted shared utilities, constants, and barrel `index.ts`
  - Next.js build verified passing

- **3B**: Improved token estimation ratio (4 → 3.5 chars/token)
  - Added named constant `CHARS_PER_TOKEN` for maintainability

- **3C**: Schema documentation
  - Added TODO documentation for `tools_used` column misuse in `compact.ts`
  - Clarified JSONB metadata structure expectations

#### Added
- New API modules extracted from server.ts routing:
  - `api/agent-contexts.ts` - Agent context management endpoints
  - `api/dashboard.ts` - Dashboard statistics and summaries
  - `api/hierarchy.ts` - Hierarchy tree and organization endpoints

**Files**: 25 files modified (dashboard components, API modules, config)

**Commit**: `61cfb6c` - excellence(wave-3): dashboard components, schema docs, token estimation

---

### Wave 4: Quality & Documentation
#### Added
- Unit test suite for messages API endpoints
- Unit test suite for cleanup module functionality
- OpenAPI 3.1 specification (`openapi.yaml`)
- This CHANGELOG documenting the initiative

#### Testing
- Test baseline: 118 pass, 5 fail (pre-existing WebSocket timeout issues)
- Coverage focus: API contracts and critical cleanup logic

**Status**: Preparation for wave 4 quality gates

---

## Metrics Summary

### Code Quality
- **Lines removed**: ~1,035 (structural refactoring)
  - server.ts: 527 LOC reduction
  - dashboard/page.tsx: 508 LOC reduction
- **Files refactored**: 50 files across context-manager and context-dashboard
- **Net code change**: +1,968 insertions, -1,491 deletions (+477 net, includes new components)

### Architecture
- **Components extracted**: 8 total
  - 3 API modules (agent-contexts, dashboard, hierarchy)
  - 5 dashboard components (HealthGauge, KPI, Tooltip, Feed, Pulse)
- **Routes consolidated**: 4 SQL branches → 1 dynamic query
- **Console calls migrated**: ~160 to structured logger

### Observability
- Structured logging with LOG_LEVEL configuration
- Named constants for maintainability (CHARS_PER_TOKEN, cleanup thresholds)
- TODOs documented for future schema corrections

### Test Coverage
- Messages API test suite
- Cleanup module test suite
- Test baseline: 118 pass, 5 fail

---

## Branch Information
- **Branch**: `excellence/codebase-dcm`
- **Base**: Main branch commit `af02354` (feat: implement DCM v3.0 Proactive Triage Station)
- **Total commits**: 28 (4 main waves + supporting commits)
- **Status**: Ready for review and merge

---

## Impact Assessment
- ✅ **Backward compatible**: All public API signatures unchanged
- ✅ **Performance**: Improved query efficiency, consolidated logging
- ✅ **Maintainability**: Reduced cyclomatic complexity, better code organization
- ✅ **Observability**: Structured logging, schema documentation
- ⚠️ **Breaking changes**: None (internal refactoring only)
