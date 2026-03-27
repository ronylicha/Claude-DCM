'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWebSocket, type WSEvent } from './useWebSocket';
import { apiClient } from '@/lib/api-client';
import type { MiniCockpitData } from '@/lib/api-client';

export type { MiniCockpitData };

// ============================================
// useSessionGrid Hook
// ============================================

export function useSessionGrid() {
  const [sessions, setSessions] = useState<MiniCockpitData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGrid = useCallback(async () => {
    try {
      const json = await apiClient.getCockpitGrid();
      setSessions(json.sessions || []);
    } catch {
      // Silent fail — will retry on next interval
    } finally {
      setLoading(false);
    }
  }, []);

  const handleEvent = useCallback(
    (event: WSEvent) => {
      if (event.event === 'capacity.update') {
        const payload = event.data as Record<string, unknown>;
        const realTokens = payload.real_tokens as Record<string, number> | undefined;
        setSessions(prev =>
          prev.map(s => {
            if (s.session_id !== payload.session_id) return s;
            return {
              ...s,
              context: {
                ...s.context,
                used_percentage: payload.used_percentage as number,
                zone: payload.zone as string,
                consumption_rate: payload.consumption_rate as number,
                predicted_exhaustion_minutes: payload.predicted_exhaustion_minutes as number | null,
                current_usage: realTokens?.total ?? s.context.current_usage,
                source: (payload.source as string) ?? s.context.source,
              },
            };
          })
        );
        return;
      }

      if (event.event === 'summary.status') {
        const payload = event.data as Record<string, unknown>;
        setSessions(prev =>
          prev.map(s => {
            if (s.session_id !== payload.session_id) return s;
            return {
              ...s,
              preemptive_summary: { status: payload.status as string },
            };
          })
        );
        return;
      }

      if (event.event === 'cockpit.refresh') {
        fetchGrid();
      }
    },
    [fetchGrid]
  );

  const { connected, subscribe } = useWebSocket({
    channels: ['global'],
    onEvent: handleEvent,
  });

  // Initial fetch
  useEffect(() => {
    fetchGrid();
  }, [fetchGrid]);

  // Subscribe to global channel once connected
  useEffect(() => {
    if (!connected) return;
    subscribe('global');
  }, [connected, subscribe]);

  // Polling fallback every 15s when WebSocket is not available
  useEffect(() => {
    if (connected) return;
    const interval = setInterval(fetchGrid, 15000);
    return () => clearInterval(interval);
  }, [connected, fetchGrid]);

  return { sessions, loading, refetch: fetchGrid };
}
