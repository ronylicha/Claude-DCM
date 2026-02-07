"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DateRangeFilter, type DateRange, getDateRangeStart } from "@/components/filters/DateRangeFilter";
import { StatusFilter, type Status } from "@/components/filters/StatusFilter";
import apiClient, { type Request, type Project, type PaginatedResponse } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import {
  Clock,
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ExternalLink,
  FolderOpen,
  Calendar,
  Activity,
  Hash,
  FileText,
} from "lucide-react";

type SortField = "session_id" | "project" | "started_at" | "status";
type SortDirection = "asc" | "desc";

// Aggregated session data from requests
interface SessionData {
  session_id: string;
  project_id: string;
  projectName: string;
  started_at: string;
  ended_at: string | null;
  status: "active" | "completed" | "failed";
  request_count: number;
}

function getStatusBadgeVariant(status: SessionData["status"]): "default" | "secondary" | "destructive" {
  switch (status) {
    case "active":
      return "default";
    case "completed":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "secondary";
  }
}

function getStatusColor(status: SessionData["status"]): string {
  switch (status) {
    case "active":
      return "bg-green-500";
    case "completed":
      return "bg-blue-500";
    case "failed":
      return "bg-red-500";
    default:
      return "bg-gray-500";
  }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(startedAt: string, endedAt: string | null): string {
  const start = new Date(startedAt);
  const end = endedAt ? new Date(endedAt) : new Date();
  const durationMs = end.getTime() - start.getTime();

  const minutes = Math.floor(durationMs / 60000);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

function SortIcon({ field, currentField, direction }: {
  field: SortField;
  currentField: SortField;
  direction: SortDirection;
}) {
  if (field !== currentField) {
    return <ChevronsUpDown className="h-4 w-4 text-muted-foreground/50" />;
  }
  return direction === "asc"
    ? <ChevronUp className="h-4 w-4" />
    : <ChevronDown className="h-4 w-4" />;
}

function TableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

// Aggregate requests into sessions
function aggregateRequestsToSessions(
  requests: Request[],
  projectMap: Map<string, string>
): SessionData[] {
  const sessionsMap = new Map<string, SessionData>();

  for (const request of requests) {
    const existing = sessionsMap.get(request.session_id);

    if (!existing) {
      // Determine session status based on request statuses
      let status: SessionData["status"] = "completed";
      if (request.status === "pending" || request.status === "running") {
        status = "active";
      } else if (request.status === "failed") {
        status = "failed";
      }

      sessionsMap.set(request.session_id, {
        session_id: request.session_id,
        project_id: request.project_id,
        projectName: projectMap.get(request.project_id) || "Unknown Project",
        started_at: request.created_at,
        ended_at: request.completed_at,
        status,
        request_count: 1,
      });
    } else {
      // Update existing session with additional request info
      existing.request_count += 1;

      // Update started_at to earliest
      if (new Date(request.created_at) < new Date(existing.started_at)) {
        existing.started_at = request.created_at;
      }

      // Update ended_at to latest
      if (request.completed_at) {
        if (!existing.ended_at || new Date(request.completed_at) > new Date(existing.ended_at)) {
          existing.ended_at = request.completed_at;
        }
      }

      // Update status (active takes priority, then failed)
      if (request.status === "pending" || request.status === "running") {
        existing.status = "active";
      } else if (request.status === "failed" && existing.status !== "active") {
        existing.status = "failed";
      }
    }
  }

  return Array.from(sessionsMap.values());
}

export default function SessionsPage() {
  // Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("24h");
  const [statusFilter, setStatusFilter] = useState<Status>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");

  // Sort state
  const [sortField, setSortField] = useState<SortField>("started_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Fetch requests (which contain session_id)
  const { data: requestsData, isLoading: requestsLoading, error: requestsError } = useQuery<Request[]>({
    queryKey: ["requests"],
    queryFn: () => apiClient.getRequests(),
  });

  // Fetch projects for the filter dropdown
  const { data: projectsData } = useQuery<PaginatedResponse<Project>>({
    queryKey: ["projects-list"],
    queryFn: () => apiClient.getProjects(1, 100),
  });

  // Create a map of project IDs to names
  const projectMap = useMemo(() => {
    const map = new Map<string, string>();
    if (projectsData?.data) {
      for (const project of projectsData.data) {
        map.set(project.id, project.name || project.path);
      }
    }
    return map;
  }, [projectsData]);

  // Aggregate requests into sessions
  const sessions: SessionData[] = useMemo(() => {
    if (!requestsData) return [];
    return aggregateRequestsToSessions(requestsData, projectMap);
  }, [requestsData, projectMap]);

  // Filter and sort sessions
  const filteredSessions = useMemo(() => {
    let result = [...sessions];

    // Apply date range filter
    const dateRangeStart = getDateRangeStart(dateRange);
    result = result.filter((session) => {
      const sessionDate = new Date(session.started_at);
      return sessionDate >= dateRangeStart;
    });

    // Apply status filter
    if (statusFilter !== "all") {
      result = result.filter((session) => session.status === statusFilter);
    }

    // Apply project filter
    if (projectFilter !== "all") {
      result = result.filter((session) => session.project_id === projectFilter);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((session) =>
        session.session_id.toLowerCase().includes(query) ||
        session.projectName.toLowerCase().includes(query)
      );
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "session_id":
          comparison = a.session_id.localeCompare(b.session_id);
          break;
        case "project":
          comparison = a.projectName.localeCompare(b.projectName);
          break;
        case "started_at":
          comparison = new Date(a.started_at).getTime() - new Date(b.started_at).getTime();
          break;
        case "status":
          comparison = a.status.localeCompare(b.status);
          break;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [sessions, dateRange, statusFilter, projectFilter, searchQuery, sortField, sortDirection]);

  // Handle sort
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  // Stats
  const stats = useMemo(() => {
    return {
      total: filteredSessions.length,
      active: filteredSessions.filter((s) => s.status === "active").length,
      completed: filteredSessions.filter((s) => s.status === "completed").length,
      failed: filteredSessions.filter((s) => s.status === "failed").length,
    };
  }, [filteredSessions]);

  const uniqueProjects = useMemo((): Project[] => {
    if (!projectsData?.data) return [];
    return projectsData.data;
  }, [projectsData]);

  return (
    <PageContainer
      title="Sessions"
      description="View and manage Claude Code sessions"
    >
      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4 stagger-children">
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-muted-foreground">Total Sessions</span>
            </div>
            <p className="mt-2 text-2xl font-bold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-green-500" />
              <span className="text-sm font-medium text-muted-foreground">Active</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-green-500">{stats.active}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-blue-500" />
              <span className="text-sm font-medium text-muted-foreground">Completed</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-blue-500">{stats.completed}</p>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="pt-6">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-red-500" />
              <span className="text-sm font-medium text-muted-foreground">Failed</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-red-500">{stats.failed}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="glass-card animate-fade-in">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-center gap-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search sessions..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-64 rounded-md border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>

            {/* Project Filter */}
            <div className="flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <select
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Projects</option>
                {uniqueProjects.map((project: Project) => (
                  <option key={project.id} value={project.id}>
                    {project.name || project.path}
                  </option>
                ))}
              </select>
            </div>

            {/* Date Range */}
            <DateRangeFilter value={dateRange} onChange={setDateRange} />

            {/* Status */}
            <StatusFilter value={statusFilter} onChange={setStatusFilter} />
          </div>
        </CardContent>
      </Card>

      {/* Sessions Table */}
      <Card className="glass-card animate-fade-in">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            Sessions
            <Badge variant="outline" className="ml-2">
              {filteredSessions.length} results
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {requestsLoading ? (
            <TableSkeleton />
          ) : requestsError ? (
            <div className="py-8 text-center">
              <p className="text-destructive">Failed to load sessions</p>
              <p className="text-sm text-muted-foreground">
                {requestsError instanceof Error ? requestsError.message : "Unknown error"}
              </p>
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="py-8 text-center">
              <Clock className="h-10 w-10 mx-auto mb-3 text-muted-foreground opacity-40" />
              <p className="text-muted-foreground">No sessions found</p>
              <p className="text-sm text-muted-foreground">
                Try adjusting your filters
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <button
                        onClick={() => handleSort("session_id")}
                        className="flex items-center gap-1 hover:text-foreground"
                      >
                        Session ID
                        <SortIcon field="session_id" currentField={sortField} direction={sortDirection} />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort("project")}
                        className="flex items-center gap-1 hover:text-foreground"
                      >
                        Project
                        <SortIcon field="project" currentField={sortField} direction={sortDirection} />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort("started_at")}
                        className="flex items-center gap-1 hover:text-foreground"
                      >
                        Started At
                        <SortIcon field="started_at" currentField={sortField} direction={sortDirection} />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort("status")}
                        className="flex items-center gap-1 hover:text-foreground"
                      >
                        Status
                        <SortIcon field="status" currentField={sortField} direction={sortDirection} />
                      </button>
                    </TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Requests</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredSessions.map((session) => (
                    <TableRow key={session.session_id}>
                      <TableCell>
                        <code className="rounded bg-muted px-2 py-1 text-xs font-mono">
                          {session.session_id.length > 20
                            ? `${session.session_id.slice(0, 20)}...`
                            : session.session_id}
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FolderOpen className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium truncate max-w-[200px]" title={session.projectName}>
                            {session.projectName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          {formatDate(session.started_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className={cn("h-2 w-2 rounded-full", session.status === "active" ? "dot-healthy" : session.status === "failed" ? "dot-error" : "bg-blue-500")} />
                          <Badge variant={getStatusBadgeVariant(session.status)}>
                            {session.status}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDuration(session.started_at, session.ended_at)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <FileText className="h-4 w-4" />
                          {session.request_count}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/sessions/${encodeURIComponent(session.session_id)}`}>
                          <Button variant="outline" size="sm">
                            View Timeline
                            <ExternalLink className="ml-1 h-3 w-3" />
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
