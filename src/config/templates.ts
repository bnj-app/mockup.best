import type { Shot } from '@/store/editor';
import { CAMERA_DEFAULT } from '@/config/motion';

/**
 * Ready-made scenes. Applying a template configures the whole scene: device, finish, camera angle,
 * background, studio, effects, and optional text. Users start with a useful result. Preserve uploaded
 * media; change only the scene setup.
 */

/**
 * Template patch. Nested `light`, `scene`, `blur`, and `statusBar` fields are partial: specify only
 * changes and retain existing values for the rest. Full objects previously made all 12 templates fail
 * compilation whenever a scene setting was added.
 */
export type TemplatePatch = Omit<
  Partial<Shot>,
  'id' | 'label' | 'media' | 'mediaKind' | 'keyframes' | 'keyframed' | 'light' | 'scene' | 'blur' | 'statusBar'
> & {
  light?: Partial<Shot['light']>;
  scene?: Partial<Shot['scene']>;
  blur?: Partial<Shot['blur']>;
  statusBar?: Partial<Shot['statusBar']>;
};

export type Template = {
  id: string;
  label: string;
  group: string;
  /** Card preview background, matching the scene background. */
  backgroundId: string;
  apply: TemplatePatch;
};

const cam = (patch: Partial<typeof CAMERA_DEFAULT>) => ({ ...CAMERA_DEFAULT, ...patch });

export const TEMPLATES: Template[] = [
  {
    id: 'hero-glass',
    label: 'Hero Glass',
    group: 'Starter',
    backgroundId: 'crystal',
    apply: {
      deviceId: 'phone',
      finishId: 'crystal',
      camera: cam({ tiltX: -12, tiltY: 28, zoom: 3.0, fov: 18 }),
      scene: { backgroundId: 'crystal', bgBlur: 0, transparent: false, envId: 'studio' },
      light: {
        rotation: 190, key: 0.2, keyHeight: 5,
        contactShadow: true, envRotation: 20, envIntensity: 1.1, lift: 0, reflection: 0,
      },
      effects: [{ id: 'vignette', value: 0.25, on: true }],
    },
  },
  {
    id: 'noir-edge',
    label: 'Noir Edge',
    group: 'Starter',
    backgroundId: 'noir',
    apply: {
      deviceId: 'phone',
      finishId: 'smoke',
      camera: cam({ tiltX: -6, tiltY: 46, zoom: 3.4, fov: 16 }),
      scene: { backgroundId: 'noir', bgBlur: 0, transparent: false, envId: 'contrast' },
      light: {
        rotation: 210, key: 0.4, keyHeight: 6,
        contactShadow: true, envRotation: 40, envIntensity: 1.5, lift: 0, reflection: 0.35,
      },
      effects: [
        { id: 'vignette', value: 0.5, on: true },
        { id: 'grain', value: 0.25, on: true },
      ],
    },
  },
  {
    id: 'store-shot',
    label: 'Store Shot',
    group: 'App Store',
    backgroundId: 'glaze',
    apply: {
      deviceId: 'phone',
      finishId: 'crystal',
      camera: cam({ tiltX: 0, tiltY: 0, zoom: 2.6, fov: 14, panY: 0.1 }),
      scene: { backgroundId: 'glaze', bgBlur: 0, transparent: false, envId: 'softbox' },
      /*
        Do not enable the status bar automatically; this previously set `on: true`. "Store Shot" uses
        screenshots from real devices or simulators that already include a status bar. Our overlay does not
        replace it: "09:41" and "9:41" overlap, and signal/Wi-Fi/battery icons appear twice. Keep settings
        ready for users to enable when their screenshot has no bar. The same issue was fixed in PHOTO mode.
      */
      statusBar: { on: false, time: '9:41', dark: true, battery: 0.9 },
      light: {
        rotation: 190, key: 0.1, keyHeight: 5,
        contactShadow: true, envRotation: 0, envIntensity: 1, lift: 0, reflection: 0,
      },
      effects: [],
    },
  },
  {
    id: 'sunrise-tilt',
    label: 'Sunrise Tilt',
    group: 'Colorful',
    backgroundId: 'sunrise',
    apply: {
      deviceId: 'phone',
      finishId: 'amber',
      camera: cam({ tiltX: -22, tiltY: -32, zoom: 3.1, roll: -6 }),
      scene: { backgroundId: 'sunrise', bgBlur: 0, transparent: false, envId: 'dusk' },
      light: {
        rotation: 150, key: 0.3, keyHeight: 4,
        contactShadow: true, envRotation: 120, envIntensity: 1.3, lift: 0.6, reflection: 0,
      },
      effects: [
        { id: 'temperature', value: 0.25, on: true },
        { id: 'vignette', value: 0.3, on: true },
      ],
    },
  },
  {
    id: 'spectrum-pop',
    label: 'Spectrum Pop',
    group: 'Colorful',
    backgroundId: 'spectrum',
    apply: {
      deviceId: 'phone',
      finishId: 'crystal',
      camera: cam({ tiltX: -16, tiltY: 34, zoom: 2.9, roll: 4 }),
      scene: { backgroundId: 'spectrum', bgBlur: 0, transparent: false, envId: 'studio' },
      light: {
        rotation: 190, key: 0.2, keyHeight: 5,
        contactShadow: true, envRotation: 60, envIntensity: 1.2, lift: 0, reflection: 0.2,
      },
      effects: [
        { id: 'saturation', value: 0.2, on: true },
        { id: 'aberration', value: 0.2, on: true },
      ],
    },
  },
  {
    id: 'desk-setup',
    label: 'Desk Setup',
    group: 'Starter',
    backgroundId: 'steel',
    apply: {
      deviceId: 'laptop',
      finishId: 'silver',
      camera: cam({ tiltX: -20, tiltY: 24, zoom: 3.0, fov: 20 }),
      scene: { backgroundId: 'steel', bgBlur: 0, transparent: false, envId: 'window' },
      light: {
        rotation: 200, key: 0.2, keyHeight: 5,
        contactShadow: true, envRotation: 30, envIntensity: 1.2, lift: 0, reflection: 0.25,
      },
      effects: [{ id: 'sharpen', value: 0.25, on: true }],
    },
  },
  {
    id: 'wrist-close',
    label: 'Wrist Close',
    group: 'Starter',
    backgroundId: 'blush',
    apply: {
      deviceId: 'watch',
      finishId: 'crystal',
      camera: cam({ tiltX: -10, tiltY: 34, zoom: 3.3, fov: 20 }),
      scene: { backgroundId: 'blush', bgBlur: 0, transparent: false, envId: 'softbox' },
      statusBar: { on: false, time: '9:41', dark: true, battery: 0.82 },
      light: {
        rotation: 180, key: 0.25, keyHeight: 5,
        contactShadow: true, envRotation: 10, envIntensity: 1.2, lift: 0, reflection: 0,
      },
      effects: [{ id: 'vignette', value: 0.2, on: true }],
    },
  },
  {
    id: 'flat-card',
    label: 'Flat Card',
    group: 'Minimal',
    backgroundId: 'glaze',
    apply: {
      deviceId: 'flat',
      finishId: 'crystal',
      camera: cam({ tiltX: -8, tiltY: 16, zoom: 2.8, fov: 16 }),
      scene: { backgroundId: 'glaze', bgBlur: 0, transparent: false, envId: 'softbox' },
      light: {
        rotation: 190, key: 0.1, keyHeight: 5,
        contactShadow: true, envRotation: 0, envIntensity: 0.9, lift: 0, reflection: 0.15,
      },
      effects: [],
    },
  },
  {
    id: 'straight-on',
    label: 'Straight On',
    group: 'Minimal',
    backgroundId: 'mint',
    apply: {
      deviceId: 'phone',
      finishId: 'frost',
      camera: cam({ tiltX: 0, tiltY: 0, zoom: 2.8, fov: 14 }),
      scene: { backgroundId: 'mint', bgBlur: 0, transparent: false, envId: 'softbox' },
      light: {
        rotation: 190, key: 0, keyHeight: 5,
        contactShadow: true, envRotation: 0, envIntensity: 1, lift: 0, reflection: 0,
      },
      effects: [],
    },
  },
  {
    id: 'low-drama',
    label: 'Low Drama',
    group: 'Cinematic',
    backgroundId: 'graphite',
    apply: {
      deviceId: 'phone',
      finishId: 'black',
      camera: cam({ tiltX: 32, tiltY: 22, zoom: 3.4, fov: 26 }),
      scene: { backgroundId: 'graphite', bgBlur: 0, transparent: false, envId: 'contrast' },
      light: {
        rotation: 220, key: 0.5, keyHeight: 3,
        contactShadow: true, envRotation: 70, envIntensity: 1.6, lift: 0, reflection: 0.4,
      },
      effects: [
        { id: 'vignette', value: 0.55, on: true },
        { id: 'grain', value: 0.3, on: true },
      ],
    },
  },
  {
    id: 'tilt-shift',
    label: 'Tilt Shift',
    group: 'Cinematic',
    backgroundId: 'ocean',
    apply: {
      deviceId: 'phone',
      finishId: 'crystal',
      camera: cam({ tiltX: -18, tiltY: 38, zoom: 3.2 }),
      scene: { backgroundId: 'ocean', bgBlur: 0, transparent: false, envId: 'studio' },
      blur: {
        mode: 'linear', strength: 34, focusSize: 0.14, falloff: 0.28,
        bokeh: true, fx: 0.5, fy: 0.5, angle: 0,
      },
      light: {
        rotation: 190, key: 0.2, keyHeight: 5,
        contactShadow: true, envRotation: 20, envIntensity: 1.1, lift: 0, reflection: 0,
      },
      effects: [],
    },
  },
  {
    id: 'violet-glass',
    label: 'Violet Glass',
    group: 'Colorful',
    backgroundId: 'violet',
    apply: {
      deviceId: 'phone',
      finishId: 'crystal',
      camera: cam({ tiltX: -14, tiltY: -30, zoom: 3.0, roll: 3 }),
      scene: { backgroundId: 'violet', bgBlur: 0, transparent: false, envId: 'studio' },
      light: {
        rotation: 160, key: 0.25, keyHeight: 5,
        contactShadow: true, envRotation: 200, envIntensity: 1.4, lift: 0.4, reflection: 0.3,
      },
      effects: [{ id: 'saturation', value: 0.15, on: true }],
    },
  },
];

export const TEMPLATE_GROUPS = ['Starter', 'App Store', 'Minimal', 'Colorful', 'Cinematic'];
