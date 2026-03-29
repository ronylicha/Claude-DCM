'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { CockpitGrid } from '@/components/cockpit/CockpitGrid';
import { CockpitZoom } from '@/components/cockpit/CockpitZoom';
import { OrchestratorStatusBar } from '@/components/cockpit/OrchestratorStatusBar';
import { CockpitLivePanel } from '@/components/cockpit/CockpitLivePanel';
import { CockpitDrawer } from '@/components/cockpit/CockpitDrawer';
import { useSessionGrid } from '@/hooks/useSessionGrid';
import { useGlobalCapacity } from '@/hooks/useGlobalCapacity';
import { useOrchestratorTopology } from '@/hooks/useOrchestratorTopology';

const OrchestratorTopology3D = dynamic(
  () => import('@/components/cockpit/OrchestratorTopology3D').then(m => ({ default: m.OrchestratorTopology3D })),
  { ssr: false, loading: () => <div className="h-[300px] animate-pulse rounded-md-md bg-[var(--md-sys-color-surface-container)]" /> }
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
  const [show3D, setShow3D] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
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
          <div className="flex-1" />
          <button
            onClick={() => setDrawerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md-sm text-[12px] font-medium text-[var(--md-sys-color-primary)] hover:bg-[var(--md-sys-color-primary-container)] transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
              <line x1="10" y1="2" x2="10" y2="14" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            Metriques
          </button>
        </div>
      )}

      {/* Orchestrator topology */}
      {topologyData !== null && (
        <div className="space-y-3">
          <OrchestratorStatusBar data={topologyData} sessionCount={globalData?.sessions.total_active} />
          {show3D ? (
            <OrchestratorTopology3D data={topologyData} />
          ) : (
            <button
              onClick={() => setShow3D(true)}
              className="w-full h-[80px] rounded-md-md border border-dashed border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container-lowest)] flex items-center justify-center gap-2 text-[var(--md-sys-color-primary)] text-[14px] hover:bg-[var(--md-sys-color-surface-container)] transition-colors"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M10 2L18 7V13L10 18L2 13V7L10 2Z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
              </svg>
              Afficher la topologie 3D
            </button>
          )}
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

      {/* Live activity panel */}
      <CockpitLivePanel runningAgentCount={globalData?.agents.running} />

      {/* Metrics drawer */}
      <CockpitDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
