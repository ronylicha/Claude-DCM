'use client';

import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { TopologyData } from '@/hooks/useOrchestratorTopology';

interface Props {
  data: TopologyData;
}

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

function getNodePositions(count: number, radius: number = 3): [number, number, number][] {
  if (count === 0) return [];
  if (count === 1) return [[radius, 0, 0]];
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return [Math.cos(angle) * radius, 0, Math.sin(angle) * radius] as [number, number, number];
  });
}

// Handle WebGL context loss gracefully
function ContextLossHandler() {
  const { gl } = useThree();

  useEffect(() => {
    const canvas = gl.domElement;
    const handleLost = (e: Event) => {
      e.preventDefault();
      console.warn('[Topology] WebGL context lost — will restore');
    };
    const handleRestored = () => {
      console.info('[Topology] WebGL context restored');
    };
    canvas.addEventListener('webglcontextlost', handleLost);
    canvas.addEventListener('webglcontextrestored', handleRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', handleLost);
      canvas.removeEventListener('webglcontextrestored', handleRestored);
    };
  }, [gl]);

  return null;
}

// Session sphere
function SessionNode({ position, node, isHovered, onHover }: {
  position: [number, number, number];
  node: TopologyData['nodes'][0];
  isHovered: boolean;
  onHover: (id: string | null) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const color = ZONE_COLORS[node.zone] || ZONE_COLORS.green;
  const scale = 0.3 + (node.used_percentage / 100) * 0.7;

  useFrame(() => {
    if (!meshRef.current) return;
    meshRef.current.position.y = position[1] + Math.sin(Date.now() * 0.001 + position[0]) * 0.05;
    if (node.active_agents > 0) {
      const pulse = 1 + Math.sin(Date.now() * 0.003) * 0.05;
      meshRef.current.scale.setScalar(scale * pulse);
    }
  });

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        scale={scale}
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
      <mesh scale={scale * 1.02}>
        <sphereGeometry args={[0.5, 16, 16]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={0.3} />
      </mesh>
      <Text
        position={[0, scale * 0.7 + 0.2, 0]}
        fontSize={0.18}
        color="white"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.02}
        outlineColor="black"
      >
        {node.project_name || 'Unknown'}
      </Text>
      <Text
        position={[0, -(scale * 0.7 + 0.15), 0]}
        fontSize={0.14}
        color={color}
        anchorX="center"
        anchorY="top"
      >
        {Math.round(node.used_percentage)}%
      </Text>
      {isHovered && (
        <Html position={[0, scale * 0.7 + 0.6, 0]} center>
          <div className="px-3 py-2 rounded-md-sm bg-[var(--md-sys-color-inverse-surface)] text-[var(--md-sys-color-inverse-on-surface)] text-[11px] whitespace-nowrap shadow-md-3 pointer-events-none">
            <p className="font-medium">{node.project_name}</p>
            <p>{node.model_id?.includes('opus') ? 'Opus' : node.model_id?.includes('sonnet') ? 'Sonnet' : node.model_id} — {Math.round(node.used_percentage)}% ({node.zone})</p>
            <p>{node.active_agents} agent{node.active_agents !== 1 ? 's' : ''} actif{node.active_agents !== 1 ? 's' : ''}</p>
          </div>
        </Html>
      )}
    </group>
  );
}

// Central orchestrator octahedron
function OrchestratorNode({ active }: { active: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y += 0.005;
    const pulse = active ? 1 + Math.sin(Date.now() * 0.002) * 0.08 : 1;
    meshRef.current.scale.setScalar(0.35 * pulse);
  });

  return (
    <group position={[0, 0.5, 0]}>
      <mesh ref={meshRef} scale={0.35}>
        <octahedronGeometry args={[0.5]} />
        <meshStandardMaterial
          color={active ? '#006494' : '#70787e'}
          emissive={active ? '#006494' : '#70787e'}
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

// Edge line
function EdgeLine({ from, to, type }: {
  from: [number, number, number];
  to: [number, number, number];
  type: string;
}) {
  const color = EDGE_COLORS[type] || EDGE_COLORS.info;
  const ref = useRef<THREE.LineSegments>(null);

  const geometry = useMemo(() => {
    const points = [new THREE.Vector3(...from), new THREE.Vector3(...to)];
    return new THREE.BufferGeometry().setFromPoints(points);
  }, [from, to]);

  return (
    <lineSegments ref={ref} geometry={geometry}>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={type === 'conflict' ? 0.9 : 0.4}
      />
    </lineSegments>
  );
}

// Scene content
function TopologyScene({ data }: Props) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const positions = useMemo(() => getNodePositions(data.nodes.length), [data.nodes.length]);
  const orchestratorPos: [number, number, number] = [0, 0.5, 0];

  const positionMap = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    data.nodes.forEach((node, i) => {
      map.set(node.session_id, positions[i]);
    });
    map.set('orchestrator-global', orchestratorPos);
    map.set('broadcast', orchestratorPos);
    return map;
  }, [data.nodes, positions]);

  return (
    <>
      <ContextLossHandler />
      <ambientLight intensity={0.4} />
      <pointLight position={[5, 5, 5]} intensity={0.8} />
      <pointLight position={[-5, 3, -5]} intensity={0.3} color="#8ecae6" />

      <OrchestratorNode active={data.orchestrator.status === 'active'} />

      {data.nodes.map((node, i) => (
        <SessionNode
          key={node.session_id}
          position={positions[i]}
          node={node}
          isHovered={hoveredNode === node.session_id}
          onHover={setHoveredNode}
        />
      ))}

      {data.nodes.map((node, i) => (
        <EdgeLine
          key={`orch-${node.session_id}`}
          from={orchestratorPos}
          to={positions[i]}
          type="info"
        />
      ))}

      {data.edges.map((edge, i) => {
        const from = positionMap.get(edge.from_session);
        const to = positionMap.get(edge.to_session);
        if (!from || !to) return null;
        return <EdgeLine key={`edge-${i}`} from={from} to={to} type={edge.type} />;
      })}

      <gridHelper args={[10, 20, '#1e2529', '#1e2529']} position={[0, -0.5, 0]} />

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

// Exported wrapper
export function OrchestratorTopology3D({ data }: Props) {
  const [contextLost, setContextLost] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const handleCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    canvasRef.current = gl.domElement;
    const canvas = gl.domElement;

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      setContextLost(true);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      setContextLost(false);
    });

    // Limit pixel ratio to reduce GPU load
    gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  }, []);

  if (data.nodes.length === 0) {
    return (
      <div className="h-[300px] flex items-center justify-center text-[var(--md-sys-color-outline)] text-[14px]">
        Aucune session active pour la topologie
      </div>
    );
  }

  if (contextLost) {
    return (
      <div className="h-[300px] flex flex-col items-center justify-center gap-2 rounded-md-md bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)]">
        <p className="text-[var(--md-sys-color-outline)] text-[14px]">WebGL context perdu</p>
        <button
          onClick={() => setContextLost(false)}
          className="px-3 py-1.5 rounded-md-sm bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)] text-[12px]"
        >
          Recharger
        </button>
      </div>
    );
  }

  return (
    <div className="h-[300px] rounded-md-md overflow-hidden bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)]">
      <Canvas
        camera={{ position: [0, 3, 5], fov: 50 }}
        gl={{
          antialias: true,
          alpha: true,
          powerPreference: 'default',
          preserveDrawingBuffer: true,
          failIfMajorPerformanceCaveat: false,
        }}
        dpr={[1, 1.5]}
        onCreated={handleCreated}
      >
        <TopologyScene data={data} />
      </Canvas>
    </div>
  );
}
