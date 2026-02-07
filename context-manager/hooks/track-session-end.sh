#!/usr/bin/env bash
# track-session-end.sh - Close session in DCM when Claude Code stops
# Reads session data from stdin JSON (Claude Code Stop hook format)

set -uo pipefail

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
CACHE_DIR="/tmp/.claude-context"

# Read hook data from stdin
RAW_INPUT=$(cat 2>/dev/null || echo "")

# Try to extract session_id from stdin JSON
session_id=""
if [[ -n "$RAW_INPUT" ]]; then
    session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
fi

# Fallback: find most recent cache file if no session_id from stdin
if [[ -z "$session_id" && -d "$CACHE_DIR" ]]; then
    latest_cache=$(ls -t "$CACHE_DIR"/*.json 2>/dev/null | head -1)
    if [[ -n "$latest_cache" ]]; then
        session_id=$(jq -r '.session_id // empty' "$latest_cache" 2>/dev/null)
    fi
fi

[[ -z "$session_id" ]] && exit 0

# Close session: set ended_at
curl -s -X PATCH "${API_URL}/api/sessions/${session_id}" \
    -H "Content-Type: application/json" \
    -d "{\"ended_at\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\"}" \
    --connect-timeout 2 \
    --max-time 5 >/dev/null 2>&1 || true

# Clean up cache file
rm -f "${CACHE_DIR}/${session_id}.json" 2>/dev/null || true

exit 0
