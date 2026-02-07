#!/usr/bin/env bash
# track-session.sh - Hook for tracking Claude Code session start
# Creates: project -> session -> request -> task (for subtasks)
#
# Environment variables from Claude Code:
#   SESSION_ID   - Current session ID
#   PROJECT_DIR  - Current project path (cwd)

set -euo pipefail

# Configuration
API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
CACHE_DIR="/tmp/.claude-context"

# Get session info
session_id="${SESSION_ID:-}"
project_path="${PROJECT_DIR:-$(pwd)}"

# Exit silently if no session
if [[ -z "$session_id" ]]; then
    exit 0
fi

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
project_result=$(api_post "/api/projects" "{
    \"path\": \"$project_path\",
    \"name\": \"$project_name\"
}")

project_id=$(echo "$project_result" | jq -r '.project.id // empty' 2>/dev/null || echo "")

if [[ -z "$project_id" ]]; then
    # Try to get existing project
    project_result=$(curl -s "${API_URL}/api/projects/by-path?path=$(echo "$project_path" | jq -sRr @uri)" \
        --connect-timeout 2 --max-time 5 2>/dev/null || echo "{}")
    project_id=$(echo "$project_result" | jq -r '.project.id // empty' 2>/dev/null || echo "")
fi

if [[ -z "$project_id" ]]; then
    # Cannot proceed without project
    exit 0
fi

# Step 2: Create session
session_result=$(api_post "/api/sessions" "{
    \"id\": \"$session_id\",
    \"project_id\": \"$project_id\"
}")

# Step 3: Create initial request for this session
request_result=$(api_post "/api/requests" "{
    \"project_id\": \"$project_id\",
    \"session_id\": \"$session_id\",
    \"prompt\": \"Session started\",
    \"prompt_type\": \"other\",
    \"status\": \"active\"
}")

request_id=$(echo "$request_result" | jq -r '.request.id // empty' 2>/dev/null || echo "")

if [[ -z "$request_id" ]]; then
    exit 0
fi

# Step 4: Create initial task (wave 0) for agent subtasks
task_result=$(api_post "/api/tasks" "{
    \"request_id\": \"$request_id\",
    \"name\": \"Agent Tasks\",
    \"wave_number\": 0,
    \"status\": \"running\"
}")

task_id=$(echo "$task_result" | jq -r '.task.id // empty' 2>/dev/null || echo "")

# Cache the IDs for track-agent.sh to use
if [[ -n "$task_id" ]]; then
    cat > "$cache_file" <<EOF
{
    "session_id": "$session_id",
    "project_id": "$project_id",
    "request_id": "$request_id",
    "task_id": "$task_id",
    "created_at": "$(date -Iseconds)"
}
EOF
fi

exit 0
