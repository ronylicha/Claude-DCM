#!/bin/bash
# DCM Statusline Hook — Pushes real token data to DCM API
# Receives JSON on stdin from Claude Code's statusline mechanism

DCM_API="${DCM_API_URL:-http://127.0.0.1:3847}"

# Read stdin (Claude Code passes JSON with token data)
INPUT=$(cat)

# Extract fields from statusline JSON
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
TOTAL_INPUT=$(echo "$INPUT" | jq -r '.total_input_tokens // 0')
TOTAL_OUTPUT=$(echo "$INPUT" | jq -r '.total_output_tokens // 0')
CONTEXT_WINDOW=$(echo "$INPUT" | jq -r '.context_window_size // 200000')
USED_PCT=$(echo "$INPUT" | jq -r '.used_percentage // 0')
MODEL_ID=$(echo "$INPUT" | jq -r '.model // "unknown"')

# Skip if no session_id
if [ -z "$SESSION_ID" ]; then
  exit 0
fi

# Fire-and-forget POST to DCM
curl -s --connect-timeout 1 --max-time 2 \
  -X POST "${DCM_API}/api/tokens/realtime" \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\": \"${SESSION_ID}\",
    \"total_input_tokens\": ${TOTAL_INPUT},
    \"total_output_tokens\": ${TOTAL_OUTPUT},
    \"context_window_size\": ${CONTEXT_WINDOW},
    \"used_percentage\": ${USED_PCT},
    \"model_id\": \"${MODEL_ID}\"
  }" >/dev/null 2>&1 &

exit 0
