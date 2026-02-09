#!/usr/bin/env bash
# save-agent-result.sh - SubagentStop hook: save agent result to DCM
# v3.0: Added batch completion check + aggregation trigger
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

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
CACHE_DIR="/tmp/.claude-context"

# Read hook input from stdin
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

# Extract fields
session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
transcript_path=$(echo "$RAW_INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

[[ -z "$session_id" ]] && exit 0

# Try to extract the last subagent's result from the transcript
agent_type=""
agent_description=""
last_task_result=""

if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    # Get the last Task tool response (subagent result)
    last_task_result=$(tail -20 "$transcript_path" 2>/dev/null | \
        jq -r 'select(.type == "tool_result" and .tool_name == "Task") | .content // empty' 2>/dev/null | \
        tail -1 | head -c 1000 || echo "")

    # Get the last Task tool call to find agent info
    last_task_call=$(tail -30 "$transcript_path" 2>/dev/null | \
        jq -r 'select(.type == "tool_use" and .name == "Task") | .input // empty' 2>/dev/null | \
        tail -1 || echo "")

    agent_type=$(echo "$last_task_call" | jq -r '.subagent_type // empty' 2>/dev/null || echo "")
    agent_description=$(echo "$last_task_call" | jq -r '.description // empty' 2>/dev/null || echo "")
fi

# If we couldn't extract agent info, exit
[[ -z "$agent_type" ]] && exit 0

# Truncate result for storage
result_summary="${last_task_result:0:500}"

# Update the agent context in DCM
cache_file="${CACHE_DIR}/${session_id}.json"
project_id=""
if [[ -f "$cache_file" ]]; then
    project_id=$(jq -r '.project_id // empty' "$cache_file" 2>/dev/null)
fi

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

# Update any running subtasks for this agent to completed
subtask_id=""
batch_id=""

if [[ -n "$session_id" ]]; then
    subtasks_response=$(curl -s "${API_URL}/api/subtasks?agent_type=${agent_type}&status=running&limit=5" \
        --connect-timeout 1 --max-time 2 2>/dev/null || echo '{"subtasks":[]}')
    # Find the most recent running subtask for this agent type
    subtask_id=$(echo "$subtasks_response" | jq -r '[.subtasks[] | select(.status == "running")] | last | .id // empty' 2>/dev/null)
    # v3.0: Extract batch_id if present
    batch_id=$(echo "$subtasks_response" | jq -r '[.subtasks[] | select(.status == "running")] | last | .batch_id // empty' 2>/dev/null)
fi

# Fallback: any running subtask of this agent_type
if [[ -z "$subtask_id" ]]; then
    subtasks_response=$(curl -s "${API_URL}/api/subtasks?agent_type=${agent_type}&status=running&limit=1" \
        --connect-timeout 1 --max-time 2 2>/dev/null || echo '{"subtasks":[]}')
    subtask_id=$(echo "$subtasks_response" | jq -r '.subtasks[0].id // empty' 2>/dev/null)
    batch_id=$(echo "$subtasks_response" | jq -r '.subtasks[0].batch_id // empty' 2>/dev/null)
fi

# Complete ALL running subtasks of this agent_type (not just the last one)
if [[ -n "$subtask_id" ]]; then
    # Get all running subtask IDs for this agent type
    all_running=$(curl -s "${API_URL}/api/subtasks?agent_type=${agent_type}&status=running&limit=50" \
        --connect-timeout 1 --max-time 2 2>/dev/null || echo '{"subtasks":[]}')
    all_ids=$(echo "$all_running" | jq -r '.subtasks[].id // empty' 2>/dev/null)

    if [[ -n "$all_ids" ]]; then
        for sid in $all_ids; do
            curl -s -X PATCH "${API_URL}/api/subtasks/${sid}" \
                -H "Content-Type: application/json" \
                -d "$(jq -n --arg summary "$result_summary" '{status: "completed", result: {summary: $summary}}')" \
                --connect-timeout 1 \
                --max-time 3 >/dev/null 2>&1 &
        done
    fi
fi

# v3.0: Check if this completes a batch and trigger aggregation
if [[ -n "$batch_id" && "$batch_id" != "null" && "$batch_id" != "" ]]; then
    # Trigger batch completion check (fire-and-forget)
    curl -s -X POST "${API_URL}/api/orchestration/batch/${batch_id}/complete" \
        -H "Content-Type: application/json" \
        --connect-timeout 1 \
        --max-time 3 >/dev/null 2>&1 &
fi

wait 2>/dev/null || true
exit 0
