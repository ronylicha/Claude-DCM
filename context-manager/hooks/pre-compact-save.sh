#!/usr/bin/env bash
# pre-compact-save.sh - PreCompact hook: save context snapshot to DCM before compact
# v3.2: Enhanced key_decisions extraction, 3000 char summary, wave_state, wider task filter
#
# Claude Code Hook: PreCompact (matcher: auto|manual)
#
# Saves the current session state (active tasks, modified files, key decisions, wave state)
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
wave_state="{}"
compact_summary=""

# 1. Get active tasks from DCM — wider filter: running, pending, blocked
tasks_response=$(curl -s "${API_URL}/api/subtasks?status=running&limit=20" \
    --connect-timeout 0.5 --max-time 1.5 2>/dev/null || echo '{"subtasks":[]}')
pending_response=$(curl -s "${API_URL}/api/subtasks?status=pending&limit=10" \
    --connect-timeout 0.5 --max-time 1 2>/dev/null || echo '{"subtasks":[]}')
blocked_response=$(curl -s "${API_URL}/api/subtasks?status=blocked&limit=10" \
    --connect-timeout 0.5 --max-time 1 2>/dev/null || echo '{"subtasks":[]}')

# Merge all tasks
active_tasks=$(echo "$tasks_response" "$pending_response" "$blocked_response" | \
    jq -sc '[.[].subtasks[]?] | unique_by(.id) | [.[] | {
    id: .id,
    description: (.description // "")[0:150],
    status: .status,
    agent_type: .agent_type,
    parent_agent_id: .parent_agent_id
}] // []' 2>/dev/null || echo "[]")

# 2. Get recent actions to find modified files
actions_response=$(curl -s "${API_URL}/api/actions?limit=50&session_id=${session_id}" \
    --connect-timeout 0.5 --max-time 1.5 2>/dev/null || echo '{"actions":[]}')

modified_files=$(echo "$actions_response" | jq -c '[
    .actions[]? |
    select(.tool_name == "Edit" or .tool_name == "Write") |
    .file_paths[]?
] | unique // []' 2>/dev/null || echo "[]")

# 3. Get agent states from agent_contexts
agents_response=$(curl -s "${API_URL}/api/agent-contexts?limit=20" \
    --connect-timeout 0.5 --max-time 1.5 2>/dev/null || echo '{"contexts":[]}')

agent_states=$(echo "$agents_response" | jq -c '[.contexts[]? | {
    agent_id: .agent_id,
    agent_type: .agent_type,
    status: (.role_context.status // "unknown"),
    summary: (.progress_summary // "")[0:150]
}] // []' 2>/dev/null || echo "[]")

# 4. Extract context_summary from transcript — 3000 chars, last 15 assistant messages
if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    context_summary=$(tail -100 "$transcript_path" 2>/dev/null | \
        jq -rs '[.[]? | select(.role == "assistant") | .content // ""] | .[-15:] | join("\n\n---\n\n")' 2>/dev/null | \
        head -c 3000 || echo "")

    if [[ -z "$context_summary" ]]; then
        context_summary=$(tail -100 "$transcript_path" 2>/dev/null | \
            grep -o '"content":[[:space:]]*"[^"]*"' | \
            tail -15 | head -c 3000 || echo "")
    fi
fi

# 5. Extract key_decisions from transcript
if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    key_decisions=$(tail -200 "$transcript_path" 2>/dev/null | \
        jq -rs '[.[]? | select(.role == "assistant") | .content // ""] | join("\n")' 2>/dev/null | \
        grep -iE "(decided|chosen|will use|architecture|approche|strategy|pattern|selected|opted for|going with)" | \
        head -20 | \
        jq -R -s 'split("\n") | map(select(length > 5)) | map(.[0:200]) | .[0:10]' 2>/dev/null || echo "[]")

    [[ "$key_decisions" == "null" || -z "$key_decisions" ]] && key_decisions="[]"
fi

# 6. Get wave state for this session
wave_current=$(curl -s "${API_URL}/api/waves/${session_id}/current" \
    --connect-timeout 0.5 --max-time 1 2>/dev/null || echo "{}")
wave_history=$(curl -s "${API_URL}/api/waves/${session_id}/history" \
    --connect-timeout 0.5 --max-time 1 2>/dev/null || echo "[]")

wave_state=$(jq -n \
    --argjson current "$wave_current" \
    --argjson history "$wave_history" \
    '{current: $current, history: $history}' 2>/dev/null || echo "{}")

# 7. Read cached session data
cache_file="${CACHE_DIR}/${session_id}.json"
cached_project_id=""
if [[ -f "$cache_file" ]]; then
    cached_project_id=$(jq -r '.project_id // empty' "$cache_file" 2>/dev/null)
fi

# Use session-scoped agent_id
agent_id="session-${session_id}"

# POST snapshot to DCM
payload=$(jq -n \
    --arg session_id "$session_id" \
    --arg trigger "$trigger" \
    --arg context_summary "$context_summary" \
    --argjson active_tasks "$active_tasks" \
    --argjson modified_files "$modified_files" \
    --argjson agent_states "$agent_states" \
    --argjson key_decisions "$key_decisions" \
    --argjson wave_state "$wave_state" \
    '{
        session_id: $session_id,
        trigger: $trigger,
        context_summary: $context_summary,
        active_tasks: $active_tasks,
        modified_files: $modified_files,
        key_decisions: $key_decisions,
        agent_states: $agent_states,
        wave_state: $wave_state
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
