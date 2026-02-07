#!/bin/bash
# install.sh - One-command DCM installer
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  DCM - Distributed Context Manager for Claude Code  ║"
echo "║  Version 2.0.0                                      ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# Step 1: Check prerequisites
echo "Step 1/6: Checking prerequisites..."

MISSING=""
command -v bun &>/dev/null || MISSING="$MISSING bun"
command -v psql &>/dev/null || MISSING="$MISSING psql"
command -v jq &>/dev/null || MISSING="$MISSING jq"

if [[ -n "$MISSING" ]]; then
    echo "ERROR: Missing required tools:$MISSING"
    echo ""
    [[ "$MISSING" == *"bun"* ]] && echo "  Install Bun: curl -fsSL https://bun.sh/install | bash"
    [[ "$MISSING" == *"psql"* ]] && echo "  Install PostgreSQL: sudo apt install postgresql postgresql-client"
    [[ "$MISSING" == *"jq"* ]] && echo "  Install jq: sudo apt install jq"
    exit 1
fi
echo "  All prerequisites found."

# Step 2: Install dependencies
echo ""
echo "Step 2/6: Installing dependencies..."
cd "$SCRIPT_DIR"
bun install
echo "  Dependencies installed."

# Step 3: Configure environment
echo ""
echo "Step 3/6: Configuring environment..."
if [[ ! -f "$SCRIPT_DIR/.env" ]]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    echo "  Created .env from template."
    echo ""
    echo "  >>> IMPORTANT: Edit $SCRIPT_DIR/.env with your database credentials <<<"
    echo "  >>> Then re-run this script. <<<"
    echo ""
    read -p "  Have you already configured PostgreSQL? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "  Please configure your .env file and run this script again."
        exit 0
    fi
else
    echo "  .env already exists."
fi

# Load env
set -a
source "$SCRIPT_DIR/.env"
set +a

# Step 4: Setup database
echo ""
echo "Step 4/6: Setting up database..."
bash "$SCRIPT_DIR/scripts/setup-db.sh"

# Step 5: Verify API starts
echo ""
echo "Step 5/6: Verifying server starts..."
timeout 10 bun run src/server.ts &
SERVER_PID=$!
sleep 3

if curl -s http://127.0.0.1:${PORT:-3847}/health | jq -e '.status == "healthy"' &>/dev/null; then
    echo "  API server verified healthy."
else
    echo "  WARNING: API server may not be running correctly."
fi
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

# Step 6: Setup hooks
echo ""
echo "Step 6/6: Setting up Claude Code hooks..."
bash "$SCRIPT_DIR/scripts/setup-hooks.sh"

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Installation complete!                             ║"
echo "╠══════════════════════════════════════════════════════╣"
echo "║                                                      ║"
echo "║  Start servers:                                      ║"
echo "║    bun run start:api    # API on port ${PORT:-3847}          ║"
echo "║    bun run start:ws     # WebSocket on port ${WS_PORT:-3849}     ║"
echo "║                                                      ║"
echo "║  Or use systemd:                                     ║"
echo "║    sudo cp *.service /etc/systemd/system/            ║"
echo "║    sudo systemctl enable context-manager-api         ║"
echo "║    sudo systemctl start context-manager-api          ║"
echo "║                                                      ║"
echo "║  Health check:                                       ║"
echo "║    curl http://127.0.0.1:${PORT:-3847}/health                ║"
echo "║                                                      ║"
echo "╚══════════════════════════════════════════════════════╝"
