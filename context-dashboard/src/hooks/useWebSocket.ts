"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ============================================
// Types
// ============================================

export type EventType =
  | "task.created"
  | "task.updated"
  | "task.completed"
  | "task.failed"
  | "subtask.created"
  | "subtask.updated"
  | "subtask.completed"
  | "subtask.failed"
  | "subtask.running"
  | "message.new"
  | "message.read"
  | "message.expired"
  | "agent.connected"
  | "agent.disconnected"
  | "agent.heartbeat"
  | "agent.blocked"
  | "agent.unblocked"
  | "session.created"
  | "session.ended"
  | "metric.update"
  | "system.error"
  | "system.info";

export interface WSEvent {
  channel: string;
  event: EventType;
  data: unknown;
  timestamp: number;
}

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

interface WSMessage {
  type: string;
  [key: string]: unknown;
}

// ============================================
// Configuration
// ============================================

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://127.0.0.1:3849";
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;
const PING_INTERVAL_MS = 25000;

// ============================================
// useWebSocket Hook
// ============================================

export interface UseWebSocketOptions {
  channels?: string[];
  agentId?: string;
  sessionId?: string;
  token?: string;
  onEvent?: (event: WSEvent) => void;
  autoConnect?: boolean;
}

export interface UseWebSocketReturn {
  connected: boolean;
  connecting: boolean;
  lastMessage: WSEvent | null;
  error: string | null;
  send: (type: string, data: Record<string, unknown>) => void;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  reconnect: () => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    channels = [],
    agentId,
    sessionId,
    token,
    onEvent,
    autoConnect = true,
  } = options;

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [lastMessage, setLastMessage] = useState<WSEvent | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs for stable references (avoid dependency issues)
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const subscribedChannelsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(false);
  const connectingRef = useRef(false);

  // Store options in refs to avoid dependency issues
  const optionsRef = useRef({ channels, agentId, sessionId, token, onEvent });
  optionsRef.current = { channels, agentId, sessionId, token, onEvent };

  // Helper function to send messages (uses wsRef directly)
  const sendMessage = useCallback((type: string, data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: WSMessage = {
        type,
        ...data,
        id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: Date.now(),
      };
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Stable send function (no dependencies)
  const send = useCallback((type: string, data: Record<string, unknown>) => {
    sendMessage(type, data);
  }, [sendMessage]);

  // Stable subscribe function (no dependencies on other callbacks)
  const subscribe = useCallback((channel: string) => {
    if (!subscribedChannelsRef.current.has(channel)) {
      subscribedChannelsRef.current.add(channel);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        sendMessage("subscribe", { channel });
      }
    }
  }, [sendMessage]);

  // Stable unsubscribe function (no dependencies on other callbacks)
  const unsubscribe = useCallback((channel: string) => {
    if (subscribedChannelsRef.current.has(channel)) {
      subscribedChannelsRef.current.delete(channel);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        sendMessage("unsubscribe", { channel });
      }
    }
  }, [sendMessage]);

  // Cleanup function (stable, no dependencies)
  const cleanup = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close(1000, "cleanup");
      wsRef.current = null;
    }
    connectingRef.current = false;
  }, []);

  // Connect function - uses refs to avoid dependencies
  const connect = useCallback(() => {
    // Prevent double connections
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;
    if (connectingRef.current) return;

    connectingRef.current = true;
    setConnecting(true);
    setError(null);

    // Read options from ref
    const { agentId: aid, sessionId: sid, token: tkn, channels: chs, onEvent: onEvt } = optionsRef.current;

    // Build URL with query params
    const url = new URL(WS_URL);
    if (aid) url.searchParams.set("agent_id", aid);
    if (sid) url.searchParams.set("session_id", sid);

    try {
      const ws = new WebSocket(url.toString());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[WS] Connected");
        connectingRef.current = false;
        setConnected(true);
        setConnecting(false);
        setError(null);
        reconnectAttemptsRef.current = 0;

        // Authenticate if needed
        if (aid || sid || tkn) {
          sendMessage("auth", {
            ...(tkn ? { token: tkn } : {}),
            agent_id: aid,
            session_id: sid,
          });
        }

        // Subscribe to initial channels
        for (const channel of chs) {
          if (!subscribedChannelsRef.current.has(channel)) {
            subscribedChannelsRef.current.add(channel);
          }
          sendMessage("subscribe", { channel });
        }

        // Restore subscriptions after reconnect
        for (const channel of subscribedChannelsRef.current) {
          if (!chs.includes(channel)) {
            sendMessage("subscribe", { channel });
          }
        }

        // Start ping interval
        pingIntervalRef.current = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            sendMessage("ping", {});
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WSMessage;

          // Handle different message types
          if (data.type === "connected") {
            console.log("[WS] Received connected confirmation");
            return;
          }

          if (data.type === "ack") {
            // Acknowledgment - could log or handle
            return;
          }

          if (data.type === "pong") {
            // Pong response - connection is alive
            return;
          }

          // It's an event
          if ("event" in data && "channel" in data) {
            const wsEvent = data as unknown as WSEvent;
            setLastMessage(wsEvent);
            // Use ref to get current onEvent callback
            optionsRef.current.onEvent?.(wsEvent);
          }
        } catch (err) {
          console.error("[WS] Failed to parse message:", err);
        }
      };

      ws.onerror = () => {
        // WebSocket errors are expected when the server is not running
        // Use warn instead of error to avoid alarming users
        console.warn("[WS] WebSocket connection failed (server may not be running)");
        setError("WebSocket server unavailable");
      };

      ws.onclose = (event) => {
        console.log(`[WS] Disconnected: ${event.code} ${event.reason}`);
        connectingRef.current = false;
        setConnected(false);
        setConnecting(false);

        // Clear ping interval
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // Only attempt reconnect if still mounted and not a clean close
        if (mountedRef.current && event.code !== 1000 && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++;
          const delay = RECONNECT_DELAY_MS * reconnectAttemptsRef.current;
          console.log(`[WS] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connect();
            }
          }, delay);
        } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          setError("Max reconnection attempts reached");
        }
      };
    } catch (err) {
      console.error("[WS] Failed to create WebSocket:", err);
      connectingRef.current = false;
      setConnecting(false);
      setError(err instanceof Error ? err.message : "Failed to connect");
    }
  }, [sendMessage]);

  // Reconnect function
  const reconnect = useCallback(() => {
    cleanup();
    reconnectAttemptsRef.current = 0;
    connect();
  }, [cleanup, connect]);

  // Auto-connect on mount - run only once
  useEffect(() => {
    // Prevent double-mount in StrictMode
    if (mountedRef.current) return;
    mountedRef.current = true;

    if (autoConnect) {
      connect();
    }

    return () => {
      mountedRef.current = false;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty - run only once on mount

  return {
    connected,
    connecting,
    lastMessage,
    error,
    send,
    subscribe,
    unsubscribe,
    reconnect,
  };
}

// ============================================
// useRealtimeMetrics Hook
// ============================================

export interface UseRealtimeMetricsReturn {
  metrics: MetricSnapshot | null;
  connected: boolean;
  error: string | null;
}

export function useRealtimeMetrics(): UseRealtimeMetricsReturn {
  const [metrics, setMetrics] = useState<MetricSnapshot | null>(null);

  const handleEvent = useCallback((event: WSEvent) => {
    if (event.event === "metric.update") {
      setMetrics(event.data as MetricSnapshot);
    }
  }, []);

  const { connected, error } = useWebSocket({
    channels: ["metrics"],
    onEvent: handleEvent,
  });

  return {
    metrics,
    connected,
    error,
  };
}

// ============================================
// useRealtimeEvents Hook
// ============================================

export interface UseRealtimeEventsOptions {
  channels?: string[];
  eventTypes?: EventType[];
  maxEvents?: number;
}

export interface UseRealtimeEventsReturn {
  events: WSEvent[];
  connected: boolean;
  error: string | null;
  clearEvents: () => void;
}

export function useRealtimeEvents(
  options: UseRealtimeEventsOptions = {}
): UseRealtimeEventsReturn {
  const { channels = ["global"], eventTypes, maxEvents = 100 } = options;

  const [events, setEvents] = useState<WSEvent[]>([]);

  const handleEvent = useCallback(
    (event: WSEvent) => {
      // Filter by event type if specified
      if (eventTypes && !eventTypes.includes(event.event)) {
        return;
      }

      setEvents((prev) => {
        const newEvents = [event, ...prev];
        // Keep only maxEvents
        return newEvents.slice(0, maxEvents);
      });
    },
    [eventTypes, maxEvents]
  );

  const { connected, error } = useWebSocket({
    channels,
    onEvent: handleEvent,
  });

  const clearEvents = useCallback(() => {
    setEvents([]);
  }, []);

  return {
    events,
    connected,
    error,
    clearEvents,
  };
}

// ============================================
// useAgentChannel Hook
// ============================================

export interface UseAgentChannelOptions {
  agentId: string;
  onMessage?: (event: WSEvent) => void;
}

export interface UseAgentChannelReturn {
  connected: boolean;
  messages: WSEvent[];
  sendMessage: (toAgent: string, content: unknown) => void;
}

export function useAgentChannel(
  options: UseAgentChannelOptions
): UseAgentChannelReturn {
  const { agentId, onMessage } = options;
  const [messages, setMessages] = useState<WSEvent[]>([]);

  const handleEvent = useCallback(
    (event: WSEvent) => {
      if (event.event.startsWith("message.")) {
        setMessages((prev) => [...prev, event].slice(-50));
        onMessage?.(event);
      }
    },
    [onMessage]
  );

  const { connected, send } = useWebSocket({
    agentId,
    channels: [`agents/${agentId}`],
    onEvent: handleEvent,
  });

  const sendMessage = useCallback(
    (toAgent: string, content: unknown) => {
      send("publish", {
        channel: `agents/${toAgent}`,
        event: "message.new",
        data: {
          from_agent: agentId,
          to_agent: toAgent,
          content,
        },
      });
    },
    [agentId, send]
  );

  return {
    connected,
    messages,
    sendMessage,
  };
}
