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
import apiClient, { type InterAgentMessagesResponse, type InterAgentMessage } from "@/lib/api-client";
import {
  BrainCircuit,
  Search,
  RefreshCw,
  Clock,
  CheckCircle,
  Activity,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

// Agent type color mapping using M3/DCM tokens
const AGENT_TYPE_COLORS: Record<string, { badge: string; dot: string }> = {
  "frontend-react": { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-frontend)_15%,transparent)] text-[var(--dcm-agent-frontend)] border-[color-mix(in_srgb,var(--dcm-agent-frontend)_30%,transparent)]", dot: "bg-[var(--dcm-agent-frontend)]" },
  "react-refine": { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-frontend)_10%,transparent)] text-[var(--dcm-agent-frontend)] border-[color-mix(in_srgb,var(--dcm-agent-frontend)_20%,transparent)]", dot: "bg-[var(--dcm-agent-frontend)]" },
  "backend-laravel": { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-backend)_15%,transparent)] text-[var(--dcm-agent-backend)] border-[color-mix(in_srgb,var(--dcm-agent-backend)_30%,transparent)]", dot: "bg-[var(--dcm-agent-backend)]" },
  "laravel-api": { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-backend)_10%,transparent)] text-[var(--dcm-agent-backend)] border-[color-mix(in_srgb,var(--dcm-agent-backend)_20%,transparent)]", dot: "bg-[var(--dcm-agent-backend)]" },
  "qa-testing": { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-testing)_15%,transparent)] text-[var(--dcm-agent-testing)] border-[color-mix(in_srgb,var(--dcm-agent-testing)_30%,transparent)]", dot: "bg-[var(--dcm-agent-testing)]" },
  "project-supervisor": { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-orchestrator)_15%,transparent)] text-[var(--dcm-agent-orchestrator)] border-[color-mix(in_srgb,var(--dcm-agent-orchestrator)_30%,transparent)]", dot: "bg-[var(--dcm-agent-orchestrator)]" },
  "tech-lead": { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-orchestrator)_10%,transparent)] text-[var(--dcm-agent-orchestrator)] border-[color-mix(in_srgb,var(--dcm-agent-orchestrator)_20%,transparent)]", dot: "bg-[var(--dcm-agent-orchestrator)]" },
  "impact-analyzer": { badge: "bg-[color-mix(in_srgb,var(--dcm-zone-yellow)_15%,transparent)] text-[var(--dcm-zone-yellow)] border-[color-mix(in_srgb,var(--dcm-zone-yellow)_30%,transparent)]", dot: "bg-[var(--dcm-zone-yellow)]" },
  "regression-guard": { badge: "bg-[color-mix(in_srgb,var(--dcm-zone-yellow)_10%,transparent)] text-[var(--dcm-zone-yellow)] border-[color-mix(in_srgb,var(--dcm-zone-yellow)_20%,transparent)]", dot: "bg-[var(--dcm-zone-yellow)]" },
  "security-specialist": { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-security)_15%,transparent)] text-[var(--dcm-agent-security)] border-[color-mix(in_srgb,var(--dcm-agent-security)_30%,transparent)]", dot: "bg-[var(--dcm-agent-security)]" },
  "database-admin": { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-database)_15%,transparent)] text-[var(--dcm-agent-database)] border-[color-mix(in_srgb,var(--dcm-agent-database)_30%,transparent)]", dot: "bg-[var(--dcm-agent-database)]" },
  "designer-ui-ux": { badge: "bg-[color-mix(in_srgb,var(--md-sys-color-tertiary)_15%,transparent)] text-[var(--md-sys-color-tertiary)] border-[color-mix(in_srgb,var(--md-sys-color-tertiary)_30%,transparent)]", dot: "bg-[var(--md-sys-color-tertiary)]" },
  "devops-infra": { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-devops)_15%,transparent)] text-[var(--dcm-agent-devops)] border-[color-mix(in_srgb,var(--dcm-agent-devops)_30%,transparent)]", dot: "bg-[var(--dcm-agent-devops)]" },
  "technical-writer": { badge: "bg-[color-mix(in_srgb,var(--md-sys-color-secondary)_15%,transparent)] text-[var(--md-sys-color-secondary)] border-[color-mix(in_srgb,var(--md-sys-color-secondary)_30%,transparent)]", dot: "bg-[var(--md-sys-color-secondary)]" },
  "react-native-dev": { badge: "bg-[color-mix(in_srgb,var(--md-sys-color-tertiary)_15%,transparent)] text-[var(--md-sys-color-tertiary)] border-[color-mix(in_srgb,var(--md-sys-color-tertiary)_30%,transparent)]", dot: "bg-[var(--md-sys-color-tertiary)]" },
  "react-native-ui": { badge: "bg-[color-mix(in_srgb,var(--md-sys-color-tertiary)_10%,transparent)] text-[var(--md-sys-color-tertiary)] border-[color-mix(in_srgb,var(--md-sys-color-tertiary)_20%,transparent)]", dot: "bg-[var(--md-sys-color-tertiary)]" },
  "performance-engineer": { badge: "bg-[color-mix(in_srgb,var(--dcm-zone-green)_15%,transparent)] text-[var(--dcm-zone-green)] border-[color-mix(in_srgb,var(--dcm-zone-green)_30%,transparent)]", dot: "bg-[var(--dcm-zone-green)]" },
};

const DEFAULT_AGENT_COLOR = { badge: "bg-[color-mix(in_srgb,var(--md-sys-color-outline)_15%,transparent)] text-[var(--md-sys-color-on-surface-variant)] border-[var(--md-sys-color-outline-variant)]", dot: "bg-[var(--md-sys-color-outline)]" };

function hashStringToColor(str: string | null | undefined): { badge: string; dot: string } {
  if (!str) return DEFAULT_AGENT_COLOR;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-frontend)_15%,transparent)] text-[var(--dcm-agent-frontend)] border-[color-mix(in_srgb,var(--dcm-agent-frontend)_30%,transparent)]", dot: "bg-[var(--dcm-agent-frontend)]" },
    { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-backend)_15%,transparent)] text-[var(--dcm-agent-backend)] border-[color-mix(in_srgb,var(--dcm-agent-backend)_30%,transparent)]", dot: "bg-[var(--dcm-agent-backend)]" },
    { badge: "bg-[color-mix(in_srgb,var(--dcm-zone-green)_15%,transparent)] text-[var(--dcm-zone-green)] border-[color-mix(in_srgb,var(--dcm-zone-green)_30%,transparent)]", dot: "bg-[var(--dcm-zone-green)]" },
    { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-orchestrator)_15%,transparent)] text-[var(--dcm-agent-orchestrator)] border-[color-mix(in_srgb,var(--dcm-agent-orchestrator)_30%,transparent)]", dot: "bg-[var(--dcm-agent-orchestrator)]" },
    { badge: "bg-[color-mix(in_srgb,var(--dcm-zone-yellow)_15%,transparent)] text-[var(--dcm-zone-yellow)] border-[color-mix(in_srgb,var(--dcm-zone-yellow)_30%,transparent)]", dot: "bg-[var(--dcm-zone-yellow)]" },
    { badge: "bg-[color-mix(in_srgb,var(--md-sys-color-tertiary)_15%,transparent)] text-[var(--md-sys-color-tertiary)] border-[color-mix(in_srgb,var(--md-sys-color-tertiary)_30%,transparent)]", dot: "bg-[var(--md-sys-color-tertiary)]" },
    { badge: "bg-[color-mix(in_srgb,var(--md-sys-color-secondary)_15%,transparent)] text-[var(--md-sys-color-secondary)] border-[color-mix(in_srgb,var(--md-sys-color-secondary)_30%,transparent)]", dot: "bg-[var(--md-sys-color-secondary)]" },
    { badge: "bg-[color-mix(in_srgb,var(--md-sys-color-primary)_15%,transparent)] text-[var(--md-sys-color-primary)] border-[color-mix(in_srgb,var(--md-sys-color-primary)_30%,transparent)]", dot: "bg-[var(--md-sys-color-primary)]" },
    { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-devops)_15%,transparent)] text-[var(--dcm-agent-devops)] border-[color-mix(in_srgb,var(--dcm-agent-devops)_30%,transparent)]", dot: "bg-[var(--dcm-agent-devops)]" },
    { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-database)_15%,transparent)] text-[var(--dcm-agent-database)] border-[color-mix(in_srgb,var(--dcm-agent-database)_30%,transparent)]", dot: "bg-[var(--dcm-agent-database)]" },
    { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-testing)_15%,transparent)] text-[var(--dcm-agent-testing)] border-[color-mix(in_srgb,var(--dcm-agent-testing)_30%,transparent)]", dot: "bg-[var(--dcm-agent-testing)]" },
    { badge: "bg-[color-mix(in_srgb,var(--dcm-agent-security)_15%,transparent)] text-[var(--dcm-agent-security)] border-[color-mix(in_srgb,var(--dcm-agent-security)_30%,transparent)]", dot: "bg-[var(--dcm-agent-security)]" },
  ];
  return colors[Math.abs(hash) % colors.length];
}

function getAgentTypeColor(agentType: string | null | undefined) {
  if (!agentType) return DEFAULT_AGENT_COLOR;
  return AGENT_TYPE_COLORS[agentType] || hashStringToColor(agentType);
}

// Status indicator configuration
function getStatusConfig(status: string) {
  switch (status) {
    case "running":
      return { dot: "dot-healthy animate-pulse", label: "Running", textColor: "text-[var(--dcm-zone-green)]" };
    case "completed":
      return { dot: "bg-[var(--md-sys-color-primary)]", label: "Completed", textColor: "text-[var(--md-sys-color-primary)]" };
    case "failed":
      return { dot: "dot-error", label: "Failed", textColor: "text-[var(--dcm-zone-red)]" };
    default:
      return { dot: "bg-[var(--md-sys-color-outline)]", label: status, textColor: "text-[var(--md-sys-color-on-surface-variant)]" };
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

// Message Card Component
function MessageCard({
  message,
  index,
}: {
  message: InterAgentMessage;
  index: number;
}) {
  const fromTypeColor = getAgentTypeColor(message.from_agent_id);
  const toTypeColor = getAgentTypeColor(message.to_agent_id);
  const isRead = (message.read_by?.length ?? 0) > 0;
  const payload = message.payload || {};

  return (
    <Card
      className={cn("bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] md-elevation-1 animate-fade-in hover:shadow-md transition-all duration-200", isRead ? "opacity-75" : "")}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <CardContent className="pt-5 pb-4">
        {/* Top row: message type + read status */}
        <div className="flex items-start justify-between gap-3">
          <Badge
            variant="outline"
            className={cn("text-xs font-medium px-2.5 py-0.5", "bg-[color-mix(in_srgb,var(--md-sys-color-primary)_15%,transparent)] text-[var(--md-sys-color-primary)] border-[color-mix(in_srgb,var(--md-sys-color-primary)_30%,transparent)]")}
          >
            {message.message_type}
          </Badge>
          <div className="flex items-center gap-1.5 shrink-0">
            <div className={cn("h-2 w-2 rounded-full", isRead ? "bg-[var(--md-sys-color-outline)]" : "dot-healthy")} />
            <span className={cn("text-xs font-medium", isRead ? "text-[var(--md-sys-color-on-surface-variant)]" : "text-[var(--dcm-zone-green)]")}>
              {isRead ? "Read" : "Unread"}
            </span>
          </div>
        </div>

        {/* From and To agents */}
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground">FROM</span>
            <Badge
              variant="secondary"
              className={cn("text-xs px-2 py-0.5 font-mono", fromTypeColor.badge)}
            >
              {message.from_agent_id}
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground">TO</span>
            <Badge
              variant="secondary"
              className={cn("text-xs px-2 py-0.5 font-mono", toTypeColor.badge)}
            >
              {message.to_agent_id}
            </Badge>
          </div>
        </div>

        {/* Topic */}
        {message.topic && (
          <p className="mt-3 text-xs text-muted-foreground italic">
            Topic: {message.topic}
          </p>
        )}

        {/* Message payload preview */}
        {Object.keys(payload).length > 0 && (
          <div className="mt-3 p-2 bg-muted/30 rounded text-xs font-mono text-foreground/70 line-clamp-3 break-all">
            {JSON.stringify(payload).substring(0, 150)}
            {JSON.stringify(payload).length > 150 ? "..." : ""}
          </div>
        )}

        {/* Bottom row: timestamps and expiry */}
        <div className="mt-3 pt-3 border-t border-border/50 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatRelativeTime(message.created_at)}
          </span>
          {message.expires_at && (
            <span className="text-[10px]">
              Expires {formatRelativeTime(message.expires_at)}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Loading skeleton for message cards
function MessageCardSkeleton() {
  return (
    <Card className="bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] md-elevation-1">
      <CardContent className="pt-5 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-12 w-full" />
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
  const [messageTypeFilter, setMessageTypeFilter] = useState<string>("all");
  const [readFilter, setReadFilter] = useState<string>("all");

  // Fetch inter-agent messages
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery<InterAgentMessagesResponse, Error>({
    queryKey: ["inter-agent-messages"],
    queryFn: () => apiClient.getInterAgentMessages(),
    refetchInterval: 30000,
  });

  // Extract unique message types for the dropdown
  const messageTypes = useMemo(() => {
    if (!data?.messages) return [];
    const types = new Set(data.messages.map((m) => m.message_type));
    return Array.from(types).sort();
  }, [data?.messages]);

  // Filter messages
  const filteredMessages = useMemo(() => {
    if (!data?.messages) return [];

    return data.messages.filter((msg) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesFrom = msg.from_agent_id.toLowerCase().includes(query);
        const matchesTo = msg.to_agent_id.toLowerCase().includes(query);
        const matchesTopic = (msg.topic || "").toLowerCase().includes(query);
        if (!matchesFrom && !matchesTo && !matchesTopic) return false;
      }

      // Message type filter
      if (messageTypeFilter !== "all" && msg.message_type !== messageTypeFilter) {
        return false;
      }

      // Read status filter
      if (readFilter !== "all") {
        const isRead = (msg.read_by?.length ?? 0) > 0;
        const shouldShow = readFilter === "unread" ? !isRead : isRead;
        if (!shouldShow) return false;
      }

      return true;
    });
  }, [data?.messages, searchQuery, messageTypeFilter, readFilter]);

  // Calculate stats
  const stats = useMemo(() => {
    if (!data?.messages) return { total: 0, unread: 0, types: 0, byType: [] };
    const unread = data.messages.filter((m) => (m.read_by?.length ?? 0) === 0).length;
    const uniqueTypes = new Set(data.messages.map((m) => m.message_type)).size;
    return {
      total: data.count || data.messages.length,
      unread,
      types: uniqueTypes,
      byType: messageTypes,
    };
  }, [data?.messages, data?.count, messageTypes]);

  return (
    <PageContainer
      title="Inter-Agent Messages"
      description="Communication between agents in active sessions"
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
          title="Total Messages"
          value={stats?.total ?? 0}
          icon={<BrainCircuit className="h-4 w-4" />}
          description={`${filteredMessages.length} matching filters`}
          loading={isLoading}
          className="bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] md-elevation-1"
        />
        <KPICard
          title="Unread"
          value={stats?.unread ?? 0}
          icon={<Activity className="h-4 w-4" />}
          description="Not yet read by recipient"
          loading={isLoading}
          className="bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] md-elevation-1"
          trend={stats?.unread ? { value: stats.unread, label: "pending" } : undefined}
        />
        <KPICard
          title="Read"
          value={(stats?.total ?? 0) - (stats?.unread ?? 0)}
          icon={<CheckCircle className="h-4 w-4" />}
          description="Successfully read"
          loading={isLoading}
          className="bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] md-elevation-1"
        />
        <KPICard
          title="Message Types"
          value={stats?.types ?? 0}
          icon={<Users className="h-4 w-4" />}
          description="Different message types"
          loading={isLoading}
          className="bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] md-elevation-1"
        />
      </div>

      {/* Filters */}
      <Card className="bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] md-elevation-1 animate-fade-in">
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

            {/* Message type dropdown */}
            <div className="min-w-[180px]">
              <label className="text-xs text-muted-foreground mb-1 block">Message Type</label>
              <select
                value={messageTypeFilter}
                onChange={(e) => setMessageTypeFilter(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="all">All Types ({messageTypes.length})</option>
                {messageTypes.map((type) => {
                  const count = (data?.messages || []).filter((m) => m.message_type === type).length;
                  return (
                    <option key={type} value={type}>
                      {type} ({count})
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Read status filter */}
            <div className="min-w-[140px]">
              <label className="text-xs text-muted-foreground mb-1 block">Read Status</label>
              <select
                value={readFilter}
                onChange={(e) => setReadFilter(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="all">All</option>
                <option value="unread">Unread</option>
                <option value="read">Read</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Messages Grid */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <BrainCircuit className="h-5 w-5" />
            Messages
            {filteredMessages.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {filteredMessages.length}
              </Badge>
            )}
          </h3>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <MessageCardSkeleton key={i} />
            ))}
          </div>
        ) : error ? (
          <ErrorDisplay error={error} reset={() => refetch()} />
        ) : filteredMessages.length === 0 ? (
          <Card className="bg-[var(--md-sys-color-surface-container-low)] border border-[var(--md-sys-color-outline-variant)] md-elevation-1">
            <CardContent className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <BrainCircuit className="h-14 w-14 mb-4 opacity-30" />
              <p className="text-lg font-medium">No messages found</p>
              <p className="text-sm mt-1">
                {data?.messages?.length === 0
                  ? "No inter-agent messages have been recorded yet."
                  : "Try adjusting your filters to see more results."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filteredMessages.map((message, index) => (
              <MessageCard
                key={message.id}
                message={message}
                index={index}
              />
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  );
}
