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
  type Session,
  type PaginatedResponse,
  type ProjectsResponse,
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
  FolderOpen,
  Wrench,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

const AGENT_CATEGORIES: Record<string, { color: string; bgColor: string; gradient: string }> = {
  "project-supervisor": { color: "text-[var(--dcm-agent-orchestrator)]", bgColor: "bg-[var(--dcm-agent-orchestrator)]", gradient: "from-[var(--dcm-agent-orchestrator)] to-[var(--md-sys-color-tertiary)]" },
  "tech-lead": { color: "text-[var(--dcm-agent-orchestrator)]", bgColor: "bg-[var(--dcm-agent-orchestrator)]", gradient: "from-[var(--dcm-agent-orchestrator)] to-[var(--md-sys-color-tertiary)]" },
  "impact-analyzer": { color: "text-[var(--dcm-agent-security)]", bgColor: "bg-[var(--dcm-agent-security)]", gradient: "from-[var(--dcm-agent-security)] to-[var(--dcm-zone-red)]" },
  "regression-guard": { color: "text-[var(--dcm-agent-security)]", bgColor: "bg-[var(--dcm-agent-security)]", gradient: "from-[var(--dcm-agent-security)] to-[var(--dcm-zone-red)]" },
  "security-specialist": { color: "text-[var(--dcm-agent-security)]", bgColor: "bg-[var(--dcm-agent-security)]", gradient: "from-[var(--dcm-agent-security)] to-[var(--dcm-zone-red)]" },
  "backend-laravel": { color: "text-[var(--dcm-agent-backend)]", bgColor: "bg-[var(--dcm-agent-backend)]", gradient: "from-[var(--dcm-agent-backend)] to-[var(--dcm-zone-orange)]" },
  "laravel-api": { color: "text-[var(--dcm-agent-backend)]", bgColor: "bg-[var(--dcm-agent-backend)]", gradient: "from-[var(--dcm-agent-backend)] to-[var(--dcm-zone-orange)]" },
  "database-admin": { color: "text-[var(--dcm-agent-database)]", bgColor: "bg-[var(--dcm-agent-database)]", gradient: "from-[var(--dcm-agent-database)] to-[var(--md-sys-color-secondary)]" },
  "frontend-react": { color: "text-[var(--dcm-agent-frontend)]", bgColor: "bg-[var(--dcm-agent-frontend)]", gradient: "from-[var(--dcm-agent-frontend)] to-[var(--md-sys-color-primary)]" },
  "react-refine": { color: "text-[var(--dcm-agent-frontend)]", bgColor: "bg-[var(--dcm-agent-frontend)]", gradient: "from-[var(--dcm-agent-frontend)] to-[var(--md-sys-color-primary)]" },
  "designer-ui-ux": { color: "text-[var(--dcm-agent-orchestrator)]", bgColor: "bg-[var(--dcm-agent-orchestrator)]", gradient: "from-[var(--dcm-agent-orchestrator)] to-[var(--md-sys-color-tertiary)]" },
  "react-native-dev": { color: "text-[var(--dcm-agent-frontend)]", bgColor: "bg-[var(--dcm-agent-frontend)]", gradient: "from-[var(--dcm-agent-frontend)] to-[var(--md-sys-color-primary)]" },
  "react-native-ui": { color: "text-[var(--dcm-agent-frontend)]", bgColor: "bg-[var(--dcm-agent-frontend)]", gradient: "from-[var(--dcm-agent-frontend)] to-[var(--md-sys-color-primary)]" },
  "step-orchestrator": { color: "text-[var(--dcm-agent-orchestrator)]", bgColor: "bg-[var(--dcm-agent-orchestrator)]", gradient: "from-[var(--dcm-agent-orchestrator)] to-[var(--md-sys-color-tertiary)]" },
  Explore: { color: "text-[var(--dcm-agent-testing)]", bgColor: "bg-[var(--dcm-agent-testing)]", gradient: "from-[var(--dcm-agent-testing)] to-[var(--dcm-zone-green)]" },
  "code-reviewer": { color: "text-[var(--dcm-zone-yellow)]", bgColor: "bg-[var(--dcm-zone-yellow)]", gradient: "from-[var(--dcm-zone-yellow)] to-[var(--dcm-zone-orange)]" },
  default: { color: "text-[var(--md-sys-color-on-surface-variant)]", bgColor: "bg-[var(--md-sys-color-outline)]", gradient: "from-[var(--md-sys-color-outline)] to-[var(--md-sys-color-surface-variant)]" },
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
                <Bot className="h-4 w-4 text-[var(--md-sys-color-on-primary)]" />
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
          {agent.project_name && (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-0.5 w-fit">
              <FolderOpen className="h-3 w-3" />
              <span className="truncate max-w-[180px]">{agent.project_name}</span>
            </div>
          )}
          {agent.parent_agent_id && (
            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-0.5 w-fit">
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
            <span className="font-medium text-[var(--dcm-zone-green)] flex items-center gap-1">
              <CheckCircle className="h-3 w-3" />
              {completedCount}
            </span>
          </div>
          {runningCount > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Running</span>
              <span className="font-medium text-[var(--md-sys-color-primary)] flex items-center gap-1">
                <Activity className="h-3 w-3 animate-pulse" />
                {runningCount}
              </span>
            </div>
          )}
          {failedCount > 0 && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Failed</span>
              <span className="font-medium text-[var(--dcm-zone-red)] flex items-center gap-1">
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
                  : successRate >= 80 ? "text-[var(--dcm-zone-green)]"
                  : successRate >= 50 ? "text-[var(--dcm-zone-yellow)]"
                  : "text-[var(--dcm-zone-red)]"
              )}>
                {successRate !== null ? `${successRate}%` : "—"}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700 ease-out",
                  successRate === null ? "bg-muted"
                    : successRate >= 80 ? "bg-[var(--dcm-zone-green)]"
                    : successRate >= 50 ? "bg-[var(--dcm-zone-yellow)]"
                    : "bg-[var(--dcm-zone-red)]"
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
// Agent Topology Tree — hierarchical main→sub
// ============================================
function AgentTopologyTree({
  subtasks,
}: {
  subtasks: SubtasksResponse["subtasks"];
}) {
  // Group by session_id, then by parent_agent_id to build hierarchy
  const tree = useMemo(() => {
    if (!subtasks || subtasks.length === 0) return [];

    // Group by session
    const bySession = new Map<string, typeof subtasks>();
    for (const s of subtasks) {
      const sid = (s as { session_id?: string }).session_id || s.task_list_id || "unknown";
      if (!bySession.has(sid)) bySession.set(sid, []);
      bySession.get(sid)!.push(s);
    }

    // For each session, separate main agents (no parent) from subagents
    return Array.from(bySession.entries()).map(([sessionId, tasks]) => {
      const mainAgents = tasks.filter((t) => !t.parent_agent_id);
      const subAgents = tasks.filter((t) => !!t.parent_agent_id);

      // Group subagents under their parent
      const childrenByParent = new Map<string, typeof tasks>();
      for (const sub of subAgents) {
        const pid = sub.parent_agent_id!;
        if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
        childrenByParent.get(pid)!.push(sub);
      }

      return { sessionId, mainAgents, childrenByParent, total: tasks.length };
    }).sort((a, b) => b.total - a.total).slice(0, 8);
  }, [subtasks]);

  if (tree.length === 0) {
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
          <Badge variant="outline" className="text-[10px]">
            {tree.reduce((acc, t) => acc + t.total, 0)} tasks
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4 max-h-[400px] overflow-y-auto">
          {tree.map(({ sessionId, mainAgents, childrenByParent }) => (
            <div key={sessionId} className="border border-border/50 rounded-lg p-3">
              <div className="text-[10px] text-muted-foreground font-mono mb-2 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Session {sessionId.slice(0, 12)}…
              </div>
              <div className="space-y-1.5">
                {mainAgents.map((agent) => {
                  const category = getAgentCategory(agent.agent_type || "");
                  const children = childrenByParent.get(agent.agent_id || "") || [];
                  const isRunning = agent.status === "running";

                  return (
                    <div key={agent.id}>
                      {/* Main agent node */}
                      <div className={cn(
                        "flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors",
                        isRunning ? "bg-primary/5" : "bg-muted/30"
                      )}>
                        <div className={cn(
                          "h-6 w-6 rounded-md flex items-center justify-center",
                          isRunning ? `bg-gradient-to-br ${category.gradient}` : "bg-muted"
                        )}>
                          <Bot className={cn("h-3 w-3", isRunning ? "text-[var(--md-sys-color-on-primary)]" : "text-muted-foreground")} />
                        </div>
                        <span className={cn("text-xs font-medium flex-1 truncate", category.color)}>
                          {agent.agent_type || "unknown"}
                        </span>
                        {isRunning && (
                          <div className="h-1.5 w-1.5 rounded-full dot-healthy animate-pulse" />
                        )}
                        <Badge variant="outline" className="text-[8px] py-0 px-1.5">
                          {agent.status}
                        </Badge>
                      </div>

                      {/* Subagent children */}
                      {children.length > 0 && (
                        <div className="ml-4 mt-1 space-y-1 border-l-2 border-border/30 pl-3">
                          {children.map((child) => {
                            const childCat = getAgentCategory(child.agent_type || "");
                            const childRunning = child.status === "running";
                            return (
                              <div
                                key={child.id}
                                className="flex items-center gap-2 text-xs py-1"
                              >
                                <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                                <div className={cn(
                                  "h-5 w-5 rounded flex items-center justify-center",
                                  childRunning ? `bg-gradient-to-br ${childCat.gradient}` : "bg-muted"
                                )}>
                                  <Bot className={cn("h-2.5 w-2.5", childRunning ? "text-[var(--md-sys-color-on-primary)]" : "text-muted-foreground")} />
                                </div>
                                <span className={cn("truncate flex-1", childCat.color)}>
                                  {child.agent_type || "unknown"}
                                </span>
                                {childRunning && (
                                  <div className="h-1.5 w-1.5 rounded-full dot-healthy animate-pulse" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Orphan subagents (parent not in this session's main agents) */}
                {(() => {
                  const mainIds = new Set(mainAgents.map((a) => a.agent_id));
                  const orphans = Array.from(childrenByParent.entries())
                    .filter(([pid]) => !mainIds.has(pid))
                    .flatMap(([, children]) => children);
                  if (orphans.length === 0) return null;
                  return orphans.map((child) => {
                    const childCat = getAgentCategory(child.agent_type || "");
                    return (
                      <div key={child.id} className="flex items-center gap-2 text-xs py-1 ml-4 border-l-2 border-dashed border-border/20 pl-3">
                        <ChevronRight className="h-3 w-3 text-muted-foreground/50" />
                        <div className={cn("h-5 w-5 rounded flex items-center justify-center bg-muted")}>
                          <Bot className="h-2.5 w-2.5 text-muted-foreground" />
                        </div>
                        <span className={cn("truncate flex-1", childCat.color)}>
                          {child.agent_type || "unknown"}
                        </span>
                        <Badge variant="outline" className="text-[8px] py-0 px-1.5">
                          {child.status}
                        </Badge>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          ))}
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
    <Card className="glass-card border-[var(--md-sys-color-error-container)]">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            {blockedCount > 0 ? (
              <ShieldAlert className="h-5 w-5 text-[var(--dcm-zone-red)]" />
            ) : (
              <ShieldCheck className="h-5 w-5 text-[var(--dcm-zone-green)]" />
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
          <div className="flex items-center gap-3 py-3 px-4 rounded-lg bg-[color-mix(in_srgb,var(--dcm-zone-green)_8%,transparent)] border border-[color-mix(in_srgb,var(--dcm-zone-green)_20%,transparent)]">
            <ShieldCheck className="h-8 w-8 text-[var(--dcm-zone-green)] opacity-60" />
            <div>
              <p className="text-sm font-medium text-[var(--dcm-zone-green)]">No blocked operations</p>
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
                className="flex items-start gap-3 rounded-lg border border-[color-mix(in_srgb,var(--dcm-zone-red)_20%,transparent)] bg-[color-mix(in_srgb,var(--dcm-zone-red)_6%,transparent)] px-3 py-2.5"
              >
                <ShieldAlert className="h-4 w-4 text-[var(--dcm-zone-red)] mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[var(--dcm-zone-red)] truncate">
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
    queryFn: () => apiClient.getSubtasks({ limit: 200 }),
    refetchInterval: 30000,
  });

  const { data: activeSessions, isLoading: activeLoading } = useQuery<ActiveSessionsResponse>({
    queryKey: ["active-sessions"],
    queryFn: apiClient.getActiveSessions,
    refetchInterval: 10000,
  });

  // Fetch live sessions (to show even when no subtasks are running)
  const { data: sessionsData, isLoading: sessionsLoading } = useQuery<PaginatedResponse<Session>>({
    queryKey: ["sessions-for-agents"],
    queryFn: () => apiClient.getSessions(1, 50),
    refetchInterval: 30000,
  });

  // Fetch projects for name mapping
  const { data: projectsData } = useQuery<ProjectsResponse>({
    queryKey: ["projects-for-agents"],
    queryFn: () => apiClient.getProjectsRaw(1, 100),
    staleTime: 60000,
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

  // Build project name map
  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    if (projectsData?.projects) {
      for (const p of projectsData.projects) {
        map.set(p.id, p.name || p.path.split("/").pop() || p.path);
      }
    }
    return map;
  }, [projectsData]);

  // Active sessions (ended_at === null)
  const liveSessions = useMemo(() => {
    if (!sessionsData?.data) return [];
    return sessionsData.data
      .filter((s) => s.ended_at === null)
      .map((s) => ({
        ...s,
        projectName: projectMap.get(s.project_id || "") || "Unknown Project",
      }));
  }, [sessionsData, projectMap]);

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
          icon={<Activity className="h-4 w-4 text-[var(--md-sys-color-on-primary)]" />}
          iconGradient="bg-[var(--dcm-zone-green)]"
          loading={activeLoading}
        />
        <PremiumKPICard
          title="Main / Sub"
          value={`${agentStats.mainAgents} / ${agentStats.subAgents}`}
          icon={<Network className="h-4 w-4 text-[var(--md-sys-color-on-primary)]" />}
          iconGradient="bg-[var(--md-sys-color-primary)]"
          loading={subtasksLoading}
        />
        <PremiumKPICard
          title="Agent Types"
          value={uniqueAgentTypes}
          icon={<Users className="h-4 w-4 text-[var(--md-sys-color-on-tertiary)]" />}
          iconGradient="bg-[var(--md-sys-color-tertiary)]"
          loading={subtasksLoading}
        />
        <PremiumKPICard
          title="Total Subtasks"
          value={agentStats.total}
          icon={<Zap className="h-4 w-4 text-[var(--md-sys-color-on-secondary)]" />}
          iconGradient="bg-[var(--md-sys-color-secondary)]"
          loading={subtasksLoading}
        />
        <PremiumKPICard
          title="Success Rate"
          value={successRate !== null ? `${successRate}%` : "N/A"}
          icon={<TrendingUp className="h-4 w-4 text-[var(--md-sys-color-on-primary)]" />}
          iconGradient="bg-[var(--md-sys-color-primary)]"
          loading={subtasksLoading}
          trend={successRate !== null ? { value: successRate >= 80 ? 1 : successRate >= 50 ? 0 : -1, label: "overall" } : undefined}
        />
      </div>

      {/* Active Sessions Panel — always shows live sessions */}
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-[var(--md-sys-color-primary)]">
            <FolderOpen className="h-4 w-4 text-[var(--md-sys-color-on-primary)]" />
          </div>
          Active Sessions
          {liveSessions.length > 0 && (
            <Badge variant="default" className="bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] text-[10px]">
              {liveSessions.length} live
            </Badge>
          )}
        </h3>
        {sessionsLoading ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => <AgentCardSkeleton key={i} />)}
          </div>
        ) : liveSessions.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {liveSessions.map((session) => (
              <Card key={session.id} className="glass-card hover:shadow-md transition-all duration-200">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-[var(--md-sys-color-primary)]">
                        <FolderOpen className="h-4 w-4 text-[var(--md-sys-color-on-primary)]" />
                      </div>
                      <div>
                        <span className="font-semibold text-sm truncate block max-w-[180px]" title={session.projectName}>
                          {session.projectName}
                        </span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <div className="h-1.5 w-1.5 rounded-full dot-healthy animate-pulse" />
                          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Live</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Timer className="h-3 w-3" />
                      {formatDuration(session.started_at)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Wrench className="h-3 w-3" />
                      {session.total_tools_used} tools
                    </span>
                    <span className="truncate max-w-[100px] font-mono text-[10px]" title={session.id}>
                      {session.id.slice(0, 8)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="glass-card">
            <CardContent className="flex flex-col items-center justify-center py-8 text-muted-foreground">
              <FolderOpen className="h-12 w-12 mb-3 opacity-20" />
              <p className="text-sm">No active sessions</p>
              <p className="text-[10px] mt-1 text-muted-foreground/70">
                Sessions appear here when Claude Code is running
              </p>
            </CardContent>
          </Card>
        )}
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
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-[var(--dcm-zone-green)]">
                  <Activity className="h-4 w-4 text-[var(--md-sys-color-on-primary)]" />
                </div>
                Main Agents
                {mainAgents.length > 0 && (
                  <Badge variant="default" className="bg-[var(--dcm-zone-green)] text-[var(--md-sys-color-on-primary)] text-[10px]">
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
                <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-[var(--md-sys-color-secondary)]">
                  <Network className="h-4 w-4 text-[var(--md-sys-color-on-secondary)]" />
                </div>
                Subagents
                {subAgents.length > 0 && (
                  <Badge variant="default" className="bg-[var(--md-sys-color-secondary)] text-[var(--md-sys-color-on-secondary)] text-[10px]">
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
        <AgentTopologyTree subtasks={subtasksData?.subtasks ?? []} />
      </div>

      {/* Safety Gate */}
      <div className="mt-6">
        <SafetyGateSection blockedActions={blockedActions} />
      </div>

      {/* Agent Types Grid */}
      <div className="mt-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-[var(--md-sys-color-tertiary)]">
            <Bot className="h-4 w-4 text-[var(--md-sys-color-on-tertiary)]" />
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
