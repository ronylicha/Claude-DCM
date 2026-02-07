#!/usr/bin/env bash
# track-agent.sh - Hook for tracking Claude Code Task tool usage (agent spawning)
# Creates a subtask entry when an agent is spawned via the Task tool
#
# Environment variables from Claude Code:
#   TOOL_NAME    - Name of the tool (we only care about "Task")
#   TOOL_INPUT   - JSON input containing subagent_type, description, etc.
#   SESSION_ID   - Current session ID

set -euo pipefail

# Configuration
API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
CACHE_DIR="/tmp/.claude-context"

# Read hook data from stdin (Claude Code passes JSON via stdin)
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

# Extract fields from JSON
tool_name=$(echo "$RAW_INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
tool_input=$(echo "$RAW_INPUT" | jq -c '.tool_input // empty' 2>/dev/null)
session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)

# Only process Task tool calls
if [[ "$tool_name" != "Task" ]]; then
    exit 0
fi

# Exit silently if no session or input
if [[ -z "$session_id" || -z "$tool_input" ]]; then
    exit 0
fi

# Extract agent info from tool input
agent_type=$(echo "$tool_input" | jq -r '.subagent_type // empty' 2>/dev/null || echo "")
description=$(echo "$tool_input" | jq -r '.description // empty' 2>/dev/null || echo "")
run_in_background=$(echo "$tool_input" | jq -r '.run_in_background // false' 2>/dev/null || echo "false")

# Skip if no agent type (not a proper agent spawn)
if [[ -z "$agent_type" ]]; then
    exit 0
fi

# Get cached task_id for this session
cache_file="${CACHE_DIR}/${session_id}.json"
task_id=""

if [[ -f "$cache_file" ]]; then
    task_id=$(jq -r '.task_id // empty' "$cache_file" 2>/dev/null || echo "")
fi

# If no task_id cached, try to find active task for this session
if [[ -z "$task_id" ]]; then
    # Query API for active request/task
    requests_result=$(curl -s "${API_URL}/api/requests?session_id=${session_id}&status=active&limit=1" \
        --connect-timeout 1 --max-time 2 2>/dev/null || echo "{}")
    request_id=$(echo "$requests_result" | jq -r '.requests[0].id // empty' 2>/dev/null || echo "")

    if [[ -n "$request_id" ]]; then
        tasks_result=$(curl -s "${API_URL}/api/tasks?request_id=${request_id}&status=running&limit=1" \
            --connect-timeout 1 --max-time 2 2>/dev/null || echo "{}")
        task_id=$(echo "$tasks_result" | jq -r '.tasks[0].id // empty' 2>/dev/null || echo "")
    fi
fi

# Cannot create subtask without task_id
if [[ -z "$task_id" ]]; then
    exit 0
fi

# Generate unique agent_id
agent_id="agent-$(date +%s%N | cut -c1-13)-$(head -c 4 /dev/urandom | xxd -p 2>/dev/null || echo "xxxx")"

# Truncate description if too long (max 500 chars for subtask)
if [[ ${#description} -gt 500 ]]; then
    description="${description:0:497}..."
fi

# Escape special characters for JSON
description_escaped=$(echo "$description" | jq -Rs '.' | sed 's/^"//;s/"$//')

# Create subtask
curl -s -X POST "${API_URL}/api/subtasks" \
    -H "Content-Type: application/json" \
    -d "{
        \"task_id\": \"$task_id\",
        \"agent_type\": \"$agent_type\",
        \"agent_id\": \"$agent_id\",
        \"description\": \"$description_escaped\",
        \"status\": \"running\"
    }" \
    --connect-timeout 1 \
    --max-time 2 \
    >/dev/null 2>&1 || true

exit 0
