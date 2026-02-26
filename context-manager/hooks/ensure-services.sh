#!/usr/bin/env bash
# ensure-services.sh - Auto-start DCM services if not running
# Triggered by SessionStart(startup) hook in Claude Code
# Idempotent: does nothing if services are already running
set -uo pipefail

# Ensure bun and common tools are in PATH
export PATH="$HOME/.bun/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node/ 2>/dev/null | tail -1)/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

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

# Start Dashboard if not running
DASHBOARD_PORT="${DASHBOARD_PORT:-3848}"
DASHBOARD_DIR="$(cd "$DCM_ROOT/.." && pwd)/context-dashboard"
DASHBOARD_URL="http://localhost:${DASHBOARD_PORT}"

if [[ -d "$DASHBOARD_DIR" ]] && ! curl -s --connect-timeout 1 --max-time 2 "$DASHBOARD_URL" >/dev/null 2>&1; then
    cd "$DASHBOARD_DIR"
    PORT=${DASHBOARD_PORT} nohup bun run dev > "${LOG_DIR}/dcm-dashboard.log" 2>&1 &
    echo $! > "$PIDS_DIR/dashboard.pid"
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

# Open dashboard in browser (only if services were just started, not already running)
if [[ "$api_ready" == "true" ]]; then
    # Open browser in background, silently - try xdg-open (Linux), then open (macOS)
    if command -v xdg-open &>/dev/null; then
        nohup xdg-open "$DASHBOARD_URL" > /dev/null 2>&1 &
    elif command -v open &>/dev/null; then
        open "$DASHBOARD_URL" &
    fi
    echo '{"status": "dcm-autostarted", "api_port": '"$API_PORT"', "ws_port": '"$WS_PORT"', "dashboard_port": '"$DASHBOARD_PORT"'}' >&2
else
    echo '{"warning": "DCM auto-start: API not ready after 5s, check /tmp/dcm-api.log"}' >&2
fi

exit 0
