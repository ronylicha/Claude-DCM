'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWebSocket, type WSEvent } from './useWebSocket';

// ============================================
// Types
// ============================================

export type SummaryStatusValue = 'none' | 'generating' | 'ready' | 'consumed' | 'failed';

export interface SummaryStatus {
  session_id: string;
  status: SummaryStatusValue;
  created_at?: string;
}

// ============================================
// usePreemptiveSummary Hook
// ============================================

export function usePreemptiveSummary(sessionId?: string) {
  const [summaries, setSummaries] = useState<Map<string, SummaryStatus>>(new Map());

  const handleEvent = useCallback(
    (event: WSEvent) => {
      if (event.event !== 'summary.status') return;

      const payload = event.data as Record<string, unknown>;
      const eventSessionId = payload.session_id as string;

      // If a specific sessionId filter is set, ignore events for other sessions
      if (sessionId && eventSessionId !== sessionId) return;

      setSummaries(prev => {
        const next = new Map(prev);
        next.set(eventSessionId, {
          session_id: eventSessionId,
          status: (payload.status as SummaryStatusValue) ?? 'none',
          created_at: (payload.created_at as string) ?? new Date().toISOString(),
        });
        return next;
      });
    },
    [sessionId]
  );

  const { connected, subscribe } = useWebSocket({
    channels: ['global'],
    onEvent: handleEvent,
  });

  // Subscribe to global channel once connected
  useEffect(() => {
    if (!connected) return;
    subscribe('global');
  }, [connected, subscribe]);

  const getStatus = useCallback(
    (sid: string): SummaryStatus => {
      return summaries.get(sid) ?? { session_id: sid, status: 'none' };
    },
    [summaries]
  );

  return { summaries, getStatus };
}
