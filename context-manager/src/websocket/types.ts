/**
 * WebSocket Types for Distributed Context Manager
 * @module websocket/types
 */

import type { ServerWebSocket } from "bun";

// ============================================
// Channel Types
// ============================================

export type ChannelType = "agents" | "sessions" | "global" | "metrics" | "topics";

export interface Channel {
  type: ChannelType;
  id?: string; // For agents/{id} and sessions/{id}
}

export function parseChannel(channel: string): Channel | null {
  if (channel === "global" || channel === "metrics") {
    return { type: channel };
  }

  if (channel.startsWith("topics/")) {
    return { type: "topics", id: channel.substring(7) };
  }

  const match = channel.match(/^(agents|sessions)\/(.+)$/);
  if (match) {
    return { type: match[1] as ChannelType, id: match[2] };
  }

  return null;
}

export function formatChannel(channel: Channel): string {
  if (channel.id) {
    return `${channel.type}/${channel.id}`;
  }
  return channel.type;
}

// ============================================
// Event Types
// ============================================

export type EventType =
  // Task events
  | "task.created"
  | "task.updated"
  | "task.completed"
  | "task.failed"
  // Subtask events
  | "subtask.created"
  | "subtask.updated"
  | "subtask.completed"
  | "subtask.failed"
  // Message events
  | "message.new"
  | "message.read"
  | "message.expired"
  // Agent events
  | "agent.connected"
  | "agent.disconnected"
  | "agent.heartbeat"
  | "agent.blocked"
  | "agent.unblocked"
  // Metric events
  | "metric.update"
  // Session events
  | "session.created"
  | "session.ended"
  // System events
  | "system.error"
  | "system.info";

// ============================================
// WebSocket Message Types
// ============================================

/** Base message structure */
export interface WSMessage {
  type: "subscribe" | "unsubscribe" | "publish" | "ping" | "pong" | "auth";
  id?: string; // Message correlation ID
  timestamp: number;
}

/** Subscribe to a channel */
export interface WSSubscribe extends WSMessage {
  type: "subscribe";
  channel: string;
}

/** Unsubscribe from a channel */
export interface WSUnsubscribe extends WSMessage {
  type: "unsubscribe";
  channel: string;
}

/** Publish an event */
export interface WSPublish extends WSMessage {
  type: "publish";
  channel: string;
  event: EventType;
  data: unknown;
}

/** Authentication message */
export interface WSAuth extends WSMessage {
  type: "auth";
  agent_id?: string;
  session_id?: string;
  token?: string;
}

/** Ping/Pong for keepalive */
export interface WSPing extends WSMessage {
  type: "ping";
}

export interface WSPong extends WSMessage {
  type: "pong";
}

// ============================================
// Server-to-Client Messages
// ============================================

export interface WSEvent {
  channel: string;
  event: EventType;
  data: unknown;
  timestamp: number;
}

export interface WSError {
  error: string;
  code: string;
  details?: unknown;
  timestamp: number;
}

export interface WSAck {
  type: "ack";
  id: string;
  success: boolean;
  error?: string;
  timestamp: number;
}

export interface WSConnected {
  type: "connected";
  client_id: string;
  timestamp: number;
}

// ============================================
// Client State
// ============================================

export interface WSClientData {
  id: string;
  agent_id?: string;
  session_id?: string;
  subscriptions: Set<string>;
  authenticated: boolean;
  connectedAt: number;
  lastPing: number;
}

export type WSClient = ServerWebSocket<WSClientData>;

// ============================================
// Metric Data Types
// ============================================

export interface MetricSnapshot {
  active_sessions: number;
  active_agents: number;
  pending_tasks: number;
  running_tasks: number;
  completed_tasks_last_hour: number;
  messages_last_hour: number;
  actions_per_minute: number;
  avg_task_duration_ms: number;
  timestamp: number;
}

// ============================================
// Task Event Data
// ============================================

export interface TaskEventData {
  task_id: string;
  request_id: string;
  name?: string;
  wave_number: number;
  status: string;
  agent_type?: string;
  created_at?: string;
  completed_at?: string;
}

export interface SubtaskEventData {
  subtask_id: string;
  task_id: string;
  agent_type?: string;
  agent_id?: string;
  description: string;
  status: string;
  result?: unknown;
}

// ============================================
// Message Event Data
// ============================================

export interface MessageEventData {
  message_id: string;
  from_agent: string;
  to_agent: string;
  channel: string;
  content: unknown;
  priority: number;
  expires_at?: string;
}

// ============================================
// Agent Event Data
// ============================================

export interface AgentEventData {
  agent_id: string;
  agent_type?: string;
  session_id?: string;
  client_id: string;
}

// ============================================
// Utility Types
// ============================================

export type IncomingMessage = WSSubscribe | WSUnsubscribe | WSPublish | WSAuth | WSPing;
export type OutgoingMessage = WSEvent | WSError | WSAck | WSConnected | WSPong;
