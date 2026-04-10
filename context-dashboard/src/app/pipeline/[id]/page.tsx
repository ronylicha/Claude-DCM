'use client';

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowDown,
  GitBranch,
  CheckCircle2,
  XCircle,
  Clock,
  Pause,
  Activity,
  Play,
  Square,
  Loader2,
  Timer,
  FileText,
  Search,
  Terminal,
  Sparkles,
  Bot,
  Zap,
  Pencil,
  FolderSearch,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils';
import apiClient from '@/lib/api-client';
import type { Pipeline, PipelineStep } from '@/lib/api-client';
import { useWebSocket } from '@/hooks/useWebSocket';
import type { WSEvent } from '@/hooks/useWebSocket';
import { WaveStepper } from '@/components/pipeline/WaveStepper';
import type { WaveStepData } from '@/components/pipeline/WaveStepper';
import { StepCard } from '@/components/pipeline/StepCard';
import { SynthesisPanel } from '@/components/pipeline/SynthesisPanel';
import { SprintTimeline } from '@/components/pipeline/SprintTimeline';

// ============================================
// Status helpers
// ============================================

interface PipelineStatusStyle {
  color: string;
  bg: string;
  border: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const PIPELINE_STATUS: Record<string, PipelineStatusStyle> = {
  completed: {
    color: 'text-[var(--dcm-zone-green)]',
    bg: 'bg-[color-mix(in_srgb,var(--dcm-zone-green)_12%,transparent)]',
    border: 'border-[color-mix(in_srgb,var(--dcm-zone-green)_30%,transparent)]',
    label: 'Completed',
    icon: CheckCircle2,
  },
  running: {
    color: 'text-[var(--md-sys-color-primary)]',
    bg: 'bg-[var(--md-sys-color-primary-container)]',
    border: 'border-[var(--md-sys-color-outline-variant)]',
    label: 'Running',
    icon: Activity,
  },
  failed: {
    color: 'text-[var(--dcm-zone-red)]',
    bg: 'bg-[color-mix(in_srgb,var(--dcm-zone-red)_12%,transparent)]',
    border: 'border-[color-mix(in_srgb,var(--dcm-zone-red)_30%,transparent)]',
    label: 'Failed',
    icon: XCircle,
  },
  paused: {
    color: 'text-[var(--md-sys-color-on-surface-variant)]',
    bg: 'bg-[var(--md-sys-color-surface-container)]',
    border: 'border-[var(--md-sys-color-outline-variant)]',
    label: 'Paused',
    icon: Pause,
  },
  pending: {
    color: 'text-[var(--md-sys-color-on-surface-variant)]',
    bg: 'bg-[var(--md-sys-color-surface-container)]',
    border: 'border-[var(--md-sys-color-outline-variant)]',
    label: 'Pending',
    icon: Clock,
  },
  planning: {
    color: 'text-[var(--md-sys-color-tertiary)]',
    bg: 'bg-[color-mix(in_srgb,var(--md-sys-color-tertiary)_12%,transparent)]',
    border: 'border-[color-mix(in_srgb,var(--md-sys-color-tertiary)_30%,transparent)]',
    label: 'Planning...',
    icon: Loader2,
  },
  ready: {
    color: 'text-[var(--md-sys-color-primary)]',
    bg: 'bg-[var(--md-sys-color-primary-container)]',
    border: 'border-[var(--md-sys-color-outline-variant)]',
    label: 'Ready',
    icon: CheckCircle2,
  },
};

function getStatus(status: string): PipelineStatusStyle {
  return PIPELINE_STATUS[status] ?? PIPELINE_STATUS.pending;
}

// ============================================
// Live elapsed time hook
// ============================================

function useElapsedTime(startedAt: string | null, completedAt: string | null): string {
  const [now, setNow] = useState(Date.now());
  const isRunning = startedAt !== null && completedAt === null;

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  if (!startedAt) return '--:--';

  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : now;
  return formatDuration(end - start);
}

// ============================================
// Skeleton
// ============================================

function DetailSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading pipeline...">
      <div className="h-12 w-64 rounded-[8px] bg-[var(--md-sys-color-surface-container)] animate-pulse" />
      <div className="h-16 rounded-[12px] bg-[var(--md-sys-color-surface-container)] animate-pulse" />
      <div className="h-[80px] rounded-[12px] bg-[var(--md-sys-color-surface-container)] animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-[160px] rounded-[12px] bg-[var(--md-sys-color-surface-container)] animate-pulse" />
        ))}
      </div>
    </div>
  );
}

// ============================================
// Pipeline Control Actions
// ============================================

function PipelineControls({
  pipeline,
  onAction,
  isPending,
}: {
  pipeline: Pipeline;
  onAction: (action: 'start' | 'pause' | 'cancel') => void;
  isPending: boolean;
}) {
  const status = pipeline.status;

  return (
    <div className="flex items-center gap-2">
      {(status === 'pending' || status === 'paused') && (
        <button
          type="button"
          onClick={() => onAction('start')}
          disabled={isPending}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[12px] font-medium cursor-pointer',
            'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]',
            'hover:shadow-[var(--md-sys-elevation-1)]',
            'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'transition-all duration-200',
          )}
          aria-label="Start pipeline"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Start
        </button>
      )}

      {status === 'running' && (
        <button
          type="button"
          onClick={() => onAction('pause')}
          disabled={isPending}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[12px] font-medium cursor-pointer',
            'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface)]',
            'border border-[var(--md-sys-color-outline-variant)]',
            'hover:bg-[var(--md-sys-color-surface-container)]',
            'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'transition-all duration-200',
          )}
          aria-label="Pause pipeline"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Pause className="h-3.5 w-3.5" />}
          Pause
        </button>
      )}

      {(status === 'running' || status === 'paused' || status === 'pending') && (
        <button
          type="button"
          onClick={() => onAction('cancel')}
          disabled={isPending}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[12px] font-medium cursor-pointer',
            'text-[var(--dcm-zone-red)]',
            'border border-[color-mix(in_srgb,var(--dcm-zone-red)_30%,transparent)]',
            'hover:bg-[color-mix(in_srgb,var(--dcm-zone-red)_8%,transparent)]',
            'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            'transition-all duration-200',
          )}
          aria-label="Cancel pipeline"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          Cancel
        </button>
      )}
    </div>
  );
}

// ============================================
// Planning Live View
// ============================================

// Re-export shared event types and rendering from EventBlocks
import {
  type StreamEvent as PlanningEvent,
  groupStreamEvents as groupPlanningEvents,
  EventBlock as PlanningEventBlock,
} from '@/components/pipeline/EventBlocks';

// ============================================
// Planning Live View
// ============================================

function PlanningLiveView({ pipelineId }: { pipelineId: string }) {
  const [events, setEvents] = useState<PlanningEvent[]>([]);
  const latestIndexRef = useRef(0);
  const [isFollowing, setIsFollowing] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isFollowingRef = useRef(true);
  isFollowingRef.current = isFollowing;

  // Detect manual scroll-up → pause auto-follow
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      if (atBottom && !isFollowingRef.current) setIsFollowing(true);
      if (!atBottom && isFollowingRef.current) setIsFollowing(false);
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Poll for new chunks every 1.5s
  useEffect(() => {
    let active = true;
    const poll = async () => {
      while (active) {
        try {
          const data = await apiClient.getPlanningOutput(pipelineId, latestIndexRef.current);
          if (data.count > 0 && active) {
            const incoming = data.chunks.map((c) => {
              try {
                return JSON.parse(c.chunk) as PlanningEvent;
              } catch {
                return { kind: 'text', content: c.chunk } as PlanningEvent;
              }
            });
            setEvents((prev) => [...prev, ...incoming]);
            latestIndexRef.current = data.latest_index + 1;
            if (isFollowingRef.current && scrollRef.current) {
              requestAnimationFrame(() => {
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
              });
            }
          }
        } catch {
          // ignore polling errors
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
    };
    poll();
    return () => { active = false; };
  }, [pipelineId]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollToBottom = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    setIsFollowing(true);
  };

  const grouped = useMemo(() => groupPlanningEvents(events), [events]);

  return (
    <div
      className={cn(
        'rounded-[16px] overflow-hidden flex flex-col',
        'bg-[var(--md-sys-color-surface-container)]',
        'border border-[color-mix(in_srgb,var(--md-sys-color-tertiary)_20%,transparent)]',
        'h-[calc(100vh-12rem)]',
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-[var(--md-sys-color-outline-variant)] shrink-0">
        <Loader2 className="h-5 w-5 text-[var(--md-sys-color-tertiary)] animate-spin" />
        <div className="flex-1 min-w-0">
          <h3 className="text-[14px] font-semibold text-[var(--md-sys-color-on-surface)]">
            Generating execution plan...
          </h3>
          <p className="text-[11px] text-[var(--md-sys-color-outline)]">
            LLM is analyzing your instructions and documents
          </p>
        </div>
        <div className="text-[11px] tabular-nums text-[var(--md-sys-color-outline)]">
          {events.length} event{events.length > 1 ? 's' : ''}
        </div>
      </div>

      {/* Event blocks */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollRef}
          className={cn(
            'absolute inset-0 p-4 overflow-y-auto',
            'bg-[var(--md-sys-color-surface)]',
            'space-y-2',
          )}
        >
          {grouped.length === 0 && (
            <div className="flex items-center justify-center h-full gap-2 text-[13px] text-[var(--md-sys-color-outline)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Waiting for LLM output...
            </div>
          )}
          {grouped.map((group, i) => (
            <PlanningEventBlock key={i} group={group} />
          ))}
        </div>

        {/* "Back to live" floating button */}
        {!isFollowing && (
          <button
            type="button"
            onClick={scrollToBottom}
            className={cn(
              'absolute bottom-4 right-4 flex items-center gap-1.5',
              'px-3 py-1.5 rounded-full text-[11px] font-medium cursor-pointer',
              'bg-[var(--md-sys-color-tertiary)] text-[var(--md-sys-color-on-tertiary)]',
              'shadow-lg hover:brightness-110 transition-all duration-200',
            )}
          >
            <ArrowDown className="h-3 w-3" />
            Live
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================
// Pipeline Detail Page
// ============================================

export default function PipelineDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pipelineId = params.id as string;

  const [selectedWave, setSelectedWave] = useState<number>(0);
  const [controlPending, setControlPending] = useState(false);
  const initialWaveSet = useRef(false);

  // Fetch pipeline data
  const {
    data: pipelineData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['pipeline', pipelineId],
    queryFn: () => apiClient.getPipeline(pipelineId),
    refetchInterval: (query) => {
      const pipeline = query.state.data?.pipeline;
      if (!pipeline) return 5000;
      const isActive = pipeline.status === 'running' || pipeline.status === 'pending' || pipeline.status === 'planning';
      return isActive ? 3000 : false;
    },
  });

  // Fetch sprints data
  const { data: sprintsData } = useQuery({
    queryKey: ['pipeline-sprints', pipelineId],
    queryFn: () => apiClient.getPipelineSprints(pipelineId),
    refetchInterval: () => {
      const p = pipelineData?.pipeline;
      if (!p) return 5000;
      return (p.status === 'running' || p.status === 'pending' || p.status === 'planning') ? 5000 : false;
    },
    enabled: !!pipelineData,
  });

  const pipeline = pipelineData?.pipeline ?? null;
  const allSteps = pipelineData?.steps ?? [];

  // Auto-select current wave when data first arrives
  useEffect(() => {
    if (pipeline && !initialWaveSet.current) {
      setSelectedWave(pipeline.current_wave);
      initialWaveSet.current = true;
    }
  }, [pipeline]);

  // Handle wave selection with smooth scroll
  const handleSelectWave = useCallback((waveNumber: number) => {
    setSelectedWave(waveNumber);
    document.getElementById(`wave-${waveNumber}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // WebSocket for real-time updates
  const handleWSEvent = useCallback(
    (event: WSEvent) => {
      const eventStr = event.event as string;
      if (
        eventStr === 'pipeline.step.updated' ||
        eventStr === 'pipeline.completed' ||
        eventStr === 'pipeline.step.completed' ||
        eventStr === 'pipeline.step.failed' ||
        eventStr === 'pipeline.ready' ||
        eventStr === 'pipeline.planning' ||
        eventStr === 'pipeline.planning.fallback' ||
        eventStr === 'pipeline.failed'
      ) {
        const data = event.data as Record<string, unknown> | null;
        if (data && data.pipeline_id === pipelineId) {
          queryClient.invalidateQueries({ queryKey: ['pipeline', pipelineId] });
          queryClient.invalidateQueries({ queryKey: ['pipeline-steps', pipelineId] });
        }
      }
      if (eventStr === 'pipeline.sprint.completed' || eventStr === 'pipeline.sprint.started') {
        const data = event.data as Record<string, unknown> | null;
        if (data && data.pipeline_id === pipelineId) {
          queryClient.invalidateQueries({ queryKey: ['pipeline-sprints', pipelineId] });
        }
      }
    },
    [pipelineId, queryClient],
  );

  useWebSocket({
    channels: ['pipelines', `pipeline/${pipelineId}`],
    onEvent: handleWSEvent,
  });

  // Build wave stepper data
  const waveStepperData = useMemo((): WaveStepData[] => {
    if (!allSteps.length) return [];

    const waveMap = new Map<number, PipelineStep[]>();
    for (const step of allSteps) {
      const existing = waveMap.get(step.wave_number);
      if (existing) {
        existing.push(step);
      } else {
        waveMap.set(step.wave_number, [step]);
      }
    }

    const waves: WaveStepData[] = [];
    const sortedWaveNumbers = [...waveMap.keys()].sort((a, b) => a - b);

    for (const wn of sortedWaveNumbers) {
      const steps = waveMap.get(wn)!;
      const allCompleted = steps.every((s) => s.status === 'completed');
      const anyFailed = steps.some((s) => s.status === 'failed');
      const anyRunning = steps.some((s) => s.status === 'running');

      let status: WaveStepData['status'] = 'pending';
      if (allCompleted) status = 'completed';
      else if (anyFailed) status = 'failed';
      else if (anyRunning) status = 'running';

      waves.push({
        waveNumber: wn,
        status,
        stepCount: steps.length,
      });
    }

    return waves;
  }, [allSteps]);

  // Elapsed time
  const elapsed = useElapsedTime(pipeline?.started_at ?? null, pipeline?.completed_at ?? null);

  // Control actions
  const handleControl = useCallback(
    async (action: 'start' | 'pause' | 'cancel') => {
      if (!pipeline) return;
      setControlPending(true);
      try {
        await apiClient.controlPipeline(pipeline.id, action);
        queryClient.invalidateQueries({ queryKey: ['pipeline', pipelineId] });
      } finally {
        setControlPending(false);
      }
    },
    [pipeline, pipelineId, queryClient],
  );

  const isTerminal = pipeline?.status === 'completed' || pipeline?.status === 'failed';

  if (isLoading) return <DetailSkeleton />;

  if (error || !pipeline) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => router.push('/pipeline')}
          className={cn(
            'flex items-center gap-1.5 text-[13px] cursor-pointer',
            'text-[var(--md-sys-color-primary)]',
            'hover:text-[var(--md-sys-color-on-primary-container)]',
            'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
            'rounded-[4px] px-1',
          )}
          aria-label="Back to pipelines"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Pipelines
        </button>
        <div
          className={cn(
            'flex flex-col items-center justify-center py-16 rounded-[16px]',
            'bg-[color-mix(in_srgb,var(--dcm-zone-red)_6%,transparent)]',
            'border border-[color-mix(in_srgb,var(--dcm-zone-red)_20%,transparent)]',
          )}
        >
          <p className="text-[14px] text-[var(--dcm-zone-red)] font-medium">
            Pipeline not found
          </p>
          <p className="text-[12px] text-[var(--md-sys-color-outline)] mt-1">
            This pipeline may have been deleted or the ID is invalid.
          </p>
        </div>
      </div>
    );
  }

  const statusStyle = getStatus(pipeline.status);
  const StatusIcon = statusStyle.icon;

  return (
    <div className="space-y-6">
      {/* Back link */}
      <button
        type="button"
        onClick={() => router.push('/pipeline')}
        className={cn(
          'flex items-center gap-1.5 text-[13px] cursor-pointer',
          'text-[var(--md-sys-color-primary)]',
          'hover:text-[var(--md-sys-color-on-primary-container)]',
          'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
          'rounded-[4px] px-1',
        )}
        aria-label="Back to pipelines"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Pipelines
      </button>

      {/* Pipeline header */}
      <div
        className={cn(
          'rounded-[16px] p-5',
          'bg-[var(--md-sys-color-surface-container)]',
          'border border-[var(--md-sys-color-outline-variant)]',
        )}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded-[12px] shrink-0',
                'bg-[var(--md-sys-color-primary-container)]',
              )}
            >
              <GitBranch
                className="h-5 w-5 text-[var(--md-sys-color-on-primary-container)]"
                aria-hidden="true"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-[20px] font-semibold text-[var(--md-sys-color-on-surface)] truncate">
                {pipeline.name ?? `Pipeline ${pipeline.id.slice(0, 8)}`}
              </h1>
              <div className="flex items-center gap-3 mt-0.5">
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border',
                    statusStyle.color,
                    statusStyle.bg,
                    statusStyle.border,
                  )}
                >
                  <StatusIcon
                    className={cn('h-3 w-3', pipeline.status === 'running' && 'animate-pulse')}
                    aria-hidden="true"
                  />
                  {statusStyle.label}
                </span>
                <span className="flex items-center gap-1 text-[12px] text-[var(--md-sys-color-outline)] tabular-nums">
                  <Timer className="h-3.5 w-3.5" aria-hidden="true" />
                  {elapsed}
                </span>
              </div>
            </div>
          </div>

          {!isTerminal && (
            <PipelineControls
              pipeline={pipeline}
              onAction={handleControl}
              isPending={controlPending}
            />
          )}
        </div>
      </div>

      {/* Planning — live LLM output */}
      {pipeline.status === 'planning' && (
        <PlanningLiveView pipelineId={pipelineId} />
      )}

      {/* Wave stepper */}
      {waveStepperData.length > 0 && (
        <div
          className={cn(
            'rounded-[16px] p-4',
            'bg-[var(--md-sys-color-surface-container)]',
            'border border-[var(--md-sys-color-outline-variant)]',
          )}
        >
          <h2 className="text-[13px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-3">
            Waves
          </h2>
          <WaveStepper
            waves={waveStepperData}
            selectedWave={selectedWave}
            onSelectWave={handleSelectWave}
          />
        </div>
      )}

      {/* Sprint Timeline */}
      {sprintsData && sprintsData.sprints.length > 0 && (
        <SprintTimeline sprints={sprintsData.sprints} />
      )}

      {/* All waves — full pipeline visualization */}
      <div className="space-y-6">
        {waveStepperData.map((wave) => {
          const waveSteps = allSteps
            .filter((s) => s.wave_number === wave.waveNumber)
            .sort((a, b) => a.step_order - b.step_order);

          const isCurrentWave = pipeline.current_wave === wave.waveNumber;
          const isSelected = selectedWave === wave.waveNumber;

          return (
            <div
              key={wave.waveNumber}
              id={`wave-${wave.waveNumber}`}
              className={cn(
                'rounded-[16px] overflow-hidden transition-all duration-300',
                'border',
                isSelected
                  ? 'border-[var(--md-sys-color-primary)] shadow-[var(--md-sys-elevation-1)]'
                  : 'border-[var(--md-sys-color-outline-variant)]',
                isCurrentWave && pipeline.status === 'running'
                  ? 'bg-[color-mix(in_srgb,var(--md-sys-color-primary)_3%,var(--md-sys-color-surface-container))]'
                  : 'bg-[var(--md-sys-color-surface-container)]',
              )}
            >
              {/* Wave header */}
              <button
                type="button"
                onClick={() => handleSelectWave(wave.waveNumber)}
                className={cn(
                  'w-full flex items-center justify-between px-4 py-3 cursor-pointer',
                  'hover:bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_4%,transparent)]',
                  'transition-colors duration-200',
                )}
              >
                <div className="flex items-center gap-3">
                  {/* Wave number badge */}
                  <div
                    className={cn(
                      'flex items-center justify-center w-7 h-7 rounded-full text-[12px] font-bold',
                      wave.status === 'completed' &&
                        'bg-[var(--dcm-zone-green)] text-white',
                      wave.status === 'running' &&
                        'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] animate-pulse',
                      wave.status === 'failed' &&
                        'bg-[var(--dcm-zone-red)] text-white',
                      wave.status === 'pending' &&
                        'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)] border border-[var(--md-sys-color-outline-variant)]',
                    )}
                  >
                    {wave.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : wave.status === 'failed' ? (
                      <XCircle className="h-4 w-4" />
                    ) : (
                      wave.waveNumber
                    )}
                  </div>
                  <div className="text-left">
                    <span className="text-[13px] font-medium text-[var(--md-sys-color-on-surface)]">
                      Wave {wave.waveNumber}
                    </span>
                    <span className="text-[11px] text-[var(--md-sys-color-outline)] ml-2">
                      {wave.stepCount} step{(wave.stepCount ?? 0) > 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
                {isCurrentWave && pipeline.status === 'running' && (
                  <span className="text-[10px] font-medium text-[var(--md-sys-color-primary)] uppercase tracking-wider">
                    Active
                  </span>
                )}
              </button>

              {/* Steps grid — always visible */}
              <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                {waveSteps.map((step) => (
                  <StepCard key={step.id} step={step} pipelineId={pipelineId} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Synthesis panel (terminal state only) */}
      {isTerminal && pipeline.synthesis && (
        <SynthesisPanel pipeline={pipeline} steps={allSteps} />
      )}

      {/* Synthesis panel fallback: show stats even without synthesis data */}
      {isTerminal && !pipeline.synthesis && allSteps.length > 0 && (
        <SynthesisPanel pipeline={pipeline} steps={allSteps} />
      )}
    </div>
  );
}
