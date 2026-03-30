'use client';

import type React from 'react';
import { Player } from '@remotion/player';
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  AbsoluteFill,
  Sequence,
} from 'remotion';

// ─── Types ───────────────────────────────────────────────────────────────────

interface StatsRecapProps {
  tokens: number;
  sessions: number;
  actions: number;
  agents: number;
  topAgent: string;
  successRate: number;
}

// ─── AnimatedCounter ─────────────────────────────────────────────────────────

function AnimatedCounter({
  value,
  label,
  icon,
  color,
}: {
  value: number;
  label: string;
  icon: string;
  color: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Count up over ~1.5 s with spring easing
  const progress = spring({ frame, fps, config: { damping: 80, mass: 0.5 } });
  const displayValue = Math.round(value * progress);

  // Fade + slide in on entry
  const opacity = interpolate(frame, [0, 15], [0, 1], { extrapolateRight: 'clamp' });
  const translateY = interpolate(frame, [0, 15], [30, 0], { extrapolateRight: 'clamp' });

  // Format large numbers with K/M suffix
  const formatted =
    displayValue >= 1_000_000
      ? `${(displayValue / 1_000_000).toFixed(1)}M`
      : displayValue >= 1_000
        ? `${(displayValue / 1_000).toFixed(1)}K`
        : displayValue.toString();

  return (
    <div
      style={{
        opacity,
        transform: `translateY(${translateY}px)`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
      }}
    >
      <span style={{ fontSize: 32 }}>{icon}</span>
      <span
        style={{
          fontSize: 48,
          fontWeight: 700,
          fontFamily: 'Geist, system-ui, sans-serif',
          color,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        {formatted}
      </span>
      <span
        style={{
          fontSize: 14,
          fontWeight: 500,
          color: 'rgba(255,255,255,0.6)',
          fontFamily: 'Geist, system-ui, sans-serif',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}
      >
        {label}
      </span>
    </div>
  );
}

// ─── GrowingBar ───────────────────────────────────────────────────────────────

function GrowingBar({
  value,
  maxValue,
  label,
  color,
  delay,
}: {
  value: number;
  maxValue: number;
  label: string;
  color: string;
  delay: number;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const adjustedFrame = Math.max(0, frame - delay);

  const widthProgress = spring({
    frame: adjustedFrame,
    fps,
    config: { damping: 60, mass: 0.8 },
  });

  const opacity = interpolate(adjustedFrame, [0, 10], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const barWidth = (value / maxValue) * 100 * widthProgress;
  const displayedValue = Math.round(value * widthProgress);

  return (
    <div
      style={{
        opacity,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        width: '100%',
      }}
    >
      <span
        style={{
          width: 120,
          fontSize: 14,
          color: 'rgba(255,255,255,0.8)',
          fontFamily: 'Geist, system-ui, sans-serif',
          textAlign: 'right',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <div
        style={{
          flex: 1,
          height: 24,
          background: 'rgba(255,255,255,0.1)',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${barWidth}%`,
            height: '100%',
            background: `linear-gradient(90deg, ${color}, ${color}88)`,
            borderRadius: 12,
          }}
        />
      </div>
      <span
        style={{
          width: 60,
          fontSize: 14,
          fontWeight: 600,
          color,
          fontFamily: '"Geist Mono", "Fira Code", monospace',
          flexShrink: 0,
          textAlign: 'right',
        }}
      >
        {displayedValue}%
      </span>
    </div>
  );
}

// ─── StatsComposition (Remotion root) ────────────────────────────────────────

function StatsComposition(props: StatsRecapProps) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Slowly rotating gradient background
  const gradientAngle = interpolate(frame, [0, durationInFrames], [135, 225]);

  // Title fade-in
  const titleOpacity = interpolate(frame, [0, 20], [0, 1], {
    extrapolateRight: 'clamp',
  });

  // Top-agent badge entrance (starts at frame fps*3 = 90)
  const badgeEntryFrame = Math.max(0, frame - fps * 3);
  const badgeOpacity = interpolate(badgeEntryFrame, [0, 20], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const badgeScale = spring({
    frame: badgeEntryFrame,
    fps,
    config: { damping: 50 },
  });

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${gradientAngle}deg, #0f172a 0%, #1e1b4b 40%, #0c4a6e 100%)`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 48,
        fontFamily: 'Geist, system-ui, sans-serif',
      }}
    >
      {/* ── Section title ── */}
      <div
        style={{
          position: 'absolute',
          top: 32,
          left: 0,
          right: 0,
          textAlign: 'center',
          opacity: titleOpacity,
        }}
      >
        <span
          style={{
            fontSize: 18,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.45)',
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
          }}
        >
          Récap DCM
        </span>
      </div>

      {/* ── KPI counters grid ── */}
      <Sequence from={10} durationInFrames={durationInFrames - 10}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 40,
            width: '100%',
            maxWidth: 800,
          }}
        >
          <AnimatedCounter
            value={props.tokens}
            label="Tokens"
            icon="🪙"
            color="#60a5fa"
          />
          <AnimatedCounter
            value={props.sessions}
            label="Sessions"
            icon="⚡"
            color="#34d399"
          />
          <AnimatedCounter
            value={props.actions}
            label="Actions"
            icon="🎯"
            color="#a78bfa"
          />
          <AnimatedCounter
            value={props.agents}
            label="Agents"
            icon="🤖"
            color="#fb923c"
          />
        </div>
      </Sequence>

      {/* ── Success-rate bar ── */}
      <Sequence from={fps * 2} durationInFrames={durationInFrames - fps * 2}>
        <div
          style={{
            width: '100%',
            maxWidth: 600,
            marginTop: 56,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <GrowingBar
            value={props.successRate}
            maxValue={100}
            label="Succès"
            color="#34d399"
            delay={0}
          />
        </div>
      </Sequence>

      {/* ── Top agent badge ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 36,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          opacity: badgeOpacity,
          transform: `scale(${badgeScale})`,
        }}
      >
        <div
          style={{
            padding: '10px 24px',
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 24,
            backdropFilter: 'blur(8px)',
          }}
        >
          <span
            style={{
              fontSize: 15,
              color: 'rgba(255,255,255,0.85)',
            }}
          >
            ⭐ Top agent :{' '}
            <strong style={{ color: '#fbbf24' }}>{props.topAgent}</strong>
          </span>
        </div>
      </div>
    </AbsoluteFill>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

/**
 * StatsRecap — Remotion Player wrapper for the animated stats recap card.
 *
 * Must be lazy-loaded via next/dynamic because the Remotion Player relies on
 * browser APIs incompatible with SSR:
 *
 * @example
 * const StatsRecap = dynamic(() => import('@/components/stats/StatsRecap'), { ssr: false });
 * <StatsRecap tokens={1_200_000} sessions={42} actions={8500} agents={12} topAgent="sonnet" successRate={94} />
 */
export default function StatsRecap(props: StatsRecapProps) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ aspectRatio: '16 / 9', maxHeight: 400 }}
    >
      <Player
        // Double cast required: Remotion's LooseComponentType expects
        // Record<string,unknown> but StatsComposition has a typed signature.
        // The cast is safe — inputProps is always a valid StatsRecapProps object.
        component={StatsComposition as unknown as React.ComponentType<Record<string, unknown>>}
        inputProps={props as unknown as Record<string, unknown>}
        durationInFrames={180}
        fps={30}
        compositionWidth={960}
        compositionHeight={540}
        style={{ width: '100%', height: '100%' }}
        controls
        loop
        autoPlay
      />
    </div>
  );
}
