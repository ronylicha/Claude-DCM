'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWebSocket, type WSEvent } from './useWebSocket';
import { apiClient } from '@/lib/api-client';
import type { GlobalCapacity, SessionCapacity } from '@/lib/api-client';

export type { GlobalCapacity, SessionCapacity };

// ============================================
// Types
// ============================================

export interface ThresholdAlert {
  session_id: string;
  threshold: number;
  zone: string;
  previous_zone: string;
  timestamp: string;
}

// ============================================
// useGlobalCapacity Hook
// ============================================

export function useGlobalCapacity() {
  const [data, setData] = useState<GlobalCapacity | null>(null);
  const [alerts, setAlerts] = useState<ThresholdAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const handleEvent = useCallback((event: WSEvent) => {
    if (event.event === 'capacity.update') {
      const payload = event.data as Record<string, unknown>;
      setData(prev => {
        if (!prev) return prev;
        const sessions = prev.tokens.by_session.map(s => {
          if (s.session_id !== payload.session_id) return s;
          return {
            ...s,
            used_percentage: payload.used_percentage as number,
            zone: payload.zone as string,
            predicted_exhaustion_minutes: payload.predicted_exhaustion_minutes as number | null,
          };
        });
        return {
          ...prev,
          tokens: {
            ...prev.tokens,
            by_session: sessions,
            total_rate: (payload.consumption_rate as number) ?? prev.tokens.total_rate,
          },
        };
      });
      return;
    }

    if (event.event === 'capacity.threshold') {
      const payload = event.data as Record<string, unknown>;
      setAlerts(prev => [
        ...prev.slice(-9),
        {
          session_id: payload.session_id as string,
          threshold: payload.threshold as number,
          zone: payload.zone as string,
          previous_zone: payload.previous_zone as string,
          timestamp: new Date().toISOString(),
        },
      ]);
    }
  }, []);

  const { connected, subscribe } = useWebSocket({
    channels: ['global'],
    onEvent: handleEvent,
  });

  const fetchData = useCallback(async () => {
    try {
      const json = await apiClient.getCockpitGlobal();
      setData(json);
    } catch {
      // Silent fail — will retry on next interval
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Subscribe to global channel once connected
  useEffect(() => {
    if (!connected) return;
    subscribe('global');
  }, [connected, subscribe]);

  // Polling fallback every 10s when WebSocket is not available
  useEffect(() => {
    if (connected) return;
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [connected, fetchData]);

  const dismissAlert = useCallback((index: number) => {
    setAlerts(prev => prev.filter((_, i) => i !== index));
  }, []);

  return { data, loading, alerts, dismissAlert, refetch: fetchData };
}
