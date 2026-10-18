'use client';

import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, PerformanceMonitor, RoundedBox } from '@react-three/drei';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { clampVideoRate, evaluateShot, shotAtTime, shotStart, textIn, totalDuration, useEditor } from '@/store/editor';
import { contentRect, getDevice, type Device, type DeviceFinish } from '@/config/devices';
import { getDeviceModel, loadDeviceModel, modelsSettled, modelsVersion, subscribeModels } from './deviceModels';
import { getBackground, toCss, type Background } from '@/config/backgrounds';
import {
  ENV_PRESETS,
  getHdriEnvironment,
  getHdriGlowEnvironment,
  getStudioEnvironment,
  hdriVersion,
  subscribeHdri,
  type ScreenGlow,
} from './environment';
import { averageColor, cachedAverageColor, colorFromScreenBg, quantize } from './screenGlow';
import { ViewportGuides } from './ViewportGuides';
import { AutoMotionOverlay } from './AutoMotionOverlay';
import { useCanvasControls } from './useCanvasControls';
import { roundedPlateGeometry, roundedRingGeometry, roundedScreenGeometry } from './geometry';
import { drawOverlay, makeOverlayMesh, setLogoLoadedHandler } from './overlay';
import { PostProcessing, setPreviewJitter } from './PostProcessing';
import { jitterLevel } from './jitterPass';
import { ensureFont } from '@/config/fonts';
import { getStatusBarTexture } from './statusBar';
import { createMarksSurface, drawScreenMarks, registerMarksLayer, unregisterMarksLayer } from './screenMarks';
import { AnnotationPlaceOverlay } from './AnnotationPlaceOverlay';
import { screenUiActive, screenUiLayout, screenUiTexture } from './screenUi';
import { Stage3D } from './stage3d';
import { getAspect } from '@/config/aspects';
import { BRAND } from '@/config/brand';
import { MOTION_PRESETS, ZOOM_FIT, sampleMotion } from '@/config/motion';
import { evaluateTrack, isSlotPath } from '@/config/tracks';
import { syncAudio } from './audioBridge';
import { getRecordSize, noteCommittedShot, registerOverlayDraw, registerScene, trackVideoSeek } from './exportBridge';
import { cacheDecodedImage, loadImageTexture, setWarmRenderer, startProjectImageWarmer, textureCache } from './mediaTextures';
import { getHdrStudioEnvironment, studioVersion, subscribeStudio } from './hdrStudio';
import { lookdev, lookdevVersion, subscribeLookdev } from './lookdev';

/*
  Body geometry cache. Rebuilding each device body (RoundedBox, 6 segments) on mount cost ~70 ms per frame for the second phone in multi-device layouts, measured on each playback loop. Keyed by dimensions; no disposal.
*/
const bodyGeoCache = new Map<string, THREE.BufferGeometry>();
// Cache screen/bezel/glass plate geometry too: shape extrusion is expensive
// and repeated on every mount (~60 ms per loop in a pair layout).
const shapeGeoCache = new Map<string, THREE.BufferGeometry>();
function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = shapeGeoCache.get(key);
  if (!g) {
    g = make();
    shapeGeoCache.set(key, g);
  }
  return g;
}
/*
  Material cache, following the geometry cache pattern.
  Profiling both local startup and the first production scene boundary showed three.js `getParameters` + `getProgramCacheKey` dominating: material parameter derivation on every mount, rather than shader compilation. Switching devices rebuilt all ~16 scene materials.
  Two exclusions:
  - Textured materials: screen images vary by scene; sharing would show the wrong image.
  - Reflection copies: they mutate side/transparent/opacity/depthWrite in place and would corrupt shared materials.
  No disposal: a few dozen materials use a few hundred kilobytes.
*/
const materialCache = new Map<string, THREE.Material>();

function cachedMaterial<T extends THREE.Material>(key0: string, make: () => T): T {
  // Refresh the key when material look development (lookdev.ts) changes; production version is always 0.
  const v = lookdevVersion();
  const key = v ? `${key0}|ld${v}` : key0;
  let m = materialCache.get(key) as T | undefined;
  if (!m) {
    m = make();
    materialCache.set(key, m);
  }
  return m;
}

/**
 * Device body.
 * RoundedBoxGeometry was replaced: it applies one radius to every edge, limited to half the smallest dimension, which is phone thickness. For a 7.16 × 15.0 × 0.78 body, the requested 1.15 radius was clamped to 0.78/2 × 0.98 = 0.382, roughly one third. The nearly rectangular body protruded past the rounded screen (1.0) and bezel band (1.12) at all four corners. The camera island had the same issue (0.85 requested, 0.088 rendered).
 * Extrusion decouples corner radius from thickness; front/back bevels also provide thin edge highlights for product renders.
 */
function getBodyGeometry(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const key = `${w.toFixed(3)}|${h.toFixed(3)}|${d.toFixed(3)}|${r.toFixed(3)}`;
  let g = bodyGeoCache.get(key);
  if (!g) {
    // Limit the bevel to one fifth of the thickness and half the radius
    // to avoid distorting thin corners.
    const bevel = Math.max(0.001, Math.min(d * 0.2, r * 0.5));
    g = roundedPlateGeometry(w, h, r, d, bevel);
    bodyGeoCache.set(key, g);
  }
  return g;
}

/**
 * Laptop key grid.
 * Relative key widths by row must vary to read as a real keyboard: wider lower-left modifiers and a long bottom-row space bar. `InstancedMesh` renders ~60 keys in one draw call, adding real geometry at negligible scene cost.
 */
const KEY_ROWS: number[][] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
  [1.8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.2],
  [2.3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.7],
  [1.3, 1.3, 1.3, 6.1, 1.3, 1.3, 1.3],
];

function LaptopKeys({ width, depth, y, z }: { width: number; depth: number; y: number; z: number }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const total = useMemo(() => KEY_ROWS.reduce((n, r) => n + r.length, 0), []);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new THREE.Object3D();
    const gap = Math.min(width, depth) * 0.012;
    const rowD = depth / KEY_ROWS.length;
    let i = 0;
    KEY_ROWS.forEach((row, r) => {
      const units = row.reduce((n, u) => n + u, 0);
      const unitW = (width - gap * (row.length + 1)) / units;
      // Advance from the row's left edge so the initial layout is centered.
      let x = -width / 2 + gap;
      row.forEach((u) => {
        const kw = unitW * u;
        o.position.set(x + kw / 2, 0, -depth / 2 + rowD * (r + 0.5));
        o.scale.set(kw, 1, rowD - gap * 2);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
        i += 1;
        x += kw + gap;
      });
    });
    mesh.count = i;
    mesh.instanceMatrix.needsUpdate = true;
  }, [width, depth]);

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, total]} position={[0, y, z]}>
      {/* Unit box: matrix supplies scale; height stays thin and fixed. */}
      <boxGeometry args={[1, 0.05, 1]} />
      <meshStandardMaterial color="#2a2d34" roughness={0.62} metalness={0.18} />
    </instancedMesh>
  );
}

/** Solid frame finish: dark matte card body for BORDER style 'solid'. */
const SOLID_FRAME = {
  id: 'solid-frame', label: 'Solid', kind: 'metal' as const,
  body: '#17181c', metalness: 0.3, roughness: 0.5,
};

/**
 * Generate the background texture in code, without an image asset. Draw the gradient on a 2D canvas and use it as a texture; 2048 px covers all export sizes and allows instant config color changes.
 */
/*
  Background texture cache. Redrawing and uploading a 2048×2048 gradient (16 MB) at every scene change and loop caused transition stalls: measured boundary frames took 150–190 ms. Key: background ID (encoded string for custom gradients) + image + blur.
*/
const bgTextureCache = new Map<string, THREE.CanvasTexture>();
/*
  Bound the cache: keys include blur and custom gradient colors, so dragging either control previously retained a new 2048² canvas + texture at every intermediate value (16 MB per canvas, unbounded). Keep the most recently used entries (Map insertion order tracks use) and evict the oldest. Multi-scene projects can retain one background per scene; larger projects redraw once at a boundary rather than leak memory. If an evicted texture is still attached to a scene, three.js reuploads its canvas on the next draw, so disposal is safe.
*/
const BG_CACHE_MAX = 8;
function bgCacheTouch(key: string, tex: THREE.CanvasTexture) {
  bgTextureCache.delete(key);
  bgTextureCache.set(key, tex);
  while (bgTextureCache.size > BG_CACHE_MAX) {
    const [oldKey, oldTex] = bgTextureCache.entries().next().value as [string, THREE.CanvasTexture];
    bgTextureCache.delete(oldKey);
    oldTex.dispose();
  }
}
export function bgCacheSize() {
  return bgTextureCache.size;
}

function useBackgroundTexture(bg: Background, bgImage: string | null, bgBlur: number) {
  /*
    Custom background image: the user's photo overrides the gradient. Load asynchronously and show the gradient until ready so the background is never blank.
  */
  // An old image may remain in state; `url === bgImage` already
  // invalidates it, so no synchronous setState is needed in the effect.
  const [img, setImg] = useState<{ url: string; el: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!bgImage) return;
    let cancelled = false;
    const el = new Image();
    el.onload = () => {
      if (!cancelled) setImg({ url: bgImage, el });
    };
    el.src = bgImage;
    return () => {
      cancelled = true;
    };
  }, [bgImage]);

  const loaded = img && img.url === bgImage ? img.el : null;

  const tex = useMemo(() => {
    const cacheKey = `${bg.id}|${JSON.stringify(bg.stops)}|${bg.angle}|${bgImage ?? ''}|${bgImage ? bgBlur : 0}|${loaded ? 1 : 0}`;
    const hit = bgTextureCache.get(cacheKey);
    if (hit) {
      bgCacheTouch(cacheKey, hit);
      return hit;
    }
    const size = 2048;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    if (!ctx) return null;

    if (loaded) {
      /*
        BG BLUR is visible on photos, since gradients are already smooth. Oversize the image by the blur radius: ctx.filter leaves a faint edge vignette, and oversizing moves it outside the frame.
      */
      const blurPx = bgBlur * 40;
      ctx.filter = blurPx > 0.5 ? `blur(${blurPx}px)` : 'none';
      const scale = Math.max(size / loaded.naturalWidth, size / loaded.naturalHeight);
      const w = loaded.naturalWidth * scale + blurPx * 4;
      const h = loaded.naturalHeight * scale + blurPx * 4;
      ctx.drawImage(loaded, (size - w) / 2, (size - h) / 2, w, h);
      ctx.filter = 'none';
    } else {
      const rad = ((bg.angle - 90) * Math.PI) / 180;
      const half = size / 2;
      const dx = Math.cos(rad) * half;
      const dy = Math.sin(rad) * half;
      const grad = ctx.createLinearGradient(half - dx, half - dy, half + dx, half + dy);
      for (const s of bg.stops) grad.addColorStop(s.at, s.color);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);

      for (const b of bg.blobs ?? []) {
        const r = b.r * size;
        const g = ctx.createRadialGradient(b.x * size, b.y * size, 0, b.x * size, b.y * size, r);
        g.addColorStop(0, `${b.color}66`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, size, size);
      }
    }

    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    bgCacheTouch(cacheKey, t);
    return t;
  }, [bg, loaded, bgBlur, bgImage]);

  // No disposal here: the cache owns the texture to avoid rebuilding it when a scene returns.
  return tex;
}

/**
 * Convert a loaded image into a screen material.
 * Store the texture in state after loading, rather than during render. Previously `TextureLoader.load()` returned an empty texture that was attached immediately; the screen stayed black until loading, then remained black because the data did not trigger another frame.
 */
/**
 * Video source texture.
 * Unlike images, `VideoTexture` updates each frame and playback follows the timeline: pausing the scene pauses the video. Otherwise recording and video playback drifted independently during export.
 */
/*
  Video texture pixel budget. Measured: 1080×1440 (1.56 MP) plays in real time; 1620×2160 (3.50 MP) falls behind. Set the limit between them, near the working size. The device screen is already ~1000 px in a 1080p frame, so there is no visible quality loss.
*/
const VIDEO_TEX_BUDGET_PX = 1_600_000;

/** Source range [start, end), also used by the live playback guard. */
function videoRange(trim: { in: number; out: number | null }, dur: number): { start: number; end: number } {
  const end = dur > 0 ? Math.min(trim.out ?? dur, dur) : (trim.out ?? Infinity);
  let start = Math.max(0, trim.in ?? 0);
  // A split may advance the start beyond the video end for a looping clip.
  if (Number.isFinite(end) && end > 0 && start >= end) start %= end;
  return { start, end };
}

/**
 * Source video time visible at scene-local second `local`.
 * Use one calculation: live playback wrapped from `trim.out` to `trim.in`, with element `loop` covering the full video, while paused preview and frame-by-frame export ignored `trim.out` and froze on the final frame. Playback and downloads therefore showed different frames. Both now loop within [in, out], using the video end when out is absent, matching playback behavior.
 */
export function videoSourceTime(local: number, rate: number, trim: { in: number; out: number | null }, dur: number): number {
  const pos = Math.max(0, local) * clampVideoRate(rate);
  const { start, end } = videoRange(trim, dur);
  const span = end - start;
  const t = Number.isFinite(span) && span > 0.001 ? start + (pos % span) : start + pos;
  return dur > 0 ? Math.min(t, Math.max(0, dur - 0.02)) : t;
}

function useVideoTexture(
  url: string | null,
  playing: boolean,
  rate = 1,
  trim: { in: number; out: number | null } = { in: 0, out: null },
  /** Global start time of the scene containing this video, in seconds. */
  startSec = 0,
) {
  const [state, setState] = useState<{
    url: string;
    tex: THREE.Texture;
    el: HTMLVideoElement;
    aspect: number;
    /** Intermediate canvas path: draw the new frame onto the canvas. Absent on the direct path. */
    draw?: () => void;
  } | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;

    const el = document.createElement('video');
    el.src = url;
    el.crossOrigin = 'anonymous';
    el.loop = true;
    el.muted = true;
    el.playsInline = true;
    el.preload = 'auto';

    let stopPump: (() => void) | null = null;
    let made: THREE.Texture | null = null;

    /*
      The export gate also waits for loading: drawing a new scene before its video loaded produced a blank device screen at scene boundaries. `true` means React must attach the new texture afterward (one more step).
    */
    let loaded: () => void = () => {};
    trackVideoSeek(
      new Promise<void>((done) => {
        const guard = window.setTimeout(done, 4000);
        loaded = () => {
          window.clearTimeout(guard);
          done();
        };
      }),
      true,
    );

    el.onloadeddata = () => {
      loaded();
      if (cancelled) return;
      const vw = el.videoWidth;
      const vh = el.videoHeight;
      /*
        Videos also need mipmaps and anisotropy. VideoTexture defaults to neither; text-heavy screen recordings broke into crosshatch patterns as the device receded, while images using mipmaps stayed clean.
        ⚠️ The mip chain is rebuilt every video frame, with cost linear in pixel count. A 1620×2160 (3.5 MP) recording advanced only ~1 s during a 4 s scene, then froze; the same recording played at full speed at 1080×1440. Disabling mipmaps would restore the aliasing bug. Instead, downscale sources over budget through an intermediate canvas, making mip cost fixed and independent of source resolution. Smaller videos still use VideoTexture directly, preserving normal clip behavior.
      */
      const budget = VIDEO_TEX_BUDGET_PX;
      const scale = vw * vh > budget ? Math.sqrt(budget / (vw * vh)) : 1;

      if (scale >= 1) {
        const tex = new THREE.VideoTexture(el);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.center.set(0.5, 0.5);
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.anisotropy = 16;
        made = tex;
        setState({ url, tex, el, aspect: vw / vh });
        return;
      }

      // No rounding to powers of two: WebGL2 supports mipmaps for NPOT textures.
      const cw = Math.max(2, Math.round(vw * scale));
      const ch = Math.max(2, Math.round(vh * scale));
      const canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d', { alpha: false })!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.center.set(0.5, 0.5);
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = 16;

      const draw = () => {
        if (el.readyState < 2) return;
        ctx.drawImage(el, 0, 0, cw, ch);
        tex.needsUpdate = true;
      };
      draw();

      /*
        Drive the pump with `requestVideoFrameCallback`: run only for new frames, avoiding idle draws. Fall back to rAF if unsupported. The paused/seek path also calls `draw()` directly from `sync()` for frame-by-frame export.
      */
      const anyEl = el as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: () => void) => number;
        cancelVideoFrameCallback?: (id: number) => void;
      };
      if (typeof anyEl.requestVideoFrameCallback === 'function') {
        let id = 0;
        const tick = () => {
          draw();
          id = anyEl.requestVideoFrameCallback!(tick);
        };
        id = anyEl.requestVideoFrameCallback(tick);
        stopPump = () => anyEl.cancelVideoFrameCallback?.(id);
      } else {
        let raf = 0;
        const tick = () => {
          if (!el.paused) draw();
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        stopPump = () => cancelAnimationFrame(raf);
      }

      made = tex;
      setState({ url, tex, el, aspect: vw / vh, draw });
    };
    el.onerror = () => {
      loaded();
      console.error('[MOCKUPTOP] video failed to load', url);
    };

    return () => {
      loaded();
      cancelled = true;
      stopPump?.();
      el.pause();
      /*
        ⚠️ Do not clean up with `el.src = ''`: the empty string resolves to the page URL, which the element tries to load as video, triggering `error`. The still-attached `onerror` logged the old closure URL, producing a "video failed to load blob:..." error on every scene/media change and obscuring real failures. Detach the listener first, remove the source, then call `load()` to clear the buffer.
      */
      el.onerror = null;
      el.onloadeddata = null;
      el.removeAttribute('src');
      el.load();
      /*
        Release the dead texture. State previously retained this element; requesting the same URL again (e.g. an image-to-video scene boundary during export) matched `state.url === url` and rendered an element with its source removed: "texImage2D: no video", mipmap errors, and a black frame. Also release the GPU texture, which previously leaked on every video change.
      */
      setState((prev) => (prev && prev.el === el ? null : prev));
      made?.dispose();
    };
  }, [url]);

  const current = state && state.url === url ? state : null;

  // Bind playback to the timeline.
  useEffect(() => {
    const el = current?.el;
    if (!el) return;
    /*
      Speed and trim. Apply speed directly to the element; a guard keeps `currentTime` within the trimmed range. Native `loop` restarts the full video, outside that range, so wrap to `trim.in` when it escapes.
    */
    el.playbackRate = clampVideoRate(rate);
    const range = () => videoRange({ in: trim.in, out: trim.out }, el.duration || 0);
    const { start: inSec, end: outSec } = range();
    /*
      Wrap only during playback. Paused preview and frame-by-frame export get their position from the synchronization below. A second seek here, to `in` when a new scene's video attached, was invisible to the export gate and produced a black frame before decoding at scene boundaries (one frame measured at an image-to-video boundary).
    */
    if (playing && (el.currentTime < inSec || el.currentTime > outSec)) el.currentTime = inSec;
    const guard = () => {
      if (el.paused) return;
      const r = range();
      if (el.currentTime > r.end || el.currentTime < r.start) el.currentTime = r.start;
    };
    el.addEventListener('timeupdate', guard);
    if (playing) void el.play().catch(() => {});
    else el.pause();
    return () => el.removeEventListener('timeupdate', guard);
  }, [current, playing, rate, trim.in, trim.out]);

  /*
    Video ⇄ timeline.
    Previously both playback and VideoTexture updates ran only while `playing`. Frame-by-frame export and paused preview move the playhead manually, so video never advanced or uploaded a frame: the device screen was black. Measured: readyState 4, no error, paused=true, currentTime=0.
    R3F `useFrame` synchronization failed because this tree is outside Canvas ("Hooks can only be used within the Canvas component"). Subscribe to the store instead: seek and refresh the texture when the playhead changes.
    Use a layout effect: two scenes sharing a video retain the element and change only `startSec`/`trim`. The subscription initially seeks using old scene values; a passive effect corrected them after export had already drawn the frame. The first boundary frame therefore showed the previous scene's video in production (measured at frame 105). A layout effect runs during commit, registering the new seek with the gate before `settleToShot` completes.
  */
  useLayoutEffect(() => {
    const el = current?.el;
    const tex = current?.tex;
    if (!el || !tex) return;
    /*
      ⚠️ Synchronization used to silently skip while a video was seeking (readyState < 2). Changing speed and playhead together let the subscription seek at the old speed, then dropped the effect's correction at the new speed. Measured: a requested 2× speed landed at 2.00 s instead of 4.00 s. Retry once seeking finishes.
    */
    let retry = false;
    const sync = () => {
      const st = useEditor.getState();
      if (st.playing) return;
      if (el.readyState < 2) {
        if (!retry) {
          retry = true;
          el.addEventListener('seeked', again, { once: true });
          el.addEventListener('loadeddata', again, { once: true });
        }
        return;
      }
      const target = videoSourceTime(Math.max(0, st.playhead - startSec), rate, { in: trim.in, out: trim.out }, el.duration || 0);
      if (Math.abs(el.currentTime - target) > 0.015) {
        el.currentTime = target;
        /*
          Frame-by-frame export must wait for the target frame to decode. Refreshing the texture immediately after writing `currentTime` uploaded the previous frame before decoding completed. Draw again when seeking finishes; the export bridge waits for this promise.
        */
        trackVideoSeek(
          new Promise<void>((done) => {
            const fin = () => {
              el.removeEventListener('seeked', fin);
              window.clearTimeout(guard);
              current?.draw?.();
              tex.needsUpdate = true;
              done();
            };
            const guard = window.setTimeout(fin, 2000);
            el.addEventListener('seeked', fin);
          }),
        );
      }
      // On the intermediate canvas path, `needsUpdate` alone is insufficient: without
      // drawing the new frame, the GPU receives the old canvas, freezing frame-by-frame export.
      current?.draw?.();
      tex.needsUpdate = true;
    };
    function again() {
      retry = false;
      el!.removeEventListener('seeked', again);
      el!.removeEventListener('loadeddata', again);
      sync();
    }
    sync();
    const unsub = useEditor.subscribe((st, prev) => {
      if (st.playhead !== prev.playhead || st.playing !== prev.playing) sync();
    });
    return () => {
      unsub();
      el.removeEventListener('seeked', again);
      el.removeEventListener('loadeddata', again);
    };
  }, [current, startSec, rate, trim.in, trim.out]);

  useEffect(() => {
    const tex = current?.tex;
    return () => tex?.dispose();
  }, [current]);

  return { tex: current?.tex ?? null, aspect: current?.aspect ?? null, el: current?.el ?? null };
}

/* The texture cache and shared loader now live in `./mediaTextures`, preventing a white screen on first appearance. */
export { mediaLoaded } from './mediaTextures';

function useMediaTexture(url: string | null) {
  const [loaded, setLoaded] = useState<{
    url: string;
    tex: THREE.Texture;
    aspect: number;
  } | null>(null);

  useEffect(() => {
    if (!url || textureCache.has(url)) return;
    let cancelled = false;
    // Shared loader: if warmup is already fetching this URL, await the same promise.
    void loadImageTexture(url).then((e) => {
      if (!cancelled && e) setLoaded({ url, tex: e.tex, aspect: e.aspect });
    });
    return () => {
      cancelled = true;
    };
  }, [url]);

  // The cache always wins; state only triggers the initial asynchronous load.
  const cached = url ? textureCache.get(url) : undefined;
  if (cached) return { tex: cached.tex, aspect: cached.aspect };
  const current = loaded && loaded.url === url ? loaded : null;
  return { tex: current?.tex ?? null, aspect: current?.aspect ?? null };
}

/**
 * Fit an image to the screen using cover cropping.
 * Mismatched aspect ratios used to stretch the texture: a 16:9 screenshot on a phone became elongated. Crop to the screen aspect ratio instead, hiding overflow without distorting the image.
 * Returns the fraction of cropped image height visible on screen (1 = fully visible, < 1 = scrollable via `crop.scroll`).
 */
function fitTextureToScreen(
  tex: THREE.Texture | null,
  imageAspect: number | null,
  screenAspect: number,
  crop: { top: number; bottom: number; scroll?: number } = { top: 0, bottom: 0 },
): number {
  if (!tex || !imageAspect) return 1;

  /*
    Apply cropping first: trimming top/bottom changes the image aspect ratio, so cover fitting must use that new ratio. Reversing the order would stretch the image as cropping increases.
  */
  const keep = Math.max(0.1, 1 - crop.top - crop.bottom);
  const effectiveAspect = imageAspect / keep;

  const rx = effectiveAspect > screenAspect ? screenAspect / effectiveAspect : 1;
  const ry = (effectiveAspect > screenAspect ? 1 : effectiveAspect / screenAspect) * keep;

  /*
    Leave unchanged textures alone.
    This function runs on every render. Unconditionally setting `needsUpdate = true` reuploaded the texture every frame, prevented mipmap chain generation, and caused severe moiré on reduced screens, in addition to full-resolution upload costs.
    `repeat` and `offset` are uniforms; changing them requires no reupload.
  */
  /*
    Define the visible vertical texture window explicitly as [lo, lo + ry] (UV y increases upward). The cropped region is [bottom, 1 − top]; scroll 0 aligns to its top, 1 to its bottom. If the image fits (ry = keep), every scroll value gives the same window, so scrolling has no effect.
    ⚠️ The old offset ignored `center = (0.5, 0.5)` (three.js adds offset after centered scaling), counting (1 − r)/2 twice. Wide images cropped from the right rather than the center; "Crop top 0.2" cut 0.1 from both top and bottom and cropped horizontally only from the left. "Crop bottom" moved the window beyond 1, smearing the final pixel row across the screen top. Tall images happened to align at the top; that appearance is preserved because default scroll is 0.
  */
  const fit: ScreenFit = { ry, top: crop.top, bottom: crop.bottom };
  tex.userData.screenFit = fit;
  const oy = scrollOffset(fit, crop.scroll ?? 0);
  const view = Math.min(1, ry / keep);
  if (tex.repeat.x === rx && tex.repeat.y === ry && tex.offset.x === 0 && tex.offset.y === oy) return view;
  tex.repeat.set(rx, ry);
  // Horizontally centered: centered scaling already centers the window.
  tex.offset.set(0, oy);
  return view;
}

/** Last texture fit; the frame loop overwrites scrolling on top of it. */
type ScreenFit = { ry: number; top: number; bottom: number };

/** Vertical offset: window bottom is `lo`; scroll 0 = cropped region top, 1 = bottom. */
function scrollOffset(fit: ScreenFit, scroll: number): number {
  const s = Math.min(1, Math.max(0, scroll));
  const lo = (1 - fit.top - fit.ry) * (1 - s) + fit.bottom * s;
  // With center 0.5, three.js uses v' = ry·(v − 0.5) + 0.5 + offset → lo at v = 0.
  return lo - (1 - fit.ry) / 2;
}

/*
  Main screen texture: the frame loop writes scrolling here.
  Why: React receives `crop.scroll` through the playhead, updated ~30 times per second during playback. At 151 fps, 60 frames had only 12 distinct offsets: scrolling text stepped visibly on 60/144 Hz displays, while export was correct per frame. The frame loop applies the same `scrollOffset` formula at the exact time immediately before each draw. React's value never reaches the screen, preventing jitter between the two writers. When paused or exporting, time is the playhead itself, so both write the same value.
*/
const mainScreen: { tex: THREE.Texture | null } = { tex: null };

function applyScreenScroll(scroll: number) {
  const tex = mainScreen.tex;
  const fit = tex?.userData.screenFit as ScreenFit | undefined;
  if (!tex || !fit) return;
  const oy = scrollOffset(fit, scroll);
  if (tex.offset.y !== oy) tex.offset.y = oy;
}

/**
 * Procedural device body.
 * When real GLB models arrive, this component will load them if `device.model` is set. Dimensions and screen placement share the same config, leaving scene code unchanged.
 */
/** Screen fade ramp: opaque at the bottom, reaching zero at height `amount`. */
let fadeTex: THREE.CanvasTexture | null = null;
function fadeRamp(amount: number): THREE.Texture {
  if (!fadeTex) {
    const c = document.createElement('canvas');
    c.width = 4;
    c.height = 256;
    const x = c.getContext('2d')!;
    const g = x.createLinearGradient(0, 256, 0, 0);
    // alphaMap reads the green channel; white→black = opaque→transparent (smooth S curve).
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.35, '#cfcfcf');
    g.addColorStop(0.7, '#3a3a3a');
    g.addColorStop(1, '#000000');
    x.fillStyle = g;
    x.fillRect(0, 0, 4, 256);
    fadeTex = new THREE.CanvasTexture(c);
    fadeTex.wrapS = fadeTex.wrapT = THREE.ClampToEdgeWrapping;
  }
  // t = v / h → clamp to the transparent ramp end when v > h.
  const h = Math.max(0.05, amount * 0.7);
  fadeTex.repeat.set(1, 1 / h);
  fadeTex.offset.set(0, 0);
  fadeTex.updateMatrix();
  return fadeTex;
}

/** Ghost material: one per texture, using mip bias for blurred sampling. */
const ghostMats = new WeakMap<THREE.Texture, THREE.MeshBasicMaterial>();
function ghostMaterial(tex: THREE.Texture, amount: number): THREE.MeshBasicMaterial {
  let m = ghostMats.get(tex);
  if (!m) {
    m = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    });
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        'texture2D( map, vMapUv )',
        'texture2D( map, vMapUv, 5.5 )',
      );
    };
    m.customProgramCacheKey = () => 'ghost-blur';
    ghostMats.set(tex, m);
  }
  m.opacity = Math.min(1, amount * 0.75);
  return m;
}

/**
 * GLB hardware material, selected by model material name.
 * `finish_body` / `finish_frame` / `back_glass` / `antenna` derive from the user's finish; other parts (lens glass, port, flash…) clone the model material. Cloning is required: layouts and reflections share the model, and reflection copies fade materials in place.
 */
function glbMaterial(
  src: THREE.Material,
  f: DeviceFinish,
  thickness: number,
  bandColor: string,
): THREE.Material {
  const name = src.name;
  const isGlass = f.kind === 'glass';
  if (name === 'band') {
    // Band: user color, matte rubber. Glass finishes retain glass to preserve the appearance.
    return new THREE.MeshPhysicalMaterial({
      name,
      color: isGlass ? '#ffffff' : bandColor,
      metalness: 0,
      roughness: isGlass ? 0.12 : 0.72,
      transmission: isGlass ? 0.9 : 0,
      thickness: 0.3,
      ior: 1.5,
      attenuationColor: new THREE.Color(f.attenuationColor ?? '#ffffff'),
      attenuationDistance: f.attenuationDistance ?? Infinity,
      clearcoat: isGlass ? 1 : 0.15,
      envMapIntensity: isGlass ? 2.2 : 1.0,
      // Fluoroelastomer sport band: soft edge highlights rather than a flat gray slab.
      sheen: isGlass ? 0 : 0.6,
      sheenRoughness: 0.45,
      sheenColor: new THREE.Color(bandColor).lerp(new THREE.Color('#ffffff'), 0.35),
    });
  }
  const finishPart = name === 'finish_body' || name === 'finish_frame' || name === 'back_glass';
  if (finishPart && isGlass) {
    return new THREE.MeshPhysicalMaterial({
      name,
      color: f.body,
      metalness: f.metalness,
      roughness: name === 'back_glass' ? Math.max(f.roughness, 0.18) : f.roughness,
      transmission: f.transmission ?? 0,
      thickness,
      ior: 1.5,
      attenuationColor: new THREE.Color(f.attenuationColor ?? '#ffffff'),
      attenuationDistance: f.attenuationDistance ?? Infinity,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 2.2,
    });
  }
  if (finishPart) {
    const back = name === 'back_glass';
    /*
      Anodized aluminum is metal but not a mirror: bead blasting spreads light broadly and softly. The frame is slightly glossier than the body, providing edge highlights. Back glass is nonmetallic and matte with a thin clearcoat: the same color but a different surface texture.
    */
    const L = lookdev();
    const color = new THREE.Color(f.body);
    /*
      Nonmetallic back glass reflected the same color diffusely and appeared much lighter than aluminum (a white patch on silver). Darken it to match the aluminum tone, leaving only the surface texture different.
    */
    if (back) color.multiplyScalar(0.86);
    return new THREE.MeshPhysicalMaterial({
      name,
      color,
      // Add a slight metallic contribution to back glass: a purely diffuse surface stayed
      // noticeably lighter than the body in bright studios (a gray panel on a black phone).
      metalness: back ? L.backMetal : name === 'finish_frame' ? Math.max(L.frameMetal, f.metalness) : Math.max(L.bodyMetalMin, f.metalness),
      roughness: back
        ? L.backRough
        : name === 'finish_frame'
          ? Math.min(L.frameRoughMax, f.roughness * L.frameRoughMul)
          : Math.max(L.bodyRoughMin, f.roughness),
      clearcoat: back ? L.backCoat : 0.12,
      clearcoatRoughness: back ? L.backCoatRough : 0.25,
      envMapIntensity: L.metalEnv,
    });
  }
  /*
    Trackpad and keys. The GLB trackpad was fixed light gray, appearing white even on black laptops. Use the finish color for body-colored glass slightly smoother than the chassis. A subtle satin surface lets previously flat keys catch edge light.
  */
  if (name === 'trackpad' && !isGlass) {
    const L = lookdev();
    return new THREE.MeshPhysicalMaterial({
      name,
      color: new THREE.Color(f.body).multiplyScalar(0.94),
      metalness: Math.max(0.5, f.metalness * 0.8),
      roughness: L.trackpadRough >= 0 ? L.trackpadRough : 0.26,
      clearcoat: 0.35,
      clearcoatRoughness: 0.2,
      envMapIntensity: 1.2,
    });
  }
  if (name === 'key') {
    const L = lookdev();
    return new THREE.MeshPhysicalMaterial({
      name,
      color: '#0d0d0f',
      metalness: 0,
      roughness: L.keyRough >= 0 ? L.keyRough : 0.48,
      clearcoat: 0.25,
      clearcoatRoughness: 0.35,
      envMapIntensity: 1.1,
    });
  }
  if (name === 'antenna') {
    return new THREE.MeshPhysicalMaterial({
      name,
      color: new THREE.Color(f.body).lerp(new THREE.Color('#8a8c90'), 0.45),
      metalness: 0,
      roughness: 0.55,
      envMapIntensity: 1.0,
    });
  }
  const c = src.clone();
  /*
    Lens glass and dark parts should reflect less environment light: glossy black glass reflected large white softboxes in bright HDRI studios, turning milky gray. Real lenses stay deep black, with colored coating reflections only on the inner element.
  */
  if (name.startsWith('lens_') && name !== 'lens_inner' && c instanceof THREE.MeshPhysicalMaterial) {
    // Anti-reflective coating: subdued reflections rather than mirror-like clearcoat.
    c.clearcoat = 0.25;
    c.specularIntensity = 0.45;
  }
  if (name === 'flash') (c as THREE.MeshStandardMaterial).color.multiplyScalar(0.8);
  {
    const L = lookdev();
    const sm = c as THREE.MeshStandardMaterial;
    if (name === 'key' && L.keyRough >= 0) sm.roughness = L.keyRough;
    if (name === 'trackpad' && L.trackpadRough >= 0) sm.roughness = L.trackpadRough;
  }
  (c as THREE.MeshStandardMaterial).envMapIntensity = name.startsWith('lens_')
    ? name === 'lens_inner'
      ? 1.2
      : 0.55
    : 1.5;
  return c;
}

/**
 * Convert the material to CLAY in place: matte, nonmetallic, no clearcoat or transparency, one color. Darken lenses and flash slightly so the camera island remains readable. Keep the watch band in the user's color, only making it matte.
 */
function toClay<T extends THREE.Material>(m: T, color: string): T {
  if (m instanceof THREE.MeshStandardMaterial) {
    const dark = m.name.startsWith('lens_') || m.name === 'flash';
    if (m.name !== 'band') m.color.set(color).multiplyScalar(dark ? 0.72 : 1);
    m.metalness = 0;
    m.roughness = 0.85;
    m.envMapIntensity = 0.9;
    if (m instanceof THREE.MeshPhysicalMaterial) {
      m.clearcoat = 0;
      m.transmission = 0;
      m.specularIntensity = 0.35;
    }
    m.needsUpdate = true;
  }
  return m;
}

/**
 * Screen annotation plane, mounted only on the main device when the scene has annotations. Covers the full screen (independent of media size / screen UI; positions use screen proportions) with corners clipped to the screen radius. The frame loop draws its contents (`drawScreenMarks`, CameraRig).
 */
function ScreenMarks({ w, h, z, geometry }: { w: number; h: number; z: number; geometry: THREE.BufferGeometry }) {
  const surface = useMemo(() => createMarksSurface(w / h), [w, h]);
  const meshRef = useRef<THREE.Mesh>(null);
  useEffect(() => {
    if (meshRef.current) registerMarksLayer(surface, meshRef.current);
    return () => {
      unregisterMarksLayer(surface);
      surface.tex.dispose();
    };
  }, [surface]);
  return (
    <mesh ref={meshRef} name="main-marks" userData={{ w, h }} position={[0, 0, z]} geometry={geometry}>
      <meshBasicMaterial map={surface.tex} transparent toneMapped={false} depthWrite={false} />
    </mesh>
  );
}

function DeviceMesh({
  device,
  finish,
  media,
  statusBar,
  opts,
  /** Above 0, render this device as a faded reflection copy without shadows. */
  opacity,
  /** Scene effects (Screen fade / Ghost / Liquid glass), 0 = disabled. */
  fx,
  /** The main device screen mesh is named 'main-screen' for the Auto-motion raycast. */
  screenName,
  /** Whether to mount the screen annotation plane (main device with scene annotations). */
  marks,
}: {
  device: Device;
  finish: string;
  media: THREE.Texture | null;
  statusBar?: { on: boolean; time: string; dark: boolean; battery: number };
  /** Device-specific settings (notch / lid angle / band color). */
  opts?: {
    notch: boolean;
    lidAngle: number;
    bandColor: string;
    screenBg: string | null;
    keyboard: boolean;
    mediaSize?: number;
    screenUi?: { menuBar: boolean; dock: boolean; browser: boolean; address: string };
  };
  opacity?: number;
  fx?: { screenFade: number; ghost: number; liquidGlass: number };
  screenName?: string;
  marks?: boolean;
}) {
  const f = device.finishes.find((x) => x.id === finish) ?? device.finishes[0];
  const { body, screen } = device;
  const flat = device.kind === 'flat';
  const isGlass = f.kind === 'glass';
  const isReflection = (opacity ?? 0) > 0;

  // RoundedBox radius must be less than half the shortest edge; equality breaks
  // the geometry, produces NaN, and crashes the scene. Cap it at 98%.
  const safeRadius = (w: number, h: number, d: number, r: number) =>
    Math.min(r, (Math.min(w, h, d) / 2) * 0.98);

  /*
    Material accessor. Disable the global cache for reflection copies: they mutate side/transparent/opacity/depthWrite in place, which would also make a shared main-device material translucent. Include the device in the key because the same finish has different thickness/dimensions on different devices.
    ⚠️ Reflection copies require a local cache lasting for the mount. Calling make() on every render recreated their materials, discarding onUpdate fading mutations and rendering opaque reflections. A local Map keeps materials stable for the mount so the effect below can mutate them safely.
  */
  /*
    Previously `useRef(new Map()).current`: reading a ref during render violates React Compiler's react-hooks/refs rule and needlessly allocates a Map each render. A lazy `useState` initializer guarantees a stable instance for the component lifetime; unlike useMemo, React cannot discard it. Materials must survive for the full mount.
  */
  const [localMats] = useState(() => new Map<string, THREE.Material>());
  const reflRef = useRef<THREE.Group>(null);
  /*
    Apply fading on every commit (no deps; traversal takes microseconds) instead of tracking when each child material changes. Set glass transmission to zero: transparent+transmission creates checkered MSAA artifacts (a known pitfall), and a faded reflection needs no glass transmission.
  */
  useEffect(() => {
    if (!isReflection || !reflRef.current) return;
    reflRef.current.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (!m) return;
      for (const mm of Array.isArray(m) ? m : [m]) {
        mm.side = THREE.DoubleSide;
        mm.transparent = true;
        mm.opacity = opacity ?? 1;
        mm.depthWrite = false;
        const pm = mm as THREE.MeshPhysicalMaterial;
        if (typeof pm.transmission === 'number' && pm.transmission > 0) {
          pm.transmission = 0;
          pm.needsUpdate = true;
        }
      }
    });
  });
  /*
    CLAY: make all hardware materials matte and monochrome here, except Dynamic Island, which must stay black. Append `|clay:color` to the key so clay does not overwrite a cached metal material with the same key.
  */
  const clay = f.kind === 'clay' ? f.body : null;
  const mat = <T extends THREE.Material>(key0: string, make0: () => T): T => {
    const toClayHere = clay !== null && !key0.startsWith('island');
    const key = toClayHere ? `${key0}|clay:${clay}` : key0;
    const make = toClayHere ? () => toClay(make0(), clay) : make0;
    if (!isReflection) return cachedMaterial(`${device.id}|${key}`, make);
    let m = localMats.get(key) as T | undefined;
    if (!m) {
      m = make();
      localMats.set(key, m);
    }
    return m;
  };

  /*
    GLB hardware. If the device has a `model`, use its body/keys/camera. Render the procedural fallback below until loading finishes, avoiding blank frames. Both paths keep the screen stack in this component.
  */
  const modelVer = useSyncExternalStore(subscribeModels, modelsVersion, () => 0);
  useEffect(() => {
    if (device.model) loadDeviceModel(device.model);
  }, [device.model]);
  const template = getDeviceModel(device.model);
  const ldVer = useSyncExternalStore(subscribeLookdev, lookdevVersion, () => 0);
  // The ldVer subscription triggers a render on look-development changes; values come from the module.
  const ld = lookdev();
  /*
    Additive screen glass only in HDR studio (dark/white). Older presets retain the old transparent layer, preserving their appearance exactly.
  */
  const studioEnv = useEditor((st) => !!ENV_PRESETS.find((p) => p.id === (st.previewShot ?? st.active()).scene.envId)?.hdrStudio);
  const glassAdd = ld.glassAdd > 0 ? ld.glassAdd : studioEnv ? ld.studioGlassAdd : 0;
  const glassRough = ld.glassRough;
  const hardware = useMemo(() => {
    if (!template) return null;
    const root = template.clone(true);
    /*
      Keep laptop base (`base__*`) separate: the lid rotates around the hinge axis (`hinge` node), while the base stays horizontal on the table.
    */
    const baseG = new THREE.Group();
    for (const c of [...root.children]) {
      if (c.name.startsWith('base__')) baseG.add(c);
    }
    const hingeNode = root.getObjectByName('hinge');
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const src = m.material as THREE.Material;
      const band = opts?.bandColor ?? '#2b2e34';
      const key = src.name === 'band' ? `glb|band|${f.id}|${band}` : `glb|${src.name}|${f.id}`;
      m.material = mat(key, () => glbMaterial(src, f, body.d, band));
    });
    baseG.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const src = m.material as THREE.Material;
      m.material = mat(`glb|${src.name}|${f.id}`, () => glbMaterial(src, f, body.d, '#2b2e34'));
    });
    return {
      root,
      base: baseG.children.length ? baseG : null,
      hinge: hingeNode ? hingeNode.position.clone() : null,
    };
    // `mat` is a new closure each render, but its key → cache behavior is stable;
    // including it as a dependency would clone the model on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, f.id, isReflection, modelVer, opts?.bandColor, ldVer]);
  const proc = !hardware;

  // Screen UI (laptop/monitor): menu bar, Dock, browser window.
  const uiOn =
    (device.kind === 'laptop' || device.kind === 'monitor') && screenUiActive(opts?.screenUi) && !isReflection;

  /*
    The glass layer is a separate body extending slightly beyond the chassis. Its rounded outer edge catches environment softboxes as long, thin highlights. A single plane has no edge surface to reflect them.
  */
  // Keep glass slightly thick (~1.4 mm): a wider bevel produces longer,
  // clearer edge highlights. This is a framing choice over physical accuracy.
  const glassD = Math.min(0.14, body.d * 0.2);
  const bezel = screen.inset * 0.55;
  const glassW = Math.min(body.w, screen.w + bezel * 2);
  const glassH = Math.min(body.h, screen.h + bezel * 2);
  const glassBevel = glassD * 0.42;

  const glassGeometry = useMemo(
    () =>
      cachedGeo(`plate|${glassW}|${glassH}|${screen.radius + bezel}|${glassD}|${glassBevel}`, () =>
        roundedPlateGeometry(glassW, glassH, screen.radius + bezel, glassD, glassBevel),
      ),
    [glassW, glassH, screen.radius, bezel, glassD, glassBevel],
  );

  // The screen and bezel band also need rounded corners: plain rectangles left
  // sharp tips protruding beyond the body at all four corners.
  /*
    Draw the screenshot in the active pixel area (screen minus black border). The border needs no separate mesh: the dark bezel beneath covers the entire body face, naturally exposing a black border as content shrinks, like a real device.
  */
  const content = contentRect(device);
  const uiLayout = uiOn ? screenUiLayout(opts!.screenUi!, content.w, content.h) : null;
  const mediaScale = (uiLayout ? uiLayout.scale : 1) * (opts?.mediaSize ?? 1);
  const screenGeometry = useMemo(
    () =>
      cachedGeo(`screen|${content.w}|${content.h}|${content.radius}`, () =>
        roundedScreenGeometry(content.w, content.h, content.radius),
      ),
    [content.w, content.h, content.radius],
  );

  /*
    The bezel band covers the entire body face.
    Previously only `screen + 0.126 cm`, it was washed out by the overlaid glass (10% white + 3.4× environment reflection). On bright backgrounds, a white screen and body looked like floating paper, losing device definition.
    The full-face band now creates a dark frame from screen edge to body edge. Glass remains visible along the edges and sidewalls.
  */
  const frameW = Math.max(0, body.w - 0.03);
  const frameH = Math.max(0, body.h - 0.03);
  const frameR = Math.max(0.01, body.radius - 0.03);
  const bezelGeometry = useMemo(
    () =>
      cachedGeo(`bezelband|${frameW}|${frameH}|${frameR}`, () =>
        roundedScreenGeometry(frameW, frameH, frameR),
      ),
    [frameW, frameH, frameR],
  );

  /*
    Layer order matters: the screen must be in front of the body. Moving it inward while adding glass let the body hide it completely, turning the phone into a gray brick. Order: body front → screen → glass.
  */
  const faceZ = body.d / 2;
  /*
    Scale layer separation with device size. A fixed 3 mm worked for phones, but a 70 cm monitor puts the camera far enough away that the depth buffer cannot resolve 1–3 mm gaps, causing screen/bezel z-fighting and striped moiré. Proportional width-based spacing works for all devices.
  */
  const sep = Math.max(0.003, body.w * 0.0012);
  const screenZ = faceZ + sep;
  const glassZ = faceZ + glassD * 0.5;

  /*
    Edge rail protrusion beyond every side of the body (cm).
    Keep one constant because side buttons must align with it. Previously the rail protruded 0.05 while buttons sat at 0.01, burying even their outer faces inside the rail and making them look like flat gray stickers rather than raised buttons.
  */
  const RAIL_OUT = 0.05;

  /*
    Rail geometry uses extrusion rather than RoundedBox.
    RoundedBoxGeometry applies one radius to every edge, so `safeRadius` clamps it to the smallest dimension. With rail depth at 62% of the body, its radius fell to half the body's, leaving sharper corners and four protrusions. Increasing the radius cannot bypass the clamp.
    `roundedPlateGeometry` decouples radius from thickness, letting the rail follow the body's corner curve exactly. Front/back bevels also provide the surface for long, thin edge highlights.
  */
  const railD = body.d * 0.62;
  const railBevel = railD * 0.22;
  const railGeometry = useMemo(
    () =>
      cachedGeo(
        `rail|${body.w}|${body.h}|${body.radius}|${railD}|${railBevel}`,
        () =>
          roundedPlateGeometry(
            body.w + RAIL_OUT * 2,
            body.h + RAIL_OUT * 2,
            body.radius + RAIL_OUT,
            railD,
            railBevel,
          ),
      ),
    [body.w, body.h, body.radius, railD, railBevel],
  );

  /*
    Base definition: `features.base` for laptops; a body-derived equivalent for tablets with the keyboard enabled. All base rendering below shares this source to avoid duplicate code.
  */
  const baseSpec =
    device.features?.base ??
    (device.kind === 'tablet' && opts?.keyboard
      ? { depth: body.h * 0.72, thickness: body.d * 1.15, tilt: 12 }
      : null);

  return (
    <group
      /*
        Negative scaling turns reflection faces inward; back-face culling would make the device look inside out. Fade the copy and disable depth writing to blend it into the floor.
        Apply mutations in a ref-based effect, not onUpdate: onUpdate fires only when group props change, missing later child material changes (empty/loaded media key or finish changes).
      */
      ref={reflRef}
    >
      {/*
        GLB laptop hinge: fixed base, lid and screen stack rotate around `hinge`. Lid angle is backward tilt from vertical (9° ≈ 99° open, −90° = closed). Other devices have zero rotation.
      */}
      {hardware?.base ? <primitive object={hardware.base} /> : null}
      <group
        position={hardware?.hinge ?? [0, 0, 0]}
        rotation={[
          hardware?.hinge
            ? (-(device.kind === 'monitor'
                ? Math.max(-5, Math.min(25, opts?.lidAngle ?? 9))
                : (opts?.lidAngle ?? 9)) *
                Math.PI) /
              180
            : 0,
          0,
          0,
        ]}
      >
      <group position={hardware?.hinge ? hardware.hinge.clone().negate() : [0, 0, 0]}>
      {/*
        Body. Glass finishes use `transmission` to pass light through the body, with `attenuation` tinting it by depth. Thickness matches actual body depth: thin edges remain clear, thick areas darken.
        `key` is required when switching glass/metal to rebuild the material; otherwise the transmission shader is not added.
      */}
      {/* No safeRadius: extrusion does not clamp radius to thickness. */}
      {proc ? (
      <mesh geometry={getBodyGeometry(body.w, body.h, body.d, body.radius)}>
        {/*
          Intentionally omit transparent: transmission already provides the glass effect. Combining transparent+transmission caused checkered MSAA artifacts along glass edges, absent on silver.
        */}
        <primitive
          attach="material"
          object={mat(`body|${f.id}|${body.d.toFixed(3)}`, () =>
            new THREE.MeshPhysicalMaterial({
              color: f.body,
              metalness: f.metalness,
              roughness: f.roughness,
              transmission: f.transmission ?? 0,
              thickness: f.transmission ? body.d : 0,
              ior: 1.5,
              attenuationColor: new THREE.Color(f.attenuationColor ?? '#ffffff'),
              attenuationDistance: f.attenuationDistance ?? Infinity,
              clearcoat: 1,
              clearcoatRoughness: isGlass ? 0.02 : 0.25,
              envMapIntensity: isGlass ? 2.4 : 1.7,
            }),
          )}
        />
      </mesh>
      ) : (
        <primitive object={hardware!.root} rotation={[0, 0, device.landscape ? -Math.PI / 2 : 0]} />
      )}

      {/*
        Edge rail: the device frame visible from the side.
        Real phones have metal edge rails even with glass bodies, catching long, thin highlights. A single glass body left a flat, dull side strip and a sticker-like silhouette.
        The rail protrudes slightly (0.02 cm) but has less depth: hidden behind the screen/glass from the front, visible as a bright metal band from the side. Glass uses neutral silver; metal uses its finish color, preserving the glass appearance.
      */}
      {!flat && proc ? (
        <mesh geometry={railGeometry}>
          <primitive
            attach="material"
            object={mat(`rail|${f.id}`, () =>
              new THREE.MeshPhysicalMaterial({
                /*
                  Use light silver: dark gray rails disappeared where the sidewall environment reflections were already dim.
                */
                color: isGlass ? '#dfe3ea' : f.body,
                /*
                  Keep metalness below 1. Pure metal has no diffuse contribution and is visible only through reflections, making the rail dark from the side where the environment is dim. At 0.78 a diffuse base keeps it visible while retaining its metallic appearance.
                */
                metalness: isGlass ? 0.78 : Math.max(0.6, f.metalness),
                /*
                  Low roughness: at 0.22 reflections spread into a dull gray slab. Sharp reflections create the thin, bright line that defines the rail.
                */
                roughness: isGlass ? 0.13 : Math.min(0.2, f.roughness),
                clearcoat: 1,
                clearcoatRoughness: 0.04,
                envMapIntensity: 3.0,
              }),
            )}
          />
        </mesh>
      ) : null}

      {/* Rear details: camera island and side buttons. */}
      {proc && device.features?.cameraIsland ? (
        <group
          position={[
            device.features.cameraIsland.x,
            device.features.cameraIsland.y,
            -body.d / 2 - device.features.cameraIsland.d / 2 + 0.01,
          ]}
        >
          <mesh
            geometry={getBodyGeometry(
              device.features.cameraIsland.w,
              device.features.cameraIsland.h,
              device.features.cameraIsland.d,
              device.features.cameraIsland.radius,
            )}
          >
            <meshPhysicalMaterial
              color={f.body}
              metalness={f.metalness}
              roughness={f.roughness * 0.8}
              clearcoat={0.7}
              envMapIntensity={1.7}
            />
          </mesh>

          {device.features.cameraIsland.lenses.map((l, i) => (
            <mesh
              key={i}
              position={[l.x, l.y, -device.features!.cameraIsland!.d / 2 - 0.04]}
              rotation={[Math.PI / 2, 0, 0]}
            >
              <primitive
                object={cachedGeo(`cyl|${l.r}`, () => new THREE.CylinderGeometry(l.r, l.r, 0.1, 32))}
                attach="geometry"
              />
              <meshPhysicalMaterial
                color="#0b0d12"
                metalness={0.2}
                roughness={0.06}
                clearcoat={1}
                envMapIntensity={2.6}
              />
            </mesh>
          ))}
        </group>
      ) : null}

      {/*
        Laptop base. The lid tilts slightly backward from the hinge; the base extends forward. Without it, the laptop looked like an upright tablet.
      */}
      {/*
        iPad keyboard base. Reuse the laptop base with dimensions derived from the tablet body instead of a separate model variant. With the toggle off, the tablet stands upright; enabling it gives a laptop posture.
      */}
      {(proc || device.kind === 'tablet') && baseSpec ? (
        <group
          // The hinge is at the lid's bottom edge; rotate there, rather than at the center.
          position={[0, -body.h / 2, 0]}
        >
          <group position={[0, 0, body.d / 2]}>
            {/* Base body. */}
            <RoundedBox
              args={[body.w, baseSpec.thickness, baseSpec.depth]}
              radius={safeRadius(
                body.w,
                baseSpec.thickness,
                baseSpec.depth,
                0.35,
              )}
              smoothness={5}
              position={[0, -baseSpec.thickness / 2, baseSpec.depth / 2]}
            >
              <meshPhysicalMaterial
                key={`base-${f.id}`}
                color={f.body}
                metalness={f.metalness}
                roughness={f.roughness}
                transmission={f.transmission ?? 0}
                thickness={f.transmission ? baseSpec.thickness : 0}
                ior={1.5}
                attenuationColor={f.attenuationColor}
                attenuationDistance={f.attenuationDistance ?? Infinity}
                
                clearcoat={1}
                envMapIntensity={isGlass ? 2.4 : 1.7}
              />
            </RoundedBox>

            {/*
              Base edge rail, for the same reason as the lid rail. The glass base looked flat and dull from the side, hiding its thickness. The rail protrudes 1 mm and is thinner vertically: it preserves the keyboard area from above and shows a bright metal band from the side.
            */}
            <RoundedBox
              args={[
                body.w + 0.1,
                baseSpec.thickness * 0.72,
                baseSpec.depth + 0.1,
              ]}
              radius={safeRadius(
                body.w + 0.1,
                baseSpec.thickness * 0.72,
                baseSpec.depth + 0.1,
                0.3,
              )}
              smoothness={5}
              position={[0, -baseSpec.thickness / 2, baseSpec.depth / 2]}
            >
              <primitive
                attach="material"
                object={mat(`base-rail|${f.id}`, () =>
                  new THREE.MeshPhysicalMaterial({
                    color: isGlass ? '#c9ced8' : f.body,
                    metalness: isGlass ? 0.92 : Math.max(0.6, f.metalness),
                    roughness: isGlass ? 0.22 : Math.min(0.3, f.roughness),
                    clearcoat: 1,
                    clearcoatRoughness: 0.06,
                    envMapIntensity: 2.2,
                  }),
                )}
              />
            </RoundedBox>

            {/*
              Keyboard. A single dark plane looked like a black rectangle pasted onto the laptop in closeups. Use a recessed well and real key grid instead: instancing draws ~60 keys in one draw call.
            */}
            <mesh position={[0, 0.001, baseSpec.depth * 0.42]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[body.w * 0.88, baseSpec.depth * 0.5]} />
              <primitive
                attach="material"
                object={mat('deck', () =>
                  new THREE.MeshStandardMaterial({ color: '#0f1013', roughness: 0.9, metalness: 0.05 }),
                )}
              />
            </mesh>
            <LaptopKeys
              width={body.w * 0.84}
              depth={baseSpec.depth * 0.44}
              y={0.004}
              z={baseSpec.depth * 0.42}
            />

            {/* Trackpad: a slightly raised plate rather than a plane, so its edge catches light. */}
            <mesh position={[0, 0.004, baseSpec.depth * 0.82]}>
              <boxGeometry args={[body.w * 0.34, 0.012, baseSpec.depth * 0.26]} />
              <primitive
                attach="material"
                object={mat('btn', () =>
                  new THREE.MeshPhysicalMaterial({
                    color: '#1c1e24',
                    roughness: 0.35,
                    metalness: 0.25,
                    clearcoat: 0.6,
                    envMapIntensity: 1.4,
                  }),
                )}
              />
            </mesh>
          </group>
        </group>
      ) : null}

      {/* Watch crown: cylinder on the right edge. */}
      {proc && device.features?.crown ? (
        <mesh
          position={[body.w / 2 + device.features.crown.d / 2, device.features.crown.y, 0]}
          rotation={[0, 0, Math.PI / 2]}
        >
          <cylinderGeometry
            args={[
              device.features.crown.r,
              device.features.crown.r,
              device.features.crown.d,
              28,
            ]}
          />
          <meshPhysicalMaterial
            color={f.body}
            metalness={isGlass ? 0.1 : f.metalness}
            roughness={0.22}
            clearcoat={1}
            envMapIntensity={2}
          />
        </mesh>
      ) : null}

      {/*
        Watch strap: two pieces extending above and below the case, with ends bent slightly backward. Even without a wrist, the strap gives the silhouette its watch identity; the case alone looked detached.
      */}
      {/*
        Two-piece curved strap. A single blunt box looked like a pasted slab. The first piece leaves the case at a slight angle; the second curves more and tapers slightly to suggest wrapping around a wrist. RoundedBox softens the corners. Metal finishes use a dark matte strap (matching color looked like a huge slab); glass retains glass to preserve its appearance.
      */}
      {proc && device.features?.band
        ? [1, -1].map((dir) => {
            const band = device.features!.band!;
            const seg1 = band.length * 0.9;
            const seg2 = band.length * 1.05;
            const bandMat = (segKey: string, th: number) => (
              <meshPhysicalMaterial
                key={`band-${segKey}-${f.id}`}
                /* User-selected band color; stays white for glass. */
                color={isGlass ? '#ffffff' : (opts?.bandColor ?? '#2b2e34')}
                metalness={0}
                roughness={isGlass ? 0.12 : 0.78}
                transmission={f.transmission ? 0.9 : 0}
                thickness={th}
                ior={1.5}
                attenuationColor={f.attenuationColor}
                attenuationDistance={f.attenuationDistance ?? Infinity}
                clearcoat={isGlass ? 1 : 0.3}
                envMapIntensity={isGlass ? 2.2 : 1.1}
              />
            );
            return (
              <group
                key={dir}
                position={[0, dir * (body.h / 2 - 0.12), -body.d * 0.1]}
                rotation={[-dir * 0.2, 0, 0]}
              >
                <RoundedBox
                  args={[band.w, seg1, band.thickness]}
                  radius={Math.min(0.13, band.thickness * 0.45)}
                  smoothness={4}
                  position={[0, dir * (seg1 / 2), 0]}
                >
                  {bandMat('a', band.thickness)}
                </RoundedBox>
                {/*
                    The second piece bends backward; bending forward made the strap look folded inward toward the camera.
*/}
                <group position={[0, dir * seg1, 0]} rotation={[-dir * 0.6, 0, 0]}>
                  <RoundedBox
                    args={[band.w * 0.92, seg2, band.thickness * 0.9]}
                    radius={Math.min(0.13, band.thickness * 0.4)}
                    smoothness={4}
                    position={[0, dir * (seg2 / 2 - 0.04), 0]}
                  >
                    {bandMat('b', band.thickness * 0.9)}
                  </RoundedBox>
                </group>
              </group>
            );
          })
        : null}

      {/*
        Monitor stand: a neck below the body and a base on the floor. Without it, the monitor looked like a flat card; the stand defines its silhouette.
      */}
      {proc && device.features?.stand ? (
        <group position={[0, -body.h / 2, -body.d / 2]}>
          <RoundedBox
            args={[
              device.features.stand.neckW,
              device.features.stand.neckH,
              device.features.stand.neckD,
            ]}
            radius={safeRadius(
              device.features.stand.neckW,
              device.features.stand.neckH,
              device.features.stand.neckD,
              0.5,
            )}
            smoothness={4}
            position={[0, -device.features.stand.neckH / 2 + 1.2, -device.features.stand.neckD / 2]}
          >
            <meshPhysicalMaterial
              key={`neck-${f.id}`}
              color={f.body}
              metalness={f.metalness}
              roughness={f.roughness}
              transmission={f.transmission ?? 0}
              thickness={f.transmission ? device.features.stand.neckD : 0}
              ior={1.5}
              attenuationColor={f.attenuationColor}
              attenuationDistance={f.attenuationDistance ?? Infinity}
              
              clearcoat={1}
              envMapIntensity={isGlass ? 2.4 : 1.7}
            />
          </RoundedBox>
          <RoundedBox
            args={[
              device.features.stand.baseW,
              device.features.stand.baseH,
              device.features.stand.baseD,
            ]}
            radius={safeRadius(
              device.features.stand.baseW,
              device.features.stand.baseH,
              device.features.stand.baseD,
              0.4,
            )}
            smoothness={4}
            position={[
              0,
              -device.features.stand.neckH + 1.2 + device.features.stand.baseH / 2,
              device.features.stand.baseD * 0.12,
            ]}
          >
            <meshPhysicalMaterial
              key={`base-${f.id}`}
              color={f.body}
              metalness={f.metalness}
              roughness={f.roughness}
              transmission={f.transmission ?? 0}
              thickness={f.transmission ? device.features.stand.baseH : 0}
              ior={1.5}
              attenuationColor={f.attenuationColor}
              attenuationDistance={f.attenuationDistance ?? Infinity}
              
              clearcoat={1}
              envMapIntensity={isGlass ? 2.4 : 1.7}
            />
          </RoundedBox>
        </group>
      ) : null}

      {/*
        Side buttons sit on top of the rail: their centers are half a button thickness beyond its outer face, leaving ~0.2 mm relief. Match the rail material; glass body colors looked patchy on metal. Match the rail band depth (0.62) too, so buttons do not look like separate floating parts.
      */}
      {proc && device.features?.buttons?.map((b, i) => (
        <mesh
          key={i}
          position={[(b.side === 'left' ? -1 : 1) * (body.w / 2 + RAIL_OUT + 0.02), b.y, 0]}
        >
          <boxGeometry args={[0.06, b.h, body.d * 0.62]} />
          <meshPhysicalMaterial
            color={isGlass ? '#dfe3ea' : f.body}
            metalness={isGlass ? 0.78 : Math.max(0.6, f.metalness)}
            roughness={isGlass ? 0.16 : Math.min(0.24, f.roughness)}
            clearcoat={1}
            clearcoatRoughness={0.05}
            envMapIntensity={2.4}
          />
        </mesh>
      ))}

      {/*
        Dark band between frame and screen, as on real phones. Without it, the screen blends into the body and the device reads as a single brick.
      */}
      {!flat ? (
        <mesh position={[0, 0, faceZ + sep * 0.4]} geometry={bezelGeometry}>
          {/*
            Use PHYSICAL rather than MeshBASIC.
            Basic materials do not receive light, leaving a flat #0a0a0c band at every angle. From the side it formed a hard black strip between rail and screen, obscuring the silhouette. Real dark bezels catch light; environment reflections make the band feel integrated while its dark color still separates screen from body.
          */}
          <meshPhysicalMaterial
            color="#0a0a0c"
            metalness={0.35}
            roughness={0.38}
            clearcoat={1}
            clearcoatRoughness={0.12}
            envMapIntensity={1.15}
          />
        </mesh>
      ) : null}

      {/*
        Glass edge line: a hairline (0.3 mm) light contour where glass meets frame, mimicking product-photo highlights. Without it the black bezel looks empty. Keep it thin and low contrast: it should subtly finish the edge without drawing attention.
      */}
      {!flat ? (
        <mesh
          position={[0, 0, faceZ + sep * 0.55]}
          geometry={cachedGeo(`glassline|${glassW}|${glassH}|${screen.radius + bezel}`, () =>
            roundedRingGeometry(glassW, glassH, screen.radius + bezel, Math.max(0.03, body.w * 0.004)),
          )}
        >
          <meshPhysicalMaterial
            color="#c8cdd6"
            metalness={0.85}
            roughness={0.3}
            clearcoat={1}
            clearcoatRoughness={0.1}
            envMapIntensity={1.6}
          />
        </mesh>
      ) : null}

      {/* Screenshot: corners clipped to the same radius as the body. */}
      {/*
        Screen background: below the screenshot and above the bezel. Transparent PNG areas or gaps around smaller images were black; now they show the user's selected color.
      */}
      {opts?.screenBg ? (
        <mesh position={[0, 0, screenZ - sep * 0.25]} geometry={screenGeometry}>
          <meshBasicMaterial color={opts.screenBg} toneMapped={false} />
        </mesh>
      ) : null}

      {uiOn ? (
        <mesh position={[0, 0, screenZ - sep * 0.15]} geometry={screenGeometry}>
          <meshBasicMaterial
            map={screenUiTexture(opts!.screenUi!, content.w, content.h, opts?.screenBg ?? null)}
            toneMapped={false}
          />
        </mesh>
      ) : null}
      <mesh
        name={screenName}
        position={[0, uiLayout ? uiLayout.centerY : 0, screenZ]}
        geometry={screenGeometry}
        /*
          MEDIA SIZE: the image covers part of the screen, leaving the screen background visible elsewhere. With screen UI enabled, shrink it into the browser window.
        */
        scale={[mediaScale, mediaScale, 1]}
      >
        {/*
          `key` is required. React updates existing materials of the same type, but Three.js omits texture support if none exists at initial compilation and silently ignores a later texture, leaving the screen black. Changing the key rebuilds the material with the correct shader.
          An empty screen uses neutral light gray because black looked broken.
        */}
        <meshBasicMaterial
          key={media ? 'screen-mapped' : 'screen-empty'}
          map={media ?? undefined}
          /*
            Without media, show the user's background color or neutral light gray if unset (black looked broken). With media, use `transparent` so empty PNG areas reveal the background layer; the first version always painted an opaque screen mesh that hid it completely.
          */
          map-anisotropy={media ? 16 : undefined}
          color={media ? '#ffffff' : (opts?.screenBg ?? '#e6e7ea')}
          transparent={!!media && !!opts?.screenBg}
          toneMapped={false}
        />
      </mesh>

      {/*
        Annotations sit just above media (+0.2 sep): Screen fade (+0.45) darkens them too, while the island (+0.5) and status bar (+0.6) stay above.
      */}
      {marks && !isReflection ? (
        <ScreenMarks w={content.w} h={content.h} z={screenZ + sep * 0.2} geometry={screenGeometry} />
      ) : null}

      {/*
        Dynamic Island: a dark pill at the top center. Can be disabled per scene to avoid adding a second notch when the user's screenshot already includes one.
      */}
      {/*
        Punch-hole camera (Android class): small black circle at top center, or right-edge center in landscape.
      */}
      {!flat && device.kind === 'phone' && opts?.notch !== false && device.features?.notchStyle === 'punch' ? (
        <mesh
          position={
            device.landscape
              ? [content.w / 2 - Math.min(content.w, content.h) * 0.085, 0, screenZ + sep * 0.5]
              : [0, content.h / 2 - Math.min(content.w, content.h) * 0.085, screenZ + sep * 0.5]
          }
        >
          <circleGeometry args={[Math.min(content.w, content.h) * 0.032, 32]} />
          <primitive attach="material" object={mat('island', () => new THREE.MeshBasicMaterial({ color: '#08090c' }))} />
        </mesh>
      ) : null}
      {/*
        Laptop camera notch: small black tab at top center, with upper corners blending into the bezel; sits in the menu bar when enabled.
      */}
      {!flat && device.kind === 'laptop' && device.model && opts?.notch !== false ? (
        <mesh
          position={[0, content.h / 2 - content.h * 0.012, screenZ + sep * 0.5]}
          geometry={cachedGeo(`lnotch|${content.w}|${content.h}`, () =>
            roundedScreenGeometry(content.w * 0.105, content.h * 0.05, content.h * 0.012),
          )}
        >
          <primitive attach="material" object={mat('island', () => new THREE.MeshBasicMaterial({ color: '#08090c' }))} />
        </mesh>
      ) : null}
      {!flat && device.kind === 'phone' && opts?.notch !== false && device.features?.notchStyle !== 'punch' ? (
        <mesh
          /* In landscape, place the island as a vertical pill at right-edge center (device rotated clockwise). */
          position={
            device.landscape
              ? [content.w / 2 - content.w * 0.045, 0, screenZ + sep * 0.5]
              : [0, content.h / 2 - content.h * 0.045, screenZ + sep * 0.5]
          }
          rotation={[0, 0, device.landscape ? Math.PI / 2 : 0]}
          geometry={cachedGeo(`island|${Math.min(content.w, content.h)}`, () => {
            const cw = Math.min(content.w, content.h);
            return roundedScreenGeometry(cw * 0.32, cw * 0.105, cw * 0.052);
          })}
        >
          <primitive
            attach="material"
            object={mat('island', () => new THREE.MeshBasicMaterial({ color: '#08090c' }))}
          />
        </mesh>
      ) : null}

      {/*
        Status bar: overlay the top screen strip without altering the source image. Useful on phones and tablets, not laptops or flat cards.
      */}
      {statusBar?.on &&
      !device.landscape &&
      (device.kind === 'phone' || device.kind === 'watch' || device.kind === 'tablet') ? (
        <mesh
          position={[0, content.h / 2 - (content.h * 0.052) / 2 - content.h * 0.012, screenZ + sep * 0.6]}
        >
          <planeGeometry args={[content.w * 0.92, content.h * 0.052]} />
          <meshBasicMaterial
            map={getStatusBarTexture({
              time: statusBar.time,
              dark: statusBar.dark,
              battery: statusBar.battery,
            })}
            transparent
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      ) : null}

      {/*
        Glass layer settings:
        - Low opacity keeps the screen beneath clear.
        - Near-zero roughness keeps reflections sharp.
        - High envMapIntensity strengthens softbox highlights at the edge.
        - ior 1.52 matches real glass and gives correct Fresnel behavior: edges brighten from side views.
      */}
      {!flat && glassAdd > 0 ? (
        /*
          Additive glass: opacity 0.1 also reduced reflections to 10%, hiding screen-glass softbox highlights in HDR studio. Set diffuse to zero and add only environment reflections (Fresnel, ior 1.52) over the screen.
        */
        <mesh geometry={glassGeometry} position={[0, 0, glassZ]}>
          <meshPhysicalMaterial
            key={`glassadd-${glassAdd}-${glassRough}`}
            color="#000000"
            transparent
            blending={THREE.AdditiveBlending}
            metalness={0}
            roughness={glassRough}
            ior={1.52}
            specularIntensity={1}
            envMapIntensity={glassAdd}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ) : !flat ? (
        <mesh geometry={glassGeometry} position={[0, 0, glassZ]}>
          <meshPhysicalMaterial
            color="#ffffff"
            transparent
            opacity={0.1}
            metalness={0}
            roughness={0.02}
            ior={1.52}
            reflectivity={1}
            specularIntensity={1}
            clearcoat={1}
            clearcoatRoughness={0.01}
            envMapIntensity={3.4}
            depthWrite={false}
          />
        </mesh>
      ) : null}

      {/*
        SCREEN FADE: content blends downward into the screen background, or black if unset. Share one ramp texture; control height with repeat/offset so slider changes do not allocate new textures.
      */}
      {fx && fx.screenFade > 0.001 && !flat ? (
        <mesh position={[0, 0, screenZ + sep * 0.45]} geometry={screenGeometry}>
          <meshBasicMaterial
            color={opts?.screenBg ?? '#000000'}
            alphaMap={fadeRamp(fx.screenFade)}
            transparent
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ) : null}

      {/*
        LIQUID GLASS: thick refractive glass with beveled edges in front of the device. The flat center keeps content clear; bevels refract and split colors (dispersion), with wet edge highlights (iridescence + clearcoat).
      */}
      {fx && fx.liquidGlass > 0.001 && !isReflection ? (
        <mesh
          position={[0, 0, faceZ + glassD + body.d * 0.35]}
          geometry={cachedGeo(`liquid|${body.w}|${body.h}|${body.radius}|${body.d}`, () =>
            roundedPlateGeometry(
              body.w * 1.05,
              body.h * 1.035,
              body.radius * 1.2 + body.w * 0.02,
              body.d * 0.7,
              body.d * 0.33,
            ),
          )}
        >
          <meshPhysicalMaterial
            color="#ffffff"
            transmission={1}
            thickness={body.d * (0.6 + fx.liquidGlass * 1.4)}
            roughness={0.02}
            ior={1.45 + fx.liquidGlass * 0.25}
            dispersion={fx.liquidGlass * 4}
            iridescence={0.5}
            iridescenceIOR={1.3}
            clearcoat={1}
            clearcoatRoughness={0.02}
            envMapIntensity={1.6}
          />
        </mesh>
      ) : null}
      </group>
      </group>

      {/*
        GHOST: a blurred screen copy behind the device, slightly lower and larger, visible as a halo around its edges from the front. Blur comes from mipmap sampling bias in the shader, without an extra pass.
      */}
      {fx && fx.ghost > 0.001 && media && !isReflection && !flat ? (
        <mesh
          position={[0, -content.h * 0.05, -body.d / 2 - Math.max(body.d, body.w * 0.06)]}
          scale={[1.14, 1.12, 1]}
          geometry={screenGeometry}
        >
          <primitive
            attach="material"
            object={ghostMaterial(media, fx.ghost)}
          />
        </mesh>
      ) : null}
    </group>
  );
}

/**
 * Extra device in the scene.
 * Use the main device image when no separate media is set, so choosing a layout immediately shows populated screens. Users can then upload individual screens if desired.
 */
/**
 * Texture view with independent fitting: shares the image (and GPU copy) but owns `repeat/offset`. Using the main texture directly inherited its screen crop; loading the same URL also returned the same cached texture, letting both fits overwrite each other on every render.
 */
function useTextureView(src: THREE.Texture | null): THREE.Texture | null {
  const view = useMemo(() => (src ? src.clone() : null), [src]);
  useEffect(() => () => view?.dispose(), [view]);
  return view;
}

function ExtraDevice({
  extra,
  unitW,
  unitH,
  fallbackMedia,
  fallbackAspect,
  fallbackCrop,
  shotId,
  statusBar,
}: {
  extra: {
    id: string;
    deviceId: string;
    finishId: string;
    media: string | null;
    mediaKind: 'image' | 'video';
    x: number;
    y: number;
    z: number;
    rotY: number;
    scale: number;
  };
  unitW: number;
  unitH: number;
  fallbackMedia: THREE.Texture | null;
  /** Main media aspect ratio: fit "Use main screen" to this device's own screen. */
  fallbackAspect: number | null;
  /** Main media crop (status bar removal): same image, same crop. */
  fallbackCrop: { top: number; bottom: number; scroll?: number };
  /** Containing scene: seek video using scene-local time. */
  shotId: string;
  statusBar?: { on: boolean; time: string; dark: boolean; battery: number };
}) {
  const device = getDevice(extra.deviceId);
  /*
    Support video too: the UI previously accepted video but always built an image texture, silently leaving the screen blank when a video was selected.
  */
  const playing = useEditor((s) => s.playing);
  const isVideo = extra.mediaKind === 'video';
  /*
    The main device passed the scene start to the video hook, but extra devices did not, defaulting to 0 (project time). A three-second video in a scene starting at second 5 therefore showed a frame near its end rather than its start.
  */
  const beginSec = useEditor((st) => (isVideo ? shotStart(st.shots, shotId) : 0));
  const ownImg = useMediaTexture(isVideo ? null : extra.media);
  const ownVid = useVideoTexture(isVideo ? extra.media : null, playing, 1, undefined, beginSec);
  const own = isVideo ? ownVid : ownImg;
  const usesMain = !own.tex;
  const screenTex = useTextureView(own.tex ?? fallbackMedia);
  {
    const c = contentRect(device);
    fitTextureToScreen(screenTex, usesMain ? fallbackAspect : own.aspect, c.w / c.h, usesMain ? fallbackCrop : undefined);
  }

  return (
    <group
      ref={(g) => {
        if (g) deviceSlotGroups.extras.set(extra.id, g);
        else if (deviceSlotGroups.extras.get(extra.id)) deviceSlotGroups.extras.delete(extra.id);
      }}
      position={[extra.x * unitW, extra.y * unitH, extra.z * unitW]}
      rotation={[0, (extra.rotY * Math.PI) / 180, 0]}
      scale={extra.scale}
    >
      <DeviceMesh
        device={device}
        finish={extra.finishId}
        media={screenTex}
        statusBar={statusBar}
      />
    </group>
  );
}

/**
 * Device warmup: compile every project device once at startup.
 * Why: measurements showed one 250 ms spike on the first laptop scene. Textures were already warmed, and geometry/textures cached; the remaining cost was compiling device-specific shader programs on that frame. Glass transmission is expensive, with separate variants per device/finish.
 * Use an offscreen copy in the scene plus `gl.compile`. Compilation ignores the frustum and processes every visible object's material; normal frames cull the offscreen rig without drawing it. Keep it mounted: disposing materials also releases programs, forcing recompilation at first real use.
 */
/** Scene effect value (0 if absent or hidden). */
function fxValue(shot: { effects: { id: string; value: number; on: boolean }[] }, id: string): number {
  const e = shot.effects.find((x) => x.id === id);
  return e && e.on ? e.value : 0;
}

function DeviceWarmup() {
  const { gl, scene, camera } = useThree();
  // `late`: fallback if the texture signal never arrives.
  const [late, setLate] = useState(false);

  /*
    Compile after textures load so the screen-textured variant (USE_MAP) is warmed; an untextured program is useless here. A fixed 1200 ms timer previously warmed the wrong variant on slow connections.
    Fallback: compile after 4 s if the texture signal never arrives (dead network), avoiding an endless startup wait.
  */
  const texturesWarm = useEditor((s) => s.texturesWarm);
  /*
    Use a progress-based fallback: a fixed 4 s timer also fired on slow but active connections, compiling the rig without textures. Missing textures then loaded at the first scene boundary, causing a measured 125 ms frame; the new materials were inside the rig. warmTick advances for each decoded image and resets the timer, so only actual inactivity opens the gate. Each tick also rerenders the rig: after recovery from a dead network, newly loaded textures compile immediately rather than at the next boundary.
  */
  const warmTick = useEditor((s) => s.warmTick);
  useEffect(() => {
    const t = window.setTimeout(() => setLate(true), 4000);
    return () => window.clearTimeout(t);
  }, [warmTick]);
  const texArmed = texturesWarm || late;

  /*
    Distinct device+finish+texture combinations in the project. Edits can change them; rebuild the rig only when the key string changes.
  */
  // The selector returns a string: zustand compares references, so returning
  // a new array on every render would create an infinite render loop.
  const comboKey = useEditor((s) =>
    [
      ...new Set(
        s.shots.flatMap((sh) => [
          `${sh.deviceId}|${sh.finishId}|${sh.mediaKind === 'image' && sh.media ? sh.media : '-'}`,
          ...sh.extras.map(
            (e) => `${e.deviceId}|${e.finishId}|${e.mediaKind === 'image' && e.media ? e.media : '-'}`,
          ),
        ]),
      ),
    ].join('~'),
  );

  const combos = useMemo(
    () =>
      comboKey.split('~').map((key) => {
        const [deviceId, finishId, media] = key.split('|');
        return { key, deviceId, finishId, media: media === '-' ? null : media };
      }),
    [comboKey],
  );

  /*
    Wait for GLB models too: otherwise the rig compiles procedural fallback bodies, leaving new programs to compile on the model's first visible frame and causing a startup spike. Failed loads count as settled; a 12 s fallback handles stalled networks.
  */
  const modelVer = useSyncExternalStore(subscribeModels, modelsVersion, () => 0);
  const modelsOk = useMemo(
    () => modelsSettled(combos.map((c) => c.deviceId)),
    // modelVer: recheck as models load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [combos, modelVer],
  );
  const [modelsLate, setModelsLate] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setModelsLate(true), 12000);
    return () => window.clearTimeout(t);
  }, []);
  const armed = texArmed && (modelsOk || modelsLate);

  /*
    Compile one frame after the rig mounts.
    Compile twice: three.js includes the current render target color space in its program cache key. Screen rendering uses `srgb`; intermediate targets (contact shadows, composer) use `srgb-linear`, producing two programs per material. Warming only the screen variant left a 100 ms spike when the device first needed the intermediate variant. Program-key measurements in `__gl.info.programs` differed only in srgb / srgb-linear.
  */
  useEffect(() => {
    if (!armed) return;
    const id = requestAnimationFrame(() => {
      const prev = gl.getRenderTarget();
      gl.compile(scene, camera);
      const linear = new THREE.WebGLRenderTarget(1, 1);
      gl.setRenderTarget(linear);
      gl.compile(scene, camera);
      /*
        Third variant: effect pipeline target (`isXRRenderTarget`, sRGB-encoded; see screenTone.ts). Bloom/flare also use this path. Without warmup, enabling blur for the first time compiles every material on that frame.
      */
      // Set the color space explicitly: on a marked target, three.js reads the output space
      // from the texture. An empty ('') space caused a 'fromXYZ' error and blocked startup.
      linear.texture.colorSpace = THREE.SRGBColorSpace;
      (linear as THREE.WebGLRenderTarget & { isXRRenderTarget?: boolean }).isXRRenderTarget = true;
      gl.setRenderTarget(linear);
      gl.compile(scene, camera);
      gl.setRenderTarget(prev);
      linear.dispose();
      // End of the chain: textures loaded + programs compiled → scene can play.
      useEditor.getState().setAssetsReady();
    });
    return () => cancelAnimationFrame(id);
    // warmTick: compile textures arriving after the rig opens without waiting for
    // a scene boundary (compile is idempotent; the program cache absorbs repeats).
  }, [armed, combos, gl, scene, camera, warmTick]);

  if (!armed) return null;

  return (
    <group position={[0, -9000, 0]}>
      {combos.map((c) => (
        <DeviceMesh
          key={c.key}
          device={getDevice(c.deviceId)}
          finish={c.finishId}
          media={c.media ? (textureCache.get(c.media)?.tex ?? null) : null}
        />
      ))}
    </group>
  );
}

/**
 * Text overlay: a 2D texture in front of the camera, redrawn each frame.
 * As a camera child it keeps filling the screen regardless of scene rotation. Being part of the WebGL canvas, it is included directly in PNG/MP4 exports.
 */
function TextOverlay({ overlayScene }: { overlayScene: THREE.Scene }) {
  const { size } = useThree();

  const canvas = useMemo(() => document.createElement('canvas'), []);
  const texture = useMemo(() => {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    /*
      Disable mipmaps.
      The default mipmapped minFilter rebuilt the entire mip chain on every `needsUpdate` upload for a screen-size × dpr texture (2560×1305 @2x ≈ 13 MB). This screen-aligned 1:1 quad gains nothing from mipmaps. That wasted work was the largest cost when text was added.
    */
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    return t;
  }, [canvas]);
  const mesh = useMemo(() => makeOverlayMesh(texture), [texture]);

  /*
    Behind layer: draw `layer: 'behind'` text on a second canvas and map it onto a camera-facing, full-frame plane behind the device in the main scene. Depth testing lets the device occlude it; lens blur softens it naturally.
  */
  const { scene: mainScene, camera: liveCam } = useThree();
  const backCanvas = useMemo(() => document.createElement('canvas'), []);
  const backTexture = useMemo(() => {
    const t = new THREE.CanvasTexture(backCanvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
    return t;
  }, [backCanvas]);
  const backMesh = useMemo(() => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: backTexture,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    m.frustumCulled = false;
    m.renderOrder = -1;
    m.visible = false;
    return m;
  }, [backTexture]);
  useEffect(() => {
    mainScene.add(backMesh);
    return () => {
      mainScene.remove(backMesh);
      backMesh.geometry.dispose();
      (backMesh.material as THREE.Material).dispose();
      backTexture.dispose();
    };
  }, [mainScene, backMesh, backTexture]);
  // Fill the frame behind the device on every frame, rather than behind the camera.
  useFrame(() => {
    if (!backMesh.visible) return;
    const cam = liveCam as THREE.PerspectiveCamera;
    const dist = cam.position.length() * 1.7;
    const h = 2 * Math.tan((cam.fov * Math.PI) / 360) * dist;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    backMesh.position.copy(cam.position).addScaledVector(fwd, dist);
    backMesh.quaternion.copy(cam.quaternion);
    backMesh.scale.set(h * cam.aspect, h, 1);
  });

  /*
    Keep text in a separate scene so the main scene's blur pass cannot blur titles or subtitles. A screen-aligned unit quad is unaffected by camera angle.
  */
  useEffect(() => {
    mesh.scale.set(1, 1, 1);
    mesh.position.set(0, 0, 0);
    overlayScene.add(mesh);
    return () => {
      overlayScene.remove(mesh);
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      texture.dispose();
    };
  }, [overlayScene, mesh, texture]);

  /*
    Dirty check. Previously the overlay redrew and reuploaded every frame; the free-plan watermark made even idle scenes perform full canvas redraws + uploads at 60 fps. This was one of the two largest main-screen performance costs.
    Signature: size + text-list reference + watermark + playhead when content is time-dependent. Immutable store updates change the text-list reference on every edit, avoiding deep comparison.
  */
  const forceRef = useRef(true);
  const lastRef = useRef<{
    w: number;
    h: number;
    items: unknown;
    /** Coarse text animation signature; see the dirty-check note. */
    animSig?: string;
    /** Displayed language (localization). */
    lang?: string | null;
    watermark: string | null;
    time: number;
  } | null>(null);

  const draw = useMemo(
    () =>
      (w: number, h: number, withWatermark = false) => {
        const state = useEditor.getState();
        /*
          Keep dimensions fixed during capture. The text layer shares one canvas; an intervening preview-size draw shrank it, making exported text ~1.8× enlarged and blurry. Measured in a 1:1 crop: overlay text was soft while device UI text was sharp. Once recording dimensions are declared, every draw uses them regardless of caller.
        */
        const rsNow = getRecordSize();
        if (rsNow) {
          w = rsNow.w;
          h = rsNow.h;
        }
        /*
          Read the text layer from the scene currently rendered, rather than `shotAtTime`. The stored playhead updates at 15 Hz and can lag the frame loop by 66 ms. At a boundary, drawing old scene text and transition amounts over new scene content leaves a visible trace of the old scene.
        */
        // Hide text/logos in gaps too: when the scene is hidden, its overlay must
        // also disappear, avoiding a title floating over an empty gap.
        if (state.inGap) {
          mesh.visible = false;
          return;
        }
        /*
          ⚠️ This previously read `activeShotId`, which follows the playhead only through useFrame synchronization. That loop does not run during video export, so selection froze: the device showed correct screens while the overlay retained one scene's text for 20 seconds, giving four of five scenes incorrect text. Paused previews and state sampling missed it; only the exported file showed the bug.
          Bind the overlay to the timeline instead of selection. Export sets an exact playhead per frame. During live playback, the ≤33 ms boundary delay from 30 Hz updates is negligible compared with frozen text.
        */
        const atShot = shotAtTime(state.shots, state.playhead);
        const at = { shot: atShot.shot, localTime: atShot.localTime };
        if ((window as unknown as Record<string, unknown>).__dbgOverlay) {
          console.log(
            `[overlay] ${w.toFixed(0)}x${h.toFixed(0)} ph=${state.playhead.toFixed(2)} ` +
              `shot=${at.shot.id} lt=${at.localTime.toFixed(2)} text=${
                (at.shot.texts ?? [])[0]?.text ?? '-'
              }`,
          );
        }
        const localT = at.localTime;
        const srcItems = at.shot.texts ?? [];
        /*
          Localization: resolve preview/export language in one place. Every `item.text` read in overlay.ts (line wrapping, words, counters, subtitles) receives resolved text. Include language in the dirty-check key.
        */
        const lang = state.previewLang && state.languages.includes(state.previewLang) ? state.previewLang : null;
        const items = srcItems.map((item0) => {
          const item = lang && item0.kind !== 'logo' ? { ...item0, text: textIn(item0, lang) } : item0;
          const from = item.start ?? 0;
          const to = item.end ?? at.shot.duration;
          if (localT < from || localT > to) return { ...item, anim: { opacity: 0, rise: 0 } };
          const d = Math.max(0.01, item.transitionDur ?? 0.4);
          const inP = Math.min(1, (localT - from) / d);
          const outP = Math.min(1, (to - localT) / d);
          // Word/knock/cycle manage their own opacity (overlay.ts).
          const own = (k: string) =>
            k === 'none' || k.startsWith('words') || k.startsWith('knock') || k === 'cycle' || k === 'type' || k === 'count';
          const fadeIn = own(item.enter) ? 1 : inP;
          const fadeOut = own(item.exit) ? 1 : outP;
          const opacity = Math.min(fadeIn, fadeOut);
          const riseIn = item.enter === 'rise' ? (1 - inP) * 0.04 : 0;
          const riseOut = item.exit === 'rise' ? -(1 - outP) * 0.04 : 0;
          const life = (localT - from) / Math.max(0.01, to - from);
          /*
            Fixed typewriter speed (~20 characters/s): a short entry duration (0.4 s) would reveal long titles instantly. Counters run for at least 1.2 s; shorter durations are unreadable.
          */
          const typeDur = Math.max(d, item.text.length / 20);
          const typeIn = item.enter === 'type' ? Math.min(1, (localT - from) / typeDur) : 1;
          const typeOut = item.exit === 'type' ? Math.min(1, (to - localT) / typeDur) : 1;
          const countDur = Math.max(d, 1.2);
          const countIn = item.enter === 'count' ? Math.min(1, (localT - from) / countDur) : 1;
          const countOut = item.exit === 'count' ? Math.min(1, (to - localT) / countDur) : 1;
          return {
            ...item,
            anim: {
              opacity,
              rise: riseIn + riseOut,
              inP,
              outP,
              life,
              type: Math.min(typeIn, typeOut),
              count: Math.min(countIn, countOut),
            },
          };
        });

        /*
          Draw the canvas watermark only for export/video recording. Preview uses the DOM pill in Stage: fractional sampling at dpr values such as 1.25 made canvas text uneven, and alignment could not fully fix it. HTML text stays crisp on every screen; the export canvas version preserves the watermark in output.
        */
        const watermark = withWatermark && !state.isPro ? BRAND.wordmark : null;

        /*
          Transition amount falls from 1 to 0 at the scene start and rises from 0 to 1 at the end, joining neighboring transitions at the cut's darkest point.
          ⚠️ Two fixes for nonfunctional fade/slide:
          1) Check playing OR capturing, rather than `state.playing`. Frame-by-frame export advances time via `seek` with `playing` false, previously omitting transitions from downloaded video. Measured `[tr] playing=false rs=var`: the overlay drew, but the condition excluded transitions.
          2) Calculate before the visibility check. `mesh.visible = <has text> || <has watermark>` hid the layer and returned for Pro users without text, skipping transition code below it. The same project produced 372 draws on free and 0 on Pro. Transitions now also make the layer visible.
        */
        const capturingNow = rsNow !== null;
        let transition: { kind: 'cut' | 'fade' | 'slide'; amount: number } | undefined;
        const tr = at.shot.transition;
        if ((state.playing || capturingNow) && tr && tr.kind !== 'cut' && tr.duration > 0) {
          const half = tr.duration / 2;
          const inAmt = 1 - Math.min(1, at.localTime / half);
          const outAmt = 1 - Math.min(1, (at.shot.duration - at.localTime) / half);
          transition = { kind: tr.kind, amount: Math.max(inAmt, outAmt) };
        }

        mesh.visible =
          items.some((t) => t.visible && (t.anim?.opacity ?? 1) > 0.001) ||
          !!watermark ||
          (!!transition && transition.amount > 0.001);
        if (!mesh.visible) {
          backMesh.visible = false;
          return;
        }

        // Scrolling subtitles and transitions depend on time; include playhead in
        // the signature only when needed, avoiding redraws on every tick for static scenes.
        /*
          Include playhead for scrolling subtitles, transitions, or text with a time window. Omitting windows would let the dirty check skip the text's appearance/disappearance.
        */
        const timeDependent =
          !!transition ||
          items.some(
            (t) =>
              t.visible &&
              (t.kind === 'ticker' ||
                (t.start ?? 0) > 0 ||
                t.end != null ||
                t.enter !== 'none' ||
                t.exit !== 'none'),
          );
        /*
          Round the time key.
          Raw `playhead` defeated the dirty check: playback supplied 30 values/s and timeline scrubbing 60–120, each causing a full-resolution canvas redraw + GPU upload. Entry/exit transitions last 0.4 s, and ~20 distinct frames/s are enough to read them. This reduces scrubbing redraws 3–6× with no visible animation loss.
        */
        const time = timeDependent ? Math.round(state.playhead * 20) : -1;

        /*
          Dirty check: `items` is now a new array every frame because animation state is evaluated. Reference comparison would always report changes, causing redraws + GPU uploads every frame, repeating the watermark issue. Use the source array reference plus a coarse animation signature.
        */
        const animSig = items
          .map((i) => `${Math.round((i.anim?.opacity ?? 1) * 100)}:${Math.round((i.anim?.rise ?? 0) * 1000)}`)
          .join(',');
        /*
          Bypass the dirty check during recording as a defensive measure.
          ⚠️ This did not fix frozen text; the actual cause was the texture-size pitfall below. Keep it because captured frames must be freshly drawn, rather than use whatever happens to be on the GPU. The cost applies only to export, which already renders the full pipeline per frame.
        */
        const capturing = rsNow !== null;
        const last = lastRef.current;
        if (
          !capturing &&
          !forceRef.current &&
          last &&
          last.w === w &&
          last.h === h &&
          last.items === srcItems &&
          last.lang === lang &&
          last.animSig === animSig &&
          last.watermark === watermark &&
          last.time === time
        ) {
          return;
        }
        forceRef.current = false;
        lastRef.current = { w, h, items: srcItems, lang, animSig, watermark, time };

        /*
          ⚠️ Dispose the texture when canvas dimensions change.
          `needsUpdate` alone is insufficient: after an initial preview-size upload (1042×532), resizing to export size (1080×1920) stopped uploads reaching the GPU, freezing old content. Playing once before export left the last scene's text throughout a 20 s video, identical to the last preview draw (ph=19.90 / 1042×532). Exporting without playback worked because the first upload already used target dimensions.
          Play then Export is a normal workflow. `dispose()` releases the GPU texture so three.js rebuilds it next frame. It runs only on size changes, a few times per export.
        */
        const prevW = canvas.width;
        const prevH = canvas.height;
        const back = items.filter((t) => t.layer === 'behind');
        drawOverlay(canvas, {
          width: Math.max(2, Math.round(w)),
          height: Math.max(2, Math.round(h)),
          items: items.filter((t) => t.layer !== 'behind'),
          time: state.playhead,
          watermark,
          transition,
        });
        const backOn = back.some((t) => t.visible && (t.anim?.opacity ?? 1) > 0.001);
        backMesh.visible = backOn;
        if (backOn) {
          const bw = backCanvas.width;
          const bh = backCanvas.height;
          drawOverlay(backCanvas, {
            width: Math.max(2, Math.round(w)),
            height: Math.max(2, Math.round(h)),
            items: back,
            time: state.playhead,
          });
          if (backCanvas.width !== bw || backCanvas.height !== bh) backTexture.dispose();
          backTexture.needsUpdate = true;
        }
        if (canvas.width !== prevW || canvas.height !== prevH) texture.dispose();
        texture.needsUpdate = true;
        if ((window as unknown as Record<string, unknown>).__dbgOverlay) {
          console.log(`[canvas] istenen=${Math.round(w)}x${Math.round(h)} gercek=${canvas.width}x${canvas.height} exporting=${state.exporting} wm=${withWatermark}`);
        }
      },
    [canvas, mesh, texture, backCanvas, backMesh, backTexture],
  );

  // Load selected fonts on demand. Force a redraw when ready:
  // otherwise the dirty check would leave the fallback-font frame on screen.
  const fonts = useEditor((s) => s.active().texts.map((t) => t.font).join(','));
  useEffect(() => {
    const families = fonts.split(',').filter(Boolean);
    if (!families.length) return;
    void Promise.all(families.map((f) => ensureFont(f))).then(() => {
      forceRef.current = true;
    });
  }, [fonts]);

  /*
    Fallback guard: redraw as soon as any web font loads, whether requested by the text panel, template, project load, or a slow network. The `ensureFont` promise once resolved before the stylesheet loaded, leaving preview stuck on the fallback font.
  */
  useEffect(() => {
    const fs = document.fonts;
    if (!fs?.addEventListener) return;
    const onDone = () => {
      forceRef.current = true;
    };
    fs.addEventListener('loadingdone', onDone);
    return () => fs.removeEventListener('loadingdone', onDone);
  }, []);

  /*
    Force a redraw when logo images load. Same pitfall as fonts: the dirty check otherwise sees no change, skips drawing, and the logo never appears.
  */
  useEffect(() => {
    setLogoLoadedHandler(() => {
      forceRef.current = true;
    });
    return () => setLogoLoadedHandler(null);
  }, []);

  // Let the export bridge redraw the overlay at target resolution;
  // exports always include the watermark on the free plan.
  useEffect(() => {
    registerOverlayDraw((w, h) => draw(w, h, true));
    return () => registerOverlayDraw(null);
  }, [draw]);

  useFrame(() => {
    const rs = getRecordSize();
    /*
      Preview stays below dpr 2, with the long edge capped at 1600.
      The text overlay is a screen-aligned quad; redrawing and uploading a 2560×1305 @2x ≈ 13 MB canvas on every change cost far more than the sharpness gained. The export path (`rs`) is unaffected: it always draws at target resolution, preserving output quality.
    */
    if (rs) {
      draw(rs.w, rs.h, true);
      return;
    }
    /*
      Do not draw preview during export. The overlay shares one canvas; preview draws (e.g. 1042×532) interrupt target-size export draws and resize it, leaving stale text or drawing text twice at different scales. Measured: 3417 preview draws interleaved with 2148 target-size draws in one export.
    */
    if (useEditor.getState().exporting) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const long = Math.max(size.width, size.height) * dpr;
    const k = long > 1600 ? 1600 / long : 1;
    draw(size.width * dpr * k, size.height * dpr * k, false);
  });

  return null;
}

/**
 * Attach the background to the scene rather than a plane.
 * A plane needed size and distance adjustments as camera distance changed 5× between watches and laptops; it either failed to fill the frame or moved in front of the camera. Scene backgrounds always fill the frame without geometry overhead.
 */
/**
 * Screen glow color, sampled from user media.
 * Source priority: media texture → screen background (`screenBg`) → no light. The background color can illuminate the scene even without media: choosing green turns the room green.
 * ⚠️ Limit state writes: video can be sampled several times per second, but every `setState` would rerender Stage. Update only when the coarse color changes; unchanged images require no rerenders.
 */
function useScreenGlowColor(
  tex: THREE.Texture | null,
  mediaKey: string | null,
  screenBg: string | null,
  active: boolean,
  isVideo: boolean,
  playing: boolean,
): THREE.Color | null {
  const [color, setColor] = useState<{ c: THREE.Color; key: string } | null>(null);
  const keyRef = useRef<string | null>(null);

  useEffect(() => {
    // Skip sampling when disabled: default projects pay no cost for this code.
    if (!active) return;

    const sample = () => {
      const src = tex?.image as CanvasImageSource | undefined;
      if (!src) return;
      /*
        Dimensions depend on source type: naturalWidth for images, videoWidth for video, width for canvas fallbacks. Reading the wrong field makes `drawImage` 0×0 and silently leaves the color black.
      */
      const el = src as HTMLImageElement & HTMLVideoElement & HTMLCanvasElement;
      const w = el.naturalWidth || el.videoWidth || el.width || 0;
      const h = el.naturalHeight || el.videoHeight || el.height || 0;
      // Video keys change over time; only cache images by URL
      // to avoid polluting the cache.
      const c = isVideo ? averageColor(src, w, h) : cachedAverageColor(mediaKey ?? 'media', src, w, h);
      if (!c) return;
      const q = quantize(c);
      if (q === keyRef.current) return;
      keyRef.current = q;
      setColor({ c, key: q });
    };

    sample();
    // Sample playing videos periodically: 4 Hz captures visible color changes
    // without affecting the frame budget.
    if (!isVideo || !playing) return;
    const id = window.setInterval(sample, 250);
    return () => window.clearInterval(id);
  }, [tex, mediaKey, active, isVideo, playing]);

  /*
    Without media, the screen background color supplies the light. Derive it directly without state: `screenBg` is a string and needs no sampling.
  */
  if (!active) return null;
  if (!tex) return colorFromScreenBg(screenBg);
  return color?.c ?? colorFromScreenBg(screenBg);
}

function SceneBackground({
  texture,
  envRotation,
  envTilt = 0,
  envIntensity,
  envId,
  glow,
}: {
  texture: THREE.Texture | null;
  envRotation: number;
  envTilt?: number;
  envIntensity: number;
  envId: string;
  glow: ScreenGlow | null;
}) {
  const { scene, gl } = useThree();

  /*
    Use a layout effect so background/environment apply during React commit. useEffect runs later; at scene boundaries, frame-by-frame export drew the new device against the old background. Measured at 23.233 s: the first frame of a white FREE scene had a black background.
  */
  useLayoutEffect(() => {
    scene.background = texture;
    return () => {
      scene.background = null;
    };
  }, [scene, texture]);

  /*
    Rotating the environment gives more control than moving a light: choose which glass edge catches a highlight without moving the device or changing framing.
  */
  useLayoutEffect(() => {
    scene.environmentRotation = new THREE.Euler((envTilt * Math.PI) / 180, (envRotation * Math.PI) / 180, 0);
    scene.environmentIntensity = envIntensity;
  }, [scene, envRotation, envTilt, envIntensity]);

  // Use the environment map only for reflections, never as the visible background.
  // Glass and metal stay in the same studio regardless of the background gradient.
  // Writing to the scene object is a normal three.js integration point; the lint
  // rule against mutating hook return values does not target this usage.
  /*
    Bake screen glow into the environment map: glass and metal respond to the environment rather than direct light (see environment.ts ScreenGlow). Dependencies use coarse color and intensity steps; every intermediate slider value would otherwise allocate a texture and PMREM conversion.
  */
  const glowKey = glow ? glow.key : '';
  const glowStep = glow ? Math.round(Math.min(3, glow.amount) * 4) : 0;
  /*
    HDRI presets use a real studio photo. With screen glow enabled, bake its colored pool over the HDRI via PMREM (environment.ts getHdriGlowEnvironment). The initial implementation lacked this path, leaving the Screen glow slider ineffective in the new default 'photo' lighting.
  */
  const hdriVer = useSyncExternalStore(subscribeHdri, hdriVersion, () => 0);
  const studioVer = useSyncExternalStore(subscribeStudio, studioVersion, () => 0);
  useLayoutEffect(() => {
    // Prefer HDR studio (hdrStudio.ts): panels with realistic luminance.
    const studio = getHdrStudioEnvironment(gl, envId, ENV_PRESETS.find((p) => p.id === envId)?.hdrStudio, glow);
    const hdr = studio ? null : getHdriEnvironment(envId);
    scene.environment = studio
      ? studio
      : hdr
        ? glow && glow.amount > 0.001
          ? (getHdriGlowEnvironment(gl, envId, glow) ?? hdr)
          : hdr
        : getStudioEnvironment(envId, glow);
    return () => {
      scene.environment = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- glow is tracked coarsely (glowKey/glowStep)
  }, [scene, gl, envId, glowKey, glowStep, hdriVer, studioVer]);

  return null;
}

/**
 * Bind camera state from the store to the scene.
 * Derive distance from device size: a watch is 5 cm, a laptop 31 cm. Fixed distance would shrink one to a dot and crop the other. This makes `zoom = 1` fit every device fully, giving motion presets a consistent feel across devices.
 */
/**
 * Device rotation groups. Stage registers refs; CameraRig writes them in the frame loop because tracks/presets do not trigger React renders (see CameraRig's device rotation note). Module scope is sufficient with a single Stage.
 */
const deviceRotGroups: { main: THREE.Group | null; mirror: THREE.Group | null; flap: THREE.Group | null } = {
  main: null,
  mirror: null,
  flap: null,
};

/**
 * Layout slot groups for per-device animation.
 * Each main device, reflection copy, and extra device has a position/rotation/scale slot group. React supplies the same values as props; CameraRig evaluates `mainSlot.*` / `extras.<id>.*` tracks at exact frame time and overwrites them, for the same reason as `crop.scroll` (playhead updates at ~30 Hz during playback). Write even without tracks: R3F does not reapply unchanged props, so removing a track would otherwise leave the device in its last animated pose.
 */
const deviceSlotGroups: { main: THREE.Group | null; mirror: THREE.Group | null; extras: Map<string, THREE.Group> } = {
  main: null,
  mirror: null,
  extras: new Map(),
};
/** Slot unit (main device body), written by the frame loop for diagnostics. */
const slotUnit = { w: 0, h: 0 };

/** Diagnostics/tests (localhost debug only): current slot-group transforms. */
export function debugSlotGroups() {
  const pick = (g: THREE.Group | null | undefined) =>
    g ? { x: g.position.x, y: g.position.y, z: g.position.z, r: g.rotation.y, s: g.scale.x } : null;
  return {
    unitW: slotUnit.w,
    unitH: slotUnit.h,
    main: pick(deviceSlotGroups.main),
    mirror: pick(deviceSlotGroups.mirror),
    extras: Object.fromEntries([...deviceSlotGroups.extras].map(([k, g]) => [k, pick(g)])),
  };
}

function CameraRig({
  device,
  spread,
  renderShotId,
}: {
  device: Device;
  spread: number;
  /**
   * ID of the scene currently drawn on screen by React. Read the camera from this scene; see the detailed note below.
   */
  renderShotId: string;
}) {
  const { camera: cam, gl, scene, size } = useThree();
  // Pause the loop for single-frame capture and advance frames manually
  // during video export (see exportBridge notes).
  const setFrameloop = useThree((s) => s.setFrameloop);
  const advance = useThree((s) => s.advance);

  // Pass refs to the export bridge: the top-bar EXPORT button
  // can access the scene only through this bridge.
  useEffect(() => {
    registerScene({ gl, scene, camera: cam as THREE.PerspectiveCamera, setFrameloop, advance });
    /*
      Expose the renderer on localhost for performance diagnostics. `__gl.info.programs` reveals when shader compilation happens, which identified the source of transition stalls.
    */
    if (window.location.hostname === 'localhost') {
      (window as unknown as Record<string, unknown>).__gl = gl;
      // Expose the applied camera too: content/camera mismatches
      // can only be diagnosed by measuring both together.
      (window as unknown as Record<string, unknown>).__cam = cam;
      // Expose the scene graph for diagnostics too: diff it at boundary spikes
      // to identify newly created materials.
      (window as unknown as Record<string, unknown>).__scene = scene;
    }
    return () => registerScene(null);
  }, [gl, scene, cam, setFrameloop, advance]);

  /*
    Idle warmup: decode and upload all project scene images in the background shortly after startup (`gl.initTexture`). Otherwise first appearances pay decode+upload costs, causing a 200 ms stall in the landing demo's laptop scene.
  */
  useEffect(() => {
    const t = window.setTimeout(() => {
      const urls = new Set<string>();
      for (const sh of useEditor.getState().shots) {
        if (sh.media && sh.mediaKind === 'image') urls.add(sh.media);
        for (const e of sh.extras) if (e.media && e.mediaKind === 'image') urls.add(e.media);
      }
      /*
        Count remaining images. Previously loading merely started after 700 ms and playback ignored it, so first-time visitors saw the demo play before images loaded. A zero count signals ready textures; device warmup also waits for that signal.
      */
      /*
        Include fonts in the readiness chain. On slow connections, web fonts loaded after playback started, forcing an overlay redraw and a measured ~90 ms spike at 400 kb/s. Do not signal readiness before fonts are ready.
      */
      let pending = urls.size + 1;
      const done = () => {
        pending -= 1;
        // Each completion signals progress, resetting DeviceWarmup's fallback timer
        // so a slow connection is not mistaken for a dead one.
        useEditor.getState().bumpWarmTick();
        if (pending <= 0) useEditor.getState().setTexturesWarm();
      };
      const finish = (img: HTMLImageElement, url: string) => {
        // Reuse existing textures; otherwise create and call gl.initTexture (setWarmRenderer).
        cacheDecodedImage(url, img);
        done();
      };
      void (document.fonts?.ready ?? Promise.resolve()).then(done, done);
      for (const url of urls) {
        if (textureCache.has(url)) {
          done();
          continue;
        }
        /*
          Use streaming fetch rather than `new Image()` so the fallback timer can observe progress. Image() emits no signals during download; at 400 kb/s, the first image exceeded 4 s and triggered the dead-network fallback early (assetsReady=true while texturesWarm=false). Each chunk advances warmTick, so only actual inactivity triggers the fallback. Supports packaged `/demo/...` paths and blob:/data: URLs; fall back to Image() if fetch cannot handle the source.
        */
        void (async () => {
          try {
            const res = await fetch(url);
            if (!res.ok || !res.body) throw new Error(String(res.status));
            const reader = res.body.getReader();
            const parts: BlobPart[] = [];
            for (;;) {
              const { done: eof, value } = await reader.read();
              if (eof) break;
              parts.push(value);
              useEditor.getState().bumpWarmTick();
            }
            const objUrl = URL.createObjectURL(new Blob(parts));
            const img = new Image();
            img.onerror = () => {
              URL.revokeObjectURL(objUrl);
              done();
            };
            img.onload = () => {
              finish(img, url);
              URL.revokeObjectURL(objUrl);
            };
            img.src = objUrl;
          } catch {
            const img = new Image();
            // Do not let network errors block the chain: failures also count as finished.
            img.onerror = done;
            img.onload = () => finish(img, url);
            img.src = url;
          }
        })();
      }
      // Start after 200 ms without blocking first paint. Measure completion
      // rather than waiting 700 ms and assuming downloads finished.
    }, 200);
    return () => window.clearTimeout(t);
  }, [gl]);

  /*
    Late images: startup warmup only covered the initial project. Images from uploads, templates, or project files loaded on first scene appearance, leaving the screen white for 1+ frames. Now load and upload new images in the background as the project changes.
  */
  useEffect(() => {
    setWarmRenderer(gl);
    const stop = startProjectImageWarmer();
    return () => {
      stop();
      setWarmRenderer(null);
    };
  }, [gl]);

  /*
    Calculate the camera every frame rather than in an effect. Motion presets change it continuously during playback; writing React state would cause 60 renders/s. Read the store without subscribing: panel edits reach the scene on the next frame.
  */
  const globalTime = useRef(0);
  const uiClock = useRef(0);
  // Last processed playhead value for selection synchronization.
  const lastSyncedPlayhead = useRef<number | null>(null);
  // Last playhead written by the playback loop itself, to distinguish external seeks
  // (timeline clicks, automation) from our own 30 Hz updates.
  const selfPlayhead = useRef<number | null>(null);
  // Handheld time advances independently of playback, allowing subtle
  // movement even while the scene is paused.
  const clock = useRef(0);

  useFrame((_, delta) => {
    clock.current += delta;
    const state = useEditor.getState();

    /*
      One global timeline. Previously each shot looped on its local clock, so playback never reached the second shot. Time now spans the total duration of all shots, displaying the scene at the current time.
    */
    const total = totalDuration(state.shots);

    if (state.playing) {
      globalTime.current += delta;
      if (globalTime.current >= total) {
        // Stop at the end when looping is disabled: recordings and single plays
        // should not jump back to the start.
        if (state.loop) {
          globalTime.current = 0;
        } else {
          globalTime.current = Math.max(0, total - 0.001);
          state.setPlaying(false);
          state.setPlayhead(Math.round(globalTime.current * 100) / 100);
        }
      }

      // Update playhead ~30 times/s. Writing the store every frame would
      // rerender the timeline at 60 fps; 15 visibly stuttered.
      // 30 is a smooth compromise between them.
      uiClock.current += delta;
      if (uiClock.current > 1 / 30) {
        uiClock.current = 0;
        const v = Math.round(globalTime.current * 100) / 100;
        selfPlayhead.current = v;
        state.setPlayhead(v);
      }
    } else {
      // When paused, show the scene at the playhead so users can see
      // which frame they are writing while recording.
      globalTime.current = state.playhead;
    }

    /*
      Synchronize active shot only when the playhead moves. Doing it every frame overrode user selection: "+ Scene" selected a new scene, then immediately jumped back to the old scene under the stationary playhead. Synchronize only on playback, timeline scrubbing, or scene clicks that change the playhead.
    */
    /*
      External seek: if playhead changed outside our own 30 Hz writes (timeline click, automation, scene jump), update time even during playback. Previously globalTime read playhead only while paused, silently swallowing pause+seek+play within the same tick.
    */
    if (
      state.playing &&
      lastSyncedPlayhead.current !== state.playhead &&
      selfPlayhead.current !== state.playhead
    ) {
      globalTime.current = state.playhead;
    }
    /*
      Synchronize audio in the frame loop. A React component subscribed to playhead would cause 15 renders/s during playback. The bridge seeks only as needed, with 0.25 s tolerance. Call even with an empty list so it can silence audio from deleted clips or previous projects; the old `length` guard prevented this.
    */
    syncAudio(state.audioTracks, globalTime.current, state.playing);
    const at = shotAtTime(state.shots, globalTime.current);
    if (at.inGap !== state.inGap) state.setInGap(at.inGap);
    if (lastSyncedPlayhead.current !== state.playhead) {
      lastSyncedPlayhead.current = state.playhead;
      if (at.shot.id !== state.activeShotId) state.selectShot(at.shot.id);
    }

    /*
      Scene boundary frame regression: cause and solution.
      Observed sequence: shot1, shot1, shot2, one frame of shot1, then shot2. Two time sources caused it. Scene content (device, media, background) comes from React and rerenders when `active()` changes; the camera was derived from time via `shotAtTime` in `useFrame`. At the boundary, the camera immediately jumped to shot2 while React still displayed shot1 content. The next frame updated content too. That mismatch looked like an old frame returning because framing moved before content.
      Read the camera from the currently rendered scene too. Both then switch together, trading one frame (~16 ms) of imperceptible delay for consistently matched content and camera.
    */
    const renderIndex = state.shots.findIndex((x) => x.id === renderShotId);
    const shot0 = renderIndex >= 0 ? state.shots[renderIndex] : at.shot;
    // Template preview uses the same scene ID; read its camera too (see Stage note).
    const shot = state.previewShot && state.previewShot.id === shot0.id ? state.previewShot : shot0;
    const shotBegin = renderIndex >= 0 ? shotStart(state.shots, shot.id) : globalTime.current - at.localTime;
    const localTime = Math.min(Math.max(0, globalTime.current - shotBegin), shot.duration);
    let camera = shot.camera;

    // Screen scrolling: exact time per frame (see applyScreenScroll).
    {
      const scrollTrack = shot.tracks.find((t) => t.path === 'crop.scroll');
      const v = scrollTrack ? evaluateTrack(scrollTrack, localTime) : undefined;
      if (v !== undefined) applyScreenScroll(v);
    }
    // Screen annotations: same reason, same exact time (screenMarks.ts).
    drawScreenMarks(shot.annotations, localTime, shot.duration);

    const motion = MOTION_PRESETS.find((m) => m.id === shot.motionId);

    /*
      Apply animation only during playback and recording.
      Applying it always would override manual camera edits after the first keyframe, making dragging appear ineffective while recording is off. When paused with recording off, use the user's angle.
    */
    /*
      Always apply tracks, including while paused.
      The old keyframe model stored the entire camera, so applying it while paused overwrote manual angles. The new model changes only tracked fields, edited by writing keyframes. Scrubbing now previews animation and keeps panel values in sync with the scene. Built-in motion presets still run only during playback.
    */
    {
      /*
        Only camera tracks override presets. The old `tracks.length > 0` condition disabled built-in motion whenever a scene had even one blur/light keyframe.
      */
      if (shot.tracks.some((t) => t.path.startsWith('camera.'))) {
        /*
          Property tracks override built-in presets.
          Change only fields that have tracks. The old model stored the entire camera per keyframe; editing an unkeyframed field was then overwritten by the stale snapshot, making settings appear to reset themselves.
        */
        for (const track of shot.tracks) {
          if (!track.path.startsWith('camera.')) continue;
          const v = evaluateTrack(track, localTime);
          if (v !== undefined) {
            camera = { ...camera, [track.path.slice('camera.'.length)]: v };
          }
        }
      } else if (motion && (state.playing || state.recording || state.exporting)) {
        camera = { ...camera, ...sampleMotion(motion, localTime / Math.max(0.001, shot.duration)) };
      }
    }

    /*
      Write device rotation (Rotate X/Y, Flap) from the frame loop too.
      ⚠️ These three fields were previously read from `shot.camera` only during React renders. Camera tracks and motion presets do not trigger rerenders, so the device froze at its initial rotation: "Fold up" stayed at −68° throughout, and Rotate X/Y keyframes did not animate. Measured scene-graph group rotations were identical at three sampled times.
    */
    {
      const rx = (camera.rotX * Math.PI) / 180;
      const ry = (camera.rotY * Math.PI) / 180;
      for (const g of [deviceRotGroups.main, deviceRotGroups.mirror]) {
        if (g) g.rotation.set(rx, ry, 0);
      }
      if (deviceRotGroups.flap) deviceRotGroups.flap.rotation.x = (-(camera.flap ?? 0) * Math.PI) / 180;
    }

    // Layout slots: evaluate tracked fields at exact time (see deviceSlotGroups note).
    {
      type SlotV = { x: number; y: number; z: number; rotY: number; scale: number };
      const W = device.body.w;
      const H = device.body.h;
      slotUnit.w = W;
      slotUnit.h = H;
      const slotTracks = shot.tracks.filter((t) => isSlotPath(t.path));
      const at = (prefix: string, base: SlotV): SlotV => {
        if (!slotTracks.length) return base;
        const v = { x: base.x, y: base.y, z: base.z, rotY: base.rotY, scale: base.scale };
        for (const t of slotTracks) {
          if (!t.path.startsWith(prefix)) continue;
          const val = evaluateTrack(t, localTime);
          if (val !== undefined) v[t.path.slice(prefix.length) as keyof SlotV] = val;
        }
        return v;
      };
      const put = (g: THREE.Group | null | undefined, v: SlotV) => {
        if (!g) return;
        g.position.set(v.x * W, v.y * H, v.z * W);
        g.rotation.set(0, (v.rotY * Math.PI) / 180, 0);
        // Zero scale makes a singular matrix: enforce the lower bound from tracks.ts SLOT_FIELDS.
        g.scale.setScalar(Math.max(0.02, v.scale));
      };
      const m = at('mainSlot.', shot.mainSlot);
      put(deviceSlotGroups.main, m);
      put(deviceSlotGroups.mirror, m);
      for (const e of shot.extras) put(deviceSlotGroups.extras.get(e.id), at(`extras.${e.id}.`, e));
    }

    const c = cam as THREE.PerspectiveCamera;
    /*
      Perspective reduction prevents a door-like swing.
      At frame-filling distance and FOV 18, horizontal rotation enlarged the near edge by over 40%, shifting the device's visual center sideways. Keep the panel value, but multiply the render angle by 0.55: the same framing is captured farther away with a narrower angle, like a telephoto lens. Rotation then feels centered, like a turntable.
    */
    c.fov = camera.fov * 0.55;
    // For video recording, derive aspect ratio from target resolution rather than CSS size.
    const rs = getRecordSize();
    c.aspect = rs ? rs.w / rs.h : size.width / Math.max(1, size.height);

    /*
      Bounding sphere radius, including body details.
      Fitting only the body cropped watch straps and laptop bases: the camera fit the case but cut off everything else.
    */
    const { w, d } = device.body;
    let { h } = device.body;
    let depth = d;
    const band = device.features?.band;
    const base = device.features?.base;
    const stand = device.features?.stand;
    if (band) h += band.length * 2 * 0.9;
    if (base) depth = Math.max(depth, base.depth * 0.9);
    // Monitor stands extend below the body; include them in framing.
    if (stand) {
      h += (stand.neckH + stand.baseH) * 1.4;
      depth = Math.max(depth, stand.baseD * 0.8);
    }
    // Multi-device layouts extend sideways; include that width in framing.
    const width = w * (1 + spread);

    /*
      Framing calibration: fit by axis rather than by sphere.
      The old approach fit a bounding sphere to vertical FOV. For wide devices (laptops, FLAT cards), width determined sphere radius and vertical fitting shrank the device to ~40% of the frame at zoom 2.91.
      Fit width to horizontal FOV and height to vertical FOV separately; add depth to each axis using the Pythagorean theorem to prevent clipping during rotation. zoom = ZOOM_FIT (2.91) means fill the frame.
    */
    const halfW = Math.sqrt(width * width + depth * depth) / 2;
    const halfH = Math.sqrt(h * h + depth * depth) / 2;
    const vFov = (c.fov * Math.PI) / 180; // Effective tilted angle: framing and pan must use the same angle.
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * c.aspect);
    const fitV = halfH / Math.tan(vFov / 2);
    const fitH = halfW / Math.tan(hFov / 2);
    const distance =
      (Math.max(fitV, fitH) * 1.04 * ZOOM_FIT) / Math.max(0.1, camera.zoom);

    const yaw = (camera.tiltY * Math.PI) / 180;
    const pitch = (camera.tiltX * Math.PI) / 180;

    /*
      HDR studio lights rotate with the camera. With world-fixed panels, orbiting the camera moved reflections out of frame, leaving the metal frame and screen glass reflecting a dark room. Product lighting is camera-relative: key and edge strips should hit consistently from every angle. User environment rotation/tilt adds an offset. Procedural/HDRI presets remain world-fixed, preserving existing projects.
    */
    if (ENV_PRESETS.find((p) => p.id === shot.scene.envId)?.hdrStudio) {
      const L = lookdev();
      const er = scene.environmentRotation;
      er.order = 'YXZ';
      er.set(
        pitch * L.envFollowPitch + ((shot.light.envTilt ?? 0) * Math.PI) / 180,
        yaw * L.envFollowYaw + ((shot.light.envRotation ?? 0) * Math.PI) / 180,
        0,
      );
    }

    c.position.set(
      Math.sin(yaw) * Math.cos(pitch) * distance,
      Math.sin(-pitch) * distance,
      Math.cos(yaw) * Math.cos(pitch) * distance,
    );
    c.up.set(0, 1, 0);
    c.lookAt(0, 0, 0);
    c.rotateZ((camera.roll * Math.PI) / 180);

    /*
      Express pan as a fraction of visible area, independent of device scale. pan = 3 (extreme) shifts by half a frame. Using 1 = half a frame previously pushed devices out of view even at the default 0.30.
    */
    const viewH = 2 * Math.tan(vFov / 2) * distance;
    let px = (camera.panX / 6) * viewH * c.aspect;
    let py = (camera.panY / 6) * viewH;

    /*
      Handheld motion sums three sine waves with different, incommensurate frequencies. One sine swings regularly like a pendulum and looks artificial; near-prime ratios create an organic, nonrepeating path.
    */
    if (camera.handheld > 0.001) {
      /*
        ⚠️ Time source: `clock.current` previously used wall time, producing different frames on repeated exports of the same project, contradicting webcodecs.ts's machine-independent deterministic output. In frame-by-frame export, shake followed rendering speed instead of timeline time, becoming irregular noise. Verification found device positions shifting between two renders of the same instant.
        Use timeline time for deterministic, repeatable, time-dependent shake.
      */
      /*
        ⚠️ Use `globalTime`, not `state.playhead`. During playback, playhead updates at only ~30 Hz, rounded to 0.01 s, making handheld offsets step on 60/120 Hz displays and repeat every other frame. Measured on a GPU with a high-refresh display: the camera did not move in 88% of 180 consecutive frames; after the fix, 0%. globalTime is smooth during playback and equals playhead while paused or exporting, preserving determinism.
      */
      const t = globalTime.current;
      const a = camera.handheld * viewH * 0.012;
      px += (Math.sin(t * 0.7) + Math.sin(t * 1.63) * 0.6) * a;
      py += (Math.cos(t * 0.53) + Math.sin(t * 1.19) * 0.5) * a;
      c.rotateZ(Math.sin(t * 0.41) * camera.handheld * 0.006);
    }

    c.translateX(px);
    c.translateY(py);

    c.near = Math.max(0.01, distance / 100);
    c.far = distance * 20;
    c.updateProjectionMatrix();
  });

  return null;
}

/** Extra horizontal width occupied by the layout, for framing calculations. */
function layoutSpread(
  mainSlot: { x: number },
  extras: { x: number; scale: number }[],
): number {
  const xs = [mainSlot.x, ...extras.map((e) => e.x)];
  const span = Math.max(...xs) - Math.min(...xs);
  return span;
}

/*
  Preview antialiasing uses jitter instead of an SSAA resolution floor.
  The old 1.6 floor rendered at 1.6× on 1× monitors and let the browser downscale. Measured fractional bilinear downsampling weighted source pixels unevenly, making edges shimmer more than at 1× as the camera approached. Remaining shimmer comes mainly from subpixel highlights; jitter accumulation addresses it, rather than resolution alone (see jitterPass.ts).
  Match the buffer to device pixels (dpr = devicePixelRatio, capped at 2), avoiding browser downsampling. Jitter samples ≈ 8 / dpr²: 8 at 1×, 4 at 1.5×, 2 at 2×. On frame-rate decline, `PerformanceMonitor` first halves samples (8→4→2→1), then reduces the buffer to 1 on 2× displays. Reductions are permanent for the session to avoid oscillation.
*/
function baseJitter(): number {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return jitterLevel(8 / (dpr * dpr));
}

export function Stage() {
  const hostRef = useRef<HTMLDivElement>(null);
  useCanvasControls(hostRef);
  // Number of quality reductions by the guard (see above).
  const aaStep = useRef(0);
  const [dprMax, setDprMax] = useState(2);
  // Sample count lives at module scope for PostProcessing, rather than React state.
  useEffect(() => {
    setPreviewJitter(baseJitter());
  }, []);
  const declineAA = () => {
    aaStep.current += 1;
    const n = baseJitter() / 2 ** aaStep.current;
    // After jitter reaches 1, the next decline reduces the buffer to 1 on 2× displays.
    if (n >= 1) setPreviewJitter(n);
    else setDprMax(1);
  };
  const optimizedNow = useEditor((s) => s.optimizedPlayback && s.playing && !s.exporting);
  // Unmount the guard during export; see the explanation below.
  const exporting = useEditor((s) => s.exporting);
  /*
    ⚠️ Measured: enabling the guard immediately reduced quality on every machine, even leaving an RTX 5070 Ti preview buffer at 1182 px. Startup shader compilation in DeviceWarmup and GPU texture uploads temporarily lower frame rate; `PerformanceMonitor` mistook this for a weak GPU. Arm the guard only after the scene settles.
  */
  const guardArmed = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      guardArmed.current = true;
    }, 6000);
    return () => clearTimeout(t);
  }, []);

  // Separate text overlay scene, rendered after blur.
  const overlayScene = useMemo(() => new THREE.Scene(), []);
  const aspect = getAspect(useEditor((s) => s.aspectId));
  /*
    Template preview: render `previewShot` when set. Every active-scene read uses the same source: these four selectors, CameraRig, and PostProcessing.renderFrame. Panels and timeline keep reading `shots`, remaining stable during preview.
  */
  const mainSlot = useEditor((s) => (s.previewShot ?? s.active()).mainSlot);
  // Expand the shadow area for multi-device layouts too, or shadows
  // from devices at the sides will be clipped.
  const spreadScale = layoutSpread(mainSlot, useEditor((s) => (s.previewShot ?? s.active()).extras));

  /*
    Calculate frame dimensions in JS.
    Pure CSS `aspect-ratio` plus `max-width/height` conflicted at wide ratios (21:9): constraining width left height fixed and distorted the ratio. Measuring and fitting the container is precise and takes one line.
  */
  const frameRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);

  // Store only container dimensions in state; derive fitting during
  // render, avoiding synchronous setState in the effect.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitted = useMemo(() => {
    const ratio = aspect.ratio;
    if (!ratio || !box) return null;
    const byWidth = { w: box.w, h: box.w / ratio };
    return byWidth.h <= box.h ? byWidth : { w: box.h * ratio, h: box.h };
  }, [aspect.ratio, box]);

  const baseShot = useEditor((s) => s.previewShot ?? s.active());
  const previewCover = useEditor((s) => s.previewCover);
  /*
    Let light/border/blur animation involve React only when needed. Camera values already come from `useFrame` without renders, but lights and borders are React props. Unconditionally subscribing to playhead rerendered the entire Canvas tree 15 times/s during playback, contributing to transition stalls.
    Without non-camera tracks, the playhead selector returns constant 0, preventing rerenders.
  */
  const hasSceneTracks = useEditor((s) =>
    (s.previewShot ?? s.active()).tracks.some((t) => !t.path.startsWith('camera.')),
  );
  const evalPlayhead = useEditor((s) => (hasSceneTracks ? s.playhead : 0));
  const evalStart = useEditor((s) => (hasSceneTracks ? shotStart(s.shots, s.activeShotId) : 0));
  const shot = useMemo(() => {
    if (!hasSceneTracks) return baseShot;
    const local = Math.min(Math.max(0, evalPlayhead - evalStart), baseShot.duration);
    return evaluateShot(baseShot, local);
  }, [hasSceneTracks, baseShot, evalPlayhead, evalStart]);
  /*
    Committed-scene marker: export advances until React actually commits the target scene (exportBridge.noteCommittedShot). Two fixed steps were sometimes insufficient, producing boundary frames with mixed old/new content.
  */
  useLayoutEffect(() => {
    noteCommittedShot(shot.id);
  }, [shot.id]);
  const isPro = useEditor((s) => s.isPro);
  /*
    Hide the scene during gaps, leaving only the background. The frame loop writes this flag only when it changes at boundaries, causing no extra renders during playback.
  */
  const inGap = useEditor((s) => s.inGap);
  const baseDevice = getDevice(shot.deviceId);
  const bg = getBackground(shot.scene.backgroundId);
  const bgTexture = useBackgroundTexture(bg, shot.scene.bgImage, shot.scene.bgBlur);
  const playing = useEditor((s) => s.playing);
  const isVideo = shot.mediaKind === 'video';
  const imageMedia = useMediaTexture(isVideo ? null : shot.media);
  const shotBeginSec = useEditor((st) => (isVideo ? shotStart(st.shots, shot.id) : 0));
  const videoMedia = useVideoTexture(
    isVideo ? shot.media : null,
    playing,
    shot.playbackRate,
    shot.trim,
    shotBeginSec,
  );
  const { tex: media, aspect: mediaAspect } = isVideo ? videoMedia : imageMedia;

  /*
    Screen glow: sample color from user media; intensity is animatable `light.screenGlow`. Feed it into both the environment map for glass/metal and the point light below for matte surfaces such as keyboard/base.
  */
  const glowAmount = shot.light.screenGlow ?? 0;
  const glowOn = glowAmount > 0.001;
  const glowColor = useScreenGlowColor(
    media,
    shot.media,
    shot.deviceOpts.screenBg,
    glowOn,
    isVideo,
    playing,
  );
  const glow: ScreenGlow | null = useMemo(
    () => (glowOn && glowColor ? { color: glowColor, amount: glowAmount, key: quantize(glowColor) } : null),
    [glowOn, glowColor, glowAmount],
  );
  /*
    Scale light-to-screen distance with device height: the source represents the screen itself. Too close creates a burned spot; too far creates a flat wash. 0.34 of device height balances the two.
  */



  /*
    FLAT devices adopt the image aspect ratio for arbitrary sizes. A fixed 16:10 card either distorted portrait screenshots or left edge gaps.
  */
  /*
    The BORDER panel controls the device frame.
    - FLAT cards: a real 3D frame around the screen. width controls thickness, radius controls corners, style selects material (glass = selected finish, solid = dark matte, none = frameless card).
    - Other devices: style 'none' preserves factory appearance; otherwise radius scales screen corners and width scales bezel thickness.
  */
  const deviceRaw = useMemo(() => {
    const b = shot.border;
    if (baseDevice.kind === 'flat') {
      const scrH = mediaAspect ? 12 : baseDevice.screen.h;
      const scrW = mediaAspect ? 12 * mediaAspect : baseDevice.screen.w;
      const frame = b.style === 'none' ? 0 : Math.max(0, b.width) * 0.22;
      const bw = scrW + frame * 2;
      const bh = scrH + frame * 2;
      const radius = Math.min(b.radius * Math.min(bw, bh), (Math.min(bw, bh) / 2) * 0.9);
      const dev = {
        ...baseDevice,
        /*
          User-controlled Depth gives the flat card physical thickness; the default 1.2 mm looked paper-thin. It is animatable, allowing the card's expansion to serve as a motion effect.
        */
        body: {
          ...baseDevice.body,
          w: bw,
          h: bh,
          d: Math.max(0.02, shot.deviceOpts.depth),
          radius: Math.max(0.05, radius),
        },
        screen: {
          ...baseDevice.screen,
          w: scrW,
          h: scrH,
          radius: Math.max(0.02, Math.min(radius - frame * 0.4, (Math.min(scrW, scrH) / 2) * 0.9)),
        },
      };
      // Solid frame: dark matte card body, independent of finish.
      if (b.style === 'solid' && frame > 0) dev.finishes = [SOLID_FRAME];
      return dev;
    }
    if (b.style === 'none') return baseDevice;
    const k = Math.max(0.2, b.width / 3);
    const inset = baseDevice.screen.inset * k;
    const delta = inset - baseDevice.screen.inset;
    const rScale = b.radius / 0.05;
    return {
      ...baseDevice,
      screen: {
        ...baseDevice.screen,
        w: Math.max(1, baseDevice.screen.w - 2 * delta),
        h: Math.max(1, baseDevice.screen.h - 2 * delta),
        inset,
        radius: Math.min(
          baseDevice.screen.radius * rScale,
          (Math.min(baseDevice.screen.w, baseDevice.screen.h) / 2) * 0.9,
        ),
      },
    };
    // `deviceOpts.depth` must be a dependency: changing thickness must rebuild
    // body geometry, or the slider moves while the scene stays unchanged.
  }, [baseDevice, mediaAspect, shot.border, shot.deviceOpts.depth]);

  /*
    Landscape orientation swaps phone/tablet body, screen, and ideal media dimensions. The screen stack derives from those dimensions, keeping the image upright and fitted; DeviceMesh rotates the hardware model. Framing, shadows, and reflections also use the swapped dimensions.
  */
  const landscape =
    !!shot.deviceOpts.landscape && (deviceRaw.kind === 'phone' || deviceRaw.kind === 'tablet');
  const device = useMemo(() => {
    if (!landscape) return deviceRaw;
    const d = deviceRaw;
    return {
      ...d,
      landscape: true,
      body: { ...d.body, w: d.body.h, h: d.body.w },
      screen: { ...d.screen, w: d.screen.h, h: d.screen.w },
      idealMedia: d.idealMedia ? { w: d.idealMedia.h, h: d.idealMedia.w } : null,
    };
  }, [deviceRaw, landscape]);

  // Other devices keep fixed screen dimensions; fit the image by cropping
  // to the active pixel area, excluding the black border.
  const contentA = contentRect(device);
  /*
    `shot` is evaluated with tracks: while paused, scrubbing, or exporting, `crop.scroll` comes from here. During playback, the frame loop overwrites it using the same formula at exact time (see `applyScreenScroll` note).
  */
  const screenView = fitTextureToScreen(media, mediaAspect, contentA.w / contentA.h, shot.crop);
  useEffect(() => {
    mainScreen.tex = media;
  }, [media]);
  // The panel shows Scroll only when useful; the scene knows the visible fraction.
  useEffect(() => {
    const st = useEditor.getState();
    if (st.screenView !== screenView) st.setScreenView(screenView);
  }, [screenView]);

  /* Screen glow distance from the screen, proportional to device height (see above). */
  const glowDist = device.body.h * 0.34;
  /** GLB laptop base drop below the lid's bottom edge (hinge + thickness). */
  const baseDrop = device.model && device.features?.base ? 0.44 + device.features.base.thickness : 0;
  /*
    Monitor stand drop from body bottom to its actual base, defining the reflection plane. The GLB stand base is `baseH` below the procedural one (measured display GLB minimum −32.30 = −h/2 − (neckH−1.2) − 0.9).
  */
  const standDrop = device.features?.stand
    ? device.features.stand.neckH - 1.2 + (device.model ? device.features.stand.baseH : 0)
    : 0;
  /*
    Floor and contact shadow intentionally retain the old drop: combined with default shadowOffset (0.02·h ≈ 0.8), the GLB base sits exactly on the floor. Using standDrop would float the monitor ~0.8 cm above it by default, changing its appearance. ⚠️ At shadowOffset 0, the GLB base sinks ~0.9 cm into the floor: a known minor issue requiring a separate design decision.
  */
  const floorStandDrop = device.features?.stand ? device.features.stand.neckH - 1.2 : 0;

  return (
    /*
      Use the container's own background for the gradient. A sibling layer covered the canvas because R3F sets inline `position: relative` on its wrapper, making z-index arrangements unreliable. The canvas naturally draws over a background, which also avoids blank space while 3D loads.
    */
    /*
      The outer container centers the frame; lock the canvas to the selected aspect ratio. Free mode ("Fill") fills the container. This lets users see export framing while editing and avoids unexpected cropping in store images.
    */
    <div ref={frameRef} className="grid h-full w-full place-items-center overflow-hidden">
    <div
      ref={hostRef}
      className="relative touch-none overflow-hidden"
      style={{
        borderRadius: 'var(--mp-radius-lg)',
        background: shot.scene.bgImage
          ? `url(${shot.scene.bgImage}) center / cover`
          : toCss(bg),
        ...(fitted
          ? { width: fitted.w, height: fitted.h }
          : { width: '100%', height: '100%' }),
      }}
    >
      <Canvas
        className="absolute inset-0"
        /*
          `flat` disables tone mapping, leaving only sRGB, for two reasons:
          1. The composer path (blur/effects enabled) must tone-map in post, where screen media's `toneMapped:false` is unavailable. Enabling blur would change screenshot colors; user media must retain accurate colors in every mode.
          2. This also makes the direct and composer paths pixel-identical.
        */
        flat
        gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true }}
        camera={{ fov: shot.camera.fov, near: 0.1, far: 5000 }}
        /*
          OPTIMIZED PLAYBACK: preview at 1× during playback for smooth heavy projects. Export bypasses this path and sets its own target resolution.
        */
        dpr={optimizedNow ? [1, 1] : [1, dprMax]}
      >
        {/*
          Lower the quality floor if frame rate drops (see above). Keep `flipflops` small: once reduced, quality stays there without oscillation.
        */}
        {/*
          ⚠️ Unmount during export.
          `recordFrames` sets frameloop to 'never' and calls `advance()` per frame. Because `PerformanceMonitor` samples via `useFrame`, it mistook full-resolution SSAA export + encoding frames (50–200 ms) for preview performance. Measured fps was 5–20, below drei's floor of 40; after ~2.5 s, 10 averages triggered `onDecline`. Since quality never rises again, one video export on a 1× monitor left preview at dpr 1 for the session, restoring aliasing.
          Unmount rather than mute it so `api.flipped` cannot increase. Once the counter exceeds `flipflops`, drei stops sampling entirely, preventing later detection of a genuinely weak GPU.
        */}
        {!exporting ? (
          <PerformanceMonitor
            flipflops={2}
            onDecline={() => {
              if (guardArmed.current) declineAA();
            }}
          />
        ) : null}
        <CameraRig
          device={device}
          spread={layoutSpread(mainSlot, shot.extras)}
          renderShotId={shot.id}
        />
        <DeviceWarmup />
        <TextOverlay overlayScene={overlayScene} />
        <PostProcessing overlayScene={overlayScene} />

        <SceneBackground
          texture={shot.scene.transparent ? null : bgTexture}
          envRotation={shot.light.envRotation}
          envTilt={shot.light.envTilt ?? 0}
          envIntensity={shot.light.envIntensity}
          envId={shot.scene.envId}
          glow={glow}
        />

        {/*
          Build three-point lighting manually instead of using drei Environment. Environment fetches HDR assets from a CDN at runtime, adding a network dependency, requiring Suspense, and risking export races.
        */}
        {/*
          Key light drives the entire direct-light rig.
          Previously it only added to the main directional light (`1.2 + key`), making full slider travel nearly invisible. Measured mean pixel differences for key 0→4: crystal 0.036 · silver 0.032 · black 0.012, versus 7.6 for lift. Glass and metal respond to direct light with tiny highlights (maximum pixel difference 20–46 over a very small area). Even key=16 barely changed the frame.
          Now key scales all direct light, like turning up studio lighting. ⚠️ At `key = 0`, every coefficient keeps its existing value, preserving default projects exactly; explicitly increased values become visible.
        */}
        <ambientLight intensity={0.5 + shot.light.key * 0.25} />
        <directionalLight
          intensity={1.2 + shot.light.key * 2}
          position={[
            Math.sin((shot.light.rotation * Math.PI) / 180) * 20,
            shot.light.keyHeight * 2,
            Math.cos((shot.light.rotation * Math.PI) / 180) * 20,
          ]}
        />
        <directionalLight intensity={0.35 + shot.light.key * 0.4} position={[-15, 6, -12]} />
        <directionalLight intensity={0.2 + shot.light.key * 0.25} position={[0, -10, 8]} />

        {/*
          Rotate X/Y rotates the device itself. Tilt controls camera framing; Rotate turns the product, so they need separate controls.
        */}
        {/* Hide the device and its shadow in gaps, leaving only the background. */}
        <group position={[0, shot.light.lift, 0]} visible={!inGap}>
          {/*
            FLAP tilts from the bottom edge. Move the group down by half the device height, rotate, then move back up to anchor the pivot at the body bottom. `rotX` rotates around the center and lifts the device in frame; flap keeps the bottom edge fixed, creating a lay-on-table motion.
          */}
          <group position={[0, -device.body.h / 2, 0]}>
            <group
              ref={(g) => {
                deviceRotGroups.flap = g;
              }}
              rotation={[(-(shot.camera.flap ?? 0) * Math.PI) / 180, 0, 0]}
            >
              <group position={[0, device.body.h / 2, 0]}>
          <group
            ref={(g) => {
              deviceRotGroups.main = g;
            }}
            rotation={[
              (shot.camera.rotX * Math.PI) / 180,
              (shot.camera.rotY * Math.PI) / 180,
              0,
            ]}
          >
            {/*
              The laptop lid tilts backward at the hinge. Apply this within the device's own group so user Rotate X/Y composes with it rather than being overwritten.
            */}
            <group
              rotation={[
                /*
                  User-controlled lid angle; the device definition's fixed `tilt` is only the default. Animatable: opening the laptop lid can be a shot in itself.
                */
                device.features?.base && !device.model ? (-shot.deviceOpts.lidAngle * Math.PI) / 180 : 0,
                0,
                0,
              ]}
            >
              {/*
                Screen glow: one point light for matte surfaces.
                Keep it inside the lid group so it rotates with the screen during opening/closing. Outside, it would work only at the default angle and fail during `lidAngle` animation.
                ⚠️ Always mounted, with `intensity=0` when off. Changing the light count makes three.js recompile every material, restoring scene-boundary stalls. Never mount conditionally.
                Scale intensity with distance squared (decay 2): device height ranges from 4 cm on watches to 21 cm on laptops; a fixed value would overexpose one and be invisible on the other.
              */}
              <pointLight
                color={glowColor ?? '#ffffff'}
                intensity={glowOn && glowColor ? glowAmount * glowDist * glowDist * 1.15 : 0}
                distance={device.body.h * 6}
                decay={2}
                position={[0, device.body.h * 0.08, device.body.d / 2 + glowDist]}
              />

              {/*
                Main and extra devices. Scale offsets by the main device width so the same layout has appropriate spacing on watches and laptops.
              */}
              <group
                ref={(g) => {
                  deviceSlotGroups.main = g;
                }}
                position={[
                  mainSlot.x * device.body.w,
                  mainSlot.y * device.body.h,
                  mainSlot.z * device.body.w,
                ]}
                rotation={[0, (mainSlot.rotY * Math.PI) / 180, 0]}
                scale={mainSlot.scale}
              >
                <DeviceMesh
                  device={device}
                  finish={shot.finishId}
                  media={media}
                  statusBar={shot.statusBar}
                  opts={shot.deviceOpts}
                  screenName="main-screen"
                  marks={shot.annotations.length > 0}
                  fx={{
                    screenFade: fxValue(shot, 'screenFade'),
                    ghost: fxValue(shot, 'ghost'),
                    liquidGlass: fxValue(shot, 'liquidGlass'),
                  }}
                />
              </group>

              {shot.extras.map((extra) => (
                <ExtraDevice
                  key={extra.id}
                  extra={extra}
                  unitW={device.body.w}
                  unitH={device.body.h}
                  fallbackMedia={media}
                  fallbackAspect={mediaAspect}
                  fallbackCrop={shot.crop}
                  shotId={shot.id}
                  statusBar={shot.statusBar}
                />
              ))}
            </group>
          </group>
              </group>
            </group>
          </group>

          {/*
            Floor reflection: draw a faded, vertically flipped device copy. This inexpensive approximation suggests a glossy floor and grounds the device without a full reflection calculation.
          */}
          {shot.light.reflection > 0 ? (
            <group
              /*
                Place the reflection plane at the actual device base. On GLB laptops, the base is ~0.44 + thickness below the hinge (baseDrop). The old calculation used the lid bottom, making the reflection pass through the base and create a ghost base.
              */
              /*
                ⚠️ For stand-mounted devices (monitors), place the reflection plane at the stand base. Using the screen body's bottom made the reflected screen overlap the stand neck, with reversed text starting just below the base. The floor and contact shadow already use the same drop.
              */
              position={[0, -device.body.h - 2 * baseDrop - 2 * standDrop - shot.light.lift * 2, 0]}
              scale={[1, -1, 1]}
            >
              <group
                ref={(g) => {
                  deviceRotGroups.mirror = g;
                }}
                rotation={[
                  (shot.camera.rotX * Math.PI) / 180,
                  (shot.camera.rotY * Math.PI) / 180,
                  0,
                ]}
              >
                {/*
                    Apply the same lid angle as the main device; otherwise the laptop reflection looks like a separate device with an upright lid.
*/}
                <group
                  rotation={[
                    device.features?.base && !device.model ? (-shot.deviceOpts.lidAngle * Math.PI) / 180 : 0,
                    0,
                    0,
                  ]}
                >
                  {/*
                    ⚠️ The reflection also inherits the main device slot. Previously it stayed centered in layouts (Pair: main device x −0.35) and stationary while per-device Drop/Pop animations moved the device. Extra devices still have no reflections.
                  */}
                  <group
                    ref={(g) => {
                      deviceSlotGroups.mirror = g;
                    }}
                    position={[mainSlot.x * device.body.w, mainSlot.y * device.body.h, mainSlot.z * device.body.w]}
                    rotation={[0, (mainSlot.rotY * Math.PI) / 180, 0]}
                    scale={mainSlot.scale}
                  >
                    <DeviceMesh
                      device={device}
                      finish={shot.finishId}
                      media={media}
                      opts={shot.deviceOpts}
                      opacity={shot.light.reflection * 0.35}
                    />
                  </group>
                </group>
              </group>
            </group>
          ) : null}
        </group>

        {/*
          Contact shadows ground the device; without them it appears suspended in space. Position the shadow plane below the device according to its dimensions.
        */}
        {/* 3D stage floor: same height as the contact shadow. */}
        {!inGap && shot.scene.stage3d && shot.scene.stage3d !== 'none' ? (
          <Stage3D
            kind={shot.scene.stage3d}
            y={
              -device.body.h / 2 -
              baseDrop -
              floorStandDrop -
              shot.light.shadowOffset * device.body.h
            }
            size={Math.max(device.body.w, device.body.h)}
          />
        ) : null}
        {shot.light.contactShadow && !inGap ? (
          <ContactShadows
            /* For devices with stands, place the floor below the stand rather than the body. */
            position={[
              0,
              -device.body.h / 2 -
                baseDrop -
                floorStandDrop -
                shot.light.shadowOffset * device.body.h,
              0,
            ]}
            scale={Math.max(device.body.w, device.body.h) * (1.8 + spreadScale)}
            resolution={512}
            blur={shot.light.shadowBlur}
            opacity={shot.light.shadowOpacity}
            far={device.body.h}
          />
        ) : null}
      </Canvas>

      {/* Editor guides: in the DOM above the canvas, excluded from export. */}
      <ViewportGuides />
      <AutoMotionOverlay />
      <AnnotationPlaceOverlay />
      {/*
        During template preview, the scene cycles through templates beneath a frozen frame captured before preview starts. The cover also absorbs clicks so camera dragging cannot modify the preview scene.
      */}
      {previewCover ? (
        <div className="absolute inset-0 z-30" data-testid="preview-cover" style={{ cursor: 'progress' }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimize */}
          <img src={previewCover} alt="" className="h-full w-full" draggable={false} />
        </div>
      ) : null}

      {/*
        Watermark: real HTML in preview. The canvas version looked uneven under fractional dpr sampling. DOM text stays crisp on every screen; export and video recording still draw their own canvas watermark, so excluding this DOM element from capture is intentional.
      */}
      {!isPro ? (
        <span
          className="mp-mono pointer-events-none absolute select-none font-bold uppercase"
          style={{
            right: '2.4%',
            bottom: '3.6%',
            fontSize: 'clamp(9px, 1.55vh, 14px)',
            letterSpacing: '0.12em',
            color: 'rgba(255,255,255,0.95)',
            background: 'rgba(0,0,0,0.42)',
            padding: '0.45em 0.8em',
            borderRadius: '0.55em',
          }}
        >
          {BRAND.wordmark}
        </span>
      ) : null}
    </div>
    </div>
  );
}
