#!/usr/bin/env bash
# Test script for circuit breaker functionality

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
source "$SCRIPT_DIR/circuit-breaker.sh"
source "$SCRIPT_DIR/common.sh"

echo "=== DCM Circuit Breaker Test ==="
echo ""

# Test 1: Check initial state
echo "Test 1: Initial state (circuit should be closed)"
if dcm_api_available; then
    echo "✓ Circuit is closed (API available)"
else
    echo "✗ Circuit is open (API unavailable)"
fi
echo ""

# Test 2: Simulate API call
echo "Test 2: Attempt API call to /api/health"
result=$(dcm_curl GET "/api/health")
if [[ $? -eq 0 ]]; then
    echo "✓ API call successful"
    echo "Response: ${result:0:100}..."
else
    echo "✗ API call failed (expected if DCM not running)"
fi
echo ""

# Test 3: Check circuit state after failure
echo "Test 3: Circuit state after potential failure"
if [[ -f "$CB_STATE_FILE" ]]; then
    failures=$(cat "$CB_STATE_FILE")
    echo "Current failure count: $failures"
    echo "Threshold: $CB_FAILURE_THRESHOLD"
    if (( failures >= CB_FAILURE_THRESHOLD )); then
        echo "⚠ Circuit is OPEN (will retry in ${CB_TIMEOUT}s)"
    else
        echo "Circuit is HALF-OPEN ($(( CB_FAILURE_THRESHOLD - failures )) failures until open)"
    fi
else
    echo "✓ No failures recorded (circuit healthy)"
fi
echo ""

# Test 4: Test helper functions
echo "Test 4: Helper functions"
dcm_init_dirs
echo "✓ Created directories: $DCM_CACHE_DIR, $DCM_LOG_DIR"

agent_id=$(dcm_generate_agent_id "test")
echo "✓ Generated agent ID: $agent_id"

file_size=$(dcm_file_size "$SCRIPT_DIR/circuit-breaker.sh")
echo "✓ File size of circuit-breaker.sh: ${file_size} bytes"
echo ""

# Test 5: Test atomic write
echo "Test 5: Atomic write"
test_file="/tmp/dcm-test-$$"
dcm_atomic_write "$test_file" "Test content $(date)"
if [[ -f "$test_file" ]]; then
    echo "✓ Atomic write successful"
    cat "$test_file"
    rm -f "$test_file"
else
    echo "✗ Atomic write failed"
fi
echo ""

# Test 6: Test JSON escape
echo "Test 6: JSON escape"
input='Line 1
Line 2 with "quotes"'
escaped=$(dcm_json_escape "$input")
echo "Input: $input"
echo "Escaped: $escaped"
echo ""

# Test 7: Logging
echo "Test 7: Logging"
dcm_log "INFO" "Circuit breaker test completed"
if [[ -f "$DCM_LOG_DIR/dcm-hooks.log" ]]; then
    echo "✓ Log file created:"
    tail -1 "$DCM_LOG_DIR/dcm-hooks.log"
else
    echo "✗ Log file not created"
fi
echo ""

echo "=== Test Complete ==="
echo "Circuit breaker state file: $CB_STATE_FILE"
echo "Cache directory: $DCM_CACHE_DIR"
echo "Log directory: $DCM_LOG_DIR"
