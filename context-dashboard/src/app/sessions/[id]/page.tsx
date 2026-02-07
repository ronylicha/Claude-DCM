"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import apiClient, { type Request, type Task } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  Clock,
  ArrowLeft,
  FolderOpen,
  Calendar,
  Timer,
  FileText,
  CheckCircle,
  XCircle,
  Loader2,
  Play,
  ListTodo,
  Zap,
} from "lucide-react";

type SessionStatus = "active" | "completed" | "failed";

function getStatusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "active":
    case "running":
      return "default";
    case "completed":
      return "secondary";
    case "failed":
      return "destructive";
    case "pending":
      return "outline";
    default:
      return "secondary";
  }
}

function getStatusDotClass(status: string): string {
  switch (status) {
    case "completed":
      return "dot-healthy";
    case "failed":
      return "dot-error";
    case "running":
    case "active":
      return "dot-running";
    case "pending":
      return "dot-warning";
    default:
      return "bg-gray-500";
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "running":
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    case "pending":
      return <Clock className="h-4 w-4 text-yellow-500" />;
    default:
      return <Play className="h-4 w-4 text-muted-foreground" />;
  }
}

function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDateTime(dateString);
}

function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt);
  const end = endedAt ? new Date(endedAt) : new Date();
  const durationMs = end.getTime() - start.getTime();

  const seconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function TimelineSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-20 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Derive session status from requests
function deriveSessionStatus(requests: Request[]): SessionStatus {
  const hasRunning = requests.some(r => r.status === "running" || r.status === "pending");
  const hasFailed = requests.some(r => r.status === "failed");

  if (hasRunning) return "active";
  if (hasFailed) return "failed";
  return "completed";
}

// Get session time range
function getSessionTimeRange(requests: Request[]): { started_at: string; ended_at: string | null } {
  if (requests.length === 0) {
    return { started_at: new Date().toISOString(), ended_at: null };
  }

  let earliestStart = requests[0].created_at;
  let latestEnd: string | null = requests[0].completed_at;

  for (const request of requests) {
    if (new Date(request.created_at) < new Date(earliestStart)) {
      earliestStart = request.created_at;
    }
    if (request.completed_at) {
      if (!latestEnd || new Date(request.completed_at) > new Date(latestEnd)) {
        latestEnd = request.completed_at;
      }
    }
  }

  return { started_at: earliestStart, ended_at: latestEnd };
}

export default function SessionDetailPage() {
  const params = useParams();
  const sessionId = decodeURIComponent(params.id as string);

  // Fetch requests for this session
  const {
    data: requests,
    isLoading: requestsLoading,
    error: requestsError,
  } = useQuery({
    queryKey: ["requests", { session_id: sessionId }],
    queryFn: () => apiClient.getRequests({ session_id: sessionId }),
    enabled: !!sessionId,
  });

  // Fetch project details (using the first request's project_id)
  const projectId = requests?.[0]?.project_id;
  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => apiClient.getProject(projectId!),
    enabled: !!projectId,
  });

  // Fetch tasks for each request
  const requestIds = requests?.map(r => r.id) || [];
  const { data: tasks } = useQuery({
    queryKey: ["tasks", { request_ids: requestIds }],
    queryFn: async () => {
      if (!requests || requests.length === 0) return [];
      const allTasks: Task[] = [];
      for (const request of requests) {
        const requestTasks = await apiClient.getTasks({ request_id: request.id });
        allTasks.push(...requestTasks);
      }
      return allTasks;
    },
    enabled: requestIds.length > 0,
  });

  if (requestsLoading) {
    return (
      <PageContainer
        title="Session Details"
        description="Loading session information..."
      >
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="pt-6">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-32" />
              </CardContent>
            </Card>
          ))}
        </div>
        <Card className="mt-4">
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <TimelineSkeleton />
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  if (requestsError || !requests || requests.length === 0) {
    return (
      <PageContainer
        title="Session Not Found"
        description="The requested session could not be found"
        actions={
          <Link href="/sessions">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Sessions
            </Button>
          </Link>
        }
      >
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-destructive">
              {requestsError instanceof Error
                ? requestsError.message
                : "No requests found for this session"}
            </p>
          </CardContent>
        </Card>
      </PageContainer>
    );
  }

  const sessionStatus = deriveSessionStatus(requests);
  const { started_at, ended_at } = getSessionTimeRange(requests);
  const totalTasks = tasks?.length || 0;

  return (
    <PageContainer
      title={`Session: ${sessionId.length > 20 ? sessionId.slice(0, 20) + "..." : sessionId}`}
      description="View session timeline and details"
      actions={
        <div className="flex items-center gap-3">
          <Badge
            variant={getStatusBadgeVariant(sessionStatus)}
            className="text-sm py-1 px-3"
          >
            <div className={cn("h-2 w-2 rounded-full mr-2", getStatusDotClass(sessionStatus))} />
            {sessionStatus.charAt(0).toUpperCase() + sessionStatus.slice(1)}
          </Badge>
          <Link href="/sessions">
            <Button variant="outline">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Sessions
            </Button>
          </Link>
        </div>
      }
    >
      {/* Mini-KPI Stats Bar */}
      <div className="grid gap-4 md:grid-cols-3 stagger-children">
        <Card className="glass-card animate-fade-in">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Total Requests</span>
            </div>
            <p className="mt-2 text-3xl font-bold animate-count-up">
              {requests.length}
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card animate-fade-in">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Total Tasks</span>
            </div>
            <p className="mt-2 text-3xl font-bold animate-count-up">
              {totalTasks}
            </p>
          </CardContent>
        </Card>
        <Card className="glass-card animate-fade-in">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Duration</span>
            </div>
            <p className="mt-2 text-3xl font-bold animate-count-up">
              {formatDuration(started_at, ended_at)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Session Info Cards */}
      <div className="grid gap-4 md:grid-cols-3 mt-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Project</span>
            </div>
            <p className="mt-2 text-lg font-semibold truncate" title={project?.name || project?.path || "Unknown"}>
              {project?.name || project?.path || "Unknown Project"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Started</span>
            </div>
            <p className="mt-2 text-lg font-semibold">
              {formatDateTime(started_at)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Session ID</span>
            </div>
            <code className="mt-2 block text-xs font-mono text-muted-foreground truncate" title={sessionId}>
              {sessionId}
            </code>
          </CardContent>
        </Card>
      </div>

      {/* Visual Timeline */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Request Timeline
            <Badge variant="outline" className="ml-2">
              {requests.length} requests
            </Badge>
            {tasks && tasks.length > 0 && (
              <Badge variant="outline" className="ml-1">
                {tasks.length} tasks
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Request and task history for this session
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="relative pl-8">
            {/* Vertical timeline line */}
            <div className="absolute left-[11px] top-2 bottom-2 w-0.5 bg-border" />

            {/* Timeline items */}
            <div className="space-y-8">
              {requests.map((request, index) => {
                const requestTasks = tasks?.filter(t => t.request_id === request.id) || [];

                return (
                  <div
                    key={request.id}
                    className="relative animate-fade-in"
                    style={{ animationDelay: `${index * 80}ms` }}
                  >
                    {/* Dot on the timeline line */}
                    <div className="absolute -left-8 top-1 flex items-center">
                      <div
                        className={cn(
                          "h-[22px] w-[22px] rounded-full flex items-center justify-center border-2 border-background z-10",
                          getStatusDotClass(request.status)
                        )}
                      >
                        <div className="h-2 w-2 rounded-full bg-white/80" />
                      </div>
                    </div>

                    {/* Relative timestamp beside the dot */}
                    <div className="absolute -left-8 top-7 w-[22px] flex justify-center">
                      <span className="text-[9px] text-muted-foreground whitespace-nowrap">
                        {formatRelativeTime(request.created_at)}
                      </span>
                    </div>

                    {/* Request card */}
                    <div className="glass-card rounded-lg p-4 ml-2 animate-slide-in-right" style={{ animationDelay: `${index * 80 + 40}ms` }}>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">Request</span>
                        <Badge variant={getStatusBadgeVariant(request.status)}>
                          {request.status}
                        </Badge>
                        {request.prompt_type && (
                          <Badge variant="outline">{request.prompt_type}</Badge>
                        )}
                        <span className="text-xs text-muted-foreground ml-auto">
                          {formatTime(request.created_at)}
                        </span>
                      </div>
                      <div className="mt-3 rounded-md border bg-card/50 p-3">
                        <p className="text-sm whitespace-pre-wrap line-clamp-4">
                          {request.prompt || "No prompt content"}
                        </p>
                        {request.completed_at && (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Completed: {formatDateTime(request.completed_at)} ({formatRelativeTime(request.completed_at)})
                          </p>
                        )}
                      </div>

                      {/* Tasks under this request */}
                      {requestTasks.length > 0 && (
                        <div className="mt-4 ml-2 space-y-2 border-l-2 border-border/50 pl-4">
                          {requestTasks.map((task, taskIndex) => (
                            <div
                              key={task.id}
                              className="flex items-start gap-3 animate-fade-in"
                              style={{ animationDelay: `${(index * 80) + (taskIndex * 50) + 120}ms` }}
                            >
                              <div className={cn(
                                "mt-0.5 h-6 w-6 flex items-center justify-center rounded-full shrink-0",
                                task.status === "completed" && "bg-green-500/10 text-green-600",
                                task.status === "failed" && "bg-red-500/10 text-red-600",
                                task.status === "running" && "bg-blue-500/10 text-blue-600",
                                task.status === "pending" && "bg-yellow-500/10 text-yellow-600"
                              )}>
                                <FileText className="h-3 w-3" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="text-sm font-medium">
                                    {task.name || `Task Wave ${task.wave_number}`}
                                  </span>
                                  <Badge variant={getStatusBadgeVariant(task.status)} className="text-xs">
                                    {task.status}
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Wave {task.wave_number} - {formatRelativeTime(task.created_at)}
                                  {task.completed_at && ` - Done ${formatRelativeTime(task.completed_at)}`}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
