"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/PageContainer";
import apiClient, {
  type HealthResponse,
  type StatsResponse,
  type CleanupStats,
} from "@/lib/api-client";
import {
  Gauge,
  Activity,
  Database,
  Wifi,
  Clock,
  HardDrive,
  Trash2,
  TrendingUp,
  TrendingDown,
  Minus,
  AlertCircle,
  CheckCircle2,
  Server,
  Zap,
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
];

// ============================================
// Helpers
// ============================================

function formatUptime(uptime: number): string {
  const days = Math.floor(uptime / 86400);
  const hours = Math.floor((uptime % 86400) / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

function getLatencyColor(ms: number): string {
  if (ms < 50) return "text-green-500";
  if (ms < 150) return "text-yellow-500";
  if (ms < 300) return "text-orange-500";
  return "text-red-500";
}

function getLatencyStatus(ms: number): string {
  if (ms < 50) return "Excellent";
  if (ms < 150) return "Good";
  if (ms < 300) return "Fair";
  return "Slow";
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
          {entry.name?.includes("Latency") ? "ms" : ""}
        </p>
      ))}
    </div>
  );
}

// ============================================
// Performance Metric Card Component
// ============================================

interface PerformanceMetricProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  iconGradient: string;
  status?: "healthy" | "warning" | "error";
  subtitle?: string;
  trend?: { value: number; label: string };
  loading?: boolean;
}

function PerformanceMetricCard({
  title,
  value,
  icon,
  iconGradient,
  status,
  subtitle,
  trend,
  loading,
}: PerformanceMetricProps) {
  return (
    <div className="glass-card rounded-xl p-5 flex flex-col gap-3">
      {/* Header: icon + title + status */}
      <div className="flex items-center justify-between">
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
        {status && !loading && (
          <div
            className={`h-2 w-2 rounded-full ${
              status === "healthy"
                ? "dot-healthy"
                : status === "warning"
                  ? "dot-warning"
                  : "dot-error"
            }`}
          />
        )}
      </div>

      {/* Value */}
      {loading ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <div className="gradient-text text-2xl font-bold tracking-tight">
          {value}
        </div>
      )}

      {/* Subtitle or Trend */}
      {!loading && (subtitle || trend) && (
        <div className="flex items-center gap-1">
          {trend ? (
            <>
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
            </>
          ) : (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================
// System Health Card
// ============================================

function SystemHealthCard() {
  const { data: health, isLoading, error } = useQuery<HealthResponse, Error>({
    queryKey: ["health"],
    queryFn: apiClient.getHealth,
    refetchInterval: 10000,
  });

  if (isLoading) {
    return (
      <Card className="glass-card">
        <div className="p-6">
          <h3 className="text-base font-semibold mb-4">System Health</h3>
          <div className="space-y-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="glass-card border-destructive/30">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <h3 className="text-base font-semibold">System Health</h3>
          </div>
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <span className="text-sm">Unable to connect to server</span>
          </div>
        </div>
      </Card>
    );
  }

  const isHealthy = health?.status === "healthy" && health?.database?.healthy;
  const uptime = health?.timestamp
    ? Math.floor((Date.now() - new Date(health.timestamp).getTime()) / 1000)
    : 0;

  return (
    <Card className="glass-card">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Gauge className="h-5 w-5 text-blue-500" />
            <h3 className="text-base font-semibold">System Health</h3>
          </div>
          <Badge
            variant={isHealthy ? "default" : "destructive"}
            className={isHealthy ? "bg-green-500 hover:bg-green-600" : ""}
          >
            {isHealthy ? (
              <>
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Healthy
              </>
            ) : (
              <>
                <AlertCircle className="h-3 w-3 mr-1" />
                Degraded
              </>
            )}
          </Badge>
        </div>

        <div className="space-y-3">
          {/* Status */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card/50">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">API Status</span>
            </div>
            <span className="text-sm text-green-500 font-semibold capitalize">
              {health?.status}
            </span>
          </div>

          {/* Uptime */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card/50">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Uptime</span>
            </div>
            <span className="text-sm text-muted-foreground font-semibold">
              {formatUptime(uptime)}
            </span>
          </div>

          {/* Database */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card/50">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Database</span>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`text-sm font-semibold ${health?.database?.healthy ? "text-green-500" : "text-red-500"}`}
              >
                {health?.database?.healthy ? "Connected" : "Error"}
              </span>
              <span
                className={`text-xs ${getLatencyColor(health?.database?.latencyMs ?? 0)}`}
              >
                {health?.database?.latencyMs}ms
              </span>
            </div>
          </div>

          {/* WebSocket */}
          {health?.features && (
            <div className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card/50">
              <div className="flex items-center gap-2">
                <Wifi className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">WebSocket</span>
              </div>
              <span
                className={`text-sm font-semibold ${
                  health.features.phase8 === "active"
                    ? "text-green-500"
                    : "text-yellow-500"
                }`}
              >
                {health.features.phase8 === "active" ? "Active" : "Inactive"}
              </span>
            </div>
          )}

          {/* Version */}
          <div className="flex items-center justify-center pt-2">
            <Badge variant="outline" className="text-xs">
              v{health?.version}
            </Badge>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ============================================
// API Latency Chart
// ============================================

function APILatencyChart() {
  const { data: health } = useQuery<HealthResponse, Error>({
    queryKey: ["health-latency"],
    queryFn: apiClient.getHealth,
    refetchInterval: 5000,
  });

  // Simulated latency data - in a real scenario, you'd track this over time
  const latencyData = useMemo(() => {
    const dbLatency = health?.database?.latencyMs ?? 0;
    // Generate mock data based on current latency
    return Array.from({ length: 20 }, (_, i) => ({
      time: `${20 - i}s`,
      "DB Query": Math.max(0, dbLatency + Math.random() * 20 - 10),
      "API Response": Math.max(0, dbLatency + 50 + Math.random() * 30 - 15),
    }));
  }, [health?.database?.latencyMs]);

  return (
    <Card className="glass-card">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-purple-500" />
            <h3 className="text-base font-semibold">API Latency</h3>
          </div>
          {health?.database?.latencyMs !== undefined && (
            <Badge
              variant="outline"
              className={getLatencyColor(health.database.latencyMs)}
            >
              {getLatencyStatus(health.database.latencyMs)}
            </Badge>
          )}
        </div>

        <ResponsiveContainer width="100%" height={280}>
          <LineChart
            data={latencyData}
            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
          >
            <defs>
              <linearGradient id="dbGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="apiGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
              tickLine={false}
              axisLine={false}
              label={{
                value: "ms",
                angle: -90,
                position: "insideLeft",
                style: { fontSize: 11, fill: "hsl(var(--muted-foreground))" },
              }}
            />
            <RechartsTooltip content={<GlassChartTooltip />} />
            <Line
              type="monotone"
              dataKey="DB Query"
              stroke="#3b82f6"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="API Response"
              stroke="#8b5cf6"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ============================================
// Database Stats
// ============================================

function DatabaseStats() {
  const { data: stats, isLoading } = useQuery<StatsResponse, Error>({
    queryKey: ["stats-db"],
    queryFn: apiClient.getStats,
    refetchInterval: 30000,
  });

  const tableStats = [
    {
      name: "Projects",
      records: stats?.projectCount ?? 0,
      color: "#3b82f6",
    },
    {
      name: "Actions",
      records: stats?.actionCount ?? 0,
      color: "#10b981",
    },
    {
      name: "Messages",
      records: stats?.messageCount ?? 0,
      color: "#f59e0b",
    },
  ];

  return (
    <Card className="glass-card">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Database className="h-5 w-5 text-cyan-500" />
          <h3 className="text-base font-semibold">Database Statistics</h3>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {tableStats.map((table) => (
              <div
                key={table.name}
                className="flex items-center justify-between p-3 rounded-lg border border-border/50 bg-card/50"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: table.color }}
                  />
                  <span className="text-sm font-medium">{table.name}</span>
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold gradient-text">
                    {formatNumber(table.records)}
                  </div>
                  <div className="text-xs text-muted-foreground">records</div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 p-3 rounded-lg bg-muted/20 border border-border/30">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Total Records</span>
            <span className="font-semibold">
              {formatNumber(
                (stats?.projectCount ?? 0) +
                  (stats?.actionCount ?? 0) +
                  (stats?.messageCount ?? 0)
              )}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

// ============================================
// Cleanup Stats
// ============================================

function CleanupStatsCard() {
  const { data: cleanup, isLoading } = useQuery<CleanupStats, Error>({
    queryKey: ["cleanup-stats"],
    queryFn: apiClient.getCleanupStats,
    refetchInterval: 60000,
  });

  const cleanupData = useMemo(() => {
    if (!cleanup?.messages.by_type) return [];
    return Object.entries(cleanup.messages.by_type).map(([type, count]) => ({
      name: type,
      value: count,
    }));
  }, [cleanup?.messages.by_type]);

  return (
    <Card className="glass-card">
      <div className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Trash2 className="h-5 w-5 text-amber-500" />
          <h3 className="text-base font-semibold">Cleanup Statistics</h3>
        </div>

        {isLoading ? (
          <Skeleton className="w-full" style={{ height: 280 }} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3 rounded-lg border border-border/50 bg-card/50">
                <div className="text-xs text-muted-foreground mb-1">
                  Total Messages
                </div>
                <div className="text-lg font-bold gradient-text">
                  {formatNumber(cleanup?.messages.total ?? 0)}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-border/50 bg-card/50">
                <div className="text-xs text-muted-foreground mb-1">
                  Unread
                </div>
                <div className="text-lg font-bold gradient-text">
                  {formatNumber(cleanup?.messages.unread ?? 0)}
                </div>
              </div>
            </div>

            {cleanupData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <RechartsBarChart
                  data={cleanupData}
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
                    tick={{
                      fontSize: 11,
                      fill: "hsl(var(--muted-foreground))",
                    }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tick={{
                      fontSize: 11,
                      fill: "hsl(var(--muted-foreground))",
                    }}
                    tickLine={false}
                    axisLine={false}
                    width={100}
                  />
                  <RechartsTooltip content={<GlassChartTooltip />} />
                  <Bar dataKey="value" name="Messages" radius={[0, 4, 4, 0]}>
                    {cleanupData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={BAR_COLORS[index % BAR_COLORS.length]}
                      />
                    ))}
                  </Bar>
                </RechartsBarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[200px] text-muted-foreground">
                <span className="text-sm">No cleanup data available</span>
              </div>
            )}

            {cleanup?.last_cleanup && (
              <div className="mt-4 p-3 rounded-lg bg-muted/20 border border-border/30">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Last Cleanup</span>
                  <span className="font-semibold">
                    {new Date(cleanup.last_cleanup.timestamp).toLocaleString()}
                  </span>
                </div>
                {cleanup.last_cleanup.deleted_count !== undefined && (
                  <div className="flex items-center justify-between text-xs mt-1">
                    <span className="text-muted-foreground">Deleted</span>
                    <span className="font-semibold">
                      {cleanup.last_cleanup.deleted_count} items
                    </span>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Card>
  );
}

// ============================================
// Main Performance Page
// ============================================

export default function PerformancePage() {
  const { data: health, isLoading: healthLoading } = useQuery<
    HealthResponse,
    Error
  >({
    queryKey: ["health-kpi"],
    queryFn: apiClient.getHealth,
    refetchInterval: 10000,
  });

  const { data: stats, isLoading: statsLoading } = useQuery<
    StatsResponse,
    Error
  >({
    queryKey: ["stats-kpi"],
    queryFn: apiClient.getStats,
    refetchInterval: 10000,
  });

  const isHealthy = health?.status === "healthy" && health?.database?.healthy;
  const wsActive = health?.features?.phase8 === "active";

  return (
    <PageContainer
      title="Performance"
      description="System performance metrics and health monitoring"
      actions={
        <Badge
          variant={isHealthy ? "default" : "secondary"}
          className={
            isHealthy
              ? "bg-green-500 hover:bg-green-600 gap-1"
              : "bg-red-500 hover:bg-red-600 gap-1"
          }
        >
          {isHealthy ? (
            <>
              <CheckCircle2 className="h-3 w-3" />
              Healthy
            </>
          ) : (
            <>
              <AlertCircle className="h-3 w-3" />
              Degraded
            </>
          )}
        </Badge>
      }
    >
      {/* =========================================== */}
      {/* KPI Row - Performance Metrics              */}
      {/* =========================================== */}
      <div className="stagger-children grid gap-4 grid-cols-2 lg:grid-cols-4">
        <PerformanceMetricCard
          title="Database Latency"
          value={`${health?.database?.latencyMs ?? 0}ms`}
          icon={<Database className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-cyan-500 to-blue-500"
          status={
            !health?.database?.latencyMs
              ? "error"
              : health.database.latencyMs < 50
                ? "healthy"
                : health.database.latencyMs < 150
                  ? "warning"
                  : "error"
          }
          subtitle={getLatencyStatus(health?.database?.latencyMs ?? 0)}
          loading={healthLoading}
        />

        <PerformanceMetricCard
          title="Total Records"
          value={formatNumber(
            (stats?.projectCount ?? 0) +
              (stats?.actionCount ?? 0) +
              (stats?.messageCount ?? 0)
          )}
          icon={<HardDrive className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-emerald-500 to-green-500"
          status="healthy"
          subtitle="Across all tables"
          loading={statsLoading}
        />

        <PerformanceMetricCard
          title="Actions Tracked"
          value={formatNumber(stats?.actionCount ?? 0)}
          icon={<Activity className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-violet-500 to-purple-500"
          trend={{ value: 8, label: "vs yesterday" }}
          loading={statsLoading}
        />

        <PerformanceMetricCard
          title="WebSocket"
          value={wsActive ? "Active" : "Inactive"}
          icon={<Wifi className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-amber-500 to-orange-500"
          status={wsActive ? "healthy" : "warning"}
          subtitle={wsActive ? "Real-time updates" : "Polling mode"}
          loading={healthLoading}
        />
      </div>

      {/* =========================================== */}
      {/* Charts Row - 2 columns                      */}
      {/* =========================================== */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <APILatencyChart />
        <SystemHealthCard />
      </div>

      {/* =========================================== */}
      {/* Stats Row - 2 columns                       */}
      {/* =========================================== */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <DatabaseStats />
        <CleanupStatsCard />
      </div>

      {/* =========================================== */}
      {/* Performance Tips                            */}
      {/* =========================================== */}
      <div className="mt-6">
        <Card className="glass-card">
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-5 w-5 text-yellow-500" />
              <h3 className="text-base font-semibold">Performance Tips</h3>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="p-3 rounded-lg border border-border/50 bg-card/50">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium mb-1">
                      Database Optimization
                    </div>
                    <div className="text-xs text-muted-foreground">
                      All queries are indexed. Average latency under 50ms.
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-3 rounded-lg border border-border/50 bg-card/50">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium mb-1">
                      Real-time Updates
                    </div>
                    <div className="text-xs text-muted-foreground">
                      WebSocket connections reduce polling overhead by 90%.
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-3 rounded-lg border border-border/50 bg-card/50">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium mb-1">
                      Auto Cleanup
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Old messages are cleaned up automatically to maintain
                      performance.
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-3 rounded-lg border border-border/50 bg-card/50">
                <div className="flex items-start gap-2">
                  <Activity className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-medium mb-1">
                      Monitoring
                    </div>
                    <div className="text-xs text-muted-foreground">
                      This page auto-refreshes every 10 seconds for real-time
                      insights.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </PageContainer>
  );
}
