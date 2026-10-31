/**
 * LAUNCH FACTORY BUILDER: the user's screens and words → the scenes of a launch package (config/launch.ts).
 *
 * No generated claims: every line on an image is the app name, the value line or a feature the user typed.
 * Three directions share the same story and differ in look: Clear (light, straight, centred), Bold (brand
 * colour, angled, left-aligned), Quiet (pale tint, frameless card, small type). Each target has its own
 * composition; scenes are normal scenes and stay editable.
 *
 * Order: the five promo video scenes first (Magic Reel, 20 s), then one still scene per image output
 * (1 s each), so pressing play shows the promo.
 */

import { applyTemplateTo, makeShot, makeTextItem, nextShotId, type Shot, type TextItem } from '@/store/editor';
import { TEMPLATES } from '@/config/templates';
import { encodeCustom } from '@/config/backgrounds';
import { buildMagicReel } from '@/config/reel';
import { getLayout } from '@/config/layouts';
import { ensureFont } from '@/config/fonts';
import { screenKey, screenNameFromFile } from '@/config/screens';
import { getAspect } from '@/config/aspects';
import { launchOutputSpecs, LAUNCH_STORE_DESIGNS, type LaunchDirectionId, type LaunchOutput, type LaunchProject } from '@/config/launch';

export type LaunchScreen = { url: string; name: string };
export type LaunchInput = {
  /** 3–5 screenshots; the first is the main screen. */
  screens: LaunchScreen[];
  appName: string;
  /** One line on what the app does for people. */
  value: string;
  /** 3–5 features, one per line, in the user's words. */
  features: string[];
  color: string;
  /** Logo image URL (brand kit or file), optional. */
  logo: string | null;
  /** Font family (brand kit) or Inter. */
  font: string;
  /** Screens for the video's three feature scenes (indices into `screens`). */
  videoScreens: number[];
  direction: LaunchDirectionId;
};
export type LaunchBuild = {
  shots: Shot[];
  launch: LaunchProject;
  /** Outputs whose text had to be cut to fit: shown to the user before export. */
  overflow: string[];
};

export const LAUNCH_LIMITS = { screens: [3, 5], features: [3, 5], appName: 40, value: 60, feature: 100 } as const;

/* ------------------------------------------------------------- colour */

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => (k >= 0 ? c + (255 - c) * k : c * (1 + k)));
  return `#${ch.map((c) => clamp(c).toString(16).padStart(2, '0')).join('')}`;
}
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};
export const validHex = (c: string | undefined, fallback: string) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : fallback);

/* ---------------------------------------------------------- directions */

type Look = {
  background: string;
  ink: string;
  /** Eyebrow / small text colour. */
  accent: string;
  template: string;
  /** Device for Google Play scenes: no iPhone island there. */
  playDevice: string;
  align: 'center' | 'left';
  weight: number;
  /** Headline below the device instead of above it (store and portrait). */
  textBelow: boolean;
  /** Camera angle for stills: [tiltX, tiltY]. */
  angle: [number, number];
  /** Headline size multiplier. */
  scale: number;
};

export const LAUNCH_DIRECTIONS: { id: LaunchDirectionId; label: string; hint: string }[] = [
  { id: 'clear', label: 'Clear', hint: 'Light, straight, centred' },
  { id: 'bold', label: 'Bold', hint: 'Brand colour, angled, big type' },
  { id: 'quiet', label: 'Quiet', hint: 'Pale tint, frameless, small type' },
];

export function directionLook(direction: LaunchDirectionId, color: string): Look {
  if (direction === 'bold') {
    const light = luminance(color) > 0.62;
    return {
      background: encodeCustom({
        id: 'custom',
        label: 'Bold',
        angle: 160,
        stops: [
          { at: 0, color: shade(color, 0.18) },
          { at: 0.6, color },
          { at: 1, color: shade(color, -0.4) },
        ],
      }),
      ink: light ? '#111318' : '#ffffff',
      accent: light ? shade(color, -0.6) : shade(color, 0.75),
      template: 'store-shot',
      playDevice: 'android',
      align: 'left',
      weight: 800,
      textBelow: false,
      angle: [-8, -26],
      scale: 1.15,
    };
  }
  if (direction === 'quiet') {
    return {
      background: encodeCustom({
        id: 'custom',
        label: 'Quiet',
        angle: 180,
        stops: [
          { at: 0, color: shade(color, 0.93) },
          { at: 1, color: shade(color, 0.84) },
        ],
      }),
      ink: shade(color, -0.72),
      accent: shade(color, -0.35),
      template: 'flat-card',
      playDevice: 'flat',
      align: 'center',
      weight: 600,
      textBelow: true,
      angle: [0, 0],
      scale: 0.8,
    };
  }
  return {
    background: encodeCustom({
      id: 'custom',
      label: 'Clear',
      angle: 180,
      stops: [
        { at: 0, color: '#f7f8fa' },
        { at: 1, color: '#e7eaef' },
      ],
    }),
    ink: '#14161b',
    accent: luminance(color) > 0.7 ? shade(color, -0.55) : color,
    template: 'store-shot',
    playDevice: 'android',
    align: 'center',
    weight: 800,
    textBelow: false,
    angle: [0, 0],
    scale: 1,
  };
}

/* ---------------------------------------------------------------- text */

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(text: string, px: number, weight: number, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * px * 0.55;
  measureCtx.font = `${weight} ${px}px "${font}", sans-serif`;
  return measureCtx.measureText(text).width;
}

/** Greedy word wrap at `maxW` px; a word longer than a line is split by characters. */
function wrap(text: string, px: number, weight: number, font: string, maxW: number): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (measure(next, px, weight, font) <= maxW) {
      cur = next;
      continue;
    }
    if (cur) lines.push(cur);
    cur = word;
    while (measure(cur, px, weight, font) > maxW && cur.length > 1) {
      let cut = cur.length - 1;
      while (cut > 1 && measure(cur.slice(0, cut), px, weight, font) > maxW) cut--;
      lines.push(cur.slice(0, cut));
      cur = cur.slice(cut);
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Fit a line into `maxLines` lines of `widthFrac` of the frame: wrap, then shrink down to `minSize`.
 * Sizes are fractions of the short edge, as the renderer draws them (components/scene/overlay.ts).
 */
function fit(text: string, size: number, minSize: number, weight: number, font: string, aspect: number, widthFrac: number, maxLines = 2) {
  // Measure on a 1000 px short edge; everything is relative, so any output size gives the same layout.
  const W = aspect >= 1 ? 1000 * aspect : 1000;
  const unit = Math.min(W, aspect >= 1 ? 1000 : 1000 / aspect);
  let s = size;
  for (;;) {
    const lines = wrap(text, s * unit, weight, font, W * widthFrac);
    if (lines.length <= maxLines) return { text: lines.join('\n'), size: s, ok: true };
    if (s * 0.92 < minSize) return { text: lines.slice(0, maxLines - 1).concat(lines.slice(maxLines - 1).join(' ')).join('\n'), size: s, ok: false };
    s *= 0.92;
  }
}

let txtSeq = 0;
function textItem(patch: Partial<TextItem>): TextItem {
  txtSeq += 1;
  return {
    ...makeTextItem('text'),
    id: `lf-txt-${Date.now().toString(36)}-${txtSeq}`,
    font: 'Inter',
    lineHeight: 1.12,
    shadow: 0,
    start: 0,
    end: null,
    enter: 'none',
    exit: 'none',
    transitionDur: 0.3,
    ...patch,
  };
}

/* -------------------------------------------------------------- scenes */

const template = (id: string) => TEMPLATES.find((t) => t.id === id)!.apply;

type Plan = {
  screens: number[];
  /** Headline and optional eyebrow (small line above). */
  headline: string;
  eyebrow?: string;
};

/**
 * The six store designs: an opening (value line, app name above), one per feature on its screen, then
 * — with fewer than five features — two-screen and three-screen designs with the app name and the value
 * line. Nothing is invented; with fewer screens than designs, screens repeat with another feature.
 */
export function storePlans(input: Pick<LaunchInput, 'screens' | 'appName' | 'value' | 'features'>): Plan[] {
  const nS = input.screens.length;
  const plans: Plan[] = [{ screens: [0], headline: input.value, eyebrow: input.appName }];
  input.features.forEach((f, i) => {
    if (plans.length < LAUNCH_STORE_DESIGNS) plans.push({ screens: [(i + 1) % nS], headline: f });
  });
  if (plans.length < LAUNCH_STORE_DESIGNS) plans.push({ screens: [1 % nS, 2 % nS], headline: input.appName });
  if (plans.length < LAUNCH_STORE_DESIGNS) plans.push({ screens: [0, 1 % nS, 2 % nS], headline: input.value });
  return plans.slice(0, LAUNCH_STORE_DESIGNS);
}

type Ctx = { input: LaunchInput; look: Look; names: string[]; overflow: string[]; n: number };

function deviceScene(c: Ctx, label: string, screenIdx: number[], aspectId: string, opts: { deviceId?: string; finishId?: string; templateId?: string; layoutId?: string }): Shot {
  c.n += 1;
  const base = applyTemplateTo({ ...makeShot(c.n), id: nextShotId(), label }, template(opts.templateId ?? c.look.template));
  let deviceId = opts.deviceId ?? base.deviceId;
  let finishId = opts.finishId ?? base.finishId;
  // A flat card takes its own image's ratio; extra cards stay 16:10, so several screens go on light phones.
  if (deviceId === 'flat' && screenIdx.length > 1) {
    deviceId = 'phone';
    finishId = 'white';
  }
  const main = c.input.screens[screenIdx[0]];
  const layout = getLayout(opts.layoutId ?? (screenIdx.length === 3 ? 'trio' : screenIdx.length === 2 ? 'pair' : 'single'));
  return {
    ...base,
    deviceId,
    finishId,
    media: main.url,
    mediaKind: 'image',
    mediaName: main.name,
    screenName: c.names[screenIdx[0]],
    scene: { ...base.scene, backgroundId: c.look.background, bgImage: null },
    statusBar: { ...base.statusBar, on: false },
    duration: 1,
    tracks: [],
    transition: { kind: 'cut', duration: 0 },
    aspectId,
    layoutId: layout.id,
    mainSlot: { ...layout.main },
    extras: layout.slots.slice(0, screenIdx.length - 1).map((slot, i) => {
      const m = c.input.screens[screenIdx[i + 1]];
      return {
        id: `extra-lf-${c.n}-${i}`,
        deviceId,
        finishId,
        media: m.url,
        mediaKind: 'image' as const,
        mediaName: m.name,
        screenName: c.names[screenIdx[i + 1]],
        ...slot,
      };
    }),
  };
}

/** Headline (+ eyebrow) placed for a target; flags the output when the words do not fit. */
function words(c: Ctx, output: string, aspectId: string, p: { headline: string; eyebrow?: string; x: number; y: number; size: number; widthFrac: number; align: 'left' | 'center'; lines?: number }): TextItem[] {
  const { look, input } = c;
  const aspect = getAspect(aspectId).ratio ?? 1;
  const out: TextItem[] = [];
  const size = p.size * look.scale;
  const h = fit(p.headline, size, size * 0.62, look.weight, input.font, aspect, p.widthFrac, p.lines ?? 2);
  if (!h.ok) c.overflow.push(output);
  const lineCount = h.text.split('\n').length;
  // The renderer centres a block on y; keep its top edge where the layout puts it.
  const unitFrac = aspect >= 1 ? 1 : aspect; // short edge as a fraction of the height
  const blockH = lineCount * h.size * 1.12 * unitFrac;
  const y = p.y + blockH / 2;
  if (p.eyebrow) {
    const e = fit(p.eyebrow, size * 0.42, size * 0.3, 600, input.font, aspect, p.widthFrac, 1);
    if (!e.ok) c.overflow.push(output);
    out.push(textItem({ text: e.text, x: p.x, y: p.y - e.size * 1.5 * unitFrac, size: e.size, weight: 600, tracking: 0.04, color: look.accent, align: p.align, font: input.font }));
  }
  out.push(textItem({ text: h.text, x: p.x, y, size: h.size, weight: look.weight, color: look.ink, align: p.align, font: input.font }));
  return out;
}

function logoItem(c: Ctx, x: number, y: number, size: number): TextItem[] {
  if (!c.input.logo) return [];
  return [{ ...makeTextItem('logo'), id: `lf-logo-${c.n}`, src: c.input.logo, x, y, size, start: 0, end: null, enter: 'none', exit: 'none' }];
}

/** Still scene of one store design, iPhone or Google Play. */
function storeScene(c: Ctx, plan: Plan, i: number, target: 'app-store' | 'google-play', output: string): Shot {
  const ios = target === 'app-store';
  const aspectId = ios ? 'as-iphone' : 'gp-phone';
  const quiet = c.look.textBelow;
  const shot = deviceScene(c, `${ios ? 'App Store' : 'Google Play'} ${String(i + 1).padStart(2, '0')}`, plan.screens, aspectId, ios ? {} : { deviceId: c.look.playDevice });
  const multi = plan.screens.length > 1;
  const [tx, ty] = c.look.angle;
  // Leave the headline band (top, or bottom for Quiet) free: smaller device, moved away from it.
  const zoom = multi ? (ios ? 1.55 : 1.45) : ios ? 2.1 : 2.0;
  const panY = quiet ? (ios ? -0.5 : -0.42) : ios ? 0.72 : 0.6;
  const left = c.look.align === 'left';
  const headY = quiet ? (ios ? 0.84 : 0.82) : plan.eyebrow ? 0.085 : 0.055;
  return {
    ...shot,
    camera: { ...shot.camera, tiltX: tx, tiltY: multi ? 0 : ty, zoom, panX: 0, panY },
    texts: [
      ...words(c, output, aspectId, {
        headline: plan.headline,
        eyebrow: plan.eyebrow,
        x: left ? 0.08 : 0.5,
        y: headY,
        size: quiet ? 0.058 : 0.072,
        widthFrac: 0.84,
        align: left ? 'left' : 'center',
      }),
    ],
  };
}

/* --------------------------------------------------------------- build */

/** Unique screen names from file names, for "Update screens". */
function screenNames(screens: LaunchScreen[]): string[] {
  const used = new Set<string>();
  return screens.map((s, i) => {
    let name = screenNameFromFile(s.name) ?? `screen-${i + 1}`;
    if (used.has(screenKey(name))) name = `${name}-${i + 1}`;
    used.add(screenKey(name));
    return name;
  });
}

export function validateLaunchInput(input: LaunchInput): string | null {
  const [sMin, sMax] = LAUNCH_LIMITS.screens;
  const [fMin, fMax] = LAUNCH_LIMITS.features;
  if (input.screens.length < sMin || input.screens.length > sMax) return `Add ${sMin}–${sMax} screenshots`;
  if (!input.appName.trim()) return 'Add the app name';
  if (!input.value.trim()) return 'Add a one-line value';
  const f = input.features.map((x) => x.trim()).filter(Boolean);
  if (f.length < fMin || f.length > fMax) return `Add ${fMin}–${fMax} features`;
  return null;
}

/** Build every scene and the launch record. Waits for the font so text is measured as it will render. */
export async function buildLaunchPackage(raw: LaunchInput): Promise<LaunchBuild | null> {
  const input: LaunchInput = {
    ...raw,
    appName: raw.appName.trim().slice(0, LAUNCH_LIMITS.appName),
    value: raw.value.trim().slice(0, LAUNCH_LIMITS.value),
    features: raw.features.map((f) => f.trim().slice(0, LAUNCH_LIMITS.feature)).filter(Boolean),
    color: validHex(raw.color, '#4f5bd5'),
  };
  if (validateLaunchInput(input)) return null;
  try {
    await ensureFont(input.font);
    await Promise.all([400, 600, 800].map((w) => document.fonts.load(`${w} 40px "${input.font}"`)));
  } catch {
    // A missing font only changes the measured widths slightly; the renderer falls back the same way.
  }
  const c: Ctx = { input, look: directionLook(input.direction, input.color), names: screenNames(input.screens), overflow: [], n: 0 };
  const nS = input.screens.length;

  // Promo video: Magic Reel (main screen opens and closes; three feature scenes).
  const vIdx = (input.videoScreens.length === 3 ? input.videoScreens : [1, 2, 3]).map((i) => ((i % nS) + nS) % nS);
  const reel = buildMagicReel({
    images: [0, ...vIdx].map((i) => input.screens[i]),
    captions: input.features.slice(0, 3),
    brand: input.appName,
  }).map((s, i, all) => ({
    ...s,
    aspectId: '16-9',
    screenName: c.names[i === 0 || i === all.length - 1 ? 0 : vIdx[i - 1]],
    scene: { ...s.scene, backgroundId: c.look.background, bgImage: null },
    texts: s.texts.map((t) => ({ ...t, color: c.look.ink, shadow: 0, font: input.font })),
  }));
  c.n = reel.length;

  const specs = launchOutputSpecs();
  const bind = new Map<string, string[]>([['video', reel.map((s) => s.id)]]);
  const stills: Shot[] = [];
  const plans = storePlans(input);
  plans.forEach((plan, i) => {
    const id = `app-store-${String(i + 1).padStart(2, '0')}`;
    const s = storeScene(c, plan, i, 'app-store', id);
    stills.push(s);
    bind.set(id, [s.id]);
  });
  plans.forEach((plan, i) => {
    const id = `google-play-${String(i + 1).padStart(2, '0')}`;
    const s = storeScene(c, plan, i, 'google-play', id);
    stills.push(s);
    bind.set(id, [s.id]);
  });

  const left = c.look.align === 'left';
  const [tx, ty] = c.look.angle;

  // Feature graphic 1024×500: words on the left, two screens on the right.
  {
    const s = deviceScene(c, 'Feature graphic', [0, 1 % nS], 'gp-feature', { deviceId: c.look.playDevice });
    stills.push({
      ...s,
      camera: { ...s.camera, tiltX: tx, tiltY: ty || -10, zoom: 1.7, panX: -0.7, panY: 0.05 },
      texts: [...logoItem(c, 0.12, 0.2, 0.09), ...words(c, 'feature-graphic', 'gp-feature', { headline: input.value, eyebrow: input.appName, x: 0.07, y: 0.4, size: 0.085, widthFrac: 0.38, align: 'left' })],
    });
    bind.set('feature-graphic', [s.id]);
  }
  // Square: the first feature as a hook over the main screen, app name small at the bottom.
  {
    const s = deviceScene(c, 'Social square', [0], '1-1', {});
    stills.push({
      ...s,
      camera: { ...s.camera, tiltX: tx, tiltY: ty, zoom: 2.05, panY: 0.42 },
      texts: [
        ...words(c, 'social-square', '1-1', { headline: input.features[0], x: left ? 0.08 : 0.5, y: 0.06, size: 0.062, widthFrac: 0.84, align: left ? 'left' : 'center' }),
      ],
    });
    bind.set('social-square', [s.id]);
  }
  // Portrait 4:5: hook on top, main and second screen together.
  {
    const s = deviceScene(c, 'Social portrait', [0, 1 % nS], '4-5', {});
    stills.push({
      ...s,
      camera: { ...s.camera, tiltX: tx, tiltY: 0, zoom: 1.75, panY: 0.38 },
      texts: words(c, 'social-portrait', '4-5', { headline: input.features[0], eyebrow: input.appName, x: left ? 0.08 : 0.5, y: 0.075, size: 0.066, widthFrac: 0.84, align: left ? 'left' : 'center' }),
    });
    bind.set('social-portrait', [s.id]);
  }
  // Landscape / cover 16:9: name and value on the left, two screens on the right.
  {
    const s = deviceScene(c, 'Social landscape', [0, 1 % nS], '16-9', {});
    stills.push({
      ...s,
      camera: { ...s.camera, tiltX: tx, tiltY: ty || -10, zoom: 1.75, panX: -0.72, panY: 0.05 },
      texts: [...logoItem(c, 0.1, 0.18, 0.08), ...words(c, 'social-landscape', '16-9', { headline: input.value, eyebrow: input.appName, x: 0.07, y: 0.4, size: 0.08, widthFrac: 0.38, align: 'left' })],
    });
    bind.set('social-landscape', [s.id]);
  }

  const outputs: LaunchOutput[] = specs.map((spec) => ({ ...spec, shotIds: bind.get(spec.id) ?? [] }));
  return {
    shots: [...reel, ...stills],
    launch: { v: 1, direction: input.direction, outputs },
    overflow: [...new Set(c.overflow)],
  };
}
