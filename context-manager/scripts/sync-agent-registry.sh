#!/usr/bin/env bash
# sync-agent-registry.sh — Auto-sync agent registry from agent-roles.json
# Reads agent-roles.json, imports into DCM API, updates wave_assignments via SQL
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DCM_DIR="$(dirname "$SCRIPT_DIR")"
ROLES_FILE="$DCM_DIR/agent-roles.json"
API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
LOG_FILE="/tmp/dcm-sync-registry.log"

if [[ -f "$DCM_DIR/.env" ]]; then
    set -a; source "$DCM_DIR/.env" 2>/dev/null || true; set +a
fi

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-5435}"
DB_USER="${DB_USER:-dcm}"
DB_NAME="${DB_NAME:-claude_context}"
DB_PASSWORD="${DB_PASSWORD:-dcm_secret}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

log "=== Agent Registry Sync START ==="

if [[ ! -f "$ROLES_FILE" ]]; then
    log "ERROR: $ROLES_FILE not found"; exit 1
fi

if ! curl -s --connect-timeout 2 "$API_URL/health" | grep -q healthy 2>/dev/null; then
    log "ERROR: DCM API not healthy at $API_URL"; exit 1
fi

CURRENT_COUNT=$(curl -s "$API_URL/api/registry" | jq '.total // 0' 2>/dev/null || echo 0)
FILE_COUNT=$(jq '.agents | length' "$ROLES_FILE" 2>/dev/null || echo 0)
log "Current registry: $CURRENT_COUNT agents | Roles file: $FILE_COUNT agents"

# Detect new agents from plugin directory
PLUGIN_DIR="$DCM_DIR/../.claude-plugin"
if [[ -d "$PLUGIN_DIR/agents" ]]; then
    shopt -s nullglob
    for agent_file in "$PLUGIN_DIR"/agents/*.md; do
        AGENT_NAME=$(basename "$agent_file" .md)
        if ! jq -e ".agents[] | select(.agent_type == \"$AGENT_NAME\")" "$ROLES_FILE" >/dev/null 2>&1; then
            log "NEW AGENT detected: $AGENT_NAME (from plugin)"
            TMP=$(mktemp)
            jq --arg name "$AGENT_NAME" '.agents += [{"agent_type": $name, "category": "specialist", "display_name": $name, "wave_assignments": []}]' "$ROLES_FILE" > "$TMP"
            mv "$TMP" "$ROLES_FILE"
            log "Added $AGENT_NAME to agent-roles.json as specialist"
        fi
    done
    shopt -u nullglob
fi

# Import via API (without wave_assignments to avoid type bug)
IMPORT_PAYLOAD=$(jq '{agents: [.agents[] | {agent_type, category, display_name}]}' "$ROLES_FILE")
RESULT=$(echo "$IMPORT_PAYLOAD" | curl -s -X POST "$API_URL/api/registry/import" \
    -H "Content-Type: application/json" -d @- 2>&1)

IMPORTED=$(echo "$RESULT" | jq '.imported // 0' 2>/dev/null || echo 0)
ERRORS=$(echo "$RESULT" | jq '.errors // [] | length' 2>/dev/null || echo 0)
log "API Import: $IMPORTED imported, $ERRORS errors"

# Update wave_assignments via SQL
WAVE_UPDATES=0
while IFS= read -r sql_line; do
    if [[ -n "$sql_line" ]]; then
        PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
            -c "$sql_line" >/dev/null 2>&1 && ((WAVE_UPDATES++)) || true
    fi
done < <(jq -r '.agents[] | select(.wave_assignments | length > 0) | "UPDATE agent_registry SET wave_assignments = ARRAY[\(.wave_assignments | join(","))] WHERE agent_type = '\''\(.agent_type)'\'';"' "$ROLES_FILE" 2>/dev/null)

log "Wave assignments updated: $WAVE_UPDATES"

FINAL_COUNT=$(curl -s "$API_URL/api/registry" | jq '.total // 0' 2>/dev/null || echo 0)
log "=== Agent Registry Sync DONE === ($FINAL_COUNT agents total)"
echo "Sync complete: $FINAL_COUNT agents ($IMPORTED imported, $WAVE_UPDATES waves updated)"
