"use client";

import { useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageContainer } from "@/components/PageContainer";
import { ProjectHeader } from "@/components/project/ProjectHeader";
import { BoardSummaryBar } from "@/components/project/BoardSummaryBar";
import { KanbanBoard } from "@/components/project/KanbanBoard";
import { EpicCreateDialog } from "@/components/project/EpicCreateDialog";
import { ErrorDisplay } from "@/components/ErrorBoundary";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectBoard } from "@/hooks/useProjectBoard";
import { useEpicMutations } from "@/hooks/useEpicMutations";

// ============================================
// Skeleton loading state
// ============================================

function ProjectPageSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6 h-full">
      {/* Header skeleton */}
      <Skeleton className="h-[104px] w-full rounded-[20px]" />
      {/* Summary bar skeleton */}
      <Skeleton className="h-[60px] w-full rounded-[12px]" />
      {/* Board skeleton — 5 columns */}
      <div className="flex gap-3 flex-1 min-h-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-2 w-[260px] shrink-0">
            <Skeleton className="h-8 w-full rounded-[8px]" />
            <Skeleton className="h-24 w-full rounded-[12px]" />
            <Skeleton className="h-16 w-full rounded-[12px]" />
            <Skeleton className="h-20 w-full rounded-[12px]" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================
// Main page
// ============================================

export default function ProjectBoardPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [epicDialogOpen, setEpicDialogOpen] = useState(false);

  const { data, isLoading, error, refetch } = useProjectBoard(projectId);
  const { transitionEpic } = useEpicMutations(projectId);

  // ── Handlers ────────────────────────────────

  const handleCreateEpic = useCallback(() => {
    setEpicDialogOpen(true);
  }, []);

  // Stub — pipeline creation will be wired later
  const handleCreatePipeline = useCallback(() => {
    console.log("Create pipeline — not yet implemented");
  }, []);

  const handleTransition = useCallback(
    (epicId: string, toStatus: string) => {
      transitionEpic.mutate({ epicId, toStatus });
    },
    [transitionEpic],
  );

  const handleEpicClick = useCallback((epicId: string) => {
    // Drawer will be added in a future iteration
    console.log("Epic clicked:", epicId);
  }, []);

  const handleEpicCreated = useCallback(() => {
    setEpicDialogOpen(false);
  }, []);

  // ── Back button (shared across states) ──────

  const backAction = (
    <Link href="/projects">
      <Button variant="outline" size="sm" aria-label="Back to projects list">
        <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
        Back to Projects
      </Button>
    </Link>
  );

  // ── Loading ──────────────────────────────────

  if (isLoading) {
    return <ProjectPageSkeleton />;
  }

  // ── Error ────────────────────────────────────

  if (error || !data) {
    return (
      <PageContainer
        title="Project Board"
        description="Error loading project"
        actions={backAction}
      >
        <ErrorDisplay
          error={(error as Error) ?? new Error("No data returned")}
          reset={() => refetch()}
        />
      </PageContainer>
    );
  }

  const { project, board, stats } = data;

  // ── Render ───────────────────────────────────

  return (
    <>
      {/* Full-height flex column — board takes all remaining space */}
      <div className="flex flex-col gap-4 p-6 h-full min-h-0">
        {/* Back link */}
        <div className="flex items-center">
          <Link href="/projects">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-[var(--md-sys-color-outline)] hover:text-[var(--md-sys-color-on-surface)] -ml-2"
              aria-label="Back to projects list"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              Projects
            </Button>
          </Link>
        </div>

        {/* Project header */}
        <ProjectHeader
          project={project}
          stats={stats}
          onCreateEpic={handleCreateEpic}
          onCreatePipeline={handleCreatePipeline}
        />

        {/* Progress summary bar */}
        <BoardSummaryBar stats={stats} board={board} />

        {/* Kanban board — flex-1 so it fills remaining height */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <KanbanBoard
            board={board}
            onTransition={handleTransition}
            onEpicClick={handleEpicClick}
          />
        </div>
      </div>

      {/* Epic creation dialog */}
      <EpicCreateDialog
        projectId={projectId}
        open={epicDialogOpen}
        onOpenChange={setEpicDialogOpen}
        onCreated={handleEpicCreated}
      />
    </>
  );
}
