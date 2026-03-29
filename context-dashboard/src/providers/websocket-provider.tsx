'use client';

import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
  useEffect,
} from 'react';
import type { WSEvent } from '@/hooks/useWebSocket';

// ============================================
// Types
// ============================================

type EventListener = (event: WSEvent) => void;

export interface WSContextValue {
  connected: boolean;
  connecting: boolean;
  error: string | null;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  send: (type: string, data: Record<string, unknown>) => void;
  addListener: (id: string, fn: EventListener) => void;
  removeListener: (id: string) => void;
  reconnect: () => void;
}

const WSContext = createContext<WSContextValue | null>(null);

// ============================================
// Configuration
// ============================================

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'ws://127.0.0.1:3849';
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;
const PING_INTERVAL_MS = 25000;

// ============================================
// WebSocketProvider
// ============================================

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef(new Map<string, EventListener>());
  const subscribedChannelsRef = useRef(new Set<string>());
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(false);
  const connectingRef = useRef(false);

  const sendRaw = useCallback((type: string, data: Record<string, unknown>) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type,
          ...data,
          id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          timestamp: Date.now(),
        }),
      );
    }
  }, []);

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
      wsRef.current.close(1000, 'cleanup');
      wsRef.current = null;
    }
    connectingRef.current = false;
  }, []);

  // Forward ref to avoid stale closure in onclose callback
  const connectRef = useRef<() => void>(() => {});

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return;
    if (connectingRef.current) return;

    connectingRef.current = true;
    setConnecting(true);
    setError(null);

    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        connectingRef.current = false;
        setConnected(true);
        setConnecting(false);
        setError(null);
        reconnectAttemptsRef.current = 0;

        // Re-subscribe to all tracked channels after (re)connect
        for (const channel of subscribedChannelsRef.current) {
          sendRaw('subscribe', { channel });
        }

        // Start ping interval to keep the connection alive
        pingIntervalRef.current = setInterval(() => {
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            sendRaw('ping', {});
          }
        }, PING_INTERVAL_MS);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as Record<string, unknown>;

          // Skip protocol-level messages
          if (
            data.type === 'connected' ||
            data.type === 'ack' ||
            data.type === 'pong'
          ) {
            return;
          }

          // Broadcast domain events to all registered listeners
          if ('event' in data && 'channel' in data) {
            const wsEvent = data as unknown as WSEvent;
            for (const listener of listenersRef.current.values()) {
              listener(wsEvent);
            }
          }
        } catch (err) {
          console.error('[WS] Parse error:', err);
        }
      };

      ws.onerror = () => {
        // Use warn — server not running is an expected dev scenario
        console.warn('[WS] Connection failed (server may not be running)');
        setError('WebSocket server unavailable');
      };

      ws.onclose = (closeEvent) => {
        connectingRef.current = false;
        setConnected(false);
        setConnecting(false);

        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

        // Attempt reconnect unless it was a clean close or max attempts reached
        if (
          mountedRef.current &&
          closeEvent.code !== 1000 &&
          reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS
        ) {
          reconnectAttemptsRef.current++;
          const delay = RECONNECT_DELAY_MS * reconnectAttemptsRef.current;
          reconnectTimeoutRef.current = setTimeout(() => {
            if (mountedRef.current) {
              connectRef.current();
            }
          }, delay);
        } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          setError('Max reconnection attempts reached');
        }
      };
    } catch (err) {
      connectingRef.current = false;
      setConnecting(false);
      setError(err instanceof Error ? err.message : 'Failed to connect');
    }
  }, [sendRaw]);

  // Keep connectRef in sync so the onclose callback always calls the latest version
  connectRef.current = connect;

  const subscribe = useCallback(
    (channel: string) => {
      if (!subscribedChannelsRef.current.has(channel)) {
        subscribedChannelsRef.current.add(channel);
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          sendRaw('subscribe', { channel });
        }
      }
    },
    [sendRaw],
  );

  const unsubscribe = useCallback(
    (channel: string) => {
      subscribedChannelsRef.current.delete(channel);
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        sendRaw('unsubscribe', { channel });
      }
    },
    [sendRaw],
  );

  const addListener = useCallback((id: string, fn: EventListener) => {
    listenersRef.current.set(id, fn);
  }, []);

  const removeListener = useCallback((id: string) => {
    listenersRef.current.delete(id);
  }, []);

  const reconnect = useCallback(() => {
    cleanup();
    reconnectAttemptsRef.current = 0;
    connect();
  }, [cleanup, connect]);

  // Connect once on mount; cleanup on unmount
  useEffect(() => {
    // Guard against React StrictMode double-mount
    if (mountedRef.current) return;
    mountedRef.current = true;

    connect();

    return () => {
      mountedRef.current = false;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally empty — run only once

  return (
    <WSContext.Provider
      value={{
        connected,
        connecting,
        error,
        subscribe,
        unsubscribe,
        send: sendRaw,
        addListener,
        removeListener,
        reconnect,
      }}
    >
      {children}
    </WSContext.Provider>
  );
}

// ============================================
// useWSContext
// ============================================

export function useWSContext(): WSContextValue {
  const ctx = useContext(WSContext);
  if (!ctx) {
    throw new Error('useWSContext must be used within <WebSocketProvider>');
  }
  return ctx;
}
