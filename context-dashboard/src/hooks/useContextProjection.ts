'use client';

import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import type { TokenProjection } from '@/lib/api-client';

// Alias for backward compatibility with existing consumers
export type ProjectionData = TokenProjection;

// ============================================
// useContextProjection Hook
// ============================================

export function useContextProjection(sessionId: string | null) {
  const [data, setData] = useState<ProjectionData | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchProjection = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const json = await apiClient.getTokenProjection(sessionId);
      setData(json);
    } catch {
      // Silent fail — will retry on next interval
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    fetchProjection();
    // Refresh every 30s — no WebSocket events for projections, REST only
    const interval = setInterval(fetchProjection, 30000);
    return () => clearInterval(interval);
  }, [fetchProjection]);

  return { data, loading, refetch: fetchProjection };
}
