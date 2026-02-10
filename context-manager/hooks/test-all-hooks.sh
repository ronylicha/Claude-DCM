#!/usr/bin/env bash
# test-all-hooks.sh - Validate all DCM hooks after bug fixes
set -euo pipefail

HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PASSED=0
FAILED=0

echo "=== DCM Hooks Validation Test ==="
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test function
test_hook() {
    local hook_file="$1"
    local hook_name=$(basename "$hook_file")
    
    printf "Testing %-30s ... " "$hook_name"
    
    # Syntax check
    if bash -n "$hook_file" 2>/dev/null; then
        echo -e "${GREEN}✓ PASS${NC}"
        PASSED=$((PASSED + 1))
        return 0
    else
        echo -e "${RED}✗ FAIL${NC}"
        bash -n "$hook_file" 2>&1 | sed 's/^/    /'
        FAILED=$((FAILED + 1))
        return 1
    fi
}

# Test circuit breaker library
echo "=== Testing Circuit Breaker Library ==="
test_hook "$HOOKS_DIR/lib/circuit-breaker.sh"
echo ""

# Test all hook scripts
echo "=== Testing Hook Scripts ==="
for hook in "$HOOKS_DIR"/*.sh; do
    [[ "$(basename "$hook")" == "test-all-hooks.sh" ]] && continue
    test_hook "$hook"
done

echo ""
echo "=== Test Summary ==="
echo -e "Passed: ${GREEN}${PASSED}${NC}"
echo -e "Failed: ${RED}${FAILED}${NC}"
echo ""

if (( FAILED == 0 )); then
    echo -e "${GREEN}All hooks validated successfully!${NC}"
    exit 0
else
    echo -e "${RED}Some hooks failed validation.${NC}"
    exit 1
fi
