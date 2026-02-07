"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/PageContainer";
import { ErrorDisplay } from "@/components/ErrorBoundary";
import apiClient, {
  type HealthResponse,
  type StatsResponse,
  type ActiveSessionsResponse,
  type ActionsResponse,
} from "@/lib/api-client";
import {
  Activity,
  Clock,
  Users,
  Wrench,
  MessageSquare,
  CheckCircle,
  XCircle,
  FolderOpen,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

function HealthCard() {
  const { data, isLoading, error, refetch } = useQuery<HealthResponse, Error>({
    queryKey: ["health"],
    queryFn: apiClient.getHealth,
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">API Status</CardTitle>
          <Activity className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="mt-2 h-4 w-32" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">API Status</CardTitle>
          <XCircle className="h-4 w-4 text-destructive" />
        </CardHeader>
        <CardContent>
          <ErrorDisplay error={error} reset={() => refetch()} />
        </CardContent>
      </Card>
    );
  }

  const isHealthy = data?.status === "healthy" && data?.database?.healthy;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">API Status</CardTitle>
        {isHealthy ? (
          <CheckCircle className="h-4 w-4 text-green-500" />
        ) : (
          <XCircle className="h-4 w-4 text-destructive" />
        )}
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <Badge variant={isHealthy ? "default" : "destructive"}>
            {data?.status || "unknown"}
          </Badge>
          <span className="text-xs text-muted-foreground">
            v{data?.version}
          </span>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          <p>
            Database:{" "}
            <span
              className={
                data?.database?.healthy ? "text-green-500" : "text-destructive"
              }
            >
              {data?.database?.healthy ? "Connected" : "Disconnected"}
            </span>
          </p>
          {data?.database?.latencyMs !== undefined && (
            <p>Latency: {data.database.latencyMs}ms</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface KPICardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  description?: string;
  loading?: boolean;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
}

function KPICard({
  title,
  value,
  icon,
  description,
  loading,
  trend,
  trendValue,
}: KPICardProps) {
  const TrendIcon =
    trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const trendColor =
    trend === "up"
      ? "text-green-500"
      : trend === "down"
        ? "text-red-500"
        : "text-muted-foreground";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <>
            <Skeleton className="h-8 w-20" />
            {description && <Skeleton className="mt-1 h-4 w-28" />}
          </>
        ) : (
          <>
            <div className="text-2xl font-bold">{value}</div>
            <div className="flex items-center gap-1">
              {description && (
                <p className="text-xs text-muted-foreground">{description}</p>
              )}
              {trend && trendValue && (
                <span className={`flex items-center text-xs ${trendColor}`}>
                  <TrendIcon className="h-3 w-3 mr-0.5" />
                  {trendValue}
                </span>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function RecentActivityCard() {
  const { data, isLoading, error } = useQuery<ActionsResponse, Error>({
    queryKey: ["actions", "recent"],
    queryFn: () => apiClient.getActions(8, 0),
    refetchInterval: 15000,
  });

  const getToolTypeColor = (type: string) => {
    switch (type) {
      case "builtin":
        return "bg-blue-500/10 text-blue-500";
      case "agent":
        return "bg-purple-500/10 text-purple-500";
      case "skill":
        return "bg-green-500/10 text-green-500";
      case "command":
        return "bg-orange-500/10 text-orange-500";
      case "mcp":
        return "bg-cyan-500/10 text-cyan-500";
      default:
        return "bg-gray-500/10 text-gray-500";
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-12 ml-auto" />
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Failed to load activity</p>
        ) : data?.actions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recent activity to display.
          </p>
        ) : (
          <div className="space-y-3">
            {data?.actions.map((action) => (
              <div
                key={action.id}
                className="flex items-center gap-2 text-sm border-b border-border/50 pb-2 last:border-0 last:pb-0"
              >
                <Badge
                  variant="outline"
                  className={getToolTypeColor(action.tool_type)}
                >
                  {action.tool_type}
                </Badge>
                <span className="font-medium truncate max-w-[120px]">
                  {action.tool_name}
                </span>
                {action.exit_code === 0 ? (
                  <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />
                ) : (
                  <XCircle className="h-3 w-3 text-red-500 flex-shrink-0" />
                )}
                <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">
                  {formatDistanceToNow(new Date(action.created_at), {
                    addSuffix: true,
                  })}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActiveAgentsCard() {
  const { data, isLoading, error } = useQuery<ActiveSessionsResponse, Error>({
    queryKey: ["active-sessions"],
    queryFn: apiClient.getActiveSessions,
    refetchInterval: 10000,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Active Agents
          {data && data.count > 0 && (
            <Badge variant="secondary" className="ml-auto">
              {data.count} running
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-32" />
              </div>
            ))}
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Failed to load agents</p>
        ) : !data || data.count === 0 ? (
          <p className="text-sm text-muted-foreground">
            No agents currently running.
          </p>
        ) : (
          <div className="space-y-3">
            {data.active_agents.slice(0, 5).map((agent) => (
              <div
                key={agent.subtask_id}
                className="flex flex-col gap-1 text-sm border-b border-border/50 pb-2 last:border-0 last:pb-0"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-green-500/10 text-green-500">
                    {agent.agent_type || "unknown"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(agent.started_at), {
                      addSuffix: true,
                    })}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {agent.description}
                </p>
              </div>
            ))}
            {data.count > 5 && (
              <p className="text-xs text-muted-foreground text-center pt-1">
                +{data.count - 5} more agents
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  // Fetch real stats from API
  const {
    data: stats,
    isLoading: statsLoading,
    error: statsError,
  } = useQuery<StatsResponse, Error>({
    queryKey: ["stats"],
    queryFn: apiClient.getStats,
    refetchInterval: 30000,
  });

  // Fetch active sessions count
  const { data: activeSessions } = useQuery<ActiveSessionsResponse, Error>({
    queryKey: ["active-sessions"],
    queryFn: apiClient.getActiveSessions,
    refetchInterval: 10000,
  });

  return (
    <PageContainer
      title="Dashboard"
      description="Overview of the Context Manager system"
    >
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <HealthCard />
        <KPICard
          title="Projects"
          value={statsError ? "Error" : (stats?.projectCount ?? 0)}
          icon={<FolderOpen className="h-4 w-4 text-muted-foreground" />}
          description="Tracked projects"
          loading={statsLoading}
        />
        <KPICard
          title="Requests"
          value={statsError ? "Error" : (stats?.requestCount ?? 0)}
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          description="Total requests"
          loading={statsLoading}
        />
        <KPICard
          title="Active Agents"
          value={activeSessions?.count ?? 0}
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          description="Currently running"
          loading={statsLoading}
        />
        <KPICard
          title="Actions"
          value={statsError ? "Error" : (stats?.actionCount ?? 0)}
          icon={<Wrench className="h-4 w-4 text-muted-foreground" />}
          description="Tools executed"
          loading={statsLoading}
        />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <RecentActivityCard />
        <ActiveAgentsCard />
      </div>
    </PageContainer>
  );
}
