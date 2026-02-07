/**
 * WebSocket Server Entry Point
 * Runs as a separate process on port 3849
 * @module websocket-server
 */

import { config, validateConfig } from "./config";
import { testConnection, closeDb } from "./db/client";
import { startWebSocketServer, stopWebSocketServer, getWSStats } from "./websocket/server";

// ============================================
// Startup
// ============================================

async function main(): Promise<void> {
  console.log("========================================");
  console.log(" Context Manager - WebSocket Server");
  console.log("========================================");
  console.log();

  // Validate configuration
  try {
    validateConfig();
    console.log(`[Config] WebSocket port: ${config.websocket.port}`);
    console.log(`[Config] Host: ${config.server.host}`);
  } catch (error) {
    console.error("[Config] Validation failed:", error);
    process.exit(1);
  }

  // Test database connection (needed for bridge)
  console.log("[DB] Testing database connection...");
  const dbConnected = await testConnection();
  if (!dbConnected) {
    console.error("[DB] Failed to connect to database. Exiting.");
    process.exit(1);
  }
  console.log("[DB] Database connected");

  // Start WebSocket server
  const server = startWebSocketServer();

  console.log();
  console.log("========================================");
  console.log(` WebSocket server ready!`);
  console.log(` URL: ws://${config.server.host}:${config.websocket.port}`);
  console.log(` Health: http://${config.server.host}:${config.websocket.port}/health`);
  console.log("========================================");
  console.log();

  // ============================================
  // Graceful Shutdown
  // ============================================

  const shutdown = async (signal: string): Promise<void> => {
    console.log();
    console.log(`[Shutdown] Received ${signal}, shutting down gracefully...`);

    // Log final stats
    const stats = getWSStats();
    console.log(`[Shutdown] Final stats - Clients: ${stats.connectedClients}, Channels: ${stats.activeChannels}`);

    // Stop WebSocket server
    await stopWebSocketServer();

    // Close database connection
    await closeDb();

    console.log("[Shutdown] Cleanup complete. Exiting.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    console.error("[Error] Uncaught exception:", error);
    shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason, promise) => {
    console.error("[Error] Unhandled rejection at:", promise, "reason:", reason);
  });

  return Promise.resolve();
}

// Run
main().catch((error) => {
  console.error("[Fatal] Startup failed:", error);
  process.exit(1);
});
