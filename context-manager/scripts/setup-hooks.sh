#!/bin/bash
# setup-hooks.sh - Auto-configure Claude Code hooks for DCM integration
# Automatically injects hooks into ~/.claude/settings.json using jq
#
# Usage:
#   bash setup-hooks.sh                # Install (skip if already configured)
#   bash setup-hooks.sh --force        # Force reinstall
#   DCM_DEPLOY_DIR=/path/to bash setup-hooks.sh  # Custom deploy path
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Resolve hooks directory: prefer DCM_DEPLOY_DIR env, fallback to script location
# This ensures hooks always point to the DEPLOYMENT directory, not the dev one.
if [[ -n "${DCM_DEPLOY_DIR:-}" ]]; then
    HOOKS_DIR="${DCM_DEPLOY_DIR}/context-manager/hooks"
else
    # Auto-detect: if we're in ~/Projets/ (dev), use ~/Claude-DCM (deploy) if it exists
    DEPLOY_CANDIDATE="$HOME/Claude-DCM/context-manager/hooks"
    if [[ "$PROJECT_DIR" == *"/Projets/"* ]] && [[ -d "$DEPLOY_CANDIDATE" ]]; then
        HOOKS_DIR="$DEPLOY_CANDIDATE"
        echo "NOTE: Dev directory detected. Using deployment path: $HOOKS_DIR"
    else
        HOOKS_DIR="$PROJECT_DIR/hooks"
    fi
fi

CLAUDE_SETTINGS="$HOME/.claude/settings.json"

echo "=== DCM Hooks Setup ==="
echo "Project: $PROJECT_DIR"
echo "Hooks:   $HOOKS_DIR"
echo ""

# Make hook scripts executable
chmod +x "$HOOKS_DIR"/*.sh 2>/dev/null || true
chmod +x "$HOOKS_DIR"/skill-advisor/*.sh 2>/dev/null || true

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
HOOKS_JSON=$(cat <<HOOKS_EOF
{
  "PreToolUse": [
    {
      "matcher": "Agent",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/track-agent-start.sh",
          "timeout": 3
        }
      ]
    }
  ],
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
      "matcher": "Agent",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/track-agent.sh",
          "timeout": 3
        },
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/track-agent-end.sh",
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
    },
    {
      "matcher": "*",
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/track-agent-turns.sh",
          "timeout": 1
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
  "UserPromptSubmit": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/suggest-skills.sh",
          "timeout": 1
        },
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/skill-advisor/analyze.sh",
          "timeout": 1
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
  ],
  "Notification": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "bash ${HOOKS_DIR}/statusline-dcm.sh",
          "timeout": 2
        }
      ]
    }
  ]
}
HOOKS_EOF
)

# Merge hooks: operates at the INDIVIDUAL HOOK level inside each matcher.
# 1. For each event, for each matcher entry:
#    - Strip any hook whose .command matches a DCM path (old dev or old deploy)
#    - If the matcher entry has remaining hooks, keep it
# 2. Then add all new DCM matcher entries
# 3. Then consolidate: merge hooks[] with the same matcher value into one entry
#
# DCM path pattern: matches /Claude-DCM/ or /context-manager/hooks/ (dev and deploy)
DCM_HOOK_PATTERN="Claude-DCM|context-manager/hooks"

jq --argjson new_hooks "$HOOKS_JSON" --arg pat "$DCM_HOOK_PATTERN" '

  # Helper: strip DCM hooks from a single matcher entry, keep custom hooks
  def strip_dcm:
    .hooks = [.hooks[]? | select(.command | test($pat) | not)]
    | select(.hooks | length > 0);

  # Helper: clean an event array — strip DCM from each entry, then append new
  def clean_and_add($new):
    ([.[]? | strip_dcm] + $new)
    # Consolidate: group by matcher, merge hooks arrays
    | group_by(.matcher // "")
    | map(
        .[0] + { hooks: [.[] | .hooks[]?] | unique_by(.command) }
      );

  .hooks //= {} |
  .hooks.PreToolUse     = ((.hooks.PreToolUse     // []) | clean_and_add($new_hooks.PreToolUse)) |
  .hooks.PostToolUse    = ((.hooks.PostToolUse    // []) | clean_and_add($new_hooks.PostToolUse)) |
  .hooks.SessionStart   = ((.hooks.SessionStart   // []) | clean_and_add($new_hooks.SessionStart)) |
  .hooks.PreCompact     = ((.hooks.PreCompact     // []) | clean_and_add($new_hooks.PreCompact)) |
  .hooks.SubagentStop   = ((.hooks.SubagentStop   // []) | clean_and_add($new_hooks.SubagentStop)) |
  .hooks.UserPromptSubmit = ((.hooks.UserPromptSubmit // []) | clean_and_add($new_hooks.UserPromptSubmit)) |
  .hooks.SessionEnd     = ((.hooks.SessionEnd     // []) | clean_and_add($new_hooks.SessionEnd)) |
  .hooks.Notification   = ((.hooks.Notification   // []) | clean_and_add($new_hooks.Notification))

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
echo "Hooks source: $HOOKS_DIR"
echo ""
echo "Hooks installed:"
echo "  PreToolUse:"
echo "    - track-agent-start.sh  (Agent, tracks agent spawn)"
echo "  PostToolUse:"
echo "    - track-action.sh       (all tools, tracks usage)"
echo "    - track-agent.sh        (Agent, tracks agent lifecycle)"
echo "    - track-agent-end.sh    (Agent, tracks agent completion)"
echo "    - monitor-context.sh    (all tools, proactive compact monitoring)"
echo "    - track-agent-turns.sh  (all tools, counts agent turns)"
echo "  SessionStart:"
echo "    - ensure-services.sh    (startup, auto-starts DCM)"
echo "    - track-session.sh      (startup, registers session)"
echo "    - post-compact-restore.sh (compact, restores context)"
echo "  PreCompact:"
echo "    - pre-compact-save.sh   (auto+manual, saves snapshot)"
echo "  SubagentStop:"
echo "    - save-agent-result.sh  (broadcasts agent results)"
echo "  UserPromptSubmit:"
echo "    - suggest-skills.sh     (routing + catalog suggestions)"
echo "    - skill-advisor/analyze.sh (background Haiku analysis)"
echo "  SessionEnd:"
echo "    - track-session-end.sh  (cleanup)"
echo "  Notification:"
echo "    - statusline-dcm.sh     (status bar updates)"
echo ""
echo "To verify: claude --debug (check hook execution)"
echo "To undo:   cp $BACKUP $CLAUDE_SETTINGS"
echo ""
echo "IMPORTANT: Restart Claude Code for hooks to take effect."
