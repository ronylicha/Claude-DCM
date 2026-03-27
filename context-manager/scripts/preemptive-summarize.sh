#!/bin/bash
# Preemptive Context Summarization — Launched by DCM when context reaches 85%
# Environment: SESSION_ID, TOKENS_USED, DCM_API_URL

set -euo pipefail

DCM_API="${DCM_API_URL:-http://127.0.0.1:3847}"
CONTEXT_FILE="/tmp/dcm-context-${SESSION_ID}.md"
SUMMARY_FILE="/tmp/dcm-summary-${SESSION_ID}.md"

cleanup() {
  rm -f "$CONTEXT_FILE" "$SUMMARY_FILE"
}
trap cleanup EXIT

# 1. Fetch raw context from DCM
HTTP_CODE=$(curl -s -o "$CONTEXT_FILE" -w "%{http_code}" \
  "${DCM_API}/api/compact/raw-context/${SESSION_ID}")

if [ "$HTTP_CODE" != "200" ] || [ ! -s "$CONTEXT_FILE" ]; then
  echo "Failed to fetch context (HTTP $HTTP_CODE)" >&2
  # Mark as failed
  curl -s -X POST "${DCM_API}/api/compact/preemptive-summary" \
    -H "Content-Type: application/json" \
    -d "{
      \"session_id\": \"${SESSION_ID}\",
      \"summary\": \"ERROR: Failed to fetch context\",
      \"source\": \"headless-agent\",
      \"context_tokens_at_trigger\": ${TOKENS_USED:-0},
      \"status\": \"failed\"
    }" >/dev/null 2>&1
  exit 1
fi

# 2. Run Claude headless for summarization
claude -p "Tu es un expert en resume de contexte de session de developpement.
Resume ce contexte en preservant :
- Toutes les taches actives et leur statut exact
- Toutes les decisions architecturales
- Tous les fichiers modifies avec leur etat
- Les dependances entre agents
- Les informations critiques pour reprendre le travail sans perte

Sois exhaustif sur les FAITS, concis sur les DESCRIPTIONS.
Ne perds AUCUNE information actionnable." \
  --bare \
  --allowedTools "" \
  --output-format text \
  --append-system-prompt-file "$CONTEXT_FILE" \
  > "$SUMMARY_FILE" 2>/dev/null

if [ ! -s "$SUMMARY_FILE" ]; then
  echo "Claude headless produced empty output" >&2
  exit 1
fi

# 3. Push summary to DCM
SUMMARY_JSON=$(jq -Rs . < "$SUMMARY_FILE")

curl -s -X POST "${DCM_API}/api/compact/preemptive-summary" \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\": \"${SESSION_ID}\",
    \"summary\": ${SUMMARY_JSON},
    \"source\": \"headless-agent\",
    \"context_tokens_at_trigger\": ${TOKENS_USED:-0}
  }" >/dev/null 2>&1

echo "Preemptive summary generated for session ${SESSION_ID}"
