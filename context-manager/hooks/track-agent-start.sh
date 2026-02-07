#!/usr/bin/env bash
# track-agent-start.sh - PreToolUse hook: creates subtask as "running"
# Paired with track-agent-end.sh (PostToolUse) which marks it "completed"

set -uo pipefail

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
CACHE_DIR="/tmp/.claude-context"

RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

tool_name=$(echo "$RAW_INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
tool_input=$(echo "$RAW_INPUT" | jq -c '.tool_input // empty' 2>/dev/null)
session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
cwd=$(echo "$RAW_INPUT" | jq -r '.cwd // empty' 2>/dev/null)

[[ "$tool_name" != "Task" ]] && exit 0
[[ -z "$session_id" || -z "$tool_input" ]] && exit 0

agent_type=$(echo "$tool_input" | jq -r '.subagent_type // empty' 2>/dev/null || echo "")
description=$(echo "$tool_input" | jq -r '.description // empty' 2>/dev/null || echo "")

[[ -z "$agent_type" ]] && exit 0

mkdir -p "$CACHE_DIR"
cache_file="${CACHE_DIR}/${session_id}.json"
task_id=""

if [[ -f "$cache_file" ]]; then
    task_id=$(jq -r '.task_id // empty' "$cache_file" 2>/dev/null || echo "")
fi

# Find or create task chain if needed
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

if [[ -z "$task_id" ]]; then
    project_id=""
    if [[ -n "$cwd" ]]; then
        project_result=$(curl -s -X POST "${API_URL}/api/projects" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg path "$cwd" --arg name "$(basename "$cwd")" '{path: $path, name: $name}')" \
            --connect-timeout 1 --max-time 2 2>/dev/null || echo "{}")
        project_id=$(echo "$project_result" | jq -r '.id // .project.id // empty' 2>/dev/null || echo "")
    fi
    [[ -z "$project_id" ]] && exit 0

    request_result=$(curl -s -X POST "${API_URL}/api/requests" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg session_id "$session_id" --arg prompt "Auto-tracked session" --arg project_id "$project_id" \
            '{session_id: $session_id, prompt: $prompt, prompt_type: "other", project_id: $project_id}')" \
        --connect-timeout 1 --max-time 2 2>/dev/null || echo "{}")
    request_id=$(echo "$request_result" | jq -r '.request.id // .id // empty' 2>/dev/null || echo "")

    if [[ -n "$request_id" ]]; then
        task_result=$(curl -s -X POST "${API_URL}/api/tasks" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg request_id "$request_id" --arg name "Session $session_id" \
                '{request_id: $request_id, name: $name, status: "running"}')" \
            --connect-timeout 1 --max-time 2 2>/dev/null || echo "{}")
        task_id=$(echo "$task_result" | jq -r '.task.id // .id // empty' 2>/dev/null || echo "")
    fi

    if [[ -n "$task_id" ]]; then
        # Save task chain to cache
        existing=$(cat "$cache_file" 2>/dev/null || echo "{}")
        echo "$existing" | jq --arg task_id "$task_id" --arg request_id "${request_id:-}" \
            '. + {task_id: $task_id, request_id: $request_id}' > "$cache_file" 2>/dev/null || true
    fi
fi

[[ -z "$task_id" ]] && exit 0

# Generate unique agent_id
agent_id="agent-$(date +%s%N | cut -c1-13)-$(head -c 4 /dev/urandom | xxd -p 2>/dev/null || echo "xxxx")"

[[ ${#description} -gt 500 ]] && description="${description:0:497}..."

# Create subtask as RUNNING
result=$(curl -s -X POST "${API_URL}/api/subtasks" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
        --arg task_id "$task_id" \
        --arg agent_type "$agent_type" \
        --arg agent_id "$agent_id" \
        --arg description "$description" \
        '{task_id: $task_id, agent_type: $agent_type, agent_id: $agent_id, description: $description, status: "running"}')" \
    --connect-timeout 1 --max-time 2 2>/dev/null || echo "{}")

subtask_id=$(echo "$result" | jq -r '.subtask.id // .id // empty' 2>/dev/null || echo "")

# Cache subtask_id so track-agent-end.sh can close it
if [[ -n "$subtask_id" ]]; then
    # Store agent_id -> subtask_id mapping
    agents_file="${CACHE_DIR}/${session_id}_agents.json"
    existing=$(cat "$agents_file" 2>/dev/null || echo "{}")
    echo "$existing" | jq --arg key "$agent_type:$description" --arg sid "$subtask_id" \
        '. + {($key): $sid}' > "$agents_file" 2>/dev/null || true
fi

exit 0
