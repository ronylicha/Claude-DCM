#!/usr/bin/env bash
# dashboard.sh - Terminal dashboard for DCM subagent monitoring
# Queries the DCM API for real-time data (centralized DB)
#
# Usage:
#   bash dashboard.sh              # Snapshot view
#   bash dashboard.sh --watch      # Auto-refresh every 2s
#   bash dashboard.sh --clean      # Clean old data (>7 days)
#   bash dashboard.sh --json       # Raw JSON output

set -uo pipefail

API_URL="${CONTEXT_MANAGER_URL:-http://127.0.0.1:3847}"
REFRESH_INTERVAL=2

# ==========================================
# Color codes
# ==========================================
BOLD='\033[1m'
DIM='\033[2m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m'

# ==========================================
# Helpers
# ==========================================

api_get() {
    curl -s "$API_URL$1" --connect-timeout 2 --max-time 5 2>/dev/null
}

check_health() {
    local health
    health=$(api_get "/health")
    if [[ -z "$health" ]]; then
        echo -e "${RED}DCM API unreachable at ${API_URL}${NC}"
        exit 1
    fi
    echo "$health"
}

format_duration() {
    local seconds=$1
    if (( seconds < 60 )); then
        echo "${seconds}s"
    elif (( seconds < 3600 )); then
        echo "$((seconds / 60))m$((seconds % 60))s"
    else
        echo "$((seconds / 3600))h$((seconds % 3600 / 60))m"
    fi
}

# ==========================================
# Dashboard render
# ==========================================

render_dashboard() {
    clear

    local health stats subtasks actions blocked_count

    health=$(api_get "/health")
    stats=$(api_get "/api/stats")
    subtasks=$(api_get "/api/subtasks?status=running&limit=50")
    actions=$(api_get "/api/actions?limit=10")

    local version status db_status
    version=$(echo "$health" | jq -r '.version // "?"' 2>/dev/null)
    status=$(echo "$health" | jq -r '.status // "unknown"' 2>/dev/null)
    db_status=$(echo "$health" | jq -r '.database // "unknown"' 2>/dev/null)

    # Header
    echo -e "${BOLD}${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║           DCM Subagent Monitor — Terminal Dashboard         ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    # Status bar
    local status_color="${GREEN}"
    [[ "$status" != "healthy" ]] && status_color="${RED}"
    local db_color="${GREEN}"
    [[ "$db_status" != "connected" ]] && db_color="${RED}"

    echo -e "  ${BOLD}API:${NC} ${status_color}${status}${NC}  ${DIM}v${version}${NC}    ${BOLD}DB:${NC} ${db_color}${db_status}${NC}    ${DIM}$(date +%H:%M:%S)${NC}"
    echo ""

    # KPI Section
    local total_sessions total_agents total_actions total_subtasks success_rate
    total_sessions=$(echo "$stats" | jq -r '.total_sessions // 0' 2>/dev/null)
    total_agents=$(echo "$stats" | jq -r '.active_agents // 0' 2>/dev/null)
    total_actions=$(echo "$stats" | jq -r '.total_actions // 0' 2>/dev/null)
    total_subtasks=$(echo "$stats" | jq -r '.total_subtasks // 0' 2>/dev/null)
    success_rate=$(echo "$stats" | jq -r '.success_rate // "N/A"' 2>/dev/null)

    echo -e "  ${BOLD}${WHITE}── KPIs ─────────────────────────────────────────────────${NC}"
    printf "  ${CYAN}Sessions:${NC} %-8s ${MAGENTA}Agents:${NC} %-8s ${BLUE}Actions:${NC} %-8s ${GREEN}Success:${NC} %s\n" \
        "$total_sessions" "$total_agents" "$total_actions" "${success_rate}%"
    echo ""

    # Active Agents
    echo -e "  ${BOLD}${WHITE}── Active Agents ────────────────────────────────────────${NC}"

    local agent_count
    agent_count=$(echo "$subtasks" | jq -r '.subtasks | length // 0' 2>/dev/null)

    if [[ "$agent_count" -gt 0 ]]; then
        printf "  ${DIM}%-20s %-15s %-40s${NC}\n" "TYPE" "STATUS" "DESCRIPTION"
        echo -e "  ${DIM}$(printf '─%.0s' {1..75})${NC}"

        echo "$subtasks" | jq -r '.subtasks[] | "\(.agent_type)\t\(.status)\t\(.description // "N/A")"' 2>/dev/null | \
        while IFS=$'\t' read -r atype astatus adesc; do
            local sc="${GREEN}"
            [[ "$astatus" == "running" ]] && sc="${YELLOW}"
            [[ "$astatus" == "failed" ]] && sc="${RED}"
            adesc="${adesc:0:38}"
            printf "  ${CYAN}%-20s${NC} ${sc}%-15s${NC} %-40s\n" "$atype" "$astatus" "$adesc"
        done
    else
        echo -e "  ${DIM}No active agents${NC}"
    fi
    echo ""

    # Recent Actions
    echo -e "  ${BOLD}${WHITE}── Recent Actions (last 10) ─────────────────────────────${NC}"
    printf "  ${DIM}%-12s %-15s %-10s %-30s${NC}\n" "TIME" "TOOL" "TYPE" "INPUT"
    echo -e "  ${DIM}$(printf '─%.0s' {1..75})${NC}"

    echo "$actions" | jq -r '.actions[]? | "\(.created_at // "")\t\(.tool_name // "")\t\(.tool_type // "")\t\(.input // "" | tostring | .[0:28])"' 2>/dev/null | \
    while IFS=$'\t' read -r atime atool atype ainput; do
        local time_short
        time_short=$(echo "$atime" | grep -oE '[0-9]{2}:[0-9]{2}:[0-9]{2}' 2>/dev/null || echo "??:??:??")
        local tc="${NC}"
        [[ "$atype" == "blocked" ]] && tc="${RED}"
        [[ "$atype" == "agent" ]] && tc="${MAGENTA}"
        [[ "$atype" == "skill" ]] && tc="${CYAN}"
        printf "  %-12s ${tc}%-15s${NC} %-10s %-30s\n" "$time_short" "$atool" "$atype" "$ainput"
    done
    echo ""

    # Blocked Operations
    local blocked
    blocked=$(api_get "/api/actions?tool_type=blocked&limit=5")
    local blocked_count
    blocked_count=$(echo "$blocked" | jq -r '.actions | length // 0' 2>/dev/null)

    if [[ "$blocked_count" -gt 0 ]]; then
        echo -e "  ${BOLD}${RED}── Blocked Operations ───────────────────────────────────${NC}"
        echo "$blocked" | jq -r '.actions[]? | "\(.created_at // "")\t\(.input // "")"' 2>/dev/null | \
        while IFS=$'\t' read -r btime binput; do
            local time_short
            time_short=$(echo "$btime" | grep -oE '[0-9]{2}:[0-9]{2}:[0-9]{2}' 2>/dev/null || echo "??:??:??")
            echo -e "  ${RED}✕${NC} ${time_short}  ${binput:0:60}"
        done
        echo ""
    fi

    # Footer
    echo -e "  ${DIM}Press Ctrl+C to exit${NC}"
}

render_json() {
    local health stats subtasks actions
    health=$(api_get "/health")
    stats=$(api_get "/api/stats")
    subtasks=$(api_get "/api/subtasks?status=running&limit=50")
    actions=$(api_get "/api/actions?limit=10")

    jq -n \
        --argjson health "$health" \
        --argjson stats "$stats" \
        --argjson agents "$subtasks" \
        --argjson actions "$actions" \
        '{health: $health, stats: $stats, active_agents: $agents, recent_actions: $actions}'
}

clean_old_data() {
    echo -e "${BOLD}${YELLOW}Cleaning data older than 7 days...${NC}"

    local cutoff
    cutoff=$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-7d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)

    if [[ -z "$cutoff" ]]; then
        echo -e "${RED}Could not calculate cutoff date${NC}"
        exit 1
    fi

    local result
    result=$(curl -s -X POST "${API_URL}/api/cleanup" \
        -H "Content-Type: application/json" \
        -d "$(jq -n --arg before "$cutoff" '{before: $before}')" \
        --connect-timeout 2 --max-time 10 2>/dev/null)

    if [[ -n "$result" ]]; then
        echo -e "${GREEN}Cleanup complete${NC}"
        echo "$result" | jq '.' 2>/dev/null || echo "$result"
    else
        echo -e "${RED}Cleanup failed or no cleanup endpoint available${NC}"
    fi
}

# ==========================================
# Main
# ==========================================

case "${1:-}" in
    --watch|-w)
        check_health >/dev/null
        while true; do
            render_dashboard
            sleep "$REFRESH_INTERVAL"
        done
        ;;
    --clean|-c)
        check_health >/dev/null
        clean_old_data
        ;;
    --json|-j)
        check_health >/dev/null
        render_json
        ;;
    --help|-h)
        echo "DCM Terminal Dashboard"
        echo ""
        echo "Usage:"
        echo "  bash dashboard.sh              # Snapshot view"
        echo "  bash dashboard.sh --watch      # Auto-refresh (2s)"
        echo "  bash dashboard.sh --clean      # Clean data >7 days"
        echo "  bash dashboard.sh --json       # Raw JSON output"
        echo "  bash dashboard.sh --help       # This help"
        ;;
    *)
        check_health >/dev/null
        render_dashboard
        ;;
esac
