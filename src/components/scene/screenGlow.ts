import * as THREE from 'three';

/**
 * SCREEN GLOW: spread the screen's own color into the scene.

 * In a dark room, the device screen is the sole light source. A green screen
 * background lights the keyboard and surroundings green; a sky image turns them blue.

 * This module only measures the average media color. Two separate channels
 * apply that color to the scene:
 *  1. environment.ts adds a colored pool to the environment map. Glass and
 *     metal reflect the environment and barely respond to direct light
 *     (measured; see the Stage.tsx key-light note).
 *  2. The point light in Stage.tsx illuminates matte MeshStandardMaterial
 *     surfaces such as keyboards and bases.
 */

/** Sampling grid: 16x16 = 256 samples. More samples make no measurable difference. */
const N = 16;

let sampler: { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

function getSampler() {
  if (!sampler) {
    const cv = document.createElement('canvas');
    cv.width = N;
    cv.height = N;
    /*
      willReadFrequently: video calls getImageData several times per second,
      though not every frame. Without this flag, browsers may keep the texture
      on the GPU and download it on each read.
    */
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    sampler = { cv, ctx };
  }
  return sampler;
}

/**
 * Average source color.

 * ⚠️ Saturation boost is required: screenshot averages are usually nearly
 * gray (white UI with a few colored elements). Using the raw average made
 * screen-colored lighting appear absent. Convert to HSL, boost saturation
 * and set a brightness floor: viewers expect the dominant color, not the average.

 * Returns null if the source is not drawable yet (video metadata unavailable).
 */
export function averageColor(src: CanvasImageSource, w: number, h: number): THREE.Color | null {
  if (!w || !h) return null;
  const s = getSampler();
  if (!s) return null;
  try {
    s.ctx.clearRect(0, 0, N, N);
    s.ctx.drawImage(src, 0, 0, N, N);
    const data = s.ctx.getImageData(0, 0, N, N).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      // Ignore fully transparent pixels: empty PNG areas pulled the average
      // toward black and extinguished the light.
      const a = data[i + 3];
      if (a < 8) continue;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n += 1;
    }
    if (!n) return null;
    const c = new THREE.Color(r / n / 255, g / n / 255, b / n / 255);
    return boost(c);
  } catch {
    // Tainted canvas from a cross-origin image: continue without a light color.
    return null;
  }
}

/** Boost saturation and set a brightness floor. */
function boost(c: THREE.Color): THREE.Color {
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return c.setHSL(hsl.h, Math.min(1, hsl.s * 1.9), Math.min(0.72, Math.max(0.42, hsl.l)));
}

/**
 * Color cache: measure once per key.

 * For images, the key is the URL, avoiding remeasurement on every scene change.
 * For video, the key changes over time; the caller handles throttling
 * (see Stage.tsx ScreenGlow).
 */
const colorCache = new Map<string, THREE.Color>();

export function cachedAverageColor(
  key: string,
  src: CanvasImageSource,
  w: number,
  h: number,
): THREE.Color | null {
  const hit = colorCache.get(key);
  if (hit) return hit;
  const c = averageColor(src, w, h);
  if (c) {
    // Bound the cache: users may browse dozens of media files.
    if (colorCache.size > 64) colorCache.clear();
    colorCache.set(key, c);
  }
  return c;
}

/**
 * Color key for the environment-map cache.

 * Quantize coarsely to 16 steps per channel: each distinct color creates a
 * new equirectangular texture and three.js PMREM conversion. Frame-by-frame
 * video color changes would otherwise generate a texture every frame.
 */
export function quantize(c: THREE.Color): string {
  const q = (v: number) => Math.round(v * 15);
  return `${q(c.r)}-${q(c.g)}-${q(c.b)}`;
}

/** Screen background color, used as the light source when media is absent. */
export function colorFromScreenBg(hex: string | null | undefined): THREE.Color | null {
  if (!hex) return null;
  try {
    return boost(new THREE.Color(hex));
  } catch {
    return null;
  }
}
