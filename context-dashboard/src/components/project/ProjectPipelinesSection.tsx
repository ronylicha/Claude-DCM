'use client';

import { GitBranch, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PipelineMiniCard } from './PipelineMiniCard';
import type { PipelineSummary } from '@/lib/api-client';

interface ProjectPipelinesSectionProps {
  pipelines: PipelineSummary[];
  onExpand?: () => void;
}

export function ProjectPipelinesSection({ pipelines, onExpand }: ProjectPipelinesSectionProps) {
  const activePipelines = pipelines.filter(
    (p) => p.status === 'running' || p.status === 'planning' || p.status === 'ready',
  );
  const completedPipelines = pipelines.filter((p) => p.status === 'completed');
  const failedPipelines = pipelines.filter((p) => p.status === 'failed' || p.status === 'cancelled');

  const hasPipelines = pipelines.length > 0;

  return (
    <section
      className={cn(
        'rounded-[20px] p-5',
        'bg-[var(--md-sys-color-surface-container)]',
        'border border-[var(--md-sys-color-outline-variant)]',
      )}
      aria-label="Project pipelines"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-[var(--md-sys-color-on-surface-variant)]" />
          <h2 className="text-[14px] font-semibold text-[var(--md-sys-color-on-surface)]">
            Pipelines
          </h2>
          <span className="text-[11px] text-[var(--md-sys-color-outline)]">
            ({pipelines.length})
          </span>
        </div>
        {onExpand && hasPipelines && (
          <button
            type="button"
            onClick={onExpand}
            className={cn(
              'text-[11px] px-2 py-1 rounded-[8px]',
              'text-[var(--md-sys-color-primary)]',
              'hover:bg-[var(--md-sys-color-primary)]/10',
              'transition-colors',
            )}
          >
            Open details →
          </button>
        )}
      </div>

      {/* Empty state */}
      {!hasPipelines && (
        <div className="flex flex-col items-center justify-center py-8 text-[var(--md-sys-color-outline)]">
          <Inbox className="h-8 w-8 mb-2 opacity-50" />
          <p className="text-[12px]">No pipelines yet</p>
          <p className="text-[10px] mt-1">
            Approve tasks in an epic chat to create a pipeline
          </p>
        </div>
      )}

      {/* Groups */}
      {hasPipelines && (
        <div className="flex flex-col gap-4">
          {activePipelines.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)]">
                  Active ({activePipelines.length})
                </h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {activePipelines.map((p) => (
                  <PipelineMiniCard key={p.id} pipeline={p} />
                ))}
              </div>
            </div>
          )}

          {failedPipelines.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)]">
                  Failed ({failedPipelines.length})
                </h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {failedPipelines.map((p) => (
                  <PipelineMiniCard key={p.id} pipeline={p} />
                ))}
              </div>
            </div>
          )}

          {completedPipelines.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)]">
                  Completed ({completedPipelines.length})
                </h3>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {completedPipelines.map((p) => (
                  <PipelineMiniCard key={p.id} pipeline={p} compact />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
