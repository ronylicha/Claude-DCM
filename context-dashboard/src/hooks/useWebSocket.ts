"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWSContext } from "@/providers/websocket-provider";

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
  | "system.info"
  | "wave.transitioned"
  | "wave.completed"
  | "wave.failed"
  | "batch.created"
  | "batch.completed"
  | "capacity.warning"
  | "conflict.detected"
  | "proactive.compact"
  | "scope.injected"
  | "registry.updated"
  | "registry.bulk_import"
  | "capacity.update"
  | "capacity.threshold"
  | "summary.status"
  | "cockpit.refresh"
  | "epic.created"
  | "epic.updated"
  | "epic.deleted"
  | "epic.status_changed"
  | "epics.reordered"
  | "epics.created_from_pipeline"
  | "epic.session.created"
  | "epic.session.stream"
  | "epic.session.message"
  | "epic.session.thinking"
  | "epic.session.ended"
  | "epic.task.proposed"
  | "epic.task.approved"
  | "epic.task.rejected"
  | "epic.task.executing"
  | "epic.task.completed"
  | "epic.task.failed"
  | "pipeline.created"
  | "pipeline.ready"
  | "pipeline.step.updated"
  | "pipeline.step.completed"
  | "pipeline.step.failed"
  | "pipeline.completed"
  | "pipeline.failed"
  | "pipeline.planning"
  | "pipeline.planning.chunk"
  | "pipeline.planning.fallback"
  | "pipeline.sprint.completed"
  | "pipeline.sprint.started"
  | "project.updated";

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

// ============================================
// useWebSocket Hook — backed by singleton provider
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
  const { channels = [], onEvent, autoConnect = true } = options;

  const ws = useWSContext();
  const [lastMessage, setLastMessage] = useState<WSEvent | null>(null);

  // Stable listener ID unique per hook instance
  const listenerIdRef = useRef(`ws_${Math.random().toString(36).substring(2, 8)}`);

  // Keep onEvent in a ref so the listener closure is always fresh
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  // Subscribe requested channels on mount / when channels list changes
  useEffect(() => {
    if (!autoConnect) return;
    for (const channel of channels) {
      ws.subscribe(channel);
    }
    // Channels are intentionally not unsubscribed on cleanup — the singleton
    // keeps the subscriptions alive as long as any consumer needs them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect, ws.subscribe, channels.join(",")]);

  // Register / unregister the per-instance event listener
  useEffect(() => {
    const id = listenerIdRef.current;
    ws.addListener(id, (event: WSEvent) => {
      setLastMessage(event);
      onEventRef.current?.(event);
    });
    return () => {
      ws.removeListener(id);
    };
  }, [ws.addListener, ws.removeListener]);

  return {
    connected: ws.connected,
    connecting: ws.connecting,
    lastMessage,
    error: ws.error,
    send: ws.send,
    subscribe: ws.subscribe,
    unsubscribe: ws.unsubscribe,
    reconnect: ws.reconnect,
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

// ============================================
// useWaveEvents Hook
// ============================================

const WAVE_EVENT_TYPES: EventType[] = [
  "wave.transitioned",
  "wave.completed",
  "wave.failed",
  "batch.created",
  "batch.completed",
  "capacity.warning",
];

export interface UseWaveEventsReturn {
  events: WSEvent[];
  connected: boolean;
  error: string | null;
  clearEvents: () => void;
}

export function useWaveEvents(sessionId?: string): UseWaveEventsReturn {
  const [events, setEvents] = useState<WSEvent[]>([]);

  const handleEvent = useCallback(
    (event: WSEvent) => {
      // Only accept wave.*, batch.*, and capacity.* events
      if (!WAVE_EVENT_TYPES.includes(event.event)) {
        return;
      }

      // Filter by sessionId if provided
      if (sessionId) {
        const data = event.data as Record<string, unknown> | null;
        if (data && "session_id" in data && data.session_id !== sessionId) {
          return;
        }
      }

      setEvents((prev) => {
        const newEvents = [event, ...prev];
        // Keep last 50 events
        return newEvents.slice(0, 50);
      });
    },
    [sessionId]
  );

  const { connected, error } = useWebSocket({
    channels: sessionId ? [`session/${sessionId}`, "global"] : ["global"],
    sessionId,
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
// useCapacityAlerts Hook
// ============================================

export interface UseCapacityAlertsReturn {
  alerts: WSEvent[];
  connected: boolean;
  hasActiveAlerts: boolean;
}

export function useCapacityAlerts(): UseCapacityAlertsReturn {
  const [alerts, setAlerts] = useState<WSEvent[]>([]);

  const handleEvent = useCallback((event: WSEvent) => {
    if (event.event !== "capacity.warning") {
      return;
    }

    setAlerts((prev) => {
      const newAlerts = [event, ...prev];
      // Keep last 20 alerts
      return newAlerts.slice(0, 20);
    });
  }, []);

  const { connected } = useWebSocket({
    channels: ["global"],
    onEvent: handleEvent,
  });

  return {
    alerts,
    connected,
    hasActiveAlerts: alerts.length > 0,
  };
}
