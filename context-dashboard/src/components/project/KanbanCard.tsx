'use client';

import { useState } from 'react';
import { ChevronRight, Tag, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { EpicCard } from '@/lib/api-client';

// ============================================
// Constants
// ============================================

const EFFORT_CONFIG: Record<
  NonNullable<EpicCard['estimated_effort']>,
  { label: string; color: string; bg: string }
> = {
  xs: {
    label: 'XS',
    color: 'text-[var(--md-sys-color-on-surface-variant)]',
    bg: 'bg-[var(--md-sys-color-surface-container-high)]',
  },
  s: {
    label: 'S',
    color: 'text-[var(--md-sys-color-primary)]',
    bg: 'bg-[var(--md-sys-color-primary-container)]',
  },
  m: {
    label: 'M',
    color: 'text-[var(--md-sys-color-tertiary)]',
    bg: 'bg-[color-mix(in_srgb,var(--md-sys-color-tertiary)_15%,transparent)]',
  },
  l: {
    label: 'L',
    color: 'text-[var(--dcm-zone-orange)]',
    bg: 'bg-[color-mix(in_srgb,var(--dcm-zone-orange)_15%,transparent)]',
  },
  xl: {
    label: 'XL',
    color: 'text-[var(--dcm-zone-red)]',
    bg: 'bg-[color-mix(in_srgb,var(--dcm-zone-red)_12%,transparent)]',
  },
};

const STATUS_ORDER = ['backlog', 'todo', 'in_progress', 'review', 'done'] as const;

function getNextStatus(current: string): string | null {
  const idx = STATUS_ORDER.indexOf(current as (typeof STATUS_ORDER)[number]);
  if (idx === -1 || idx === STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1];
}

function getProgressColor(pct: number): string {
  if (pct >= 100) return 'var(--dcm-zone-green)';
  if (pct >= 66) return 'var(--md-sys-color-primary)';
  if (pct >= 33) return 'var(--dcm-zone-orange)';
  return 'var(--md-sys-color-outline)';
}

// ============================================
// Props
// ============================================

interface KanbanCardProps {
  epic: EpicCard;
  columnColor: string;
  onTransition: (epicId: string, toStatus: string) => void;
  onClick: () => void;
  onStartSession?: (epicId: string) => void;
}

// ============================================
// KanbanCard
// ============================================

export function KanbanCard({ epic, columnColor, onTransition, onClick, onStartSession }: KanbanCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const nextStatus = getNextStatus(epic.status);
  const effortConfig = epic.estimated_effort ? EFFORT_CONFIG[epic.estimated_effort] : null;
  const accentColor = epic.color ?? columnColor;
  const visibleTags = epic.tags.slice(0, 3);
  const hasMoreTags = epic.tags.length > 3;

  const handleTransitionClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (nextStatus) onTransition(epic.id, nextStatus);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Epic: ${epic.title}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        'relative rounded-[12px] p-3 cursor-pointer',
        'bg-[var(--md-sys-color-surface)]',
        'border border-[var(--md-sys-color-outline-variant)]',
        'border-l-[3px] transition-all duration-200',
        'hover:bg-[var(--md-sys-color-surface-container)]',
        'hover:shadow-[0_2px_8px_color-mix(in_srgb,var(--md-sys-color-shadow)_12%,transparent)]',
        'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)] focus-visible:outline-offset-2',
        'select-none',
      )}
      style={{ borderLeftColor: accentColor }}
    >
      {/* Title */}
      <p
        className={cn(
          'text-[13px] font-medium text-[var(--md-sys-color-on-surface)] leading-snug',
          'line-clamp-2 mb-2',
        )}
      >
        {epic.title}
      </p>

      {/* Progress bar */}
      {epic.progress !== undefined && (
        <div className="mb-2.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-[var(--md-sys-color-outline)] uppercase tracking-wider">
              Progress
            </span>
            <span
              className="text-[10px] font-medium"
              style={{ color: getProgressColor(epic.progress.progress_pct) }}
            >
              {epic.progress.progress_pct}%
            </span>
          </div>
          <div
            className="h-1 rounded-full bg-[var(--md-sys-color-surface-container-high)] overflow-hidden"
            role="progressbar"
            aria-valuenow={epic.progress.progress_pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, epic.progress.progress_pct)}%`,
                backgroundColor: getProgressColor(epic.progress.progress_pct),
              }}
            />
          </div>
        </div>
      )}

      {/* Badges row */}
      <div className="flex items-center flex-wrap gap-1.5">
        {/* Wave badge */}
        {epic.wave_start !== null && epic.wave_end !== null && (
          <span
            className={cn(
              'inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-medium',
              'text-[var(--md-sys-color-on-surface-variant)]',
              'bg-[var(--md-sys-color-surface-container-high)]',
            )}
          >
            W{epic.wave_start}&rarr;W{epic.wave_end}
          </span>
        )}

        {/* Effort badge */}
        {effortConfig && (
          <span
            className={cn(
              'inline-flex items-center px-1.5 py-0.5 rounded-[4px] text-[10px] font-semibold',
              effortConfig.color,
              effortConfig.bg,
            )}
          >
            {effortConfig.label}
          </span>
        )}

        {/* Tags */}
        {visibleTags.map((tag) => (
          <span
            key={tag}
            className={cn(
              'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-[4px] text-[10px]',
              'text-[var(--md-sys-color-outline)]',
              'bg-[var(--md-sys-color-surface-variant)]',
            )}
          >
            <Tag className="h-2.5 w-2.5" aria-hidden="true" />
            {tag}
          </span>
        ))}

        {hasMoreTags && (
          <span className="text-[10px] text-[var(--md-sys-color-outline)]">
            +{epic.tags.length - 3}
          </span>
        )}
      </div>

      {/* Quick transition button — visible on hover */}
      {nextStatus && (
        <button
          type="button"
          aria-label={`Move to ${nextStatus.replace('_', ' ')}`}
          onClick={handleTransitionClick}
          className={cn(
            'absolute bottom-2.5 right-2.5',
            'flex items-center gap-1 px-2 py-1 rounded-[6px] text-[10px] font-medium',
            'text-[var(--md-sys-color-primary)]',
            'bg-[var(--md-sys-color-primary-container)]',
            'transition-opacity duration-150',
            'hover:brightness-95 cursor-pointer',
            isHovered ? 'opacity-100' : 'opacity-0',
            'focus-visible:opacity-100 focus-visible:outline-1 focus-visible:outline-[var(--md-sys-color-primary)]',
          )}
        >
          {nextStatus.replace('_', ' ')}
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </button>
      )}

      {/* Start brainstorm session button */}
      {onStartSession && isHovered && epic.status !== 'done' && epic.status !== 'cancelled' && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onStartSession(epic.id); }}
          className={cn(
            'absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-[6px]',
            'text-[10px] font-medium cursor-pointer',
            'bg-[var(--md-sys-color-tertiary)] text-[var(--md-sys-color-on-tertiary)]',
            'shadow-sm hover:shadow-md transition-all',
          )}
        >
          <MessageSquare className="h-3 w-3" />
          Chat
        </button>
      )}
    </div>
  );
}
