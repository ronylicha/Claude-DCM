#!/bin/bash
# setup-hooks.sh - Auto-configure Claude Code hooks for DCM integration
# Automatically injects hooks into ~/.claude/settings.json using jq
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HOOKS_DIR="$PROJECT_DIR/hooks"
CLAUDE_SETTINGS="$HOME/.claude/settings.json"

echo "=== DCM Hooks Setup ==="
echo "Project: $PROJECT_DIR"
echo "Hooks:   $HOOKS_DIR"
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

# Create settings.json if it doesn't exist
if [[ ! -f "$CLAUDE_SETTINGS" ]]; then
    echo "Creating $CLAUDE_SETTINGS..."
    mkdir -p "$(dirname "$CLAUDE_SETTINGS")"
    echo '{}' > "$CLAUDE_SETTINGS"
fi

echo "Claude Code settings: $CLAUDE_SETTINGS"
echo ""

# Check if hooks are already configured
if grep -q "track-action.sh" "$CLAUDE_SETTINGS" 2>/dev/null && \
   grep -q "pre-compact-save.sh" "$CLAUDE_SETTINGS" 2>/dev/null; then
    echo "DCM hooks already configured. Skipping injection."
    echo ""
    echo "To force re-install, run: $0 --force"
    if [[ "${1:-}" != "--force" ]]; then
        exit 0
    fi
    echo "Force mode: re-injecting hooks..."
fi

# Backup current settings
BACKUP="${CLAUDE_SETTINGS}.bak.$(date +%Y%m%d%H%M%S)"
cp "$CLAUDE_SETTINGS" "$BACKUP"
echo "Backup: $BACKUP"
echo ""

# Build the complete hooks configuration
# We use jq to merge into existing settings without destroying other config
HOOKS_JSON=$(cat <<HOOKS_EOF
{
  "PostToolUse": [
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/track-action.sh",
          "timeout": 3
        }
      ]
    },
    {
      "matcher": "Task",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/track-agent.sh",
          "timeout": 3
        }
      ]
    },
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/monitor-context.sh",
          "timeout": 2
        }
      ]
    }
  ],
  "SessionStart": [
    {
      "matcher": "startup",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/ensure-services.sh",
          "timeout": 10
        }
      ]
    },
    {
      "matcher": "startup",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/track-session.sh",
          "timeout": 5
        }
      ]
    },
    {
      "matcher": "compact",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/post-compact-restore.sh",
          "timeout": 8
        }
      ]
    }
  ],
  "PreCompact": [
    {
      "matcher": "auto",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/pre-compact-save.sh",
          "timeout": 5
        }
      ]
    },
    {
      "matcher": "manual",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/pre-compact-save.sh",
          "timeout": 5
        }
      ]
    }
  ],
  "SubagentStop": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/save-agent-result.sh",
          "timeout": 3
        }
      ]
    }
  ],
  "SessionEnd": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/track-session-end.sh",
          "timeout": 3
        }
      ]
    }
  ]
}
HOOKS_EOF
)

# Merge hooks into existing settings using jq
# Strategy: deep merge - existing hooks for other events are preserved,
# DCM hooks are added/replaced
jq --argjson new_hooks "$HOOKS_JSON" '
  # Ensure hooks object exists
  .hooks //= {} |
  # For each event in new_hooks, replace or add
  .hooks.PostToolUse = (
    [(.hooks.PostToolUse // [])[] | select(
      (.hooks // []) | all(.command | test("track-action|track-agent|monitor-context") | not)
    )] + $new_hooks.PostToolUse
  ) |
  .hooks.SessionStart = (
    [(.hooks.SessionStart // [])[] | select(
      (.hooks // []) | all(.command | test("ensure-services|track-session|post-compact-restore") | not)
    )] + $new_hooks.SessionStart
  ) |
  .hooks.PreCompact = (
    [(.hooks.PreCompact // [])[] | select(
      (.hooks // []) | all(.command | test("pre-compact-save") | not)
    )] + $new_hooks.PreCompact
  ) |
  .hooks.SubagentStop = (
    [(.hooks.SubagentStop // [])[] | select(
      (.hooks // []) | all(.command | test("save-agent-result") | not)
    )] + $new_hooks.SubagentStop
  ) |
  .hooks.SessionEnd = (
    [(.hooks.SessionEnd // [])[] | select(
      (.hooks // []) | all(.command | test("track-session-end") | not)
    )] + $new_hooks.SessionEnd
  )
' "$CLAUDE_SETTINGS" > "${CLAUDE_SETTINGS}.tmp"

# Validate the generated JSON
if jq empty "${CLAUDE_SETTINGS}.tmp" 2>/dev/null; then
    mv "${CLAUDE_SETTINGS}.tmp" "$CLAUDE_SETTINGS"
    echo "Hooks injected successfully into $CLAUDE_SETTINGS"
else
    echo "ERROR: Generated invalid JSON. Restoring backup."
    cp "$BACKUP" "$CLAUDE_SETTINGS"
    rm -f "${CLAUDE_SETTINGS}.tmp"
    exit 1
fi

echo ""
echo "=== Hooks configured ==="
echo ""
echo "Hooks installed:"
echo "  PostToolUse:"
echo "    - track-action.sh     (all tools, tracks usage)"
echo "    - track-agent.sh      (Task tool, tracks agent spawns)"
echo "    - monitor-context.sh  (all tools, proactive compact monitoring)"
echo "  SessionStart:"
echo "    - ensure-services.sh  (startup, auto-starts DCM if not running)"
echo "    - track-session.sh  (startup, creates session hierarchy)"
echo "    - post-compact-restore.sh (compact, restores context from DCM)"
echo "  PreCompact:"
echo "    - pre-compact-save.sh (auto+manual, saves snapshot to DCM)"
echo "  SubagentStop:"
echo "    - save-agent-result.sh (saves agent results for cross-agent sharing)"
echo "  SessionEnd:"
echo "    - track-session-end.sh (cleanup)"
echo ""
echo "To verify: claude --debug (then check hook execution in logs)"
echo "To undo:   cp $BACKUP $CLAUDE_SETTINGS"
echo ""
echo "IMPORTANT: Restart Claude Code for hooks to take effect."
