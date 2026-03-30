'use client';

import { useState } from 'react';
import {
  Bot,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils';
import type { PipelineStep } from '@/lib/api-client';

// ============================================
// Status styling
// ============================================

interface StepStatusStyle {
  dot: string;
  label: string;
  labelText: string;
  border: string;
  icon: React.ComponentType<{ className?: string }>;
}

const STEP_STATUS: Record<string, StepStatusStyle> = {
  completed: {
    dot: 'bg-[var(--dcm-zone-green)]',
    label: 'text-[var(--dcm-zone-green)]',
    labelText: 'Completed',
    border: '',
    icon: CheckCircle2,
  },
  running: {
    dot: 'bg-[var(--md-sys-color-primary)] animate-pulse',
    label: 'text-[var(--md-sys-color-primary)]',
    labelText: 'Running',
    border: 'border-l-2 border-l-[var(--md-sys-color-primary)]',
    icon: Loader2,
  },
  failed: {
    dot: 'bg-[var(--dcm-zone-red)]',
    label: 'text-[var(--dcm-zone-red)]',
    labelText: 'Failed',
    border: '',
    icon: XCircle,
  },
  pending: {
    dot: 'bg-[var(--md-sys-color-outline-variant)]',
    label: 'text-[var(--md-sys-color-outline)]',
    labelText: 'Pending',
    border: '',
    icon: Clock,
  },
};

function getStepStatus(status: string): StepStatusStyle {
  return STEP_STATUS[status] ?? STEP_STATUS.pending;
}

// ============================================
// Result summary component
// ============================================

function ResultSummary({ result }: { result: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(false);

  const summary = typeof result.summary === 'string'
    ? result.summary
    : typeof result.output === 'string'
      ? result.output
      : JSON.stringify(result, null, 2);

  const lines = summary.split('\n');
  const isTruncated = lines.length > 3 || summary.length > 300;
  const displayText = expanded ? summary : lines.slice(0, 3).join('\n').slice(0, 300);

  return (
    <div className="mt-2">
      <pre
        className={cn(
          'text-[12px] leading-relaxed whitespace-pre-wrap font-mono',
          'text-[var(--md-sys-color-on-surface-variant)]',
          'bg-[var(--md-sys-color-surface-container)] rounded-[8px] p-2.5',
          !expanded && isTruncated && 'line-clamp-3',
        )}
      >
        {displayText}
        {!expanded && isTruncated && '...'}
      </pre>
      {isTruncated && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className={cn(
            'flex items-center gap-1 mt-1 text-[11px] cursor-pointer',
            'text-[var(--md-sys-color-primary)]',
            'hover:text-[var(--md-sys-color-on-primary-container)]',
            'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
            'rounded-[4px] px-1',
          )}
          aria-expanded={expanded}
          aria-label={expanded ? 'Show less' : 'Show more'}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" aria-hidden="true" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
              Show more
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ============================================
// StepCard
// ============================================

interface StepCardProps {
  step: PipelineStep;
}

export function StepCard({ step }: StepCardProps) {
  const style = getStepStatus(step.status);
  const StatusIcon = style.icon;
  const isRunning = step.status === 'running';

  return (
    <div
      className={cn(
        'rounded-[12px] p-4',
        'bg-[var(--md-sys-color-surface-container)]',
        'border border-[var(--md-sys-color-outline-variant)]',
        'transition-all duration-200',
        style.border,
        isRunning && 'shadow-[var(--md-sys-elevation-1)]',
      )}
      role="article"
      aria-label={`Step: ${step.agent_type}, ${style.labelText}`}
    >
      {/* Header: agent type + status */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={cn(
              'flex items-center justify-center w-8 h-8 rounded-[8px] shrink-0',
              'bg-[var(--md-sys-color-surface-container-high)]',
            )}
          >
            <Bot className="h-4 w-4 text-[var(--md-sys-color-on-surface-variant)]" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h4 className="text-[13px] font-medium text-[var(--md-sys-color-on-surface)] truncate">
              {step.agent_type}
            </h4>
            <span className="text-[11px] text-[var(--md-sys-color-outline)] font-mono">
              {step.model}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn('w-2 h-2 rounded-full', style.dot)} />
          <span className={cn('text-[11px] font-medium', style.label)}>
            {style.labelText}
          </span>
          {isRunning && (
            <Loader2 className="h-3 w-3 text-[var(--md-sys-color-primary)] animate-spin ml-0.5" aria-hidden="true" />
          )}
        </div>
      </div>

      {/* Description */}
      {step.description && (
        <p className="text-[13px] text-[var(--md-sys-color-on-surface-variant)] leading-relaxed mb-2">
          {step.description}
        </p>
      )}

      {/* Meta row: duration, retry */}
      <div className="flex items-center gap-3 flex-wrap">
        {step.duration_ms !== null && (
          <span className="flex items-center gap-1 text-[11px] text-[var(--md-sys-color-outline)]">
            <Clock className="h-3 w-3" aria-hidden="true" />
            {formatDuration(step.duration_ms)}
          </span>
        )}

        {step.retry_count > 0 && (
          <span
            className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium',
              'bg-[color-mix(in_srgb,var(--dcm-zone-orange)_12%,transparent)]',
              'text-[var(--dcm-zone-orange)]',
              'border border-[color-mix(in_srgb,var(--dcm-zone-orange)_30%,transparent)]',
            )}
          >
            <RotateCcw className="h-2.5 w-2.5" aria-hidden="true" />
            {step.retry_count} {step.retry_count === 1 ? 'retry' : 'retries'}
          </span>
        )}
      </div>

      {/* Error message */}
      {step.error && (
        <div
          className={cn(
            'mt-3 p-3 rounded-[8px]',
            'bg-[color-mix(in_srgb,var(--dcm-zone-red)_8%,transparent)]',
            'border border-[color-mix(in_srgb,var(--dcm-zone-red)_25%,transparent)]',
          )}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle className="h-3.5 w-3.5 text-[var(--dcm-zone-red)]" aria-hidden="true" />
            <span className="text-[11px] font-medium text-[var(--dcm-zone-red)]">Error</span>
          </div>
          <p className="text-[12px] text-[var(--dcm-zone-red)] leading-relaxed font-mono whitespace-pre-wrap">
            {step.error}
          </p>
        </div>
      )}

      {/* Result summary */}
      {step.result && Object.keys(step.result).length > 0 && step.status === 'completed' && (
        <ResultSummary result={step.result} />
      )}
    </div>
  );
}
