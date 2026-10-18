import * as THREE from 'three';
import type { Annotation } from '@/store/editor';

/**
 * SCREEN HIGHLIGHT LAYER.

 * Tap ripples, rings, spotlights and cursors render on a separate plane just
 * above the device screen (2D canvas -> texture). Unlike frame-attached text
 * in overlay.ts, marks follow the screen's rotation, tilt and perspective.

 * TIMING: CameraRig's frame loop supplies exact time, as for crop.scroll
 * (see Stage.tsx applyScreenScroll). The playhead updates at about 30 Hz,
 * so React-driven ripples would grow in steps. Export advance() uses the
 * same loop frame by frame; rendered content matches the file.

 * DIRTY CHECK: compute a numeric state key each frame. If unchanged, leave
 * both canvas and GPU untouched. Static rings/spotlights/cursors require
 * no uploads after first appearing.
 */

/** Canvas long edge (px); preserve screen aspect ratio. */
const LONG_SIDE = 1280;
/** Tap: pulse duration and repeat interval for longer windows (seconds). */
const TAP_DUR = 0.7;
const TAP_PERIOD = 1.2;
/** Ring/spotlight/cursor entrance and exit durations (seconds). */
const IN_DUR = 0.4;
const OUT_DUR = 0.25;
/** Cursor glide duration and click ripple. */
const GLIDE = 0.55;
const CLICK_DUR = 0.5;

export type MarksSurface = { canvas: HTMLCanvasElement; tex: THREE.CanvasTexture };

type Layer = MarksSurface & {
  mesh: THREE.Mesh;
  /** Last rendered state key for dirty checking. */
  key: string;
};

let layer: Layer | null = null;

/** Screen-aspect canvas and texture; recreate when device/orientation changes the ratio. */
export function createMarksSurface(aspect: number): MarksSurface {
  const c = document.createElement('canvas');
  // An incorrect ratio turns screen circles into ellipses (measured on a landscape phone).
  if (aspect >= 1) {
    c.width = LONG_SIDE;
    c.height = Math.max(2, Math.round(LONG_SIDE / aspect));
  } else {
    c.height = LONG_SIDE;
    c.width = Math.max(2, Math.round(LONG_SIDE * aspect));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  /*
    Enable mipmaps: devices are often small in frame (phone screen about 500 px
    in preview). Downscaling a thin 1280 px ring without mipmaps causes playback
    shimmer. Upload only dirty frames; mipmaps are generated on the GPU.
  */
  tex.anisotropy = 8;
  return { canvas: c, tex };
}

/** Scene layers register here for frame-loop access and placement. */
export function registerMarksLayer(surface: MarksSurface, mesh: THREE.Mesh) {
  layer = { ...surface, mesh, key: '' };
  // New surface is blank: reset its key so the first frame draws.
  surface.canvas.getContext('2d')!.clearRect(0, 0, surface.canvas.width, surface.canvas.height);
}

export function unregisterMarksLayer(surface: MarksSurface) {
  if (layer?.tex === surface.tex) layer = null;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (p: number) => 1 - Math.pow(1 - clamp01(p), 3);
const easeInOut = (p: number) => {
  const x = clamp01(p);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};

/** "#rrggbb" -> "r,g,b" for rgba() with opacity. */
function rgb(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/** Detect light colors to choose contrasting cursor outlines and tap shadows. */
function isLight(hex: string): boolean {
  const [r, g, b] = rgb(hex).split(',').map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

/** Current highlight drawing state; null means invisible. */
type Drawn = {
  a: Annotation;
  /** Overall visibility during entrance/exit. */
  alpha: number;
  /** Type-specific progress values. */
  p: number;
  q: number;
  /** Current cursor position in screen-relative coordinates. */
  cx: number;
  cy: number;
};

/** Pure highlight-state calculation at t; drawing and the key share the same values. */
export function markState(a: Annotation, t: number, shotDur: number): Drawn | null {
  const end = Math.min(a.end ?? shotDur, shotDur);
  if (t < a.start || t > end) return null;
  const local = t - a.start;
  // Exit only for explicitly ended windows; scene-long highlights stay fully visible until the cut.
  const out = a.end !== null && a.end < shotDur ? clamp01((end - t) / OUT_DUR) : 1;
  if (a.kind === 'tap') {
    const k = Math.floor(local / TAP_PERIOD);
    const p = (local - k * TAP_PERIOD) / TAP_DUR;
    if (p > 1) return null;
    return { a, alpha: 1, p, q: 0, cx: a.x, cy: a.y };
  }
  if (a.kind === 'cursor') {
    // Glide in from the lower right of the target, clamped to stay onscreen.
    const g = easeInOut(local / GLIDE);
    const fx = Math.min(0.97, a.x + 0.22);
    const fy = Math.min(0.97, a.y + 0.18);
    const cx = fx + (a.x - fx) * g;
    const cy = fy + (a.y - fy) * g;
    const click = (local - GLIDE) / CLICK_DUR;
    return { a, alpha: Math.min(clamp01(local / 0.2), out), p: g, q: click, cx, cy };
  }
  return { a, alpha: Math.min(easeOut(local / IN_DUR), out), p: easeOut(local / IN_DUR), q: 0, cx: a.x, cy: a.y };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

function stateKey(list: Drawn[]): string {
  return list
    .map((d) => {
      const a = d.a;
      // Static after the click ripple ends; clamp to 1/-1 in the key.
      const q = d.q > 1 || d.q < 0 ? -1 : r3(d.q);
      return `${a.kind}|${r3(a.x)}|${r3(a.y)}|${r3(a.size)}|${a.color}|${r3(d.alpha)}|${r3(d.p)}|${q}|${r3(d.cx)}|${r3(d.cy)}`;
    })
    .join(';');
}

/** Tap: pressed point with an expanding ripple. */
function drawTap(ctx: CanvasRenderingContext2D, d: Drawn, S: number, W: number, H: number) {
  const { a, p } = d;
  const x = a.x * W;
  const y = a.y * H;
  const R = a.size * S;
  const col = rgb(a.color);
  const shade = isLight(a.color) ? '0,0,0' : '255,255,255';
  // Touch point appears quickly and fades as the ripple expands.
  const dotA = p < 0.08 ? p / 0.08 : 1 - clamp01((p - 0.35) / 0.65);
  ctx.save();
  ctx.shadowColor = `rgba(${shade},0.28)`;
  ctx.shadowBlur = S * 0.02;
  ctx.fillStyle = `rgba(${col},${0.42 * dotA})`;
  ctx.beginPath();
  ctx.arc(x, y, R * 0.42 * (1 - 0.12 * Math.sin(Math.min(1, p / 0.3) * Math.PI)), 0, Math.PI * 2);
  ctx.fill();
  const rr = R * (0.42 + 0.58 * easeOut(p));
  ctx.strokeStyle = `rgba(${col},${0.95 * (1 - clamp01(p))})`;
  ctx.lineWidth = Math.max(2, S * 0.011);
  ctx.beginPath();
  ctx.arc(x, y, rr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Ring: draw clockwise from the top on entrance. */
function drawRing(ctx: CanvasRenderingContext2D, d: Drawn, S: number, W: number, H: number) {
  const { a, p, alpha } = d;
  const col = rgb(a.color);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.shadowColor = `rgba(${col},0.45)`;
  ctx.shadowBlur = S * 0.025;
  ctx.strokeStyle = `rgb(${col})`;
  ctx.lineWidth = Math.max(3, S * 0.014);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(a.x * W, a.y * H, a.size * S, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.001, p));
  ctx.stroke();
  ctx.restore();
}

/** Spotlight: dim the screen around a soft-edged bright circle. */
function drawSpotlight(ctx: CanvasRenderingContext2D, d: Drawn, S: number, W: number, H: number) {
  const { a, alpha } = d;
  const R = a.size * S;
  const col = rgb(a.color);
  const g = ctx.createRadialGradient(a.x * W, a.y * H, R * 0.82, a.x * W, a.y * H, R * 1.18);
  g.addColorStop(0, `rgba(${col},0)`);
  g.addColorStop(1, `rgba(${col},${0.62 * alpha})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/*
  Cursor: generic arrow with original proportions, not a copy of an OS cursor
  (for copyright reasons). Unit height is 1, tip at (0, 0).
*/
const ARROW: [number, number][] = [
  [0, 0],
  [0, 0.8],
  [0.21, 0.63],
  [0.34, 0.93],
  [0.47, 0.87],
  [0.34, 0.58],
  [0.6, 0.58],
];

function drawCursor(ctx: CanvasRenderingContext2D, d: Drawn, S: number, W: number, H: number) {
  const { a, alpha, q } = d;
  const h = a.size * S * 2;
  const x = d.cx * W;
  const y = d.cy * H;
  const col = rgb(a.color);
  const edge = isLight(a.color) ? '#111318' : '#ffffff';
  ctx.save();
  ctx.globalAlpha = alpha;
  // Click: small ripple below the cursor, which briefly shrinks.
  if (q >= 0 && q <= 1) {
    ctx.strokeStyle = `rgba(${col},${0.9 * (1 - q)})`;
    ctx.lineWidth = Math.max(2, S * 0.009);
    ctx.beginPath();
    ctx.arc(x, y, h * (0.12 + 0.55 * easeOut(q)), 0, Math.PI * 2);
    ctx.stroke();
  }
  const press = q >= 0 && q <= 0.4 ? 1 - 0.14 * Math.sin((q / 0.4) * Math.PI) : 1;
  ctx.translate(x, y);
  ctx.scale(h * press, h * press);
  ctx.beginPath();
  ARROW.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = S * 0.015;
  ctx.shadowOffsetY = S * 0.004;
  ctx.fillStyle = `rgb(${col})`;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.06;
  ctx.strokeStyle = edge;
  ctx.stroke();
  ctx.restore();
}

/**
 * Called by the frame loop to draw active-scene highlights at t. Hide the
 * plane if nothing is visible to avoid rendering an empty transparent layer.
 */
export function drawScreenMarks(list: Annotation[], t: number, shotDur: number) {
  const l = layer;
  if (!l) return;
  const drawn = list.map((a) => markState(a, t, shotDur)).filter((d): d is Drawn => !!d);
  const key = stateKey(drawn);
  l.mesh.visible = drawn.length > 0;
  if (key === l.key) return;
  l.key = key;
  const { canvas } = l;
  const W = canvas.width;
  const H = canvas.height;
  const S = Math.min(W, H);
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  // Spotlights go at the bottom so their dimming does not cover other marks.
  const order = { spotlight: 0, ring: 1, tap: 2, cursor: 3 } as const;
  for (const d of [...drawn].sort((x, y) => order[x.a.kind] - order[y.a.kind])) {
    if (d.a.kind === 'tap') drawTap(ctx, d, S, W, H);
    else if (d.a.kind === 'ring') drawRing(ctx, d, S, W, H);
    else if (d.a.kind === 'spotlight') drawSpotlight(ctx, d, S, W, H);
    else drawCursor(ctx, d, S, W, H);
  }
  l.tex.needsUpdate = true;
}

/**
 * Click-to-place: raycast a frame-relative point (0-1, top-left origin) onto
 * the highlight plane, yielding screen-relative coordinates; null on a miss.

 * Raycast the highlight plane rather than main-screen: media meshes are
 * scaled/offset by "Media size" and screen UI, so their local space does not
 * cover the whole screen.
 */
export function pickScreenPoint(
  camera: THREE.Camera,
  fx: number,
  fy: number,
): { x: number; y: number } | null {
  const mesh = layer?.mesh;
  if (!mesh) return null;
  const { w, h } = mesh.userData as { w: number; h: number };
  camera.updateMatrixWorld();
  mesh.updateWorldMatrix(true, false);
  const n = new THREE.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
  const p0 = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p0);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(fx * 2 - 1, -(fy * 2 - 1)), camera);
  const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
  if (!hit) return null;
  const local = mesh.worldToLocal(hit);
  const x = local.x / w + 0.5;
  const y = 0.5 - local.y / h;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}
