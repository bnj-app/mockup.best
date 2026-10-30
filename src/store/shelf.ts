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
 * WRITE QUEUE: every write (autosave flush, save as, open, delete, clear)
 * runs one at a time. Overlapping writes let garbage collection delete media
 * another write had just stored but not yet referenced.
 *
 * TABS: the open project's media list is stored per tab (`current:<tab>`).
 * A single shared list let one tab's cleanup delete the media of a project
 * open in another tab. Lists of tabs not seen for 30 days are dropped.
 *
 * Browser storage can be cleared. The dialog explains this and offers
 * Save project beside it for file backups; do not promise a secure backup.
 */

import { idbAll, idbClear, idbDelete, idbGet, idbHas, idbKeys, idbPut, isQuotaError, deviceDbAvailable } from '@/lib/deviceDb';
import { useEditor, type AudioTrack, type Shot } from '@/store/editor';
import {
  applyProject,
  AUTOSAVED_EVENT,
  projectSnapshot,
  readAutosave,
  restoredAutosaveTab,
  type ProjectFile,
} from '@/store/project';
import { silentPatch } from '@/store/history';
import { onBeforeShelfSwitch, setShelfCurrentId, shelfCurrentId, tabId } from '@/store/shelfState';

const PREF_KEY = 'mockuptop:device-media';
/** Legacy single media list, written before lists were kept per tab. */
const LEGACY_META = 'current';
const metaKey = (tab: string = tabId()) => `current:${tab}`;
const META_TTL = 30 * 24 * 3600 * 1000;

type MediaRec = { blob: Blob; name: string | null; type: string; size: number; at: number };
/** Open-project media mapping: IDs → media key. */
type Refs = {
  shots: Record<string, { media?: string; bg?: string; extras?: Record<string, string>; logos?: Record<string, string> }>;
  audio: Record<string, string>;
};
type CurrentMeta = { savedAt: number; refs: Refs; tab?: string };

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

/** Media that could not be stored during one write (storage full, unreadable file). */
type Report = { failed: number };

/* ------------------------------------------------------------ preference */

/**
 * "Keep the open project's files after a refresh". This controls only the open project's own media
 * list. Named shelf projects always keep saving: turning it off used to stop their autosave too, while
 * the dialog still said "saving automatically".
 */
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
    // Disabling releases this tab's open-project media; shelf projects retain their own media.
    await enqueue(async () => {
      await idbDelete('meta', metaKey()).catch(() => {});
      await gc();
    });
  }
}

/* ------------------------------------------------------------ queue */

let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
}

/* ------------------------------------------------------------ media */

const urlToKey = new Map<string, string>();
const keyToUrl = new Map<string, string>();
const sizes = new Map<string, number>();
const inflight = new Map<string, Promise<string | null>>();
/** Warn once per file, not once per tab: a later, different file that cannot be kept must warn too. */
const warnedUrls = new Set<string>();

/** Locally storable media: object URLs and data URLs. Bundled '/' paths already exist. */
const storable = (u: string | null | undefined): u is string => !!u && (u.startsWith('blob:') || u.startsWith('data:'));

function toast(message: string) {
  window.dispatchEvent(new CustomEvent('mockuptop:toast', { detail: { message } }));
}

function warnFailed(url: string, e: unknown) {
  if (warnedUrls.has(url)) return;
  warnedUrls.add(url);
  toast(
    isQuotaError(e)
      ? 'Device storage is full — a file was not kept on this device. Use Save project for a backup.'
      : 'A file could not be kept on this device — use Save project for a backup.',
  );
}

function forget(key: string) {
  const u = keyToUrl.get(key);
  keyToUrl.delete(key);
  if (u) urlToKey.delete(u);
  sizes.delete(key);
}

async function keyFor(url: string, name: string | null): Promise<string | null> {
  const hit = urlToKey.get(url);
  if (hit) {
    // The in-memory map is not proof: cleanup in another tab may have deleted the record.
    if (await idbHas('media', hit).catch(() => false)) return hit;
    forget(hit);
  }
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
      warnedUrls.delete(url);
      return key;
    } catch (e) {
      warnFailed(url, e);
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

async function collectRefs(shots: Shot[], audio: AudioTrack[], report: Report, prev?: Refs): Promise<Refs> {
  const refs: Refs = { shots: {}, audio: {} };
  // A file that cannot be stored keeps its previous key so the last stored copy is not collected.
  const take = async (u: string, name: string | null, old: string | undefined) => {
    const k = await keyFor(u, name);
    if (k) return k;
    report.failed += 1;
    return old;
  };
  for (const s of shots) {
    const r: Refs['shots'][string] = {};
    const p = prev?.shots[s.id];
    if (storable(s.media)) r.media = await take(s.media, s.mediaName, p?.media);
    if (storable(s.scene.bgImage)) r.bg = await take(s.scene.bgImage, null, p?.bg);
    for (const e of s.extras) {
      if (!storable(e.media)) continue;
      const k = await take(e.media, e.mediaName ?? null, p?.extras?.[e.id]);
      if (k) (r.extras ??= {})[e.id] = k;
    }
    for (const t of s.texts) {
      if (t.kind !== 'logo' || !storable(t.src)) continue;
      const k = await take(t.src, t.text, p?.logos?.[t.id]);
      if (k) (r.logos ??= {})[t.id] = k;
    }
    if (r.media === undefined) delete r.media;
    if (r.bg === undefined) delete r.bg;
    if (Object.keys(r).length) refs.shots[s.id] = r;
  }
  for (const a of audio) {
    if (!storable(a.url)) continue;
    const k = await take(a.url, a.name, prev?.audio[a.id]);
    if (k) refs.audio[a.id] = k;
  }
  return refs;
}

let saveTimer: number | undefined;
/** Shelf writes are allowed only after startup loading; before that the editor shows placeholder content. */
let armed = false;

/** Called on each autosave write; expensive media writes use a separate debounce. */
export function scheduleDeviceSave() {
  if (!deviceDbAvailable() || (!deviceMediaEnabled() && !shelfCurrentId())) return;
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
  /*
    Leaving a shelf project (New project, a pack, a file, a link, Open, undo): write its latest content to
    its own record first. These loaders used to drop the link immediately, so edits made in the last ~2 s
    (autosave 0.8 s + this 1.2 s debounce) never reached the record.
  */
  const offSwitch = onBeforeShelfSwitch((from) => {
    if (!armed || !from) return;
    const snap = projectSnapshot();
    void enqueue(() => updateShelfRecord(from, snap, { failed: 0 }));
  });
  window.addEventListener(AUTOSAVED_EVENT, onSaved);
  document.addEventListener('visibilitychange', onHide);
  return () => {
    armed = false;
    offSwitch();
    window.removeEventListener(AUTOSAVED_EVENT, onSaved);
    document.removeEventListener('visibilitychange', onHide);
    window.clearTimeout(saveTimer);
  };
}

/** Startup loading (link, autosave or demo) is done; shelf records may now be written. */
export function armShelfWrites() {
  armed = true;
}

/**
 * Flush the pending local save before switching projects or closing the tab. The project and its shelf
 * entry are captured NOW: when the queued write runs, the editor may already show another project.
 */
export function saveCurrentNow(): Promise<void> {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  const media = deviceMediaEnabled();
  const id = shelfCurrentId();
  if (!deviceDbAvailable() || (!media && !id)) return queue.then(() => undefined);
  const snap = projectSnapshot();
  return enqueue(async () => {
    const report: Report = { failed: 0 };
    try {
      if (media) {
        const prev = await idbGet<CurrentMeta>('meta', metaKey()).catch(() => undefined);
        const refs = await collectRefs(snap.shots, snap.audioTracks ?? [], report, prev?.refs);
        await idbPut('meta', metaKey(), { savedAt: Date.now(), refs, tab: tabId() } satisfies CurrentMeta);
      }
      if (id) await updateShelfRecord(id, snap, report);
      // Do not collect while a file failed: its previous copy may still be the only one.
      if (!report.failed) await gc();
    } catch (e) {
      if (isQuotaError(e)) warnFailed('meta', e);
    }
  });
}

/** Media list to restore at startup: this tab's, then the tab that wrote the autosave, then the newest. */
async function pickMeta(preferTab: string | null): Promise<CurrentMeta | undefined> {
  const own = await idbGet<CurrentMeta>('meta', metaKey()).catch(() => undefined);
  if (own?.refs) return own;
  if (preferTab) {
    const theirs = await idbGet<CurrentMeta>('meta', metaKey(preferTab)).catch(() => undefined);
    if (theirs?.refs) return theirs;
  }
  const all = await idbAll<CurrentMeta>('meta').catch(() => [] as CurrentMeta[]);
  return all.filter((m) => m?.refs).sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0))[0];
}

/**
 * Restore media after autosave loads at startup. Fill only empty media
 * fields so newer user selections are not overwritten.
 * Returns the number of restored media items.
 */
export async function restoreDeviceMedia(): Promise<number> {
  if (!deviceMediaEnabled()) return 0;
  const meta = await pickMeta(restoredAutosaveTab());
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

/** Field address used to find a field's previous `idb:` value in the record being updated. */
type PrevIndex = Map<string, string>;
function indexRefs(file: ProjectFile | undefined): PrevIndex {
  const out: PrevIndex = new Map();
  if (!file) return out;
  const put = (k: string, v: string | null | undefined) => v && v.startsWith('idb:') && out.set(k, v);
  for (const s of file.shots) {
    put(`m:${s.id}`, s.media);
    put(`b:${s.id}`, s.scene?.bgImage);
    for (const e of s.extras ?? []) put(`e:${s.id}:${e.id}`, e.media);
    for (const t of s.texts ?? []) if (t.kind === 'logo') put(`l:${s.id}:${t.id}`, t.src);
  }
  for (const a of file.audioTracks ?? []) put(`a:${a.id}`, a.url);
  return out;
}

async function fileWithRefs(file: ProjectFile, report: Report, prevFile?: ProjectFile): Promise<{ file: ProjectFile; bytes: number }> {
  let bytes = 0;
  const prev = indexRefs(prevFile);
  const ref = async (u: string | null | undefined, name: string | null, at: string) => {
    if (!storable(u)) return u ?? null;
    const k = await keyFor(u, name);
    if (!k) {
      // Keep the record's last stored copy instead of saving an empty field.
      report.failed += 1;
      return prev.get(at) ?? null;
    }
    bytes += sizes.get(k) ?? 0;
    return `idb:${k}`;
  };
  const shots: Shot[] = [];
  for (const s of file.shots) {
    const extras = [];
    for (const e of s.extras) extras.push({ ...e, media: await ref(e.media, e.mediaName ?? null, `e:${s.id}:${e.id}`) });
    const texts = [];
    for (const t of s.texts) texts.push(t.kind === 'logo' ? { ...t, src: await ref(t.src, t.text, `l:${s.id}:${t.id}`) } : t);
    shots.push({
      ...s,
      media: await ref(s.media, s.mediaName, `m:${s.id}`),
      scene: { ...s.scene, bgImage: await ref(s.scene.bgImage, null, `b:${s.id}`) },
      extras,
      texts,
    });
  }
  const audioTracks: AudioTrack[] = [];
  for (const a of file.audioTracks ?? []) audioTracks.push({ ...a, url: await ref(a.url, a.name, `a:${a.id}`) });
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

/** Delete media unused by any project or by any tab's open project; drop media lists of long-gone tabs. */
async function gc() {
  try {
    const keep = new Set<string>();
    const now = Date.now();
    for (const key of await idbKeys('meta')) {
      if (key !== LEGACY_META && !key.startsWith('current:')) continue;
      const meta = await idbGet<CurrentMeta>('meta', key);
      if (!meta?.refs) continue;
      if (key !== metaKey() && now - (meta.savedAt ?? 0) > META_TTL) {
        await idbDelete('meta', key);
        continue;
      }
      for (const r of Object.values(meta.refs.shots)) {
        [r.media, r.bg, ...Object.values(r.extras ?? {}), ...Object.values(r.logos ?? {})].forEach((k) => k && keep.add(k));
      }
      Object.values(meta.refs.audio).forEach((k) => keep.add(k));
    }
    for (const p of await idbAll<ShelfProject>('projects')) refKeys(p.file).forEach((k) => keep.add(k));
    for (const k of await idbKeys('media')) {
      if (keep.has(k)) continue;
      await idbDelete('media', k);
      forget(k);
    }
  } catch {
    // Retry failed garbage collection on the next write.
  }
}

/** Write a snapshot of a project to its shelf entry, retaining the thumbnail. Runs inside the queue. */
async function updateShelfRecord(id: string, snap: ProjectFile, report: Report) {
  const rec = await idbGet<ShelfProject>('projects', id);
  if (!rec) {
    if (shelfCurrentId() === id) setShelfCurrentId(null, 'retag');
    return;
  }
  const { file, bytes } = await fileWithRefs(snap, report, rec.file);
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
const newId = (prefix: string) =>
  typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/**
 * Save the open project as a new shelf entry and mark it as current. `failed` counts files that could not
 * be stored; the dialog must not report a complete save when it is not zero.
 */
export async function saveProjectAs(name: string): Promise<{ rec: ShelfProject; failed: number }> {
  const snap = projectSnapshot();
  const thumb = await makeThumb();
  const out = await enqueue(async () => {
    const report: Report = { failed: 0 };
    const { file, bytes } = await fileWithRefs(snap, report);
    const now = Date.now();
    const rec: ShelfProject = {
      id: newId('p'),
      name: name.trim().slice(0, 60) || 'Untitled project',
      createdAt: now,
      updatedAt: now,
      scenes: file.shots.length,
      bytes,
      thumb,
      file,
    };
    await idbPut('projects', rec.id, rec);
    return { rec, failed: report.failed };
  });
  // Same content, new link: relabel rather than switch (nothing to flush).
  setShelfCurrentId(out.rec.id, 'retag');
  // Request persistent browser storage on the first named save, not at startup.
  if (!persistAsked && navigator.storage?.persist) {
    persistAsked = true;
    void navigator.storage.persist().catch(() => false);
  }
  await saveCurrentNow();
  return out;
}

/** Open from the shelf after flushing the current project's pending save to its entry. */
export async function openProject(id: string): Promise<boolean> {
  await saveCurrentNow();
  const rec = await idbGet<ShelfProject>('projects', id);
  if (!rec) return false;
  const file = await resolveFile(rec.file);
  /*
    Link first, then content: the undo snapshot of the opened content must carry this entry, and the
    switch hooks must see the outgoing project still on screen.
  */
  const prev = shelfCurrentId();
  setShelfCurrentId(id);
  const ok = applyProject(file);
  if (!ok) {
    setShelfCurrentId(prev, 'retag');
    return false;
  }
  await saveCurrentNow();
  return true;
}

export async function renameProject(id: string, name: string) {
  await enqueue(async () => {
    const rec = await idbGet<ShelfProject>('projects', id);
    if (!rec) return;
    await idbPut('projects', id, { ...rec, name: name.trim().slice(0, 60) || rec.name });
  });
}

export async function duplicateProject(id: string): Promise<ShelfProject | null> {
  return enqueue(async () => {
    const rec = await idbGet<ShelfProject>('projects', id);
    if (!rec) return null;
    const now = Date.now();
    const copy: ShelfProject = { ...rec, id: newId('p'), name: `${rec.name} copy`.slice(0, 60), createdAt: now, updatedAt: now };
    await idbPut('projects', copy.id, copy);
    return copy;
  });
}

export async function deleteProject(id: string) {
  await enqueue(async () => {
    await idbDelete('projects', id);
    if (shelfCurrentId() === id) setShelfCurrentId(null, 'retag');
    await gc();
  });
}

/** All Mockuptop shelf and media data in this browser; autosave remains. */
export async function clearDeviceData() {
  await enqueue(async () => {
    await Promise.all([idbClear('projects'), idbClear('media'), idbClear('meta')]).catch(() => {});
    urlToKey.clear();
    keyToUrl.clear();
    sizes.clear();
    setShelfCurrentId(null, 'retag');
  });
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

/* ---------------------------------------------- keep work before a link */

/**
 * Opening a share link replaces the editor content and the autosave. A project that was not in Projects
 * existed only there (its media only in the device list), so it was lost without a prompt and without
 * undo. Keep it as a shelf entry first, built from the autosave plus the device media list of the tab
 * that wrote it (its media is not in the editor yet at startup). Returns the entry name, or null.
 */
export async function stashAutosave(name: string): Promise<string | null> {
  if (!deviceDbAvailable()) return null;
  const auto = readAutosave();
  if (!auto) return null;
  return enqueue(async () => {
    const meta = deviceMediaEnabled() ? await pickMeta(auto.tab ?? null) : undefined;
    const refs = meta?.refs;
    const idb = (k: string | undefined) => (k ? `idb:${k}` : null);
    const shots: Shot[] = auto.shots.map((s) => {
      const r = refs?.shots[s.id];
      return {
        ...s,
        media: s.media ?? idb(r?.media),
        scene: { ...s.scene, bgImage: s.scene?.bgImage ?? idb(r?.bg) },
        extras: (s.extras ?? []).map((e) => ({ ...e, media: e.media ?? idb(r?.extras?.[e.id]) })),
        texts: (s.texts ?? []).map((t) => (t.kind === 'logo' ? { ...t, src: t.src ?? idb(r?.logos?.[t.id]) } : t)),
      };
    });
    const audioTracks = (auto.audioTracks ?? []).map((a) => ({ ...a, url: a.url ?? idb(refs?.audio[a.id]) }));
    const { tab: _tab, shelfId: _shelf, ...rest } = auto;
    void _tab;
    void _shelf;
    const file: ProjectFile = { ...rest, shots, audioTracks };
    let bytes = 0;
    for (const k of refKeys(file)) bytes += (await idbGet<MediaRec>('media', k).catch(() => undefined))?.size ?? 0;
    const now = Date.now();
    const rec: ShelfProject = { id: newId('p'), name: name.slice(0, 60), createdAt: now, updatedAt: now, scenes: shots.length, bytes, file };
    await idbPut('projects', rec.id, rec);
    return rec.name;
  });
}
