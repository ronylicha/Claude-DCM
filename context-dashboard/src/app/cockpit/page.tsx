'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { CockpitGrid } from '@/components/cockpit/CockpitGrid';
import { OrchestratorStatusBar } from '@/components/cockpit/OrchestratorStatusBar';
import { CockpitLivePanel } from '@/components/cockpit/CockpitLivePanel';
import { OrchestratorTopologySVG } from '@/components/cockpit/OrchestratorTopologySVG';
import { useSessionGrid } from '@/hooks/useSessionGrid';
import { useGlobalCapacity } from '@/hooks/useGlobalCapacity';
import { useOrchestratorTopology } from '@/hooks/useOrchestratorTopology';
import { formatTokens } from '@/lib/format';

const CockpitDrawer = dynamic(
  () => import('@/components/cockpit/CockpitDrawer').then(m => ({ default: m.CockpitDrawer })),
  { ssr: false }
);

const CockpitZoom = dynamic(
  () => import('@/components/cockpit/CockpitZoom').then(m => ({ default: m.CockpitZoom })),
  { ssr: false }
);

// ============================================
// KPI Chip — compact stat indicator (M3 chip style)
// ============================================

function KPIChip({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-md-md bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)]">
      {color && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />}
      <span className="text-[20px] font-medium text-[var(--md-sys-color-on-surface)] tabular-nums">{value}</span>
      <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)] uppercase tracking-wider">{label}</span>
    </div>
  );
}

// ============================================
// Skeleton
// ============================================

function CockpitSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Chargement du cockpit...">
      <div className="h-10 rounded-md-md bg-[var(--md-sys-color-surface-container)] animate-pulse" />
      <div className="h-[320px] rounded-md-md bg-[var(--md-sys-color-surface-container)] animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-56 rounded-md-md bg-[var(--md-sys-color-surface-container)] animate-pulse" />
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { sessions, loading } = useSessionGrid();
  const { data: globalData } = useGlobalCapacity();
  const { data: topologyData } = useOrchestratorTopology();

  if (loading) return <CockpitSkeleton />;

  if (zoomedSession !== null) {
    return <CockpitZoom sessionId={zoomedSession} onBack={() => setZoomedSession(null)} />;
  }

  return (
    <div className="space-y-4">
      {/* ── Row 1: KPI chips + orchestrator status ── */}
      <div className="flex flex-wrap items-center gap-3">
        {globalData !== null && (
          <>
            <KPIChip label="sessions" value={globalData.sessions.total_active} color="var(--md-sys-color-primary)" />
            <KPIChip label="agents" value={globalData.agents.running} color="var(--dcm-zone-green)" />
            <KPIChip label="tokens" value={formatTokens(globalData.tokens.total_consumed)} />
            {globalData.summaries.generating > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-2 rounded-md-md bg-[color-mix(in_srgb,var(--dcm-zone-orange)_12%,transparent)] border border-[color-mix(in_srgb,var(--dcm-zone-orange)_30%,transparent)]">
                <span className="w-2 h-2 rounded-full bg-[var(--dcm-zone-orange)] animate-pulse" />
                <span className="text-[12px] text-[var(--dcm-zone-orange)]">{globalData.summaries.generating} resume(s)</span>
              </div>
            )}
          </>
        )}
        <div className="flex-1" />
        <button
          onClick={() => setDrawerOpen(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-md-md text-[12px] font-medium text-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] hover:bg-[var(--md-sys-color-primary-container)] transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none" />
            <line x1="10" y1="2" x2="10" y2="14" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          Metriques
        </button>
      </div>

      {/* ── Row 2: Topology map (always visible) + orchestrator bar ── */}
      {topologyData !== null && (
        <div className="space-y-2">
          <OrchestratorStatusBar data={topologyData} sessionCount={globalData?.sessions.total_active} />
          <OrchestratorTopologySVG data={topologyData} />
        </div>
      )}

      {/* ── Row 3: Session grid ── */}
      {sessions.length > 0 ? (
        <CockpitGrid sessions={sessions} onZoom={sessionId => setZoomedSession(sessionId)} />
      ) : (
        <div className="flex items-center justify-center h-48 rounded-md-md bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface-variant)] text-[14px]">
          Aucune session active
        </div>
      )}

      {/* ── Row 4: Live activity ── */}
      <CockpitLivePanel runningAgentCount={globalData?.agents.running} />

      {/* Metrics drawer */}
      <CockpitDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
