#!/bin/bash
# Quick launcher for DCM (Dashboard + Backend)
# Usage: ./start.sh or `dashboard` alias

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$HOME/.claude/services/context-manager"

echo "========================================="
echo " Distributed Context Manager"
echo "========================================="
echo ""

# Start backend API (port 3847)
echo "[1/3] Starting API server on http://127.0.0.1:3847..."
cd "$BACKEND_DIR"
bun run src/server.ts &
API_PID=$!

# Start WebSocket server (port 3849)
echo "[2/3] Starting WebSocket server on ws://127.0.0.1:3849..."
bun run src/websocket-server.ts &
WS_PID=$!

# Start dashboard frontend (port 3848)
echo "[3/3] Starting Dashboard on http://127.0.0.1:3848..."
cd "$SCRIPT_DIR"
bun run dev &
DASHBOARD_PID=$!

# Wait for servers to be ready
sleep 3

# Open browser (Linux)
if command -v xdg-open &> /dev/null; then
    xdg-open "http://127.0.0.1:3848" 2>/dev/null
elif command -v sensible-browser &> /dev/null; then
    sensible-browser "http://127.0.0.1:3848" 2>/dev/null
fi

echo ""
echo "========================================="
echo " All services running!"
echo "========================================="
echo " API:       http://127.0.0.1:3847 (PID: $API_PID)"
echo " WebSocket: ws://127.0.0.1:3849  (PID: $WS_PID)"
echo " Dashboard: http://127.0.0.1:3848 (PID: $DASHBOARD_PID)"
echo "========================================="
echo ""
echo "Press Ctrl+C to stop all services"

# Cleanup function
cleanup() {
    echo ""
    echo "Stopping services..."
    kill $API_PID $WS_PID $DASHBOARD_PID 2>/dev/null
    echo "Done."
    exit 0
}

trap cleanup SIGINT SIGTERM

# Wait for any process to exit
wait
