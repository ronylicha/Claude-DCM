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

# Load circuit breaker library
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

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

# Portable stat for file size
get_file_size() {
    local file="$1"
    stat --format=%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo "0"
}

# Portable stat for file modification time
get_file_mtime() {
    local file="$1"
    stat --format=%Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null || echo "0"
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
    size_bytes=$(get_file_size "$transcript_path")
    size_kb=$((size_bytes / 1024))

    if (( size_bytes >= THRESHOLD_RED )); then
        # RED: >1MB - systemMessage + proactive save
        log_message "ALERT" "Transcript ${size_kb}KB (RED) - triggering proactive save"

        # Output systemMessage to Claude
        printf '{"systemMessage":"[DCM Guardian] Context at %dKB (>1MB). Run /compact NOW to avoid context loss."}' "$size_kb"

        # Synchronous save with short timeout (circuit breaker aware)
        if dcm_api_available; then
            save_result=$(timeout 1.5s curl -s -X POST "${API_URL}/api/compact/save" \
                -H "Content-Type: application/json" \
                -d "$(jq -n \
                    --arg sid "$session_id" \
                    --arg summary "Guardian proactive save at ${size_kb}KB" \
                    '{session_id: $sid, trigger: "proactive", context_summary: $summary}')" \
                --connect-timeout 1 \
                --max-time 1.5 2>/dev/null || echo "")
            
            if [[ -n "$save_result" ]]; then
                dcm_api_success
            else
                dcm_api_failed
            fi
        fi

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
    cache_mtime=$(get_file_mtime "$HEALTH_CACHE")
    current_time=$(date +%s)
    cache_age=$((current_time - cache_mtime))
    if (( cache_age >= HEALTH_CACHE_TTL )); then
        should_check_health=true
    fi
fi

if [[ "$should_check_health" == "true" ]]; then
    # Check circuit breaker before attempting API call
    if ! dcm_api_available; then
        exit 0
    fi

    health_status=$(timeout 1s curl -s -o /dev/null -w "%{http_code}" "${API_URL}/health" \
        --connect-timeout 1 2>/dev/null || echo "000")

    # Atomic cache write (write to temp, then mv)
    cache_tmp="${HEALTH_CACHE}.tmp.$$"
    if [[ "$health_status" == "200" ]]; then
        echo "ok" > "$cache_tmp" 2>/dev/null && mv "$cache_tmp" "$HEALTH_CACHE" 2>/dev/null || true
        dcm_api_success
    else
        echo "down" > "$cache_tmp" 2>/dev/null && mv "$cache_tmp" "$HEALTH_CACHE" 2>/dev/null || true
        dcm_api_failed
        log_message "ERROR" "DCM instance unreachable (HTTP $health_status)"
        
        # Validate cache is valid JSON (if it exists)
        if [[ -f "$HEALTH_CACHE" ]]; then
            if ! echo "$(cat "$HEALTH_CACHE")" | jq empty 2>/dev/null; then
                # Cache is not valid JSON, remove it
                rm -f "$HEALTH_CACHE"
            fi
        fi
        
        printf '{"systemMessage":"[DCM Guardian] DCM instance disconnected (HTTP %s). Context tracking paused."}' "$health_status"
        exit 0
    fi
fi

exit 0
