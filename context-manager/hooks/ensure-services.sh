#!/usr/bin/env bash
# ensure-services.sh - Auto-start DCM services if not running
# Triggered by SessionStart(startup) hook in Claude Code
# Idempotent: does nothing if services are already running
set -uo pipefail

# Configuration
DCM_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
API_PORT="${PORT:-3847}"
WS_PORT="${WS_PORT:-3849}"
API_URL="http://127.0.0.1:${API_PORT}"
WS_URL="http://127.0.0.1:${WS_PORT}"
LOG_DIR="/tmp"
PIDS_DIR="/tmp/.dcm-pids"
LOCK_FILE="/tmp/.dcm-autostart.lock"

# Load env if available
if [[ -f "$DCM_ROOT/.env" ]]; then
    set -a
    source "$DCM_ROOT/.env" 2>/dev/null || true
    set +a
    API_PORT="${PORT:-3847}"
    WS_PORT="${WS_PORT:-3849}"
    API_URL="http://127.0.0.1:${API_PORT}"
    WS_URL="http://127.0.0.1:${WS_PORT}"
fi

# Prevent concurrent auto-starts (race condition with multiple Claude sessions)
if [[ -f "$LOCK_FILE" ]]; then
    lock_age=$(( $(date +%s) - $(stat -c %Y "$LOCK_FILE" 2>/dev/null || echo 0) ))
    if (( lock_age < 30 )); then
        # Another auto-start is in progress, wait for it
        for i in $(seq 1 10); do
            if curl -s --connect-timeout 1 --max-time 2 "${API_URL}/health" >/dev/null 2>&1; then
                exit 0
            fi
            sleep 0.5
        done
        exit 0
    fi
    # Stale lock, remove it
    rm -f "$LOCK_FILE"
fi

# Quick health check - if API responds, everything is likely fine
if curl -s --connect-timeout 1 --max-time 2 "${API_URL}/health" | grep -q '"healthy"' 2>/dev/null; then
    exit 0
fi

# Services not running - acquire lock and start them
echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

mkdir -p "$PIDS_DIR"

# Check PostgreSQL is available before starting
DB_USER="${DB_USER:-dcm}"
DB_NAME="${DB_NAME:-claude_context}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5432}"

if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -q 2>/dev/null; then
    # PostgreSQL not ready - cannot start DCM
    # Output a warning that will appear in hook output
    echo '{"warning": "DCM auto-start skipped: PostgreSQL not available"}' >&2
    exit 0
fi

# Start API server if not running
if ! curl -s --connect-timeout 1 --max-time 2 "${API_URL}/health" >/dev/null 2>&1; then
    cd "$DCM_ROOT"
    nohup bun run src/server.ts > "${LOG_DIR}/dcm-api.log" 2>&1 &
    echo $! > "$PIDS_DIR/api.pid"
fi

# Start WebSocket server if not running
if ! lsof -i ":${WS_PORT}" >/dev/null 2>&1; then
    cd "$DCM_ROOT"
    nohup bun run src/websocket-server.ts > "${LOG_DIR}/dcm-ws.log" 2>&1 &
    echo $! > "$PIDS_DIR/ws.pid"
fi

# Wait for API to become healthy (max ~5s)
api_ready=false
for i in $(seq 1 10); do
    if curl -s --connect-timeout 1 --max-time 2 "${API_URL}/health" | grep -q '"healthy"' 2>/dev/null; then
        api_ready=true
        break
    fi
    sleep 0.5
done

if [[ "$api_ready" == "true" ]]; then
    echo '{"status": "dcm-autostarted", "api_port": '"$API_PORT"', "ws_port": '"$WS_PORT"'}' >&2
else
    echo '{"warning": "DCM auto-start: API not ready after 5s, check /tmp/dcm-api.log"}' >&2
fi

exit 0
