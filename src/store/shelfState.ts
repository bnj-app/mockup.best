/**
 * Shelf ID of the open project. This small module is shared by project.ts,
 * whose replacement loaders detach projects from the shelf, and shelf.ts.
 * Importing those modules into each other would create a cycle.

 * Persist in localStorage: after refresh, autosave reopens the same project
 * and must keep updating its shelf record. For hydration safety, read only
 * after mount.
 */

const KEY = 'mockuptop:shelf-current';
let current: string | null | undefined;
const listeners = new Set<() => void>();

/*
  TAB ID: per-tab identity for state that must not be shared between open tabs (autosave copy, the
  open project's local-media list). sessionStorage survives this tab's refreshes and is separate per
  tab; a module fallback covers storage-less browsers.
*/
const TAB_KEY = 'mockuptop:tab-id';
let tab: string | null = null;
export function tabId(): string {
  if (tab) return tab;
  try {
    tab = window.sessionStorage.getItem(TAB_KEY);
  } catch {
    tab = null;
  }
  if (!tab) {
    tab =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    try {
      window.sessionStorage.setItem(TAB_KEY, tab);
    } catch {
      // Module value lasts for this page load.
    }
  }
  return tab;
}

export function shelfCurrentId(): string | null {
  if (current === undefined) {
    try {
      current = window.localStorage.getItem(KEY);
    } catch {
      current = null;
    }
  }
  return current;
}

/*
  Switch hooks. Undo history stores the shelf ID with each snapshot, and the shelf flushes the outgoing
  project to its own record. Both must run BEFORE the ID changes: a pending edit belongs to the project
  being left. They are registered from history.ts and shelf.ts to avoid importing them here (cycle).
*/
type SwitchHook = (from: string | null, to: string | null) => void;
const beforeSwitch = new Set<SwitchHook>();
const afterRetag = new Set<() => void>();

export function onBeforeShelfSwitch(fn: SwitchHook): () => void {
  beforeSwitch.add(fn);
  return () => beforeSwitch.delete(fn);
}

export function onShelfRetag(fn: () => void): () => void {
  afterRetag.add(fn);
  return () => afterRetag.delete(fn);
}

/**
 * Change the open project's shelf ID.
 * - 'switch' (default): the editor content is about to change to another project (open, new, load).
 * - 'retag': the content stays and only its shelf link changes (save as, delete, clear). History
 *   relabels its newest snapshot so undo keeps the right link.
 */
/*
  Switch counter: async work that started on one project (Save as, waiting for a thumbnail and the
  database) checks it before linking its result, so a project opened meanwhile is not relabelled.
*/
let epoch = 0;
export function shelfSwitchEpoch(): number {
  return epoch;
}

export function setShelfCurrentId(id: string | null, mode: 'switch' | 'retag' = 'switch') {
  const from = shelfCurrentId();
  if (mode === 'switch') epoch += 1;
  if (mode === 'switch' && from !== id) for (const fn of beforeSwitch) fn(from, id);
  current = id;
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private mode: retain for this session only.
  }
  if (mode === 'retag') for (const fn of afterRetag) fn();
  for (const l of listeners) l();
}

/** Any load replacing the entire project (new project, demo, file, link, etc.) detaches it from the shelf. */
export function detachFromShelf() {
  if (shelfCurrentId()) setShelfCurrentId(null);
  // Still a project switch for in-flight saves, even with no shelf link to drop.
  else epoch += 1;
}

export function subscribeShelfCurrent(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
