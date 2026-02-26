/**
 * WebSocket Server Entry Point
 * Runs as a separate process on port 3849
 * @module websocket-server
 */

import { config, validateConfig } from "./config";
import { testConnection, closeDb } from "./db/client";
import { startWebSocketServer, stopWebSocketServer, getWSStats } from "./websocket/server";
import { createLogger } from "./lib/logger";

const log = createLogger("WSServer");

// ============================================
// Startup
// ============================================

async function main(): Promise<void> {
  log.info("========================================");
  log.info(" Context Manager - WebSocket Server");
  log.info("========================================");
  log.info("");

  // Validate configuration
  try {
    validateConfig();
    log.info(`WebSocket port: ${config.websocket.port}`);
    log.info(`Host: ${config.server.host}`);
  } catch (error) {
    log.error("Validation failed:", error);
    process.exit(1);
  }

  // Test database connection (needed for bridge)
  log.info("Testing database connection...");
  const dbConnected = await testConnection();
  if (!dbConnected) {
    log.error("Failed to connect to database. Exiting.");
    process.exit(1);
  }
  log.info("Database connected");

  // Start WebSocket server
  const server = startWebSocketServer();

  log.info("");
  log.info("========================================");
  log.info(" WebSocket server ready!");
  log.info(` URL: ws://${config.server.host}:${config.websocket.port}`);
  log.info(` Health: http://${config.server.host}:${config.websocket.port}/health`);
  log.info("========================================");
  log.info("");

  // ============================================
  // Graceful Shutdown
  // ============================================

  const shutdown = async (signal: string): Promise<void> => {
    log.info("");
    log.info(`Received ${signal}, shutting down gracefully...`);

    // Log final stats
    const stats = getWSStats();
    log.info(`Final stats - Clients: ${stats.connectedClients}, Channels: ${stats.activeChannels}`);

    // Stop WebSocket server
    await stopWebSocketServer();

    // Close database connection
    await closeDb();

    log.info("Cleanup complete. Exiting.");
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Handle uncaught errors
  process.on("uncaughtException", (error) => {
    log.error("Uncaught exception:", error);
    shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason, promise) => {
    log.error("Unhandled rejection at:", promise, "reason:", reason);
  });

  return Promise.resolve();
}

// Run
main().catch((error) => {
  log.error("Startup failed:", error);
  process.exit(1);
});
