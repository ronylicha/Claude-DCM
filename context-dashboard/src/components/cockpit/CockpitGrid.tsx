'use client';

import { useCallback } from 'react';
import { SessionMiniCockpit } from './SessionMiniCockpit';
import type { MiniCockpitData } from '@/hooks/useSessionGrid';

interface CockpitGridProps {
  sessions: MiniCockpitData[];
  onZoom: (sessionId: string) => void;
}

export function CockpitGrid({ sessions, onZoom }: CockpitGridProps) {
  const handleZoom = useCallback(
    (sessionId: string) => {
      onZoom(sessionId);
    },
    [onZoom],
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
      {sessions.map(session => (
        <SessionMiniCockpit
          key={session.session_id}
          session={session}
          onZoom={handleZoom}
        />
      ))}
    </div>
  );
}
