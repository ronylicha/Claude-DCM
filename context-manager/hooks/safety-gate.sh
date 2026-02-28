#!/usr/bin/env bash
# safety-gate.sh - PreToolUse hook: blocks dangerous operations
# v1.0: Blocks rm -rf, DROP DATABASE/TABLE, TRUNCATE, direct .env access
#
# Claude Code Hook: PreToolUse (Bash, Write, Edit matcher)
# Returns: {"decision": "block", "reason": "..."} to prevent execution
# Logs all blocks to DCM API (centralized in DB)

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/common.sh" 2>/dev/null || true
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

dcm_init_dirs

RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

tool_name=$(echo "$RAW_INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)

# Only gate Bash, Write, and Edit tools
case "$tool_name" in
    Bash|Write|Edit) ;;
    *) exit 0 ;;
esac

# Extract the command/content to check
command_text=""
file_path=""
if [[ "$tool_name" == "Bash" ]]; then
    command_text=$(echo "$RAW_INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
elif [[ "$tool_name" == "Write" || "$tool_name" == "Edit" ]]; then
    file_path=$(echo "$RAW_INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
    command_text="$file_path"
fi

[[ -z "$command_text" ]] && exit 0

# ==========================================
# SAFETY GATE - Dangerous Pattern Detection
# ==========================================

block_reason=""

# 1. Destructive filesystem operations
if echo "$command_text" | grep -qiE 'rm\s+(-[a-z]*f[a-z]*\s+)?(-[a-z]*r[a-z]*\s+)?/($|\s)|rm\s+-rf\s+/|rm\s+-fr\s+/'; then
    block_reason="Destructive rm -rf / detected"
fi

if echo "$command_text" | grep -qiE 'rm\s+(-[a-z]*r[a-z]*\s+)+(~|/home|/etc|/var|/usr)'; then
    block_reason="Destructive rm on system directory detected"
fi

# 2. Database destructive operations
if echo "$command_text" | grep -qiE 'DROP\s+(DATABASE|SCHEMA)\s'; then
    block_reason="DROP DATABASE/SCHEMA detected"
fi

if echo "$command_text" | grep -qiE 'DROP\s+TABLE\s'; then
    block_reason="DROP TABLE detected"
fi

if echo "$command_text" | grep -qiE 'TRUNCATE\s+(TABLE\s+)?'; then
    block_reason="TRUNCATE TABLE detected"
fi

# 3. Direct .env file access (reading secrets)
if [[ "$tool_name" == "Bash" ]]; then
    if echo "$command_text" | grep -qiE 'cat\s+.*\.env($|\s)|less\s+.*\.env|more\s+.*\.env|head\s+.*\.env|tail\s+.*\.env'; then
        block_reason="Direct .env file read via shell detected"
    fi
fi

if [[ "$tool_name" == "Write" && -n "$file_path" ]]; then
    if [[ "$file_path" == *"/.env" ]] && [[ "$file_path" != *".env.example"* ]] && [[ "$file_path" != *".env.local"* ]]; then
        block_reason="Direct .env file write detected"
    fi
fi

# 4. Fork bomb / resource exhaustion
if echo "$command_text" | grep -qE ':\(\)\{.*:\|:.*&.*\}'; then
    block_reason="Fork bomb detected"
fi

# 5. Disk wipe operations
if echo "$command_text" | grep -qiE 'dd\s+if=/dev/zero\s+of=/dev/|mkfs\s+/dev/'; then
    block_reason="Disk wipe/format operation detected"
fi

# ==========================================
# DECISION
# ==========================================

if [[ -n "$block_reason" ]]; then
    # Log to DCM API (centralized in DB)
    dcm_log_blocked "${command_text:0:500}" "$block_reason" "$session_id"

    # Return block decision to Claude Code
    echo "{\"decision\": \"block\", \"reason\": \"SAFETY GATE: ${block_reason}. This operation has been blocked to prevent data loss.\"}"
    exit 0
fi

# Allow by default
exit 0
