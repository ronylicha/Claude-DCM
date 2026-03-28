'use client';

import { useState, useEffect, useCallback } from 'react';
import { useWebSocket, type WSEvent } from './useWebSocket';

// ============================================
// Types
// ============================================

export interface TopologyNode {
  session_id: string;
  project_name: string;
  used_percentage: number;
  zone: string;
  model_id: string;
  active_agents: number;
  last_action_at: string | null;
}

export interface TopologyEdge {
  from_session: string;
  to_session: string;
  type: 'info' | 'directive' | 'conflict';
  topic: string;
  message_preview: string;
  created_at: string;
}

export interface TopologyConflict {
  file_path: string;
  sessions: string[];
  detected_at: string;
  resolved: boolean;
}

export interface OrchestratorStatus {
  status: 'active' | 'inactive';
  last_heartbeat: string | null;
  total_directives: number;
  total_conflicts: number;
}

export interface TopologyData {
  orchestrator: OrchestratorStatus;
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  conflicts: TopologyConflict[];
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3847';

// ============================================
// Hook
// ============================================

export function useOrchestratorTopology() {
  const [data, setData] = useState<TopologyData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTopology = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/orchestrator/topology`);
      if (res.ok) {
        const json = await res.json() as TopologyData;
        setData(json);
      }
    } catch {
      // Silent fail — server may not expose this endpoint yet
    } finally {
      setLoading(false);
    }
  }, []);

  const handleEvent = useCallback(
    (event: WSEvent) => {
      if (
        event.event.startsWith('capacity.') ||
        event.event.startsWith('orchestrator.') ||
        event.event === 'cockpit.refresh'
      ) {
        fetchTopology();
      }
    },
    [fetchTopology]
  );

  const { connected, subscribe } = useWebSocket({
    channels: ['global'],
    onEvent: handleEvent,
  });

  // Initial fetch
  useEffect(() => {
    fetchTopology();
  }, [fetchTopology]);

  // Subscribe once connected
  useEffect(() => {
    if (!connected) return;
    subscribe('global');
  }, [connected, subscribe]);

  // Polling fallback every 15s when WebSocket is unavailable
  useEffect(() => {
    if (connected) return;
    const interval = setInterval(fetchTopology, 15_000);
    return () => clearInterval(interval);
  }, [connected, fetchTopology]);

  return { data, loading, refetch: fetchTopology };
}
