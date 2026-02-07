#!/usr/bin/env bash
# track-agent.sh - Hook for tracking Claude Code Task tool usage (agent spawning)
# Creates a subtask entry when an agent is spawned via the Task tool
# Auto-creates request→task chain if none exists for the session

set -uo pipefail

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

# Skip if no agent type (not a proper agent spawn)
if [[ -z "$agent_type" ]]; then
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

    # Create a request for this session
    request_body=$(jq -n \
        --arg session_id "$session_id" \
        --arg prompt "Auto-tracked session" \
        --arg prompt_type "auto" \
        --arg project_id "$project_id" \
        '{session_id: $session_id, prompt: $prompt, prompt_type: $prompt_type} + (if $project_id != "" then {project_id: $project_id} else {} end)')

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

    # Cache the task_id for future calls in this session
    if [[ -n "$task_id" ]]; then
        jq -n --arg task_id "$task_id" --arg request_id "$request_id" \
            '{task_id: $task_id, request_id: $request_id}' > "$cache_file" 2>/dev/null || true
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

# Create subtask via API
curl -s -X POST "${API_URL}/api/subtasks" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
        --arg task_id "$task_id" \
        --arg agent_type "$agent_type" \
        --arg agent_id "$agent_id" \
        --arg description "$description" \
        '{task_id: $task_id, agent_type: $agent_type, agent_id: $agent_id, description: $description, status: "running"}')" \
    --connect-timeout 1 \
    --max-time 2 \
    >/dev/null 2>&1 || true

exit 0
