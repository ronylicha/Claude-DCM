"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart } from "@/components/charts/BarChart";
import apiClient, {
  type SubtasksResponse,
  type ActiveSessionsResponse,
} from "@/lib/api-client";
import {
  Users,
  Activity,
  CheckCircle,
  Clock,
  AlertCircle,
  Zap,
  Bot,
  Network,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Agent type categories for color coding
const AGENT_CATEGORIES: Record<string, { color: string; bgColor: string }> = {
  // Core orchestration
  "project-supervisor": { color: "text-purple-600", bgColor: "bg-purple-500" },
  "tech-lead": { color: "text-purple-500", bgColor: "bg-purple-400" },
  // Protection
  "impact-analyzer": { color: "text-red-600", bgColor: "bg-red-500" },
  "regression-guard": { color: "text-red-500", bgColor: "bg-red-400" },
  "security-specialist": { color: "text-red-600", bgColor: "bg-red-500" },
  // Backend
  "backend-laravel": { color: "text-orange-600", bgColor: "bg-orange-500" },
  "laravel-api": { color: "text-orange-500", bgColor: "bg-orange-400" },
  "database-admin": { color: "text-amber-600", bgColor: "bg-amber-500" },
  // Frontend
  "frontend-react": { color: "text-blue-600", bgColor: "bg-blue-500" },
  "react-refine": { color: "text-blue-500", bgColor: "bg-blue-400" },
  "designer-ui-ux": { color: "text-pink-600", bgColor: "bg-pink-500" },
  // Mobile
  "react-native-dev": { color: "text-cyan-600", bgColor: "bg-cyan-500" },
  "react-native-ui": { color: "text-cyan-500", bgColor: "bg-cyan-400" },
  // Default
  default: { color: "text-gray-600", bgColor: "bg-gray-500" },
};

function getAgentCategory(agentType: string) {
  return AGENT_CATEGORIES[agentType] || AGENT_CATEGORIES.default;
}

// Status badge variant mapping
function getStatusBadgeVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running":
      return "default";
    case "completed":
      return "secondary";
    case "failed":
      return "destructive";
    case "pending":
    case "blocked":
    case "paused":
    default:
      return "outline";
  }
}

// Relative time formatter
function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "just started";
  const diff = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Premium KPI Card Component
function PremiumKPICard({
  title,
  value,
  icon,
  iconGradient,
  description,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  iconGradient: string;
  description?: string;
}) {
  return (
    <div className="glass-card rounded-xl p-5 flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <div className={cn("flex items-center justify-center h-8 w-8 rounded-lg", iconGradient)}>
          {icon}
        </div>
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
      </div>
      <div className="text-3xl font-bold tracking-tight">{value}</div>
      {description && <span className="text-xs text-muted-foreground">{description}</span>}
    </div>
  );
}

// Active Agent Card Component
function ActiveAgentCard({
  agent,
  index,
}: {
  agent: ActiveSessionsResponse["active_agents"][0];
  index: number;
}) {
  const category = getAgentCategory(agent.agent_type || "");
  // Use started_at if available, fallback to created_at
  const timeRef = agent.started_at || agent.created_at;
  const duration = relativeTime(timeRef);

  return (
    <Card className="border-l-4" style={{ borderLeftColor: "hsl(var(--primary))" }}>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-[10px] font-bold text-primary">
              {index}
            </span>
            <div className={`h-2 w-2 rounded-full ${category.bgColor} animate-pulse`} />
            <span className={`font-medium ${category.color}`}>
              {agent.agent_type || "unknown"}
            </span>
          </div>
          <Badge variant="default" className="bg-green-500">
            Running
          </Badge>
        </div>
        <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
          {agent.description || "No description"}
        </p>
        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {duration}
          </span>
          {agent.session_id && (
            <span className="truncate max-w-[150px]" title={agent.session_id}>
              Session: {agent.session_id.slice(0, 8)}...
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Agent Type Stats Card with progress bar
function AgentTypeCard({
  agentType,
  count,
  statuses,
}: {
  agentType: string;
  count: number;
  statuses: Record<string, number>;
}) {
  const category = getAgentCategory(agentType);
  const completedCount = statuses.completed || 0;
  const failedCount = statuses.failed || 0;
  const runningCount = statuses.running || 0;
  const totalTerminated = completedCount + failedCount;
  const successRate =
    totalTerminated > 0
      ? Math.round((completedCount / totalTerminated) * 100)
      : null;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <div className={`h-3 w-3 rounded-full ${category.bgColor}`} />
            <span className={category.color}>{agentType}</span>
          </CardTitle>
          <Badge variant="outline">{count} tasks</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Completed</span>
            <span className="font-medium text-green-600 flex items-center gap-1">
              <CheckCircle className="h-3 w-3" />
              {completedCount}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Running</span>
            <span className="font-medium text-blue-600 flex items-center gap-1">
              <Activity className="h-3 w-3" />
              {runningCount}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Failed</span>
            <span className="font-medium text-red-600 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {failedCount}
            </span>
          </div>
          <div className="pt-2 border-t">
            <div className="flex items-center justify-between text-sm mb-1.5">
              <span className="text-muted-foreground">Success Rate</span>
              <span
                className={cn(
                  "font-medium",
                  successRate === null
                    ? "text-muted-foreground"
                    : successRate >= 80
                      ? "text-green-600"
                      : successRate >= 50
                        ? "text-yellow-600"
                        : "text-red-600"
                )}
              >
                {successRate !== null ? `${successRate}%` : "N/A"}
              </span>
            </div>
            {/* Progress bar */}
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500 ease-out",
                  successRate === null
                    ? "bg-muted"
                    : successRate >= 80
                      ? "bg-green-500"
                      : successRate >= 50
                        ? "bg-yellow-500"
                        : "bg-red-500"
                )}
                style={{ width: `${successRate !== null ? successRate : 0}%` }}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Agent Grid - Replaces NetworkGraphPlaceholder
function AgentGrid({
  agentStats,
  activeAgentTypes,
}: {
  agentStats: Record<string, { count: number; statuses: Record<string, number> }>;
  activeAgentTypes: Set<string>;
}) {
  const agents = Object.entries(agentStats)
    .filter(([type]) => type !== "unassigned")
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 16); // 4x4 grid max

  if (agents.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Network className="h-5 w-5" />
            Agent Grid
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Network className="h-16 w-16 mb-4 opacity-30" />
            <p className="text-center">No agent data available yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Network className="h-5 w-5" />
          Agent Grid
          <Badge variant="outline" className="ml-2">{agents.length} agents</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-3">
          {agents.map(([agentType], index) => {
            const category = getAgentCategory(agentType);
            const isActive = activeAgentTypes.has(agentType);
            // Truncate name for display
            const shortName = agentType.length > 12
              ? agentType.slice(0, 11) + "..."
              : agentType;

            return (
              <div
                key={agentType}
                className={cn(
                  "flex flex-col items-center justify-center rounded-lg border p-2 transition-all duration-200 animate-fade-in",
                  isActive
                    ? "animate-pulse-glow border-primary/50 bg-primary/5"
                    : "opacity-50 border-border bg-card"
                )}
                style={{ animationDelay: `${index * 40}ms` }}
                title={agentType}
              >
                <div className="relative">
                  <div className={cn(
                    "h-10 w-10 rounded-lg flex items-center justify-center",
                    isActive ? category.bgColor + "/20" : "bg-muted"
                  )}>
                    <Users className={cn(
                      "h-5 w-5",
                      isActive ? category.color : "text-muted-foreground"
                    )} />
                  </div>
                  {/* Status dot */}
                  <div className={cn(
                    "absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background",
                    isActive ? "bg-green-500 animate-pulse" : "bg-muted-foreground/40"
                  )} />
                </div>
                <span className={cn(
                  "mt-1.5 text-[10px] font-medium text-center leading-tight truncate w-full",
                  isActive ? category.color : "text-muted-foreground"
                )}>
                  {shortName}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// Loading skeleton for agent cards
function AgentCardSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-5 w-16" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function AgentsPage() {
  // Fetch subtasks to get agent types and their stats
  const { data: subtasksData, isLoading: subtasksLoading } =
    useQuery<SubtasksResponse>({
      queryKey: ["subtasks", "all"],
      queryFn: () => apiClient.getSubtasks({ limit: 1000 }),
      refetchInterval: 30000, // Refresh every 30s
    });

  // Fetch active sessions
  const { data: activeSessions, isLoading: activeLoading } =
    useQuery<ActiveSessionsResponse>({
      queryKey: ["active-sessions"],
      queryFn: apiClient.getActiveSessions,
      refetchInterval: 10000, // Refresh every 10s for live data
    });

  // Process subtasks to get agent type stats
  const agentStats = useMemo(() => {
    if (!subtasksData?.subtasks) return { byType: {}, total: 0, statusCounts: {} };

    const byType: Record<string, { count: number; statuses: Record<string, number> }> = {};
    const statusCounts: Record<string, number> = {};

    for (const subtask of subtasksData.subtasks) {
      const agentType = subtask.agent_type || "unassigned";

      if (!byType[agentType]) {
        byType[agentType] = { count: 0, statuses: {} };
      }

      byType[agentType].count++;
      byType[agentType].statuses[subtask.status] =
        (byType[agentType].statuses[subtask.status] || 0) + 1;

      statusCounts[subtask.status] = (statusCounts[subtask.status] || 0) + 1;
    }

    return {
      byType,
      total: subtasksData.subtasks.length,
      statusCounts,
    };
  }, [subtasksData]);

  // Get sorted agent types for bar chart
  const chartData = useMemo(() => {
    return Object.entries(agentStats.byType)
      .filter(([type]) => type !== "unassigned")
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 10)
      .map(([name, data]) => ({
        name: name.replace(/-/g, " ").slice(0, 18),
        value: data.count,
      }));
  }, [agentStats]);

  // Get unique agent types count
  const uniqueAgentTypes = Object.keys(agentStats.byType).filter(
    (t) => t !== "unassigned"
  ).length;

  // Active agents count
  const activeAgentsCount = activeSessions?.count || 0;

  // Compute active agent types set for the grid
  const activeAgentTypes = useMemo(() => {
    const types = new Set<string>();
    if (activeSessions?.active_agents) {
      for (const agent of activeSessions.active_agents) {
        if (agent.agent_type) {
          types.add(agent.agent_type);
        }
      }
    }
    return types;
  }, [activeSessions]);

  return (
    <PageContainer
      title="Agents"
      description="Agent activity monitoring and statistics"
      actions={
        <Badge variant="outline" className="gap-1">
          <Bot className="h-3 w-3" />
          {uniqueAgentTypes} Types
        </Badge>
      }
    >
      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 stagger-children">
        <PremiumKPICard
          title="Active Agents"
          value={activeAgentsCount}
          icon={<Activity className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-green-500 to-emerald-500"
          description="Currently running"
        />
        <PremiumKPICard
          title="Agent Types"
          value={uniqueAgentTypes}
          icon={<Users className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-purple-500 to-violet-600"
          description="Unique types used"
        />
        <PremiumKPICard
          title="Total Subtasks"
          value={agentStats.total}
          icon={<Zap className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-amber-500 to-orange-500"
          description="All time"
        />
        <PremiumKPICard
          title="Success Rate"
          value={
            (agentStats.statusCounts.completed || 0) + (agentStats.statusCounts.failed || 0) > 0
              ? `${Math.round(
                  ((agentStats.statusCounts.completed || 0) /
                    ((agentStats.statusCounts.completed || 0) +
                      (agentStats.statusCounts.failed || 0))) *
                    100
                )}%`
              : "N/A"
          }
          icon={<CheckCircle className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-blue-500 to-cyan-500"
          description="Completed vs failed"
        />
      </div>

      {/* Active Agents Section */}
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Activity className="h-5 w-5 text-green-500" />
          Currently Active Agents
          {activeAgentsCount > 0 && (
            <Badge variant="default" className="bg-green-500">
              {activeAgentsCount}
            </Badge>
          )}
        </h3>
        {activeLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <AgentCardSkeleton key={i} />
            ))}
          </div>
        ) : activeSessions?.active_agents && activeSessions.active_agents.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {activeSessions.active_agents.map((agent, idx) => (
              <ActiveAgentCard key={agent.subtask_id || idx} agent={agent} index={idx + 1} />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <Users className="h-12 w-12 mb-4 opacity-30" />
              <p>No agents currently active</p>
              <p className="text-xs mt-1">
                Agents will appear here when tasks are running
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Charts and Agent Grid Row */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        {/* Bar Chart - Top Agents by Usage */}
        <BarChart
          title="Top 10 Agents by Task Count"
          data={chartData}
          loading={subtasksLoading}
          height={300}
          horizontal
          barLabel="Tasks"
        />

        {/* Agent Grid - Replaces NetworkGraphPlaceholder */}
        <AgentGrid
          agentStats={agentStats.byType}
          activeAgentTypes={activeAgentTypes}
        />
      </div>

      {/* Agent Types Grid */}
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Bot className="h-5 w-5" />
          Agent Type Statistics
        </h3>
        {subtasksLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <AgentCardSkeleton key={i} />
            ))}
          </div>
        ) : Object.keys(agentStats.byType).length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Object.entries(agentStats.byType)
              .filter(([type]) => type !== "unassigned")
              .sort((a, b) => b[1].count - a[1].count)
              .map(([agentType, data]) => (
                <AgentTypeCard
                  key={agentType}
                  agentType={agentType}
                  count={data.count}
                  statuses={data.statuses}
                />
              ))}
          </div>
        ) : (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bot className="h-16 w-16 mb-4 opacity-30" />
              <p>No agent data available</p>
              <p className="text-xs mt-1">
                Agent statistics will appear here as tasks are processed
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Status Summary */}
      <div className="mt-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Task Status Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {Object.entries(agentStats.statusCounts).map(([status, count]) => (
                <Badge
                  key={status}
                  variant={getStatusBadgeVariant(status)}
                  className="text-sm py-1 px-3"
                >
                  {status}: {count}
                </Badge>
              ))}
              {Object.keys(agentStats.statusCounts).length === 0 && (
                <span className="text-muted-foreground text-sm">
                  No task data available
                </span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
