/**
 * UI constants measured from rendered DOM and computed styles. Values were read from the screen;
 * source code was not copied.
 */

/** Card: bg-card, rounded-xl (14px), 1px border, py-24, rows px-24. */
export const CARD = {
  radius: 14,
  /*
     ⚠️ Theme-dependent. The old rgba(51,51,51,0.1) worked with a single theme but hid card borders in
     dark mode. The token is defined for both themes inside .photo-root.
     */
  border: 'var(--mp-border)',
  padY: 24,
  padX: 24,
  gap: 16,
} as const;

/** Side columns: 368px content, 408px outer width (20px side padding). */
export const COL = { inner: 368, outer: 408 } as const;

export const TOPBAR_H = 80;

/**
 * Section heading: 12px, uppercase, .6px tracking. ⚠️ Use a color token. Hardcoded
 * rgba(51,51,51,.75) made headings (DEVICE / PHONE / SHADOW …) nearly unreadable on dark
 * backgrounds. --muted-foreground preserves that value in light mode and supplies its dark-mode
 * equivalent.
 */
export const SECTION_LABEL =
  'text-[12px] font-medium uppercase tracking-[0.6px] text-[color:var(--muted-foreground)]';

/** Eight dots in the BACKGROUND card; the last is a rainbow custom color picker. */
export const BG_COLORS = [
  '#ffffff',
  '#000000',
  '#4285f4',
  '#db4437',
  '#f4b400',
  '#0f9d58',
  '#ab47bc',
] as const;

export const BG_MODES = ['None', 'Video', 'Image'] as const;

export const SHADOWS = ['None', 'Soft', 'Medium', 'Hard'] as const;
export const SHADOW_DEFAULT = 'Hard';

export const ZOOMS = [0.5, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2] as const;
export const ZOOM_DEFAULT = 0.9;

/**
 * PRESET = a complete look, not a pose as initially assumed. Each of the four names corresponds to
 * a measured combination of background color, emoji set and pattern.
 */
// Measured by selecting each preset; the initial values had been guesses.
// Clean Studio uses a white background; Midnight Noir uses black
// with the Random pattern. All four retain Hard shadow and 0.9 zoom.
export const PRESETS = [
  { id: 'Default', bgColor: '#ffffff', shadow: 'Hard', zoom: 0.9, emojis: [] as string[], pattern: 'Staggered' },
  { id: 'Clean Studio', bgColor: '#ffffff', shadow: 'Hard', zoom: 0.9, emojis: [] as string[], pattern: 'Staggered' },
  { id: 'Midnight Noir', bgColor: '#000000', shadow: 'Hard', zoom: 0.9, emojis: ['⚫'] as string[], pattern: 'Random' },
  { id: 'Vibrant Pulse', bgColor: '#7c3aed', shadow: 'Hard', zoom: 0.9, emojis: ['✨', '🔥', '🌈'], pattern: 'Rings' },
] as const;

/** The emoji heading is "EMOJIS (3/5)", allowing at most five. */
export const EMOJI_MAX = 5;

/**
 * Devices. Use generic names and procedurally drawn bodies instead of branded iPhone names and
 * copyrighted body photographs. Dimensions (aspect ratio, corner radius, bezel thickness) are
 * generic and unrestricted.
 */
// body = body color. The color is embedded in the device model
// because the body is drawn procedurally, with no separate color control.
// These color tones are original.
export const DEVICES = [
  { id: 'pro', label: 'Pro', w: 1071, h: 2190, radius: 0.115, bezel: 0.015, island: true, body: '#4a4a4f' },
  { id: 'standard', label: 'Standard', w: 1071, h: 2190, radius: 0.115, bezel: 0.016, island: true, body: '#1c1c1e' },
  { id: 'air', label: 'Air', w: 1095, h: 2285, radius: 0.12, bezel: 0.013, island: true, body: '#8fa8bd' },
  { id: 'compact', label: 'Compact', w: 1071, h: 2190, radius: 0.115, bezel: 0.017, island: true, body: '#d6d2c8' },
  { id: 'promax', label: 'Pro Max', w: 1167, h: 2380, radius: 0.115, bezel: 0.014, island: true, body: '#a9663d' },
  { id: 'max', label: 'Max', w: 1164, h: 2380, radius: 0.115, bezel: 0.016, island: true, body: '#2f3a45' },
] as const;

export const DEVICE_BORDERS = ['None', 'Border'] as const;

/** The EMOJIS card shows seven random emoji on each reload. */
export const EMOJI_POOL = [
  '💯', '🐨', '🐝', '⌨️', '🐻', '🦛', '💽', '🚀', '🔥', '✨', '🎧', '📸',
  '🍿', '🌈', '⚡', '🎯', '🧊', '🪩', '🛰️', '🧩', '🥁', '🪐', '🍉', '🦖',
] as const;

export function pickEmojis(n = 7, seed = 0) {
  const pool = [...EMOJI_POOL];
  const out: string[] = [];
  let s = seed || 1;
  while (out.length < n && pool.length) {
    // Deterministic shuffle: avoid Math.random so SSR and the first client
    // render match; random selection previously caused hydration errors.
    s = (s * 1103515245 + 12345) % 2147483648;
    out.push(pool.splice(s % pool.length, 1)[0]);
  }
  return out;
}
