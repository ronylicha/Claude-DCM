#!/usr/bin/env bash
# UserPromptSubmit hook: Spawn AI skill+agent analysis in background
# Returns immediately (< 100ms). engine.ts runs async and writes advisor-reco.json.
# Part of DCM — queries DCM routing + Haiku for intelligent recommendations.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_GATE_ROOT="/tmp/claude-skill-gate"

RAW_INPUT=$(cat 2>/dev/null || echo "")
SESSION_ID=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
PROMPT=$(echo "$RAW_INPUT" | jq -r '.prompt // empty' 2>/dev/null)

# No session or prompt → skip
if [ -z "$SESSION_ID" ] || [ -z "$PROMPT" ]; then
  echo '{"decision":"approve"}'
  exit 0
fi

# Skip very short prompts (< 15 chars)
if [ ${#PROMPT} -lt 15 ]; then
  echo '{"decision":"approve"}'
  exit 0
fi

# Skip greetings and trivial non-code prompts
if echo "$PROMPT" | grep -qiE '^(hi|hello|bonjour|merci|thanks|salut|ok|oui|non|yes|no|bye|quit|exit|help|clear|compact)$'; then
  echo '{"decision":"approve"}'
  exit 0
fi

# Write input to temp file (avoids shell escaping issues with long prompts)
SESSION_DIR="${SKILL_GATE_ROOT}/${SESSION_ID}"
mkdir -p "$SESSION_DIR" 2>/dev/null
INPUT_FILE="${SESSION_DIR}/advisor-input.json"
echo "$RAW_INPUT" > "$INPUT_FILE" 2>/dev/null

# Spawn engine in background (fire-and-forget)
if command -v bun &>/dev/null; then
  nohup bun "$SCRIPT_DIR/engine.ts" "$INPUT_FILE" > /dev/null 2>&1 &
fi

echo '{"decision":"approve"}'
exit 0
