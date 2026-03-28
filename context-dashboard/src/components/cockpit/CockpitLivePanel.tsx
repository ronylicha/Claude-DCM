'use client';

import { useState, useEffect, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { useRealtimeEvents, useRealtimeMetrics } from '@/hooks/useWebSocket';
import apiClient from '@/lib/api-client';
import { Activity, Users, Zap, MessageSquare, Radio, ChevronDown, ChevronUp } from 'lucide-react';

// ============================================
// Types & Config
// ============================================

type EventCategory = 'task' | 'subtask' | 'message' | 'agent' | 'system';

function getEventCategory(eventType: string): EventCategory {
  if (eventType.startsWith('task.')) return 'task';
  if (eventType.startsWith('subtask.')) return 'subtask';
  if (eventType.startsWith('message.')) return 'message';
  if (eventType.startsWith('agent.')) return 'agent';
  return 'system';
}

const CAT_COLORS: Record<EventCategory, { text: string; border: string }> = {
  task:    { text: 'text-[var(--md-sys-color-tertiary)]', border: 'border-[var(--md-sys-color-outline-variant)]' },
  subtask: { text: 'text-[var(--md-sys-color-primary)]', border: 'border-[var(--md-sys-color-outline-variant)]' },
  message: { text: 'text-[var(--dcm-zone-green)]', border: 'border-[color-mix(in_srgb,var(--dcm-zone-green)_25%,transparent)]' },
  agent:   { text: 'text-[var(--dcm-zone-orange)]', border: 'border-[color-mix(in_srgb,var(--dcm-zone-orange)_25%,transparent)]' },
  system:  { text: 'text-[var(--md-sys-color-on-surface-variant)]', border: 'border-[var(--md-sys-color-outline-variant)]' },
};

function CatIcon({ category }: { category: EventCategory }) {
  const cls = 'h-3.5 w-3.5';
  switch (category) {
    case 'task':    return <Activity className={cls} />;
    case 'subtask': return <Zap className={cls} />;
    case 'message': return <MessageSquare className={cls} />;
    case 'agent':   return <Users className={cls} />;
    default:        return <Radio className={cls} />;
  }
}

function relativeTime(timestamp: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diff < 1) return 'now';
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  return `${Math.floor(diff / 3600)}h`;
}

// ============================================
// Agent topology
// ============================================

interface AgentInfo {
  id: string;
  type?: string;
  active: boolean;
}

const AGENT_COLORS = [
  'bg-[var(--md-sys-color-tertiary-container)] text-[var(--md-sys-color-on-tertiary-container)] border-[var(--md-sys-color-outline-variant)]',
  'bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)] border-[var(--md-sys-color-outline-variant)]',
  'bg-[color-mix(in_srgb,var(--dcm-zone-green)_15%,transparent)] text-[var(--dcm-zone-green)] border-[color-mix(in_srgb,var(--dcm-zone-green)_30%,transparent)]',
  'bg-[color-mix(in_srgb,var(--dcm-zone-orange)_15%,transparent)] text-[var(--dcm-zone-orange)] border-[color-mix(in_srgb,var(--dcm-zone-orange)_30%,transparent)]',
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}

// ============================================
// CockpitLivePanel
// ============================================

export function CockpitLivePanel() {
  const [expanded, setExpanded] = useState(false);
  const [agents, setAgents] = useState<Map<string, AgentInfo>>(new Map());
  const [, setTick] = useState(0);

  const { connected: metricsConnected } = useRealtimeMetrics();
  const { events, connected: eventsConnected } = useRealtimeEvents({ channels: ['global'], maxEvents: 30 });

  const isConnected = eventsConnected || metricsConnected;

  useEffect(() => {
    if (!expanded) return;
    const interval = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(interval);
  }, [expanded]);

  useEffect(() => {
    let cancelled = false;
    async function fetchAgents() {
      try {
        const resp = await apiClient.getActiveSessions();
        if (cancelled || !resp.active_agents) return;
        setAgents(prev => {
          const next = new Map(prev);
          for (const a of resp.active_agents!) {
            const id = a.agent_id || a.subtask_id || a.agent_type;
            if (id && !next.has(id)) next.set(id, { id, type: a.agent_type, active: true });
          }
          return next;
        });
      } catch { /* non-blocking */ }
    }
    fetchAgents();
    const interval = setInterval(fetchAgents, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (events.length === 0) return;
    const latest = events[0];
    const data = latest?.data as Record<string, unknown>;
    const agentId = data?.agent_id as string | undefined;
    if (!agentId) return;
    if (latest.event === 'agent.connected') {
      setAgents(prev => { const next = new Map(prev); next.set(agentId, { id: agentId, type: data.agent_type as string, active: true }); return next; });
    } else if (latest.event === 'agent.disconnected') {
      setAgents(prev => { const next = new Map(prev); next.delete(agentId); return next; });
    }
  }, [events]);

  const agentList = useMemo(() => Array.from(agents.values()), [agents]);
  const visibleEvents = events.slice(0, 20);

  return (
    <div className="rounded-md-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-low)] overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--md-sys-color-surface-container)] transition-colors"
      >
        <Activity className="h-4 w-4 text-[var(--md-sys-color-primary)]" />
        <span className="text-[14px] font-medium text-[var(--md-sys-color-on-surface)]">Live Activity</span>
        <span className={`h-2 w-2 rounded-full flex-shrink-0 ${isConnected ? 'bg-[var(--dcm-zone-green)]' : 'bg-[var(--dcm-zone-red)]'}`} />
        {!expanded && events.length > 0 && (
          <span className="text-[12px] text-[var(--md-sys-color-outline)]">{events.length} events</span>
        )}
        {!expanded && agentList.length > 0 && (
          <span className="text-[12px] text-[var(--md-sys-color-outline)]">{agentList.length} agents</span>
        )}
        <div className="flex-1" />
        {expanded ? <ChevronUp className="h-4 w-4 text-[var(--md-sys-color-outline)]" /> : <ChevronDown className="h-4 w-4 text-[var(--md-sys-color-outline)]" />}
      </button>

      {expanded && (
        <div className="border-t border-[var(--md-sys-color-outline-variant)]">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 lg:divide-x lg:divide-[var(--md-sys-color-outline-variant)]">
            <div className="lg:col-span-2 max-h-[300px] overflow-y-auto">
              {visibleEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-[var(--md-sys-color-outline)]">
                  <Activity className="h-6 w-6 mb-2 opacity-40" />
                  <p className="text-[12px]">En attente d'evenements...</p>
                </div>
              ) : (
                <div className="divide-y divide-[var(--md-sys-color-outline-variant)]">
                  {visibleEvents.map((event, i) => {
                    const cat = getEventCategory(event.event);
                    const colors = CAT_COLORS[cat];
                    const data = event.data as Record<string, unknown>;
                    return (
                      <div key={`${event.timestamp}-${i}`} className="flex items-center gap-2 px-3 py-2">
                        <span className={colors.text}><CatIcon category={cat} /></span>
                        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${colors.text} ${colors.border}`}>
                          {event.event}
                        </Badge>
                        <span className="text-[12px] text-[var(--md-sys-color-on-surface-variant)] truncate flex-1">
                          {(data?.description as string) || (data?.name as string) || (data?.agent_type as string) || ''}
                        </span>
                        <span className="text-[11px] text-[var(--md-sys-color-outline)] tabular-nums flex-shrink-0">
                          {relativeTime(event.timestamp)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-3.5 w-3.5 text-[var(--md-sys-color-outline)]" />
                <span className="text-[12px] font-medium text-[var(--md-sys-color-on-surface-variant)]">Agents ({agentList.length})</span>
              </div>
              {agentList.length === 0 ? (
                <p className="text-[12px] text-[var(--md-sys-color-outline)]">Aucun agent connecte</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-[250px] overflow-auto">
                  {agentList.map(agent => {
                    const safeId = agent.id || 'unknown';
                    const initials = safeId.replace(/[^a-zA-Z]/g, '').substring(0, 2).toUpperCase() || '??';
                    const colorIdx = hashStr(safeId) % AGENT_COLORS.length;
                    return (
                      <div
                        key={agent.id}
                        title={`${agent.id}${agent.type ? ` (${agent.type})` : ''}`}
                        className={`h-9 w-9 rounded-lg border flex items-center justify-center text-[11px] font-bold ${AGENT_COLORS[colorIdx]}`}
                      >
                        {initials}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
