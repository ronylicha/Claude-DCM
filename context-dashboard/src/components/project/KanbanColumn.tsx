'use client';

import { cn } from '@/lib/utils';
import type { EpicCard } from '@/lib/api-client';
import { KanbanCard } from './KanbanCard';

// ============================================
// Props
// ============================================

interface KanbanColumnProps {
  title: string;
  status: string;
  epics: EpicCard[];
  color: string;
  onTransition: (epicId: string, toStatus: string) => void;
  onEpicClick: (epicId: string) => void;
}

// ============================================
// KanbanColumn
// ============================================

export function KanbanColumn({
  title,
  status,
  epics,
  color,
  onTransition,
  onEpicClick,
}: KanbanColumnProps) {
  return (
    <div
      data-kanban-status={status}
      className={cn(
        'flex flex-col rounded-[16px]',
        'bg-[var(--md-sys-color-surface-container-low)]',
        'border border-[var(--md-sys-color-outline-variant)]',
      )}
      style={{ minWidth: '260px' }}
      aria-label={`${title} column — ${epics.length} item${epics.length !== 1 ? 's' : ''}`}
    >
      {/* Column header */}
      <div
        className={cn(
          'flex items-center justify-between px-3 py-2.5',
          'border-b border-[var(--md-sys-color-outline-variant)]',
          'rounded-t-[16px]',
        )}
      >
        <div className="flex items-center gap-2">
          {/* Color dot */}
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: color }}
            aria-hidden="true"
          />
          <h3 className="text-[12px] font-semibold text-[var(--md-sys-color-on-surface)] uppercase tracking-wider">
            {title}
          </h3>
        </div>

        {/* Count badge */}
        <span
          className={cn(
            'inline-flex items-center justify-center',
            'min-w-[20px] h-5 px-1.5 rounded-full',
            'text-[11px] font-semibold',
          )}
          style={{
            backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`,
            color: color,
          }}
          aria-label={`${epics.length} items`}
        >
          {epics.length}
        </span>
      </div>

      {/* Cards list */}
      <div
        className={cn(
          'flex flex-col gap-2 p-2 overflow-y-auto',
          'scrollbar-thin scrollbar-thumb-[var(--md-sys-color-outline-variant)] scrollbar-track-transparent',
        )}
        style={{ maxHeight: 'calc(100vh - 280px)', minHeight: '80px' }}
        role="list"
        aria-label={`${title} epics`}
      >
        {epics.length === 0 ? (
          <div
            className={cn(
              'flex flex-col items-center justify-center py-6 px-3',
              'rounded-[8px]',
              'border border-dashed border-[var(--md-sys-color-outline-variant)]',
            )}
            aria-label="No items in this column"
          >
            <span className="text-[12px] text-[var(--md-sys-color-outline)] select-none">
              No items
            </span>
          </div>
        ) : (
          epics.map((epic) => (
            <div key={epic.id} role="listitem">
              <KanbanCard
                epic={epic}
                columnColor={color}
                onTransition={onTransition}
                onClick={() => onEpicClick(epic.id)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
