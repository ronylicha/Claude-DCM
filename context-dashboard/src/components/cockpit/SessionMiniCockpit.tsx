'use client';

import { memo } from 'react';
import type { MiniCockpitData } from '@/hooks/useSessionGrid';
import { formatTokens, formatModel } from '@/lib/format';

function getZoneBorderClass(zone: string): string {
  switch (zone) {
    case 'yellow':   return 'border-[var(--dcm-zone-yellow)]';
    case 'orange':   return 'border-[var(--dcm-zone-orange)]';
    case 'red':      return 'border-[var(--dcm-zone-red)]';
    case 'critical': return 'border-[var(--dcm-zone-critical)]';
    default:         return 'border-[var(--md-sys-color-outline-variant)]';
  }
}

// ============================================
// CircularGauge — SVG donut with zone color
// ============================================

function CircularGauge({
  percentage,
  zone,
  size = 80,
}: {
  percentage: number;
  zone: string;
  size?: number;
}) {
  const radius = (size - 8) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90" aria-hidden="true">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--md-sys-color-surface-container)"
        strokeWidth="6"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={`var(--dcm-zone-${zone})`}
        strokeWidth="6"
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
        className="transform rotate-90 origin-center text-[14px] font-medium"
        fill="var(--md-sys-color-on-surface)"
      >
        {Math.round(percentage)}%
      </text>
    </svg>
  );
}

// ============================================
// Sparkline — simple SVG polyline
// ============================================

function Sparkline({
  data,
  color,
  width = 120,
  height = 32,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) return null;

  const max = Math.max(...data, 1);
  const points = data
    .map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * height}`)
    .join(' ');

  return (
    <svg width={width} height={height} className="opacity-60" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// ============================================
// SessionMiniCockpit
// ============================================

interface SessionMiniCockpitProps {
  session: MiniCockpitData;
  onZoom: (sessionId: string) => void;
}

export const SessionMiniCockpit = memo(function SessionMiniCockpit({ session, onZoom }: SessionMiniCockpitProps) {
  const { context, wave, agents, sparkline, preemptive_summary } = session;
  const zone = context.zone || 'green';
  const isCritical = zone === 'critical';
  const borderClass = getZoneBorderClass(zone);
  const zoneColor = `var(--dcm-zone-${zone})`;

  const waveProgress =
    wave && wave.total > 0 ? Math.round((wave.completed / wave.total) * 100) : 0;

  return (
    <article
      className={[
        'relative flex flex-col gap-3 p-4 rounded-md-md border',
        'bg-[var(--md-sys-color-surface-container-low)]',
        'shadow-sm hover:shadow-md transition-all duration-200 cursor-pointer',
        borderClass,
        isCritical ? 'animate-pulse' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => onZoom(session.session_id)}
      aria-label={`Session ${session.project_name} — contexte ${Math.round(context.used_percentage)}%`}
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="flex-shrink-0 w-2.5 h-2.5 rounded-full"
          style={{ backgroundColor: zoneColor }}
          aria-hidden="true"
        />
        <span
          className="flex-1 min-w-0 text-[14px] font-medium text-[var(--md-sys-color-on-surface)] truncate"
          title={session.project_name}
        >
          {session.project_name}
        </span>
        <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)]">
          {formatModel(session.model_id)}
        </span>
      </div>

      {/* ── Body: gauge + stats ── */}
      <div className="flex items-center gap-3">
        <CircularGauge percentage={context.used_percentage} zone={zone} />

        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <p className="text-[13px] text-[var(--md-sys-color-on-surface)]">
            {formatTokens(context.current_usage)}{' '}
            <span className="text-[var(--md-sys-color-outline)]">
              / {formatTokens(context.context_window_size)}
            </span>
          </p>

          {context.predicted_exhaustion_minutes !== null ? (
            <p className="text-[12px]" style={{ color: zoneColor }}>
              ~{Math.round(context.predicted_exhaustion_minutes)}min restantes
            </p>
          ) : (
            <p className="text-[12px] text-[var(--md-sys-color-outline)]">Illimite</p>
          )}

          <p className="text-[11px] text-[var(--md-sys-color-outline)]">
            {Math.round(context.consumption_rate)} tok/min
          </p>

          {preemptive_summary.status === 'generating' && (
            <p className="text-[11px] text-[var(--dcm-zone-orange)] animate-pulse">
              Resume en cours...
            </p>
          )}
          {preemptive_summary.status === 'ready' && (
            <p className="text-[11px] text-[var(--dcm-zone-green)]">Resume pret</p>
          )}
        </div>
      </div>

      {/* ── Cost & Lines ── */}
      {(context.cost_usd !== undefined && context.cost_usd > 0) || (context.lines_added !== undefined && context.lines_added > 0) ? (
        <div className="flex items-center gap-3 text-[11px] text-[var(--md-sys-color-outline)]">
          {context.cost_usd !== undefined && context.cost_usd > 0 && (
            <span>${context.cost_usd.toFixed(2)}</span>
          )}
          {context.lines_added !== undefined && context.lines_added > 0 && (
            <span className="text-[var(--dcm-zone-green)]">+{context.lines_added}</span>
          )}
          {context.lines_removed !== undefined && context.lines_removed > 0 && (
            <span className="text-[var(--dcm-zone-red)]">-{context.lines_removed}</span>
          )}
          {context.cache_read_tokens !== undefined && context.cache_read_tokens > 0 && (
            <span title="Cache read tokens">cache {formatTokens(context.cache_read_tokens)}</span>
          )}
        </div>
      ) : null}

      {/* ── Wave progress ── */}
      {wave !== null && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-[var(--md-sys-color-on-surface-variant)]">
              Wave {wave.current_number} — {wave.completed}/{wave.total}
            </span>
            <span className="text-[11px] text-[var(--md-sys-color-outline)]">{wave.status}</span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--md-sys-color-surface-container-high)] overflow-hidden">
            <div
              className="h-full rounded-full bg-[var(--md-sys-color-primary)] transition-all duration-300"
              style={{ width: `${waveProgress}%` }}
              role="progressbar"
              aria-valuenow={waveProgress}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </div>
      )}

      {/* ── Agents ── */}
      <div className="flex items-center gap-2">
        {agents.running > 0 && (
          <span className="flex items-center gap-1 text-[12px] text-[var(--md-sys-color-on-surface-variant)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--dcm-zone-green)]" aria-hidden="true" />
            {agents.running}
          </span>
        )}
        {agents.blocked > 0 && (
          <span className="flex items-center gap-1 text-[12px] text-[var(--md-sys-color-on-surface-variant)]">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--dcm-zone-orange)]" aria-hidden="true" />
            {agents.blocked}
          </span>
        )}
        <span className="text-[12px] text-[var(--md-sys-color-outline)]">
          / {agents.total} agents
        </span>

        {agents.last_action && (
          <span
            className="ml-auto text-[11px] text-[var(--md-sys-color-outline)] truncate max-w-[96px]"
            title={agents.last_action.tool_name}
          >
            {agents.last_action.tool_name}
          </span>
        )}
      </div>

      {/* ── Sparkline ── */}
      {sparkline.length >= 2 && (
        <div className="flex justify-end">
          <Sparkline data={sparkline} color={zoneColor} />
        </div>
      )}

      {/* ── Footer: zoom ── */}
      <div className="flex justify-end pt-1 border-t border-[var(--md-sys-color-outline-variant)]">
        <button
          onClick={e => {
            e.stopPropagation();
            onZoom(session.session_id);
          }}
          className="min-h-[48px] px-3 text-[14px] font-medium text-[var(--md-sys-color-primary)] hover:opacity-80 transition-opacity"
          aria-label={`Zoom sur la session ${session.project_name}`}
        >
          Zoom
        </button>
      </div>
    </article>
  );
});
