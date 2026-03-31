'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  GitBranch,
  Plus,
  Inbox,
  Search,
  Loader2,
  X,
  Upload,
  FileText,
  FolderOpen,
  ChevronUp,
  ChevronDown,
  Github,
  Lock,
  Globe,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import apiClient from '@/lib/api-client';
import { PipelineCard } from '@/components/pipeline/PipelineCard';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3847';

// ============================================
// New Pipeline Dialog
// ============================================

interface NewPipelineDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (pipelineId: string) => void;
}

function generateSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return `pipe-${ts}-${rand}`;
}

function parseGitRepoName(url: string): string | null {
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  return match?.[1] ?? null;
}

// ============================================
// Git Section Component
// ============================================

interface GitRepo {
  name: string;
  url: string;
  isPrivate: boolean;
  defaultBranch: string;
  pushedAt: string;
}

interface GitSectionProps {
  showGitConfig: boolean;
  setShowGitConfig: (v: boolean) => void;
  gitRepoUrl: string;
  setGitRepoUrl: (v: string) => void;
  gitBranch: string;
  setGitBranch: (v: string) => void;
  gitRepoName: string | null;
  setWorkspacePath: (v: string) => void;
  setSessionName: (v: string) => void;
  sessionName: string;
}

function GitSection({
  showGitConfig, setShowGitConfig,
  gitRepoUrl, setGitRepoUrl,
  gitBranch, setGitBranch,
  gitRepoName,
  setWorkspacePath, setSessionName, sessionName,
}: GitSectionProps) {
  const [ghStatus, setGhStatus] = useState<{
    authenticated: boolean;
    user: string | null;
    repos: GitRepo[];
    message?: string;
    loading: boolean;
  }>({ authenticated: false, user: null, repos: [], loading: false });

  const [repoSearch, setRepoSearch] = useState('');

  // Check GitHub status when section is opened
  useEffect(() => {
    if (!showGitConfig || ghStatus.loading || ghStatus.user !== null) return;
    setGhStatus((prev) => ({ ...prev, loading: true }));
    fetch(`${API_BASE_URL}/api/git/status`)
      .then((res) => res.json())
      .then((data) => {
        setGhStatus({
          authenticated: data.authenticated ?? false,
          user: data.user ?? null,
          repos: data.repos ?? [],
          message: data.message,
          loading: false,
        });
      })
      .catch(() => {
        setGhStatus({ authenticated: false, user: null, repos: [], message: 'Failed to check GitHub status', loading: false });
      });
  }, [showGitConfig, ghStatus.loading, ghStatus.user]);

  const filteredRepos = useMemo(() => {
    if (!repoSearch.trim()) return ghStatus.repos.slice(0, 15);
    const q = repoSearch.toLowerCase();
    return ghStatus.repos.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 15);
  }, [ghStatus.repos, repoSearch]);

  const selectRepo = (repo: GitRepo) => {
    setGitRepoUrl(repo.url.endsWith('.git') ? repo.url : `${repo.url}.git`);
    setGitBranch(repo.defaultBranch);
    const repoName = repo.name.split('/')[1] ?? repo.name;
    if (!sessionName.trim()) setSessionName(repoName);
    setWorkspacePath(`/home/${ghStatus.user ?? 'user'}/Projets/${repoName}`);
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setShowGitConfig(!showGitConfig)}
        className={cn(
          'flex items-center gap-2 text-[12px] font-medium cursor-pointer',
          'text-[var(--md-sys-color-primary)]',
          'hover:text-[var(--md-sys-color-on-primary-container)]',
          'transition-colors duration-200',
        )}
      >
        <Github className="h-3.5 w-3.5" />
        {showGitConfig ? 'Hide' : 'Connect'} Git Repository
        {showGitConfig ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {showGitConfig && (
        <div className="mt-2 space-y-3 p-3 rounded-[8px] bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)]">

          {/* GitHub connection status */}
          {ghStatus.loading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--md-sys-color-primary)]" />
              <span className="text-[12px] text-[var(--md-sys-color-outline)]">Checking GitHub connection...</span>
            </div>
          ) : ghStatus.authenticated ? (
            <div className="flex items-center gap-2 py-1">
              <CheckCircle2 className="h-4 w-4 text-[var(--dcm-zone-green)]" />
              <span className="text-[12px] text-[var(--md-sys-color-on-surface)]">
                Connected as <span className="font-semibold">{ghStatus.user}</span>
              </span>
              <span className="text-[10px] text-[var(--md-sys-color-outline)] ml-auto">
                {ghStatus.repos.length} repos
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 py-2 px-3 rounded-[6px] bg-[color-mix(in_srgb,var(--dcm-zone-orange)_8%,transparent)] border border-[color-mix(in_srgb,var(--dcm-zone-orange)_20%,transparent)]">
              <AlertCircle className="h-4 w-4 text-[var(--dcm-zone-orange)] shrink-0" />
              <div className="flex-1">
                <p className="text-[12px] font-medium text-[var(--md-sys-color-on-surface)]">
                  GitHub not connected
                </p>
                <p className="text-[10px] text-[var(--md-sys-color-outline)]">
                  Run in your terminal: <code className="px-1 py-0.5 rounded bg-[var(--md-sys-color-surface-container-high)] font-mono text-[10px]">gh auth login</code>
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setGhStatus((prev) => ({ ...prev, user: null, loading: false }));
                }}
                className="text-[11px] text-[var(--md-sys-color-primary)] font-medium cursor-pointer hover:underline shrink-0"
              >
                Retry
              </button>
            </div>
          )}

          {/* Repo picker (when authenticated) */}
          {ghStatus.authenticated && ghStatus.repos.length > 0 && (
            <div>
              <label className="block text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1">
                Select a repository
              </label>
              {ghStatus.repos.length > 5 && (
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[var(--md-sys-color-outline)]" />
                  <input
                    type="text"
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    placeholder="Search repos..."
                    className={cn(
                      'w-full pl-8 pr-3 py-1.5 rounded-[6px] text-[12px]',
                      'bg-[var(--md-sys-color-surface)]',
                      'border border-[var(--md-sys-color-outline-variant)]',
                      'text-[var(--md-sys-color-on-surface)]',
                      'placeholder:text-[var(--md-sys-color-outline)]',
                      'focus:outline-2 focus:outline-[var(--md-sys-color-primary)]',
                      'transition-colors duration-200',
                    )}
                  />
                </div>
              )}
              <div className="max-h-[160px] overflow-y-auto space-y-0.5 rounded-[6px] border border-[var(--md-sys-color-outline-variant)]">
                {filteredRepos.map((repo) => {
                  const isSelected = gitRepoUrl.includes(repo.name.split('/')[1] ?? '___');
                  return (
                    <button
                      key={repo.name}
                      type="button"
                      onClick={() => selectRepo(repo)}
                      className={cn(
                        'w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer',
                        'hover:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_6%,transparent)]',
                        'transition-colors duration-150',
                        isSelected && 'bg-[var(--md-sys-color-primary-container)]',
                      )}
                    >
                      {repo.isPrivate
                        ? <Lock className="h-3 w-3 text-[var(--md-sys-color-outline)] shrink-0" />
                        : <Globe className="h-3 w-3 text-[var(--md-sys-color-outline)] shrink-0" />}
                      <span className="text-[12px] text-[var(--md-sys-color-on-surface)] truncate flex-1 font-mono">
                        {repo.name}
                      </span>
                      {isSelected && <CheckCircle2 className="h-3 w-3 text-[var(--md-sys-color-primary)] shrink-0" />}
                    </button>
                  );
                })}
                {filteredRepos.length === 0 && (
                  <p className="px-3 py-2 text-[11px] text-[var(--md-sys-color-outline)]">No repos match</p>
                )}
              </div>
            </div>
          )}

          {/* Manual URL input (always available as fallback) */}
          <div>
            <label htmlFor="pipeline-git-url" className="block text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1">
              Or enter URL manually
            </label>
            <input
              id="pipeline-git-url"
              type="text"
              value={gitRepoUrl}
              onChange={(e) => setGitRepoUrl(e.target.value)}
              placeholder="https://github.com/user/repo.git"
              className={cn(
                'w-full px-3 py-2 rounded-[6px] text-[13px]',
                'bg-[var(--md-sys-color-surface)]',
                'border border-[var(--md-sys-color-outline-variant)]',
                'text-[var(--md-sys-color-on-surface)]',
                'placeholder:text-[var(--md-sys-color-outline)]',
                'focus:outline-2 focus:outline-[var(--md-sys-color-primary)]',
                'transition-colors duration-200',
              )}
            />
            {gitRepoName && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-[var(--dcm-zone-green)]" />
                <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
                  Repository: <span className="font-medium text-[var(--md-sys-color-on-surface)]">{gitRepoName}</span>
                </span>
              </div>
            )}
          </div>

          {/* Branch */}
          <div>
            <label htmlFor="pipeline-git-branch" className="block text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1">
              Branch
            </label>
            <input
              id="pipeline-git-branch"
              type="text"
              value={gitBranch}
              onChange={(e) => setGitBranch(e.target.value)}
              placeholder="main"
              className={cn(
                'w-full px-3 py-2 rounded-[6px] text-[13px]',
                'bg-[var(--md-sys-color-surface)]',
                'border border-[var(--md-sys-color-outline-variant)]',
                'text-[var(--md-sys-color-on-surface)]',
                'placeholder:text-[var(--md-sys-color-outline)]',
                'focus:outline-2 focus:outline-[var(--md-sys-color-primary)]',
                'transition-colors duration-200',
              )}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================
// New Pipeline Dialog
// ============================================

function NewPipelineDialog({ open, onClose, onCreated }: NewPipelineDialogProps) {
  const [sessionName, setSessionName] = useState('');
  const [sessionId] = useState(() => generateSessionId());
  const [instructions, setInstructions] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [workspacePath, setWorkspacePath] = useState('');
  const [gitRepoUrl, setGitRepoUrl] = useState('');
  const [gitBranch, setGitBranch] = useState('main');
  const [showGitConfig, setShowGitConfig] = useState(false);
  const [showDirBrowser, setShowDirBrowser] = useState(false);
  const [browsingPath, setBrowsingPath] = useState('');
  const [browseDirs, setBrowseDirs] = useState<Array<{ name: string; path: string }>>([]);
  const [browseParent, setBrowseParent] = useState<string | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const ALLOWED_EXTENSIONS = ['md', 'txt', 'json', 'ts', 'tsx', 'js', 'py', 'php', 'sql', 'sh', 'markdown'];

  // File handlers (for attachments only)
  const handleFiles = (newFiles: FileList | null) => {
    if (!newFiles) return;
    const valid = Array.from(newFiles).filter((f) => {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      return ALLOWED_EXTENSIONS.includes(ext) && f.size > 0;
    });
    setFiles((prev) => [...prev, ...valid]);
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  // Directory browser (for workspace only)
  const browseTo = async (path?: string) => {
    setBrowseLoading(true);
    try {
      const params = path ? `?path=${encodeURIComponent(path)}` : '';
      const res = await fetch(`${API_BASE_URL}/api/fs/browse${params}`);
      const data = await res.json();
      if (data.current) {
        setBrowsingPath(data.current);
        setBrowseDirs(data.dirs ?? []);
        setBrowseParent(data.parent ?? null);
      }
    } catch {
      // ignore
    } finally {
      setBrowseLoading(false);
    }
  };

  const openDirBrowser = () => {
    setShowDirBrowser(true);
    browseTo(workspacePath || undefined);
  };

  const selectDirectory = (path: string) => {
    setWorkspacePath(path);
    setShowDirBrowser(false);
    // Auto-fill session name from directory name
    const dirName = path.split('/').filter(Boolean).pop() ?? '';
    if (!sessionName.trim() && dirName) {
      setSessionName(dirName);
    }
  };

  const gitRepoName = gitRepoUrl.trim() ? parseGitRepoName(gitRepoUrl.trim()) : null;

  const createMutation = useMutation({
    mutationFn: async () => {
      const workspace = {
        path: workspacePath.trim(),
        ...(gitRepoUrl.trim() ? { git_repo_url: gitRepoUrl.trim() } : {}),
        ...(gitBranch.trim() !== 'main' ? { git_branch: gitBranch.trim() } : {}),
      };
      if (files.length > 0) {
        const formData = new FormData();
        formData.append('session_id', sessionId);
        formData.append('instructions', instructions.trim());
        formData.append('workspace_path', workspacePath.trim());
        if (gitRepoUrl.trim()) formData.append('git_repo_url', gitRepoUrl.trim());
        if (gitBranch.trim() !== 'main') formData.append('git_branch', gitBranch.trim());
        for (const file of files) {
          formData.append('files', file);
        }
        const res = await fetch(`${API_BASE_URL}/api/pipelines/upload`, {
          method: 'POST',
          body: formData,
        });
        return res.json();
      }
      return apiClient.createPipeline({
        session_id: sessionId,
        instructions: instructions.trim(),
        workspace,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['pipelines'] });
      onCreated(data.pipeline.id);
    },
  });

  const canSubmit =
    workspacePath.trim().length > 0 &&
    (instructions.trim().length > 0 || files.length > 0) &&
    !createMutation.isPending;

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
          'w-full max-w-lg mx-4 rounded-[16px] overflow-hidden max-h-[90vh] flex flex-col',
          'bg-[var(--md-sys-color-surface)] shadow-[var(--md-sys-elevation-3)]',
          'border border-[var(--md-sys-color-outline-variant)]',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--md-sys-color-outline-variant)] shrink-0">
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

        {/* Body — scrollable */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">
          {/* Session Name */}
          <div>
            <label htmlFor="pipeline-session-name" className="block text-[12px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1.5">
              Session Name
            </label>
            <input
              id="pipeline-session-name"
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder="My project"
              className={cn(
                'w-full px-3 py-2.5 rounded-[8px] text-[14px]',
                'bg-[var(--md-sys-color-surface-container)]',
                'border border-[var(--md-sys-color-outline-variant)]',
                'text-[var(--md-sys-color-on-surface)]',
                'placeholder:text-[var(--md-sys-color-outline)]',
                'focus:outline-2 focus:outline-[var(--md-sys-color-primary)]',
                'transition-colors duration-200',
              )}
            />
            <p className="text-[10px] text-[var(--md-sys-color-outline)] mt-1 font-mono select-all">
              ID: {sessionId}
            </p>
          </div>

          {/* Workspace Directory */}
          <div>
            <label htmlFor="pipeline-workspace" className="block text-[12px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1.5">
              Workspace Directory <span className="text-[var(--dcm-zone-red)]">*</span>
            </label>
            <div className="flex gap-2">
              <input
                id="pipeline-workspace"
                type="text"
                value={workspacePath}
                onChange={(e) => setWorkspacePath(e.target.value)}
                placeholder="/home/user/projects/my-project"
                className={cn(
                  'flex-1 px-3 py-2.5 rounded-[8px] text-[14px] font-mono',
                  'bg-[var(--md-sys-color-surface-container)]',
                  'border border-[var(--md-sys-color-outline-variant)]',
                  'text-[var(--md-sys-color-on-surface)]',
                  'placeholder:text-[var(--md-sys-color-outline)]',
                  'focus:outline-2 focus:outline-[var(--md-sys-color-primary)]',
                  'transition-colors duration-200',
                )}
              />
              <button
                type="button"
                onClick={openDirBrowser}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-[12px] font-medium cursor-pointer shrink-0',
                  'text-[var(--md-sys-color-primary)]',
                  'border border-[var(--md-sys-color-outline-variant)]',
                  'hover:bg-[var(--md-sys-color-surface-container-high)]',
                  'transition-colors duration-200',
                )}
                aria-label="Browse directories"
              >
                <FolderOpen className="h-4 w-4" />
                Browse
              </button>
            </div>

            {/* Inline directory browser */}
            {showDirBrowser && (
              <div className="mt-2 rounded-[8px] border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container)] overflow-hidden">
                {/* Current path */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-high)]">
                  <FolderOpen className="h-3.5 w-3.5 text-[var(--md-sys-color-primary)] shrink-0" />
                  <span className="text-[11px] font-mono text-[var(--md-sys-color-on-surface)] truncate flex-1">
                    {browsingPath}
                  </span>
                  <button
                    type="button"
                    onClick={() => selectDirectory(browsingPath)}
                    className={cn(
                      'px-2 py-1 rounded-[6px] text-[10px] font-semibold cursor-pointer shrink-0',
                      'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]',
                      'hover:shadow-sm transition-all duration-150',
                    )}
                  >
                    Select this folder
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDirBrowser(false)}
                    className="p-1 cursor-pointer hover:bg-[var(--md-sys-color-surface-container)] rounded-full"
                    aria-label="Close browser"
                  >
                    <X className="h-3 w-3 text-[var(--md-sys-color-outline)]" />
                  </button>
                </div>

                {browseLoading ? (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--md-sys-color-primary)]" />
                  </div>
                ) : (
                  <div className="max-h-[180px] overflow-y-auto">
                    {/* Parent directory */}
                    {browseParent && (
                      <button
                        type="button"
                        onClick={() => browseTo(browseParent)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_6%,transparent)] transition-colors duration-150"
                      >
                        <ChevronUp className="h-3.5 w-3.5 text-[var(--md-sys-color-outline)]" />
                        <span className="text-[12px] text-[var(--md-sys-color-outline)] italic">..</span>
                      </button>
                    )}
                    {/* Subdirectories */}
                    {browseDirs.map((dir) => (
                      <button
                        key={dir.path}
                        type="button"
                        onClick={() => browseTo(dir.path)}
                        onDoubleClick={() => selectDirectory(dir.path)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left cursor-pointer hover:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_6%,transparent)] transition-colors duration-150"
                      >
                        <FolderOpen className="h-3.5 w-3.5 text-[var(--md-sys-color-primary)] shrink-0" />
                        <span className="text-[12px] text-[var(--md-sys-color-on-surface)] truncate">{dir.name}</span>
                      </button>
                    ))}
                    {browseDirs.length === 0 && !browseParent && (
                      <p className="px-3 py-3 text-[11px] text-[var(--md-sys-color-outline)] text-center">Empty directory</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Git configuration */}
          <GitSection
            showGitConfig={showGitConfig}
            setShowGitConfig={setShowGitConfig}
            gitRepoUrl={gitRepoUrl}
            setGitRepoUrl={setGitRepoUrl}
            gitBranch={gitBranch}
            setGitBranch={setGitBranch}
            gitRepoName={gitRepoName}
            setWorkspacePath={setWorkspacePath}
            setSessionName={setSessionName}
            sessionName={sessionName}
          />

          {/* Instructions */}
          <div>
            <label htmlFor="pipeline-instructions" className="block text-[12px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1.5">
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
                'transition-colors duration-200',
              )}
            />
          </div>

          {/* File attachments (separate from workspace) */}
          <div>
            <label className="block text-[12px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-1.5">
              Attachments
            </label>
            <div
              className={cn(
                'relative rounded-[12px] border-2 border-dashed p-5 text-center transition-all duration-200',
                isDragging
                  ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-primary-container)]'
                  : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container)]',
                'hover:border-[var(--md-sys-color-primary)] hover:bg-[color-mix(in_srgb,var(--md-sys-color-primary)_4%,transparent)]',
              )}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.txt,.json,.ts,.tsx,.js,.py,.php,.sql,.sh,.markdown"
                multiple
                onChange={(e) => handleFiles(e.target.files)}
                className="hidden"
              />
              <Upload className="h-6 w-6 mx-auto mb-1.5 text-[var(--md-sys-color-outline)]" />
              <p className="text-[12px] text-[var(--md-sys-color-on-surface-variant)]">
                Drop files here or{' '}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="text-[var(--md-sys-color-primary)] font-medium cursor-pointer hover:underline"
                >
                  browse
                </button>
              </p>
              <p className="text-[10px] text-[var(--md-sys-color-outline)] mt-0.5">
                .md, .txt, .json, code files
              </p>
            </div>
          </div>

          {/* Attached files list */}
          {files.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-[var(--md-sys-color-on-surface-variant)]">
                {files.length} file{files.length > 1 ? 's' : ''} attached
              </p>
              {files.map((file, i) => (
                <div key={`${file.name}-${i}`} className="flex items-center gap-2 py-1 px-2 rounded-[6px] bg-[var(--md-sys-color-surface-container)]">
                  <FileText className="h-3.5 w-3.5 text-[var(--md-sys-color-outline)] shrink-0" />
                  <span className="text-[12px] text-[var(--md-sys-color-on-surface)] truncate flex-1">{file.name}</span>
                  <span className="text-[10px] text-[var(--md-sys-color-outline)] tabular-nums shrink-0">{(file.size / 1024).toFixed(1)}KB</span>
                  <button type="button" onClick={() => removeFile(i)} className="cursor-pointer p-0.5 hover:bg-[var(--md-sys-color-surface-container-high)] rounded-full" aria-label={`Remove ${file.name}`}>
                    <X className="h-3 w-3 text-[var(--md-sys-color-outline)]" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {createMutation.error && (
            <p className="text-[12px] text-[var(--dcm-zone-red)]">
              Failed to create pipeline. Please try again.
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[var(--md-sys-color-outline-variant)] shrink-0">
          <button type="button" onClick={onClose} className={cn('px-4 py-2.5 rounded-[8px] text-[13px] font-medium cursor-pointer', 'text-[var(--md-sys-color-on-surface-variant)]', 'hover:bg-[var(--md-sys-color-surface-container-high)]', 'transition-colors duration-200')}>
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
