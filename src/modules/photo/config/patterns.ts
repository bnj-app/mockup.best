/**
 * Emoji patterns.
 *
 * ⚠️ Measuring with ANIMATE enabled made floating emojis appear oversized.
 * Disable ANIMATE, read emoji canvas pixels with toDataURL, then analyze
 * connected blobs. Measured values on a 686px canvas:
 *
 *   Staggered  45 items · 8.3%   | Small Grid  64 items · 7.5% (8x8 grid)
 *   Large Grid 25 items · 11.9%  | Rings       61 items · 6.7%
 *   Spiral     40 items · 6.7%   | Wave        44 items · 8.5%
 *   Random     23 items · 6–15%  | Float       17 items · 6–17%
 *   Diagonal  110 items · 6.2%   | Explode     12 items · 9–21%
 *
 * Each layout returns {x, y, size, rot} in 0..1 space. Time t is in seconds;
 * pass 0 when ANIMATE is off, otherwise use it to drive drift.
 */

export type Placed = { x: number; y: number; size: number; rot: number };

export const PATTERNS = [
  'Staggered',
  'Small Grid',
  'Large Grid',
  'Rings',
  'Spiral',
  'Wave',
  'Random',
  'Float',
  'Diagonal',
  'Explode',
] as const;

export type PatternName = (typeof PATTERNS)[number];
export const PATTERN_DEFAULT: PatternName = 'Staggered';

/** Deterministic pseudorandom values; Math.random would jump between frames. */
function rnd(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const TAU = Math.PI * 2;

/**
 * Drift.
 *
 * The original ~1% amplitude at one frequency was barely noticeable.
 * Use three layers: a slow broad sway, faster small jitter, and breathing
 * scale. Keep speed low (base frequency ~0.5 rad/s, a ~12-second cycle);
 * amplitude and relative phase shifts make the motion visible.
 */
function drift(t: number, i: number, amp: number) {
  // ANIMATE off passes exactly 0; retain the measured layout unchanged
  // so the static appearance and statistics remain accurate.
  if (t === 0) return { dx: 0, dy: 0, dr: 0, scale: 1 };
  const a = amp * 2.6; // Main amplitude: ~2.6× the original.
  const ph = i * 1.7;
  return {
    dx:
      Math.sin(t * 0.5 + ph) * a +
      Math.sin(t * 1.15 + ph * 2.3) * a * 0.35,
    dy:
      Math.cos(t * 0.42 + ph * 1.4) * a +
      Math.cos(t * 1.3 + ph * 0.7) * a * 0.3,
    dr: Math.sin(t * 0.55 + i) * 16,
    // Breathing: ±10% scale with a phase independent of position.
    scale: 1 + Math.sin(t * 0.62 + i * 0.9) * 0.1,
  };
}

/**
 * Scattered layout with minimum spacing. Unconstrained randomness made
 * emojis overlap, yielding only 17 connected blobs instead of 23.
 */
function scatter(
  push: (x: number, y: number, s: number, rot: number, i: number, amp?: number) => void,
  r: () => number,
  n: number,
  minSize: number,
  maxSize: number,
  minDist: number,
  rotRange: number,
  amp = 0.014,
) {
  const pts: Array<[number, number]> = [];
  let guard = 0;
  while (pts.length < n && guard++ < n * 200) {
    const x = 0.05 + r() * 0.9;
    const y = 0.05 + r() * 0.9;
    if (pts.some(([px, py]) => Math.hypot(px - x, py - y) < minDist)) continue;
    pts.push([x, y]);
  }
  pts.forEach(([x, y], i) => push(x, y, minSize + r() * (maxSize - minSize), r() * rotRange - rotRange / 2, i, amp));
}

export function layout(name: PatternName, t = 0): Placed[] {
  const out: Placed[] = [];
  const push = (x: number, y: number, size: number, rot: number, i: number, amp = 0.012) => {
    const d = drift(t, i, amp);
    out.push({ x: x + d.dx, y: y + d.dy, size: size * d.scale, rot: rot + d.dr });
  };

  switch (name) {
    case 'Small Grid': {
      // Measured: regular 8x8 grid, 7.5%; many small emojis.
      const n = 8;
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++)
          push((c + 0.5) / n, (r + 0.5) / n, 0.075, 0, r * n + c, 0.006);
      break;
    }
    case 'Large Grid': {
      // Measured: 5x5, 11.9% (x = .10 .30 .50 .70 .90).
      const n = 5;
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++)
          push((c + 0.5) / n, (r + 0.5) / n, 0.119, 0, r * n + c, 0.008);
      break;
    }
    case 'Staggered': {
      // Measured: 6 columns (.167 step), .14 row step, odd rows offset by half.
      const cols = 6;
      const rows = 8;
      let i = 0;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const off = r % 2 ? -0.5 / cols : 0;
          push((c + 0.5) / cols + off, 0.07 + r * 0.14, 0.083, 0, i++, 0.01);
        }
      break;
    }
    case 'Rings': {
      // Measured: 61 items, 6.7%; center + 4 rings with 6·k points per ring.
      push(0.5, 0.5, 0.067, 0, 0, 0.006);
      let i = 1;
      for (let k = 1; k <= 4; k++) {
        const rad = 0.112 * k;
        const n = 6 * k;
        for (let j = 0; j < n; j++) {
          const a = (j / n) * TAU - Math.PI / 2;
          push(0.5 + Math.cos(a) * rad, 0.5 + Math.sin(a) * rad * 1.0, 0.067, 0, i++, 0.006);
        }
      }
      break;
    }
    case 'Spiral': {
      // Measured: 40 items, 6.7%.
      const n = 40;
      for (let k = 0; k < n; k++) {
        const a = k * 0.7;
        // Starting too near the center made the first ring overlap.
        const rad = 0.075 + k * 0.0115;
        push(0.5 + Math.cos(a) * rad, 0.5 + Math.sin(a) * rad, 0.067, 0, k, 0.007);
      }
      break;
    }
    case 'Wave': {
      // Measured: 44 items, 8.5%; rows shift sinusoidally.
      const cols = 7;
      const rows = 6;
      let i = 0;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const y = 0.06 + r * 0.175 + Math.sin((c / cols) * TAU + r * 0.5) * 0.05;
          push((c + 0.5) / cols, y, 0.085, 0, i++, 0.01);
        }
      break;
    }
    case 'Random': {
      // Measured: 23 items, 6.3–15.2%. Minimum-distance sampling prevents
      // overlapping emojis from merging into one blob.
      scatter(push, rnd(9137), 23, 0.063, 0.115, 0.13, 360);
      break;
    }
    case 'Float': {
      // Measured: 17 items, 5.8–16.6%, with visible drift.
      scatter(push, rnd(4421), 17, 0.058, 0.132, 0.15, 30, 0.03);
      break;
    }
    case 'Diagonal': {
      // Measured: 110 items, 6.2%. A row step smaller than emoji size
      // (0.056 < 0.062) merged everything into one blob. Use a staggered
      // 10-column × 11-row lattice with steps larger than emoji size.
      let i = 0;
      for (let r = 0; r < 11; r++)
        for (let c = 0; c < 10; c++) {
          const x = ((c * 0.1 + r * 0.05) % 1 + 1) % 1;
          push(x + 0.02, 0.03 + r * 0.09, 0.062, 0, i++, 0.008);
        }
      break;
    }
    case 'Explode': {
      // Measured: 12 items, mean 10%, max 21%; mostly small with one prominent large item.
      const r = rnd(7717);
      for (let k = 0; k < 12; k++) {
        const a = (k / 12) * TAU + 0.4;
        const rad = 0.16 + (k % 3) * 0.12;
        const size = k === 5 ? 0.213 : 0.089 + r() * 0.02;
        push(0.5 + Math.cos(a) * rad, 0.5 + Math.sin(a) * rad, size, 0, k, 0.016);
      }
      break;
    }
  }
  return out;
}
