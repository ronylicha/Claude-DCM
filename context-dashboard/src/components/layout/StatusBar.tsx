'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useGlobalCapacity, type SessionCapacity, type ThresholdAlert } from '@/hooks/useGlobalCapacity';

// ============================================
// Types
// ============================================

type ZoneKey = 'green' | 'yellow' | 'orange' | 'red' | 'critical';

interface SessionPastille {
  letter: string;
  sessionId: string;
  percentage: number;
  zone: ZoneKey;
  model: string;
  label: string;
}

// ============================================
// Helpers
// ============================================

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function sessionLetter(index: number): string {
  return ALPHABET[index % ALPHABET.length] ?? String(index + 1);
}

function normalizeZone(zone: string): ZoneKey {
  const valid: ZoneKey[] = ['green', 'yellow', 'orange', 'red', 'critical'];
  return valid.includes(zone as ZoneKey) ? (zone as ZoneKey) : 'green';
}

function formatModel(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes('opus')) return 'Opus';
  if (lower.includes('sonnet')) return 'Sonnet';
  if (lower.includes('haiku')) return 'Haiku';
  return modelId;
}

function mapSessionToPastille(s: SessionCapacity, index: number): SessionPastille {
  return {
    letter: sessionLetter(index),
    sessionId: s.session_id,
    percentage: Math.round(s.used_percentage),
    zone: normalizeZone(s.zone),
    model: formatModel(s.model_id),
    label: s.project_name || s.session_id.slice(0, 8),
  };
}

/** Format token count: 1200000 → "1.2M", 340000 → "340K", 1500 → "1.5K" */
function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

/** Format rate in tokens/min → "12K/min" */
function formatRate(n: number): string {
  if (n >= 1_000) return `${Math.round(n / 1_000)}K/min`;
  return `${n}/min`;
}

// ============================================
// Zone color helper
// ============================================

function zoneColor(zone: ZoneKey): string {
  const map: Record<ZoneKey, string> = {
    green: 'var(--dcm-zone-green)',
    yellow: 'var(--dcm-zone-yellow)',
    orange: 'var(--dcm-zone-orange)',
    red: 'var(--dcm-zone-red)',
    critical: 'var(--dcm-zone-critical)',
  };
  return map[zone];
}

// ============================================
// Sub-components
// ============================================

function Divider() {
  return (
    <div className="w-px h-6 bg-[var(--md-sys-color-outline-variant)] shrink-0" />
  );
}

/** Skeleton pulse block for loading state */
function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'animate-pulse rounded bg-[var(--md-sys-color-outline-variant)] opacity-40',
        className,
      )}
    />
  );
}

interface SessionTooltipProps {
  session: SessionPastille;
}

function SessionPastilleItem({ session }: SessionTooltipProps) {
  return (
    <div
      className="group relative flex items-center gap-1.5"
      title={`${session.label} (${session.model}) — ${session.percentage}% context used`}
    >
      {/* Circle with zone color */}
      <div
        className="
          flex items-center justify-center
          w-5 h-5 rounded-full shrink-0
          text-white text-[9px] font-bold
          transition-transform duration-150 group-hover:scale-110
        "
        style={{ backgroundColor: zoneColor(session.zone) }}
        aria-label={`Session ${session.label}: ${session.percentage}% context`}
      >
        {session.letter}
      </div>

      {/* Percentage */}
      <span
        className="
          text-[10px] font-mono font-medium
          text-[var(--md-sys-color-on-surface-variant)]
        "
      >
        {session.percentage}%
      </span>

      {/* Tooltip on hover */}
      <div
        role="tooltip"
        className="
          absolute bottom-full left-1/2 -translate-x-1/2 mb-2
          px-2 py-1 rounded-[var(--radius-md-sm)]
          bg-[var(--md-sys-color-inverse-surface)]
          text-[var(--md-sys-color-inverse-on-surface)]
          text-[10px] font-medium whitespace-nowrap
          opacity-0 group-hover:opacity-100
          pointer-events-none
          transition-opacity duration-150 z-10
        "
      >
        {session.label} · {session.model} · {session.percentage}% used
        <div
          aria-hidden="true"
          className="
            absolute top-full left-1/2 -translate-x-1/2
            w-0 h-0
            border-x-4 border-x-transparent
            border-t-4 border-t-[var(--md-sys-color-inverse-surface)]
          "
        />
      </div>
    </div>
  );
}

interface AlertToastProps {
  alert: ThresholdAlert;
  index: number;
  onDismiss: (index: number) => void;
}

function AlertToast({ alert, index, onDismiss }: AlertToastProps) {
  const zone = normalizeZone(alert.zone);
  return (
    <div
      role="alert"
      className="
        flex items-center gap-2
        px-2.5 py-1 rounded-[var(--radius-md-sm)]
        bg-[var(--md-sys-color-error-container)]
        text-[var(--md-sys-color-on-error-container)]
        text-[10px] font-medium
        animate-in fade-in slide-in-from-bottom-2 duration-200
      "
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: zoneColor(zone) }}
        aria-hidden="true"
      />
      <span>
        {alert.session_id.slice(0, 8)} → {alert.threshold}%
      </span>
      <button
        type="button"
        onClick={() => onDismiss(index)}
        aria-label="Dismiss alert"
        className="
          ml-0.5 w-3.5 h-3.5 rounded-full
          flex items-center justify-center
          opacity-60 hover:opacity-100
          transition-opacity duration-100
          focus-visible:outline-1 focus-visible:outline-current
        "
      >
        ×
      </button>
    </div>
  );
}

// ============================================
// StatusBar
// ============================================

export function StatusBar() {
  const { data, loading, alerts, dismissAlert } = useGlobalCapacity();

  // Derive session pastilles from real data
  const activeSessions: SessionPastille[] = (data?.tokens.by_session ?? []).map(
    mapSessionToPastille,
  );

  // Model breakdown label
  const byModel = data?.sessions.by_model;
  const modelBreakdown = byModel
    ? [
        byModel.opus > 0 ? `${byModel.opus} Opus` : null,
        byModel.sonnet > 0 ? `${byModel.sonnet} Son` : null,
        byModel.haiku > 0 ? `${byModel.haiku} Hku` : null,
      ]
        .filter(Boolean)
        .join(' ')
    : '';

  return (
    <footer
      className="
        fixed bottom-0 right-0 z-40
        h-14 ml-[72px]
        flex items-center gap-4 px-4
        bg-[var(--md-sys-color-surface-container-high)]
        border-t border-[var(--md-sys-color-outline-variant)]
      "
      style={{ left: '72px' }}
      aria-label="System status bar"
    >
      {/* 1. Sessions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {loading ? (
          <Skeleton className="w-16 h-3" />
        ) : (
          <>
            <span className="text-[11px] font-semibold text-[var(--md-sys-color-on-surface)]">
              {data?.sessions.total_active ?? 0}
            </span>
            <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
              sessions
            </span>
            {modelBreakdown && (
              <span className="text-[10px] font-mono text-[var(--md-sys-color-on-surface-variant)] opacity-70">
                | {modelBreakdown}
              </span>
            )}
          </>
        )}
      </div>

      <Divider />

      {/* 2. Agents */}
      <div className="flex items-center gap-1.5 shrink-0">
        {loading ? (
          <Skeleton className="w-20 h-3" />
        ) : (
          <>
            <span className="text-[11px] font-semibold text-[var(--md-sys-color-on-surface)]">
              {data?.agents.running ?? 0}
            </span>
            <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
              agents
            </span>
            <div className="flex items-center gap-1 ml-0.5">
              {/* blocked dot */}
              {/* blocked dot */}
              {(data?.agents.blocked ?? 0) > 0 && (
                <span
                  className="flex items-center gap-0.5"
                  title={`${data!.agents.blocked} blocked`}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: 'var(--dcm-zone-red)' }}
                  />
                  <span className="text-[10px] text-[var(--md-sys-color-on-surface-variant)]">
                    {data!.agents.blocked}
                  </span>
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <Divider />

      {/* 3. Tokens global */}
      <div className="flex items-center gap-1 shrink-0">
        {loading ? (
          <Skeleton className="w-24 h-3" />
        ) : (
          <>
            <span className="text-[11px] font-mono font-medium text-[var(--md-sys-color-on-surface)]">
              {formatTokens(data?.tokens.total_consumed ?? 0)}
            </span>
            <span className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
              tok
            </span>
            {(data?.tokens.total_rate ?? 0) > 0 && (
              <span className="text-[10px] font-mono text-[var(--md-sys-color-on-surface-variant)] opacity-70">
                | {formatRate(data!.tokens.total_rate)}
              </span>
            )}
          </>
        )}
      </div>

      <Divider />

      {/* 4. Session pastilles */}
      <div
        className={cn(
          'flex items-center gap-3 flex-1 overflow-x-auto',
          'scrollbar-none',
        )}
        aria-label="Active sessions"
      >
        {loading ? (
          // Loading skeleton: three placeholder dots
          <>
            <Skeleton className="w-12 h-4 rounded-full" />
            <Skeleton className="w-12 h-4 rounded-full" />
            <Skeleton className="w-12 h-4 rounded-full" />
          </>
        ) : activeSessions.length === 0 ? (
          <span className="text-[10px] text-[var(--md-sys-color-on-surface-variant)] opacity-50 italic">
            Pas de session active
          </span>
        ) : (
          activeSessions.map((session) => (
            <SessionPastilleItem key={session.sessionId} session={session} />
          ))
        )}
      </div>

      {/* 5. Alert toasts */}
      {alerts.length > 0 && (
        <div
          className="flex items-center gap-1.5 shrink-0 overflow-x-auto max-w-[220px] scrollbar-none"
          aria-label="Threshold alerts"
        >
          {alerts.slice(-3).map((alert, i) => (
            <AlertToast
              key={`${alert.session_id}-${alert.timestamp}`}
              alert={alert}
              index={i}
              onDismiss={dismissAlert}
            />
          ))}
        </div>
      )}

      {/* 6. Cockpit link */}
      <div className="shrink-0 ml-auto">
        <Link
          href="/cockpit"
          className="
            text-[11px] font-medium
            text-[var(--md-sys-color-primary)]
            hover:text-[var(--md-sys-color-on-primary-container)]
            px-2 py-1 rounded-[var(--radius-md-sm)]
            hover:bg-[var(--md-sys-color-primary-container)]
            transition-all duration-150 md-motion-standard
            focus-visible:outline-2 focus-visible:outline-[var(--md-sys-color-primary)]
          "
        >
          Cockpit
        </Link>
      </div>
    </footer>
  );
}
