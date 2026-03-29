'use client';

import { Activity, AlertTriangle, Send } from 'lucide-react';
import type { TopologyData } from '@/hooks/useOrchestratorTopology';

// ============================================
// Props
// ============================================

interface Props {
  data: TopologyData | null;
  sessionCount?: number;
}

// ============================================
// OrchestratorStatusBar
// ============================================

export function OrchestratorStatusBar({ data, sessionCount }: Props) {
  if (!data) return null;

  const { orchestrator } = data;
  const isActive = orchestrator.status === 'active';

  return (
    <div
      className="flex flex-wrap items-center gap-4 px-4 py-2 rounded-md-sm bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)]"
      role="status"
      aria-label="Statut de l'orchestrateur"
    >
      {/* Status indicator */}
      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            isActive
              ? 'bg-[var(--dcm-zone-green)] animate-pulse'
              : 'bg-[var(--md-sys-color-outline)]'
          }`}
          aria-hidden="true"
        />
        <span className="text-[12px] font-medium text-[var(--md-sys-color-on-surface)]">
          {isActive ? 'Orchestrateur actif' : 'Orchestrateur inactif'}
        </span>
      </div>

      {/* Separator */}
      <div className="w-px h-4 bg-[var(--md-sys-color-outline-variant)]" aria-hidden="true" />

      {/* Sessions count */}
      <div className="flex items-center gap-1.5">
        <Activity className="w-3.5 h-3.5 text-[var(--md-sys-color-primary)]" aria-hidden="true" />
        <span className="text-[12px] text-[var(--md-sys-color-on-surface-variant)]">
          {sessionCount ?? data.nodes.length} session{(sessionCount ?? data.nodes.length) !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Conflicts — only shown when present */}
      {data.conflicts.length > 0 && (
        <>
          <div className="w-px h-4 bg-[var(--md-sys-color-outline-variant)]" aria-hidden="true" />
          <div className="flex items-center gap-1.5">
            <AlertTriangle
              className="w-3.5 h-3.5 text-[var(--dcm-zone-red)]"
              aria-hidden="true"
            />
            <span className="text-[12px] text-[var(--dcm-zone-red)]">
              {data.conflicts.length} conflit{data.conflicts.length > 1 ? 's' : ''}
            </span>
          </div>
        </>
      )}

      {/* Directives count */}
      <div className="w-px h-4 bg-[var(--md-sys-color-outline-variant)]" aria-hidden="true" />
      <div className="flex items-center gap-1.5">
        <Send
          className="w-3.5 h-3.5 text-[var(--md-sys-color-secondary)]"
          aria-hidden="true"
        />
        <span className="text-[12px] text-[var(--md-sys-color-on-surface-variant)]">
          {orchestrator.total_directives} directive{orchestrator.total_directives !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Last heartbeat */}
      {orchestrator.last_heartbeat && (
        <>
          <div className="w-px h-4 bg-[var(--md-sys-color-outline-variant)]" aria-hidden="true" />
          <span className="text-[11px] text-[var(--md-sys-color-outline)]">
            Heartbeat:{' '}
            {new Date(orchestrator.last_heartbeat).toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        </>
      )}
    </div>
  );
}
