'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { CockpitGrid } from '@/components/cockpit/CockpitGrid';
import { CockpitZoom } from '@/components/cockpit/CockpitZoom';
import { OrchestratorStatusBar } from '@/components/cockpit/OrchestratorStatusBar';
import { useSessionGrid } from '@/hooks/useSessionGrid';
import { useGlobalCapacity } from '@/hooks/useGlobalCapacity';
import { useOrchestratorTopology } from '@/hooks/useOrchestratorTopology';

// Dynamic import — Three.js is incompatible with SSR
const OrchestratorTopology3D = dynamic(
  () =>
    import('@/components/cockpit/OrchestratorTopology3D').then(
      (m) => ({ default: m.OrchestratorTopology3D })
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-[300px] animate-pulse rounded-md-md bg-[var(--md-sys-color-surface-container)]" />
    ),
  }
);

// ============================================
// Helpers
// ============================================

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ============================================
// Skeleton
// ============================================

function CockpitSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Chargement du cockpit...">
      <div className="h-12 rounded-md-md bg-[var(--md-sys-color-surface-container)] animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4">
        {[1, 2, 3].map(i => (
          <div
            key={i}
            className="h-64 rounded-md-md bg-[var(--md-sys-color-surface-container)] animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}

// ============================================
// CockpitPage
// ============================================

export default function CockpitPage() {
  const [zoomedSession, setZoomedSession] = useState<string | null>(null);
  const { sessions, loading } = useSessionGrid();
  const { data: globalData } = useGlobalCapacity();
  const { data: topologyData } = useOrchestratorTopology();

  if (loading) {
    return <CockpitSkeleton />;
  }

  if (zoomedSession !== null) {
    return (
      <CockpitZoom
        sessionId={zoomedSession}
        onBack={() => setZoomedSession(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Global summary bar */}
      {globalData !== null && (
        <div className="flex flex-wrap items-center gap-6 px-4 py-3 rounded-md-md bg-[var(--md-sys-color-surface-container)]">
          <span className="text-[14px] font-medium text-[var(--md-sys-color-on-surface)]">
            {globalData.sessions.total_active} sessions actives
          </span>
          <span className="text-[14px] text-[var(--md-sys-color-on-surface-variant)]">
            {globalData.agents.running} agents en cours
          </span>
          <span className="text-[14px] text-[var(--md-sys-color-on-surface-variant)]">
            {formatTokens(globalData.tokens.total_consumed)} tok total
          </span>
          {globalData.summaries.generating > 0 && (
            <span className="text-[14px] text-[var(--dcm-zone-orange)] animate-pulse">
              {globalData.summaries.generating} resume(s) en cours
            </span>
          )}
        </div>
      )}

      {/* Orchestrator topology */}
      {topologyData !== null && (
        <div className="space-y-3">
          <OrchestratorStatusBar data={topologyData} />
          <OrchestratorTopology3D data={topologyData} />
        </div>
      )}

      {/* Grid of mini-cockpits */}
      {sessions.length > 0 ? (
        <CockpitGrid
          sessions={sessions}
          onZoom={sessionId => setZoomedSession(sessionId)}
        />
      ) : (
        <div className="flex items-center justify-center h-64 text-[var(--md-sys-color-on-surface-variant)]">
          Aucune session active
        </div>
      )}
    </div>
  );
}
