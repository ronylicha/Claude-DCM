#!/usr/bin/env bash
#
# context-stop-guard.sh - Stop hook (last resort before context overflow)
#
# When Claude finishes responding, checks if context is critical.
# If so, BLOCKS Claude with a message forcing the user to run /compact.
#
# Execution: Stop event
# Timeout: 3s
#
set -uo pipefail

# Load circuit breaker library
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

# Configuration
readonly API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
readonly LOG_FILE="/tmp/dcm-stop-guard.log"
readonly CRITICAL_SIZE=$((900 * 1024))  # 900KB transcript = critical

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

# Read stdin
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

# Anti-loop guard: if stop_hook_active is true, another Stop hook already fired
stop_hook_active=$(echo "$RAW_INPUT" | jq -r '.stop_hook_active // false' 2>/dev/null)
if [[ "$stop_hook_active" == "true" ]]; then
    exit 0
fi

# Extract fields
session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
transcript_path=$(echo "$RAW_INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

[[ -z "$session_id" ]] && exit 0

# --- Check 1: Transcript file size ---

is_critical=false
size_metric=""  # Store either size_kb or usage_percent for message

if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    size_bytes=$(get_file_size "$transcript_path")
    size_kb=$((size_bytes / 1024))

    if (( size_bytes >= CRITICAL_SIZE )); then
        is_critical=true
        size_metric="${size_kb}KB"
        log_message "CRITICAL" "Transcript at ${size_kb}KB (>900KB threshold)"
    fi
fi

# --- Check 2: API capacity zone (only if not already critical from file size) ---

if [[ "$is_critical" != "true" ]]; then
    # Check circuit breaker before API call
    if dcm_api_available; then
        agent_id="${AGENT_ID:-$session_id}"
        health_response=$(timeout 1.5s curl -s "${API_URL}/api/context/health/${agent_id}" \
            --connect-timeout 1 --max-time 1.5 2>/dev/null || echo "")

        if [[ -n "$health_response" ]]; then
            dcm_api_success
            zone=$(echo "$health_response" | jq -r '.capacity.zone // "green"' 2>/dev/null)
            should_compact=$(echo "$health_response" | jq -r '.shouldCompact // false' 2>/dev/null)
            usage_percent=$(echo "$health_response" | jq -r '.capacity.usage_percent // 0' 2>/dev/null)

            # Fix operator precedence: critical if (zone is red/critical) OR (zone is orange AND shouldCompact)
            if [[ "$zone" == "red" || "$zone" == "critical" ]] || [[ "$zone" == "orange" && "$should_compact" == "true" ]]; then
                is_critical=true
                size_metric="${usage_percent}%"
                log_message "CRITICAL" "API reports zone=${zone}, usage=${usage_percent}%"
            fi
        else
            dcm_api_failed
        fi
    fi
fi

# --- Decision ---

if [[ "$is_critical" == "true" ]]; then
    # Proactive save before blocking (only if circuit allows)
    if dcm_api_available; then
        timeout 1.5s curl -s -X POST "${API_URL}/api/compact/save" \
            -H "Content-Type: application/json" \
            -d "$(jq -n \
                --arg sid "$session_id" \
                --arg summary "Stop guard triggered at ${size_metric}" \
                '{session_id: $sid, trigger: "proactive", context_summary: $summary}')" \
            2>/dev/null >/dev/null || true
    fi

    log_message "BLOCK" "Blocking Claude - context critical (${size_metric}), forcing /compact"

    # Block Claude with actionable message
    printf '{"decision":"block","reason":"[DCM Stop Guard] Context window critical (%s). State saved. Run /compact to continue safely."}' "$size_metric"
    exit 0
fi

# Not critical - allow Claude to continue
exit 0
