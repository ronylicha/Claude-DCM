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

# Log to file with rotation
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
