#!/usr/bin/env bash
#
# context-guardian.sh - Ultra-lightweight PostToolUse hook (EVERY tool call)
#
# Checks transcript file size locally (no HTTP = <10ms).
# Only calls API when thresholds exceeded or to verify DCM alive (cached 60s).
#
# Execution: PostToolUse (every tool call, matcher: *)
# Timeout: 2s
#
set -uo pipefail

# Configuration
readonly API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
readonly HEALTH_CACHE="/tmp/.dcm-health-cache"
readonly HEALTH_CACHE_TTL=60  # seconds
readonly LOG_FILE="/tmp/dcm-guardian.log"

# Thresholds in bytes
readonly THRESHOLD_YELLOW=$((500 * 1024))   # 500KB
readonly THRESHOLD_ORANGE=$((750 * 1024))   # 750KB
readonly THRESHOLD_RED=$((1024 * 1024))     # 1MB

# Logging helper
log_message() {
    local level="$1"
    shift
    printf "[%s] [%s] %s\n" "$(date '+%Y-%m-%d %H:%M:%S')" "$level" "$*" >> "$LOG_FILE" 2>/dev/null || true
}

# Read stdin
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

# Extract fields
session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
transcript_path=$(echo "$RAW_INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

[[ -z "$session_id" ]] && exit 0

# --- Layer 1: Local transcript size check (0ms, no HTTP) ---

if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    # stat -c%s for Linux, stat -f%z for macOS
    size_bytes=$(stat -c%s "$transcript_path" 2>/dev/null || stat -f%z "$transcript_path" 2>/dev/null || echo "0")
    size_kb=$((size_bytes / 1024))

    if (( size_bytes >= THRESHOLD_RED )); then
        # RED: >1MB - systemMessage + proactive save
        log_message "ALERT" "Transcript ${size_kb}KB (RED) - triggering proactive save"

        # Output systemMessage to Claude
        printf '{"systemMessage":"[DCM Guardian] Context at %dKB (>1MB). Run /compact NOW to avoid context loss."}' "$size_kb"

        # Fire-and-forget: proactive save
        timeout 1.5s curl -s -X POST "${API_URL}/api/compact/save" \
            -H "Content-Type: application/json" \
            -d "$(jq -n \
                --arg sid "$session_id" \
                --arg summary "Guardian proactive save at ${size_kb}KB" \
                '{session_id: $sid, trigger: "proactive", context_summary: $summary}')" \
            2>/dev/null >/dev/null &

        exit 0

    elif (( size_bytes >= THRESHOLD_ORANGE )); then
        # ORANGE: 750KB-1MB - systemMessage alert
        log_message "WARN" "Transcript ${size_kb}KB (ORANGE) - alerting Claude"
        printf '{"systemMessage":"[DCM Guardian] Context at %dKB. Consider running /compact soon."}' "$size_kb"
        exit 0

    elif (( size_bytes >= THRESHOLD_YELLOW )); then
        # YELLOW: 500-750KB - log only, no output
        log_message "INFO" "Transcript ${size_kb}KB (YELLOW)"
        exit 0
    fi
    # GREEN: <500KB - complete silence
fi

# --- Layer 2: Cached DCM health check (every 60s) ---

should_check_health=false
if [[ ! -f "$HEALTH_CACHE" ]]; then
    should_check_health=true
else
    cache_age=$(( $(date +%s) - $(stat -c%Y "$HEALTH_CACHE" 2>/dev/null || stat -f%m "$HEALTH_CACHE" 2>/dev/null || echo "0") ))
    if (( cache_age >= HEALTH_CACHE_TTL )); then
        should_check_health=true
    fi
fi

if [[ "$should_check_health" == "true" ]]; then
    health_status=$(timeout 1s curl -s -o /dev/null -w "%{http_code}" "${API_URL}/health" \
        --connect-timeout 1 2>/dev/null || echo "000")

    if [[ "$health_status" == "200" ]]; then
        echo "ok" > "$HEALTH_CACHE" 2>/dev/null || true
    else
        echo "down" > "$HEALTH_CACHE" 2>/dev/null || true
        log_message "ERROR" "DCM instance unreachable (HTTP $health_status)"
        printf '{"systemMessage":"[DCM Guardian] DCM instance disconnected (HTTP %s). Context tracking paused."}' "$health_status"
        exit 0
    fi
fi

exit 0
