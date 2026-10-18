import * as THREE from 'three';
import { useEditor } from '@/store/editor';
import { nextKeyframeId, type EasingId, type PropertyTrack } from '@/config/tracks';
import { CAMERA_LIMITS } from '@/config/motion';
import { getSceneRefs } from './exportBridge';

/**
 * Auto-motion: camera movement from user-drawn focus regions. 1. Raycast from the camera at drawing
 * time into the main-screen mesh, converting regions to screen-local coordinates. The target
 * remains the same pixel regardless of later camera rotation. 2. Solve the camera numerically in
 * the live scene: choose an angle, iteratively center the target with pan, then zoom until the
 * region fills about half the frame. The measured pan = −2·f·zoom rule applied only to phones;
 * numerical solving works for laptops, monitors and watches too. 3. Output ordinary keyframes,
 * preserving easing graphs, snapping, recording mode and manual adjustment.
 */

export type AreaRect = { x0: number; y0: number; x1: number; y1: number };

/** Viewing angles for focus regions; Shuffle randomizes them. */
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

/**
 * Create regions and write camera motion. Returns the target count (0 = no region intersected the
 * screen).
 */
export async function composeAutoMotion(rects: AreaRect[], seed = 0): Promise<number> {
  const refs = getSceneRefs();
  if (!refs) return 0;
  const { scene, camera } = refs;
  const screen = scene.getObjectByName('main-screen') as THREE.Mesh | undefined;
  if (!screen) return 0;

  const st = useEditor.getState();
  const overview: Pose = (({ tiltX, tiltY, zoom, panX, panY }) => ({ tiltX, tiltY, zoom, panX, panY }))(
    st.evaluated().camera,
  );

  // 1) Convert regions to screen-local coordinates using the camera at drawing time.
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
  const targets = rects
    .map((r) => {
      const cx = (r.x0 + r.x1) / 2;
      const cy = (r.y0 + r.y1) / 2;
      const c = toLocal(cx, cy);
      const t = toLocal(cx, Math.min(r.y0, r.y1));
      const b = toLocal(cx, Math.max(r.y0, r.y1));
      const l = toLocal(Math.min(r.x0, r.x1), cy);
      const rr = toLocal(Math.max(r.x0, r.x1), cy);
      if (!c || !t || !b || !l || !rr) return null;
      return { c, h: Math.max(0.05, t.distanceTo(b)), w: Math.max(0.05, l.distanceTo(rr)) };
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  if (!targets.length) return 0;

  // 2) Prepare the solver: remove camera tracks and preset motion so
  // the evaluated camera cannot override the base; disable recording.
  const prevRecording = st.recording;
  useEditor.setState((s) => ({
    recording: false,
    playing: false,
    shots: s.shots.map((x) =>
      x.id === s.activeShotId
        ? { ...x, motionId: null, tracks: x.tracks.filter((tr) => !tr.path.startsWith('camera.')) }
        : x,
    ),
  }));

  const project = (v: THREE.Vector3) => {
    camera.updateMatrixWorld();
    screen.updateWorldMatrix(true, false);
    return screen.localToWorld(v.clone()).project(camera);
  };

  const poses: Pose[] = [];
  for (let i = 0; i < targets.length; i++) {
    const tg = targets[i];
    const [tx, ty] = ANGLES[(i + seed) % ANGLES.length];
    const jitter = seed ? ((seed * 7 + i * 13) % 9) - 4 : 0;
    const pose: Pose = { tiltX: tx, tiltY: ty + jitter, zoom: Math.max(overview.zoom, 3.2), panX: 0, panY: 0 };
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
      // Make the region fill ~50% of the frame (NDC 1.0 = half the frame).
      const fit = Math.max(hN / 1.0, wN / 1.15, 0.05);
      // Cap at 8: tiny regions otherwise hit 10 and magnify pixels excessively.
      pose.zoom = Math.min(8, clamp('zoom', pose.zoom / Math.min(1.8, Math.max(0.55, fit))));
      // Pan: NDC displacement ≈ −pan/3 (rig: px = pan/6 · visible half-width ×2).
      pose.panX = clamp('panX', pose.panX + pc.x * 3 * 0.85);
      pose.panY = clamp('panY', pose.panY + pc.y * 3 * 0.85);
      if (Math.abs(pc.x) < 0.02 && Math.abs(pc.y) < 0.02 && Math.abs(fit - 1) < 0.06) break;
    }
    poses.push({ ...pose });
  }

  // 3) Keyframes: overview → reach each region (quint) + brief hold.
  const D = st.active().duration;
  const k = poses.length;
  const lead = D * 0.08;
  const hold = Math.min(0.7, D * 0.1);
  const travel = Math.max(0.35, (D - lead - k * hold) / k);
  const keys: { t: number; pose: Pose; easing: EasingId }[] = [
    { t: 0, pose: overview, easing: 'easeInOut' },
    { t: lead, pose: overview, easing: 'quint' },
  ];
  // Ruler marks: reaching each region and the end of its hold (see Shot.focusMarks).
  const focusMarks: { t: number; end: number }[] = [];
  let t = lead;
  poses.forEach((p, i) => {
    t += travel;
    const arrive = +Math.min(D, t).toFixed(3);
    keys.push({ t: Math.min(D, t), pose: p, easing: 'quint' });
    if (i < poses.length - 1) {
      t += hold;
      keys.push({ t: Math.min(D, t), pose: p, easing: 'quint' });
    }
    focusMarks.push({ t: arrive, end: i < poses.length - 1 ? +Math.min(D, t).toFixed(3) : arrive });
  });
  const last = keys[keys.length - 1];
  if (last.t < D - 0.01) keys.push({ t: D, pose: last.pose, easing: 'easeInOut' });

  const fields: (keyof Pose)[] = ['tiltX', 'tiltY', 'zoom', 'panX', 'panY'];
  const tracks: PropertyTrack[] = fields.map((f) => ({
    path: `camera.${f}`,
    keyframes: keys.map((kk) => ({
      id: nextKeyframeId(),
      t: +kk.t.toFixed(3),
      value: +kk.pose[f].toFixed(3),
      easingIn: kk.easing,
      easingOut: kk.easing,
    })),
  }));

  useEditor.setState((s) => ({
    recording: prevRecording,
    shots: s.shots.map((x) =>
      x.id === s.activeShotId
        ? { ...x, camera: { ...x.camera, ...overview, roll: 0 }, tracks: [...x.tracks, ...tracks], focusMarks }
        : x,
    ),
  }));
  return poses.length;
}
