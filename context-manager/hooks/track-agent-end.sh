#!/usr/bin/env bash
# track-agent-end.sh - PostToolUse hook: marks subtask as "completed"
# Paired with track-agent-start.sh (PreToolUse) which creates it as "running"

set -uo pipefail

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

# Find subtask_id from cache
agents_file="${CACHE_DIR}/${session_id}_agents.json"
[[ ! -f "$agents_file" ]] && exit 0

key="${agent_type}:${description}"
subtask_id=$(jq -r --arg key "$key" '.[$key] // empty' "$agents_file" 2>/dev/null || echo "")

[[ -z "$subtask_id" ]] && exit 0

# Mark subtask as completed
curl -s -X PATCH "${API_URL}/api/subtasks/${subtask_id}" \
    -H "Content-Type: application/json" \
    -d '{"status": "completed"}' \
    --connect-timeout 1 --max-time 2 >/dev/null 2>&1 || true

# Remove from cache
jq --arg key "$key" 'del(.[$key])' "$agents_file" > "${agents_file}.tmp" 2>/dev/null && \
    mv "${agents_file}.tmp" "$agents_file" 2>/dev/null || true

exit 0
