/**
 * Shared export helpers: the still moment of a scene (store set, launch package) and the video bitrate
 * rule. Used by the export panel and the launch package export (lib/launchExport.ts).
 */

import type { Shot } from '@/store/editor';
import { MOTION_PRESETS, motionProgress, sampleMotion } from '@/config/motion';
import { evaluateTrack } from '@/config/tracks';

/** Scene zoom at local time `t`, with the same priority as Stage's frame loop:
    camera tracks if present, otherwise the motion preset (applied during export). */
export function zoomAt(shot: Shot, t: number): number {
  if (shot.tracks.some((t) => t.path.startsWith('camera.'))) {
    const tr = shot.tracks.find((x) => x.path === 'camera.zoom');
    return (tr ? evaluateTrack(tr, t) : undefined) ?? shot.camera.zoom;
  }
  const m = MOTION_PRESETS.find((x) => x.id === shot.motionId);
  return (m ? sampleMotion(m, motionProgress(shot, t)).zoom : undefined) ?? shot.camera.zoom;
}

/**
 * Still-frame time in scene-local seconds for each scene in a store set.
 *
 * 1. Clean interval: fade/slide transitions darken the frame for half their
 *    duration at each end; animated text also enters and exits there.
 *    Exclude these regions with a one-frame margin.
 * 2. Choose the widest framing (lowest zoom), breaking ties toward the end.
 *    Always taking the last frame cropped laptop edges in zoom-in scenes
 *    such as Aura/Lumen. Only zoom controls device size in the frame
 *    (FOV is balanced by distance), so lower zoom keeps the device whole.
 *    Constant-zoom motions (Fold up, orbit) use their settled final pose.
 */
export function stillMoment(shot: Shot): number {
  const tr = shot.transition;
  const half = tr && tr.kind !== 'cut' && tr.duration > 0 ? tr.duration / 2 : 0;
  let head = half;
  let tail = half;
  for (const t of shot.texts ?? []) {
    if (!t.visible) continue;
    const d = t.transitionDur ?? 0.4;
    if (t.enter !== 'none' && (t.start ?? 0) <= 0) head = Math.max(head, d);
    if (t.exit !== 'none' && t.end == null) tail = Math.max(tail, d);
  }
  const end = Math.max(0, shot.duration - tail - 1 / 30);
  const start = Math.min(end, head + 1 / 30);
  let best = end;
  let bestZoom = zoomAt(shot, end);
  const N = 24;
  // Search backward: replace only with clearly wider framing; ties keep the later time.
  for (let i = N - 1; i >= 0; i -= 1) {
    const t = start + ((end - start) * i) / N;
    const z = zoomAt(shot, t);
    if (z < bestZoom - 0.02) {
      best = t;
      bestZoom = z;
    }
  }
  return best;
}

/** Bits per second from bits per pixel, clamped to 4–100 Mbps. */
export function bitrateFor(bpp: number, w: number, h: number, fps: number): number {
  return Math.round(Math.min(100_000_000, Math.max(4_000_000, bpp * w * h * fps)));
}
