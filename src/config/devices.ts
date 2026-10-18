/**
 * Device catalog. Dimensions come from real hardware measurements in millimeters; 1 scene unit = 1 cm.
 * The screen field defines placement inside the body (cm) and corner radius. idealMedia supplies the
 * recommended upload resolution. Bodies are procedural; adding real GLB models only requires filling
 * model, with no scene-code changes.
 */

export type DeviceKind = 'flat' | 'phone' | 'watch' | 'laptop' | 'tablet' | 'monitor';

/**
 * Finish type. glass gives the device a distinctive abstract glass body rather than a hardware
 * replica. metal provides a conventional body but is not the default.
 */
export type FinishKind = 'glass' | 'metal' | 'clay';

export type DeviceFinish = {
  id: string;
  label: string;
  kind: FinishKind;
  /** Body color / glass tint (hex). */
  body: string;
  metalness: number;
  roughness: number;
  /** Glass light transmission (0–1). */
  transmission?: number;
  /** Glass attenuation distance (cm) and color: how color deepens with thickness. */
  attenuationDistance?: number;
  attenuationColor?: string;
};

export type Device = {
  id: string;
  label: string;
  kind: DeviceKind;
  /** Exclusive to the Pro plan? */
  pro: boolean;
  /** Ideal pixel dimensions for uploaded screen media. */
  idealMedia: { w: number; h: number } | null;
  /** Body dimensions, cm. */
  body: { w: number; h: number; d: number; radius: number };
  /**
   * Screen dimensions and corner radius inside the body, cm. border is the black margin between screen
   * glass and active pixels (cm). Real content never reaches the glass edge; without a margin, it looks
   * like a sticker. This fixed value follows the device's physical dimensions. Defaults to 0.
   */
  screen: { w: number; h: number; radius: number; inset: number; border?: number };
  finishes: DeviceFinish[];
  /**
   * Body details: camera bump and side buttons keep the back from looking empty when rotated. All
   * dimensions are in cm relative to the body center.
   */
  features?: {
    cameraIsland?: {
      w: number;
      h: number;
      d: number;
      radius: number;
      x: number;
      y: number;
      lenses: { r: number; x: number; y: number }[];
    };
    buttons?: { side: 'left' | 'right'; y: number; h: number }[];
    /** Front camera shape: 'island' (pill, default) or 'punch' (hole). */
    notchStyle?: 'island' | 'punch';
    /** Watch digital crown: a cylinder on the right edge. */
    crown?: { y: number; r: number; d: number };
    /** Watch strap: two pieces extending from the top and bottom of the case. */
    band?: { w: number; length: number; thickness: number };
    /**
     * Laptop base. The lid (screen) remains the body; the base extends forward from it. Keyboard and
     * trackpad proportions are relative to the base.
     */
    base?: { depth: number; thickness: number; tilt: number };
    /**
     * Monitor stand: a neck below the body and a base on the floor. The stand distinguishes a monitor from
     * a flat card.
     */
    stand?: { neckW: number; neckH: number; neckD: number; baseW: number; baseD: number; baseH: number };
  };
  /** Populate when a real model is available. */
  model?: string;
  /**
   * Derived landscape definition (Stage, deviceOpts.landscape): swap body, screen, and ideal dimensions;
   * rotate hardware 90° in DeviceMesh. The screen stack uses swapped dimensions, so media stays upright.
   */
  landscape?: boolean;
};

/* --- GLASS: default identity --- */

const CRYSTAL: DeviceFinish = {
  id: 'crystal', label: 'Crystal', kind: 'glass',
  body: '#ffffff', metalness: 0, roughness: 0.03,
  /*
    attenuationDistance 2.4 → 1.05. At 2.4, glass was so clear that its silhouette vanished against
    light backgrounds: the screen floated like paper with no visible edge or thickness. Thick glass
    darkens along longer light paths, making edges visible while preserving its glass appearance.
  */
  /*
    Keep edges visible. With transmission 1.0 the body was fully transparent from the side: no
    silhouette, a floating side button, and a sticker-like appearance. 0.86 preserves glass with slight
    milkiness so longer edge light paths remain visible. Shorter attenuationDistance deepens color
    faster in thick areas, defining the edge.
  */
  transmission: 0.86, attenuationColor: '#9fb8d6', attenuationDistance: 0.62,
};
const SMOKE: DeviceFinish = {
  id: 'smoke', label: 'Smoke', kind: 'glass',
  body: '#ffffff', metalness: 0, roughness: 0.05,
  transmission: 0.84, attenuationColor: '#3c4250', attenuationDistance: 0.55,
};
const AMBER: DeviceFinish = {
  id: 'amber', label: 'Amber', kind: 'glass',
  body: '#ffffff', metalness: 0, roughness: 0.04,
  transmission: 0.85, attenuationColor: '#d4913c', attenuationDistance: 0.7,
};
const FROST: DeviceFinish = {
  id: 'frost', label: 'Frost', kind: 'glass',
  body: '#ffffff', metalness: 0, roughness: 0.42,
  transmission: 0.8, attenuationColor: '#d3dde9', attenuationDistance: 1.6,
};

/* --- METAL: available but not the default --- */

const BLACK: DeviceFinish = {
  id: 'black', label: 'Black', kind: 'metal', body: '#1c1c1e', metalness: 0.55, roughness: 0.35,
};
const SILVER: DeviceFinish = {
  id: 'silver', label: 'Silver', kind: 'metal', body: '#d8d9dc', metalness: 0.85, roughness: 0.28,
};
const TITANIUM: DeviceFinish = {
  // The initial value (#8f8b86) was too dark: metal reflects its surroundings,
  // and the dark base made it look black. Real titanium is lighter too.
  id: 'titanium', label: 'Titanium', kind: 'metal', body: '#bdb8b1', metalness: 0.88, roughness: 0.26,
};
const WHITE: DeviceFinish = {
  /*
    Brighten white: #f2f2f4 + metalness 0.15 absorbed the studio's mid-gray environment and looked dirty
    gray. Lower metalness and a lighter color increase diffuse reflection so the body reads as white.
  */
  /*
    metalness 0.04 was tried and reverted: the front looked ceramic white, but at the low angle the lid
    back (the laptop's largest surface) became a flat, lifeless gray slab with no environment response.
    0.14 + 0.34 roughness softly captures the environment gradient while keeping the color light.
  */
  id: 'white', label: 'White', kind: 'metal', body: '#fafafc', metalness: 0.14, roughness: 0.34,
};

/*
  CLAY: monochrome, matte hardware without reflections; screen content stays unchanged. Useful for
  concept/wireframe presentations and a less brand-specific appearance. DeviceMesh converts materials
  centrally with toClay.
*/
const CLAY: DeviceFinish = { id: 'clay', label: 'Clay', kind: 'clay', body: '#e8e5df', metalness: 0, roughness: 0.85 };
const CLAY_DARK: DeviceFinish = { id: 'clay-dark', label: 'Clay Dark', kind: 'clay', body: '#3b3c40', metalness: 0, roughness: 0.85 };

/** Consistent order for every device: glass (default), metal, then clay. */
const FINISHES: DeviceFinish[] = [CRYSTAL, SMOKE, AMBER, FROST, BLACK, SILVER, TITANIUM, WHITE, CLAY, CLAY_DARK];
/*
  Realistic devices now use GLB hardware models and default to metal. Glass finishes remain available
  but no longer come first. Flat cards still start with glass.
*/
const REAL_FINISHES: DeviceFinish[] = [SILVER, TITANIUM, BLACK, WHITE, CRYSTAL, SMOKE, AMBER, FROST, CLAY, CLAY_DARK];

export const DEVICES: Device[] = [
  {
    id: 'flat',
    label: 'Flat',
    kind: 'flat',
    pro: false,
    idealMedia: null,
    // Flat card: inherits the uploaded image's aspect ratio; only thickness matters here.
    body: { w: 16, h: 10, d: 0.12, radius: 0.5 },
    screen: { w: 16, h: 10, radius: 0.5, inset: 0 },
    finishes: FINISHES,
  },
  {
    id: 'phone',
    label: 'Phone',
    kind: 'phone',
    pro: false,
    idealMedia: { w: 1206, h: 2622 },
    // 6.3" Pro-class body: 15.0 × 7.19 × 0.875 cm, matching the GLB model
    // (tools/devices3d/build.py). Update both together if dimensions change.
    body: { w: 7.19, h: 15.0, d: 0.875, radius: 1.18 },
    model: '/models/phone.glb',
    screen: { w: 6.7, h: 14.54, radius: 1.0, inset: 0.23, border: 0.12 },
    finishes: REAL_FINISHES,
    features: {
      // Square camera bump at top left, with three lenses in a triangle.
      cameraIsland: {
        w: 3.2, h: 3.2, d: 0.18, radius: 0.85,
        x: -1.7, y: 5.3,
        lenses: [
          { r: 0.62, x: -0.72, y: 0.72 },
          { r: 0.62, x: 0.72, y: 0.72 },
          { r: 0.62, x: -0.72, y: -0.72 },
        ],
      },
      /*
        Design decision: omit side buttons. A clean metal edge works better in product shots; buttons broke
        the line into distracting patches. Keep them on tablets and watches, where the edge is thicker and
        buttons define the hardware.
      */
    },
  },
  {
    id: 'phone-max',
    label: 'Phone Max',
    kind: 'phone',
    pro: true,
    idealMedia: { w: 1320, h: 2868 },
    // 6.9" class body: 16.3 × 7.8 × 0.83 cm.
    body: { w: 7.8, h: 16.3, d: 0.875, radius: 1.25 },
    model: '/models/phone-max.glb',
    screen: { w: 7.3, h: 15.84, radius: 1.05, inset: 0.25, border: 0.13 },
    finishes: REAL_FINISHES,
    features: {
      cameraIsland: {
        w: 3.5, h: 3.5, d: 0.2, radius: 0.9,
        x: -1.85, y: 5.8,
        lenses: [
          { r: 0.66, x: -0.78, y: 0.78 },
          { r: 0.66, x: 0.78, y: 0.78 },
          { r: 0.66, x: -0.78, y: -0.78 },
        ],
      },
      // No side buttons, for the same reason as phone.
    },
  },
  {
    id: 'tablet',
    label: 'Tablet',
    kind: 'tablet',
    pro: true,
    idealMedia: { w: 2064, h: 2752 },
    // 13" class portrait tablet: 28.1 × 21.5 × 0.51 cm.
    // Deliberately no camera bump: a plain tablet back keeps it distinct from a phone.
    body: { w: 21.5, h: 28.1, d: 0.51, radius: 1.55 },
    model: '/models/tablet.glb',
    screen: { w: 20.3, h: 26.9, radius: 0.85, inset: 0.6, border: 0.28 },
    finishes: REAL_FINISHES,
    features: {
      buttons: [{ side: 'right', y: 12.2, h: 1.8 }],
    },
  },
  {
    id: 'watch',
    label: 'Watch',
    kind: 'watch',
    pro: false,
    idealMedia: { w: 410, h: 502 },
    // 49 mm class case: 4.9 × 4.4 × 1.44 cm (actual Ultra-class thickness).
    body: { w: 4.4, h: 4.9, d: 1.2, radius: 1.0 },
    model: '/models/watch.glb',
    screen: { w: 3.7, h: 4.4, radius: 0.85, inset: 0.35 },
    finishes: REAL_FINISHES,
    features: {
      // Without a strap, the watch case looks like a detached part.
      // The strap defines half the silhouette.
      /*
        Keep the strap a short loop. At 7.5 cm it formed huge plates outside the frame; at 4.2 cm it still
        overwhelmed the case. Product shots rarely show the whole strap: a short extension establishes the
        watch shape without disrupting framing.
      */
      band: { w: 2.6, length: 1.7, thickness: 0.32 },
      crown: { y: 0.55, r: 0.3, d: 0.34 },
      buttons: [{ side: 'right', y: -0.6, h: 1.0 }],
    },
  },
  {
    id: 'laptop',
    label: 'Laptop',
    kind: 'laptop',
    pro: false,
    idealMedia: { w: 3024, h: 1964 },
    /*
      14" class lid: 31.26 × 22.12 cm. ⚠️ Corrected thickness: 1.55 cm is the real machine's total closed
      thickness; the lid alone is ~0.45 cm. The old value looked tablet-thick. Base (1.1) + lid (0.45) ≈
      1.55 now matches the hardware.
    */
    body: { w: 31.26, h: 22.12, d: 0.48, radius: 0.84 },
    model: '/models/laptop.glb',
    screen: { w: 29.9, h: 19.4, radius: 0.35, inset: 0.68 },
    finishes: REAL_FINISHES,
    features: {
      // Without a base, the laptop looked like an upright tablet.
      base: { depth: 22.1, thickness: 1.1, tilt: 9 },
    },
  },
  {
    id: 'laptop-16',
    label: 'Laptop 16"',
    kind: 'laptop',
    pro: true,
    idealMedia: { w: 3456, h: 2234 },
    // 16" class lid: 35.57 × 24.81 cm; the same thickness correction as the 14":
    // 1.68 is the closed total, lid ~0.47; base 1.2 + lid ≈ actual hardware.
    body: { w: 35.57, h: 24.81, d: 0.5, radius: 0.88 },
    model: '/models/laptop-16.glb',
    screen: { w: 34.2, h: 21.9, radius: 0.4, inset: 0.7 },
    finishes: REAL_FINISHES,
    features: {
      base: { depth: 24.8, thickness: 1.2, tilt: 9 },
    },
  },
  {
    id: 'display',
    label: 'Display',
    kind: 'monitor',
    pro: true,
    idealMedia: { w: 6016, h: 3384 },
    // 32" class panel: 71.7 × 41.2 × 2.4 cm.
    body: { w: 71.7, h: 41.2, d: 2.4, radius: 1.2 },
    model: '/models/display.glb',
    screen: { w: 69.7, h: 39.2, radius: 0.6, inset: 1.0 },
    finishes: REAL_FINISHES,
    features: {
      stand: { neckW: 6.4, neckH: 12, neckD: 2.2, baseW: 22, baseD: 18, baseH: 0.9 },
    },
  },
  /*
    Additional devices all use GLB models (tools/devices3d) and generic names without brands or logos.
    Both Android-class models are used directly for Play Store visuals.
  */
  {
    id: 'phone-slim',
    label: 'Phone Slim',
    kind: 'phone',
    pro: false,
    idealMedia: { w: 1260, h: 2736 },
    // 6.5" ultra-thin body: 15.62 × 7.47 × 0.564 cm.
    body: { w: 7.47, h: 15.62, d: 0.564, radius: 1.22 },
    model: '/models/phone-slim.glb',
    screen: { w: 6.98, h: 15.15, radius: 1.05, inset: 0.24, border: 0.12 },
    finishes: REAL_FINISHES,
  },
  {
    id: 'android',
    label: 'Android',
    kind: 'phone',
    pro: false,
    idealMedia: { w: 1280, h: 2856 },
    // 6.3" Android-class body: 15.28 × 7.2 × 0.86 cm, full-width camera visor.
    body: { w: 7.2, h: 15.28, d: 0.86, radius: 1.25 },
    model: '/models/android.glb',
    screen: { w: 6.62, h: 14.76, radius: 1.05, inset: 0.25, border: 0.1 },
    finishes: REAL_FINISHES,
    features: { notchStyle: 'punch' },
  },
  {
    id: 'android-ultra',
    label: 'Android Ultra',
    kind: 'phone',
    pro: false,
    idealMedia: { w: 1440, h: 3120 },
    // 6.9" angular Android-class body: 16.28 × 7.81 × 0.82 cm.
    body: { w: 7.81, h: 16.28, d: 0.82, radius: 0.72 },
    model: '/models/android-ultra.glb',
    screen: { w: 7.35, h: 15.92, radius: 0.5, inset: 0.22, border: 0.1 },
    finishes: REAL_FINISHES,
    features: { notchStyle: 'punch' },
  },
  {
    id: 'laptop-slim',
    label: 'Laptop Slim 13"',
    kind: 'laptop',
    pro: false,
    idealMedia: { w: 2560, h: 1664 },
    // 13" slim laptop lid: 30.41 × 21.5, lid 0.4 + base 0.73 cm.
    body: { w: 30.41, h: 21.5, d: 0.4, radius: 0.8 },
    model: '/models/laptop-slim.glb',
    screen: { w: 28.4, h: 18.46, radius: 0.3, inset: 0.65 },
    finishes: REAL_FINISHES,
    features: { base: { depth: 21.5, thickness: 0.73, tilt: 9 } },
  },
  {
    id: 'display-27',
    label: 'Display 27"',
    kind: 'monitor',
    pro: false,
    idealMedia: { w: 5120, h: 2880 },
    // 27" panel: 62.3 × 36.2 × 2.2 cm.
    body: { w: 62.3, h: 36.2, d: 2.2, radius: 1.0 },
    model: '/models/display-27.glb',
    screen: { w: 59.8, h: 33.64, radius: 0.4, inset: 1.0 },
    finishes: REAL_FINISHES,
    features: {
      stand: { neckW: 6.4, neckH: 11, neckD: 2.2, baseW: 18, baseD: 16, baseH: 0.9 },
    },
  },
];

export const DEFAULT_DEVICE = 'flat';

export function getDevice(id: string): Device {
  return DEVICES.find((d) => d.id === id) ?? DEVICES[0];
}

/** Screen aspect ratio for correct source-image cropping. */
export function screenAspect(d: Device): number {
  return d.screen.w / d.screen.h;
}

/**
 * Active pixel area: content rectangle after subtracting screen.border. Media, notch, and status bar
 * use this area; screen glass and dark bezel retain the screen dimensions.
 */
export function contentRect(d: Device): { w: number; h: number; radius: number } {
  const b = d.screen.border ?? 0;
  let w = Math.max(0.5, d.screen.w - 2 * b);
  let h = Math.max(0.5, d.screen.h - 2 * b);
  /*
    Preserve aspect ratio. Subtracting b from every edge changes a phone's content ratio from 0.4608 to
    0.4517, cropping ~2% from full-resolution screenshots in cover-fit (cutting off clock/battery).
    After subtracting the border, fit the largest rectangle with the idealMedia ratio. Extra space
    blends into the black border on one axis, with no cropping.
  */
  if (d.idealMedia) {
    const a = d.idealMedia.w / d.idealMedia.h;
    if (w / h > a) w = h * a;
    else h = w / a;
  }
  return {
    w,
    h,
    /* The content corner follows the glass corner, inset by the border. The same
       radius would taper the border to zero at the corner. */
    radius: Math.max(0.02, d.screen.radius - b),
  };
}
