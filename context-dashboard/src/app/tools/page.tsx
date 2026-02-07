"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BarChart } from "@/components/charts/BarChart";
import { PieChart } from "@/components/charts/PieChart";
import { KPICard } from "@/components/charts/KPICard";
import { ErrorDisplay } from "@/components/ErrorBoundary";
import apiClient, {
  type ActionsResponse,
  type RoutingStats,
  type Action,
} from "@/lib/api-client";
import {
  Wrench,
  CheckCircle,
  XCircle,
  Clock,
  Activity,
  TrendingUp,
  Filter,
} from "lucide-react";

// Tool types for filtering
const TOOL_TYPES = ["no-builtin", "agent", "skill", "command", "mcp", "builtin", "all"] as const;
type ToolType = (typeof TOOL_TYPES)[number];

// Tab labels for display
const TAB_LABELS: Record<string, string> = {
  "no-builtin": "Smart Tools",
  agent: "Agents",
  skill: "Skills",
  command: "Commands",
  mcp: "MCP",
  builtin: "Builtins",
  all: "All",
};

// Tool type hex colors for charts (SVG fill)
const TOOL_TYPE_HEX: Record<string, string> = {
  builtin: "#64748b",
  agent: "#7c3aed",
  skill: "#10b981",
  command: "#f59e0b",
  mcp: "#06b6d4",
  unknown: "#6b7280",
};

// Tool type Tailwind classes for badges
const TOOL_TYPE_BADGE: Record<string, string> = {
  builtin: "bg-slate-500",
  agent: "bg-violet-600",
  skill: "bg-emerald-500",
  command: "bg-amber-500",
  mcp: "bg-cyan-500",
  unknown: "bg-gray-500",
};

// Helper to format duration
function formatDuration(ms: number | null): string {
  if (ms === null) return "N/A";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

// Helper to get hex color for charts
function getToolHexColor(type: string): string {
  return TOOL_TYPE_HEX[type.toLowerCase()] || TOOL_TYPE_HEX.unknown;
}

// Helper to get badge class for UI badges
function getToolBadgeClass(type: string): string {
  return TOOL_TYPE_BADGE[type.toLowerCase()] || TOOL_TYPE_BADGE.unknown;
}

// Helper to filter stats by selected type
function filterStatsByType(stats: ToolStats[], selectedType: ToolType): ToolStats[] {
  if (selectedType === "all") return stats;
  if (selectedType === "no-builtin") {
    return stats.filter((s) => s.type.toLowerCase() !== "builtin");
  }
  return stats.filter((s) => s.type.toLowerCase() === selectedType);
}

// Tool stats aggregated from actions
interface ToolStats {
  name: string;
  type: string;
  usageCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDuration: number;
  totalDuration: number;
}

// Aggregate actions into tool stats
function aggregateToolStats(actions: Action[]): ToolStats[] {
  const statsMap = new Map<string, ToolStats>();

  for (const action of actions) {
    const key = action.tool_name;
    const existing = statsMap.get(key);
    const isSuccess = action.exit_code === 0;
    const duration = action.duration_ms ?? 0;

    if (existing) {
      existing.usageCount += 1;
      existing.successCount += isSuccess ? 1 : 0;
      existing.failureCount += isSuccess ? 0 : 1;
      existing.totalDuration += duration;
    } else {
      statsMap.set(key, {
        name: action.tool_name,
        type: action.tool_type || "unknown",
        usageCount: 1,
        successCount: isSuccess ? 1 : 0,
        failureCount: isSuccess ? 0 : 1,
        successRate: 0,
        avgDuration: 0,
        totalDuration: duration,
      });
    }
  }

  // Calculate rates and averages
  const result: ToolStats[] = [];
  for (const stats of statsMap.values()) {
    stats.successRate = stats.usageCount > 0
      ? (stats.successCount / stats.usageCount) * 100
      : 0;
    stats.avgDuration = stats.usageCount > 0
      ? stats.totalDuration / stats.usageCount
      : 0;
    result.push(stats);
  }

  return result.sort((a, b) => b.usageCount - a.usageCount);
}

// Top tools chart component
function TopToolsChart({
  stats,
  loading,
}: {
  stats: ToolStats[];
  loading: boolean;
}) {
  const chartData = stats.slice(0, 10).map((tool) => ({
    name: tool.name.length > 15 ? tool.name.slice(0, 12) + "..." : tool.name,
    value: tool.usageCount,
    color: getToolHexColor(tool.type),
  }));

  return (
    <BarChart
      title="Top 10 Tools by Usage"
      data={chartData}
      loading={loading}
      height={300}
      horizontal
      barLabel="Usage"
    />
  );
}

// Tool type distribution chart
function ToolTypeDistribution({
  stats,
  loading,
}: {
  stats: ToolStats[];
  loading: boolean;
}) {
  const typeCount = new Map<string, number>();
  for (const tool of stats) {
    const type = tool.type || "unknown";
    typeCount.set(type, (typeCount.get(type) || 0) + tool.usageCount);
  }

  const chartData = Array.from(typeCount.entries()).map(([name, value]) => ({
    name,
    value,
    color: getToolHexColor(name),
  }));

  return (
    <PieChart
      title="Tool Type Distribution"
      data={chartData}
      loading={loading}
      height={300}
      showLegend
      innerRadius={50}
      outerRadius={90}
    />
  );
}

// Tools table component
function ToolsTable({
  stats,
  loading,
  selectedType,
}: {
  stats: ToolStats[];
  loading: boolean;
  selectedType: ToolType;
}) {
  const filteredStats = selectedType === "all"
    ? stats
    : selectedType === "no-builtin"
    ? stats.filter((s) => s.type.toLowerCase() !== "builtin")
    : stats.filter((s) => s.type.toLowerCase() === selectedType);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (filteredStats.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Wrench className="h-10 w-10 mb-3 opacity-40" />
        <p>No tools found for the selected filter</p>
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tool Name</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Usage</TableHead>
          <TableHead className="text-right">Success Rate</TableHead>
          <TableHead className="text-right">Avg Duration</TableHead>
          <TableHead className="text-right">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {filteredStats.map((tool) => (
          <TableRow key={tool.name}>
            <TableCell className="font-medium">{tool.name}</TableCell>
            <TableCell>
              <Badge className={`${getToolBadgeClass(tool.type)} text-white`}>
                {tool.type}
              </Badge>
            </TableCell>
            <TableCell className="text-right">{tool.usageCount}</TableCell>
            <TableCell className="text-right">
              <span
                className={
                  tool.successRate >= 90
                    ? "text-green-500"
                    : tool.successRate >= 70
                    ? "text-amber-500"
                    : "text-red-500"
                }
              >
                {tool.successRate.toFixed(1)}%
              </span>
            </TableCell>
            <TableCell className="text-right">
              {formatDuration(tool.avgDuration)}
            </TableCell>
            <TableCell className="text-right">
              {tool.successRate >= 90 ? (
                <CheckCircle className="ml-auto h-4 w-4 text-green-500" />
              ) : tool.successRate >= 70 ? (
                <Activity className="ml-auto h-4 w-4 text-amber-500" />
              ) : (
                <XCircle className="ml-auto h-4 w-4 text-red-500" />
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function ToolsPage() {
  const [selectedType, setSelectedType] = useState<ToolType>("all");

  // Fetch actions data
  const {
    data: actionsData,
    isLoading: actionsLoading,
    error: actionsError,
    refetch: refetchActions,
  } = useQuery<ActionsResponse, Error>({
    queryKey: ["actions", 2000, 0],
    queryFn: () => apiClient.getActions(2000, 0),
    refetchInterval: 60000,
  });

  // Fetch routing stats
  const {
    data: routingStats,
    isLoading: routingLoading,
    error: routingError,
    refetch: refetchRouting,
  } = useQuery<RoutingStats, Error>({
    queryKey: ["routing-stats"],
    queryFn: apiClient.getRoutingStats,
    refetchInterval: 60000,
  });

  // Calculate aggregated stats
  const actions = actionsData?.actions;
  const toolStats = useMemo(() => {
    if (!actions) return [];
    return aggregateToolStats(actions);
  }, [actions]);

  // Filter stats based on selected type
  const filteredToolStats = useMemo(() => {
    return filterStatsByType(toolStats, selectedType);
  }, [toolStats, selectedType]);

  // Calculate KPI values - use ALL tools for totals, filtered for rates
  const kpiStats = useMemo(() => {
    const totalActions = actionsData?.count ?? 0;
    const uniqueTools = toolStats.length; // Always total unique, not filtered
    const totalSuccess = toolStats.reduce((acc, t) => acc + t.successCount, 0);
    const totalUsage = toolStats.reduce((acc, t) => acc + t.usageCount, 0);
    const overallSuccessRate = totalUsage > 0 ? (totalSuccess / totalUsage) * 100 : 0;
    // Only compute avg duration from actions that actually have duration
    const toolsWithDuration = toolStats.filter((t) => t.totalDuration > 0);
    const durationUsage = toolsWithDuration.reduce((acc, t) => acc + t.usageCount, 0);
    const avgDuration = durationUsage > 0
      ? toolsWithDuration.reduce((acc, t) => acc + t.totalDuration, 0) / durationUsage
      : null; // null = no data

    return {
      totalActions,
      uniqueTools,
      overallSuccessRate,
      avgDuration,
    };
  }, [actionsData?.count, toolStats]);

  const isLoading = actionsLoading || routingLoading;
  const hasError = actionsError || routingError;

  if (hasError) {
    return (
      <PageContainer
        title="Tools"
        description="Analytics for skills, commands, workflows, and plugins"
      >
        <ErrorDisplay
          error={actionsError || routingError}
          reset={() => {
            refetchActions();
            refetchRouting();
          }}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Tools"
      description="Analytics for skills, commands, workflows, and plugins"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            refetchActions();
            refetchRouting();
          }}
        >
          Refresh
        </Button>
      }
    >
      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 stagger-children">
        <KPICard
          title="Total Actions"
          value={kpiStats.totalActions.toLocaleString()}
          icon={<Activity className="h-4 w-4" />}
          description="Recorded tool executions"
          loading={isLoading}
        />
        <KPICard
          title="Unique Tools"
          value={kpiStats.uniqueTools}
          icon={<Wrench className="h-4 w-4" />}
          description="Different tools used"
          loading={isLoading}
        />
        <KPICard
          title="Success Rate"
          value={`${kpiStats.overallSuccessRate.toFixed(1)}%`}
          icon={<TrendingUp className="h-4 w-4" />}
          description="Overall success rate"
          loading={isLoading}
          trend={
            kpiStats.overallSuccessRate >= 90
              ? { value: 0, label: "excellent" }
              : undefined
          }
        />
        <KPICard
          title="Avg Duration"
          value={kpiStats.avgDuration !== null ? formatDuration(kpiStats.avgDuration) : "N/A"}
          icon={<Clock className="h-4 w-4" />}
          description="Average execution time"
          loading={isLoading}
        />
      </div>

      {/* Charts Row */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <TopToolsChart stats={filteredToolStats} loading={isLoading} />
        <ToolTypeDistribution stats={filteredToolStats} loading={isLoading} />
      </div>

      {/* Tools Table with Filters */}
      <Card className="mt-6 glass-card animate-fade-in">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Filter className="h-5 w-5" />
              All Tools
            </CardTitle>
            <Tabs value={selectedType} onValueChange={(v) => setSelectedType(v as ToolType)}>
              <TabsList >
                {TOOL_TYPES.map((type) => (
                  <TabsTrigger key={type} value={type}>
                    {TAB_LABELS[type] || type}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </CardHeader>
        <CardContent>
          <ToolsTable
            stats={toolStats}
            loading={isLoading}
            selectedType={selectedType}
          />
        </CardContent>
      </Card>

      {/* Routing Stats Card */}
      {routingStats && (
        <Card className="mt-6 glass-card animate-fade-in">
          <CardHeader>
            <CardTitle>Routing Intelligence</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Total Records</p>
                <p className="text-2xl font-bold">{routingStats.totals.total_records}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Unique Tools</p>
                <p className="text-2xl font-bold">{routingStats.totals.unique_tools}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Top Tools by Usage</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {routingStats.top_by_usage?.slice(0, 5).map((tool) => (
                    <Badge
                      key={tool.tool_name}
                      variant="outline"
                      className="text-xs"
                    >
                      {tool.tool_name} ({tool.total_usage})
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
