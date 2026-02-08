#!/usr/bin/env bash
#
# monitor-context.sh - PostToolUse hook for proactive context snapshot
#
# Purpose: Monitor transcript size and trigger proactive snapshot before auto-compact
# Execution: PostToolUse (after every tool call, but full check every 10th call)
# Timeout: Must complete in < 2 seconds
#
set -uo pipefail

# Configuration
readonly API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
readonly COUNTER_FILE="/tmp/.dcm-monitor-counter"
readonly COOLDOWN_FILE="/tmp/.dcm-last-proactive"
readonly LOG_FILE="/tmp/dcm-monitor.log"
readonly CHECK_INTERVAL=10
readonly COOLDOWN_SECONDS=60
readonly THRESHOLD_YELLOW=512000  # 500KB in bytes
readonly THRESHOLD_RED=819200     # 800KB in bytes

# Logging helper
log_message() {
    local level="$1"
    shift
    printf "[%s] [%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$level" "$*" >> "$LOG_FILE" 2>/dev/null || true
}

# Read and validate input from stdin
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

# Extract fields with jq (fail silently if jq not available or invalid JSON)
session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
transcript_path=$(echo "$RAW_INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)
tool_name=$(echo "$RAW_INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# Exit if missing critical data
[[ -z "$session_id" ]] && exit 0
[[ -z "$transcript_path" ]] && exit 0
[[ ! -f "$transcript_path" ]] && exit 0

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

# Get transcript size in bytes
transcript_size=$(stat -f%z "$transcript_path" 2>/dev/null || stat -c%s "$transcript_path" 2>/dev/null || echo "0")

# Size-based actions
if (( transcript_size < THRESHOLD_YELLOW )); then
    # GREEN zone: do nothing
    exit 0
elif (( transcript_size < THRESHOLD_RED )); then
    # YELLOW zone: log warning
    log_message "WARN" "Session $session_id transcript at ${transcript_size} bytes (${tool_name})"
    exit 0
fi

# RED zone: check cooldown before triggering snapshot
if [[ -f "$COOLDOWN_FILE" ]]; then
    last_trigger=$(cat "$COOLDOWN_FILE" 2>/dev/null || echo "0")
    current_time=$(date +%s)
    elapsed=$((current_time - last_trigger))

    if (( elapsed < COOLDOWN_SECONDS )); then
        log_message "INFO" "Proactive snapshot skipped (cooldown: ${elapsed}s/${COOLDOWN_SECONDS}s)"
        exit 0
    fi
fi

# Extract context summary from last 50 lines of transcript
context_summary=""
if [[ -f "$transcript_path" ]]; then
    context_summary=$(tail -n 50 "$transcript_path" 2>/dev/null | head -c 500 || echo "")
fi

# Trigger proactive snapshot
log_message "ALERT" "Triggering proactive snapshot for session $session_id (${transcript_size} bytes)"

# Fire-and-forget API call with timeout
response=$(timeout 1.5s curl -s -X POST "${API_URL}/api/compact/save" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
        --arg sid "$session_id" \
        --arg trigger "proactive" \
        --arg summary "$context_summary" \
        '{session_id: $sid, trigger: $trigger, context_summary: $summary}')" \
    2>/dev/null || echo '{"status":"timeout"}')

# Update cooldown timestamp
date +%s > "$COOLDOWN_FILE" 2>/dev/null || true

# Log result
if echo "$response" | jq -e '.status == "success"' >/dev/null 2>&1; then
    log_message "INFO" "Proactive snapshot saved successfully"
else
    log_message "ERROR" "Proactive snapshot failed: $response"
fi

exit 0
