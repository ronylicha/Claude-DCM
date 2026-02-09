/**
 * Configuration for the Distributed Context Manager
 * @module config
 */

export interface Config {
  /** PostgreSQL connection settings */
  database: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
    maxConnections: number;
  };
  /** HTTP API server settings */
  server: {
    host: string;
    port: number;
  };
  /** WebSocket server settings */
  websocket: {
    port: number;
  };
  /** Application settings */
  app: {
    /** Message TTL in milliseconds (default: 1 hour) */
    messageTtlMs: number;
    /** Healthcheck interval in milliseconds */
    healthcheckIntervalMs: number;
    /** Maximum retries for database operations */
    maxDbRetries: number;
  };
  /** Session and snapshot cleanup settings */
  cleanup: {
    /** How old a session/agent must be before eligible for cleanup (hours) */
    staleThresholdHours: number;
    /** How long without activity before considered inactive (minutes) */
    inactiveMinutes: number;
    /** Max age for compact snapshots (hours) */
    snapshotMaxAgeHours: number;
    /** Cleanup interval (milliseconds) */
    intervalMs: number;
    /** Max age for read broadcast messages (hours) */
    readMessageMaxAgeHours: number;
  };
}

/**
 * Load configuration from environment variables with defaults
 */
function loadConfig(): Config {
  return {
    database: {
      host: process.env["DB_HOST"] ?? "localhost",
      port: parseInt(process.env["DB_PORT"] ?? "5432", 10),
      database: process.env["DB_NAME"] ?? "claude_context",
      user: process.env["DB_USER"] ?? "",
      password: process.env["DB_PASSWORD"] ?? "",
      maxConnections: parseInt(process.env["DB_MAX_CONNECTIONS"] ?? "10", 10),
    },
    server: {
      host: process.env["HOST"] ?? "127.0.0.1",
      port: parseInt(process.env["PORT"] ?? "3847", 10),
    },
    websocket: {
      port: parseInt(process.env["WS_PORT"] ?? "3849", 10),
    },
    app: {
      messageTtlMs: parseInt(process.env["MESSAGE_TTL_MS"] ?? "3600000", 10), // 1 hour
      healthcheckIntervalMs: parseInt(process.env["HEALTHCHECK_INTERVAL_MS"] ?? "30000", 10), // 30s
      maxDbRetries: parseInt(process.env["MAX_DB_RETRIES"] ?? "3", 10),
    },
    cleanup: {
      staleThresholdHours: parseFloat(process.env["CLEANUP_STALE_HOURS"] ?? "0.5"),
      inactiveMinutes: parseInt(process.env["CLEANUP_INACTIVE_MINUTES"] ?? "10", 10),
      snapshotMaxAgeHours: parseInt(process.env["CLEANUP_SNAPSHOT_MAX_HOURS"] ?? "24", 10),
      intervalMs: parseInt(process.env["CLEANUP_INTERVAL_MS"] ?? "60000", 10),
      readMessageMaxAgeHours: parseInt(process.env["CLEANUP_READ_MSG_MAX_HOURS"] ?? "24", 10),
    },
  };
}

/** Global configuration instance */
export const config = loadConfig();

/**
 * Get the full PostgreSQL connection URL
 */
export function getDatabaseUrl(): string {
  const { host, port, database, user, password } = config.database;
  const encodedPassword = encodeURIComponent(password);
  return `postgresql://${user}:${encodedPassword}@${host}:${port}/${database}`;
}

/**
 * Validate configuration and throw if invalid
 */
export function validateConfig(): void {
  if (!config.database.user) {
    throw new Error(
      "DB_USER environment variable is required. Set it in your .env file or export it before starting the server."
    );
  }
  if (!config.database.password) {
    throw new Error(
      "DB_PASSWORD environment variable is required. Set it in your .env file or export it before starting the server."
    );
  }
  
  // Validate WS_AUTH_SECRET (strict validation in production, warning in development)
  const wsAuthSecret = process.env["WS_AUTH_SECRET"];
  const isProduction = process.env["NODE_ENV"] === "production";
  
  if (!wsAuthSecret) {
    if (isProduction) {
      throw new Error(
        "WS_AUTH_SECRET environment variable is required in production. Set it in your .env file with a strong random value."
      );
    } else {
      console.warn(
        "[WARN] WS_AUTH_SECRET is not set. WebSocket authentication will fail. Set it in your .env file."
      );
    }
  } else if (wsAuthSecret.length < 32) {
    if (isProduction) {
      throw new Error(
        "WS_AUTH_SECRET must be at least 32 characters long in production for secure authentication."
      );
    } else {
      console.warn(
        "[WARN] WS_AUTH_SECRET is shorter than 32 characters. For production use, ensure it is at least 32 characters long."
      );
    }
  }
  
  if (config.server.port < 1 || config.server.port > 65535) {
    throw new Error(`Invalid server port: ${config.server.port}`);
  }
  if (config.websocket.port < 1 || config.websocket.port > 65535) {
    throw new Error(`Invalid WebSocket port: ${config.websocket.port}`);
  }
  if (config.database.maxConnections < 1) {
    throw new Error(`Invalid max connections: ${config.database.maxConnections}`);
  }
}
