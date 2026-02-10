#!/usr/bin/env bash
# Template for DCM hooks with circuit breaker integration
# Copy this file and modify for specific hook implementations

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
LIB_DIR="$SCRIPT_DIR/lib"

# Source shared libraries
source "$LIB_DIR/circuit-breaker.sh"
source "$LIB_DIR/common.sh"

# Initialize directories
dcm_init_dirs

# Read stdin with timeout
STDIN_JSON=$(dcm_read_stdin 2)

# Extract common fields
AGENT_ID=$(dcm_json_field "$STDIN_JSON" "agentId" "$(dcm_generate_agent_id)")
SESSION_ID=$(dcm_json_field "$STDIN_JSON" "sessionId" "")
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)

# Log hook execution
dcm_log "INFO" "Hook started: agentId=$AGENT_ID sessionId=$SESSION_ID"

# Check circuit breaker before API call
if ! dcm_api_available; then
    dcm_log "WARN" "Circuit breaker OPEN - skipping API call"
    echo '{
        "hookSpecificOutput": {
            "status": "skipped",
            "reason": "circuit_breaker_open"
        }
    }'
    exit 0
fi

# Example API call with circuit breaker
response=$(dcm_curl GET "/api/health")
if [[ $? -ne 0 ]]; then
    dcm_log "ERROR" "API call failed - circuit breaker updated"
    dcm_api_failed
    echo '{
        "hookSpecificOutput": {
            "status": "error",
            "reason": "api_unavailable"
        }
    }'
    exit 0
fi

# Record success
dcm_api_success
dcm_log "INFO" "API call successful"

# Process response and generate output
# ... your hook-specific logic here ...

# Example output
echo '{
    "hookSpecificOutput": {
        "status": "success",
        "agentId": "'"$AGENT_ID"'",
        "timestamp": "'"$TIMESTAMP"'"
    }
}'

dcm_log "INFO" "Hook completed successfully"
exit 0
