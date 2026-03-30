#!/usr/bin/env bash
#
# skill-gate-status.sh — UserPromptSubmit hook
# Queries DCM API /api/skill-gate/:sid/status and injects workflow state
# + advisor recommendations into the systemMessage.
# Replaces: enforce-claude-rules.sh
#
# Timeout: 500ms
#
set -uo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$HOOK_DIR/lib/circuit-breaker.sh" 2>/dev/null || true

readonly API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"

RAW_INPUT=$(cat 2>/dev/null || echo "")
[[ -z "$RAW_INPUT" ]] && exit 0

SESSION_ID=$(echo "$RAW_INPUT" | jq -r '.session_id // empty' 2>/dev/null)
[[ -z "$SESSION_ID" ]] && exit 0

if ! dcm_api_available; then
  # Fallback: minimal rules injection
  cat <<'FALLBACK'
{"decision":"approve","reason":"rules-injected-fallback","systemMessage":"WORKFLOW: 1) Skills avant code 2) impact-analyzer avant Moyenne+ 3) regression-guard apres 4) Delegation fractionnee 5) 1 agent = 1 fichier = 1 action"}
FALLBACK
  exit 0
fi

RESPONSE=$(curl -s \
  --connect-timeout 0.3 \
  --max-time 0.5 \
  "${API_URL}/api/skill-gate/${SESSION_ID}/status" 2>/dev/null || echo "")

if [[ -z "$RESPONSE" ]] || ! echo "$RESPONSE" | jq empty 2>/dev/null; then
  dcm_api_failed
  cat <<'FALLBACK'
{"decision":"approve","reason":"rules-injected-fallback","systemMessage":"WORKFLOW: 1) Skills avant code 2) impact-analyzer avant Moyenne+ 3) regression-guard apres 4) Delegation fractionnee"}
FALLBACK
  exit 0
fi

dcm_api_success

# Extract fields
SKILLS_COUNT=$(echo "$RESPONSE" | jq -r '.skills_count // 0' 2>/dev/null)
SKILLS_LIST=$(echo "$RESPONSE" | jq -r '.skills // [] | join(", ")' 2>/dev/null)
IMPACT=$(echo "$RESPONSE" | jq -r '.workflow.impact_analyzer // false' 2>/dev/null)
REGRESSION=$(echo "$RESPONSE" | jq -r '.workflow.regression_guard // false' 2>/dev/null)
ADVISOR_FRESH=$(echo "$RESPONSE" | jq -r '.advisor_fresh // false' 2>/dev/null)

# Status indicators
SKILLS_ICON="✗"
[[ "$SKILLS_COUNT" != "0" ]] && SKILLS_ICON="✓(${SKILLS_COUNT})"
IMPACT_ICON="✗"
[[ "$IMPACT" == "true" ]] && IMPACT_ICON="✓"
REGRESSION_ICON="✗"
[[ "$REGRESSION" == "true" ]] && REGRESSION_ICON="✓"

# Build system message
SYS_MSG="=== ENFORCEMENT [session:${SESSION_ID:0:8}] ===\n\nETAT: Skills=${SKILLS_ICON} | Impact=${IMPACT_ICON} | Regression=${REGRESSION_ICON}\nSkills charges: ${SKILLS_LIST:-aucun}\n\nWORKFLOW OBLIGATOIRE:\n1. TASK SIZING: Triviale/Simple/Moyenne/Large\n2. SKILLS: Skill('workflow-clean-code') + domaine\n3. IMPACT-ANALYZER si Moyenne+\n4. DELEGUER: 1 agent = 1 fichier = 1 action, prompt < 200 mots\n5. REGRESSION-GUARD si Moyenne+\n6. SYNTHESE 2-3 lignes\n\nBLOCAGE ACTIF: Edit/Write/Agent refuses si skills non charges ou mauvais agent."

# Add advisor section if fresh
if [[ "$ADVISOR_FRESH" == "true" ]]; then
  RECO_COMPLEXITY=$(echo "$RESPONSE" | jq -r '.advisor.complexity // "?"' 2>/dev/null)
  RECO_DOMAINS=$(echo "$RESPONSE" | jq -r '.advisor.domains_detected // [] | join(", ")' 2>/dev/null)
  RECO_SKILLS=$(echo "$RESPONSE" | jq -r '[.advisor.required_skills[]? | "\(.skill) [\(.priority)]"] | join(", ")' 2>/dev/null)
  RECO_AGENTS=$(echo "$RESPONSE" | jq -r '[.advisor.recommended_agents[]? | "\(.agent) [\(.for_domain)]"] | join(", ")' 2>/dev/null)
  RECO_ALT=$(echo "$RESPONSE" | jq -r '.advisor.alternative_agents // [] | join(", ")' 2>/dev/null)
  RECO_SUMMARY=$(echo "$RESPONSE" | jq -r '.advisor.summary // ""' 2>/dev/null)
  RECO_ORCH=$(echo "$RESPONSE" | jq -r '.advisor.needs_orchestrate // false' 2>/dev/null)
  RECO_TEMPLATE=$(echo "$RESPONSE" | jq -r '.advisor.orchestrate_template // ""' 2>/dev/null)

  SYS_MSG="${SYS_MSG}\n\n=== SKILL-ADVISOR AI + DCM ===\nComplexite: ${RECO_COMPLEXITY} | Domaines: ${RECO_DOMAINS}\nSkills a charger: ${RECO_SKILLS}\nAgents IMPOSES: ${RECO_AGENTS}\nAlternatifs: ${RECO_ALT:-aucun}\nResume: ${RECO_SUMMARY}"

  if [[ "$RECO_ORCH" == "true" ]]; then
    SYS_MSG="${SYS_MSG}\n⚠ ORCHESTRATION RECOMMANDEE: /orchestrate${RECO_TEMPLATE:+ --template $RECO_TEMPLATE}"
  fi

  case "$RECO_COMPLEXITY" in
    medium|large)
      SYS_MSG="${SYS_MSG}\n\n--- DELEGATION ---\n- 1 agent = 1 fichier = 1 action atomique\n- Prompt < 200 mots, scope precis, delivrable explicite\n- JAMAIS explorer ET implementer dans le meme agent\n- Paralleliser les agents independants\n- TOUT agent hors de la liste sera BLOQUE"
      ;;
  esac
fi

# Output as JSON systemMessage
ESCAPED_MSG=$(printf '%b' "$SYS_MSG" | jq -Rs '.' 2>/dev/null)
[[ -z "$ESCAPED_MSG" || "$ESCAPED_MSG" == "null" ]] && ESCAPED_MSG="\"Skill Gate actif\""

printf '{"decision":"approve","reason":"rules-enforced","systemMessage":%s}' "$ESCAPED_MSG"
exit 0
