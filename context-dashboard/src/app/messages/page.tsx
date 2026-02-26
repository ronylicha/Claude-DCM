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
  XCircle,
  Activity,
  Users,
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
      className={cn("glass-card animate-fade-in hover:shadow-md transition-all duration-200", isRead ? "opacity-75" : "")}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <CardContent className="pt-5 pb-4">
        {/* Top row: message type + read status */}
        <div className="flex items-start justify-between gap-3">
          <Badge
            variant="outline"
            className={cn("text-xs font-medium px-2.5 py-0.5", "bg-blue-500/15 text-blue-600 border-blue-500/30")}
          >
            {message.message_type}
          </Badge>
          <div className="flex items-center gap-1.5 shrink-0">
            <div className={cn("h-2 w-2 rounded-full", isRead ? "bg-gray-400" : "bg-green-500")} />
            <span className={cn("text-xs font-medium", isRead ? "text-gray-500" : "text-green-600")}>
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
    <Card className="glass-card">
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
          className="glass-card"
        />
        <KPICard
          title="Unread"
          value={stats?.unread ?? 0}
          icon={<Activity className="h-4 w-4" />}
          description="Not yet read by recipient"
          loading={isLoading}
          className="glass-card"
          trend={stats?.unread ? { value: stats.unread, label: "pending" } : undefined}
        />
        <KPICard
          title="Read"
          value={(stats?.total ?? 0) - (stats?.unread ?? 0)}
          icon={<CheckCircle className="h-4 w-4" />}
          description="Successfully read"
          loading={isLoading}
          className="glass-card"
        />
        <KPICard
          title="Message Types"
          value={stats?.types ?? 0}
          icon={<Users className="h-4 w-4" />}
          description="Different message types"
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
          <Card className="glass-card">
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
