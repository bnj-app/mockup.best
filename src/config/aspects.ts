/**
 * Frame aspect ratios. null fills the container freely. Selecting a ratio locks the canvas to it
 * with surrounding space, showing the exact export framing while editing. Unexpected export
 * cropping is especially frustrating when creating store images.
 */

export type AspectOption = {
  id: string;
  label: string;
  /** Width / height. null = free. */
  ratio: number | null;
  /** Pixel dimensions for presets such as App Store sizes. */
  px?: { w: number; h: number };
  group?: string;
};

export const ASPECTS: AspectOption[] = [
  { id: 'fill', label: 'Fill', ratio: null },
  { id: '21-9', label: '21:9', ratio: 21 / 9 },
  { id: '16-9', label: '16:9', ratio: 16 / 9 },
  { id: '3-2', label: '3:2', ratio: 3 / 2 },
  { id: '4-3', label: '4:3', ratio: 4 / 3 },
  { id: '1-1', label: '1:1', ratio: 1 },
  { id: '4-5', label: '4:5', ratio: 4 / 5 },
  { id: '3-4', label: '3:4', ratio: 3 / 4 },
  { id: '2-3', label: '2:3', ratio: 2 / 3 },
  { id: '9-16', label: '9:16', ratio: 9 / 16 },

  {
    id: 'as-iphone',
    label: 'App Store · iPhone',
    ratio: 1290 / 2796,
    px: { w: 1290, h: 2796 },
    group: 'App Store',
  },
  {
    id: 'as-ipad',
    label: 'App Store · iPad',
    ratio: 2064 / 2752,
    px: { w: 2064, h: 2752 },
    group: 'App Store',
  },
  {
    id: 'as-mac',
    label: 'App Store · Mac',
    ratio: 2880 / 1800,
    px: { w: 2880, h: 1800 },
    group: 'App Store',
  },
  /*
    App Store preview sizes, taken directly from Apple's specification. All Face ID / Dynamic Island
    iPhones require 886×1920; the old "Portrait 1080×1920" applies only to the 5.5" Home-button row.
    Give 886×1920 a new ID: changing dimensions while retaining as-video-v silently narrowed old
    saved projects on opening. Migrate the old ID to the 1080×1920 5.5" row on load
    (LEGACY_ASPECT_IDS, project.ts applyProject).
  */
  {
    id: 'as-video-iphone',
    label: 'App Store Preview · iPhone',
    ratio: 886 / 1920,
    px: { w: 886, h: 1920 },
    group: 'App Store',
  },
  {
    id: 'as-video-legacy',
    label: 'App Store Preview · iPhone 5.5"',
    ratio: 1080 / 1920,
    px: { w: 1080, h: 1920 },
    group: 'App Store',
  },
  {
    id: 'as-video-ipad',
    label: 'App Store Preview · iPad',
    ratio: 1200 / 1600,
    px: { w: 1200, h: 1600 },
    group: 'App Store',
  },
  {
    id: 'as-video-h',
    label: 'App Store Preview · Mac / TV',
    ratio: 16 / 9,
    px: { w: 1920, h: 1080 },
    group: 'App Store',
  },

  /*
    Google Play: the long image edge can be at most twice the short edge. 1290×2796 (2.17) cannot be
    uploaded, so use a separate group. Tablet 9:16 shares the phone ratio and needs no separate row
    here (export has one).
  */
  {
    id: 'gp-phone',
    label: 'Google Play · Phone',
    ratio: 1080 / 1920,
    px: { w: 1080, h: 1920 },
    group: 'Google Play',
  },
  {
    id: 'gp-feature',
    label: 'Google Play · Feature graphic',
    ratio: 1024 / 500,
    px: { w: 1024, h: 500 },
    group: 'Google Play',
  },

  /* Social / launch: match export aspect ratios so framing can be previewed. */
  { id: 'og', label: 'Social · Link preview (OG)', ratio: 1200 / 630, px: { w: 1200, h: 630 }, group: 'Social' },
  { id: 'ph-gallery', label: 'Social · Product Hunt gallery', ratio: 1270 / 760, px: { w: 1270, h: 760 }, group: 'Social' },
];

/** Legacy IDs with changed meanings → current equivalents, preserving dimensions. */
const LEGACY_ASPECT_IDS: Record<string, string> = {
  // Before 2026-10-08 this meant 1080×1920; October 8–11 saves meant 886,
  // but no marker distinguishes them. Most saves, dating back to August, use 1080×1920.
  'as-video-v': 'as-video-legacy',
};

/** Map a saved project's aspect ID to the current table. */
export function migrateAspectId(id: string): string {
  return LEGACY_ASPECT_IDS[id] ?? id;
}

export function getAspect(id: string): AspectOption {
  return ASPECTS.find((a) => a.id === id) ?? ASPECTS[0];
}
