'use client';

import { cn } from '@/lib/utils';
import type { EpicCard } from '@/lib/api-client';
import { KanbanColumn } from './KanbanColumn';

// ============================================
// Column config
// ============================================

interface ColumnConfig {
  key: keyof KanbanBoardProps['board'];
  title: string;
  color: string;
}

const COLUMNS: ColumnConfig[] = [
  {
    key: 'backlog',
    title: 'Backlog',
    color: 'var(--md-sys-color-outline)',
  },
  {
    key: 'todo',
    title: 'To Do',
    color: 'var(--md-sys-color-primary)',
  },
  {
    key: 'in_progress',
    title: 'In Progress',
    color: 'var(--dcm-zone-orange)',
  },
  {
    key: 'review',
    title: 'Review',
    color: 'var(--md-sys-color-tertiary)',
  },
  {
    key: 'done',
    title: 'Done',
    color: 'var(--dcm-zone-green)',
  },
];

// ============================================
// Props
// ============================================

interface KanbanBoardProps {
  board: {
    backlog: EpicCard[];
    todo: EpicCard[];
    in_progress: EpicCard[];
    review: EpicCard[];
    done: EpicCard[];
  };
  onTransition: (epicId: string, toStatus: string) => void;
  onEpicClick: (epicId: string) => void;
}

// ============================================
// KanbanBoard
// ============================================

export function KanbanBoard({ board, onTransition, onEpicClick }: KanbanBoardProps) {
  return (
    <div
      className={cn(
        'w-full overflow-x-auto pb-4',
        '-mx-0',
        // Custom scrollbar styling
        'scrollbar-thin scrollbar-thumb-[var(--md-sys-color-outline-variant)] scrollbar-track-transparent',
      )}
      role="region"
      aria-label="Kanban board"
    >
      <div
        className="flex gap-3 min-w-max"
        style={{ paddingBottom: '4px' }}
      >
        {COLUMNS.map((col) => (
          <KanbanColumn
            key={col.key}
            title={col.title}
            status={col.key}
            epics={board[col.key]}
            color={col.color}
            onTransition={onTransition}
            onEpicClick={onEpicClick}
          />
        ))}
      </div>
    </div>
  );
}

// Re-export column color lookup for use by other components
export const KANBAN_COLUMN_COLORS: Record<string, string> = Object.fromEntries(
  COLUMNS.map((c) => [c.key, c.color]),
);
