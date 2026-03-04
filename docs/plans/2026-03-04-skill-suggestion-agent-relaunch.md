# Skill Auto-Suggestion & Subagent Relaunch Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ajouter 2 fonctionnalites manquantes au DCM : (A) suggestion automatique de skills via hook UserPromptSubmit, (B) tracking des iterations subagent + relaunch automatique avec contexte compacte.

**Architecture:** Feature A utilise le hook UserPromptSubmit pour intercepter les prompts, extraire des keywords, et interroger l'API routing existante (`GET /api/routing/suggest`). Feature B ajoute une colonne `turns_used`/`max_turns` dans `subtasks`, un endpoint API pour tracker les tours, et un hook SubagentStop pour relancer les agents epuises avec contexte compacte.

**Tech Stack:** Bash (hooks), TypeScript/Hono (API), PostgreSQL (migrations), Bun (runtime)

---

## Feature A : Skill Auto-Suggestion

### Task 1: Hook suggest-skills.sh

**Files:**
- Create: `/home/rony/Claude-DCM/context-manager/hooks/suggest-skills.sh`

**Step 1: Create the hook script**

```bash
#!/usr/bin/env bash
# suggest-skills.sh - UserPromptSubmit hook: suggest relevant skills
# v1.0: Extracts keywords from user prompt, queries DCM routing API
#
# Claude Code Hook: UserPromptSubmit
# Output: additionalContext with skill suggestions
# Timeout budget: 400ms (500ms max - 100ms margin)

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"

# Read hook input from stdin
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

# Extract user prompt
user_prompt=$(echo "$RAW_INPUT" | jq -r '.user_prompt // .prompt // empty' 2>/dev/null)
[[ -z "$user_prompt" ]] && exit 0

# Check circuit breaker
dcm_api_available || exit 0

# Extract keywords: split by spaces, filter stop-words, keep words > 3 chars
STOP_WORDS="le|la|les|de|du|des|un|une|en|et|ou|je|tu|il|nous|vous|ils|the|is|are|was|were|be|been|have|has|had|do|does|did|will|would|shall|should|can|could|may|might|must|with|for|from|into|that|this|what|which|who|whom|when|where|how|not|all|each|every|both|few|more|most|some|any|and|but|nor|yet|also|just|then|than|too|very|bien|tout|tres|fait|fais|faire|dans|pour|avec|sur|par|pas|plus|sont|est|suis|etre|avoir"

keywords=$(echo "$user_prompt" | \
    tr '[:upper:]' '[:lower:]' | \
    tr -cs '[:alnum:]' ' ' | \
    tr ' ' '\n' | \
    grep -vwE "^($STOP_WORDS)$" | \
    awk 'length > 3' | \
    sort -u | \
    head -15 | \
    paste -sd ',' -)

[[ -z "$keywords" ]] && exit 0

# Query DCM routing API (timeout 400ms = 0.4s)
response=$(curl -s --connect-timeout 0.3 --max-time 0.4 \
    "${API_URL}/api/routing/suggest?keywords=${keywords}&limit=5&min_score=0.5&tool_type=skill" \
    2>/dev/null) || { dcm_api_failed; exit 0; }

dcm_api_success

# Parse suggestions
count=$(echo "$response" | jq -r '.count // 0' 2>/dev/null)
[[ "$count" == "0" || -z "$count" ]] && exit 0

# Build suggestion message
auto_invoke=""
consider=""

while IFS= read -r line; do
    name=$(echo "$line" | jq -r '.tool_name' 2>/dev/null)
    score=$(echo "$line" | jq -r '.score' 2>/dev/null)

    if (( $(echo "$score >= 0.8" | bc -l 2>/dev/null || echo 0) )); then
        auto_invoke="${auto_invoke}${auto_invoke:+, }${name}"
    else
        consider="${consider}${consider:+, }${name}"
    fi
done < <(echo "$response" | jq -c '.suggestions[]' 2>/dev/null)

# Build additionalContext
context_parts=""
if [[ -n "$auto_invoke" ]]; then
    context_parts="DCM Skill Auto-Suggestion: INVOKE these skills (high confidence): ${auto_invoke}."
fi
if [[ -n "$consider" ]]; then
    context_parts="${context_parts}${context_parts:+ }Consider these skills (moderate confidence): ${consider}."
fi

[[ -z "$context_parts" ]] && exit 0

# Output as Claude Code hook format
cat <<EOF
{"hookSpecificOutput":{"additionalContext":"${context_parts}"}}
EOF

exit 0
```

**Step 2: Make executable**

Run: `chmod +x /home/rony/Claude-DCM/context-manager/hooks/suggest-skills.sh`

**Step 3: Test manually**

Run: `echo '{"user_prompt":"je veux creer un composant react avec du tailwind"}' | bash /home/rony/Claude-DCM/context-manager/hooks/suggest-skills.sh`
Expected: JSON with hookSpecificOutput containing skill suggestions (or empty if no matching keywords in DB)

**Step 4: Commit**

```bash
cd /home/rony/Claude-DCM
git add context-manager/hooks/suggest-skills.sh
git commit -m "feat(hooks): add suggest-skills.sh for UserPromptSubmit skill auto-suggestion"
```

---

### Task 2: Register hook in hooks.json

**Files:**
- Modify: `/home/rony/Claude-DCM/context-manager/hooks/hooks.json`

**Step 1: Add UserPromptSubmit entry**

Add this block at the end of the `hooks` object, after the `SessionEnd` block:

```json
"UserPromptSubmit": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/suggest-skills.sh",
        "timeout": 1
      }
    ]
  }
]
```

**Step 2: Validate JSON syntax**

Run: `jq '.' /home/rony/Claude-DCM/context-manager/hooks/hooks.json > /dev/null && echo "OK"`
Expected: OK

**Step 3: Commit**

```bash
cd /home/rony/Claude-DCM
git add context-manager/hooks/hooks.json
git commit -m "feat(hooks): register suggest-skills.sh in UserPromptSubmit"
```

---

## Feature B : Subagent Iteration Tracking & Relaunch

### Task 3: Database migration for turns tracking

**Files:**
- Create: `/home/rony/Claude-DCM/context-manager/src/db/migrations/006_agent_turns_tracking.sql`

**Step 1: Create migration file**

```sql
-- DCM v3.2.0 - Agent Turns Tracking: turns_used, max_turns, relaunch support
-- Migration: 006_agent_turns_tracking.sql

-- Add turns tracking columns to subtasks
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS turns_used INTEGER DEFAULT 0;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS max_turns INTEGER;
ALTER TABLE subtasks ADD COLUMN IF NOT EXISTS last_relaunch_context TEXT;

-- Index for fast lookup of running agents by agent_id
CREATE INDEX IF NOT EXISTS idx_subtasks_agent_id_status ON subtasks(agent_id, status);

-- Update schema version
UPDATE schema_version SET version = '3.2.0', updated_at = NOW() WHERE id = 1;

COMMENT ON COLUMN subtasks.turns_used IS 'Number of tool calls consumed by this agent';
COMMENT ON COLUMN subtasks.max_turns IS 'Maximum turns budget for this agent (from complexity tier)';
COMMENT ON COLUMN subtasks.last_relaunch_context IS 'Compacted context from previous attempt for relaunch';
```

**Step 2: Run migration**

Run: `cd /home/rony/Claude-DCM/context-manager && psql -h 127.0.0.1 -U dcm -d dcm_db -f src/db/migrations/006_agent_turns_tracking.sql`
Expected: ALTER TABLE, CREATE INDEX, UPDATE 1

**Step 3: Verify columns exist**

Run: `psql -h 127.0.0.1 -U dcm -d dcm_db -c "\d subtasks" | grep -E "turns_used|max_turns|last_relaunch"`
Expected: 3 lines showing the new columns

**Step 4: Commit**

```bash
cd /home/rony/Claude-DCM
git add context-manager/src/db/migrations/006_agent_turns_tracking.sql
git commit -m "feat(db): add turns_used, max_turns, last_relaunch_context to subtasks"
```

---

### Task 4: API endpoint for agent turns tracking

**Files:**
- Create: `/home/rony/Claude-DCM/context-manager/src/api/agents.ts`
- Modify: `/home/rony/Claude-DCM/context-manager/src/server.ts`

**Step 1: Create agents.ts API module**

```typescript
/**
 * Agents API - Track turns, relaunch agents
 * Phase 10 - Subagent iteration management
 * @module api/agents
 */

import type { Context } from "hono";
import { getDb } from "../db/client";
import { createLogger } from "../lib/logger";

const log = createLogger("Agents");

/**
 * POST /api/agents/track-turn - Increment turns_used for a running agent
 * Body: { agent_id: string, session_id?: string }
 * Returns: { turns_used, max_turns, should_warn, should_stop }
 */
export async function trackAgentTurn(c: Context): Promise<Response> {
  try {
    const body = await c.req.json() as { agent_id: string; session_id?: string };

    if (!body.agent_id) {
      return c.json({ error: "Missing agent_id" }, 400);
    }

    const sql = getDb();

    // Increment turns_used and return current state
    const result = await sql`
      UPDATE subtasks
      SET turns_used = COALESCE(turns_used, 0) + 1
      WHERE agent_id = ${body.agent_id}
        AND status = 'running'
      RETURNING id, agent_type, turns_used, max_turns, retry_count
    `;

    if (result.length === 0) {
      return c.json({ error: "No running subtask found for agent_id" }, 404);
    }

    const row = result[0];
    const turnsUsed = Number(row.turns_used);
    const maxTurns = row.max_turns ? Number(row.max_turns) : null;

    const shouldWarn = maxTurns !== null && turnsUsed >= Math.floor(maxTurns * 0.8);
    const shouldStop = maxTurns !== null && turnsUsed >= maxTurns;

    return c.json({
      agent_id: body.agent_id,
      agent_type: row.agent_type,
      subtask_id: row.id,
      turns_used: turnsUsed,
      max_turns: maxTurns,
      retry_count: Number(row.retry_count),
      should_warn: shouldWarn,
      should_stop: shouldStop,
    });
  } catch (error) {
    log.error("POST /api/agents/track-turn error:", error);
    return c.json({ error: "Failed to track turn" }, 500);
  }
}

/**
 * GET /api/agents/:agent_id/status - Get agent iteration status
 */
export async function getAgentStatus(c: Context): Promise<Response> {
  try {
    const agentId = c.req.param("agent_id");
    const sql = getDb();

    const result = await sql`
      SELECT id, agent_type, agent_id, status, turns_used, max_turns,
             retry_count, description, last_relaunch_context,
             started_at, completed_at
      FROM subtasks
      WHERE agent_id = ${agentId}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (result.length === 0) {
      return c.json({ error: "Agent not found" }, 404);
    }

    return c.json({ agent: result[0] });
  } catch (error) {
    log.error("GET /api/agents/:agent_id/status error:", error);
    return c.json({ error: "Failed to get agent status" }, 500);
  }
}

/**
 * POST /api/agents/relaunch - Prepare relaunch context for an exhausted agent
 * Body: { agent_id: string, partial_result?: string }
 * Returns: { should_relaunch, retry_count, relaunch_prompt, original_description }
 */
export async function relaunchAgent(c: Context): Promise<Response> {
  try {
    const body = await c.req.json() as {
      agent_id: string;
      partial_result?: string;
    };

    if (!body.agent_id) {
      return c.json({ error: "Missing agent_id" }, 400);
    }

    const sql = getDb();

    // Get the agent's current state
    const result = await sql`
      SELECT id, agent_type, agent_id, description, turns_used, max_turns,
             retry_count, result, last_relaunch_context
      FROM subtasks
      WHERE agent_id = ${body.agent_id}
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (result.length === 0) {
      return c.json({ error: "Agent not found" }, 404);
    }

    const agent = result[0];
    const retryCount = Number(agent.retry_count);
    const maxRetries = 2; // 3 attempts total

    if (retryCount >= maxRetries) {
      return c.json({
        should_relaunch: false,
        reason: "max_retries_exceeded",
        retry_count: retryCount,
        max_retries: maxRetries,
        agent_type: agent.agent_type,
        description: agent.description,
      });
    }

    // Build compacted context from partial result
    const partialResult = body.partial_result || "";
    const previousContext = agent.last_relaunch_context || "";
    const compactedContext = [
      previousContext ? `Previous attempt context: ${previousContext}` : "",
      partialResult ? `Partial result from attempt ${retryCount + 1}: ${partialResult}` : "",
    ].filter(Boolean).join("\n").slice(0, 2000);

    // Update retry_count and save relaunch context
    await sql`
      UPDATE subtasks
      SET retry_count = retry_count + 1,
          last_relaunch_context = ${compactedContext},
          status = 'failed',
          completed_at = NOW()
      WHERE id = ${agent.id}
    `;

    // Build enriched prompt for the new agent
    const relaunchPrompt = [
      `RELAUNCH (attempt ${retryCount + 2}/3) - Continue the following task:`,
      `Original task: ${agent.description}`,
      compactedContext ? `\nContext from previous attempt(s):\n${compactedContext}` : "",
      `\nContinue where the previous agent left off. Do NOT restart from scratch.`,
    ].filter(Boolean).join("\n");

    return c.json({
      should_relaunch: true,
      retry_count: retryCount + 1,
      max_retries: maxRetries,
      agent_type: agent.agent_type,
      original_description: agent.description,
      relaunch_prompt: relaunchPrompt,
      max_turns: agent.max_turns,
    });
  } catch (error) {
    log.error("POST /api/agents/relaunch error:", error);
    return c.json({ error: "Failed to prepare relaunch" }, 500);
  }
}
```

**Step 2: Register routes in server.ts**

Add import at top of server.ts (after the orchestration-planner import):

```typescript
import { trackAgentTurn, getAgentStatus, relaunchAgent } from "./api/agents";
```

Add route registrations (after the Wave Management section, before Server Startup):

```typescript
// ============================================
// Agent Turns & Relaunch API - Phase 10
// ============================================

// POST /api/agents/track-turn - Increment turn counter for running agent
app.post("/api/agents/track-turn", trackAgentTurn);

// GET /api/agents/:agent_id/status - Get agent iteration status
app.get("/api/agents/:agent_id/status", getAgentStatus);

// POST /api/agents/relaunch - Prepare relaunch context
app.post("/api/agents/relaunch", relaunchAgent);
```

**Step 3: Restart DCM API to load new routes**

Run: `cd /home/rony/Claude-DCM/context-manager && kill $(cat .pids/api.pid 2>/dev/null) 2>/dev/null; bun run src/server.ts &`

**Step 4: Test endpoints**

Run: `curl -s http://127.0.0.1:3847/api/agents/test-agent/status | jq .`
Expected: `{"error":"Agent not found"}` with 404 (correct — no agent running)

**Step 5: Commit**

```bash
cd /home/rony/Claude-DCM
git add context-manager/src/api/agents.ts context-manager/src/server.ts
git commit -m "feat(api): add agent turns tracking and relaunch endpoints"
```

---

### Task 5: Hook track-agent-turns.sh

**Files:**
- Create: `/home/rony/Claude-DCM/context-manager/hooks/track-agent-turns.sh`

**Step 1: Create the hook script**

```bash
#!/usr/bin/env bash
# track-agent-turns.sh - PostToolUse hook: increment turn counter for running agents
# v1.0: Tracks tool calls per agent, warns at 80% capacity, flags at 100%
#
# Claude Code Hook: PostToolUse (matcher: *)
# Fires on every tool use, but only acts when inside a subagent (CLAUDE_AGENT_ID set)

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"

# Only track when running inside a subagent
agent_id="${CLAUDE_AGENT_ID:-}"
[[ -z "$agent_id" ]] && exit 0

# Rate limit: only track every 3rd call to reduce API load
COUNTER_FILE="/tmp/.dcm-turns-${agent_id}"
count=0
[[ -f "$COUNTER_FILE" ]] && count=$(cat "$COUNTER_FILE" 2>/dev/null || echo "0")
count=$((count + 1))
echo "$count" > "$COUNTER_FILE" 2>/dev/null

# Only call API every 3rd tool use
(( count % 3 != 0 )) && exit 0

# Check circuit breaker
dcm_api_available || exit 0

# Track turn (fire-and-forget with fast timeout)
response=$(curl -s -X POST "${API_URL}/api/agents/track-turn" \
    -H "Content-Type: application/json" \
    -d "{\"agent_id\":\"${agent_id}\"}" \
    --connect-timeout 0.2 --max-time 0.3 2>/dev/null) || { dcm_api_failed; exit 0; }

dcm_api_success

# Check if we should warn
should_warn=$(echo "$response" | jq -r '.should_warn // false' 2>/dev/null)
should_stop=$(echo "$response" | jq -r '.should_stop // false' 2>/dev/null)
turns_used=$(echo "$response" | jq -r '.turns_used // 0' 2>/dev/null)
max_turns=$(echo "$response" | jq -r '.max_turns // "null"' 2>/dev/null)

if [[ "$should_stop" == "true" ]]; then
    cat <<EOF
{"hookSpecificOutput":{"systemMessage":"WARNING: Agent ${agent_id} has reached max_turns (${turns_used}/${max_turns}). Complete current work and return results immediately."}}
EOF
elif [[ "$should_warn" == "true" ]]; then
    cat <<EOF
{"hookSpecificOutput":{"systemMessage":"INFO: Agent ${agent_id} approaching turn limit (${turns_used}/${max_turns}). Start wrapping up."}}
EOF
fi

exit 0
```

**Step 2: Make executable**

Run: `chmod +x /home/rony/Claude-DCM/context-manager/hooks/track-agent-turns.sh`

**Step 3: Commit**

```bash
cd /home/rony/Claude-DCM
git add context-manager/hooks/track-agent-turns.sh
git commit -m "feat(hooks): add track-agent-turns.sh for subagent iteration tracking"
```

---

### Task 6: Hook relaunch-agent.sh

**Files:**
- Create: `/home/rony/Claude-DCM/context-manager/hooks/relaunch-agent.sh`

**Step 1: Create the hook script**

```bash
#!/usr/bin/env bash
# relaunch-agent.sh - SubagentStop hook: detect max_turns exhaustion and trigger relaunch
# v1.0: Checks if agent stopped due to turn limit, prepares relaunch with compacted context
#
# Claude Code Hook: SubagentStop
# Output: additionalContext with relaunch instructions if applicable

set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"

# Read hook input from stdin
RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

session_id=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
transcript_path=$(echo "$RAW_INPUT" | jq -r '.transcript_path // empty' 2>/dev/null)

[[ -z "$session_id" ]] && exit 0

# Check circuit breaker
dcm_api_available || exit 0

# Extract the agent info from transcript
agent_type=""
agent_id=""
last_result=""

if [[ -n "$transcript_path" && -f "$transcript_path" ]]; then
    # Get the last Task tool call to find agent info
    last_task_input=$(jq -s '[.[] | select(.type == "tool_use" and .name == "Task")] | last | .input // {}' \
        "$transcript_path" 2>/dev/null || echo "{}")

    agent_type=$(echo "$last_task_input" | jq -r '.subagent_type // empty' 2>/dev/null || echo "")

    # Get last Task result for partial context
    last_result=$(jq -s '[.[] | select(.type == "tool_result" and .tool_name == "Task")] | last | .content // empty' \
        "$transcript_path" 2>/dev/null | head -c 1500 || echo "")
fi

[[ -z "$agent_type" ]] && exit 0

# Find the agent's subtask to check turn status
subtask_response=$(curl -s "${API_URL}/api/subtasks?agent_type=${agent_type}&status=running&limit=1" \
    --connect-timeout 0.3 --max-time 0.5 2>/dev/null || echo '{"subtasks":[]}')

agent_id=$(echo "$subtask_response" | jq -r '.subtasks[0].agent_id // empty' 2>/dev/null)
[[ -z "$agent_id" ]] && exit 0

# Check agent status
status_response=$(curl -s "${API_URL}/api/agents/${agent_id}/status" \
    --connect-timeout 0.3 --max-time 0.5 2>/dev/null || echo '{}')

turns_used=$(echo "$status_response" | jq -r '.agent.turns_used // 0' 2>/dev/null)
max_turns=$(echo "$status_response" | jq -r '.agent.max_turns // "null"' 2>/dev/null)

# Only relaunch if agent hit max_turns (not just normal completion)
if [[ "$max_turns" == "null" || -z "$max_turns" ]]; then
    exit 0
fi

if (( turns_used < max_turns )); then
    # Agent completed normally before hitting limit
    exit 0
fi

# Agent exhausted its turns — attempt relaunch
relaunch_response=$(curl -s -X POST "${API_URL}/api/agents/relaunch" \
    -H "Content-Type: application/json" \
    -d "$(jq -n --arg agent_id "$agent_id" --arg partial "$last_result" \
        '{agent_id: $agent_id, partial_result: $partial}')" \
    --connect-timeout 0.3 --max-time 0.5 2>/dev/null || echo '{}')

dcm_api_success

should_relaunch=$(echo "$relaunch_response" | jq -r '.should_relaunch // false' 2>/dev/null)

if [[ "$should_relaunch" == "true" ]]; then
    retry_count=$(echo "$relaunch_response" | jq -r '.retry_count // 0' 2>/dev/null)
    relaunch_prompt=$(echo "$relaunch_response" | jq -r '.relaunch_prompt // empty' 2>/dev/null)
    original_agent_type=$(echo "$relaunch_response" | jq -r '.agent_type // empty' 2>/dev/null)
    relaunch_max_turns=$(echo "$relaunch_response" | jq -r '.max_turns // "null"' 2>/dev/null)

    # Escape for JSON
    escaped_prompt=$(echo "$relaunch_prompt" | jq -Rs '.' 2>/dev/null)

    cat <<EOF
{"hookSpecificOutput":{"additionalContext":"RELAUNCH REQUIRED: Agent ${original_agent_type} exhausted its turn budget (attempt ${retry_count}/3). Relaunch with: subagent_type=${original_agent_type}, max_turns=${relaunch_max_turns}, prompt=${escaped_prompt}"}}
EOF
else
    reason=$(echo "$relaunch_response" | jq -r '.reason // "unknown"' 2>/dev/null)
    original_desc=$(echo "$relaunch_response" | jq -r '.description // empty' 2>/dev/null)

    cat <<EOF
{"hookSpecificOutput":{"additionalContext":"AGENT FAILED: Agent ${agent_type} failed after 3 attempts. Reason: ${reason}. Original task: ${original_desc}. Manual intervention required."}}
EOF
fi

# Cleanup counter file
rm -f "/tmp/.dcm-turns-${agent_id}" 2>/dev/null

exit 0
```

**Step 2: Make executable**

Run: `chmod +x /home/rony/Claude-DCM/context-manager/hooks/relaunch-agent.sh`

**Step 3: Commit**

```bash
cd /home/rony/Claude-DCM
git add context-manager/hooks/relaunch-agent.sh
git commit -m "feat(hooks): add relaunch-agent.sh for subagent auto-relaunch on max_turns"
```

---

### Task 7: Register new hooks in hooks.json

**Files:**
- Modify: `/home/rony/Claude-DCM/context-manager/hooks/hooks.json`

**Step 1: Add track-agent-turns.sh to PostToolUse**

In the `PostToolUse` array, add a new entry after the existing `monitor-context.sh` block:

```json
{
  "matcher": "*",
  "hooks": [
    {
      "type": "command",
      "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/track-agent-turns.sh",
      "timeout": 1
    }
  ]
}
```

**Step 2: Add relaunch-agent.sh to SubagentStop**

In the `SubagentStop` array, add a second hook entry after the existing `save-agent-result.sh`:

```json
{
  "hooks": [
    {
      "type": "command",
      "command": "bash ${CLAUDE_PLUGIN_ROOT}/hooks/relaunch-agent.sh",
      "timeout": 2
    }
  ]
}
```

**Step 3: Validate JSON syntax**

Run: `jq '.' /home/rony/Claude-DCM/context-manager/hooks/hooks.json > /dev/null && echo "OK"`
Expected: OK

**Step 4: Commit**

```bash
cd /home/rony/Claude-DCM
git add context-manager/hooks/hooks.json
git commit -m "feat(hooks): register track-agent-turns and relaunch-agent in hooks.json"
```

---

### Task 8: Wire max_turns into track-agent-start.sh

**Files:**
- Modify: `/home/rony/Claude-DCM/context-manager/hooks/track-agent-start.sh`

**Step 1: Extract max_turns from tool_input and pass to subtask creation**

In `track-agent-start.sh`, after line 31 (`description=...`), add:

```bash
max_turns=$(echo "$tool_input" | jq -r '.max_turns // empty' 2>/dev/null || echo "")
```

Then modify the `subtask_payload` construction (line 115-122) to include max_turns:

```bash
subtask_payload=$(jq -n \
    --arg task_id "$task_id" \
    --arg agent_type "$agent_type" \
    --arg agent_id "$agent_id" \
    --arg description "$description" \
    --arg parent_agent_id "$parent_agent_id" \
    --arg max_turns "$max_turns" \
    '{task_id: $task_id, agent_type: $agent_type, agent_id: $agent_id, description: $description, status: "running"}
    | if $parent_agent_id != "" then . + {parent_agent_id: $parent_agent_id} else . end
    | if $max_turns != "" then . + {max_turns: ($max_turns | tonumber)} else . end')
```

**Step 2: Update subtasks API to accept max_turns**

In `/home/rony/Claude-DCM/context-manager/src/api/subtasks.ts`, find the Zod schema for `SubtaskInput` and add:

```typescript
max_turns: z.number().int().positive().optional(),
```

Then in the INSERT query of `postSubtask`, add `max_turns` to the columns.

**Step 3: Commit**

```bash
cd /home/rony/Claude-DCM
git add context-manager/hooks/track-agent-start.sh context-manager/src/api/subtasks.ts
git commit -m "feat: wire max_turns from Agent tool input through to subtask creation"
```

---

### Task 9: Integration test

**Step 1: Verify all hooks are registered**

Run: `jq '.hooks | keys' /home/rony/Claude-DCM/context-manager/hooks/hooks.json`
Expected: Array containing `UserPromptSubmit`, `SubagentStop` with new hooks

**Step 2: Verify API endpoints**

Run: `curl -s http://127.0.0.1:3847/health | jq .status`
Expected: "healthy"

Run: `curl -s -X POST http://127.0.0.1:3847/api/agents/track-turn -H "Content-Type: application/json" -d '{"agent_id":"test-nonexistent"}' | jq .`
Expected: `{"error":"No running subtask found for agent_id"}` (404)

Run: `curl -s http://127.0.0.1:3847/api/agents/test-nonexistent/status | jq .`
Expected: `{"error":"Agent not found"}` (404)

Run: `curl -s -X POST http://127.0.0.1:3847/api/agents/relaunch -H "Content-Type: application/json" -d '{"agent_id":"test-nonexistent"}' | jq .`
Expected: `{"error":"Agent not found"}` (404)

**Step 3: Verify suggest-skills hook**

Run: `echo '{"user_prompt":"test prompt with react and typescript"}' | bash /home/rony/Claude-DCM/context-manager/hooks/suggest-skills.sh`
Expected: Either JSON with suggestions or empty (depending on keyword_tool_scores data)

**Step 4: Final commit**

```bash
cd /home/rony/Claude-DCM
git add -A
git commit -m "feat: complete skill auto-suggestion + subagent relaunch implementation"
```

---

## Decision Log

| Decision | Alternatives | Reason |
|----------|-------------|--------|
| Hook UserPromptSubmit + API routing existante | Parser serveur avec endpoint dedie | L'API routing existe deja |
| Extraction keywords par split simple | NLP/embeddings | YAGNI + contrainte 500ms |
| Auto-invocation si score >= 0.8 | Toujours auto-invoquer | Balance automatisation/controle |
| 3-5 skills max | Illimite | Evite le bruit |
| Tracking tours via PostToolUse + API | WebSocket push | Over-engineering |
| Relaunch avec nouveau agent + contexte | Resume du meme agent | Resume ne permet pas d'injecter du contexte compacte |
| Max 2 relaunches (3 tentatives) | 1 ou 3 | Equilibre cout/perseverance |
| Rate limit tracking every 3rd call | Every call | Reduit charge API, 500ms budget |
| Colonne turns_used dans subtasks | Table separee | Simplicite, donnees liees |
