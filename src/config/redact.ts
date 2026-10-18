/**
 * SENSITIVE DATA REDACTION.
 * Users mark areas such as email addresses, customer names and balances with rectangles.
 * Permanently bake them into the image and propagate the sanitized copy to all scenes using it.
 * Keep the original only in this tab's memory for undo and reediting; never include it in project
 * files, share links or exports.
 * Coordinates are image-relative (0–1), allowing the same areas to be reapplied to updated
 * screens.
 * Styles ordered by privacy strength:
 * - erase: fill with the surrounding color, as if text were erased (opaque)
 * - bar: solid color band (opaque)
 * - pixel: large blocks, half the area's shorter edge, making text unreadable
 * - blur: strong blur, falling back to pixel when ctx.filter is unavailable
 */

export type RedactStyle = 'erase' | 'bar' | 'pixel' | 'blur';
export type RedactRect = { x: number; y: number; w: number; h: number; style: RedactStyle; color?: string };

export const REDACT_STYLES: { id: RedactStyle; label: string }[] = [
  { id: 'erase', label: 'Erase' },
  { id: 'bar', label: 'Bar' },
  { id: 'pixel', label: 'Pixelate' },
  { id: 'blur', label: 'Blur' },
];

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Validate an imported/manual list; discard malformed items. */
export function cleanRedactions(list: unknown): RedactRect[] | undefined {
  if (!Array.isArray(list)) return undefined;
  const ok = new Set<RedactStyle>(['erase', 'bar', 'pixel', 'blur']);
  const out = list
    .filter(
      (r): r is RedactRect =>
        !!r &&
        typeof r === 'object' &&
        ['x', 'y', 'w', 'h'].every((k) => Number.isFinite((r as Record<string, unknown>)[k])) &&
        ok.has((r as RedactRect).style),
    )
    .map((r) => {
      const x = clamp01(r.x);
      const y = clamp01(r.y);
      return {
        x,
        y,
        w: Math.min(1 - x, Math.max(0, r.w)),
        h: Math.min(1 - y, Math.max(0, r.h)),
        style: r.style,
        ...(typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? { color: r.color } : {}),
      };
    })
    .filter((r) => r.w > 0.001 && r.h > 0.001);
  return out.length ? out : undefined;
}

/** Median color of the ring immediately OUTSIDE the area, used by the eraser fill. */
function ringColor(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): string {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const pad = 2;
  const x0 = Math.max(0, x - pad);
  const y0 = Math.max(0, y - pad);
  const x1 = Math.min(W, x + w + pad);
  const y1 = Math.min(H, y + h + pad);
  const data = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0));
  const rw = data.width;
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const take = (px: number, py: number) => {
    const i = (py * rw + px) * 4;
    rs.push(data.data[i]);
    gs.push(data.data[i + 1]);
    bs.push(data.data[i + 2]);
  };
  const ix = x - x0;
  const iy = y - y0;
  for (let px = 0; px < rw; px += 1) {
    for (let py = 0; py < data.height; py += 1) {
      const inside = px >= ix && px < ix + w && py >= iy && py < iy + h;
      if (!inside) take(px, py);
    }
  }
  if (!rs.length) return '#000000';
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(med(rs))}${hex(med(gs))}${hex(med(bs))}`;
}

const supportsFilter = () => {
  try {
    const c = document.createElement('canvas').getContext('2d');
    return !!c && 'filter' in c;
  } catch {
    return false;
  }
};

/**
 * Bake areas into the image. Return a sanitized full-resolution PNG. Apply in order; the last
 * overlapping area wins.
 */
export async function bakeRedactions(src: HTMLImageElement | ImageBitmap, rects: RedactRect[]): Promise<Blob> {
  const c = bakeToCanvas(src, rects);
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('bake failed'))), 'image/png'));
}

/** Apply the same rendering to a canvas; the dialog's live preview uses a smaller copy. */
export function bakeToCanvas(
  src: HTMLImageElement | ImageBitmap | HTMLCanvasElement,
  rects: RedactRect[],
  size?: { w: number; h: number },
): HTMLCanvasElement {
  const W = size?.w ?? ('naturalWidth' in src ? src.naturalWidth : src.width);
  const H = size?.h ?? ('naturalHeight' in src ? src.naturalHeight : src.height);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, W, H);
  const canBlur = supportsFilter();
  for (const r of rects) {
    const x = Math.round(r.x * W);
    const y = Math.round(r.y * H);
    const w = Math.max(1, Math.round(r.w * W));
    const h = Math.max(1, Math.round(r.h * H));
    const style = r.style === 'blur' && !canBlur ? 'pixel' : r.style;
    if (style === 'erase' || style === 'bar') {
      ctx.fillStyle = style === 'bar' ? (r.color ?? '#111111') : ringColor(ctx, x, y, w, h);
      ctx.fillRect(x, y, w, h);
    } else if (style === 'pixel') {
      // Block size: half the shorter edge (at least 8 px), larger than one block per character in single-line text.
      const block = Math.max(8, Math.round(Math.min(w, h) / 2));
      const sw = Math.max(1, Math.round(w / block));
      const sh = Math.max(1, Math.round(h / block));
      const tmp = document.createElement('canvas');
      tmp.width = sw;
      tmp.height = sh;
      const t = tmp.getContext('2d')!;
      t.imageSmoothingEnabled = true;
      t.drawImage(c, x, y, w, h, 0, 0, sw, sh);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, sw, sh, x, y, w, h);
      ctx.imageSmoothingEnabled = true;
    } else {
      // Blur the area plus an expanded copy, then clip to the area to prevent edge leakage.
      const radius = Math.max(10, Math.round(Math.min(w, h) * 0.6));
      const pad = radius * 2;
      const tmp = document.createElement('canvas');
      tmp.width = w + pad * 2;
      tmp.height = h + pad * 2;
      const t = tmp.getContext('2d')!;
      // Fill with the surrounding color first so expansion near image edges does not remain transparent.
      t.fillStyle = ringColor(ctx, x, y, w, h);
      t.fillRect(0, 0, tmp.width, tmp.height);
      t.drawImage(c, x - pad, y - pad, tmp.width, tmp.height, 0, 0, tmp.width, tmp.height);
      // Two passes: fine text may remain legible after one.
      const tmp2 = document.createElement('canvas');
      tmp2.width = tmp.width;
      tmp2.height = tmp.height;
      const t2 = tmp2.getContext('2d')!;
      t2.filter = `blur(${radius}px)`;
      t2.drawImage(tmp, 0, 0);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.filter = `blur(${radius}px)`;
      ctx.drawImage(tmp2, x - pad, y - pad);
      ctx.filter = 'none';
      ctx.restore();
    }
  }
  return c;
}

/** Load an image from a URL (blob:/data:/same-origin). */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('image failed to load'));
    img.src = url;
  });
}

/*
  ORIGINALS: only in this tab's memory. Sanitized URL → original URL. Reediting reapplies areas to
  the original, allowing areas to be removed. Reloading loses the original: the sanitized image
  then becomes the source, with old redactions baked in.
*/
const originals = new Map<string, string>();
export function originalOf(url: string): string | null {
  return originals.get(url) ?? null;
}

/** Bake areas and return the sanitized image URL, remembering the original. */
export async function redactToUrl(sourceUrl: string, rects: RedactRect[]): Promise<string> {
  const base = originals.get(sourceUrl) ?? sourceUrl;
  const img = await loadImage(base);
  const blob = await bakeRedactions(img, rects);
  const url = URL.createObjectURL(blob);
  originals.set(url, base);
  return url;
}
