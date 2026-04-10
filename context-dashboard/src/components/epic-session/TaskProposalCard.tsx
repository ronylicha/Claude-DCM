'use client';

import { Check, X, Loader2, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProposedTask {
  id: string;
  title: string;
  description?: string;
  agent_type: string;
  model: string;
  status: 'proposed' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';
}

interface TaskProposalCardProps {
  task: ProposedTask;
  onApprove: (taskId: string) => void;
  onReject: (taskId: string) => void;
}

const STATUS_COLORS: Record<string, { border: string; bg: string; label: string }> = {
  proposed: { border: 'var(--md-sys-color-primary)', bg: 'color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent)', label: 'Proposed' },
  approved: { border: 'var(--dcm-zone-green)', bg: 'color-mix(in srgb, var(--dcm-zone-green) 8%, transparent)', label: 'Approved' },
  rejected: { border: 'var(--dcm-zone-red)', bg: 'color-mix(in srgb, var(--dcm-zone-red) 8%, transparent)', label: 'Rejected' },
  executing: { border: 'var(--md-sys-color-secondary)', bg: 'color-mix(in srgb, var(--md-sys-color-secondary) 8%, transparent)', label: 'Executing' },
  completed: { border: 'var(--dcm-zone-green)', bg: 'color-mix(in srgb, var(--dcm-zone-green) 8%, transparent)', label: 'Done' },
  failed: { border: 'var(--dcm-zone-red)', bg: 'color-mix(in srgb, var(--dcm-zone-red) 8%, transparent)', label: 'Failed' },
};

export function TaskProposalCard({ task, onApprove, onReject }: TaskProposalCardProps) {
  const colors = STATUS_COLORS[task.status] ?? STATUS_COLORS.proposed;

  return (
    <div
      className={cn(
        'rounded-[10px] p-3 my-2',
        'border-l-[3px]',
      )}
      style={{
        borderLeftColor: colors.border,
        backgroundColor: colors.bg,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <Bot className="h-3.5 w-3.5 shrink-0" style={{ color: colors.border }} />
            <span className="text-[13px] font-medium text-[var(--md-sys-color-on-surface)] truncate">
              {task.title}
            </span>
          </div>
          {task.description && (
            <p className="text-[11px] text-[var(--md-sys-color-outline)] line-clamp-2 ml-5.5">
              {task.description}
            </p>
          )}
          <div className="flex items-center gap-2 mt-1.5 ml-5.5">
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)]">
              {task.agent_type}
            </span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-outline)]">
              {task.model}
            </span>
          </div>
        </div>

        {/* Action buttons or status */}
        <div className="flex items-center gap-1 shrink-0">
          {task.status === 'proposed' ? (
            <>
              <button
                type="button"
                onClick={() => onApprove(task.id)}
                className={cn(
                  'p-1.5 rounded-full cursor-pointer',
                  'bg-[var(--dcm-zone-green)] text-white',
                  'hover:brightness-110 transition-all',
                )}
                title="Approve"
              >
                <Check className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onReject(task.id)}
                className={cn(
                  'p-1.5 rounded-full cursor-pointer',
                  'bg-[var(--dcm-zone-red)] text-white',
                  'hover:brightness-110 transition-all',
                )}
                title="Reject"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          ) : task.status === 'executing' ? (
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: colors.border }} />
          ) : (
            <span
              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
              style={{ color: colors.border, backgroundColor: colors.bg }}
            >
              {colors.label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
