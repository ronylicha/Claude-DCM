#!/usr/bin/env bash
#
# monitor-context.sh - PostToolUse hook for proactive context management
#
# v3.0: Replaced stat-based transcript size check with API-based capacity tracking.
# Queries DCM predictive capacity endpoint instead of raw file size.
#
# Execution: PostToolUse (after every tool call, full check every 10th call)
# Timeout: Must complete in < 2 seconds
#
set -uo pipefail

# Configuration
readonly API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
readonly COUNTER_FILE="/tmp/.dcm-monitor-counter"
readonly COOLDOWN_FILE="/tmp/.dcm-last-proactive"
readonly LOG_FILE="/tmp/dcm-monitor.log"
readonly CHECK_INTERVAL=10
readonly COOLDOWN_SECONDS=120

# Logging helper
log_message() {
    local level="$1"
    shift
    printf "[%s] [%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$level" "$*" >> "$LOG_FILE" 2>/dev/null || true
}

# Read and validate input from stdin
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

# Extract fields with jq
session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
tool_name=$(echo "$RAW_INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# Exit if missing critical data
[[ -z "$session_id" ]] && exit 0

# Counter mechanism: increment and check modulo
current_count=0
if [[ -f "$COUNTER_FILE" ]]; then
    current_count=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
fi
next_count=$((current_count + 1))
echo "$next_count" > "$COUNTER_FILE" 2>/dev/null || exit 0

# Only run full check every Nth call
if (( next_count % CHECK_INTERVAL != 0 )); then
    exit 0
fi

# Query DCM capacity API for this agent (use session_id as agent_id for orchestrator)
agent_id="${AGENT_ID:-$session_id}"
capacity_response=$(timeout 1.5s curl -s "${API_URL}/api/capacity/${agent_id}" \
    --connect-timeout 1 \
    --max-time 1.5 2>/dev/null || echo "")

# If API unreachable, exit silently
[[ -z "$capacity_response" ]] && exit 0

# Parse response
zone=$(echo "$capacity_response" | jq -r '.zone // "green"' 2>/dev/null)
should_intervene=$(echo "$capacity_response" | jq -r '.shouldIntervene // false' 2>/dev/null)
usage_percent=$(echo "$capacity_response" | jq -r '.usage_percent // 0' 2>/dev/null)
minutes_remaining=$(echo "$capacity_response" | jq -r '.minutes_remaining // "unknown"' 2>/dev/null)

# Zone-based actions
case "$zone" in
    green)
        exit 0
        ;;
    yellow)
        log_message "WARN" "Agent $agent_id at ${usage_percent}% capacity (${zone}), ~${minutes_remaining} remaining"
        exit 0
        ;;
    orange|red|critical)
        # Check if intervention is recommended by API (includes cooldown check)
        if [[ "$should_intervene" != "true" ]]; then
            log_message "INFO" "Agent $agent_id at ${usage_percent}% (${zone}) but intervention skipped (cooldown)"
            exit 0
        fi
        ;;
    *)
        exit 0
        ;;
esac

# Trigger proactive compact
log_message "ALERT" "Triggering proactive compact for agent $agent_id (${usage_percent}% - ${zone})"

# Fire-and-forget API call
response=$(timeout 1.5s curl -s -X POST "${API_URL}/api/compact/save" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
        --arg sid "$session_id" \
        --arg trigger "proactive" \
        --arg summary "Proactive save at ${usage_percent}% capacity (${zone} zone)" \
        '{session_id: $sid, trigger: $trigger, context_summary: $summary}')" \
    2>/dev/null || echo '{"status":"timeout"}')

# Reset capacity after proactive compact
timeout 1s curl -s -X POST "${API_URL}/api/capacity/${agent_id}/reset" \
    -H "Content-Type: application/json" \
    2>/dev/null || true

# Publish proactive compact event
timeout 1s curl -s -X POST "${API_URL}/api/tokens/track" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
        --arg agent_id "$agent_id" \
        --arg session_id "$session_id" \
        '{agent_id: $agent_id, session_id: $session_id, tool_name: "proactive-compact", input_size: 0, output_size: 0}')" \
    2>/dev/null || true

# Log result
if echo "$response" | jq -e '.success == true' >/dev/null 2>&1; then
    log_message "INFO" "Proactive compact saved successfully for $agent_id"
else
    log_message "ERROR" "Proactive compact failed for $agent_id: $response"
fi

exit 0
