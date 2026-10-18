import * as THREE from 'three';
import type { ScreenGlow } from './environment';

/**
 * HDR studio: environment built from full-brightness light panels. Why: procedural presets use an
 * 8-bit canvas, clipping even an "intensity 2.6" softbox to 1.0 (white). Metal reflects only its
 * environment, so sharp, bright edge highlights could not form; six presets looked nearly identical
 * on dark metal in measurements. Here a small THREE scene contains the room and panels at
 * brightness 20–60, baked by PMREM into a HalfFloat target for true HDR. Same fromScene + cache
 * pattern as getHdriGlowEnvironment. Direction convention: az = 0 → +Z (screen-facing, toward
 * camera), az = 90 → +X (right), el = 90 → overhead. envRotation rotates everything together.
 */
export type StudioLight = {
  /** Azimuth (degrees). 0 = front, ±90 = sides, 180 = back. */
  az: number;
  /** Elevation angle (degrees). */
  el: number;
  /** Angular width / height (degrees). */
  w: number;
  h: number;
  /** Linear brightness: 1 = white paper, 20+ = softbox, 0 = black panel (flag). */
  intensity: number;
  /** 0 = sharp edge (strip), 1 = very soft (diffused box). */
  soft?: number;
  color?: string;
};

export type HdrStudio = {
  /** Room: zenith → horizon → floor (sRGB hex), plus multiplier. */
  room: [string, string, string];
  roomIntensity: number;
  lights: StudioLight[];
};

export const HDR_STUDIOS: Record<string, HdrStudio> = {
  /*
    Dark studio: black room, broad soft key from upper left, thin side strips near the rear for
    sharp metal rim highlights, and a long narrow overhead strip for glass glare.
  */
  dark: {
    room: ['#0a0b0d', '#050506', '#020203'],
    roomIntensity: 1,
    lights: [
      { az: -50, el: 32, w: 46, h: 34, intensity: 7, soft: 0.65 },
      { az: -112, el: 6, w: 5, h: 72, intensity: 34, soft: 0.12 },
      { az: 112, el: 6, w: 4, h: 64, intensity: 24, soft: 0.12 },
      { az: 0, el: 72, w: 90, h: 5, intensity: 12, soft: 0.2 },
      { az: 175, el: 22, w: 34, h: 22, intensity: 2.5, soft: 0.8 },
      { az: 25, el: -12, w: 70, h: 14, intensity: 0.45, soft: 0.9 },
      // Broad soft ceiling: long bright highlight along the frame's top/side edges.
      { az: 0, el: 50, w: 150, h: 60, intensity: 3, soft: 1 },
    ],
  },
  /*
    White studio: bright enveloping room for light-background product shots, with black flags on
    both sides to define metal edges and prevent whiteout, plus a soft key.
  */
  white: {
    room: ['#f5f6f8', '#e6e8ec', '#c9ccd2'],
    roomIntensity: 1.15,
    lights: [
      { az: -45, el: 35, w: 60, h: 40, intensity: 5, soft: 0.7 },
      { az: 60, el: 25, w: 40, h: 30, intensity: 2.5, soft: 0.8 },
      { az: -105, el: 5, w: 16, h: 70, intensity: 0, soft: 0.25 },
      { az: 105, el: 5, w: 14, h: 70, intensity: 0, soft: 0.25 },
      { az: 0, el: 75, w: 90, h: 8, intensity: 8, soft: 0.3 },
    ],
  },
};

/* --- Local lighting look-dev: writable through debug on localhost only --- */
let override: { id: string; def: HdrStudio } | null = null;
let overrideVer = 0;
const listeners = new Set<() => void>();
export function setStudioOverride(id: string | null, def?: HdrStudio) {
  override = id && def ? { id, def } : null;
  overrideVer += 1;
  for (const [k, v] of cache) {
    v.dispose();
    cache.delete(k);
  }
  for (const l of listeners) l();
}
export function subscribeStudio(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export function studioVersion() {
  return overrideVer;
}

export function studioDef(id: string): HdrStudio | null {
  if (override && override.id === id) return override.def;
  return HDR_STUDIOS[id] ?? null;
}

/** Soft-edged panel texture (soft 0..1): edge falloff with a flat center. */
const softTexCache = new Map<number, THREE.Texture>();
function softTexture(soft: number): THREE.Texture {
  const k = Math.round(soft * 20);
  const hit = softTexCache.get(k);
  if (hit) return hit;
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d')!;
  const img = x.createImageData(S, S);
  const edge = Math.max(0.02, k / 20) * 0.5;
  for (let j = 0; j < S; j += 1) {
    for (let i = 0; i < S; i += 1) {
      const u = Math.abs((i + 0.5) / S - 0.5) * 2;
      const v = Math.abs((j + 0.5) / S - 0.5) * 2;
      const du = Math.min(1, Math.max(0, (1 - u) / (edge * 2)));
      const dv = Math.min(1, Math.max(0, (1 - v) / (edge * 2)));
      const s = du * du * (3 - 2 * du) * (dv * dv * (3 - 2 * dv));
      const o = (j * S + i) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      img.data[o + 3] = Math.round(s * 255);
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  softTexCache.set(k, t);
  return t;
}

function roomTexture(room: [string, string, string]): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, room[0]);
  g.addColorStop(0.5, room[1]);
  g.addColorStop(1, room[2]);
  x.fillStyle = g;
  x.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const cache = new Map<string, THREE.Texture>();
let pmrem: THREE.PMREMGenerator | null = null;

/**
 * Return the PMREM environment for HDR studio presets, otherwise null. Bake screen glow as a
 * colored front pool, as in procedural/HDRI paths.
 */
export function getHdrStudioEnvironment(
  gl: THREE.WebGLRenderer,
  presetId: string,
  studioId: string | undefined,
  glow: ScreenGlow | null,
): THREE.Texture | null {
  if (!studioId) return null;
  const def = studioDef(studioId);
  if (!def) return null;
  const on = !!glow && glow.amount > 0.001;
  const step = on ? Math.round(Math.min(3, glow!.amount) * 4) : 0;
  const key = `${presetId}|${overrideVer}|${on ? glow!.key : ''}|${step}`;
  const hit = cache.get(key);
  if (hit) return hit;

  pmrem ??= new THREE.PMREMGenerator(gl);
  const sc = new THREE.Scene();
  const disposables: { dispose: () => void }[] = [];
  const R = 10;
  const roomGeo = new THREE.SphereGeometry(R * 1.5, 48, 24);
  const roomTex = roomTexture(def.room);
  const roomMat = new THREE.MeshBasicMaterial({
    map: roomTex,
    side: THREE.BackSide,
    toneMapped: false,
    color: new THREE.Color(1, 1, 1).multiplyScalar(def.roomIntensity),
  });
  sc.add(new THREE.Mesh(roomGeo, roomMat));
  disposables.push(roomGeo, roomMat, roomTex);

  const dirOf = (az: number, el: number) => {
    const a = (az * Math.PI) / 180;
    const e = (el * Math.PI) / 180;
    return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  };

  for (const L of def.lights) {
    const w = 2 * R * Math.tan(((Math.min(L.w, 170) / 2) * Math.PI) / 180);
    const h = 2 * R * Math.tan(((Math.min(L.h, 170) / 2) * Math.PI) / 180);
    const geo = new THREE.PlaneGeometry(w, h);
    const col = new THREE.Color(L.color ?? '#ffffff').multiplyScalar(L.intensity);
    const flag = L.intensity <= 0.0001;
    const m = new THREE.MeshBasicMaterial({
      color: flag ? new THREE.Color(0, 0, 0) : col,
      map: softTexture(L.soft ?? 0.3),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      // Flags cover the room behind them (normal blending); lights add.
      blending: flag ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.copy(dirOf(L.az, L.el).multiplyScalar(R));
    mesh.lookAt(0, 0, 0);
    // Draw flags before lights so later lights add over them.
    mesh.renderOrder = flag ? 0 : 1;
    sc.add(mesh);
    disposables.push(geo, m);
  }

  if (on) {
    const g = glow!;
    const a = step / 4;
    const geo = new THREE.PlaneGeometry(14, 8);
    const m = new THREE.MeshBasicMaterial({
      color: g.color.clone().multiplyScalar(0.9 * a),
      map: softTexture(1),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const pool = new THREE.Mesh(geo, m);
    pool.position.set(0, -1.2, 6);
    pool.lookAt(0, 0, 0);
    pool.renderOrder = 2;
    sc.add(pool);
    disposables.push(geo, m);
  }

  const rt = pmrem.fromScene(sc, 0, 0.1, 100);
  for (const d of disposables) d.dispose();
  if (cache.size > 12) {
    for (const [k, v] of cache) {
      v.dispose();
      cache.delete(k);
    }
  }
  cache.set(key, rt.texture);
  return rt.texture;
}
