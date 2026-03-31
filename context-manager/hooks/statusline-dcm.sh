#!/bin/bash
# DCM Statusline Hook — Pushes ALL real-time data to DCM API
# Receives HookInput JSON on stdin from Claude Code Notification hook
#
# HookInput fields:
#   session_id, transcript_path, cwd, version, exceeds_200k_tokens
#   model: { id, display_name }
#   workspace: { current_dir, project_dir }
#   cost: { total_cost_usd, total_duration_ms, total_api_duration_ms, total_lines_added, total_lines_removed }
#   context_window: { total_input_tokens, total_output_tokens, context_window_size,
#                     current_usage: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens } }

DCM_API="${DCM_API_URL:-http://127.0.0.1:3847}"

# Read stdin
INPUT=$(cat)

# --- Core ---
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
[ -z "$SESSION_ID" ] && exit 0

# --- Model ---
MODEL_ID=$(echo "$INPUT" | jq -r '.model.id // "unknown"')
MODEL_NAME=$(echo "$INPUT" | jq -r '.model.display_name // ""')
VERSION=$(echo "$INPUT" | jq -r '.version // ""')

# --- Context Window ---
TOTAL_INPUT=$(echo "$INPUT" | jq -r '.context_window.total_input_tokens // 0')
TOTAL_OUTPUT=$(echo "$INPUT" | jq -r '.context_window.total_output_tokens // 0')
CONTEXT_WINDOW=$(echo "$INPUT" | jq -r '.context_window.context_window_size // 1000000')
CURRENT_INPUT=$(echo "$INPUT" | jq -r '.context_window.current_usage.input_tokens // 0')
CURRENT_OUTPUT=$(echo "$INPUT" | jq -r '.context_window.current_usage.output_tokens // 0')
CACHE_CREATION=$(echo "$INPUT" | jq -r '.context_window.current_usage.cache_creation_input_tokens // 0')
CACHE_READ=$(echo "$INPUT" | jq -r '.context_window.current_usage.cache_read_input_tokens // 0')
EXCEEDS_200K=$(echo "$INPUT" | jq -r '.exceeds_200k_tokens // false')

# --- Cost ---
COST_USD=$(echo "$INPUT" | jq -r '.cost.total_cost_usd // 0')
DURATION_MS=$(echo "$INPUT" | jq -r '.cost.total_duration_ms // 0')
API_DURATION_MS=$(echo "$INPUT" | jq -r '.cost.total_api_duration_ms // 0')
LINES_ADDED=$(echo "$INPUT" | jq -r '.cost.total_lines_added // 0')
LINES_REMOVED=$(echo "$INPUT" | jq -r '.cost.total_lines_removed // 0')

# --- Calculate usage ---
CURRENT_USAGE=$((CURRENT_INPUT + CURRENT_OUTPUT))
[ "$CURRENT_USAGE" -eq 0 ] && CURRENT_USAGE=$((TOTAL_INPUT + TOTAL_OUTPUT))

if [ "$CONTEXT_WINDOW" -gt 0 ] && [ "$CURRENT_USAGE" -gt 0 ]; then
  USED_PCT=$(echo "scale=1; $CURRENT_USAGE * 100 / $CONTEXT_WINDOW" | bc 2>/dev/null || echo "0")
else
  USED_PCT="0"
fi

# Fire-and-forget POST to DCM with ALL data
curl -s --connect-timeout 1 --max-time 2 \
  -X POST "${DCM_API}/api/tokens/realtime" \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\": \"${SESSION_ID}\",
    \"model_id\": \"${MODEL_ID}\",
    \"model_name\": \"${MODEL_NAME}\",
    \"version\": \"${VERSION}\",
    \"total_input_tokens\": ${TOTAL_INPUT},
    \"total_output_tokens\": ${TOTAL_OUTPUT},
    \"context_window_size\": ${CONTEXT_WINDOW},
    \"current_input_tokens\": ${CURRENT_INPUT},
    \"current_output_tokens\": ${CURRENT_OUTPUT},
    \"cache_creation_tokens\": ${CACHE_CREATION},
    \"cache_read_tokens\": ${CACHE_READ},
    \"used_percentage\": ${USED_PCT},
    \"exceeds_200k\": ${EXCEEDS_200K},
    \"cost_usd\": ${COST_USD},
    \"duration_ms\": ${DURATION_MS},
    \"api_duration_ms\": ${API_DURATION_MS},
    \"lines_added\": ${LINES_ADDED},
    \"lines_removed\": ${LINES_REMOVED}
  }" >/dev/null 2>&1 &

exit 0
