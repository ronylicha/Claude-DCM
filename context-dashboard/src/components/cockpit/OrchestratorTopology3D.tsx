'use client';

import { useMemo, useState } from 'react';
import type { TopologyData } from '@/hooks/useOrchestratorTopology';

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
  if (count === 1) return [{ x: cx + radius, y: cy }];
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius };
  });
}

export function OrchestratorTopology3D({ data }: Props) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const width = 700;
  const height = 280;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.32;

  const positions = useMemo(
    () => getNodePositions(data.nodes.length, cx, cy, radius),
    [data.nodes.length, cx, cy, radius]
  );

  const positionMap = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    data.nodes.forEach((node, i) => {
      if (positions[i]) map.set(node.session_id, positions[i]);
    });
    map.set('orchestrator-global', { x: cx, y: cy });
    map.set('broadcast', { x: cx, y: cy });
    return map;
  }, [data.nodes, positions, cx, cy]);

  if (data.nodes.length === 0) {
    return (
      <div className="h-[280px] flex items-center justify-center text-[14px] text-[var(--md-sys-color-outline)]">
        Aucune session active pour la topologie
      </div>
    );
  }

  return (
    <div className="rounded-md-md overflow-hidden bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)]">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-[280px]"
        role="img"
        aria-label="Topologie de l'orchestrateur inter-projets"
      >
        <defs>
          {/* Glow filter */}
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          {/* Pulse animation */}
          <style>{`
            @keyframes pulse-ring { 0%,100% { opacity: 0.3; r: 28; } 50% { opacity: 0.6; r: 34; } }
            @keyframes rotate-orch { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            .pulse-ring { animation: pulse-ring 2s ease-in-out infinite; }
            .orch-rotate { animation: rotate-orch 10s linear infinite; transform-origin: ${cx}px ${cy}px; }
          `}</style>
        </defs>

        {/* Grid dots background */}
        {Array.from({ length: 15 }, (_, i) =>
          Array.from({ length: 6 }, (_, j) => (
            <circle
              key={`grid-${i}-${j}`}
              cx={i * (width / 14)}
              cy={j * (height / 5)}
              r="1"
              fill="var(--md-sys-color-outline-variant)"
              opacity="0.3"
            />
          ))
        )}

        {/* Edges from orchestrator to each session */}
        {data.nodes.map((node, i) => {
          const pos = positions[i];
          if (!pos) return null;
          return (
            <line
              key={`orch-edge-${node.session_id}`}
              x1={cx} y1={cy}
              x2={pos.x} y2={pos.y}
              stroke="var(--md-sys-color-outline-variant)"
              strokeWidth="1"
              strokeDasharray="4 4"
              opacity="0.5"
            />
          );
        })}

        {/* Directive/conflict edges */}
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
              strokeWidth={edge.type === 'conflict' ? 2.5 : 1.5}
              strokeDasharray={edge.type === 'conflict' ? 'none' : '6 3'}
              opacity="0.7"
            />
          );
        })}

        {/* Orchestrator central node */}
        <g>
          {/* Rotating hexagon */}
          <polygon
            className="orch-rotate"
            points={Array.from({ length: 6 }, (_, i) => {
              const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
              return `${cx + Math.cos(a) * 20},${cy + Math.sin(a) * 20}`;
            }).join(' ')}
            fill={data.orchestrator.status === 'active' ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline)'}
            opacity="0.8"
            filter="url(#glow)"
          />
          {data.orchestrator.status === 'active' && (
            <circle cx={cx} cy={cy} r="28" fill="none" stroke="var(--md-sys-color-primary)" strokeWidth="1" className="pulse-ring" />
          )}
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize="10" fontWeight="600" fill="white">
            DCM
          </text>
        </g>

        {/* Session nodes */}
        {data.nodes.map((node, i) => {
          const pos = positions[i];
          if (!pos) return null;
          const zoneColor = ZONE_COLORS[node.zone] || ZONE_COLORS.green;
          const nodeRadius = 14 + (node.used_percentage / 100) * 16; // 14 to 30
          const isHovered = hoveredNode === node.session_id;

          return (
            <g
              key={node.session_id}
              onMouseEnter={() => setHoveredNode(node.session_id)}
              onMouseLeave={() => setHoveredNode(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* Outer glow ring */}
              {node.active_agents > 0 && (
                <circle cx={pos.x} cy={pos.y} r={nodeRadius + 6} fill="none" stroke={zoneColor} strokeWidth="1" className="pulse-ring" />
              )}
              {/* Node circle */}
              <circle
                cx={pos.x} cy={pos.y} r={nodeRadius}
                fill={zoneColor}
                opacity={isHovered ? 0.95 : 0.75}
                filter={isHovered ? 'url(#glow)' : undefined}
                style={{ transition: 'opacity 0.2s, r 0.3s' }}
              />
              {/* Wireframe ring */}
              <circle cx={pos.x} cy={pos.y} r={nodeRadius} fill="none" stroke={zoneColor} strokeWidth="1.5" opacity="0.5" />
              {/* Project name */}
              <text x={pos.x} y={pos.y - nodeRadius - 8} textAnchor="middle" fontSize="11" fontWeight="500"
                fill="var(--md-sys-color-on-surface)">
                {node.project_name}
              </text>
              {/* Percentage inside */}
              <text x={pos.x} y={pos.y + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="white">
                {Math.round(node.used_percentage)}%
              </text>
              {/* Model label below */}
              <text x={pos.x} y={pos.y + nodeRadius + 14} textAnchor="middle" fontSize="9" fill="var(--md-sys-color-outline)">
                {node.model_id?.toLowerCase().includes('opus') ? 'Opus' : node.model_id?.toLowerCase().includes('sonnet') ? 'Sonnet' : ''}
              </text>

              {/* Hover tooltip */}
              {isHovered && (
                <foreignObject x={pos.x - 80} y={pos.y + nodeRadius + 20} width="160" height="60">
                  <div className="px-2 py-1.5 rounded-md-xs bg-[var(--md-sys-color-inverse-surface)] text-[var(--md-sys-color-inverse-on-surface)] text-[10px]">
                    <p className="font-medium">{node.project_name}</p>
                    <p>{Math.round(node.used_percentage)}% — {node.zone}</p>
                    <p>{node.active_agents} agent{node.active_agents !== 1 ? 's' : ''} actif{node.active_agents !== 1 ? 's' : ''}</p>
                  </div>
                </foreignObject>
              )}
            </g>
          );
        })}

        {/* Conflict markers */}
        {data.conflicts.map((conflict, i) => (
          <g key={`conflict-${i}`}>
            <text x={width - 10} y={20 + i * 16} textAnchor="end" fontSize="9" fill="var(--dcm-zone-red)">
              ⚠ {conflict.file_path.split('/').pop()}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
