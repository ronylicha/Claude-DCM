/**
 * WebSocket Server using Bun native WebSocket
 * Runs on a separate port (default: 3849)
 * @module websocket/server
 */

import type { ServerWebSocket } from "bun";
import { config } from "../config";
import type { WSClientData } from "./types";
import { handleConnection, handleMessage, handleClose, getWSStats, clients, startDeliveryRetry } from "./handlers";
import { startDatabaseBridge, stopDatabaseBridge } from "./bridge";

// ============================================
// Server State
// ============================================

let wsServer: ReturnType<typeof Bun.serve> | null = null;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let deliveryRetryInterval: ReturnType<typeof setInterval> | null = null;

// Heartbeat interval: 30 seconds
const HEARTBEAT_INTERVAL_MS = 30000;

// ============================================
// Client ID Generator
// ============================================

function generateClientId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `ws_${timestamp}_${random}`;
}

// ============================================
// HTTP Method Validation Helpers
// ============================================

/**
 * Handle OPTIONS request for HTTP endpoints
 */
function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Allow": "GET, OPTIONS",
    },
  });
}

/**
 * Validate HTTP method is GET, return 405 if not
 */
function validateGetMethod(method: string): Response | null {
  if (method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: {
        "Allow": "GET, OPTIONS",
      },
    });
  }
  return null;
}

// ============================================
// WebSocket Server
// ============================================

/**
 * Start the WebSocket server
 */
export function startWebSocketServer(): ReturnType<typeof Bun.serve> {
  const port = config.websocket.port;
  const host = config.server.host;

  console.log(`[WS Server] Starting WebSocket server on ws://${host}:${port}`);

  wsServer = Bun.serve({
    hostname: host,
    port: port,

    // HTTP handler for upgrade and health check
    fetch(req, server) {
      const url = new URL(req.url);

      // Health check endpoint
      if (url.pathname === "/health") {
        // Handle OPTIONS for proper HTTP semantics
        if (req.method === "OPTIONS") {
          return handleOptions();
        }
        
        const methodError = validateGetMethod(req.method);
        if (methodError) return methodError;
        
        const stats = getWSStats();
        return new Response(
          JSON.stringify({
            status: "healthy",
            type: "websocket",
            port: port,
            ...stats,
            timestamp: new Date().toISOString(),
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          }
        );
      }

      // Stats endpoint
      if (url.pathname === "/stats") {
        // Handle OPTIONS for proper HTTP semantics
        if (req.method === "OPTIONS") {
          return handleOptions();
        }
        
        const methodError = validateGetMethod(req.method);
        if (methodError) return methodError;
        
        const stats = getWSStats();
        return new Response(JSON.stringify(stats), {
          headers: {
            "Content-Type": "application/json",
          },
        });
      }

      // WebSocket upgrade
      if (url.pathname === "/" || url.pathname === "/ws") {
        // Extract auth info from query params or headers
        const agentId = url.searchParams.get("agent_id") ?? undefined;
        const sessionId = url.searchParams.get("session_id") ?? undefined;

        const clientData: WSClientData = {
          id: generateClientId(),
          agent_id: agentId,
          session_id: sessionId,
          subscriptions: new Set<string>(),
          authenticated: false,
          connectedAt: Date.now(),
          lastPing: Date.now(),
        };

        const success = server.upgrade(req, {
          data: clientData,
        });

        if (success) {
          return undefined;
        }

        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      return new Response("Not Found", { status: 404 });
    },

    // WebSocket handlers
    websocket: {
      open(ws: ServerWebSocket<WSClientData>) {
        handleConnection(ws);
      },

      message(ws: ServerWebSocket<WSClientData>, message: string | Buffer) {
        handleMessage(ws, message);
      },

      close(ws: ServerWebSocket<WSClientData>) {
        handleClose(ws);
      },

      drain(ws: ServerWebSocket<WSClientData>) {
        console.log(`[WS Server] Socket drain: ${ws.data.id}`);
      },
    },

    // Error handler
    error(error) {
      console.error("[WS Server] Server error:", error);
      return new Response("Internal Server Error", { status: 500 });
    },
  });

  // Start database bridge
  startDatabaseBridge();

  // Start heartbeat interval (pings + dead connection cleanup)
  startHeartbeat();

  // Start delivery retry interval (at-least-once semantics)
  deliveryRetryInterval = startDeliveryRetry();

  console.log(`[WS Server] WebSocket server listening on ws://${host}:${port}`);

  return wsServer;
}

/**
 * Stop the WebSocket server
 */
export async function stopWebSocketServer(): Promise<void> {
  console.log("[WS Server] Stopping WebSocket server...");

  // Stop heartbeat
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }

  // Stop delivery retry
  if (deliveryRetryInterval) {
    clearInterval(deliveryRetryInterval);
    deliveryRetryInterval = null;
  }

  // Stop database bridge
  await stopDatabaseBridge();

  // Stop server
  if (wsServer) {
    wsServer.stop();
    wsServer = null;
  }

  console.log("[WS Server] WebSocket server stopped");
}

// ============================================
// Heartbeat with Ping + Dead Connection Cleanup
// ============================================

function startHeartbeat(): void {
  heartbeatInterval = setInterval(() => {
    const now = Date.now();
    const stats = getWSStats();

    for (const [clientId, client] of clients.entries()) {
      // Check if client is alive (responded to last ping within 60s)
      if (now - client.data.lastPing > 60000) {
        console.log(`[WS] Client ${clientId} timed out, closing`);
        try { client.close(4000, "Ping timeout"); } catch { /* ignore */ }
        clients.delete(clientId);
        continue;
      }
      // Send server ping
      try {
        client.send(JSON.stringify({ type: "ping", timestamp: now }));
      } catch (error) {
        console.error(`[WS] Failed to ping ${clientId}, removing`);
        clients.delete(clientId);
      }
    }

    console.log(`[WS Server] Heartbeat - Clients: ${stats.connectedClients}, Channels: ${stats.activeChannels}`);
  }, HEARTBEAT_INTERVAL_MS);
}

// ============================================
// Exports
// ============================================

export { getWSStats } from "./handlers";
export { publishEvent, publishTaskEvent, publishSubtaskEvent, publishMessageEvent } from "./bridge";
