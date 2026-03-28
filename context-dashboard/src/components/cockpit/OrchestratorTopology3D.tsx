'use client';

import { useRef, useMemo, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { TopologyData } from '@/hooks/useOrchestratorTopology';

// ============================================
// Props
// ============================================

interface Props {
  data: TopologyData;
}

// ============================================
// Constants — hex colours matching M3 palette values
// Three.js cannot read CSS custom properties, so we
// replicate the palette values inline.
// ============================================

const ZONE_COLORS: Record<string, string> = {
  green: '#1b873b',
  yellow: '#9a7b00',
  orange: '#b65c00',
  red: '#ba1a1a',
  critical: '#8c0009',
};

const EDGE_COLORS: Record<string, string> = {
  info: '#006494',
  directive: '#5e5b7e',
  conflict: '#ba1a1a',
};

// ============================================
// Helpers
// ============================================

/**
 * Distribute nodes evenly on a circle in the XZ plane.
 * With 1 node we place it at the origin; with 0 we return [].
 */
function getNodePositions(count: number, radius = 3): Array<[number, number, number]> {
  if (count === 0) return [];
  if (count === 1) return [[0, 0, 0]];
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return [Math.cos(angle) * radius, 0, Math.sin(angle) * radius] as [number, number, number];
  });
}

// ============================================
// SessionNode — animated sphere for each session
// ============================================

interface SessionNodeProps {
  position: [number, number, number];
  node: TopologyData['nodes'][0];
  isHovered: boolean;
  onHover: (id: string | null) => void;
}

function SessionNode({ position, node, isHovered, onHover }: SessionNodeProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const color = ZONE_COLORS[node.zone] ?? ZONE_COLORS.green;

  // Scale grows with context usage (0.3 – 1.0)
  const baseScale = 0.3 + (node.used_percentage / 100) * 0.7;

  useFrame(() => {
    if (!meshRef.current) return;

    // Gentle floating along Y
    meshRef.current.position.y =
      position[1] + Math.sin(Date.now() * 0.001 + position[0]) * 0.05;

    // Pulse when active agents are running
    const pulse =
      node.active_agents > 0 ? 1 + Math.sin(Date.now() * 0.003) * 0.05 : 1;
    meshRef.current.scale.setScalar(baseScale * pulse);

    if (wireRef.current) {
      wireRef.current.position.y = meshRef.current.position.y;
      wireRef.current.scale.setScalar(baseScale * pulse * 1.02);
    }
  });

  return (
    <group position={position}>
      {/* Solid sphere */}
      <mesh
        ref={meshRef}
        scale={baseScale}
        onPointerOver={() => onHover(node.session_id)}
        onPointerOut={() => onHover(null)}
      >
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isHovered ? 0.5 : 0.15}
          transparent
          opacity={0.85}
        />
      </mesh>

      {/* Wireframe overlay */}
      <mesh ref={wireRef} scale={baseScale * 1.02}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.3} />
      </mesh>

      {/* Project name label */}
      <Text
        position={[0, baseScale * 0.7 + 0.2, 0]}
        fontSize={0.18}
        color="white"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.02}
        outlineColor="black"
      >
        {node.project_name}
      </Text>

      {/* Usage percentage label */}
      <Text
        position={[0, -(baseScale * 0.7 + 0.15), 0]}
        fontSize={0.14}
        color={color}
        anchorX="center"
        anchorY="top"
      >
        {Math.round(node.used_percentage)}%
      </Text>

      {/* Hover tooltip rendered in HTML */}
      {isHovered && (
        <Html position={[0, baseScale * 0.7 + 0.6, 0]} center>
          <div
            className="px-3 py-2 rounded-md-sm shadow-lg whitespace-nowrap pointer-events-none text-[11px]"
            style={{
              background: 'var(--md-sys-color-inverse-surface)',
              color: 'var(--md-sys-color-inverse-on-surface)',
            }}
          >
            <p className="font-medium">{node.project_name}</p>
            <p>
              {node.model_id} — {Math.round(node.used_percentage)}% ({node.zone})
            </p>
            <p>
              {node.active_agents} agent{node.active_agents !== 1 ? 's' : ''} actif
              {node.active_agents !== 1 ? 's' : ''}
            </p>
          </div>
        </Html>
      )}
    </group>
  );
}

// ============================================
// OrchestratorNode — rotating octahedron at centre
// ============================================

interface OrchestratorNodeProps {
  active: boolean;
}

function OrchestratorNode({ active }: OrchestratorNodeProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y += 0.005;
    const pulse = active ? 1 + Math.sin(Date.now() * 0.002) * 0.08 : 1;
    meshRef.current.scale.setScalar(0.35 * pulse);
  });

  const color = active ? '#006494' : '#70787e';

  return (
    <group position={[0, 0.5, 0]}>
      <mesh ref={meshRef} scale={0.35}>
        <octahedronGeometry args={[0.5]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={active ? 0.4 : 0.1}
          transparent
          opacity={0.9}
        />
      </mesh>
      <Text
        position={[0, 0.5, 0]}
        fontSize={0.12}
        color={active ? '#8ecae6' : '#8a9299'}
        anchorX="center"
      >
        DCM
      </Text>
    </group>
  );
}

// ============================================
// EdgeLine — line between two 3D positions
// ============================================

interface EdgeLineProps {
  from: [number, number, number];
  to: [number, number, number];
  type: string;
}

function EdgeLine({ from, to, type }: EdgeLineProps) {
  const color = EDGE_COLORS[type] ?? EDGE_COLORS.info;

  const geometry = useMemo(() => {
    const points = [new THREE.Vector3(...from), new THREE.Vector3(...to)];
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [from, to]);

  return (
    // @ts-expect-error — JSX primitive <line> is valid in R3F
    <line geometry={geometry}>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={type === 'conflict' ? 0.9 : 0.4}
      />
    </line>
  );
}

// ============================================
// TopologyScene — the full R3F scene graph
// ============================================

function TopologyScene({ data }: Props) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const positions = useMemo(
    () => getNodePositions(data.nodes.length),
    [data.nodes.length]
  );

  const orchestratorPos: [number, number, number] = [0, 0.5, 0];

  // Build a lookup from session_id → world position for edges
  const positionMap = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    data.nodes.forEach((node, i) => {
      map.set(node.session_id, positions[i]);
    });
    map.set('orchestrator-global', orchestratorPos);
    map.set('broadcast', orchestratorPos);
    return map;
    // orchestratorPos is a constant — safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.nodes, positions]);

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <pointLight position={[5, 5, 5]} intensity={0.8} />
      <pointLight position={[-5, 3, -5]} intensity={0.3} color="#8ecae6" />

      {/* Central orchestrator */}
      <OrchestratorNode active={data.orchestrator.status === 'active'} />

      {/* Session spheres */}
      {data.nodes.map((node, i) => (
        <SessionNode
          key={node.session_id}
          position={positions[i]}
          node={node}
          isHovered={hoveredNode === node.session_id}
          onHover={setHoveredNode}
        />
      ))}

      {/* Radial lines: orchestrator → each session */}
      {data.nodes.map((node, i) => (
        <EdgeLine
          key={`orch-${node.session_id}`}
          from={orchestratorPos}
          to={positions[i]}
          type="info"
        />
      ))}

      {/* Cross-session edges (directives / conflicts) */}
      {data.edges.map((edge, i) => {
        const from = positionMap.get(edge.from_session);
        const to = positionMap.get(edge.to_session);
        if (!from || !to) return null;
        return (
          <EdgeLine
            key={`edge-${i}`}
            from={from}
            to={to}
            type={edge.type}
          />
        );
      })}

      {/* Subtle grid floor */}
      <gridHelper args={[10, 20, '#1e2529', '#1e2529']} position={[0, -0.5, 0]} />

      {/* Camera controls */}
      <OrbitControls
        enablePan={false}
        minDistance={3}
        maxDistance={10}
        maxPolarAngle={Math.PI / 2.2}
        autoRotate
        autoRotateSpeed={0.3}
      />
    </>
  );
}

// ============================================
// OrchestratorTopology3D — exported wrapper
// ============================================

export function OrchestratorTopology3D({ data }: Props) {
  if (data.nodes.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-[14px] text-[var(--md-sys-color-outline)]">
        Aucune session active pour la topologie
      </div>
    );
  }

  return (
    <div
      className="h-[300px] rounded-md-md overflow-hidden bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)]"
      role="img"
      aria-label="Topologie 3D de l'orchestrateur"
    >
      <Canvas
        camera={{ position: [0, 3, 5], fov: 50 }}
        gl={{ antialias: true, alpha: true }}
      >
        <TopologyScene data={data} />
      </Canvas>
    </div>
  );
}
