/**
 * Goal-based publishing packs.
 *
 * Users choose a goal: feature launch, store image set, or portfolio.
 * Each pack provides named screen slots (config/screens.ts, refreshable
 * with "Update screens"), short text fields, an aspect ratio, and a list
 * of suitable outputs with instructions for exporting them.
 *
 * Scenes reuse existing, verified components: Feature launch uses Magic Reel
 * choreography (config/reel.ts), Store set uses "Store Shot", and Portfolio
 * uses "Desk Setup" with a slow orbit. No new camera behavior is introduced.
 *
 * Deep link: `/editor/?start=<pack>` opens the dialog on that pack,
 * allowing landing pages to link directly to it.
 */

import { makeShot, makeTextItem, nextShotId, type Shot, type TextItem } from '@/store/editor';
import { TEMPLATES } from '@/config/templates';
import { applyTemplateTo } from '@/store/editor';
import { encodeCustom } from '@/config/backgrounds';
import { nextKeyframeId, type PropertyTrack } from '@/config/tracks';
import { buildMagicReel } from '@/config/reel';
import { screenKey } from '@/config/screens';

export type PackId = 'feature-launch' | 'app-store' | 'portfolio';

export type PackSlot = {
  /** Screen name, assigned to each scene's `screenName`. */
  name: string;
  label: string;
  hint: string;
  required?: boolean;
};
export type PackField = { id: string; label: string; placeholder: string; max: number };
export type PackOutput = { label: string; where: string };

export type PackMedia = { url: string; name: string; kind: 'image' | 'video' };
export type PackInput = {
  media: Record<string, PackMedia | undefined>;
  texts: Record<string, string>;
  /** Brand color (#rrggbb), used to derive the background. */
  color: string;
};

export type Pack = {
  id: PackId;
  title: string;
  tagline: string;
  slots: PackSlot[];
  fields: PackField[];
  aspectId: string;
  defaultColor: string;
  outputs: PackOutput[];
  build: (input: PackInput) => Shot[];
};

/* ----------------------------------------------------------- helpers */

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => (k >= 0 ? c + (255 - c) * k : c * (1 + k)));
  return `#${ch.map((c) => clamp(c).toString(16).padStart(2, '0')).join('')}`;
}
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
const validHex = (c: string | undefined, fallback: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : fallback);

/** Soft brand-color background: light top, brand color, dark bottom. */
export function brandBackground(color: string): string {
  return encodeCustom({
    id: 'custom',
    label: 'Brand',
    angle: 160,
    stops: [
      { at: 0, color: shade(color, 0.22) },
      { at: 0.55, color },
      { at: 1, color: shade(color, -0.35) },
    ],
  });
}

function headline(text: string, color: string, patch: Partial<TextItem> = {}): TextItem {
  const dark = luminance(color) > 0.62;
  return {
    ...makeTextItem('text'),
    id: `pack-txt-${Math.random().toString(36).slice(2, 9)}`,
    text,
    x: 0.5,
    y: 0.09,
    size: 0.068,
    font: 'Inter',
    weight: 800,
    color: dark ? '#111111' : '#ffffff',
    shadow: dark ? 0 : 0.25,
    lineHeight: 1.1,
    start: 0,
    end: null,
    enter: 'fade',
    exit: 'fade',
    transitionDur: 0.35,
    ...patch,
  };
}

const track = (path: string, keys: [number, number][]): PropertyTrack => ({
  path,
  keyframes: keys.map(([t, value]) => ({ id: nextKeyframeId(), t, value, easingIn: 'easeInOut', easingOut: 'easeInOut' })),
});

const template = (id: string) => TEMPLATES.find((t) => t.id === id)!.apply;

/** Pack scene: media, screen name, template, and brand background. */
function sceneFrom(n: number, label: string, slot: string, m: PackMedia, color: string, templateId: string): Shot {
  const base = applyTemplateTo({ ...makeShot(n), id: nextShotId(), label }, template(templateId));
  return {
    ...base,
    media: m.url,
    mediaKind: m.kind,
    mediaName: m.name,
    screenName: slot,
    scene: { ...base.scene, backgroundId: brandBackground(color), bgImage: null },
  };
}

/* --------------------------------------------------------------- packs */

const FEATURE_LAUNCH: Pack = {
  id: 'feature-launch',
  title: 'Feature launch',
  tagline: 'A 10–20 s promo video: your main screen opens and closes it, each feature gets a scene and a caption.',
  slots: [
    { name: 'hero', label: 'Main screen', hint: 'Opens and closes the video', required: true },
    { name: 'feature-1', label: 'Feature 1', hint: 'Optional' },
    { name: 'feature-2', label: 'Feature 2', hint: 'Optional' },
    { name: 'feature-3', label: 'Feature 3', hint: 'Optional' },
  ],
  fields: [
    { id: 'feature-1', label: 'Caption for feature 1', placeholder: 'e.g. Plan in seconds', max: 32 },
    { id: 'feature-2', label: 'Caption for feature 2', placeholder: 'e.g. Share with your team', max: 32 },
    { id: 'feature-3', label: 'Caption for feature 3', placeholder: 'e.g. Works offline', max: 32 },
    { id: 'brand', label: 'Closing line', placeholder: 'Your app name', max: 40 },
  ],
  aspectId: 'fill',
  defaultColor: '#4f5bd5',
  outputs: [
    { label: 'Promo video, 16:9', where: 'Export → Video → MP4' },
    { label: 'Cover image', where: 'Move the playhead to the opening, then Export → Image' },
    { label: 'Vertical / square cuts', where: 'Export → Video → Export all ratios — check that captions clear the device' },
  ],
  build: (input) => {
    const color = validHex(input.color, '#4f5bd5');
    const hero = input.media.hero;
    if (!hero) return [];
    const features = ['feature-1', 'feature-2', 'feature-3']
      .map((slot) => ({ slot, m: input.media[slot] }))
      .filter((x): x is { slot: string; m: PackMedia } => !!x.m && x.m.kind === 'image');
    const shots = buildMagicReel({
      images: [hero, ...features.map((f) => f.m)].map((m) => ({ url: m.url, name: m.name })),
      captions: features.map((f) => input.texts[f.slot] ?? ''),
      brand: input.texts.brand ?? '',
    });
    // Screen names follow slot names: opening and closing use "hero", others follow in order.
    return shots.map((s, i) => ({
      ...s,
      screenName: i === 0 || i === shots.length - 1 ? 'hero' : features[i - 1].slot,
      scene: { ...s.scene, backgroundId: brandBackground(color) },
    }));
  },
};

const APP_STORE: Pack = {
  id: 'app-store',
  title: 'App Store set',
  tagline: 'Up to five store screenshots with a headline each, exported at every App Store and Google Play size in one ZIP.',
  slots: [1, 2, 3, 4, 5].map((n) => ({
    name: `screen-${n}`,
    label: `Screenshot ${n}`,
    hint: n === 1 ? 'The first one people see' : 'Optional',
    required: n === 1,
  })),
  fields: [1, 2, 3, 4, 5].map((n) => ({
    id: `screen-${n}`,
    label: `Headline ${n}`,
    placeholder: ['Track every habit', 'See your streaks', 'Gentle reminders', 'Works offline', 'Private by design'][n - 1],
    max: 40,
  })),
  aspectId: 'as-iphone',
  defaultColor: '#1f6feb',
  outputs: [
    { label: 'Store set (ZIP) — every scene at every App Store and Google Play size', where: 'Export → Image → Store set' },
    { label: 'One screenshot at a time', where: 'Pick a scene, then Export → Image' },
  ],
  build: (input) => {
    const color = validHex(input.color, '#1f6feb');
    let n = 0;
    return APP_STORE.slots
      .filter((s) => input.media[s.name])
      .map((s) => {
        n += 1;
        const shot = sceneFrom(n, `Screenshot ${n}`, s.name, input.media[s.name]!, color, 'store-shot');
        const text = (input.texts[s.name] ?? '').trim();
        return {
          ...shot,
          duration: 3,
          /*
            Leave title space by making the device smaller and lower. Positive
            panY lowers it; the original reversed sign overlapped the title.
            Compared zoom 2.2/2.1/2.0 and panY 0.5/0.7/0.85 side by side.
          */
          camera: { ...shot.camera, zoom: 2.1, panY: 0.72 },
          texts: text ? [headline(text, color, { enter: 'none', exit: 'none' })] : [],
        };
      });
  },
};

const PORTFOLIO: Pack = {
  id: 'portfolio',
  title: 'Portfolio showcase',
  tagline: 'Desktop and mobile shots for Dribbble, Behance or a case study — 4:3 images plus a short video.',
  slots: [
    { name: 'desktop', label: 'Desktop screen', hint: 'Shown on a laptop', required: true },
    { name: 'mobile', label: 'Mobile screen', hint: 'Optional — adds a phone scene and a duo shot' },
  ],
  fields: [
    { id: 'title', label: 'Project title', placeholder: 'e.g. Orbit — banking redesign', max: 48 },
    { id: 'subtitle', label: 'One-line description', placeholder: 'e.g. Web and iOS, 2026', max: 60 },
  ],
  aspectId: '4-3',
  defaultColor: '#e9e4dc',
  outputs: [
    { label: '4:3 images, one per scene (Dribbble 1600×1200)', where: 'Pick a scene, then Export → Image → 4:3' },
    { label: 'Case-study video', where: 'Export → Video → MP4' },
  ],
  build: (input) => {
    const color = validHex(input.color, '#e9e4dc');
    const desktop = input.media.desktop;
    if (!desktop) return [];
    const mobile = input.media.mobile;
    const title = (input.texts.title ?? '').trim();
    const subtitle = (input.texts.subtitle ?? '').trim();
    const shots: Shot[] = [];
    const hero = sceneFrom(1, 'Desktop', 'desktop', desktop, color, 'desk-setup');
    // Fit the laptop with title space (compared zoom 1.6/1.75/1.9 and panY 0.42/0.38/0.3).
    // Stop zooming at 1.96; more cropped the keyboard's front edge in a 4:3 still.
    shots.push({
      ...hero,
      duration: 4,
      camera: { ...hero.camera, zoom: 1.9, panY: 0.3 },
      tracks: [track('camera.tiltY', [[0, 26], [4, 12]]), track('camera.zoom', [[0, 1.9], [4, 1.96]])],
      texts: title ? [headline(title, color, { y: 0.1, size: 0.06 })] : [],
    });
    if (mobile) {
      const phone = sceneFrom(2, 'Mobile', 'mobile', mobile, color, 'store-shot');
      shots.push({
        ...phone,
        duration: 3.5,
        camera: { ...phone.camera, tiltX: -8, tiltY: -22, zoom: 2.15, panY: 0.6 },
        tracks: [track('camera.tiltY', [[0, -24], [3.5, -10]])],
        texts: subtitle ? [headline(subtitle, color, { y: 0.1, size: 0.05, weight: 600 })] : [],
      });
      // Pair: laptop in front, phone at front right, in primary-device width units.
      const duo = sceneFrom(3, 'Together', 'desktop', desktop, color, 'desk-setup');
      shots.push({
        ...duo,
        duration: 4,
        layoutId: 'pair',
        mainSlot: { x: -0.12, y: 0, z: 0, rotY: 6, scale: 1 },
        extras: [
          {
            id: `extra-pack-${Date.now().toString(36)}`,
            deviceId: 'phone',
            finishId: 'crystal',
            media: mobile.url,
            mediaKind: mobile.kind,
            mediaName: mobile.name,
            screenName: 'mobile',
            x: 0.46,
            y: -0.06,
            z: 0.32,
            rotY: -14,
            scale: 1,
          },
        ],
        camera: { ...duo.camera, zoom: 2.5 },
        tracks: [track('camera.tiltY', [[0, 18], [4, 6]])],
        texts: title ? [headline(title, color, { y: 0.1, size: 0.055 })] : [],
      });
    }
    return shots;
  },
};

export const PACKS: Pack[] = [FEATURE_LAUNCH, APP_STORE, PORTFOLIO];

export function getPack(id: string | null | undefined): Pack | null {
  return PACKS.find((p) => p.id === id) ?? null;
}

/** Suggest files for pack slots by name: `screen-2.png` → screen-2; `home.png` → first empty slot. */
export function suggestSlot(pack: Pack, fileName: string, taken: Set<string>): string | null {
  const key = screenKey(fileName.replace(/\.[a-z0-9]{1,5}$/i, ''));
  const exact = pack.slots.find((s) => screenKey(s.name) === key && !taken.has(s.name));
  if (exact) return exact.name;
  return pack.slots.find((s) => !taken.has(s.name))?.name ?? null;
}
