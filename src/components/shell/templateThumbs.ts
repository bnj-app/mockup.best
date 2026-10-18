'use client';

import { applyTemplateTo, evaluateShot, useEditor, type Shot } from '@/store/editor';
import type { TemplatePatch } from '@/config/templates';
import { captureFrame, getSceneRefs } from '@/components/scene/exportBridge';
import { waitForModels } from '@/components/scene/deviceModels';
import { hdriSettled } from '@/components/scene/environment';

/**
 * TEMPLATE CARDS WITH THE USER'S OWN SCREEN. When the templates menu opens and the active scene
 * has media, render each template sequentially in the same 3D scene and capture a thumbnail.
 * Keep project state intact: write the template to the temporary `previewShot` field, read only
 * by the 3D scene (see Stage), rather than applying it to `shots`. Panels, timeline, undo history
 * and autosave remain unaffected. A frozen frame from before preview (`previewCover`) covers the
 * scene. Cancel synchronously when the menu closes or a template is clicked: clear temporary
 * fields and discard any unfinished capture.
 * Show each template's FRAMING: freeze tracks at t=0 and disable the motion preset. Cache per
 * media/template pair; release old object URLs when media changes.
 */

const cache = new Map<string, string>();
/** Increment on every start/cancel so an older run detects that it is obsolete and stops. */
let token = 0;
let restore: { playing: boolean } | null = null;
let renders = 0;

const mediaKey = (shot: Shot) => `${shot.mediaKind}|${shot.media}|`;
const thumbKey = (shot: Shot, id: string) => mediaKey(shot) + id;

/** Cached thumbnail, or null. Cards use this when the menu opens. */
export function cachedThumb(shot: Shot, id: string): string | null {
  return shot.media ? (cache.get(thumbKey(shot, id)) ?? null) : null;
}

/** Diagnostics/test: total thumbnails rendered so far. */
export function thumbRenderCount() {
  return renders;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/** Wait for the template's assets (GLB device, HDRI environment) to load, then three frames for scene setup. */
async function settle(shot: Shot, my: number) {
  await waitForModels([shot.deviceId, ...shot.extras.map((e) => e.deviceId)]);
  for (let i = 0; i < 240 && !hdriSettled(shot.scene.envId); i++) {
    if (my !== token) return;
    await frame();
  }
  for (let i = 0; i < 3; i++) await frame();
}

function finish() {
  const r = restore;
  restore = null;
  useEditor.setState({ previewShot: null, previewCover: null, ...(r ? { playing: r.playing } : null) });
}

/** Menu closed / template clicked: immediately restore the real scene. */
export function cancelTemplateThumbs() {
  token += 1;
  if (restore || useEditor.getState().previewShot) finish();
}

/**
 * Generate missing thumbnails sequentially. Call `onThumb` as each becomes ready so its card can
 * update. Do nothing if the active scene has no media.
 */
export async function renderTemplateThumbs(
  items: { id: string; apply: TemplatePatch }[],
  onThumb: (id: string, url: string) => void,
): Promise<void> {
  const st = useEditor.getState();
  const base = st.active();
  if (!base.media || st.exporting) return;
  // Thumbnails for other media or removed items (deleted user templates)
  // will no longer appear: release them. `items` is always the FULL list (mine + TEMPLATES).
  const keep = new Set(items.map((it) => thumbKey(base, it.id)));
  for (const [k, url] of cache) {
    if (!keep.has(k)) {
      URL.revokeObjectURL(url);
      cache.delete(k);
    }
  }
  const todo = items.filter((it) => !cache.has(thumbKey(base, it.id)));
  const refs = getSceneRefs();
  if (!todo.length || !refs) return;
  cancelTemplateThumbs();
  const my = token;
  let cover: string | null = null;
  try {
    // preserveDrawingBuffer is enabled: the canvas holds the currently displayed frame.
    cover = refs.gl.domElement.toDataURL('image/jpeg', 0.9);
  } catch {
    cover = null;
  }
  restore = { playing: st.playing };
  useEditor.setState({ previewCover: cover, playing: false });
  // Use the PREVIEW CANVAS aspect ratio, which determines framing; the card displays a cropped thumbnail.
  const el = refs.gl.domElement;
  const W = 320;
  const H = Math.max(120, Math.min(640, Math.round((W * el.height) / Math.max(1, el.width))));
  try {
    for (const it of todo) {
      if (my !== token) return;
      const shot: Shot = { ...evaluateShot(applyTemplateTo(base, it.apply), 0), tracks: [], motionId: null };
      useEditor.setState({ previewShot: shot });
      await settle(shot, my);
      if (my !== token) return;
      const blob = await captureFrame({ width: W, height: H, mime: 'image/jpeg', quality: 0.82 });
      if (my !== token) return;
      renders += 1;
      const url = URL.createObjectURL(blob);
      cache.set(thumbKey(base, it.id), url);
      onThumb(it.id, url);
    }
  } catch {
    // If capture fails, keep the prebuilt videos so the menu still works.
  } finally {
    if (my === token) finish();
  }
}
