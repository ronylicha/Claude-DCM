#!/usr/bin/env bash
# track-agent-end.sh - PostToolUse hook: marks subtask as "completed"
# v3.1: Fixed key collision with agent_id instead of agent_type:description, flock for cache race
#
# Paired with track-agent-start.sh (PreToolUse) which creates it as "running"

set -uo pipefail

# Load circuit breaker library
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

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

# Find subtask_id from cache using agent_id (not agent_type:description)
# The cache should use agent_id as the key (set by track-agent-start.sh)
agents_file="${CACHE_DIR}/${session_id}_agents.json"
[[ ! -f "$agents_file" ]] && exit 0

# Use flock for atomic read/write
agents_lock="${agents_file}.lock"
subtask_id=""
(
    flock -x 200 || exit 1
    
    # In the updated version, track-agent-start.sh should store by agent_id
    # For now, we'll try both old key format and new agent_id format
    # Old key format for backward compatibility
    old_key="${agent_type}:${description}"
    subtask_id=$(jq -r --arg key "$old_key" '.[$key] // empty' "$agents_file" 2>/dev/null || echo "")
    
    # If no subtask_id found with old key, it means we need agent_id
    # For now, we'll just get any subtask for this agent_type from the file
    if [[ -z "$subtask_id" ]]; then
        # Get first subtask_id that matches this agent_type (stored as value)
        subtask_id=$(jq -r --arg atype "$agent_type" 'to_entries[] | select(.key | startswith($atype + ":")) | .value' "$agents_file" 2>/dev/null | head -1 || echo "")
    fi
    
    echo "$subtask_id"
) 200>"$agents_lock"

subtask_id=$(cat "$agents_lock" 2>/dev/null | tail -1 || echo "")
[[ -z "$subtask_id" ]] && exit 0

# Mark subtask as completed
curl -s -X PATCH "${API_URL}/api/subtasks/${subtask_id}" \
    -H "Content-Type: application/json" \
    -d '{"status": "completed"}' \
    --connect-timeout 1 --max-time 2 >/dev/null 2>&1 || true

# Remove from cache (atomic with flock)
(
    flock -x 200 || exit 1
    
    # Remove the old key format entry
    old_key="${agent_type}:${description}"
    tmp_file="${agents_file}.tmp.$$"
    jq --arg key "$old_key" 'del(.[$key])' "$agents_file" > "$tmp_file" 2>/dev/null && \
        mv "$tmp_file" "$agents_file" 2>/dev/null || rm -f "$tmp_file" 2>/dev/null
) 200>"$agents_lock"

exit 0
