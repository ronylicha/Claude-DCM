'use client';

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  GitBranch,
  Plus,
  Inbox,
  Search,
  Loader2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import apiClient from '@/lib/api-client';
import { PipelineCard } from '@/components/pipeline/PipelineCard';

// ============================================
// New Pipeline Dialog
// ============================================

interface NewPipelineDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (pipelineId: string) => void;
}

function NewPipelineDialog({ open, onClose, onCreated }: NewPipelineDialogProps) {
  const [sessionId, setSessionId] = useState('');
  const [instructions, setInstructions] = useState('');
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.createPipeline({
        session_id: sessionId.trim(),
        instructions: instructions.trim(),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      onCreated(data.pipeline.id);
      setSessionId('');
      setInstructions('');
    },
  });

  const canSubmit = sessionId.trim().length > 0 && instructions.trim().length > 0 && !createMutation.isPending;

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Create new pipeline"
    >
      <div
        className={cn(
          'w-full max-w-lg mx-4 rounded-[16px] overflow-hidden',
          'bg-[var(--md-sys-color-surface)] shadow-[var(--md-sys-elevation-3)]',
          'border border-[var(--md-sys-color-outline-variant)]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--md-sys-color-outline-variant)]">
          <h2 className="text-[18px] font-semibold text-[var(--md-sys-color-on-surface)]">
            New Pipeline
          </h2>
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

        {/* Body */}
        <div className="p-5 space-y-4">
          <div>
            <label
              htmlFor="pipeline-session-id"
              className="block text-[12px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1.5"
            >
              Session ID
            </label>
            <input
              id="pipeline-session-id"
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder="e.g. abc123-def456-..."
              className={cn(
                'w-full px-3 py-2.5 rounded-[8px] text-[14px]',
                'bg-[var(--md-sys-color-surface-container)]',
                'border border-[var(--md-sys-color-outline-variant)]',
                'text-[var(--md-sys-color-on-surface)]',
                'placeholder:text-[var(--md-sys-color-outline)]',
                'focus:outline-2 focus:outline-[var(--md-sys-color-primary)]',
                'focus:border-[var(--md-sys-color-primary)]',
                'transition-colors duration-200',
              )}
            />
          </div>

          <div>
            <label
              htmlFor="pipeline-instructions"
              className="block text-[12px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1.5"
            >
              Instructions
            </label>
            <textarea
              id="pipeline-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Describe what this pipeline should accomplish..."
              rows={4}
              className={cn(
                'w-full px-3 py-2.5 rounded-[8px] text-[14px] resize-none',
                'bg-[var(--md-sys-color-surface-container)]',
                'border border-[var(--md-sys-color-outline-variant)]',
                'text-[var(--md-sys-color-on-surface)]',
                'placeholder:text-[var(--md-sys-color-outline)]',
                'focus:outline-2 focus:outline-[var(--md-sys-color-primary)]',
                'focus:border-[var(--md-sys-color-primary)]',
                'transition-colors duration-200',
              )}
            />
          </div>

          {createMutation.error && (
            <p className="text-[12px] text-[var(--dcm-zone-red)]">
              Failed to create pipeline. Please try again.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[var(--md-sys-color-outline-variant)]">
          <button
            type="button"
            onClick={onClose}
            className={cn(
              'px-4 py-2.5 rounded-[8px] text-[13px] font-medium cursor-pointer',
              'text-[var(--md-sys-color-on-surface-variant)]',
              'hover:bg-[var(--md-sys-color-surface-container-high)]',
              'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
              'transition-colors duration-200',
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={!canSubmit}
            className={cn(
              'flex items-center gap-2 px-5 py-2.5 rounded-[8px] text-[13px] font-medium cursor-pointer',
              'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]',
              'hover:shadow-[var(--md-sys-elevation-1)]',
              'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
              'focus-visible:outline-offset-2',
              'disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none',
              'transition-all duration-200',
            )}
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="h-4 w-4" aria-hidden="true" />
            )}
            Create Pipeline
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================
// Skeleton
// ============================================

function PipelineListSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" aria-busy="true" aria-label="Loading pipelines...">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div
          key={i}
          className="h-[140px] rounded-[16px] bg-[var(--md-sys-color-surface-container)] animate-pulse"
        />
      ))}
    </div>
  );
}

// ============================================
// Empty state
// ============================================

function EmptyState({ hasFilter }: { hasFilter: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div
        className={cn(
          'flex items-center justify-center w-16 h-16 rounded-full mb-4',
          'bg-[var(--md-sys-color-surface-container-high)]',
        )}
      >
        <Inbox className="h-7 w-7 text-[var(--md-sys-color-outline)]" aria-hidden="true" />
      </div>
      <h3 className="text-[16px] font-medium text-[var(--md-sys-color-on-surface)] mb-1">
        {hasFilter ? 'No matching pipelines' : 'No pipelines yet'}
      </h3>
      <p className="text-[13px] text-[var(--md-sys-color-outline)] max-w-xs">
        {hasFilter
          ? 'Try adjusting your search or filters to find what you are looking for.'
          : 'Create your first pipeline to start orchestrating agents across waves.'}
      </p>
    </div>
  );
}

// ============================================
// Pipeline List Page
// ============================================

export default function PipelinePage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const router = useRouter();

  const { data, isLoading, error } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => apiClient.getPipelines(),
    refetchInterval: 10_000,
  });

  const handleCreated = useCallback((pipelineId: string) => {
    setDialogOpen(false);
    router.push(`/pipeline/${pipelineId}`);
  }, [router]);

  const filteredPipelines = useMemo(() => {
    if (!data?.pipelines) return [];
    let list = data.pipelines;

    if (statusFilter !== 'all') {
      list = list.filter((p) => p.status === statusFilter);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(
        (p) =>
          (p.name?.toLowerCase().includes(q)) ||
          p.id.toLowerCase().includes(q) ||
          p.session_id.toLowerCase().includes(q),
      );
    }

    return list;
  }, [data?.pipelines, statusFilter, searchQuery]);

  const statusCounts = useMemo(() => {
    if (!data?.pipelines) return { all: 0, running: 0, completed: 0, failed: 0, paused: 0, pending: 0 };
    const counts: Record<string, number> = { all: data.pipelines.length };
    for (const p of data.pipelines) {
      counts[p.status] = (counts[p.status] ?? 0) + 1;
    }
    return counts;
  }, [data?.pipelines]);

  const statuses = ['all', 'running', 'completed', 'failed', 'paused', 'pending'] as const;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex items-center justify-center w-10 h-10 rounded-[12px]',
              'bg-[var(--md-sys-color-primary-container)]',
            )}
          >
            <GitBranch
              className="h-5 w-5 text-[var(--md-sys-color-on-primary-container)]"
              aria-hidden="true"
            />
          </div>
          <div>
            <h1 className="text-[22px] font-semibold text-[var(--md-sys-color-on-surface)] leading-tight">
              Pipelines
            </h1>
            <p className="text-[13px] text-[var(--md-sys-color-outline)]">
              {data?.count ?? 0} total
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className={cn(
            'flex items-center gap-2 px-5 py-2.5 rounded-[8px] text-[13px] font-medium cursor-pointer',
            'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]',
            'hover:shadow-[var(--md-sys-elevation-1)]',
            'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
            'focus-visible:outline-offset-2',
            'transition-all duration-200',
          )}
          aria-label="Create new pipeline"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New Pipeline
        </button>
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--md-sys-color-outline)]"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search pipelines..."
            className={cn(
              'w-full pl-9 pr-3 py-2 rounded-[8px] text-[13px]',
              'bg-[var(--md-sys-color-surface-container)]',
              'border border-[var(--md-sys-color-outline-variant)]',
              'text-[var(--md-sys-color-on-surface)]',
              'placeholder:text-[var(--md-sys-color-outline)]',
              'focus:outline-2 focus:outline-[var(--md-sys-color-primary)]',
              'transition-colors duration-200',
            )}
            aria-label="Search pipelines"
          />
        </div>

        {/* Status tabs */}
        <div
          className="flex items-center gap-0.5 p-0.5 rounded-[8px] bg-[var(--md-sys-color-surface-container)]"
          role="tablist"
          aria-label="Filter by status"
        >
          {statuses.map((status) => {
            const count = statusCounts[status] ?? 0;
            const isActive = statusFilter === status;
            return (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setStatusFilter(status)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-[12px] font-medium cursor-pointer',
                  'transition-all duration-200',
                  'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
                  isActive
                    ? 'bg-[var(--md-sys-color-surface)] text-[var(--md-sys-color-on-surface)] shadow-sm'
                    : 'text-[var(--md-sys-color-on-surface-variant)] hover:text-[var(--md-sys-color-on-surface)]',
                )}
              >
                <span className="capitalize">{status}</span>
                {count > 0 && (
                  <span
                    className={cn(
                      'text-[10px] tabular-nums px-1.5 py-0.5 rounded-full',
                      isActive
                        ? 'bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]'
                        : 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-outline)]',
                    )}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <PipelineListSkeleton />
      ) : error ? (
        <div
          className={cn(
            'flex flex-col items-center justify-center py-12 rounded-[16px]',
            'bg-[color-mix(in_srgb,var(--dcm-zone-red)_6%,transparent)]',
            'border border-[color-mix(in_srgb,var(--dcm-zone-red)_20%,transparent)]',
          )}
        >
          <p className="text-[14px] text-[var(--dcm-zone-red)] font-medium">
            Failed to load pipelines
          </p>
          <p className="text-[12px] text-[var(--md-sys-color-outline)] mt-1">
            Check that the DCM server is running.
          </p>
        </div>
      ) : filteredPipelines.length === 0 ? (
        <EmptyState hasFilter={searchQuery.trim().length > 0 || statusFilter !== 'all'} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filteredPipelines.map((pipeline) => (
            <PipelineCard key={pipeline.id} pipeline={pipeline} />
          ))}
        </div>
      )}

      {/* Creation dialog */}
      <NewPipelineDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  );
}
