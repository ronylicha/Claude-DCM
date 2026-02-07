"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { PageContainer } from "@/components/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useRealtimeEvents,
  useRealtimeMetrics,
  type WSEvent,
  type EventType,
} from "@/hooks/useWebSocket";
import {
  Activity,
  Users,
  Zap,
  MessageSquare,
  RefreshCw,
  Trash2,
  Pause,
  Play,
  Radio,
} from "lucide-react";

// ============================================
// Types
// ============================================

interface AgentInfo {
  id: string;
  type?: string;
  sessionId?: string;
  active: boolean;
  taskCount?: number;
  lastSeen: number;
}

type EventCategory = "task" | "subtask" | "message" | "agent" | "system";

// ============================================
// Event Category Configuration
// ============================================

function getEventCategory(eventType: string): EventCategory {
  if (eventType.startsWith("task.")) return "task";
  if (eventType.startsWith("subtask.")) return "subtask";
  if (eventType.startsWith("message.")) return "message";
  if (eventType.startsWith("agent.")) return "agent";
  return "system";
}

const categoryConfig: Record<
  EventCategory,
  { color: string; bgColor: string; borderColor: string; iconClass: string }
> = {
  task: {
    color: "text-violet-400",
    bgColor: "bg-violet-500/15",
    borderColor: "border-violet-500/30",
    iconClass: "text-violet-400",
  },
  subtask: {
    color: "text-blue-400",
    bgColor: "bg-blue-500/15",
    borderColor: "border-blue-500/30",
    iconClass: "text-blue-400",
  },
  message: {
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/15",
    borderColor: "border-emerald-500/30",
    iconClass: "text-emerald-400",
  },
  agent: {
    color: "text-amber-400",
    bgColor: "bg-amber-500/15",
    borderColor: "border-amber-500/30",
    iconClass: "text-amber-400",
  },
  system: {
    color: "text-gray-400",
    bgColor: "bg-gray-500/15",
    borderColor: "border-gray-500/30",
    iconClass: "text-gray-400",
  },
};

function CategoryIcon({
  category,
  className,
}: {
  category: EventCategory;
  className?: string;
}) {
  const cls = `h-4 w-4 ${categoryConfig[category].iconClass} ${className ?? ""}`;
  switch (category) {
    case "task":
      return <Activity className={cls} />;
    case "subtask":
      return <Zap className={cls} />;
    case "message":
      return <MessageSquare className={cls} />;
    case "agent":
      return <Users className={cls} />;
    default:
      return <Radio className={cls} />;
  }
}

// ============================================
// Action Labels per Event Type
// ============================================

const eventActionLabels: Record<string, string> = {
  "task.created": "Created",
  "task.updated": "Updated",
  "task.completed": "Completed",
  "task.failed": "Failed",
  "subtask.created": "Created",
  "subtask.updated": "Updated",
  "subtask.completed": "Completed",
  "subtask.failed": "Failed",
  "message.new": "New",
  "message.read": "Read",
  "message.expired": "Expired",
  "agent.connected": "Connected",
  "agent.disconnected": "Disconnected",
  "agent.heartbeat": "Heartbeat",
  "metric.update": "Metrics",
  "system.error": "Error",
  "system.info": "Info",
};

// ============================================
// Relative Time Formatter
// ============================================

function relativeTime(timestamp: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diff < 1) return "now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ============================================
// Filter Definitions
// ============================================

const eventFilters: { label: string; types: EventType[] | undefined }[] = [
  { label: "All", types: undefined },
  {
    label: "Tasks",
    types: ["task.created", "task.updated", "task.completed", "task.failed"],
  },
  {
    label: "Subtasks",
    types: [
      "subtask.created",
      "subtask.updated",
      "subtask.completed",
      "subtask.failed",
    ],
  },
  {
    label: "Messages",
    types: ["message.new", "message.read", "message.expired"],
  },
  {
    label: "Agents",
    types: ["agent.connected", "agent.disconnected", "agent.heartbeat"],
  },
];

// ============================================
// Semi-Circle Gauge (SVG)
// ============================================

function SemiCircleGauge({
  value,
  max,
  color,
  label,
  connected,
}: {
  value: number;
  max: number;
  color: string;
  label: string;
  connected: boolean;
}) {
  const radius = 48;
  const strokeWidth = 8;
  const circumference = Math.PI * radius;
  const displayValue = connected ? value : 0;
  const percentage = Math.min(displayValue / max, 1);
  const dashOffset = circumference * (1 - percentage);

  return (
    <div className="glass-card rounded-xl p-4 text-center">
      <svg
        width="120"
        height="72"
        viewBox="0 0 120 72"
        className="mx-auto"
        role="meter"
        aria-valuenow={displayValue}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label}
      >
        {/* Background track */}
        <path
          d="M 12 64 A 48 48 0 0 1 108 64"
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted-foreground/15"
          strokeLinecap="round"
        />
        {/* Filled arc */}
        <path
          d="M 12 64 A 48 48 0 0 1 108 64"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{
            transition: "stroke-dashoffset 0.5s ease-out",
            filter: `drop-shadow(0 0 6px ${color}40)`,
          }}
        />
      </svg>
      <div className="-mt-8 text-2xl font-bold tabular-nums animate-count-up">
        {connected ? displayValue : "--"}
      </div>
      <div className="text-xs text-muted-foreground mt-1.5">{label}</div>
    </div>
  );
}

// ============================================
// Connection Status Bar
// ============================================

function ConnectionStatusBar({
  connected,
  error,
  latencyMs,
  onReconnect,
}: {
  connected: boolean;
  error: string | null;
  latencyMs: number | null;
  onReconnect: () => void;
}) {
  const dotClass = connected
    ? "dot-healthy"
    : error
      ? "dot-error"
      : "dot-warning animate-pulse";

  return (
    <div className="glass-card rounded-xl px-4 py-2.5 flex items-center gap-3 animate-fade-in">
      <span
        className={`h-2.5 w-2.5 rounded-full flex-shrink-0 ${dotClass}`}
        aria-hidden="true"
      />

      <span className="text-sm font-medium flex-shrink-0">
        {connected ? (
          <span className="status-healthy">Connected</span>
        ) : error ? (
          <span className="status-error">Disconnected</span>
        ) : (
          <span className="status-warning">Connecting...</span>
        )}
      </span>

      <span className="text-xs text-muted-foreground font-mono truncate hidden sm:inline">
        {connected
          ? "ws://127.0.0.1:3849"
          : error
            ? "Server unavailable"
            : "Attempting connection..."}
      </span>

      <div className="flex-1" />

      {connected && latencyMs !== null && (
        <span className="text-xs text-muted-foreground tabular-nums flex-shrink-0">
          {latencyMs.toFixed(0)}ms latency
        </span>
      )}

      {!connected && (
        <Button
          variant="outline"
          size="sm"
          onClick={onReconnect}
          className="h-7 text-xs gap-1.5 flex-shrink-0"
          aria-label="Reconnect to WebSocket server"
        >
          <RefreshCw className="h-3 w-3" />
          Reconnect
        </Button>
      )}
    </div>
  );
}

// ============================================
// Agent Topology Grid
// ============================================

const AGENT_CELL_COLORS = [
  "bg-violet-500/20 text-violet-300 border-violet-500/40",
  "bg-blue-500/20 text-blue-300 border-blue-500/40",
  "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  "bg-amber-500/20 text-amber-300 border-amber-500/40",
  "bg-rose-500/20 text-rose-300 border-rose-500/40",
  "bg-cyan-500/20 text-cyan-300 border-cyan-500/40",
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function AgentTopologyGrid({ agents }: { agents: AgentInfo[] }) {
  return (
    <div className="glass-card rounded-xl p-4 animate-fade-in">
      <div className="flex items-center gap-2 mb-3">
        <Users className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Agent Topology</span>
        {agents.length > 0 && (
          <Badge variant="secondary" className="text-[10px] h-5">
            {agents.length} active
          </Badge>
        )}
      </div>

      {agents.length === 0 ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <span className="h-2 w-2 rounded-full dot-warning flex-shrink-0" />
          <span className="text-sm">No agents connected</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 max-h-32 overflow-auto">
          {agents.map((agent) => {
            const initials =
              agent.id
                .replace(/[^a-zA-Z]/g, "")
                .substring(0, 2)
                .toUpperCase() || "??";
            const colorIdx = hashString(agent.id) % AGENT_CELL_COLORS.length;

            return (
              <div
                key={agent.id}
                title={[
                  agent.id,
                  agent.type ? `(${agent.type})` : null,
                  agent.active ? "Active" : "Idle",
                  agent.taskCount ? `${agent.taskCount} tasks` : null,
                ]
                  .filter(Boolean)
                  .join(" - ")}
                className={`h-10 w-10 rounded-lg border flex items-center justify-center text-xs font-bold transition-all cursor-default ${AGENT_CELL_COLORS[colorIdx]} ${agent.active ? "animate-pulse-glow" : ""}`}
                aria-label={`Agent ${agent.id}${agent.active ? ", active" : ""}`}
              >
                {initials}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================
// Single Event Card
// ============================================

function extractEventInfo(event: WSEvent): {
  title: string;
  description: string;
} {
  const data = event.data as Record<string, unknown>;

  if (
    event.event.startsWith("task.") ||
    event.event.startsWith("subtask.")
  ) {
    const title =
      (data.name as string) ||
      (data.description as string) ||
      event.event;
    let desc = `Status: ${data.status || "unknown"}`;
    if (data.agent_type) desc += ` | Agent: ${data.agent_type}`;
    return { title, description: desc };
  }

  if (event.event.startsWith("message.")) {
    return {
      title: `${data.from_agent || "system"} \u2192 ${data.to_agent || "broadcast"}`,
      description: `Channel: ${data.channel || event.channel}`,
    };
  }

  if (event.event.startsWith("agent.")) {
    return {
      title: (data.agent_id as string) || "Unknown agent",
      description: data.session_id
        ? `Session: ${data.session_id}`
        : "",
    };
  }

  return {
    title: event.event,
    description:
      typeof data === "object" && data !== null
        ? JSON.stringify(data).substring(0, 80)
        : "",
  };
}

function EventCard({
  event,
  index,
  isRecent,
}: {
  event: WSEvent;
  index: number;
  isRecent: boolean;
}) {
  const category = getEventCategory(event.event);
  const config = categoryConfig[category];
  const { title, description } = extractEventInfo(event);
  const actionLabel =
    eventActionLabels[event.event] || event.event.split(".").pop() || "";
  const timeAgo = relativeTime(event.timestamp);

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${config.bgColor} ${config.borderColor} ${isRecent ? "animate-slide-in-right" : ""}`}
      style={
        isRecent
          ? { animationDelay: `${Math.min(index * 50, 250)}ms` }
          : undefined
      }
    >
      {/* Category icon */}
      <div className="flex-shrink-0">
        <CategoryIcon category={category} />
      </div>

      {/* Text content */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold truncate">{title}</div>
        {description && (
          <div className="text-xs text-muted-foreground truncate">
            {description}
          </div>
        )}
      </div>

      {/* Action badge */}
      <Badge
        variant="outline"
        className={`text-[10px] h-5 flex-shrink-0 ${config.color} ${config.borderColor}`}
      >
        {actionLabel}
      </Badge>

      {/* Relative timestamp */}
      <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0 w-14 text-right">
        {timeAgo}
      </span>
    </div>
  );
}

// ============================================
// Animated Event Stream
// ============================================

function AnimatedEventStream({
  events,
  paused,
  activeFilterLabel,
  onFilterChange,
  onClear,
  onTogglePause,
  connected,
}: {
  events: WSEvent[];
  paused: boolean;
  activeFilterLabel: string;
  onFilterChange: (label: string, types: EventType[] | undefined) => void;
  onClear: () => void;
  onTogglePause: () => void;
  connected: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visibleEvents = events.slice(0, 50);

  // Single tick counter to refresh all relative timestamps periodically
  const [, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll to top when new events arrive (newest first)
  useEffect(() => {
    if (!paused && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
  }, [events.length, paused]);

  return (
    <div className="glass-card rounded-xl flex flex-col flex-1 min-h-0 animate-fade-in overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Event Stream</span>
          {connected && !paused && (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {events.length} event{events.length !== 1 ? "s" : ""}
            {activeFilterLabel !== "All" ? " (filtered)" : ""}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onTogglePause}
            className="h-7 text-xs gap-1.5"
            aria-label={paused ? "Resume event stream" : "Pause event stream"}
          >
            {paused ? (
              <>
                <Play className="h-3 w-3" /> Resume
              </>
            ) : (
              <>
                <Pause className="h-3 w-3" /> Pause
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onClear}
            className="h-7 text-xs gap-1.5"
            aria-label="Clear all events"
          >
            <Trash2 className="h-3 w-3" /> Clear
          </Button>
        </div>
      </div>

      {/* Filter pills */}
      <div
        className="flex items-center gap-1.5 px-4 py-2 border-b border-border/30"
        role="tablist"
        aria-label="Filter events by type"
      >
        {eventFilters.map((filter) => {
          const isActive = activeFilterLabel === filter.label;
          return (
            <button
              key={filter.label}
              role="tab"
              aria-selected={isActive}
              onClick={() => onFilterChange(filter.label, filter.types)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {/* Event list with optional pause overlay */}
      <div className="relative flex-1 min-h-0">
        {paused && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[2px] pointer-events-none">
            <div className="animate-pulse text-sm font-semibold text-muted-foreground flex items-center gap-2">
              <Pause className="h-4 w-4" />
              Paused
            </div>
          </div>
        )}

        <div
          ref={containerRef}
          className="h-full overflow-y-auto px-3 py-2 space-y-1.5"
        >
          {visibleEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Activity className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">Waiting for events...</p>
              <p className="text-xs mt-1 opacity-60">
                Events will appear here in real-time
              </p>
            </div>
          ) : (
            visibleEvents.map((event, index) => (
              <EventCard
                key={`${event.timestamp}-${event.event}`}
                event={event}
                index={index}
                isRecent={Date.now() - event.timestamp < 1200}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Main Page Component
// ============================================

export default function LivePage() {
  const [activeFilter, setActiveFilter] = useState<EventType[] | undefined>(
    undefined,
  );
  const [activeFilterLabel, setActiveFilterLabel] = useState("All");
  const [paused, setPaused] = useState(false);
  const [agents, setAgents] = useState<Map<string, AgentInfo>>(new Map());

  const {
    metrics,
    connected: metricsConnected,
    error: metricsError,
  } = useRealtimeMetrics();

  const { events, connected, error, clearEvents } = useRealtimeEvents({
    channels: ["global"],
    eventTypes: activeFilter,
    maxEvents: 100,
  });

  // Derive connection state from both hooks
  const isConnected = connected || metricsConnected;
  const connectionError = !isConnected ? error || metricsError : null;

  // Track agents from incoming events
  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    if (!latest) return;
    const data = latest.data as Record<string, unknown>;
    const agentId = data.agent_id as string | undefined;

    if (!agentId) return;

    if (latest.event === "agent.connected") {
      setAgents((prev) => {
        const next = new Map(prev);
        next.set(agentId, {
          id: agentId,
          type: (data.agent_type as string) || undefined,
          sessionId: (data.session_id as string) || undefined,
          active: true,
          lastSeen: latest.timestamp,
        });
        return next;
      });
    } else if (latest.event === "agent.disconnected") {
      setAgents((prev) => {
        const next = new Map(prev);
        next.delete(agentId);
        return next;
      });
    } else if (latest.event === "agent.heartbeat") {
      setAgents((prev) => {
        const next = new Map(prev);
        const existing = next.get(agentId);
        next.set(agentId, {
          id: agentId,
          type:
            (data.agent_type as string) || existing?.type || undefined,
          sessionId:
            (data.session_id as string) || existing?.sessionId || undefined,
          active: true,
          taskCount: existing?.taskCount,
          lastSeen: latest.timestamp,
        });
        return next;
      });
    }
  }, [events]);

  const agentList = useMemo(() => Array.from(agents.values()), [agents]);

  const handleFilterChange = useCallback(
    (label: string, types: EventType[] | undefined) => {
      setActiveFilterLabel(label);
      setActiveFilter(types);
    },
    [],
  );

  const handleReconnect = useCallback(() => {
    window.location.reload();
  }, []);

  // Use avg_task_duration_ms as a latency proxy when db_latency_ms is unavailable
  const latencyMs = metrics?.avg_task_duration_ms ?? null;

  return (
    <PageContainer
      title="Live Activity"
      description="Real-time monitoring and activity stream"
    >
      <div className="flex flex-col gap-4 h-[calc(100vh-180px)]">
        {/* Row 1 -- Connection status (full width) */}
        <ConnectionStatusBar
          connected={isConnected}
          error={connectionError}
          latencyMs={latencyMs}
          onReconnect={handleReconnect}
        />

        {/* Offline notice */}
        {connectionError && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 animate-fade-in">
            <p className="text-sm text-amber-200">
              <strong>WebSocket server offline.</strong> Start it with:{" "}
              <code className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs font-mono">
                cd ~/.claude/services/context-manager &amp;&amp; bun run ws
              </code>
            </p>
          </div>
        )}

        {/* Row 2 -- Gauges (4 columns) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 stagger-children">
          <SemiCircleGauge
            value={metrics?.active_sessions ?? 0}
            max={10}
            color="#3b82f6"
            label="Active Sessions"
            connected={isConnected}
          />
          <SemiCircleGauge
            value={metrics?.active_agents ?? 0}
            max={20}
            color="#8b5cf6"
            label="Active Agents"
            connected={isConnected}
          />
          <SemiCircleGauge
            value={metrics?.pending_tasks ?? 0}
            max={50}
            color="#f59e0b"
            label="Pending Tasks"
            connected={isConnected}
          />
          <SemiCircleGauge
            value={metrics?.actions_per_minute ?? 0}
            max={100}
            color="#22c55e"
            label="Actions / min"
            connected={isConnected}
          />
        </div>

        {/* Row 3 -- Agent Topology (full width, max-h-32 with overflow) */}
        <AgentTopologyGrid agents={agentList} />

        {/* Row 4 -- Event Stream (full width, flex-1 takes remaining height) */}
        <AnimatedEventStream
          events={events}
          paused={paused}
          activeFilterLabel={activeFilterLabel}
          onFilterChange={handleFilterChange}
          onClear={clearEvents}
          onTogglePause={() => setPaused((p) => !p)}
          connected={isConnected}
        />
      </div>
    </PageContainer>
  );
}
