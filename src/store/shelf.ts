'use client';

/**
 * Local project shelf with persistent media.
 *
 * Two responsibilities:
 *  1. Keep the open project's media locally. Autosave in localStorage
 *     deliberately excludes media, so refresh previously left screens
 *     "file missing". Store media in IndexedDB, load autosave immediately,
 *     then restore screens by scene/device/audio/logo ID. The autosave
 *     format is unchanged; this is an additional storage channel.
 *  2. Named projects: save, open, rename, duplicate, and delete in Projects.
 *     Autosave also updates the shelf entry for the open project.
 *
 * Media keys are random IDs, not hashes: hashing a 100 MB recording on the
 * main thread would cause a noticeable pause. Keep URL ↔ key mappings in
 * memory to avoid storing a URL twice. Collect unreferenced media after
 * every write.
 *
 * Browser storage can be cleared. The dialog explains this and offers
 * Save project beside it for file backups; do not promise a secure backup.
 */

import { idbAll, idbClear, idbDelete, idbGet, idbKeys, idbPut, isQuotaError, deviceDbAvailable } from '@/lib/deviceDb';
import { useEditor, type AudioTrack, type Shot } from '@/store/editor';
import { applyProject, AUTOSAVED_EVENT, projectSnapshot, type ProjectFile } from '@/store/project';
import { silentPatch } from '@/store/history';
import { setShelfCurrentId, shelfCurrentId } from '@/store/shelfState';

const PREF_KEY = 'mockuptop:device-media';

type MediaRec = { blob: Blob; name: string | null; type: string; size: number; at: number };
/** Open-project media mapping: IDs → media key. */
type Refs = {
  shots: Record<string, { media?: string; bg?: string; extras?: Record<string, string>; logos?: Record<string, string> }>;
  audio: Record<string, string>;
};
type CurrentMeta = { savedAt: number; refs: Refs };

export type ShelfProject = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  scenes: number;
  /** Total media size in bytes at save time. */
  bytes: number;
  thumb?: Blob;
  /** Project file with media fields encoded as `idb:<key>`. */
  file: ProjectFile;
};

/* ------------------------------------------------------------ preference */

export function deviceMediaEnabled(): boolean {
  if (!deviceDbAvailable()) return false;
  try {
    return window.localStorage.getItem(PREF_KEY) !== '0';
  } catch {
    return false;
  }
}

export async function setDeviceMediaEnabled(on: boolean) {
  try {
    window.localStorage.setItem(PREF_KEY, on ? '1' : '0');
  } catch {
    // Noncritical.
  }
  if (on) await saveCurrentNow();
  else {
    // Disabling releases open-project media; shelf projects retain their own media.
    await idbDelete('meta', 'current').catch(() => {});
    await gc();
  }
}

/* ------------------------------------------------------------ media */

const urlToKey = new Map<string, string>();
const keyToUrl = new Map<string, string>();
const sizes = new Map<string, number>();
const inflight = new Map<string, Promise<string | null>>();
let quotaWarned = false;

/** Locally storable media: object URLs and data URLs. Bundled '/' paths already exist. */
const storable = (u: string | null | undefined): u is string => !!u && (u.startsWith('blob:') || u.startsWith('data:'));

function warnQuota() {
  if (quotaWarned) return;
  quotaWarned = true;
  window.dispatchEvent(
    new CustomEvent('mockuptop:toast', {
      detail: { message: 'Device storage is full — media is not kept after refresh. Use Save project for a backup.' },
    }),
  );
}

async function keyFor(url: string, name: string | null): Promise<string | null> {
  const hit = urlToKey.get(url);
  if (hit) return hit;
  const running = inflight.get(url);
  if (running) return running;
  const p = (async () => {
    try {
      const blob = await (await fetch(url)).blob();
      const key = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `m-${Date.now()}-${Math.random()}`;
      const rec: MediaRec = { blob, name, type: blob.type, size: blob.size, at: Date.now() };
      await idbPut('media', key, rec);
      urlToKey.set(url, key);
      keyToUrl.set(key, url);
      sizes.set(key, blob.size);
      return key;
    } catch (e) {
      if (isQuotaError(e)) warnQuota();
      return null;
    } finally {
      inflight.delete(url);
    }
  })();
  inflight.set(url, p);
  return p;
}

async function urlFor(key: string): Promise<string | null> {
  const hit = keyToUrl.get(key);
  if (hit) return hit;
  const rec = await idbGet<MediaRec>('media', key).catch(() => undefined);
  if (!rec?.blob) return null;
  const url = URL.createObjectURL(rec.blob);
  keyToUrl.set(key, url);
  urlToKey.set(url, key);
  sizes.set(key, rec.size);
  return url;
}

/* ------------------------------------------------- open project (current) */

async function collectRefs(shots: Shot[], audio: AudioTrack[]): Promise<Refs> {
  const refs: Refs = { shots: {}, audio: {} };
  for (const s of shots) {
    const r: Refs['shots'][string] = {};
    if (storable(s.media)) r.media = (await keyFor(s.media, s.mediaName)) ?? undefined;
    if (storable(s.scene.bgImage)) r.bg = (await keyFor(s.scene.bgImage, null)) ?? undefined;
    for (const e of s.extras) {
      if (!storable(e.media)) continue;
      const k = await keyFor(e.media, e.mediaName ?? null);
      if (k) (r.extras ??= {})[e.id] = k;
    }
    for (const t of s.texts) {
      if (t.kind !== 'logo' || !storable(t.src)) continue;
      const k = await keyFor(t.src, t.text);
      if (k) (r.logos ??= {})[t.id] = k;
    }
    if (Object.keys(r).length) refs.shots[s.id] = r;
  }
  for (const a of audio) {
    if (!storable(a.url)) continue;
    const k = await keyFor(a.url, a.name);
    if (k) refs.audio[a.id] = k;
  }
  return refs;
}

let saveTimer: number | undefined;
let saving: Promise<void> | null = null;

/** Called on each autosave write; expensive media writes use a separate debounce. */
export function scheduleDeviceSave() {
  if (!deviceMediaEnabled()) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void saveCurrentNow(), 1200);
}

/**
 * While the editor is open, schedule a local write on each autosave and
 * flush when the tab is hidden. Returns cleanup.
 */
export function startDeviceSync(): () => void {
  const onSaved = () => scheduleDeviceSave();
  const onHide = () => {
    if (document.visibilityState === 'hidden' && saveTimer !== undefined) void saveCurrentNow();
  };
  window.addEventListener(AUTOSAVED_EVENT, onSaved);
  document.addEventListener('visibilitychange', onHide);
  return () => {
    window.removeEventListener(AUTOSAVED_EVENT, onSaved);
    document.removeEventListener('visibilitychange', onHide);
    window.clearTimeout(saveTimer);
  };
}

/** Flush the pending local save before switching projects or closing the tab. */
export async function saveCurrentNow(): Promise<void> {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!deviceMediaEnabled()) return;
  // Avoid overlapping writes; save the latest state after the previous write finishes.
  if (saving) await saving.catch(() => {});
  saving = (async () => {
    const st = useEditor.getState();
    const refs = await collectRefs(st.shots, st.audioTracks);
    await idbPut('meta', 'current', { savedAt: Date.now(), refs } satisfies CurrentMeta);
    const id = shelfCurrentId();
    if (id) await updateShelfRecord(id);
    await gc();
  })();
  try {
    await saving;
  } catch (e) {
    if (isQuotaError(e)) warnQuota();
  } finally {
    saving = null;
  }
}

/**
 * Restore media after autosave loads at startup. Fill only empty media
 * fields so newer user selections are not overwritten.
 * Returns the number of restored media items.
 */
export async function restoreDeviceMedia(): Promise<number> {
  if (!deviceMediaEnabled()) return 0;
  const meta = await idbGet<CurrentMeta>('meta', 'current').catch(() => undefined);
  if (!meta?.refs) return 0;
  const want = new Set<string>();
  for (const r of Object.values(meta.refs.shots)) {
    if (r.media) want.add(r.media);
    if (r.bg) want.add(r.bg);
    for (const k of Object.values(r.extras ?? {})) want.add(k);
    for (const k of Object.values(r.logos ?? {})) want.add(k);
  }
  for (const k of Object.values(meta.refs.audio)) want.add(k);
  const urls = new Map<string, string>();
  for (const k of want) {
    const u = await urlFor(k);
    if (u) urls.set(k, u);
  }
  if (!urls.size) return 0;
  const fill = (cur: string | null | undefined, key: string | undefined) => (cur || !key ? (cur ?? null) : (urls.get(key) ?? null));
  const fixShots = (shots: Shot[]) =>
    shots.map((s) => {
      const r = meta.refs.shots[s.id];
      if (!r) return s;
      return {
        ...s,
        media: fill(s.media, r.media),
        scene: { ...s.scene, bgImage: fill(s.scene.bgImage, r.bg) },
        extras: s.extras.map((e) => ({ ...e, media: fill(e.media, r.extras?.[e.id]) })),
        texts: s.texts.map((t) => (t.kind === 'logo' ? { ...t, src: fill(t.src, r.logos?.[t.id]) } : t)),
      };
    });
  const count = () => {
    const st = useEditor.getState();
    let n = 0;
    for (const s of st.shots) {
      n += Number(!!s.media) + Number(!!s.scene.bgImage);
      for (const e of s.extras) n += Number(!!e.media);
      for (const t of s.texts) if (t.kind === 'logo') n += Number(!!t.src);
    }
    for (const a of st.audioTracks) n += Number(!!a.url);
    return n;
  };
  const before = count();
  silentPatch((snap) => ({
    shots: fixShots(snap.shots),
    audioTracks: snap.audioTracks.map((a) => ({ ...a, url: fill(a.url, meta.refs.audio[a.id]) })),
  }));
  return count() - before;
}

/* ------------------------------------------------------------- shelf */

async function fileWithRefs(file: ProjectFile): Promise<{ file: ProjectFile; bytes: number }> {
  let bytes = 0;
  const ref = async (u: string | null | undefined, name: string | null) => {
    if (!storable(u)) return u ?? null;
    const k = await keyFor(u, name);
    if (!k) return null;
    bytes += sizes.get(k) ?? 0;
    return `idb:${k}`;
  };
  const shots: Shot[] = [];
  for (const s of file.shots) {
    const extras = [];
    for (const e of s.extras) extras.push({ ...e, media: await ref(e.media, e.mediaName ?? null) });
    const texts = [];
    for (const t of s.texts) texts.push(t.kind === 'logo' ? { ...t, src: await ref(t.src, t.text) } : t);
    shots.push({
      ...s,
      media: await ref(s.media, s.mediaName),
      scene: { ...s.scene, bgImage: await ref(s.scene.bgImage, null) },
      extras,
      texts,
    });
  }
  const audioTracks: AudioTrack[] = [];
  for (const a of file.audioTracks ?? []) audioTracks.push({ ...a, url: await ref(a.url, a.name) });
  return { file: { ...file, shots, audioTracks }, bytes };
}

async function resolveFile(file: ProjectFile): Promise<ProjectFile> {
  const res = async (u: string | null | undefined) => (u && u.startsWith('idb:') ? await urlFor(u.slice(4)) : (u ?? null));
  const shots: Shot[] = [];
  for (const s of file.shots) {
    const extras = [];
    for (const e of s.extras) extras.push({ ...e, media: await res(e.media) });
    const texts = [];
    for (const t of s.texts) texts.push(t.kind === 'logo' ? { ...t, src: await res(t.src) } : t);
    shots.push({ ...s, media: await res(s.media), scene: { ...s.scene, bgImage: await res(s.scene.bgImage) }, extras, texts });
  }
  const audioTracks: AudioTrack[] = [];
  for (const a of file.audioTracks ?? []) audioTracks.push({ ...a, url: await res(a.url) });
  return { ...file, shots, audioTracks };
}

const refKeys = (file: ProjectFile): string[] => {
  const out: string[] = [];
  const take = (u: string | null | undefined) => u && u.startsWith('idb:') && out.push(u.slice(4));
  for (const s of file.shots) {
    take(s.media);
    take(s.scene.bgImage);
    for (const e of s.extras) take(e.media);
    for (const t of s.texts) if (t.kind === 'logo') take(t.src);
  }
  for (const a of file.audioTracks ?? []) take(a.url);
  return out;
};

/** Delete media unused by any project. */
async function gc() {
  try {
    const keep = new Set<string>();
    const meta = await idbGet<CurrentMeta>('meta', 'current');
    if (meta?.refs) {
      for (const r of Object.values(meta.refs.shots)) {
        [r.media, r.bg, ...Object.values(r.extras ?? {}), ...Object.values(r.logos ?? {})].forEach((k) => k && keep.add(k));
      }
      Object.values(meta.refs.audio).forEach((k) => keep.add(k));
    }
    for (const p of await idbAll<ShelfProject>('projects')) refKeys(p.file).forEach((k) => keep.add(k));
    for (const k of await idbKeys('media')) {
      if (keep.has(k)) continue;
      await idbDelete('media', k);
      const u = keyToUrl.get(k);
      keyToUrl.delete(k);
      if (u) urlToKey.delete(u);
      sizes.delete(k);
    }
  } catch {
    // Retry failed garbage collection on the next write.
  }
}

/** Autosave the open project to its shelf entry, retaining the thumbnail. */
async function updateShelfRecord(id: string) {
  const rec = await idbGet<ShelfProject>('projects', id);
  if (!rec) {
    setShelfCurrentId(null);
    return;
  }
  const { file, bytes } = await fileWithRefs(projectSnapshot());
  await idbPut('projects', id, { ...rec, file, bytes, scenes: file.shots.length, updatedAt: Date.now() } satisfies ShelfProject);
}

async function makeThumb(): Promise<Blob | undefined> {
  try {
    const { captureFrame } = await import('@/components/scene/exportBridge');
    return await captureFrame({ width: 320, height: 200, mime: 'image/jpeg', quality: 0.72 });
  } catch {
    return undefined;
  }
}

export async function listProjects(): Promise<ShelfProject[]> {
  if (!deviceDbAvailable()) return [];
  const all = await idbAll<ShelfProject>('projects').catch(() => []);
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

let persistAsked = false;

/** Save the open project as a new shelf entry and mark it as current. */
export async function saveProjectAs(name: string): Promise<ShelfProject> {
  const { file, bytes } = await fileWithRefs(projectSnapshot());
  const now = Date.now();
  const rec: ShelfProject = {
    id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `p-${now}`,
    name: name.trim().slice(0, 60) || 'Untitled project',
    createdAt: now,
    updatedAt: now,
    scenes: file.shots.length,
    bytes,
    thumb: await makeThumb(),
    file,
  };
  await idbPut('projects', rec.id, rec);
  setShelfCurrentId(rec.id);
  // Request persistent browser storage on the first named save, not at startup.
  if (!persistAsked && navigator.storage?.persist) {
    persistAsked = true;
    void navigator.storage.persist().catch(() => false);
  }
  await saveCurrentNow();
  return rec;
}

/** Open from the shelf after flushing the current project's pending save to its entry. */
export async function openProject(id: string): Promise<boolean> {
  await saveCurrentNow();
  const rec = await idbGet<ShelfProject>('projects', id);
  if (!rec) return false;
  const ok = applyProject(await resolveFile(rec.file));
  if (!ok) return false;
  setShelfCurrentId(id);
  await saveCurrentNow();
  return true;
}

export async function renameProject(id: string, name: string) {
  const rec = await idbGet<ShelfProject>('projects', id);
  if (!rec) return;
  await idbPut('projects', id, { ...rec, name: name.trim().slice(0, 60) || rec.name });
}

export async function duplicateProject(id: string): Promise<ShelfProject | null> {
  const rec = await idbGet<ShelfProject>('projects', id);
  if (!rec) return null;
  const now = Date.now();
  const copy: ShelfProject = { ...rec, id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `p-${now}`, name: `${rec.name} copy`.slice(0, 60), createdAt: now, updatedAt: now };
  await idbPut('projects', copy.id, copy);
  return copy;
}

export async function deleteProject(id: string) {
  await idbDelete('projects', id);
  if (shelfCurrentId() === id) setShelfCurrentId(null);
  await gc();
}

/** All Mockuptop shelf and media data in this browser; autosave remains. */
export async function clearDeviceData() {
  await Promise.all([idbClear('projects'), idbClear('media'), idbClear('meta')]).catch(() => {});
  urlToKey.clear();
  keyToUrl.clear();
  sizes.clear();
  setShelfCurrentId(null);
}

export async function deviceUsage(): Promise<{ bytes: number; quota: number | null }> {
  let bytes = 0;
  try {
    for (const m of await idbAll<MediaRec>('media')) bytes += m.size ?? 0;
    for (const p of await idbAll<ShelfProject>('projects')) bytes += p.thumb?.size ?? 0;
  } catch {
    // Empty.
  }
  let quota: number | null = null;
  try {
    const est = await navigator.storage?.estimate?.();
    quota = est?.quota ?? null;
  } catch {
    // Empty.
  }
  return { bytes, quota };
}
