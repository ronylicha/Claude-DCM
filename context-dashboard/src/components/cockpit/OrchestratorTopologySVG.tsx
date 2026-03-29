'use client';

import { useState, useMemo } from 'react';
import type { TopologyData } from '@/hooks/useOrchestratorTopology';
import { formatModel } from '@/lib/format';

// ============================================
// Types & Config
// ============================================

interface Props {
  data: TopologyData;
}

const ZONE_COLORS: Record<string, string> = {
  green: 'var(--dcm-zone-green)',
  yellow: 'var(--dcm-zone-yellow)',
  orange: 'var(--dcm-zone-orange)',
  red: 'var(--dcm-zone-red)',
  critical: 'var(--dcm-zone-critical)',
};

const EDGE_COLORS: Record<string, string> = {
  info: 'var(--md-sys-color-primary)',
  directive: 'var(--md-sys-color-tertiary)',
  conflict: 'var(--dcm-zone-red)',
};

function getNodePositions(count: number, cx: number, cy: number, radius: number) {
  if (count === 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

// ============================================
// OrchestratorTopologySVG
// ============================================

export function OrchestratorTopologySVG({ data }: Props) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);

  const svgW = 700;
  const svgH = 320;
  const cx = svgW / 2;
  const cy = svgH / 2;
  const radius = Math.min(svgW, svgH) * 0.35;

  const positions = useMemo(() => getNodePositions(data.nodes.length, cx, cy, radius), [data.nodes.length, cx, cy, radius]);

  const positionMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    data.nodes.forEach((node, i) => map.set(node.session_id, positions[i]));
    map.set('orchestrator-global', { x: cx, y: cy });
    map.set('broadcast', { x: cx, y: cy });
    return map;
  }, [data.nodes, positions, cx, cy]);

  const isActive = data.orchestrator.status === 'active';

  if (data.nodes.length === 0) {
    return (
      <div className="h-[320px] flex items-center justify-center rounded-[16px] bg-[var(--md-sys-color-surface-container-lowest)] text-[var(--md-sys-color-outline)] text-[14px]">
        Aucune session active pour la topologie
      </div>
    );
  }

  return (
    <div className="relative rounded-[16px] overflow-hidden bg-[var(--md-sys-color-surface-container-lowest)]">
      {/* Legend */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-3 px-3 py-1.5 rounded-md-md bg-[var(--md-sys-color-surface-container)]/80 backdrop-blur-sm text-[10px] text-[var(--md-sys-color-on-surface-variant)]">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--dcm-zone-green)]" />OK</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--dcm-zone-yellow)]" />Warn</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--dcm-zone-orange)]" />High</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[var(--dcm-zone-red)]" />Crit</span>
      </div>

      {/* Hint */}
      <div className="absolute bottom-3 right-3 z-10 px-2 py-1 rounded-md-md bg-[var(--md-sys-color-surface-container)]/60 text-[10px] text-[var(--md-sys-color-outline)]">
        Click node to inspect
      </div>

      <svg
        viewBox={`0 0 ${svgW} ${svgH}`}
        className="w-full h-[320px]"
        style={{ minHeight: 280 }}
      >
        <defs>
          {/* Animated dash for connections */}
          <style>{`
            @keyframes dashFlow {
              to { stroke-dashoffset: -20; }
            }
            @keyframes pulse {
              0%, 100% { opacity: 0.6; }
              50% { opacity: 1; }
            }
            @keyframes coreRotate {
              to { transform: rotate(360deg); }
            }
            .dash-flow {
              animation: dashFlow 2s linear infinite;
            }
            .node-pulse {
              animation: pulse 2s ease-in-out infinite;
            }
            .core-ring {
              animation: coreRotate 20s linear infinite;
              transform-origin: ${cx}px ${cy}px;
            }
          `}</style>
        </defs>

        {/* Connection lines: DCM → sessions */}
        {data.nodes.map((node, i) => {
          const pos = positions[i];
          const color = ZONE_COLORS[node.zone] || ZONE_COLORS.green;
          const isHovered = hoveredNode === node.session_id || focusedNode === node.session_id;
          // Curved path via control point above midpoint
          const midX = (cx + pos.x) / 2;
          const midY = (cy + pos.y) / 2 - 15;
          return (
            <path
              key={`conn-${node.session_id}`}
              d={`M ${cx} ${cy} Q ${midX} ${midY} ${pos.x} ${pos.y}`}
              fill="none"
              stroke={isHovered ? color : 'var(--md-sys-color-outline-variant)'}
              strokeWidth={isHovered ? 2 : 1}
              strokeDasharray="6 4"
              className={node.active_agents > 0 ? 'dash-flow' : ''}
              opacity={isHovered ? 0.9 : 0.4}
            />
          );
        })}

        {/* Inter-session edges */}
        {data.edges.map((edge, i) => {
          const from = positionMap.get(edge.from_session);
          const to = positionMap.get(edge.to_session);
          if (!from || !to) return null;
          const color = EDGE_COLORS[edge.type] || EDGE_COLORS.info;
          return (
            <line
              key={`edge-${i}`}
              x1={from.x} y1={from.y}
              x2={to.x} y2={to.y}
              stroke={color}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              className="dash-flow"
              opacity={0.5}
            />
          );
        })}

        {/* DCM core node */}
        <g>
          {/* Outer ring (rotating) */}
          <circle
            cx={cx} cy={cy} r={32}
            fill="none"
            stroke={isActive ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline)'}
            strokeWidth={1.5}
            strokeDasharray="8 4"
            className="core-ring"
            opacity={0.5}
          />
          {/* Glow */}
          <circle
            cx={cx} cy={cy} r={24}
            fill={isActive ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline)'}
            opacity={0.08}
          />
          {/* Core hexagon */}
          <polygon
            points={Array.from({ length: 6 }, (_, i) => {
              const a = (Math.PI / 3) * i - Math.PI / 6;
              return `${cx + 18 * Math.cos(a)},${cy + 18 * Math.sin(a)}`;
            }).join(' ')}
            fill={isActive ? 'var(--md-sys-color-primary-container)' : 'var(--md-sys-color-surface-container)'}
            stroke={isActive ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline)'}
            strokeWidth={1.5}
          />
          <text
            x={cx} y={cy + 1}
            textAnchor="middle"
            dominantBaseline="central"
            fill={isActive ? 'var(--md-sys-color-on-primary-container)' : 'var(--md-sys-color-on-surface-variant)'}
            fontSize={10}
            fontWeight={700}
          >
            DCM
          </text>
        </g>

        {/* Session nodes */}
        {data.nodes.map((node, i) => {
          const pos = positions[i];
          const color = ZONE_COLORS[node.zone] || ZONE_COLORS.green;
          const isHovered = hoveredNode === node.session_id;
          const isFocused = focusedNode === node.session_id;
          const highlighted = isHovered || isFocused;
          const nodeRadius = 14 + (node.used_percentage / 100) * 10;
          const usageArc = (node.used_percentage / 100) * Math.PI * 2;

          return (
            <g
              key={node.session_id}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredNode(node.session_id)}
              onMouseLeave={() => setHoveredNode(null)}
              onClick={() => setFocusedNode(focusedNode === node.session_id ? null : node.session_id)}
            >
              {/* Usage ring track */}
              <circle
                cx={pos.x} cy={pos.y} r={nodeRadius + 4}
                fill="none"
                stroke="var(--md-sys-color-outline-variant)"
                strokeWidth={2}
                opacity={0.3}
              />
              {/* Usage ring arc */}
              <circle
                cx={pos.x} cy={pos.y} r={nodeRadius + 4}
                fill="none"
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={`${usageArc * (nodeRadius + 4)} ${999}`}
                transform={`rotate(-90 ${pos.x} ${pos.y})`}
                opacity={0.9}
              />
              {/* Node circle */}
              <circle
                cx={pos.x} cy={pos.y} r={nodeRadius}
                fill={highlighted ? color : 'var(--md-sys-color-surface-container)'}
                fillOpacity={highlighted ? 0.15 : 1}
                stroke={color}
                strokeWidth={highlighted ? 2 : 1.5}
              />
              {/* Pulse for active */}
              {node.active_agents > 0 && (
                <circle
                  cx={pos.x} cy={pos.y} r={nodeRadius}
                  fill="none"
                  stroke={color}
                  strokeWidth={1}
                  className="node-pulse"
                />
              )}
              {/* Project name */}
              <text
                x={pos.x} y={pos.y - nodeRadius - 8}
                textAnchor="middle"
                fill="var(--md-sys-color-on-surface)"
                fontSize={10}
                fontWeight={500}
              >
                {node.project_name || 'Unknown'}
              </text>
              {/* Percentage */}
              <text
                x={pos.x} y={pos.y + 1}
                textAnchor="middle"
                dominantBaseline="central"
                fill={highlighted ? color : 'var(--md-sys-color-on-surface-variant)'}
                fontSize={10}
                fontWeight={600}
              >
                {Math.round(node.used_percentage)}%
              </text>
              {/* Agent count badge */}
              {node.active_agents > 0 && (
                <g>
                  <circle
                    cx={pos.x + nodeRadius - 2} cy={pos.y - nodeRadius + 2} r={6}
                    fill={color}
                  />
                  <text
                    x={pos.x + nodeRadius - 2} y={pos.y - nodeRadius + 3}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill="white"
                    fontSize={7}
                    fontWeight={700}
                  >
                    {node.active_agents}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* Focused node detail card (M3 surface) */}
      {focusedNode && (() => {
        const node = data.nodes.find(n => n.session_id === focusedNode);
        if (!node) return null;
        const color = ZONE_COLORS[node.zone] || ZONE_COLORS.green;
        return (
          <div
            className="absolute top-3 right-3 z-10 w-[220px] p-3 rounded-md-md bg-[var(--md-sys-color-surface-container)] border border-[var(--md-sys-color-outline-variant)] shadow-md"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[13px] font-medium text-[var(--md-sys-color-on-surface)]">{node.project_name}</span>
            </div>
            <div className="space-y-1 text-[11px] text-[var(--md-sys-color-on-surface-variant)]">
              <div className="flex justify-between">
                <span>Model</span>
                <span className="font-medium text-[var(--md-sys-color-on-surface)]">{formatModel(node.model_id)}</span>
              </div>
              <div className="flex justify-between">
                <span>Context</span>
                <span className="font-medium" style={{ color }}>{Math.round(node.used_percentage)}% ({node.zone})</span>
              </div>
              <div className="flex justify-between">
                <span>Agents</span>
                <span className="font-medium text-[var(--md-sys-color-on-surface)]">{node.active_agents}</span>
              </div>
            </div>
            <button
              onClick={() => setFocusedNode(null)}
              className="mt-2 w-full text-[10px] text-[var(--md-sys-color-outline)] hover:text-[var(--md-sys-color-on-surface)] transition-colors"
            >
              Fermer
            </button>
          </div>
        );
      })()}
    </div>
  );
}
