#!/usr/bin/env bash
# pre-compact-save.sh - PreCompact hook: save context snapshot to DCM before compact
# v3.1: Fixed jq extraction, UTF-8 truncation, cumulative timeout reduction
#
# Claude Code Hook: PreCompact (matcher: auto|manual)
#
# Saves the current session state (active tasks, modified files, key decisions)
# to DCM so it can be restored after compact via post-compact-restore.sh
#
# Input: JSON via stdin with session_id, transcript_path, trigger
# Output: None (fire-and-forget, must complete in <5s)

set -uo pipefail

# Load circuit breaker library
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
CACHE_DIR="/tmp/.claude-context"

# Read hook input from stdin
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

# Extract fields
session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
transcript_path=$(echo "$RAW_INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
trigger=$(echo "$RAW_INPUT" | jq -r '.trigger // "auto"' 2>/dev/null)

[[ -z "$session_id" ]] && exit 0

# Check circuit breaker
if ! dcm_api_available; then
    exit 0
fi

# Build snapshot data from multiple sources
active_tasks="[]"
modified_files="[]"
key_decisions="[]"
agent_states="[]"
context_summary=""

# 1. Get active tasks from DCM (reduced timeout: 1.5s max)
tasks_response=$(curl -s "${API_URL}/api/subtasks?status=running&limit=20" \
    --connect-timeout 0.5 --max-time 1.5 2>/dev/null || echo '{"subtasks":[]}')

# Simplified jq extraction for active_tasks
active_tasks=$(echo "$tasks_response" | jq -c '[.subtasks[]? | {
    id: .id,
    description: (.description // "")[0:100],
    status: .status,
    agent_type: .agent_type
}] // []' 2>/dev/null || echo "[]")

# 2. Get recent actions to find modified files (reduced timeout: 1.5s max)
actions_response=$(curl -s "${API_URL}/api/actions?limit=50&session_id=${session_id}" \
    --connect-timeout 0.5 --max-time 1.5 2>/dev/null || echo '{"actions":[]}')

# Simplified jq extraction for file_paths
modified_files=$(echo "$actions_response" | jq -c '[
    .actions[]? | 
    select(.tool_name == "Edit" or .tool_name == "Write") | 
    .file_paths[]?
] | unique // []' 2>/dev/null || echo "[]")

# 3. Get agent states from agent_contexts (reduced timeout: 1.5s max)
agents_response=$(curl -s "${API_URL}/api/agent-contexts?limit=20" \
    --connect-timeout 0.5 --max-time 1.5 2>/dev/null || echo '{"contexts":[]}')

agent_states=$(echo "$agents_response" | jq -c '[.contexts[]? | {
    agent_id: .agent_id,
    agent_type: .agent_type,
    status: (.role_context.status // "unknown"),
    summary: (.progress_summary // "")[0:100]
}] // []' 2>/dev/null || echo "[]")

# 4. Extract summary from transcript (last few assistant messages)
# Fix UTF-8 truncation: use head -c with character boundary awareness
if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    # Get last 5 assistant messages for summary, truncate safely
    context_summary=$(tail -50 "$transcript_path" 2>/dev/null | \
        jq -rs '[.[]? | select(.role == "assistant") | .content // ""] | .[-5:] | join(" ")' 2>/dev/null | \
        head -c 500 || echo "")
    
    # Fallback: if jq fails, try simple extraction
    if [[ -z "$context_summary" ]]; then
        context_summary=$(tail -50 "$transcript_path" 2>/dev/null | \
            grep -o '"content":[[:space:]]*"[^"]*"' | \
            tail -5 | head -c 500 || echo "")
    fi
fi

# 5. Read cached session data
cache_file="${CACHE_DIR}/${session_id}.json"
cached_project_id=""
if [[ -f "$cache_file" ]]; then
    cached_project_id=$(jq -r '.project_id // empty' "$cache_file" 2>/dev/null)
fi

# POST snapshot to DCM (final timeout: 1.5s max)
payload=$(jq -n \
    --arg session_id "$session_id" \
    --arg trigger "$trigger" \
    --arg context_summary "$context_summary" \
    --argjson active_tasks "$active_tasks" \
    --argjson modified_files "$modified_files" \
    --argjson agent_states "$agent_states" \
    --argjson key_decisions "$key_decisions" \
    '{
        session_id: $session_id,
        trigger: $trigger,
        context_summary: $context_summary,
        active_tasks: $active_tasks,
        modified_files: $modified_files,
        key_decisions: $key_decisions,
        agent_states: $agent_states
    }')

save_result=$(curl -s -X POST "${API_URL}/api/compact/save" \
    -H "Content-Type: application/json" \
    -d "$payload" \
    --connect-timeout 0.5 \
    --max-time 1.5 2>/dev/null || echo "")

if [[ -n "$save_result" ]]; then
    dcm_api_success
else
    dcm_api_failed
fi

exit 0
