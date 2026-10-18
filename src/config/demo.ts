import { makeShot, nextShotId, type Shot } from '@/store/editor';
import { nextKeyframeId, type EasingId, type PropertyTrack } from '@/config/tracks';

/**
 * Why the demo camera uses `tracks` rather than `keyframes`:
 * Only `shot.tracks` drives the camera at runtime (the Stage rig). The legacy `{t, camera}` list
 * is converted by `tracksFromLegacy` in `migrateShot`, which runs only during imports, share-link
 * loading and autosave restoration. `loadDemoProject` writes shots directly, bypassing migration:
 * all demo cameras were static on the FIRST VISIT but moved after a reload through autosave.
 * Generate tracks here to fix this and enable per-keyframe curve control for sharp punch-ins.
 */
/**
 * PAN CALCULATION: use measurements to determine framing.
 * The rig (Stage.tsx) computes `py = (panY / 6) * viewH`, then calls `camera.translateY(py)`.
 * Positive panY moves the CAMERA up and the subject DOWN in the frame.
 * ⚠️ The previous `panY = -6 * f` was incorrect: it mixed frame-relative pan with a target on the
 * SCREEN and omitted `zoom`. As zoom increases, the screen grows beyond the frame, so the same
 * panY covers a smaller screen fraction. The formulas agree only at zoom = 3; at this demo's
 * 4.9–6.6 zoom, targets were consistently missed (2.1× too little pan in the music demo).
 * Measured law (4 zoom values × 7 panY values, median k = -0.49):
 * panY = -2 * f * zoom panX = -2 * f * zoom
 * deepest reachable region: f_max = 1.5 / zoom (because |pan| ≤ 3)
 * f = target offset as a fraction of the SCREEN from its center (down +, right +)
 * Example: the music demo's "120 BPM" card is at 53% vertically, so f = +0.03; at final zoom 6.4,
 * panY = -2 × 0.03 × 6.4 ≈ -0.38.
 * Pan is a FUNCTION of zoom. Each keyframe following the same target must derive pan from its own
 * zoom; zooming with fixed panY drifts away from the target. Targeting is irrelevant in wide
 * shots (zoom < 3), where pan stays 0.
 */
type Key = [t: number, value: number, easing?: EasingId];

function track(path: string, keys: Key[]): PropertyTrack {
  return {
    path,
    keyframes: keys.map(([t, value, easing]) => ({
      id: nextKeyframeId(),
      t,
      value,
      // A segment combines the LEFT keyframe's outgoing and RIGHT keyframe's incoming curve.
      // Using the same curve at both ends gives a pure curve for that segment;
      // both ends of a snap therefore need 'quint'.
      easingIn: easing ?? 'easeInOut',
      easingOut: easing ?? 'easeInOut',
    })),
  };
}

/**
 * OPENING DEMO: the landing experience itself.
 * First-time visitors get an automatically playing, five-scene cinematic project instead of an
 * empty editor.
 * The previous plain/white screens, some with Turkish interfaces, faded into the light gray
 * background. The sequence now uses Wander (travel), Aura (music), Lumen (laptop gallery), a
 * Color Hunt pair with colorful screens, then Forma (product page).
 * Fictional screen interfaces are HTML (`tools/demo-screens/`) to keep small text intact; their
 * photos are in `tools/demo-photos/` (rebuild with `tools/gen-showcase-screens.mjs`). These
 * fictional apps are replaceable showcase content. All scenes share one dark studio image
 * (`/demo/stage.jpg`, drawn by `tools/stage_bg.py`), realistic GLB devices (tools/devices3d),
 * metal finishes and 'photo' studio HDRI lighting. Vivid screens and glass bodies stand out
 * against the dark background.
 * Design decision: keep background, studio and finishes fixed for consistent branding and zero
 * transition cost. Every scene uses the SAME background URL: different URLs would generate a
 * 2048² texture on every cut, causing stutters.
 * After any interaction, this is a normal editable, savable project to build on. New project
 * starts fresh.
 */
const STAGE = { backgroundId: 'noir', bgImage: '/demo/stage.jpg', envId: 'photo' } as const;

export function makeDemoShots(): Shot[] {
  const base = () => makeShot(1);
  const scene = () => ({ ...base().scene, ...STAGE });

  const s1: Shot = {
    ...base(),
    id: nextShotId(),
    label: 'Wander',
    duration: 4,
    media: '/demo/wander.jpg',
    deviceId: 'phone',
    finishId: 'titanium',
    camera: { ...base().camera, tiltX: -2, tiltY: 3, zoom: 7.2, handheld: 0.08 },
    motionId: null,
    /*
      OPENING: PULL BACK AND REVEAL. First show the content: a misty fjord bend fills the frame.
      Then gently pull back to reveal the glass phone. A hard opening hit would weaken the impact
      of later dives in the reel.
    */
    tracks: [
      track('camera.zoom', [[0, 7.2], [0.5, 7.0], [4, 2.55]]),
      track('camera.tiltY', [[0, 3], [0.5, 5], [4, 30]]),
      track('camera.tiltX', [[0, -2], [4, -12]]),
    ],
    scene: scene(),
    texts: [],
  };

  const s2: Shot = {
    ...base(),
    id: nextShotId(),
    label: 'Aura',
    duration: 4,
    media: '/demo/aura.jpg',
    deviceId: 'phone',
    finishId: 'black',
    camera: { ...base().camera, tiltX: -6, tiltY: -26, zoom: 2.5, handheld: 0.1 },
    motionId: null,
    /*
      TARGET: album cover and track title ("Neon Tides").
      The cover spans 140–519 px and the title 545–610 px on a 979 px screen. Their midpoint is
      ~375 px, so f = 375/979 − 0.5 ≈ −0.12. At zoom 4.6, panY = −2 × (−0.12) × 4.6 ≈ +1.1. About
      63% of the screen remains visible, fitting both. Reverse the tilt (−26) because the previous
      scene turned from the right; avoid cutting to the same angle.
    */
    tracks: [
      track('camera.zoom', [[0, 2.5], [1.3, 2.55, 'quint'], [1.75, 4.6, 'quint'], [4, 4.75]]),
      track('camera.tiltY', [[0, -26], [1.3, -24, 'quint'], [1.75, -8, 'quint'], [4, -5]]),
      track('camera.tiltX', [[0, -6], [1.75, -2, 'quint'], [4, -1]]),
      track('camera.panY', [[0, 0], [1.3, 0, 'quint'], [1.75, 1.1, 'quint'], [4, 1.14]]),
    ],
    transition: { kind: 'cut', duration: 0.4 },
    scene: scene(),
    statusBar: { on: false, time: '9:41', dark: true, battery: 0.82 },
  };

  const s3: Shot = {
    ...base(),
    id: nextShotId(),
    label: 'Lumen',
    duration: 4,
    media: '/demo/lumen.jpg',
    deviceId: 'laptop',
    finishId: 'silver',
    camera: { ...base().camera, tiltX: -16, tiltY: 34, zoom: 2.3, handheld: 0.08 },
    motionId: null,
    /*
      LAPTOP: show support beyond phones. Dive into the gallery grid without pan: the measured pan
      law covers phones, not laptops, and the grid is already centered. Use a lower zoom ceiling
      than for phones; the wide screen fills the frame with photos at 4.4.
    */
    tracks: [
      track('camera.zoom', [[0, 2.3], [1.4, 2.35, 'quint'], [1.85, 4.3, 'quint'], [4, 4.45]]),
      track('camera.tiltY', [[0, 34], [1.4, 30, 'quint'], [1.85, 10, 'quint'], [4, 6]]),
      track('camera.tiltX', [[0, -16], [1.85, -8, 'quint'], [4, -6]]),
    ],
    transition: { kind: 'cut', duration: 0.4 },
    scene: scene(),
  };

  const s4: Shot = {
    ...base(),
    id: nextShotId(),
    label: 'Color Hunt',
    duration: 4,
    media: '/demo/colorhunt-home.jpg',
    deviceId: 'phone',
    finishId: 'silver',
    camera: { ...base().camera, tiltX: -6, tiltY: 14, zoom: 4.8, panY: 2.88, handheld: 0.1 },
    motionId: null,
    /*
      Show a real app alongside the fictional demos.
      START ON THE FEATURE: the daily color card ("Shallow Tide") is ~20% down the screen, so f =
      −0.30. At zoom 4.8, f_max = 1.5/4.8 = 0.31, just within reach; panY = −2 × (−0.30) × 4.8 =
      +2.88.
      Then pull back to reveal the second phone (palette screen): the opening reveals a device,
      while this shot reveals the layout. Reset pan too, or both devices would remain below the
      frame.
    */
    tracks: [
      track('camera.zoom', [[0, 4.8], [0.9, 4.85, 'quint'], [1.35, 2.5, 'quint'], [4, 2.4]]),
      track('camera.panY', [[0, 2.88], [0.9, 2.9, 'quint'], [1.35, 0.05, 'quint'], [4, 0]]),
      track('camera.tiltY', [[0, 14], [0.9, 14, 'quint'], [1.35, 6, 'quint'], [4, 12]]),
      track('camera.tiltX', [[0, -6], [4, -15]]),
    ],
    transition: { kind: 'cut', duration: 0.4 },
    scene: scene(),
    layoutId: 'pair',
    mainSlot: { x: -0.62, y: 0, z: 0, rotY: 10, scale: 1 },
    extras: [
      {
        id: 'demo-extra-1',
        deviceId: 'phone',
        finishId: 'silver',
        media: '/demo/colorhunt-palette.jpg',
        mediaKind: 'image',
        x: 0.62,
        y: -0.04,
        z: -0.6,
        rotY: -12,
        scale: 0.96,
      },
    ],
  };

  const s5: Shot = {
    ...base(),
    id: nextShotId(),
    label: 'Forma',
    duration: 4,
    media: '/demo/forma.jpg',
    deviceId: 'phone',
    finishId: 'white',
    camera: { ...base().camera, tiltX: -6, tiltY: 20, zoom: 3.1, panY: 0, handheld: 0.12 },
    motionId: null,
    /*
      CLOSING: dive into the product, then PULL BACK.
      Target the shoe and name/price row: shoe ~33%, "Drift Runner 2 · $129" ~62%, midpoint ~45%,
      so f = −0.05, nearly centered. At zoom 5.0, ~58% of the screen is visible, fitting both;
      panY = −2 × (−0.05) × 5.0 = +0.5. Ending wide also supports looping: restarting after 20
      seconds makes a clean cut to the opening close-up.
    */
    tracks: [
      track('camera.zoom', [[0, 3.1], [0.9, 3.15, 'quint'], [1.35, 5.0, 'quint'], [2.6, 5.1], [4, 3.0]]),
      track('camera.panY', [[0, 0], [0.9, 0, 'quint'], [1.35, 0.5, 'quint'], [2.6, 0.51], [4, 0]]),
      track('camera.tiltX', [[0, -6], [1.35, -2, 'quint'], [2.6, -3], [4, -12]]),
      track('camera.tiltY', [[0, 20], [1.35, 8, 'quint'], [2.6, 8], [4, 30]]),
    ],
    transition: { kind: 'cut', duration: 0.4 },
    scene: scene(),
  };

  return [s1, s2, s3, s4, s5];
}
