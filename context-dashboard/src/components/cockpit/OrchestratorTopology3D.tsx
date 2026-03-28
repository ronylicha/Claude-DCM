'use client';

import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Text, Html, Float, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { TopologyData } from '@/hooks/useOrchestratorTopology';

// ============================================
// Constants
// ============================================

interface Props {
  data: TopologyData;
}

const ZONE_COLORS: Record<string, string> = {
  green: '#22c55e',
  yellow: '#eab308',
  orange: '#f97316',
  red: '#ef4444',
  critical: '#dc2626',
};

const EDGE_COLORS: Record<string, string> = {
  info: '#38bdf8',
  directive: '#a78bfa',
  conflict: '#f87171',
};

function getNodePositions(count: number, radius = 3.5): [number, number, number][] {
  if (count === 0) return [];
  if (count === 1) return [[radius, 0, 0]];
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const y = Math.sin(i * 0.8) * 0.3;
    return [Math.cos(angle) * radius, y, Math.sin(angle) * radius] as [number, number, number];
  });
}

// ============================================
// Ambient Particle Field
// ============================================

function ParticleField({ count = 300 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);

  const [positions, sizes] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const sz = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 8;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 16;
      sz[i] = Math.random() * 0.03 + 0.01;
    }
    return [pos, sz];
  }, [count]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime() * 0.05;
    ref.current.rotation.y = t;
    ref.current.rotation.x = Math.sin(t * 0.5) * 0.1;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <pointsMaterial color="#60a5fa" size={0.04} transparent opacity={0.4} sizeAttenuation />
    </points>
  );
}

// ============================================
// Glow Sprite — billboard glow effect
// ============================================

function GlowSprite({ color, scale = 1, opacity = 0.3 }: { color: string; scale?: number; opacity?: number }) {
  return (
    <sprite scale={[scale, scale, 1]}>
      <spriteMaterial
        color={color}
        transparent
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </sprite>
  );
}

// ============================================
// Orbital Ring — context usage indicator
// ============================================

function OrbitalRing({ percentage, zone, radius = 0.6 }: { percentage: number; zone: string; radius?: number }) {
  const ringRef = useRef<THREE.Mesh>(null);
  const color = ZONE_COLORS[zone] || ZONE_COLORS.green;
  const arc = (percentage / 100) * Math.PI * 2;

  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    ringRef.current.rotation.z = clock.getElapsedTime() * 0.3;
  });

  return (
    <group rotation={[Math.PI / 3, 0, 0]}>
      {/* Track ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.015, 8, 64]} />
        <meshBasicMaterial color="white" transparent opacity={0.08} />
      </mesh>
      {/* Usage arc */}
      <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[radius, 0.025, 8, 64, arc]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

// ============================================
// Session Node — glass sphere with orbital ring
// ============================================

function SessionNode({ position, node, isHovered, isFocused, onHover, onFocus }: {
  position: [number, number, number];
  node: TopologyData['nodes'][0];
  isHovered: boolean;
  isFocused: boolean;
  onHover: (id: string | null) => void;
  onFocus: (id: string | null) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const color = ZONE_COLORS[node.zone] || ZONE_COLORS.green;
  const baseScale = 0.25 + (node.used_percentage / 100) * 0.5;

  useFrame(({ clock }) => {
    if (!groupRef.current || !meshRef.current) return;
    const t = clock.getElapsedTime();

    // Floating motion
    groupRef.current.position.y = position[1] + Math.sin(t * 0.8 + position[0]) * 0.08;

    // Pulse when active
    if (node.active_agents > 0) {
      const pulse = 1 + Math.sin(t * 2.5) * 0.04;
      meshRef.current.scale.setScalar(baseScale * pulse);
    }

    // Hover scale
    const target = isHovered || isFocused ? baseScale * 1.15 : baseScale;
    const current = meshRef.current.scale.x;
    meshRef.current.scale.setScalar(THREE.MathUtils.lerp(current, target, 0.08));
  });

  const formatModel = (id: string | null | undefined) => {
    if (!id) return 'Unknown';
    const l = id.toLowerCase();
    if (l.includes('opus')) return 'Opus';
    if (l.includes('sonnet')) return 'Sonnet';
    if (l.includes('haiku')) return 'Haiku';
    return id;
  };

  return (
    <group ref={groupRef} position={position}>
      {/* Core sphere */}
      <mesh
        ref={meshRef}
        scale={baseScale}
        onPointerOver={(e) => { e.stopPropagation(); onHover(node.session_id); }}
        onPointerOut={() => onHover(null)}
        onClick={(e) => { e.stopPropagation(); onFocus(isFocused ? null : node.session_id); }}
      >
        <icosahedronGeometry args={[0.5, 2]} />
        <meshPhysicalMaterial
          color={color}
          emissive={color}
          emissiveIntensity={isHovered || isFocused ? 0.6 : 0.2}
          transparent
          opacity={0.7}
          roughness={0.1}
          metalness={0.3}
          clearcoat={1}
          clearcoatRoughness={0.1}
        />
      </mesh>

      {/* Wireframe overlay */}
      <mesh scale={baseScale * 1.02}>
        <icosahedronGeometry args={[0.5, 1]} />
        <meshBasicMaterial color={color} wireframe transparent opacity={isHovered ? 0.4 : 0.15} />
      </mesh>

      {/* Glow */}
      <GlowSprite color={color} scale={baseScale * 2.5} opacity={isHovered || isFocused ? 0.4 : 0.15} />

      {/* Orbital ring — usage % */}
      <OrbitalRing percentage={node.used_percentage} zone={node.zone} radius={baseScale * 1.4} />

      {/* Project name */}
      <Text
        position={[0, baseScale * 0.8 + 0.2, 0]}
        fontSize={0.16}
        color="white"
        anchorX="center"
        anchorY="bottom"
        outlineWidth={0.015}
        outlineColor="black"
        font="/fonts/inter-medium.woff"
      >
        {node.project_name || 'Unknown'}
      </Text>

      {/* Usage % */}
      <Text
        position={[0, -(baseScale * 0.8 + 0.12), 0]}
        fontSize={0.13}
        color={color}
        anchorX="center"
        anchorY="top"
      >
        {Math.round(node.used_percentage)}%
      </Text>

      {/* Agent count dots */}
      {node.active_agents > 0 && Array.from({ length: Math.min(node.active_agents, 5) }).map((_, idx) => {
        const dotAngle = (idx / Math.min(node.active_agents, 5)) * Math.PI * 2;
        const dotR = baseScale * 0.9;
        return (
          <mesh key={idx} position={[Math.cos(dotAngle) * dotR, -baseScale * 0.6, Math.sin(dotAngle) * dotR]} scale={0.04}>
            <sphereGeometry args={[1, 8, 8]} />
            <meshBasicMaterial color={color} />
          </mesh>
        );
      })}

      {/* Hover tooltip */}
      {(isHovered || isFocused) && (
        <Html position={[0, baseScale * 0.8 + 0.55, 0]} center>
          <div className="px-4 py-3 rounded-xl bg-[var(--md-sys-color-inverse-surface)]/95 backdrop-blur-sm text-[var(--md-sys-color-inverse-on-surface)] text-[11px] whitespace-nowrap shadow-lg pointer-events-none border border-white/10">
            <p className="font-semibold text-[13px] mb-1">{node.project_name}</p>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span>{formatModel(node.model_id)} — {Math.round(node.used_percentage)}%</span>
            </div>
            <p className="text-[10px] opacity-70">
              {node.active_agents} agent{node.active_agents !== 1 ? 's' : ''} actif{node.active_agents !== 1 ? 's' : ''}
              {node.zone !== 'green' && <span className="ml-1 font-medium" style={{ color }}>[{node.zone}]</span>}
            </p>
          </div>
        </Html>
      )}
    </group>
  );
}

// ============================================
// Central DCM Core — glowing icosahedron
// ============================================

function DCMCore({ active, nodeCount }: { active: boolean; nodeCount: number }) {
  const coreRef = useRef<THREE.Mesh>(null);
  const wireRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (coreRef.current) {
      coreRef.current.rotation.y = t * 0.2;
      coreRef.current.rotation.x = Math.sin(t * 0.15) * 0.2;
      const pulse = active ? 1 + Math.sin(t * 1.5) * 0.08 : 1;
      coreRef.current.scale.setScalar(0.4 * pulse);
    }
    if (wireRef.current) {
      wireRef.current.rotation.y = -t * 0.15;
      wireRef.current.rotation.z = t * 0.1;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.4;
    }
  });

  const coreColor = active ? '#38bdf8' : '#64748b';
  const glowColor = active ? '#0ea5e9' : '#475569';

  return (
    <Float speed={1.5} rotationIntensity={0.1} floatIntensity={0.3}>
      <group position={[0, 0.3, 0]}>
        {/* Inner core */}
        <mesh ref={coreRef} scale={0.4}>
          <icosahedronGeometry args={[0.5, 1]} />
          <meshPhysicalMaterial
            color={coreColor}
            emissive={coreColor}
            emissiveIntensity={active ? 0.8 : 0.2}
            transparent
            opacity={0.85}
            roughness={0}
            metalness={0.5}
            clearcoat={1}
          />
        </mesh>

        {/* Wireframe shell */}
        <mesh ref={wireRef} scale={0.52}>
          <icosahedronGeometry args={[0.5, 0]} />
          <meshBasicMaterial color={coreColor} wireframe transparent opacity={0.3} />
        </mesh>

        {/* Equatorial ring */}
        <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.35, 0.012, 8, 64]} />
          <meshBasicMaterial color={coreColor} transparent opacity={0.6} />
        </mesh>

        {/* Glow halo */}
        <GlowSprite color={glowColor} scale={1.8} opacity={active ? 0.35 : 0.1} />

        {/* Label */}
        <Text
          position={[0, 0.5, 0]}
          fontSize={0.14}
          color={active ? '#7dd3fc' : '#94a3b8'}
          anchorX="center"
          letterSpacing={0.12}
          font="/fonts/inter-medium.woff"
        >
          DCM
        </Text>
        <Text
          position={[0, -0.45, 0]}
          fontSize={0.09}
          color={active ? '#7dd3fc' : '#64748b'}
          anchorX="center"
          font="/fonts/inter-medium.woff"
        >
          {nodeCount} session{nodeCount !== 1 ? 's' : ''}
        </Text>
      </group>
    </Float>
  );
}

// ============================================
// Animated Connection Beam
// ============================================

function ConnectionBeam({ from, to, type, active }: {
  from: [number, number, number];
  to: [number, number, number];
  type: string;
  active?: boolean;
}) {
  const particlesRef = useRef<THREE.Points>(null);
  const color = EDGE_COLORS[type] || EDGE_COLORS.info;
  const particleCount = 8;

  const curve = useMemo(() => {
    const start = new THREE.Vector3(...from);
    const end = new THREE.Vector3(...to);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    mid.y += 0.4 + start.distanceTo(end) * 0.1;
    return new THREE.QuadraticBezierCurve3(start, mid, end);
  }, [from, to]);

  const linePoints = useMemo(() => {
    return curve.getPoints(40).map(p => [p.x, p.y, p.z] as [number, number, number]);
  }, [curve]);

  const particlePositions = useMemo(() => new Float32Array(particleCount * 3), []);

  useFrame(({ clock }) => {
    if (!particlesRef.current) return;
    const t = clock.getElapsedTime();
    const positions = particlesRef.current.geometry.attributes.position;
    for (let i = 0; i < particleCount; i++) {
      const progress = ((t * 0.3 + i / particleCount) % 1);
      const point = curve.getPoint(progress);
      positions.array[i * 3] = point.x;
      positions.array[i * 3 + 1] = point.y;
      positions.array[i * 3 + 2] = point.z;
    }
    positions.needsUpdate = true;
  });

  return (
    <group>
      {/* Curved beam line (Drei Line component) */}
      <Line
        points={linePoints}
        color={color}
        transparent
        opacity={type === 'conflict' ? 0.7 : active ? 0.5 : 0.2}
        lineWidth={1.5}
      />

      {/* Flowing particles */}
      <points ref={particlesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[particlePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={color}
          size={0.06}
          transparent
          opacity={0.8}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

// ============================================
// Camera Controller — click-to-focus
// ============================================

function CameraController({ focusTarget }: { focusTarget: [number, number, number] | null }) {
  const { camera } = useThree();
  const targetRef = useRef(new THREE.Vector3(0, 0.3, 0));
  const positionRef = useRef(new THREE.Vector3(0, 3.5, 6));

  useFrame(() => {
    if (focusTarget) {
      const focusPos = new THREE.Vector3(...focusTarget);
      const offset = focusPos.clone().normalize().multiplyScalar(2.5);
      offset.y = 2;
      targetRef.current.lerp(focusPos, 0.04);
      positionRef.current.lerp(focusPos.clone().add(offset), 0.04);
    } else {
      targetRef.current.lerp(new THREE.Vector3(0, 0.3, 0), 0.03);
      positionRef.current.lerp(new THREE.Vector3(0, 3.5, 6), 0.03);
    }

    camera.position.lerp(positionRef.current, 0.06);
    camera.lookAt(targetRef.current);
  });

  return null;
}

// ============================================
// WebGL Context Loss Handler
// ============================================

function ContextLossHandler() {
  const { gl } = useThree();
  useEffect(() => {
    const canvas = gl.domElement;
    const handleLost = (e: Event) => { e.preventDefault(); };
    const handleRestored = () => { /* auto-restore */ };
    canvas.addEventListener('webglcontextlost', handleLost);
    canvas.addEventListener('webglcontextrestored', handleRestored);
    return () => {
      canvas.removeEventListener('webglcontextlost', handleLost);
      canvas.removeEventListener('webglcontextrestored', handleRestored);
    };
  }, [gl]);
  return null;
}

// ============================================
// Scene
// ============================================

function TopologyScene({ data }: Props) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [focusedNode, setFocusedNode] = useState<string | null>(null);

  const positions = useMemo(() => getNodePositions(data.nodes.length), [data.nodes.length]);
  const orchestratorPos: [number, number, number] = [0, 0.3, 0];

  const positionMap = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    data.nodes.forEach((node, i) => map.set(node.session_id, positions[i]));
    map.set('orchestrator-global', orchestratorPos);
    map.set('broadcast', orchestratorPos);
    return map;
  }, [data.nodes, positions]);

  const focusPosition = useMemo(() => {
    if (!focusedNode) return null;
    return positionMap.get(focusedNode) || null;
  }, [focusedNode, positionMap]);

  return (
    <>
      <ContextLossHandler />
      <CameraController focusTarget={focusPosition} />

      {/* Lighting */}
      <ambientLight intensity={0.25} />
      <pointLight position={[6, 6, 6]} intensity={1} color="#e0f2fe" />
      <pointLight position={[-6, 4, -4]} intensity={0.5} color="#a78bfa" />
      <pointLight position={[0, -2, 0]} intensity={0.3} color="#38bdf8" />

      {/* Ambient particles */}
      <ParticleField count={250} />

      {/* Ground plane — subtle grid */}
      <gridHelper args={[14, 28, '#1e293b', '#1e293b']} position={[0, -1, 0]} />
      <mesh position={[0, -1.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[14, 14]} />
        <meshBasicMaterial color="#0f172a" transparent opacity={0.5} />
      </mesh>

      {/* DCM Core */}
      <DCMCore active={data.orchestrator.status === 'active'} nodeCount={data.nodes.length} />

      {/* Session Nodes */}
      {data.nodes.map((node, i) => (
        <SessionNode
          key={node.session_id}
          position={positions[i]}
          node={node}
          isHovered={hoveredNode === node.session_id}
          isFocused={focusedNode === node.session_id}
          onHover={setHoveredNode}
          onFocus={setFocusedNode}
        />
      ))}

      {/* Connection beams: DCM → Sessions */}
      {data.nodes.map((node, i) => (
        <ConnectionBeam
          key={`dcm-${node.session_id}`}
          from={orchestratorPos}
          to={positions[i]}
          type="info"
          active={node.active_agents > 0}
        />
      ))}

      {/* Inter-session edges */}
      {data.edges.map((edge, i) => {
        const from = positionMap.get(edge.from_session);
        const to = positionMap.get(edge.to_session);
        if (!from || !to) return null;
        return <ConnectionBeam key={`edge-${i}`} from={from} to={to} type={edge.type} />;
      })}

      <OrbitControls
        enablePan={false}
        minDistance={3}
        maxDistance={12}
        maxPolarAngle={Math.PI / 2.1}
        autoRotate={!focusedNode}
        autoRotateSpeed={0.4}
        enableDamping
        dampingFactor={0.05}
      />
    </>
  );
}

// ============================================
// Exported wrapper
// ============================================

export function OrchestratorTopology3D({ data }: Props) {
  const [contextLost, setContextLost] = useState(false);

  const handleCreated = useCallback(({ gl }: { gl: THREE.WebGLRenderer }) => {
    const canvas = gl.domElement;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setContextLost(true); });
    canvas.addEventListener('webglcontextrestored', () => setContextLost(false));
    gl.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.2;
  }, []);

  if (data.nodes.length === 0) {
    return (
      <div className="h-[400px] flex items-center justify-center text-[var(--md-sys-color-outline)] text-[14px]">
        Aucune session active pour la topologie
      </div>
    );
  }

  if (contextLost) {
    return (
      <div className="h-[400px] flex flex-col items-center justify-center gap-2 rounded-md-md bg-[var(--md-sys-color-surface-container-lowest)] border border-[var(--md-sys-color-outline-variant)]">
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
    <div className="h-[400px] rounded-md-md overflow-hidden bg-gradient-to-b from-[#0c1222] to-[#0f172a] border border-[var(--md-sys-color-outline-variant)] relative">
      {/* Legend overlay */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-3 px-3 py-1.5 rounded-lg bg-black/40 backdrop-blur-sm text-[10px] text-white/60">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#22c55e]" />OK</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#eab308]" />Warn</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#f97316]" />High</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#ef4444]" />Crit</span>
      </div>

      {/* Interaction hint */}
      <div className="absolute bottom-3 right-3 z-10 px-2 py-1 rounded-md bg-black/30 backdrop-blur-sm text-[10px] text-white/40">
        Click node to focus &middot; Drag to orbit
      </div>

      <Canvas
        camera={{ position: [0, 3.5, 6], fov: 45 }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'default',
          preserveDrawingBuffer: true,
          failIfMajorPerformanceCaveat: false,
        }}
        dpr={[1, 1.5]}
        onCreated={handleCreated}
      >
        <color attach="background" args={['#0c1222']} />
        <fog attach="fog" args={['#0c1222', 8, 18]} />
        <TopologyScene data={data} />
      </Canvas>
    </div>
  );
}
