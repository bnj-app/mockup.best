import * as THREE from 'three';
import { makeAnnotation, makeTextItem, useEditor, type Annotation, type Shot, type TextItem } from '@/store/editor';
import { nextKeyframeId, type EasingId, type PropertyTrack } from '@/config/tracks';
import { CAMERA_LIMITS } from '@/config/motion';
import { getSceneRefs } from './exportBridge';
import { analysisPixels, pickFocus, scanFocus, type FocusKind, type FocusScan } from '@/lib/focusFinder';
import { beginHistoryBatch, endHistoryBatch } from '@/store/history';

/**
 * Auto-motion: camera movement that visits focus areas on the device screen.
 *
 * Areas come from the user (drawn boxes, raycast onto the screen at drawing time) or from Find focus
 * areas / Direct it (lib/focusFinder.ts on the screen image, mapped through the inverse texture
 * transform). Either way they become TARGETS in screen-local coordinates: the same pixel regardless of
 * later camera moves, so Compose and Shuffle never drift.
 *
 * The director orders the targets (hero first, buttons last), gives each a viewing angle from its kind
 * and position (yaw/pitch signs are measured, not assumed), fits the scene length (fewer stops rather
 * than a rushed tour; the last stop holds too), then solves pan and zoom numerically in the live scene
 * so the area fills about half the frame. Output is ordinary keyframes plus optional highlights
 * (rings, a count-up caption) and soft focus, all editable and undone in one step.
 */

export type AreaRect = { x0: number; y0: number; x1: number; y1: number };

/** Viewing angles for hand-drawn areas (no kind known); Shuffle rotates through them. */
const ANGLES: [number, number][] = [
  [-8, 20],
  [-14, -24],
  [-4, 32],
  [-12, -12],
  [-18, 14],
  [-6, -30],
];

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

type Pose = { tiltX: number; tiltY: number; zoom: number; panX: number; panY: number };

function setCam(p: Partial<Pose>) {
  useEditor.setState((s) => ({
    shots: s.shots.map((x) => (x.id === s.activeShotId ? { ...x, camera: { ...x.camera, ...p, roll: 0 } } : x)),
  }));
}

const clamp = (k: keyof typeof CAMERA_LIMITS, v: number) => {
  const l = CAMERA_LIMITS[k];
  return Math.max(l.min, Math.min(l.max, v));
};
const c01 = (v: number) => Math.min(1, Math.max(0, v));

/** Focus areas per scene length: an upper bound; the director may use fewer to keep stops readable. */
export function focusCountFor(duration: number): number {
  return duration < 3.5 ? 2 : duration < 6 ? 3 : 4;
}

/* ------------------------------------------------------------------ targets */

export type TargetKind = FocusKind | 'drawn';
type Local = { c: THREE.Vector3; w: number; h: number };
/** A focus area on the main screen, in screen-local coordinates (see file comment). */
export type FocusTarget = Local & { kind: TargetKind; score: number; content: Local; label?: string; conf?: number };
/** Find focus areas: targets plus frame rectangles to show them; `reason` explains an empty result. */
export type FocusResult = { rects: AreaRect[]; targets: FocusTarget[]; reason?: 'no-image' | 'facing-away' | 'none' };

/** Main screen, its image and the mappings between image, screen and frame. */
function screenContext() {
  const refs = getSceneRefs();
  if (!refs) return null;
  const { scene, camera } = refs;
  const screen = scene.getObjectByName('main-screen') as THREE.Mesh | undefined;
  const tex = (screen?.material as THREE.MeshBasicMaterial | undefined)?.map ?? null;
  const src = tex?.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
  if (!screen || !tex || !src) return null;
  const el = src as HTMLImageElement & HTMLVideoElement;
  const iw = el.videoWidth || el.naturalWidth || src.width || 0;
  const ih = el.videoHeight || el.naturalHeight || src.height || 0;
  tex.updateMatrix();
  const fwd = tex.matrix.clone();
  const inv = fwd.clone().invert();
  const imgY = (v: number) => (tex.flipY ? 1 - v : v);
  const geo = screen.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox!.clone();
  const gw = bb.max.x - bb.min.x;
  const gh = bb.max.y - bb.min.y;
  camera.updateMatrixWorld();
  screen.updateWorldMatrix(true, false);
  /*
    Visible part of the image (cover crop, Crop top/bottom, Scroll): the screen's UV corners through the
    texture transform. Candidates are chosen inside it; choosing first and dropping cropped areas
    afterwards left nothing when the best areas were scrolled out of view.
  */
  const corners = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(([u, v]) => new THREE.Vector3(u, v, 1).applyMatrix3(fwd));
  const visible = {
    x0: c01(Math.min(...corners.map((c) => c.x))),
    x1: c01(Math.max(...corners.map((c) => c.x))),
    y0: c01(Math.min(...corners.map((c) => imgY(c.y)))),
    y1: c01(Math.max(...corners.map((c) => imgY(c.y)))),
  };
  // Image point (x right, y down) → screen-local point.
  const toLocal = (u: number, yTop: number) => {
    const t = new THREE.Vector3(u, imgY(yTop), 1).applyMatrix3(inv);
    return new THREE.Vector3(bb.min.x + c01(t.x) * gw, bb.min.y + c01(t.y) * gh, 0);
  };
  const toFrame = (local: THREE.Vector3) => {
    const ndc = screen.localToWorld(local.clone()).project(camera);
    return { x: (ndc.x + 1) / 2, y: (1 - ndc.y) / 2, onFrame: Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1 && ndc.z < 1 };
  };
  return { scene, camera, screen, tex, src, iw, ih, bb, gw, gh, visible, toLocal, toFrame };
}
type ScreenCtx = NonNullable<ReturnType<typeof screenContext>>;

/** Pixel pass for the main screen image (and the context it was read with). */
function scanScreen(): { ctx: ScreenCtx; scan: FocusScan } | null {
  const ctx = screenContext();
  if (!ctx) return null;
  const px = analysisPixels(ctx.src, ctx.iw, ctx.ih);
  if (!px) return null;
  return { ctx, scan: scanFocus(px, ctx.visible) };
}

/**
 * Optional second pass over the candidates before grouping (reading the text: numbers, prices, button
 * labels). Plugged in by the OCR module; without it the pixel result is used as is.
 */
export type ScanRefiner = (scan: FocusScan, source: CanvasImageSource, size: { w: number; h: number }) => Promise<void>;
let refiner: ScanRefiner | null = null;
export function setScanRefiner(fn: ScanRefiner | null) {
  refiner = fn;
}

/** Image box → screen-local box (centre and size along the screen axes). */
function localBox(ctx: ScreenCtx, b: AreaRect): Local {
  const c = ctx.toLocal((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  const l = ctx.toLocal(b.x0, (b.y0 + b.y1) / 2);
  const r = ctx.toLocal(b.x1, (b.y0 + b.y1) / 2);
  const t = ctx.toLocal((b.x0 + b.x1) / 2, b.y0);
  const d = ctx.toLocal((b.x0 + b.x1) / 2, b.y1);
  return { c, w: Math.max(0.05, l.distanceTo(r)), h: Math.max(0.05, t.distanceTo(d)) };
}

/** Targets for regions, dropping what the viewer cannot see now; plus frame rectangles to show them. */
function regionsToResult(ctx: ScreenCtx, scan: FocusScan, max: number): FocusResult {
  const { screen, camera, scene, bb } = ctx;
  /*
    The screen must face the camera. With the device turned around, the screen's projection still
    lands on the frame (over the back of the case), and areas were suggested there.
  */
  const centerW = screen.localToWorld(new THREE.Vector3((bb.min.x + bb.max.x) / 2, (bb.min.y + bb.max.y) / 2, 0));
  const normalW = new THREE.Vector3(0, 0, 1).transformDirection(screen.matrixWorld);
  const camW = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  if (normalW.dot(camW.clone().sub(centerW)) <= 0) return { rects: [], targets: [], reason: 'facing-away' };
  // Occlusion tolerance: glass and overlays sit just above the screen; a lid or another device does not.
  const heightW = screen
    .localToWorld(new THREE.Vector3(0, bb.max.y, 0))
    .distanceTo(screen.localToWorld(new THREE.Vector3(0, bb.min.y, 0)));
  const tol = Math.max(0.02, heightW * 0.04);
  const ray = new THREE.Raycaster();
  ray.camera = camera;
  const occluded = (local: THREE.Vector3) => {
    const pW = screen.localToWorld(local.clone());
    const dir = pW.clone().sub(camW);
    const dist = dir.length();
    ray.set(camW, dir.normalize());
    try {
      const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.visible && h.object !== screen);
      return !!hit && hit.distance < dist - tol;
    } catch {
      return false;
    }
  };

  const rects: AreaRect[] = [];
  const targets: FocusTarget[] = [];
  for (const r of pickFocus(scan, max)) {
    const box = localBox(ctx, r);
    const c = ctx.toFrame(box.c);
    // Off the frame or hidden behind something: the user could not see what the camera would visit.
    if (!c.onFrame || occluded(box.c)) continue;
    const pts = [ctx.toLocal(r.x0, r.y0), ctx.toLocal(r.x1, r.y0), ctx.toLocal(r.x0, r.y1), ctx.toLocal(r.x1, r.y1)].map(ctx.toFrame);
    const xs = [c.x, ...pts.map((p) => p.x)];
    const ys = [c.y, ...pts.map((p) => p.y)];
    const rect = { x0: c01(Math.min(...xs)), y0: c01(Math.min(...ys)), x1: c01(Math.max(...xs)), y1: c01(Math.max(...ys)) };
    if (rect.x1 - rect.x0 <= 0.01 || rect.y1 - rect.y0 <= 0.01) continue;
    // The label read for the region's main item, if any (OCR).
    const W = scan.W;
    const H = scan.H;
    const main = scan.items.find(
      (it) => Math.abs(it.x0 / W - r.content.x0) < 1e-6 && Math.abs(it.y0 / H - r.content.y0) < 1e-6,
    );
    rects.push(rect);
    targets.push({ ...box, kind: r.kind, score: r.score, content: localBox(ctx, r.content), label: main?.label, conf: main?.conf });
  }
  return targets.length ? { rects, targets } : { rects, targets, reason: 'none' };
}

/** Find focus areas, pixel pass only (synchronous; tests and the fallback use it). */
export function findFocusRects(max: number): FocusResult {
  const s = scanScreen();
  if (!s) return { rects: [], targets: [], reason: 'no-image' };
  return regionsToResult(s.ctx, s.scan, max);
}

/** Find focus areas for the active scene: pixel pass, then the text pass when available. */
export async function analyzeFocus(max = focusCountFor(useEditor.getState().active().duration)): Promise<FocusResult> {
  const s = scanScreen();
  if (!s) return { rects: [], targets: [], reason: 'no-image' };
  if (refiner) {
    try {
      await refiner(s.scan, s.ctx.src, { w: s.ctx.iw, h: s.ctx.ih });
    } catch {
      // Keep the pixel result.
    }
  }
  return regionsToResult(s.ctx, s.scan, max);
}

/** Focus areas for the active scene, pixel pass (kept for the synchronous callers). */
export function findFocusCountRects(): FocusResult {
  return findFocusRects(focusCountFor(useEditor.getState().active().duration));
}

/** Hand-drawn frame rectangles → targets, raycast onto the screen with the camera as it is now. */
export function rectsToTargets(rects: AreaRect[]): FocusTarget[] {
  const refs = getSceneRefs();
  if (!refs) return [];
  const { scene, camera } = refs;
  const screen = scene.getObjectByName('main-screen') as THREE.Mesh | undefined;
  if (!screen) return [];
  camera.updateMatrixWorld();
  screen.updateWorldMatrix(true, false);
  const ray = new THREE.Raycaster();
  const n = new THREE.Vector3(0, 0, 1).transformDirection(screen.matrixWorld);
  const p0 = new THREE.Vector3().setFromMatrixPosition(screen.matrixWorld);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, p0);
  const toLocal = (fx: number, fy: number) => {
    ray.setFromCamera(new THREE.Vector2(fx * 2 - 1, -(fy * 2 - 1)), camera);
    const hit = ray.ray.intersectPlane(plane, new THREE.Vector3());
    return hit ? screen.worldToLocal(hit) : null;
  };
  const out: FocusTarget[] = [];
  for (const r of rects) {
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const c = toLocal(cx, cy);
    const t = toLocal(cx, Math.min(r.y0, r.y1));
    const b = toLocal(cx, Math.max(r.y0, r.y1));
    const l = toLocal(Math.min(r.x0, r.x1), cy);
    const rr = toLocal(Math.max(r.x0, r.x1), cy);
    if (!c || !t || !b || !l || !rr) continue;
    const box = { c, h: Math.max(0.05, t.distanceTo(b)), w: Math.max(0.05, l.distanceTo(rr)) };
    out.push({ ...box, kind: 'drawn', score: 0.5, content: box });
  }
  return out;
}

/* ----------------------------------------------------------------- director */

export type DirectOptions = {
  /** Up to two rings on numbers/prices and buttons, inside their stops. */
  highlights: boolean;
  /** One count-up caption for a confidently read number (needs the text pass). */
  countUp: boolean;
  /** Radial soft focus around each close-up stop. */
  softFocus: boolean;
};
export const DIRECT_DEFAULTS: DirectOptions = { highlights: true, countUp: false, softFocus: false };

/** Generated items carry this id prefix: recomposing replaces only them, never the user's own. */
const AUTO = 'am-';
const isAuto = (id: string) => id.startsWith(AUTO);

/** Readable holds per kind (seconds); a count-up needs 1.2 s of counting plus time to read the result. */
const HOLD: Record<TargetKind, number> = { text: 1.0, number: 1.0, button: 0.9, visual: 0.8, drawn: 0.8 };
/** Angle limits per kind: text stays near-frontal to stay legible; a large visual can turn more. */
const YAW: Record<TargetKind, number> = { text: 12, number: 12, button: 10, visual: 25, drawn: 14 };
const PITCH: Record<TargetKind, number> = { text: 8, number: 8, button: 6, visual: 12, drawn: 8 };
const BASE_PITCH = -6;
const MIN_TRAVEL = 0.5;

/** Small deterministic random source (Shuffle varies the seed). */
function rng(seed: number) {
  let a = (seed * 2654435761) >>> 0 || 1;
  return () => {
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    return ((a >>> 0) % 10000) / 10000;
  };
}

/**
 * Hero first, then reading order (top to bottom, left to right), buttons (calls to action) last. The
 * hero is the strongest area that is not a button: a tour opening on "Add to bag" reads backwards.
 */
function orderTargets(targets: FocusTarget[]): FocusTarget[] {
  if (targets.every((t) => t.kind === 'drawn')) return targets;
  const pool = targets.some((t) => t.kind !== 'button') ? targets.filter((t) => t.kind !== 'button') : targets;
  const hero = pool.reduce((a, b) => (b.score > a.score ? b : a));
  const rest = targets.filter((t) => t !== hero);
  const reading = (a: FocusTarget, b: FocusTarget) => b.c.y - a.c.y || a.c.x - b.c.x;
  rest.sort((a, b) => Number(a.kind === 'button') - Number(b.kind === 'button') || reading(a, b));
  return [hero, ...rest];
}

/**
 * Time plan: lead-in, travel and hold per stop. Drops the weakest stops (never the hero) until every
 * stop keeps a readable hold and at least MIN_TRAVEL to get there; the hero is reached by ~1.2 s.
 */
function timePlan(targets: FocusTarget[], D: number, holdFor: (t: FocusTarget) => number) {
  let list = [...targets];
  const lead = Math.min(0.5, D * 0.08);
  for (;;) {
    const holds = list.map(holdFor);
    const free = D - lead - holds.reduce((a, b) => a + b, 0);
    if (free >= MIN_TRAVEL * list.length || list.length === 1) {
      const k = list.length;
      const travel = Math.max(0.3, free / k);
      const travels = list.map(() => travel);
      // Reach the hero early; give the saved time to the later moves.
      if (k > 1) {
        const first = Math.max(MIN_TRAVEL, Math.min(travels[0], 1.2 - lead));
        const spare = travels[0] - first;
        travels[0] = first;
        for (let i = 1; i < k; i++) travels[i] += spare / (k - 1);
      }
      // A single stop in a very short scene: shorten its hold rather than overrun the scene.
      const scale = free < MIN_TRAVEL && k === 1 ? Math.max(0.2, (D - lead - MIN_TRAVEL) / holds[0]) : 1;
      return { list, lead, travels, holds: holds.map((h) => h * scale) };
    }
    // Drop the weakest non-hero stop.
    let weakest = 1;
    for (let i = 2; i < list.length; i++) if (list[i].score < list[weakest].score) weakest = i;
    list = list.filter((_, i) => i !== weakest);
  }
}

/**
 * Measure which yaw/pitch sign brings a screen side closer to the camera: the camera rig orbits and the
 * device may itself be rotated, so the sign is not assumed. +1 means a positive tilt favours +x / +y.
 */
async function measureSigns(screen: THREE.Object3D, camera: THREE.Camera, gw: number, gh: number, base: Pose) {
  const camPos = () => new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  const dist = (local: THREE.Vector3) => {
    camera.updateMatrixWorld();
    screen.updateWorldMatrix(true, false);
    return screen.localToWorld(local.clone()).distanceTo(camPos());
  };
  const probe = async (p: Partial<Pose>, a: THREE.Vector3, b: THREE.Vector3) => {
    setCam({ ...base, ...p });
    await frame();
    await frame();
    return dist(a) < dist(b) ? 1 : -1;
  };
  const right = new THREE.Vector3(gw * 0.4, 0, 0);
  const left = new THREE.Vector3(-gw * 0.4, 0, 0);
  const top = new THREE.Vector3(0, gh * 0.4, 0);
  const bottom = new THREE.Vector3(0, -gh * 0.4, 0);
  const yawSign = await probe({ tiltY: 15, tiltX: 0 }, right, left);
  const pitchSign = await probe({ tiltX: 12, tiltY: 0 }, top, bottom);
  return { yawSign, pitchSign };
}

/**
 * Compose the camera tour for the given targets. Returns the number of stops (0 = nothing to do).
 * One undo step restores the scene as it was.
 */
export async function composeTargets(input: FocusTarget[], seed = 0, opts: DirectOptions = DIRECT_DEFAULTS): Promise<number> {
  const refs = getSceneRefs();
  if (!refs || !input.length) return 0;
  const { scene, camera } = refs;
  const screen = scene.getObjectByName('main-screen') as THREE.Mesh | undefined;
  if (!screen) return 0;
  const st = useEditor.getState();
  const shot0 = st.active();
  /*
    Start pose: the user's view, or, when an earlier automatic tour exists, its base (overview) camera.
    The evaluated camera at the playhead is a zoomed stop mid-tour; starting Shuffle from it began the
    new tour zoomed in and made no stop count as a close-up.
  */
  const pick = ({ tiltX, tiltY, zoom, panX, panY }: Pose) => ({ tiltX, tiltY, zoom, panX, panY });
  const overview: Pose = pick(shot0.autoDirect ? shot0.camera : st.evaluated().camera);
  const geo = screen.geometry;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const gw = bb.max.x - bb.min.x;
  const gh = bb.max.y - bb.min.y;

  const canCount = (t: FocusTarget) =>
    opts.countUp && t.kind === 'number' && !!t.label && (t.conf ?? 0) >= 90 && /^[^\d-]*-?[\d.,\s]*\d[\d.,]*\s*[%€£$₺¥]?$/.test(t.label);
  // A ring needs a stop of at least 1 s to enter and leave; give ringable stops that much.
  const holdFor = (t: FocusTarget) =>
    canCount(t) ? 1.6 : opts.highlights && (t.kind === 'number' || t.kind === 'button') ? Math.max(1.0, HOLD[t.kind]) : HOLD[t.kind];
  const plan = timePlan(orderTargets(input), shot0.duration, holdFor);
  const targets = plan.list;

  beginHistoryBatch();
  const prevRecording = st.recording;
  try {
    // Prepare: stop playback/recording; drop camera tracks and preset motion (they would override the
    // solved base); drop earlier automatic highlights and soft focus.
    const ownBlur = !!shot0.autoDirect?.softFocus;
    useEditor.setState((s) => ({
      recording: false,
      playing: false,
      shots: s.shots.map((x) =>
        x.id === s.activeShotId
          ? {
              ...x,
              motionId: null,
              tracks: x.tracks.filter((tr) => !tr.path.startsWith('camera.') && !(ownBlur && tr.path.startsWith('blur.'))),
              annotations: x.annotations.filter((a) => !isAuto(a.id)),
              texts: x.texts.filter((t) => !isAuto(t.id)),
              ...(ownBlur && shot0.autoDirect?.prevBlurMode ? { blur: { ...x.blur, mode: shot0.autoDirect.prevBlurMode } } : null),
            }
          : x,
      ),
    }));

    const drawnOnly = targets.every((t) => t.kind === 'drawn');
    const signs = drawnOnly ? null : await measureSigns(screen, camera, gw, gh, overview);
    const rand = rng(seed + 1);
    const project = (v: THREE.Vector3) => {
      camera.updateMatrixWorld();
      screen.updateWorldMatrix(true, false);
      return screen.localToWorld(v.clone()).project(camera);
    };

    type Pt = { x: number; y: number };
    type Stop = { pose: Pose; target: FocusTarget; corners: Pt[]; frame: Pt[] };
    const stops: Stop[] = [];
    let prevYaw = overview.tiltY;
    let prevPitch = overview.tiltX;
    for (let i = 0; i < targets.length; i++) {
      const tg = targets[i];
      let yaw: number;
      let pitch: number;
      if (!signs) {
        const [tx, ty] = ANGLES[(i + seed) % ANGLES.length];
        const jitter = seed ? ((seed * 7 + i * 13) % 9) - 4 : 0;
        pitch = tx;
        yaw = ty + jitter;
      } else {
        // Turn the side the area is on towards the camera; centred areas alternate for variety.
        const side = tg.c.x / (gw / 2);
        const vert = tg.c.y / (gh / 2);
        const vary = 0.75 + 0.5 * rand();
        const dir = Math.abs(side) > 0.08 ? Math.sign(side) : i % 2 ? -1 : 1;
        yaw = signs.yawSign * dir * YAW[tg.kind] * (0.45 + 0.55 * Math.min(1, Math.abs(side) * 1.5)) * vary;
        pitch = BASE_PITCH + signs.pitchSign * Math.sign(vert) * PITCH[tg.kind] * Math.min(1, Math.abs(vert) * 1.5) * vary;
        // Calm neighbours: limit the change from the previous stop.
        yaw = Math.max(prevYaw - 20, Math.min(prevYaw + 20, yaw));
        pitch = Math.max(prevPitch - 10, Math.min(prevPitch + 10, pitch));
      }
      prevYaw = yaw;
      prevPitch = pitch;
      const pose: Pose = { tiltX: clamp('tiltX', pitch), tiltY: clamp('tiltY', yaw), zoom: Math.max(overview.zoom, 3.2), panX: 0, panY: 0 };
      for (let it = 0; it < 8; it++) {
        setCam(pose);
        await frame();
        await frame();
        const pc = project(tg.c);
        const pt = project(tg.c.clone().add(new THREE.Vector3(0, tg.h / 2, 0)));
        const pb = project(tg.c.clone().add(new THREE.Vector3(0, -tg.h / 2, 0)));
        const pl = project(tg.c.clone().add(new THREE.Vector3(-tg.w / 2, 0, 0)));
        const pr = project(tg.c.clone().add(new THREE.Vector3(tg.w / 2, 0, 0)));
        const hN = Math.abs(pt.y - pb.y);
        const wN = Math.abs(pr.x - pl.x);
        // Make the area fill ~50% of the frame (NDC 1.0 = half the frame).
        const fit = Math.max(hN / 1.0, wN / 1.15, 0.05);
        // Cap at 8: tiny areas otherwise hit 10 and magnify pixels excessively.
        pose.zoom = Math.min(8, clamp('zoom', pose.zoom / Math.min(1.8, Math.max(0.55, fit))));
        // Pan: NDC displacement ≈ −pan/3 (rig: px = pan/6 · visible half-width ×2).
        pose.panX = clamp('panX', pose.panX + pc.x * 3 * 0.85);
        pose.panY = clamp('panY', pose.panY + pc.y * 3 * 0.85);
        if (Math.abs(pc.x) < 0.02 && Math.abs(pc.y) < 0.02 && Math.abs(fit - 1) < 0.06) break;
      }
      // Where the area's main item lands at arrival (highlight and soft focus placement).
      setCam(pose);
      await frame();
      await frame();
      // Frame positions of a box's corners and centre at arrival.
      const cornersOf = (bx: Local) =>
        [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
          [0, 0],
        ].map(([sx, sy]) => {
          const p = project(bx.c.clone().add(new THREE.Vector3((sx * bx.w) / 2, (sy * bx.h) / 2, 0)));
          return { x: (p.x + 1) / 2, y: (1 - p.y) / 2 };
        });
      // Main item (caption placement) and the whole framed area (soft focus keeps all of it sharp —
      // the main item alone left a price beside a title blurred).
      stops.push({ pose: { ...pose }, target: tg, corners: cornersOf(tg.content), frame: cornersOf(tg) });
    }

    // Keyframes: overview → each stop (quint) with a hold, the last stop included.
    const D = shot0.duration;
    const r3 = (v: number) => +v.toFixed(3);
    const keys: { t: number; pose: Pose; easing: EasingId }[] = [
      { t: 0, pose: overview, easing: 'easeInOut' },
      { t: plan.lead, pose: overview, easing: 'quint' },
    ];
    const focusMarks: { t: number; end: number }[] = [];
    const windows: { arrive: number; leave: number }[] = [];
    let t = plan.lead;
    stops.forEach((s, i) => {
      t += plan.travels[i];
      const arrive = Math.min(D, t);
      keys.push({ t: arrive, pose: s.pose, easing: 'quint' });
      t += plan.holds[i];
      const leave = Math.min(D, t);
      if (leave > arrive + 0.01) keys.push({ t: leave, pose: s.pose, easing: 'quint' });
      focusMarks.push({ t: r3(arrive), end: r3(leave) });
      windows.push({ arrive, leave });
    });
    const last = keys[keys.length - 1];
    if (last.t < D - 0.01) keys.push({ t: D, pose: last.pose, easing: 'easeInOut' });
    const fields: (keyof Pose)[] = ['tiltX', 'tiltY', 'zoom', 'panX', 'panY'];
    const tracks: PropertyTrack[] = fields.map((f) => ({
      path: `camera.${f}`,
      keyframes: keys.map((kk) => ({
        id: nextKeyframeId(),
        t: r3(kk.t),
        value: +kk.pose[f].toFixed(3),
        easingIn: kk.easing,
        easingOut: kk.easing,
      })),
    }));

    // Screen-relative position of a target's main item (annotations: 0–1, top-left origin).
    const toScreenRel = (tg: FocusTarget) => ({
      x: c01((tg.content.c.x - bb.min.x) / gw),
      y: c01(1 - (tg.content.c.y - bb.min.y) / gh),
      r: Math.min(0.3, (Math.max(tg.content.w, tg.content.h) / 2 / Math.min(gw, gh)) * 1.15),
    });

    /*
      Highlights: at most two, only on stops long enough to enter and leave. A compact number/price
      gets a ring around it; a button gets one tap at its centre (a circle around a wide button cut
      across the content beside it).
    */
    const annotations: Annotation[] = [];
    if (opts.highlights) {
      const marked = stops
        .map((s, i) => ({ s, i }))
        .filter(({ s, i }) => (s.target.kind === 'number' || s.target.kind === 'button') && windows[i].leave - windows[i].arrive >= 1.0)
        .sort((a, b) => Number(a.s.target.kind !== 'number') - Number(b.s.target.kind !== 'number'))
        .slice(0, 2);
      for (const { s, i } of marked) {
        const p = toScreenRel(s.target);
        const tap = s.target.kind === 'button';
        const start = r3(windows[i].arrive + (tap ? 0.25 : 0.1));
        annotations.push({
          ...makeAnnotation(tap ? 'tap' : 'ring', start),
          id: `${AUTO}${tap ? 'tap' : 'ring'}-${i}`,
          x: p.x,
          y: p.y,
          ...(tap ? null : { size: p.r }),
          start,
          end: r3(windows[i].leave - 0.05),
        });
      }
    }

    // Count-up caption: one confidently read number, on the frame side away from where it sits.
    const texts: TextItem[] = [];
    const countAt = opts.countUp ? stops.findIndex((s) => canCount(s.target)) : -1;
    if (countAt >= 0) {
      const s = stops[countAt];
      const cy = s.corners[4].y;
      texts.push({
        ...makeTextItem('text'),
        id: `${AUTO}count-${countAt}`,
        text: s.target.label!,
        y: cy < 0.5 ? 0.86 : 0.14,
        size: 0.075,
        bandOpacity: 0.55,
        bandColor: '#000000',
        bandRadius: 0.4,
        start: r3(windows[countAt].arrive),
        end: r3(windows[countAt].leave),
        enter: 'count',
        exit: 'fade',
        transitionDur: 0.25,
      });
    }

    // Soft focus: radial blur around each close-up stop's main item; zero while moving and in the
    // overview. Left alone if the user already animates blur.
    const userBlur = useEditor.getState().active().tracks.some((tr) => tr.path.startsWith('blur.'));
    const blurTracks: PropertyTrack[] = [];
    let softFocus = false;
    if (opts.softFocus && !userBlur) {
      const aspect = (camera as THREE.PerspectiveCamera).aspect || 1;
      const key = (tt: number, v: number) => ({ id: nextKeyframeId(), t: r3(tt), value: +v.toFixed(4), easingIn: 'linear' as EasingId, easingOut: 'linear' as EasingId });
      const strength = [key(0, 0)];
      const fx = [key(0, 0.5)];
      const fy = [key(0, 0.5)];
      const size = [key(0, 0.4)];
      stops.forEach((s, i) => {
        const { arrive, leave } = windows[i];
        const close = s.pose.zoom > overview.zoom * 1.4;
        if (!close || leave - arrive < 0.6) return;
        const c = s.frame[4];
        const far = Math.max(...s.frame.slice(0, 4).map((p) => Math.hypot((p.x - c.x) * aspect, p.y - c.y)));
        // Keep at least the middle of the frame sharp: soft focus is a gentle frame, not a crop.
        const fs = Math.min(0.9, Math.max(0.42, far * 1.1));
        strength.push(key(arrive, 0), key(arrive + 0.2, 7), key(leave - 0.2, 7), key(leave, 0));
        fx.push(key(arrive, c.x), key(leave, c.x));
        fy.push(key(arrive, c.y), key(leave, c.y));
        size.push(key(arrive, fs), key(leave, fs));
        softFocus = true;
      });
      if (softFocus) {
        blurTracks.push(
          { path: 'blur.strength', keyframes: strength },
          { path: 'blur.fx', keyframes: fx },
          { path: 'blur.fy', keyframes: fy },
          { path: 'blur.focusSize', keyframes: size },
        );
      }
    }

    useEditor.setState((s) => ({
      recording: prevRecording,
      shots: s.shots.map((x) => {
        if (x.id !== s.activeShotId) return x;
        const prevBlurMode = x.blur.mode;
        const next: Shot = {
          ...x,
          camera: { ...x.camera, ...overview, roll: 0 },
          tracks: [...x.tracks, ...tracks, ...blurTracks],
          focusMarks,
          annotations: [...x.annotations, ...annotations],
          texts: [...x.texts, ...texts],
          autoDirect: { v: 1, seed, softFocus, ...(softFocus ? { prevBlurMode } : null) },
          ...(softFocus ? { blur: { ...x.blur, mode: 'radial' as const, bokeh: false, falloff: 0.2 } } : null),
        };
        return next;
      }),
    }));
    return stops.length;
  } finally {
    useEditor.setState({ recording: prevRecording });
    endHistoryBatch();
  }
}

/** Compose from hand-drawn frame rectangles (the original Auto-motion entry point). */
export async function composeAutoMotion(rects: AreaRect[], seed = 0, opts: DirectOptions = DIRECT_DEFAULTS): Promise<number> {
  const targets = rectsToTargets(rects);
  if (!targets.length) return 0;
  return composeTargets(targets, seed, opts);
}
