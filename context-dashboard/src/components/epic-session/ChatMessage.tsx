'use client';

import { cn } from '@/lib/utils';

interface ChatMessageProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  contentType: 'text' | 'markdown' | 'task_proposal';
  createdAt: string;
  isStreaming?: boolean;
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return '';
  }
}

export function ChatMessage({
  role,
  content,
  createdAt,
  isStreaming = false,
}: ChatMessageProps) {
  if (role === 'system') {
    return (
      <div className="flex justify-center py-1">
        <span className="text-xs text-[var(--md-sys-color-outline)] bg-[var(--md-sys-color-surface-container)] px-3 py-1 rounded-full">
          {content}
        </span>
      </div>
    );
  }

  const isUser = role === 'user';

  return (
    <div
      className={cn(
        'flex gap-2 px-4 py-1',
        isUser ? 'flex-row-reverse' : 'flex-row'
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex-shrink-0 size-7 rounded-full flex items-center justify-center text-xs font-semibold mt-0.5',
          isUser
            ? 'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]'
            : 'bg-[var(--md-sys-color-secondary-container)] text-[var(--md-sys-color-on-secondary-container)]'
        )}
      >
        {isUser ? 'U' : 'AI'}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          'flex flex-col gap-1 max-w-[78%]',
          isUser ? 'items-end' : 'items-start'
        )}
      >
        <div
          className={cn(
            'rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words',
            isUser
              ? 'rounded-tr-sm bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]'
              : 'rounded-tl-sm bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface)]'
          )}
        >
          {content}
          {isStreaming && (
            <span
              aria-hidden="true"
              className="inline-block w-[2px] h-[1em] ml-0.5 align-text-bottom bg-[var(--md-sys-color-on-surface)] opacity-80 animate-[blink_1s_step-end_infinite]"
            />
          )}
        </div>

        <span className="text-[10px] text-[var(--md-sys-color-outline)] px-1">
          {formatTime(createdAt)}
        </span>
      </div>
    </div>
  );
}
