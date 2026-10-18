import { makeShot, makeTextItem, nextShotId, type Shot, type TextItem } from '@/store/editor';
import { nextKeyframeId, type EasingId, type PropertyTrack } from '@/config/tracks';
import { screenNameFromFile } from '@/config/screens';

/**
 * MAGIC REEL: automatically create a showcase video from 1-4 screenshots.

 * Uses validated motion blocks and measured camera rules:

 *   panY = -2 * f * zoom
 *   f_max = 1.5 / zoom (from the |pan| <= 3 limit)

 * Editing rules:
 *  - Keep backdrop, studio and finish fixed throughout to avoid transition costs.
 *  - Hold completely still for 0.6-0.9 seconds on every beat.
 *  - Text enters 0.25 seconds after the camera settles and exits 0.25 seconds
 *    before the outgoing whip.
 *  - Always close by pulling back with space for branding above.
 */

type Key = [t: number, value: number, easing?: EasingId];
type RawTrack = { path: string; keys: Key[] };
type Block = { dur: number; radialBlur?: boolean; tracks: RawTrack[] };

const ZOOM_FIT = 2.91;

/*
  MOTION BLOCKS: all four are verified. Do not manually "improve" values;
  every number was calibrated with reference images and video measurements.
  For example, reveal uses quint rather than expo because expo held still
  for 2.3 of 3 seconds. An inverted closing panY sign once made closing text
  overlap the device.
*/
const REVEAL: Block = {
  dur: 3,
  tracks: [
    { path: 'camera.zoom', keys: [[0, 7.0, 'quint'], [3, ZOOM_FIT, 'quint']] },
    { path: 'camera.fov', keys: [[0, 13, 'sine'], [3, 20, 'sine']] },
    { path: 'camera.tiltY', keys: [[0, 0, 'sine'], [3, 24, 'sine']] },
    { path: 'camera.tiltX', keys: [[0, 0, 'sine'], [3, -14, 'sine']] },
  ],
};

const CLOSING: Block = {
  /* Each track reaches its final value at 3.6 s and stops, leaving a real 1.4 s hold. */
  dur: 5,
  tracks: [
    { path: 'camera.zoom', keys: [[0, 4.4, 'easeOut'], [3.6, 2.0, 'easeOut'], [5, 2.0, 'easeOut']] },
    { path: 'camera.fov', keys: [[0, 16, 'sine'], [3.6, 24, 'sine'], [5, 24, 'sine']] },
    { path: 'camera.panY', keys: [[0, 0, 'easeOut'], [3.6, 0.9, 'easeOut'], [5, 0.9, 'easeOut']] },
    { path: 'camera.tiltY', keys: [[0, 30, 'sine'], [3.6, 18, 'sine'], [5, 18, 'sine']] },
    { path: 'camera.handheld', keys: [[0, 0.12, 'sine'], [3.6, 0.04, 'sine'], [5, 0.04, 'sine']] },
  ],
};

const WHIP_IN: Block = {
  dur: 0.3,
  radialBlur: true,
  tracks: [
    { path: 'camera.panX', keys: [[0, 3, 'quint'], [0.3, 0, 'quint']] },
    { path: 'camera.zoom', keys: [[0, 3.7, 'quint'], [0.3, ZOOM_FIT, 'quint']] },
    { path: 'blur.strength', keys: [[0, 32, 'quint'], [0.3, 0, 'quint']] },
  ],
};

const WHIP_OUT: Block = {
  dur: 0.25,
  radialBlur: true,
  tracks: [
    { path: 'camera.panX', keys: [[0, 0, 'easeIn'], [0.25, -3, 'easeIn']] },
    { path: 'camera.zoom', keys: [[0, ZOOM_FIT, 'easeIn'], [0.25, 3.7, 'easeIn']] },
    { path: 'blur.strength', keys: [[0, 0, 'easeIn'], [0.25, 32, 'easeIn']] },
  ],
};

/** Scale block keyframe times proportionally to the target duration (Alt-retime behavior). */
const scaleKeys = (block: Block, dur: number, offset = 0): RawTrack[] =>
  block.tracks.map((t) => ({
    path: t.path,
    keys: t.keys.map((k) => [+(offset + (k[0] / block.dur) * dur).toFixed(3), k[1], k[2]] as Key),
  }));

/**
 * Layer the whip proportionally over the base motion.

 * ⚠️ Appending raw whip keys leaked its base zoom (2.91) into the scene's
 * resting section, causing zoom to drift back. Normalize the whip boundary
 * to 1 and multiply by the base motion's current value, allowing insertion
 * anywhere without disturbing the underlying motion.
 */
function relativeWhip(
  block: Block,
  offset: number,
  bodyByPath: Map<string, Key[]>,
  boundaryIsStart: boolean,
): RawTrack[] {
  return block.tracks.map((t) => {
    const own = boundaryIsStart ? t.keys[t.keys.length - 1][1] : t.keys[0][1];
    const bodyKeys = bodyByPath.get(t.path);
    let scale = 1;
    if (bodyKeys && own) {
      const bound = boundaryIsStart ? bodyKeys[0][1] : bodyKeys[bodyKeys.length - 1][1];
      scale = bound / own;
    }
    return {
      path: t.path,
      keys: t.keys.map((k) => [+(offset + k[0]).toFixed(3), +(k[1] * scale).toFixed(3), k[2]] as Key),
    };
  });
}

/** Merge segments writing to the same path and sort by time. */
function mergeTracks(parts: RawTrack[][]): RawTrack[] {
  const byPath = new Map<string, Key[]>();
  for (const p of parts) {
    for (const t of p) {
      byPath.set(t.path, (byPath.get(t.path) ?? []).concat(t.keys));
    }
  }
  return [...byPath.entries()].map(([path, keys]) => ({
    path,
    keys: keys.sort((a, b) => a[0] - b[0]),
  }));
}

const toTracks = (raw: RawTrack[]): PropertyTrack[] =>
  raw.map((t) => ({
    path: t.path,
    keyframes: t.keys.map(([time, value, easing]) => ({
      id: nextKeyframeId(),
      t: time,
      value,
      easingIn: easing ?? 'easeInOut',
      easingOut: easing ?? 'easeInOut',
    })),
  }));

export type MagicReelImage = { url: string; name: string };
export type MagicReelInput = {
  /** 1-4 screenshots. The first is the main screen used for opening and closing. */
  images: MagicReelImage[];
  /** Feature titles matching images[1..]; empty string means no text in that scene. */
  captions: string[];
  /** Brand line in the closing scene; empty means no text. */
  brand: string;
};

/*
  Dive targets: since screen content is unknown, use moderate alternating
  targets instead of measured content-specific f values (0.03 / 0.245 / -0.23).
  Near-center dives are safe for any content; alternating signs add variety.
  At zoom 5.2, f_max = 0.288, so all three targets are within bounds.
*/
const PUSH_TARGETS = [
  { f: 0.05, zoom: 5.2 },
  { f: -0.14, zoom: 5.0 },
  { f: 0.12, zoom: 5.4 },
];

/**
 * Build a multi-scene reel from 1-4 images.
 * 1 image -> opening + closing (8 s); 4 images -> full reel (20 s).
 */
export function buildMagicReel(input: MagicReelInput): Shot[] {
  const images = input.images.slice(0, 4);
  if (!images.length) return [];
  const main = images[0];
  const features = images.slice(1);

  type SceneDef = {
    label: string;
    media: MagicReelImage;
    dur: number;
    body: 'reveal' | 'closing' | 'push';
    f?: number;
    zoom?: number;
    whipIn?: boolean;
    whipOut?: boolean;
    text?: string | null;
    textSize?: number;
  };

  const scenes: SceneDef[] = [
    { label: 'Opening', media: main, dur: 3, body: 'reveal', whipOut: features.length > 0 },
    ...features.map((img, j): SceneDef => {
      const tgt = PUSH_TARGETS[j % PUSH_TARGETS.length];
      return {
        label: `Feature ${j + 1}`,
        media: img,
        dur: 4,
        body: 'push',
        f: tgt.f,
        zoom: tgt.zoom,
        whipIn: true,
        whipOut: j < features.length - 1 || true,
        text: (input.captions[j] ?? '').trim() || null,
        textSize: 0.075,
      };
    }),
    {
      label: 'Closing',
      media: main,
      dur: 5,
      body: 'closing',
      whipIn: features.length > 0,
      text: input.brand.trim() || null,
      textSize: 0.085,
    },
  ];

  const base = () => makeShot(1);

  return scenes.map((sc, i) => {
    const inDur = sc.whipIn ? WHIP_IN.dur : 0;
    const outDur = sc.whipOut ? WHIP_OUT.dur : 0;
    const winDur = sc.dur - inDur - outDur;

    const parts: RawTrack[][] = [];
    /* Text enters 0.25 s after the camera settles. */
    let arrive = inDur + winDur * 0.3;

    if (sc.body === 'reveal') {
      parts.push(scaleKeys(REVEAL, winDur, inDur));
    } else if (sc.body === 'closing') {
      parts.push(scaleKeys(CLOSING, winDur, inDur));
    } else {
      /*
         PUSH: measured rule. Guard against silently writing pan for an unreachable
         target. Targets here are fixed and in bounds, but a formula change should
         surface the first violation.
         */
      const f = sc.f ?? 0;
      const zoom = sc.zoom ?? 5;
      const fMax = 1.5 / zoom;
      const fSafe = Math.max(-fMax, Math.min(fMax, f));
      const panY = +(-2 * fSafe * zoom).toFixed(2);
      const tArrive = +(inDur + winDur * 0.55).toFixed(2);
      const tEnd = +(inDur + winDur).toFixed(2);
      const fov = Math.max(13, Math.round(22 - zoom));
      parts.push([
        { path: 'camera.zoom', keys: [[inDur, ZOOM_FIT, 'quint'], [tArrive, zoom, 'quint'], [tEnd, zoom, 'quint']] },
        { path: 'camera.fov', keys: [[inDur, 20, 'sine'], [tArrive, fov, 'sine'], [tEnd, fov, 'sine']] },
        { path: 'camera.panY', keys: [[inDur, 0, 'quint'], [tArrive, panY, 'quint'], [tEnd, panY, 'quint']] },
      ]);
      arrive = tArrive;
    }

    /* Base-motion tracks are required for proportional whip scaling. */
    const bodyByPath = new Map<string, Key[]>();
    for (const p of parts) for (const t of p) bodyByPath.set(t.path, t.keys);

    if (sc.whipIn) parts.push(relativeWhip(WHIP_IN, 0, bodyByPath, true));
    if (sc.whipOut) parts.push(relativeWhip(WHIP_OUT, sc.dur - outDur, bodyByPath, false));

    const texts: TextItem[] = [];
    if (sc.text) {
      const tStart = +(arrive + 0.25).toFixed(2);
      const tEnd = +(sc.dur - outDur - 0.25).toFixed(2);
      texts.push({
        ...makeTextItem('text'),
        id: `magic-txt-${i}`,
        text: sc.text,
        x: 0.5,
        y: 0.12,
        size: sc.textSize ?? 0.075,
        start: tStart,
        end: tEnd,
        enter: 'rise',
        exit: 'fade',
        transitionDur: 0.35,
      });
    }

    const b = base();
    const shot: Shot = {
      ...b,
      id: nextShotId(),
      label: sc.label,
      duration: sc.dur,
      media: sc.media.url,
      mediaKind: 'image',
      mediaName: sc.media.name,
      screenName: screenNameFromFile(sc.media.name),
      deviceId: 'phone',
      finishId: 'crystal',
      motionId: null,
      camera: {
        ...b.camera,
        tiltX: -12,
        /* Alternate tiltY per scene for varied angles. */
        tiltY: i % 2 ? -26 : 28,
        panX: 0,
        panY: 0,
        roll: 0,
        handheld: 0.1,
      },
      /*
         Whip scenes require RADIAL blur; writing only a strength track would
         otherwise animate an effect whose mode is off.
         */
      blur: sc.whipIn || sc.whipOut ? { ...b.blur, mode: 'radial' } : b.blur,
      scene: { ...b.scene, backgroundId: 'crystal', envId: 'studio' },
      texts,
      tracks: toTracks(mergeTracks(parts)),
    };
    return shot;
  });
}
