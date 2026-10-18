import { assetUrl } from './assets';
import { warpToQuad, type P } from './warp';
import { mediaQuad, quadToCss } from './homography';
import { deviceLayout } from './layout';
import { paintShadow } from './shadow';
import { statusTint } from './tint';
import { DEVICES } from '@photo/config/ui';
import { loadOptional, paintBackground, paintBranding, type DecorState } from './decor';
import type { PhotoState } from '@photo/store/photo';

/**
 * Heavy assets that must not reload per frame in the video loop.
 * exportVideo prepares and passes them once; exportPng omits them
 * and lets renderFrame load them.
 */
export type Preloaded = {
  bgImage: HTMLImageElement | null;
  appLogo: HTMLImageElement | null;
  /** Background video plays throughout the loop without per-frame recreation. */
  bgVideo: HTMLVideoElement | null;
  /** Hand/scene image in photo mode. */
  photo: HTMLImageElement | null;
};

export type ExportOpts = {
  state: PhotoState;
  size: number;
  watermark: boolean;
  /** Prepared source to avoid reloading on every video frame. */
  mediaEl?: CanvasImageSource | null;
  /** Prepared background/logo/background video/photo; otherwise loaded per frame. */
  preloaded?: Preloaded | null;
  /** Emoji animation time in seconds; 0 for still images. */
  time?: number;
};

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Image could not be loaded: ' + src));
    img.src = src;
  });
}

function loadVideo(src: string): Promise<HTMLVideoElement> {
  return new Promise((res, rej) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.playsInline = true;
    // Some codecs fire loadeddata before a usable frame, producing black.
    // Seek slightly and wait for seeked to ensure the first frame is ready.
    v.onseeked = () => res(v);
    v.onloadeddata = () => {
      if (v.currentTime === 0) v.currentTime = 0.001;
      else res(v);
    };
    v.onerror = () => rej(new Error('Video could not be loaded'));
    v.src = src;
  });
}

function srcSize(src: CanvasImageSource) {
  const v = src as HTMLVideoElement;
  if (typeof v.videoWidth === 'number' && v.videoWidth) return { w: v.videoWidth, h: v.videoHeight };
  const i = src as HTMLImageElement;
  return {
    w: i.naturalWidth || (i as unknown as HTMLCanvasElement).width,
    h: i.naturalHeight || (i as unknown as HTMLCanvasElement).height,
  };
}

/** Cover the short edge and crop overflow, matching preview object-cover. */
function drawCover(ctx: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number) {
  const { w: sw, h: sh } = srcSize(src);
  if (!sw || !sh) return;
  const scale = Math.max(w / sw, h / sh);
  ctx.drawImage(src, (w - sw * scale) / 2, (h - sh * scale) / 2, sw * scale, sh * scale);
}

/**
 * Status bar icons use the same geometry as the preview SVGs.
 * Different signal/Wi-Fi/battery shapes would make output diverge.
 */
function statusBar(ctx: CanvasRenderingContext2D, w: number, h: number, tint = '#000000') {
  const fs = Math.max(9, w * 0.045);
  const y = h * 0.022;
  ctx.save();
  ctx.fillStyle = tint;
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText('9:41', w * 0.07, y);

  // Right-aligned 36x10 icon strip.
  const gh = Math.max(6, w * 0.038);
  const gw = gh * 3.6;
  const gx = w - w * 0.07 - gw;
  const k = gh / 10;
  ctx.translate(gx, y + (fs - gh) / 2);
  ctx.scale(k, k);

  const bar = (x: number, top: number) => {
    roundRect(ctx, x, top, 2, 10 - top, 0.6);
    ctx.fill();
  };
  bar(0, 6);
  bar(3.2, 4.4);
  bar(6.4, 2.6);
  bar(9.6, 1);

  // Wi-Fi: two arcs and a dot.
  ctx.beginPath();
  ctx.arc(19.2, 8.6, 5.4, Math.PI * 1.25, Math.PI * 1.75);
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = tint;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(19.2, 8.6, 2.9, Math.PI * 1.25, Math.PI * 1.75);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(19.2, 8.2, 0.9, 0, Math.PI * 2);
  ctx.fill();

  // Battery.
  ctx.lineWidth = 1;
  roundRect(ctx, 26, 1.6, 8.4, 6.8, 1.8);
  ctx.stroke();
  roundRect(ctx, 27.2, 2.8, 6, 4.4, 1);
  ctx.fill();
  roundRect(ctx, 35, 3.8, 1, 2.4, 0.5);
  ctx.fill();

  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/**
 * Screen canvas: intermediate layer built before warping in photo mode.
 *
 * Directly warping media stretches it instead of matching preview object-cover
 * cropping, and loses the status bar. Draw everything onto a canvas with
 * the screen's aspect ratio before warping.
 *
 * Reuse this canvas until dimensions change, avoiding ~120 allocations per
 * video export. Unlike WebGL, 2D contexts have no count limit, but reuse
 * is inexpensive. The returned canvas is shared; callers must warp it
 * immediately and copy the result.
 */
let SCREEN_CV: HTMLCanvasElement | null = null;

/**
 * Screen canvas.
 *
 * ⚠️ Outset prevents leaks; it must not change content layout.
 * Extend media beyond the alpha cutout by MEDIA_OUTSET to prevent background
 * leakage. Laying out content against that larger rectangle enlarged it
 * by ~3%, hiding screenshot edges ("Terracotta" → "rracotta") and pushing
 * the status bar beyond the real screen, under the bezel.
 *
 * Inset content by the outset amount. Fill the outer ring with an extended
 * copy of edge media, hidden under the bezel; align content and status bar
 * to the actual screen rectangle.
 */
function screenCanvas(
  w: number,
  h: number,
  src: CanvasImageSource | null,
  sb: boolean,
  pad: { x: number; y: number } = { x: 0, y: 0 },
) {
  const tint = statusTint(src);
  const cw = Math.max(2, Math.round(w));
  const ch = Math.max(2, Math.round(h));
  const cv = SCREEN_CV ?? (SCREEN_CV = document.createElement('canvas'));
  if (cv.width !== cw || cv.height !== ch) {
    cv.width = cw;
    cv.height = ch;
  }
  const ctx = cv.getContext('2d')!;
  // Clear the reused canvas to remove the previous frame.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cv.width, cv.height);
  const px = Math.max(0, Math.round(pad.x));
  const py = Math.max(0, Math.round(pad.y));
  const iw = Math.max(2, cw - px * 2);
  const ih = Math.max(2, ch - py * 2);
  if (src) {
    // 1) Leak-prevention copy fills the ring beneath the bezel.
    if (px || py) drawCover(ctx, src, cw, ch);
    // 2) Actual content aligns exactly with the cutout.
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, iw, ih);
    ctx.clip();
    ctx.translate(px, py);
    drawCover(ctx, src, iw, ih);
    ctx.restore();
  }
  // Align the status bar to the real screen, not the outset.
  if (sb) {
    ctx.save();
    ctx.translate(px, py);
    statusBar(ctx, iw, ih, tint);
    ctx.restore();
  }
  return cv;
}

function watermarkOn(ctx: CanvasRenderingContext2D, size: number, lift = 0) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#8a8a8a';
  ctx.font = `700 ${Math.round(size * 0.05)}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText('mockuptop', size - size * 0.035, size - size * 0.025 - lift);
  ctx.restore();
}

/** Composite one frame for both bare-device and photo modes. */
export async function renderFrame(opts: ExportOpts): Promise<HTMLCanvasElement> {
  const { state: s, size, watermark, mediaEl } = opts;

  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;

  // Use the same background and emoji-pattern function as the preview.
  const pre = opts.preloaded;
  const [bgImg, logoImg] = pre
    ? [pre.bgImage, pre.appLogo]
    : await Promise.all([loadOptional(s.bgImage), loadOptional(s.appLogo)]);
  // Draw the background video's current frame.
  const bgVid = pre
    ? pre.bgVideo
    : s.bgMode === 'Video' && s.bgVideo
      ? await loadVideo(s.bgVideo)
      : null;
  const decor: DecorState = {
    bgMode: s.bgMode,
    bgColor: s.bgColor,
    bgImage: bgImg,
    bgVideoFrame: bgVid,
    bgEmojis: s.bgEmojis,
    pattern: s.pattern,
    time: opts.time ?? 0,
    appLogo: logoImg,
    appName: s.appName,
  };
  paintBackground(ctx, size, decor);

  const src =
    mediaEl ??
    (s.media ? (s.media.type === 'video' ? await loadVideo(s.media.url) : await loadImage(s.media.url)) : null);

  const source = s.source;
  if (source?.kind === 'device' || source?.kind === 'bare') {
    // Frameless mode uses generic Pro dimensions with zero bezel.
    const bare = source.kind === 'bare';
    const d = bare ? DEVICES[0] : DEVICES.find((x) => x.id === source.id);
    if (d) {
      const { x, y, w, h } = deviceLayout(size, d.w, d.h, s.zoom);
      const r = w * d.radius;
      const bezel = bare ? 0 : w * d.bezel;

      // Tilt around the body's center, matching the preview CSS rotation.
      ctx.save();
      if (s.tilt) {
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate((s.tilt * Math.PI) / 180);
        ctx.translate(-(x + w / 2), -(y + h / 2));
      }

      // Share shadow and body rendering with the preview's 10-level ramp.
      if (!bare) paintShadow(ctx, s.shadow, { x, y, w, h, r }, d.body);

      const sx = x + bezel;
      const sy = y + bezel;
      const sw = w - bezel * 2;
      const shh = h - bezel * 2;
      ctx.save();
      roundRect(ctx, sx, sy, sw, shh, Math.max(0, r - bezel));
      ctx.clip();
      ctx.fillStyle = '#fff';
      ctx.fillRect(sx, sy, sw, shh);
      ctx.translate(sx, sy);
      if (src) drawCover(ctx, src, sw, shh);
      if (s.showStatusBar) statusBar(ctx, sw, shh, statusTint(src));
      ctx.restore();

      if (d.island && s.showIsland !== false) {
        ctx.save();
        ctx.fillStyle = '#000';
        roundRect(ctx, x + w / 2 - w * 0.15, y + bezel + w * 0.03, w * 0.3, w * 0.075, w * 0.0375);
        ctx.fill();
        ctx.restore();
      }

      // Thin dark ring in frameless mode only.
      if (bare && s.deviceBorder === 'Border') {
        ctx.save();
        ctx.strokeStyle = '#000';
        ctx.lineWidth = Math.max(1, w * 0.014);
        roundRect(ctx, x, y, w, h, r);
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
  } else if (source?.kind === 'photo') {
    const asset = s.assets.find((a) => a.id === source.id);
    if (asset) {
      {
        // Draw the screen even without media: white fill and status bar,
        // matching the preview. Use the same expanded quad as the preview;
        // a fixed 2px margin did not scale and remained narrower than the cutout.
        const mq = mediaQuad(asset.quad);
        const box = quadToCss(mq, size);
        /*
          The expanded quad prevents leaks; content must fit the actual hole.
          Inset by their difference to avoid enlarging screenshots by ~3%,
          cropping their edges, and pushing the status bar beneath the bezel.
        */
        const trueBox = quadToCss(asset.quad, size);
        const pad = {
          x: Math.max(0, (box.width - trueBox.width) / 2),
          y: Math.max(0, (box.height - trueBox.height) / 2),
        };
        const screen = screenCanvas(box.width, box.height, src, s.showStatusBar, pad);
        ctx.drawImage(warpToQuad(screen, mq as [P, P, P, P], size), 0, 0);
      }
      const photo = pre?.photo ?? (await loadImage(assetUrl(asset, 'preview')));
      ctx.drawImage(photo, 0, 0, size, size);
    }
  }

  paintBranding(ctx, size, decor);
  // Move the watermark upward to avoid the lower-right brand label.
  if (watermark) watermarkOn(ctx, size, s.appName || s.appLogo ? size * 0.075 : 0);
  return cv;
}

export async function exportPng(opts: ExportOpts, filename: string) {
  const cv = await renderFrame(opts);
  const blob: Blob | null = await new Promise((r) => cv.toBlob(r, 'image/png'));
  if (!blob) throw new Error('PNG could not be produced');
  download(blob, filename);
}

/**
 * Frame scheduler.
 *
 * requestAnimationFrame freezes in background tabs (a measured 22-second
 * delay), stalling export indefinitely at 0% when users switch tabs.
 * A worker timer avoids that restriction. Fall back to rAF if creating
 * the worker fails, for example because of CSP.
 */
function frameTicker(fps: number, onTick: () => void): () => void {
  try {
    const src = 'let i;onmessage=e=>{clearInterval(i);if(e.data)i=setInterval(()=>postMessage(0),e.data)}';
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = () => onTick();
    w.postMessage(Math.max(1, Math.round(1000 / fps)));
    return () => {
      w.terminate();
      URL.revokeObjectURL(url);
    };
  } catch {
    let raf = 0;
    const loop = () => {
      onTick();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }
}

/**
 * Video export for screen recordings and animated compositions.
 * Prepare heavy assets once outside the loop; only drawing runs per frame.
 */
export async function exportVideo(
  opts: ExportOpts,
  filename: string,
  onProgress?: (t: number) => void,
): Promise<void> {
  const { state: s, size } = opts;

  /**
   * Video output also supports animated emoji patterns over still images.
   * Keep Video enabled and record a fixed duration when media has no video.
   */
  const hasVideo = s.media?.type === 'video';
  const STILL_SECONDS = 4;

  let video: HTMLVideoElement | null = null;
  if (hasVideo) {
    video = document.createElement('video');
    video.src = s.media!.url;
    video.muted = true;
    video.playsInline = true;
    await new Promise<void>((res, rej) => {
      video!.onloadedmetadata = () => res();
      video!.onerror = () => rej(new Error('Video could not be loaded'));
    });
  }

  /**
   * Prepare heavy assets once outside the loop. Loading them in renderFrame
   * recreated the background video each frame, freezing it at 0.001 seconds:
   * a playing preview became a still background in the output.
   */
  const src = s.source;
  const photoAsset = src?.kind === 'photo' ? s.assets.find((a) => a.id === src.id) : null;
  const preloaded: Preloaded = {
    bgImage: await loadOptional(s.bgImage),
    appLogo: await loadOptional(s.appLogo),
    bgVideo: s.bgMode === 'Video' && s.bgVideo ? await loadVideo(s.bgVideo) : null,
    photo: photoAsset ? await loadImage(assetUrl(photoAsset, 'preview')) : null,
  };
  // Load still images once too; reuse mediaEl for this.
  const stillMedia = !hasVideo && s.media ? await loadImage(s.media.url) : null;

  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;

  /*
    Measured: MediaRecorder encodes no frames in background tabs, even with
    captureStream(0) and manual requestFrame calls. Background recording is
    therefore unavailable; finish the loop on time and use the empty-file
    check below to show a clear error.
  */
  const stream = cv.captureStream(30);

  const mime = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1')
    ? 'video/mp4;codecs=avc1'
    : 'video/webm;codecs=vp9';
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<Blob>((res) => {
    rec.onstop = () => res(new Blob(chunks, { type: mime.split(';')[0] }));
  });

  rec.start();
  if (video) await video.play();
  if (preloaded.bgVideo) {
    preloaded.bgVideo.loop = true;
    // If autoplay is denied, keep a frozen background without aborting export.
    await preloaded.bgVideo.play().catch(() => {});
  }
  const t0 = performance.now();
  // Fall back to a fixed duration if the media video's duration is unknown.
  const clipSeconds =
    video && isFinite(video.duration) && video.duration > 0 ? video.duration : STILL_SECONDS;

  let stopTicker = () => {};
  try {
    /**
     * Drawing errors were silently swallowed, leaving the promise pending,
     * skipping rec.stop(), and hanging export forever. Propagate them now.
     */
    await new Promise<void>((res, rej) => {
      let drawing = false;
      let finished = false;
      const finish = () => {
        finished = true;
        res();
      };
      const tick = async () => {
        // Avoid overlapping frames when drawing runs late.
        if (finished || drawing) return;
        drawing = true;
        try {
          const elapsed = (performance.now() - t0) / 1000;
          // Browsers may suspend background video; resume if it has not ended.
          if (video && video.paused && !video.ended) void video.play().catch(() => {});
          /*
            Stop by the video's own time, not wall time. Generating 2160px
            frames can be slower than real time; wall time would truncate
            long clips. stalled is only a safeguard against infinite loops
            when the browser suspends video and freezes currentTime.
          */
          const stalled = elapsed > clipSeconds * 3 + 10;
          const clipDone = video
            ? video.ended || video.currentTime >= clipSeconds - 0.05 || stalled
            : elapsed >= STILL_SECONDS;
          if (clipDone) return finish();
          const frame = await renderFrame({
            ...opts,
            mediaEl: video ?? stillMedia,
            preloaded,
            time: elapsed,
          });
          ctx.clearRect(0, 0, size, size);
          ctx.drawImage(frame, 0, 0);
          onProgress?.(video ? (video.duration ? video.currentTime / video.duration : 0) : elapsed / STILL_SECONDS);
        } catch (e) {
          rej(e);
        } finally {
          drawing = false;
        }
      };
      if (video) video.onended = () => finish();
      stopTicker = frameTicker(30, tick);
    });
  } finally {
    stopTicker();
    preloaded.bgVideo?.pause();
    rec.stop();
  }

  const blob = await done;
  // Report an error instead of downloading an empty file so users know what happened.
  if (!blob.size) throw new Error('Video could not be recorded — no frames were captured');
  download(blob, filename.replace(/\.\w+$/, mime.startsWith('video/mp4') ? '.mp4' : '.webm'));
}

export function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
