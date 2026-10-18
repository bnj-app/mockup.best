/**
 * EXPORT DIMENSIONS: single source for ExportMenu (client) and landing pages
 * (server-side store-size table and size checker). A server component could
 * not read the values while they lived in a client file.
 */

export type SizeOption = {
  id: string;
  label: string;
  w: number;
  h: number;
  pro?: boolean;
  fixed?: boolean;
  /** Image export only: video encoders cannot reliably encode dimensions above 3840. */
  imageOnly?: boolean;
  /** Video export only (App Store preview dimensions). */
  videoOnly?: boolean;
  /**
   * Store dimensions: store-image exports alpha-free PNG (color type 2) or JPG;
   * store-video enables App Store preview rules: 30 fps, 12 Mbps maximum,
   * 256k AAC, a silent audio track if no audio is present, and MP4.
   */
  kind?: 'store-image' | 'store-video';
  /** Folder for this size in the store-set ZIP; omitted sizes are excluded. */
  folder?: string;
};

/**
 * Output dimensions include App Store presets so users do not need to look
 * up store screenshot sizes.

 * fixed disables orientation changes. App Store sizes are exact: a store
 * expecting 1290x2796 rejects 2796x1290. Selecting a store preset while
 * Landscape was active silently produced an invalid rotated image.
 * Landscape store dimensions therefore have separate entries.
 */
export const SIZES: SizeOption[] = [
  { id: '720p', label: '16:9 — 1280×720 (720P)', w: 1280, h: 720 },
  { id: '1080p', label: '16:9 — 1920×1080 (1080P)', w: 1920, h: 1080 },
  { id: '1440p', label: '16:9 — 2560×1440 (1440P)', w: 2560, h: 1440, pro: true },
  { id: '4k', label: '16:9 — 3840×2160 (4K)', w: 3840, h: 2160, pro: true },
  { id: '5k', label: '16:9 — 5120×2880 (5K)', w: 5120, h: 2880, pro: true, imageOnly: true },
  { id: '43', label: '4:3 — 1920×1440', w: 1920, h: 1440 },
  { id: '43-hi', label: '4:3 — 2560×1920', w: 2560, h: 1920, pro: true },
  { id: '32', label: '3:2 — 2880×1920', w: 2880, h: 1920, pro: true },
  { id: '219', label: '21:9 — 2240×960', w: 2240, h: 960, pro: true },
  /*
    STORE IMAGES: Apple's 6.9-inch group accepts 1290x2796; 13-inch iPad accepts
    2064x2752. Google Play limits the long edge to twice the short edge
    (1290x2796 = 2.17 and is rejected), so Play uses separate 9:16 entries.
    All are image-only: these formerly appeared under video too, but 1290x2796
    video does not fit any store preview slot.
  */
  { id: 'as-iphone', label: 'App Store · iPhone 6.9" — 1290×2796', w: 1290, h: 2796, fixed: true, imageOnly: true, kind: 'store-image', folder: 'app-store/iphone-6.9in-1290x2796' },
  { id: 'as-ipad', label: 'App Store · iPad 13" — 2064×2752', w: 2064, h: 2752, fixed: true, imageOnly: true, kind: 'store-image', folder: 'app-store/ipad-13in-2064x2752' },
  { id: 'as-mac', label: 'App Store · Mac — 2880×1800', w: 2880, h: 1800, fixed: true, imageOnly: true, kind: 'store-image', folder: 'app-store/mac-2880x1800' },
  { id: 'gp-phone', label: 'Google Play · Phone — 1080×1920', w: 1080, h: 1920, fixed: true, imageOnly: true, kind: 'store-image', folder: 'google-play/phone-1080x1920' },
  { id: 'gp-phone-h', label: 'Google Play · Phone landscape — 1920×1080', w: 1920, h: 1080, fixed: true, imageOnly: true, kind: 'store-image' },
  { id: 'gp-tablet', label: 'Google Play · Tablet — 1440×2560', w: 1440, h: 2560, fixed: true, imageOnly: true, kind: 'store-image', folder: 'google-play/tablet-1440x2560' },
  { id: 'gp-tablet-h', label: 'Google Play · Tablet landscape — 2560×1440', w: 2560, h: 1440, fixed: true, imageOnly: true, kind: 'store-image' },
  { id: 'gp-feature', label: 'Google Play · Feature graphic — 1024×500', w: 1024, h: 500, fixed: true, imageOnly: true, kind: 'store-image' },
  /*
    APP STORE PREVIEW VIDEOS: exact Apple specification dimensions.
    The old "Portrait 1080x1920" applies only to 5.5-inch iPhones with Home buttons;
    Face ID / Dynamic Island iPhones require 886x1920. Keep the 5.5-inch entry
    with a corrected name.
  */
  { id: 'as-video-iphone', label: 'App Store Preview · iPhone — 886×1920', w: 886, h: 1920, fixed: true, videoOnly: true, kind: 'store-video' },
  { id: 'as-video-vh', label: 'App Store Preview · iPhone landscape — 1920×886', w: 1920, h: 886, fixed: true, videoOnly: true, kind: 'store-video' },
  { id: 'as-video-ipad', label: 'App Store Preview · iPad — 1200×1600', w: 1200, h: 1600, fixed: true, videoOnly: true, kind: 'store-video' },
  { id: 'as-video-ipad-h', label: 'App Store Preview · iPad landscape — 1600×1200', w: 1600, h: 1200, fixed: true, videoOnly: true, kind: 'store-video' },
  { id: 'as-video-h', label: 'App Store Preview · Mac / Apple TV — 1920×1080', w: 1920, h: 1080, fixed: true, videoOnly: true, kind: 'store-video' },
  { id: 'as-video-legacy', label: 'App Store Preview · iPhone 5.5" — 1080×1920', w: 1080, h: 1920, fixed: true, videoOnly: true, kind: 'store-video' },
  /*
    SOCIAL / LAUNCH IMAGES: users think in destinations rather than pixels.
    OG 1200x630 and LinkedIn 1200x627 are established sizes. Product Hunt gallery:
    1270x760; its own page was unavailable, but third-party guides agree
    (screenhance.com/blog/product-hunt-gallery-size).
  */
  { id: 'og', label: 'Social · Link preview (OG) — 1200×630', w: 1200, h: 630, fixed: true, imageOnly: true },
  { id: 'linkedin', label: 'Social · LinkedIn post — 1200×627', w: 1200, h: 627, fixed: true, imageOnly: true },
  { id: 'x-post', label: 'Social · X post — 1600×900', w: 1600, h: 900, fixed: true, imageOnly: true },
  { id: 'ph-gallery', label: 'Social · Product Hunt gallery — 1270×760', w: 1270, h: 760, fixed: true, imageOnly: true },
  { id: 'custom', label: 'Custom…', w: 1920, h: 1080, pro: true },
];

/** Store image dimensions (alpha-free PNG/JPG), filtered from SIZES. */
export const STORE_IMAGE_SIZES = SIZES.filter((s) => s.kind === 'store-image');
