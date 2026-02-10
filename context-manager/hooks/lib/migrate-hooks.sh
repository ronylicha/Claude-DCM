#!/usr/bin/env bash
# Automated migration script to integrate circuit breaker in all hooks
# This script updates hooks to use the shared library functions

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
HOOKS_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== DCM Hooks Circuit Breaker Migration ==="
echo ""

# Find all hooks (executable .sh files, excluding lib/ and this script)
mapfile -t hooks < <(find "$HOOKS_DIR" -maxdepth 1 -name "*.sh" -type f -executable ! -name "migrate-hooks.sh" 2>/dev/null || true)

if [[ ${#hooks[@]} -eq 0 ]]; then
    echo "No hooks found to migrate."
    exit 0
fi

echo "Found ${#hooks[@]} hooks to analyze:"
for hook in "${hooks[@]}"; do
    echo "  - $(basename "$hook")"
done
echo ""

# Track migration results
migrated=0
already_integrated=0
skipped=0

for hook in "${hooks[@]}"; do
    hook_name=$(basename "$hook")
    echo "Analyzing: $hook_name"
    
    # Check if already using circuit breaker
    if grep -q "source.*lib/circuit-breaker.sh" "$hook" 2>/dev/null; then
        echo "  ✓ Already integrated circuit breaker"
        ((already_integrated++))
        
        # Check if using dcm_curl
        if ! grep -q "dcm_curl" "$hook" 2>/dev/null; then
            echo "  ⚠ Uses circuit-breaker.sh but no dcm_curl calls found"
            echo "    Consider replacing direct curl calls with dcm_curl"
        fi
        
        # Check if using common.sh
        if ! grep -q "source.*lib/common.sh" "$hook" 2>/dev/null; then
            echo "  ℹ Missing common.sh - consider adding for utilities"
        fi
        
        echo ""
        continue
    fi
    
    # Check if hook makes API calls (broad pattern matching)
    if ! grep -qE "curl.*(127\.0\.0\.1|localhost|CONTEXT_MANAGER_URL|API_URL)" "$hook" 2>/dev/null; then
        echo "  ℹ No API calls detected - skipping"
        ((skipped++))
        echo ""
        continue
    fi
    
    echo "  ⚙ Found API calls - creating migration guide"
    
    # Create backup
    backup="${hook}.backup.$(date +%s)"
    cp "$hook" "$backup" 2>/dev/null || true
    echo "  ✓ Backup created: $(basename "$backup")"
    
    # Create migration recommendations file
    recommendations="${hook}.migration-guide.txt"
    {
        echo "Migration Guide for $(basename "$hook")"
        echo "Generated: $(date)"
        echo ""
        echo "Step 1: Add library imports at top of script (after set -euo pipefail):"
        echo "----------------------------------------"
        echo 'SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"'
        echo 'source "$SCRIPT_DIR/lib/circuit-breaker.sh"'
        echo 'source "$SCRIPT_DIR/lib/common.sh"'
        echo ""
        echo "Step 2: Initialize directories (if needed):"
        echo "----------------------------------------"
        echo "dcm_init_dirs"
        echo ""
        echo "Step 3: Replace curl calls with dcm_curl:"
        echo "----------------------------------------"
        echo "Current curl calls found:"
        grep -n "curl" "$hook" 2>/dev/null || echo "  (none found)"
        echo ""
        echo "Replacement patterns:"
        echo '  GET:  response=$(dcm_curl GET "/api/endpoint") || { exit 0; }'
        echo '  POST: response=$(dcm_curl POST "/api/endpoint" '\''{"key":"value"}'\'') || { exit 0; }'
        echo ""
        echo "Step 4: Add circuit check before critical sections:"
        echo "----------------------------------------"
        echo "dcm_api_available || exit 0"
        echo ""
        echo "Step 5: Replace logging with dcm_log (optional):"
        echo "----------------------------------------"
        echo 'dcm_log "INFO" "Message here"'
        echo 'dcm_log "ERROR" "Error message"'
        echo 'dcm_log "WARN" "Warning message"'
        echo ""
        echo "Step 6: Use helper functions (optional):"
        echo "----------------------------------------"
        echo "dcm_json_field \"\$json\" \"field\" \"default\""
        echo "dcm_atomic_write \"\$file\" \"\$content\""
        echo "dcm_generate_agent_id \"prefix\""
        echo ""
        echo "Manual changes required - review the backup and apply changes carefully."
        echo "Backup location: $backup"
    } > "$recommendations" 2>/dev/null || true
    
    echo "  ✓ Migration guide created: $(basename "$recommendations")"
    echo ""
    
    ((migrated++)) || true
done

echo "=== Migration Summary ==="
echo "Total hooks analyzed: ${#hooks[@]}"
echo "Already integrated: $already_integrated"
echo "Migration guides created: $migrated"
echo "Skipped (no API calls): $skipped"
echo ""

if [[ $migrated -gt 0 ]]; then
    echo "Next steps:"
    echo "1. Review .migration-guide.txt files for each hook"
    echo "2. Apply recommended changes manually"
    echo "3. Test each hook after migration"
    echo "4. Remove .backup and .migration-guide.txt files when done"
    echo ""
    echo "Backups created:"
    find "$HOOKS_DIR" -maxdepth 1 -name "*.backup.*" -type f 2>/dev/null | head -10
fi

echo ""
echo "For testing, run: $SCRIPT_DIR/test-circuit-breaker.sh"
exit 0
