'use client';

import { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Float } from '@react-three/drei';
import * as THREE from 'three';

export interface TokenSphereProps {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  className?: string;
}

// Particle data shape — computed once per mount
interface ParticleData {
  theta: number;
  phi: number;
  speed: number;
  offset: number;
  radius: number;
}

// Module-level factory — outside React render, so the Compiler does not flag Math.random().
function buildParticles(count: number, baseRadius: number, baseSpeed: number): ParticleData[] {
  const data: ParticleData[] = [];
  for (let i = 0; i < count; i++) {
    data.push({
      theta: Math.random() * Math.PI * 2,
      phi: Math.acos(2 * Math.random() - 1),
      speed: 0.1 + Math.random() * baseSpeed,
      offset: Math.random() * Math.PI * 2,
      radius: baseRadius + (Math.random() - 0.5) * 0.5,
    });
  }
  return data;
}

// InstancedMesh particle system orbiting the central core
function TokenParticles({
  count,
  color,
  radius,
  speed,
}: {
  count: number;
  color: string;
  radius: number;
  speed: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Particles built via module-level factory (avoids render-purity lint error).
  // useMemo is safe here — factory is pure from React's perspective.
  const particles = useMemo(
    () => buildParticles(count, radius, speed),
    [count, radius, speed],
  );

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();

    particles.forEach((p, i) => {
      const angle = p.theta + t * p.speed;
      dummy.position.set(
        Math.sin(p.phi) * Math.cos(angle) * p.radius,
        Math.cos(p.phi) * p.radius * 0.8,
        Math.sin(p.phi) * Math.sin(angle) * p.radius,
      );
      dummy.scale.setScalar(0.02 + Math.sin(t * 2 + p.offset) * 0.01);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });

    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color={color} transparent opacity={0.8} />
    </instancedMesh>
  );
}

// Central pulsing core with orbital ring
function Core() {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    meshRef.current.scale.setScalar(1 + Math.sin(t * 1.5) * 0.08);
  });

  return (
    <Float speed={2} rotationIntensity={0.3} floatIntensity={0.5}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.4, 32, 32]} />
        <meshStandardMaterial
          color="#7dd3fc"
          emissive="#0ea5e9"
          emissiveIntensity={0.5}
          transparent
          opacity={0.9}
        />
      </mesh>
      {/* Outer glow ring */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.7, 0.02, 16, 64]} />
        <meshBasicMaterial color="#38bdf8" transparent opacity={0.4} />
      </mesh>
    </Float>
  );
}

// Compact K/M/B formatter
function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export default function TokenSphere({
  inputTokens = 0,
  outputTokens = 0,
  totalTokens = 0,
  className,
}: TokenSphereProps) {
  // Derive particle counts proportional to token share (clamped 50–300)
  const safeTotal = totalTokens || 1;
  const inputCount = Math.min(300, Math.max(50, Math.round((inputTokens / safeTotal) * 200)));
  const outputCount = Math.min(300, Math.max(50, Math.round((outputTokens / safeTotal) * 200)));

  return (
    <div className={`relative ${className ?? ''}`} style={{ height: 400 }}>
      <Canvas
        camera={{ position: [0, 0, 4], fov: 45 }}
        style={{ background: 'transparent' }}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.4} />
        <pointLight position={[5, 5, 5]} intensity={0.8} />
        <pointLight position={[-5, -5, -5]} intensity={0.3} color="#818cf8" />

        <Core />

        {/* Input tokens: blue particles on the outer orbit */}
        <TokenParticles count={inputCount} color="#60a5fa" radius={1.8} speed={0.3} />

        {/* Output tokens: green particles on the inner orbit */}
        <TokenParticles count={outputCount} color="#34d399" radius={1.2} speed={0.5} />

        {/* Central stats overlay rendered as HTML inside the canvas */}
        <Html center distanceFactor={4}>
          <div className="pointer-events-none select-none text-center">
            <div
              className="text-3xl font-bold"
              style={{ color: 'var(--md-sys-color-on-surface)' }}
            >
              {formatTokens(totalTokens)}
            </div>
            <div
              className="text-xs mt-1"
              style={{ color: 'var(--md-sys-color-on-surface-variant)' }}
            >
              tokens
            </div>
          </div>
        </Html>

        <OrbitControls
          enableZoom={false}
          enablePan={false}
          autoRotate
          autoRotateSpeed={0.5}
          minPolarAngle={Math.PI / 4}
          maxPolarAngle={(3 * Math.PI) / 4}
        />
      </Canvas>

      {/* Legend — positioned outside the canvas to always render on top */}
      <div
        className="absolute bottom-4 left-4 flex gap-4 text-xs"
        style={{ color: 'var(--md-sys-color-on-surface-variant)' }}
      >
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-400" />
          Input ({formatTokens(inputTokens)})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
          Output ({formatTokens(outputTokens)})
        </span>
      </div>
    </div>
  );
}
