#!/usr/bin/env bash
# track-usage.sh - Hook for tracking Claude Code tool usage
# Phase 2.5 - Calls REST API instead of SQLite
#
# Environment variables expected from Claude Code:
#   TOOL_NAME        - Name of the tool being used
#   TOOL_INPUT       - Input passed to the tool (may be large)
#   TOOL_OUTPUT      - Output from the tool (may be large)
#   TOOL_EXIT_CODE   - Exit code of the tool
#   TOOL_DURATION_MS - Duration in milliseconds (if available)
#   TOOL_FILE_PATHS  - File path(s) affected (comma-separated)
#   SESSION_ID       - Current session ID
#   PROJECT_DIR      - Current project path (cwd)

set -euo pipefail

# Configuration
API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
ENDPOINT="${API_URL}/api/actions"

# Extract tool type from tool name
get_tool_type() {
    local tool_name="$1"
    case "$tool_name" in
        Read|Write|Edit|Glob|Grep|Bash|Task|TodoRead|TodoWrite)
            echo "builtin"
            ;;
        mcp__*)
            echo "mcp"
            ;;
        /*)
            echo "command"
            ;;
        *)
            # Check if it's an agent or skill by name pattern
            if [[ "$tool_name" == *-specialist || "$tool_name" == *-expert || "$tool_name" == *-dev || "$tool_name" == *-admin ]]; then
                echo "agent"
            else
                echo "skill"
            fi
            ;;
    esac
}

# Main function
main() {
    # Get tool name (required)
    local tool_name="${TOOL_NAME:-}"
    if [[ -z "$tool_name" ]]; then
        exit 0  # Silently skip if no tool name
    fi

    # Determine tool type
    local tool_type
    tool_type=$(get_tool_type "$tool_name")

    # Prepare input (truncate if too large, max 10KB for hook)
    local input="${TOOL_INPUT:-}"
    if [[ ${#input} -gt 10240 ]]; then
        input="${input:0:10240}... (truncated)"
    fi

    # Prepare output (truncate if too large)
    local output="${TOOL_OUTPUT:-}"
    if [[ ${#output} -gt 10240 ]]; then
        output="${output:0:10240}... (truncated)"
    fi

    # Get other values
    local exit_code="${TOOL_EXIT_CODE:-0}"
    local duration_ms="${TOOL_DURATION_MS:-}"
    local file_paths="${TOOL_FILE_PATHS:-}"
    local session_id="${SESSION_ID:-}"
    local project_path="${PROJECT_DIR:-$(pwd)}"

    # Convert file paths to JSON array
    local file_paths_json="[]"
    if [[ -n "$file_paths" ]]; then
        # Convert comma-separated to JSON array
        file_paths_json=$(echo "$file_paths" | jq -R 'split(",") | map(gsub("^\\s+|\\s+$"; ""))')
    fi

    # Build JSON payload
    local payload
    payload=$(jq -n \
        --arg tool_name "$tool_name" \
        --arg tool_type "$tool_type" \
        --arg input "$input" \
        --arg output "$output" \
        --argjson exit_code "$exit_code" \
        --arg duration_ms "$duration_ms" \
        --argjson file_paths "$file_paths_json" \
        --arg session_id "$session_id" \
        --arg project_path "$project_path" \
        '{
            tool_name: $tool_name,
            tool_type: $tool_type,
            input: (if $input == "" then null else $input end),
            output: (if $output == "" then null else $output end),
            exit_code: $exit_code,
            duration_ms: (if $duration_ms == "" then null else ($duration_ms | tonumber) end),
            file_paths: $file_paths,
            session_id: (if $session_id == "" then null else $session_id end),
            project_path: $project_path
        }')

    # Send to API (fire and forget, don't block Claude Code)
    curl -s -X POST "$ENDPOINT" \
        -H "Content-Type: application/json" \
        -d "$payload" \
        --connect-timeout 1 \
        --max-time 2 \
        >/dev/null 2>&1 || true
}

# Run main function
main "$@"
