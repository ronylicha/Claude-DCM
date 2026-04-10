'use client';

import { Plus, GitBranch, FolderKanban, Layers, ScanSearch, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import type { Project } from '@/lib/api-client';

// ============================================
// Props
// ============================================

interface ProjectHeaderProps {
  project: Project;
  stats: {
    total_epics: number;
    linked_pipelines: number;
    completion_pct: number;
  };
  onCreateEpic: () => void;
  onCreatePipeline: () => void;
  onAnalyze?: () => void;
  analyzeStatus?: 'idle' | 'running' | 'done' | 'error';
}

// ============================================
// StatusBadge sub-component
// ============================================

type ProjectStatus = 'active' | 'archived' | 'unknown';

function resolveProjectStatus(metadata: Record<string, unknown>): ProjectStatus {
  const s = metadata?.status;
  if (s === 'active') return 'active';
  if (s === 'archived') return 'archived';
  return 'unknown';
}

const STATUS_STYLE: Record<ProjectStatus, { label: string; color: string; bg: string }> = {
  active: {
    label: 'Active',
    color: 'text-[var(--dcm-zone-green)]',
    bg: 'bg-[color-mix(in_srgb,var(--dcm-zone-green)_14%,transparent)]',
  },
  archived: {
    label: 'Archived',
    color: 'text-[var(--md-sys-color-outline)]',
    bg: 'bg-[var(--md-sys-color-surface-container-high)]',
  },
  unknown: {
    label: 'Active',
    color: 'text-[var(--dcm-zone-green)]',
    bg: 'bg-[color-mix(in_srgb,var(--dcm-zone-green)_14%,transparent)]',
  },
};

// ============================================
// StatChip sub-component
// ============================================

function StatChip({
  icon: Icon,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number | string;
  label: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-[8px]',
        'bg-[var(--md-sys-color-surface-container)]',
        'border border-[var(--md-sys-color-outline-variant)]',
      )}
      aria-label={`${value} ${label}`}
    >
      <Icon className="h-3.5 w-3.5 text-[var(--md-sys-color-outline)]" aria-hidden="true" />
      <span className="text-[13px] font-semibold text-[var(--md-sys-color-on-surface)]">
        {value}
      </span>
      <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">{label}</span>
    </div>
  );
}

// ============================================
// ProjectHeader
// ============================================

export function ProjectHeader({
  project,
  stats,
  onCreateEpic,
  onCreatePipeline,
  onAnalyze,
  analyzeStatus = 'idle',
}: ProjectHeaderProps) {
  const projectStatus = resolveProjectStatus(project.metadata);
  const statusStyle = STATUS_STYLE[projectStatus];
  const displayName = project.name ?? project.path.split('/').pop() ?? project.id;

  return (
    <div
      className={cn(
        'rounded-[20px] p-5',
        'bg-[var(--md-sys-color-surface-container)]',
        'border border-[var(--md-sys-color-outline-variant)]',
      )}
      role="banner"
      aria-label={`Project: ${displayName}`}
    >
      {/* Top row: title + actions */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex flex-col gap-1.5 min-w-0">
          {/* Status badge */}
          <span
            className={cn(
              'self-start inline-flex items-center px-2.5 py-0.5 rounded-full',
              'text-[10px] font-semibold uppercase tracking-wider',
              statusStyle.color,
              statusStyle.bg,
            )}
            aria-label={`Project status: ${statusStyle.label}`}
          >
            {statusStyle.label}
          </span>

          {/* Project name */}
          <h1
            className={cn(
              'text-[22px] font-bold leading-tight',
              'text-[var(--md-sys-color-on-surface)]',
              'truncate',
            )}
          >
            {displayName}
          </h1>

          {/* Project path */}
          <code
            className={cn(
              'text-[11px] font-mono leading-none',
              'text-[var(--md-sys-color-outline)]',
              'truncate max-w-[480px]',
            )}
            title={project.path}
            aria-label={`Path: ${project.path}`}
          >
            {project.path}
          </code>

          {/* Context status indicator */}
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 text-[10px]',
                analyzeStatus === 'running'
                  ? 'text-[var(--md-sys-color-tertiary)]'
                  : analyzeStatus === 'done'
                    ? 'text-[var(--dcm-zone-green)]'
                    : 'text-[var(--md-sys-color-outline)]',
              )}
            >
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  analyzeStatus === 'running'
                    ? 'bg-[var(--md-sys-color-tertiary)] animate-pulse'
                    : analyzeStatus === 'done'
                      ? 'bg-[var(--dcm-zone-green)]'
                      : 'bg-[var(--md-sys-color-outline-variant)]',
                )}
              />
              {analyzeStatus === 'running'
                ? 'Context updating...'
                : analyzeStatus === 'done'
                  ? 'Context up to date'
                  : 'Context not generated'}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Analyze button */}
          <div className="relative inline-flex items-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onAnalyze}
              disabled={analyzeStatus === 'running'}
              aria-label="Analyze project"
              className={cn(
                'border-[var(--md-sys-color-outline-variant)]',
                'text-[var(--md-sys-color-on-surface-variant)]',
                'hover:bg-[var(--md-sys-color-surface-container-high)]',
                'hover:text-[var(--md-sys-color-on-surface)]',
                'disabled:opacity-60',
              )}
            >
              {analyzeStatus === 'running' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              Analyze
            </Button>
            {analyzeStatus === 'done' && (
              <span
                className={cn(
                  'absolute -top-1.5 -right-1.5',
                  'inline-flex items-center px-1.5 py-0.5 rounded-full',
                  'text-[9px] font-semibold uppercase tracking-wider leading-none',
                  'text-[var(--dcm-zone-green)]',
                  'bg-[color-mix(in_srgb,var(--dcm-zone-green)_14%,transparent)]',
                  'border border-[color-mix(in_srgb,var(--dcm-zone-green)_30%,transparent)]',
                )}
                aria-label="Analysis complete"
              >
                Analyzed
              </span>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCreatePipeline}
            aria-label="Create new pipeline"
            className={cn(
              'border-[var(--md-sys-color-outline-variant)]',
              'text-[var(--md-sys-color-on-surface-variant)]',
              'hover:bg-[var(--md-sys-color-surface-container-high)]',
              'hover:text-[var(--md-sys-color-on-surface)]',
            )}
          >
            <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
            New Pipeline
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={onCreateEpic}
            aria-label="Create new epic"
            className={cn(
              'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]',
              'hover:brightness-90',
            )}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New Epic
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-2 flex-wrap">
        <StatChip icon={Layers} value={stats.total_epics} label="epics" />
        <StatChip icon={GitBranch} value={stats.linked_pipelines} label="pipelines" />
        <StatChip icon={FolderKanban} value={`${stats.completion_pct}%`} label="complete" />
      </div>
    </div>
  );
}
