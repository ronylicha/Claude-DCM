#!/usr/bin/env bash
# track-agent.sh - Hook for tracking Claude Code Task tool usage (agent spawning)
# v3.1: Fixed agent_id uniqueness with UUID, atomic cache writes, registry error handling, description truncation
#
# Creates a subtask entry when an agent is spawned via the Task tool
# Auto-creates request->task chain if none exists for the session
# Fetches agent scope from registry for context injection

set -uo pipefail

# Load circuit breaker library
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

# Configuration
API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
CACHE_DIR="/tmp/.claude-context"

# Read hook data from stdin (Claude Code passes JSON via stdin)
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

# Extract fields from JSON
tool_name=$(echo "$RAW_INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
tool_input=$(echo "$RAW_INPUT" | jq -c '.tool_input // empty' 2>/dev/null)
session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
cwd=$(echo "$RAW_INPUT" | jq -r '.cwd // empty' 2>/dev/null)

# Only process Task tool calls
if [[ "$tool_name" != "Task" ]]; then
    exit 0
fi

# Exit silently if no session or input
if [[ -z "$session_id" || -z "$tool_input" ]]; then
    exit 0
fi

# Extract agent info from tool input
agent_type=$(echo "$tool_input" | jq -r '.subagent_type // empty' 2>/dev/null || echo "")
description=$(echo "$tool_input" | jq -r '.description // empty' 2>/dev/null || echo "")
run_in_background=$(echo "$tool_input" | jq -r '.run_in_background // false' 2>/dev/null || echo "false")

# Skip if no agent type (not a proper agent spawn)
if [[ -z "$agent_type" ]]; then
    exit 0
fi

# Check circuit breaker
if ! dcm_api_available; then
    exit 0
fi

# v3.2: Task chain creation + subtask creation moved to track-agent-start.sh (PreToolUse)
# This hook (PostToolUse) now only handles scope fetch + message publishing

# v3.0: Fetch agent scope from registry (best-effort, non-blocking)
scope_json=""
if dcm_api_available; then
    registry_response=$(timeout 1s curl -s "${API_URL}/api/registry/${agent_type}" \
        --connect-timeout 0.5 --max-time 1 2>/dev/null || echo "")

    if [[ -n "$registry_response" ]]; then
        scope_json=$(echo "$registry_response" | jq -c '.default_scope // empty' 2>/dev/null || echo "")
        dcm_api_success
    fi
fi

# Publish scope injection event (non-blocking)
if [[ -n "$scope_json" && "$scope_json" != "" && "$scope_json" != "null" ]]; then
    curl -s -X POST "${API_URL}/api/messages" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg from "system" \
            --arg agent_type "$agent_type" \
            '{from_agent: $from, topic: "agent.started", content: {agent_type: $agent_type, event: "scope_injected"}, priority: 2, ttl_seconds: 3600}')" \
        --connect-timeout 0.5 \
        --max-time 1 \
        >/dev/null 2>&1 &
fi

exit 0
