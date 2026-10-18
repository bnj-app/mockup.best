'use client';

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';

/**
 * 3D stages place the device on a physical floor.
 *
 * Lightweight construction: one wide floor disk, procedural texture, and a
 * baked central light pool fading to the background with alpha, without
 * a horizon line. Existing systems provide contact shadows and Reflection;
 * polished concrete is slightly transparent so reflections show through.
 */
export type Stage3DKind = 'none' | 'sweep' | 'concrete';

export const STAGE3D: { id: Stage3DKind; label: string; backgroundId: string }[] = [
  { id: 'none', label: 'None', backgroundId: '' },
  { id: 'sweep', label: 'Studio sweep', backgroundId: 'steel' },
  { id: 'concrete', label: 'Concrete', backgroundId: 'noir' },
];

const texCache = new Map<string, THREE.Texture>();

function rand(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function floorTexture(kind: 'sweep' | 'concrete'): THREE.Texture {
  const hit = texCache.get(kind);
  if (hit) return hit;
  const N = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d')!;
  const r = rand(kind === 'concrete' ? 7 : 3);
  if (kind === 'concrete') {
    x.fillStyle = '#16171a';
    x.fillRect(0, 0, N, N);
    // Broad patches and fine aggregate.
    for (let i = 0; i < 260; i++) {
      const g = x.createRadialGradient(r() * N, r() * N, 0, r() * N, r() * N, 30 + r() * 140);
      const v = 22 + r() * 22;
      g.addColorStop(0, `rgba(${v},${v},${v + 3},0.25)`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, N, N);
    }
    for (let i = 0; i < 24000; i++) {
      const v = r() < 0.5 ? 60 + r() * 40 : 10 + r() * 15;
      x.fillStyle = `rgba(${v},${v},${v},${0.18 + r() * 0.2})`;
      x.fillRect(r() * N, r() * N, 1 + r() * 1.6, 1 + r() * 1.6);
    }
    // Light pool.
    const pool = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N * 0.32);
    pool.addColorStop(0, 'rgba(255,248,236,0.18)');
    pool.addColorStop(1, 'rgba(255,248,236,0)');
    x.fillStyle = pool;
    x.fillRect(0, 0, N, N);
  } else {
    const g = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N * 0.5);
    g.addColorStop(0, '#fbfbfc');
    g.addColorStop(1, '#d9dbe0');
    x.fillStyle = g;
    x.fillRect(0, 0, N, N);
    for (let i = 0; i < 6000; i++) {
      x.fillStyle = `rgba(0,0,0,${r() * 0.025})`;
      x.fillRect(r() * N, r() * N, 2, 2);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  texCache.set(kind, t);
  return t;
}

let fadeTex: THREE.Texture | null = null;
function radialFade(): THREE.Texture {
  if (fadeTex) return fadeTex;
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, '#ffffff');
  g.addColorStop(1, '#000000');
  x.fillStyle = g;
  x.fillRect(0, 0, N, N);
  fadeTex = new THREE.CanvasTexture(c);
  return fadeTex;
}

export function Stage3D({ kind, y, size }: { kind: Stage3DKind; y: number; size: number }) {
  const mat = useMemo(() => {
    if (kind === 'none') return null;
    return new THREE.MeshStandardMaterial({
      map: floorTexture(kind),
      // Scene and photo-studio lights were turning even dark textures gray.
      color: kind === 'concrete' ? '#5a5a5e' : '#ffffff',
      alphaMap: radialFade(),
      transparent: true,
      depthWrite: false,
      roughness: kind === 'concrete' ? 0.72 : 0.92,
      metalness: 0,
      // Polished concrete lets the reflection copy show faintly through the floor.
      opacity: kind === 'concrete' ? 0.86 : 1,
      envMapIntensity: kind === 'concrete' ? 0.12 : 0.9,
    });
  }, [kind]);
  // Changing floor type (sweep ↔ concrete) reuses the component with a new material.
  // Dispose the old material or its GPU program survives until the tab closes.
  // floorTexture/radialFade are shared cached textures; material.dispose does not affect them.
  useEffect(() => () => mat?.dispose(), [mat]);
  if (!mat) return null;
  const R = size * 9;
  return (
    <mesh position={[0, y - size * 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={-2} material={mat}>
      <circleGeometry args={[R, 96]} />
    </mesh>
  );
}
