'use client';

import { useState, useMemo } from 'react';
import {
  CheckCircle2,
  Clock,
  FileText,
  Bot,
  AlertTriangle,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils';
import type { Pipeline, PipelineStep } from '@/lib/api-client';

// ============================================
// Stat item
// ============================================

interface StatItemProps {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color?: string;
}

function StatItem({ label, value, icon: Icon, color }: StatItemProps) {
  return (
    <div className="flex flex-col items-center justify-center p-3 rounded-[12px] bg-[var(--md-sys-color-surface-container)]">
      <Icon
        className={cn('h-4 w-4 mb-1.5', color ?? 'text-[var(--md-sys-color-on-surface-variant)]')}
        aria-hidden="true"
      />
      <span className="text-[20px] font-bold tabular-nums text-[var(--md-sys-color-on-surface)]">
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-[var(--md-sys-color-outline)] mt-0.5">
        {label}
      </span>
    </div>
  );
}

// ============================================
// Files changed section
// ============================================

function FilesChanged({ files }: { files: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const displayFiles = expanded ? files : files.slice(0, 5);
  const hasMore = files.length > 5;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'flex items-center gap-1.5 w-full text-left cursor-pointer',
          'text-[12px] font-medium text-[var(--md-sys-color-on-surface-variant)]',
          'hover:text-[var(--md-sys-color-on-surface)]',
          'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
          'rounded-[4px] py-1',
        )}
        aria-expanded={expanded}
        aria-label={`Files changed: ${files.length} files`}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        )}
        <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Files changed ({files.length})
      </button>
      {(expanded || files.length <= 5) && (
        <ul className="mt-1.5 space-y-0.5 ml-5">
          {displayFiles.map((file) => (
            <li
              key={file}
              className="text-[12px] text-[var(--md-sys-color-on-surface-variant)] font-mono truncate"
              title={file}
            >
              {file}
            </li>
          ))}
          {hasMore && !expanded && (
            <li className="text-[11px] text-[var(--md-sys-color-outline)]">
              ...and {files.length - 5} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

// ============================================
// Timeline event
// ============================================

interface TimelineEvent {
  timestamp: string;
  label: string;
  status: 'completed' | 'running' | 'failed' | 'info';
}

function TimelineDot({ status }: { status: TimelineEvent['status'] }) {
  const colorMap = {
    completed: 'bg-[var(--dcm-zone-green)]',
    running: 'bg-[var(--md-sys-color-primary)] animate-pulse',
    failed: 'bg-[var(--dcm-zone-red)]',
    info: 'bg-[var(--md-sys-color-outline)]',
  };

  return (
    <span className={cn('w-2 h-2 rounded-full shrink-0', colorMap[status])} />
  );
}

// ============================================
// SynthesisPanel
// ============================================

interface SynthesisPanelProps {
  pipeline: Pipeline;
  steps: PipelineStep[];
}

export function SynthesisPanel({ pipeline, steps }: SynthesisPanelProps) {
  const synthesis = pipeline.synthesis;

  const stats = useMemo(() => {
    const totalSteps = steps.length;
    const completed = steps.filter(s => s.status === 'completed').length;
    const failed = steps.filter(s => s.status === 'failed').length;
    const totalRetries = steps.reduce((sum, s) => sum + s.retry_count, 0);
    const uniqueAgents = new Set(steps.map(s => s.agent_type)).size;

    let durationMs = 0;
    if (pipeline.completed_at && pipeline.started_at) {
      durationMs = new Date(pipeline.completed_at).getTime() - new Date(pipeline.started_at).getTime();
    } else if (pipeline.started_at) {
      durationMs = Date.now() - new Date(pipeline.started_at).getTime();
    }

    return {
      totalSteps,
      completed,
      failed,
      totalRetries,
      uniqueAgents,
      duration: formatDuration(durationMs),
    };
  }, [steps, pipeline.started_at, pipeline.completed_at]);

  const filesChanged = useMemo(() => {
    if (synthesis && Array.isArray(synthesis.files_changed)) {
      return synthesis.files_changed as string[];
    }
    // Attempt to extract from step results
    const files = new Set<string>();
    for (const step of steps) {
      if (step.result && Array.isArray(step.result.files_changed)) {
        for (const f of step.result.files_changed as string[]) {
          files.add(f);
        }
      }
    }
    return Array.from(files);
  }, [synthesis, steps]);

  const errors = useMemo(() => {
    return steps
      .filter(s => s.error !== null)
      .map(s => ({
        agent: s.agent_type,
        wave: s.wave_number,
        error: s.error as string,
      }));
  }, [steps]);

  const timeline = useMemo((): TimelineEvent[] => {
    const events: TimelineEvent[] = [];

    if (pipeline.created_at) {
      events.push({
        timestamp: pipeline.created_at,
        label: 'Pipeline created',
        status: 'info',
      });
    }
    if (pipeline.started_at) {
      events.push({
        timestamp: pipeline.started_at,
        label: 'Execution started',
        status: 'info',
      });
    }

    // Group by waves
    const waveNumbers = [...new Set(steps.map(s => s.wave_number))].sort((a, b) => a - b);
    for (const wn of waveNumbers) {
      const waveSteps = steps.filter(s => s.wave_number === wn);
      const allCompleted = waveSteps.every(s => s.status === 'completed');
      const anyFailed = waveSteps.some(s => s.status === 'failed');
      const firstStarted = waveSteps
        .filter(s => s.started_at)
        .sort((a, b) => new Date(a.started_at!).getTime() - new Date(b.started_at!).getTime())[0];

      if (firstStarted?.started_at) {
        events.push({
          timestamp: firstStarted.started_at,
          label: `Wave ${wn} started (${waveSteps.length} steps)`,
          status: anyFailed ? 'failed' : allCompleted ? 'completed' : 'running',
        });
      }
    }

    if (pipeline.completed_at) {
      events.push({
        timestamp: pipeline.completed_at,
        label: `Pipeline ${pipeline.status}`,
        status: pipeline.status === 'completed' ? 'completed' : 'failed',
      });
    }

    return events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [pipeline, steps]);

  const summaryText = typeof synthesis?.summary === 'string'
    ? synthesis.summary
    : typeof synthesis?.result === 'string'
      ? synthesis.result
      : null;

  return (
    <div
      className={cn(
        'rounded-[16px] overflow-hidden',
        'bg-[var(--md-sys-color-surface-container)]',
        'border border-[var(--md-sys-color-outline-variant)]',
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'px-5 py-4 border-b border-[var(--md-sys-color-outline-variant)]',
          'bg-[var(--md-sys-color-surface-container-high)]',
        )}
      >
        <h3 className="text-[16px] font-semibold text-[var(--md-sys-color-on-surface)]">
          Synthesis Report
        </h3>
        {summaryText && (
          <p className="text-[13px] text-[var(--md-sys-color-on-surface-variant)] mt-1.5 leading-relaxed">
            {summaryText}
          </p>
        )}
      </div>

      <div className="p-5 space-y-5">
        {/* Stats grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatItem label="Steps" value={stats.totalSteps} icon={Layers} />
          <StatItem label="Duration" value={stats.duration} icon={Clock} />
          <StatItem
            label="Completed"
            value={stats.completed}
            icon={CheckCircle2}
            color="text-[var(--dcm-zone-green)]"
          />
          <StatItem
            label="Failed"
            value={stats.failed}
            icon={AlertTriangle}
            color={stats.failed > 0 ? 'text-[var(--dcm-zone-red)]' : undefined}
          />
          <StatItem label="Agents" value={stats.uniqueAgents} icon={Bot} />
          <StatItem
            label="Retries"
            value={stats.totalRetries}
            icon={RotateCcw}
            color={stats.totalRetries > 0 ? 'text-[var(--dcm-zone-orange)]' : undefined}
          />
        </div>

        {/* Files changed */}
        {filesChanged.length > 0 && (
          <FilesChanged files={filesChanged} />
        )}

        {/* Errors list */}
        {errors.length > 0 && (
          <div>
            <h4 className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--dcm-zone-red)] mb-2">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              Errors ({errors.length})
            </h4>
            <div className="space-y-2">
              {errors.map((err, i) => (
                <div
                  key={`${err.agent}-${err.wave}-${i}`}
                  className={cn(
                    'p-2.5 rounded-[8px]',
                    'bg-[color-mix(in_srgb,var(--dcm-zone-red)_6%,transparent)]',
                    'border border-[color-mix(in_srgb,var(--dcm-zone-red)_20%,transparent)]',
                  )}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)]">
                      {err.agent}
                    </span>
                    <span className="text-[10px] text-[var(--md-sys-color-outline)]">
                      Wave {err.wave}
                    </span>
                  </div>
                  <p className="text-[12px] text-[var(--dcm-zone-red)] font-mono leading-relaxed whitespace-pre-wrap">
                    {err.error}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Timeline */}
        {timeline.length > 0 && (
          <div>
            <h4 className="text-[12px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-3">
              Timeline
            </h4>
            <div className="space-y-0">
              {timeline.map((event, i) => (
                <div key={`${event.timestamp}-${i}`} className="flex items-start gap-3 relative">
                  {/* Vertical line */}
                  <div className="flex flex-col items-center shrink-0 pt-1">
                    <TimelineDot status={event.status} />
                    {i < timeline.length - 1 && (
                      <div className="w-px h-6 bg-[var(--md-sys-color-outline-variant)]" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex items-baseline gap-2 pb-2 min-w-0">
                    <span className="text-[11px] text-[var(--md-sys-color-outline)] font-mono tabular-nums shrink-0">
                      {new Date(event.timestamp).toLocaleTimeString('fr-FR', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                    <span className="text-[12px] text-[var(--md-sys-color-on-surface-variant)] truncate">
                      {event.label}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
