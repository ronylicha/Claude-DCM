'use client';

import {
  Activity,
  Bot,
  FileText,
  FolderSearch,
  Loader2,
  Pencil,
  Search,
  Sparkles,
  Terminal,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ============================================
// Types (shared)
// ============================================

export interface StreamEvent {
  kind: string;
  [key: string]: unknown;
}

export interface EventGroup {
  kind: string;
  events: StreamEvent[];
}

// ============================================
// Grouping logic
// ============================================

export function groupStreamEvents(events: StreamEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  for (const evt of events) {
    const last = groups[groups.length - 1];
    if (
      (evt.kind === 'skill' && last?.kind === 'skill') ||
      (evt.kind === 'action' && last?.kind === 'action') ||
      (evt.kind === 'system' && last?.kind === 'system') ||
      (evt.kind === 'thinking' && last?.kind === 'thinking')
    ) {
      last.events.push(evt);
    } else {
      groups.push({ kind: evt.kind, events: [evt] });
    }
  }
  return groups;
}

// ============================================
// Parse raw text/JSON into StreamEvents
// ============================================

export function parseChunkToEvents(chunk: string): StreamEvent[] {
  // Try parsing as JSON first
  try {
    const parsed = JSON.parse(chunk);
    if (parsed.kind) return [parsed];
  } catch { /* not JSON */ }

  // Try parsing as multiple JSON objects (one per line)
  const events: StreamEvent[] = [];
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed.kind) events.push(parsed);
    } catch { /* not JSON, treat as text */ }
  }
  if (events.length > 0) return events;

  // Fallback: plain text
  if (chunk.trim()) {
    return [{ kind: 'text', content: chunk }];
  }
  return [];
}

// ============================================
// Rendering
// ============================================

const ACTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Read: FileText,
  Write: Pencil,
  Edit: Pencil,
  Grep: Search,
  Glob: FolderSearch,
  Bash: Terminal,
};

export function EventBlock({ group }: { group: EventGroup }) {
  switch (group.kind) {
    case 'skill':
      return (
        <div
          className={cn(
            'rounded-[12px] p-3',
            'bg-[color-mix(in_srgb,var(--md-sys-color-tertiary)_8%,transparent)]',
            'border border-[color-mix(in_srgb,var(--md-sys-color-tertiary)_20%,transparent)]',
          )}
        >
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="h-3.5 w-3.5 text-[var(--md-sys-color-tertiary)]" />
            <span className="text-[11px] font-semibold text-[var(--md-sys-color-tertiary)] uppercase tracking-wider">
              Skills
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {group.events.map((e, i) => (
              <span
                key={i}
                className={cn(
                  'inline-flex px-2.5 py-1 rounded-full text-[11px] font-medium',
                  'bg-[var(--md-sys-color-tertiary-container)] text-[var(--md-sys-color-on-tertiary-container)]',
                )}
              >
                {e.name as string}
              </span>
            ))}
          </div>
        </div>
      );

    case 'action':
      return (
        <div
          className={cn(
            'rounded-[12px] p-3',
            'bg-[var(--md-sys-color-surface-container)]',
            'border border-[var(--md-sys-color-outline-variant)]',
          )}
        >
          <div className="space-y-1.5">
            {group.events.map((e, i) => {
              const Icon = ACTION_ICONS[e.tool as string] ?? Activity;
              const label = (e.label as string) ?? (e.tool as string) ?? '';
              const detail = (e.detail as string) ?? '';
              return (
                <div key={i} className="flex items-start gap-2 text-[12px]">
                  <Icon className="h-3.5 w-3.5 text-[var(--md-sys-color-primary)] shrink-0 mt-0.5" />
                  <span className="font-medium text-[var(--md-sys-color-on-surface-variant)] shrink-0">
                    {label}
                  </span>
                  {detail ? (
                    <span className="text-[var(--md-sys-color-outline)] truncate font-mono text-[11px]">
                      {detail}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      );

    case 'text':
      return (
        <div
          className={cn(
            'rounded-[12px] p-4',
            'bg-[var(--md-sys-color-primary-container)]',
            'border border-[color-mix(in_srgb,var(--md-sys-color-primary)_20%,transparent)]',
          )}
        >
          <p className="text-[13px] leading-relaxed text-[var(--md-sys-color-on-primary-container)] whitespace-pre-wrap">
            {group.events.map((e) => e.content as string).join('\n')}
          </p>
        </div>
      );

    case 'agent':
      return (
        <div
          className={cn(
            'rounded-[12px] p-3',
            'bg-[color-mix(in_srgb,var(--dcm-zone-green)_8%,transparent)]',
            'border border-[color-mix(in_srgb,var(--dcm-zone-green)_20%,transparent)]',
          )}
        >
          {group.events.map((e, i) => (
            <div key={i} className="flex items-center gap-2">
              <Bot className="h-3.5 w-3.5 text-[var(--dcm-zone-green)]" />
              {(e.agent as string) ? (
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--dcm-zone-green)_15%,transparent)] text-[var(--dcm-zone-green)]">
                  {e.agent as string}
                </span>
              ) : null}
              <span className="text-[12px] text-[var(--md-sys-color-on-surface)]">
                {(e.description as string) ?? ''}
              </span>
            </div>
          ))}
        </div>
      );

    case 'thinking':
      return (
        <div className="flex items-center gap-2 py-1 px-1">
          <Loader2 className="h-3.5 w-3.5 text-[var(--md-sys-color-outline)] animate-spin" />
          <span className="text-[11px] text-[var(--md-sys-color-outline)] italic">
            Thinking...
          </span>
        </div>
      );

    case 'system':
      return (
        <div className="flex items-center gap-2 py-1 px-1">
          <Zap className="h-3 w-3 text-[var(--md-sys-color-outline)]" />
          <span className="text-[11px] text-[var(--md-sys-color-outline)]">
            {group.events.map((e) => e.label as string).join(', ')}
          </span>
        </div>
      );

    default:
      return null;
  }
}
