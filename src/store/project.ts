'use client';

import {
  DEVICE_MOTION_DEFAULT,
  makeAnnotation,
  makeShot,
  makeTextItem,
  nextShotId,
  normalizeLangCode,
  useEditor,
  type Annotation,
  type AnnotationKind,
  type AudioTrack,
  type Shot,
  type TextItem,
} from '@/store/editor';
import type { Keyframe } from '@/config/motion';
import { EASINGS, makeKeyframe, type Bezier, type EasingId, type PropertyTrack } from '@/config/tracks';
import { makeDemoShots } from '@/config/demo';
import { migrateAspectId } from '@/config/aspects';
import { buildMagicReel, type MagicReelInput } from '@/config/reel';
import { screenNameFromFile } from '@/config/screens';
import { cleanRedactions } from '@/config/redact';
import { detachFromShelf } from '@/store/shelfState';
import type { Pack, PackInput } from '@/config/packs';

/**
 * Project saving and loading. Two separate needs: 1) AUTOSAVE (localStorage) protects the setup if the
 * tab closes accidentally. Media is excluded: even one screenshot as a data URL can take megabytes and
 * exceed the quota. 2) PROJECT FILE (.json download) supports transfer, archiving, and sharing with
 * clients. Media is embedded as data URLs: a larger, self-contained file with no separate images to
 * carry.
 */

const AUTOSAVE_KEY = 'mockuptop:autosave:v1';

export type ProjectFile = {
  format: 'mockuptop';
  version: 1;
  aspectId: string;
  /** Legacy files: layouts used to be global; they are now per scene. */
  layoutId?: string;
  mainSlot?: { x: number; y: number; z: number; rotY: number; scale: number };
  shots: Shot[];
  /** Audio tracks: URLs omitted from autosave, embedded in project files. */
  audioTracks?: AudioTrack[];
  /** Localization: base language and additional languages. Legacy defaults: 'en' / []. */
  baseLang?: string;
  languages?: string[];
};

/** Convert a blob/object URL to a portable data URL. */
async function toDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Snapshot of saved state, including media URLs; also used by the project shelf. */
export function projectSnapshot(): ProjectFile {
  return snapshot();
}

function snapshot(): ProjectFile {
  const s = useEditor.getState();
  return {
    format: 'mockuptop',
    version: 1,
    aspectId: s.aspectId,
    shots: s.shots,
    audioTracks: s.audioTracks,
    baseLang: s.baseLang,
    languages: s.languages,
  };
}

/** Build a complete project file with embedded media. */
export async function exportProject(): Promise<Blob> {
  const base = snapshot();
  const shots = await Promise.all(
    base.shots.map(async (shot) => ({
      ...shot,
      media: await toDataUrl(shot.media),
      scene: { ...shot.scene, bgImage: await toDataUrl(shot.scene.bgImage) },
      extras: await Promise.all(
        shot.extras.map(async (e) => ({ ...e, media: await toDataUrl(e.media) })),
      ),
    })),
  );
  // Embed audio in the project file to keep it portable and self-contained.
  const audioTracks = await Promise.all(
    (base.audioTracks ?? []).map(async (a) => ({ ...a, url: await toDataUrl(a.url) })),
  );
  /*
    Embed logos too. Uploading with "+ Logo" creates a `blob:` URL. Previously, screen media,
    backgrounds, and audio were embedded but text-layer logos kept their URLs, so projects opened
    without logos in another browser or after the tab closed. Brand-kit logos are already data URLs;
    bundled `/` paths remain unchanged.
  */
  const withLogos = await Promise.all(
    shots.map(async (shot) => ({
      ...shot,
      texts: await Promise.all(
        shot.texts.map(async (t) =>
          t.kind === 'logo' && t.src && t.src.startsWith('blob:') ? { ...t, src: await toDataUrl(t.src) } : t,
        ),
      ),
    })),
  );
  return new Blob([JSON.stringify({ ...base, shots: withLogos, audioTracks }, null, 2)], {
    type: 'application/json',
  });
}

/** Distribute legacy `{t, camera}` keyframes into property tracks. */
function tracksFromLegacy(keys: Keyframe[] | undefined): PropertyTrack[] {
  if (!Array.isArray(keys) || !keys.length) return [];
  const byPath = new Map<string, PropertyTrack>();
  for (const k of [...keys].sort((a, b) => a.t - b.t)) {
    for (const [field, value] of Object.entries(k.camera ?? {})) {
      if (typeof value !== 'number') continue;
      const path = `camera.${field}`;
      let track = byPath.get(path);
      if (!track) {
        track = { path, keyframes: [] };
        byPath.set(path, track);
      }
      track.keyframes.push(makeKeyframe(k.t, value));
    }
  }
  return [...byPath.values()];
}

/**
 * Schema migration. Saved projects may come from older versions with missing fields. Reading these as
 * `undefined` can produce NaN in calculations and crash the scene. Overlay every loaded scene on fresh
 * defaults: missing fields get defaults and extra fields are harmless. This is more robust than
 * version-specific migrations and needs no extra migration step when adding fields.
 */
function normalizeShot(raw: Partial<Shot>, index: number): Shot {
  const base = makeShot(index + 1);
  /*
    Migrate the old border default {0.05, glass, 3}. Existing autosaves contain it without an explicit
    user choice. Replace only that exact value with the new default (none); preserve all custom values.
  */
  const b = raw.border;
  const border =
    b && b.style === 'glass' && b.radius === 0.05 && b.width === 3
      ? base.border
      : { ...base.border, ...b };
  // Migrate camera pan too: 0.30/-0.32 was the old default; new projects open centered.
  // A ±0.06 threshold also treats tiny accidental drag offsets as the old default.
  // This prevents nearly unchanged legacy offsets from bypassing centering.
  // Preserve deliberately larger pan values.
  const rc = raw.camera;
  const nearOldDefault =
    rc &&
    typeof rc.panX === 'number' &&
    typeof rc.panY === 'number' &&
    Math.abs(rc.panX - 0.3) < 0.06 &&
    Math.abs(rc.panY + 0.32) < 0.06;
  const camera = nearOldDefault
    ? { ...base.camera, ...rc, panX: 0, panY: 0 }
    : { ...base.camera, ...rc };
  return {
    ...base,
    ...raw,
    camera,
    blur: { ...base.blur, ...raw.blur },
    scene: { ...base.scene, ...raw.scene },
    border,
    light: { ...base.light, ...raw.light },
    statusBar: { ...base.statusBar, ...raw.statusBar },
    deviceOpts: { ...base.deviceOpts, ...raw.deviceOpts },
    trim: { ...base.trim, ...raw.trim },
    /*
      ⚠️ Merge `crop`, `transition`, and `mainSlot` with defaults too. They previously came only from
      `...raw`, unlike other nested fields. A missing field would feed `undefined` into calculations,
      produce NaN, and crash the scene. Current files include all three, but this protects files when new
      fields are added.
    */
    crop: { ...base.crop, ...raw.crop },
    transition: { ...base.transition, ...raw.transition },
    mainSlot: { ...base.mainSlot, ...raw.mainSlot },
    /*
      Validate duration as well as `playbackRate` and `gapBefore`. A manually edited `"duration": "3"`
      turns timeline calculations (`shotStart`, `totalDuration`, export duration) into string operations.
      Fall back to the default unless duration is finite and positive.
    */
    duration:
      typeof raw.duration === 'number' && Number.isFinite(raw.duration) && raw.duration > 0
        ? raw.duration
        : base.duration,
    playbackRate: typeof raw.playbackRate === 'number' ? raw.playbackRate : 1,
    mediaName: raw.mediaName ?? null,
    /*
      For legacy files, derive missing screen names from the filename, preserving the user's own naming.
      Empty or non-string values also fall back to the filename.
    */
    screenName:
      typeof raw.screenName === 'string' && raw.screenName.trim()
        ? raw.screenName.trim().slice(0, 40)
        : screenNameFromFile(raw.mediaName ?? null),
    redactions: cleanRedactions(raw.redactions),
    gapBefore: typeof raw.gapBefore === 'number' ? Math.max(0, raw.gapBefore) : 0,
    /*
      Migrate legacy camera keyframes to property tracks (config/tracks.ts). The old model stored the
      entire camera in each keyframe; the new model stores each property separately. Preserve saved
      animation by distributing fields into their tracks, then clear the legacy field so opening the file
      migrates it once.
    */
    tracks: Array.isArray(raw.tracks) && raw.tracks.length
      ? cleanTracks(raw.tracks)
      : tracksFromLegacy(raw.keyframes),
    keyframes: [],
    keyframed: {},
    // Legacy files without annotations get an empty list.
    annotations: Array.isArray(raw.annotations) ? cleanAnnotations(raw.annotations) : [],
    // Discard non-object translations in manually edited files.
    texts: Array.isArray(raw.texts)
      ? cleanTexts(raw.texts).map((t) => (t.i18n && typeof t.i18n === 'object' ? t : { ...t, i18n: undefined }))
      : [],
    // Auto-motion ruler marks: accept only numeric pairs.
    focusMarks: Array.isArray(raw.focusMarks)
      ? raw.focusMarks.filter((m) => m && typeof m.t === 'number' && typeof m.end === 'number')
      : undefined,
    // Device motion recipe (panel memory only): fill missing fields from defaults.
    deviceMotion:
      raw.deviceMotion && typeof raw.deviceMotion === 'object'
        ? { ...DEVICE_MOTION_DEFAULT, ...raw.deviceMotion, per: { ...(raw.deviceMotion.per ?? {}) } }
        : undefined,
    effects: Array.isArray(raw.effects) ? cleanEffects(raw.effects) : [],
    extras: Array.isArray(raw.extras) ? cleanExtras(raw.extras, base.finishId) : [],
    id: raw.id ?? base.id,
    label: raw.label ?? base.label,
  };
}

/*
  Validate array entries too. `normalizeShot` merged nested objects with defaults but did not inspect
  arrays. Files containing `tracks: [{"path":"camera.panX"}]` without keyframes or `extras: [null]`
  loaded successfully, then crashed during first-frame evaluation or device-list access outside the
  file-reading try/catch. Drop invalid entries, fill missing fields with defaults, and load the rest
  of the file.
*/
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const EASING_IDS = new Set<string>(EASINGS.map((e) => e.id));

function cleanTracks(list: unknown[]): PropertyTrack[] {
  const out: PropertyTrack[] = [];
  for (const tr of list) {
    if (!isObj(tr) || typeof tr.path !== 'string' || !Array.isArray(tr.keyframes)) continue;
    const keyframes = tr.keyframes
      .filter((k): k is Record<string, unknown> => isObj(k) && Number.isFinite(k.t) && Number.isFinite(k.value))
      .map((k) => {
        const fresh = makeKeyframe(k.t as number, k.value as number);
        const ease = (v: unknown) => (typeof v === 'string' && EASING_IDS.has(v) ? (v as EasingId) : fresh.easingIn);
        const bz = Array.isArray(k.bezier) && k.bezier.length === 4 && k.bezier.every((n) => Number.isFinite(n));
        return {
          ...fresh,
          id: typeof k.id === 'string' ? k.id : fresh.id,
          easingIn: ease(k.easingIn),
          easingOut: ease(k.easingOut),
          ...(bz && { bezier: k.bezier as Bezier }),
        };
      })
      .sort((a, b) => a.t - b.t);
    if (keyframes.length) out.push({ ...(tr as unknown as PropertyTrack), keyframes });
  }
  return out;
}

/*
  Do not apply all text defaults: missing fields in older files can determine their appearance (for
  example, effects added later). A full merge would change existing projects. Repair only fields used
  for timing and identity.
*/
function cleanTexts(list: unknown[]): TextItem[] {
  return list.filter(isObj).map((t) => {
    const kind = t.kind === 'ticker' || t.kind === 'logo' ? t.kind : 'text';
    const id = typeof t.id === 'string' ? t.id : makeTextItem(kind).id;
    const end = t.end === null || t.end === undefined ? null : num(t.end, NaN);
    return {
      ...(t as Partial<TextItem>),
      id,
      kind,
      start: Math.max(0, num(t.start, 0)),
      end: Number.isNaN(end) ? null : end,
    } as TextItem;
  });
}

const ANNOTATION_KINDS = new Set<AnnotationKind>(['tap', 'ring', 'spotlight', 'cursor']);
function cleanAnnotations(list: unknown[]): Annotation[] {
  return list
    .filter((a): a is Record<string, unknown> => isObj(a) && ANNOTATION_KINDS.has(a.kind as AnnotationKind))
    .map((a) => ({ ...makeAnnotation(a.kind as AnnotationKind), ...(a as Partial<Annotation>) }) as Annotation);
}

function cleanEffects(list: unknown[]): Shot['effects'] {
  return list
    .filter((e): e is Record<string, unknown> => isObj(e) && typeof e.id === 'string')
    .map((e) => ({ ...e, value: num(e.value, 0), on: e.on !== false }) as Shot['effects'][number]);
}

let extraSeq = 0;
function cleanExtras(list: unknown[], finishId: string): Shot['extras'] {
  return list
    .filter((e): e is Record<string, unknown> => isObj(e) && typeof e.deviceId === 'string')
    .map((e) => ({
      ...e,
      id: typeof e.id === 'string' ? e.id : `extra-fix-${Date.now().toString(36)}-${(extraSeq += 1)}`,
      deviceId: e.deviceId as string,
      finishId: typeof e.finishId === 'string' ? e.finishId : finishId,
      media: typeof e.media === 'string' ? e.media : null,
      mediaKind: e.mediaKind === 'video' ? ('video' as const) : ('image' as const),
      mediaName: typeof e.mediaName === 'string' ? e.mediaName : null,
      screenName:
        typeof e.screenName === 'string' && e.screenName.trim()
          ? e.screenName.trim().slice(0, 40)
          : screenNameFromFile(typeof e.mediaName === 'string' ? e.mediaName : null),
      redactions: cleanRedactions(e.redactions),
      x: num(e.x, 0),
      y: num(e.y, 0),
      z: num(e.z, 0),
      rotY: num(e.rotY, 0),
      scale: num(e.scale, 1),
    }));
}

function cleanAudio(list: unknown): AudioTrack[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((a): a is Record<string, unknown> => isObj(a) && typeof a.id === 'string')
    .map((a) => ({
      ...(a as Partial<AudioTrack>),
      id: a.id as string,
      name: typeof a.name === 'string' ? a.name : 'audio',
      url: typeof a.url === 'string' ? a.url : null,
      start: num(a.start, 0),
      volume: num(a.volume, 0.8),
      duration: num(a.duration, 0),
    }) as AudioTrack);
}

export function applyProject(data: unknown): boolean {
  const p = data as ProjectFile;
  if (!p || p.format !== 'mockuptop' || !Array.isArray(p.shots) || !p.shots.length) return false;
  /*
    Legacy files had a global layout. Apply it to scenes without layoutId. New files store layouts per
    scene and omit global fields.
  */
  // Do not replace `mainSlot` wholesale: a missing legacy global field
  // such as `scale` produced NaN dimensions and made the device disappear.
  const globalLayout =
    p.layoutId && p.mainSlot ? { layoutId: p.layoutId, mainSlot: p.mainSlot } : null;
  const shots = p.shots.map((raw, i) => {
    const n = normalizeShot(raw, i);
    return globalLayout && raw.layoutId === undefined
      ? { ...n, layoutId: globalLayout.layoutId, mainSlot: { ...n.mainSlot, ...globalLayout.mainSlot } }
      : n;
  });
  useEditor.setState({
    shots,
    activeShotId: shots[0].id,
    aspectId: migrateAspectId(p.aspectId ?? 'fill'),
    playhead: 0,
    playing: false,
    audioTracks: cleanAudio(p.audioTracks),
    ...langState(p),
  });
  return true;
}

/** Validate language fields; fall back to the base language if the preview language is absent. */
function langState(p: Partial<ProjectFile>) {
  const baseLang = (typeof p.baseLang === 'string' && normalizeLangCode(p.baseLang)) || 'en';
  const languages = Array.isArray(p.languages)
    ? [...new Set(p.languages.map((l) => (typeof l === 'string' ? normalizeLangCode(l) : null)))].filter(
        (l): l is string => !!l && l !== baseLang,
      )
    : [];
  const prev = useEditor.getState().previewLang;
  return { baseLang, languages, previewLang: prev && languages.includes(prev) ? prev : null };
}

export async function importProjectFile(file: File): Promise<boolean> {
  try {
    const ok = applyProject(JSON.parse(await file.text()));
    // An imported file is a separate project; do not overwrite the shelf entry.
    if (ok) detachFromShelf();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Reset to a new project. Why: autosave restores on every load, so even a hard refresh could not
 * escape a broken scene. Clear autosave and return to fresh state. Ctrl+Z still works because history
 * records the reset snapshot.
 */
export function resetProject() {
  detachFromShelf();
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // Without storage, there is no autosave to clear.
  }
  /*
    Start new projects with one scene. Previously, two scenes opened but device selection and media
    upload affected only the active scene. The second stayed a blank white card, leaving the latter half
    of video exports white (measured: a two-scene, 6-second project was blank at 2.5 seconds). `addShot`
    inherits the active scene's visual setup so new scenes do not look broken. Users add an inherited
    second scene with `+ Scene`.
  */
  const s1 = { ...makeShot(1), id: nextShotId() };
  useEditor.setState({
    shots: [s1],
    activeShotId: s1.id,
    aspectId: 'fill',
    playhead: 0,
    playing: false,
    recording: false,
    activeTextId: null,
    placingAnnotationId: null,
    baseLang: 'en',
    languages: [],
    previewLang: null,
    /*
      ⚠️ Reset audio tracks too: "New project" previously carried music and beat marks into the new
      project. Demo loading already cleared them. Ctrl+Z restores audio because history includes it.
    */
    audioTracks: [],
  });
  // Also clear a shared-link hash so refresh does not restore it.
  try {
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname);
  } catch {
    // Non-critical.
  }
}

/* --- Shareable link --- */

/**
 * Compress scene state into a URL. Exclude media: one screenshot as a data URL takes hundreds of
 * kilobytes, beyond browser address limits. Share the setup; recipients supply their own images to
 * reuse the framing. Use `deflate-raw` + base64url: an uncompressed scene typically takes 6–8 KB and
 * does not fit the address bar.
 */
/*
  Keep references to the shared state. Autosave removes the link only if one changes. Otherwise, an
  800 ms pending save in the "edit → immediately Share" flow could run after sharing and erase the new
  link.
*/
type SharedRefs = Pick<ReturnType<typeof useEditor.getState>, 'shots' | 'aspectId' | 'audioTracks' | 'baseLang' | 'languages'>;
let sharedRefs: SharedRefs | null = null;
function changedSinceShare(): boolean {
  const s = useEditor.getState();
  const r = sharedRefs;
  return (
    !r ||
    s.shots !== r.shots ||
    s.aspectId !== r.aspectId ||
    s.audioTracks !== r.audioTracks ||
    s.baseLang !== r.baseLang ||
    s.languages !== r.languages
  );
}

export async function encodeShareLink(): Promise<string> {
  {
    const s = useEditor.getState();
    sharedRefs = { shots: s.shots, aspectId: s.aspectId, audioTracks: s.audioTracks, baseLang: s.baseLang, languages: s.languages };
  }
  const stripped = stripMedia(snapshot());
  /*
    Exclude logo sources from links. Brand-kit data URLs (~50–500 KB) exceed address-bar limits; object
    URLs are unusable in another browser. Keep only bundled paths ('/…'). Preserve the logo item
    (position, size, timing) so recipients can supply their own logo.
  */
  const data = {
    ...stripped,
    shots: stripped.shots.map((sh) => ({
      ...sh,
      texts: sh.texts.map((t) => (t.kind === 'logo' && t.src && !t.src.startsWith('/') ? { ...t, src: null } : t)),
    })),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const packed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  packed.forEach((b) => (binary += String.fromCharCode(b)));
  const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#s=${b64}`;
}

export async function decodeShareLink(hash: string): Promise<boolean> {
  const raw = hash.startsWith('#s=') ? hash.slice(3) : null;
  if (!raw) return false;
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const text = await new Response(stream).text();
    const ok = applyProject(JSON.parse(text));
    /*
      Clear the URL after import. Shared links correctly take precedence over autosave at startup, but
      leaving them in the address bar made every refresh reopen the link and discard subsequent edits.
    */
    if (ok) {
      clearShareHash();
      detachFromShelf();
    }
    return ok;
  } catch {
    return false;
  }
}

/** Remove the share link from the address bar, preserving the path and query. */
function clearShareHash() {
  try {
    if (window.location.hash.startsWith('#s=')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  } catch {
    // Non-critical.
  }
}

/* --- Autosave --- */

/**
 * Strip media to avoid exceeding the quota. bgImage is media too: one custom background data URL can
 * exhaust localStorage. Keep bundled static paths such as `/demo/...`: these are short strings, and
 * removing them would leave the startup demo without screens after refresh.
 */
const keepMedia = (m: string | null) => (m && m.startsWith('/') ? m : null);

function stripMedia(p: ProjectFile): ProjectFile {
  return {
    ...p,
    /*
      Strip audio files too: a one-minute MP3 data URL takes megabytes and can exhaust localStorage.
      Object URLs expire when the tab closes. Save track metadata (name, start, volume), but let the user
      reupload the file.
    */
    audioTracks: (p.audioTracks ?? []).map((a) => ({ ...a, url: null })),
    shots: p.shots.map((s) => ({
      ...s,
      // Keep the name to identify missing files after refresh.
      media: keepMedia(s.media),
      scene: { ...s.scene, bgImage: keepMedia(s.scene.bgImage) },
      extras: s.extras.map((e) => ({ ...e, media: keepMedia(e.media) })),
      // Uploaded "+ Logo" blob: URLs expire on refresh; keep brand-kit data URLs
      // and bundled '/' paths.
      texts: s.texts.map((t) => (t.kind === 'logo' && t.src?.startsWith('blob:') ? { ...t, src: null } : t)),
    })),
  };
}

/**
 * First-visit demo: without autosave or a shared link, load a five-scene introductory project and play
 * it automatically.
 */
export function loadDemoProject() {
  detachFromShelf();
  const shots = makeDemoShots();
  useEditor.setState({
    shots,
    activeShotId: shots[0].id,
    aspectId: 'fill',
    playhead: 0,
    /*
      Play only when ready. Setting `playing: true` immediately showed a stuttering demo before images
      loaded and shaders compiled, spoiling the first three seconds. Wait for the scene-ready signal
      through the subscription below.
    */
    playing: useEditor.getState().assetsReady,
    // A new demo is loading; previous cancellation does not apply to this project.
    autoplayCancelled: false,
  });
  playWhenReady();
}

/**
 * MAGIC REEL: load a reel built from the user's screenshots. Like the demo loader, scenes arrive fully
 * configured: config/reel.ts builds tracks directly, so normalizeShot migration is unnecessary. Play
 * from the start for immediate feedback. Media uses object URLs; autosave strips them and retains
 * mediaName, just like regular uploads.
 */
export function loadMagicReel(input: MagicReelInput): boolean {
  detachFromShelf();
  const shots = buildMagicReel(input);
  if (!shots.length) return false;
  useEditor.setState({
    shots,
    activeShotId: shots[0].id,
    aspectId: 'fill',
    playhead: 0,
    playing: useEditor.getState().assetsReady,
    autoplayCancelled: false,
    audioTracks: [],
    baseLang: 'en',
    languages: [],
    previewLang: null,
  });
  playWhenReady();
  return true;
}

/**
 * Purpose pack: load a project from config/packs.ts using the Magic Reel pattern. Replace the whole
 * project and detach it from the shelf; Ctrl+Z restores the old one. Video packs play when ready;
 * store sets remain still.
 */
export function loadPack(pack: Pack, input: PackInput): boolean {
  const shots = pack.build(input);
  if (!shots.length) return false;
  detachFromShelf();
  const play = pack.id !== 'app-store';
  useEditor.setState({
    shots,
    activeShotId: shots[0].id,
    aspectId: pack.aspectId,
    playhead: 0,
    playing: play && useEditor.getState().assetsReady,
    autoplayCancelled: false,
    audioTracks: [],
    baseLang: 'en',
    languages: [],
    previewLang: null,
  });
  if (play) playWhenReady();
  return true;
}

/**
 * Start playback as soon as the scene is ready. Stage provides a fallback: even without a texture
 * signal, it compiles and sets `assetsReady` after 4 seconds, so this subscription cannot wait
 * forever. Respect any play/pause action made while waiting.
 */
function playWhenReady() {
  if (useEditor.getState().assetsReady) return;
  const unsub = useEditor.subscribe((s, prev) => {
    if (!s.assetsReady || prev.assetsReady) return;
    unsub();
    // Respect a pause requested while waiting.
    if (useEditor.getState().autoplayCancelled) return;
    // If the user switched projects while waiting (autosave/link/new project),
    // start playback only if the demo is still current.
    if (!useEditor.getState().playing) useEditor.getState().setPlaying(true);
  });
}

export const AUTOSAVED_EVENT = 'mockuptop:autosaved';

export function startAutosave(): () => void {
  let timer: number | undefined;
  /*
    Quota handling: silently swallowed failures restored the last successful save after reopening,
    without telling users their recent work was lost. Notify once without interrupting work; rearm the
    warning after a successful save.
  */
  let warned = false;
  const write = () => {
    /*
      The first edit after sharing removes the link from the address bar. Share deliberately puts it there
      for manual copying if clipboard permission is denied. Keeping it would restore the shared snapshot
      on refresh and overwrite later edits.
    */
    if (changedSinceShare()) clearShareHash();
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(stripMedia(snapshot())));
      warned = false;
      // The project shelf (store/shelf.ts) uses this signal to persist media locally without circular imports.
      window.dispatchEvent(new Event(AUTOSAVED_EVENT));
    } catch {
      if (!warned) {
        warned = true;
        window.dispatchEvent(
          new CustomEvent('mockuptop:toast', {
            detail: { message: 'Autosave failed (browser storage is full) — use Save project to keep your work' },
          }),
        );
      }
    }
  };
  /*
    Autosave previously never ran during playback: every store update reset the 800 ms debounce, while
    the playhead updated 15 times per second (≈66 ms). Edits made during playback, including the
    autoplay demo, were lost on close or refresh. Measured: no save during 4 seconds of playback, then a
    save on pause. As in `history.ts`, reset the timer only when persisted fields
    (shots/aspectId/audioTracks from snapshot) change. Ignore transient playhead, playback, and
    selection state.
  */
  let pending = false;
  const unsub = useEditor.subscribe((state, prev) => {
    if (
      state.shots === prev.shots &&
      state.aspectId === prev.aspectId &&
      state.audioTracks === prev.audioTracks &&
      state.baseLang === prev.baseLang &&
      state.languages === prev.languages
    ) {
      return;
    }
    window.clearTimeout(timer);
    pending = true;
    timer = window.setTimeout(() => {
      pending = false;
      write();
    }, 800);
  });

  /*
    Flush when leaving the tab. The 800 ms debounce otherwise loses an edit made just before closing.
    Use `visibilitychange`/`hidden`: mobile browsers do not reliably fire `beforeunload` when
    backgrounding tabs, and desktop `pagehide` can be skipped when entering bfcache. Listening to both
    is cheap; `write()` is safe to repeat.
  */
  const flush = () => {
    if (!pending) return;
    window.clearTimeout(timer);
    pending = false;
    write();
  };
  const onHidden = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onHidden);
  window.addEventListener('pagehide', flush);

  return () => {
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onHidden);
    window.removeEventListener('pagehide', flush);
    unsub();
  };
}

export function restoreAutosave(): boolean {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    return applyProject(JSON.parse(raw));
  } catch (err) {
    /*
      Remove unreadable autosaves so corrupted state cannot trap users in a crash on every load. Losing
      the setup once is preferable to an endless crash loop.
    */
    console.error('[MOCKUPTOP] autosave unreadable, discarding', err);
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      // Nothing else to do if storage is completely inaccessible.
    }
    return false;
  }
}
