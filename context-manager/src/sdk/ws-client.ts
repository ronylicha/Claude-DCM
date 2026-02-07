/**
 * DCM WebSocket Client
 * Real-time event subscription with auto-reconnect
 */

import type { DCMConfig, WSEvent, EventHandler } from "./types";

type ConnectionState = "disconnected" | "connecting" | "connected" | "authenticated";

export class DCMWebSocket {
  private ws: WebSocket | null = null;
  private config: Required<Pick<DCMConfig, "wsUrl" | "agentId" | "sessionId" | "authToken">>;
  private state: ConnectionState = "disconnected";
  private handlers = new Map<string, Set<EventHandler>>();
  private globalHandlers = new Set<EventHandler>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private subscriptions = new Set<string>();
  private pingInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<DCMConfig>) {
    this.config = {
      wsUrl: config?.wsUrl || "ws://127.0.0.1:3849",
      agentId: config?.agentId || "",
      sessionId: config?.sessionId || "",
      authToken: config?.authToken || "",
    };
  }

  /** Connect to DCM WebSocket server */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.state === "connected" || this.state === "authenticated") {
        resolve();
        return;
      }

      this.state = "connecting";
      const url = this.config.agentId
        ? `${this.config.wsUrl}?agent_id=${this.config.agentId}`
        : this.config.wsUrl;

      try {
        this.ws = new WebSocket(url);
      } catch (error) {
        this.state = "disconnected";
        reject(error);
        return;
      }

      this.ws.onopen = () => {
        this.state = "connected";
        this.reconnectAttempts = 0;
        
        // Authenticate
        this.send({
          type: "auth",
          agent_id: this.config.agentId,
          session_id: this.config.sessionId,
          token: this.config.authToken || undefined,
        });

        // Start ping interval
        this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            this.send({ type: "ping" });
          }
        }, 25000);

        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data));
          this.handleMessage(msg);
        } catch (error) {
          console.error("[DCM-WS] Failed to parse message:", error);
        }
      };

      this.ws.onclose = (event) => {
        this.cleanup();
        if (event.code !== 1000) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error("[DCM-WS] Connection error:", error);
        if (this.state === "connecting") {
          reject(error);
        }
      };
    });
  }

  /** Disconnect from server */
  disconnect(): void {
    this.cleanup();
    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }
  }

  /** Subscribe to a channel */
  subscribe(channel: string): void {
    this.subscriptions.add(channel);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: "subscribe", channel });
    }
  }

  /** Unsubscribe from a channel */
  unsubscribe(channel: string): void {
    this.subscriptions.delete(channel);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.send({ type: "unsubscribe", channel });
    }
  }

  /** Listen for events on a specific channel */
  on(channel: string, handler: EventHandler): () => void {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, new Set());
    }
    this.handlers.get(channel)!.add(handler);
    // Auto-subscribe if not already
    if (!this.subscriptions.has(channel)) {
      this.subscribe(channel);
    }
    // Return unsubscribe function
    return () => {
      this.handlers.get(channel)?.delete(handler);
    };
  }

  /** Listen for ALL events */
  onAny(handler: EventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => { this.globalHandlers.delete(handler); };
  }

  /** Listen for a specific event type across all channels */
  onEvent(eventType: string, handler: EventHandler): () => void {
    return this.onAny((event) => {
      if (event.event === eventType) handler(event);
    });
  }

  /** Publish an event to a channel */
  publish(channel: string, event: string, data: Record<string, unknown>): void {
    this.send({ type: "publish", channel, event, data });
  }

  /** Get current connection state */
  getState(): ConnectionState {
    return this.state;
  }

  /** Check if connected and authenticated */
  isReady(): boolean {
    return this.state === "authenticated" || this.state === "connected";
  }

  private send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private handleMessage(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case "connected":
        this.state = "connected";
        break;

      case "ack":
        if (msg.success) {
          this.state = "authenticated";
          // Restore subscriptions after auth
          for (const channel of this.subscriptions) {
            this.send({ type: "subscribe", channel });
          }
        }
        break;

      case "pong":
        // Server is alive
        break;

      case "ping":
        this.send({ type: "pong" });
        break;

      case "error":
        console.error("[DCM-WS] Server error:", msg);
        break;

      default: {
        // Treat as event message
        const event: WSEvent = {
          id: (msg.id as string) || "",
          channel: (msg.channel as string) || "global",
          event: (msg.event as string) || "unknown",
          data: (msg.data as Record<string, unknown>) || {},
          timestamp: (msg.timestamp as number) || Date.now(),
        };

        // Send acknowledgment
        if (event.id) {
          this.send({ type: "ack", message_id: event.id });
        }

        // Dispatch to channel handlers
        const channelHandlers = this.handlers.get(event.channel);
        if (channelHandlers) {
          for (const handler of channelHandlers) {
            try { handler(event); } catch (e) { console.error("[DCM-WS] Handler error:", e); }
          }
        }

        // Dispatch to global handlers
        for (const handler of this.globalHandlers) {
          try { handler(event); } catch (e) { console.error("[DCM-WS] Global handler error:", e); }
        }
        break;
      }
    }
  }

  private cleanup(): void {
    this.state = "disconnected";
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[DCM-WS] Max reconnect attempts reached");
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[DCM-WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }
}
