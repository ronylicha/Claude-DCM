---
# Monitored Agent Template for DCM (Distributed Context Manager)
# Copy this file and customize for each new agent type.
#
# The hooks below enable full tracking of tool calls inside the subagent.
# PreToolUse fires BEFORE each tool call, PostToolUse fires AFTER.

hooks:
  PreToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: "bash ${CLAUDE_PLUGIN_ROOT:-~/.claude/plugins/dcm}/hooks/safety-gate.sh"
          timeout: 2000
  PostToolUse:
    - matcher: ".*"
      hooks:
        - type: command
          command: "bash ${CLAUDE_PLUGIN_ROOT:-~/.claude/plugins/dcm}/hooks/track-action.sh"
          timeout: 3000
---

# Agent: [YOUR_AGENT_NAME]

## Role
[Describe the agent's purpose and responsibilities]

## Capabilities
- [List specific capabilities]

## Constraints
- All tool calls are tracked by DCM hooks
- Dangerous operations (rm -rf, DROP DATABASE, .env access) are blocked by safety-gate
- Results are automatically broadcast to other agents on completion

## Instructions
[Add agent-specific instructions here]
