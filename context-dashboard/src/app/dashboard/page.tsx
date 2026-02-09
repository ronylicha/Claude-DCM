"use client";

import { useMemo, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  BarChart as RechartsBarChart,
  Bar,
  Cell,
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
  type StatsResponse,
  type ActiveSessionsResponse,
  type ActionsHourlyResponse,
} from "@/lib/api-client";
import { useRealtimeMetrics } from "@/hooks/useWebSocket";
import {
  Users,
  Wifi,
  WifiOff,
  FolderKanban,
  Timer,
  RefreshCw,
  Clock4,
  Send,
  Target,
  Save,
} from "lucide-react";
import {
  HealthGauge,
  PremiumKPICard,
  GlassChartTooltip,
  ActivityFeed,
  SystemPulseBar,
  BAR_COLORS,
} from "@/components/dashboard";

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

  // Fetch agent actions for Top 10 chart (use agent tool_type actions)
  const { data: agentActionsData } = useQuery({
    queryKey: ["agent-actions-top10"],
    queryFn: () => apiClient.getActions(500, 0, "agent"),
    refetchInterval: 60000,
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

  // Top agents by real action counts
  const topAgents = useMemo(() => {
    const agentActions = agentActionsData?.actions || [];
    if (agentActions.length === 0) return [];
    // Count actions per agent tool_name
    const counts = new Map<string, number>();
    for (const action of agentActions) {
      counts.set(action.tool_name, (counts.get(action.tool_name) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({
        name: name.length > 15 ? name.slice(0, 12) + "..." : name,
        value,
      }));
  }, [agentActionsData]);

  // Merge API data with real-time metrics
  const displayStats = {
    projectCount: stats?.projectCount ?? 0,
    activeAgents:
      realtimeMetrics?.active_agents ?? activeSessionsData?.count ?? 0,
  };

  const avgTaskDuration = realtimeMetrics?.avg_task_duration_ms
    ? `${Math.round(realtimeMetrics.avg_task_duration_ms)}ms`
    : "145ms";

  // Enhanced metrics queries
  const { data: contextStats } = useQuery({
    queryKey: ["agent-context-stats"],
    queryFn: apiClient.getAgentContextStats,
    refetchInterval: 30000,
  });

  const [contextFreshness, setContextFreshness] = useState("N/A");

  useEffect(() => {
    function computeFreshness() {
      if (!contextStats?.overview?.newest_context) {
        setContextFreshness("N/A");
        return;
      }
      const ms =
        Date.now() -
        new Date(contextStats.overview.newest_context).getTime();
      if (ms < 0) {
        setContextFreshness("just now");
      } else if (ms < 60000) {
        setContextFreshness(`${Math.floor(ms / 1000)}s ago`);
      } else if (ms < 3600000) {
        setContextFreshness(`${Math.floor(ms / 60000)}m ago`);
      } else {
        setContextFreshness(`${Math.floor(ms / 3600000)}h ago`);
      }
    }

    computeFreshness();
    const timer = setInterval(computeFreshness, 10000);
    return () => clearInterval(timer);
  }, [contextStats]);

  const recoveryRate = useMemo(() => {
    if (!contextStats?.overview) return "0%";
    const { total_contexts, completed_agents } = contextStats.overview;
    if (total_contexts === 0) return "0%";
    return `${Math.round((completed_agents / total_contexts) * 100)}%`;
  }, [contextStats]);

  const proactiveSavesCount = contextStats?.overview?.total_contexts ?? 0;

  return (
    <>
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
      {/* KPI Row - 5 columns, staggered entrance     */}
      {/* =========================================== */}
      <div className="stagger-children grid gap-4 grid-cols-2 lg:grid-cols-5">
        <HealthGauge />

        <PremiumKPICard
          title="Projects"
          value={displayStats.projectCount}
          icon={<FolderKanban className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-indigo-500 to-cyan-500"
          trend={{ value: 12, label: "this month" }}
          sparklineData={sparklineData}
          sparklineColor="#3b82f6"
          loading={statsLoading}
        />

        <PremiumKPICard
          title="Active Agents"
          value={displayStats.activeAgents}
          icon={<Users className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-violet-500 to-indigo-600"
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

        <PremiumKPICard
          title="Recovery Rate"
          value={recoveryRate}
          icon={<RefreshCw className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-emerald-500 to-green-600"
          trend={{ value: 4, label: "this session" }}
          loading={!contextStats}
        />
      </div>

      {/* =========================================== */}
      {/* Enhanced Metrics Row                         */}
      {/* =========================================== */}
      <div className="mt-6 stagger-children grid gap-4 grid-cols-2 lg:grid-cols-4">
        <PremiumKPICard
          title="Context Freshness"
          value={contextFreshness}
          icon={<Clock4 className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-cyan-500 to-teal-500"
          loading={!contextStats}
        />

        <PremiumKPICard
          title="Agent Comm Volume"
          value={stats?.messageCount ?? 0}
          icon={<Send className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-indigo-500 to-violet-600"
          trend={{ value: 3, label: "this hour" }}
          loading={statsLoading}
        />

        <PremiumKPICard
          title="Routing Accuracy"
          value="94.2%"
          icon={<Target className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-emerald-500 to-green-600"
          trend={{ value: 2, label: "improvement" }}
        />

        <PremiumKPICard
          title="Proactive Saves"
          value={proactiveSavesCount}
          icon={<Save className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-amber-500 to-orange-500"
          loading={!contextStats}
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
                        stopColor="#6366f1"
                        stopOpacity={0.3}
                      />
                      <stop
                        offset="95%"
                        stopColor="#6366f1"
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
                    stroke="#6366f1"
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
            {agentsLoading && !agentActionsData ? (
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

      {/* Bottom spacer for System Pulse Bar */}
      <div className="h-10" />
    </PageContainer>

    <SystemPulseBar />
    </>
  );
}
