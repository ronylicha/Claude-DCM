#!/usr/bin/env bash
# setup-supervisor.sh - Install systemd user services for DCM
# Ensures all 3 components auto-start on boot, restart on failure
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DCM_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DASHBOARD_ROOT="$(cd "$DCM_ROOT/../context-dashboard" 2>/dev/null && pwd || echo "")"
SYSTEMD_USER_DIR="$HOME/.config/systemd/user"
TEMPLATE_DIR="$DCM_ROOT/systemd"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Load env for port config
if [[ -f "$DCM_ROOT/.env" ]]; then
    set -a
    source "$DCM_ROOT/.env" 2>/dev/null || true
    set +a
fi

API_PORT="${PORT:-3847}"
WS_PORT="${WS_PORT:-3849}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3848}"

# Detect bun path
BUN_PATH="$(command -v bun 2>/dev/null || echo "")"
if [[ -z "$BUN_PATH" ]]; then
    # Try common locations
    for candidate in "$HOME/.bun/bin/bun" "/usr/local/bin/bun" "/usr/bin/bun"; do
        if [[ -x "$candidate" ]]; then
            BUN_PATH="$candidate"
            break
        fi
    done
fi

if [[ -z "$BUN_PATH" ]]; then
    echo -e "${RED}ERROR: bun not found. Install it first: curl -fsSL https://bun.sh/install | bash${NC}"
    exit 1
fi

# Build a PATH that includes all dirs needed by DCM services
# systemd user services inherit a minimal PATH, missing ~/.local/bin, ~/.bun/bin, nvm, cargo, etc.
build_service_path() {
    local dirs=()

    # Always include standard system dirs
    dirs+=("/usr/local/sbin" "/usr/local/bin" "/usr/sbin" "/usr/bin" "/sbin" "/bin")

    # Add directory of each detected binary
    for bin in claude bun node npm npx git curl psql jq codex gemini; do
        local bin_path
        bin_path="$(command -v "$bin" 2>/dev/null || true)"
        if [[ -n "$bin_path" ]]; then
            local bin_dir
            bin_dir="$(dirname "$bin_path")"
            # Avoid duplicates
            local already=false
            for d in "${dirs[@]}"; do
                [[ "$d" == "$bin_dir" ]] && already=true && break
            done
            [[ "$already" == "false" ]] && dirs+=("$bin_dir")
        fi
    done

    # Also check common user-local dirs that may not have binaries yet
    for extra in "$HOME/.local/bin" "$HOME/.bun/bin" "$HOME/.cargo/bin"; do
        if [[ -d "$extra" ]]; then
            local already=false
            for d in "${dirs[@]}"; do
                [[ "$d" == "$extra" ]] && already=true && break
            done
            [[ "$already" == "false" ]] && dirs+=("$extra")
        fi
    done

    # Join with ":"
    local IFS=":"
    echo "${dirs[*]}"
}

SERVICE_PATH="$(build_service_path)"

# Check systemd user support
check_systemd_user() {
    if ! systemctl --user status >/dev/null 2>&1; then
        echo -e "${YELLOW}systemd user session not available.${NC}"
        echo "  This can happen if you're in an SSH session without a login session."
        echo "  Try: export XDG_RUNTIME_DIR=/run/user/\$(id -u)"
        return 1
    fi
    return 0
}

# Enable lingering so services survive logout
enable_linger() {
    local user
    user="$(whoami)"
    if ! loginctl show-user "$user" 2>/dev/null | grep -q "Linger=yes"; then
        echo -n "  Enabling linger for user $user... "
        if loginctl enable-linger "$user" 2>/dev/null; then
            echo -e "${GREEN}done${NC}"
        else
            echo -e "${YELLOW}needs sudo${NC}"
            echo "  Run: sudo loginctl enable-linger $user"
            echo "  (required for services to survive logout/reboot)"
        fi
    else
        echo -e "  Linger: ${GREEN}already enabled${NC}"
    fi
}

# Template a service file: replace placeholders with actual paths
template_service() {
    local src="$1"
    local dst="$2"

    sed \
        -e "s|__DCM_ROOT__|${DCM_ROOT}|g" \
        -e "s|__DASHBOARD_ROOT__|${DASHBOARD_ROOT}|g" \
        -e "s|__BUN_PATH__|${BUN_PATH}|g" \
        -e "s|__API_PORT__|${API_PORT}|g" \
        -e "s|__WS_PORT__|${WS_PORT}|g" \
        -e "s|__DASHBOARD_PORT__|${DASHBOARD_PORT}|g" \
        -e "s|__SERVICE_PATH__|${SERVICE_PATH}|g" \
        "$src" > "$dst"
}

# Stop existing nohup-based services (graceful migration)
stop_nohup_services() {
    local pids_dir="/tmp/.dcm-pids"
    if [[ -d "$pids_dir" ]]; then
        for pidfile in "$pids_dir"/*.pid; do
            [[ -f "$pidfile" ]] || continue
            local pid
            pid=$(cat "$pidfile" 2>/dev/null || echo "0")
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
            fi
            rm -f "$pidfile"
        done
        echo -e "  ${GREEN}Stopped legacy nohup services${NC}"
    fi
}

# Main install
install_supervisor() {
    echo -e "${BLUE}DCM Supervisor Setup${NC}"
    echo ""

    # Step 1: Check systemd user support
    echo -e "${YELLOW}[1/5]${NC} Checking systemd user support..."
    if ! check_systemd_user; then
        echo -e "${RED}Supervisor setup aborted. Falling back to nohup mode.${NC}"
        exit 0
    fi
    echo -e "  ${GREEN}systemd user session available${NC}"

    # Step 2: Enable linger
    echo -e "${YELLOW}[2/5]${NC} Configuring linger..."
    enable_linger

    # Step 3: Install unit files
    echo -e "${YELLOW}[3/5]${NC} Installing systemd unit files..."
    mkdir -p "$SYSTEMD_USER_DIR"

    # Target
    cp "$TEMPLATE_DIR/dcm.target" "$SYSTEMD_USER_DIR/dcm.target"
    echo "  Installed dcm.target"

    # API service
    template_service "$TEMPLATE_DIR/dcm-api.service" "$SYSTEMD_USER_DIR/dcm-api.service"
    echo "  Installed dcm-api.service"

    # WebSocket service
    template_service "$TEMPLATE_DIR/dcm-ws.service" "$SYSTEMD_USER_DIR/dcm-ws.service"
    echo "  Installed dcm-ws.service"

    # Dashboard service (only if directory exists)
    if [[ -n "$DASHBOARD_ROOT" && -d "$DASHBOARD_ROOT" ]]; then
        template_service "$TEMPLATE_DIR/dcm-dashboard.service" "$SYSTEMD_USER_DIR/dcm-dashboard.service"
        echo "  Installed dcm-dashboard.service"
    else
        echo -e "  ${YELLOW}Skipped dcm-dashboard.service (directory not found)${NC}"
    fi

    # Step 4: Stop legacy nohup services and reload systemd
    echo -e "${YELLOW}[4/5]${NC} Migrating from nohup to systemd..."
    stop_nohup_services
    systemctl --user daemon-reload

    # Step 5: Enable and start
    echo -e "${YELLOW}[5/5]${NC} Enabling and starting services..."

    systemctl --user enable dcm.target 2>/dev/null || true
    systemctl --user enable dcm-api.service 2>/dev/null || true
    systemctl --user enable dcm-ws.service 2>/dev/null || true

    if [[ -n "$DASHBOARD_ROOT" && -d "$DASHBOARD_ROOT" ]]; then
        systemctl --user enable dcm-dashboard.service 2>/dev/null || true
    fi

    # Pre-build dashboard for production (outside systemd to avoid OOM)
    if [[ -n "$DASHBOARD_ROOT" && -d "$DASHBOARD_ROOT" ]]; then
        echo -n "  Building dashboard for production... "
        (cd "$DASHBOARD_ROOT" && NODE_ENV=production npx next build >/dev/null 2>&1) && \
            echo -e "${GREEN}done${NC}" || \
            echo -e "${YELLOW}build failed (run manually: cd $DASHBOARD_ROOT && npx next build)${NC}"
    fi

    # Start the target (pulls in all services)
    systemctl --user start dcm.target

    # Wait for API to be healthy
    echo -n "  Waiting for API... "
    local healthy=false
    for i in $(seq 1 15); do
        if curl -s --connect-timeout 1 --max-time 2 "http://127.0.0.1:${API_PORT}/health" | grep -q '"healthy"' 2>/dev/null; then
            healthy=true
            break
        fi
        sleep 1
    done

    if [[ "$healthy" == "true" ]]; then
        echo -e "${GREEN}healthy${NC}"
    else
        echo -e "${YELLOW}not ready yet (check: journalctl --user -u dcm-api -f)${NC}"
    fi

    # Write marker so dcm CLI knows supervisor is installed
    echo "installed=$(date -Iseconds)" > "$DCM_ROOT/.supervisor-installed"

    echo ""
    echo -e "${GREEN}Supervisor installed!${NC}"
    echo ""
    echo "  Services will auto-start on boot and restart on failure."
    echo ""
    echo "  Commands:"
    echo "    dcm supervisor status    Show supervisor status"
    echo "    dcm supervisor logs      Follow all service logs"
    echo "    dcm supervisor restart   Restart all services"
    echo "    dcm supervisor disable   Disable auto-start"
    echo "    dcm supervisor enable    Re-enable auto-start"
    echo "    dcm supervisor uninstall Remove supervisor completely"
}

# Uninstall supervisor
uninstall_supervisor() {
    echo -e "${BLUE}Removing DCM supervisor...${NC}"

    systemctl --user stop dcm.target 2>/dev/null || true
    systemctl --user disable dcm.target dcm-api.service dcm-ws.service dcm-dashboard.service 2>/dev/null || true

    rm -f "$SYSTEMD_USER_DIR/dcm.target"
    rm -f "$SYSTEMD_USER_DIR/dcm-api.service"
    rm -f "$SYSTEMD_USER_DIR/dcm-ws.service"
    rm -f "$SYSTEMD_USER_DIR/dcm-dashboard.service"
    rm -f "$DCM_ROOT/.supervisor-installed"

    systemctl --user daemon-reload 2>/dev/null || true

    echo -e "${GREEN}Supervisor removed.${NC}"
}

# Status
status_supervisor() {
    echo -e "${BLUE}DCM Supervisor Status${NC}"
    echo ""

    # Check linger
    local user
    user="$(whoami)"
    echo -n "  Linger:     "
    if loginctl show-user "$user" 2>/dev/null | grep -q "Linger=yes"; then
        echo -e "${GREEN}enabled${NC} (survives logout)"
    else
        echo -e "${RED}disabled${NC} (won't survive logout)"
    fi

    # Check target
    echo -n "  dcm.target: "
    if systemctl --user is-active dcm.target >/dev/null 2>&1; then
        echo -e "${GREEN}active${NC}"
    else
        echo -e "${RED}inactive${NC}"
    fi

    echo ""

    # Check each service
    for svc in dcm-api dcm-ws dcm-dashboard; do
        echo -n "  ${svc}: "
        if ! systemctl --user cat "$svc.service" >/dev/null 2>&1; then
            echo -e "${YELLOW}not installed${NC}"
            continue
        fi

        local state
        state=$(systemctl --user show -p ActiveState "$svc.service" 2>/dev/null | cut -d= -f2)
        local enabled
        enabled=$(systemctl --user is-enabled "$svc.service" 2>/dev/null || echo "unknown")

        case "$state" in
            active)   echo -e "${GREEN}running${NC} (enabled=$enabled)" ;;
            failed)   echo -e "${RED}failed${NC} (enabled=$enabled)" ;;
            inactive) echo -e "${YELLOW}stopped${NC} (enabled=$enabled)" ;;
            *)        echo -e "${YELLOW}${state}${NC} (enabled=$enabled)" ;;
        esac

        # Show restart count if failed
        if [[ "$state" == "failed" ]]; then
            echo "    Last log: $(journalctl --user -u "$svc" -n 1 --no-pager -o cat 2>/dev/null || echo 'N/A')"
        fi
    done

    echo ""

    # Uptime
    local api_start
    api_start=$(systemctl --user show -p ActiveEnterTimestamp dcm-api.service 2>/dev/null | cut -d= -f2)
    if [[ -n "$api_start" && "$api_start" != " " ]]; then
        echo "  API uptime since: $api_start"
    fi
}

# Reload after update (re-template and restart)
reload_supervisor() {
    echo -e "${BLUE}Reloading DCM supervisor (post-update)...${NC}"

    # Re-template service files with current paths
    template_service "$TEMPLATE_DIR/dcm-api.service" "$SYSTEMD_USER_DIR/dcm-api.service"
    template_service "$TEMPLATE_DIR/dcm-ws.service" "$SYSTEMD_USER_DIR/dcm-ws.service"
    if [[ -n "$DASHBOARD_ROOT" && -d "$DASHBOARD_ROOT" ]]; then
        template_service "$TEMPLATE_DIR/dcm-dashboard.service" "$SYSTEMD_USER_DIR/dcm-dashboard.service"
    fi

    # Pre-build dashboard for production
    if [[ -n "$DASHBOARD_ROOT" && -d "$DASHBOARD_ROOT" ]]; then
        echo -n "  Building dashboard... "
        (cd "$DASHBOARD_ROOT" && NODE_ENV=production npx next build >/dev/null 2>&1) && \
            echo -e "${GREEN}done${NC}" || \
            echo -e "${YELLOW}build failed${NC}"
    fi

    systemctl --user daemon-reload
    systemctl --user restart dcm.target

    echo -e "${GREEN}Supervisor reloaded.${NC}"
}

# Route subcommands
case "${1:-install}" in
    install)   install_supervisor ;;
    uninstall) uninstall_supervisor ;;
    status)    status_supervisor ;;
    reload)    reload_supervisor ;;
    restart)   systemctl --user restart dcm.target; echo "DCM services restarted." ;;
    stop)      systemctl --user stop dcm.target; echo "DCM services stopped." ;;
    start)     systemctl --user start dcm.target; echo "DCM services started." ;;
    enable)    systemctl --user enable dcm.target dcm-api dcm-ws dcm-dashboard 2>/dev/null; echo "Auto-start enabled." ;;
    disable)   systemctl --user disable dcm.target dcm-api dcm-ws dcm-dashboard 2>/dev/null; echo "Auto-start disabled." ;;
    logs)      journalctl --user -u dcm-api -u dcm-ws -u dcm-dashboard -f --no-pager ;;
    *)
        echo "Usage: setup-supervisor.sh {install|uninstall|status|reload|restart|stop|start|enable|disable|logs}"
        exit 1
        ;;
esac
