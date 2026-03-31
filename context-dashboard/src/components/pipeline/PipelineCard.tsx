'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clock,
  XCircle,
  Pause,
  Play,
  Square,
  Activity,
  Timer,
  Loader2,
  MoreVertical,
  Trash2,
  RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils';
import type { Pipeline } from '@/lib/api-client';

// ============================================
// Status config
// ============================================

interface StatusStyle {
  color: string;
  bg: string;
  border: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STATUS_MAP: Record<string, StatusStyle> = {
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

function getStatusStyle(status: string): StatusStyle {
  return STATUS_MAP[status] ?? STATUS_MAP.pending;
}

// ============================================
// Helpers
// ============================================

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  const days = Math.floor(diffMs / 86_400_000);
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
  });
}

function computeDurationMs(pipeline: Pipeline): number | null {
  if (pipeline.completed_at && pipeline.started_at) {
    return new Date(pipeline.completed_at).getTime() - new Date(pipeline.started_at).getTime();
  }
  if (pipeline.started_at) {
    return Date.now() - new Date(pipeline.started_at).getTime();
  }
  return null;
}

// ============================================
// WaveProgressDots
// ============================================

function WaveProgressDots({ currentWave, status }: { currentWave: number; status: string }) {
  const totalDots = Math.max(currentWave + 1, 1);
  const maxDisplay = 10;
  const displayCount = Math.min(totalDots, maxDisplay);

  return (
    <div className="flex items-center gap-1" aria-label={`Wave ${currentWave}, status: ${status}`}>
      {Array.from({ length: displayCount }, (_, i) => {
        const isCompleted = i < currentWave;
        const isCurrent = i === currentWave;
        const isFailed = isCurrent && status === 'failed';
        return (
          <span
            key={i}
            className={cn(
              'w-1.5 h-1.5 rounded-full transition-colors duration-200',
              isCompleted && 'bg-[var(--dcm-zone-green)]',
              isCurrent && !isFailed && 'bg-[var(--md-sys-color-primary)]',
              isFailed && 'bg-[var(--dcm-zone-red)]',
              !isCompleted && !isCurrent && 'bg-[var(--md-sys-color-outline-variant)]',
            )}
          />
        );
      })}
      {totalDots > maxDisplay && (
        <span className="text-[10px] text-[var(--md-sys-color-outline)] ml-0.5">
          +{totalDots - maxDisplay}
        </span>
      )}
    </div>
  );
}

// ============================================
// PipelineCard
// ============================================

interface PipelineCardProps {
  pipeline: Pipeline;
}

export function PipelineCard({ pipeline }: PipelineCardProps) {
  const style = getStatusStyle(pipeline.status);
  const StatusIcon = style.icon;
  const durationMs = computeDurationMs(pipeline);
  const isRunning = pipeline.status === 'running';
  const [showActions, setShowActions] = useState(false);
  const queryClient = useQueryClient();

  const actionMutation = useMutation({
    mutationFn: async (action: string) => {
      const { default: api } = await import('@/lib/api-client');
      if (action === 'delete') return api.deletePipeline(pipeline.id);
      if (action === 'retry-planning') return api.retryPlanning(pipeline.id);
      return api.controlPipeline(pipeline.id, action as 'start' | 'pause' | 'cancel');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      setShowActions(false);
    },
  });

  const status = pipeline.status;

  return (
    <div
      className={cn(
        'relative rounded-[16px] p-4',
        'bg-[var(--md-sys-color-surface-container)]',
        'border border-[var(--md-sys-color-outline-variant)]',
        'transition-all duration-200',
        'hover:bg-[var(--md-sys-color-surface-container-high)]',
        'hover:shadow-[var(--md-sys-elevation-1)]',
        isRunning && 'border-l-2 border-l-[var(--md-sys-color-primary)]',
      )}
    >
      <Link
        href={`/pipeline/${pipeline.id}`}
        className="block cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)] rounded-[8px]"
        aria-label={`Pipeline: ${pipeline.name ?? pipeline.id.slice(0, 8)}`}
      >
        {/* Row 1: Name + Status */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-[14px] font-medium text-[var(--md-sys-color-on-surface)] leading-tight truncate flex-1">
            {pipeline.name ?? `Pipeline ${pipeline.id.slice(0, 8)}`}
          </h3>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border shrink-0',
              style.color, style.bg, style.border,
            )}
          >
            <StatusIcon className={cn('h-3 w-3', (isRunning || status === 'planning') && 'animate-pulse')} aria-hidden="true" />
            {style.label}
          </span>
        </div>

        {/* Row 2: Wave progress */}
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] text-[var(--md-sys-color-outline)] uppercase tracking-wider">
            Wave {pipeline.current_wave}
          </span>
          <WaveProgressDots currentWave={pipeline.current_wave} status={pipeline.status} />
        </div>

        {/* Row 3: Meta info */}
        <div className="flex items-center gap-4 text-[11px] text-[var(--md-sys-color-outline)]">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {formatRelativeTime(pipeline.created_at)}
          </span>
          {durationMs !== null && (
            <span className="flex items-center gap-1">
              <Timer className="h-3 w-3" aria-hidden="true" />
              {formatDuration(durationMs)}
            </span>
          )}
        </div>
      </Link>

      {/* Action menu button */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setShowActions(!showActions); }}
        className={cn(
          'absolute top-3 right-3 p-1.5 rounded-full cursor-pointer',
          'text-[var(--md-sys-color-outline)]',
          'hover:bg-[var(--md-sys-color-surface-container-high)]',
          'transition-colors duration-150',
        )}
        aria-label="Pipeline actions"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {/* Action dropdown */}
      {showActions && (
        <div
          className={cn(
            'absolute top-10 right-3 z-10 w-44 rounded-[8px] py-1 shadow-lg',
            'bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)]',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {(status === 'ready' || status === 'paused') && (
            <ActionButton icon={Play} label="Start" onClick={() => actionMutation.mutate('start')} disabled={actionMutation.isPending} />
          )}
          {status === 'running' && (
            <ActionButton icon={Pause} label="Pause" onClick={() => actionMutation.mutate('pause')} disabled={actionMutation.isPending} />
          )}
          {(status === 'running' || status === 'paused' || status === 'ready') && (
            <ActionButton icon={Square} label="Cancel" onClick={() => actionMutation.mutate('cancel')} disabled={actionMutation.isPending} />
          )}
          {(status === 'planning' || status === 'failed') && (
            <ActionButton icon={RefreshCw} label="Retry Planning" onClick={() => actionMutation.mutate('retry-planning')} disabled={actionMutation.isPending} />
          )}
          <div className="h-px mx-2 my-1 bg-[var(--md-sys-color-outline-variant)]" />
          <ActionButton icon={Trash2} label="Delete" onClick={() => actionMutation.mutate('delete')} disabled={actionMutation.isPending} danger />
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, disabled, danger }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 text-left text-[12px] cursor-pointer',
        'transition-colors duration-150',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        danger
          ? 'text-[var(--dcm-zone-red)] hover:bg-[color-mix(in_srgb,var(--dcm-zone-red)_8%,transparent)]'
          : 'text-[var(--md-sys-color-on-surface)] hover:bg-[var(--md-sys-color-surface-container-high)]',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
