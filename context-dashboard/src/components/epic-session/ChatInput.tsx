'use client';

import { useRef, useState, useCallback } from 'react';
import { SendHorizonal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

const MIN_ROWS = 2;
const MAX_ROWS = 5;

export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Décrivez ce que vous souhaitez brainstormer...',
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Reset height to measure scrollHeight correctly
    el.style.height = 'auto';
    const lineHeight = parseInt(getComputedStyle(el).lineHeight, 10) || 20;
    const minH = MIN_ROWS * lineHeight;
    const maxH = MAX_ROWS * lineHeight;
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minH), maxH)}px`;
  }, []);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setValue(e.target.value);
      adjustHeight();
    },
    [adjustHeight]
  );

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue('');
    // Reset height after send
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
    }
  }, [value, disabled, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const canSend = value.trim().length > 0 && !disabled;

  return (
    <div className="flex items-end gap-2 px-4 py-3 border-t border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)]">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        rows={MIN_ROWS}
        aria-label="Message"
        className={cn(
          'flex-1 resize-none rounded-xl border border-[var(--md-sys-color-outline-variant)]',
          'bg-[var(--md-sys-color-surface-container-low)] text-[var(--md-sys-color-on-surface)]',
          'px-3.5 py-2.5 text-sm leading-relaxed',
          'placeholder:text-[var(--md-sys-color-on-surface-variant)]',
          'focus:outline-none focus:border-[var(--md-sys-color-primary)] focus:ring-1 focus:ring-[var(--md-sys-color-primary)]',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'transition-[border-color,box-shadow]'
        )}
        style={{ minHeight: `${MIN_ROWS * 20}px` }}
      />

      <Button
        type="button"
        size="icon"
        onClick={handleSend}
        disabled={!canSend}
        aria-label="Envoyer"
        className={cn(
          'flex-shrink-0 size-10 rounded-xl',
          'bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]',
          'hover:bg-[var(--md-sys-color-primary)]/90',
          'disabled:opacity-40 disabled:cursor-not-allowed',
          'transition-opacity'
        )}
      >
        <SendHorizonal className="size-4" />
      </Button>
    </div>
  );
}
