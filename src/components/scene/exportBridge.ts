'use client';

import { waitForModels } from './deviceModels';
import { ensureProjectImages } from './mediaTextures';
import { shotAtTime, useEditor } from '@/store/editor';
import * as THREE from 'three';
import { audioTracksForRecording } from './audioBridge';
import { canUseWebCodecs, exportFrameByFrame } from './karekare';

export { canUseWebCodecs };

/**
 * Bridge between the scene and external controls. Export needs the renderer, scene and camera; R3F
 * only exposes these inside Canvas. Module-level references let the top-bar EXPORT button access
 * them.
 */

type SceneRefs = {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /**
   * R3F frame-loop switch. Stop the loop for single-frame capture: rendering 4K every rAF saturated
   * the GPU and queued toBlob for 5+ seconds (render: 12 ms, toBlob: 5019 ms; with the loop stopped:
   * ~150 ms).
   */
  setFrameloop?: (mode: 'always' | 'never' | 'demand') => void;
  /** Manually advance R3F by one frame when frameloop is 'never'. */
  advance?: (timestamp: number) => void;
};

let refs: SceneRefs | null = null;

export function registerScene(next: SceneRefs | null) {
  refs = next;
}

/** Live scene references (the auto-motion solver reads the camera and screen). */
export function getSceneRefs(): SceneRefs | null {
  return refs;
}

/**
 * Final rendering pipeline (composer + text overlay). gl.render(scene, camera) alone omits composer
 * blur/effects and the separate text/watermark overlay. Direct exports lost effects and let free
 * users export without a watermark. PostProcessing registers here.
 */
type Pipeline = {
  /**
   * blurScale: export resolution / preview resolution. Blur uses absolute pixels; without scaling it
   * looks half as strong at 4K. Composer resizing is lazy and internal to the pipeline to avoid
   * allocating a half-GB MSAA HalfFloat buffer for effect-free 4K exports.
   */
  render: (w: number, h: number, blurScale?: number) => void;
};

let pipeline: Pipeline | null = null;
let overlayDraw: ((w: number, h: number) => void) | null = null;

/*
 * Target resolution during video recording. Recording uses the canvas stream; leaving the canvas at
 * preview size would make "App Store Video 1920×1080" output depend on screen size. The drawing
 * buffer keeps the target size; CameraRig/PostProcessing/TextOverlay read it here.
 */
let recordSize: { w: number; h: number } | null = null;
/*
  Motion blur is an amount (0 = off), allowing subtle blur instead of a single on/off flag.
*/
let motionBlur = 0;
/*
  Preview pixel ratio before capture. restorePreview used devicePixelRatio, but the preview now
  uses supersampling (Stage's PREVIEW_DPR_FLOOR). On 1× monitors that silently reset the ratio to
  1, degrading the editor after video export. ⚠️ Keep this declaration near the top: module-end
  declarations once caused a TDZ error that try/catch silently swallowed.
*/
let previewPixelRatio: number | null = null;

export function getRecordSize() {
  return recordSize;
}

/*
  Real-time recording (MediaRecorder: transparent WebM or browsers without WebCodecs)?
  Frame-by-frame export can afford high jitter counts; the same load drops frames on slower
  machines during real-time capture, which uses the preview sample count (see PostProcessing
  EXPORT_JITTER).
*/
let realtimeRecording = false;
export function isRealtimeRecording() {
  return realtimeRecording;
}

/** 0 = off, 0.35 = low, 0.6 = medium, 0.8 = high (AfterimagePass damping). */
export function motionBlurAmount() {
  return motionBlur;
}

export function registerPipeline(p: Pipeline | null) {
  pipeline = p;
}

export function registerOverlayDraw(fn: ((w: number, h: number) => void) | null) {
  overlayDraw = fn;
}

export function isSceneReady() {
  return refs !== null;
}

/*
  SUPERSAMPLING (SSAA). Export rendered one sample per target pixel. Canvas/composer MSAA smooths
  geometry edges, not screenshot downscaling (1290 px media → ~340 px in 1080p output, ≈3.8×). This
  broke 1 px lines and blurred small text. The same scene was clean at 4K; downsampled 4K beat
  native 1080p (SSIM 0.9859 / PSNR 35.3 dB, entirely in screen content), making the most common
  size the worst output. Render larger, then downsample with a 2D canvas. A fixed 2× multiplier
  costs too much memory: effects/blur allocate MSAA HalfFloat targets (8 bytes/pixel × 4 samples),
  and 2× 4K exceeds half a GB, causing context loss on midrange GPUs. Cap rendering at 12 MP: full
  2× at 1080p and below, ~1.8× at 1440p, ~1.2× at 4K, which was already clean.
*/
const MAX_RENDER_PX = 12_000_000;

export function supersampleScale(
  gl: THREE.WebGLRenderer,
  width: number,
  height: number,
): number {
  const px = Math.max(1, width * height);
  const maxDim = gl.capabilities.maxTextureSize || 4096;
  const s = Math.min(
    2,
    Math.sqrt(MAX_RENDER_PX / px),
    maxDim / Math.max(1, Math.max(width, height)),
  );
  // Below 1.15, the improvement is not worth the cost; keep 1×.
  return s < 1.15 ? 1 : s;
}

/**
 * Actual video-export SSAA multiplier for the panel label (1 = none). Only frame-by-frame WebCodecs
 * supersamples; transparent video uses real-time MediaRecorder at target canvas size, with no AA
 * multiplier. High previously always showed "· 2× AA", even for transparent video and ~1.2× 4K. The
 * texture-size limit is unknown here; the 12 MP rule matches supersampleScale.
 */
export function videoSupersampleFactor(width: number, height: number, alphaVideo: boolean): number {
  if (alphaVideo || !canUseWebCodecs()) return 1;
  const s = Math.min(2, Math.sqrt(MAX_RENDER_PX / Math.max(1, width * height)));
  return s < 1.15 ? 1 : s;
}

/** Render dimensions: supersampled and even (H.264 rejects odd dimensions). */
function renderSize(gl: THREE.WebGLRenderer, width: number, height: number) {
  const s = supersampleScale(gl, width, height);
  if (s === 1) return { w: width, h: height, scale: 1 };
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { w: even(width * s), h: even(height * s), scale: s };
}

export type CaptureOptions = {
  width: number;
  height: number;
  /**
   * Pass TRUE for sequential capture (frame-by-frame video). Normally captureFrame restores preview
   * size and redraws the text overlay. Between sequential frames this adds a preview render per
   * target render (measured: 266 of each), shrinking the shared canvas so exported text is upscaled
   * and blurry. TRUE keeps the size; the caller invokes restorePreview() once at the end.
   */
  keepSize?: boolean;
  /** 'image/png' preserves transparency; 'image/jpeg' does not. */
  mime: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif';
  quality?: number;
  /**
   * Output without an alpha channel, for store images. App Store and Google Play reject PNGs carrying
   * alpha even with no visible transparency. Chrome always writes RGBA (color type 6) from default
   * 2D/WebGL canvases, but RGB (color type 2) from an {alpha:false} canvas. TRUE flattens onto white
   * in an alpha:false canvas, as the JPG path does.
   */
  opaque?: boolean;
};

/**
 * Capture one frame. Resize the renderer to target resolution, render, then restore its size. A
 * 1200 px preview can produce 4K output independently of screen resolution. The third argument in
 * setSize(w, h, false) must remain false to preserve CSS size; true briefly enlarges the canvas to
 * 4K and shifts the page.
 */
/*
  Last scene committed by React (written by Stage's layout effect). Two fixed steps can be
  insufficient at scene boundaries: rendering before React commits produces a missing device or
  stale background (observed at 7.733, 23.233 and 7.750 s). Step until the target scene is
  committed; only boundary frames incur this negligible cost.
*/
let committedShot: string | null = null;
export function noteCommittedShot(id: string) {
  committedShot = id;
}
function expectedShotId(): string | null {
  const st = useEditor.getState();
  return shotAtTime(st.shots, st.playhead).shot?.id ?? null;
}
async function settleToShot(step: () => Promise<void>) {
  const want = expectedShotId();
  let extra = 0;
  while (want && committedShot !== want && extra < 8) {
    await step();
    extra += 1;
  }
  // If the commit just arrived, give camera and layout effects one more step.
  if (extra > 0) await step();
}

/*
  Video readiness gate. Two render steps do not guarantee the requested frame is decoded: setting
  currentTime starts asynchronous decoding while the texture still holds the previous frame,
  producing blank or stale scene starts on long seeks. Textures register seek/load promises here;
  await them before rendering. With commit, step once more so React binds the loaded texture to the
  material. Bound the wait so broken videos cannot stall export.
*/
const pendingVideo = new Map<Promise<void>, boolean>();
export function trackVideoSeek(p: Promise<void>, commit = false) {
  pendingVideo.set(p, commit);
  void p.finally(() => pendingVideo.delete(p));
}
async function settleVideo(step: () => Promise<void>) {
  /*
    Drain pending seeks: completing one can trigger another. Sync requests arriving during a seek
    wait to retry afterward, then seek to the correct position (at boundaries sharing a video: old
    scene time, then new scene time). Returning after the first pass missed the second seek and
    occasionally rendered the previous scene's frame in production builds.
  */
  for (let i = 0; i < 6; i += 1) {
    // Let the mounted scene's effects and retry listeners run first.
    await new Promise<void>((r) => setTimeout(r, 0));
    if (!pendingVideo.size) return;
    const commit = [...pendingVideo.values()].some(Boolean);
    await Promise.race([Promise.all([...pendingVideo.keys()]), new Promise<void>((r) => setTimeout(r, 2500))]);
    if (commit) await step();
  }
}

/** All project devices, including extras, for the model readiness gate. */
function projectDeviceIds(): string[] {
  return useEditor.getState().shots.flatMap((s) => [s.deviceId, ...s.extras.map((e) => e.deviceId)]);
}

export async function captureFrame(opts: CaptureOptions): Promise<Blob> {
  if (!refs) throw new Error('Scene is not ready');
  /*
    Wait for images too: if a scene appears before its texture loads, its screen renders white and
    that frame enters the file (observed in the first two frames of scene 2). Caching all project
    images ensures textures are ready for each scene's first frame.
  */
  await Promise.all([waitForModels(projectDeviceIds()), ensureProjectImages()]);
  const { gl, scene, camera } = refs;

  /*
     Diagnostics (localhost only): 4K capture took 4–5 s; per-step markers identify where that time
     goes.
  */
  const t0 = performance.now();
  const dbg = typeof window !== 'undefined' && window.location.hostname === 'localhost';
  const mark = (label: string) => {
    if (dbg) console.debug(`[capture] ${label} ${(performance.now() - t0).toFixed(0)}ms`);
  };

  const prevSize = new THREE.Vector2();
  gl.getSize(prevSize);
  const prevPixelRatio = gl.getPixelRatio();
  const prevAspect = camera.aspect;

  /*
    Single-frame capture must also publish target size. recordSize was set only for video, leaving
    captureFrame's text overlay at preview size (e.g. 1042×532). This shrank the canvas and upscaled
    exported text by ~1.8×, blurring it. At 1:1, overlay text was soft while the device's UI text
    stayed sharp.
  */
  // Only the first frame holds the true preview ratio; on later frames
  // the canvas ratio is already 1, so storing it would lose the original.
  if (recordSize === null) previewPixelRatio = prevPixelRatio;

  const rs = renderSize(gl, opts.width, opts.height);
  recordSize = { w: rs.w, h: rs.h };
  // Stop the loop; see SceneRefs.setFrameloop. The keepSize path
  // (frame-by-frame video) keeps the loop running intentionally.
  if (!opts.keepSize) refs.setFrameloop?.('never');
  try {
    gl.setPixelRatio(1);
    gl.setSize(rs.w, rs.h, false);
    camera.aspect = opts.width / opts.height;
    camera.updateProjectionMatrix();
    mark('setSize');

    if (pipeline) {
      // Redraw text at render resolution: stretching the preview texture
      // to 4K blurred headings. With SSAA, text also renders at 2×
      // and is downsampled with the image for cleaner edges.
      overlayDraw?.(rs.w, rs.h);
      mark('overlay');
      pipeline.render(rs.w, rs.h, rs.h / Math.max(1, prevSize.y));
    } else {
      gl.render(scene, camera);
    }
    // In debug mode, drain the GPU queue so deferred work is not charged to toBlob.
    if (dbg) gl.getContext().finish();
    mark('render');

    /*
      Downsample and composite in one 2D canvas: reduce SSAA output to target size and add white for
      JPEG. JPEG has no alpha; direct toBlob with a transparent background turned transparent pixels
      black. PNG keeps alpha without a fill; downsampling blends alpha correctly too. Without SSAA, PNG
      skips compositing and uses the original path unchanged.
    */
    let source: HTMLCanvasElement = gl.domElement;
    const flatten = opts.mime === 'image/jpeg' || !!opts.opaque;
    const needsComposite = rs.scale !== 1 || flatten;
    if (needsComposite) {
      const tmp = document.createElement('canvas');
      tmp.width = opts.width;
      tmp.height = opts.height;
      // Use alpha:false only when flattening; it determines the PNG color type.
      const ctx = tmp.getContext('2d', flatten ? { alpha: false } : undefined);
      if (ctx) {
        if (flatten) {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, opts.width, opts.height);
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(gl.domElement, 0, 0, opts.width, opts.height);
        source = tmp;
      }
    }

    mark('compose');
    const blob = await new Promise<Blob | null>((resolve) =>
      // JPEG defaults to 0.95 for mockup/store-image output;
      // 0.92 left room for visible quality improvement.
      source.toBlob(resolve, opts.mime, opts.quality ?? 0.95),
    );
    mark('toBlob');
    if (!blob) throw new Error('Frame capture failed');
    return blob;
  } finally {
    if (!opts.keepSize) {
      refs.setFrameloop?.('always');
      recordSize = null;
      gl.setPixelRatio(prevPixelRatio);
      gl.setSize(prevSize.x, prevSize.y, false);
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
      if (pipeline) {
        overlayDraw?.(prevSize.x, prevSize.y);
        pipeline.render(prevSize.x, prevSize.y, 1);
      } else {
        gl.render(scene, camera);
      }
      mark('restore');
    }
  }
}

/**
 * Diagnostics (localhost debug only): render the preview pipeline frames times, wait for the GPU,
 * and return ms/frame. Since rAF is capped at 60, this reveals frame-time headroom; it was used to
 * choose the jitter sample count.
 */
export function benchPipeline(frames = 60): number {
  if (!refs || !pipeline) return -1;
  const { gl } = refs;
  const size = gl.getSize(new THREE.Vector2());
  const ctx = gl.getContext();
  // finish() does not wait for the GPU in ANGLE (measured: 0.1 ms); reading one pixel does.
  const px = new Uint8Array(4);
  const sync = () => ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
  sync();
  const t0 = performance.now();
  for (let i = 0; i < frames; i += 1) {
    pipeline.render(size.x, size.y, 1);
    sync();
  }
  return (performance.now() - t0) / frames;
}

/** Restore the preview once after sequential capture. */
export function restorePreview(w: number, h: number) {
  if (!refs) return;
  const { gl, scene, camera } = refs;
  recordSize = null;
  gl.setPixelRatio(previewPixelRatio ?? Math.min(window.devicePixelRatio || 1, 2));
  gl.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (pipeline) {
    overlayDraw?.(w, h);
    pipeline.render(w, h, 1);
  } else {
    gl.render(scene, camera);
  }
}

/**
 * Set the playhead and wait for the scene to settle before single-frame capture. captureFrame does
 * not update the camera (useFrame); it renders the last pose. Capturing immediately after
 * setPlayhead saves the old pose or scene. Match recordFrames' two-step contract: useFrame applies
 * camera and scene selection, then React renders the new content.
 */
export async function settleAt(seek: () => void): Promise<void> {
  if (!refs) throw new Error('Scene is not ready');
  const r = refs;
  const useAdvance = !!r.advance && !!r.setFrameloop;
  const tick0 = () => new Promise<void>((res) => setTimeout(res, 0));
  const nextFrame = () => new Promise<void>((res) => requestAnimationFrame(() => res()));
  if (useAdvance) r.setFrameloop!('never');
  try {
    seek();
    const stepOnce = async () => {
      if (useAdvance) {
        await tick0();
        r.advance!(performance.now());
      } else {
        await nextFrame();
      }
    };
    await stepOnce();
    await stepOnce();
    await settleToShot(stepOnce);
    // The new scene's device model or image may not be loaded yet.
    await Promise.all([waitForModels(projectDeviceIds()), ensureProjectImages()]);
    await settleVideo(stepOnce);
  } finally {
    if (useAdvance) r.setFrameloop!('always');
  }
}

/** Choose the first video format supported by the browser. */
export function pickVideoMime(): string | null {
  // Browsers without MediaRecorder threw a ReferenceError here;
  // this runs during export-menu rendering, so opening the menu failed.
  // Its absence means video recording is unavailable, not an error.
  if (typeof MediaRecorder === 'undefined') return null;
  const candidates = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export type RecordOptions = {
  durationMs: number;
  fps: number;
  /** Target resolution; the canvas keeps this size throughout recording. */
  width: number;
  height: number;
  /** Bitrate (bps), shown as High/Medium/Low in the panel. */
  bitrate: number;
  /** Low-cost motion blur that trails camera movements (AfterimagePass). */
  /** 0..1 — AfterimagePass damping; 0 = off. */
  motionBlur: number;
  /**
   * Required container/codec. Transparent video: 'video/webm;codecs=vp8'. In the measured Chrome
   * version, WebCodecs alpha:'keep' is unsupported; MediaRecorder VP8 preserves alpha, VP9 does not.
   */
  mime?: string;
};

/**
 * Frame-by-frame recording (WebCodecs): drive time explicitly. Set the playhead, confirm the scene
 * is rendered, then encode each frame. Slower machines take longer, but frame count and duration
 * stay independent of wall-clock time; preview stutters never enter the file. Wait two frames after
 * seek: useFrame applies the camera and any scene change, then React renders the new content.
 * Waiting only one saves old content with the new camera, breaking scene boundaries.
 */
export async function recordFrames(opts: {
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  bitrate: number;
  motionBlur: number;
  seek: (t: number) => void;
  onProgress?: (ratio: number) => void;
  /** Offline-mixed audio, if available. */
  audio?: AudioBuffer | null;
  /** AAC bitrate (bps); defaults to the WebCodecs value when omitted. */
  audioBitrate?: number;
  /**
   * SSAA: render above target size and downsample (see supersampleScale). This costs ~4× pixels per
   * frame, so only Quality=High enables it; Medium/Low retain the fast path.
   */
  supersample?: boolean;
}): Promise<Blob> {
  return withFrameDriver(opts, (render, canvas) =>
    exportFrameByFrame({
      width: opts.width,
      height: opts.height,
      fps: opts.fps,
      durationSec: opts.durationSec,
      bitrate: opts.bitrate,
      canvas,
      onProgress: opts.onProgress,
      audio: opts.audio ?? null,
      audioBitrate: opts.audioBitrate,
      renderFrame: (t) => render(t, opts.seek),
    }),
  );
}

/**
 * Frame sequences (GIF, PNG): the same frame-by-frame path as MP4, with identical size, jitter/AA
 * and two-step advancement, but send frames to onFrame instead of the encoder. If times is
 * supplied, render only those timestamps (the GIF palette uses a few sample frames); otherwise use
 * 0, 1/fps, 2/fps … with MP4's frame count: round(duration × fps).
 */
export async function renderSequence(opts: {
  width: number;
  height: number;
  fps: number;
  durationSec: number;
  motionBlur: number;
  supersample?: boolean;
  seek: (t: number) => void;
  times?: number[];
  onProgress?: (ratio: number) => void;
  onFrame: (canvas: HTMLCanvasElement, index: number, total: number) => Promise<void> | void;
}): Promise<void> {
  const times =
    opts.times ??
    Array.from({ length: Math.max(1, Math.round(opts.durationSec * opts.fps)) }, (_, i) => i / opts.fps);
  await withFrameDriver(opts, async (render, canvas) => {
    for (let i = 0; i < times.length; i += 1) {
      await render(times[i], opts.seek);
      await opts.onFrame(canvas, i, times.length);
      opts.onProgress?.((i + 1) / times.length);
    }
  });
}

/**
 * Shared frame-by-frame setup and cleanup: resize the buffer, manually step R3F, then restore the
 * preview. render(t) uses the full pipeline (overlay + effects); canvas is the output source, or
 * the target-size downsampling canvas with SSAA.
 */
async function withFrameDriver<T>(
  opts: { width: number; height: number; motionBlur: number; supersample?: boolean },
  body: (render: (t: number, seek: (t: number) => void) => Promise<void>, canvas: HTMLCanvasElement) => Promise<T>,
): Promise<T> {
  if (!refs) throw new Error('Scene is not ready');
  /*
    Wait for images too: a scene without its texture initially renders a white screen that enters the
    file (observed in the first two frames of scene 2). Cache all project images so each scene's
    first frame has its texture ready.
  */
  await Promise.all([waitForModels(projectDeviceIds()), ensureProjectImages()]);
  const { gl, scene, camera } = refs;
  const prevSize = new THREE.Vector2();
  gl.getSize(prevSize);
  const prevPixelRatio = gl.getPixelRatio();
  previewPixelRatio = prevPixelRatio;
  const prevAspect = camera.aspect;

  const rs = opts.supersample
    ? renderSize(gl, opts.width, opts.height)
    : { w: opts.width, h: opts.height, scale: 1 };
  /*
    With SSAA, give the encoder the downsampling canvas, not the GL canvas. VideoFrame must use
    target size, or the file will have 2× the selected resolution.
  */
  const down =
    rs.scale === 1
      ? null
      : (() => {
          const c = document.createElement('canvas');
          c.width = opts.width;
          c.height = opts.height;
          const ctx = c.getContext('2d');
          if (!ctx) return null;
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          return { c, ctx };
        })();

  gl.setPixelRatio(1);
  gl.setSize(rs.w, rs.h, false);
  camera.aspect = opts.width / opts.height;
  camera.updateProjectionMatrix();
  recordSize = { w: rs.w, h: rs.h };
  motionBlur = opts.motionBlur;

  /*
    Frame advancement without vsync waits. Previously two rAFs per frame added 2×16.7 ms ≈33 ms of
    idle time; a 6 s 1080p30 clip took 17 s. Set the loop to 'never' and use R3F advance() manually.
    Preserve the two-step contract: useFrame applies camera/scene selection, then React renders the
    new content. setTimeout(0) between steps lets React commit; a microtask is insufficient because
    the scheduler needs a macrotask. Fall back to rAF if the advance bridge is unavailable in older
    registrations.
  */
  const refsNow = refs;
  const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  const tick0 = () => new Promise<void>((r) => setTimeout(r, 0));
  const useAdvance = !!refsNow.advance && !!refsNow.setFrameloop;
  const step = async () => {
    if (useAdvance) {
      await tick0();
      refsNow.advance!(performance.now());
    } else {
      await nextFrame();
    }
  };
  if (useAdvance) refsNow.setFrameloop!('never');

  try {
    return await body(async (t, seek) => {
      seek(t);
      await step();
      await step();
      await settleToShot(step);
      await settleVideo(step);
      // Render the final frame explicitly: R3F's own render may use
      // preview dimensions; export must pass through the full pipeline.
      overlayDraw?.(rs.w, rs.h);
      if (pipeline) pipeline.render(rs.w, rs.h, rs.h / Math.max(1, prevSize.y));
      else gl.render(scene, camera);
      if (down) down.ctx.drawImage(gl.domElement, 0, 0, opts.width, opts.height);
    }, down ? down.c : gl.domElement);
  } finally {
    if (useAdvance) refsNow.setFrameloop!('always');
    recordSize = null;
    motionBlur = 0;
    gl.setPixelRatio(prevPixelRatio);
    gl.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
  }
}

/**
 * Record the canvas at target resolution for the given duration. The stream captures the scene's
 * existing per-frame rendering. Keep the buffer at target size without changing preview CSS
 * (setSize(w,h,false)); the preview intentionally shows the target aspect ratio until recording
 * ends.
 */
export function recordCanvas(opts: RecordOptions): Promise<Blob> {
  if (!refs) return Promise.reject(new Error('Scene is not ready'));
  const mime = opts.mime && MediaRecorder.isTypeSupported(opts.mime) ? opts.mime : pickVideoMime();
  if (!mime) return Promise.reject(new Error('This browser cannot record video'));

  const { gl } = refs;
  const prevSize = new THREE.Vector2();
  gl.getSize(prevSize);
  const prevPixelRatio = gl.getPixelRatio();
  previewPixelRatio = prevPixelRatio;

  gl.setPixelRatio(1);
  gl.setSize(opts.width, opts.height, false);
  recordSize = { w: opts.width, h: opts.height };
  realtimeRecording = true;
  motionBlur = opts.motionBlur;

  let videoStream: MediaStream | null = null;
  const restore = () => {
    recordSize = null;
    realtimeRecording = false;
    motionBlur = 0;
    gl.setPixelRatio(prevPixelRatio);
    gl.setSize(prevSize.x, prevSize.y, false);
  };

  /*
    Audio: canvas streams carry only video. Add project audio tracks from the AudioContext
    destination to the same MediaStream so downloaded files include music heard in preview. Protect
    setup too: size and recording flags change before stream/recorder creation. If new MediaRecorder
    throws for an unsupported bitrate/container, restore must still run or the preview remains at
    export size with recording flags set.
  */
  let recorder: MediaRecorder;
  try {
    videoStream = gl.domElement.captureStream(opts.fps);
    const audio = audioTracksForRecording();
    const stream = audio.length
      ? new MediaStream([...videoStream.getVideoTracks(), ...audio])
      : videoStream;
    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: opts.bitrate,
    });
  } catch (e) {
    videoStream?.getTracks().forEach((t) => t.stop());
    restore();
    return Promise.reject(e instanceof Error ? e : new Error('Recording failed'));
  }
  const chunks: BlobPart[] = [];

  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    recorder.onerror = () => {
      restore();
      reject(new Error('Recording failed'));
    };
    recorder.onstop = () => {
      // Video tracks only: audio tracks belong to the bridge's shared recording destination.
      videoStream?.getVideoTracks().forEach((t) => t.stop());
      restore();
      resolve(new Blob(chunks, { type: mime }));
    };
    recorder.start();
    setTimeout(() => recorder.stop(), opts.durationMs);
  });
}

/** Download a Blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
