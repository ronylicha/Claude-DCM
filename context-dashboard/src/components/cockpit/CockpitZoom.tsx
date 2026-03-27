'use client';

import { useState, useEffect, useMemo } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useContextProjection } from '@/hooks/useContextProjection';
import { apiClient } from '@/lib/api-client';
import type { CockpitDetail } from '@/lib/api-client';

// ============================================
// Types
// ============================================

interface AgentEntry {
  id: string;
  agent_id?: string;
  agent_type: string;
  parent_agent_id?: string | null;
  status: string;
}

interface WaveEntry {
  wave_number: number;
  status: string;
  completed_tasks: number;
  total_tasks: number;
}

interface CockpitZoomProps {
  sessionId: string;
  onBack: () => void;
}

// ============================================
// Helpers
// ============================================

function formatModel(modelId: string | null | undefined): string {
  if (!modelId || modelId === 'unknown') return 'Unknown';
  const lower = modelId.toLowerCase();
  if (lower.includes('opus')) return 'Opus';
  if (lower.includes('sonnet')) return 'Sonnet';
  if (lower.includes('haiku')) return 'Haiku';
  return modelId;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ============================================
// LargeGauge — 120px SVG donut
// ============================================

function LargeGauge({ percentage, zone }: { percentage: number; zone: string }) {
  const size = 120;
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90" aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--md-sys-color-surface-container-high)"
        strokeWidth="8"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={`var(--dcm-zone-${zone})`}
        strokeWidth="8"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-all duration-500"
      />
      <text
        x={size / 2}
        y={size / 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="transform rotate-90 origin-center text-[22px] font-normal"
        fill="var(--md-sys-color-on-surface)"
      >
        {Math.round(percentage)}%
      </text>
    </svg>
  );
}

// ============================================
// AgentStatusDot
// ============================================

function AgentStatusDot({ status }: { status: string }) {
  const colorClass =
    status === 'running'   ? 'bg-[var(--dcm-zone-green)]' :
    status === 'blocked'   ? 'bg-[var(--dcm-zone-orange)]' :
    status === 'completed' ? 'bg-[var(--md-sys-color-primary)]' :
    status === 'failed'    ? 'bg-[var(--dcm-zone-red)]' :
                             'bg-[var(--md-sys-color-outline)]';

  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${colorClass}`} aria-hidden="true" />;
}

// ============================================
// WaveCard
// ============================================

function WaveCard({ wave }: { wave: WaveEntry }) {
  const progress =
    wave.total_tasks > 0 ? (wave.completed_tasks / wave.total_tasks) * 100 : 0;

  const containerClass =
    wave.status === 'running'
      ? 'border-[var(--md-sys-color-primary)] bg-[var(--md-sys-color-surface)]'
      : wave.status === 'completed'
      ? 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-primary-container)]'
      : 'border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface-container)]';

  const badgeClass =
    wave.status === 'completed'
      ? 'bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]'
      : wave.status === 'running'
      ? 'bg-[var(--md-sys-color-tertiary-container)] text-[var(--md-sys-color-on-tertiary-container)]'
      : wave.status === 'failed'
      ? 'bg-[var(--md-sys-color-error-container)] text-[var(--md-sys-color-on-error-container)]'
      : 'bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)]';

  const progressColor =
    wave.status === 'failed'
      ? 'var(--dcm-zone-red)'
      : 'var(--md-sys-color-primary)';

  return (
    <div className={`flex-shrink-0 w-[160px] p-4 rounded-md-md border transition-all ${containerClass}`}>
      <p className="text-[14px] font-medium text-[var(--md-sys-color-on-surface)]">
        Wave {wave.wave_number}
      </p>
      <p className="text-[12px] text-[var(--md-sys-color-outline)] mt-1">
        {wave.completed_tasks}/{wave.total_tasks} taches
      </p>
      <div className="mt-2 h-1.5 rounded-full bg-[var(--md-sys-color-surface-container-high)] overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${progress}%`, backgroundColor: progressColor }}
          role="progressbar"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <span className={`mt-2 inline-block text-[11px] px-2 py-0.5 rounded-full ${badgeClass}`}>
        {wave.status}
      </span>
    </div>
  );
}

// ============================================
// CockpitZoom — main component
// ============================================

export function CockpitZoom({ sessionId, onBack }: CockpitZoomProps) {
  const [data, setData] = useState<CockpitDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const { data: projection } = useContextProjection(sessionId);

  useEffect(() => {
    apiClient.getCockpitSession(sessionId)
      .then((json) => setData(json))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2
          className="w-8 h-8 animate-spin text-[var(--md-sys-color-primary)]"
          aria-label="Chargement..."
        />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--md-sys-color-on-surface-variant)]">
        Session introuvable
      </div>
    );
  }

  const ctx = data.context;
  const zone = ctx.zone || 'green';
  const zoneColor = `var(--dcm-zone-${zone})`;
  const summaryStatus = ctx.preemptive_summary?.status;

  return (
    <div className="space-y-6">
      {/* ── Back button ── */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 min-h-[48px] text-[var(--md-sys-color-primary)] hover:opacity-80 transition-opacity"
        aria-label="Retour a la grille"
      >
        <ArrowLeft className="w-5 h-5" aria-hidden="true" />
        <span className="text-[14px] font-medium">Retour grille</span>
      </button>

      {/* ── Zone 1: Context ── */}
      <div className="grid grid-cols-12 gap-4">

        {/* Large gauge */}
        <div className="col-span-12 sm:col-span-4 xl:col-span-3 flex flex-col items-center justify-center p-6 rounded-md-md bg-[var(--md-sys-color-surface-container-low)]">
          <LargeGauge percentage={ctx.used_percentage} zone={zone} />
          <p className="mt-2 text-[14px] text-[var(--md-sys-color-on-surface-variant)]">
            {formatTokens(ctx.current_usage)} / {formatTokens(ctx.context_window_size)}
          </p>
          <span className="mt-1 px-3 py-1 rounded-full text-[11px] font-medium bg-[var(--md-sys-color-primary-container)] text-[var(--md-sys-color-on-primary-container)]">
            {formatModel(ctx.model_id)}
          </span>
        </div>

        {/* Prediction */}
        <div className="col-span-12 sm:col-span-4 xl:col-span-3 p-6 rounded-md-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)]">
          <h3 className="text-[14px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-3">
            Prediction
          </h3>
          <p className="text-[28px] font-normal text-[var(--md-sys-color-on-surface)]">
            {ctx.predicted_exhaustion_minutes !== null
              ? `~${Math.round(ctx.predicted_exhaustion_minutes)}min`
              : '∞'}
          </p>
          <p className="text-[12px] text-[var(--md-sys-color-outline)]">
            {Math.round(ctx.consumption_rate || 0)} tok/min
          </p>

          {projection !== null && (
            <div className="mt-4 space-y-1">
              <p className="text-[12px] text-[var(--md-sys-color-on-surface-variant)]">
                5h : {formatTokens(projection.projection_5h.total_tokens)}{' '}
                ({projection.projection_5h.compactions} compacts)
              </p>
              <p className="text-[12px] text-[var(--md-sys-color-on-surface-variant)]">
                7j : {formatTokens(projection.projection_7d.total_tokens)}
              </p>
            </div>
          )}

          {summaryStatus === 'generating' && (
            <div className="mt-3 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" style={{ color: zoneColor }} aria-hidden="true" />
              <span className="text-[11px]" style={{ color: zoneColor }}>
                Resume en cours...
              </span>
            </div>
          )}
          {summaryStatus === 'ready' && (
            <p className="mt-3 text-[11px] text-[var(--dcm-zone-green)]">Resume pret ✓</p>
          )}
        </div>

        {/* Consumption chart */}
        <div className="col-span-12 xl:col-span-6 p-6 rounded-md-md bg-[var(--md-sys-color-surface-container-low)]">
          <h3 className="text-[14px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-3">
            Consommation
          </h3>
          <ConsumptionChart sessionId={sessionId} />
        </div>
      </div>

      {/* ── Zone 2: Agents ── */}
      <div className="rounded-md-md border border-[var(--md-sys-color-outline-variant)] bg-[var(--md-sys-color-surface)] overflow-hidden">
        <div className="px-4 py-3 border-b border-[var(--md-sys-color-outline-variant)]">
          <h3 className="text-[14px] font-medium text-[var(--md-sys-color-on-surface)]">
            Agents ({data.agents.total}) —{' '}
            <span className="text-[var(--dcm-zone-green)]">{data.agents.running} actifs</span>
            {data.agents.blocked > 0 && (
              <>
                ,{' '}
                <span className="text-[var(--dcm-zone-orange)]">
                  {data.agents.blocked} bloques
                </span>
              </>
            )}
          </h3>
        </div>

        <div className="divide-y divide-[var(--md-sys-color-outline-variant)]">
          {data.agents.list && data.agents.list.length > 0 ? (
            data.agents.list.map(agent => (
              <div
                key={agent.id}
                className="flex items-center gap-3 py-2 pr-4"
                style={{ paddingLeft: agent.parent_agent_id ? '48px' : '16px' }}
              >
                <AgentStatusDot status={agent.status} />
                <span className="text-[14px] text-[var(--md-sys-color-on-surface)] font-medium truncate">
                  {agent.agent_id ?? agent.agent_type}
                </span>
                <span className="text-[12px] text-[var(--md-sys-color-outline)] flex-shrink-0">
                  {agent.agent_type}
                </span>
                <span className="ml-auto text-[11px] px-2 py-0.5 rounded-full bg-[var(--md-sys-color-surface-container)] text-[var(--md-sys-color-on-surface-variant)] flex-shrink-0">
                  {agent.status}
                </span>
              </div>
            ))
          ) : (
            <p className="px-4 py-3 text-[14px] text-[var(--md-sys-color-outline)]">
              Aucun agent
            </p>
          )}
        </div>
      </div>

      {/* ── Zone 3: Wave Pipeline ── */}
      <div>
        <h3 className="text-[14px] font-medium text-[var(--md-sys-color-on-surface-variant)] mb-3">
          Pipeline Waves
        </h3>
        <div className="flex gap-3 overflow-x-auto pb-2">
          {data.waves.pipeline && data.waves.pipeline.length > 0 ? (
            data.waves.pipeline.map(wave => (
              <WaveCard key={wave.wave_number} wave={wave} />
            ))
          ) : (
            <p className="text-[14px] text-[var(--md-sys-color-outline)]">Aucune wave</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================
// Consumption Chart — real actions/5min for this session
// ============================================

interface ChartPoint {
  time: string;
  actions: number;
}

function ConsumptionChart({ sessionId }: { sessionId: string }) {
  const [points, setPoints] = useState<ChartPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3847'}/api/actions/hourly?session_id=${sessionId}`
        );
        if (!res.ok) throw new Error('Failed');
        const json = await res.json();
        const hourly = json.hourly || json.data || json;

        if (Array.isArray(hourly)) {
          setPoints(
            hourly.map((h: { hour?: string; bucket?: string; count?: number; total?: number }) => ({
              time: new Date(h.hour || h.bucket || '').toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
              actions: Number(h.count || h.total || 0),
            }))
          );
        }
      } catch {
        setPoints([]);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [sessionId]);

  if (loading) {
    return (
      <div className="h-32 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--md-sys-color-outline)]" />
      </div>
    );
  }

  if (points.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-[12px] text-[var(--md-sys-color-outline)]">
        Pas de donnees de consommation
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={128}>
      <AreaChart data={points} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="consumptionFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--md-sys-color-primary)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="var(--md-sys-color-primary)" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="time"
          tick={{ fontSize: 10, fill: 'var(--md-sys-color-outline)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: 'var(--md-sys-color-outline)' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--md-sys-color-surface-container-high)',
            border: '1px solid var(--md-sys-color-outline-variant)',
            borderRadius: '8px',
            fontSize: '12px',
            color: 'var(--md-sys-color-on-surface)',
          }}
        />
        <Area
          type="monotone"
          dataKey="actions"
          stroke="var(--md-sys-color-primary)"
          fill="url(#consumptionFill)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
