'use client';

import { useState, useId } from 'react';
import { X, Loader2 } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CreateEpicInput } from '@/lib/api-client';

// ============================================
// Types
// ============================================

interface EpicCreateDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

type EffortOption = 'xs' | 's' | 'm' | 'l' | 'xl';

const EFFORT_OPTIONS: { value: EffortOption; label: string }[] = [
  { value: 'xs', label: 'XS — Trivial' },
  { value: 's', label: 'S — Small' },
  { value: 'm', label: 'M — Medium' },
  { value: 'l', label: 'L — Large' },
  { value: 'xl', label: 'XL — Epic' },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'review', label: 'Review' },
  { value: 'done', label: 'Done' },
];

const DEFAULT_COLOR = '#006494';

// ============================================
// Form field sub-component
// ============================================

function Field({
  label,
  htmlFor,
  required,
  children,
  error,
}: {
  label: string;
  htmlFor: string;
  required?: boolean;
  children: React.ReactNode;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-[12px] font-medium text-[var(--md-sys-color-on-surface-variant)] uppercase tracking-wider"
      >
        {label}
        {required && (
          <span className="text-[var(--dcm-zone-red)] ml-1" aria-label="required">
            *
          </span>
        )}
      </label>
      {children}
      {error && (
        <p className="text-[11px] text-[var(--dcm-zone-red)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ============================================
// EpicCreateDialog
// ============================================

export function EpicCreateDialog({
  projectId,
  open,
  onOpenChange,
  onCreated,
}: EpicCreateDialogProps) {
  const uid = useId();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('backlog');
  const [effort, setEffort] = useState<EffortOption | ''>('');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [titleError, setTitleError] = useState('');

  const createMutation = useMutation({
    mutationFn: async (data: CreateEpicInput) => {
      const { default: api } = await import('@/lib/api-client');
      return api.createEpic(projectId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-board', projectId] });
      handleClose();
      onCreated();
    },
  });

  const handleClose = () => {
    setTitle('');
    setDescription('');
    setStatus('backlog');
    setEffort('');
    setColor(DEFAULT_COLOR);
    setTitleError('');
    onOpenChange(false);
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!title.trim()) {
      setTitleError('Title is required');
      return;
    }

    setTitleError('');

    const payload: CreateEpicInput = {
      title: title.trim(),
      status,
      ...(description.trim() && { description: description.trim() }),
      ...(effort && { estimated_effort: effort }),
      ...(color !== DEFAULT_COLOR && { color }),
    };

    createMutation.mutate(payload);
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) handleClose();
  };

  if (!open) return null;

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        'bg-[var(--md-sys-color-scrim)]/40 backdrop-blur-sm',
        'animate-in fade-in duration-200',
      )}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${uid}-title`}
      onClick={handleBackdropClick}
    >
      <div
        className={cn(
          'relative w-full max-w-md rounded-[20px] p-6',
          'bg-[var(--md-sys-color-surface)]',
          'border border-[var(--md-sys-color-outline-variant)]',
          'shadow-[0_8px_32px_color-mix(in_srgb,var(--md-sys-color-shadow)_24%,transparent)]',
          'animate-in zoom-in-95 slide-in-from-bottom-4 duration-200',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2
            id={`${uid}-title`}
            className="text-[16px] font-semibold text-[var(--md-sys-color-on-surface)]"
          >
            New Epic
          </h2>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close dialog"
            className={cn(
              'p-1.5 rounded-full cursor-pointer',
              'text-[var(--md-sys-color-outline)]',
              'hover:bg-[var(--md-sys-color-surface-container)]',
              'transition-colors duration-150',
              'focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]',
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} noValidate>
          <div className="flex flex-col gap-4">
            {/* Title */}
            <Field label="Title" htmlFor={`${uid}-title-input`} required error={titleError}>
              <Input
                id={`${uid}-title-input`}
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (titleError) setTitleError('');
                }}
                placeholder="What needs to be done?"
                aria-required="true"
                aria-invalid={!!titleError}
                aria-describedby={titleError ? `${uid}-title-error` : undefined}
                className={cn(
                  'bg-[var(--md-sys-color-surface-container-low)]',
                  'border-[var(--md-sys-color-outline-variant)]',
                  'focus-visible:ring-[var(--md-sys-color-primary)]',
                  titleError && 'border-[var(--dcm-zone-red)]',
                )}
              />
            </Field>

            {/* Description */}
            <Field label="Description" htmlFor={`${uid}-desc`}>
              <textarea
                id={`${uid}-desc`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description…"
                rows={3}
                className={cn(
                  'flex w-full rounded-md border px-3 py-2 text-sm shadow-sm',
                  'resize-none transition-colors',
                  'bg-[var(--md-sys-color-surface-container-low)]',
                  'border-[var(--md-sys-color-outline-variant)]',
                  'text-[var(--md-sys-color-on-surface)]',
                  'placeholder:text-[var(--md-sys-color-outline)]',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--md-sys-color-primary)]',
                )}
              />
            </Field>

            {/* Status + Effort */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Status" htmlFor={`${uid}-status`}>
                <select
                  id={`${uid}-status`}
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className={cn(
                    'flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm',
                    'appearance-none cursor-pointer',
                    'bg-[var(--md-sys-color-surface-container-low)]',
                    'border-[var(--md-sys-color-outline-variant)]',
                    'text-[var(--md-sys-color-on-surface)]',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--md-sys-color-primary)]',
                  )}
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Effort" htmlFor={`${uid}-effort`}>
                <select
                  id={`${uid}-effort`}
                  value={effort}
                  onChange={(e) => setEffort(e.target.value as EffortOption | '')}
                  className={cn(
                    'flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-sm',
                    'appearance-none cursor-pointer',
                    'bg-[var(--md-sys-color-surface-container-low)]',
                    'border-[var(--md-sys-color-outline-variant)]',
                    'text-[var(--md-sys-color-on-surface)]',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--md-sys-color-primary)]',
                  )}
                >
                  <option value="">No estimate</option>
                  {EFFORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {/* Color */}
            <Field label="Color" htmlFor={`${uid}-color`}>
              <div className="flex items-center gap-3">
                <input
                  id={`${uid}-color`}
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className={cn(
                    'h-9 w-14 rounded-md border px-1 py-1 cursor-pointer',
                    'border-[var(--md-sys-color-outline-variant)]',
                    'bg-[var(--md-sys-color-surface-container-low)]',
                    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--md-sys-color-primary)]',
                  )}
                  aria-label="Epic accent color"
                />
                <span className="text-[12px] font-mono text-[var(--md-sys-color-outline)]">
                  {color}
                </span>
                {color !== DEFAULT_COLOR && (
                  <button
                    type="button"
                    onClick={() => setColor(DEFAULT_COLOR)}
                    className="text-[11px] text-[var(--md-sys-color-primary)] hover:underline cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
            </Field>

            {/* Error state */}
            {createMutation.isError && (
              <p
                className={cn(
                  'text-[12px] px-3 py-2 rounded-[8px]',
                  'text-[var(--dcm-zone-red)]',
                  'bg-[color-mix(in_srgb,var(--dcm-zone-red)_10%,transparent)]',
                )}
                role="alert"
              >
                Failed to create epic. Please try again.
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 mt-6">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleClose}
              disabled={createMutation.isPending}
              className="text-[var(--md-sys-color-on-surface-variant)]"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={createMutation.isPending}
              className={cn(
                'min-w-[90px]',
                'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]',
                'hover:brightness-90',
              )}
            >
              {createMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  Creating…
                </>
              ) : (
                'Create Epic'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
