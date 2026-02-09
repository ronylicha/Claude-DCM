#!/usr/bin/env bash
# post-compact-restore.sh - SessionStart(compact) hook: restore context from DCM
# v3.0: Added scope injection at the top of the brief
#
# Claude Code Hook: SessionStart (matcher: compact)
#
# After Claude compacts, this hook fires and injects essential context back
# via the additionalContext JSON mechanism. Claude sees this context immediately
# after compact, preventing loss of critical session state.
#
# v3.0: If the agent has a registered scope, it's injected FIRST in the brief,
# followed by previous wave results, then contextual data.
#
# Input: JSON via stdin with session_id, transcript_path, source="compact"
# Output: JSON to stdout with hookSpecificOutput.additionalContext

set -uo pipefail

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"

# Read hook input from stdin
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

# Extract fields
session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)

[[ -z "$session_id" ]] && exit 0

# v3.0: Determine agent type from context (if available)
agent_type="${AGENT_TYPE:-orchestrator}"
agent_id="${AGENT_ID:-orchestrator}"

# v3.0: Try to fetch enriched context with scope injection
scope_brief=""
if [[ "$agent_type" != "orchestrator" ]]; then
    enrich_response=$(curl -s -X POST "${API_URL}/api/registry/enrich-context" \
        -H "Content-Type: application/json" \
        -d "$(jq -n \
            --arg agent_type "$agent_type" \
            --arg session_id "$session_id" \
            '{agent_type: $agent_type, session_id: $session_id}')" \
        --connect-timeout 2 \
        --max-time 3 2>/dev/null || echo "")

    if [[ -n "$enrich_response" ]]; then
        scope_brief=$(echo "$enrich_response" | jq -r '.enriched_context_markdown // empty' 2>/dev/null)
    fi
fi

# 1. Try to restore from DCM compact/restore endpoint (generates a full brief)
restore_response=$(curl -s -X POST "${API_URL}/api/compact/restore" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
        --arg session_id "$session_id" \
        --arg agent_id "$agent_id" \
        --arg agent_type "$agent_type" \
        '{
            session_id: $session_id,
            agent_id: $agent_id,
            agent_type: $agent_type,
            max_tokens: 3000
        }')" \
    --connect-timeout 2 \
    --max-time 5 2>/dev/null || echo "")

brief=""
if [[ -n "$restore_response" ]]; then
    brief=$(echo "$restore_response" | jq -r '.brief // empty' 2>/dev/null)
fi

# 2. If no brief from restore, try to get the saved snapshot directly
if [[ -z "$brief" ]]; then
    snapshot_response=$(curl -s "${API_URL}/api/compact/snapshot/${session_id}" \
        --connect-timeout 2 \
        --max-time 3 2>/dev/null || echo "")

    if [[ -n "$snapshot_response" ]]; then
        exists=$(echo "$snapshot_response" | jq -r '.exists // false' 2>/dev/null)
        if [[ "$exists" == "true" ]]; then
            snapshot=$(echo "$snapshot_response" | jq -r '.snapshot // empty' 2>/dev/null)
            summary=$(echo "$snapshot_response" | jq -r '.summary // empty' 2>/dev/null)

            # Build a minimal brief from the snapshot
            brief="## Context Restored After Compact\n\n"
            [[ -n "$summary" ]] && brief+="**Summary:** ${summary}\n\n"

            # Active tasks
            tasks=$(echo "$snapshot" | jq -r '.active_tasks // [] | .[] | "- [\(.status)] \(.description)"' 2>/dev/null)
            if [[ -n "$tasks" ]]; then
                brief+="### Active Tasks\n${tasks}\n\n"
            fi

            # Modified files
            files=$(echo "$snapshot" | jq -r '.modified_files // [] | .[] | "- \(.)"' 2>/dev/null)
            if [[ -n "$files" ]]; then
                brief+="### Modified Files\n${files}\n\n"
            fi

            # Agent states
            agents=$(echo "$snapshot" | jq -r '.agent_states // [] | .[] | "- \(.agent_type) (\(.agent_id)): \(.status) - \(.summary // "no summary")"' 2>/dev/null)
            if [[ -n "$agents" ]]; then
                brief+="### Agent States\n${agents}\n\n"
            fi

            # Key decisions
            decisions=$(echo "$snapshot" | jq -r '.key_decisions // [] | .[] | "- \(.)"' 2>/dev/null)
            if [[ -n "$decisions" ]]; then
                brief+="### Key Decisions\n${decisions}\n\n"
            fi
        fi
    fi
fi

# 3. If we still have no context, exit silently
if [[ -z "$brief" && -z "$scope_brief" ]]; then
    exit 0
fi

# v3.0: Combine scope (first) + contextual brief (after)
final_brief=""
if [[ -n "$scope_brief" ]]; then
    final_brief="${scope_brief}\n\n---\n\n"
fi
if [[ -n "$brief" ]]; then
    final_brief+="$brief"
fi

# Trim if empty
[[ -z "$final_brief" ]] && exit 0

# 4. Output JSON with additionalContext for Claude Code to inject
jq -n \
    --arg context "$final_brief" \
    '{
        hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: $context
        }
    }'

exit 0
