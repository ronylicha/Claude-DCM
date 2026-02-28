"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart } from "@/components/charts/BarChart";
import { PremiumKPICard } from "@/components/dashboard/PremiumKPICard";
import apiClient, {
  type SubtasksResponse,
  type ActiveSessionsResponse,
  type ActionsResponse,
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
  ShieldAlert,
  ShieldCheck,
  Timer,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

const AGENT_CATEGORIES: Record<string, { color: string; bgColor: string; gradient: string }> = {
  "project-supervisor": { color: "text-purple-600 dark:text-purple-400", bgColor: "bg-purple-500", gradient: "from-purple-500 to-violet-600" },
  "tech-lead": { color: "text-purple-500 dark:text-purple-300", bgColor: "bg-purple-400", gradient: "from-purple-400 to-violet-500" },
  "impact-analyzer": { color: "text-red-600 dark:text-red-400", bgColor: "bg-red-500", gradient: "from-red-500 to-rose-600" },
  "regression-guard": { color: "text-red-500 dark:text-red-300", bgColor: "bg-red-400", gradient: "from-red-400 to-rose-500" },
  "security-specialist": { color: "text-red-600 dark:text-red-400", bgColor: "bg-red-500", gradient: "from-red-500 to-rose-600" },
  "backend-laravel": { color: "text-orange-600 dark:text-orange-400", bgColor: "bg-orange-500", gradient: "from-orange-500 to-amber-600" },
  "laravel-api": { color: "text-orange-500 dark:text-orange-300", bgColor: "bg-orange-400", gradient: "from-orange-400 to-amber-500" },
  "database-admin": { color: "text-amber-600 dark:text-amber-400", bgColor: "bg-amber-500", gradient: "from-amber-500 to-yellow-600" },
  "frontend-react": { color: "text-blue-600 dark:text-blue-400", bgColor: "bg-blue-500", gradient: "from-blue-500 to-cyan-600" },
  "react-refine": { color: "text-blue-500 dark:text-blue-300", bgColor: "bg-blue-400", gradient: "from-blue-400 to-cyan-500" },
  "designer-ui-ux": { color: "text-pink-600 dark:text-pink-400", bgColor: "bg-pink-500", gradient: "from-pink-500 to-rose-600" },
  "react-native-dev": { color: "text-cyan-600 dark:text-cyan-400", bgColor: "bg-cyan-500", gradient: "from-cyan-500 to-teal-600" },
  "react-native-ui": { color: "text-cyan-500 dark:text-cyan-300", bgColor: "bg-cyan-400", gradient: "from-cyan-400 to-teal-500" },
  "step-orchestrator": { color: "text-indigo-600 dark:text-indigo-400", bgColor: "bg-indigo-500", gradient: "from-indigo-500 to-purple-600" },
  Explore: { color: "text-emerald-600 dark:text-emerald-400", bgColor: "bg-emerald-500", gradient: "from-emerald-500 to-green-600" },
  "code-reviewer": { color: "text-yellow-600 dark:text-yellow-400", bgColor: "bg-yellow-500", gradient: "from-yellow-500 to-amber-600" },
  default: { color: "text-gray-600 dark:text-gray-400", bgColor: "bg-gray-500", gradient: "from-gray-500 to-slate-600" },
};

function getAgentCategory(agentType: string) {
  return AGENT_CATEGORIES[agentType] || AGENT_CATEGORIES.default;
}

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "running": return "default";
    case "completed": return "secondary";
    case "failed": return "destructive";
    default: return "outline";
  }
}

function relativeTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "just started";
  const diff = Math.max(0, Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatDuration(startStr: string | null | undefined): string {
  if (!startStr) return "0s";
  const diff = Math.max(0, Math.floor((Date.now() - new Date(startStr).getTime()) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

// ============================================
// Active Agent Card with animated gradient border
// ============================================
function ActiveAgentCard({
  agent,
  index,
}: {
  agent: ActiveSessionsResponse["active_agents"][0];
  index: number;
}) {
  const category = getAgentCategory(agent.agent_type || "");
  const timeRef = agent.started_at || agent.created_at;

  return (
    <div className="relative group">
      {/* Animated gradient border */}
      <div className={cn(
        "absolute -inset-[1px] rounded-xl bg-gradient-to-r opacity-60 blur-[2px] group-hover:opacity-100 transition-opacity duration-300",
        category.gradient
      )} />
      <Card className="relative glass-card border-0 overflow-hidden">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <div className={cn(
                "flex items-center justify-center h-8 w-8 rounded-lg bg-gradient-to-br",
                category.gradient
              )}>
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div>
                <span className={cn("font-semibold text-sm", category.color)}>
                  {agent.agent_type || "unknown"}
                </span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Running</span>
                </div>
              </div>
            </div>
            <span className="flex items-center justify-center h-6 w-6 rounded-full bg-primary/10 text-[10px] font-bold text-primary">
              #{index}
            </span>
          </div>
          {agent.parent_agent_id && (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-0.5 w-fit">
              <Network className="h-3 w-3" />
              <span>Subagent of <span className="font-mono">{agent.parent_agent_id.slice(0, 8)}</span></span>
            </div>
          )}
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {agent.description || "No description"}
          </p>
          <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {formatDuration(timeRef)}
            </span>
            {agent.session_id && (
              <span className="truncate max-w-[120px] font-mono text-[10px]" title={agent.session_id}>
                {agent.session_id.slice(0, 8)}
              </span>
            )}
            {agent.actions_count !== undefined && agent.actions_count > 0 && (
              <span className="flex items-center gap-1">
                <Zap className="h-3 w-3" />
                {agent.actions_count} actions
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================
// Agent Type Stats Card with glassmorphism
// ============================================
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
  const successRate = totalTerminated > 0 ? Math.round((completedCount / totalTerminated) * 100) : null;

  return (
    <Card className="glass-card hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 group">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <div className={cn("h-2.5 w-2.5 rounded-full", category.bgColor)} />
            <span className={cn("truncate", category.color)}>{agentType}</span>
          </CardTitle>
          <Badge variant="outline" className="text-[10px]">{count}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Completed</span>
            <span className="font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
              <CheckCircle className="h-3 w-3" />
              {completedCount}
            </span>
          </div>
          {runningCount > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Running</span>
              <span className="font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1">
                <Activity className="h-3 w-3 animate-pulse" />
                {runningCount}
              </span>
            </div>
          )}
          {failedCount > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Failed</span>
              <span className="font-medium text-red-600 dark:text-red-400 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {failedCount}
              </span>
            </div>
          )}
          <div className="pt-2 border-t border-border/50">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-muted-foreground">Success</span>
              <span className={cn(
                "font-semibold",
                successRate === null ? "text-muted-foreground"
                  : successRate >= 80 ? "text-green-600 dark:text-green-400"
                  : successRate >= 50 ? "text-yellow-600 dark:text-yellow-400"
                  : "text-red-600 dark:text-red-400"
              )}>
                {successRate !== null ? `${successRate}%` : "—"}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700 ease-out",
                  successRate === null ? "bg-muted"
                    : successRate >= 80 ? "bg-gradient-to-r from-green-500 to-emerald-400"
                    : successRate >= 50 ? "bg-gradient-to-r from-yellow-500 to-amber-400"
                    : "bg-gradient-to-r from-red-500 to-rose-400"
                )}
                style={{ width: `${successRate ?? 0}%` }}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// Agent Grid with visual topology
// ============================================
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
    .slice(0, 16);

  if (agents.length === 0) {
    return (
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-5 w-5" />
            Agent Topology
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Network className="h-16 w-16 mb-4 opacity-20" />
            <p>No agent data yet</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Network className="h-5 w-5" />
            Agent Topology
          </CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <div className="h-2 w-2 rounded-full bg-green-500" /> Active
            </div>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <div className="h-2 w-2 rounded-full bg-muted-foreground/40" /> Idle
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-2.5">
          {agents.map(([agentType, data], index) => {
            const category = getAgentCategory(agentType);
            const isActive = activeAgentTypes.has(agentType);
            const shortName = agentType.length > 14 ? agentType.slice(0, 13) + "…" : agentType;

            return (
              <div
                key={agentType}
                className={cn(
                  "flex flex-col items-center justify-center rounded-xl border p-2.5 transition-all duration-300",
                  isActive
                    ? "border-primary/30 bg-primary/5 shadow-sm shadow-primary/10"
                    : "opacity-40 border-border/50 bg-card hover:opacity-70"
                )}
                style={{ animationDelay: `${index * 30}ms` }}
                title={`${agentType} — ${data.count} tasks`}
              >
                <div className="relative">
                  <div className={cn(
                    "h-9 w-9 rounded-lg flex items-center justify-center transition-all duration-300",
                    isActive ? `bg-gradient-to-br ${category.gradient}` : "bg-muted"
                  )}>
                    <Bot className={cn(
                      "h-4 w-4",
                      isActive ? "text-white" : "text-muted-foreground"
                    )} />
                  </div>
                  <div className={cn(
                    "absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background transition-colors",
                    isActive ? "bg-green-500 animate-pulse" : "bg-muted-foreground/30"
                  )} />
                </div>
                <span className={cn(
                  "mt-1.5 text-[9px] font-medium text-center leading-tight truncate w-full",
                  isActive ? category.color : "text-muted-foreground"
                )}>
                  {shortName}
                </span>
                <span className="text-[8px] text-muted-foreground mt-0.5">
                  {data.count}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// Safety Gate Section - Blocked Operations
// ============================================
function SafetyGateSection({ blockedActions }: { blockedActions: ActionsResponse | undefined }) {
  const blocked = blockedActions?.actions ?? [];
  const blockedCount = blocked.length;

  return (
    <Card className="glass-card border-red-500/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {blockedCount > 0 ? (
              <ShieldAlert className="h-5 w-5 text-red-500" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-green-500" />
            )}
            Safety Gate
          </CardTitle>
          <Badge
            variant={blockedCount > 0 ? "destructive" : "secondary"}
            className="text-[10px]"
          >
            {blockedCount > 0 ? `${blockedCount} blocked` : "All clear"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {blockedCount === 0 ? (
          <div className="flex items-center gap-3 py-3 px-4 rounded-lg bg-green-500/5 border border-green-500/10">
            <ShieldCheck className="h-8 w-8 text-green-500/60" />
            <div>
              <p className="text-sm font-medium text-green-600 dark:text-green-400">No blocked operations</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Safety gate is active — rm -rf, DROP DATABASE, .env access are blocked
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {blocked.map((action, idx) => (
              <div
                key={action.id || idx}
                className="flex items-start gap-3 rounded-lg border border-red-500/10 bg-red-500/5 px-3 py-2.5"
              >
                <ShieldAlert className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-red-600 dark:text-red-400 truncate">
                    {typeof action.metadata?.reason === "string" ? action.metadata.reason : "Blocked operation"}
                  </p>
                  <p className="text-[10px] text-muted-foreground mt-0.5 font-mono truncate">
                    {(action as { input?: string }).input || "N/A"}
                  </p>
                </div>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                  {relativeTime(action.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================
// Loading Skeletons
// ============================================
function AgentCardSkeleton() {
  return (
    <Card className="glass-card">
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

// ============================================
// Main Page
// ============================================
export default function AgentsPage() {
  const { data: subtasksData, isLoading: subtasksLoading } = useQuery<SubtasksResponse>({
    queryKey: ["subtasks", "all"],
    queryFn: () => apiClient.getSubtasks({ limit: 1000 }),
    refetchInterval: 30000,
  });

  const { data: activeSessions, isLoading: activeLoading } = useQuery<ActiveSessionsResponse>({
    queryKey: ["active-sessions"],
    queryFn: apiClient.getActiveSessions,
    refetchInterval: 10000,
  });

  // Fetch blocked operations from Safety Gate
  const { data: blockedActions } = useQuery<ActionsResponse>({
    queryKey: ["actions", "blocked"],
    queryFn: () => apiClient.getActions(20, 0, "blocked"),
    refetchInterval: 15000,
  });

  const agentStats = useMemo(() => {
    if (!subtasksData?.subtasks) return { byType: {}, total: 0, statusCounts: {}, mainAgents: 0, subAgents: 0 };
    const byType: Record<string, { count: number; statuses: Record<string, number>; isSubagent: boolean }> = {};
    const statusCounts: Record<string, number> = {};
    let mainAgents = 0;
    let subAgents = 0;
    for (const subtask of subtasksData.subtasks) {
      const agentType = subtask.agent_type || "unassigned";
      const isSubagent = !!subtask.parent_agent_id;
      if (!byType[agentType]) byType[agentType] = { count: 0, statuses: {}, isSubagent };
      byType[agentType].count++;
      byType[agentType].statuses[subtask.status] = (byType[agentType].statuses[subtask.status] || 0) + 1;
      statusCounts[subtask.status] = (statusCounts[subtask.status] || 0) + 1;
      if (isSubagent) subAgents++; else mainAgents++;
    }
    return { byType, total: subtasksData.subtasks.length, statusCounts, mainAgents, subAgents };
  }, [subtasksData]);

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

  const uniqueAgentTypes = Object.keys(agentStats.byType).filter((t) => t !== "unassigned").length;
  const activeAgentsCount = activeSessions?.count || 0;
  const blockedCount = blockedActions?.actions?.length ?? 0;

  const activeAgentTypes = useMemo(() => {
    const types = new Set<string>();
    if (activeSessions?.active_agents) {
      for (const agent of activeSessions.active_agents) {
        if (agent.agent_type) types.add(agent.agent_type);
      }
    }
    return types;
  }, [activeSessions]);

  const successRate = useMemo(() => {
    const completed = agentStats.statusCounts.completed || 0;
    const failed = agentStats.statusCounts.failed || 0;
    const total = completed + failed;
    return total > 0 ? Math.round((completed / total) * 100) : null;
  }, [agentStats]);

  return (
    <PageContainer
      title="Agents"
      description="Subagent monitoring, statistics & safety gate"
      actions={
        <div className="flex items-center gap-2">
          {blockedCount > 0 && (
            <Badge variant="destructive" className="gap-1 text-[10px]">
              <ShieldAlert className="h-3 w-3" />
              {blockedCount} blocked
            </Badge>
          )}
          <Badge variant="outline" className="gap-1">
            <Bot className="h-3 w-3" />
            {uniqueAgentTypes} types
          </Badge>
        </div>
      }
    >
      {/* KPI Cards - Using shared PremiumKPICard component */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <PremiumKPICard
          title="Active Agents"
          value={activeAgentsCount}
          icon={<Activity className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-green-500 to-emerald-500"
          loading={activeLoading}
        />
        <PremiumKPICard
          title="Main / Sub"
          value={`${agentStats.mainAgents} / ${agentStats.subAgents}`}
          icon={<Network className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-cyan-500 to-teal-500"
          loading={subtasksLoading}
        />
        <PremiumKPICard
          title="Agent Types"
          value={uniqueAgentTypes}
          icon={<Users className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-purple-500 to-violet-600"
          loading={subtasksLoading}
        />
        <PremiumKPICard
          title="Total Subtasks"
          value={agentStats.total}
          icon={<Zap className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-amber-500 to-orange-500"
          loading={subtasksLoading}
        />
        <PremiumKPICard
          title="Success Rate"
          value={successRate !== null ? `${successRate}%` : "N/A"}
          icon={<TrendingUp className="h-4 w-4 text-white" />}
          iconGradient="bg-gradient-to-br from-blue-500 to-cyan-500"
          loading={subtasksLoading}
          trend={successRate !== null ? { value: successRate >= 80 ? 1 : successRate >= 50 ? 0 : -1, label: "overall" } : undefined}
        />
      </div>

      {/* Active Agents Section — Split into Main Agents and Subagents */}
      {(() => {
        const mainAgents = activeSessions?.active_agents?.filter(a => !a.parent_agent_id) ?? [];
        const subAgents = activeSessions?.active_agents?.filter(a => !!a.parent_agent_id) ?? [];

        return (
          <>
            {/* Main Agents */}
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500">
                  <Activity className="h-4 w-4 text-white" />
                </div>
                Main Agents
                {mainAgents.length > 0 && (
                  <Badge variant="default" className="bg-green-500 text-[10px]">
                    {mainAgents.length} running
                  </Badge>
                )}
              </h3>
              {activeLoading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[1, 2, 3].map((i) => <AgentCardSkeleton key={i} />)}
                </div>
              ) : mainAgents.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {mainAgents.map((agent, idx) => (
                    <ActiveAgentCard key={agent.subtask_id || idx} agent={agent} index={idx + 1} />
                  ))}
                </div>
              ) : (
                <Card className="glass-card">
                  <CardContent className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                    <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
                      <Users className="h-8 w-8 opacity-30" />
                    </div>
                    <p className="font-medium">No main agents currently active</p>
                    <p className="text-xs mt-1 text-muted-foreground/70">
                      Main agents appear here when top-level tasks are running
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Subagents */}
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-500">
                  <Network className="h-4 w-4 text-white" />
                </div>
                Subagents
                {subAgents.length > 0 && (
                  <Badge variant="default" className="bg-cyan-500 text-[10px]">
                    {subAgents.length} running
                  </Badge>
                )}
              </h3>
              {activeLoading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {[1, 2].map((i) => <AgentCardSkeleton key={i} />)}
                </div>
              ) : subAgents.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {subAgents.map((agent, idx) => (
                    <ActiveAgentCard key={agent.subtask_id || idx} agent={agent} index={idx + 1} />
                  ))}
                </div>
              ) : (
                <Card className="glass-card">
                  <CardContent className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                    <Network className="h-10 w-10 mb-3 opacity-20" />
                    <p className="text-sm">No subagents currently active</p>
                    <p className="text-[10px] mt-1 text-muted-foreground/70">
                      Subagents are spawned by main agents for delegated tasks
                    </p>
                  </CardContent>
                </Card>
              )}
            </div>
          </>
        );
      })()}

      {/* Charts + Agent Grid + Safety Gate */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <BarChart
          title="Top 10 Agents by Task Count"
          data={chartData}
          loading={subtasksLoading}
          height={300}
          horizontal
          barLabel="Tasks"
        />
        <AgentGrid agentStats={agentStats.byType} activeAgentTypes={activeAgentTypes} />
      </div>

      {/* Safety Gate */}
      <div className="mt-6">
        <SafetyGateSection blockedActions={blockedActions} />
      </div>

      {/* Agent Types Grid */}
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600">
            <Bot className="h-4 w-4 text-white" />
          </div>
          Agent Type Statistics
        </h3>
        {subtasksLoading ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[1, 2, 3, 4, 5, 6].map((i) => <AgentCardSkeleton key={i} />)}
          </div>
        ) : Object.keys(agentStats.byType).length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
          <Card className="glass-card">
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Bot className="h-16 w-16 mb-4 opacity-20" />
              <p>No agent data available</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Status Summary Footer */}
      <div className="mt-6">
        <Card className="glass-card">
          <CardContent className="py-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground mr-2">Status:</span>
              {Object.entries(agentStats.statusCounts).map(([status, count]) => (
                <Badge key={status} variant={getStatusBadgeVariant(status)} className="text-xs py-0.5 px-2.5">
                  {status}: {count}
                </Badge>
              ))}
              {Object.keys(agentStats.statusCounts).length === 0 && (
                <span className="text-muted-foreground text-xs">No data</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
