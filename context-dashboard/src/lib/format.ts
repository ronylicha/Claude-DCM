/**
 * Shared formatting utilities — single source of truth.
 * Replaces 16+ duplicate definitions across cockpit, status bar, and pages.
 */

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function formatModel(modelId: string | null | undefined): string {
  if (!modelId || modelId === 'unknown') return 'Unknown';
  const lower = modelId.toLowerCase();
  if (lower.includes('opus')) return 'Opus';
  if (lower.includes('sonnet')) return 'Sonnet';
  if (lower.includes('haiku')) return 'Haiku';
  return modelId;
}

export function relativeTime(timestamp: number | string): string {
  const ts = typeof timestamp === 'string' ? new Date(timestamp).getTime() : timestamp;
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 1) return 'now';
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

export type EventCategory = 'task' | 'subtask' | 'message' | 'agent' | 'system';

export function getEventCategory(eventType: string): EventCategory {
  if (eventType.startsWith('task.')) return 'task';
  if (eventType.startsWith('subtask.')) return 'subtask';
  if (eventType.startsWith('message.')) return 'message';
  if (eventType.startsWith('agent.')) return 'agent';
  return 'system';
}

export function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}
