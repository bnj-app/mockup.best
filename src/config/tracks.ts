/**
 * Property tracks form the animation core. Why: the old { t, camera: Partial<CameraState> } model
 * stored an entire camera snapshot per keyframe. Editing an unkeyframed field was later overwritten by
 * stale values from neighboring keyframes as the playhead moved. Store animation per property instead:
 * track.path = 'camera.fov', keyframe.value = 35. Properties without tracks remain untouched. The same
 * structure supports blur, lighting, lid angles, and effects, enabling a keyframe control beside each
 * setting.
 */

/* ---------------------------------------------------------------- easing */

/** Easing preset family. */
export type EasingId =
  | 'linear'
  | 'ease'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'sine'
  | 'quint'
  | 'expo'
  | 'spring'
  | 'back';

export const EASINGS: { id: EasingId; label: string; fn: (t: number) => number }[] = [
  { id: 'linear', label: 'Linear', fn: (t) => t },
  // "Ease" gives the classic CSS ease feel: a quick start and gentle finish.
  { id: 'ease', label: 'Ease', fn: (t) => t * t * (3 - 2 * t) },
  { id: 'easeIn', label: 'Ease In', fn: (t) => t * t },
  { id: 'easeOut', label: 'Ease Out', fn: (t) => 1 - (1 - t) * (1 - t) },
  {
    id: 'easeInOut',
    label: 'Ease In Out',
    fn: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  },
  { id: 'sine', label: 'Sine', fn: (t) => 1 - Math.cos((t * Math.PI) / 2) },
  { id: 'quint', label: 'Quint', fn: (t) => 1 - Math.pow(1 - t, 5) },
  {
    id: 'expo',
    label: 'Expo',
    fn: (t) => (t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, 10 * t - 10)),
  },
  /*
    Spring and overshoot. Spring overshoots by ~10% and settles with damping (1.5 oscillations). The raw
    curve falls short of 1 at t=1 due to the e^-7 residual; a linear correction makes the endpoint
    exactly 1 to avoid a keyframe jump. Back is classic easeOutBack: one overshoot followed by a return.
  */
  { id: 'spring', label: 'Spring', fn: (t) => springRaw(t) - t * (springRaw(1) - 1) },
  {
    id: 'back',
    label: 'Back',
    fn: (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2),
  },
];

function springRaw(t: number): number {
  return 1 - Math.exp(-7 * t) * Math.cos(3 * Math.PI * t);
}

const EASING_FN = new Map(EASINGS.map((e) => [e.id, e.fn]));

/**
 * Curve between two keyframes. Combine the left keyframe's outgoing easing and the right one's
 * incoming easing. If equal, use that curve directly. Otherwise, blend with outgoing easing dominant
 * in the first half and incoming easing in the second, keeping the ease-out → ease-in chain smooth.
 */
export function easeBetween(out: EasingId, into: EasingId, p: number, bezier?: Bezier): number {
  // A custom curve bypasses preset blending:
  // manually placed handles express the user's intended curve.
  if (bezier) return cubicBezier(p, bezier);
  const a = EASING_FN.get(out) ?? EASING_FN.get('easeInOut')!;
  const b = EASING_FN.get(into) ?? EASING_FN.get('easeInOut')!;
  if (out === into) return a(p);
  return a(p) * (1 - p) + b(p) * p;
}

/* ----------------------------------------------------------------- model */

/** Cubic Bezier control points: [x1, y1, x2, y2], matching CSS. */
export type Bezier = [number, number, number, number];

/* ------------------------------------------------------------- mirroring */

/*
  Mirror in time for reversal and the return half of a seamless loop. ⚠️ Swapping easing names alone
  was incorrect: "Ease Out" at both ends still ended with deceleration in reverse. Measured: reversed
  0→8 ease-out gave 4.5 instead of 7.5 at 1 second. Mirror the curve itself: h(p) = 1 − f(1 − p). To
  preserve blending in easeBetween, the new outgoing easing mirrors the old incoming easing, and vice
  versa.
*/
const MIRROR_NAMED: Partial<Record<EasingId, EasingId>> = {
  linear: 'linear',
  ease: 'ease',
  easeInOut: 'easeInOut',
  easeIn: 'easeOut',
  easeOut: 'easeIn',
};
/*
  For curves without listed mirrors, use standard Bezier approximations (easings.net): Sine =
  easeInSine → easeOutSine; Quint = easeOutQuint → easeInQuint; Expo = easeInExpo → easeOutExpo; Back
  = easeOutBack → easeInBack. Spring has no Bezier equivalent because it oscillates, so keep it
  unchanged.
*/
const MIRROR_BEZIER: Partial<Record<EasingId, Bezier>> = {
  sine: [0.61, 1, 0.88, 1],
  quint: [0.64, 0, 0.78, 0],
  expo: [0.16, 1, 0.3, 1],
  back: [0.36, 0, 0.66, -0.56],
};

export function mirrorBezier(b: Bezier): Bezier {
  return [1 - b[2], 1 - b[3], 1 - b[0], 1 - b[1]];
}

/**
 * Outgoing easing, incoming easing, and custom curve for a time-mirrored a→b segment (a.easingOut,
 * b.easingIn, a.bezier). Write the Bezier to the new starting keyframe, which was the old ending
 * keyframe.
 */
export function mirrorSegment(
  out: EasingId,
  into: EasingId,
  bezier?: Bezier,
): { out: EasingId; into: EasingId; bezier?: Bezier } {
  const named = { out: MIRROR_NAMED[into] ?? into, into: MIRROR_NAMED[out] ?? out };
  if (bezier) return { ...named, bezier: mirrorBezier(bezier) };
  if (out === into && !MIRROR_NAMED[out] && MIRROR_BEZIER[out]) return { out, into, bezier: MIRROR_BEZIER[out] };
  return named;
}

/**
 * Mirror keyframes in time over duration d, including segment curves. Input order is arbitrary; output
 * is sorted by time.
 */
export function mirrorKeyframes(keys: TrackKeyframe[], d: number, round: (t: number) => number): TrackKeyframe[] {
  const ks = [...keys].sort((a, b) => a.t - b.t);
  const out = ks.map((k) => {
    const copy: TrackKeyframe = { ...k, t: round(d - k.t), easingIn: k.easingOut, easingOut: k.easingIn };
    delete copy.bezier;
    return copy;
  });
  for (let i = 0; i < ks.length - 1; i += 1) {
    const m = mirrorSegment(ks[i].easingOut, ks[i + 1].easingIn, ks[i].bezier);
    out[i + 1].easingOut = m.out;
    if (m.bezier) out[i + 1].bezier = m.bezier;
    out[i].easingIn = m.into;
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * Find Bezier y for a given x, as with CSS cubic-bezier. The curve is parametric (t → x,y), but
 * evaluation needs x → y. Solve t by bisection: 18 steps give 1/2^18 error, sufficient for animation
 * without Newton's divergence risk on pathological curves.
 */
export function cubicBezier(p: number, b: Bezier): number {
  const [x1, y1, x2, y2] = b;
  const cx = (t: number) => 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
  const cy = (t: number) => 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i += 1) {
    const mid = (lo + hi) / 2;
    if (cx(mid) < p) lo = mid;
    else hi = mid;
  }
  return cy((lo + hi) / 2);
}

export type TrackKeyframe = {
  id: string;
  /** Seconds within the scene; trimming does not cut keyframe data. */
  t: number;
  value: number;
  easingIn: EasingId;
  easingOut: EasingId;
  /**
   * Custom curve for the segment after this keyframe. Overrides presets when set by moving handles in
   * the graph editor.
   */
  bezier?: Bezier;
};

export type PropertyTrack = {
  /** 'camera.fov', 'blur.strength', 'light.key' … */
  path: string;
  keyframes: TrackKeyframe[];
};

let kfSeq = 0;
export function nextKeyframeId(): string {
  kfSeq += 1;
  return `kf-${Date.now().toString(36)}-${kfSeq}`;
}

export function makeKeyframe(t: number, value: number): TrackKeyframe {
  return { id: nextKeyframeId(), t, value, easingIn: 'easeInOut', easingOut: 'easeInOut' };
}

/* ------------------------------------------------------------ evaluation */

/**
 * Sample a track at the given time. Without keyframes, return undefined and leave the property
 * untouched in the caller. Unanimated properties retain the user's manual values.
 */
export function evaluateTrack(track: PropertyTrack, t: number): number | undefined {
  const k = track.keyframes;
  if (!k.length) return undefined;
  if (k.length === 1) return k[0].value;

  // The store guarantees time-sorted keyframes,
  // but imported files are not trusted.
  const s = isSorted(k) ? k : [...k].sort((a, b) => a.t - b.t);
  if (t <= s[0].t) return s[0].value;
  if (t >= s[s.length - 1].t) return s[s.length - 1].value;

  let i = 0;
  while (i < s.length - 1 && s[i + 1].t < t) i += 1;
  const a = s[i];
  const b = s[i + 1];
  const span = b.t - a.t;
  // Two keyframes at the same time: step to the second.
  if (span <= 0) return b.value;
  const eased = easeBetween(a.easingOut, b.easingIn, (t - a.t) / span, a.bezier);
  return a.value + (b.value - a.value) * eased;
}

function isSorted(k: TrackKeyframe[]): boolean {
  for (let i = 1; i < k.length; i += 1) if (k[i].t < k[i - 1].t) return false;
  return true;
}

/** Is there a keyframe at this time, within tolerance? */
export function keyframeAt(track: PropertyTrack | undefined, t: number): TrackKeyframe | undefined {
  // Use a 1/60-second tolerance: users cannot position the playhead at the exact decimal,
  // and should not have to.
  return track?.keyframes.find((k) => Math.abs(k.t - t) < 0.017);
}

/* -------------------------------------------------- animatable property registry */

export type AnimatableSpec = {
  path: string;
  /** Display name in the panel and timeline row. */
  label: string;
  /** Section used for timeline grouping. */
  group: 'camera' | 'blur' | 'light' | 'border' | 'media' | 'layout';
  min: number;
  max: number;
  step: number;
  precision: number;
};

/**
 * Animatable property registry. Panels, timeline, and migration code share this source. Add one entry
 * here to make a new property animatable.
 */
export const ANIMATABLE: AnimatableSpec[] = [
  { path: 'camera.tiltX', label: 'Tilt X', group: 'camera', min: -70, max: 70, step: 1, precision: 0 },
  { path: 'camera.tiltY', label: 'Tilt Y', group: 'camera', min: -60, max: 60, step: 1, precision: 0 },
  { path: 'camera.roll', label: 'Roll', group: 'camera', min: -180, max: 180, step: 1, precision: 0 },
  { path: 'camera.fov', label: 'FOV', group: 'camera', min: 10, max: 100, step: 1, precision: 0 },
  { path: 'camera.zoom', label: 'Zoom', group: 'camera', min: 0.5, max: 30, step: 0.01, precision: 2 },
  { path: 'camera.panX', label: 'Pan X', group: 'camera', min: -12, max: 12, step: 0.01, precision: 2 },
  { path: 'camera.panY', label: 'Pan Y', group: 'camera', min: -12, max: 12, step: 0.01, precision: 2 },
  { path: 'camera.rotX', label: 'Rotate X', group: 'camera', min: -90, max: 90, step: 1, precision: 0 },
  { path: 'camera.rotY', label: 'Rotate Y', group: 'camera', min: -50, max: 50, step: 1, precision: 0 },
  { path: 'camera.handheld', label: 'Handheld', group: 'camera', min: 0, max: 1, step: 0.01, precision: 2 },
  { path: 'camera.flap', label: 'Flap', group: 'camera', min: -90, max: 90, step: 1, precision: 0 },
  { path: 'blur.strength', label: 'Blur', group: 'blur', min: 0, max: 60, step: 1, precision: 0 },
  { path: 'blur.focusSize', label: 'Focus size', group: 'blur', min: 0.05, max: 1, step: 0.01, precision: 2 },
  { path: 'blur.falloff', label: 'Falloff', group: 'blur', min: 0, max: 1, step: 0.01, precision: 2 },
  { path: 'blur.fx', label: 'Focus X', group: 'blur', min: 0, max: 1, step: 0.01, precision: 2 },
  { path: 'blur.fy', label: 'Focus Y', group: 'blur', min: 0, max: 1, step: 0.01, precision: 2 },
  { path: 'light.key', label: 'Key light', group: 'light', min: 0, max: 4, step: 0.01, precision: 2 },
  { path: 'light.rotation', label: 'Light rotation', group: 'light', min: 0, max: 360, step: 1, precision: 0 },
  { path: 'light.envIntensity', label: 'Reflection', group: 'light', min: 0, max: 3, step: 0.01, precision: 2 },
  { path: 'light.lift', label: 'Lift', group: 'light', min: 0, max: 6, step: 0.01, precision: 2 },
  /*
    Screen light intensity is animatable: fading up from 0 in a dark room can define a shot. Color is
    not animatable; it is measured from media. Intensity is the numeric control users animate.
  */
  { path: 'light.screenGlow', label: 'Screen glow', group: 'light', min: 0, max: 3, step: 0.01, precision: 2 },
  /* MacBook lid angle is animatable. */
  { path: 'deviceOpts.lidAngle', label: 'Lid angle', group: 'border', min: -90, max: 120, step: 1, precision: 0 },
  { path: 'deviceOpts.depth', label: 'Depth', group: 'border', min: 0.02, max: 2, step: 0.01, precision: 2 },
  { path: 'border.radius', label: 'Border radius', group: 'border', min: 0, max: 0.5, step: 0.005, precision: 3 },
  { path: 'border.width', label: 'Border width', group: 'border', min: 0, max: 10, step: 0.1, precision: 1 },
  /*
    Screen scrolling: move a long screenshot inside the device (0 = top, 1 = bottom), producing a
    scrolling-page video from a single image.
  */
  { path: 'crop.scroll', label: 'Scroll', group: 'media', min: 0, max: 1, step: 0.001, precision: 2 },
];

const ANIMATABLE_BY_PATH = new Map(ANIMATABLE.map((a) => [a.path, a]));

/*
  Layout slots support per-device animation. Main device: mainSlot.<field>; extra devices:
  extras.<id>.<field>. Address array entries by ID so reordering cannot redirect tracks. Units match
  layouts: x/z use main-device width, y uses height. These paths are dynamic because extra-device IDs
  vary by project.
*/
const SLOT_RE = /^(mainSlot|extras\.[^.]+)\.(x|y|z|rotY|scale)$/;
const SLOT_FIELDS: Record<string, { label: string; min: number; max: number; step: number; precision: number }> = {
  x: { label: 'X', min: -3, max: 3, step: 0.01, precision: 2 },
  y: { label: 'Y', min: -3, max: 3, step: 0.01, precision: 2 },
  z: { label: 'Depth', min: -3, max: 3, step: 0.01, precision: 2 },
  rotY: { label: 'Turn', min: -180, max: 180, step: 1, precision: 0 },
  // Not 0: zero scale creates a singular matrix (the RoundedBox NaN issue).
  scale: { label: 'Scale', min: 0.02, max: 2, step: 0.01, precision: 2 },
};

export function animatable(path: string): AnimatableSpec | undefined {
  const hit = ANIMATABLE_BY_PATH.get(path);
  if (hit) return hit;
  const m = SLOT_RE.exec(path);
  if (!m) return undefined;
  const f = SLOT_FIELDS[m[2]];
  return { path, group: 'layout', ...f, label: `${m[1] === 'mainSlot' ? 'Device 1' : 'Device'} ${f.label}` };
}

/** Is this a slot track (mainSlot.x, extras.<id>.y …)? */
export function isSlotPath(path: string): boolean {
  return SLOT_RE.test(path);
}

/**
 * Timeline/panel label: resolve extra-device order from the scene ("Device 3 Y"); the registry has no
 * scene context. Other paths use the registered label.
 */
export function trackLabel(path: string, shot?: { extras: { id: string }[] }): string {
  const m = SLOT_RE.exec(path);
  if (m && shot && m[1] !== 'mainSlot') {
    const i = shot.extras.findIndex((e) => `extras.${e.id}` === m[1]);
    if (i >= 0) return `Device ${i + 2} ${SLOT_FIELDS[m[2]].label}`;
  }
  return animatable(path)?.label ?? path;
}

/* ------------------------------------------------------- dotted path access */

/**
 * Read a path such as 'camera.fov' from an object. Return undefined for missing paths so callers can
 * silently skip legacy fields.
 */
export function getByPath(obj: unknown, path: string): number | undefined {
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    // Array path segments are IDs: extras.<id>.x.
    cur = Array.isArray(cur)
      ? cur.find((e) => !!e && typeof e === 'object' && (e as { id?: unknown }).id === part)
      : (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'number' ? cur : undefined;
}

/**
 * Write a path by copying, without mutating input. Zustand requires immutable state: in-place writes
 * would prevent React rerenders and leave the scene displaying old values.
 */
const MISS = Symbol('miss');

export function setByPath<T>(obj: T, path: string, value: number): T {
  const parts = path.split('.');
  /*
    Handle arrays safely: intermediate array segments are IDs. Find entries by ID and copy with map.
    Previously, object spread at every level turned extras.<id>.x writes into plain objects, silently
    corrupting the extra-device list. Unknown IDs (deleted-device tracks or templates from other
    projects) leave input unchanged.
  */
  const write = (node: unknown, i: number): unknown => {
    if (node === null || typeof node !== 'object') return MISS;
    const key = parts[i];
    if (Array.isArray(node)) {
      const idx = node.findIndex((e) => !!e && typeof e === 'object' && (e as { id?: unknown }).id === key);
      if (idx < 0 || i === parts.length - 1) return MISS;
      const child = write(node[idx], i + 1);
      return child === MISS ? MISS : node.map((e, j) => (j === idx ? child : e));
    }
    const rec = node as Record<string, unknown>;
    if (i === parts.length - 1) return { ...rec, [key]: value };
    const child = write(rec[key], i + 1);
    return child === MISS ? MISS : { ...rec, [key]: child };
  };
  const out = write(obj, 0);
  return out === MISS ? obj : (out as T);
}
