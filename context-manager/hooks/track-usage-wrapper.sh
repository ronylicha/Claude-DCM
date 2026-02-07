#!/usr/bin/env bash
# Wrapper to preserve environment variables for background tracking
# Captures vars synchronously, then calls the actual tracker async

# Capture all relevant vars NOW (before going background)
_TOOL_NAME="${TOOL_NAME:-}"
_TOOL_INPUT="${TOOL_INPUT:-}"
_TOOL_OUTPUT="${TOOL_OUTPUT:-}"
_TOOL_EXIT_CODE="${TOOL_EXIT_CODE:-0}"
_TOOL_DURATION_MS="${TOOL_DURATION_MS:-}"
_TOOL_FILE_PATHS="${TOOL_FILE_PATHS:-}"
_SESSION_ID="${SESSION_ID:-}"
_PROJECT_DIR="${PROJECT_DIR:-$(pwd)}"

# Export and run in background
(
  export TOOL_NAME="$_TOOL_NAME"
  export TOOL_INPUT="$_TOOL_INPUT"
  export TOOL_OUTPUT="$_TOOL_OUTPUT"
  export TOOL_EXIT_CODE="$_TOOL_EXIT_CODE"
  export TOOL_DURATION_MS="$_TOOL_DURATION_MS"
  export TOOL_FILE_PATHS="$_TOOL_FILE_PATHS"
  export SESSION_ID="$_SESSION_ID"
  export PROJECT_DIR="$_PROJECT_DIR"

  bash ~/.claude/services/context-manager/hooks/track-usage.sh
) &>/dev/null &

exit 0
