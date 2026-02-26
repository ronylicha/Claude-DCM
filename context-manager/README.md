# DCM Context Manager Service

Core backend service for the Distributed Context Manager. Provides the REST API server, WebSocket server, and Claude Code hooks that power context tracking, inter-agent communication, and compact recovery across multi-agent sessions.

## Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun >= 1.0 |
| HTTP framework | Hono |
| Database | PostgreSQL 16 |
| WebSocket | Bun native WS |
| Validation | Zod v4 |
| Real-time | PostgreSQL LISTEN/NOTIFY |

## Quick Start

```bash
./dcm install   # Install deps, create DB, configure hooks
./dcm start     # Start API + WebSocket servers
./dcm status    # Verify both services are healthy
```

Manual alternative:

```bash
bun install
cp .env.example .env           # Edit with your PostgreSQL credentials
createdb claude_context
psql claude_context < src/db/schema.sql
bun run start:api              # API on port 3847
bun run start:ws               # WebSocket on port 3849
```

Verify:

```bash
curl http://127.0.0.1:3847/health
curl http://127.0.0.1:3849/health
```

## Auto-Start (Plugin Mode)

When installed as a Claude Code plugin, DCM services start automatically. The `ensure-services.sh` hook fires on every `SessionStart(startup)` event and:

1. Checks if the API is already responding on port 3847
2. If not, verifies PostgreSQL is reachable
3. Starts API and WebSocket servers in the background
4. Waits up to 5 seconds for the API to become healthy
5. Uses file-based locking to prevent race conditions from concurrent sessions

No manual `./dcm start` is needed in plugin mode. Logs go to `/tmp/dcm-api.log` and `/tmp/dcm-ws.log`.

## Project Structure

```
context-manager/
  dcm                          # CLI (install, start, stop, status, hooks, unhook)
  src/
    server.ts                  # API entry point (Hono on Bun, all routes)
    websocket-server.ts        # WebSocket entry point
    config.ts                  # Environment configuration
    context-generator.ts       # Context brief generation engine
    cleanup.ts                 # Expired message cleanup
    api/                       # REST handlers (13 modules, ~50 endpoints)
      actions.ts               #   Tool usage tracking
      blocking.ts              #   Agent blocking/coordination
      compact.ts               #   Compact save/restore
      context.ts               #   Context retrieval
      messages.ts              #   Pub/sub messaging
      projects.ts              #   Project management
      requests.ts              #   User requests
      routing.ts               #   Intelligent keyword routing
      sessions.ts              #   Session management
      subscriptions.ts         #   Topic subscriptions
      subtasks.ts              #   Subtask management
      tasks.ts                 #   Task (wave) management
      tools-summary.ts         #   Tools counting
    db/
      client.ts                # PostgreSQL connection pool
      schema.sql               # Full database schema (10 tables, 4 views)
    websocket/
      server.ts                # WS server with heartbeat
      handlers.ts              # Message handlers + broadcast
      bridge.ts                # PostgreSQL LISTEN/NOTIFY bridge
      auth.ts                  # HMAC-SHA256 token auth
    templates/                 # Context brief templates per agent type
    sdk/                       # TypeScript SDK (REST + WS clients)
    tests/                     # Integration tests (API + WS)
  hooks/
    hooks.json                 # Plugin-native hook definitions
    ensure-services.sh         # Auto-start on SessionStart(startup)
    track-action.sh            # PostToolUse(*) - record tool invocations
    track-agent.sh             # PostToolUse(Task) - track agent lifecycle
    monitor-context.sh         # PostToolUse(*) - proactive context monitoring
    pre-compact-save.sh        # PreCompact - save state before compaction
    post-compact-restore.sh    # SessionStart(compact) - restore context
    save-agent-result.sh       # SubagentStop - broadcast agent results
    track-session.sh           # SessionStart(startup) - register session
    track-session-end.sh       # SessionEnd - close session
  scripts/
    setup-db.sh                # Database creation and schema setup
    setup-hooks.sh             # Inject hooks into Claude Code settings
    health-check.sh            # Health check script
    backup-db.sh               # Database backup
  agents/
    context-keeper.md          # Agent for manual context inspection
  .claude-plugin/
    plugin.json                # Plugin manifest for auto-discovery
  openapi.yaml                 # OpenAPI 3.0 specification
  docker-compose.yml           # Docker deployment
  Dockerfile                   # Container image
```

## Development

```bash
bun run dev          # API with hot reload (--watch)
bun test             # Run integration tests
bun test --watch     # Tests in watch mode
bun x tsc --noEmit   # Type checking
```

All npm scripts:

| Script | Description |
|--------|-------------|
| `dev` | API server with hot reload |
| `start` | Both API + WS servers |
| `start:api` | API server only |
| `start:ws` | WebSocket server only |
| `test` | Run all tests |
| `test:watch` | Tests with watch mode |
| `typecheck` | TypeScript type checking |
| `setup:db` | Database setup |
| `setup:hooks` | Hook configuration |
| `health` | Health check |
| `backup` | Database backup |

Tests are integration tests that require running servers and a database. Start both servers before running tests.

## Configuration

Copy `.env.example` to `.env` and edit. Bun loads `.env` automatically -- no dotenv needed.

| Variable | Default | Description |
|----------|---------|-------------|
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_NAME` | `claude_context` | Database name |
| `DB_USER` | *(required)* | Database user |
| `DB_PASSWORD` | *(required)* | Database password |
| `DB_MAX_CONNECTIONS` | `10` | Connection pool size |
| `HOST` | `127.0.0.1` | Server bind address |
| `PORT` | `3847` | API server port |
| `WS_PORT` | `3849` | WebSocket server port |
| `WS_AUTH_SECRET` | `dcm-dev-secret-change-me` | HMAC secret for WS auth |
| `MESSAGE_TTL_MS` | `3600000` | Message expiration (1 hour) |
| `NODE_ENV` | `development` | Environment mode |

## Ports

| Port | Service | Protocol |
|------|---------|----------|
| 3847 | REST API (Hono) | HTTP |
| 3849 | WebSocket server | WS |

## See Also

- [API Reference](../docs/API.md) -- Full endpoint documentation with examples
- [Architecture](../docs/ARCHITECTURE.md) -- System design, data model, and flows
- [Deployment](../docs/DEPLOYMENT.md) -- Docker, systemd, and production setup
- [Integration](../docs/INTEGRATION.md) -- Hooks, plugin mode, and SDK usage
- [OpenAPI Spec](./openapi.yaml) -- Machine-readable API specification
- [Context Agent Guide](./docs/context-agent-guide.md) -- Context template system
- [Migration Guide](./docs/migration-guide.md) -- Upgrading from previous versions

## License

MIT
