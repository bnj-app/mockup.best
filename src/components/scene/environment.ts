import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/**
 * Procedural studio environment map. Glass edges look polished when they have something to reflect:
 * a real studio's bright rectangular softboxes. Draw them into an equirectangular texture and use
 * scene.environment for long, thin edge highlights and realistic metal reflections. No HDR download
 * means no network dependency or export race, and full control over softbox positions and
 * intensity.
 */

type Softbox = {
  /** Horizontal position 0..1 (0 = behind us, 0.5 = straight ahead). */
  u: number;
  /** Vertical position 0..1 (0 = ceiling, 1 = floor). */
  v: number;
  /** Size as a fraction of texture width. */
  w: number;
  h: number;
  /** Brightness; values above 1 behave like HDR. */
  intensity: number;
  /** Edge softness 0..1. */
  softness: number;
};

/*
  Keep softboxes sharp and bright. Soft, dim boxes produced no visible glass-edge reflections.
  Glass needs strong brightness contrast between the reflected object and its surroundings, as in a
  dark studio with a few very bright boxes.
*/
const STUDIO: Softbox[] = [
  // Key light: narrow and bright from the upper left, for a long, crisp edge highlight.
  { u: 0.2, v: 0.28, w: 0.17, h: 0.42, intensity: 2.6, softness: 0.28 },
  // Opposing light: upper right, half the key light's intensity.
  { u: 0.74, v: 0.32, w: 0.12, h: 0.3, intensity: 1.3, softness: 0.32 },
  // Top strip: very long and narrow, for a thin highlight on the screen glass.
  { u: 0.5, v: 0.07, w: 0.62, h: 0.05, intensity: 1.8, softness: 0.45 },
  // Side accent: directly from the side, to separate the device profile.
  { u: 0.96, v: 0.5, w: 0.07, h: 0.5, intensity: 1.1, softness: 0.35 },
  // Bottom fill: weak, to keep the underside from going completely dark.
  { u: 0.42, v: 0.8, w: 0.35, h: 0.14, intensity: 0.35, softness: 0.85 },
  /*
    Ceiling and rear fill. At low camera angles, the device back (the laptop lid's rear, the
    catalog's largest single surface) faces the upper rear, where the map was empty. Silver and white
    looked flat and lifeless. Two faint, very soft fills add a gentle gradient to rear surfaces
    without changing front reflections, which remain dominated by the 2.6/1.8 boxes.
  */
  { u: 0.5, v: 0.03, w: 0.95, h: 0.12, intensity: 0.5, softness: 0.95 },
  { u: 0.03, v: 0.3, w: 0.3, h: 0.42, intensity: 0.45, softness: 0.92 },
];

/** Narrow, hard-edged strip light for a thin, sharp edge highlight. */
type Strip = { u: number; v: number; w: number; h: number; intensity: number; blur: number };

const STRIPS: Strip[] = [
  // Left vertical strip: long, crisp highlight on the device's right edge.
  { u: 0.19, v: 0.42, w: 0.012, h: 0.62, intensity: 1, blur: 2 },
  // Right vertical strip: opposite edge, slightly weaker.
  { u: 0.79, v: 0.44, w: 0.009, h: 0.5, intensity: 0.75, blur: 2 },
  // Top horizontal strip: thin highlight on the top edge and glass.
  { u: 0.5, v: 0.14, w: 0.55, h: 0.008, intensity: 0.8, blur: 2 },
  // Bottom rim: very weak, to retain the lower edge.
  { u: 0.5, v: 0.86, w: 0.4, h: 0.006, intensity: 0.35, blur: 3 },
];

function drawSoftbox(ctx: CanvasRenderingContext2D, s: Softbox, W: number, H: number) {
  const cx = s.u * W;
  const cy = s.v * H;
  const w = s.w * W;
  const h = s.h * H;

  // Stretch a radial gradient into a rectangle for soft edges.
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(w / 2, h / 2);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  const core = Math.max(0.05, 1 - s.softness);
  const a = s.intensity;
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(core, `rgba(255,255,255,${a * 0.92})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Studio presets. One environment cannot suit every scene: dark products need strong contrast,
 * while bright scenes need soft wraparound light. Each preset changes the softboxes, strips and
 * room brightness.
 */
export type EnvPreset = {
  id: string;
  label: string;
  /** Room gradient: ceiling → above horizon → horizon → below horizon → floor. */
  room: [string, string, string, string, string];
  softboxes: Softbox[];
  strips: Strip[];
  horizon: number;
  /**
   * Real studio photograph (HDRI, Poly Haven CC0). When set, use this file for the environment, with
   * the procedural room as a loading fallback. The procedural room uses an 8-bit canvas without true
   * HDR highlights, leaving metal dull; this provides realistic device lighting.
   */
  hdri?: string;
  /**
   * True HDR studio (hdrStudio.ts): light panels far above 1 are baked into PMREM. When set, use this
   * environment; room/softboxes are fallbacks for paths without GL, such as template previews.
   */
  hdrStudio?: string;
};

const SOFT_ROOM: Pick<EnvPreset, 'room' | 'softboxes' | 'strips' | 'horizon'> = {
  room: ['#b9bfc8', '#8e949e', '#6e737b', '#7a7f88', '#4a4e55'],
  softboxes: [
    { u: 0.24, v: 0.3, w: 0.34, h: 0.5, intensity: 1.5, softness: 0.8 },
    { u: 0.74, v: 0.34, w: 0.28, h: 0.42, intensity: 1.0, softness: 0.85 },
  ],
  strips: [],
  horizon: 0.35,
};

export const ENV_PRESETS: EnvPreset[] = [
  /*
    Photographic studio environments for a product-photography look. Files from Poly Haven, CC0
    (public domain): studio_small_09 and photo_studio_loft_hall, 1k.
  */
  /*
    HDR studios: bright, thin strips in a dark room or black flags in a white room. See hdrStudio.ts.
  */
  { id: 'dark', label: 'Dark studio', hdrStudio: 'dark', ...SOFT_ROOM, room: ['#1a1c20', '#0e0f12', '#08090b', '#0b0c0f', '#040405'] },
  { id: 'white', label: 'White studio', hdrStudio: 'white', ...SOFT_ROOM },
  { id: 'photo', label: 'Photo studio', hdri: '/env/studio-soft.hdr', ...SOFT_ROOM },
  { id: 'loft', label: 'Loft', hdri: '/env/loft.hdr', ...SOFT_ROOM },
  {
    id: 'studio',
    label: 'Studio',
    room: ['#8b9099', '#5d626b', '#3c4046', '#4a4e55', '#23262b'],
    softboxes: STUDIO,
    strips: STRIPS,
    horizon: 0.65,
  },
  {
    id: 'softbox',
    label: 'Softbox',
    // Broad and soft: wraparound edges without hard lines.
    room: ['#b9bfc8', '#8e949e', '#6e737b', '#7a7f88', '#4a4e55'],
    softboxes: [
      { u: 0.24, v: 0.3, w: 0.34, h: 0.5, intensity: 1.5, softness: 0.8 },
      { u: 0.74, v: 0.34, w: 0.28, h: 0.42, intensity: 1.0, softness: 0.85 },
      { u: 0.5, v: 0.1, w: 0.7, h: 0.16, intensity: 1.0, softness: 0.9 },
    ],
    strips: [{ u: 0.5, v: 0.12, w: 0.5, h: 0.02, intensity: 0.5, blur: 8 }],
    horizon: 0.35,
  },
  {
    id: 'contrast',
    label: 'Contrast',
    // Dark room with very bright, narrow strips for the sharpest edge highlights.
    room: ['#3a3e45', '#22252a', '#141619', '#1b1e22', '#0a0b0d'],
    softboxes: [
      { u: 0.2, v: 0.3, w: 0.12, h: 0.4, intensity: 3.2, softness: 0.2 },
      { u: 0.8, v: 0.36, w: 0.09, h: 0.3, intensity: 1.6, softness: 0.25 },
    ],
    strips: [
      { u: 0.17, v: 0.44, w: 0.01, h: 0.7, intensity: 1, blur: 1 },
      { u: 0.83, v: 0.46, w: 0.008, h: 0.55, intensity: 0.85, blur: 1 },
      { u: 0.5, v: 0.1, w: 0.6, h: 0.006, intensity: 0.9, blur: 1 },
    ],
    horizon: 0.8,
  },
  {
    id: 'window',
    label: 'Window',
    // One large side window: natural, directional light.
    room: ['#a8b2bf', '#7d8794', '#5c646f', '#666e78', '#3a3f46'],
    softboxes: [{ u: 0.28, v: 0.38, w: 0.3, h: 0.62, intensity: 2.2, softness: 0.45 }],
    strips: [
      { u: 0.28, v: 0.38, w: 0.004, h: 0.62, intensity: 0.7, blur: 2 },
      { u: 0.16, v: 0.38, w: 0.004, h: 0.62, intensity: 0.5, blur: 2 },
    ],
    horizon: 0.45,
  },
  {
    id: 'screenlit',
    label: 'Screen-lit',
    /*
      Screen-lit room. A nearly black room with two very weak fills lets most light come from the
      device screen (see light.screenGlow). Dim softboxes too, or studio lighting overwhelms the screen
      color. Two faint rim strips retain the silhouette; without them, the glass body disappears
      against dark backgrounds.
    */
    room: ['#191b20', '#101216', '#0a0b0e', '#0d0e12', '#050506'],
    softboxes: [
      { u: 0.22, v: 0.3, w: 0.14, h: 0.34, intensity: 0.5, softness: 0.4 },
      { u: 0.78, v: 0.34, w: 0.1, h: 0.26, intensity: 0.3, softness: 0.45 },
    ],
    strips: [
      { u: 0.18, v: 0.44, w: 0.008, h: 0.6, intensity: 0.45, blur: 2 },
      { u: 0.82, v: 0.46, w: 0.006, h: 0.48, intensity: 0.3, blur: 2 },
    ],
    horizon: 0.12,
  },
  {
    id: 'dusk',
    label: 'Dusk',
    // Warm top, cool bottom: colored reflections.
    room: ['#c99a6a', '#8e6f5c', '#4a4a55', '#3d4457', '#20242e'],
    softboxes: [
      { u: 0.3, v: 0.24, w: 0.2, h: 0.3, intensity: 2.0, softness: 0.4 },
      { u: 0.7, v: 0.6, w: 0.24, h: 0.3, intensity: 0.7, softness: 0.7 },
    ],
    strips: [{ u: 0.3, v: 0.4, w: 0.008, h: 0.5, intensity: 0.9, blur: 2 }],
    horizon: 0.5,
  },
];

export const DEFAULT_ENV = 'studio';

/* --- HDRI cache: same pattern as the model cache (deviceModels.ts) --- */
const hdriCache = new Map<string, THREE.Texture | 'loading' | 'failed'>();
const hdriListeners = new Set<() => void>();
let hdriVer = 0;
export function subscribeHdri(l: () => void) {
  hdriListeners.add(l);
  return () => {
    hdriListeners.delete(l);
  };
}
export function hdriVersion() {
  return hdriVer;
}
/**
 * HDRI + screen light. A canvas cannot draw into an HDR texture. Instead, create a small scene with
 * the HDRI as background and an additive colored pool facing the screen (+Z, slightly below the
 * horizon), then bake it into PMREM. This is the HDR equivalent of procedural presets' front pool.
 * The key still uses coarse color and intensity levels; the cache is bounded.
 */
const glowCache = new Map<string, THREE.Texture>();
let pmrem: THREE.PMREMGenerator | null = null;
export function getHdriGlowEnvironment(
  gl: THREE.WebGLRenderer,
  presetId: string,
  glow: ScreenGlow,
): THREE.Texture | null {
  const hdr = getHdriEnvironment(presetId);
  if (!hdr) return null;
  const step = Math.round(Math.min(3, glow.amount) * 4);
  const key = `${presetId}|${glow.key}|${step}`;
  const hit = glowCache.get(key);
  if (hit) return hit;
  pmrem ??= new THREE.PMREMGenerator(gl);
  const sc = new THREE.Scene();
  sc.background = hdr;
  const a = step / 4;
  const col = glow.color.clone().multiplyScalar(0.9 * a);
  const geo = new THREE.SphereGeometry(10, 32, 16, 0, Math.PI * 2, 0, Math.PI);
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(14, 8),
    new THREE.MeshBasicMaterial({
      color: col,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      map: glowSprite(),
    }),
  );
  pool.position.set(0, -1.2, 6);
  pool.lookAt(0, 0, 0);
  sc.add(pool);
  // Room wash: a very faint color layer over the entire sphere.
  const wash = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({
      color: glow.color.clone().multiplyScalar(0.06 * a),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );
  sc.add(wash);
  const rt = pmrem.fromScene(sc, 0, 0.1, 100);
  geo.dispose();
  if (glowCache.size > 12) {
    for (const [k, v] of glowCache) {
      v.dispose();
      glowCache.delete(k);
    }
  }
  glowCache.set(key, rt.texture);
  return rt.texture;
}

let sprite: THREE.Texture | null = null;
function glowSprite(): THREE.Texture {
  if (sprite) return sprite;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 128);
  sprite = new THREE.CanvasTexture(c);
  return sprite;
}

/**
 * Is the preset's environment ready? Presets without HDRI are always ready; HDRI presets are ready
 * after download success or failure (using the fallback). Also starts the download. Template
 * previews (templateThumbs) wait for this before capture.
 */
export function hdriSettled(presetId: string): boolean {
  const url = ENV_PRESETS.find((p) => p.id === presetId)?.hdri;
  if (!url) return true;
  if (getHdriEnvironment(presetId)) return true;
  return hdriCache.get(url) === 'failed';
}

/** The downloaded HDRI texture if available for this preset; otherwise null (render the fallback). */
export function getHdriEnvironment(presetId: string): THREE.Texture | null {
  const url = ENV_PRESETS.find((p) => p.id === presetId)?.hdri;
  if (!url) return null;
  const e = hdriCache.get(url);
  if (e && e !== 'loading' && e !== 'failed') return e;
  if (!e) {
    hdriCache.set(url, 'loading');
    new HDRLoader().load(
      url,
      (tex) => {
        tex.mapping = THREE.EquirectangularReflectionMapping;
        hdriCache.set(url, tex);
        hdriVer++;
        for (const l of hdriListeners) l();
      },
      undefined,
      () => {
        hdriCache.set(url, 'failed');
      },
    );
  }
  return null;
}

const cache = new Map<string, THREE.Texture>();

/**
 * Screen light also affects the environment map. Why: device bodies are glass and metal. Measured
 * with key light 0→4, direct lighting changed average frame pixels by only 0.012–0.036. Glass and
 * metal respond to the environment; using only a point light for screen color would make this
 * visible feature too dim to measure.
 */
export type ScreenGlow = {
  /** Average screen color. */
  color: THREE.Color;
  /** 0 = off. Panel range: 0–3. */
  amount: number;
  /** Environment cache key: coarse color (see screenGlow.quantize). */
  key: string;
};

/**
 * Studio environment: generated once and shared per preset (+ screen light). ⚠️ The cache key must
 * include screen light: using only presetId would keep returning the first color, so lighting would
 * not change with screen content.
 */
export function getStudioEnvironment(
  presetId: string = DEFAULT_ENV,
  glow?: ScreenGlow | null,
): THREE.Texture {
  const on = !!glow && glow.amount > 0.001;
  // Quantize intensity too: otherwise each intermediate slider value
  // would create a new texture and PMREM conversion.
  const amountStep = on ? Math.round(Math.min(3, glow!.amount) * 4) : 0;
  const cacheKey = on ? `${presetId}|${glow!.key}|${amountStep}` : presetId;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const preset = ENV_PRESETS.find((p) => p.id === presetId) ?? ENV_PRESETS[0];
  const W = 1024;
  const H = 512;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;

  /*
    Use medium room brightness. A nearly black room made softboxes shine but left metal frames black:
    metal reflects its surroundings. Product studios use gray rooms with much brighter softboxes;
    that brightness difference provides contrast.
  */
  const base = ctx.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, preset.room[0]);
  base.addColorStop(0.42, preset.room[1]);
  base.addColorStop(0.5, preset.room[2]);
  base.addColorStop(0.58, preset.room[3]);
  base.addColorStop(1, preset.room[4]);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // Horizon strip: thin and slightly bright, for a clean line on horizontal surfaces.
  const horizon = ctx.createLinearGradient(0, H * 0.46, 0, H * 0.54);
  horizon.addColorStop(0, 'rgba(255,255,255,0)');
  horizon.addColorStop(0.5, `rgba(215,228,245,${preset.horizon})`);
  horizon.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, H * 0.46, W, H * 0.08);

  ctx.globalCompositeOperation = 'lighter';
  for (const s of preset.softboxes) drawSoftbox(ctx, s, W, H);

  /*
    Strip lights give glass its polished appearance. Softboxes create broad, diffuse edge highlights;
    thin, crisp lines along edges require narrow, very bright rectangles with almost hard edges, like
    real studio strip softboxes.
  */
  for (const s of preset.strips) {
    ctx.save();
    ctx.filter = `blur(${s.blur}px)`;
    ctx.fillStyle = `rgba(255,255,255,${s.intensity})`;
    ctx.fillRect((s.u - s.w / 2) * W, (s.v - s.h / 2) * H, s.w * W, s.h * H);
    ctx.restore();
  }

  /*
    Screen light has two layers. 1. Room wash: a faint color layer over the entire map, tinting the
    room and every glass-edge reflection toward the screen color. 2. Front pool: a broad, soft
    colored patch facing the device (u 0.5), representing screen light hitting nearby surfaces. Place
    it slightly below the horizon (v 0.58): light falls on the desk, not the ceiling.
  */
  if (on) {
    const g = glow!;
    const a = Math.min(3, g.amount);
    const rgb = `${Math.round(g.color.r * 255)},${Math.round(g.color.g * 255)},${Math.round(g.color.b * 255)}`;

    ctx.globalCompositeOperation = 'lighter';

    ctx.fillStyle = `rgba(${rgb},${(a * 0.055).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(0.5 * W, 0.58 * H);
    ctx.scale(0.62 * W, 0.42 * H);
    const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    pool.addColorStop(0, `rgba(${rgb},${(a * 0.42).toFixed(3)})`);
    pool.addColorStop(0.45, `rgba(${rgb},${(a * 0.2).toFixed(3)})`);
    pool.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.globalCompositeOperation = 'source-over';

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  /*
    Cache limit: with screen light enabled, color-dependent keys could grow indefinitely. Each entry
    holds a texture and its three.js PMREM. Keep base presets without screen light; clear all lit
    entries on overflow. The current scene's texture regenerates next frame without visible loss.
  */
  if (cache.size > 24) {
    for (const [k, v] of cache) {
      if (!k.includes('|')) continue;
      v.dispose();
      cache.delete(k);
    }
  }
  cache.set(cacheKey, tex);
  return tex;
}
