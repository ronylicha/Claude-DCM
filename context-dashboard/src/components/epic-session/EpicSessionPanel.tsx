'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWebSocket } from '@/hooks/useWebSocket';
import type { WSEvent } from '@/hooks/useWebSocket';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { TaskProposalCard } from './TaskProposalCard';
import { SessionToolbar } from './SessionToolbar';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3847';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  content_type: string;
  created_at: string;
}

interface ProposedTask {
  id: string;
  title: string;
  description?: string;
  agent_type: string;
  model: string;
  status: 'proposed' | 'approved' | 'rejected' | 'executing' | 'completed' | 'failed';
}

interface EpicSessionPanelProps {
  epicId: string;
  epicTitle: string;
  projectId: string;
  open: boolean;
  onClose: () => void;
}

export function EpicSessionPanel({ epicId, epicTitle, projectId, open, onClose }: EpicSessionPanelProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [proposedTasks, setProposedTasks] = useState<ProposedTask[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [autoExecute, setAutoExecute] = useState(false);
  const [model] = useState('claude-opus-4-6');
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      });
    }
  }, []);

  // Create session on mount
  useEffect(() => {
    if (!open || sessionId) return;
    const create = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/projects/${projectId}/epics/${epicId}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, auto_execute: autoExecute }),
        });
        const data = await res.json();
        if (data.success && data.session) {
          setSessionId(data.session.id);
          setMessages([{
            id: 'system-init',
            role: 'system',
            content: `Session started for epic: ${epicTitle}`,
            content_type: 'text',
            created_at: new Date().toISOString(),
          }]);
        } else {
          setError(data.error ?? 'Failed to create session');
        }
      } catch {
        setError('Failed to create session');
      }
    };
    create();
  }, [open, epicId, projectId, epicTitle, model, autoExecute, sessionId]);

  // WebSocket events
  const handleWSEvent = useCallback((event: WSEvent) => {
    const data = event.data as Record<string, unknown> | null;
    if (!data || data.session_id !== sessionId) return;

    switch (event.event) {
      case 'epic.session.stream':
        setIsStreaming(true);
        setStreamingText((prev) => prev + (data.chunk as string ?? ''));
        scrollToBottom();
        break;

      case 'epic.session.message': {
        setIsStreaming(false);
        const msg = data.message as Message | undefined;
        if (msg) {
          setMessages((prev) => [...prev, msg]);
          setStreamingText('');
        }
        scrollToBottom();
        break;
      }

      case 'epic.task.proposed': {
        const task = data.task as ProposedTask | undefined;
        if (task) {
          setProposedTasks((prev) => {
            if (prev.some((t) => t.id === task.id)) return prev;
            return [...prev, task];
          });
        }
        scrollToBottom();
        break;
      }

      case 'epic.task.approved':
      case 'epic.task.rejected':
      case 'epic.task.executing':
      case 'epic.task.completed':
      case 'epic.task.failed': {
        const taskId = data.task_id as string;
        const newStatus = data.status as ProposedTask['status'];
        if (taskId && newStatus) {
          setProposedTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
          );
        }
        break;
      }

      case 'epic.session.ended':
        setIsStreaming(false);
        break;
    }
  }, [sessionId, scrollToBottom]);

  useWebSocket({
    channels: sessionId ? [`epic-sessions/${sessionId}`] : [],
    onEvent: handleWSEvent,
  });

  // Send message
  const handleSend = useCallback(async (content: string) => {
    if (!sessionId) return;
    // Optimistic add
    setMessages((prev) => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      content_type: 'text',
      created_at: new Date().toISOString(),
    }]);
    setIsStreaming(true);
    setStreamingText('');
    scrollToBottom();

    try {
      await fetch(`${API_BASE_URL}/api/epic-sessions/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
    } catch {
      setError('Failed to send message');
      setIsStreaming(false);
    }
  }, [sessionId, scrollToBottom]);

  // Approve/reject task
  const handleApprove = useCallback(async (taskId: string) => {
    if (!sessionId) return;
    setProposedTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: 'approved' } : t)));
    await fetch(`${API_BASE_URL}/api/epic-sessions/${sessionId}/tasks/${taskId}/approve`, { method: 'POST' });
  }, [sessionId]);

  const handleReject = useCallback(async (taskId: string) => {
    if (!sessionId) return;
    setProposedTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: 'rejected' } : t)));
    await fetch(`${API_BASE_URL}/api/epic-sessions/${sessionId}/tasks/${taskId}/reject`, { method: 'POST' });
  }, [sessionId]);

  // Execute all approved
  const handleExecuteAll = useCallback(async () => {
    if (!sessionId) return;
    await fetch(`${API_BASE_URL}/api/epic-sessions/${sessionId}/execute-all`, { method: 'POST' });
  }, [sessionId]);

  // End session
  const handleEndSession = useCallback(async () => {
    if (!sessionId) return;
    await fetch(`${API_BASE_URL}/api/epic-sessions/${sessionId}/end`, { method: 'POST' });
    onClose();
  }, [sessionId, onClose]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!open) return null;

  const hasApprovedTasks = proposedTasks.some((t) => t.status === 'approved');

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

      {/* Panel */}
      <div
        className={cn(
          'relative w-full max-w-[600px] h-full flex flex-col',
          'bg-[var(--md-sys-color-surface)] border-l border-[var(--md-sys-color-outline-variant)]',
          'shadow-2xl',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--md-sys-color-outline-variant)]">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-[var(--md-sys-color-on-surface)] truncate">
              {epicTitle}
            </h2>
            <p className="text-[11px] text-[var(--md-sys-color-outline)]">
              Brainstorm &amp; task creation
            </p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-full hover:bg-[var(--md-sys-color-surface-container-high)] cursor-pointer">
            <X className="h-4 w-4 text-[var(--md-sys-color-on-surface-variant)]" />
          </button>
        </div>

        {/* Toolbar */}
        {sessionId && (
          <SessionToolbar
            model={model}
            autoExecute={autoExecute}
            onToggleAutoExecute={() => setAutoExecute(!autoExecute)}
            onEndSession={handleEndSession}
            onExecuteAll={handleExecuteAll}
            hasApprovedTasks={hasApprovedTasks}
            isActive={isStreaming}
          />
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {!sessionId && !error && (
            <div className="flex items-center justify-center h-full gap-2 text-[13px] text-[var(--md-sys-color-outline)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating session...
            </div>
          )}
          {error && (
            <div className="p-3 rounded-[8px] bg-[color-mix(in_srgb,var(--dcm-zone-red)_10%,transparent)] text-[12px] text-[var(--dcm-zone-red)]">
              {error}
            </div>
          )}

          {messages.map((msg) => (
            <ChatMessage
              key={msg.id}
              role={msg.role}
              content={msg.content}
              contentType={msg.content_type as 'text' | 'markdown' | 'task_proposal'}
              createdAt={msg.created_at}
            />
          ))}

          {/* Streaming assistant message */}
          {isStreaming && streamingText && (
            <ChatMessage
              role="assistant"
              content={streamingText}
              contentType="text"
              createdAt={new Date().toISOString()}
              isStreaming
            />
          )}

          {/* Proposed tasks inline */}
          {proposedTasks.length > 0 && (
            <div className="space-y-1">
              {proposedTasks.map((task) => (
                <TaskProposalCard
                  key={task.id}
                  task={task}
                  onApprove={handleApprove}
                  onReject={handleReject}
                />
              ))}
            </div>
          )}
        </div>

        {/* Input */}
        <ChatInput
          onSend={handleSend}
          disabled={!sessionId || isStreaming}
          placeholder={isStreaming ? 'Claude is thinking...' : 'Describe what you want to build...'}
        />
      </div>
    </div>
  );
}
