'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Target,
  GitCommit,
  FileText,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils';
import type { PipelineSprint } from '@/lib/api-client';

// Status styles
const SPRINT_STATUS: Record<string, { color: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  completed: { color: 'text-[var(--dcm-zone-green)]', bg: 'bg-[var(--dcm-zone-green)]', icon: CheckCircle2 },
  running: { color: 'text-[var(--md-sys-color-primary)]', bg: 'bg-[var(--md-sys-color-primary)]', icon: Loader2 },
  failed: { color: 'text-[var(--dcm-zone-red)]', bg: 'bg-[var(--dcm-zone-red)]', icon: XCircle },
  pending: { color: 'text-[var(--md-sys-color-outline)]', bg: 'bg-[var(--md-sys-color-outline-variant)]', icon: Clock },
  skipped: { color: 'text-[var(--md-sys-color-outline)]', bg: 'bg-[var(--md-sys-color-outline-variant)]', icon: Clock },
};

function getSprintStyle(status: string) {
  return SPRINT_STATUS[status] ?? SPRINT_STATUS.pending;
}

interface SprintTimelineProps {
  sprints: PipelineSprint[];
}

export function SprintTimeline({ sprints }: SprintTimelineProps) {
  const [expandedSprint, setExpandedSprint] = useState<number | null>(null);

  if (sprints.length === 0) return null;

  return (
    <div className={cn(
      'rounded-[16px] p-5',
      'bg-[var(--md-sys-color-surface-container)]',
      'border border-[var(--md-sys-color-outline-variant)]',
    )}>
      <h2 className="text-[14px] font-semibold text-[var(--md-sys-color-on-surface)] mb-4">
        Sprints
      </h2>

      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[15px] top-4 bottom-4 w-0.5 bg-[var(--md-sys-color-outline-variant)]" />

        <div className="space-y-4">
          {sprints.map((sprint) => {
            const style = getSprintStyle(sprint.status);
            const StatusIcon = style.icon;
            const isExpanded = expandedSprint === sprint.sprint_number;
            const report = sprint.report;

            return (
              <div key={sprint.id} className="relative pl-10">
                {/* Dot on timeline */}
                <div className={cn(
                  'absolute left-[10px] top-1.5 w-[12px] h-[12px] rounded-full border-2 border-[var(--md-sys-color-surface-container)]',
                  style.bg,
                  sprint.status === 'running' && 'animate-pulse',
                )} />

                {/* Sprint card */}
                <div className={cn(
                  'rounded-[12px] overflow-hidden',
                  'border border-[var(--md-sys-color-outline-variant)]',
                  'bg-[var(--md-sys-color-surface)]',
                  sprint.status === 'running' && 'border-[var(--md-sys-color-primary)]',
                )}>
                  {/* Header */}
                  <button
                    type="button"
                    onClick={() => setExpandedSprint(isExpanded ? null : sprint.sprint_number)}
                    className="w-full flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[color-mix(in_srgb,var(--md-sys-color-on-surface)_4%,transparent)] transition-colors duration-200"
                  >
                    <div className="flex items-center gap-3">
                      <StatusIcon className={cn('h-4 w-4', style.color, sprint.status === 'running' && 'animate-spin')} />
                      <div className="text-left">
                        <span className="text-[13px] font-medium text-[var(--md-sys-color-on-surface)]">
                          Sprint {sprint.sprint_number}: {sprint.name}
                        </span>
                        <span className="text-[11px] text-[var(--md-sys-color-outline)] ml-2">
                          Waves {sprint.wave_start}–{sprint.wave_end}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {sprint.commit_sha && (
                        <span className="flex items-center gap-1 text-[10px] text-[var(--md-sys-color-outline)] font-mono">
                          <GitCommit className="h-3 w-3" />
                          {sprint.commit_sha.slice(0, 7)}
                        </span>
                      )}
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-[var(--md-sys-color-outline)]" /> : <ChevronDown className="h-4 w-4 text-[var(--md-sys-color-outline)]" />}
                    </div>
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-4 pb-4 space-y-3 border-t border-[var(--md-sys-color-outline-variant)]">
                      {/* Objectives */}
                      <div className="pt-3">
                        <h4 className="text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)] uppercase tracking-wider mb-2">
                          Objectives
                        </h4>
                        <ul className="space-y-1.5">
                          {sprint.objectives.map((obj, i) => {
                            const met = report?.objectives_met?.[i];
                            return (
                              <li key={`${sprint.id}-obj-${i}`} className="flex items-start gap-2 text-[12px]">
                                <Target className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', met?.met ? 'text-[var(--dcm-zone-green)]' : 'text-[var(--md-sys-color-outline)]')} />
                                <span className={cn(met?.met ? 'text-[var(--md-sys-color-on-surface)]' : 'text-[var(--md-sys-color-on-surface-variant)]')}>
                                  {obj}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      </div>

                      {/* Report (if completed) */}
                      {report && (
                        <div className="space-y-2">
                          <h4 className="text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)] uppercase tracking-wider">
                            Report
                          </h4>
                          <p className="text-[12px] text-[var(--md-sys-color-on-surface)]">
                            {report.summary}
                          </p>

                          {/* Stats */}
                          <div className="flex flex-wrap gap-3 text-[11px]">
                            <span className="flex items-center gap-1 text-[var(--dcm-zone-green)]">
                              <CheckCircle2 className="h-3 w-3" /> {report.steps_completed} completed
                            </span>
                            {report.steps_failed > 0 && (
                              <span className="flex items-center gap-1 text-[var(--dcm-zone-red)]">
                                <XCircle className="h-3 w-3" /> {report.steps_failed} failed
                              </span>
                            )}
                            {report.files_changed.length > 0 && (
                              <span className="flex items-center gap-1 text-[var(--md-sys-color-outline)]">
                                <FileText className="h-3 w-3" /> {report.files_changed.length} files
                              </span>
                            )}
                            {report.duration_ms > 0 && (
                              <span className="text-[var(--md-sys-color-outline)]">
                                {formatDuration(report.duration_ms)}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
