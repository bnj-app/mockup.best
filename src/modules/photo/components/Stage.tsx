'use client';

import { useEffect, useRef, useState } from 'react';
import { revokeBlob, usePhoto } from '@photo/store/photo';
import { assetUrl } from '@photo/lib/assets';
import { mediaQuad, quadToCss } from '@photo/lib/homography';
import { COL, DEVICES } from '@photo/config/ui';
import { loadOptional, paintBackground, paintBranding, type DecorState } from '@photo/lib/decor';
import { deviceLayout } from '@photo/lib/layout';
import { shadowCss } from '@photo/lib/shadow';
import { statusTint } from '@photo/lib/tint';

/**
 * Draw background and branding layers on the preview canvas with the same functions as export. A
 * separate DOM copy would let the two outputs drift apart.
 */
type DecorInput = Omit<DecorState, 'bgImage' | 'appLogo'> & {
  bgImageUrl: string | null;
  appLogoUrl: string | null;
  dpr: number;
  animate: boolean;
};

function useDecor(size: number, s: DecorInput) {
  const bgRef = useRef<HTMLCanvasElement>(null);
  const fgRef = useRef<HTMLCanvasElement>(null);
  const [imgs, setImgs] = useState<{ bg: HTMLImageElement | null; logo: HTMLImageElement | null }>({
    bg: null,
    logo: null,
  });

  useEffect(() => {
    let alive = true;
    Promise.all([loadOptional(s.bgImageUrl), loadOptional(s.appLogoUrl)]).then(([bg, logo]) => {
      if (alive) setImgs({ bg, logo });
    });
    return () => {
      alive = false;
    };
  }, [s.bgImageUrl, s.appLogoUrl]);

  const draw = (time: number) => {
    const state: DecorState = { ...s, time, bgImage: imgs.bg, appLogo: imgs.logo };
    for (const [ref, paint] of [
      [bgRef, paintBackground],
      [fgRef, paintBranding],
    ] as const) {
      const cv = ref.current;
      if (!cv) continue;
      if (cv.width !== size * s.dpr) {
        cv.width = size * s.dpr;
        cv.height = size * s.dpr;
      }
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      paint(ctx, size, state);
    }
  };

  /**
   * The loop reads fresh state through a ref. Previously the rAF effect had no dependency array;
   * Stage subscribed to the whole store, so every set restarted the effect and reset t0. Emoji drift
   * jumped back to drift(0), its initial position, making the pattern appear frozen during slider
   * drags.
   */
  const drawRef = useRef(draw);
  // Refresh the ref in an effect, not during render; effects below
  // run in declaration order and therefore always see the current draw.
  useEffect(() => {
    drawRef.current = draw;
  });

  const animOn = s.animate && s.bgEmojis.length > 0;

  // With ANIMATE off, draw one frame to reflect color/pattern/logo changes immediately.
  useEffect(() => {
    if (!animOn) drawRef.current(0);
  });

  // With ANIMATE on, loop continuously; idle rAF work needlessly runs laptop fans.
  useEffect(() => {
    if (!animOn) return;
    let raf = 0;
    const t0 = performance.now();
    const loop = () => {
      drawRef.current((performance.now() - t0) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [animOn, size, s.dpr]);

  return { bgRef, fgRef };
}

function MediaFill({ media }: { media: { url: string; type: 'image' | 'video' } }) {
  if (media.type === 'video') {
    return <video src={media.url} className="w-full h-full object-cover" autoPlay loop muted playsInline />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={media.url} alt="" className="w-full h-full object-cover" />;
}

function StatusBar({ scale, tint }: { scale: number; tint: string }) {
  return (
    <div
      className="absolute flex items-center justify-between pointer-events-none"
      style={{
        left: '7%',
        right: '7%',
        top: '2.2%',
        fontSize: Math.max(8, scale * 0.045),
        fontWeight: 600,
        color: tint,
      }}
    >
      <span>9:41</span>
      <StatusGlyphs h={Math.max(6, scale * 0.038)} />
    </div>
  );
}

/** Signal · Wi-Fi · battery, drawn as vectors. */
function StatusGlyphs({ h }: { h: number }) {
  return (
    <svg width={h * 3.6} height={h} viewBox="0 0 36 10" fill="currentColor" aria-hidden>
      <rect x="0" y="6" width="2" height="4" rx=".6" />
      <rect x="3.2" y="4.4" width="2" height="5.6" rx=".6" />
      <rect x="6.4" y="2.6" width="2" height="7.4" rx=".6" />
      <rect x="9.6" y="1" width="2" height="9" rx=".6" />
      <path d="M15.2 3.4a7 7 0 0 1 8 0l-1.2 1.5a5 5 0 0 0-5.6 0Zm2 2.5a3.4 3.4 0 0 1 4 0l-2 2.5Z" />
      <rect x="26" y="1.6" width="8.4" height="6.8" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="27.2" y="2.8" width="6" height="4.4" rx="1" />
      <rect x="35" y="3.8" width="1" height="2.4" rx=".5" />
    </svg>
  );
}

function Plus({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full h-full flex items-center justify-center transition-opacity hover:opacity-70"
      style={{ background: '#fff' }}
      aria-label="Upload a screen recording"
    >
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden>
        <path d="M24 14v20M14 24h20" stroke="rgba(0,0,0,.35)" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/**
 * Photo-mode layer order: background → screen (matrix3d) → status bar → photo (with a screen
 * cutout). The photo sits on top, so fingers overlapping the phone naturally form a foreground
 * layer.
 */
export function Stage({ size }: { size: number }) {
  const s = usePhoto();
  const inputRef = useRef<HTMLInputElement>(null);
  const src = s.source;
  const asset = src?.kind === 'photo' ? s.assets.find((a) => a.id === src.id) : null;
  const device = src?.kind === 'device' ? DEVICES.find((d) => d.id === src.id) : null;
  // Bodyless mode: the screen itself, using generic "Pro" dimensions.
  const bare = src?.kind === 'bare' ? DEVICES[0] : null;

  const { bgRef, fgRef } = useDecor(size, {
    bgMode: s.bgMode,
    bgColor: s.bgColor,
    bgImageUrl: s.bgImage,
    bgVideoBehind: s.bgMode === 'Video' && !!s.bgVideo,
    bgEmojis: s.bgEmojis,
    pattern: s.pattern,
    time: 0,
    animate: s.animate,
    appLogoUrl: s.appLogo,
    appName: s.appName,
    dpr: typeof window === 'undefined' ? 1 : Math.min(2, window.devicePixelRatio || 1),
  });

  const [dragging, setDragging] = useState(false);

  function accept(f: File | undefined | null) {
    if (!f) return;
    if (!/^(image|video)\//.test(f.type)) return;
    // Release the old resource before replacing it to avoid bloating the tab.
    revokeBlob(s.media?.url);
    s.set({ media: { url: URL.createObjectURL(f), type: f.type.startsWith('video') ? 'video' : 'image' } });
  }

  /**
   * Status-bar tint: black "9:41" was unreadable on dark screenshots. Share statusTint with export;
   * compute and cache it once when media loads.
   */
  const [measured, setMeasured] = useState<{ url: string; tint: string } | null>(null);
  // The tint applies only while the measured media remains current; changing media
  // automatically invalidates the old tint without resetting it in an effect.
  const tint = s.media && measured?.url === s.media.url ? measured.tint : '#000000';
  useEffect(() => {
    if (!s.media) return;
    const url = s.media.url;
    if (s.media.type === 'video') {
      const v = document.createElement('video');
      v.muted = true;
      v.src = url;
      v.onloadeddata = () => setMeasured({ url, tint: statusTint(v) });
      return;
    }
    const img = new Image();
    img.onload = () => setMeasured({ url, tint: statusTint(img) });
    img.src = url;
  }, [s.media]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    accept(e.target.files?.[0]);
  }

  /** Drop a file onto the canvas to place it on the screen without a file picker. */
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    accept(e.dataTransfer.files?.[0]);
  }

  // Make the quad larger than the cutout to prevent background leaks at the edge.
  const css = asset ? quadToCss(mediaQuad(asset.quad), size) : null;
  const pick = () => inputRef.current?.click();

  // Device or bodyless screen; layout rules are in lib/layout.ts.
  const model = device || bare;
  let dev: { w: number; h: number; x: number; y: number; r: number; bezel: number } | null = null;
  if (model) {
    const L = deviceLayout(size, model.w, model.h, s.zoom);
    // No bezel in bodyless mode; show the screen directly.
    dev = { ...L, r: L.w * model.radius, bezel: bare ? 0 : L.w * model.bezel };
  }

  return (
    <div
      className="relative overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragging) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      style={{
        width: size,
        height: size,
        borderRadius: 24,
        background: 'transparent',
        boxShadow: '0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06)',
      }}
    >
      {s.bgMode === 'Video' && s.bgVideo && (
        <video
          src={s.bgVideo}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ zIndex: 0 }}
          autoPlay
          loop
          muted
          playsInline
        />
      )}
      <canvas ref={bgRef} className="absolute inset-0 w-full h-full" style={{ zIndex: 1 }} />
      {/* ——— bare device mode ——— */}
      {dev && model && (
        <div
          className="absolute"
          style={{
            left: dev.x,
            top: dev.y,
            width: dev.w,
            height: dev.h,
            borderRadius: dev.r,
            background: bare ? 'transparent' : model.body,
            transform: s.tilt ? `rotate(${s.tilt}deg)` : undefined,
            boxShadow: bare ? 'none' : shadowCss(s.shadow, dev.w),
            padding: dev.bezel,
            zIndex: 10,
          }}
        >
          <div
            className="relative w-full h-full overflow-hidden"
            style={{ borderRadius: Math.max(0, dev.r - dev.bezel), background: '#fff' }}
          >
            {s.media ? <MediaFill media={s.media} /> : <Plus onClick={pick} />}
            {s.showStatusBar && <StatusBar scale={dev.w} tint={tint} />}
            {model.island && s.showIsland !== false && (
              <div
                className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
                style={{
                  top: dev.w * 0.03,
                  width: dev.w * 0.3,
                  height: dev.w * 0.075,
                  borderRadius: 999,
                  background: '#000',
                }}
              />
            )}
          </div>
          {/* Show the ring only in bodyless mode, as a thin dark line. */}
          {bare && s.deviceBorder === 'Border' && (
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ borderRadius: dev.r, boxShadow: `0 0 0 ${Math.max(1, dev.w * 0.007)}px #000` }}
            />
          )}
        </div>
      )}

      {/* ——— photo mode ——— */}
      {asset && css && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: css.width,
            height: css.height,
            transform: `translate(${css.left}px, ${css.top}px) ${css.matrix3d}`,
            transformOrigin: '0 0',
            overflow: 'hidden',
            backfaceVisibility: 'hidden',
            background: '#f2f2f2',
            zIndex: 10,
          }}
        >
          {s.media ? <MediaFill media={s.media} /> : <Plus onClick={pick} />}
          {s.showStatusBar && <StatusBar scale={css.width} tint={tint} />}
        </div>
      )}
      {asset && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={assetUrl(asset, 'preview')}
          alt=""
          className="absolute inset-0 w-full h-full pointer-events-none select-none"
          style={{ zIndex: 25 }}
        />
      )}

      <canvas ref={fgRef} className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 30 }} />

      {/* Watermark in the DOM rather than canvas: small text renders unevenly at hiDPI. */}
      <div
        className="absolute pointer-events-none select-none font-bold"
        style={{
          right: size * 0.035,
          bottom: size * 0.02 + (s.appName || s.appLogo ? size * 0.075 : 0),
          fontSize: size * 0.058,
          letterSpacing: '-0.02em',
          color: 'rgba(138,138,138,.55)',
        }}
      >
        mockuptop
      </div>

      {dragging && (
        <div
          className="absolute inset-0 z-40 grid place-items-center pointer-events-none"
          style={{ background: 'rgba(67,86,255,.12)', border: '2px dashed var(--foreground)', borderRadius: 24 }}
        >
          <span className="text-sm font-semibold">Drop to upload</span>
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/*,video/*" hidden onChange={onPick} />
    </div>
  );
}

/**
 * Canvas size: measured formula. Center it in the entire viewport rather than fitting a middle
 * column: min(width − 2×408 − 96, height − 120). Verified: 1600×950 → 688 (width-limited),
 * 1900×1000 → 880 (height-limited). The old container-based measurement yielded 704 / 792.
 */
/*
 * This hook takes no ref: measurements come entirely from the viewport. The old parameter never
 * read ref.current and misleadingly suggested container measurement.
 */
export function useStageSize() {
  const [size, setSize] = useState(600);
  useEffect(() => {
    const calc = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const wide = vw >= 1024;
      const s = wide
        ? Math.min(vw - 2 * COL.outer - 96, vh - 120)
        : Math.min(vw - 32, vh - 260);
      setSize(Math.max(200, Math.min(s, 1080)));
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);
  return size;
}
