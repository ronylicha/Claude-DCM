#!/usr/bin/env bash
# relaunch-agent.sh - SubagentStop hook: detect max_turns exhaustion and trigger relaunch
# v1.0: Checks if agent stopped due to turn limit, prepares relaunch with compacted context
#
# Claude Code Hook: SubagentStop
# Output: additionalContext with relaunch instructions if applicable

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"

# Read hook input from stdin
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
transcript_path=$(echo "$RAW_INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

[[ -z "$session_id" ]] && exit 0

# Check circuit breaker
dcm_api_available || exit 0

# Extract the agent info from transcript
agent_type=""
agent_id=""
last_result=""

if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    # Get the last Task tool call to find agent info
    last_task_input=$(jq -s '[.[] | select(.type == "tool_use" and .name == "Task")] | last | .input // {}' \
        "$transcript_path" 2>/dev/null || echo "{}")

    agent_type=$(echo "$last_task_input" | jq -r '.subagent_type // empty' 2>/dev/null || echo "")

    # Get last Task result for partial context
    last_result=$(jq -s '[.[] | select(.type == "tool_result" and .tool_name == "Task")] | last | .content // empty' \
        "$transcript_path" 2>/dev/null | head -c 1500 || echo "")
fi

[[ -z "$agent_type" ]] && exit 0

# Find the agent's subtask to check turn status
subtask_response=$(curl -s "${API_URL}/api/subtasks?agent_type=${agent_type}&status=running&limit=1" \
    --connect-timeout 0.3 --max-time 0.5 2>/dev/null || echo '{"subtasks":[]}')

agent_id=$(echo "$subtask_response" | jq -r '.subtasks[0].agent_id // empty' 2>/dev/null)
[[ -z "$agent_id" ]] && exit 0

# Check agent status
status_response=$(curl -s "${API_URL}/api/agents/${agent_id}/status" \
    --connect-timeout 0.3 --max-time 0.5 2>/dev/null || echo '{}')

turns_used=$(echo "$status_response" | jq -r '.agent.turns_used // 0' 2>/dev/null)
max_turns=$(echo "$status_response" | jq -r '.agent.max_turns // "null"' 2>/dev/null)

# Only relaunch if agent hit max_turns (not just normal completion)
if [[ "$max_turns" == "null" || -z "$max_turns" ]]; then
    exit 0
fi

if (( turns_used < max_turns )); then
    # Agent completed normally before hitting limit
    exit 0
fi

# Agent exhausted its turns — attempt relaunch
relaunch_response=$(curl -s -X POST "${API_URL}/api/agents/relaunch" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg agent_id "$agent_id" --arg partial "$last_result" \
        '{agent_id: $agent_id, partial_result: $partial}')" \
    --connect-timeout 0.3 --max-time 0.5 2>/dev/null || echo '{}')

dcm_api_success

should_relaunch=$(echo "$relaunch_response" | jq -r '.should_relaunch // false' 2>/dev/null)

if [[ "$should_relaunch" == "true" ]]; then
    retry_count=$(echo "$relaunch_response" | jq -r '.retry_count // 0' 2>/dev/null)
    relaunch_prompt=$(echo "$relaunch_response" | jq -r '.relaunch_prompt // empty' 2>/dev/null)
    original_agent_type=$(echo "$relaunch_response" | jq -r '.agent_type // empty' 2>/dev/null)
    relaunch_max_turns=$(echo "$relaunch_response" | jq -r '.max_turns // "null"' 2>/dev/null)

    # Escape for JSON
    escaped_prompt=$(echo "$relaunch_prompt" | jq -Rs '.' 2>/dev/null)

    cat <<EOF
{"hookSpecificOutput":{"additionalContext":"RELAUNCH REQUIRED: Agent ${original_agent_type} exhausted its turn budget (attempt ${retry_count}/3). Relaunch with: subagent_type=${original_agent_type}, max_turns=${relaunch_max_turns}, prompt=${escaped_prompt}"}}
EOF
else
    reason=$(echo "$relaunch_response" | jq -r '.reason // "unknown"' 2>/dev/null)
    original_desc=$(echo "$relaunch_response" | jq -r '.description // empty' 2>/dev/null)

    cat <<EOF
{"hookSpecificOutput":{"additionalContext":"AGENT FAILED: Agent ${agent_type} failed after 3 attempts. Reason: ${reason}. Original task: ${original_desc}. Manual intervention required."}}
EOF
fi

# Cleanup counter file
rm -f "/tmp/.dcm-turns-${agent_id}" 2>/dev/null

exit 0
