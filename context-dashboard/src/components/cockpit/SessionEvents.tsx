'use client';

import { useState, useEffect, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  useRealtimeEvents,
  useWaveEvents,
  type WSEvent,
} from '@/hooks/useWebSocket';
import { relativeTime, getEventCategory, type EventCategory } from '@/lib/format';
import { Activity, Users, Zap, MessageSquare, Radio } from 'lucide-react';

// ============================================
// Config
// ============================================

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

// ============================================
// SessionEvents
// ============================================

export function SessionEvents({ sessionId }: { sessionId: string }) {
  const [, setTick] = useState(0);

  const { events: globalEvents } = useRealtimeEvents({ channels: ['global'], maxEvents: 100 });
  const { events: waveEvents } = useWaveEvents(sessionId);

  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 5000);
    return () => clearInterval(interval);
  }, []);

  const sessionEvents = useMemo(() => {
    const fromGlobal = globalEvents.filter(e => {
      const data = e.data as Record<string, unknown> | null;
      return data?.session_id === sessionId;
    });

    const waveAsWS: WSEvent[] = waveEvents.map(e => ({ ...e, channel: 'wave' } as WSEvent));
    const merged = [...fromGlobal, ...waveAsWS];
    merged.sort((a, b) => b.timestamp - a.timestamp);

    const seen = new Set<string>();
    return merged.filter(e => {
      const key = `${e.timestamp}-${e.event}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 30);
  }, [globalEvents, waveEvents, sessionId]);

  if (sessionEvents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-[var(--md-sys-color-outline)]">
        <Activity className="h-6 w-6 mb-2 opacity-40" />
        <p className="text-[12px]">En attente d'evenements...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h3 className="text-[14px] font-medium text-[var(--md-sys-color-on-surface-variant)]">Evenements Session</h3>
      <div className="rounded-md-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)] overflow-hidden max-h-[320px] overflow-y-auto">
        <div className="divide-y divide-[var(--md-sys-color-outline-variant)]">
          {sessionEvents.map((event, i) => {
            const cat = getEventCategory(event.event);
            const colors = CAT_COLORS[cat];
            const data = event.data as Record<string, unknown>;
            return (
              <div key={`${event.timestamp}-${i}`} className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--md-sys-color-surface-container)] transition-colors">
                <span className={colors.text}><CatIcon category={cat} /></span>
                <span className="text-[11px] font-mono text-[var(--md-sys-color-outline)] w-[52px] shrink-0 tabular-nums">
                  {new Date(event.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </span>
                <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${colors.text} ${colors.border}`}>
                  {event.event}
                </Badge>
                <span className="text-[12px] text-[var(--md-sys-color-on-surface-variant)] truncate flex-1">
                  {(data?.description as string) || (data?.name as string) || (data?.agent_type as string) || ''}
                </span>
                <span className="text-[10px] text-[var(--md-sys-color-outline)] tabular-nums flex-shrink-0">
                  {relativeTime(event.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
