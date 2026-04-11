'use client';

import Link from 'next/link';
import {
  GitBranch,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  ExternalLink,
  Folder,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { PipelineSummary } from '@/lib/api-client';

// ============================================
// Status styling — shared across section + drawer
// ============================================

type PipelineStatus =
  | 'planning'
  | 'ready'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

const STATUS_STYLE: Record<
  PipelineStatus,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  planning:  { label: 'Planning',  className: 'text-amber-500 bg-amber-500/10 border-amber-500/30', icon: Loader2 },
  ready:     { label: 'Ready',     className: 'text-sky-500 bg-sky-500/10 border-sky-500/30',      icon: Clock   },
  running:   { label: 'Running',   className: 'text-blue-500 bg-blue-500/10 border-blue-500/30',   icon: Loader2 },
  paused:    { label: 'Paused',    className: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/30', icon: Clock },
  completed: { label: 'Completed', className: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30', icon: CheckCircle2 },
  failed:    { label: 'Failed',    className: 'text-red-500 bg-red-500/10 border-red-500/30',      icon: XCircle },
  cancelled: { label: 'Cancelled', className: 'text-gray-500 bg-gray-500/10 border-gray-500/30',   icon: XCircle },
  unknown:   { label: 'Unknown',   className: 'text-gray-500 bg-gray-500/10 border-gray-500/30',   icon: Clock   },
};

function resolveStatus(raw: string): PipelineStatus {
  if ((Object.keys(STATUS_STYLE) as PipelineStatus[]).includes(raw as PipelineStatus)) {
    return raw as PipelineStatus;
  }
  return 'unknown';
}

// ============================================
// Helpers
// ============================================

function formatRelative(iso?: string | null): string {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '—';
  const diffSec = Math.round((Date.now() - ts) / 1000);
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

// ============================================
// Component
// ============================================

export interface PipelineMiniCardProps {
  pipeline: PipelineSummary;
  compact?: boolean;
}

export function PipelineMiniCard({ pipeline, compact = false }: PipelineMiniCardProps) {
  const status = resolveStatus(pipeline.status);
  const statusStyle = STATUS_STYLE[status];
  const StatusIcon = statusStyle.icon;
  const isAnimating = status === 'running' || status === 'planning';

  const total = pipeline.total_steps ?? 0;
  const completed = pipeline.completed_steps ?? 0;
  const failed = pipeline.failed_steps ?? 0;
  const running = pipeline.running_steps ?? 0;
  const queued = pipeline.queued_steps ?? 0;
  const progressPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const displayName = pipeline.name?.trim() || `Pipeline ${pipeline.id.slice(0, 8)}`;
  const lastActivity = pipeline.last_activity ?? pipeline.updated_at ?? pipeline.created_at;

  return (
    <Link
      href={`/pipeline/${pipeline.id}`}
      className={cn(
        'group relative flex flex-col gap-2 rounded-[12px] p-3',
        'bg-[var(--md-sys-color-surface-container)]',
        'border border-[var(--md-sys-color-outline-variant)]',
        'hover:border-[var(--md-sys-color-primary)] hover:shadow-sm',
        'transition-all duration-150',
        compact && 'p-2.5 gap-1.5',
      )}
      aria-label={`Open pipeline ${displayName}`}
    >
      {/* Header: status + name + external-link hint */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full',
              'text-[10px] font-semibold uppercase tracking-wider border',
              statusStyle.className,
            )}
          >
            <StatusIcon className={cn('h-3 w-3', isAnimating && 'animate-spin')} />
            {statusStyle.label}
          </span>
          <GitBranch className="h-3.5 w-3.5 text-[var(--md-sys-color-outline)] shrink-0" />
          <span
            className={cn(
              'text-[13px] font-semibold truncate',
              'text-[var(--md-sys-color-on-surface)]',
            )}
            title={displayName}
          >
            {displayName}
          </span>
        </div>
        <ExternalLink className="h-3.5 w-3.5 text-[var(--md-sys-color-outline)] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[10px] text-[var(--md-sys-color-on-surface-variant)]">
            <span>
              {completed}/{total} steps &middot; wave {pipeline.current_wave ?? 0}
            </span>
            <span className="font-mono">{progressPct}%</span>
          </div>
          <div className="h-1 w-full rounded-full bg-[var(--md-sys-color-surface-container-high)] overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-300',
                status === 'failed'
                  ? 'bg-red-500'
                  : status === 'completed'
                    ? 'bg-emerald-500'
                    : 'bg-[var(--md-sys-color-primary)]',
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Step breakdown chips */}
      {!compact && total > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap text-[10px]">
          {running > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              {running} running
            </span>
          )}
          {queued > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-500">
              <Clock className="h-2.5 w-2.5" />
              {queued} queued
            </span>
          )}
          {failed > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">
              <XCircle className="h-2.5 w-2.5" />
              {failed} failed
            </span>
          )}
          {completed > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 className="h-2.5 w-2.5" />
              {completed} done
            </span>
          )}
        </div>
      )}

      {/* Footer: workspace + last activity */}
      {!compact && (
        <div className="flex items-center justify-between gap-2 text-[10px] text-[var(--md-sys-color-outline)]">
          {pipeline.workspace_path ? (
            <span className="inline-flex items-center gap-1 truncate max-w-[60%]" title={pipeline.workspace_path}>
              <Folder className="h-3 w-3 shrink-0" />
              <code className="truncate font-mono">{pipeline.workspace_path}</code>
            </span>
          ) : (
            <span className="italic text-red-500/70">no workspace</span>
          )}
          <span className="shrink-0">{formatRelative(lastActivity)}</span>
        </div>
      )}
    </Link>
  );
}
