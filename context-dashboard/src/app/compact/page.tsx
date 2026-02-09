"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
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
import apiClient, { type CompactEvent } from "@/lib/api-client";
import {
  History,
  Archive,
  Clock,
  Database,
  ChevronDown,
  ChevronRight,
  Activity,
  TrendingUp,
  AlertCircle,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ============================================
// Helpers
// ============================================

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

function getTriggerBadgeColor(trigger: string): string {
  if (trigger === "auto") return "bg-blue-500/10 text-blue-400 border-blue-500/20";
  if (trigger === "manual") return "bg-violet-500/10 text-violet-400 border-violet-500/20";
  if (trigger === "proactive") return "bg-amber-500/10 text-amber-400 border-amber-500/20";
  return "bg-zinc-500/10 text-zinc-400 border-zinc-500/20";
}

function getTriggerIcon(trigger: string) {
  if (trigger === "auto") return <Clock className="h-3 w-3" />;
  if (trigger === "manual") return <Database className="h-3 w-3" />;
  if (trigger === "proactive") return <Zap className="h-3 w-3" />;
  return <Activity className="h-3 w-3" />;
}

// ============================================
// Glass Chart Tooltip
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
// Stats KPI Card Component
// ============================================

interface StatsCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  iconGradient: string;
  loading?: boolean;
  subtitle?: string;
}

function StatsCard({
  title,
  value,
  icon,
  iconGradient,
  loading,
  subtitle,
}: StatsCardProps) {
  return (
    <div className="glass-card rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <div
          className={cn(
            "flex items-center justify-center h-8 w-8 rounded-lg",
            iconGradient
          )}
        >
          {icon}
        </div>
        <span className="text-sm font-medium text-muted-foreground">
          {title}
        </span>
      </div>

      {loading ? (
        <Skeleton className="h-9 w-24" />
      ) : (
        <div className="gradient-text text-3xl font-bold tracking-tight">
          {value}
        </div>
      )}

      {subtitle && !loading && (
        <span className="text-xs text-muted-foreground">{subtitle}</span>
      )}
    </div>
  );
}

// ============================================
// Timeline Event Component
// ============================================

interface TimelineEventProps {
  event: CompactEvent & { snapshot_size_bytes?: number };
  isLast: boolean;
}

function TimelineEvent({ event, isLast }: TimelineEventProps) {
  const [expanded, setExpanded] = useState(false);

  const snapshotSize = event.snapshot_size_bytes ||
    (event.snapshot ? JSON.stringify(event.snapshot).length : 0);

  return (
    <div className="relative flex gap-4">
      {/* Timeline Line */}
      {!isLast && (
        <div className="absolute left-4 top-12 bottom-0 w-0.5 bg-zinc-700" />
      )}

      {/* Timeline Dot */}
      <div className="relative z-10 flex flex-col items-center">
        <div className={cn(
          "flex items-center justify-center h-8 w-8 rounded-full border-2 border-zinc-700",
          getTriggerBadgeColor(event.trigger)
        )}>
          {getTriggerIcon(event.trigger)}
        </div>
      </div>

      {/* Event Card */}
      <div className="flex-1 pb-8">
        <div
          className="glass-card rounded-xl p-4 cursor-pointer hover:border-zinc-600 transition-colors"
          onClick={() => setExpanded(!expanded)}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 mb-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <Badge className={cn("text-xs", getTriggerBadgeColor(event.trigger))}>
                  {event.trigger}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {formatDate(event.created_at)}
                </span>
                <span className="text-xs text-zinc-500">
                  {formatRelativeTime(event.created_at)}
                </span>
              </div>
              <p className="text-sm text-muted-foreground line-clamp-2">
                {event.summary || "No summary available"}
              </p>
            </div>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label={expanded ? "Collapse" : "Expand"}
            >
              {expanded ? (
                <ChevronDown className="h-5 w-5" />
              ) : (
                <ChevronRight className="h-5 w-5" />
              )}
            </button>
          </div>

          {/* Metadata */}
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">Size</span>
              <span className="font-medium text-foreground">
                {formatBytes(snapshotSize)}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">Agent Type</span>
              <span className="font-medium text-foreground truncate">
                {event.agent_type}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground">Session</span>
              <span className="font-mono text-xs text-foreground truncate">
                {event.session_id.substring(0, 8)}...
              </span>
            </div>
          </div>

          {/* Expanded Details */}
          {expanded && (
            <div className="mt-4 pt-4 border-t border-zinc-700">
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Database className="h-4 w-4" />
                Snapshot Data
              </h4>
              <pre className="text-xs bg-zinc-950 rounded-lg p-3 overflow-x-auto max-h-96 overflow-y-auto">
                <code className="text-zinc-300">
                  {JSON.stringify(event.snapshot, null, 2)}
                </code>
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Main Compact History Page
// ============================================

export default function CompactHistoryPage() {
  // Fetch compact snapshots
  const { data: snapshotsData, isLoading: contextsLoading, error: contextsError } = useQuery<
    { snapshots: CompactEvent[] },
    Error
  >({
    queryKey: ["compact-snapshots"],
    queryFn: () => apiClient.getCompactSnapshots(),
    refetchInterval: 30000,
  });

  // Map snapshots with calculated size
  const compactEvents = useMemo(() => {
    if (!snapshotsData?.snapshots) return [];

    return snapshotsData.snapshots
      .map((snapshot) => ({
        ...snapshot,
        snapshot_size_bytes: JSON.stringify(snapshot.snapshot).length,
      }))
      .sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
  }, [snapshotsData]);

  // Calculate stats
  const stats = useMemo(() => {
    if (compactEvents.length === 0) {
      return {
        totalCompacts: 0,
        avgSize: 0,
        mostActiveSession: "N/A",
        proactiveRatio: 0,
      };
    }

    const totalSize = compactEvents.reduce((sum, e) => sum + (e.snapshot_size_bytes || 0), 0);
    const avgSize = Math.round(totalSize / compactEvents.length);

    // Find most active session
    const sessionCounts = new Map<string, number>();
    compactEvents.forEach((e) => {
      sessionCounts.set(e.session_id, (sessionCounts.get(e.session_id) || 0) + 1);
    });
    const mostActive = Array.from(sessionCounts.entries())
      .sort((a, b) => b[1] - a[1])[0];
    const mostActiveSession = mostActive
      ? `${mostActive[0].substring(0, 8)}... (${mostActive[1]})`
      : "N/A";

    // Calculate proactive vs reactive ratio
    const proactiveCount = compactEvents.filter((e) => e.trigger === "proactive").length;
    const proactiveRatio = Math.round((proactiveCount / compactEvents.length) * 100);

    return {
      totalCompacts: compactEvents.length,
      avgSize,
      mostActiveSession,
      proactiveRatio,
    };
  }, [compactEvents]);

  // Prepare chart data (group by hour)
  const chartData = useMemo(() => {
    if (compactEvents.length === 0) return [];

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Create hourly buckets
    const buckets = new Map<string, number>();
    for (let i = 0; i < 24; i++) {
      const time = new Date(last24h.getTime() + i * 60 * 60 * 1000);
      const hourKey = time.toISOString().substring(0, 13);
      buckets.set(hourKey, 0);
    }

    // Fill buckets with event counts
    compactEvents.forEach((event) => {
      const eventDate = new Date(event.created_at);
      if (eventDate >= last24h) {
        const hourKey = eventDate.toISOString().substring(0, 13);
        buckets.set(hourKey, (buckets.get(hourKey) || 0) + 1);
      }
    });

    return Array.from(buckets.entries())
      .map(([hour, count]) => ({
        name: new Date(hour).toLocaleTimeString("en-US", {
          hour: "2-digit",
          hour12: false,
        }),
        compacts: count,
      }))
      .slice(-24);
  }, [compactEvents]);

  // Loading state
  if (contextsLoading) {
    return (
      <PageContainer
        title="Compact History"
        description="Timeline of context compaction events"
      >
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 w-full rounded-xl mt-6" />
        <Skeleton className="h-96 w-full rounded-xl mt-6" />
      </PageContainer>
    );
  }

  // Error state
  if (contextsError) {
    return (
      <PageContainer
        title="Compact History"
        description="Timeline of context compaction events"
      >
        <Card className="glass-card border-destructive/30">
          <div className="p-6 flex items-center gap-3 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <div>
              <p className="font-semibold">Failed to load compact history</p>
              <p className="text-sm text-muted-foreground">
                {contextsError.message}
              </p>
            </div>
          </div>
        </Card>
      </PageContainer>
    );
  }

  // Empty state
  if (compactEvents.length === 0) {
    return (
      <PageContainer
        title="Compact History"
        description="Timeline of context compaction events"
      >
        <Card className="glass-card">
          <div className="p-12 flex flex-col items-center justify-center gap-3 text-center">
            <Archive className="h-12 w-12 text-muted-foreground opacity-50" />
            <p className="text-lg font-semibold text-muted-foreground">
              No compact events yet
            </p>
            <p className="text-sm text-muted-foreground max-w-md">
              Compact events will appear here when context is saved during sessions.
              They help restore context in new sessions.
            </p>
          </div>
        </Card>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Compact History"
      description="Timeline of context compaction events"
      actions={
        <Badge variant="outline" className="text-xs">
          <History className="h-3 w-3" />
          {stats.totalCompacts} events
        </Badge>
      }
    >
      {/* Stats Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <StatsCard
          title="Total Compacts"
          value={stats.totalCompacts}
          icon={<Archive className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-blue-500 to-cyan-500"
        />

        <StatsCard
          title="Avg Snapshot Size"
          value={formatBytes(stats.avgSize)}
          icon={<Database className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-violet-500 to-purple-600"
        />

        <StatsCard
          title="Most Active Session"
          value={stats.mostActiveSession.split(" ")[0]}
          icon={<Activity className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-emerald-500 to-green-600"
          subtitle={stats.mostActiveSession.includes("(") ? stats.mostActiveSession.split("(")[1].replace(")", " compacts") : undefined}
        />

        <StatsCard
          title="Proactive Ratio"
          value={`${stats.proactiveRatio}%`}
          icon={<TrendingUp className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-amber-500 to-orange-500"
          subtitle="Proactive vs reactive"
        />
      </div>

      {/* Area Chart */}
      <Card className="glass-card mt-6">
        <div className="p-6">
          <h3 className="text-base font-semibold mb-4 flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Compact Frequency (Last 24h)
          </h3>
          {chartData.length === 0 ? (
            <div className="flex items-center justify-center h-[280px] text-muted-foreground">
              No data available
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart
                data={chartData}
                margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
              >
                <defs>
                  <linearGradient
                    id="compactsGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="#8b5cf6"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor="#8b5cf6"
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
                  dataKey="compacts"
                  name="Compacts"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  fill="url(#compactsGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      {/* Timeline */}
      <div className="mt-6">
        <Card className="glass-card">
          <div className="p-6">
            <h3 className="text-base font-semibold mb-6 flex items-center gap-2">
              <History className="h-5 w-5" />
              Timeline
            </h3>

            <div className="space-y-0">
              {compactEvents.map((event, index) => (
                <TimelineEvent
                  key={event.id}
                  event={event}
                  isLast={index === compactEvents.length - 1}
                />
              ))}
            </div>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
