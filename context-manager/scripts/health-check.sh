#!/usr/bin/env bash
# health-check.sh - Vérifie que tous les services DCM fonctionnent
#
# Usage: ./health-check.sh [--quiet]
#
# Exit codes:
#   0 - Tous les services sont OK
#   1 - Au moins un service est KO

set -euo pipefail

# Configuration
API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
WS_URL="${CONTEXT_MANAGER_WS_URL:-http://127.0.0.1:3849}"
DASHBOARD_URL="${CONTEXT_DASHBOARD_URL:-http://127.0.0.1:3848}"

QUIET=false
if [[ "${1:-}" == "--quiet" ]] || [[ "${1:-}" == "-q" ]]; then
    QUIET=true
fi

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log() {
    if [[ "$QUIET" == "false" ]]; then
        echo -e "$1"
    fi
}

# Compteur d'erreurs
ERRORS=0

# Check API
log "${YELLOW}Checking API server (${API_URL})...${NC}"
if curl -sf "${API_URL}/health" > /dev/null 2>&1; then
    API_RESPONSE=$(curl -sf "${API_URL}/health")
    API_STATUS=$(echo "$API_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
    API_VERSION=$(echo "$API_RESPONSE" | jq -r '.version' 2>/dev/null || echo "unknown")
    DB_HEALTHY=$(echo "$API_RESPONSE" | jq -r '.database.healthy' 2>/dev/null || echo "unknown")

    if [[ "$API_STATUS" == "healthy" ]]; then
        log "${GREEN}  [OK] API server v${API_VERSION} is healthy${NC}"
        if [[ "$DB_HEALTHY" == "true" ]]; then
            log "${GREEN}  [OK] Database connection is healthy${NC}"
        else
            log "${RED}  [KO] Database connection failed${NC}"
            ((ERRORS++))
        fi
    else
        log "${RED}  [KO] API server status: ${API_STATUS}${NC}"
        ((ERRORS++))
    fi
else
    log "${RED}  [KO] API server is not responding${NC}"
    ((ERRORS++))
fi

# Check WebSocket
log "${YELLOW}Checking WebSocket server (${WS_URL})...${NC}"
if curl -sf "${WS_URL}/health" > /dev/null 2>&1; then
    WS_RESPONSE=$(curl -sf "${WS_URL}/health")
    WS_STATUS=$(echo "$WS_RESPONSE" | jq -r '.status' 2>/dev/null || echo "unknown")
    WS_CLIENTS=$(echo "$WS_RESPONSE" | jq -r '.connectedClients' 2>/dev/null || echo "0")

    if [[ "$WS_STATUS" == "healthy" ]]; then
        log "${GREEN}  [OK] WebSocket server is healthy (${WS_CLIENTS} clients connected)${NC}"
    else
        log "${RED}  [KO] WebSocket server status: ${WS_STATUS}${NC}"
        ((ERRORS++))
    fi
else
    log "${RED}  [KO] WebSocket server is not responding${NC}"
    ((ERRORS++))
fi

# Check Dashboard (optional)
log "${YELLOW}Checking Dashboard (${DASHBOARD_URL})...${NC}"
if curl -sf "${DASHBOARD_URL}" > /dev/null 2>&1; then
    log "${GREEN}  [OK] Dashboard is accessible${NC}"
else
    log "${YELLOW}  [--] Dashboard is not running (optional)${NC}"
    # Dashboard is optional, don't count as error
fi

# Check PostgreSQL directly (optional)
log "${YELLOW}Checking PostgreSQL...${NC}"
if command -v pg_isready &> /dev/null; then
    DB_HOST="${DB_HOST:-localhost}"
    DB_PORT="${DB_PORT:-5432}"

    if pg_isready -h "$DB_HOST" -p "$DB_PORT" > /dev/null 2>&1; then
        log "${GREEN}  [OK] PostgreSQL is accepting connections${NC}"
    else
        log "${RED}  [KO] PostgreSQL is not accepting connections${NC}"
        ((ERRORS++))
    fi
else
    log "${YELLOW}  [--] pg_isready not found, skipping direct PG check${NC}"
fi

# Summary
echo ""
if [[ $ERRORS -eq 0 ]]; then
    log "${GREEN}All services are healthy!${NC}"
    exit 0
else
    log "${RED}${ERRORS} service(s) failed health check${NC}"
    exit 1
fi
