'use client';

import { cn } from '@/lib/utils';
import type { EpicCard } from '@/lib/api-client';

// ============================================
// Constants
// ============================================

interface SegmentConfig {
  key: string;
  label: string;
  color: string;
}

const SEGMENTS: SegmentConfig[] = [
  { key: 'backlog', label: 'backlog', color: 'var(--md-sys-color-outline)' },
  { key: 'todo', label: 'to do', color: 'var(--md-sys-color-primary)' },
  { key: 'in_progress', label: 'in progress', color: 'var(--dcm-zone-orange)' },
  { key: 'review', label: 'review', color: 'var(--md-sys-color-tertiary)' },
  { key: 'done', label: 'done', color: 'var(--dcm-zone-green)' },
];

// ============================================
// Props
// ============================================

interface BoardSummaryBarProps {
  stats: {
    total_epics: number;
    linked_pipelines: number;
    completion_pct: number;
  };
  board: Record<string, EpicCard[]>;
}

// ============================================
// BoardSummaryBar
// ============================================

export function BoardSummaryBar({ stats, board }: BoardSummaryBarProps) {
  const total = stats.total_epics;

  const segments = SEGMENTS.map((seg) => ({
    ...seg,
    count: board[seg.key]?.length ?? 0,
    pct: total > 0 ? ((board[seg.key]?.length ?? 0) / total) * 100 : 0,
  }));

  const completionColor =
    stats.completion_pct >= 80
      ? 'var(--dcm-zone-green)'
      : stats.completion_pct >= 40
        ? 'var(--dcm-zone-orange)'
        : 'var(--md-sys-color-outline)';

  return (
    <div
      className={cn(
        'rounded-[12px] px-4 py-3',
        'bg-[var(--md-sys-color-surface-container)]',
        'border border-[var(--md-sys-color-outline-variant)]',
      )}
      role="region"
      aria-label="Board summary"
    >
      {/* Top row: labels + completion */}
      <div className="flex items-center justify-between mb-2">
        <div
          className="flex items-center flex-wrap gap-x-3 gap-y-1"
          aria-label="Epic counts by status"
        >
          {segments.map((seg, i) => (
            <span key={seg.key} className="flex items-center gap-1">
              {i > 0 && (
                <span
                  className="text-[11px] text-[var(--md-sys-color-outline-variant)]"
                  aria-hidden="true"
                >
                  ·
                </span>
              )}
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ backgroundColor: seg.color }}
                aria-hidden="true"
              />
              <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
                <span className="font-semibold text-[var(--md-sys-color-on-surface)]">
                  {seg.count}
                </span>{' '}
                {seg.label}
              </span>
            </span>
          ))}
        </div>

        {/* Completion percentage */}
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <span className="text-[11px] text-[var(--md-sys-color-outline)] uppercase tracking-wider">
            Complete
          </span>
          <span
            className="text-[13px] font-semibold tabular-nums"
            style={{ color: completionColor }}
            aria-label={`${stats.completion_pct}% complete`}
          >
            {stats.completion_pct}%
          </span>
        </div>
      </div>

      {/* Segmented progress bar */}
      <div
        className="flex h-1.5 rounded-full overflow-hidden gap-px bg-[var(--md-sys-color-surface-container-high)]"
        role="progressbar"
        aria-valuenow={stats.completion_pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${stats.completion_pct}% of epics completed`}
      >
        {total === 0 ? (
          <div className="flex-1 bg-[var(--md-sys-color-surface-container-high)] rounded-full" />
        ) : (
          segments.map((seg) =>
            seg.pct > 0 ? (
              <div
                key={seg.key}
                className="h-full transition-all duration-500"
                style={{
                  width: `${seg.pct}%`,
                  backgroundColor: seg.color,
                }}
                aria-label={`${seg.label}: ${seg.count} epics (${Math.round(seg.pct)}%)`}
              />
            ) : null,
          )
        )}
      </div>
    </div>
  );
}
