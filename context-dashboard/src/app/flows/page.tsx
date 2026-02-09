"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import apiClient, {
  type ActiveSessionsResponse,
  type ActiveAgent,
  type SessionsStats,
  type ActionsResponse,
} from "@/lib/api-client";
import { PageContainer } from "@/components/PageContainer";
import { PremiumKPICard } from "@/components/dashboard";
import { Badge } from "@/components/ui/badge";
import {
  useRealtimeMetrics,
  useRealtimeEvents,
  type WSEvent,
} from "@/hooks/useWebSocket";
import {
  Activity,
  Users,
  Zap,
  Radio,
  ArrowRight,
  ArrowLeft,
  Filter,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================
// Types
// ============================================

interface SessionNode {
  id: string;
  label: string;
  agentCount: number;
  status: "active" | "idle" | "compacting" | "error";
  x: number;
  y: number;
}

type TimelineFilter = "all" | "orchestration" | "actions" | "messages" | "sessions";

// ============================================
// Helpers
// ============================================

function truncateId(id: string, len = 8): string {
  return id.length > len ? id.slice(0, len) : id;
}

function calculateNodePositions(
  count: number,
  centerX: number,
  centerY: number,
  radius: number
): { x: number; y: number }[] {
  if (count === 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const angle = (2 * Math.PI * i) / count - Math.PI / 2;
    return {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
    };
  });
}

function getStatusColor(status: string): string {
  switch (status) {
    case "active": return "#22c55e";
    case "idle": return "#71717a";
    case "compacting": return "#eab308";
    case "error": return "#ef4444";
    default: return "#71717a";
  }
}

function getEventDirection(event: WSEvent): "outbound" | "inbound" | "internal" {
  const type = event.event;
  if (type.startsWith("session.") || type === "scope.injected" || type === "batch.created") return "outbound";
  if (type.startsWith("agent.") || type.startsWith("subtask.") || type.startsWith("task.")) return "inbound";
  return "internal";
}

function getEventLabel(event: WSEvent): string {
  return event.event.replace(".", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function getEventFilterMatch(event: WSEvent, filter: TimelineFilter): boolean {
  if (filter === "all") return true;
  const type = event.event;
  switch (filter) {
    case "orchestration": return type.startsWith("wave.") || type.startsWith("batch.") || type === "scope.injected";
    case "actions": return type.startsWith("task.") || type.startsWith("subtask.");
    case "messages": return type.startsWith("message.") || type === "capacity.warning" || type === "conflict.detected";
    case "sessions": return type.startsWith("session.") || type.startsWith("agent.");
    default: return true;
  }
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ============================================
// Sub-components
// ============================================

function TopologyNode({
  node,
  isCenter,
  pulseColor,
}: {
  node: { x: number; y: number; label: string; status?: string; agentCount?: number };
  isCenter?: boolean;
  pulseColor?: string;
}) {
  if (isCenter) {
    // DCM central hexagon
    const size = 32;
    const points = Array.from({ length: 6 }, (_, i) => {
      const angle = (Math.PI / 3) * i - Math.PI / 6;
      return `${node.x + size * Math.cos(angle)},${node.y + size * Math.sin(angle)}`;
    }).join(" ");

    return (
      <g>
        {/* Pulse ring */}
        <circle cx={node.x} cy={node.y} r={42} fill="none" stroke={pulseColor || "#6366f1"} strokeWidth={1.5} opacity={0.3}>
          <animate attributeName="r" values="38;48;38" dur="3s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.1;0.4" dur="3s" repeatCount="indefinite" />
        </circle>
        {/* Hexagon */}
        <polygon points={points} fill="url(#dcm-gradient)" stroke="#818cf8" strokeWidth={2} />
        {/* Label */}
        <text x={node.x} y={node.y + 1} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize={12} fontWeight={700}>
          DCM
        </text>
      </g>
    );
  }

  // Session node
  const statusColor = getStatusColor(node.status || "idle");
  return (
    <g>
      {/* Outer ring */}
      <circle cx={node.x} cy={node.y} r={26} fill="none" stroke={statusColor} strokeWidth={1.5} opacity={0.4} />
      {/* Main circle */}
      <circle cx={node.x} cy={node.y} r={22} fill="#18181b" stroke={statusColor} strokeWidth={2} />
      {/* Session ID */}
      <text x={node.x} y={node.y - 4} textAnchor="middle" dominantBaseline="middle" fill="#d4d4d8" fontSize={9} fontFamily="monospace">
        {node.label}
      </text>
      {/* Agent count */}
      <text x={node.x} y={node.y + 10} textAnchor="middle" dominantBaseline="middle" fill={statusColor} fontSize={8} fontWeight={600}>
        {node.agentCount || 0} agents
      </text>
      {/* Status dot */}
      <circle cx={node.x + 18} cy={node.y - 18} r={4} fill={statusColor}>
        {node.status === "active" && (
          <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
        )}
      </circle>
    </g>
  );
}

function FlowLine({
  from,
  to,
  active,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  active?: boolean;
}) {
  const color = active ? "#818cf8" : "#3f3f46";
  return (
    <line
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke={color}
      strokeWidth={active ? 2 : 1}
      strokeDasharray={active ? "6 4" : "4 6"}
      opacity={active ? 0.8 : 0.3}
    >
      {active && (
        <animate attributeName="stroke-dashoffset" values="0;-20" dur="1.5s" repeatCount="indefinite" />
      )}
    </line>
  );
}

function EventRow({ event }: { event: WSEvent }) {
  const direction = getEventDirection(event);
  const data = event.data as Record<string, unknown> | null;
  const sessionId = (data?.session_id as string) || "";

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
      {/* Timestamp */}
      <span className="text-[11px] font-mono text-muted-foreground w-[70px] shrink-0">
        {formatTimestamp(event.timestamp)}
      </span>

      {/* Direction arrow */}
      <div className={cn(
        "flex items-center justify-center h-6 w-6 rounded-full shrink-0",
        direction === "outbound" && "bg-indigo-500/20 text-indigo-400",
        direction === "inbound" && "bg-emerald-500/20 text-emerald-400",
        direction === "internal" && "bg-zinc-500/20 text-zinc-400",
      )}>
        {direction === "outbound" ? (
          <ArrowRight className="h-3 w-3" />
        ) : direction === "inbound" ? (
          <ArrowLeft className="h-3 w-3" />
        ) : (
          <Activity className="h-3 w-3" />
        )}
      </div>

      {/* Event type badge */}
      <Badge
        variant="outline"
        className={cn(
          "text-[10px] font-mono shrink-0",
          event.event.startsWith("wave.") && "border-violet-500/40 text-violet-400",
          event.event.startsWith("batch.") && "border-cyan-500/40 text-cyan-400",
          event.event.startsWith("session.") && "border-green-500/40 text-green-400",
          event.event.startsWith("agent.") && "border-amber-500/40 text-amber-400",
          event.event.startsWith("task.") && "border-blue-500/40 text-blue-400",
          event.event.startsWith("subtask.") && "border-blue-500/40 text-blue-400",
          event.event === "scope.injected" && "border-purple-500/40 text-purple-400",
        )}
      >
        {event.event}
      </Badge>

      {/* Session ID */}
      {sessionId && (
        <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0">
          {truncateId(sessionId)}
        </span>
      )}

      {/* Details */}
      <span className="text-xs text-muted-foreground truncate ml-auto">
        {data?.description as string || data?.agent_type as string || data?.status as string || ""}
      </span>
    </div>
  );
}

// ============================================
// Filter tabs
// ============================================

const FILTER_TABS: { key: TimelineFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "orchestration", label: "Orchestration" },
  { key: "actions", label: "Actions" },
  { key: "messages", label: "Messages" },
  { key: "sessions", label: "Sessions" },
];

// ============================================
// Main Page
// ============================================

export default function FlowsPage() {
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>("all");
  const [recentEventSessionIds, setRecentEventSessionIds] = useState<Set<string>>(new Set());
  const [selectedTopologySession, setSelectedTopologySession] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  // --- Data sources ---

  const { metrics, connected: wsConnected } = useRealtimeMetrics();

  const { events, connected: eventsConnected } = useRealtimeEvents({
    channels: ["global"],
    maxEvents: 50,
  });

  const { data: activeSessions, isLoading: sessionsLoading } = useQuery<ActiveSessionsResponse>({
    queryKey: ["active-sessions"],
    queryFn: apiClient.getActiveSessions,
    refetchInterval: 5000,
  });

  const { data: sessionsStats, isLoading: statsLoading } = useQuery<SessionsStats>({
    queryKey: ["sessions-stats"],
    queryFn: apiClient.getSessionsStats,
    refetchInterval: 10000,
  });

  const { data: recentActions } = useQuery<ActionsResponse>({
    queryKey: ["recent-actions-flows"],
    queryFn: () => apiClient.getActions(20),
    refetchInterval: 10000,
  });

  // --- Track recent event sessions for topology highlighting ---

  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    const data = latest?.data as Record<string, unknown> | null;
    const sid = data?.session_id as string;
    if (sid) {
      setRecentEventSessionIds((prev) => {
        const next = new Set(prev);
        next.add(sid);
        return next;
      });
      // Clear highlight after 3s
      const timer = setTimeout(() => {
        setRecentEventSessionIds((prev) => {
          const next = new Set(prev);
          next.delete(sid);
          return next;
        });
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [events]);

  // --- Build topology nodes ---

  const sessionNodes = useMemo<SessionNode[]>(() => {
    if (!activeSessions?.active_agents) return [];

    // Group agents by session_id
    const sessionMap = new Map<string, ActiveAgent[]>();
    for (const agent of activeSessions.active_agents) {
      const sid = agent.session_id;
      if (!sessionMap.has(sid)) sessionMap.set(sid, []);
      sessionMap.get(sid)!.push(agent);
    }

    const centerX = 250;
    const centerY = 180;
    const radius = 130;
    const sessions = Array.from(sessionMap.entries());
    const positions = calculateNodePositions(sessions.length, centerX, centerY, radius);

    return sessions.map(([sid, agents], i) => ({
      id: sid,
      label: truncateId(sid),
      agentCount: agents.length,
      status: "active" as const,
      x: positions[i].x,
      y: positions[i].y,
    }));
  }, [activeSessions]);

  // --- Selected session agents ---

  const selectedSessionAgents = useMemo(() => {
    if (!selectedTopologySession || !activeSessions?.active_agents) return [];
    return activeSessions.active_agents.filter(a => a.session_id === selectedTopologySession);
  }, [selectedTopologySession, activeSessions]);

  // --- Filtered timeline events ---

  const filteredEvents = useMemo(() => {
    return events.filter((e) => getEventFilterMatch(e, timelineFilter));
  }, [events, timelineFilter]);

  // --- KPI values ---

  const activeSessCount = metrics?.active_sessions ?? sessionsStats?.overview?.active_sessions ?? 0;
  const activeAgentsCount = metrics?.active_agents ?? activeSessions?.count ?? 0;
  const actionsPerMin = metrics?.actions_per_minute ?? 0;
  const craftPromptCalls = recentActions?.actions?.filter(
    (a) => a.tool_name === "craft-prompt" || a.tool_name === "decompose"
  ).length ?? 0;

  return (
    <PageContainer
      title="Flow Visualization"
      description="Real-time data flows between DCM and Claude instances"
      actions={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1.5">
            {wsConnected ? (
              <Wifi className="h-3 w-3 text-green-400" />
            ) : (
              <WifiOff className="h-3 w-3 text-red-400" />
            )}
            {wsConnected ? "Live" : "Disconnected"}
          </Badge>
          <Badge variant="outline">{events.length} events</Badge>
        </div>
      }
    >
      {/* ========== Section A: KPI Strip ========== */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 stagger-children">
        <PremiumKPICard
          title="Active Sessions"
          value={activeSessCount}
          icon={<Radio className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-green-500 to-emerald-600"
          loading={statsLoading && !metrics}
        />
        <PremiumKPICard
          title="Active Agents"
          value={activeAgentsCount}
          icon={<Users className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-violet-500 to-purple-600"
          loading={sessionsLoading && !metrics}
        />
        <PremiumKPICard
          title="Orchestration Calls"
          value={craftPromptCalls}
          icon={<Zap className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-amber-500 to-orange-600"
          trend={{ value: craftPromptCalls, label: "recent" }}
        />
        <PremiumKPICard
          title="Actions / min"
          value={actionsPerMin.toFixed(1)}
          icon={<Activity className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-cyan-500 to-blue-600"
        />
      </div>

      {/* ========== Section B: Topology View ========== */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-foreground">Topology</h3>
          <span className="text-xs text-muted-foreground">
            {sessionNodes.length} session{sessionNodes.length !== 1 ? "s" : ""} connected
          </span>
        </div>

        <div className="flex items-center justify-center">
          <svg
            viewBox="0 0 500 360"
            className="w-full max-w-[600px] h-auto"
            style={{ minHeight: 280 }}
          >
            <defs>
              <linearGradient id="dcm-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#4f46e5" />
                <stop offset="100%" stopColor="#7c3aed" />
              </linearGradient>
              <filter id="glow">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Flow lines */}
            {sessionNodes.map((node) => (
              <FlowLine
                key={`line-${node.id}`}
                from={{ x: 250, y: 180 }}
                to={{ x: node.x, y: node.y }}
                active={recentEventSessionIds.has(node.id)}
              />
            ))}

            {/* Session nodes */}
            {sessionNodes.map((node) => (
              <g
                key={`node-${node.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedTopologySession(prev => prev === node.id ? null : node.id);
                }}
                className="cursor-pointer"
              >
                <TopologyNode
                  node={node}
                />
              </g>
            ))}

            {/* DCM center node */}
            <TopologyNode
              node={{ x: 250, y: 180, label: "DCM" }}
              isCenter
              pulseColor={wsConnected ? "#6366f1" : "#ef4444"}
            />

            {/* Empty state */}
            {sessionNodes.length === 0 && (
              <text x={250} y={300} textAnchor="middle" fill="#71717a" fontSize={12}>
                No active sessions detected
              </text>
            )}
          </svg>
        </div>

        {/* Selected Session Detail */}
        {selectedTopologySession && selectedSessionAgents.length > 0 && (
          <div className="mt-4 border-t border-zinc-800/50 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Agents in {truncateId(selectedTopologySession, 12)}
              </h4>
              <button
                onClick={() => setSelectedTopologySession(null)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
            </div>
            <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
              {selectedSessionAgents.map((agent) => (
                <div
                  key={agent.subtask_id}
                  className="flex items-center gap-2.5 p-2.5 rounded-lg bg-zinc-900/40 border border-zinc-800/40"
                >
                  <div className="flex items-center justify-center h-7 w-7 rounded-md bg-violet-500/20">
                    <Users className="h-3.5 w-3.5 text-violet-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-foreground/80 truncate">{agent.agent_type}</div>
                    <div className="text-[10px] text-muted-foreground/50 truncate">{agent.description}</div>
                  </div>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0 border-green-500/30 text-green-400">
                    running
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ========== Section C: Event Timeline ========== */}
      <div className="glass-card rounded-xl overflow-hidden">
        {/* Filter tabs */}
        <div className="flex items-center gap-1 px-4 py-3 border-b border-zinc-800">
          <Filter className="h-3.5 w-3.5 text-muted-foreground mr-2" />
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setTimelineFilter(tab.key)}
              className={cn(
                "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                timelineFilter === tab.key
                  ? "bg-indigo-500/20 text-indigo-400"
                  : "text-muted-foreground hover:text-foreground hover:bg-zinc-800/50"
              )}
            >
              {tab.label}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-muted-foreground font-mono">
            {filteredEvents.length} events
          </span>
        </div>

        {/* Event list */}
        <div ref={timelineRef} className="max-h-[400px] overflow-y-auto">
          {filteredEvents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Activity className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">Waiting for events...</p>
              <p className="text-xs mt-1 opacity-60">Events will appear here in real-time</p>
            </div>
          ) : (
            filteredEvents.map((event, i) => (
              <EventRow key={`${event.timestamp}-${i}`} event={event} />
            ))
          )}
        </div>
      </div>
    </PageContainer>
  );
}
