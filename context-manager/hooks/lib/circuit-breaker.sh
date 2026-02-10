#!/usr/bin/env bash
# DCM Circuit Breaker - Shared library for all hooks
# Prevents cascading timeouts when DCM API is unavailable
# 
# Usage: source "$(dirname "$0")/lib/circuit-breaker.sh"
#        dcm_api_available || exit 0
#        result=$(dcm_curl GET "/api/health") || { dcm_api_failed; exit 0; }
#        dcm_api_success

CB_STATE_FILE="/tmp/.dcm-circuit-breaker"
CB_TIMEOUT=${DCM_CB_TIMEOUT:-30}       # Seconds before retry after failure
CB_FAILURE_THRESHOLD=${DCM_CB_THRESHOLD:-3}  # Failures before opening circuit

# Check if API is available (circuit is closed)
dcm_api_available() {
    [[ ! -f "$CB_STATE_FILE" ]] && return 0
    
    local failures age
    failures=$(head -1 "$CB_STATE_FILE" 2>/dev/null || echo "0")
    age=$(( $(date +%s) - $(stat -c %Y "$CB_STATE_FILE" 2>/dev/null || stat -f %Y "$CB_STATE_FILE" 2>/dev/null || echo "0") ))
    
    # Half-open: allow retry after timeout
    if (( age >= CB_TIMEOUT )); then
        return 0  # Allow one request through
    fi
    
    # Circuit is open
    if (( failures >= CB_FAILURE_THRESHOLD )); then
        return 1
    fi
    
    return 0
}

# Record API failure
dcm_api_failed() {
    local current=0
    [[ -f "$CB_STATE_FILE" ]] && current=$(head -1 "$CB_STATE_FILE" 2>/dev/null || echo "0")
    echo "$(( current + 1 ))" > "$CB_STATE_FILE" 2>/dev/null
}

# Record API success (close circuit)
dcm_api_success() {
    rm -f "$CB_STATE_FILE" 2>/dev/null
}

# Wrapper for curl with circuit breaker
# Usage: dcm_curl METHOD PATH [DATA]
# Returns: response body on stdout, exit 0 on success, exit 1 on failure
dcm_curl() {
    local method="${1:-GET}"
    local path="$2"
    local data="$3"
    local url="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}${path}"
    local response
    
    dcm_api_available || return 1
    
    if [[ "$method" == "GET" ]]; then
        response=$(curl -s --connect-timeout 1 --max-time 2 "$url" 2>/dev/null)
    else
        response=$(curl -s -X "$method" "$url" \
            -H "Content-Type: application/json" \
            -d "$data" \
            --connect-timeout 1 --max-time 2 2>/dev/null)
    fi
    
    local exit_code=$?
    if (( exit_code != 0 )); then
        dcm_api_failed
        return 1
    fi
    
    dcm_api_success
    echo "$response"
    return 0
}

# Atomic file write (write to .tmp then mv)
dcm_atomic_write() {
    local target="$1"
    local content="$2"
    local tmp="${target}.tmp.$$"
    
    echo "$content" > "$tmp" 2>/dev/null && mv -f "$tmp" "$target" 2>/dev/null
    return $?
}

# Safe JSON output for Claude Code hooks
dcm_json_escape() {
    local input="$1"
    # Use jq to properly escape the string
    echo "$input" | jq -Rs '.' 2>/dev/null || echo "\"$(echo "$input" | sed 's/"/\\"/g; s/\n/\\n/g')\""
}

# Cross-platform stat for file size in bytes
dcm_file_size() {
    local file="$1"
    stat -c%s "$file" 2>/dev/null || stat -f%z "$file" 2>/dev/null || echo "0"
}

# Cross-platform stat for file modification time
dcm_file_mtime() {
    local file="$1"
    stat -c%Y "$file" 2>/dev/null || stat -f%m "$file" 2>/dev/null || echo "0"
}
