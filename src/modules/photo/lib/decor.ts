/**
 * Background and branding overlays. Preview and export draw both layers through the same functions.
 * Preview uses a canvas layer without a duplicate DOM version. Bypassing the render pipeline caused an
 * export bug in Mockuptop; keep a single source here.
 */

import { layout, type PatternName } from '@photo/config/patterns';

export type DecorState = {
  bgMode: 'None' | 'Video' | 'Image';
  bgColor: string;
  bgImage: HTMLImageElement | null;
  /** Current background-video frame for export. */
  bgVideoFrame?: CanvasImageSource | null;
  /**
   * In preview, background video plays in the DOM beneath the canvas. Skip the canvas background color
   * so it does not cover the video; still draw the emoji pattern.
   */
  bgVideoBehind?: boolean;
  bgEmojis: string[];
  pattern: PatternName;
  /** Seconds; 0 when ANIMATE is off. */
  time: number;
  appLogo: HTMLImageElement | null;
  appName: string;
};

export function paintBackground(ctx: CanvasRenderingContext2D, size: number, s: DecorState) {
  ctx.clearRect(0, 0, size, size);
  if (s.bgMode === 'None') return;

  if (!s.bgVideoBehind) {
    ctx.fillStyle = s.bgColor;
    ctx.fillRect(0, 0, size, size);
  }

  if (s.bgVideoFrame) {
    const v = s.bgVideoFrame as HTMLVideoElement;
    const w = v.videoWidth;
    const h = v.videoHeight;
    if (w && h) {
      const k = Math.max(size / w, size / h);
      ctx.drawImage(v, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k);
    }
  }

  if (s.bgImage) {
    const { naturalWidth: w, naturalHeight: h } = s.bgImage;
    if (w && h) {
      const k = Math.max(size / w, size / h);
      ctx.drawImage(s.bgImage, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k);
    }
  }

  if (s.bgEmojis.length) paintEmojiPattern(ctx, size, s.bgEmojis, s.pattern, s.time);
}

/**
 * Emoji pattern. Draw at full opacity with layout-dependent sizes: roughly a quarter of the canvas for
 * Small Grid and 7% for Rings. The previous single-size wallpaper at 22% opacity was incorrect.
 */
/*
  ⚠️ Cache emoji sprites to prevent ANIMATE dropping to 1 fps. On Chrome/Windows, color-emoji fillText
  rasterizes the glyph on every draw: dozens of ~200–400 px glyphs in Small Grid at 60 fps took
  seconds per frame. Render each emoji once to an offscreen canvas, then use cheap drawImage calls.
  The same path speeds up 4K video export.
*/
const SPRITE_FONT = 512; // Keep the largest use sharp (~23% × 2160 export ≈ 500 px).
const emojiSprites = new Map<string, HTMLCanvasElement>();

function emojiSprite(ch: string): HTMLCanvasElement {
  let cv = emojiSprites.get(ch);
  if (cv) return cv;
  // Emoji glyphs can exceed the em box; allow 25% padding.
  const side = Math.round(SPRITE_FONT * 1.25);
  cv = document.createElement('canvas');
  cv.width = side;
  cv.height = side;
  const c = cv.getContext('2d')!;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.font = `${SPRITE_FONT}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  c.fillText(ch, side / 2, side / 2);
  emojiSprites.set(ch, cv);
  return cv;
}

export function paintEmojiPattern(
  ctx: CanvasRenderingContext2D,
  size: number,
  emojis: string[],
  pattern: PatternName,
  t: number,
) {
  const items = layout(pattern, t);
  ctx.save();
  items.forEach((p, i) => {
    const fs = p.size * size;
    const spr = emojiSprite(emojis[i % emojis.length]);
    // Sprite edges are 1.25 times the font size; drawing at the same ratio
    // keeps glyph size identical to the old fillText(fs).
    const side = fs * 1.25;
    ctx.save();
    ctx.translate(p.x * size, p.y * size);
    ctx.rotate((p.rot * Math.PI) / 180);
    ctx.drawImage(spr, -side / 2, -side / 2, side, side);
    ctx.restore();
  });
  ctx.restore();
}

/**
 * Logo and app name: measured at bottom right (x≈0.853, y≈0.914), text 3.8% of the canvas, weight 600,
 * with a 4px logo gap. It was initially assumed centered. Choose black/white from background
 * brightness so text remains visible on white backgrounds too.
 */
export function paintBranding(ctx: CanvasRenderingContext2D, size: number, s: DecorState) {
  if (!s.appLogo && !s.appName) return;
  const fs = size * 0.038;
  const logoSize = size * 0.055;
  const gap = size * 0.012;
  const pad = size * 0.047;

  ctx.save();
  ctx.font = `600 ${fs}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const textW = s.appName ? ctx.measureText(s.appName).width : 0;
  const total = (s.appLogo ? logoSize + gap : 0) + textW;
  const y = size - pad;
  let x = size - pad - total;

  if (s.appLogo) {
    ctx.save();
    const r = logoSize * 0.24;
    roundPath(ctx, x, y - logoSize / 2, logoSize, logoSize, r);
    ctx.clip();
    ctx.drawImage(s.appLogo, x, y - logoSize / 2, logoSize, logoSize);
    ctx.restore();
    x += logoSize + gap;
  }
  if (s.appName) {
    ctx.fillStyle = isDark(s.bgColor) ? '#ffffff' : '#111111';
    ctx.fillText(s.appName, x, y);
  }
  ctx.restore();
}

function roundPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Is #rrggbb dark? Simple relative luminance. */
function isDark(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.55;
}

/** data/blob URL to a loaded <img>, or null if absent. */
export function loadOptional(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}
