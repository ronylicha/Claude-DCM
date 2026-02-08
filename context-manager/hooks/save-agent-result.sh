#!/usr/bin/env bash
# save-agent-result.sh - SubagentStop hook: save agent result to DCM
# Claude Code Hook: SubagentStop
#
# When a subagent finishes, save its result summary to DCM
# so other agents can access it via the context API.
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
# The transcript is a JSONL file - find the most recent Task tool result
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
# Find the subtask for this agent and mark it as completed
cache_file="${CACHE_DIR}/${session_id}.json"
project_id=""
if [[ -f "$cache_file" ]]; then
    project_id=$(jq -r '.project_id // empty' "$cache_file" 2>/dev/null)
fi

# Save/update agent context
payload=$(jq -n \
    --arg agent_id "$agent_type" \
    --arg agent_type "$agent_type" \
    --arg project_id "$project_id" \
    --arg summary "$result_summary" \
    --arg description "$agent_description" \
    '{
        agent_id: $agent_id,
        agent_type: $agent_type,
        project_id: (if $project_id == "" then null else $project_id end),
        role_context: {
            status: "completed",
            description: $description,
            completed_at: (now | todate)
        },
        progress_summary: $summary
    }')

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

# Fire both requests in parallel
curl -s -X POST "${API_URL}/api/messages" \
    -H "Content-Type: application/json" \
    -d "$msg_payload" \
    --connect-timeout 1 \
    --max-time 2 >/dev/null 2>&1 &

# Update any running subtasks for this agent to completed
subtasks_response=$(curl -s "${API_URL}/api/subtasks?agent_type=${agent_type}&status=running&limit=1" \
    --connect-timeout 1 --max-time 2 2>/dev/null || echo '{"subtasks":[]}')
subtask_id=$(echo "$subtasks_response" | jq -r '.subtasks[0].id // empty' 2>/dev/null)

if [[ -n "$subtask_id" ]]; then
    curl -s -X PATCH "${API_URL}/api/subtasks/${subtask_id}" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg summary "$result_summary" '{status: "completed", result: {summary: $summary}}')" \
        --connect-timeout 1 \
        --max-time 2 >/dev/null 2>&1 &
fi

wait 2>/dev/null || true
exit 0
