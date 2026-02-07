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
import { DateRangeFilter, getDateRangeStart, type DateRange } from "@/components/filters/DateRangeFilter";
import apiClient, { type InterAgentMessage, type InterAgentMessagesResponse } from "@/lib/api-client";
import {
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Search,
  Filter,
  RefreshCw,
  Info,
  HelpCircle,
  Bell,
  MessageCircle,
  Clock,
  CheckCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Message type configuration with colors and icons
const MESSAGE_TYPE_CONFIG: Record<
  InterAgentMessage["message_type"],
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Info; bubbleColor: string }
> = {
  info: { label: "Info", variant: "secondary", icon: Info, bubbleColor: "bg-muted" },
  request: { label: "Request", variant: "default", icon: HelpCircle, bubbleColor: "bg-primary/10" },
  response: { label: "Response", variant: "outline", icon: MessageCircle, bubbleColor: "bg-green-500/10" },
  notification: { label: "Notification", variant: "destructive", icon: Bell, bubbleColor: "bg-destructive/10" },
};

// Generate a consistent color from agent name for the avatar
function getAgentAvatarColor(agentId: string): string {
  const colors = [
    "bg-blue-500", "bg-purple-500", "bg-green-500", "bg-orange-500",
    "bg-pink-500", "bg-cyan-500", "bg-amber-500", "bg-red-500",
    "bg-indigo-500", "bg-teal-500", "bg-emerald-500", "bg-violet-500",
  ];
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) {
    hash = agentId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

// Get initials from agent ID
function getAgentInitials(agentId: string): string {
  const parts = agentId.split("-").filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return agentId.slice(0, 2).toUpperCase();
}

// Format relative time for messages
function formatMessageTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMin / 60);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Chat bubble component
function ChatBubble({
  message,
  isExpanded,
  onToggle,
  index,
}: {
  message: InterAgentMessage;
  isExpanded: boolean;
  onToggle: () => void;
  index: number;
}) {
  const typeConfig = MESSAGE_TYPE_CONFIG[message.message_type];
  const TypeIcon = typeConfig.icon;
  const isRead = message.read_by.length > 0;
  const hasPayload = Object.keys(message.payload).length > 0;

  // Determine alignment: messages from sender go left, responses go right
  const isResponse = message.message_type === "response";
  const avatarAgent = isResponse ? message.to_agent_id : message.from_agent_id;
  const avatarColor = getAgentAvatarColor(avatarAgent);
  const initials = getAgentInitials(avatarAgent);

  return (
    <div
      className={cn(
        "flex gap-3 max-w-[85%] animate-slide-in-right",
        isResponse ? "ml-auto flex-row-reverse" : "mr-auto"
      )}
      style={{ animationDelay: `${index * 30}ms` }}
    >
      {/* Avatar */}
      <div
        className={cn(
          "h-9 w-9 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0",
          avatarColor
        )}
        title={avatarAgent}
      >
        {initials}
      </div>

      {/* Bubble */}
      <div className="flex-1 min-w-0">
        {/* Agent names and direction */}
        <div className={cn(
          "flex items-center gap-1.5 mb-1 text-xs text-muted-foreground",
          isResponse ? "justify-end" : "justify-start"
        )}>
          <span className="font-medium text-foreground">{message.from_agent_id}</span>
          <span>-&gt;</span>
          <span className="font-medium text-foreground">{message.to_agent_id}</span>
        </div>

        {/* Message bubble */}
        <div
          className={cn(
            "rounded-2xl px-4 py-3 cursor-pointer transition-all duration-200 hover:shadow-md",
            typeConfig.bubbleColor,
            isResponse ? "rounded-tr-sm" : "rounded-tl-sm",
            isExpanded && "ring-1 ring-primary/20"
          )}
          onClick={onToggle}
        >
          {/* Type badge and topic */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant={typeConfig.variant} className="gap-1 text-[10px] py-0 h-5">
              <TypeIcon className="h-2.5 w-2.5" />
              {typeConfig.label}
            </Badge>
            <code className="text-xs text-primary font-medium">{message.topic}</code>
            {!isRead && (
              <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" />
            )}
            {hasPayload && (
              <span className="ml-auto text-muted-foreground">
                {isExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </span>
            )}
          </div>

          {/* Expanded payload */}
          {isExpanded && hasPayload && (
            <div className="mt-2 animate-fade-in">
              <pre className="text-xs bg-background/80 p-3 rounded-lg overflow-auto max-h-60 border border-border/50">
                {JSON.stringify(message.payload, null, 2)}
              </pre>
              {message.read_by.length > 0 && (
                <div className="mt-1.5 text-[10px] text-muted-foreground flex items-center gap-1">
                  <CheckCircle className="h-2.5 w-2.5" />
                  Read by: {message.read_by.join(", ")}
                </div>
              )}
              {message.expires_at && (
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  Expires: {new Date(message.expires_at).toLocaleString()}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div className={cn(
          "flex items-center gap-1 mt-1 text-[10px] text-muted-foreground",
          isResponse ? "justify-end" : "justify-start"
        )}>
          <Clock className="h-2.5 w-2.5" />
          {formatMessageTime(message.created_at)}
          {isRead && (
            <CheckCircle className="h-2.5 w-2.5 text-green-500 ml-1" />
          )}
        </div>
      </div>
    </div>
  );
}

// Message type filter component
function MessageTypeFilter({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (type: string | null) => void;
}) {
  const types = [
    { value: null, label: "All" },
    ...Object.entries(MESSAGE_TYPE_CONFIG).map(([key, config]) => ({
      value: key,
      label: config.label,
    })),
  ];

  return (
    <div className="flex items-center gap-2">
      <Filter className="h-4 w-4 text-muted-foreground" />
      <div className="flex rounded-md border">
        {types.map((type) => (
          <Button
            key={type.label}
            variant={value === type.value ? "default" : "ghost"}
            size="sm"
            onClick={() => onChange(type.value)}
            className={cn(
              "rounded-none first:rounded-l-md last:rounded-r-md",
              value === type.value && "pointer-events-none"
            )}
          >
            {type.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

// Loading skeleton for chat
function ChatSkeleton() {
  return (
    <div className="space-y-6 p-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className={cn("flex gap-3", i % 2 === 0 ? "max-w-[75%]" : "max-w-[75%] ml-auto flex-row-reverse")}
        >
          <Skeleton className="h-9 w-9 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className={cn("h-16 rounded-2xl", i % 2 === 0 ? "rounded-tl-sm" : "rounded-tr-sm")} />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function MessagesPage() {
  // Filter states
  const [searchTopic, setSearchTopic] = useState("");
  const [messageTypeFilter, setMessageTypeFilter] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>("");
  const [dateRange, setDateRange] = useState<DateRange>("24h");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // Fetch messages
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery<InterAgentMessagesResponse, Error>({
    queryKey: ["inter-agent-messages"],
    queryFn: () => apiClient.getInterAgentMessages("all"),
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Extract unique agents for the filter dropdown
  const uniqueAgents = useMemo(() => {
    if (!data?.messages) return [];
    const agents = new Set<string>();
    data.messages.forEach((msg) => {
      agents.add(msg.from_agent_id);
      agents.add(msg.to_agent_id);
    });
    return Array.from(agents).sort();
  }, [data?.messages]);

  // Extract unique topics for autocomplete
  const uniqueTopics = useMemo(() => {
    if (!data?.messages) return [];
    const topics = new Set<string>();
    data.messages.forEach((msg) => topics.add(msg.topic));
    return Array.from(topics).sort();
  }, [data?.messages]);

  // Filter messages
  const filteredMessages = useMemo(() => {
    if (!data?.messages) return [];
    const dateStart = getDateRangeStart(dateRange);

    return data.messages.filter((msg) => {
      // Date filter
      if (new Date(msg.created_at) < dateStart) return false;

      // Topic search
      if (searchTopic && !msg.topic.toLowerCase().includes(searchTopic.toLowerCase())) {
        return false;
      }

      // Message type filter
      if (messageTypeFilter && msg.message_type !== messageTypeFilter) {
        return false;
      }

      // Agent filter (matches from or to)
      if (agentFilter) {
        const agentLower = agentFilter.toLowerCase();
        if (
          !msg.from_agent_id.toLowerCase().includes(agentLower) &&
          !msg.to_agent_id.toLowerCase().includes(agentLower)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [data?.messages, searchTopic, messageTypeFilter, agentFilter, dateRange]);

  // Toggle row expansion
  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Stats
  const stats = useMemo(() => {
    const messages = data?.messages || [];
    return {
      total: messages.length,
      unread: messages.filter((m) => m.read_by.length === 0).length,
      requests: messages.filter((m) => m.message_type === "request").length,
      responses: messages.filter((m) => m.message_type === "response").length,
    };
  }, [data?.messages]);

  return (
    <PageContainer
      title="Messages"
      description="Inter-agent message flow and communication"
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
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4 stagger-children">
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Messages</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold animate-count-up">{stats.total}</div>
            <p className="text-xs text-muted-foreground">
              {filteredMessages.length} matching filters
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Unread</CardTitle>
            <Bell className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold animate-count-up">{stats.unread}</div>
            <p className="text-xs text-muted-foreground">Pending review</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Requests</CardTitle>
            <HelpCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold animate-count-up">{stats.requests}</div>
            <p className="text-xs text-muted-foreground">Agent requests</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Responses</CardTitle>
            <MessageCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold animate-count-up">{stats.responses}</div>
            <p className="text-xs text-muted-foreground">Completed exchanges</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {/* Topic search */}
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by topic..."
                value={searchTopic}
                onChange={(e) => setSearchTopic(e.target.value)}
                className="w-[200px]"
                list="topic-suggestions"
              />
              <datalist id="topic-suggestions">
                {uniqueTopics.slice(0, 10).map((topic) => (
                  <option key={topic} value={topic} />
                ))}
              </datalist>
            </div>

            {/* Agent filter */}
            <div className="flex items-center gap-2">
              <Input
                placeholder="Filter by agent..."
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="w-[180px]"
                list="agent-suggestions"
              />
              <datalist id="agent-suggestions">
                {uniqueAgents.slice(0, 20).map((agent) => (
                  <option key={agent} value={agent} />
                ))}
              </datalist>
            </div>

            {/* Message type filter */}
            <MessageTypeFilter
              value={messageTypeFilter}
              onChange={setMessageTypeFilter}
            />

            {/* Date range filter */}
            <DateRangeFilter value={dateRange} onChange={setDateRange} />
          </div>
        </CardContent>
      </Card>

      {/* Chat-like Message Flow */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Message Flow
            {filteredMessages.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {filteredMessages.length} messages
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <ChatSkeleton />
          ) : error ? (
            <ErrorDisplay error={error} reset={() => refetch()} />
          ) : filteredMessages.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-medium">No messages found</p>
              <p className="text-sm">
                {data?.messages?.length === 0
                  ? "No inter-agent messages have been recorded yet."
                  : "Try adjusting your filters to see more results."}
              </p>
            </div>
          ) : (
            <div className="space-y-5 py-2">
              {filteredMessages.map((message, index) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  isExpanded={expandedRows.has(message.id)}
                  onToggle={() => toggleRow(message.id)}
                  index={index}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
