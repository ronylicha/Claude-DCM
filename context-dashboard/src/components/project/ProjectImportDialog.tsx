'use client';

import { useState, useCallback, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Folder,
  FolderOpen,
  ArrowLeft,
  Home,
  Loader2,
  Plus,
  ChevronRight,
  GitBranch,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3847';

interface DirEntry {
  name: string;
  path: string;
}

interface BrowseResult {
  current: string;
  parent: string | null;
  dirs: DirEntry[];
}

interface ProjectImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProjectImportDialog({ open, onOpenChange }: ProjectImportDialogProps) {
  const queryClient = useQueryClient();
  const [currentPath, setCurrentPath] = useState('');
  const [dirs, setDirs] = useState<DirEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [error, setError] = useState('');
  const [isGitRepo, setIsGitRepo] = useState(false);

  const browseTo = useCallback(async (path?: string) => {
    setLoading(true);
    setError('');
    try {
      const params = path ? `?path=${encodeURIComponent(path)}` : '';
      const res = await fetch(`${API_BASE_URL}/api/fs/browse${params}`);
      const data: BrowseResult = await res.json();
      if (data.current) {
        setCurrentPath(data.current);
        setDirs(data.dirs ?? []);
        setParentPath(data.parent ?? null);
        // Auto-fill name from directory
        const dirName = data.current.split('/').filter(Boolean).pop() ?? '';
        setProjectName(dirName);
        // Check if .git exists
        setIsGitRepo(data.dirs.some((d) => d.name === '.git'));
      }
    } catch {
      setError('Failed to browse directory');
    } finally {
      setLoading(false);
    }
  }, []);

  // Browse home on open
  useEffect(() => {
    if (open && !currentPath) browseTo();
  }, [open, currentPath, browseTo]);

  const createProject = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE_URL}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: currentPath,
          name: projectName.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error('Failed to create project');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onOpenChange(false);
      setCurrentPath('');
    },
    onError: () => setError('Failed to create project'),
  });

  if (!open) return null;

  const pathSegments = currentPath.split('/').filter(Boolean);
  // Filter out hidden dirs except .git for display
  const visibleDirs = dirs.filter((d) => !d.name.startsWith('.') || d.name === '.git');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={() => onOpenChange(false)}
    >
      <div
        className={cn(
          'w-full max-w-[600px] max-h-[80vh] flex flex-col rounded-[16px] shadow-2xl',
          'bg-[var(--md-sys-color-surface)] border border-[var(--md-sys-color-outline-variant)]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--md-sys-color-outline-variant)]">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--md-sys-color-on-surface)]">
              Import Project
            </h2>
            <p className="text-[12px] text-[var(--md-sys-color-outline)] mt-0.5">
              Browse and select a local directory
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="p-1.5 rounded-full hover:bg-[var(--md-sys-color-surface-container-high)] cursor-pointer"
          >
            <X className="h-4 w-4 text-[var(--md-sys-color-on-surface-variant)]" />
          </button>
        </div>

        {/* Breadcrumb */}
        <div className="flex items-center gap-1 px-5 py-2 border-b border-[var(--md-sys-color-outline-variant)] overflow-x-auto">
          <button
            type="button"
            onClick={() => browseTo('/')}
            className="p-1 rounded hover:bg-[var(--md-sys-color-surface-container-high)] cursor-pointer shrink-0"
          >
            <Home className="h-3.5 w-3.5 text-[var(--md-sys-color-outline)]" />
          </button>
          {pathSegments.map((seg, i) => {
            const segPath = '/' + pathSegments.slice(0, i + 1).join('/');
            const isLast = i === pathSegments.length - 1;
            return (
              <div key={segPath} className="flex items-center gap-1 shrink-0">
                <ChevronRight className="h-3 w-3 text-[var(--md-sys-color-outline)]" />
                <button
                  type="button"
                  onClick={() => !isLast && browseTo(segPath)}
                  className={cn(
                    'text-[12px] px-1 py-0.5 rounded cursor-pointer',
                    isLast
                      ? 'font-semibold text-[var(--md-sys-color-primary)]'
                      : 'text-[var(--md-sys-color-outline)] hover:bg-[var(--md-sys-color-surface-container-high)]',
                  )}
                >
                  {seg}
                </button>
              </div>
            );
          })}
        </div>

        {/* Directory list */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-[var(--md-sys-color-outline)]" />
            </div>
          ) : (
            <>
              {/* Parent directory */}
              {parentPath && (
                <button
                  type="button"
                  onClick={() => browseTo(parentPath)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-[8px] cursor-pointer',
                    'hover:bg-[var(--md-sys-color-surface-container-high)]',
                    'text-left transition-colors',
                  )}
                >
                  <ArrowLeft className="h-4 w-4 text-[var(--md-sys-color-outline)]" />
                  <span className="text-[13px] text-[var(--md-sys-color-outline)]">..</span>
                </button>
              )}

              {/* Directories */}
              {visibleDirs.length === 0 && !parentPath && (
                <p className="text-center py-8 text-[13px] text-[var(--md-sys-color-outline)]">
                  Empty directory
                </p>
              )}
              {visibleDirs.map((dir) => (
                <button
                  key={dir.path}
                  type="button"
                  onClick={() => browseTo(dir.path)}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2 rounded-[8px] cursor-pointer',
                    'hover:bg-[var(--md-sys-color-surface-container-high)]',
                    'text-left transition-colors',
                  )}
                >
                  {dir.name === '.git' ? (
                    <GitBranch className="h-4 w-4 text-[var(--md-sys-color-tertiary)]" />
                  ) : (
                    <Folder className="h-4 w-4 text-[var(--md-sys-color-primary)]" />
                  )}
                  <span className="text-[13px] text-[var(--md-sys-color-on-surface)] truncate">
                    {dir.name}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>

        {/* Footer — selected path + name + import */}
        <div className="border-t border-[var(--md-sys-color-outline-variant)] px-5 py-4 space-y-3">
          {/* Selected path */}
          <div className="flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-[var(--md-sys-color-primary)] shrink-0" />
            <code className="text-[12px] text-[var(--md-sys-color-on-surface-variant)] font-mono truncate flex-1">
              {currentPath}
            </code>
            {isGitRepo && (
              <span className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium shrink-0',
                'bg-[color-mix(in_srgb,var(--md-sys-color-tertiary)_12%,transparent)]',
                'text-[var(--md-sys-color-tertiary)]',
              )}>
                <GitBranch className="h-3 w-3" />
                Git
              </span>
            )}
          </div>

          {/* Name input */}
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Project name"
            className={cn(
              'w-full px-3 py-2 rounded-[8px] text-[13px]',
              'bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface)]',
              'border border-[var(--md-sys-color-outline-variant)]',
              'focus:outline-none focus:border-[var(--md-sys-color-primary)]',
              'placeholder:text-[var(--md-sys-color-outline)]',
            )}
          />

          {error && (
            <p className="text-[12px] text-[var(--dcm-zone-red)]">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className={cn(
                'px-4 py-2 rounded-[8px] text-[13px] font-medium cursor-pointer',
                'text-[var(--md-sys-color-on-surface-variant)]',
                'hover:bg-[var(--md-sys-color-surface-container-high)]',
              )}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => createProject.mutate()}
              disabled={!currentPath || createProject.isPending}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-[8px] text-[13px] font-medium cursor-pointer',
                'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]',
                'hover:shadow-md transition-shadow',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              {createProject.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Import Project
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
