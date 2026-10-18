'use client';

import { useState, useSyncExternalStore } from 'react';
import { Badge, Segmented, Select, Toggle } from '@/components/panel/Controls';
import { shotStart, totalDuration, useEditor, type Shot } from '@/store/editor';
import { getAspect } from '@/config/aspects';
import { SIZES, type SizeOption } from '@/config/exportSizes';
import { BRAND, FREE_CAPTURES } from '@/config/brand';
import { track } from '@/lib/analytics';
import { buildZip, type ZipEntry } from '@/lib/zip';
import { buildPalette, createGifWriter } from '@/lib/gif';
import { playBlip, playDone } from '@/components/shell/sounds';
import { toast } from '@/components/shell/Toast';
import { MOTION_PRESETS, sampleMotion } from '@/config/motion';
import { evaluateTrack } from '@/config/tracks';
import { renderAudioMix } from '@/components/scene/audioBridge';
import {
  canUseWebCodecs,
  captureFrame,
  downloadBlob,
  pickVideoMime,
  recordCanvas,
  recordFrames,
  renderSequence,
  settleAt,
  videoSupersampleFactor,
} from '@/components/scene/exportBridge';

type Orientation = 'landscape' | 'square' | 'portrait';



/*
  App Store preview limits (developer.apple.com → App preview
  specifications): up to 30 fps, 15–30 s, H.264 up to High Profile Level 4.0,
  target 10–12 Mbps, stereo 256 kbps AAC at 44.1/48 kHz. The 12 Mbps cap
  keeps all preview sizes within level 4.0 (verified by the test).
*/
const PREVIEW_FPS = 30;
const PREVIEW_MAX_BPS = 12_000_000;
const PREVIEW_AUDIO_BPS = 256_000;
const PREVIEW_MIN_SEC = 15;
const PREVIEW_MAX_SEC = 30;

/**
 * Silent stereo audio track. App Store Connect rejects previews without
 * audio as "unsupported or corrupted audio" (developer forums; Apple's
 * page does not state this explicitly). A silent track passes upload.
 */
function silentTrack(seconds: number): AudioBuffer | null {
  if (typeof AudioBuffer === 'undefined' || seconds <= 0) return null;
  return new AudioBuffer({ numberOfChannels: 2, sampleRate: 48000, length: Math.ceil(seconds * 48000) });
}

/** Scene zoom at local time `t`, with the same priority as Stage's frame loop:
    camera tracks if present, otherwise the motion preset (applied during export). */
function zoomAt(shot: Shot, t: number): number {
  if (shot.tracks.some((t) => t.path.startsWith('camera.'))) {
    const tr = shot.tracks.find((x) => x.path === 'camera.zoom');
    return (tr ? evaluateTrack(tr, t) : undefined) ?? shot.camera.zoom;
  }
  const m = MOTION_PRESETS.find((x) => x.id === shot.motionId);
  return (m ? sampleMotion(m, t / Math.max(0.001, shot.duration)).zoom : undefined) ?? shot.camera.zoom;
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
function stillMoment(shot: Shot): number {
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

/** Video bitrates, presented as quality levels in the panel. */
/*
  Quality scales with pixels rather than using fixed Mbps.
  Previously all resolutions and frame rates shared a bitrate: 22 Mbps is
  generous at 1080p30 but gives 8× fewer bits per pixel at 4K60, making the
  most expensive setting look worst. Use `bpp × width × height × fps`:
  close to the old values at 1080p30, scaling up for larger output.
  Cap at 100 Mbps; higher rates increase file size without visible benefit.
*/
/*
  One-click multi-aspect export: package the same project at 16:9 (YouTube/web),
  9:16 (Reels/TikTok/Shorts), 1:1 and 4:5 (feeds) in one ZIP. Camera distance
  fits width to horizontal FOV and height to vertical FOV independently,
  keeping the whole device in frame. The selected Size sets the short edge
  (1080p → 1080).
*/
const RATIOS = [
  { id: '16x9', rw: 16, rh: 9 },
  { id: '9x16', rw: 9, rh: 16 },
  { id: '1x1', rw: 1, rh: 1 },
  { id: '4x5', rw: 4, rh: 5 },
] as const;
const ratioSize = (r: (typeof RATIOS)[number], short: number) => {
  const even = (n: number) => Math.round(n / 2) * 2;
  return r.rw >= r.rh ? { w: even((short * r.rw) / r.rh), h: short } : { w: short, h: even((short * r.rh) / r.rw) };
};

/*
  Export estimates: size comes from bitrate × duration. Time uses the last
  measured export speed on this device (ms per megapixel-frame, per format
  and quality, with a 50/50 moving average). Hide time until measured.
  localStorage is a convenience; omit estimates silently if it is unavailable.
*/
const SPEED_KEY = 'mockuptop:export-speed:v1';
type SpeedKey = 'mp4-high' | 'mp4-medium' | 'mp4-low' | 'gif' | 'png-seq';
function readSpeeds(): Partial<Record<SpeedKey, number>> {
  try {
    return JSON.parse(window.localStorage.getItem(SPEED_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}
function recordSpeed(key: SpeedKey, ms: number, frames: number, w: number, h: number) {
  try {
    const v = ms / Math.max(1, frames * ((w * h) / 1_000_000));
    const all = readSpeeds();
    const prev = all[key];
    all[key] = prev ? prev * 0.5 + v * 0.5 : v;
    window.localStorage.setItem(SPEED_KEY, JSON.stringify(all));
  } catch {
    // No storage means no estimate; export is unaffected.
  }
}
/** Time export and save its speed at module scope; reading the clock inside the component violates React Compiler purity. */
async function timed<T>(key: SpeedKey, frames: number, w: number, h: number, run: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const out = await run();
  recordSpeed(key, performance.now() - t0, frames, w, h);
  return out;
}
const fmtSec = (sec: number) => (sec < 90 ? `~${Math.max(1, Math.round(sec))} s` : `~${Math.round(sec / 60)} min`);

/*
  AVIF gives the smallest web files. Unsupported `toBlob('image/avif')`
  silently returns PNG, so probe once with a 2×2 canvas and show the option
  only when supported. Store the result at module scope with
  useSyncExternalStore, avoiding setState inside an effect.
*/
let avifSupport: boolean | null = null;
const avifListeners = new Set<() => void>();
function subscribeAvif(cb: () => void) {
  avifListeners.add(cb);
  if (avifSupport === null && typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = 2;
    c.height = 2;
    c.toBlob((b) => {
      avifSupport = b?.type === 'image/avif';
      avifListeners.forEach((l) => l());
    }, 'image/avif');
  }
  return () => {
    avifListeners.delete(cb);
  };
}

const QUALITIES = [
  { id: 'high', label: 'High', bpp: 0.3 },
  { id: 'medium', label: 'Medium', bpp: 0.17 },
  { id: 'low', label: 'Low', bpp: 0.09 },
] as const;

function bitrateFor(bpp: number, w: number, h: number, fps: number): number {
  return Math.round(Math.min(100_000_000, Math.max(4_000_000, bpp * w * h * fps)));
}

/** Rotate the selected dimensions to match the orientation. */
function resolve(size: { w: number; h: number }, orientation: Orientation) {
  const long = Math.max(size.w, size.h);
  const short = Math.min(size.w, size.h);
  if (orientation === 'square') return { w: long, h: long };
  if (orientation === 'portrait') return { w: short, h: long };
  return { w: long, h: short };
}

export function ExportMenu({ onClose }: { onClose: () => void }) {
  const isPro = useEditor((s) => s.isPro);
  const consumeCapture = useEditor((s) => s.consumeCapture);
  const capturesLeft = useEditor((s) => s.capturesLeft);
  const shot = useEditor((s) => s.active());
  const setPlaying = useEditor((s) => s.setPlaying);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  // Video exports the entire project; reflect that in the panel.
  const shotCount = useEditor((s) => s.shots.length);
  /*
    Localization: additional languages get separate store-set folders and an
    "All languages (ZIP)" option for images and video. `null` is the base language.
  */
  const languages = useEditor((s) => s.languages);
  const baseLang = useEditor((s) => s.baseLang);
  const langPasses: (string | null)[] = languages.length ? [null, ...languages] : [null];
  /** Set the preview language and wait for the scene, including text, to render in it. */
  const showLang = (l: string | null) => settleAt(() => useEditor.getState().setPreviewLang(l));
  const audioCount = useEditor((s) => s.audioTracks.length);
  const projectSeconds = useEditor((s) => totalDuration(s.shots));

  /*
    Preserve the canvas aspect ratio during export.
    Previously this panel ignored `aspectId`: a composition framed at 9:16
    downloaded as a landscape 1920×1080 file. Measured output was 1920×1080
    for 12 of 14 ratios, unexpectedly reframing store images.
    When a ratio is selected, prepend and select "Match canvas" as the
    default. Users can still choose another size. `fill` keeps existing
    behavior and tests, since it is the default project aspect.
  */
  const aspectId = useEditor((s) => s.aspectId);
  const aspect = getAspect(aspectId);
  const matchSize = (() => {
    if (aspect.ratio == null) return null;
    if (aspect.px) return { w: aspect.px.w, h: aspect.px.h };
    /* Long edge 1920; derive the short edge from the ratio. H.264 requires even dimensions. */
    const even = (n: number) => Math.max(64, Math.round(n / 2) * 2);
    return aspect.ratio >= 1
      ? { w: 1920, h: even(1920 / aspect.ratio) }
      : { w: even(1920 * aspect.ratio), h: 1920 };
  })();

  const [tab, setTab] = useState<'image' | 'video'>('image');
  const [format, setFormat] = useState<'png' | 'jpg' | 'webp' | 'avif'>('png');
  const avifOk = useSyncExternalStore(subscribeAvif, () => avifSupport === true, () => false);
  // Opened only by a click, never during SSR; reading localStorage on first render is safe.
  const [speeds] = useState(readSpeeds);
  const [orientation, setOrientation] = useState<Orientation>('landscape');
  const [sizeChoice, setSizeChoice] = useState(matchSize ? 'match' : '1080p');
  const [customW, setCustomW] = useState(1920);
  const [customH, setCustomH] = useState(1080);
  const [fps, setFps] = useState<'30' | '60'>('60');
  /*
    Video formats: MP4 (default), GIF, and PNG sequence (ZIP). GIF has
    separate long-edge and fps settings because its centisecond delays
    cannot represent 30/60 fps exactly.
  */
  const [videoFormat, setVideoFormat] = useState<'mp4' | 'gif' | 'png-seq'>('mp4');
  const [gifLong, setGifLong] = useState<'480' | '640' | '800'>('640');
  const [gifFps, setGifFps] = useState<'10' | '20' | '25'>('20');
  const [quality, setQuality] = useState<(typeof QUALITIES)[number]['id']>('high');
  /*
    Motion blur levels: Off / Low / Medium / High.
    Values set AfterimagePass damping: the amount carried into the next frame.
    Applying this at render time avoids slowing down the preview continuously.
  */
  const [motionBlur, setMotionBlur] = useState<'off' | 'low' | 'medium' | 'high'>('off');
  const MOTION_BLUR_AMOUNT = { off: 0, low: 0.35, medium: 0.6, high: 0.8 } as const;
  /*
    Transparent background is also exposed in export, where users look for
    alpha PNG output. Both controls update the same scene state;
    this is a visible shortcut to the scene setting.
  */
  const transparent = useEditor((s) => s.active().scene.transparent);
  const patchShot = useEditor((s) => s.patchShot);
  const sceneOf = useEditor((s) => s.active().scene);
  const [busy, setBusy] = useState(false);
  /** Frame-by-frame export progress (0..1); null for real-time recording. */
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* "Match canvas" is a virtual size prepended when a ratio is selected,
     rather than stored in SIZES. It is `fixed` because the aspect ratio
     already determines orientation. */
  /* Store aspects (as-iphone, gp-phone…) pass their rules to "Match canvas":
     opaque PNG or preview constraints. Tab filters are inherited too,
     so video-only App Store Preview sizes cannot appear in the image tab,
     or image-only Feature graphic sizes in the video tab, through this option. */
  const matchRow = SIZES.find((s) => s.id === aspect.id);
  const SIZE_OPTIONS: SizeOption[] = (matchSize
    ? [
        {
          id: 'match',
          label: `Match canvas · ${aspect.label} — ${matchSize.w}×${matchSize.h}`,
          w: matchSize.w,
          h: matchSize.h,
          fixed: true,
          kind: matchRow?.kind,
          imageOnly: matchRow?.imageOnly,
          videoOnly: matchRow?.videoOnly,
        },
        ...SIZES,
      ]
    : SIZES
  ).filter((s) => (tab === 'image' ? !s.videoOnly : !s.imageOnly));
  /*
    Switching to `fill` while the panel is open removes 'match'; do not
    leave the effective selection on a missing ID.
    An effect calling `setSizeId('1080p')` violated
    react-hooks/set-state-in-effect by adding a render for derived state.
    Derive it during render instead: missing IDs resolve to 1080p while
    preserving `sizeChoice`, so 'match' becomes valid again if the ratio returns.
  */
  const sizeId = SIZE_OPTIONS.some((o) => o.id === sizeChoice) ? sizeChoice : '1080p';
  const preset = SIZE_OPTIONS.find((s) => s.id === sizeId) ?? SIZE_OPTIONS.find((s) => s.id === '1080p') ?? SIZES[1];
  // Custom dimensions ignore orientation because the user supplies both edges.
  const size =
    sizeId === 'custom'
      ? {
          ...preset,
          /*
            Video is capped at 3840. The previous 6000 limit could crash the
            encoder above 4K, leaving users to discover the failure in a corrupt file.
          */
          /*
            Images support 5120; video stays at 3840 because the encoder limit still applies.
          */
          w: Math.min(tab === 'image' ? 5120 : 3840, Math.max(64, Math.round(customW))),
          h: Math.min(tab === 'image' ? 5120 : 3840, Math.max(64, Math.round(customH))),
        }
      : preset;
  /*
    Do not apply orientation to:
    - custom sizes: users specify both edges.
    - fixed App Store presets: stores require exact dimensions and reject
      rotated output. Landscape `resolve()` changed 1290×2796 to 2796×1290,
      a failure only visible at submission.
    Pass the selected dimensions through unchanged in both cases.
  */
  const keepSize = sizeId === 'custom' || !!preset.fixed;
  const outSize = () => (keepSize ? size : resolve(size, orientation));
  const motion = MOTION_PRESETS.find((m) => m.id === shot.motionId);
  const canVideo = pickVideoMime() !== null;

  /*
    Derive store rules from the selected size, without a separate mode.
    Images: opaque output and PNG instead of WEBP (neither store accepts WEBP).
    Video: 30 fps, bitrate cap, MP4 only; transparent WebM is disabled.
  */
  const storeImage = tab === 'image' && size.kind === 'store-image';
  const storeVideo = tab === 'video' && size.kind === 'store-video';
  // Stores reject WEBP/AVIF; also fall back to PNG when AVIF is unsupported.
  const outFormat = (storeImage && (format === 'webp' || format === 'avif')) || (format === 'avif' && !avifOk) ? 'png' : format;
  const imageMime = (f: typeof outFormat) =>
    f === 'png' ? 'image/png' : f === 'webp' ? 'image/webp' : f === 'avif' ? 'image/avif' : 'image/jpeg';
  const outFps = storeVideo ? PREVIEW_FPS : Number(fps);
  // Store previews require MP4, so hide the format selector for those sizes.
  const vFormat = storeVideo ? 'mp4' : videoFormat;
  /** GIF dimensions: selected aspect ratio, long edge `gifLong`, rounded to even pixels. */
  const gifSize = () => {
    const { w, h } = outSize();
    const k = Number(gifLong) / Math.max(w, h);
    return { w: Math.max(2, Math.round((w * k) / 2) * 2), h: Math.max(2, Math.round((h * k) / 2) * 2) };
  };
  const seqFrames = Math.max(1, Math.round(projectSeconds * (vFormat === 'gif' ? Number(gifFps) : outFps)));
  const rateFor = (bpp: number, w: number, h: number) => {
    const r = bitrateFor(bpp, w, h, outFps);
    return storeVideo ? Math.min(PREVIEW_MAX_BPS, r) : r;
  };
  const estimate = (() => {
    if (tab !== 'video') return '';
    const { w, h } = vFormat === 'gif' ? gifSize() : outSize();
    const parts: string[] = [];
    if (vFormat === 'mp4') {
      // Video bitrate plus ~192 kbps audio when present or required for previews.
      const bpp = QUALITIES.find((q) => q.id === quality)?.bpp ?? 0.3;
      const bits = rateFor(bpp, w, h) * projectSeconds + (storeVideo || audioCount ? 192_000 * projectSeconds : 0);
      // Upper bound: variable bitrate puts still scenes far below target.
      // A 2 s empty scene measured 0.03 MB versus a 1 MB estimate; "≈" would mislead.
      parts.push(`up to ~${Math.max(1, Math.round(bits / 8 / 1_048_576))} MB`);
    }
    const key: SpeedKey = vFormat === 'mp4' ? (`mp4-${quality}` as SpeedKey) : vFormat;
    const v = speeds[key];
    const frames = vFormat === 'mp4' ? Math.round(projectSeconds * outFps) : seqFrames;
    if (v) parts.push(`${fmtSec((v * frames * ((w * h) / 1_000_000)) / 1000)} on this device`);
    return parts.join(' · ');
  })();
  const previewLengthOk = projectSeconds >= PREVIEW_MIN_SEC && projectSeconds <= PREVIEW_MAX_SEC;

  /*
    Copy to clipboard: paste directly into Figma/Slack/Docs without downloading,
    locating, and dragging a file. The clipboard always takes PNG.
    Pass a PROMISE to ClipboardItem: Safari requires starting the write
    within the click handler, while capture is asynchronous.
  */
  async function copyImage() {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
      setError('This browser cannot copy images — use Export image.');
      return;
    }
    setBusy(true);
    setError(null);
    useEditor.getState().setExporting(true);
    try {
      const { w, h } = outSize();
      const png = captureFrame({ width: w, height: h, mime: 'image/png', opaque: storeImage });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      track('copy_image', { w, h });
      playDone();
      toast(`Copied ${w}×${h} PNG — paste it anywhere`);
      onClose();
    } catch (e) {
      playBlip();
      setError(e instanceof Error ? `Copy failed: ${e.message}` : 'Copy failed');
      track('export_failed', { kind: 'copy' });
    } finally {
      useEditor.getState().setExporting(false);
      setBusy(false);
    }
  }

  async function exportImage() {
    if (!isPro && preset.pro) {
      playBlip();
      setError('This size is a Pro feature.');
      // Paywall hits show how often each limit blocks users, informing pricing decisions.
      track('paywall_hit', { where: 'size' });
      return;
    }
    /*
      Check the allowance here; deduct only after a successful export.
      Calling `consumeCapture()` before `captureFrame` charged users even
      when memory, context loss, or unsupported dimensions prevented a file.
      FREE_FOR_ALL masked this bug; disabling it would restore the failure.
    */
    if (!isPro && capturesLeft <= 0) {
      playBlip();
      setError('You are out of free captures.');
      track('paywall_hit', { where: 'captures' });
      return;
    }
    setBusy(true);
    setError(null);
    /*
      Enable `exporting` on every path, rather than only frame-by-frame video.
      Capture changes renderer resolution without changing the canvas CSS box:
      a 1080x1920 buffer stretches across a wide box, widening the device.
      The flag covers the scene so users never see that distorted frame.
    */
    useEditor.getState().setExporting(true);
    try {
      const { w, h } = outSize();
      const blob = await captureFrame({
        width: w,
        height: h,
        mime: imageMime(outFormat),
        opaque: storeImage,
      });
      downloadBlob(blob, `${BRAND.fileSlug}-${w}x${h}.${outFormat}`);
      // The file is ready; deduct the allowance now.
      if (!isPro) consumeCapture();
      track('export_image', { w, h, format: outFormat, pro: isPro, store: storeImage });
      playDone();
      onClose();
    } catch (e) {
      playBlip();
      setError(e instanceof Error ? e.message : 'Export failed');
      track('export_failed', { kind: 'image' });
    } finally {
      useEditor.getState().setExporting(false);
      setBusy(false);
    }
  }

  /**
   * Store set: every scene × every store size in one ZIP.
   *
   * Previously only the current frame was downloaded, separately for each
   * Apple size, even treating video sizes as images. A six-scene set
   * required exporting each scene manually. Output now includes:
   *   app-store/iphone-6.9in-1290x2796/01.png …  (scene order = file number)
   *   google-play/phone-1080x1920/01.png …
   *   google-play/feature-graphic-1024x500.png   (one frame from the active scene)
   * Capture `stillMoment` for each scene: widest framing in the clean interval.
   * All files are opaque.
   */
  /** Image tab: current frame at the selected size in every language, packaged in one ZIP. */
  async function exportImageAllLanguages() {
    if (!isPro && preset.pro) {
      playBlip();
      setError('This size is a Pro feature.');
      return;
    }
    setBusy(true);
    setError(null);
    useEditor.getState().setExporting(true);
    const previewBefore = useEditor.getState().previewLang;
    try {
      const { w, h } = outSize();
      const entries: ZipEntry[] = [];
      for (let k = 0; k < langPasses.length; k += 1) {
        const lang = langPasses[k];
        await showLang(lang);
        const blob = await captureFrame({ width: w, height: h, mime: imageMime(outFormat), opaque: storeImage });
        entries.push({ name: `${lang ?? baseLang}/${BRAND.fileSlug}-${w}x${h}.${outFormat}`, data: new Uint8Array(await blob.arrayBuffer()) });
        setProgress((k + 1) / langPasses.length);
      }
      downloadBlob(buildZip(entries), `${BRAND.fileSlug}-${w}x${h}-all-languages.zip`);
      track('export_image_languages', { w, h, langs: langPasses.length });
      playDone();
      onClose();
    } catch (e) {
      playBlip();
      setError(e instanceof Error ? e.message : 'Export failed');
      track('export_failed', { kind: 'image-languages' });
    } finally {
      useEditor.getState().setPreviewLang(previewBefore);
      setProgress(null);
      useEditor.getState().setExporting(false);
      setBusy(false);
    }
  }

  async function exportStoreSet() {
    if (!isPro) {
      setError('Store set export is a Pro feature.');
      track('paywall_hit', { where: 'store-set' });
      return;
    }
    setBusy(true);
    setError(null);
    useEditor.getState().setExporting(true);
    const st = useEditor.getState();
    const { playhead: playheadBefore, shots, activeShotId } = st;
    setPlaying(false);
    const ext = outFormat === 'jpg' ? 'jpg' : 'png';
    const mime = ext === 'jpg' ? 'image/jpeg' : 'image/png';
    const sizes = SIZES.filter((s) => s.folder);
    const feature = SIZES.find((s) => s.id === 'gp-feature');
    const passes = langPasses;
    const previewBefore = useEditor.getState().previewLang;
    const total = passes.length * (shots.length * sizes.length + (feature ? 1 : 0));
    let done = 0;
    const entries: ZipEntry[] = [];
    const grab = async (w: number, h: number, name: string) => {
      const blob = await captureFrame({ width: w, height: h, mime, opaque: true });
      entries.push({ name, data: new Uint8Array(await blob.arrayBuffer()) });
      done += 1;
      setProgress(done / total);
    };
    try {
      setProgress(0);
      for (const lang of passes) {
        // Each language gets its own folder, e.g. tr/app-store/iphone-…/01.png.
        const dir = passes.length > 1 ? `${lang ?? baseLang}/` : '';
        await showLang(lang);
        for (let i = 0; i < shots.length; i += 1) {
          const s = shots[i];
          const t = shotStart(shots, s.id) + stillMoment(s);
          await settleAt(() => useEditor.getState().setPlayhead(Math.round(t * 1000) / 1000));
          const no = String(i + 1).padStart(2, '0');
          for (const size of sizes) await grab(size.w, size.h, `${dir}${size.folder}/${no}.${ext}`);
        }
        if (feature) {
          // Feature graphic is a single image from the user's active scene.
          const a = shots.find((x) => x.id === activeShotId) ?? shots[0];
          const t = shotStart(shots, a.id) + stillMoment(a);
          await settleAt(() => useEditor.getState().setPlayhead(Math.round(t * 1000) / 1000));
          await grab(feature.w, feature.h, `${dir}google-play/feature-graphic-${feature.w}x${feature.h}.${ext}`);
        }
      }
      downloadBlob(buildZip(entries), `${BRAND.fileSlug}-store-set.zip`);
      track('export_store_set', { scenes: shots.length, files: entries.length, format: ext });
      playDone();
      onClose();
    } catch (e) {
      playBlip();
      setError(e instanceof Error ? e.message : 'Export failed');
      track('export_failed', { kind: 'store-set' });
    } finally {
      // Restore the user's playhead, selected scene, and preview language.
      useEditor.getState().setPreviewLang(previewBefore);
      await settleAt(() => useEditor.getState().setPlayhead(playheadBefore)).catch(() => {});
      if (useEditor.getState().activeShotId !== activeShotId) useEditor.getState().selectShot(activeShotId);
      setProgress(null);
      useEditor.getState().setExporting(false);
      setBusy(false);
    }
  }

  /** Read the frame canvas as RGBA at the target size for GIF export. */
  function pixelReader(w: number, h: number) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D is not available');
    return (src: HTMLCanvasElement) => {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(src, 0, 0, w, h);
      return ctx.getImageData(0, 0, w, h).data;
    };
  }

  /*
    GIF uses two passes: build a shared palette from 8 evenly spaced frames,
    then encode all frames with that palette and ordered dithering. Per-frame
    palettes made gradients flicker (lib/gif.ts). GIF has no audio.
  */
  async function exportGif() {
    if (!isPro) {
      setError('Video export is a Pro feature.');
      track('paywall_hit', { where: 'gif' });
      return;
    }
    setBusy(true);
    setError(null);
    useEditor.getState().setExporting(true);
    const playheadBefore = useEditor.getState().playhead;
    try {
      const seconds = totalDuration(useEditor.getState().shots);
      const { w, h } = gifSize();
      const rate = Number(gifFps);
      const read = pixelReader(w, h);
      const seek = (t: number) => useEditor.getState().setPlayhead(Math.round(t * 1000) / 1000);
      setPlaying(false);
      setPlayhead(0);
      const samples: Uint8ClampedArray[] = [];
      const blob = await timed('gif', seqFrames, w, h, async () => {
        await renderSequence({
          width: w,
          height: h,
          fps: rate,
          durationSec: seconds,
          motionBlur: MOTION_BLUR_AMOUNT[motionBlur],
          seek,
          times: Array.from({ length: 8 }, (_, i) => (seconds * (i + 0.5)) / 8),
          onProgress: (r) => setProgress(r * 0.1),
          onFrame: (c) => {
            samples.push(read(c).slice());
          },
        });
        const writer = createGifWriter({
          width: w,
          height: h,
          fps: rate,
          palette: buildPalette(samples, transparent),
          alpha: transparent,
        });
        await renderSequence({
          width: w,
          height: h,
          fps: rate,
          durationSec: seconds,
          motionBlur: MOTION_BLUR_AMOUNT[motionBlur],
          seek,
          onProgress: (r) => setProgress(0.1 + r * 0.9),
          onFrame: (c) => writer.addFrame(read(c)),
        });
        return writer.finish();
      });
      downloadBlob(blob, `${BRAND.fileSlug}-${w}x${h}-${rate}fps.gif`);
      track('export_gif', { w, h, fps: rate, frames: seqFrames, kb: Math.round(blob.size / 1024) });
      playDone();
      onClose();
    } catch (e) {
      playBlip();
      setError(e instanceof Error ? e.message : 'GIF export failed');
      track('export_failed', { kind: 'gif' });
    } finally {
      setProgress(null);
      setPlayhead(playheadBefore);
      useEditor.getState().setExporting(false);
      setBusy(false);
    }
  }

  /*
    PNG sequence: lossless frames for After Effects / Premiere / Resolve,
    with alpha for transparent scenes, in one ZIP (STORED; PNG is compressed).
    Dimensions and fps use the same selectors as MP4.
  */
  async function exportPngSequence() {
    if (!isPro) {
      setError('Video export is a Pro feature.');
      track('paywall_hit', { where: 'png-seq' });
      return;
    }
    setBusy(true);
    setError(null);
    useEditor.getState().setExporting(true);
    const playheadBefore = useEditor.getState().playhead;
    try {
      const seconds = totalDuration(useEditor.getState().shots);
      const { w, h } = outSize();
      const dir = `${BRAND.fileSlug}-${w}x${h}-${outFps}fps`;
      const entries: ZipEntry[] = [];
      setPlaying(false);
      setPlayhead(0);
      await timed('png-seq', Math.max(1, Math.round(seconds * outFps)), w, h, () =>
        renderSequence({
          width: w,
          height: h,
          fps: outFps,
          durationSec: seconds,
          motionBlur: MOTION_BLUR_AMOUNT[motionBlur],
          seek: (t) => useEditor.getState().setPlayhead(Math.round(t * 1000) / 1000),
          onProgress: (r) => setProgress(r),
          onFrame: async (c, i) => {
            const png = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
            if (!png) throw new Error('PNG encoding failed');
            entries.push({ name: `${dir}/frame_${String(i + 1).padStart(5, '0')}.png`, data: new Uint8Array(await png.arrayBuffer()) });
          },
        }),
      );
      const zip = buildZip(entries);
      downloadBlob(zip, `${dir}.zip`);
      track('export_png_seq', { w, h, fps: outFps, frames: entries.length, mb: Math.round(zip.size / 1_048_576) });
      playDone();
      onClose();
    } catch (e) {
      playBlip();
      setError(e instanceof Error ? e.message : 'PNG sequence export failed');
      track('export_failed', { kind: 'png-seq' });
    } finally {
      setProgress(null);
      setPlayhead(playheadBefore);
      useEditor.getState().setExporting(false);
      setBusy(false);
    }
  }

  /** Frame-by-frame MP4 (WebCodecs): one path for single-video and all-aspect exports. */
  function renderMp4(w: number, h: number, seconds: number, audio: AudioBuffer | null, onProgress: (r: number) => void) {
    const bpp = QUALITIES.find((q) => q.id === quality)?.bpp ?? 0.3;
    return recordFrames({
      durationSec: seconds,
      fps: outFps,
      width: w,
      height: h,
      bitrate: rateFor(bpp, w, h),
      motionBlur: MOTION_BLUR_AMOUNT[motionBlur],
      seek: (t) => useEditor.getState().setPlayhead(Math.round(t * 1000) / 1000),
      onProgress,
      audio,
      audioBitrate: storeVideo ? PREVIEW_AUDIO_BPS : undefined,
      /*
        SSAA is High-only: roughly 4× pixels per frame. Cheap for a still,
        but it multiplies export time across a 600-frame clip.
        Medium/Low deliberately use the faster path.
      */
      supersample: quality === 'high',
    });
  }

  async function exportAllRatios() {
    if (!isPro) {
      setError('Video export is a Pro feature.');
      track('paywall_hit', { where: 'all-ratios' });
      return;
    }
    if (!canUseWebCodecs()) {
      setError('All-ratio export needs Chrome or Edge (WebCodecs).');
      return;
    }
    setBusy(true);
    setError(null);
    useEditor.getState().setExporting(true);
    const st = useEditor.getState();
    const playheadBefore = st.playhead;
    try {
      const seconds = totalDuration(st.shots);
      setPlaying(false);
      setPlayhead(0);
      // Mix audio once and reuse the buffer for all four files.
      const audio = st.audioTracks.length ? await renderAudioMix(st.audioTracks, seconds) : null;
      const { w: bw, h: bh } = outSize();
      const short = Math.min(bw, bh);
      const base = BRAND.name.toLowerCase();
      const entries: ZipEntry[] = [];
      for (let k = 0; k < RATIOS.length; k += 1) {
        const r = RATIOS[k];
        const { w, h } = ratioSize(r, short);
        const blob = await renderMp4(w, h, seconds, audio, (p) => setProgress((k + p) / RATIOS.length));
        entries.push({ name: `${base}-${r.id}-${w}x${h}-${outFps}fps.mp4`, data: new Uint8Array(await blob.arrayBuffer()) });
      }
      const zip = buildZip(entries);
      downloadBlob(zip, `${base}-all-ratios-${short}p.zip`);
      track('export_all_ratios', { short, fps: outFps, mb: Math.round(zip.size / 1_048_576) });
      playDone();
      onClose();
    } catch (e) {
      playBlip();
      setError(e instanceof Error ? e.message : 'Export failed');
      track('export_failed', { kind: 'all-ratios' });
    } finally {
      setProgress(null);
      setPlayhead(playheadBefore);
      useEditor.getState().setExporting(false);
      setBusy(false);
    }
  }

  /** MP4 video tab: the entire project in every language, audio mixed once, in one ZIP. */
  async function exportVideoAllLanguages() {
    if (!isPro) {
      setError('Video export is a Pro feature.');
      track('paywall_hit', { where: 'all-languages' });
      return;
    }
    if (!canUseWebCodecs()) {
      setError('All-language export needs Chrome or Edge (WebCodecs).');
      return;
    }
    setBusy(true);
    setError(null);
    useEditor.getState().setExporting(true);
    const st = useEditor.getState();
    const playheadBefore = st.playhead;
    const previewBefore = st.previewLang;
    try {
      const seconds = totalDuration(st.shots);
      setPlaying(false);
      setPlayhead(0);
      const audio = st.audioTracks.length ? await renderAudioMix(st.audioTracks, seconds) : null;
      const { w, h } = outSize();
      const base = BRAND.name.toLowerCase();
      const entries: ZipEntry[] = [];
      for (let k = 0; k < langPasses.length; k += 1) {
        const lang = langPasses[k];
        await showLang(lang);
        const blob = await renderMp4(w, h, seconds, audio, (p) => setProgress((k + p) / langPasses.length));
        entries.push({ name: `${base}-${lang ?? baseLang}-${w}x${h}-${outFps}fps.mp4`, data: new Uint8Array(await blob.arrayBuffer()) });
      }
      const zip = buildZip(entries);
      downloadBlob(zip, `${base}-${w}x${h}-all-languages.zip`);
      track('export_video_languages', { w, h, langs: langPasses.length, mb: Math.round(zip.size / 1_048_576) });
      playDone();
      onClose();
    } catch (e) {
      playBlip();
      setError(e instanceof Error ? e.message : 'Export failed');
      track('export_failed', { kind: 'video-languages' });
    } finally {
      useEditor.getState().setPreviewLang(previewBefore);
      setProgress(null);
      setPlayhead(playheadBefore);
      useEditor.getState().setExporting(false);
      setBusy(false);
    }
  }

  async function exportVideo() {
    if (!isPro) {
      setError('Video export is a Pro feature.');
      track('paywall_hit', { where: 'video' });
      return;
    }
    setBusy(true);
    setError(null);
    // Real-time recording also resizes the canvas; cover the scene to hide
    // the stretched preview throughout recording.
    useEditor.getState().setExporting(true);
    try {
      /*
        Using `motion?.duration ?? shot.duration` recorded only the active scene:
        a five-scene, 15-second project produced 3 seconds, starting at the
        current playhead because it was not reset. Export the entire project:
        restart, record the total duration, then restore the playhead.
        Single-scene projects behaved identically, which hid this from tests.
      */
      const st = useEditor.getState();
      const { playhead: playheadBefore, shots } = st;
      const seconds = totalDuration(shots);
      const { w, h } = outSize();
      const bpp = QUALITIES.find((q) => q.id === quality)?.bpp ?? 0.3;
      const rate = rateFor(bpp, w, h);

      /*
        Frame-by-frame export also supports projects with audio.
        OfflineAudioContext mixes the full project into one buffer for
        AudioEncoder, making timing independent of wall-clock time.
        Audio projects formerly fell back to real-time recording before
        mixing existed; now only browsers without WebCodecs need that fallback.
      */
      /*
        Transparent video uses real-time recording: MediaRecorder VP8 preserves
        alpha; WebCodecs does not (see RecordOptions.mime).
      */
      // App Store previews require MP4; disable transparency for store sizes.
      const alphaVideo =
        !storeVideo && transparent && typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp8');
      const useFrames = canUseWebCodecs() && !alphaVideo;
      let blob: Blob;
      if (useFrames) {
        // setExporting is enabled outside this path; clearing it here would uncover the scene early.
        setPlaying(false);
        setPlayhead(0);
        try {
          // Prepare audio first; fetching files during encoding would stall the queue.
          const mixed = st.audioTracks.length
            ? await renderAudioMix(st.audioTracks, seconds)
            : null;
          // Previews require audio; use a silent track when the project has none.
          const audio = mixed ?? (storeVideo ? silentTrack(seconds) : null);
          blob = await timed(`mp4-${quality}` as SpeedKey, Math.round(seconds * outFps), w, h, () =>
            renderMp4(w, h, seconds, audio, (r) => setProgress(r)),
          );
        } finally {
          setProgress(null);
        }
      } else {
        setPlayhead(0);
        setPlaying(true);
        blob = await recordCanvas({
          durationMs: seconds * 1000,
          fps: outFps,
          width: w,
          height: h,
          bitrate: rate,
          motionBlur: MOTION_BLUR_AMOUNT[motionBlur],
          mime: alphaVideo ? 'video/webm;codecs=vp8' : undefined,
        });
        setPlaying(false);
      }
      setPlayhead(playheadBefore);
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      downloadBlob(blob, `${BRAND.fileSlug}-${w}x${h}-${outFps}fps.${ext}`);
      // Count frame and real-time paths separately. Real-time recording cannot
      // apply the selected dimensions; usage frequency determines the fix's priority.
      track('export_video', { w, h, fps: outFps, path: useFrames ? 'frames' : 'realtime', store: storeVideo });
      playDone();
      onClose();
    } catch (e) {
      playBlip();
      setPlaying(false);
      setError(e instanceof Error ? e.message : 'Recording failed');
      track('export_failed', { kind: 'video' });
    } finally {
      useEditor.getState().setExporting(false);
      setBusy(false);
    }
  }

  return (
    <div
      className="mp-scroll absolute right-0 top-full z-[700] mt-2 flex w-[300px] flex-col gap-2 overflow-y-auto p-3"
      style={{
        maxHeight: '70vh',
        background: 'var(--mp-dropdown)',
        border: '1px solid var(--mp-border)',
        borderRadius: 'var(--mp-radius-lg)',
        boxShadow: 'var(--mp-shadow-dropdown)',
      }}
    >
      <Segmented
        ariaLabel="Export type"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'image', label: 'Image' },
          { value: 'video', label: 'Video' },
        ]}
      />

      {tab === 'image' ? (
        <>
          <Select
            label="Format"
            value={format}
            options={[
              { value: 'png', label: 'PNG — transparency' },
              { value: 'jpg', label: 'JPG — smallest file' },
              { value: 'webp', label: 'WEBP — small, transparency' },
              ...(avifOk ? [{ value: 'avif' as const, label: 'AVIF — smallest for the web' }] : []),
            ]}
            onChange={setFormat}
          />
          {/*
            Expose the scene.transparent shortcut here: users decide they need
            alpha PNG output during export. The scene remains the source of truth.
            JPG cannot preserve alpha, so show this only for PNG.
          */}
          {format !== 'jpg' && !storeImage ? (
            <Toggle
              label="Transparent background"
              checked={transparent}
              onChange={(v) => patchShot({ scene: { ...sceneOf, transparent: v } })}
            />
          ) : null}
          {/*
            Removed the disconnected watermark toggle. Watermarks depend on
            the plan (free versus Pro); a nonfunctional option undermines trust.
          */}
          {!isPro ? (
            <p className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }}>
              {BRAND.wordmark} watermark — removed on Pro
            </p>
          ) : null}
        </>
      ) : (
        <>
          {!storeVideo ? (
            <Select
              label="Format"
              value={videoFormat}
              options={[
                { value: 'mp4' as const, label: 'MP4 — video' },
                { value: 'gif' as const, label: 'GIF — autoplays anywhere' },
                { value: 'png-seq' as const, label: 'PNG sequence (ZIP) — lossless' },
              ]}
              onChange={setVideoFormat}
            />
          ) : null}
          {vFormat === 'gif' ? (
            <>
              <Select
                label="GIF size"
                value={gifLong}
                options={[
                  { value: '480' as const, label: '480 px — smallest' },
                  { value: '640' as const, label: '640 px' },
                  { value: '800' as const, label: '800 px — sharpest' },
                ]}
                onChange={setGifLong}
              />
              <Select
                label="FPS"
                value={gifFps}
                options={[
                  { value: '10' as const, label: '10 FPS — smallest' },
                  { value: '20' as const, label: '20 FPS' },
                  { value: '25' as const, label: '25 FPS — smoothest' },
                ]}
                onChange={setGifFps}
              />
            </>
          ) : null}
          {/*
            App Store previews allow at most 30 fps. Show the locked selector
            so users understand the limit. Preserve their fps choice for other sizes.
          */}
          {vFormat !== 'gif' ? (
            <Select
              label="FPS"
              value={storeVideo ? '30' : fps}
              options={
                storeVideo
                  ? [{ value: '30' as const, label: '30 FPS — App Store max' }]
                  : [
                      { value: '30' as const, label: '30 FPS' },
                      { value: '60' as const, label: '60 FPS' },
                    ]
              }
              onChange={(v) => {
                if (!storeVideo) setFps(v);
              }}
            />
          ) : null}
          {vFormat === 'mp4' ? (
            <Select
              label="Quality"
              value={quality}
              /*
                Calculate the label from the selected dimensions; a fixed
                "~22 Mbps" label misrepresented 4K output.
              */
              options={QUALITIES.map((q) => {
                const { w, h } = outSize();
                const mbps = rateFor(q.bpp, w, h) / 1_000_000;
                // High also enables SSAA; show its cost in the panel.
                // Use the pipeline's actual factor: transparent MediaRecorder
                // video has no AA, and 4K uses ~1.2×, rather than always "2× AA".
                const alphaV = transparent && typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp8');
                const ss = q.id === 'high' ? videoSupersampleFactor(w, h, alphaV) : 1;
                const extra = ss > 1 ? ` · ${Number.isInteger(ss) ? ss : ss.toFixed(1)}× AA` : '';
                return { value: q.id, label: `${q.label} — ~${mbps.toFixed(0)} Mbps${extra}` };
              })}
              onChange={setQuality}
            />
          ) : null}
          <Select
            label="Motion blur"
            value={motionBlur}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
            onChange={setMotionBlur}
          />
          {/*
            Transparent WebM (VP8 alpha) places the device, shadow, and glow
            over Premiere/After Effects/Figma/web content without a background.
            Uses real-time recording because WebCodecs has no alpha support.
          */}
          {!storeVideo ? (
            <Toggle
              label={
                vFormat === 'gif'
                  ? 'Transparent background (1-bit)'
                  : vFormat === 'png-seq'
                    ? 'Transparent background (alpha)'
                    : 'Transparent background (WebM)'
              }
              checked={transparent}
              onChange={(v) => patchShot({ scene: { ...sceneOf, transparent: v } })}
            />
          ) : null}
        </>
      )}

      {/*
        Hide orientation for custom and App Store sizes: these bypass
        resolve() via keepSize, so an active-looking selector would have no
        effect and make users think their dimensions were wrong.
      */}
      {!keepSize ? (
        <Segmented
          ariaLabel="Orientation"
          value={orientation}
          onChange={setOrientation}
          options={[
            { value: 'landscape', label: 'Landscape' },
            { value: 'square', label: 'Square' },
            { value: 'portrait', label: 'Portrait' },
          ]}
        />
      ) : null}

      {tab === 'video' && vFormat === 'gif' ? null : (
        <Select
          label="Size"
          value={sizeId}
          options={SIZE_OPTIONS.map((s) => ({
            value: s.id,
            label: s.label,
            badge: 'pro' in s && s.pro && !isPro ? ('pro' as const) : undefined,
          }))}
          onChange={setSizeChoice}
        />
      )}

      {sizeId === 'custom' && !(tab === 'video' && vFormat === 'gif') ? (
        <div className="flex items-center gap-2">
          {(
            [
              ['W', customW, setCustomW],
              ['H', customH, setCustomH],
            ] as const
          ).map(([lbl, val, set]) => (
            <label
              key={lbl}
              className="mp-label flex flex-1 items-center gap-1.5 px-2"
              style={{
                height: 'var(--mp-row-h)',
                borderRadius: 'var(--mp-radius)',
                background: 'var(--mp-surface)',
              }}
            >
              <span style={{ color: 'var(--mp-text-tertiary)' }}>{lbl}</span>
              <input
                type="number"
                min={64}
                max={tab === 'image' ? 5120 : 3840}
                value={val}
                onChange={(e) => set(Number(e.target.value))}
                className="w-full bg-transparent text-right outline-none"
                style={{ color: 'var(--mp-text-primary)' }}
              />
            </label>
          ))}
        </div>
      ) : null}

      {/*
        Place store rules below Size, which determines them. Hide transparency
        for store sizes because both stores reject alpha and output is flattened.
        Explain the change rather than unexpectedly adding a white background.
      */}
      {storeImage ? (
        <p className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }}>
          {'Store-ready: no alpha channel.'}
          {transparent ? ' Transparent background is flattened to white.' : ''}
          {format === 'webp' || format === 'avif' ? ' Stores take PNG or JPG — exporting PNG.' : ''}
        </p>
      ) : null}

      {tab === 'video' ? (
        <p className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }}>
          {/*
            State explicitly that recording covers the project. Previously
            the active scene's motion preset was shown and only that scene recorded.
          */}
          {`Records the whole project — ${shotCount} ${shotCount === 1 ? 'scene' : 'scenes'} · ${projectSeconds.toFixed(1)}s`}
          {estimate ? ` · ${estimate}` : ''}
          {motion ? ` · this scene: ${motion.label}` : ''}
          {!canVideo && vFormat === 'mp4' ? ' · This browser cannot record video.' : ''}
        </p>
      ) : null}
      {tab === 'video' && vFormat === 'gif' ? (
        <p className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }}>
          {`${gifSize().w}×${gifSize().h} · ${seqFrames} frames · loops forever · no audio`}
          {transparent ? ' · GIF transparency is on/off per pixel — soft shadows drop out; use PNG sequence for soft alpha.' : ''}
        </p>
      ) : null}
      {tab === 'video' && vFormat === 'png-seq' ? (
        <p className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }}>
          {(() => {
            const { w, h } = outSize();
            // Measured rough ratio: a 3D scene with gradient background uses ~1.2 bytes/pixel in PNG.
            const mb = (seqFrames * w * h * 1.2) / 1_048_576;
            return `${seqFrames} PNG frames in one ZIP · ~${mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`} · no audio`;
          })()}
          {transparent ? ' · alpha kept' : ''}
        </p>
      ) : null}

      {/*
        Duration is a warning, not a blocker: files outside 15–30 s can
        download for other uses, but warn that App Store Connect will reject them.
      */}
      {storeVideo ? (
        <p className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }}>
          {'App Store-ready: MP4 · H.264 · 30 fps · stereo AAC (silent track if no audio).'}
          {transparent ? ' Previews cannot be transparent — background renders black.' : ''}
          {!canUseWebCodecs() ? ' This browser cannot guarantee the format — use Chrome or Edge.' : ''}
        </p>
      ) : null}
      {storeVideo && !previewLengthOk ? (
        <p className="mp-label" style={{ color: '#f0a64a' }}>
          {`App Store previews must be ${PREVIEW_MIN_SEC}–${PREVIEW_MAX_SEC}s — this project is ${projectSeconds.toFixed(1)}s.`}
        </p>
      ) : null}

      {error ? (
        <p className="mp-label" style={{ color: '#ff6b57' }}>
          {error}
        </p>
      ) : null}

      <button
        disabled={busy || (tab === 'video' && vFormat === 'mp4' && !canVideo)}
        onClick={
          tab === 'image'
            ? exportImage
            : vFormat === 'gif'
              ? exportGif
              : vFormat === 'png-seq'
                ? exportPngSequence
                : exportVideo
        }
        className="mp-label mt-1 w-full py-2.5"
        style={{
          borderRadius: 'var(--mp-radius)',
          background: isPro || tab === 'image' ? 'var(--mp-accent)' : 'var(--mp-surface-active)',
          color: isPro || tab === 'image' ? '#fff' : 'var(--mp-text-label)',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {/*
          Frame-by-frame export can take longer than real time on slow machines.
          Show percentage progress so users can tell it has not frozen.
        */}
        {busy
          ? progress !== null
            ? `Rendering… ${Math.round(progress * 100)}%`
            : 'Preparing…'
          : tab === 'image'
            ? `Export image${isPro ? '' : ` (${capturesLeft})`}`
            : !isPro
              ? 'Upgrade to export video'
              : vFormat === 'gif'
                ? 'Export GIF'
                : vFormat === 'png-seq'
                  ? 'Export PNG sequence'
                  : 'Export video'}
      </button>

      {tab === 'video' && vFormat === 'mp4' && !storeVideo ? (
        <button
          disabled={busy || !canUseWebCodecs()}
          onClick={exportAllRatios}
          className="mp-label w-full py-2"
          style={{
            borderRadius: 'var(--mp-radius)',
            background: 'var(--mp-surface-active)',
            color: 'var(--mp-text-label)',
            opacity: busy ? 0.6 : 1,
          }}
          title={`One ZIP with four MP4s: 16:9, 9:16, 1:1 and 4:5 at a ${Math.min(outSize().w, outSize().h)} px short edge. The camera refits every ratio.${transparent ? ' MP4 has no transparency.' : ''}`}
        >
          {`Export all ratios (ZIP) · 16:9 · 9:16 · 1:1 · 4:5${isPro ? '' : ' · PRO'}`}
        </button>
      ) : null}

      {languages.length && (tab === 'image' || (tab === 'video' && vFormat === 'mp4')) ? (
        <button
          disabled={busy || (tab === 'video' && !canUseWebCodecs())}
          onClick={tab === 'image' ? exportImageAllLanguages : exportVideoAllLanguages}
          data-testid="export-all-languages"
          className="mp-label w-full py-2"
          style={{
            borderRadius: 'var(--mp-radius)',
            background: 'var(--mp-surface-active)',
            color: 'var(--mp-text-label)',
            opacity: busy ? 0.6 : 1,
          }}
          title={`One ZIP, one ${tab === 'image' ? 'image' : 'video'} per language at the selected size: ${[baseLang, ...languages].join(', ')}.`}
        >
          {`Export all languages (ZIP) · ${[baseLang, ...languages].join(' · ')}${isPro ? '' : ' · PRO'}`}
        </button>
      ) : null}

      {tab === 'image' ? (
        <button
          disabled={busy}
          onClick={copyImage}
          className="mp-label w-full py-2"
          style={{
            borderRadius: 'var(--mp-radius)',
            background: 'var(--mp-surface-active)',
            color: 'var(--mp-text-label)',
            opacity: busy ? 0.6 : 1,
          }}
          title="Copies a PNG at the selected size — paste straight into Figma, Slack or Docs."
        >
          Copy image to clipboard
        </button>
      ) : null}

      {tab === 'image' ? (
        <button
          disabled={busy}
          onClick={exportStoreSet}
          className="mp-label w-full py-2"
          style={{
            borderRadius: 'var(--mp-radius)',
            background: 'var(--mp-surface-active)',
            color: 'var(--mp-text-label)',
            opacity: busy ? 0.6 : 1,
          }}
          title="One ZIP: every scene in App Store (iPhone, iPad, Mac) and Google Play (phone, tablet) sizes, plus a feature graphic from this scene. Each scene is captured at its widest framing. No alpha channel."
        >
          {`Export store set (ZIP) · ${shotCount} ${shotCount === 1 ? 'scene' : 'scenes'}${isPro ? '' : ' · PRO'}`}
        </button>
      ) : null}

      {!isPro ? (
        <div className="flex items-center justify-center gap-2 pt-1">
          <Badge tone="free" />
          <span className="mp-label" style={{ color: 'var(--mp-text-tertiary)' }}>
            {FREE_CAPTURES} free captures
          </span>
        </div>
      ) : null}
    </div>
  );
}
