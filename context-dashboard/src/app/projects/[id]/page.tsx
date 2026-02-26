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
import apiClient, { type HierarchyResponse } from "@/lib/api-client";
import {
  ArrowLeft,
  Folder,
  Calendar,
  Clock,
  GitBranch,
  CheckCircle,
  XCircle,
  Loader2,
  FileText,
  ListTodo,
} from "lucide-react";

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }> = {
    completed: { variant: "default", icon: <CheckCircle className="h-3 w-3" /> },
    active: { variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    pending: { variant: "outline", icon: <Clock className="h-3 w-3" /> },
    running: { variant: "secondary", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    failed: { variant: "destructive", icon: <XCircle className="h-3 w-3" /> },
  };

  const { variant, icon } = config[status] || { variant: "outline" as const, icon: null };

  return (
    <Badge variant={variant} className="gap-1">
      {icon}
      {status}
    </Badge>
  );
}

export default function ProjectDetailPage() {
  const params = useParams();
  const projectId = params.id as string;

  const { data, isLoading, error, refetch } = useQuery<HierarchyResponse>({
    queryKey: ["project-hierarchy", projectId],
    queryFn: () => apiClient.getHierarchy(projectId),
    enabled: !!projectId,
    refetchInterval: 5000,
  });

  if (isLoading) {
    return (
      <PageContainer
        title="Project Details"
        description="Loading project information..."
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
      <PageContainer title="Project Details" description="Error loading project">
        <ErrorDisplay error={error as Error} reset={() => refetch()} />
      </PageContainer>
    );
  }

  const project = data?.hierarchy;
  const counts = data?.counts;

  return (
    <PageContainer
      title={project?.name || "Project Details"}
      description={project?.path || ""}
      actions={
        <Link href="/projects">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Projects
          </Button>
        </Link>
      }
    >
      {/* Project Info Card */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Folder className="h-5 w-5" />
            Project Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-sm text-muted-foreground">Path</p>
              <code className="text-sm">{project?.path}</code>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Created</p>
              <p className="flex items-center gap-1 text-sm">
                <Calendar className="h-4 w-4" />
                {project?.created_at ? new Date(project.created_at).toLocaleDateString() : "-"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Last Updated</p>
              <p className="flex items-center gap-1 text-sm">
                <Clock className="h-4 w-4" />
                {project?.updated_at ? new Date(project.updated_at).toLocaleDateString() : "-"}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">ID</p>
              <code className="text-xs">{project?.id}</code>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{counts?.requests || 0}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <GitBranch className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{counts?.tasks || 0}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Subtasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              <ListTodo className="h-4 w-4 text-muted-foreground" />
              <span className="text-2xl font-bold">{counts?.subtasks || 0}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Requests List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Requests ({project?.requests?.length || 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!project?.requests?.length ? (
            <p className="text-sm text-muted-foreground">No requests found for this project.</p>
          ) : (
            <div className="space-y-4">
              {project.requests.map((request) => (
                <div key={request.id} className="rounded-lg border p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={request.status} />
                      {request.prompt_type && (
                        <Badge variant="outline">{request.prompt_type}</Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(request.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mb-2 text-sm line-clamp-2">{request.prompt}</p>
                  <div className="text-xs text-muted-foreground">
                    Session: <code>{request.session_id}</code>
                  </div>

                  {/* Tasks under this request */}
                  {request.tasks?.length > 0 && (
                    <div className="mt-3 space-y-2 border-t pt-3">
                      <p className="text-xs font-medium text-muted-foreground">
                        Tasks ({request.tasks.length}):
                      </p>
                      {request.tasks.map((task) => (
                        <div key={task.id} className="ml-4 rounded border-l-2 border-blue-500 pl-3 py-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              Wave {task.wave_number}
                            </Badge>
                            <StatusBadge status={task.status} />
                            <span className="text-xs">{task.name || "Unnamed task"}</span>
                          </div>
                          {task.subtasks?.length > 0 && (
                            <div className="mt-1 ml-4 text-xs text-muted-foreground">
                              {task.subtasks.length} subtask(s):{" "}
                              {task.subtasks.slice(0, 3).map((st, i) => (
                                <span key={st.id}>
                                  {i > 0 && ", "}
                                  {st.agent_type || "unknown"}
                                </span>
                              ))}
                              {task.subtasks.length > 3 && ` +${task.subtasks.length - 3} more`}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
