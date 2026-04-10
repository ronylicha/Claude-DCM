'use client';

import { Loader2, Play, X, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SessionToolbarProps {
  model: string;
  autoExecute: boolean;
  onToggleAutoExecute: () => void;
  onEndSession: () => void;
  onExecuteAll: () => void;
  hasApprovedTasks: boolean;
  isActive: boolean;
}

export function SessionToolbar({
  model,
  autoExecute,
  onToggleAutoExecute,
  onEndSession,
  onExecuteAll,
  hasApprovedTasks,
  isActive,
}: SessionToolbarProps) {
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--md-sys-color-outline-variant)]">
      <div className="flex items-center gap-3">
        {/* Status dot */}
        <span
          className={cn(
            'w-2 h-2 rounded-full',
            isActive ? 'bg-[var(--dcm-zone-green)] animate-pulse' : 'bg-[var(--md-sys-color-outline)]',
          )}
        />
        {/* Model badge */}
        <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)]">
          {model}
        </span>
        {/* Auto-execute toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={autoExecute}
          onClick={onToggleAutoExecute}
          className="flex items-center gap-1.5 cursor-pointer"
        >
          <span className="text-[11px] text-[var(--md-sys-color-outline)]">Auto</span>
          <div
            className={cn(
              'w-7 h-4 rounded-full transition-colors relative',
              autoExecute ? 'bg-[var(--md-sys-color-primary)]' : 'bg-[var(--md-sys-color-outline-variant)]',
            )}
          >
            <div
              className={cn(
                'absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform',
                autoExecute ? 'translate-x-3.5' : 'translate-x-0.5',
              )}
            />
          </div>
        </button>
      </div>

      <div className="flex items-center gap-2">
        {hasApprovedTasks && (
          <button
            type="button"
            onClick={onExecuteAll}
            className={cn(
              'flex items-center gap-1 px-2.5 py-1 rounded-[6px] text-[11px] font-medium cursor-pointer',
              'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]',
              'hover:shadow-sm transition-shadow',
            )}
          >
            <Play className="h-3 w-3" />
            Execute
          </button>
        )}
        <button
          type="button"
          onClick={onEndSession}
          className={cn(
            'flex items-center gap-1 px-2.5 py-1 rounded-[6px] text-[11px] font-medium cursor-pointer',
            'text-[var(--dcm-zone-red)] border border-[color-mix(in_srgb,var(--dcm-zone-red)_30%,transparent)]',
            'hover:bg-[color-mix(in_srgb,var(--dcm-zone-red)_8%,transparent)]',
          )}
        >
          <X className="h-3 w-3" />
          End
        </button>
      </div>
    </div>
  );
}
