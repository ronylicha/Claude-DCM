#!/usr/bin/env bash
# DCM Common Library - Shared constants and functions
# Source this + circuit-breaker.sh in every hook

DCM_API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
DCM_CACHE_DIR="/tmp/.claude-context"
DCM_LOG_DIR="/tmp/dcm-logs"

# Ensure directories exist with secure permissions
dcm_init_dirs() {
    mkdir -p "$DCM_CACHE_DIR" 2>/dev/null && chmod 700 "$DCM_CACHE_DIR" 2>/dev/null
    mkdir -p "$DCM_LOG_DIR" 2>/dev/null && chmod 700 "$DCM_LOG_DIR" 2>/dev/null
}

# Get file size cross-platform
dcm_file_size() {
    local file="$1"
    if [[ -f "$file" ]]; then
        stat --printf="%s" "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo 0
    else
        echo 0
    fi
}

# Generate unique agent ID
dcm_generate_agent_id() {
    local prefix="${1:-agent}"
    if [[ -f /proc/sys/kernel/random/uuid ]]; then
        echo "${prefix}-$(cat /proc/sys/kernel/random/uuid)"
    elif command -v uuidgen &>/dev/null; then
        echo "${prefix}-$(uuidgen | tr '[:upper:]' '[:lower:]')"
    else
        echo "${prefix}-$(date +%s%N)-$(head -c 8 /dev/urandom | xxd -p 2>/dev/null || echo "$(( RANDOM ))$(( RANDOM ))")"
    fi
}

# Read stdin JSON safely (with timeout)
dcm_read_stdin() {
    local timeout="${1:-2}"
    timeout "$timeout" cat 2>/dev/null || echo ""
}

# Extract field from JSON with fallback
dcm_json_field() {
    local json="$1"
    local field="$2"
    local default="${3:-}"
    local result
    result=$(echo "$json" | jq -r ".${field} // empty" 2>/dev/null)
    echo "${result:-$default}"
}

# Log to file with rotation (local fallback only)
dcm_log() {
    local level="$1"
    local message="$2"
    local logfile="${DCM_LOG_DIR}/dcm-hooks.log"

    # Simple rotation: truncate if > 1MB
    if [[ -f "$logfile" ]] && (( $(dcm_file_size "$logfile") > 1048576 )); then
        tail -100 "$logfile" > "${logfile}.tmp" && mv "${logfile}.tmp" "$logfile"
    fi

    echo "[$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)] [${level}] ${message}" >> "$logfile" 2>/dev/null
}

# Log blocked operation to DCM API (centralized in DB)
dcm_log_blocked() {
    local command="$1"
    local reason="$2"
    local session_id="${3:-unknown}"

    curl -s -X POST "${DCM_API_URL}/api/actions" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg tool_name "SAFETY_GATE" \
            --arg tool_type "blocked" \
            --arg input "$command" \
            --arg session_id "$session_id" \
            --arg project_path "" \
            --argjson exit_code 1 \
            '{tool_name: $tool_name, tool_type: $tool_type, input: $input, exit_code: $exit_code, session_id: $session_id, project_path: $project_path, metadata: {reason: $input}}'
        )" \
        --connect-timeout 1 --max-time 2 >/dev/null 2>&1 &

    # Also log locally as fallback
    dcm_log "BLOCKED" "session=${session_id} reason=\"${reason}\" command=\"${command:0:200}\""
}
