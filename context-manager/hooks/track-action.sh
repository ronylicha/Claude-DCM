#!/bin/bash
# track-action.sh - Record ALL tool actions to DCM PostgreSQL
# v3.1: Fixed memory limit on TOOL_INPUT, variable init defaults, true fire-and-forget
#
# Feeds keyword_tool_scores for routing intelligence
# + token consumption for predictive capacity monitoring

set -uo pipefail

# Load circuit breaker library
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
EXIT_CODE="${1:-0}"

# Read hook data from stdin (Claude Code passes JSON via stdin)
# Limit read to prevent memory issues (read max 100KB)
RAW_INPUT=$(head -c 102400 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

# Extract fields with defaults if jq fails
TOOL_NAME=$(echo "$RAW_INPUT" | jq -r '.tool_name // empty' 2>/dev/null || echo "")
TOOL_INPUT=$(echo "$RAW_INPUT" | jq -c '.tool_input // {}' 2>/dev/null || echo "{}")
TOOL_OUTPUT=$(echo "$RAW_INPUT" | jq -c '.tool_output // {}' 2>/dev/null || echo "{}")
SESSION_ID=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null || echo "")
WORKING_DIR=$(echo "$RAW_INPUT" | jq -r '.cwd // empty' 2>/dev/null || echo "")

[[ -z "$TOOL_NAME" ]] && exit 0

# Check circuit breaker
if ! dcm_api_available; then
    exit 0
fi

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
    EFFECTIVE_NAME=$(echo "$TOOL_INPUT" | jq -r '.skill // empty' 2>/dev/null || echo "")
    [[ -z "$EFFECTIVE_NAME" ]] && EFFECTIVE_NAME="$TOOL_NAME"
elif [[ "$TOOL_NAME" == "Task" ]]; then
    EFFECTIVE_NAME=$(echo "$TOOL_INPUT" | jq -r '.subagent_type // empty' 2>/dev/null || echo "")
    [[ -z "$EFFECTIVE_NAME" ]] && EFFECTIVE_NAME="$TOOL_NAME"
fi

# Truncate input for API (max 2KB) BEFORE echo to limit memory
INPUT_TEXT=$(echo "$TOOL_INPUT" | head -c 2048 2>/dev/null || echo "{}")

# Calculate sizes for token tracking (safe defaults)
INPUT_SIZE=${#TOOL_INPUT}
OUTPUT_SIZE=${#TOOL_OUTPUT}

# Send to DCM API (true fire-and-forget - no wait)
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

# v3.0: Track token consumption (true fire-and-forget)
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

# NO wait - true fire-and-forget
exit 0
