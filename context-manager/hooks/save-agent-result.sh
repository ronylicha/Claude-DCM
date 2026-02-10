#!/usr/bin/env bash
# save-agent-result.sh - SubagentStop hook: save agent result to DCM
# v3.1: Fixed transcript extraction with jq slurp, atomic API call, removed unused project_id
#
# Claude Code Hook: SubagentStop
#
# When a subagent finishes, save its result summary to DCM
# so other agents can access it via the context API.
# v3.0: Also checks if this completes a batch and triggers aggregation.
#
# Input: JSON via stdin with session_id, transcript_path, stop_hook_active
# Output: None (fire-and-forget)

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

[[ -z "$session_id" ]] && exit 0

# Check circuit breaker
if ! dcm_api_available; then
    exit 0
fi

# Try to extract the last subagent's result from the transcript
agent_type=""
agent_description=""
last_task_result=""

if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    # Use jq slurp mode for robust parsing of JSONL transcript
    # Get the last Task tool result
    last_task_result=$(jq -s '[.[] | select(.type == "tool_result" and .tool_name == "Task")] | last | .content // empty' \
        "$transcript_path" 2>/dev/null | head -c 1000 || echo "")

    # Get the last Task tool call to find agent info
    last_task_input=$(jq -s '[.[] | select(.type == "tool_use" and .name == "Task")] | last | .input // {}' \
        "$transcript_path" 2>/dev/null || echo "{}")

    agent_type=$(echo "$last_task_input" | jq -r '.subagent_type // empty' 2>/dev/null || echo "")
    agent_description=$(echo "$last_task_input" | jq -r '.description // empty' 2>/dev/null || echo "")
fi

# If we couldn't extract agent info, exit
[[ -z "$agent_type" ]] && exit 0

# Truncate result for storage
result_summary="${last_task_result:0:500}"

# Post as a message so other agents can pick it up
msg_payload=$(jq -n \
    --arg from "$agent_type" \
    --arg topic "agent.completed" \
    --arg summary "$result_summary" \
    --arg description "$agent_description" \
    '{
        from_agent_id: $from,
        to_agent_id: null,
        message_type: "agent.completed",
        topic: "agent.completed",
        payload: {
            agent_type: $from,
            description: $description,
            result_summary: $summary
        },
        priority: 3
    }')

# Fire message post in background
curl -s -X POST "${API_URL}/api/messages" \
    -H "Content-Type: application/json" \
    -d "$msg_payload" \
    --connect-timeout 1 \
    --max-time 2 >/dev/null 2>&1 &

# Get running subtasks for this agent type in a single call (atomic)
subtasks_response=""
if dcm_api_available; then
    subtasks_response=$(curl -s "${API_URL}/api/subtasks?agent_type=${agent_type}&status=running&limit=50" \
        --connect-timeout 1 --max-time 2 2>/dev/null || echo '{"subtasks":[]}')
    
    if [[ -n "$subtasks_response" ]]; then
        dcm_api_success
    else
        dcm_api_failed
    fi
fi

# Extract all running subtask IDs and batch_id (single pass)
all_ids=$(echo "$subtasks_response" | jq -r '.subtasks[].id // empty' 2>/dev/null)
batch_id=$(echo "$subtasks_response" | jq -r '[.subtasks[] | select(.batch_id != null)] | first | .batch_id // empty' 2>/dev/null)

# Complete ALL running subtasks of this agent_type
if [[ -n "$all_ids" ]]; then
    # Fix loop quoting: use proper quoting for variable expansion
    while IFS= read -r sid; do
        [[ -z "$sid" ]] && continue
        curl -s -X PATCH "${API_URL}/api/subtasks/${sid}" \
            -H "Content-Type: application/json" \
            -d "$(jq -n --arg summary "$result_summary" '{status: "completed", result: {summary: $summary}}')" \
            --connect-timeout 1 \
            --max-time 3 >/dev/null 2>&1 &
    done <<< "$all_ids"
fi

# v3.0: Check if this completes a batch and trigger aggregation
if [[ -n "$batch_id" && "$batch_id" != "null" && "$batch_id" != "" ]]; then
    # Trigger batch completion check (fire-and-forget)
    curl -s -X POST "${API_URL}/api/orchestration/batch/${batch_id}/complete" \
        -H "Content-Type: application/json" \
        --connect-timeout 1 \
        --max-time 3 >/dev/null 2>&1 &
fi

exit 0
