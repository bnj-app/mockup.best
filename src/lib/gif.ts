import { GIFEncoder, applyPalette, quantize } from 'gifenc';

/**
 * GIF export: the format that autoplays in README files, Slack, Notion and email. Three decisions:
 * 1. One global palette built from sample frames spaced evenly across the timeline. Per-frame
 * palettes choose slightly different sets of 256 colors, making gradient backgrounds flicker or
 * "boil". 2. Ordered Bayer 4×4 dithering rather than Floyd–Steinberg error diffusion. Both reduce
 * 256-color gradient banding, but error diffusion depends on neighboring pixels and makes the
 * entire background crawl as the device moves. Bayer depends only on pixel position, keeping static
 * areas identical across frames. 3. GIF supports only 1-bit transparency: alpha < 128 is
 * transparent, everything else opaque. Soft shadows and glow disappear; use a PNG sequence for soft
 * alpha.
 */

export type GifPalette = number[][];

/** Bayer 4×4 thresholds centered on −0.5…+0.5. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16 - 0.5);

/**
 * In-place ordered dithering. strength is peak-to-peak amplitude in 0–255 units; keep it near the
 * palette step to avoid grain. Transparent pixels (alpha < 128) remain unchanged.
 */
export function ditherBayer(rgba: Uint8ClampedArray, width: number, height: number, strength = 10) {
  for (let y = 0; y < height; y += 1) {
    const row = (y & 3) * 4;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if (rgba[i + 3] < 128) continue;
      const d = BAYER4[row + (x & 3)] * strength;
      // Uint8ClampedArray clamps values to 0–255 automatically.
      rgba[i] += d;
      rgba[i + 1] += d;
      rgba[i + 2] += d;
    }
  }
}

/**
 * Build a shared palette from sample frames, taking every step-th pixel. All pixels from eight
 * 640×360 frames would create an unnecessary 7 MB array; sparse sampling preserves the color
 * distribution.
 */
export function buildPalette(samples: Uint8ClampedArray[], alpha: boolean, step = 3): GifPalette {
  let n = 0;
  for (const s of samples) n += Math.ceil(s.length / 4 / step);
  const pool = new Uint8ClampedArray(n * 4);
  let o = 0;
  for (const s of samples) {
    for (let p = 0; p < s.length / 4; p += step) {
      pool[o] = s[p * 4];
      pool[o + 1] = s[p * 4 + 1];
      pool[o + 2] = s[p * 4 + 2];
      pool[o + 3] = s[p * 4 + 3];
      o += 4;
    }
  }
  return alpha
    ? quantize(pool, 256, { format: 'rgba4444', oneBitAlpha: true, clearAlpha: true, clearAlphaThreshold: 127 })
    : quantize(pool, 256, { format: 'rgb565' });
}

/**
 * GIF writer. Frame delays use centiseconds: 20 fps = 5 cs and 25 fps = 4 cs divide exactly; 30/60
 * do not, so the panel omits them.
 */
export function createGifWriter(opts: { width: number; height: number; fps: number; palette: GifPalette; alpha: boolean }) {
  const gif = GIFEncoder();
  const delayMs = Math.round(100 / opts.fps) * 10;
  const format = opts.alpha ? 'rgba4444' : 'rgb565';
  const transparentIndex = opts.alpha ? opts.palette.findIndex((c) => c[3] === 0) : -1;
  let first = true;
  return {
    addFrame(rgba: Uint8ClampedArray) {
      ditherBayer(rgba, opts.width, opts.height);
      const index = applyPalette(rgba, opts.palette, format);
      gif.writeFrame(index, opts.width, opts.height, {
        palette: first ? opts.palette : undefined,
        delay: delayMs,
        repeat: 0,
        transparent: transparentIndex >= 0,
        transparentIndex: Math.max(0, transparentIndex),
        // Restore the background so previous frames do not show through transparent areas.
        dispose: transparentIndex >= 0 ? 2 : -1,
      });
      first = false;
    },
    finish(): Blob {
      gif.finish();
      return new Blob([gif.bytes()], { type: 'image/gif' });
    },
  };
}
