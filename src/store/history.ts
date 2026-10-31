'use client';

import { useEditor, type AudioTrack, type Shot } from '@/store/editor';
import type { LaunchProject } from '@/config/launch';
import { toast } from '@/components/shell/Toast';
import { onBeforeShelfSwitch, onShelfRetag, setShelfCurrentId, shelfCurrentId } from '@/store/shelfState';

/**
 * Undo / redo.
 *
 * Use snapshots rather than a command log: individual commands for every
 * setting would require hundreds of maintenance lines and risk omissions
 * as features are added. Scene state is only a few kilobytes of JSON;
 * storing all of it is simple and complete.
 *
 * Record only editable state. Transient playhead and playback values
 * stay out of history so Ctrl+Z does not unexpectedly rewind playback.
 */

type Snap = {
  shots: Shot[];
  activeShotId: string;
  aspectId: string;
  /** Audio tracks must be undoable; adding and moving them are edits. */
  audioTracks: AudioTrack[];
  /** Adding a language is also an undoable edit. */
  baseLang: string;
  languages: string[];
  /** Launch package outputs: creating or removing a package is one undoable step. */
  launch: LaunchProject | null;
  /*
    Shelf entry the content belonged to. Undoing "Open" restored the previous project's scenes while
    the shelf link stayed on the opened project, so autosave wrote the old content into the opened
    project's record. Undo/redo now restore the link together with the content.
  */
  shelfId: string | null;
};

const LIMIT = 60;
const past: Snap[] = [];
const future: Snap[] = [];
let applying = false;
/*
  Pending history write deliberately lives at module scope.
  The timer was hidden inside startHistory(), so undo() could not flush it.
  Pressing Ctrl+Z within 350 ms skipped the latest, unrecorded edit and
  applied the previous step, appearing to undo one step too many while
  silently losing the newest change.
  Keeping the timer here lets commitNow() flush it early.
*/
let timer: number | undefined;
let pendingWrite: (() => void) | null = null;

/** Flush pending history immediately; required before undo/redo. */
function commitNow() {
  if (!pendingWrite) return;
  window.clearTimeout(timer);
  const write = pendingWrite;
  pendingWrite = null;
  write();
}

function read(): Snap {
  const s = useEditor.getState();
  return {
    shots: s.shots,
    activeShotId: s.activeShotId,
    aspectId: s.aspectId,
    audioTracks: s.audioTracks,
    baseLang: s.baseLang,
    languages: s.languages,
    launch: s.launch,
    shelfId: shelfCurrentId(),
  };
}

function same(a: Snap, b: Snap) {
  return (
    a.shots === b.shots &&
    a.aspectId === b.aspectId &&
    a.audioTracks === b.audioTracks &&
    a.baseLang === b.baseLang &&
    a.languages === b.languages &&
    a.launch === b.launch
  );
}

export function startHistory(): () => void {
  /*
    Reset the stacks: module-scoped past/future previously survived cleanup.
    Remounting the editor (StrictMode or mode switching) retained snapshots
    from the previous session, allowing Ctrl+Z to restore another project.
  */
  past.length = 0;
  future.length = 0;
  window.clearTimeout(timer);
  pendingWrite = null;
  past.push(read());

  const unsub = useEditor.subscribe((state, prev) => {
    if (applying || batchDepth > 0) return;
    /*
      Why history was not recorded during playback:
      The subscription reset its debounce on every store write. Playback
      writes the playhead 15 times per second (every 66 ms), so the 350 ms
      delay never elapsed. Edits during playback never entered history;
      Ctrl+Z undid an older change instead of the latest.
      Reset the timer only when fields included in history change.
      Playhead, playback status, selection, and warmup flags are transient
      and must not reset the delay.
    */
    if (
      state.shots === prev.shots &&
      state.aspectId === prev.aspectId &&
      state.audioTracks === prev.audioTracks &&
      state.baseLang === prev.baseLang &&
      state.languages === prev.languages &&
      state.launch === prev.launch
    ) {
      return;
    }
    window.clearTimeout(timer);
    /*
      Keep the 350 ms debounce: sliders emit dozens of updates per second.
      Recording each update could turn one drag into 40 undo steps.
      Commit one step when the user stops.
    */
    pendingWrite = () => {
      const next = read();
      const last = past[past.length - 1];
      if (last && same(last, next)) return;
      past.push(next);
      const gone = past.length > LIMIT ? [past.shift()!] : [];
      dropped([...gone, ...future]);
      future.length = 0;
    };
    timer = window.setTimeout(commitNow, 350);
  });

  // Commit a pending edit under the project being left, before the shelf link changes.
  const offSwitch = onBeforeShelfSwitch(() => commitNow());
  // Content unchanged, link changed (save as, delete): relabel the newest snapshot.
  const offRetag = onShelfRetag(() => {
    commitNow();
    const top = past[past.length - 1];
    if (top) past[past.length - 1] = { ...top, shelfId: shelfCurrentId() };
  });

  return () => {
    window.clearTimeout(timer);
    pendingWrite = null;
    unsub();
    offSwitch();
    offRetag();
  };
}

/**
 * Move the history baseline to the current state. At startup, autosave,
 * shared links, or demos load after history starts. Treating that load as
 * an edit made the first Ctrl+Z after refresh restore an empty project.
 */
export function rebaseHistory() {
  window.clearTimeout(timer);
  pendingWrite = null;
  dropped([...past, ...future]);
  past.length = 0;
  future.length = 0;
  past.push(read());
}

/**
 * Repair state without recording history, and apply the same repair to
 * stored snapshots. Used when the shelf restores local media after refresh:
 * restoration is not a user edit, and undo must not make every screen
 * "file missing" again.
 */
export function silentPatch(fix: (snap: Pick<Snap, 'shots' | 'audioTracks'>) => Pick<Snap, 'shots' | 'audioTracks'>) {
  commitNow();
  const fixAll = (list: Snap[]) => {
    for (let i = 0; i < list.length; i += 1) list[i] = { ...list[i], ...fix(list[i]) };
  };
  fixAll(past);
  fixAll(future);
  applying = true;
  const s = useEditor.getState();
  useEditor.setState(fix({ shots: s.shots, audioTracks: s.audioTracks }));
  queueMicrotask(() => {
    applying = false;
  });
}

function apply(snap: Snap) {
  applying = true;
  /*
    Switch the shelf link first: the switch hooks flush the outgoing content to its own record while
    it is still on screen. Then show the snapshot's content.
  */
  const { shelfId, ...content } = snap;
  if (shelfId !== shelfCurrentId()) setShelfCurrentId(shelfId);
  useEditor.setState({ ...content, playing: false });
  // Release in the next microtask so the subscription does not mistake this
  // write for a new user action.
  queueMicrotask(() => {
    applying = false;
  });
}

/*
  Report what changed after undo. Effects, audio, or edits in another scene
  may be outside the frame, leaving users unsure what Ctrl+Z did.
  Describe the first difference between the two small snapshots;
  comparison is inexpensive.
*/
const LABELS: [keyof Shot, string][] = [
  ['media', 'media'],
  ['deviceId', 'device'],
  ['finishId', 'finish'],
  ['camera', 'camera'],
  ['tracks', 'animation'],
  // Moving a marker also moves tracks, yielding 'animation'; report this only when it changes alone.
  ['focusMarks', 'motion marks'],
  ['scene', 'background'],
  ['light', 'lighting'],
  ['effects', 'effects'],
  ['blur', 'blur'],
  ['texts', 'text'],
  ['annotations', 'annotations'],
  ['deviceOpts', 'device options'],
  ['deviceMotion', 'device motion'],
  ['border', 'border'],
  ['duration', 'duration'],
  ['extras', 'layout'],
  ['transition', 'transition'],
  ['crop', 'crop'],
  ['trim', 'trim'],
  ['playbackRate', 'speed'],
  ['gapBefore', 'gap'],
  ['label', 'scene name'],
  ['aspectId', 'frame ratio'],
];
function describe(a: Snap, b: Snap): string {
  if (a.shots.length !== b.shots.length) return a.shots.length < b.shots.length ? 'scene added' : 'scene removed';
  if (a.aspectId !== b.aspectId) return 'frame ratio';
  if (a.launch !== b.launch) return 'launch package';
  if (JSON.stringify(a.audioTracks) !== JSON.stringify(b.audioTracks)) return 'audio';
  if (a.baseLang !== b.baseLang || JSON.stringify(a.languages) !== JSON.stringify(b.languages)) return 'languages';
  for (let i = 0; i < a.shots.length; i++) {
    const x = a.shots[i];
    const y = b.shots[i];
    if (x.id !== y.id) return 'scene order';
    for (const [k, label] of LABELS) {
      if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) {
        return a.shots.length > 1 ? `${label} · ${y.label}` : label;
      }
    }
  }
  return 'change';
}

export function undo(): boolean {
  // Commit the pending edit first; otherwise undo skips the latest unsaved
  // change and moves one step too far.
  commitNow();
  if (past.length < 2) return false;
  const current = past.pop()!;
  future.push(current);
  const prev = past[past.length - 1];
  apply(prev);
  toast(`Undo — ${describe(current, prev)}`);
  return true;
}

export function redo(): boolean {
  commitNow();
  const next = future.pop();
  if (!next) return false;
  const cur = past[past.length - 1];
  past.push(next);
  apply(next);
  if (cur) toast(`Redo — ${describe(cur, next)}`);
  return true;
}

/*
  Snapshots leaving history (limit, a new edit clearing redo, rebase) may hold the last reference to a
  generated media copy. Report their media URLs so the owner can release copies nothing uses any more.
*/
let onDropped: ((urls: Set<string>) => void) | null = null;
export function onHistoryDropped(fn: ((urls: Set<string>) => void) | null) {
  onDropped = fn;
}
function dropped(list: Snap[]) {
  if (!onDropped || !list.length) return;
  const urls = new Set<string>();
  for (const snap of list) {
    for (const s of snap.shots) {
      if (s.media) urls.add(s.media);
      for (const e of s.extras) if (e.media) urls.add(e.media);
    }
  }
  const fn = onDropped;
  // After the caller finishes updating the stacks.
  queueMicrotask(() => fn(urls));
}

/*
  BATCH: one undo step for a multi-step operation. The Auto-motion solver writes the camera many times
  while it searches; each pause longer than the 350 ms debounce used to become its own undo step, so
  Ctrl+Z walked back through solver poses instead of restoring the scene before Compose.
*/
let batchDepth = 0;
export function beginHistoryBatch() {
  commitNow();
  batchDepth += 1;
}
export function endHistoryBatch() {
  if (batchDepth === 0) return;
  batchDepth -= 1;
  if (batchDepth > 0) return;
  const next = read();
  const last = past[past.length - 1];
  if (last && same(last, next)) return;
  past.push(next);
  const gone = past.length > LIMIT ? [past.shift()!] : [];
  dropped([...gone, ...future]);
  future.length = 0;
}

/** End a batch without recording: the operation was cancelled and the scene put back as it was. */
export function cancelHistoryBatch() {
  if (batchDepth > 0) batchDepth -= 1;
}

/** Is a media URL still used by any undo/redo snapshot? Callers release it only when it is not. */
export function referencedInHistory(url: string): boolean {
  const uses = (snap: Snap) =>
    snap.shots.some((s) => s.media === url || s.scene.bgImage === url || s.extras.some((e) => e.media === url));
  return past.some(uses) || future.some(uses);
}

export function historyDepth() {
  return { undo: Math.max(0, past.length - 1), redo: future.length };
}
