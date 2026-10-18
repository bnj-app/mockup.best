'use client';

import { create } from 'zustand';
import { CAMERA_DEFAULT, MOTION_PRESETS, sampleMotion, type CameraState, type Keyframe } from '@/config/motion';
import { DEFAULT_DEVICE, getDevice } from '@/config/devices';
import { DEFAULT_BACKGROUND, getBackground, isDarkBackground } from '@/config/backgrounds';
import { getLayout } from '@/config/layouts';
import { getBrandKit, type BrandKit } from '@/config/brandKit';
import type { TemplatePatch } from '@/config/templates';
import { FREE_CAPTURES, FREE_FOR_ALL } from '@/config/brand';
import { screenKey, screenNameFromFile } from '@/config/screens';
import type { RedactRect } from '@/config/redact';
import {
  type Bezier,
  type EasingId,
  type PropertyTrack,
  evaluateTrack,
  getByPath,
  isSlotPath,
  keyframeAt,
  makeKeyframe,
  mirrorKeyframes,
  mirrorSegment,
  nextKeyframeId,
  setByPath,
} from '@/config/tracks';

/*
  Keep localStorage keys at the top. Pitfall: these constants used to be below `create(...)`, which
  initializes state and calls readers during module loading. `const` is not hoisted: a TDZ
  ReferenceError was swallowed by try/catch, making every launch look unsaved and restoring all 3
  captures on refresh.
*/
const CAPTURES_KEY = 'mockuptop:captures:v1';
const PRO_KEY = 'mockuptop:pro:v1';
/*
  Persist the theme preference. Previously it lived only in the store, so refreshing or visiting
  PHOTO and returning reset dark mode to light because mode switches navigate the whole page.
*/
const THEME_KEY = 'mockuptop:theme:v1';
/*
  Owner key removed. A hardcoded string formerly enabled Pro permanently via `?unlock=<string>`.
  Static export exposed it verbatim in the client bundle, where anyone could find it. Client secrets
  cannot be secured. Enabling is now localhost-only, where debug already supports it; production
  `?unlock` only disables Pro.
*/

export type Theme = 'light' | 'dark';
/** 'lens': depth-based depth of field with autofocus. */
export type BlurMode = 'off' | 'radial' | 'linear' | 'lens';
export type BorderStyle = 'none' | 'glass' | 'solid';

/**
 * On-screen text item. `text` is fixed; `ticker` scrolls right to left. One type shares font,
 * color, border, and shadow settings without duplicating them.
 */
export type TextItem = {
  id: string;
  /**
   * `logo` shares position, size, rotation, opacity, and timing with text. A separate type would
   * duplicate these fields and their maintenance.
   */
  kind: 'text' | 'ticker' | 'logo';
  text: string;
  visible: boolean;
  /** Frame-relative position (0–1), consistent across resolutions. */
  x: number;
  y: number;
  /** Font size relative to the shorter edge. */
  size: number;
  font: string;
  weight: number;
  color: string;
  opacity: number;
  align: 'left' | 'center' | 'right';
  rotation: number;
  lineHeight: number;
  /** Letter spacing as a fraction of font size. */
  tracking: number;
  strokeWidth: number;
  strokeColor: string;
  shadow: number;
  /** Ticker only: band background and scrolling speed. */
  bandColor: string;
  bandOpacity: number;
  bandRadius: number;
  /** Frame widths traveled per second. */
  speed: number;
  /** `logo` only: image source (object/data URL). */
  src: string | null;
  /*
    Time window: text is visible only during its own timeline interval. Time is scene-local; `end:
    null` means through the scene's end.
  */
  start: number;
  end: number | null;
  /** Entrance/exit animation and duration (seconds). */
  enter: TextAnim;
  exit: TextAnim;
  transitionDur: number;
  /**
   * Layer: 'front' is in front of the frame (default); 'behind' is behind the device, for large
   * headlines with devices in front. Older saves without this field use 'front'.
   */
  layer?: 'front' | 'behind';
  /**
   * Localization: language code → text. `text` holds the base language. Empty/missing translations
   * fall back to it so the frame never loses its text.
   */
  i18n?: Record<string, string>;
};

/** Language code: "tr", "de", "pt-BR", "zh-Hans". Lowercase primary subtag plus optional region/script. */
export function normalizeLangCode(raw: string): string | null {
  const m = /^\s*([A-Za-z]{2,3})(?:[-_]([A-Za-z0-9]{2,4}))?\s*$/.exec(raw);
  if (!m) return null;
  const sub = m[2] ? (m[2].length === 2 ? m[2].toUpperCase() : m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()) : '';
  return m[1].toLowerCase() + (sub ? `-${sub}` : '');
}

/** Text in the requested language, falling back to the base text. */
export function textIn(item: { text: string; i18n?: Record<string, string> }, lang: string | null): string {
  if (!lang) return item.text;
  const t = item.i18n?.[lang];
  return t && t.trim() ? t : item.text;
}

/**
 * Text entrance/exit animations, including word-based words/knock/cycle variants.
 */
export type TextAnim =
  | 'none'
  | 'fade'
  | 'rise'
  | 'words-left'
  | 'words-right'
  | 'knock-left'
  | 'knock-right'
  | 'cycle'
  /** Typewriter (types on entrance, erases on exit) and counter (numbers count up from 0). */
  | 'type'
  | 'count';

/*
  ID counter. `Date.now()` alone collides when two items are added in one millisecond: `patchText`
  changes both and the text overlaps.
*/
let textSeq = 0;

export function makeTextItem(kind: 'text' | 'ticker' | 'logo'): TextItem {
  textSeq += 1;
  return {
    id: `txt-${Date.now().toString(36)}-${textSeq}`,
    kind,
    text:
      kind === 'ticker'
        ? 'Your scrolling headline goes here'
        : kind === 'logo'
          ? 'Logo'
          : 'Your text',
    visible: true,
    x: 0.5,
    y: kind === 'ticker' ? 0.88 : 0.18,
    size: kind === 'ticker' ? 0.045 : kind === 'logo' ? 0.16 : 0.09,
    font: kind === 'ticker' ? 'Space Grotesk' : 'Anton',
    weight: 700,
    color: '#ffffff',
    opacity: 1,
    align: 'center',
    rotation: 0,
    lineHeight: 1.15,
    tracking: 0,
    strokeWidth: 0,
    strokeColor: '#000000',
    shadow: 0.35,
    bandColor: '#000000',
    bandOpacity: kind === 'ticker' ? 0.55 : 0,
    bandRadius: 0,
    speed: 0.12,
    src: null,
    start: 0,
    end: null,
    // Default fade: abrupt entrances look rough, while text without
    // animation can appear not to have been added.
    enter: 'fade',
    exit: 'fade',
    transitionDur: 0.4,
  };
}

/**
 * Screen annotations: tap ripple, ring, spotlight, cursor. Attached to the device screen, rotating
 * with it rather than the frame-relative text layer. Positions use screen coordinates (the glass),
 * not content moved by `crop.scroll`, like a real finger tap. Animation is built into each kind (no
 * track); timing follows the text window contract.
 */
export type AnnotationKind = 'tap' | 'ring' | 'spotlight' | 'cursor';

/**
 * Per-device animation uses ordinary tracks (`mainSlot.y`, `extras.<id>.scale` …) so reverse, loop,
 * split, beat snapping, and curve editing work. The recipe only remembers `composeDeviceMotion`
 * settings for the panel. Tracks are authoritative: manual keyframe edits make the recipe stale;
 * recomposing overwrites tracks.
 */
export type DeviceMotionKind = 'none' | 'drop' | 'rise' | 'slide' | 'spin' | 'pop';
export type DeviceMotionRecipe = {
  kind: DeviceMotionKind;
  /** Delay between devices (seconds) and entrance duration per device (seconds). */
  stagger: number;
  duration: number;
  /** Entrance order: left to right, right to left, center outward. */
  order: 'ltr' | 'rtl' | 'center';
  /** Exit with the same motion at the end of the scene. */
  exit: boolean;
  /** Per-device kind ('main' or extra device ID); falls back to `kind`. */
  per: Record<string, DeviceMotionKind>;
};

export const DEVICE_MOTION_DEFAULT: DeviceMotionRecipe = {
  kind: 'none',
  stagger: 0.15,
  duration: 0.7,
  order: 'ltr',
  exit: false,
  per: {},
};

export type Annotation = {
  id: string;
  kind: AnnotationKind;
  /** Screen-relative position (0–1), with (0, 0) at the top left. */
  x: number;
  y: number;
  /** Radius relative to the screen's shorter edge (half the arrow length for cursors). */
  size: number;
  /** Spotlight dimming color. */
  color: string;
  /** Scene-local seconds; `end: null` means through the scene's end. */
  start: number;
  end: number | null;
};

let annotSeq = 0;

/** Defaults per kind. Taps start with a single-pulse time window. */
export function makeAnnotation(kind: AnnotationKind, start = 0): Annotation {
  annotSeq += 1;
  return {
    id: `ann-${Date.now().toString(36)}-${annotSeq}`,
    kind,
    x: 0.5,
    y: 0.5,
    size: kind === 'spotlight' ? 0.26 : kind === 'ring' ? 0.17 : kind === 'cursor' ? 0.05 : 0.08,
    color: kind === 'spotlight' ? '#000000' : kind === 'ring' ? '#ff3b30' : '#ffffff',
    start,
    end: kind === 'tap' ? Math.round((start + 0.8) * 100) / 100 : null,
  };
}

/*
  Scene ID counter. `shots.length + 1` reused IDs after deletion ("shot-2" collision), making
  patchShot update both scenes and React keys collide.
*/
let shotSeq = 0;

/** Scene copy/paste clipboard: tab-local, separate from the OS clipboard. */
let shotClipboard: Shot | null = null;

/** Keyframe clipboard: offsets are relative to the group's start. */
let kfClipboard: {
  path: string;
  offset: number;
  value: number;
  easingIn: EasingId;
  easingOut: EasingId;
}[] = [];

export function nextShotId(): string {
  shotSeq += 1;
  return `shot-${Date.now().toString(36)}-${shotSeq}`;
}

/** Audio track attached to the sequence. */
/** One file in a bulk screen update: object URL + kind + filename. */
export type ScreenMedia = { url: string; kind: 'image' | 'video'; name: string; redactions?: RedactRect[] };

export type AudioTrack = {
  id: string;
  name: string;
  /** Object URL or data URL. Excluded from autosave due to quota limits. */
  url: string | null;
  /** Start time on the timeline (seconds). */
  start: number;
  volume: number;
  /** File duration, measured on load; determines strip width. */
  duration: number;
};

/** A "shot" is one frame/scene. The timeline arranges them consecutively. */
export type Shot = {
  id: string;
  label: string;
  duration: number;
  /**
   * Gap before this scene (seconds). Allows spacing between scenes previously placed end to end.
   * The scene is hidden during the gap, leaving the background visible and providing breathing room
   * when editing to music.
   */
  gapBefore: number;
  /** Source media object URL. */
  media: string | null;
  /** Image or video: determines how the scene creates its texture. */
  mediaKind: 'image' | 'video';
  /**
   * Media filename. Autosave cannot retain the media itself (data URLs exceed quota; object URLs
   * expire when the tab closes), but can keep the name to identify missing files after refresh
   * instead of showing an unexplained empty scene.
   */
  mediaName: string | null;
  /**
   * Screen name (`home`, `checkout`…; see config/screens.ts). "Update screens" replaces all scenes
   * sharing a name at once. Defaults to the filename; editable in Source.
   */
  screenName: string | null;
  /**
   * Redactions baked into the image (config/redact.ts). Media is already sanitized; this list
   * reapplies the same areas during "Update screens" and permits further edits in this tab.
   */
  redactions?: RedactRect[];
  /** Video speed 0.5×–4×; maximum raised from 2× to 4× (`VIDEO_RATE`). */
  playbackRate: number;
  /** Used interval in the source video (seconds). */
  trim: { in: number; out: number | null };
  /**
   * Top/bottom source-image crop (0–0.3), allowing users to replace their phone's status bar with
   * ours. `scroll` (0–1, animatable) selects the visible slice if the image is taller than the
   * screen: 0 = cropped top, 1 = bottom. No effect if it fits. Default 0 preserves the previous top
   * alignment.
   */
  crop: { top: number; bottom: number; scroll: number };
  deviceId: string;
  finishId: string;
  /**
   * Per-scene device settings, including the notch. One object avoids branching the schema for each
   * new option and lets `normalizeShot` supply defaults centrally.
   */
  deviceOpts: {
    /** iPhone: whether to show Dynamic Island. */
    notch: boolean;
    /** MacBook: lid angle (degrees). 0 = upright; larger values tilt backward. */
    lidAngle: number;
    /** Apple Watch: band color. */
    bandColor: string;
    /**
     * FLAT card thickness ("Depth", formerly Extrude). Gives a flat card physical depth; 0 =
     * paper-thin.
     */
    depth: number;
    /**
     * Screen background, separate from the scene background. This layer beneath the screen fills
     * gaps in transparent PNGs or images that do not fill the screen.
     */
    screenBg: string | null;
    /** iPad: Magic Keyboard-style base. */
    keyboard: boolean;
    /**
     * Media size: how much of the screen the image fills (1 = full, 0.5 = half); remaining space
     * shows the screen background.
     */
    mediaSize: number;
    /** Phone/tablet landscape: rotate the device while keeping the image upright and fitting the new shape. */
    landscape: boolean;
    /**
     * Laptop/monitor screen UI: menu bar, Dock, and browser window with an editable address.
     * Generic icons without logos.
     */
    screenUi: { menuBar: boolean; dock: boolean; browser: boolean; address: string };
  };
  camera: CameraState;
  /**
   * Motion preset assigned to this shot. Playback moves the camera through it; `null` keeps the
   * shot still.
   */
  motionId: string | null;
  /** Transition applied when entering this scene. */
  transition: { kind: 'cut' | 'fade' | 'slide'; duration: number };
  /**
   * Extra devices around the main device (`deviceId`). Offsets use the main device's width to
   * preserve proportions when combining phones and laptops.
   */
  extras: {
    id: string;
    deviceId: string;
    finishId: string;
    media: string | null;
    mediaKind: 'image' | 'video';
    /** This screen's filename / screen name, with the same meaning as on the main scene. */
    mediaName?: string | null;
    screenName?: string | null;
    redactions?: RedactRect[];
    x: number;
    y: number;
    z: number;
    rotY: number;
    scale: number;
  }[];
  /**
   * Added effects in application order; `on` controls the eye icon. An array preserves the user's
   * panel ordering.
   */
  effects: { id: string; value: number; on: boolean }[];
  /** On-screen text and ticker bands. */
  texts: TextItem[];
  /** Annotations attached to the device screen (tap, ring, spotlight, cursor). */
  annotations: Annotation[];
  /** Last per-device motion recipe (panel memory only; animation lives in tracks). */
  deviceMotion?: DeviceMotionRecipe;
  /**
   * Auto-motion ruler markers: arrival (`t`) and departure (`end`, after the brief hold) for each
   * focus area. Auto-motion writes them; click a numbered marker to seek, or drag to align arrival
   * keyframes with music/beats. Camera keyframes are authoritative: hide markers whose arrival
   * keyframe was manually removed.
   */
  focusMarks?: { t: number; end: number }[];
  /**
   * Property tracks are the single source of truth for animation. Each animates one property
   * ('camera.fov') over time.
   */
  tracks: PropertyTrack[];
  /**
   * Legacy model for migration only. `normalizeShot` converts camera keyframes from older
   * files/autosaves into tracks, then clears this field. New code never writes here.
   */
  keyframes: Keyframe[];
  /** Camera fields with keyframes, used to color panel diamonds. */
  keyframed: Partial<Record<keyof CameraState, boolean>>;
  blur: {
    mode: BlurMode;
    strength: number;
    focusSize: number;
    falloff: number;
    bokeh: boolean;
    fx: number;
    fy: number;
    /** Focus band angle in linear mode. */
    angle: number;
  };
  scene: {
    backgroundId: string;
    /** Custom background image (object URL). Takes precedence over the gradient when set. */
    bgImage: string | null;
    bgBlur: number;
    transparent: boolean;
    /** Studio preset for reflections. */
    envId: string;
    /** 3D scene (floor): 'none' | 'sweep' | 'concrete'. */
    stage3d?: 'none' | 'sweep' | 'concrete';
  };
  /** Status bar overlaid on the screen. */
  statusBar: { on: boolean; time: string; dark: boolean; battery: number };
  /**
   * Per-scene layout. Previously global, it leaked between scenes: choosing Pair in scene 2 also
   * moved scene 1's main device.
   */
  layoutId: string;
  mainSlot: { x: number; y: number; z: number; rotY: number; scale: number };
  border: { radius: number; style: BorderStyle; width: number };
  light: {
    rotation: number;
    key: number;
    keyHeight: number;
    contactShadow: boolean;
    /** Horizontal environment-map rotation: selects the reflection direction. */
    envRotation: number;
    /** Environment intensity: reflection strength on glass and metal. */
    envIntensity: number;
    /** Vertical environment tilt (degrees): moves light up/down (Light rotation X). */
    envTilt: number;
    /** Lift the device above the floor, separating it from its shadow. */
    lift: number;
    /** Floor reflection (0 = off). */
    reflection: number;
    /**
     * Screen light (0 = off). Screen color illuminates the scene through a colored pool in the
     * environment map and one point light in front of the screen. Color is sampled from media or
     * `screenBg` without media. Visible in dark environments ("Screen-lit" preset). Default 0
     * preserves existing rendering.
     */
    screenGlow: number;
    /** Shadow softness, darkness, and distance from the device. */
    shadowBlur: number;
    shadowOpacity: number;
    shadowOffset: number;
  };
};

/*
  Video speed limit raised from 2× to 4× to fit slow parts of long recordings into App Store's
  30-second previews. Export seeks `currentTime` per frame, independent of speed; browsers may mute
  preview audio at 4× (video audio is already excluded from export).
*/
export const VIDEO_RATE = { min: 0.5, max: 4 } as const;
export const clampVideoRate = (r: number) => Math.min(VIDEO_RATE.max, Math.max(VIDEO_RATE.min, r));

/**
 * Apply a template to a scene (pure). Shared by `applyTemplate` and templateThumbs previews with
 * user media so previews exactly match the result of clicking a template.
 */
export function applyTemplateTo(x: Shot, patch: TemplatePatch): Shot {
  return {
    ...x,
    ...patch,
    // Merge nested fields: templates specify only changes;
    // remaining values come from the current scene.
    light: { ...x.light, ...patch.light },
    /*
      Clear the background image when a template selects a background: images override gradients and
      otherwise hide the template background. The opening demo's `/demo/stage.jpg` caused every
      template to retain its background. Ctrl+Z restores it.
    */
    scene: {
      ...x.scene,
      ...(patch.scene?.backgroundId && patch.scene.bgImage === undefined ? { bgImage: null } : null),
      ...patch.scene,
    },
    blur: { ...x.blur, ...patch.blur },
    statusBar: { ...x.statusBar, ...patch.statusBar },
    // Preserve uploaded media and saved keyframes:
    // templates set up the scene without discarding user work.
    media: x.media,
    mediaKind: x.mediaKind,
    keyframes: x.keyframes,
    keyframed: x.keyframed,
    texts: x.texts,
    annotations: x.annotations,
    id: x.id,
    label: x.label,
  };
}

/** All defaults for a new scene; also used for migration. */
export function makeShot(index: number): Shot {
  return {
    id: `shot-${index}`,
    label: `Shot ${index}`,
    duration: 3,
    gapBefore: 0,
    media: null,
    mediaKind: 'image',
    mediaName: null,
    screenName: null,
    playbackRate: 1,
    trim: { in: 0, out: null },
    crop: { top: 0, bottom: 0, scroll: 0 },
    deviceId: DEFAULT_DEVICE,
    // Notch on by default: present on the real device; hiding it is an explicit choice.
    deviceOpts: {
      notch: true,
      lidAngle: 9,
      bandColor: '#2b2e34',
      depth: 0.12,
      screenBg: null,
      keyboard: false,
      mediaSize: 1,
      landscape: false,
      screenUi: { menuBar: false, dock: false, browser: false, address: 'yourapp.com' },
    },
    // Default to the device's first finish; hardcoded 'white' silently fell back
    // to the first material on devices without that finish.
    finishId: getDevice(DEFAULT_DEVICE).finishes[0].id,
    camera: { ...CAMERA_DEFAULT },
    motionId: null,
    transition: { kind: 'cut', duration: 0.4 },
    extras: [],
    effects: [],
    texts: [],
    annotations: [],
    tracks: [],
    keyframes: [],
    keyframed: {},
    // Off by default: a blurred opening scene can look broken.
    blur: {
      mode: 'off',
      strength: 19,
      focusSize: 0.4,
      falloff: 0.62,
      bokeh: true,
      fx: 0.5,
      fy: 0.5,
      angle: 0,
    },
    // 'photo': real studio HDRI for realistic lighting on metal devices.
    scene: { backgroundId: DEFAULT_BACKGROUND, bgImage: null, bgBlur: 0, transparent: false, envId: 'photo' },
    // 9:41 is the conventional time for product shots: neutral and familiar.
    statusBar: { on: false, time: '9:41', dark: true, battery: 0.82 },
    layoutId: 'single',
    mainSlot: { x: 0, y: 0, z: 0, rotY: 0, scale: 1 },
    /*
      Border off by default. Design decision: users can enable frames in the panel; avoid
      unsolicited decoration.
    */
    border: { radius: 0.05, style: 'none', width: 3 },
    light: {
      rotation: 190,
      key: 0,
      keyHeight: 5,
      contactShadow: true,
      envRotation: 0,
      envIntensity: 1,
      envTilt: 0,
      lift: 0,
      reflection: 0,
      screenGlow: 0,
      shadowBlur: 2.4,
      shadowOpacity: 0.5,
      shadowOffset: 0.02,
    },
  };
}

type EditorState = {
  theme: Theme;
  shots: Shot[];
  activeShotId: string;
  /**
   * Project-level aspect ratio, not per shot. Changing it between scenes would make video export
   * incoherent.
   */
  aspectId: string;
  setAspect: (id: string) => void;
  /** Video mode shows the timeline. */
  videoMode: boolean;
  panelOpen: boolean;
  /** Narrow-screen drawer; unused on wide screens. */
  drawerOpen: boolean;
  toggleDrawer: () => void;
  playing: boolean;
  /** Loop playback at the end (default), or stop? */
  loop: boolean;
  toggleLoop: () => void;
  playhead: number;
  /**
   * Audio tracks belong to the sequence, not individual scenes, so music does not stop at each
   * scene change.
   */
  audioTracks: AudioTrack[];
  addAudio: (name: string, url: string) => void;
  patchAudio: (id: string, patch: Partial<AudioTrack>) => void;
  removeAudioTrack: (id: string) => void;

  /** Record mode: every camera change writes a keyframe at the playhead. */
  recording: boolean;
  /**
   * Frame-by-frame export in progress. Time is driven externally rather than by playback. The scene
   * applies motion presets but does not advance globalTime itself.
   */
  exporting: boolean;
  setExporting: (v: boolean) => void;
  /** Whether the playhead is in a gap between scenes. */
  inGap: boolean;
  setInGap: (v: boolean) => void;
  /**
   * Fraction of cropped media height visible on the active screen: 1 = fully fits, < 1 =
   * scrollable. Measured by the scene because screen ratio depends on device, orientation, and
   * frame style; the panel cannot calculate it alone. Neither saved nor included in undo history.
   */
  screenView: number;
  setScreenView: (v: number) => void;
  /**
   * One-click screen scroll: replaces the active `crop.scroll` track with two top-to-bottom
   * keyframes and brief holds at both ends. Existing scrolling is replaced; Ctrl+Z restores it.
   */
  addScreenScroll: () => void;
  /**
   * Per-device animation: rewrites each device's slot tracks (x/y/rotY/scale) for staggered
   * entrances and optional exits. Only slot tracks change; one `set` = one undo step. Returns the
   * animated device count.
   */
  composeDeviceMotion: (recipe: DeviceMotionRecipe) => number;
  /**
   * Move an auto-motion arrival: all camera keyframes at arrival and hold end shift equally,
   * preserving the hold without crossing adjacent arrivals. `t` is scene-local seconds.
   */
  moveFocusMark: (shotId: string, index: number, t: number) => void;
  /*
    Startup readiness. The demo played before images downloaded, causing early stutter. Fixed
    700/1200 ms warmup timers could not account for network speed. Now event-driven: images decoded
    (texturesWarm) → devices compiled (assetsReady) → playback.
  */
  texturesWarm: boolean;
  assetsReady: boolean;
  /** Lower preview resolution during playback without changing export. Preference stored in localStorage. */
  optimizedPlayback: boolean;
  setOptimizedPlayback: (v: boolean) => void;
  /**
   * Warmup progress counter, incremented per decoded image/font. Why: DeviceWarmup's fixed 4-second
   * timeout fired on slow but active networks, compiling the rig and starting playback before
   * textures arrived. Missing textures loaded at the first scene boundary, producing a measured 125
   * ms frame with new materials in the y:-9000 rig. The timeout now means no progress for 4
   * seconds.
   */
  warmTick: number;
  bumpWarmTick: () => void;
  /**
   * User or automation play/pause input cancels the demo's play-when-ready trigger; otherwise a
   * paused demo restarts when assets arrive.
   */
  autoplayCancelled: boolean;
  /** Frame center guides. */
  centerGuides: boolean;
  /** Approximate areas obscured by Reels/TikTok UI in portrait (9:16). Not saved. */
  safeAreaGuide: boolean;
  toggleSafeAreaGuide: () => void;
  /** Whether auto-motion drawing mode is active (frame overlay). */
  autoMotion: boolean;
  /**
   * Multi-scene selection: Shift selects a range, Ctrl/⌘ individual scenes. With 2+ selected,
   * patchShot / patchCamera applies only changed fields to all selected scenes (see diffPatch).
   */
  selectedShotIds: string[];
  selectShotMulti: (id: string, mode: 'toggle' | 'range') => void;
  clearShotSelection: () => void;
  toggleCenterGuides: () => void;
  setTexturesWarm: () => void;
  setAssetsReady: () => void;
  capturesLeft: number;
  isPro: boolean;
  /** Load persisted Pro/capture values after mount for hydration safety. */
  hydratePersisted: () => void;

  active: () => Shot;
  setTheme: (t: Theme) => void;
  selectShot: (id: string) => void;
  addShot: () => void;
  /** Move a scene up/down in the list. */
  moveShot: (id: string, dir: -1 | 1) => void;
  /** Delete the entire keyframe at the given time. */
  removeKeyframe: (shotId: string, t: number) => void;
  /** Delete a single property keyframe. */
  removeTrackKeyframe: (shotId: string, path: string, keyframeId: string) => void;
  /** Move a keyframe in time (scene-local seconds). */
  moveTrackKeyframe: (shotId: string, path: string, keyframeId: string, t: number) => void;
  /*
    Keyframe selection is editor state, excluded from the project. Key: `shotId|path|keyframeId`.
    Stored here because Delete is handled at page level while diamonds live in Timeline.
  */
  selectedKfs: string[];
  selectKeyframe: (key: string, additive: boolean) => void;
  clearKfSelection: () => void;
  /** Select all active-scene keyframes (Ctrl+Alt+A). */
  selectAllKeyframes: () => number;
  /** Delete selected keyframes. Returns the number deleted. */
  deleteSelectedKeyframes: () => number;
  /**
   * Move selected keyframes. With `proportional`, anchor the group's start and scale intervals
   * proportionally (Alt retiming).
   */
  moveSelectedKeyframes: (deltaSeconds: number, proportional: boolean) => void;
  /** Copy selected keyframes internally. Returns the number copied. */
  copySelectedKeyframes: () => number;
  /** Paste at the playhead, preserving relative intervals. */
  pasteKeyframes: () => number;
  /** Assign easing to the selection, or one keyframe if nothing is selected. */
  setKeyframeEasing: (easing: EasingId, one?: { shotId: string; path: string; id: string }) => void;
  /** Assign/remove a custom curve (graph editor). */
  setKeyframeBezier: (
    target: { shotId: string; path: string; id: string },
    bezier: Bezier | null,
  ) => void;
  /** Remove one camera field; delete the keyframe if empty. */
  removeKeyframeField: (shotId: string, t: number, field: keyof CameraState) => void;
  patchShot: (patch: Partial<Shot>) => void;
  patchCamera: (patch: Partial<CameraState>) => void;
  toggleKeyframe: (field: keyof CameraState) => void;
  /** Toggle the property's keyframe at the playhead. */
  toggleTrackKeyframe: (path: string) => void;
  /**
   * Write an animatable property: update its playhead keyframe if present, otherwise change its
   * base value.
   */
  setAnimatable: (path: string, value: number) => void;
  /** Delete all animation for a property. */
  clearTrack: (path: string) => void;
  /** Reset a property to default (right-click its slider). */
  resetAnimatable: (path: string) => void;
  /** Add a playhead keyframe to every existing track (K shortcut). */
  keyframeAllTracks: () => number;
  /** Set the gap before a scene (0 = no gap). */
  setGapBefore: (id: string, seconds: number) => void;
  /** Split the active scene at the playhead; false if no split occurs. */
  splitShot: () => boolean;
  /** Reverse the scene's animation in time. */
  reverseShot: (id: string) => void;
  /**
   * Seamless ping-pong loop: forward in the first half, backward in the second. Identical
   * first/last frames allow seamless GIF/background video loops. Returns false without animation.
   */
  loopShot: (id: string) => boolean;
  /** Active scene with tracks evaluated; displayed by the panel. */
  evaluated: () => Shot;
  setMedia: (url: string | null, kind?: 'image' | 'video', name?: string | null) => void;
  /** Assign an extra device its own screen, including filename and screen name. */
  setExtraMedia: (id: string, url: string | null, kind: 'image' | 'video', name: string | null) => void;
  /**
   * Bulk screen update: one `set` = one undo step. `assign` maps screenKey to media for all
   * matching scenes and extra devices. `newScenes` appends unmatched files using the last scene's
   * visual setup.
   */
  /**
   * Replace media everywhere after baking redactions: all scenes and extra devices using this URL.
   * One `set`; returns replacement count.
   */
  replaceMediaUrl: (from: string, to: string, redactions: RedactRect[] | undefined) => number;
  updateScreens: (plan: {
    assign: Record<string, ScreenMedia>;
    newScenes?: ScreenMedia[];
  }) => { screens: number; scenes: number; added: number };
  setMotion: (motionId: string | null) => void;
  toggleVideoMode: () => void;
  togglePanel: () => void;
  setPlaying: (v: boolean) => void;
  setPlayhead: (t: number) => void;
  toggleRecording: () => void;
  clearKeyframes: () => void;
  /**
   * Selecting a motion preset removes each affected scene's own camera tracks, legacy keyframes,
   * and focus markers (active scene, or all selected scenes). Blur/light/effect tracks remain.
   * Returns affected scene count.
   */
  dropCameraTracks: () => number;
  /** Select a shot and move the playhead to its start. */
  goToShot: (id: string) => void;
  duplicateShot: (id: string) => void;
  removeShot: (id: string) => void;
  setShotDuration: (id: string, seconds: number) => void;
  setShotTransition: (
    id: string,
    patch: { kind?: 'cut' | 'fade' | 'slide'; duration?: number },
  ) => void;
  /** Copy the active scene internally / paste after it. */
  copyShot: () => boolean;
  pasteShot: () => boolean;
  /** Apply a scene preset without changing user media. */
  applyTemplate: (patch: TemplatePatch) => void;
  /** Apply a multi-device layout. */
  applyLayout: (id: string) => void;
  patchExtra: (id: string, patch: Record<string, unknown>) => void;
  removeExtra: (id: string) => void;
  addEffect: (id: string, value: number) => void;
  patchEffect: (id: string, patch: { value?: number; on?: boolean }) => void;
  removeEffect: (id: string) => void;
  addText: (kind: 'text' | 'ticker' | 'logo') => void;
  patchText: (id: string, patch: Partial<TextItem>) => void;
  /** Update text in a specific scene for the timeline strip. */
  patchTextIn: (shotId: string, id: string, patch: Partial<TextItem>) => void;
  removeText: (id: string) => void;
  /** Text item selected in the panel. */
  activeTextId: string | null;
  selectText: (id: string | null) => void;
  /**
   * Add an annotation at the scene-local playhead and screen center, then enable click-to-place
   * mode.
   */
  addAnnotation: (kind: AnnotationKind) => void;
  patchAnnotation: (id: string, patch: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;
  /** Annotation in placement mode (frame click overlay). Not saved. */
  placingAnnotationId: string | null;
  /**
   * Apply the brand kit: heading font + first color for text, body font (+ second band color) for
   * tickers, kit logo for logos; add a logo if absent. Returns changed item count. One `set` = one
   * undo step.
   */
  applyBrandKit: (kit: BrandKit) => number;
  /**
   * Localization: `baseLang` is the language of each item's `text`; `languages` lists extra
   * languages (saved with the project and undo history). `previewLang` selects the displayed
   * language; null = base. Not saved.
   */
  baseLang: string;
  languages: string[];
  previewLang: string | null;
  addLanguage: (code: string) => string | null;
  removeLanguage: (code: string) => void;
  setBaseLang: (code: string) => void;
  setPreviewLang: (code: string | null) => void;
  /**
   * Translation table: header has base text in column 1 and language codes elsewhere; rows contain
   * base text + translations. All items in all scenes with exact trimmed base-text matches receive
   * translations. Add missing languages. One `set` = one undo step.
   */
  importTranslations: (table: string[][]) => { matched: number; unmatched: number; texts: number; langs: string[] };
  /**
   * Template preview: the 3D scene renders this instead of the active scene. Panel, timeline,
   * history, and autosave still use untouched `shots`. `previewCover` is a frozen frame (data URL)
   * covering the scene meanwhile. Neither is saved.
   */
  previewShot: Shot | null;
  previewCover: string | null;
  /** Whether timeline dragging snaps to music beats. Not saved. */
  beatSnap: boolean;
  setBeatSnap: (on: boolean) => void;
  /**
   * Align scene endings to beats: each spans `every` beats (fewer if over 12 seconds, more if under
   * 0.5 seconds). Scale tracks, text, and annotations proportionally; snap post-gap starts too.
   * `beats` are ascending project times. Returns scenes with changed duration. One `set` = one undo
   * step.
   */
  cutShotsOnBeats: (beats: number[], every: number) => number;
  consumeCapture: () => boolean;
};

/** Rebuild the keyed-field map from remaining keyframes. */
function keyframedFrom(keyframes: Keyframe[]): Partial<Record<keyof CameraState, boolean>> {
  const map: Partial<Record<keyof CameraState, boolean>> = {};
  for (const k of keyframes) {
    for (const key of Object.keys(k.camera)) map[key as keyof CameraState] = true;
  }
  return map;
}

export const useEditor = create<EditorState>((set, get) => ({
  theme: 'light',
  shots: [makeShot(1), makeShot(2)],
  activeShotId: 'shot-1',
  aspectId: 'fill',
  setAspect: (aspectId) => set({ aspectId }),
  videoMode: true,
  /*
    Hydration rule: initial state must not read `window`. `window.innerWidth >= 1024` gave server
    true/client false on narrow screens, causing React #418. Wide screens use `panelOpen`, narrow
    screens `drawerOpen`; CSS breakpoints decide which applies.
  */
  panelOpen: true,
  drawerOpen: false,
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
  playing: false,
  loop: true,
  toggleLoop: () => set((s) => ({ loop: !s.loop })),
  playhead: 0,
  audioTracks: [],
  addAudio: (name, url) =>
    set((s) => ({
      audioTracks: [
        ...s.audioTracks,
        { id: `aud-${Date.now().toString(36)}`, name, url, start: 0, volume: 0.8, duration: 0 },
      ],
    })),
  patchAudio: (id, patch) =>
    set((s) => ({
      audioTracks: s.audioTracks.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    })),
  removeAudioTrack: (id) =>
    set((s) => ({ audioTracks: s.audioTracks.filter((a) => a.id !== id) })),

  recording: false,
  exporting: false,
  setExporting: (exporting) => set({ exporting }),
  inGap: false,
  setInGap: (inGap) => set({ inGap }),
  screenView: 1,
  setScreenView: (screenView) => set({ screenView }),
  texturesWarm: false,
  assetsReady: false,
  // Hydration rule: fixed initial value; read the preference after mount (TopBar).
  optimizedPlayback: false,
  setOptimizedPlayback: (v) => {
    try {
      window.localStorage.setItem('mockuptop:optimized-playback', v ? '1' : '0');
    } catch {
      // Without storage, keep it for this session only.
    }
    set({ optimizedPlayback: v });
  },
  autoplayCancelled: false,
  centerGuides: false,
  safeAreaGuide: false,
  autoMotion: false,
  selectedShotIds: [],
  selectShotMulti: (id, mode) =>
    set((s) => {
      const base = s.selectedShotIds.length ? s.selectedShotIds : [s.activeShotId];
      if (mode === 'toggle') {
        const has = base.includes(id);
        const next = has ? base.filter((x) => x !== id) : [...base, id];
        return { selectedShotIds: next.length > 1 ? next : [], activeShotId: has ? s.activeShotId : id };
      }
      const ids = s.shots.map((x) => x.id);
      const a = ids.indexOf(s.activeShotId);
      const b = ids.indexOf(id);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const next = ids.slice(lo, hi + 1);
      return { selectedShotIds: next.length > 1 ? next : [], activeShotId: id };
    }),
  clearShotSelection: () => set({ selectedShotIds: [] }),
  toggleCenterGuides: () => set((s) => ({ centerGuides: !s.centerGuides })),
  toggleSafeAreaGuide: () => set((s) => ({ safeAreaGuide: !s.safeAreaGuide })),
  setTexturesWarm: () => set({ texturesWarm: true }),
  warmTick: 0,
  bumpWarmTick: () => set((s) => ({ warmTick: s.warmTick + 1 })),
  setAssetsReady: () => set({ assetsReady: true }),
  /*
    Hydration requires identical initial server/client values. `readPersistedCaptures()` /
    `readPersistedPro()` gave 3 captures + isPro:false on the server but unlimited + isPro:true on
    enabled clients. Initial TopBar text and ExportMenu badges differed, causing React #418 (7 times
    in one test session). Load persisted values after mount with `hydratePersisted()` so first
    frames match.
  */
  /*
    FREE_FOR_ALL starts as `true` too. This build-time constant produces identical server/client
    output for safe hydration (see brand.ts).
  */
  capturesLeft: FREE_CAPTURES,
  isPro: FREE_FOR_ALL,
  hydratePersisted: () => {
    /*
      Hydrate the theme here too: initial render stays 'light' like the server to avoid #418. The
      inline head script sets `data-theme` before paint to prevent flashing; this only synchronizes
      the store and theme-button icon.
    */
    const theme = readPersistedTheme();
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme;
    set({ capturesLeft: readPersistedCaptures(), isPro: readPersistedPro(), theme });
  },

  active: () => {
    const s = get();
    return s.shots.find((x) => x.id === s.activeShotId) ?? s.shots[0];
  },

  setTheme: (theme) => {
    document.documentElement.dataset.theme = theme;
    setThemePersisted(theme);
    set({ theme });
  },

  selectShot: (activeShotId) => set({ activeShotId }),

  addShot: () =>
    set((s) => {
      /*
        Derive label numbers from the highest existing label, not list length: deleting Shot 1 then
        adding a scene used to duplicate "Shot 2". IDs always use the unique counter.
      */
      const nums = s.shots.map((x) => Number(/^Shot (\d+)/.exec(x.label)?.[1] ?? 0));
      const n = Math.max(0, ...nums) + 1;
      /*
        New scenes inherit device, media, background, lighting, camera, and layout from the active
        scene. Empty scenes looked broken; video usually shows another product angle.
        Keyframes/presets/text/effects start clean. ⚠️ Blur is also an effect: copying `blur:
        {...src.blur}` made every scene added after heavy DOF unexpectedly blurry, especially on
        laptops/tablets.
      */
      const src = s.shots.find((x) => x.id === s.activeShotId) ?? s.shots[s.shots.length - 1];
      const shot: Shot = {
        ...makeShot(n),
        id: nextShotId(),
        label: `Shot ${n}`,
        deviceId: src.deviceId,
        finishId: src.finishId,
        media: src.media,
        mediaKind: src.mediaKind,
        // Keep filename and screen name: another angle of the same screen should receive bulk updates together.
        mediaName: src.mediaName,
        screenName: src.screenName,
        redactions: src.redactions,
        crop: { ...src.crop },
        camera: { ...src.camera },
        scene: { ...src.scene },
        light: { ...src.light },
        statusBar: { ...src.statusBar },
        border: { ...src.border },
        layoutId: src.layoutId,
        mainSlot: { ...src.mainSlot },
        extras: src.extras.map((e) => ({ ...e })),
      };
      /*
        Move the playhead to the new scene's start: CameraRig selects by playhead, so leaving it
        reselected the old scene. ⚠️ Summing only durations omitted `gapBefore`, leaving the
        playhead behind by total gap length and reintroducing the jump. `totalDuration` is the
        authoritative gap-aware calculation.
      */
      const start = totalDuration(s.shots);
      return { shots: [...s.shots, shot], activeShotId: shot.id, playhead: start, playing: false };
    }),

  moveShot: (id, dir) =>
    set((s) => {
      const i = s.shots.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.shots.length) return s;
      const shots = [...s.shots];
      [shots[i], shots[j]] = [shots[j], shots[i]];
      return { shots };
    }),

  /*
    Scene-row diamond deletes all property keyframes at that instant. Use `removeTrackKeyframe` on
    the expanded property row to delete just one.
  */
  removeKeyframe: (shotId, t) =>
    set((s) => ({
      shots: s.shots.map((x) => {
        if (x.id !== shotId) return x;
        const tracks = x.tracks
          .map((tr) => ({ ...tr, keyframes: tr.keyframes.filter((k) => Math.abs(k.t - t) >= 0.017) }))
          .filter((tr) => tr.keyframes.length > 0);
        return { ...x, tracks };
      }),
    })),

  moveTrackKeyframe: (shotId, path, keyframeId, t) =>
    set((s) => ({
      shots: s.shots.map((x) => {
        if (x.id !== shotId) return x;
        const clamped = Math.round(Math.min(Math.max(0, t), x.duration) * 100) / 100;
        return {
          ...x,
          tracks: x.tracks.map((tr) =>
            tr.path === path
              ? {
                  ...tr,
                  /*
                    Keyframes may cross neighbors; this simply reorders them. Sort after moving to
                    avoid invalid ordering when keyframes overlap.
                  */
                  keyframes: tr.keyframes
                    .map((k) => (k.id === keyframeId ? { ...k, t: clamped } : k))
                    .sort((a, b) => a.t - b.t),
                }
              : tr,
          ),
        };
      }),
    })),

  removeTrackKeyframe: (shotId, path, keyframeId) =>
    set((s) => ({
      shots: s.shots.map((x) => {
        if (x.id !== shotId) return x;
        const tracks = x.tracks
          .map((tr) =>
            tr.path === path
              ? { ...tr, keyframes: tr.keyframes.filter((k) => k.id !== keyframeId) }
              : tr,
          )
          .filter((tr) => tr.keyframes.length > 0);
        return { ...x, tracks };
      }),
    })),

  removeKeyframeField: (shotId, t, field) =>
    set((s) => ({
      shots: s.shots.map((x) => {
        if (x.id !== shotId) return x;
        const keyframes = x.keyframes
          .map((k) => {
            if (Math.abs(k.t - t) >= 0.005) return k;
            const camera = { ...k.camera };
            delete camera[field];
            return { ...k, camera };
          })
          // Discard keyframes with no fields: empty diamonds looked like
          // undeletable timeline remnants.
          .filter((k) => Object.keys(k.camera).length > 0);
        return { ...x, keyframes, keyframed: keyframedFrom(keyframes) };
      }),
    })),

  patchShot: (patch) =>
    set((s) => {
      const multi = s.selectedShotIds.length > 1 && s.selectedShotIds.includes(s.activeShotId);
      if (!multi) {
        return { shots: s.shots.map((x) => (x.id === s.activeShotId ? { ...x, ...patch } : x)) };
      }
      const active = s.shots.find((x) => x.id === s.activeShotId)!;
      const diff = diffPatch(active, patch as Record<string, unknown>);
      return {
        shots: s.shots.map((x) =>
          x.id === s.activeShotId
            ? { ...x, ...patch }
            : s.selectedShotIds.includes(x.id)
              ? applyDiff(x, diff)
              : x,
        ),
      };
    }),

  /**
   * Camera change. In record mode, also write at the playhead without a separate add-keyframe
   * action. Overwrite keyframes already at the same second.
   */
  patchCamera: (patch) =>
    set((s) => {
      // Multi-selection: apply the same fields to other selected scenes' base cameras.
      const others = s.selectedShotIds.length > 1 && s.selectedShotIds.includes(s.activeShotId)
        ? new Set(s.selectedShotIds.filter((id) => id !== s.activeShotId))
        : null;
      const withOthers = (shots: Shot[]) =>
        others ? shots.map((x) => (others.has(x.id) ? { ...x, camera: { ...x.camera, ...patch } } : x)) : shots;
      return {
        /*
          Camera edits stop playback when RECORD is off. Animated fields write keyframes, correct
          while paused but scattering unwanted keyframes along a moving playhead. RECORD
          intentionally keeps playback running for live recording.
        */
        ...(s.playing && !s.recording ? { playing: false, autoplayCancelled: true } : {}),
        shots: withOthers(s.shots.map((x) => {
          if (x.id !== s.activeShotId) return x;
          const camera = { ...x.camera, ...patch };
          /*
            Tracked fields always write keyframes, even without record mode. Scene and panel show
            evaluated values, so base edits are overwritten next frame and canvas dragging appears
            ineffective. Sliders follow the same rule (`setAnimatable`).
          */
          const animated = new Set(
            x.tracks.filter((tr) => tr.path.startsWith('camera.')).map((tr) => tr.path),
          );
          const touchesTrack = Object.keys(patch).some((f) => animated.has(`camera.${f}`));
          if (!s.recording && !touchesTrack) return { ...x, camera };

          /*
            Record mode writes each changed camera field at the playhead. Keyframe time is
            scene-local, playhead global; raw time clamped scene 2 recordings to its end. Write
            separate property tracks, updating existing keyframes at the same instant.
          */
          const t = localTimeIn(s, x);
          let tracks = x.tracks;
          for (const [field, value] of Object.entries(patch)) {
            if (typeof value !== 'number') continue;
            const path = `camera.${field}`;
            const track = tracks.find((tr) => tr.path === path);
            if (!track) {
              // With recording off, do not create keyframes for untracked fields:
              // those are the user's static settings, not animation.
              if (!s.recording) continue;
              tracks = [...tracks, { path, keyframes: [makeKeyframe(t, value)] }];
              continue;
            }
            const here = keyframeAt(track, t);
            const keyframes = here
              ? track.keyframes.map((k) => (k.id === here.id ? { ...k, value } : k))
              : [...track.keyframes, makeKeyframe(t, value)].sort((a, b) => a.t - b.t);
            tracks = tracks.map((tr) => (tr.path === path ? { ...tr, keyframes } : tr));
          }
          return { ...x, camera, tracks };
        })),
      };
    }),

  toggleKeyframe: (field) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === s.activeShotId
          ? { ...x, keyframed: { ...x.keyframed, [field]: !x.keyframed[field] } }
          : x,
      ),
    })),

  /*
    Animation uses property tracks. Time is scene-local; the playhead is global across scenes. Raw
    playhead times clamped scene 2 recordings to its end and prevented motion in the legacy model.
  */
  toggleTrackKeyframe: (path) =>
    set((s) => {
      const shot = s.shots.find((x) => x.id === s.activeShotId);
      if (!shot) return {};
      const t = localTimeIn(s, shot);
      const track = shot.tracks.find((tr) => tr.path === path);
      const here = keyframeAt(track, t);

      let tracks: PropertyTrack[];
      if (!track) {
        // No track → create a track and first keyframe with the current value.
        const value = getByPath(shot, path);
        if (value === undefined) return {};
        tracks = [...shot.tracks, { path, keyframes: [makeKeyframe(t, value)] }];
      } else if (here) {
        // Remove this keyframe; remove the track too if empty.
        const keyframes = track.keyframes.filter((k) => k.id !== here.id);
        tracks = keyframes.length
          ? shot.tracks.map((tr) => (tr.path === path ? { ...tr, keyframes } : tr))
          : shot.tracks.filter((tr) => tr.path !== path);
      } else {
        // Track exists but no keyframe here → write the current evaluated value.
        const value = evaluateTrack(track, t) ?? getByPath(shot, path) ?? 0;
        const keyframes = [...track.keyframes, makeKeyframe(t, value)].sort((a, b) => a.t - b.t);
        tracks = shot.tracks.map((tr) => (tr.path === path ? { ...tr, keyframes } : tr));
      }
      return { shots: s.shots.map((x) => (x.id === shot.id ? { ...x, tracks } : x)) };
    }),

  setAnimatable: (path, value) =>
    set((s) => {
      const shot = s.shots.find((x) => x.id === s.activeShotId);
      if (!shot) return {};
      /*
        As in patchCamera, slider edits during playback with RECORD off pause first to avoid
        scattering keyframes. Set autoplayCancelled too, as in setPlaying(false), so a user-paused
        demo cannot restart when assets arrive.
      */
      const pause = s.playing && !s.recording ? { playing: false, autoplayCancelled: true } : {};
      const t = localTimeIn(s, shot);
      const track = shot.tracks.find((tr) => tr.path === path);
      const here = keyframeAt(track, t);

      /*
        Two-way binding: at a keyframe, the slider edits it; otherwise it changes the base. Record
        mode creates a new keyframe for an already keyed property, preserving the rule that every
        recorded edit is a keyframe.
      */
      if (track && here) {
        const keyframes = track.keyframes.map((k) => (k.id === here.id ? { ...k, value } : k));
        return {
          ...pause,
          shots: s.shots.map((x) =>
            x.id === shot.id
              ? { ...x, tracks: x.tracks.map((tr) => (tr.path === path ? { ...tr, keyframes } : tr)) }
              : x,
          ),
        };
      }
      /*
        Existing track with no playhead keyframe: write one. Base edits otherwise appear ineffective
        because evaluation overwrites them next frame. Animated sliders always write keyframes, as
        in After Effects. Record mode is unnecessary: enabling the diamond already marks the
        property animated.
      */
      if (track) {
        const keyframes = [...track.keyframes, makeKeyframe(t, value)].sort((a, b) => a.t - b.t);
        return {
          ...pause,
          shots: s.shots.map((x) =>
            x.id === shot.id
              ? { ...x, tracks: x.tracks.map((tr) => (tr.path === path ? { ...tr, keyframes } : tr)) }
              : x,
          ),
        };
      }
      return { ...pause, shots: s.shots.map((x) => (x.id === shot.id ? setByPath(x, path, value) : x)) };
    }),

  /*
    Right-click resets to default globally. A fresh `makeShot()` is the sole defaults source; a
    separate table would create a second source that could drift out of sync.
  */
  resetAnimatable: (path) => {
    const value = getByPath(makeShot(1), path);
    if (value === undefined) return;
    get().setAnimatable(path, value);
  },

  /*
    Screen scroll needs two keyframes: evaluateTrack holds values before the first and after the
    last. Brief holds allow reading at the top and pausing at the bottom, keeping store-set
    `stillMoment` on a clean top frame. Scenes under 2 seconds omit holds to leave scrolling room.
  */
  moveFocusMark: (shotId, index, t) => {
    const s = get();
    const shot = s.shots.find((x) => x.id === shotId);
    const marks = shot?.focusMarks;
    const m = marks?.[index];
    if (!shot || !marks || !m) return;
    const hold = m.end - m.t;
    const lo = (index > 0 ? marks[index - 1].end : 0) + 0.1;
    const hi = (index < marks.length - 1 ? marks[index + 1].t : shot.duration) - 0.1 - hold;
    if (hi < lo) return;
    const nt = Math.round(Math.min(hi, Math.max(lo, t)) * 1000) / 1000;
    const d = nt - m.t;
    if (Math.abs(d) < 1e-4) return;
    const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
    const tracks = shot.tracks.map((tr) =>
      tr.path.startsWith('camera.')
        ? {
            ...tr,
            keyframes: tr.keyframes
              .map((k) => (near(k.t, m.t) || (hold > 0 && near(k.t, m.end)) ? { ...k, t: Math.round((k.t + d) * 1000) / 1000 } : k))
              .sort((a, b) => a.t - b.t),
          }
        : tr,
    );
    const focusMarks = marks.map((x, i) => (i === index ? { t: nt, end: Math.round((x.end + d) * 1000) / 1000 } : x));
    set({ shots: s.shots.map((x) => (x.id === shotId ? { ...x, tracks, focusMarks } : x)) });
  },

  composeDeviceMotion: (recipe) => {
    const s = get();
    const shot = s.shots.find((x) => x.id === s.activeShotId);
    if (!shot) return 0;
    type Slot = { x: number; y: number; z: number; rotY: number; scale: number };
    const devs: { key: string; prefix: string; slot: Slot }[] = [
      { key: 'main', prefix: 'mainSlot', slot: shot.mainSlot },
      ...shot.extras.map((e) => ({ key: e.id, prefix: `extras.${e.id}`, slot: e as Slot })),
    ];
    // Order by horizontal slot position; ties preserve array order (stable sort).
    const ranked = [...devs].sort((a, b) =>
      recipe.order === 'rtl'
        ? b.slot.x - a.slot.x
        : recipe.order === 'center'
          ? Math.abs(a.slot.x) - Math.abs(b.slot.x)
          : a.slot.x - b.slot.x,
    );
    const n = devs.length;
    const D = shot.duration;
    let d = Math.min(3, Math.max(0.1, recipe.duration));
    let st = n > 1 ? Math.min(1, Math.max(0, recipe.stagger)) : 0;
    // Fit within the scene: entrance must finish by halfway if exiting; shorten both proportionally.
    const budget = (recipe.exit ? D / 2 : D) * 0.95;
    const need = (n - 1) * st + d;
    if (need > budget) {
      const f = budget / need;
      d *= f;
      st *= f;
    }
    const r2 = (t: number) => Math.round(t * 100) / 100;
    /*
      Starting poses use width units for x/z and height for y. Generous distances do not guarantee
      offscreen positions at every zoom. Slide direction follows the slot: left from left, right
      from right, center from left.
    */
    const start = (kind: DeviceMotionKind, b: Slot): Partial<Slot> => {
      const side = b.x > 0.05 ? 1 : -1;
      if (kind === 'drop') return { y: b.y + 1.6 };
      if (kind === 'rise') return { y: b.y - 1.6 };
      if (kind === 'slide') return { x: b.x + side * 2.5 };
      if (kind === 'spin') return { rotY: b.rotY + side * 180, scale: Math.max(0.02, b.scale * 0.6) };
      if (kind === 'pop') return { scale: 0.02 };
      return {};
    };
    /*
      Entrance easing: drop/rise/slide decelerate sharply (bounce would sink into the floor), spin
      overshoots slightly, pop is springy. ⚠️ 'expo' starts slowly here (0.25 at p=0.8), causing
      devices to rush in at the last moment.
    */
    const EASE: Record<DeviceMotionKind, EasingId> = {
      none: 'easeInOut',
      drop: 'quint',
      rise: 'quint',
      slide: 'quint',
      spin: 'back',
      pop: 'spring',
    };
    const kf = (t: number, value: number, ease: EasingId) => ({ ...makeKeyframe(r2(t), value), easingIn: ease, easingOut: ease });
    const prefixes = devs.map((x) => `${x.prefix}.`);
    // Recomposing replaces these devices' old slot tracks; applyLayout/removeExtra prune orphans.
    const tracks: PropertyTrack[] = shot.tracks.filter((tr) => !prefixes.some((p) => tr.path.startsWith(p)));
    let animated = 0;
    for (const dev of devs) {
      const kind = recipe.per[dev.key] ?? recipe.kind;
      if (kind === 'none') continue;
      const r = ranked.indexOf(dev);
      const t0 = r * st;
      const from = start(kind, dev.slot);
      const fields = Object.keys(from) as (keyof Slot)[];
      if (!fields.length) continue;
      animated += 1;
      for (const field of fields) {
        const v0 = from[field]!;
        const base = dev.slot[field];
        const ease = EASE[kind];
        const kfs = [kf(t0, v0, ease), kf(t0 + d, base, ease)];
        if (recipe.exit) {
          // Exit in the same order (first in, first out); the last device is outside at scene end.
          const te = D - d - (n - 1 - r) * st;
          kfs[1] = { ...kfs[1], easingOut: 'easeIn' };
          kfs.push({ ...kf(te, base, 'easeIn') }, { ...kf(te + d, v0, 'easeIn') });
        }
        tracks.push({ path: `${dev.prefix}.${field}`, keyframes: kfs });
      }
    }
    set({
      shots: s.shots.map((x) =>
        x.id === shot.id ? { ...x, tracks, deviceMotion: { ...recipe, per: { ...recipe.per } } } : x,
      ),
    });
    return animated;
  },

  addScreenScroll: () =>
    set((s) => {
      const shot = s.shots.find((x) => x.id === s.activeShotId);
      if (!shot) return {};
      const d = shot.duration;
      const hold = d >= 2 ? Math.round(Math.min(0.6, d * 0.12) * 100) / 100 : 0;
      const track: PropertyTrack = {
        path: 'crop.scroll',
        keyframes: [makeKeyframe(hold, 0), makeKeyframe(Math.round((d - hold) * 100) / 100, 1)],
      };
      const tracks = [...shot.tracks.filter((tr) => tr.path !== 'crop.scroll'), track];
      return { shots: s.shots.map((x) => (x.id === shot.id ? { ...x, tracks } : x)) };
    }),

  clearTrack: (path) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === s.activeShotId ? { ...x, tracks: x.tracks.filter((tr) => tr.path !== path) } : x,
      ),
    })),

  /*
    Evaluated active scene: tracked properties use their playhead values. Untracked fields remain
    untouched, structurally preventing the legacy stale-camera-snapshot overwrite bug.
  */
  evaluated: () => {
    const s = get();
    const shot = s.shots.find((x) => x.id === s.activeShotId) ?? s.shots[0];
    return evaluateShot(shot, localTimeIn(s, shot));
  },

  keyframeAllTracks: () => {
    /*
      `K` adds playhead keyframes only to already animated properties. Otherwise one key could
      create 21 unwanted tracks. Returns 0 without tracks so callers can point to the diamond.
    */
    const s = get();
    const shot = s.shots.find((x) => x.id === s.activeShotId);
    if (!shot || !shot.tracks.length) return 0;
    const t = localTimeIn(s, shot);
    let n = 0;
    const tracks = shot.tracks.map((tr) => {
      if (keyframeAt(tr, t)) return tr;
      const value = evaluateTrack(tr, t);
      if (value === undefined) return tr;
      n += 1;
      return { ...tr, keyframes: [...tr.keyframes, makeKeyframe(t, value)].sort((a, b) => a.t - b.t) };
    });
    if (n) set({ shots: s.shots.map((x) => (x.id === shot.id ? { ...x, tracks } : x)) });
    return n;
  },

  setGapBefore: (id, seconds) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === id ? { ...x, gapBefore: Math.max(0, Math.round(seconds * 100) / 100) } : x,
      ),
    })),

  splitShot: () => {
    /*
      Split at the playhead, distributing animation rather than discarding it. Left keeps local
      times; right keyframes shift backward by split time. Avoid endpoint splits: zero-duration
      scenes become unclickable timeline lines.
    */
    const s = get();
    const shot = s.shots.find((x) => x.id === s.activeShotId);
    if (!shot) return false;
    const t = localTimeIn(s, shot);
    if (t < 0.1 || t > shot.duration - 0.1) return false;

    /*
      Split annotation timing: left keeps those starting before the split (clipped ends), right
      keeps those ending afterward (shifted back by split time); spanning annotations are split.
    */
    const r2 = (v: number) => Math.round(v * 100) / 100;
    /*
      Boundary keyframe: splitting tracks by time alone froze a two-keyframe 0→8 Pan X at 0 on the
      left and 8 on the right because each retained only one keyframe. Write the evaluated split
      value at both boundaries (left: t, right: 0). Boundary values are exact; curved-segment
      intermediate values are approximate because the cut-side boundary keyframe is linear, keeping
      motion across the cut. Needed even if all original keyframes lie on one side: tracks hold
      endpoint values, but a keyframe-free part reverts to base.
    */
    const near = (a: number, b: number) => Math.abs(a - b) < 0.017;
    const cut = (value: number) => ({ ...makeKeyframe(0, value), easingIn: 'linear' as const, easingOut: 'linear' as const });
    const leftTracks: PropertyTrack[] = [];
    const rightTracks: PropertyTrack[] = [];
    for (const tr of shot.tracks) {
      const v = evaluateTrack(tr, t);
      const l = tr.keyframes.filter((k) => k.t <= t);
      const r = tr.keyframes.filter((k) => k.t > t).map((k) => ({ ...k, t: r2(k.t - t) }));
      if (v !== undefined) {
        if (!l.some((k) => near(k.t, t))) l.push({ ...cut(v), t: r2(t) });
        if (!r.some((k) => near(k.t, 0))) r.unshift(cut(v));
      }
      if (l.length) leftTracks.push({ ...tr, keyframes: l });
      if (r.length) rightTracks.push({ ...tr, keyframes: r });
    }
    /*
      Distribute timed text like annotations. Previously both parts kept original times, so text at
      3–4 seconds disappeared outside two-second parts. `end: null` means through the part's end.
    */
    const leftTexts = shot.texts
      .filter((x) => x.start < t)
      .map((x) => (x.end !== null && x.end > t ? { ...x, end: null } : x));
    const rightTexts = shot.texts
      .filter((x) => (x.end ?? shot.duration) > t)
      .map((x) => ({
        ...x,
        id: `${x.id}-b`,
        start: r2(Math.max(0, x.start - t)),
        end: x.end === null ? null : r2(x.end - t),
      }));
    /*
      Continue video from the split: right starts at source `in + t·speed`, not original `in` (a
      scene using seconds 5–9 should resume at 7, not 5). Wrap the start within the trimmed interval
      if looping.
    */
    const rate = clampVideoRate(shot.playbackRate ?? 1);
    const inSec = Math.max(0, shot.trim.in ?? 0);
    const span = shot.trim.out !== null ? shot.trim.out - inSec : Infinity;
    const advanced = t * rate;
    const rightIn = r2(inSec + (span > 0 && span !== Infinity ? advanced % span : advanced));
    const left: Shot = {
      ...shot,
      duration: Math.round(t * 100) / 100,
      tracks: leftTracks,
      texts: leftTexts,
      annotations: shot.annotations
        .filter((a) => a.start < t)
        .map((a) => (a.end !== null && a.end > t ? { ...a, end: null } : a)),
      // Clip marker hold ends crossing the split, as with annotations;
      // otherwise `end` would lie outside the shortened scene.
      focusMarks: shot.focusMarks?.filter((m) => m.t <= t).map((m) => (m.end > t ? { ...m, end: r2(t) } : m)),
    };
    const right: Shot = {
      ...shot,
      id: nextShotId(),
      label: `${shot.label} B`,
      duration: Math.round((shot.duration - t) * 100) / 100,
      // Keep the gap before the left part only; duplicating it on the right
      // would extend duration and misalign everything afterward with music.
      gapBefore: 0,
      trim: { ...shot.trim, in: rightIn },
      tracks: rightTracks,
      texts: rightTexts,
      annotations: shot.annotations
        .filter((a) => (a.end ?? shot.duration) > t)
        .map((a) => ({
          ...a,
          id: `${a.id}-b`,
          start: r2(Math.max(0, a.start - t)),
          end: a.end === null ? null : r2(a.end - t),
        })),
      focusMarks: shot.focusMarks?.filter((m) => m.t > t).map((m) => ({ t: r2(m.t - t), end: r2(m.end - t) })),
    };
    const i = s.shots.findIndex((x) => x.id === shot.id);
    const shots = [...s.shots.slice(0, i), left, right, ...s.shots.slice(i + 1)];
    set({ shots });
    return true;
  },

  reverseShot: (id) =>
    set((s) => ({
      shots: s.shots.map((x) => {
        if (x.id !== id) return x;
        /*
          Reverse mirrors time and curves (`mirrorKeyframes`); renaming alone left "Ease Out"
          unchanged. Mirror custom bezier curves too and move them to the segment's new starting
          keyframe.
        */
        const r2 = (v: number) => Math.round(v * 100) / 100;
        const tracks = x.tracks.map((tr) => ({ ...tr, keyframes: mirrorKeyframes(tr.keyframes, x.duration, r2) }));
        /*
          Mirror focus markers: swap arrival and hold end and reverse order. Untouched markers
          silently vanished because their times no longer matched camera keyframes.
        */
        const focusMarks = x.focusMarks
          ?.map((m) => ({ t: r2(x.duration - m.end), end: r2(x.duration - m.t) }))
          .sort((a, b) => a.t - b.t);
        return { ...x, tracks, ...(focusMarks && { focusMarks }) };
      }),
    })),

  /*
    Seamless loop: 1. If a motion preset exists without camera tracks, bake it into tracks with 13
    samples (linear interpolation; the preset curve is captured in the samples). 2. Compress tracks
    into the first half and mirror into the second. Reverse segment curves too: swap entrance/exit,
    reverse custom bezier from the preceding keyframe, and store it at the mirrored segment's
    earlier endpoint.
  */
  loopShot: (id) => {
    const s = get();
    const x = s.shots.find((sh) => sh.id === id);
    if (!x) return false;
    const d = x.duration;
    const r2 = (t: number) => Math.round(t * 100) / 100;
    let tracks = x.tracks;
    let motionId = x.motionId;
    const motion =
      x.motionId && !x.tracks.some((t) => t.path.startsWith('camera.'))
        ? MOTION_PRESETS.find((m) => m.id === x.motionId)
        : undefined;
    if (motion) {
      const N = 12;
      const samples = Array.from({ length: N + 1 }, (_, i) => ({ t: r2((i / N) * d), cam: sampleMotion(motion, i / N) }));
      const fields = [...new Set(samples.flatMap((sm) => Object.keys(sm.cam)))] as (keyof CameraState)[];
      const baked: PropertyTrack[] = fields.map((f) => ({
        path: `camera.${f}`,
        keyframes: samples.map((sm) => ({
          ...makeKeyframe(sm.t, (sm.cam[f] as number | undefined) ?? (x.camera[f] as number)),
          easingIn: 'linear' as const,
          easingOut: 'linear' as const,
        })),
      }));
      tracks = [...tracks, ...baked];
      motionId = null;
    }
    if (!tracks.some((t) => t.keyframes.length >= 2)) return false;
    /*
      Use `mirrorSegment`: each forward segment (first[i] → first[i+1]) returns as (M(i+1) → M(i)).
      The midpoint pivot is its own mirror, not duplicated; the first return segment uses its
      outgoing easing. Leaving its unused forward exit unchanged made an "Ease Out" return start by
      decelerating too.
    */
    tracks = tracks.map((tr) => {
      const first = [...tr.keyframes].sort((a, b) => a.t - b.t).map((k) => ({ ...k, t: r2(k.t / 2) }));
      const mir = new Map<number, (typeof first)[number]>();
      first.forEach((k, i) => {
        if (k.t >= r2(d / 2)) return;
        const copy = { ...k, id: nextKeyframeId(), t: r2(d - k.t), easingIn: k.easingOut, easingOut: k.easingIn };
        delete copy.bezier;
        mir.set(i, copy);
      });
      const M = (i: number) => mir.get(i) ?? first[i];
      for (let i = 0; i < first.length - 1; i += 1) {
        const m = mirrorSegment(first[i].easingOut, first[i + 1].easingIn, first[i].bezier);
        const start = M(i + 1);
        start.easingOut = m.out;
        // The pivot was the final forward keyframe: its old bezier does not belong to the return segment.
        if (m.bezier) start.bezier = m.bezier;
        else delete start.bezier;
        M(i).easingIn = m.into;
      }
      return { ...tr, keyframes: [...first, ...mir.values()].sort((a, b) => a.t - b.t) };
    });
    /*
      Focus markers compress into the first half like tracks. The mirrored camera revisits areas in
      reverse; each held marker gets a return arrival (mirrored hold end). The last area without a
      hold is the turning point; its mirror would be a departure, so omit it.
    */
    const half = x.focusMarks?.map((m) => ({ t: r2(m.t / 2), end: r2(m.end / 2) }));
    const focusMarks = half && [
      ...half,
      ...half.filter((m) => m.end > m.t && m.end < r2(d / 2)).map((m) => ({ t: r2(d - m.end), end: r2(d - m.t) })),
    ].sort((a, b) => a.t - b.t);
    set({
      shots: s.shots.map((sh) => (sh.id === id ? { ...sh, tracks, motionId, ...(focusMarks && { focusMarks }) } : sh)),
    });
    return true;
  },

  selectedKfs: [],

  selectKeyframe: (key, additive) =>
    set((s) => {
      if (!additive) return { selectedKfs: [key] };
      return s.selectedKfs.includes(key)
        ? { selectedKfs: s.selectedKfs.filter((k) => k !== key) }
        : { selectedKfs: [...s.selectedKfs, key] };
    }),

  clearKfSelection: () => set({ selectedKfs: [] }),

  selectAllKeyframes: () => {
    const s = get();
    const shot = s.shots.find((x) => x.id === s.activeShotId);
    if (!shot) return 0;
    const keys = shot.tracks.flatMap((tr) => tr.keyframes.map((k) => `${shot.id}|${tr.path}|${k.id}`));
    set({ selectedKfs: keys });
    return keys.length;
  },

  deleteSelectedKeyframes: () => {
    const s = get();
    if (!s.selectedKfs.length) return 0;
    const sel = new Set(s.selectedKfs);
    let n = 0;
    const shots = s.shots.map((x) => {
      const tracks = x.tracks
        .map((tr) => {
          const keyframes = tr.keyframes.filter((k) => {
            const hit = sel.has(`${x.id}|${tr.path}|${k.id}`);
            if (hit) n += 1;
            return !hit;
          });
          return { ...tr, keyframes };
        })
        .filter((tr) => tr.keyframes.length > 0);
      return { ...x, tracks };
    });
    set({ shots, selectedKfs: [] });
    return n;
  },

  moveSelectedKeyframes: (deltaSeconds, proportional) =>
    set((s) => {
      if (!s.selectedKfs.length) return {};
      const sel = new Set(s.selectedKfs);
      /*
        Proportional retiming anchors the first keyframe and scales others by distance from it,
        preserving spacing when compressing 0→10 seconds to 5 seconds. Plain translation moves
        everything equally.
      */
      const times: number[] = [];
      for (const x of s.shots)
        for (const tr of x.tracks)
          for (const k of tr.keyframes) if (sel.has(`${x.id}|${tr.path}|${k.id}`)) times.push(k.t);
      if (!times.length) return {};
      const first = Math.min(...times);
      const last = Math.max(...times);
      const span = Math.max(0.0001, last - first);
      const scale = proportional ? Math.max(0.05, (span + deltaSeconds) / span) : 1;

      const shots = s.shots.map((x) => ({
        ...x,
        tracks: x.tracks.map((tr) => ({
          ...tr,
          keyframes: tr.keyframes
            .map((k) => {
              if (!sel.has(`${x.id}|${tr.path}|${k.id}`)) return k;
              const nt = proportional
                ? first + (k.t - first) * scale
                : k.t + deltaSeconds;
              return { ...k, t: Math.round(Math.min(Math.max(0, nt), x.duration) * 100) / 100 };
            })
            .sort((a, b) => a.t - b.t),
        })),
      }));
      return { shots };
    }),

  copySelectedKeyframes: () => {
    const s = get();
    if (!s.selectedKfs.length) return 0;
    const sel = new Set(s.selectedKfs);
    const items: { path: string; offset: number; value: number; easingIn: EasingId; easingOut: EasingId }[] = [];
    let min = Infinity;
    for (const x of s.shots)
      for (const tr of x.tracks)
        for (const k of tr.keyframes)
          if (sel.has(`${x.id}|${tr.path}|${k.id}`)) {
            min = Math.min(min, k.t);
            items.push({ path: tr.path, offset: k.t, value: k.value, easingIn: k.easingIn, easingOut: k.easingOut });
          }
    if (!items.length) return 0;
    // Store offsets relative to the group's start: pasting treats the
    // playhead as that start, preserving all intervals.
    kfClipboard = items.map((i) => ({ ...i, offset: Math.round((i.offset - min) * 100) / 100 }));
    return kfClipboard.length;
  },

  pasteKeyframes: () => {
    const s = get();
    if (!kfClipboard.length) return 0;
    const shot = s.shots.find((x) => x.id === s.activeShotId);
    if (!shot) return 0;
    const base = localTimeIn(s, shot);
    let tracks = shot.tracks;
    let n = 0;
    for (const item of kfClipboard) {
      const t = Math.round(Math.min(base + item.offset, shot.duration) * 100) / 100;
      const track = tracks.find((tr) => tr.path === item.path);
      const kf = { ...makeKeyframe(t, item.value), easingIn: item.easingIn, easingOut: item.easingOut };
      if (!track) {
        tracks = [...tracks, { path: item.path, keyframes: [kf] }];
      } else {
        // Overwrite keyframes at the same instant: overlapping keyframes
        // create an unclickable timeline pile.
        const without = track.keyframes.filter((k) => Math.abs(k.t - t) >= 0.017);
        tracks = tracks.map((tr) =>
          tr.path === item.path ? { ...tr, keyframes: [...without, kf].sort((a, b) => a.t - b.t) } : tr,
        );
      }
      n += 1;
    }
    set({ shots: s.shots.map((x) => (x.id === shot.id ? { ...x, tracks } : x)) });
    return n;
  },

  setKeyframeBezier: ({ shotId, path, id }, bezier) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === shotId
          ? {
              ...x,
              tracks: x.tracks.map((tr) =>
                tr.path === path
                  ? {
                      ...tr,
                      keyframes: tr.keyframes.map((k) =>
                        k.id === id ? { ...k, bezier: bezier ?? undefined } : k,
                      ),
                    }
                  : tr,
              ),
            }
          : x,
      ),
    })),

  setKeyframeEasing: (easing, one) =>
    set((s) => {
      const sel = new Set(s.selectedKfs);
      const hit = (shotId: string, path: string, id: string) =>
        one ? one.shotId === shotId && one.path === path && one.id === id : sel.has(`${shotId}|${path}|${id}`);
      return {
        shots: s.shots.map((x) => ({
          ...x,
          tracks: x.tracks.map((tr) => ({
            ...tr,
            keyframes: tr.keyframes.map((k) =>
              /*
                Set entrance and exit easing together. Separate ease-out/ease-in choices become
                useful in the graph editor; requiring two menu choices would overwhelm users.
              */
              hit(x.id, tr.path, k.id) ? { ...k, easingIn: easing, easingOut: easing } : k,
            ),
          })),
        })),
      };
    }),

  setMedia: (url, kind = 'image', name = null) => {
    /*
      Screen names follow filenames, but custom names (different from filename-derived ones) survive
      replacement: the name identifies a slot whose image can change.
    */
    const cur = get().active();
    const auto = !cur.screenName || cur.screenName === screenNameFromFile(cur.mediaName);
    const screenName = name && auto ? screenNameFromFile(name) : cur.screenName;
    get().patchShot({ media: url, mediaKind: kind, mediaName: name, screenName });
  },
  setExtraMedia: (id, url, kind, name) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === s.activeShotId
          ? {
              ...x,
              extras: x.extras.map((e) => {
                if (e.id !== id) return e;
                const auto = !e.screenName || e.screenName === screenNameFromFile(e.mediaName ?? null);
                return {
                  ...e,
                  media: url,
                  mediaKind: kind,
                  mediaName: name,
                  screenName: name && auto ? screenNameFromFile(name) : (e.screenName ?? null),
                };
              }),
            }
          : x,
      ),
    })),
  replaceMediaUrl: (from, to, redactions) => {
    let n = 0;
    const shots = get().shots.map((x) => {
      let next = x;
      if (x.media === from) {
        next = { ...next, media: to, redactions };
        n += 1;
      }
      if (x.extras.some((e) => e.media === from)) {
        next = { ...next, extras: next.extras.map((e) => (e.media === from ? ((n += 1), { ...e, media: to, redactions }) : e)) };
      }
      return next;
    });
    if (n) set({ shots });
    return n;
  },
  updateScreens: ({ assign, newScenes = [] }) => {
    const s = get();
    const hit = new Set<string>();
    let scenes = 0;
    /*
      Reset speed and trim when media kind changes (image ↔ video): seconds 5–9 mean nothing for
      images. New videos start untrimmed because recording timing differs. Camera, text, and tracks
      remain unchanged, as intended.
    */
    const shots = s.shots.map((x) => {
      let next = x;
      const m = x.screenName ? assign[screenKey(x.screenName)] : undefined;
      if (m) {
        hit.add(screenKey(x.screenName));
        next = {
          ...next,
          media: m.url,
          mediaKind: m.kind,
          mediaName: m.name,
          // Without reapplication, the old redaction list would describe the new image incorrectly.
          redactions: m.redactions,
          ...(m.kind === 'video' || x.mediaKind !== m.kind ? { trim: { in: 0, out: null }, playbackRate: 1 } : {}),
        };
      }
      let extrasChanged = false;
      const extras = x.extras.map((e) => {
        const em = e.screenName ? assign[screenKey(e.screenName)] : undefined;
        if (!em) return e;
        hit.add(screenKey(e.screenName));
        extrasChanged = true;
        return { ...e, media: em.url, mediaKind: em.kind, mediaName: em.name, redactions: em.redactions };
      });
      if (extrasChanged) next = { ...next, extras };
      if (next !== x) scenes += 1;
      return next;
    });
    const nums = shots.map((x) => Number(/^Shot (\d+)/.exec(x.label)?.[1] ?? 0));
    let n = Math.max(0, ...nums);
    const src = shots[shots.length - 1];
    const added: Shot[] = newScenes.map((m) => {
      n += 1;
      return {
        ...makeShot(n),
        id: nextShotId(),
        label: `Shot ${n}`,
        deviceId: src.deviceId,
        finishId: src.finishId,
        media: m.url,
        mediaKind: m.kind,
        mediaName: m.name,
        screenName: screenNameFromFile(m.name),
        crop: { ...src.crop },
        camera: { ...src.camera },
        scene: { ...src.scene },
        light: { ...src.light },
        statusBar: { ...src.statusBar },
        border: { ...src.border },
        layoutId: src.layoutId,
        mainSlot: { ...src.mainSlot },
        extras: src.extras.map((e) => ({ ...e })),
      };
    });
    if (!scenes && !added.length) return { screens: 0, scenes: 0, added: 0 };
    set({ shots: [...shots, ...added], playing: false });
    return { screens: hit.size, scenes, added: added.length };
  },
  setMotion: (motionId) => get().patchShot({ motionId }),
  toggleVideoMode: () => set((s) => ({ videoMode: !s.videoMode })),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPlaying: (playing) => set({ playing, autoplayCancelled: true }),
  setPlayhead: (playhead) => set({ playhead }),

  // Starting recording pauses playback so the scene stays still
  // and users know which second they are editing.
  // If the playhead is outside the active scene, move it to the start;
  // previously it silently clamped to 0, leaving users wondering
  // why every edit was written at the start.
  toggleRecording: () =>
    set((s) => {
      if (s.recording) return { recording: false, playing: false };
      const shot = s.shots.find((x) => x.id === s.activeShotId) ?? s.shots[0];
      const start = shotStart(s.shots, shot.id);
      const inside = s.playhead >= start && s.playhead < start + shot.duration;
      return { recording: true, playing: false, playhead: inside ? s.playhead : start };
    }),

  clearKeyframes: () => get().patchShot({ tracks: [], keyframes: [], keyframed: {} }),

  /*
    Do not use patchShot: multi-selection copies array fields such as tracks wholesale (diffPatch
    merges only plain-object fields), replacing other scenes' blur/light/scroll tracks with the
    active scene's remaining tracks. Filter each scene's own tracks here.
  */
  dropCameraTracks: () => {
    const s = get();
    const multi = s.selectedShotIds.length > 1 && s.selectedShotIds.includes(s.activeShotId);
    const ids = multi ? s.selectedShotIds : [s.activeShotId];
    let n = 0;
    const shots = s.shots.map((x) => {
      if (!ids.includes(x.id)) return x;
      const tracks = x.tracks.filter((t) => !t.path.startsWith('camera.'));
      if (tracks.length === x.tracks.length && !x.keyframes.length) return x;
      n += 1;
      // Focus markers depend on camera keyframes and would be stale without them.
      return { ...x, tracks, keyframes: [], keyframed: {}, focusMarks: undefined };
    });
    if (n) set({ shots });
    return n;
  },

  goToShot: (id) =>
    set((s) => ({
      activeShotId: id,
      playhead: shotStart(s.shots, id),
      playing: false,
    })),

  duplicateShot: (id) =>
    set((s) => {
      const index = s.shots.findIndex((x) => x.id === id);
      if (index < 0) return s;
      const source = s.shots[index];
      const copy: Shot = {
        ...source,
        // Counter-based ID: two copies in one millisecond previously collided.
        id: nextShotId(),
        label: `${source.label} copy`,
        // Avoid shared references, which would make later edits affect both copies.
        camera: { ...source.camera },
        keyframes: source.keyframes.map((k) => ({ t: k.t, camera: { ...k.camera } })),
        keyframed: { ...source.keyframed },
        blur: { ...source.blur },
        scene: { ...source.scene },
        border: { ...source.border },
        light: { ...source.light },
      };
      const shots = [...s.shots];
      shots.splice(index + 1, 0, copy);
      return { shots, activeShotId: copy.id };
    }),

  removeShot: (id) =>
    set((s) => {
      // Do not delete the last shot: an empty timeline shows nothing.
      if (s.shots.length <= 1) return s;
      const shots = s.shots.filter((x) => x.id !== id);
      const activeShotId = s.activeShotId === id ? shots[0].id : s.activeShotId;
      return { shots, activeShotId, playhead: 0 };
    }),

  setShotDuration: (id, seconds) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === id ? { ...x, duration: Math.min(12, Math.max(0.5, seconds)) } : x,
      ),
    })),

  setShotTransition: (id, patch) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === id
          ? {
              ...x,
              transition: {
                kind: patch.kind ?? x.transition?.kind ?? 'cut',
                duration: Math.min(
                  2,
                  Math.max(0.1, patch.duration ?? x.transition?.duration ?? 0.4),
                ),
              },
            }
          : x,
      ),
    })),

  copyShot: () => {
    const s = get();
    const source = s.shots.find((x) => x.id === s.activeShotId);
    if (!source) return false;
    // Deep copy: the source scene may change while the clipboard waits.
    shotClipboard = JSON.parse(JSON.stringify(source)) as Shot;
    return true;
  },

  pasteShot: () => {
    const clip = shotClipboard;
    if (!clip) return false;
    set((s) => {
      const index = s.shots.findIndex((x) => x.id === s.activeShotId);
      const copy: Shot = {
        ...(JSON.parse(JSON.stringify(clip)) as Shot),
        id: nextShotId(),
        label: `${clip.label} copy`,
      };
      const shots = [...s.shots];
      shots.splice(index + 1, 0, copy);
      return { shots, activeShotId: copy.id };
    });
    return true;
  },

  activeTextId: null,
  selectText: (activeTextId) => set({ activeTextId }),

  applyLayout: (id) =>
    set((s) => {
      const layout = getLayout(id);
      const shot = s.shots.find((x) => x.id === s.activeShotId);
      const device = shot?.deviceId ?? DEFAULT_DEVICE;
      const finish = shot?.finishId ?? getDevice(device).finishes[0].id;
      return {
        shots: s.shots.map((x) =>
          x.id === s.activeShotId
            ? {
                ...x,
                layoutId: id,
                /*
                  Changing layout removes slot tracks: keyframes describe old positions and would
                  pull devices back there. Keep the recipe so the panel can suggest recomposing.
                */
                tracks: x.tracks.filter((tr) => !isSlotPath(tr.path)),
                mainSlot: layout.main,
                extras: layout.slots.map((slot, i) => {
                  // Preserve existing extra-device media and finishes:
                  // changing layout must not erase uploaded screens.
                  const prev = x.extras[i];
                  return {
                    id: prev?.id ?? `extra-${i}-${Date.now().toString(36)}`,
                    deviceId: prev?.deviceId ?? device,
                    finishId: prev?.finishId ?? finish,
                    media: prev?.media ?? null,
                    mediaKind: prev?.mediaKind ?? ('image' as const),
                    mediaName: prev?.mediaName ?? null,
                    screenName: prev?.screenName ?? null,
                    redactions: prev?.redactions,
                    ...slot,
                  };
                }),
              }
            : x,
        ),
      };
    }),

  patchExtra: (id, patch) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === s.activeShotId
          ? { ...x, extras: x.extras.map((e) => (e.id === id ? { ...e, ...patch } : e)) }
          : x,
      ),
    })),

  removeExtra: (id) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === s.activeShotId
          ? {
              ...x,
              extras: x.extras.filter((e) => e.id !== id),
              // Remove deleted devices' slot tracks to avoid orphans.
              tracks: x.tracks.filter((tr) => !tr.path.startsWith(`extras.${id}.`)),
            }
          : x,
      ),
    })),

  applyTemplate: (patch) =>
    set((s) => ({
      shots: s.shots.map((x) => (x.id === s.activeShotId ? applyTemplateTo(x, patch) : x)),
    })),

  addEffect: (id, value) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === s.activeShotId && !x.effects.some((e) => e.id === id)
          ? { ...x, effects: [...x.effects, { id, value, on: true }] }
          : x,
      ),
    })),

  patchEffect: (id, patch) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === s.activeShotId
          ? { ...x, effects: x.effects.map((e) => (e.id === id ? { ...e, ...patch } : e)) }
          : x,
      ),
    })),

  removeEffect: (id) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === s.activeShotId ? { ...x, effects: x.effects.filter((e) => e.id !== id) } : x,
      ),
    })),

  addText: (kind) =>
    set((s) => {
      const item = makeTextItem(kind);
      /*
        Choose text color for the background. Fixed white was invisible on near-white backgrounds
        (glaze #f6f7fb→#d4d9ea), making added text appear absent and barely visible in exports.
        Logos are images and remain untouched.
      */
      if (kind !== 'logo') {
        const shot = s.shots.find((x) => x.id === s.activeShotId);
        const bg = shot ? getBackground(shot.scene.backgroundId) : null;
        item.color = bg && !isDarkBackground(bg) ? '#14161a' : '#ffffff';
        /*
          Brand kit: heading/body fonts and first color are defaults. Use kit color only if present;
          otherwise retain the background-contrast rule above.
        */
        const kit = getBrandKit();
        if (kind === 'text' && kit.headingFont) item.font = kit.headingFont;
        if (kind === 'ticker' && kit.bodyFont) item.font = kit.bodyFont;
        if (kit.colors[0]) item.color = kit.colors[0];
      }
      /*
        Move the playhead to entrance end. Like the color issue, adding text appeared ineffective:
        default `enter: 'fade'` at time 0 renders opacity 0. Measured: invisible at t=0, faint at
        0.2, full at 0.5; PNG export at the same playhead also omitted text. Keep the deliberate
        fade default (see `makeTextItem`); seeking to its end preserves playback animation while
        making the item immediately visible.
      */
      const shots = s.shots.map((x) =>
        x.id === s.activeShotId ? { ...x, texts: [...x.texts, item] } : x,
      );
      const idx = shots.findIndex((x) => x.id === s.activeShotId);
      const startOfShot = shots
        .slice(0, idx + 1)
        .reduce((sum, x, k) => sum + (x.gapBefore ?? 0) + (k < idx ? x.duration : 0), 0);
      const visibleAt = startOfShot + item.start + (item.enter === 'none' ? 0 : item.transitionDur);
      const shot = shots[idx];
      /* Stay inside the scene: entrance duration may exceed a short scene. */
      const clamped = Math.min(visibleAt, startOfShot + (shot?.duration ?? 0));
      return {
        shots,
        activeTextId: item.id,
        playhead: s.playhead < clamped ? clamped : s.playhead,
      };
    }),

  patchText: (id, patch) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === s.activeShotId
          ? { ...x, texts: x.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
          : x,
      ),
    })),

  patchTextIn: (shotId, id, patch) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === shotId
          ? { ...x, texts: x.texts.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
          : x,
      ),
    })),

  removeText: (id) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === s.activeShotId ? { ...x, texts: x.texts.filter((t) => t.id !== id) } : x,
      ),
      activeTextId: s.activeTextId === id ? null : s.activeTextId,
    })),

  placingAnnotationId: null,

  applyBrandKit: (kit) => {
    const s = get();
    const shot = s.shots.find((x) => x.id === s.activeShotId);
    if (!shot) return 0;
    let n = 0;
    const texts = shot.texts.map((t) => {
      if (t.kind === 'logo') {
        if (!kit.logo || t.src === kit.logo) return t;
        n += 1;
        return { ...t, src: kit.logo };
      }
      const font = t.kind === 'ticker' ? (kit.bodyFont ?? t.font) : (kit.headingFont ?? t.font);
      const color = kit.colors[0] ?? t.color;
      const bandColor = t.kind === 'ticker' && kit.colors[1] ? kit.colors[1] : t.bandColor;
      if (font === t.font && color === t.color && bandColor === t.bandColor) return t;
      n += 1;
      return { ...t, font, color, bandColor };
    });
    if (kit.logo && !texts.some((t) => t.kind === 'logo')) {
      // Without a logo, add a small one at top left (same item type as text).
      texts.push({ ...makeTextItem('logo'), src: kit.logo, text: 'Brand logo', x: 0.12, y: 0.1, size: 0.1 });
      n += 1;
    }
    if (n) set({ shots: s.shots.map((x) => (x.id === shot.id ? { ...x, texts } : x)) });
    return n;
  },

  baseLang: 'en',
  languages: [],
  previewLang: null,
  addLanguage: (raw) => {
    const code = normalizeLangCode(raw);
    const s = get();
    if (!code || code === s.baseLang) return null;
    if (!s.languages.includes(code)) set({ languages: [...s.languages, code] });
    return code;
  },
  removeLanguage: (code) =>
    // Keep translations on text items so re-adding a language restores the work.
    set((s) => ({
      languages: s.languages.filter((l) => l !== code),
      previewLang: s.previewLang === code ? null : s.previewLang,
    })),
  setBaseLang: (raw) => {
    const code = normalizeLangCode(raw);
    if (code) set((s) => ({ baseLang: code, languages: s.languages.filter((l) => l !== code) }));
  },
  setPreviewLang: (code) => set((s) => ({ previewLang: code && s.languages.includes(code) ? code : null })),
  importTranslations: (table) => {
    const s = get();
    const head = table[0] ?? [];
    const cols = head.slice(1).map((h) => normalizeLangCode(h ?? ''));
    const langs = [...new Set(cols.filter((c): c is string => !!c && c !== s.baseLang))];
    const rows = new Map<string, Record<string, string>>();
    for (const row of table.slice(1)) {
      const key = (row[0] ?? '').trim();
      if (!key) continue;
      const tr: Record<string, string> = {};
      cols.forEach((c, j) => {
        const v = (row[j + 1] ?? '').trim();
        if (c && c !== s.baseLang && v) tr[c] = v;
      });
      if (Object.keys(tr).length) rows.set(key, { ...(rows.get(key) ?? {}), ...tr });
    }
    const hit = new Set<string>();
    let texts = 0;
    const shots = s.shots.map((x) => {
      let changed = false;
      const out = x.texts.map((t) => {
        if (t.kind === 'logo') return t;
        const tr = rows.get(t.text.trim());
        if (!tr) return t;
        hit.add(t.text.trim());
        changed = true;
        texts += 1;
        return { ...t, i18n: { ...(t.i18n ?? {}), ...tr } };
      });
      return changed ? { ...x, texts: out } : x;
    });
    set({ shots, languages: [...s.languages, ...langs.filter((l) => !s.languages.includes(l))] });
    return { matched: hit.size, unmatched: rows.size - hit.size, texts, langs };
  },

  previewShot: null,
  previewCover: null,
  beatSnap: true,
  setBeatSnap: (beatSnap) => set({ beatSnap }),

  cutShotsOnBeats: (beats, every) => {
    const s = get();
    if (beats.length < 2 || every < 1) return 0;
    const B = beats;
    const EPS = 0.03;
    /** Index of the first beat after `t` (with EPS tolerance), or −1 if absent. */
    const firstFrom = (t: number) => B.findIndex((b) => b >= t - EPS);
    let changed = 0;
    let prevEnd = 0;
    const shots = s.shots.map((x) => {
      let gapBefore = x.gapBefore;
      let start = prevEnd + gapBefore;
      // Snap post-gap scene starts too; retain the gap, adjusting it to a beat.
      if (gapBefore > 0) {
        const k = firstFrom(start);
        const cands = [B[k - 1], B[k]].filter((b): b is number => b !== undefined && b > prevEnd + 0.05);
        const b = cands.sort((p, q) => Math.abs(p - start) - Math.abs(q - start))[0];
        if (b !== undefined) {
          gapBefore = b - prevEnd;
          start = b;
        }
      }
      const k = firstFrom(start);
      // End after `every` beats; halve if over 12 seconds, double if under 0.5 seconds.
      let m = every;
      while (m > 1 && k >= 0 && B[k + m] !== undefined && B[k + m] - start > 12) m = Math.max(1, Math.floor(m / 2));
      while (k >= 0 && B[k + m] !== undefined && B[k + m] - start < 0.5) m += every;
      const endBeat = k >= 0 ? B[k + m] : undefined;
      // After music ends, leave the scene unchanged except for a possible start shift.
      if (endBeat === undefined || endBeat - start > 12) {
        prevEnd = start + x.duration;
        if (gapBefore === x.gapBefore) return x;
        changed += 1;
        return { ...x, gapBefore };
      }
      const duration = endBeat - start;
      prevEnd = endBeat;
      if (Math.abs(duration - x.duration) < 1e-6 && gapBefore === x.gapBefore) return x;
      changed += 1;
      const f = duration / x.duration;
      // Do not let times rounded to 0.01 exceed the new duration; keep the final keyframe inside.
      const rt = (t: number) => Math.min(Math.round(t * f * 100) / 100, Math.floor(duration * 100) / 100);
      return {
        ...x,
        gapBefore,
        duration,
        tracks: x.tracks.map((tr) => ({ ...tr, keyframes: tr.keyframes.map((kf) => ({ ...kf, t: rt(kf.t) })) })),
        texts: x.texts.map((t) => ({ ...t, start: rt(t.start), end: t.end === null ? null : rt(t.end) })),
        annotations: x.annotations.map((a) => ({ ...a, start: rt(a.start), end: a.end === null ? null : rt(a.end) })),
        // Scale auto-motion markers with the same rounding as keyframes, or they would disappear.
        focusMarks: x.focusMarks?.map((m) => ({ t: rt(m.t), end: rt(m.end) })),
      };
    });
    if (changed) set({ shots });
    return changed;
  },

  addAnnotation: (kind) =>
    set((s) => {
      const shot = s.shots.find((x) => x.id === s.activeShotId);
      if (!shot) return {};
      /*
        Start at the scene-local playhead to mark currently visible content. Avoid the last 0.3
        seconds: a tap ripple would not fit and its window would remain invisible.
      */
      const t = Math.max(0, Math.min(localTimeIn(s, shot), shot.duration - 0.3));
      const item = makeAnnotation(kind, Math.floor(t * 10) / 10);
      /*
        Move the playhead to entrance end, as in addText: ring/spotlight begin at opacity 0, and the
        cursor reaches its target at 0.55 seconds. Users must see annotations while placing them.
      */
      const settle = { tap: 0.15, ring: 0.45, spotlight: 0.45, cursor: 0.6 }[kind];
      const begin = shotStart(s.shots, shot.id);
      return {
        shots: s.shots.map((x) =>
          x.id === shot.id ? { ...x, annotations: [...x.annotations, item] } : x,
        ),
        placingAnnotationId: item.id,
        playing: false,
        /*
          ⚠️ Stay inside the scene: exactly `begin + duration` starts the next scene, moving
          selection and closing placement mode because it cannot find the annotation.
        */
        playhead: begin + Math.max(0, Math.min(item.start + settle, shot.duration - 0.05)),
      };
    }),

  patchAnnotation: (id, patch) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === s.activeShotId
          ? { ...x, annotations: x.annotations.map((a) => (a.id === id ? { ...a, ...patch } : a)) }
          : x,
      ),
    })),

  removeAnnotation: (id) =>
    set((s) => ({
      shots: s.shots.map((x) =>
        x.id === s.activeShotId ? { ...x, annotations: x.annotations.filter((a) => a.id !== id) } : x,
      ),
      placingAnnotationId: s.placingAnnotationId === id ? null : s.placingAnnotationId,
    })),

  consumeCapture: () => {
    const s = get();
    if (s.isPro) return true;
    if (s.capturesLeft <= 0) return false;
    const capturesLeft = s.capturesLeft - 1;
    set({ capturesLeft });
    persistCaptures(capturesLeft);
    return true;
  },
}));

/*
  Persist free capture limits: refreshing previously restored all 3 captures, defeating the paywall.
  `typeof window` is required because build prerender also evaluates this module; unguarded
  localStorage breaks static export.
*/
function readPersistedCaptures(): number {
  if (typeof window === 'undefined') return FREE_CAPTURES;
  try {
    const raw = window.localStorage.getItem(CAPTURES_KEY);
    if (raw === null) return FREE_CAPTURES;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(FREE_CAPTURES, Math.max(0, n)) : FREE_CAPTURES;
  } catch {
    return FREE_CAPTURES;
  }
}

function persistCaptures(n: number) {
  try {
    window.localStorage.setItem(CAPTURES_KEY, String(n));
  } catch {
    // Without storage, the allowance lasts only for the tab's lifetime.
  }
}

/*
  Pro gates until Stripe integration. ⚠️ An old comment incorrectly claimed production enabling
  through `?unlock=<key>` after key removal, silently breaking three production tests. Current
  behavior: `debug.setPro` enables only on localhost; `?unlock=on` enables only on localhost, any
  value disables in production. `?unlock=off` disables everywhere, allowing paywall inspection
  without clearing browser data. This client gate is not a security boundary; paid access will
  require server-provided `isPro`.
*/
function readPersistedPro(): boolean {
  // When everything is free, ignore the saved flag so nobody loses access.
  if (FREE_FOR_ALL) return true;
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PRO_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Theme preference read/write. The inline script in `layout.tsx` reads the same key; update both
 * places when changing it.
 */
export function readPersistedTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function setThemePersisted(t: Theme) {
  try {
    window.localStorage.setItem(THEME_KEY, t);
  } catch {
    // Without storage, the preference lasts only for the tab's lifetime.
  }
}

/** Enable/disable Pro and persist it. */
export function setProPersisted(v: boolean) {
  /*
    Disable guard: `?unlock=off` and `debug.setPro(false)` could lock the product while everything
    was free. Ignore disabling requests while the constant is enabled.
  */
  if (FREE_FOR_ALL) {
    useEditor.setState({ isPro: true });
    return;
  }
  useEditor.setState({ isPro: v });
  try {
    if (v) window.localStorage.setItem(PRO_KEY, '1');
    else window.localStorage.removeItem(PRO_KEY);
  } catch {
    // Without storage, unlocking lasts only for the tab's lifetime.
  }
}

/**
 * Apply the URL's `?unlock=` parameter and clean the URL. `?unlock=on` enables Pro only on
 * localhost; every value disables in production. Returns 'on' or 'off' if something changed,
 * otherwise null.
 */
export function applyOwnerUnlock(): 'on' | 'off' | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const key = url.searchParams.get('unlock');
  if (key === null) return null;
  const on = key === 'on' && window.location.hostname === 'localhost';
  setProPersisted(on);
  url.searchParams.delete('unlock');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  return on ? 'on' : 'off';
}

/** Playhead time local to the given scene (0..duration). */
function localTimeIn(s: { playhead: number; shots: Shot[] }, shot: Shot): number {
  const local = s.playhead - shotStart(s.shots, shot.id);
  return Math.round(Math.min(Math.max(0, local), shot.duration) * 100) / 100;
}

/** Evaluate the scene at a local time, applying tracks over base values. */
export function evaluateShot(shot: Shot, t: number): Shot {
  if (!shot.tracks.length) return shot;
  let out = shot;
  for (const track of shot.tracks) {
    const v = evaluateTrack(track, t);
    if (v !== undefined) out = setByPath(out, track.path, v);
  }
  return out;
}

/** Total duration for the timeline ruler and playback. */
export function totalDuration(shots: Shot[]): number {
  return shots.reduce((sum, s) => sum + (s.gapBefore ?? 0) + s.duration, 0);
}

/** Shot start time on the timeline. */
export function shotStart(shots: Shot[], id: string): number {
  let acc = 0;
  for (const s of shots) {
    acc += s.gapBefore ?? 0;
    if (s.id === id) return acc;
    acc += s.duration;
  }
  return 0;
}

/**
 * Which shot plays at a global time? Playback needs one authoritative timeline to cross scenes.
 * Each shot derives local time from it.
 */
export function shotAtTime(
  shots: Shot[],
  time: number,
): { shot: Shot; index: number; start: number; localTime: number; inGap: boolean } {
  let acc = 0;
  for (let i = 0; i < shots.length; i += 1) {
    const s = shots[i];
    const gap = s.gapBefore ?? 0;
    // Inside a gap: this scene has not started. Return it so the panel
    // has something to display, but set `inGap` so scene rendering
    // can hide it.
    if (gap > 0 && time < acc + gap) {
      return { shot: s, index: i, start: acc + gap, localTime: 0, inGap: true };
    }
    acc += gap;
    if (time < acc + s.duration || i === shots.length - 1) {
      return { shot: s, index: i, start: acc, localTime: Math.max(0, time - acc), inGap: false };
    }
    acc += s.duration;
  }
  return { shot: shots[0], index: 0, start: 0, localTime: 0, inGap: false };
}


/*
  Multi-edit diff. Panels often copy the active scene's nested object (`scene: { ...shot.scene,
  transparent }`). Copying it wholesale would overwrite other scenes' backgrounds/lighting.
  Propagate only changed fields, comparing nested objects by key.
*/
function diffPatch(active: Record<string, unknown> | Shot, patch: Record<string, unknown>) {
  const a = active as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    const cur = a[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      const sub: Record<string, unknown> = {};
      for (const [kk, vv] of Object.entries(v as Record<string, unknown>)) {
        if (JSON.stringify((cur as Record<string, unknown>)[kk]) !== JSON.stringify(vv)) sub[kk] = vv;
      }
      if (Object.keys(sub).length) out[k] = { __merge: true, ...sub };
    } else if (JSON.stringify(cur) !== JSON.stringify(v)) {
      out[k] = v;
    }
  }
  return out;
}

function applyDiff(x: Shot, diff: Record<string, unknown>): Shot {
  const r = { ...x } as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(diff)) {
    if (v && typeof v === 'object' && (v as Record<string, unknown>).__merge) {
      const { __merge: _m, ...rest } = v as Record<string, unknown>;
      void _m;
      r[k] = { ...(r[k] as Record<string, unknown>), ...rest };
    } else {
      r[k] = v;
    }
  }
  return r as unknown as Shot;
}
