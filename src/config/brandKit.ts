'use client';

import { useSyncExternalStore } from 'react';

/**
 * BRAND KIT.
 * The user's own logo, up to 3 colors, and heading/body fonts. `config/brand.ts` defines the
 * product's brand; this is separate. Store it in browser localStorage using the `userTemplates`
 * pattern, without a backend. It belongs to the browser rather than a project, so it is available
 * in every new project.
 * Defaults apply to new text (heading font + first color), new tickers (body font) and "+ Brand
 * logo". "Apply brand to scene" updates existing text and logos to the kit.
 * HYDRATION: server and first client render use an EMPTY kit (getServerSnapshot). Read
 * localStorage only in the client subscription.
 * QUOTA: resize logos to 512 px before storing. Autosave, user templates and the kit share about
 * 5 MB. Return `false` on write failure.
 */
const KEY = 'mockuptop:brand-kit:v1';

export type BrandKit = {
  /** PNG/WebP data URL (≤ 512 px). */
  logo: string | null;
  /** "#rrggbb", up to 3. */
  colors: string[];
  headingFont: string | null;
  bodyFont: string | null;
};

const EMPTY: BrandKit = { logo: null, colors: [], headingFont: null, bodyFont: null };
const listeners = new Set<() => void>();
let cache: BrandKit | null = null;

const HEX = /^#[0-9a-f]{6}$/i;

function sanitize(raw: unknown): BrandKit {
  const r = (raw ?? {}) as Partial<BrandKit>;
  return {
    logo: typeof r.logo === 'string' && r.logo.startsWith('data:image/') ? r.logo : null,
    colors: Array.isArray(r.colors) ? r.colors.filter((c) => typeof c === 'string' && HEX.test(c)).slice(0, 3) : [],
    headingFont: typeof r.headingFont === 'string' && r.headingFont ? r.headingFont : null,
    bodyFont: typeof r.bodyFont === 'string' && r.bodyFont ? r.bodyFont : null,
  };
}

/** Read the cached kit. Return an empty kit on the server or when storage is unavailable. */
export function getBrandKit(): BrandKit {
  if (cache) return cache;
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    cache = raw ? sanitize(JSON.parse(raw)) : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

/** Write part of the kit. Return false on quota/permission failure, leaving the kit unchanged. */
export function saveBrandKit(patch: Partial<BrandKit>): boolean {
  const next = sanitize({ ...getBrandKit(), ...patch });
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    return false;
  }
  cache = next;
  for (const l of listeners) l();
  return true;
}

export function hasBrandKit(k: BrandKit): boolean {
  return !!(k.logo || k.colors.length || k.headingFont || k.bodyFont);
}

export function useBrandKit(): BrandKit {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getBrandKit,
    () => EMPTY,
  );
}

/**
 * Decode the image. Try `createImageBitmap` first for speed, then `<img>` if it fails.
 * ⚠️ Chrome rejects SVGs with only `viewBox` and no width/height in createImageBitmap ("could not
 * be decoded"); many logos use this format. `<img>` decodes them, deriving natural dimensions
 * from the viewBox ratio when dimensions are absent.
 */
async function decodeLogo(file: Blob): Promise<{ src: CanvasImageSource; w: number; h: number; done: () => void }> {
  try {
    const bmp = await createImageBitmap(file);
    return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
  } catch {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch (e) {
      URL.revokeObjectURL(url);
      throw e;
    }
    const w = img.naturalWidth || 512;
    const h = img.naturalHeight || 512;
    return { src: img, w, h, done: () => URL.revokeObjectURL(url) };
  }
}

/**
 * Resize a logo to at most `max` px, preserving aspect ratio and transparency. Fall back to WebP
 * if PNG exceeds 400 KB; photo-like logos can produce large PNGs.
 */
export async function downscaleLogo(file: Blob, max = 512): Promise<string> {
  const { src, w: w0, h: h0, done } = await decodeLogo(file);
  const isSvg = file.type === 'image/svg+xml';
  // Render vector logos at the TARGET size for sharp, inexpensive upscaling; only downscale bitmaps.
  const k = isSvg ? max / Math.max(w0, h0) : Math.min(1, max / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d')!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, w, h);
  done();
  const png = c.toDataURL('image/png');
  if (png.length <= 400_000 * 1.37) return png;
  return c.toDataURL('image/webp', 0.9);
}
