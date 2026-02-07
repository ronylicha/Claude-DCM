/**
 * WebSocket Message Handlers
 * @module websocket/handlers
 */

import type {
  WSClient,
  WSClientData,
  IncomingMessage,
  WSSubscribe,
  WSUnsubscribe,
  WSPublish,
  WSAuth,
  WSAck,
  WSConnected,
  WSEvent,
  WSError,
  EventType,
} from "./types";
import { parseChannel } from "./types";
import { validateToken } from "./auth";

// ============================================
// Client Registry
// ============================================

/** Map of client_id -> WSClient */
export const clients = new Map<string, WSClient>();

/** Map of channel -> Set<client_id> */
const channels = new Map<string, Set<string>>();

// ============================================
// Message Delivery Queue
// ============================================

/** Pending messages awaiting acknowledgment (at-least-once delivery) */
const pendingMessages = new Map<string, { msg: string; clientId: string; attempts: number; sentAt: number }>();
const MAX_RETRY_ATTEMPTS = 3;
const ACK_TIMEOUT_MS = 5000;

// ============================================
// Reconnection: Subscription Restore
// ============================================

/** Store last known subscriptions per agent for reconnection restore */
const agentSubscriptions = new Map<string, Set<string>>();

// ============================================
// Connection Handlers
// ============================================

/**
 * Handle new WebSocket connection
 */
export function handleConnection(ws: WSClient): void {
  const clientId = ws.data.id;

  // Register client
  clients.set(clientId, ws);

  console.log(`[WS] Client connected: ${clientId}`);

  // Send connected message
  const connectedMsg: WSConnected = {
    type: "connected",
    client_id: clientId,
    timestamp: Date.now(),
  };

  ws.send(JSON.stringify(connectedMsg));

  // Auto-subscribe to global channel
  subscribeToChannel(ws, "global");
}

/**
 * Handle WebSocket message
 */
export function handleMessage(ws: WSClient, message: string | Buffer): void {
  try {
    const msgStr = typeof message === "string" ? message : message.toString();
    const parsed = JSON.parse(msgStr) as IncomingMessage & { message_id?: string };

    switch (parsed.type) {
      case "subscribe":
        handleSubscribe(ws, parsed as WSSubscribe);
        break;
      case "unsubscribe":
        handleUnsubscribe(ws, parsed as WSUnsubscribe);
        break;
      case "publish":
        handlePublish(ws, parsed as WSPublish);
        break;
      case "auth":
        handleAuth(ws, parsed as WSAuth);
        break;
      case "ping":
        handlePing(ws);
        break;
      case "ack" as string:
        // Client acknowledges receipt of a tracked message
        if (parsed.message_id) {
          pendingMessages.delete(`${parsed.message_id}:${ws.data.id}`);
        }
        break;
      default:
        sendError(ws, "UNKNOWN_MESSAGE_TYPE", `Unknown message type: ${(parsed as { type: string }).type}`);
    }
  } catch (error) {
    console.error("[WS] Failed to parse message:", error);
    sendError(ws, "PARSE_ERROR", "Failed to parse message");
  }
}

/**
 * Handle WebSocket close
 */
export function handleClose(ws: WSClient): void {
  const clientId = ws.data.id;

  console.log(`[WS] Client disconnected: ${clientId}`);

  // Unsubscribe from all channels
  for (const channel of ws.data.subscriptions) {
    const subscribers = channels.get(channel);
    if (subscribers) {
      subscribers.delete(clientId);
      if (subscribers.size === 0) {
        channels.delete(channel);
      }
    }
  }

  // Remove client
  clients.delete(clientId);

  // Clean up pending messages for this client
  for (const [key] of pendingMessages) {
    if (key.endsWith(`:${clientId}`)) {
      pendingMessages.delete(key);
    }
  }

  // Broadcast agent.disconnected if authenticated
  if (ws.data.agent_id) {
    broadcast("global", "agent.disconnected", {
      agent_id: ws.data.agent_id,
      client_id: clientId,
      session_id: ws.data.session_id,
    });
  }
}

// ============================================
// Message Type Handlers
// ============================================

function handleSubscribe(ws: WSClient, msg: WSSubscribe): void {
  const channel = msg.channel;
  const parsed = parseChannel(channel);

  if (!parsed) {
    sendAck(ws, msg.id, false, `Invalid channel format: ${channel}`);
    return;
  }

  // Check authorization for private channels
  if (parsed.type === "agents" && parsed.id !== ws.data.agent_id && !ws.data.authenticated) {
    sendAck(ws, msg.id, false, "Not authorized to subscribe to this agent channel");
    return;
  }

  subscribeToChannel(ws, channel);
  sendAck(ws, msg.id, true);

  console.log(`[WS] Client ${ws.data.id} subscribed to ${channel}`);
}

function handleUnsubscribe(ws: WSClient, msg: WSUnsubscribe): void {
  const channel = msg.channel;

  unsubscribeFromChannel(ws, channel);
  sendAck(ws, msg.id, true);

  console.log(`[WS] Client ${ws.data.id} unsubscribed from ${channel}`);
}

function handlePublish(ws: WSClient, msg: WSPublish): void {
  // Validate event type
  const validEvents = [
    "task.created", "task.updated", "task.completed", "task.failed",
    "subtask.created", "subtask.updated", "subtask.completed", "subtask.failed",
    "message.new", "message.read", "message.expired",
    "agent.connected", "agent.disconnected", "agent.heartbeat",
    "metric.update", "system.error", "system.info",
  ];

  if (!validEvents.includes(msg.event)) {
    sendAck(ws, msg.id, false, `Invalid event type: ${msg.event}`);
    return;
  }

  // Broadcast to channel
  broadcast(msg.channel, msg.event, msg.data);
  sendAck(ws, msg.id, true);

  console.log(`[WS] Client ${ws.data.id} published ${msg.event} to ${msg.channel}`);
}

function handleAuth(ws: WSClient, msg: WSAuth): void {
  // Validate token if provided
  if (msg.token) {
    const payload = validateToken(msg.token);
    if (!payload) {
      sendError(ws, "4001", "Invalid or expired token");
      return;
    }
    ws.data.agent_id = payload.agent_id;
    ws.data.session_id = payload.session_id || ws.data.session_id;
    ws.data.authenticated = true;
  } else if (msg.agent_id) {
    // Fallback: allow agent_id without token in dev mode
    if (process.env["NODE_ENV"] === "production") {
      sendError(ws, "4002", "Token required in production mode");
      return;
    }
    ws.data.agent_id = msg.agent_id;
    ws.data.session_id = msg.session_id || ws.data.session_id;
    ws.data.authenticated = true;
  } else {
    sendError(ws, "4003", "Missing token or agent_id");
    return;
  }

  // Send auth success
  sendAck(ws, msg.id, true);

  // Auto-subscribe to agent's private channel
  if (ws.data.agent_id) {
    subscribeToChannel(ws, `agents/${ws.data.agent_id}`);
  }
  if (ws.data.session_id) {
    subscribeToChannel(ws, `sessions/${ws.data.session_id}`);
  }

  // Restore previous subscriptions on reconnection
  const previousSubs = agentSubscriptions.get(ws.data.agent_id || "");
  if (previousSubs) {
    for (const channel of previousSubs) {
      subscribeToChannel(ws, channel);
    }
    console.log(`[WS] Restored ${previousSubs.size} subscriptions for ${ws.data.agent_id}`);
  }

  // Broadcast agent.connected
  if (ws.data.agent_id) {
    broadcast("global", "agent.connected", {
      agent_id: ws.data.agent_id,
      client_id: ws.data.id,
      session_id: ws.data.session_id,
    });
  }

  console.log(`[WS] Client ${ws.data.id} authenticated as agent: ${ws.data.agent_id}`);
}

function handlePing(ws: WSClient): void {
  ws.data.lastPing = Date.now();
  ws.send(JSON.stringify({ type: "pong", timestamp: Date.now() }));
}

// ============================================
// Channel Management
// ============================================

function subscribeToChannel(ws: WSClient, channel: string): void {
  // Add to client's subscriptions
  ws.data.subscriptions.add(channel);

  // Add client to channel
  if (!channels.has(channel)) {
    channels.set(channel, new Set());
  }
  channels.get(channel)!.add(ws.data.id);

  // Persist subscription for reconnection restore
  if (ws.data.agent_id) {
    if (!agentSubscriptions.has(ws.data.agent_id)) {
      agentSubscriptions.set(ws.data.agent_id, new Set());
    }
    agentSubscriptions.get(ws.data.agent_id)!.add(channel);
  }
}

function unsubscribeFromChannel(ws: WSClient, channel: string): void {
  // Remove from client's subscriptions
  ws.data.subscriptions.delete(channel);

  // Remove client from channel
  const subscribers = channels.get(channel);
  if (subscribers) {
    subscribers.delete(ws.data.id);
    if (subscribers.size === 0) {
      channels.delete(channel);
    }
  }
}

// ============================================
// Broadcasting
// ============================================

/**
 * Broadcast an event to all subscribers of a channel
 * Tracks delivery for important events (task.*, subtask.*, message.*)
 */
export function broadcast(channel: string, event: EventType, data: unknown): void {
  const subscribers = channels.get(channel);

  if (!subscribers || subscribers.size === 0) {
    return;
  }

  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const msgObj = {
    id: msgId,
    channel,
    event,
    data,
    timestamp: Date.now(),
  };
  const msgStr = JSON.stringify(msgObj);

  for (const clientId of subscribers) {
    const client = clients.get(clientId);
    if (client) {
      try {
        client.send(msgStr);
        // Track for delivery confirmation (only for important events)
        if (event.startsWith("task.") || event.startsWith("subtask.") || event.startsWith("message.")) {
          pendingMessages.set(`${msgId}:${clientId}`, { msg: msgStr, clientId, attempts: 1, sentAt: Date.now() });
        }
      } catch (error) {
        console.error(`[WS] Failed to send to client ${clientId}:`, error);
        // Remove failed client
        clients.delete(clientId);
        subscribers.delete(clientId);
      }
    }
  }
}

/**
 * Broadcast to all connected clients
 */
export function broadcastAll(event: EventType, data: unknown): void {
  const message: WSEvent = {
    channel: "global",
    event,
    data,
    timestamp: Date.now(),
  };

  const msgStr = JSON.stringify(message);

  for (const client of clients.values()) {
    try {
      client.send(msgStr);
    } catch (error) {
      console.error(`[WS] Failed to broadcast to client:`, error);
    }
  }
}

// ============================================
// Delivery Retry
// ============================================

/**
 * Start the delivery retry interval for at-least-once semantics.
 * Retries unacknowledged messages up to MAX_RETRY_ATTEMPTS times.
 */
export function startDeliveryRetry(): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const now = Date.now();
    for (const [key, pending] of pendingMessages.entries()) {
      if (now - pending.sentAt > ACK_TIMEOUT_MS) {
        if (pending.attempts >= MAX_RETRY_ATTEMPTS) {
          pendingMessages.delete(key);
          continue;
        }
        const client = clients.get(pending.clientId);
        if (client) {
          try {
            client.send(pending.msg);
            pending.attempts++;
            pending.sentAt = now;
          } catch {
            pendingMessages.delete(key);
          }
        } else {
          pendingMessages.delete(key);
        }
      }
    }
  }, 2000);
}

// ============================================
// Utility Functions
// ============================================

function sendAck(ws: WSClient, id: string | undefined, success: boolean, error?: string): void {
  if (!id) return;

  const ack: WSAck = {
    type: "ack",
    id,
    success,
    error,
    timestamp: Date.now(),
  };

  ws.send(JSON.stringify(ack));
}

function sendError(ws: WSClient, code: string, message: string): void {
  const error: WSError = {
    error: message,
    code,
    timestamp: Date.now(),
  };

  ws.send(JSON.stringify(error));
}

// ============================================
// Stats & Monitoring
// ============================================

/**
 * Get WebSocket server stats
 */
export function getWSStats(): {
  connectedClients: number;
  activeChannels: number;
  channelStats: Record<string, number>;
  pendingDeliveries: number;
} {
  const channelStats: Record<string, number> = {};

  for (const [channel, subscribers] of channels) {
    channelStats[channel] = subscribers.size;
  }

  return {
    connectedClients: clients.size,
    activeChannels: channels.size,
    channelStats,
    pendingDeliveries: pendingMessages.size,
  };
}

/**
 * Get all connected client IDs
 */
export function getConnectedClients(): string[] {
  return Array.from(clients.keys());
}

/**
 * Check if a specific client is connected
 */
export function isClientConnected(clientId: string): boolean {
  return clients.has(clientId);
}

/**
 * Get client by agent ID
 */
export function getClientByAgentId(agentId: string): WSClient | undefined {
  for (const client of clients.values()) {
    if (client.data.agent_id === agentId) {
      return client;
    }
  }
  return undefined;
}
