#!/usr/bin/env bash
#
# skill-gate-enforce.sh — Unified PreToolUse enforcement hook
# Queries DCM API /api/skill-gate/:sid/check for approve/block decisions.
# Replaces: enforce-skills-before-code.sh + enforce-skills-before-agent.sh
#
# Matchers: Edit, Write, MultiEdit, Agent
# Timeout: 500ms (API call < 400ms + margin)
#
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

readonly API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"

RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

TOOL_NAME=$(echo "$RAW_INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
SESSION_ID=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)

[[ -z "$TOOL_NAME" || -z "$SESSION_ID" ]] && exit 0

# Build query params based on tool type
QUERY=""
case "$TOOL_NAME" in
  Edit|Write|MultiEdit)
    FILE_PATH=$(echo "$RAW_INPUT" | jq -r '.tool_input.file_path // .tool_input.file // empty' 2>/dev/null)
    [[ -z "$FILE_PATH" ]] && exit 0
    # URL-encode file path (basic: spaces and special chars)
    ENCODED_PATH=$(printf '%s' "$FILE_PATH" | jq -sRr @uri 2>/dev/null || echo "$FILE_PATH")
    QUERY="tool_type=edit&file_path=${ENCODED_PATH}"
    ;;
  Agent)
    SUBAGENT=$(echo "$RAW_INPUT" | jq -r '.tool_input.subagent_type // empty' 2>/dev/null)
    [[ -z "$SUBAGENT" ]] && exit 0
    QUERY="tool_type=agent&subagent_type=${SUBAGENT}"
    ;;
  *)
    exit 0
    ;;
esac

# Check circuit breaker
if ! dcm_api_available; then
  exit 0
fi

# Query DCM API
RESPONSE=$(curl -s \
  --connect-timeout 0.3 \
  --max-time 0.5 \
  "${API_URL}/api/skill-gate/${SESSION_ID}/check?${QUERY}" 2>/dev/null || echo "")

if [[ -z "$RESPONSE" ]]; then
  dcm_api_failed
  exit 0
fi

if ! echo "$RESPONSE" | jq empty 2>/dev/null; then
  dcm_api_failed
  exit 0
fi

dcm_api_success

DECISION=$(echo "$RESPONSE" | jq -r '.decision // "approve"' 2>/dev/null)

if [[ "$DECISION" == "block" ]]; then
  REASON=$(echo "$RESPONSE" | jq -r '.reason // "Skills manquants"' 2>/dev/null)
  # Escape reason for JSON output
  ESCAPED_REASON=$(echo "$REASON" | jq -Rs '.[:-1]' 2>/dev/null || echo "$REASON")
  printf '{"decision":"block","reason":%s}' "$ESCAPED_REASON"
fi

exit 0
