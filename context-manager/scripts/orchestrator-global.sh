#!/bin/bash
# orchestrator-global.sh — Launches the DCM global orchestrator (Sonnet headless)
# Singleton: only one instance runs at a time (flock)
set -euo pipefail

LOCK_FILE="/tmp/.claude-context/orchestrator-global.lock"
PID_FILE="/tmp/.claude-context/orchestrator-global.pid"
API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"

mkdir -p /tmp/.claude-context

# Flock: exit if already running
exec 200>"$LOCK_FILE"
flock -n 200 || { exit 0; }

# Record PID
echo $$ > "$PID_FILE"

cleanup() {
  rm -f "$PID_FILE"
}
trap cleanup EXIT

# Generate orchestrator context file
CONTEXT_FILE="/tmp/.claude-context/orchestrator-context.md"
cat > "$CONTEXT_FILE" << 'PROMPT'
Tu es l'orchestrateur DCM inter-projets. Tu tournes en continu.

## Tes pouvoirs
Tu peux appeler ces APIs avec l'outil Bash et curl :
- GET http://127.0.0.1:3847/api/cockpit/global — vue d'ensemble sessions
- GET http://127.0.0.1:3847/api/cockpit/grid — details par session
- POST http://127.0.0.1:3847/api/messages — envoyer info/directive
- PATCH http://127.0.0.1:3847/api/subtasks/:id — changer priorite/status
- POST http://127.0.0.1:3847/api/compact/preemptive-summary — forcer resume

## Ta boucle (repete indefiniment)
1. Appelle GET /api/cockpit/grid pour voir les sessions actives
2. Detecte les conflits fichiers avec cette requete SQL via psql :
   SELECT unnest(a.file_paths) as fp, COUNT(DISTINCT a.session_id) as cnt, array_agg(DISTINCT a.session_id) as sids FROM actions a WHERE a.file_paths IS NOT NULL AND a.tool_name IN ('Write','Edit','MultiEdit') AND a.created_at > NOW() - INTERVAL '15 minutes' AND a.session_id IS NOT NULL GROUP BY fp HAVING COUNT(DISTINCT a.session_id) > 1
3. Pour chaque situation detectee, agis :
   - CONFLIT FICHIER → POST /api/messages avec topic=directive.stop
   - DECISION ARCHI (fichier schema.sql, server.ts, package.json modifie) → POST /api/messages topic=directive.architecture broadcast
   - CONTEXTE >85% → verifie resume pre-emptif en cours, sinon declenche
   - INFO UTILE → POST /api/messages topic=directive.info
4. Publie un heartbeat : POST /api/messages avec topic=orchestrator.heartbeat
5. Si 0 sessions actives pendant 10 cycles → arrete-toi (exit 0)
6. Attends 30 secondes puis recommence

## Format des messages
POST /api/messages -H "Content-Type: application/json" -d '{"from_agent_id":"orchestrator-global","to_agent_id":null,"message_type":"notification","topic":"directive.info","payload":{"action":"info","message":"..."},"priority":5,"ttl_seconds":300}'

## Regles
- Ne demande JAMAIS confirmation, agis directement
- Sois concis dans tes messages (max 200 chars)
- Ne modifie JAMAIS de fichier directement, uniquement via API
- Log tes actions dans stdout
PROMPT

# Launch claude headless as orchestrator
claude -p "Tu es l'orchestrateur DCM. Commence ta boucle de surveillance maintenant. Appelle GET /api/cockpit/grid pour commencer." \
  --bare \
  --allowedTools "Bash" \
  --output-format text \
  --append-system-prompt-file "$CONTEXT_FILE" \
  2>/dev/null || true

# Cleanup on exit
cleanup
