#!/usr/bin/env bash
# track-session.sh - Hook for tracking Claude Code session start
# Creates: project -> session -> request -> task (for subtasks)
# Reads session data from stdin JSON (Claude Code SessionStart hook format)

set -uo pipefail

# Configuration
API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
CACHE_DIR="/tmp/.claude-context"

# Read hook data from stdin (Claude Code passes JSON via stdin)
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

# Extract fields from JSON
session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
project_path=$(echo "$RAW_INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Fallback for project_path
if [[ -z "$project_path" ]]; then
    project_path=$(pwd)
fi

# Exit silently if no session
if [[ -z "$session_id" ]]; then
    exit 0
fi

# Always inject DCM Orchestrator Protocol (even if session already tracked)
cat <<'HOOK_OUTPUT'
{"hookSpecificOutput":{"additionalContext":"## DCM Orchestrator Protocol\n\nBefore launching ANY subagent via Task tool:\n1. POST http://127.0.0.1:3847/api/orchestration/craft-prompt with {task_description, agent_type, session_id, target_files, target_directories}\n2. Use returned crafted_prompt as Task prompt\n3. Use returned max_turns and model\n\nFor complex multi-step tasks: POST /api/orchestration/decompose first.\n\nRules:\n- NEVER launch a subagent without consulting DCM\n- ALWAYS specify target_files or target_directories\n- NEVER give broad prompts like 'scan entire codebase'"}}
HOOK_OUTPUT

# Create cache directory
mkdir -p "$CACHE_DIR"
cache_file="${CACHE_DIR}/${session_id}.json"

# If cache already exists for this session, skip (session already initialized)
if [[ -f "$cache_file" ]]; then
    exit 0
fi

# Helper function for API calls
api_post() {
    local endpoint="$1"
    local data="$2"
    curl -s -X POST "${API_URL}${endpoint}" \
        -H "Content-Type: application/json" \
        -d "$data" \
        --connect-timeout 2 \
        --max-time 5 2>/dev/null || echo "{}"
}

# Step 1: Create or get project
project_name=$(basename "$project_path")
project_result=$(api_post "/api/projects" "$(jq -n \
    --arg path "$project_path" \
    --arg name "$project_name" \
    '{path: $path, name: $name}')")

project_id=$(echo "$project_result" | jq -r '.project.id // .id // empty' 2>/dev/null || echo "")

if [[ -z "$project_id" ]]; then
    # Try to get existing project by path
    project_result=$(curl -s "${API_URL}/api/projects/by-path?path=$(echo "$project_path" | jq -sRr @uri)" \
        --connect-timeout 2 --max-time 5 2>/dev/null || echo "{}")
    project_id=$(echo "$project_result" | jq -r '.project.id // empty' 2>/dev/null || echo "")
fi

if [[ -z "$project_id" ]]; then
    # Cannot proceed without project
    exit 0
fi

# Step 2: Create session
api_post "/api/sessions" "$(jq -n \
    --arg id "$session_id" \
    --arg project_id "$project_id" \
    '{id: $id, project_id: $project_id}')" >/dev/null 2>&1 || true

# Step 3: Create initial request for this session
request_result=$(api_post "/api/requests" "$(jq -n \
    --arg project_id "$project_id" \
    --arg session_id "$session_id" \
    '{project_id: $project_id, session_id: $session_id, prompt: "Session started", prompt_type: "other", status: "active"}')")

request_id=$(echo "$request_result" | jq -r '.request.id // .id // empty' 2>/dev/null || echo "")

if [[ -z "$request_id" ]]; then
    exit 0
fi

# Step 4: Create initial task (wave 0) for agent subtasks
task_result=$(api_post "/api/tasks" "$(jq -n \
    --arg request_id "$request_id" \
    '{request_id: $request_id, name: "Agent Tasks", wave_number: 0, status: "running"}')")

task_id=$(echo "$task_result" | jq -r '.task.id // .id // empty' 2>/dev/null || echo "")

# Cache the IDs for track-agent.sh to use
if [[ -n "$task_id" ]]; then
    jq -n \
        --arg session_id "$session_id" \
        --arg project_id "$project_id" \
        --arg request_id "$request_id" \
        --arg task_id "$task_id" \
        --arg created_at "$(date -Iseconds)" \
        '{session_id: $session_id, project_id: $project_id, request_id: $request_id, task_id: $task_id, created_at: $created_at}' \
        > "$cache_file" 2>/dev/null || true
fi

exit 0
