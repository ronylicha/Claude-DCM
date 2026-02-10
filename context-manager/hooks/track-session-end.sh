#!/usr/bin/env bash
# track-session-end.sh - Close session in DCM when Claude Code stops
# v3.1: Fixed session ID extraction (stdin first, then cache by session, not by date), cleanup agents file
#
# Reads session data from stdin JSON (Claude Code Stop hook format)

set -uo pipefail

# Load circuit breaker library
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
CACHE_DIR="/tmp/.claude-context"

# Read hook data from stdin
RAW_INPUT=$(cat 2>/dev/null || echo "")

# --- Session ID extraction with multiple fallback strategies ---
session_id=""

# Strategy 1: Extract from stdin JSON (HIGHEST PRIORITY)
if [[ -n "$RAW_INPUT" ]]; then
    session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
fi

# Strategy 2: Find cache file for this specific session (not by date)
# If we got session_id from stdin, validate the cache exists
if [[ -n "$session_id" && -d "$CACHE_DIR" ]]; then
    cache_file="${CACHE_DIR}/${session_id}.json"
    if [[ ! -f "$cache_file" ]]; then
        # Cache doesn't exist, maybe session wasn't tracked
        session_id=""
    fi
fi

# Strategy 3: If no session_id from stdin, find most recent cache file
if [[ -z "$session_id" && -d "$CACHE_DIR" ]]; then
    latest_cache=$(ls -t "$CACHE_DIR"/*.json 2>/dev/null | grep -v '_agents\.json$' | head -1)
    if [[ -n "$latest_cache" ]]; then
        session_id=$(jq -r '.session_id // empty' "$latest_cache" 2>/dev/null)
    fi
fi

# Strategy 4: Query API for most recent active session (fallback)
if [[ -z "$session_id" ]]; then
    if dcm_api_available; then
        api_response=$(curl -s "${API_URL}/api/sessions?active_only=true&limit=1&sort=started_at&order=desc" \
            --connect-timeout 1 --max-time 2 2>/dev/null || echo '{}')
        session_id=$(echo "$api_response" | jq -r '.sessions[0].id // empty' 2>/dev/null)
        
        if [[ -n "$session_id" ]]; then
            dcm_api_success
        fi
    fi
fi

if [[ -z "$session_id" ]]; then
    echo "[DCM] track-session-end: could not determine session_id" >&2
    exit 0
fi

# Check circuit breaker before API calls
if ! dcm_api_available; then
    exit 0
fi

# Close session: set ended_at
curl -s -X PATCH "${API_URL}/api/sessions/${session_id}" \
    -H "Content-Type: application/json" \
    -d "{\"ended_at\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}" \
    --connect-timeout 2 \
    --max-time 5 >/dev/null 2>&1 || true

# Close all running subtasks for this session (prevent orphans)
curl -s -X POST "${API_URL}/api/subtasks/close-session" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\": \"${session_id}\"}" \
    --connect-timeout 2 \
    --max-time 5 >/dev/null 2>&1 || true

# Clean up cache files (both session cache and agents cache)
rm -f "${CACHE_DIR}/${session_id}.json" 2>/dev/null || true
rm -f "${CACHE_DIR}/${session_id}_agents.json" 2>/dev/null || true

exit 0
