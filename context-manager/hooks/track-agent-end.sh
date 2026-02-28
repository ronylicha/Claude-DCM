#!/usr/bin/env bash
# track-agent-end.sh - PostToolUse hook: marks subtask as "completed"
# v3.3: All tracking via DCM API (centralized DB), no local files
#
# Paired with track-agent-start.sh (PreToolUse) which creates it as "running"

set -uo pipefail

# Load libraries
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true
source "$HOOK_DIR/lib/common.sh" 2>/dev/null || true

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
CACHE_DIR="/tmp/.claude-context"

RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

tool_name=$(echo "$RAW_INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
tool_input=$(echo "$RAW_INPUT" | jq -c '.tool_input // empty' 2>/dev/null)
session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)

[[ "$tool_name" != "Task" ]] && exit 0
[[ -z "$session_id" || -z "$tool_input" ]] && exit 0

agent_type=$(echo "$tool_input" | jq -r '.subagent_type // empty' 2>/dev/null || echo "")
description=$(echo "$tool_input" | jq -r '.description // empty' 2>/dev/null || echo "")

[[ -z "$agent_type" ]] && exit 0

# Check circuit breaker
if ! dcm_api_available; then
    exit 0
fi

# Find subtask_id from cache using agent_type:description key
agents_file="${CACHE_DIR}/${session_id}_agents.json"
[[ ! -f "$agents_file" ]] && exit 0

cache_key="${agent_type}:${description}"
subtask_id=$(jq -r --arg key "$cache_key" '.[$key] // empty' "$agents_file" 2>/dev/null || echo "")
[[ -z "$subtask_id" ]] && exit 0

# Mark subtask as completed in DB
curl -s -X PATCH "${API_URL}/api/subtasks/${subtask_id}" \
    -H "Content-Type: application/json" \
    -d '{"status": "completed"}' \
    --connect-timeout 1 --max-time 2 >/dev/null 2>&1 || true

# Remove from cache (atomic with flock)
agents_lock="${agents_file}.lock"
(
    flock -x 200 || exit 1
    tmp_file="${agents_file}.tmp.$$"
    jq --arg key "$cache_key" 'del(.[$key])' "$agents_file" > "$tmp_file" 2>/dev/null && \
        mv "$tmp_file" "$agents_file" 2>/dev/null || rm -f "$tmp_file" 2>/dev/null
) 200>"$agents_lock"

exit 0
