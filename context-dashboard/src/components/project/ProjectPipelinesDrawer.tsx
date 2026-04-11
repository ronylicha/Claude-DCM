'use client';

import { useEffect, useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  X,
  GitBranch,
  ExternalLink,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronRight,
  Folder,
  Inbox,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import apiClient, {
  type PipelineSummary,
  type PipelineStep,
} from '@/lib/api-client';

// ============================================
// Types / helpers (shared naming with mini card)
// ============================================

const STEP_STATUS_COLOR: Record<string, string> = {
  pending:   'text-gray-400 bg-gray-500/10',
  queued:    'text-sky-500 bg-sky-500/10',
  running:   'text-blue-500 bg-blue-500/10',
  completed: 'text-emerald-500 bg-emerald-500/10',
  failed:    'text-red-500 bg-red-500/10',
  cancelled: 'text-gray-500 bg-gray-500/10',
};

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    case 'failed':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 text-blue-500 animate-spin" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-sky-500" />;
  }
}

// ============================================
// Props
// ============================================

interface ProjectPipelinesDrawerProps {
  open: boolean;
  onClose: () => void;
  pipelines: PipelineSummary[];
}

export function ProjectPipelinesDrawer({
  open,
  onClose,
  pipelines,
}: ProjectPipelinesDrawerProps) {
  // Active pipelines first, then the rest. Pre-select the most active one.
  const sorted = useMemo(() => {
    const score = (p: PipelineSummary): number => {
      if (p.status === 'running') return 0;
      if (p.status === 'planning') return 1;
      if (p.status === 'ready') return 2;
      if (p.status === 'failed') return 3;
      if (p.status === 'completed') return 4;
      return 5;
    };
    return [...pipelines].sort((a, b) => score(a) - score(b));
  }, [pipelines]);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (sorted.length === 0) {
      setSelectedId(null);
      return;
    }
    // Keep selection if still present, else pick the top sorted one
    setSelectedId((prev) => {
      if (prev && sorted.some((p) => p.id === prev)) return prev;
      return sorted[0]?.id ?? null;
    });
  }, [open, sorted]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const selected = sorted.find((p) => p.id === selectedId) ?? null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Project pipelines drawer"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className={cn(
          'relative w-full max-w-[880px] h-full flex',
          'bg-[var(--md-sys-color-surface)] border-l border-[var(--md-sys-color-outline-variant)]',
          'shadow-2xl',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sidebar — pipeline list */}
        <aside className="w-[260px] shrink-0 flex flex-col border-r border-[var(--md-sys-color-outline-variant)]">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--md-sys-color-outline-variant)]">
            <div className="flex items-center gap-2 min-w-0">
              <GitBranch className="h-4 w-4 text-[var(--md-sys-color-on-surface-variant)]" />
              <h2 className="text-[13px] font-semibold text-[var(--md-sys-color-on-surface)]">
                Pipelines ({pipelines.length})
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-full hover:bg-[var(--md-sys-color-surface-container-high)]"
              aria-label="Close drawer"
            >
              <X className="h-4 w-4 text-[var(--md-sys-color-on-surface-variant)]" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {sorted.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-[var(--md-sys-color-outline)]">
                <Inbox className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-[11px]">No pipelines</p>
              </div>
            )}
            {sorted.map((p) => {
              const isSelected = p.id === selectedId;
              const total = p.total_steps ?? 0;
              const done = p.completed_steps ?? 0;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    'w-full text-left px-3 py-2 rounded-[8px] mb-1',
                    'border transition-colors',
                    isSelected
                      ? 'bg-[var(--md-sys-color-surface-container-high)] border-[var(--md-sys-color-primary)]'
                      : 'border-transparent hover:bg-[var(--md-sys-color-surface-container)]',
                  )}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span
                      className={cn(
                        'text-[11px] font-semibold truncate',
                        'text-[var(--md-sys-color-on-surface)]',
                      )}
                      title={p.name ?? undefined}
                    >
                      {p.name ?? `Pipeline ${p.id.slice(0, 8)}`}
                    </span>
                    <ChevronRight className="h-3 w-3 text-[var(--md-sys-color-outline)] shrink-0" />
                  </div>
                  <div className="flex items-center justify-between text-[9px] text-[var(--md-sys-color-on-surface-variant)]">
                    <span
                      className={cn(
                        'px-1.5 py-0.5 rounded-full uppercase tracking-wider font-semibold',
                        p.status === 'running'
                          ? 'text-blue-500 bg-blue-500/10'
                          : p.status === 'completed'
                            ? 'text-emerald-500 bg-emerald-500/10'
                            : p.status === 'failed'
                              ? 'text-red-500 bg-red-500/10'
                              : 'text-gray-500 bg-gray-500/10',
                      )}
                    >
                      {p.status}
                    </span>
                    {total > 0 && (
                      <span className="font-mono">
                        {done}/{total} ({pct}%)
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Main — selected pipeline detail */}
        <main className="flex-1 flex flex-col min-w-0">
          {selected ? (
            <PipelineDetailPanel pipeline={selected} />
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--md-sys-color-outline)] text-[12px]">
              Select a pipeline
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ============================================
// Inline detail panel — loads steps on demand
// ============================================

function PipelineDetailPanel({ pipeline }: { pipeline: PipelineSummary }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['pipeline-detail', pipeline.id],
    queryFn: () => apiClient.getPipeline(pipeline.id),
    // Refresh actively while the pipeline is running so the drawer reflects
    // live progress without a manual reload.
    refetchInterval:
      pipeline.status === 'running' || pipeline.status === 'planning' ? 3000 : false,
  });

  const steps = data?.steps ?? [];
  const grouped = useMemo(() => {
    const byWave: Record<number, PipelineStep[]> = {};
    for (const s of steps) {
      if (!byWave[s.wave_number]) byWave[s.wave_number] = [];
      byWave[s.wave_number]!.push(s);
    }
    return Object.entries(byWave)
      .map(([w, arr]) => ({
        wave: Number(w),
        steps: arr.sort((a, b) => a.step_order - b.step_order),
      }))
      .sort((a, b) => a.wave - b.wave);
  }, [steps]);

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--md-sys-color-outline-variant)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[15px] font-semibold text-[var(--md-sys-color-on-surface)] truncate">
              {pipeline.name ?? `Pipeline ${pipeline.id.slice(0, 8)}`}
            </h3>
            <span
              className={cn(
                'px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider',
                pipeline.status === 'running'
                  ? 'text-blue-500 bg-blue-500/10'
                  : pipeline.status === 'completed'
                    ? 'text-emerald-500 bg-emerald-500/10'
                    : pipeline.status === 'failed'
                      ? 'text-red-500 bg-red-500/10'
                      : 'text-gray-500 bg-gray-500/10',
              )}
            >
              {pipeline.status}
            </span>
          </div>
          {pipeline.workspace_path && (
            <p className="text-[10px] text-[var(--md-sys-color-outline)] mt-0.5 inline-flex items-center gap-1">
              <Folder className="h-3 w-3" />
              <code className="font-mono">{pipeline.workspace_path}</code>
            </p>
          )}
        </div>
        <Link
          href={`/pipeline/${pipeline.id}`}
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[8px]',
            'text-[11px] font-semibold',
            'text-[var(--md-sys-color-primary)]',
            'hover:bg-[var(--md-sys-color-primary)]/10',
          )}
        >
          Open full view
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {isLoading && (
          <div className="flex items-center justify-center py-8 text-[var(--md-sys-color-outline)]">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="text-[12px]">Loading steps…</span>
          </div>
        )}

        {error && (
          <div className="py-6 text-center text-[12px] text-red-500">
            Failed to load pipeline details
          </div>
        )}

        {!isLoading && !error && grouped.length === 0 && (
          <div className="py-8 text-center text-[11px] text-[var(--md-sys-color-outline)]">
            No steps yet. Approve tasks in the epic chat to populate this pipeline.
          </div>
        )}

        {grouped.map(({ wave, steps: waveSteps }) => (
          <div key={wave} className="mb-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)]">
                Wave {wave}
              </span>
              <span className="flex-1 h-px bg-[var(--md-sys-color-outline-variant)]" />
              <span className="text-[10px] text-[var(--md-sys-color-outline)]">
                {waveSteps.filter((s) => s.status === 'completed').length}/{waveSteps.length}
              </span>
            </div>
            <ul className="flex flex-col gap-1.5">
              {waveSteps.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    'flex items-start gap-2 p-2 rounded-[8px]',
                    'bg-[var(--md-sys-color-surface-container)]',
                    'border border-[var(--md-sys-color-outline-variant)]',
                  )}
                >
                  <StepIcon status={s.status} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[12px] font-semibold text-[var(--md-sys-color-on-surface)]">
                        {s.agent_type}
                      </span>
                      <span
                        className={cn(
                          'text-[9px] px-1.5 py-0.5 rounded-full uppercase font-semibold',
                          STEP_STATUS_COLOR[s.status] ?? 'text-gray-500 bg-gray-500/10',
                        )}
                      >
                        {s.status}
                      </span>
                      {s.retry_count > 0 && (
                        <span className="text-[9px] text-[var(--md-sys-color-outline)]">
                          retry {s.retry_count}
                        </span>
                      )}
                    </div>
                    {s.description && (
                      <p className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] mt-0.5 line-clamp-2">
                        {s.description}
                      </p>
                    )}
                    {s.error && (
                      <p className="text-[10px] text-red-500/80 mt-0.5 font-mono line-clamp-1">
                        {s.error}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
