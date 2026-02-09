#!/bin/bash
# track-action.sh - Record ALL tool actions to DCM PostgreSQL
# v3.0: Added token consumption tracking via POST /api/tokens/track
#
# Feeds keyword_tool_scores for routing intelligence
# + token consumption for predictive capacity monitoring

set -uo pipefail

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
EXIT_CODE="${1:-0}"

# Read hook data from stdin (Claude Code passes JSON via stdin)
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

# Extract fields
TOOL_NAME=$(echo "$RAW_INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
TOOL_INPUT=$(echo "$RAW_INPUT" | jq -c '.tool_input // empty' 2>/dev/null)
TOOL_OUTPUT=$(echo "$RAW_INPUT" | jq -c '.tool_output // empty' 2>/dev/null)
SESSION_ID=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
WORKING_DIR=$(echo "$RAW_INPUT" | jq -r '.cwd // empty' 2>/dev/null)

[[ -z "$TOOL_NAME" ]] && exit 0

# Detect tool type
detect_type() {
    case "$1" in
        Bash|Read|Write|Edit|MultiEdit|Glob|Grep|NotebookEdit|WebFetch|WebSearch|EnterPlanMode|ExitPlanMode|AskUserQuestion|TaskCreate|TaskUpdate|TaskGet|TaskList|TaskOutput|TaskStop|ToolSearch)
            echo "builtin" ;;
        Task)
            echo "agent" ;;
        Skill)
            echo "skill" ;;
        mcp__*)
            echo "mcp" ;;
        *)
            echo "builtin" ;;
    esac
}

TOOL_TYPE=$(detect_type "$TOOL_NAME")

# For Skill/Task, use the effective name
EFFECTIVE_NAME="$TOOL_NAME"
if [[ "$TOOL_NAME" == "Skill" ]]; then
    EFFECTIVE_NAME=$(echo "$TOOL_INPUT" | jq -r '.skill // empty' 2>/dev/null)
    [[ -z "$EFFECTIVE_NAME" ]] && EFFECTIVE_NAME="$TOOL_NAME"
elif [[ "$TOOL_NAME" == "Task" ]]; then
    EFFECTIVE_NAME=$(echo "$TOOL_INPUT" | jq -r '.subagent_type // empty' 2>/dev/null)
    [[ -z "$EFFECTIVE_NAME" ]] && EFFECTIVE_NAME="$TOOL_NAME"
fi

# Truncate input for API (max 2KB)
INPUT_TEXT=$(echo "$TOOL_INPUT" | head -c 2048)

# Calculate sizes for token tracking
INPUT_SIZE=${#TOOL_INPUT}
OUTPUT_SIZE=${#TOOL_OUTPUT}

# Send to DCM API (fire and forget, max 2s timeout)
curl -s -X POST "${API_URL}/api/actions" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
        --arg tool_name "$EFFECTIVE_NAME" \
        --arg tool_type "$TOOL_TYPE" \
        --arg input "$INPUT_TEXT" \
        --argjson exit_code "$EXIT_CODE" \
        --arg session_id "$SESSION_ID" \
        --arg project_path "$WORKING_DIR" \
        '{tool_name: $tool_name, tool_type: $tool_type, input: $input, exit_code: $exit_code, session_id: $session_id, project_path: $project_path}'
    )" \
    --connect-timeout 1 \
    --max-time 2 \
    >/dev/null 2>&1 &

# v3.0: Track token consumption (fire-and-forget, <5ms target)
AGENT_ID="${AGENT_ID:-$SESSION_ID}"
if [[ -n "$AGENT_ID" && -n "$SESSION_ID" ]]; then
    curl -s -X POST "${API_URL}/api/tokens/track" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg agent_id "$AGENT_ID" \
            --arg session_id "$SESSION_ID" \
            --arg tool_name "$EFFECTIVE_NAME" \
            --argjson input_size "$INPUT_SIZE" \
            --argjson output_size "$OUTPUT_SIZE" \
            '{agent_id: $agent_id, session_id: $session_id, tool_name: $tool_name, input_size: $input_size, output_size: $output_size}'
        )" \
        --connect-timeout 1 \
        --max-time 1 \
        >/dev/null 2>&1 &
fi

wait 2>/dev/null || true
exit 0
