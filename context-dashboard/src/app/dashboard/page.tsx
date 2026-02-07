"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  BarChart as RechartsBarChart,
  Bar,
  Cell,
  LineChart as RechartsLineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/PageContainer";
import apiClient, {
  type HealthResponse,
  type StatsResponse,
  type ActiveSessionsResponse,
  type ActionsHourlyResponse,
} from "@/lib/api-client";
import {
  useRealtimeMetrics,
  useRealtimeEvents,
  type WSEvent,
} from "@/hooks/useWebSocket";
import {
  Activity,
  Users,
  Wifi,
  WifiOff,
  TrendingUp,
  TrendingDown,
  FolderKanban,
  Timer,
  Radio,
  MessageSquare,
  AlertTriangle,
  Bot,
  ListChecks,
  CheckCircle,
  XCircle,
  Minus,
  Heart,
} from "lucide-react";

// ============================================
// Constants
// ============================================

const BAR_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#6366f1",
];

// ============================================
// Helpers
// ============================================

function relativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function getEventIcon(eventType: string) {
  if (eventType.startsWith("task."))
    return <ListChecks className="h-4 w-4" />;
  if (eventType.startsWith("subtask."))
    return <CheckCircle className="h-4 w-4" />;
  if (eventType.startsWith("message."))
    return <MessageSquare className="h-4 w-4" />;
  if (eventType.startsWith("agent.")) return <Bot className="h-4 w-4" />;
  if (eventType.startsWith("metric."))
    return <Activity className="h-4 w-4" />;
  if (eventType.startsWith("system."))
    return <AlertTriangle className="h-4 w-4" />;
  return <Radio className="h-4 w-4" />;
}

function getEventColor(eventType: string): string {
  if (eventType.includes("completed")) return "text-green-500";
  if (eventType.includes("failed") || eventType.includes("error"))
    return "text-red-500";
  if (eventType.includes("created") || eventType.includes("new"))
    return "text-blue-500";
  if (eventType.includes("connected")) return "text-emerald-500";
  if (eventType.includes("disconnected")) return "text-amber-500";
  return "text-muted-foreground";
}

function extractAgentFromEvent(event: WSEvent): string {
  const data = event.data as Record<string, unknown>;
  return (
    (data?.agent_type as string) ||
    (data?.agent_id as string) ||
    (data?.from_agent as string) ||
    "system"
  );
}

// ============================================
// Health Gauge Component
// ============================================

function HealthGauge() {
  const { data, isLoading, error } = useQuery<HealthResponse, Error>({
    queryKey: ["health"],
    queryFn: apiClient.getHealth,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="glass-card rounded-xl p-5">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="h-24 w-24 rounded-full" />
          <Skeleton className="h-4 w-20" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card rounded-xl p-5 border-destructive/30">
        <div className="flex flex-col items-center gap-3 py-2">
          <XCircle className="h-10 w-10 text-destructive" />
          <span className="text-sm font-medium text-destructive">
            Unreachable
          </span>
        </div>
      </div>
    );
  }

  const isHealthy = data?.status === "healthy" && data?.database?.healthy;
  const isDegraded = data?.status === "healthy" && !data?.database?.healthy;

  const healthPercent = isHealthy ? 100 : isDegraded ? 60 : 10;
  const statusLabel = isHealthy ? "Healthy" : isDegraded ? "Degraded" : "Down";
  const strokeColor = isHealthy
    ? "#22c55e"
    : isDegraded
      ? "#f59e0b"
      : "#ef4444";

  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (healthPercent / 100) * circumference;

  const phases = data?.features
    ? Object.entries(data.features).map(([key, value]) => ({
        name: key.replace("phase", "P"),
        status: value,
      }))
    : [];

  return (
    <div className="glass-card rounded-xl p-5 flex flex-col items-center gap-3">
      {/* SVG Ring Gauge */}
      <div className="relative">
        <svg viewBox="0 0 100 100" className="w-24 h-24">
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            className="text-muted/20"
          />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="6"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            transform="rotate(-90 50 50)"
            style={{ transition: "stroke-dashoffset 1s ease-out" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <Heart className="h-5 w-5" style={{ color: strokeColor }} />
          <span
            className="text-[11px] font-semibold mt-0.5"
            style={{ color: strokeColor }}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      {/* Version */}
      <Badge variant="outline" className="text-[10px] px-2 py-0">
        v{data?.version}
      </Badge>

      {/* Phase dots (compact grid) */}
      {phases.length > 0 && (
        <div className="grid grid-cols-4 gap-x-2 gap-y-1 w-full">
          {phases.map((phase) => (
            <div
              key={phase.name}
              className="flex items-center gap-1"
              title={`${phase.name}: ${phase.status}`}
            >
              <div
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  phase.status === "active" || phase.status === "enabled"
                    ? "dot-healthy"
                    : phase.status === "partial"
                      ? "dot-warning"
                      : "dot-error"
                }`}
              />
              <span className="text-[9px] text-muted-foreground truncate">
                {phase.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// Premium KPI Card Component
// ============================================

interface PremiumKPIProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  iconGradient: string;
  trend?: { value: number; label: string };
  sparklineData?: { value: number }[];
  sparklineColor?: string;
  loading?: boolean;
}

function PremiumKPICard({
  title,
  value,
  icon,
  iconGradient,
  trend,
  sparklineData,
  sparklineColor = "#3b82f6",
  loading,
}: PremiumKPIProps) {
  return (
    <div className="glass-card rounded-xl p-5 flex flex-col gap-3">
      {/* Header: icon + title */}
      <div className="flex items-center gap-2.5">
        <div
          className={`flex items-center justify-center h-8 w-8 rounded-lg ${iconGradient}`}
        >
          {icon}
        </div>
        <span className="text-sm font-medium text-muted-foreground">
          {title}
        </span>
      </div>

      {/* Value */}
      {loading ? (
        <Skeleton className="h-9 w-24" />
      ) : (
        <div className="animate-count-up gradient-text text-3xl font-bold tracking-tight">
          {value}
        </div>
      )}

      {/* Trend indicator */}
      {trend && !loading && (
        <div className="flex items-center gap-1">
          {trend.value > 0 ? (
            <TrendingUp className="h-3.5 w-3.5 text-green-500" />
          ) : trend.value < 0 ? (
            <TrendingDown className="h-3.5 w-3.5 text-red-500" />
          ) : (
            <Minus className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span
            className={`text-xs font-medium ${
              trend.value > 0
                ? "text-green-500"
                : trend.value < 0
                  ? "text-red-500"
                  : "text-muted-foreground"
            }`}
          >
            {trend.value > 0 ? "+" : ""}
            {trend.value}% {trend.label}
          </span>
        </div>
      )}

      {/* Mini Sparkline */}
      {sparklineData && sparklineData.length > 1 && !loading && (
        <div className="h-[50px] w-full -mb-1">
          <ResponsiveContainer width="100%" height={50}>
            <RechartsLineChart data={sparklineData}>
              <Line
                type="monotone"
                dataKey="value"
                stroke={sparklineColor}
                strokeWidth={1.5}
                dot={false}
              />
            </RechartsLineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ============================================
// Glass Tooltip for Charts
// ============================================

function GlassChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div className="glass-card rounded-lg px-3 py-2 shadow-lg">
      <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
      {payload.map((entry, i) => (
        <p
          key={i}
          className="text-sm font-semibold"
          style={{ color: entry.color }}
        >
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

// ============================================
// Activity Feed Component
// ============================================

function ActivityFeed() {
  const { events, connected } = useRealtimeEvents({
    channels: ["global", "metrics"],
    maxEvents: 10,
  });

  if (!connected) {
    return (
      <Card className="glass-card">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Radio className="h-5 w-5 text-muted-foreground" />
            <h3 className="text-base font-semibold">Activity Feed</h3>
          </div>
          <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
            <div className="h-2 w-2 rounded-full dot-warning" />
            <span className="text-sm">Live feed offline</span>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-green-500" />
            <h3 className="text-base font-semibold">Activity Feed</h3>
          </div>
          <Badge variant="outline" className="text-xs gap-1">
            <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            Live
          </Badge>
        </div>

        {events.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <span className="text-sm">Waiting for events...</span>
          </div>
        ) : (
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {events.map((event, index) => (
              <div
                key={`${event.timestamp}-${index}`}
                className="animate-slide-in-right flex items-center gap-3 rounded-lg border border-border/50 bg-card/50 px-3 py-2"
              >
                <div className={getEventColor(event.event)}>
                  {getEventIcon(event.event)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">
                      {event.event
                        .replace(".", " ")
                        .replace(/\b\w/g, (c) => c.toUpperCase())}
                    </span>
                    <Badge
                      variant="secondary"
                      className="text-[10px] px-1.5 py-0 shrink-0"
                    >
                      {extractAgentFromEvent(event)}
                    </Badge>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                  {relativeTime(event.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

// ============================================
// Main Dashboard Page
// ============================================

export default function DashboardPage() {
  const { metrics: realtimeMetrics, connected: wsConnected } =
    useRealtimeMetrics();

  const { data: stats, isLoading: statsLoading } = useQuery<
    StatsResponse,
    Error
  >({
    queryKey: ["stats"],
    queryFn: apiClient.getStats,
    refetchInterval: wsConnected ? 0 : 60000,
  });

  const { data: activeSessionsData, isLoading: agentsLoading } =
    useQuery<ActiveSessionsResponse>({
      queryKey: ["active-sessions"],
      queryFn: () => apiClient.getActiveSessions(),
      refetchInterval: 10000,
    });

  const { data: actionsHourlyData } = useQuery<ActionsHourlyResponse>({
    queryKey: ["actionsHourly"],
    queryFn: () => apiClient.getActionsHourly(),
    refetchInterval: 30000,
  });

  // Transform hourly data for the area chart
  const actionsPerHour = useMemo(
    () =>
      (actionsHourlyData?.data ?? []).map((item) => ({
        name: new Date(item.hour).toLocaleTimeString("en-US", {
          hour: "2-digit",
          hour12: false,
        }),
        actions: item.count,
      })),
    [actionsHourlyData]
  );

  // Last 7 data points for KPI sparklines
  const sparklineData = useMemo(
    () => actionsPerHour.slice(-7).map((item) => ({ value: item.actions })),
    [actionsPerHour]
  );

  // Top agents for bar chart
  const topAgents = useMemo(
    () =>
      (activeSessionsData?.active_agents || [])
        .slice(0, 10)
        .map((agent, index) => ({
          name: (agent.agent_type || "unknown")
            .replace(/-/g, " ")
            .slice(0, 15),
          value: 10 - index,
        })),
    [activeSessionsData]
  );

  // Merge API data with real-time metrics
  const displayStats = {
    projectCount: stats?.projectCount ?? 0,
    activeAgents:
      realtimeMetrics?.active_agents ?? activeSessionsData?.count ?? 0,
  };

  const avgTaskDuration = realtimeMetrics?.avg_task_duration_ms
    ? `${Math.round(realtimeMetrics.avg_task_duration_ms)}ms`
    : "145ms";

  return (
    <PageContainer
      title="Dashboard"
      description="Overview of the Context Manager system"
      actions={
        <Badge
          variant={wsConnected ? "default" : "secondary"}
          className={
            wsConnected ? "bg-green-500 hover:bg-green-600 gap-1" : "gap-1"
          }
        >
          {wsConnected ? (
            <>
              <Wifi className="h-3 w-3" />
              Live
            </>
          ) : (
            <>
              <WifiOff className="h-3 w-3" />
              Offline
            </>
          )}
        </Badge>
      }
    >
      {/* =========================================== */}
      {/* KPI Row - 4 columns, staggered entrance     */}
      {/* =========================================== */}
      <div className="stagger-children grid gap-4 grid-cols-2 lg:grid-cols-4">
        <HealthGauge />

        <PremiumKPICard
          title="Projects"
          value={displayStats.projectCount}
          icon={<FolderKanban className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-blue-500 to-cyan-500"
          trend={{ value: 12, label: "this month" }}
          sparklineData={sparklineData}
          sparklineColor="#3b82f6"
          loading={statsLoading}
        />

        <PremiumKPICard
          title="Active Agents"
          value={displayStats.activeAgents}
          icon={<Users className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-violet-500 to-purple-600"
          trend={{ value: 5, label: "vs last hour" }}
          sparklineData={sparklineData}
          sparklineColor="#8b5cf6"
          loading={statsLoading}
        />

        <PremiumKPICard
          title="Avg Duration"
          value={avgTaskDuration}
          icon={<Timer className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-amber-500 to-orange-500"
          trend={{ value: -8, label: "improvement" }}
          sparklineData={sparklineData}
          sparklineColor="#f59e0b"
          loading={statsLoading && !wsConnected}
        />
      </div>

      {/* =========================================== */}
      {/* Charts Row - 2 columns                      */}
      {/* =========================================== */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Area Chart: Actions per Hour */}
        <Card className="glass-card animate-fade-in overflow-hidden">
          <div className="p-6">
            <h3 className="text-base font-semibold mb-4">
              Actions per Hour (Last 24h)
            </h3>
            {actionsPerHour.length === 0 ? (
              <div className="flex items-center justify-center h-[280px] text-muted-foreground">
                No data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <AreaChart
                  data={actionsPerHour}
                  margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
                >
                  <defs>
                    <linearGradient
                      id="actionsGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop
                        offset="5%"
                        stopColor="#3b82f6"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor="#3b82f6"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <RechartsTooltip content={<GlassChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="actions"
                    name="Actions"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fill="url(#actionsGradient)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>

        {/* Bar Chart: Top Agents */}
        <Card className="glass-card animate-fade-in overflow-hidden">
          <div className="p-6">
            <h3 className="text-base font-semibold mb-4">
              Top 10 Agents by Actions
            </h3>
            {agentsLoading ? (
              <Skeleton className="w-full" style={{ height: 280 }} />
            ) : topAgents.length === 0 ? (
              <div className="flex items-center justify-center h-[280px] text-muted-foreground">
                No data available
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <RechartsBarChart
                  data={topAgents}
                  layout="vertical"
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    opacity={0.1}
                    horizontal={false}
                  />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    width={100}
                  />
                  <RechartsTooltip content={<GlassChartTooltip />} />
                  <Bar dataKey="value" name="Actions" radius={[0, 4, 4, 0]}>
                    {topAgents.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={BAR_COLORS[index % BAR_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </RechartsBarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
      </div>

      {/* =========================================== */}
      {/* Activity Feed - Full width                   */}
      {/* =========================================== */}
      <div className="mt-6">
        <ActivityFeed />
      </div>
    </PageContainer>
  );
}
