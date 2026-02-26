"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PageContainer } from "@/components/PageContainer";
import { ErrorDisplay } from "@/components/ErrorBoundary";
import apiClient, {
  type HealthResponse,
  type DashboardKPIs,
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
  Zap,
  BarChart3,
  Target,
  Route,
  Brain,
  Percent,
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
  accent?: string;
}

function KPICard({
  title,
  value,
  icon,
  description,
  loading,
  accent,
}: KPICardProps) {
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
            <div className={`text-2xl font-bold ${accent || ""}`}>{value}</div>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SuccessRateBar({ rate, label }: { rate: number; label: string }) {
  const color =
    rate >= 90
      ? "bg-green-500"
      : rate >= 70
        ? "bg-yellow-500"
        : "bg-red-500";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{rate}%</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${Math.min(rate, 100)}%` }}
        />
      </div>
    </div>
  );
}

function AgentDistributionCard({ kpis, loading }: { kpis?: DashboardKPIs; loading: boolean }) {
  const topTypes = kpis?.agents.top_types ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Agent Distribution
          {kpis && (
            <Badge variant="secondary" className="ml-auto">
              {kpis.agents.unique_types} types
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : topTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No agent context data yet.
          </p>
        ) : (
          <div className="space-y-3">
            {topTypes.map((t) => {
              const maxCount = topTypes[0]?.count ?? 1;
              const pct = Math.round((t.count / maxCount) * 100);
              return (
                <div key={t.agent_type} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium truncate max-w-[180px]">
                      {t.agent_type}
                    </span>
                    <span className="text-muted-foreground">{t.count}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SystemHealthCard({ kpis, loading }: { kpis?: DashboardKPIs; loading: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5" />
          System Metrics
        </CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <SuccessRateBar
              rate={kpis?.actions_24h.success_rate ?? 0}
              label="Actions Success Rate (24h)"
            />
            <SuccessRateBar
              rate={kpis?.subtasks.completion_rate ?? 0}
              label="Subtask Completion Rate"
            />
            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              <div>
                <p className="text-xs text-muted-foreground">Avg Actions/hr</p>
                <p className="text-lg font-bold">{kpis?.actions_24h.avg_per_hour ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Avg Tools/Session</p>
                <p className="text-lg font-bold">{kpis?.sessions.avg_tools_per_session ?? 0}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Routing Keywords</p>
                <p className="text-lg font-bold">{(kpis?.routing.keywords ?? 0).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Routing Tools</p>
                <p className="text-lg font-bold">{kpis?.routing.tools ?? 0}</p>
              </div>
            </div>
          </div>
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
                    {formatDistanceToNow(new Date(agent.started_at || agent.created_at), {
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
  const {
    data: kpis,
    isLoading: kpisLoading,
  } = useQuery<DashboardKPIs, Error>({
    queryKey: ["dashboard-kpis"],
    queryFn: apiClient.getDashboardKPIs,
    refetchInterval: 15000,
  });

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
      {/* Row 1: Primary KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <HealthCard />
        <KPICard
          title="Success Rate (24h)"
          value={kpis ? `${kpis.actions_24h.success_rate}%` : "..."}
          icon={<Percent className="h-4 w-4 text-muted-foreground" />}
          description={kpis ? `${kpis.actions_24h.success}/${kpis.actions_24h.total} actions` : undefined}
          loading={kpisLoading}
          accent={
            kpis
              ? kpis.actions_24h.success_rate >= 90
                ? "text-green-600"
                : kpis.actions_24h.success_rate >= 70
                  ? "text-yellow-600"
                  : "text-red-600"
              : undefined
          }
        />
        <KPICard
          title="Actions/Hour"
          value={kpis?.actions_24h.avg_per_hour ?? 0}
          icon={<BarChart3 className="h-4 w-4 text-muted-foreground" />}
          description={kpis ? `${kpis.actions_24h.unique_tools} unique tools` : undefined}
          loading={kpisLoading}
        />
        <KPICard
          title="Active Agents"
          value={activeSessions?.count ?? 0}
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          description="Currently running"
          loading={kpisLoading}
        />
        <KPICard
          title="Sessions"
          value={kpis?.sessions.total ?? 0}
          icon={<FolderOpen className="h-4 w-4 text-muted-foreground" />}
          description={kpis ? `${kpis.sessions.active} active` : undefined}
          loading={kpisLoading}
        />
      </div>

      {/* Row 2: Secondary KPIs */}
      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Subtasks"
          value={kpis?.subtasks.total ?? 0}
          icon={<Wrench className="h-4 w-4 text-muted-foreground" />}
          description={kpis ? `${kpis.subtasks.completed} completed, ${kpis.subtasks.running} running` : undefined}
          loading={kpisLoading}
        />
        <KPICard
          title="Agent Contexts"
          value={kpis?.agents.contexts_total ?? 0}
          icon={<Brain className="h-4 w-4 text-muted-foreground" />}
          description={kpis ? `${kpis.agents.unique_types} agent types` : undefined}
          loading={kpisLoading}
        />
        <KPICard
          title="Routing Coverage"
          value={kpis ? (kpis.routing.keywords).toLocaleString() : 0}
          icon={<Route className="h-4 w-4 text-muted-foreground" />}
          description={kpis ? `${kpis.routing.tools} tools, ${(kpis.routing.mappings).toLocaleString()} mappings` : undefined}
          loading={kpisLoading}
        />
        <KPICard
          title="Actions (24h)"
          value={kpis?.actions_24h.total ?? 0}
          icon={<Clock className="h-4 w-4 text-muted-foreground" />}
          description={kpis ? `${kpis.actions_24h.active_sessions} sessions active` : undefined}
          loading={kpisLoading}
        />
      </div>

      {/* Row 3: Detailed panels */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <SystemHealthCard kpis={kpis} loading={kpisLoading} />
        <AgentDistributionCard kpis={kpis} loading={kpisLoading} />
      </div>

      {/* Row 4: Activity panels */}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <RecentActivityCard />
        <ActiveAgentsCard />
      </div>
    </PageContainer>
  );
}
