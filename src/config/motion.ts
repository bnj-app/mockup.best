/**
 * Ready-made camera motions.
 * Each preset has two or more camera stops. Adding it to the timeline creates eased keyframes
 * between them, producing cinematic output without requiring camera expertise.
 */

export type CameraState = {
  tiltX: number;
  tiltY: number;
  roll: number;
  fov: number;
  zoom: number;
  panX: number;
  panY: number;
  rotX: number;
  rotY: number;
  /**
   * Handheld feel. Move the camera slowly along an irregular path: a fixed tripod view feels
   * rendered, while subtle organic motion feels filmed.
   */
  handheld: number;
  /**
   * FLAP: tilt the device around its BOTTOM EDGE. `rotX` rotates around the center; flap uses a
   * hinge, suggesting an opening lid or laying a flat card on a table with one control. Keeping
   * the bottom edge fixed prevents the device from rising in the frame.
   */
  flap: number;
};

/**
 * Limits were measured by entering out-of-range values and observing clamping.
 * TILT Y is especially important: a full 360° rotation is unsuitable, while ±60 gives a natural
 * product-shot angle. Beyond ±70, TILT X makes the device look flattened from above/below.
 */
export const CAMERA_LIMITS: Record<keyof CameraState, { min: number; max: number; step: number; precision: number }> = {
  tiltX: { min: -70, max: 70, step: 1, precision: 0 },
  tiltY: { min: -60, max: 60, step: 1, precision: 0 },
  roll: { min: -180, max: 180, step: 1, precision: 0 },
  fov: { min: 10, max: 100, step: 1, precision: 0 },
  /*
    MACRO: raise the ceiling from 10 to 30 for extreme close-ups extending beyond the frame; at
    10, the frame could not be narrower than one-third of the screen. Increase pan limits too:
    measured law f_max = |pan|max / (2·zoom). At ±3 and zoom 30, the target can be only 5% from
    screen center; ±12 allows 20%, reaching the screen edge at zoom 12.
  */
  zoom: { min: 0.5, max: 30, step: 0.01, precision: 2 },
  panX: { min: -12, max: 12, step: 0.01, precision: 2 },
  panY: { min: -12, max: 12, step: 0.01, precision: 2 },
  rotY: { min: -50, max: 50, step: 1, precision: 0 },
  rotX: { min: -90, max: 90, step: 1, precision: 0 },
  handheld: { min: 0, max: 1, step: 0.01, precision: 2 },
  flap: { min: -90, max: 90, step: 1, precision: 0 },
};

export function clampCamera<K extends keyof CameraState>(field: K, value: number): number {
  const l = CAMERA_LIMITS[field];
  return Math.min(l.max, Math.max(l.min, value));
}

/**
 * `zoom` uses a 0.5–10 scale with default 2.91. Normalize it by device size in the scene: 2.91
 * means fit to frame on every device, giving the same framing for a watch or laptop.
 */
export const ZOOM_FIT = 2.91;

/** Canvas drag: degrees per pixel, determined by measurement. */
export const DRAG_DEGREES_PER_PX = 0.5;

/** Mouse wheel: zoom change per notch. Down zooms in. */
export const ZOOM_PER_WHEEL_TICK = 0.5;

/**
 * Wheel step: measured fixed 0.5 up to zoom 10; proportional in the macro range (10–30), since
 * fixed 0.5 would take 40 notches to reach 30.
 */
export function wheelZoomStep(zoom: number): number {
  return zoom <= 10 ? ZOOM_PER_WHEEL_TICK : ZOOM_PER_WHEEL_TICK * (zoom / 10);
}

/*
  Design decision: default pan is 0/0 so the device opens centered on screen. Tilt/zoom use the
  hero pose.
*/
export const CAMERA_DEFAULT: CameraState = {
  tiltX: -19, tiltY: 42, roll: 0, fov: 18, zoom: ZOOM_FIT,
  panX: 0, panY: 0, rotX: 0, rotY: 0, handheld: 0, flap: 0,
};

/**
 * CAMERA → PRESETS pose buttons (Hero/Angled/Flat/Bottom/Detail). One-click framing: all are
 * centered (pan 0/0), changing only angle and zoom. These are POSES; MOTION_PRESETS are
 * ANIMATIONS.
 */
export const CAMERA_POSES: { id: string; label: string; camera: Partial<CameraState> }[] = [
  { id: 'hero', label: 'Hero', camera: { tiltX: -19, tiltY: 42, roll: 0, zoom: ZOOM_FIT, panX: 0, panY: 0, rotX: 0, rotY: 0 } },
  { id: 'angled', label: 'Angled', camera: { tiltX: -26, tiltY: -34, roll: 0, zoom: 2.6, panX: 0, panY: 0, rotX: 0, rotY: 0 } },
  { id: 'flat', label: 'Flat', camera: { tiltX: 0, tiltY: 0, roll: 0, zoom: 2.5, panX: 0, panY: 0, rotX: 0, rotY: 0 } },
  { id: 'bottom', label: 'Bottom', camera: { tiltX: 32, tiltY: 24, roll: 0, zoom: 2.8, panX: 0, panY: 0, rotX: 0, rotY: 0 } },
  { id: 'detail', label: 'Detail', camera: { tiltX: -8, tiltY: 52, roll: 0, zoom: 5.4, panX: 0, panY: 0, rotX: 0, rotY: 0 } },
];

export type MotionPreset = {
  id: string;
  label: string;
  /** Seconds. */
  duration: number;
  /** Time from 0..1 → partial camera state. */
  keys: { t: number; camera: Partial<CameraState> }[];
};

export const MOTION_PRESETS: MotionPreset[] = [
  {
    id: 'scan-lr',
    label: 'Scan left to right',
    duration: 4,
    keys: [
      { t: 0, camera: { tiltY: -36, panX: -0.18, zoom: 3.35 } },
      { t: 1, camera: { tiltY: 36, panX: 0.18, zoom: 3.35 } },
    ],
  },
  {
    id: 'top-to-bottom',
    label: 'Top to bottom',
    duration: 4,
    keys: [
      { t: 0, camera: { tiltX: -48, panY: 0.2, zoom: 3.64 } },
      { t: 1, camera: { tiltX: -6, panY: -0.15, zoom: 3.06 } },
    ],
  },
  {
    id: 'low-angle-pan-up',
    label: 'Low-angle pan up',
    duration: 4,
    keys: [
      { t: 0, camera: { tiltX: 32, panY: -0.2, zoom: 3.93, fov: 30 } },
      { t: 1, camera: { tiltX: -14, panY: 0.02, zoom: 3.2, fov: 22 } },
    ],
  },
  {
    id: 'slow-zoom-out',
    label: 'Slow zoom out',
    duration: 4,
    keys: [
      { t: 0, camera: { zoom: 5.24, tiltY: 20 } },
      { t: 1, camera: { zoom: 2.76, tiltY: 34 } },
    ],
  },
  {
    id: 'overhead-pan',
    label: 'Overhead pan',
    duration: 4,
    keys: [
      { t: 0, camera: { tiltX: -70, roll: -12, zoom: 3.35 } },
      { t: 1, camera: { tiltX: -70, roll: 12, zoom: 3.35 } },
    ],
  },
  {
    id: 'out-and-back',
    label: 'Out and back',
    duration: 4,
    keys: [
      { t: 0, camera: { zoom: 2.76, tiltY: 38 } },
      { t: 0.5, camera: { zoom: 4.95, tiltY: 0 } },
      { t: 1, camera: { zoom: 2.76, tiltY: -38 } },
    ],
  },
  {
    id: 'fold-up',
    label: 'Fold up',
    duration: 4,
    keys: [
      { t: 0, camera: { rotX: -68, zoom: 3.78, tiltX: -8 } },
      { t: 1, camera: { rotX: 0, zoom: 3.2, tiltX: -18 } },
    ],
  },
  {
    id: 'flat-truck',
    label: 'Flat truck',
    duration: 4,
    keys: [
      { t: 0, camera: { tiltX: -2, tiltY: 0, panX: -0.22, zoom: 3.49 } },
      { t: 1, camera: { tiltX: -2, tiltY: 0, panX: 0.22, zoom: 3.49 } },
    ],
  },
  /*
    Preset names describe techniques rather than directors or films. Both motions are
    duration-independent: preset t spans the scene duration with a fixed easeInOut curve. Dolly
    zoom is deliberately omitted because it is not perceptible on a flat gradient background; it
    needs a 3D ground plane.
  */
  {
    // Frontal, symmetrical, slow push-in; existing presets lack a frontal push-in.
    id: 'symmetry-glide',
    label: 'Symmetry glide',
    duration: 5,
    keys: [
      { t: 0, camera: { tiltX: 0, tiltY: 0, roll: 0, panX: 0, panY: 0, zoom: 2.2, fov: 30 } },
      { t: 1, camera: { tiltX: 0, tiltY: 0, roll: 0, panX: 0, panY: 0, zoom: 3.3, fov: 30 } },
    ],
  },
  {
    // The camera stays still while the DEVICE rotates: HDRI reflections require
    // device rotation to move light across the body. Reset its rotY when switching presets
    // (Timeline preset menu).
    id: 'hero-turn',
    label: 'Hero turn',
    duration: 6,
    keys: [
      { t: 0, camera: { tiltX: -8, tiltY: 6, roll: 0, zoom: 2.5, panX: 0, panY: 0, rotX: 0, rotY: -32 } },
      { t: 1, camera: { tiltX: -4, tiltY: 6, roll: 0, zoom: 2.6, panX: 0, panY: 0, rotX: 0, rotY: 32 } },
    ],
  },
];

/** User-recorded keyframe: time in seconds plus camera fields changed at that instant. */
export type Keyframe = { t: number; camera: Partial<CameraState> };

/**
 * Sample keyframes at the given time in seconds.
 * Unlike motion presets, time is in SECONDS rather than 0–1, and fields are sparse: only changed
 * values are recorded. A field with one keyframe stays constant; interpolate smoothly between
 * two.
 */
export function sampleKeyframes(keys: Keyframe[], time: number): Partial<CameraState> {
  if (!keys.length) return {};
  const sorted = [...keys].sort((a, b) => a.t - b.t);
  const out: Partial<CameraState> = {};

  const fields = new Set<string>();
  for (const k of sorted) for (const f of Object.keys(k.camera)) fields.add(f);

  for (const field of fields) {
    const f = field as keyof CameraState;
    const track = sorted.filter((k) => k.camera[f] !== undefined);
    if (!track.length) continue;

    if (time <= track[0].t) {
      out[f] = track[0].camera[f];
      continue;
    }
    if (time >= track[track.length - 1].t) {
      out[f] = track[track.length - 1].camera[f];
      continue;
    }

    let i = 0;
    while (i < track.length - 1 && track[i + 1].t < time) i += 1;
    const a = track[i];
    const b = track[i + 1];
    const span = Math.max(0.0001, b.t - a.t);
    const local = easeInOut((time - a.t) / span);
    out[f] = (a.camera[f] as number) + ((b.camera[f] as number) - (a.camera[f] as number)) * local;
  }

  return out;
}

/** Ease in/out gives motions their cinematic feel. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Sample the preset at the given normalized time. */
export function sampleMotion(preset: MotionPreset, t: number): Partial<CameraState> {
  const keys = preset.keys;
  if (t <= keys[0].t) return keys[0].camera;
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].camera;

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t < t) i += 1;
  const a = keys[i];
  const b = keys[i + 1];
  const local = easeInOut((t - a.t) / (b.t - a.t));

  const out: Partial<CameraState> = {};
  const fields = new Set([...Object.keys(a.camera), ...Object.keys(b.camera)]);
  for (const key of fields) {
    const k = key as keyof CameraState;
    const from = a.camera[k] ?? CAMERA_DEFAULT[k];
    const to = b.camera[k] ?? CAMERA_DEFAULT[k];
    out[k] = from + (to - from) * local;
  }
  return out;
}
