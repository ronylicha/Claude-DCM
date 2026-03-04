#!/usr/bin/env bash
# track-agent-turns.sh - PostToolUse hook: increment turn counter for running agents
# v1.0: Tracks tool calls per agent, warns at 80% capacity, flags at 100%
#
# Claude Code Hook: PostToolUse (matcher: *)
# Fires on every tool use, but only acts when inside a subagent (CLAUDE_AGENT_ID set)

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"

# Only track when running inside a subagent
agent_id="${CLAUDE_AGENT_ID:-}"
[[ -z "$agent_id" ]] && exit 0

# Rate limit: only track every 3rd call to reduce API load
COUNTER_FILE="/tmp/.dcm-turns-${agent_id}"
count=0
[[ -f "$COUNTER_FILE" ]] && count=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
count=$((count + 1))
echo "$count" > "$COUNTER_FILE" 2>/dev/null

# Only call API every 3rd tool use
(( count % 3 != 0 )) && exit 0

# Check circuit breaker
dcm_api_available || exit 0

# Track turn (fire-and-forget with fast timeout)
response=$(curl -s -X POST "${API_URL}/api/agents/track-turn" \
    -H "Content-Type: application/json" \
    -d "{\"agent_id\":\"${agent_id}\"}" \
    --connect-timeout 0.2 --max-time 0.3 2>/dev/null) || { dcm_api_failed; exit 0; }

dcm_api_success

# Check if we should warn
should_warn=$(echo "$response" | jq -r '.should_warn // false' 2>/dev/null)
should_stop=$(echo "$response" | jq -r '.should_stop // false' 2>/dev/null)
turns_used=$(echo "$response" | jq -r '.turns_used // 0' 2>/dev/null)
max_turns=$(echo "$response" | jq -r '.max_turns // "null"' 2>/dev/null)

if [[ "$should_stop" == "true" ]]; then
    cat <<EOF
{"hookSpecificOutput":{"systemMessage":"WARNING: Agent ${agent_id} has reached max_turns (${turns_used}/${max_turns}). Complete current work and return results immediately."}}
EOF
elif [[ "$should_warn" == "true" ]]; then
    cat <<EOF
{"hookSpecificOutput":{"systemMessage":"INFO: Agent ${agent_id} approaching turn limit (${turns_used}/${max_turns}). Start wrapping up."}}
EOF
fi

exit 0
