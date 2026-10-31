/**
 * LAUNCH PACKAGE EXPORT: every file of a launch package (config/launch.ts) in one ZIP.
 *
 * One job at a time on the one renderer: each image output is settled at its scene's still moment and
 * captured at each of its sizes (opaque PNG/JPEG, as stores require), then the promo video is recorded
 * frame by frame from its own scenes only (their order and durations in the project, so reordering or
 * retiming them is respected). A language folder per language, a manifest at the root.
 *
 * Cancelling stops between images and between video frames. Nothing is downloaded unless every file was
 * made; the project itself is never changed (playhead, scene, preview language are restored).
 */

import { canUseWebCodecs, captureFrame, recordFrames, settleAt } from '@/components/scene/exportBridge';
import { shotStart, textIn, useEditor, type Shot } from '@/store/editor';
import { getAspect } from '@/config/aspects';
import { LAUNCH_VIDEO, launchPath, type LaunchFile, type LaunchOutput } from '@/config/launch';
import { bitrateFor, stillMoment } from '@/lib/exportJobs';
import { buildZip, type ZipEntry } from '@/lib/zip';

/** Medium quality (the export panel's default level). */
const VIDEO_BPP = 0.17;
/** A video counts as this many images in the overall progress. */
const VIDEO_WEIGHT = 30;
/** Above this many bytes in memory, warn before starting (the ZIP is built in memory). */
export const LAUNCH_MEMORY_BUDGET = 256 * 1024 * 1024;

export type LaunchCheck = {
  /** Blocking: the package cannot be made as it is. */
  problems: string[];
  /** Not blocking, shown before export. */
  warnings: string[];
  /** H.264 1080p30 encoding is available. */
  videoOk: boolean;
  /** Rough size of the ZIP in bytes. */
  estimate: number;
};

export type LaunchProgress = { phase: 'images' | 'video' | 'packaging'; fraction: number; detail: string };

const isVideo = (o: LaunchOutput) => o.target === 'video';
const abortError = () => new DOMException('Export cancelled', 'AbortError');

/** Rough encoded size of one file (PNG ~1.2 B/px of UI, JPEG ~0.3 B/px, video at its bitrate). */
function guessBytes(f: LaunchFile, videoSeconds: number): number {
  if (f.format === 'mp4') return (bitrateFor(VIDEO_BPP, f.w, f.h, LAUNCH_VIDEO.fps) / 8) * videoSeconds;
  return f.w * f.h * (f.format === 'png' ? 1.2 : 0.3);
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** Does every text line of a scene stay inside its frame (in this language)? */
function textInside(shot: Shot, aspectRatio: number, lang: string | null): boolean {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return true;
  const W = aspectRatio >= 1 ? 1000 * aspectRatio : 1000;
  const H = aspectRatio >= 1 ? 1000 : 1000 / aspectRatio;
  const unit = Math.min(W, H);
  for (const t of shot.texts) {
    if (t.kind !== 'text' || !t.visible) continue;
    const px = t.size * unit;
    measureCtx.font = `${t.weight} ${px}px "${t.font}", sans-serif`;
    const lines = textIn(t, lang).split('\n');
    for (const line of lines) {
      const w = measureCtx.measureText(line).width + line.length * t.tracking * px;
      const x = t.x * W;
      const left = t.align === 'left' ? x : t.align === 'right' ? x - w : x - w / 2;
      if (left < -1 || left + w > W + 1) return false;
    }
    const half = (lines.length * px * t.lineHeight) / 2;
    if (t.y * H - half < -1 || t.y * H + half > H + 1) return false;
  }
  return true;
}

async function videoSupported(): Promise<boolean> {
  if (!canUseWebCodecs()) return false;
  if (typeof VideoEncoder.isConfigSupported !== 'function') return true;
  const { w, h, fps } = LAUNCH_VIDEO;
  for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42003e']) {
    try {
      const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate: bitrateFor(VIDEO_BPP, w, h, fps), framerate: fps });
      if (r?.supported) return true;
    } catch {
      // Try the next profile.
    }
  }
  return false;
}

/** Scenes of an output, in its order; null when one is missing. */
function scenesOf(o: LaunchOutput, shots: Shot[]): Shot[] | null {
  const list = o.shotIds.map((id) => shots.find((s) => s.id === id));
  return list.length && list.every(Boolean) ? (list as Shot[]) : null;
}

/** Before export: missing scenes block; text off the frame, untranslated text and memory warn. */
export async function checkLaunchPackage(langs: string[]): Promise<LaunchCheck> {
  const st = useEditor.getState();
  const launch = st.launch;
  if (!launch) return { problems: ['This project is not a launch package.'], warnings: [], videoOk: false, estimate: 0 };
  const problems: string[] = [];
  const warnings: string[] = [];
  const off: string[] = [];
  const untranslated = new Map<string, number>();
  let videoSeconds = 0;
  for (const o of launch.outputs) {
    const scenes = scenesOf(o, st.shots);
    if (!scenes) {
      problems.push(`${o.label}: its scene was deleted — undo, or create the package again.`);
      continue;
    }
    if (isVideo(o)) {
      videoSeconds = scenes.reduce((a, s) => a + s.duration, 0);
      continue;
    }
    const ratio = getAspect(scenes[0].aspectId ?? st.aspectId).ratio ?? o.files[0].w / o.files[0].h;
    for (const lang of langs) {
      const code = lang === st.baseLang ? null : lang;
      if (!textInside(scenes[0], ratio, code)) off.push(code ? `${o.label} (${code})` : o.label);
      if (code && scenes[0].texts.some((t) => t.kind === 'text' && t.text.trim() && !t.i18n?.[code]?.trim())) {
        untranslated.set(code, (untranslated.get(code) ?? 0) + 1);
      }
    }
  }
  if (off.length) warnings.push(`Text runs off the frame in: ${off.join(', ')}.`);
  for (const [code, n] of untranslated) warnings.push(`${n} image${n > 1 ? 's' : ''} in ${code.toUpperCase()} use the base-language text (not translated).`);
  const videoOk = await videoSupported();
  if (!videoOk) warnings.push('This browser cannot encode H.264 video: the package can be made without the video.');
  const perLang = launch.outputs.reduce((a, o) => a + o.files.reduce((b, f) => b + guessBytes(f, videoSeconds), 0), 0);
  const estimate = perLang * langs.length;
  if (estimate > LAUNCH_MEMORY_BUDGET) warnings.push(`About ${Math.round(estimate / 1048576)} MB in memory: choose fewer languages, or images only, if your browser struggles.`);
  return { problems, warnings, videoOk, estimate };
}

/**
 * Make every file and return the ZIP. `langs`: the base language first, then any of the project's
 * languages. Throws an AbortError when cancelled; the project is restored in every case.
 */
export async function exportLaunchPackage(opts: {
  langs: string[];
  imagesOnly: boolean;
  signal: AbortSignal;
  onProgress: (p: LaunchProgress) => void;
}): Promise<{ zip: Blob; files: number; timings: { images: number; video: number; zip: number } }> {
  const st = useEditor.getState();
  const launch = st.launch;
  if (!launch) throw new Error('This project is not a launch package.');
  const { shots, playhead: playheadBefore, activeShotId, previewLang: langBefore, baseLang } = st;
  const stop = () => {
    if (opts.signal.aborted) throw abortError();
  };
  const imageOutputs = launch.outputs.filter((o) => !isVideo(o));
  const video = opts.imagesOnly ? null : launch.outputs.find(isVideo) ?? null;
  const imageJobs = imageOutputs.reduce((a, o) => a + o.files.length, 0) * opts.langs.length;
  const totalWeight = imageJobs + (video ? VIDEO_WEIGHT * opts.langs.length : 0);
  let doneWeight = 0;
  // Rendering fills the bar up to 98 %; packaging and the last checks take the rest.
  const share = (w: number) => 0.98 * Math.min(1, w / totalWeight);
  const entries: ZipEntry[] = [];
  const files: { path: string; output: string; target: string; width: number; height: number; format: string; bytes: number; scenes: string[] }[] = [];
  const timings = { images: 0, video: 0, zip: 0 };

  st.setPlaying(false);
  st.setExporting(true);
  try {
    for (const lang of opts.langs) {
      const code = lang === baseLang ? null : lang;
      await settleAt(() => useEditor.getState().setPreviewLang(code));
      let t0 = performance.now();
      for (const o of imageOutputs) {
        const scenes = scenesOf(o, shots);
        if (!scenes) throw new Error(`${o.label}: its scene is missing`);
        stop();
        const s = scenes[0];
        const t = shotStart(shots, s.id) + stillMoment(s);
        await settleAt(() => useEditor.getState().setPlayhead(Math.round(t * 1000) / 1000));
        for (const f of o.files) {
          stop();
          opts.onProgress({ phase: 'images', fraction: share(doneWeight), detail: `Image ${Math.round(doneWeight) + 1} of ${imageJobs} · ${lang}` });
          const mime = f.format === 'jpeg' ? 'image/jpeg' : 'image/png';
          const blob = await captureFrame({ width: f.w, height: f.h, mime, quality: f.format === 'jpeg' ? 0.92 : undefined, opaque: true });
          const data = new Uint8Array(await blob.arrayBuffer());
          const path = launchPath(lang, f);
          entries.push({ name: path, data });
          files.push({ path, output: o.id, target: o.target, width: f.w, height: f.h, format: f.format, bytes: data.length, scenes: [s.id] });
          doneWeight += 1;
        }
      }
      timings.images += performance.now() - t0;

      if (video) {
        const scenes = scenesOf(video, shots);
        if (!scenes) throw new Error('Promo video: a scene is missing');
        stop();
        // Video time → project time through the bound scenes, in their own order.
        const segs = scenes.map((s) => ({ start: shotStart(shots, s.id), dur: s.duration }));
        const seconds = segs.reduce((a, s) => a + s.dur, 0);
        const toProject = (t: number) => {
          let acc = 0;
          for (const s of segs) {
            if (t < acc + s.dur || s === segs[segs.length - 1]) return s.start + Math.min(t - acc, s.dur - 1e-3);
            acc += s.dur;
          }
          return 0;
        };
        const f = video.files[0];
        const base = doneWeight;
        t0 = performance.now();
        const blob = await recordFrames({
          durationSec: seconds,
          fps: LAUNCH_VIDEO.fps,
          width: f.w,
          height: f.h,
          bitrate: bitrateFor(VIDEO_BPP, f.w, f.h, LAUNCH_VIDEO.fps),
          motionBlur: 0,
          seek: (t) => useEditor.getState().setPlayhead(Math.round(toProject(t) * 1000) / 1000),
          signal: opts.signal,
          onProgress: (r) => {
            doneWeight = base + r * VIDEO_WEIGHT;
            const frames = Math.round(seconds * LAUNCH_VIDEO.fps);
            opts.onProgress({ phase: 'video', fraction: share(doneWeight), detail: `Video · ${lang} · frame ${Math.round(r * frames)} of ${frames}` });
          },
        });
        timings.video += performance.now() - t0;
        const data = new Uint8Array(await blob.arrayBuffer());
        const path = launchPath(lang, f);
        entries.push({ name: path, data });
        files.push({ path, output: video.id, target: video.target, width: f.w, height: f.h, format: f.format, bytes: data.length, scenes: scenes.map((s) => s.id) });
        doneWeight = base + VIDEO_WEIGHT;
      }
    }
    stop();
    opts.onProgress({ phase: 'packaging', fraction: 0.99, detail: 'Packaging ZIP' });
    const t0 = performance.now();
    const videoOut = launch.outputs.find(isVideo);
    const manifest = {
      format: 'mockup.best launch package',
      version: 1,
      direction: launch.direction,
      languages: opts.langs,
      baseLanguage: baseLang,
      imagesOnly: !video,
      video: video && videoOut ? { fps: LAUNCH_VIDEO.fps, seconds: files.find((x) => x.output === videoOut.id)?.scenes.reduce((a, id) => a + (shots.find((s) => s.id === id)?.duration ?? 0), 0) } : null,
      files,
    };
    entries.unshift({ name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
    // Let the progress paint before the (synchronous) CRC pass.
    await new Promise((r) => setTimeout(r, 0));
    const zip = buildZip(entries);
    timings.zip = performance.now() - t0;
    return { zip, files: entries.length, timings };
  } finally {
    const s = useEditor.getState();
    s.setPreviewLang(langBefore);
    await settleAt(() => useEditor.getState().setPlayhead(playheadBefore)).catch(() => {});
    if (useEditor.getState().activeShotId !== activeShotId) useEditor.getState().selectShot(activeShotId);
    useEditor.getState().setExporting(false);
  }
}
