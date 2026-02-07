"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ErrorDisplay } from "@/components/ErrorBoundary";
import apiClient from "@/lib/api-client";
import {
  ArrowLeft,
  Bot,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  Activity,
  TrendingUp,
} from "lucide-react";
import { useMemo } from "react";

interface Subtask {
  id: string;
  task_list_id: string;
  agent_type: string | null;
  agent_id: string | null;
  description: string;
  status: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
    completed: { variant: "default", icon: <CheckCircle className="h-3 w-3" /> },
    pending: { variant: "outline", icon: <Clock className="h-3 w-3" /> },
    running: { variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    failed: { variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
    blocked: { variant: "outline", icon: <Clock className="h-3 w-3" /> },
  };

  const { variant, icon } = config[status] || { variant: "outline" as const, icon: null };

  return (
    <Badge variant={variant} className="gap-1">
      {icon}
      {status}
    </Badge>
  );
}

export default function AgentDetailPage() {
  const params = useParams();
  const agentType = decodeURIComponent(params.id as string);

  // Fetch all subtasks for this agent type
  const { data: subtasksData, isLoading, error, refetch } = useQuery<{ subtasks: Subtask[]; count: number }>({
    queryKey: ["agent-subtasks", agentType],
    queryFn: () => apiClient.getSubtasks({ agent_type: agentType }),
    enabled: !!agentType,
  });

  const stats = useMemo(() => {
    const subtasks = subtasksData?.subtasks || [];
    const total = subtasks.length;
    const completed = subtasks.filter((s) => s.status === "completed").length;
    const failed = subtasks.filter((s) => s.status === "failed").length;
    const running = subtasks.filter((s) => s.status === "running").length;
    const pending = subtasks.filter((s) => s.status === "pending").length;

    return {
      total,
      completed,
      failed,
      running,
      pending,
      successRate: total > 0 ? ((completed / (completed + failed || 1)) * 100).toFixed(1) : "0",
    };
  }, [subtasksData]);

  if (isLoading) {
    return (
      <PageContainer
        title="Agent Details"
        description="Loading agent information..."
      >
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageContainer>
    );
  }

  if (error) {
    return (
      <PageContainer title="Agent Details" description="Error loading agent">
        <ErrorDisplay error={error as Error} reset={() => refetch()} />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title={agentType}
      description={`Agent activity and statistics`}
      actions={
        <Link href="/agents">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Agents
          </Button>
        </Link>
      }
    >
      {/* Agent Info Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            {agentType}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This agent has been used in {stats.total} subtask(s) across all projects.
          </p>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{stats.total}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <span className="text-2xl font-bold">{stats.completed}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              <span className="text-2xl font-bold">{stats.failed}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-blue-500" />
              <span className="text-2xl font-bold">{stats.successRate}%</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status Distribution */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Status Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              Pending: {stats.pending}
            </Badge>
            <Badge variant="secondary" className="gap-1">
              <Loader2 className="h-3 w-3" />
              Running: {stats.running}
            </Badge>
            <Badge variant="default" className="gap-1">
              <CheckCircle className="h-3 w-3" />
              Completed: {stats.completed}
            </Badge>
            <Badge variant="destructive" className="gap-1">
              <XCircle className="h-3 w-3" />
              Failed: {stats.failed}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Recent Tasks */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Tasks</CardTitle>
        </CardHeader>
        <CardContent>
          {!subtasksData?.subtasks?.length ? (
            <p className="text-sm text-muted-foreground">No tasks found for this agent.</p>
          ) : (
            <div className="space-y-3">
              {subtasksData.subtasks.slice(0, 20).map((subtask) => (
                <div key={subtask.id} className="flex items-start justify-between rounded-lg border p-3">
                  <div className="flex-1">
                    <p className="text-sm line-clamp-2">{subtask.description}</p>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {new Date(subtask.created_at).toLocaleString()}
                      {subtask.agent_id && (
                        <>
                          <span>•</span>
                          <code>{subtask.agent_id}</code>
                        </>
                      )}
                    </div>
                  </div>
                  <StatusBadge status={subtask.status} />
                </div>
              ))}
              {subtasksData.subtasks.length > 20 && (
                <p className="text-center text-sm text-muted-foreground">
                  And {subtasksData.subtasks.length - 20} more...
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
