/**
 * Code-generated backgrounds without image assets.
 *
 * Each background defines color stops shared by its CSS preview swatch
 * and scene-plane texture. This preserves quality at 4K and lets colors
 * be adjusted freely.
 */

export type Stop = { at: number; color: string };

export type Background = {
  id: string;
  label: string;
  /** Gradient angle in degrees; 0 points upward. */
  angle: number;
  stops: Stop[];
  /** Additional light spots for a soft mesh effect. */
  blobs?: { x: number; y: number; r: number; color: string }[];
};

export const BACKGROUNDS: Background[] = [
  {
    id: 'glaze',
    label: 'Glaze',
    angle: 150,
    stops: [
      { at: 0, color: '#f6f7fb' },
      { at: 0.55, color: '#e7eaf4' },
      { at: 1, color: '#d4d9ea' },
    ],
    blobs: [{ x: 0.25, y: 0.2, r: 0.6, color: '#ffffff' }],
  },
  {
    id: 'crystal',
    label: 'Crystal',
    angle: 120,
    stops: [
      { at: 0, color: '#eef3fb' },
      { at: 0.45, color: '#cfe0f6' },
      { at: 1, color: '#9dbde9' },
    ],
    blobs: [
      { x: 0.7, y: 0.25, r: 0.5, color: '#ffffff' },
      { x: 0.2, y: 0.8, r: 0.45, color: '#e6d8f5' },
    ],
  },
  {
    id: 'sunrise',
    label: 'Sunrise',
    angle: 165,
    stops: [
      { at: 0, color: '#ffe9c9' },
      { at: 0.5, color: '#ffb98a' },
      { at: 1, color: '#f4786b' },
    ],
    blobs: [{ x: 0.5, y: 0.85, r: 0.55, color: '#ffd7a1' }],
  },
  {
    id: 'spectrum',
    label: 'Spectrum',
    angle: 135,
    stops: [
      { at: 0, color: '#8ee7f5' },
      { at: 0.35, color: '#a08cf0' },
      { at: 0.7, color: '#f07fb8' },
      { at: 1, color: '#ffbf7a' },
    ],
  },
  {
    id: 'graphite',
    label: 'Graphite',
    angle: 145,
    stops: [
      { at: 0, color: '#2b2d33' },
      { at: 0.6, color: '#17181c' },
      { at: 1, color: '#0b0b0d' },
    ],
    blobs: [{ x: 0.3, y: 0.25, r: 0.55, color: '#3d4048' }],
  },
  {
    id: 'mint',
    label: 'Mint',
    angle: 160,
    stops: [
      { at: 0, color: '#eafaf2' },
      { at: 0.5, color: '#bfeeda' },
      { at: 1, color: '#7fd6bb' },
    ],
  },
];

/* --- Extend the collection beyond a single gradient --- */

BACKGROUNDS.push(
  /*
    Studio backdrops: black and off-white seamless surfaces for product
    shots. No noise or blotches; pair with Dark/White studio lighting.
  */
  {
    id: 'void',
    label: 'Void',
    angle: 180,
    stops: [
      { at: 0, color: '#050506' },
      { at: 1, color: '#000000' },
    ],
  },
  {
    id: 'seamless',
    label: 'Seamless',
    angle: 180,
    stops: [
      { at: 0, color: '#f7f8fa' },
      { at: 0.6, color: '#eceef2' },
      { at: 1, color: '#dfe2e7' },
    ],
    blobs: [{ x: 0.5, y: 0.35, r: 0.7, color: '#ffffff' }],
  },
  {
    id: 'noir',
    label: 'Noir',
    angle: 140,
    stops: [
      { at: 0, color: '#1b1d22' },
      { at: 0.55, color: '#0e0f12' },
      { at: 1, color: '#050506' },
    ],
    blobs: [{ x: 0.72, y: 0.2, r: 0.5, color: '#4a4f5a' }],
  },
  {
    id: 'blush',
    label: 'Blush',
    angle: 155,
    stops: [
      { at: 0, color: '#fdeef2' },
      { at: 0.5, color: '#f8cfdc' },
      { at: 1, color: '#e79ab4' },
    ],
    blobs: [{ x: 0.3, y: 0.25, r: 0.5, color: '#ffffff' }],
  },
  {
    id: 'ocean',
    label: 'Ocean',
    angle: 130,
    stops: [
      { at: 0, color: '#dff3fb' },
      { at: 0.45, color: '#8fcbe8' },
      { at: 1, color: '#2f6f9e' },
    ],
  },
  {
    id: 'lime',
    label: 'Lime',
    angle: 145,
    stops: [
      { at: 0, color: '#f6ffe3' },
      { at: 0.5, color: '#d7f59a' },
      { at: 1, color: '#8fc93a' },
    ],
  },
  {
    id: 'violet',
    label: 'Violet',
    angle: 135,
    stops: [
      { at: 0, color: '#efe6ff' },
      { at: 0.5, color: '#c1a5f5' },
      { at: 1, color: '#6b3fd4' },
    ],
    blobs: [{ x: 0.75, y: 0.75, r: 0.5, color: '#ff9ad5' }],
  },
  {
    id: 'sand',
    label: 'Sand',
    angle: 160,
    stops: [
      { at: 0, color: '#fbf3e6' },
      { at: 0.5, color: '#ecd9b9' },
      { at: 1, color: '#c9a878' },
    ],
  },
  {
    id: 'steel',
    label: 'Steel',
    angle: 150,
    stops: [
      { at: 0, color: '#f2f4f7' },
      { at: 0.5, color: '#cfd6de' },
      { at: 1, color: '#97a2b0' },
    ],
  },
  {
    id: 'ember',
    label: 'Ember',
    angle: 140,
    stops: [
      { at: 0, color: '#2a1410' },
      { at: 0.5, color: '#7a2d18' },
      { at: 1, color: '#e0631f' },
    ],
    blobs: [{ x: 0.6, y: 0.7, r: 0.55, color: '#ffb066' }],
  },
);

export const DEFAULT_BACKGROUND = 'crystal';

/**
 * User-defined background.
 *
 * Users matching brand colors need custom stops regardless of preset count.
 * Encode with a `custom:` prefix so the project stores it as a single string.
 */
export function encodeCustom(bg: Background): string {
  return `custom:${bg.angle}:${bg.stops.map((s) => `${s.at}|${s.color}`).join(',')}`;
}

export function decodeCustom(id: string): Background | null {
  if (!id.startsWith('custom:')) return null;
  const [, angleRaw, stopsRaw] = id.split(':');
  const stops = (stopsRaw ?? '')
    .split(',')
    .map((part) => {
      const [at, color] = part.split('|');
      return { at: Number(at), color };
    })
    .filter((s) => Number.isFinite(s.at) && !!s.color);
  if (stops.length < 2) return null;
  return { id, label: 'Custom', angle: Number(angleRaw) || 145, stops };
}

export function getBackground(id: string): Background {
  return decodeCustom(id) ?? BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0];
}

/**
 * Is the background dark?
 *
 * Selects the initial text color. Fixed white text disappeared on near-white
 * backgrounds such as glaze (#f6f7fb→#d4d9ea) and crystal; export merely
 * exposed a visibility problem already present in the editor.
 *
 * Average the stops: a single stop misclassifies light-to-dark gradients.
 */
export function isDarkBackground(bg: Background): boolean {
  const lum = (hex: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return 1;
    const n = parseInt(m[1], 16);
    // Relative luminance weights green most heavily, matching visual sensitivity.
    return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
  };
  if (!bg.stops.length) return false;
  const avg = bg.stops.reduce((s, x) => s + lum(x.color), 0) / bg.stops.length;
  return avg < 0.5;
}

/** CSS gradient for swatches and DOM previews. */
export function toCss(bg: Background): string {
  const stops = bg.stops.map((s) => `${s.color} ${Math.round(s.at * 100)}%`).join(', ');
  const base = `linear-gradient(${bg.angle}deg, ${stops})`;
  if (!bg.blobs?.length) return base;
  const blobs = bg.blobs.map(
    (b) =>
      `radial-gradient(circle at ${Math.round(b.x * 100)}% ${Math.round(b.y * 100)}%, ` +
      `${b.color}66 0%, transparent ${Math.round(b.r * 100)}%)`,
  );
  return [...blobs, base].join(', ');
}
