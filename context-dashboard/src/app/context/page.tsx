"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart } from "@/components/charts/BarChart";
import { PieChart } from "@/components/charts/PieChart";
import { KPICard } from "@/components/charts/KPICard";
import { ErrorDisplay } from "@/components/ErrorBoundary";
import apiClient, { type AgentContextsStatsResponse } from "@/lib/api-client";
import {
  BrainCircuit, Activity, CheckCircle, XCircle, Users,
  Wrench, Clock, Layers, RefreshCw, TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

const AGENT_COLORS: Record<string, string> = {
  "backend-laravel": "#ef4444", "frontend-react": "#3b82f6", "Explore": "#8b5cf6",
  "docs-writer": "#6366f1", "explore-codebase": "#a855f7", "impact-analyzer": "#f59e0b",
  "qa-testing": "#22c55e", "supabase-backend": "#06b6d4", "tech-lead": "#7c3aed",
  "project-supervisor": "#9333ea", "react-refine": "#60a5fa", "regression-guard": "#eab308",
  "security-specialist": "#f43f5e", "database-admin": "#f97316", "devops-infra": "#14b8a6",
};

function getColor(t: string) { return AGENT_COLORS[t] || "#6b7280"; }

function relTime(d: string | null) {
  if (!d) return "N/A";
  try { return formatDistanceToNow(new Date(d), { addSuffix: true }); } catch { return d; }
}

function AgentTypesChart({ topTypes, loading }: { topTypes: AgentContextsStatsResponse["top_types"]; loading: boolean }) {
  const data = (topTypes || []).slice(0, 12).map(t => ({
    name: t.agent_type.length > 18 ? t.agent_type.slice(0, 15) + "..." : t.agent_type,
    value: t.count, color: getColor(t.agent_type),
  }));
  return <BarChart title="Agent Types Distribution" data={data} loading={loading} height={350} horizontal barLabel="Contexts" />;
}

function ToolsUsageChart({ toolsUsed, loading }: { toolsUsed: AgentContextsStatsResponse["tools_used"]; loading: boolean }) {
  const colors = ["#3b82f6","#8b5cf6","#22c55e","#f59e0b","#ef4444","#ec4899","#06b6d4","#f97316","#14b8a6","#6366f1"];
  const data = (toolsUsed || []).slice(0, 10).map((t, i) => ({ name: t.tool, value: t.usage_count, color: colors[i % colors.length] }));
  return <PieChart title="Top Tools Used by Agents" data={data} loading={loading} height={350} showLegend innerRadius={55} outerRadius={95} />;
}

function RecentActivityList({ recentActivity, loading }: { recentActivity: AgentContextsStatsResponse["recent_activity"]; loading: boolean }) {
  if (loading) return <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="flex gap-3"><Skeleton className="h-8 w-8 rounded-full shrink-0" /><div className="flex-1 space-y-1"><Skeleton className="h-4 w-3/4" /><Skeleton className="h-3 w-1/2" /></div></div>)}</div>;
  if (!recentActivity?.length) return <div className="flex flex-col items-center py-8 text-muted-foreground"><Clock className="h-10 w-10 mb-3 opacity-30" /><p>No recent activity</p></div>;

  return (
    <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
      {recentActivity.map((a, idx) => {
        const sc = a.status === "running" ? "bg-green-500 animate-pulse" : a.status === "completed" ? "bg-blue-500" : a.status === "failed" ? "bg-red-500" : "bg-gray-400";
        return (
          <div key={a.id || idx} className="flex gap-3 items-start p-3 rounded-lg border bg-card/50 hover:bg-accent/30 transition-colors">
            <div className={cn("h-2.5 w-2.5 rounded-full mt-1.5 shrink-0", sc)} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs shrink-0" style={{ borderColor: getColor(a.agent_type), color: getColor(a.agent_type) }}>{a.agent_type}</Badge>
                <span className="text-xs text-muted-foreground truncate">{a.agent_id}</span>
              </div>
              <p className="text-sm mt-1 text-foreground/80 line-clamp-2">{a.progress_summary || "No summary"}</p>
              <span className="text-[11px] text-muted-foreground mt-1 block">{relTime(a.last_updated)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TopTypesTable({ topTypes, loading }: { topTypes: AgentContextsStatsResponse["top_types"]; loading: boolean }) {
  if (loading) return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  const max = topTypes?.[0]?.count || 1;
  return (
    <div className="space-y-2">
      {(topTypes || []).slice(0, 10).map(type => (
        <div key={type.agent_type} className="flex items-center gap-3">
          <div className="w-32 truncate text-sm font-medium" title={type.agent_type}>{type.agent_type}</div>
          <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500 flex items-center justify-end pr-2"
              style={{ width: `${Math.max((type.count / max) * 100, 8)}%`, backgroundColor: getColor(type.agent_type) }}>
              <span className="text-[10px] text-white font-bold">{type.count}</span>
            </div>
          </div>
          {type.running > 0 && <Badge variant="outline" className="text-xs text-green-600 border-green-500/30 shrink-0">{type.running} active</Badge>}
        </div>
      ))}
    </div>
  );
}

export default function ContextPage() {
  const { data, isLoading, error, refetch } = useQuery<AgentContextsStatsResponse, Error>({
    queryKey: ["agent-contexts-stats"],
    queryFn: () => apiClient.getAgentContextStats(),
    refetchInterval: 30000,
  });

  const overview = data?.overview;
  const completionRate = useMemo(() => overview && overview.total_contexts > 0 ? Math.round((overview.completed_agents / overview.total_contexts) * 100) : 0, [overview]);
  const failureRate = useMemo(() => overview && overview.total_contexts > 0 ? Math.round((overview.failed_agents / overview.total_contexts) * 100) : 0, [overview]);

  if (error) return <PageContainer title="Context Dashboard" description="Agent context analytics"><ErrorDisplay error={error} reset={() => refetch()} /></PageContainer>;

  return (
    <PageContainer title="Context Dashboard" description="Monitor agent context usage, performance, and distribution"
      actions={<Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}><RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />Refresh</Button>}>

      {/* KPI Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 stagger-children">
        <KPICard title="Total Contexts" value={overview?.total_contexts ?? 0} icon={<BrainCircuit className="h-4 w-4" />} description="All agent contexts" loading={isLoading} />
        <KPICard title="Active Agents" value={overview?.active_agents ?? 0} icon={<Activity className="h-4 w-4" />} description="Currently running" loading={isLoading}
          trend={overview?.active_agents ? { value: overview.active_agents, label: "active" } : undefined} />
        <KPICard title="Completed" value={overview?.completed_agents ?? 0} icon={<CheckCircle className="h-4 w-4" />} description={`${completionRate}% completion rate`} loading={isLoading} />
        <KPICard title="Failed" value={overview?.failed_agents ?? 0} icon={<XCircle className="h-4 w-4" />} description={`${failureRate}% failure rate`} loading={isLoading} />
        <KPICard title="Agent Types" value={overview?.unique_agent_types ?? 0} icon={<Users className="h-4 w-4" />} description="Unique types used" loading={isLoading} />
        <KPICard title="Projects" value={overview?.unique_projects ?? 0} icon={<Layers className="h-4 w-4" />} description="With agent contexts" loading={isLoading} />
      </div>

      {/* Timeline */}
      {overview && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground px-1">
          <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Oldest: {relTime(overview.oldest_context)}</span>
          <span>|</span>
          <span className="flex items-center gap-1"><TrendingUp className="h-3.5 w-3.5" />Latest: {relTime(overview.newest_context)}</span>
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <AgentTypesChart topTypes={data?.top_types || []} loading={isLoading} />
        <ToolsUsageChart toolsUsed={data?.tools_used || []} loading={isLoading} />
      </div>

      {/* Bottom: Types + Activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass-card animate-fade-in">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Agent Types Breakdown</CardTitle>
            <CardDescription>Distribution of context creation by agent type</CardDescription>
          </CardHeader>
          <CardContent><TopTypesTable topTypes={data?.top_types || []} loading={isLoading} /></CardContent>
        </Card>
        <Card className="glass-card animate-fade-in">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" />Recent Activity</CardTitle>
            <CardDescription>Latest agent context changes</CardDescription>
          </CardHeader>
          <CardContent><RecentActivityList recentActivity={data?.recent_activity || []} loading={isLoading} /></CardContent>
        </Card>
      </div>

      {/* Tools Summary */}
      <Card className="glass-card animate-fade-in">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Wrench className="h-5 w-5" />Tools Usage Across Agents</CardTitle>
          <CardDescription>Most commonly used tools by all agents</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex gap-2 flex-wrap">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-8 w-24" />)}</div>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {(data?.tools_used || []).map(tool => (
                <Badge key={tool.tool} variant="secondary" className="text-sm px-3 py-1.5 font-mono">
                  {tool.tool}<span className="ml-2 text-muted-foreground font-normal">{tool.usage_count}x</span>
                </Badge>
              ))}
              {(!data?.tools_used || data.tools_used.length === 0) && <p className="text-sm text-muted-foreground">No tools usage data yet.</p>}
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
