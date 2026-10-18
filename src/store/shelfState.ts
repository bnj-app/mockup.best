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

export function setShelfCurrentId(id: string | null) {
  current = id;
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Private mode: retain for this session only.
  }
  for (const l of listeners) l();
}

/** Any load replacing the entire project (new project, demo, file, link, etc.) detaches it from the shelf. */
export function detachFromShelf() {
  if (shelfCurrentId()) setShelfCurrentId(null);
}

export function subscribeShelfCurrent(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
