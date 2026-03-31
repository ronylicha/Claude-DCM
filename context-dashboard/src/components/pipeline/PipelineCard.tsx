'use client';

import Link from 'next/link';
import {
  CheckCircle2,
  Clock,
  XCircle,
  Pause,
  Activity,
  Timer,
  Loader2,
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

  return (
    <Link
      href={`/pipeline/${pipeline.id}`}
      className={cn(
        'group block rounded-[16px] p-4 cursor-pointer',
        'bg-[var(--md-sys-color-surface-container)]',
        'border border-[var(--md-sys-color-outline-variant)]',
        'transition-all duration-200',
        'hover:bg-[var(--md-sys-color-surface-container-high)]',
        'hover:shadow-[var(--md-sys-elevation-1)]',
        'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
        'focus-visible:outline-offset-2',
        isRunning && 'border-l-2 border-l-[var(--md-sys-color-primary)]',
      )}
      aria-label={`Pipeline: ${pipeline.name ?? pipeline.id.slice(0, 8)}, status: ${style.label}`}
    >
      {/* Row 1: Name + Status */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-[14px] font-medium text-[var(--md-sys-color-on-surface)] leading-tight truncate flex-1">
          {pipeline.name ?? `Pipeline ${pipeline.id.slice(0, 8)}`}
        </h3>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-medium border shrink-0',
            style.color,
            style.bg,
            style.border,
          )}
        >
          <StatusIcon className={cn('h-3 w-3', isRunning && 'animate-pulse')} aria-hidden="true" />
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
  );
}
