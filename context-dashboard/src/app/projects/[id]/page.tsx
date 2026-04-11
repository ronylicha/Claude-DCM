"use client";

import { useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { PageContainer } from "@/components/PageContainer";
import { ProjectHeader } from "@/components/project/ProjectHeader";
import { BoardSummaryBar } from "@/components/project/BoardSummaryBar";
import { KanbanBoard } from "@/components/project/KanbanBoard";
import { EpicCreateDialog } from "@/components/project/EpicCreateDialog";
import { ProjectPipelinesSection } from "@/components/project/ProjectPipelinesSection";
import { ProjectPipelinesDrawer } from "@/components/project/ProjectPipelinesDrawer";
import { EpicSessionPanel } from "@/components/epic-session/EpicSessionPanel";
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
  const [sessionEpicId, setSessionEpicId] = useState<string | null>(null);
  const [pipelinesDrawerOpen, setPipelinesDrawerOpen] = useState(false);
  const [analyzeStatus, setAnalyzeStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const analyzeAbortRef = useRef<AbortController | null>(null);

  const { data, isLoading, error, refetch } = useProjectBoard(projectId);
  const { transitionEpic } = useEpicMutations(projectId);

  // Find the epic being brainstormed (for the session panel)
  const sessionEpic = sessionEpicId
    ? Object.values(data?.board ?? {}).flat().find((e) => e.id === sessionEpicId)
    : null;

  // Derive analyzeStatus from project metadata when data is loaded
  const metadataAnalyzeStatus = data?.project?.metadata?.analyze_status as string | undefined;
  const effectiveAnalyzeStatus: 'idle' | 'running' | 'done' | 'error' =
    analyzeStatus === 'running' || metadataAnalyzeStatus === 'running'
      ? 'running'
      : metadataAnalyzeStatus === 'done'
        ? 'done'
        : metadataAnalyzeStatus === 'error'
          ? 'error'
          : analyzeStatus;

  // ── Handlers ────────────────────────────────

  const handleCreateEpic = useCallback(() => {
    // Open epic chat directly — creates epic + session in one call
    setSessionEpicId('new');
  }, []);

  const handleCreatePipeline = useCallback(() => {
    console.log("Create pipeline — not yet implemented");
  }, []);

  const handleStartSession = useCallback((epicId: string) => {
    setSessionEpicId(epicId);
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

  const handleAnalyze = useCallback(async () => {
    if (analyzeStatus === 'running') return;
    setAnalyzeStatus('running');

    try {
      const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3847';
      await fetch(`${API_BASE_URL}/api/projects/${projectId}/analyze`, { method: 'POST' });
      // Analysis runs in background — poll for completion
      const poll = setInterval(async () => {
        const res = await refetch();
        const meta = res.data?.project?.metadata as Record<string, unknown> | undefined;
        const s = meta?.analyze_status as string | undefined;
        if (s === 'done') {
          setAnalyzeStatus('done');
          clearInterval(poll);
        } else if (s === 'error') {
          setAnalyzeStatus('error');
          clearInterval(poll);
        }
      }, 3000);
      // Safety timeout
      setTimeout(() => clearInterval(poll), 300000);
    } catch {
      setAnalyzeStatus('error');
    }
  }, [analyzeStatus, projectId, refetch]);

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

  const { project, board, stats, pipelines = [] } = data;

  // ── Render ───────────────────────────────────

  return (
    <>
      {/* Scrollable project page */}
      <div className="flex flex-col gap-4 p-6 min-h-full">
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
          onAnalyze={handleAnalyze}
          analyzeStatus={effectiveAnalyzeStatus}
          onOpenPipelines={() => setPipelinesDrawerOpen(true)}
        />

        {/* Progress summary bar */}
        <BoardSummaryBar stats={stats} board={board} />

        {/* Kanban board */}
        <div>
          <KanbanBoard
            board={board}
            onTransition={handleTransition}
            onEpicClick={handleEpicClick}
            onStartSession={handleStartSession}
          />
        </div>

        {/* Pipelines section — linked to approved epic tasks */}
        <ProjectPipelinesSection
          pipelines={pipelines}
          onExpand={() => setPipelinesDrawerOpen(true)}
        />
      </div>

      {/* Pipelines drawer — deeper detail with per-step live view */}
      <ProjectPipelinesDrawer
        open={pipelinesDrawerOpen}
        onClose={() => setPipelinesDrawerOpen(false)}
        pipelines={pipelines}
      />

      {/* Epic creation dialog */}
      <EpicCreateDialog
        projectId={projectId}
        open={epicDialogOpen}
        onOpenChange={setEpicDialogOpen}
        onCreated={handleEpicCreated}
      />

      {/* Claude brainstorm session panel */}
      {sessionEpicId && (
        <EpicSessionPanel
          epicId={sessionEpicId}
          epicTitle={sessionEpic?.title ?? "Epic"}
          projectId={projectId}
          open={!!sessionEpicId}
          onClose={() => setSessionEpicId(null)}
        />
      )}
    </>
  );
}
