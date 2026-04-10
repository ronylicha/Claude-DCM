'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  X,
  Bot,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Copy,
  Check,
  ArrowDown,
} from 'lucide-react';
import { cn, formatDuration } from '@/lib/utils';
import { apiClient } from '@/lib/api-client';
import type { PipelineStep } from '@/lib/api-client';
import { type StreamEvent, groupStreamEvents, EventBlock, parseChunkToEvents } from './EventBlocks';

interface StepOutputModalProps {
  open: boolean;
  onClose: () => void;
  pipelineId: string;
  step: PipelineStep;
}

// ============================================
// Status badge
// ============================================

type StatusEntry = {
  label: string;
  color: string;
  Icon: React.ComponentType<{ className?: string }>;
};

const STATUS_MAP: Record<string, StatusEntry> = {
  completed: { label: 'Completed', color: 'text-[var(--dcm-zone-green)]', Icon: CheckCircle2 },
  running: { label: 'Running', color: 'text-[var(--md-sys-color-primary)]', Icon: Loader2 },
  failed: { label: 'Failed', color: 'text-[var(--dcm-zone-red)]', Icon: XCircle },
  pending: { label: 'Pending', color: 'text-[var(--md-sys-color-outline)]', Icon: Clock },
  queued: { label: 'Queued', color: 'text-[var(--md-sys-color-outline)]', Icon: Clock },
};

function StatusBadge({ status }: { status: string }) {
  const entry = STATUS_MAP[status] ?? STATUS_MAP.pending;
  const Icon = entry.Icon;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[12px] font-medium', entry.color)}>
      <Icon className={cn('h-3.5 w-3.5', status === 'running' && 'animate-spin')} />
      {entry.label}
    </span>
  );
}

// ============================================
// StepOutputModal
// ============================================

export function StepOutputModal({ open, onClose, pipelineId, step }: StepOutputModalProps) {
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const outputRef = useRef<HTMLDivElement>(null);

  const isRunning =
    step.status === 'running' || step.status === 'pending' || step.status === 'queued';

  // Poll every 2s while step is running
  const { data, isLoading, error } = useQuery({
    queryKey: ['step-output', pipelineId, step.id],
    queryFn: () => apiClient.getStepOutput(pipelineId, step.id),
    enabled: open,
    refetchInterval: open && isRunning ? 2000 : false,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  // Auto-scroll to bottom when new content arrives (only if user hasn't scrolled up)
  useEffect(() => {
    if (!autoScroll) return;
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [data?.full_text, autoScroll]);

  // Detect user scrolling away from bottom (disables auto-scroll until user jumps back)
  const handleScroll = (e: React.UIEvent<HTMLPreElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  };

  // Escape key closes modal
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleCopy = async () => {
    if (!data?.full_text) return;
    try {
      await navigator.clipboard.writeText(data.full_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable; silently ignore
    }
  };

  const scrollToBottom = () => {
    const el = outputRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAutoScroll(true);
  };

  if (!open) return null;

  const outputText = data?.full_text ?? '';
  const hasContent = outputText.length > 0;
  const charCount = outputText.length;
  const displayStatus = data?.status ?? step.status;
  const displayError = data?.error ?? step.error;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Output for ${step.agent_type}`}
    >
      <div
        className={cn(
          'w-full max-w-4xl h-[85vh] rounded-[16px] overflow-hidden flex flex-col',
          'bg-[var(--md-sys-color-surface)] shadow-[var(--md-sys-elevation-3)]',
          'border border-[var(--md-sys-color-outline-variant)]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--md-sys-color-outline-variant)] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded-[10px] shrink-0',
                'bg-[var(--md-sys-color-surface-container-high)]',
              )}
            >
              <Bot className="h-5 w-5 text-[var(--md-sys-color-on-surface-variant)]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold text-[var(--md-sys-color-on-surface)] truncate">
                {step.agent_type}
              </h2>
              <div className="flex items-center gap-3 text-[11px] text-[var(--md-sys-color-outline)] mt-0.5 flex-wrap">
                <span>Wave {step.wave_number}</span>
                <span>•</span>
                <span>Step {step.step_order}</span>
                <span>•</span>
                <StatusBadge status={displayStatus} />
                {step.duration_ms !== null && (
                  <>
                    <span>•</span>
                    <span>{formatDuration(step.duration_ms)}</span>
                  </>
                )}
                {data?.is_live && isRunning && (
                  <>
                    <span>•</span>
                    <span className="inline-flex items-center gap-1 text-[var(--md-sys-color-primary)]">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--md-sys-color-primary)] animate-pulse" />
                      LIVE
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {hasContent && (
              <button
                type="button"
                onClick={handleCopy}
                className={cn(
                  'flex items-center gap-1.5 px-3 h-9 rounded-full text-[12px] font-medium cursor-pointer',
                  'text-[var(--md-sys-color-on-surface-variant)]',
                  'hover:bg-[var(--md-sys-color-surface-container-high)]',
                  'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
                  'transition-colors duration-200',
                )}
                aria-label={copied ? 'Copied to clipboard' : 'Copy output'}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className={cn(
                'flex items-center justify-center w-10 h-10 rounded-full cursor-pointer',
                'text-[var(--md-sys-color-on-surface-variant)]',
                'hover:bg-[var(--md-sys-color-surface-container-high)]',
                'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
                'transition-colors duration-200',
              )}
              aria-label="Close dialog"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Description */}
        {step.description && (
          <div className="px-5 py-3 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] shrink-0">
            <p className="text-[12px] text-[var(--md-sys-color-on-surface-variant)] leading-relaxed">
              {step.description}
            </p>
          </div>
        )}

        {/* Error banner */}
        {displayError && (
          <div
            className={cn(
              'mx-5 mt-4 p-3 rounded-[10px] shrink-0',
              'bg-[color-mix(in_srgb,var(--dcm-zone-red)_8%,transparent)]',
              'border border-[color-mix(in_srgb,var(--dcm-zone-red)_25%,transparent)]',
            )}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <AlertTriangle className="h-3.5 w-3.5 text-[var(--dcm-zone-red)]" />
              <span className="text-[11px] font-medium text-[var(--dcm-zone-red)]">Error</span>
            </div>
            <p className="text-[12px] text-[var(--dcm-zone-red)] font-mono whitespace-pre-wrap break-words">
              {displayError}
            </p>
          </div>
        )}

        {/* Output body */}
        <div className="flex-1 min-h-0 relative flex flex-col">
          {isLoading && !hasContent ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-[var(--md-sys-color-primary)]" />
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center text-center px-5">
              <div>
                <AlertTriangle className="h-8 w-8 text-[var(--dcm-zone-red)] mx-auto mb-2" />
                <p className="text-[13px] text-[var(--dcm-zone-red)]">
                  Failed to load step output
                </p>
                <p className="text-[11px] text-[var(--md-sys-color-outline)] mt-1">
                  {error instanceof Error ? error.message : 'Unknown error'}
                </p>
              </div>
            </div>
          ) : !hasContent ? (
            <div className="flex-1 flex items-center justify-center text-center px-5">
              <div>
                {isRunning ? (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin text-[var(--md-sys-color-primary)] mx-auto mb-2" />
                    <p className="text-[13px] text-[var(--md-sys-color-on-surface-variant)]">
                      Waiting for output…
                    </p>
                    <p className="text-[11px] text-[var(--md-sys-color-outline)] mt-1">
                      The agent is starting. Output will stream here.
                    </p>
                  </>
                ) : (
                  <>
                    <Clock className="h-8 w-8 text-[var(--md-sys-color-outline)] mx-auto mb-2" />
                    <p className="text-[13px] text-[var(--md-sys-color-on-surface-variant)]">
                      No output available
                    </p>
                  </>
                )}
              </div>
            </div>
          ) : (
            <>
              <div
                ref={outputRef}
                onScroll={handleScroll as unknown as React.UIEventHandler<HTMLDivElement>}
                className={cn(
                  'flex-1 overflow-auto p-4 space-y-2',
                  'bg-[var(--md-sys-color-surface-container-lowest)]',
                )}
              >
                {(() => {
                  // Parse chunks into structured events
                  const allEvents: StreamEvent[] = [];
                  if (data?.chunks) {
                    for (const c of data.chunks) {
                      allEvents.push(...parseChunkToEvents(c.chunk));
                    }
                  } else if (outputText) {
                    // Fallback: split text output into lines and parse
                    for (const line of outputText.split('\n')) {
                      allEvents.push(...parseChunkToEvents(line));
                    }
                  }
                  const grouped = groupStreamEvents(allEvents);
                  if (grouped.length > 0) {
                    return grouped.map((group, i) => <EventBlock key={i} group={group} />);
                  }
                  // Fallback to raw text if no structured events
                  return (
                    <pre className="text-[12px] leading-relaxed whitespace-pre-wrap break-words font-mono text-[var(--md-sys-color-on-surface)] m-0">
                      {outputText}
                    </pre>
                  );
                })()}
                {isRunning && (
                  <div className="flex items-center gap-2 py-1">
                    <Loader2 className="h-3.5 w-3.5 text-[var(--md-sys-color-primary)] animate-spin" />
                    <span className="text-[11px] text-[var(--md-sys-color-outline)]">Agent working...</span>
                  </div>
                )}
              </div>

              {/* Jump to bottom button (visible when auto-scroll disabled) */}
              {!autoScroll && (
                <button
                  type="button"
                  onClick={scrollToBottom}
                  className={cn(
                    'absolute bottom-4 right-4 flex items-center gap-1.5 px-3 h-9 rounded-full cursor-pointer',
                    'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]',
                    'shadow-[var(--md-sys-elevation-2)] text-[12px] font-medium',
                    'hover:opacity-90 transition-opacity',
                  )}
                  aria-label="Scroll to latest output"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                  Latest
                </button>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-2.5 border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] shrink-0 text-[11px] text-[var(--md-sys-color-outline)]">
          <span className="font-mono">{step.model}</span>
          <span className="tabular-nums">
            {charCount.toLocaleString()} char{charCount !== 1 ? 's' : ''}
            {data?.is_live && ` • ${data.chunks.length} chunks`}
          </span>
        </div>
      </div>
    </div>
  );
}
