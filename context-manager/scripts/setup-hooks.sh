#!/bin/bash
# setup-hooks.sh - Configure Claude Code hooks for DCM integration
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOOKS_DIR="$PROJECT_DIR/hooks"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

echo "=== DCM Hooks Setup ==="
echo "Project: $PROJECT_DIR"
echo "Hooks: $HOOKS_DIR"
echo ""

# Make hook scripts executable
chmod +x "$HOOKS_DIR"/*.sh 2>/dev/null || true

# Check if jq is available
if ! command -v jq &>/dev/null; then
    echo "ERROR: jq not found. Install it first."
    echo "  Ubuntu/Debian: sudo apt install jq"
    echo "  macOS: brew install jq"
    exit 1
fi

# Check if settings.json exists
if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
    echo "WARNING: $CLAUDE_SETTINGS not found."
    echo "Claude Code may not be installed or configured."
    echo ""
    echo "To manually add hooks, add these to your settings.json PostToolUse:"
    echo ""
    echo '  {"matcher": "*", "hooks": [{"type": "command", "command": "bash '"$HOOKS_DIR"'/track-action.sh \"$TOOL_EXIT_CODE\""}]}'
    echo '  {"matcher": "Task", "hooks": [{"type": "command", "command": "bash '"$HOOKS_DIR"'/track-agent.sh"}]}'
    exit 0
fi

echo "Claude Code settings found at: $CLAUDE_SETTINGS"
echo ""

# Check if hooks are already configured
if grep -q "track-action.sh" "$CLAUDE_SETTINGS" 2>/dev/null; then
    echo "DCM hooks already configured in settings.json."
    echo "No changes needed."
else
    echo "DCM hooks NOT yet configured."
    echo ""
    echo "Add these hooks to your settings.json PostToolUse array:"
    echo ""
    echo "  Track all tool usage:"
    echo '    {"matcher": "*", "hooks": [{"type": "command", "command": "bash '"$HOOKS_DIR"'/track-action.sh \"$TOOL_EXIT_CODE\""}]}'
    echo ""
    echo "  Track agent spawning:"
    echo '    {"matcher": "Task", "hooks": [{"type": "command", "command": "bash '"$HOOKS_DIR"'/track-agent.sh"}]}'
    echo ""
    echo "  Track session start:"
    echo '    Add to SessionStart: {"type": "command", "command": "(nohup bash '"$HOOKS_DIR"'/track-session.sh >/dev/null 2>&1 &)"}'
fi

echo ""
echo "=== Hooks setup complete ==="
