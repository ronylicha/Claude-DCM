"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageContainer } from "@/components/PageContainer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { KPICard } from "@/components/charts/KPICard";
import { ErrorDisplay } from "@/components/ErrorBoundary";
import apiClient, { type Project, type PaginatedResponse } from "@/lib/api-client";
import {
  FolderOpen,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ExternalLink,
  Calendar,
  FolderGit,
  Activity,
  Trash2,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type SortField = "name" | "path" | "created_at" | "updated_at";
type SortDirection = "asc" | "desc";

// Format date for display
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Format relative time
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

// Extract project name from path
function getProjectName(project: Project): string {
  if (project.name) return project.name;
  // Extract last part of path as fallback
  const parts = project.path.split("/").filter(Boolean);
  return parts[parts.length - 1] || "Unknown Project";
}

// Sort indicator component
function SortIndicator({
  field,
  currentField,
  direction,
}: {
  field: SortField;
  currentField: SortField;
  direction: SortDirection;
}) {
  if (field !== currentField) {
    return <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />;
  }
  return direction === "asc" ? (
    <ArrowUp className="ml-1 h-3 w-3" />
  ) : (
    <ArrowDown className="ml-1 h-3 w-3" />
  );
}

// Loading skeleton for table
function TableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 py-3 px-2">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-60 flex-1" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-24" />
        </div>
      ))}
    </div>
  );
}

export default function ProjectsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("updated_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const limit = 20;
  const queryClient = useQueryClient();

  // Fetch projects
  const {
    data: projectsResponse,
    isLoading,
    error,
    refetch,
  } = useQuery<PaginatedResponse<Project>, Error>({
    queryKey: ["projects", page, limit],
    queryFn: () => apiClient.getProjects(page, limit),
    staleTime: 30000,
  });

  // Memoize projects array to prevent dependency changes
  const projects = useMemo(() => projectsResponse?.data ?? [], [projectsResponse?.data]);
  const totalProjects = projectsResponse?.total || 0;
  const totalPages = projectsResponse?.totalPages || 1;

  // Memoize the "one week ago" date to avoid impure Date.now() calls during render
  const oneWeekAgo = useMemo(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date;
  }, []);

  // Filter and sort projects
  const filteredAndSortedProjects = useMemo(() => {
    let filtered = projects;

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = projects.filter(
        (project) =>
          getProjectName(project).toLowerCase().includes(query) ||
          project.path.toLowerCase().includes(query)
      );
    }

    // Apply sorting
    return [...filtered].sort((a, b) => {
      let aValue: string | number;
      let bValue: string | number;

      switch (sortField) {
        case "name":
          aValue = getProjectName(a).toLowerCase();
          bValue = getProjectName(b).toLowerCase();
          break;
        case "path":
          aValue = a.path.toLowerCase();
          bValue = b.path.toLowerCase();
          break;
        case "created_at":
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
          break;
        case "updated_at":
          aValue = new Date(a.updated_at).getTime();
          bValue = new Date(b.updated_at).getTime();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [projects, searchQuery, sortField, sortDirection]);

  // Handle sort toggle
  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  // Handle project deletion
  const handleDeleteProject = useCallback(async (project: Project) => {
    const projectName = getProjectName(project);
    const confirmed = window.confirm(
      `Delete project "${projectName}"? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeletingId(project.id);
    try {
      await apiClient.deleteProject(project.id);
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete project";
      window.alert(`Error deleting project: ${message}`);
    } finally {
      setDeletingId(null);
    }
  }, [queryClient]);

  // Calculate stats
  const recentProjectsCount = useMemo(() => {
    return projects.filter(
      (p) => new Date(p.updated_at) > oneWeekAgo
    ).length;
  }, [projects, oneWeekAgo]);

  if (error) {
    return (
      <PageContainer
        title="Projects"
        description="Manage your Claude Code projects"
      >
        <ErrorDisplay error={error} reset={() => refetch()} />
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title="Projects"
      description="Manage your Claude Code projects"
      actions={
        <Badge variant="secondary">
          {totalProjects} {totalProjects === 1 ? "project" : "projects"}
        </Badge>
      }
    >
      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-3 stagger-children">
        <KPICard
          title="Total Projects"
          value={totalProjects}
          icon={<FolderGit className="h-4 w-4" />}
          description="All registered projects"
          loading={isLoading}
          className="glass-card"
        />
        <KPICard
          title="Active This Week"
          value={recentProjectsCount}
          icon={<Activity className="h-4 w-4" />}
          description="Projects updated recently"
          loading={isLoading}
          trend={
            recentProjectsCount > 0
              ? { value: Math.round((recentProjectsCount / totalProjects) * 100), label: "of total" }
              : undefined
          }
          className="glass-card"
        />
        <KPICard
          title="Current Page"
          value={`${page} / ${totalPages}`}
          icon={<FolderOpen className="h-4 w-4" />}
          description={`Showing ${filteredAndSortedProjects.length} projects`}
          loading={isLoading}
          className="glass-card"
        />
      </div>

      {/* Projects Table */}
      <Card className="mt-6">
        <CardHeader className="border-b">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" />
              Projects List
            </CardTitle>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search projects..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6">
              <TableSkeleton />
            </div>
          ) : filteredAndSortedProjects.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <FolderOpen className="h-12 w-12 text-muted-foreground/50" />
              <h3 className="mt-4 text-lg font-semibold">No projects found</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {searchQuery
                  ? "Try adjusting your search query"
                  : "Start using Claude Code to see projects here"}
              </p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12"></TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort("name")}
                        className="flex items-center font-medium hover:text-foreground cursor-pointer"
                      >
                        Name
                        <SortIndicator
                          field="name"
                          currentField={sortField}
                          direction={sortDirection}
                        />
                      </button>
                    </TableHead>
                    <TableHead className="hidden md:table-cell">
                      <button
                        onClick={() => handleSort("path")}
                        className="flex items-center font-medium hover:text-foreground cursor-pointer"
                      >
                        Path
                        <SortIndicator
                          field="path"
                          currentField={sortField}
                          direction={sortDirection}
                        />
                      </button>
                    </TableHead>
                    <TableHead className="hidden sm:table-cell">
                      <button
                        onClick={() => handleSort("created_at")}
                        className="flex items-center font-medium hover:text-foreground cursor-pointer"
                      >
                        Created
                        <SortIndicator
                          field="created_at"
                          currentField={sortField}
                          direction={sortDirection}
                        />
                      </button>
                    </TableHead>
                    <TableHead>
                      <button
                        onClick={() => handleSort("updated_at")}
                        className="flex items-center font-medium hover:text-foreground cursor-pointer"
                      >
                        Updated
                        <SortIndicator
                          field="updated_at"
                          currentField={sortField}
                          direction={sortDirection}
                        />
                      </button>
                    </TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedProjects.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell>
                        <FolderGit className="h-5 w-5 text-muted-foreground" />
                      </TableCell>
                      <TableCell className="font-medium">
                        <Link
                          href={`/projects/${project.id}`}
                          className="hover:text-primary hover:underline cursor-pointer"
                        >
                          {getProjectName(project)}
                        </Link>
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                          {project.path}
                        </code>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Calendar className="h-3.5 w-3.5" />
                          <span title={formatDate(project.created_at)}>
                            {formatRelativeTime(project.created_at)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-sm">
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full",
                              new Date(project.updated_at) > oneWeekAgo
                                ? "bg-green-500"
                                : "bg-muted-foreground/50"
                            )}
                          />
                          <span title={formatDate(project.updated_at)}>
                            {formatRelativeTime(project.updated_at)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                          >
                            <Link href={`/projects/${project.id}`}>
                              View Details
                              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                            </Link>
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDeleteProject(project)}
                            disabled={deletingId === project.id}
                            className="h-8 w-8 p-0"
                            title={`Delete project ${getProjectName(project)}`}
                          >
                            {deletingId === project.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t px-6 py-4">
                  <p className="text-sm text-muted-foreground">
                    Showing {(page - 1) * limit + 1} to{" "}
                    {Math.min(page * limit, totalProjects)} of {totalProjects}{" "}
                    projects
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      Previous
                    </Button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum: number;
                        if (totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (page <= 3) {
                          pageNum = i + 1;
                        } else if (page >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = page - 2 + i;
                        }
                        return (
                          <Button
                            key={pageNum}
                            variant={page === pageNum ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setPage(pageNum)}
                            className="w-8"
                          >
                            {pageNum}
                          </Button>
                        );
                      })}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </PageContainer>
  );
}
