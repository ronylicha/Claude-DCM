#!/usr/bin/env bash
#
# monitor-context.sh - PostToolUse hook for proactive context management
#
# v3.1: Uses combined /api/context/health endpoint (1 HTTP call instead of 3).
# Reduced CHECK_INTERVAL to 5. Outputs systemMessage JSON for yellow+.
# Blocks Claude on red/critical with decision:block.
#
# Execution: PostToolUse (after every tool call, full check every 5th call)
# Timeout: Must complete in < 2 seconds
#
set -uo pipefail

# Configuration
readonly API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
readonly COUNTER_FILE="/tmp/.dcm-monitor-counter"
readonly LOG_FILE="/tmp/dcm-monitor.log"
readonly CHECK_INTERVAL=5

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

# Query combined health endpoint (1 call instead of 3)
agent_id="${AGENT_ID:-$session_id}"
health_response=$(timeout 1.5s curl -s "${API_URL}/api/context/health/${agent_id}" \
    --connect-timeout 1 \
    --max-time 1.5 2>/dev/null || echo "")

# If API unreachable, output systemMessage
if [[ -z "$health_response" ]]; then
    log_message "ERROR" "DCM API unreachable at ${API_URL}"
    printf '{"systemMessage":"[DCM Monitor] DCM instance disconnected. Context tracking unavailable."}'
    exit 0
fi

# Parse combined response
zone=$(echo "$health_response" | jq -r '.capacity.zone // "green"' 2>/dev/null)
should_compact=$(echo "$health_response" | jq -r '.shouldCompact // false' 2>/dev/null)
usage_percent=$(echo "$health_response" | jq -r '.capacity.usage_percent // 0' 2>/dev/null)
minutes_remaining=$(echo "$health_response" | jq -r '.capacity.minutes_remaining // "unknown"' 2>/dev/null)
recommendation=$(echo "$health_response" | jq -r '.recommendation.message // ""' 2>/dev/null)

# Zone-based actions with systemMessage output
case "$zone" in
    green)
        exit 0
        ;;
    yellow)
        log_message "WARN" "Agent $agent_id at ${usage_percent}% capacity (${zone}), ~${minutes_remaining} remaining"
        printf '{"systemMessage":"[DCM Monitor] %s"}' "$recommendation"
        exit 0
        ;;
    orange)
        log_message "WARN" "Agent $agent_id at ${usage_percent}% capacity (${zone})"
        if [[ "$should_compact" == "true" ]]; then
            # Proactive save
            timeout 1.5s curl -s -X POST "${API_URL}/api/compact/save" \
                -H "Content-Type: application/json" \
                -d "$(jq -n \
                    --arg sid "$session_id" \
                    --arg trigger "proactive" \
                    --arg summary "Monitor proactive save at ${usage_percent}% (${zone})" \
                    '{session_id: $sid, trigger: $trigger, context_summary: $summary}')" \
                2>/dev/null >/dev/null || true
            log_message "INFO" "Proactive save triggered for $agent_id"
        fi
        printf '{"systemMessage":"[DCM Monitor] %s"}' "$recommendation"
        exit 0
        ;;
    red|critical)
        log_message "ALERT" "Agent $agent_id at ${usage_percent}% capacity (${zone}) - CRITICAL"

        # Always proactive save at red/critical
        timeout 1.5s curl -s -X POST "${API_URL}/api/compact/save" \
            -H "Content-Type: application/json" \
            -d "$(jq -n \
                --arg sid "$session_id" \
                --arg trigger "proactive" \
                --arg summary "Monitor CRITICAL save at ${usage_percent}% (${zone})" \
                '{session_id: $sid, trigger: $trigger, context_summary: $summary}')" \
            2>/dev/null >/dev/null || true

        # Reset capacity
        timeout 1s curl -s -X POST "${API_URL}/api/capacity/${agent_id}/reset" \
            -H "Content-Type: application/json" \
            2>/dev/null >/dev/null || true

        log_message "INFO" "Proactive save + capacity reset for $agent_id"

        # Block Claude to force /compact
        printf '{"decision":"block","reason":"[DCM Monitor] Context at %d%% (%s zone). State saved. Run /compact NOW."}' "$usage_percent" "$zone"
        exit 0
        ;;
    *)
        exit 0
        ;;
esac
