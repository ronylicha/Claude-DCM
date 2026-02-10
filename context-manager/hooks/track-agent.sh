#!/usr/bin/env bash
# track-agent.sh - Hook for tracking Claude Code Task tool usage (agent spawning)
# v3.1: Fixed agent_id uniqueness with UUID, atomic cache writes, registry error handling, description truncation
#
# Creates a subtask entry when an agent is spawned via the Task tool
# Auto-creates request->task chain if none exists for the session
# Fetches agent scope from registry for context injection

set -uo pipefail

# Load circuit breaker library
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

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
cwd=$(echo "$RAW_INPUT" | jq -r '.cwd // empty' 2>/dev/null)

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

# Check circuit breaker
if ! dcm_api_available; then
    exit 0
fi

# Ensure cache dir exists
mkdir -p "$CACHE_DIR"

# Get cached task_id for this session
cache_file="${CACHE_DIR}/${session_id}.json"
task_id=""

if [[ -f "$cache_file" ]]; then
    task_id=$(jq -r '.task_id // empty' "$cache_file" 2>/dev/null || echo "")
fi

# If no task_id cached, try to find active task for this session
if [[ -z "$task_id" ]]; then
    requests_result=$(curl -s "${API_URL}/api/requests?session_id=${session_id}&status=active&limit=1" \
        --connect-timeout 1 --max-time 2 2>/dev/null || echo "{}")
    request_id=$(echo "$requests_result" | jq -r '.requests[0].id // empty' 2>/dev/null || echo "")

    if [[ -n "$request_id" ]]; then
        tasks_result=$(curl -s "${API_URL}/api/tasks?request_id=${request_id}&status=running&limit=1" \
            --connect-timeout 1 --max-time 2 2>/dev/null || echo "{}")
        task_id=$(echo "$tasks_result" | jq -r '.tasks[0].id // empty' 2>/dev/null || echo "")
    fi
fi

# If still no task_id, auto-create request + task chain
if [[ -z "$task_id" ]]; then
    # Find or create project
    project_id=""
    if [[ -n "$cwd" ]]; then
        project_result=$(curl -s -X POST "${API_URL}/api/projects" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg path "$cwd" --arg name "$(basename "$cwd")" \
                '{path: $path, name: $name}')" \
            --connect-timeout 1 --max-time 2 2>/dev/null || echo "{}")
        project_id=$(echo "$project_result" | jq -r '.id // .project.id // empty' 2>/dev/null || echo "")
    fi

    # project_id is required by the API - skip if we couldn't get one
    if [[ -z "$project_id" ]]; then
        exit 0
    fi

    # Create a request for this session
    request_body=$(jq -n \
        --arg session_id "$session_id" \
        --arg prompt "Auto-tracked session" \
        --arg project_id "$project_id" \
        '{session_id: $session_id, prompt: $prompt, prompt_type: "other", project_id: $project_id}')

    request_result=$(curl -s -X POST "${API_URL}/api/requests" \
        -H "Content-Type: application/json" \
        -d "$request_body" \
        --connect-timeout 1 --max-time 2 2>/dev/null || echo "{}")
    request_id=$(echo "$request_result" | jq -r '.request.id // .id // empty' 2>/dev/null || echo "")

    if [[ -n "$request_id" ]]; then
        # Create a task for this request
        task_result=$(curl -s -X POST "${API_URL}/api/tasks" \
            -H "Content-Type: application/json" \
            -d "$(jq -n \
                --arg request_id "$request_id" \
                --arg name "Session $session_id" \
                '{request_id: $request_id, name: $name, status: "running"}')" \
            --connect-timeout 1 --max-time 2 2>/dev/null || echo "{}")
        task_id=$(echo "$task_result" | jq -r '.task.id // .id // empty' 2>/dev/null || echo "")
    fi

    # Cache the task_id for future calls in this session (atomic write)
    if [[ -n "$task_id" ]]; then
        cache_tmp="${cache_file}.tmp.$$"
        jq -n --arg task_id "$task_id" --arg request_id "$request_id" --arg project_id "$project_id" \
            '{task_id: $task_id, request_id: $request_id, project_id: $project_id}' > "$cache_tmp" 2>/dev/null && \
            mv "$cache_tmp" "$cache_file" 2>/dev/null || true
    fi
fi

# Cannot create subtask without task_id
if [[ -z "$task_id" ]]; then
    exit 0
fi

# Generate unique agent_id using UUID (uuidgen or /proc/sys/kernel/random/uuid)
agent_id=""
if command -v uuidgen >/dev/null 2>&1; then
    agent_id=$(uuidgen 2>/dev/null | tr '[:upper:]' '[:lower:]')
elif [[ -f /proc/sys/kernel/random/uuid ]]; then
    agent_id=$(cat /proc/sys/kernel/random/uuid 2>/dev/null)
fi

# Fallback to timestamp-based if UUID unavailable
if [[ -z "$agent_id" ]]; then
    agent_id="agent-$(date +%s%N | cut -c1-13)-$(head -c 4 /dev/urandom | xxd -p 2>/dev/null || echo "xxxx")"
fi

# Truncate description if too long (max 500 chars exactly, no off-by-one)
if [[ ${#description} -gt 500 ]]; then
    description="${description:0:500}"
fi

# v3.0: Fetch agent scope from registry (best-effort, non-blocking)
scope_json=""
if dcm_api_available; then
    registry_response=$(timeout 1s curl -s "${API_URL}/api/registry/${agent_type}" \
        --connect-timeout 0.5 --max-time 1 2>/dev/null || echo "")
    
    # Log registry fetch but continue without scope if it fails
    if [[ -n "$registry_response" ]]; then
        scope_json=$(echo "$registry_response" | jq -c '.default_scope // empty' 2>/dev/null || echo "")
        dcm_api_success
    else
        # Registry error is non-fatal, just log and continue
        : # no-op, continue without scope
    fi
fi

# Build context_snapshot with scope if available
context_snapshot="{}"
if [[ -n "$scope_json" && "$scope_json" != "" && "$scope_json" != "null" ]]; then
    context_snapshot=$(jq -n \
        --argjson scope "$scope_json" \
        --arg agent_type "$agent_type" \
        '{agent_scope: $scope, agent_type: $agent_type, scope_injected: true}')
fi

# Create subtask via API
curl -s -X POST "${API_URL}/api/subtasks" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
        --arg task_id "$task_id" \
        --arg agent_type "$agent_type" \
        --arg agent_id "$agent_id" \
        --arg description "$description" \
        --arg status "$([ "$run_in_background" = "true" ] && echo running || echo completed)" \
        --argjson context_snapshot "$context_snapshot" \
        '{task_id: $task_id, agent_type: $agent_type, agent_id: $agent_id, description: $description, status: $status, context_snapshot: $context_snapshot}')" \
    --connect-timeout 1 \
    --max-time 2 \
    >/dev/null 2>&1 || true

# v3.0: Publish scope injection event (non-blocking)
if [[ -n "$scope_json" && "$scope_json" != "" && "$scope_json" != "null" ]]; then
    curl -s -X POST "${API_URL}/api/messages" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg from "system" \
            --arg topic "scope.injected" \
            --arg agent_type "$agent_type" \
            '{from_agent_id: $from, message_type: "notification", topic: $topic, payload: {agent_type: $agent_type, event: "scope_injected"}, priority: 2}')" \
        --connect-timeout 0.5 \
        --max-time 1 \
        >/dev/null 2>&1 &
fi

exit 0
