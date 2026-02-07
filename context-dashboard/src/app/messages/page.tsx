"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorDisplay } from "@/components/ErrorBoundary";
import { KPICard } from "@/components/charts/KPICard";
import apiClient, { type AgentContextsResponse, type AgentContext } from "@/lib/api-client";
import {
  BrainCircuit,
  Search,
  Filter,
  RefreshCw,
  Clock,
  CheckCircle,
  XCircle,
  Activity,
  Users,
  Layers,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// Agent type color mapping
const AGENT_TYPE_COLORS: Record<string, { badge: string; dot: string }> = {
  "frontend-react": { badge: "bg-blue-500/15 text-blue-600 border-blue-500/30", dot: "bg-blue-500" },
  "react-refine": { badge: "bg-blue-400/15 text-blue-500 border-blue-400/30", dot: "bg-blue-400" },
  "backend-laravel": { badge: "bg-red-500/15 text-red-600 border-red-500/30", dot: "bg-red-500" },
  "laravel-api": { badge: "bg-red-400/15 text-red-500 border-red-400/30", dot: "bg-red-400" },
  "qa-testing": { badge: "bg-green-500/15 text-green-600 border-green-500/30", dot: "bg-green-500" },
  "project-supervisor": { badge: "bg-purple-500/15 text-purple-600 border-purple-500/30", dot: "bg-purple-500" },
  "tech-lead": { badge: "bg-purple-400/15 text-purple-500 border-purple-400/30", dot: "bg-purple-400" },
  "impact-analyzer": { badge: "bg-amber-500/15 text-amber-600 border-amber-500/30", dot: "bg-amber-500" },
  "regression-guard": { badge: "bg-amber-400/15 text-amber-500 border-amber-400/30", dot: "bg-amber-400" },
  "security-specialist": { badge: "bg-rose-500/15 text-rose-600 border-rose-500/30", dot: "bg-rose-500" },
  "database-admin": { badge: "bg-orange-500/15 text-orange-600 border-orange-500/30", dot: "bg-orange-500" },
  "designer-ui-ux": { badge: "bg-pink-500/15 text-pink-600 border-pink-500/30", dot: "bg-pink-500" },
  "devops-infra": { badge: "bg-teal-500/15 text-teal-600 border-teal-500/30", dot: "bg-teal-500" },
  "technical-writer": { badge: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30", dot: "bg-indigo-500" },
  "react-native-dev": { badge: "bg-cyan-500/15 text-cyan-600 border-cyan-500/30", dot: "bg-cyan-500" },
  "react-native-ui": { badge: "bg-cyan-400/15 text-cyan-500 border-cyan-400/30", dot: "bg-cyan-400" },
  "performance-engineer": { badge: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", dot: "bg-emerald-500" },
};

const DEFAULT_AGENT_COLOR = { badge: "bg-gray-500/15 text-gray-600 border-gray-500/30", dot: "bg-gray-500" };

function getAgentTypeColor(agentType: string) {
  return AGENT_TYPE_COLORS[agentType] || DEFAULT_AGENT_COLOR;
}

// Status indicator configuration
function getStatusConfig(status: string) {
  switch (status) {
    case "running":
      return { dot: "bg-green-500 animate-pulse", label: "Running", textColor: "text-green-600" };
    case "completed":
      return { dot: "bg-blue-500", label: "Completed", textColor: "text-blue-600" };
    case "failed":
      return { dot: "bg-red-500", label: "Failed", textColor: "text-red-600" };
    default:
      return { dot: "bg-gray-400", label: status, textColor: "text-gray-500" };
  }
}

// Format relative time
function formatRelativeTime(dateString: string): string {
  try {
    return formatDistanceToNow(new Date(dateString), { addSuffix: true });
  } catch {
    return dateString;
  }
}

// Agent Context Card Component
function AgentContextCard({
  context,
  index,
}: {
  context: AgentContext;
  index: number;
}) {
  const typeColor = getAgentTypeColor(context.agent_type);
  const statusConfig = getStatusConfig(context.role_context?.status || "unknown");
  const toolsUsed = context.tools_used || [];
  const progressSummary = context.progress_summary || "No progress summary available";

  return (
    <Card
      className="glass-card animate-fade-in hover:shadow-md transition-all duration-200"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <CardContent className="pt-5 pb-4">
        {/* Top row: agent type badge + status */}
        <div className="flex items-start justify-between gap-3">
          <Badge
            variant="outline"
            className={cn("text-xs font-medium px-2.5 py-0.5", typeColor.badge)}
          >
            {context.agent_type}
          </Badge>
          <div className="flex items-center gap-1.5 shrink-0">
            <div className={cn("h-2 w-2 rounded-full", statusConfig.dot)} />
            <span className={cn("text-xs font-medium", statusConfig.textColor)}>
              {statusConfig.label}
            </span>
          </div>
        </div>

        {/* Agent ID */}
        <div className="mt-3 flex items-center gap-2">
          <code className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded truncate max-w-[280px]" title={context.agent_id}>
            {context.agent_id}
          </code>
        </div>

        {/* Progress Summary */}
        <p className="mt-3 text-sm text-foreground/80 line-clamp-3 leading-relaxed">
          {progressSummary}
        </p>

        {/* Task description if available */}
        {context.role_context?.task_description && (
          <p className="mt-2 text-xs text-muted-foreground italic line-clamp-2">
            Task: {context.role_context.task_description}
          </p>
        )}

        {/* Tools used badges */}
        {toolsUsed.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {toolsUsed.slice(0, 6).map((tool) => (
              <Badge
                key={tool}
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-5 font-mono"
              >
                {tool}
              </Badge>
            ))}
            {toolsUsed.length > 6 && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5">
                +{toolsUsed.length - 6}
              </Badge>
            )}
          </div>
        )}

        {/* Bottom row: timestamps */}
        <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Spawned {context.role_context?.spawned_at
              ? formatRelativeTime(context.role_context.spawned_at)
              : "unknown"}
          </span>
          <span className="flex items-center gap-1">
            Updated {formatRelativeTime(context.last_updated)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// Status filter button group
function StatusFilterBar({
  value,
  onChange,
}: {
  value: string;
  onChange: (status: string) => void;
}) {
  const statuses = [
    { value: "all", label: "All" },
    { value: "running", label: "Running", color: "text-green-500" },
    { value: "completed", label: "Completed", color: "text-blue-500" },
    { value: "failed", label: "Failed", color: "text-red-500" },
  ];

  return (
    <div className="flex items-center gap-2">
      <Filter className="h-4 w-4 text-muted-foreground" />
      <div className="flex rounded-md border">
        {statuses.map((status) => (
          <Button
            key={status.value}
            variant={value === status.value ? "default" : "ghost"}
            size="sm"
            onClick={() => onChange(status.value)}
            className={cn(
              "rounded-none first:rounded-l-md last:rounded-r-md",
              value === status.value && "pointer-events-none"
            )}
          >
            <span className={status.color}>{status.label}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

// Loading skeleton for context cards
function ContextCardSkeleton() {
  return (
    <Card className="glass-card">
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-12 w-full" />
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-5 w-14" />
          <Skeleton className="h-5 w-14" />
        </div>
        <div className="flex justify-between pt-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-20" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function MessagesPage() {
  // Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [agentTypeFilter, setAgentTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Fetch agent contexts
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery<AgentContextsResponse, Error>({
    queryKey: ["agent-contexts"],
    queryFn: () => apiClient.getAgentContexts(100, 0),
    refetchInterval: 30000,
  });

  // Extract unique agent types for the dropdown
  const agentTypes = useMemo(() => {
    if (!data?.type_distribution) return [];
    return data.type_distribution.map((td) => td.agent_type).sort();
  }, [data?.type_distribution]);

  // Filter contexts
  const filteredContexts = useMemo(() => {
    if (!data?.contexts) return [];

    return data.contexts.filter((ctx) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesAgentId = ctx.agent_id.toLowerCase().includes(query);
        const matchesSummary = (ctx.progress_summary || "").toLowerCase().includes(query);
        const matchesType = ctx.agent_type.toLowerCase().includes(query);
        if (!matchesAgentId && !matchesSummary && !matchesType) return false;
      }

      // Agent type filter
      if (agentTypeFilter !== "all" && ctx.agent_type !== agentTypeFilter) {
        return false;
      }

      // Status filter
      if (statusFilter !== "all" && ctx.role_context?.status !== statusFilter) {
        return false;
      }

      return true;
    });
  }, [data?.contexts, searchQuery, agentTypeFilter, statusFilter]);

  // KPI values
  const stats = data?.stats;

  return (
    <PageContainer
      title="Agent Contexts"
      description="Context sharing data across all agents"
      actions={
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw className={cn("h-4 w-4 mr-2", isLoading && "animate-spin")} />
          Refresh
        </Button>
      }
    >
      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 stagger-children">
        <KPICard
          title="Total Contexts"
          value={stats?.total ?? 0}
          icon={<BrainCircuit className="h-4 w-4" />}
          description={`${filteredContexts.length} matching filters`}
          loading={isLoading}
          className="glass-card"
        />
        <KPICard
          title="Active Agents"
          value={stats?.running ?? 0}
          icon={<Activity className="h-4 w-4" />}
          description="Currently running"
          loading={isLoading}
          className="glass-card"
          trend={stats?.running ? { value: stats.running, label: "active" } : undefined}
        />
        <KPICard
          title="Completed"
          value={stats?.completed ?? 0}
          icon={<CheckCircle className="h-4 w-4" />}
          description="Successfully finished"
          loading={isLoading}
          className="glass-card"
        />
        <KPICard
          title="Unique Types"
          value={stats?.unique_types ?? 0}
          icon={<Users className="h-4 w-4" />}
          description="Different agent types"
          loading={isLoading}
          className="glass-card"
        />
      </div>

      {/* Filters */}
      <Card className="glass-card animate-fade-in">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="h-4 w-4" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4 items-end">
            {/* Search */}
            <div className="flex-1 min-w-[200px] max-w-[320px]">
              <label className="text-xs text-muted-foreground mb-1 block">Search</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="agent ID, summary, or type..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>

            {/* Agent type dropdown */}
            <div className="min-w-[180px]">
              <label className="text-xs text-muted-foreground mb-1 block">Agent Type</label>
              <select
                value={agentTypeFilter}
                onChange={(e) => setAgentTypeFilter(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="all">All Types ({agentTypes.length})</option>
                {agentTypes.map((type) => {
                  const dist = data?.type_distribution?.find((td) => td.agent_type === type);
                  return (
                    <option key={type} value={type}>
                      {type} ({dist?.count ?? 0})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Status filter */}
            <StatusFilterBar value={statusFilter} onChange={setStatusFilter} />
          </div>
        </CardContent>
      </Card>

      {/* Context Cards Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Layers className="h-5 w-5" />
            Agent Contexts
            {filteredContexts.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {filteredContexts.length}
              </Badge>
            )}
          </h3>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <ContextCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <ErrorDisplay error={error} reset={() => refetch()} />
        ) : filteredContexts.length === 0 ? (
          <Card className="glass-card">
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <BrainCircuit className="h-14 w-14 mb-4 opacity-30" />
              <p className="text-lg font-medium">No agent contexts found</p>
              <p className="text-sm mt-1">
                {data?.contexts?.length === 0
                  ? "No agent context data has been recorded yet."
                  : "Try adjusting your filters to see more results."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredContexts.map((context, index) => (
              <AgentContextCard
                key={context.id}
                context={context}
                index={index}
              />
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
