/**
 * Device storage: a small Promise wrapper over IndexedDB. Why: localStorage autosave has a ~5 MB
 * quota, too small even for one screen recording, so media was deliberately excluded and screens
 * showed "file missing" after refresh. IndexedDB stores Blobs directly on disk with hundreds of MB
 * of quota. Stores: media maps random IDs to { blob, name, type, size, at }; projects maps IDs to
 * saved projects (named shelf); meta maps 'current' to the open project's media mapping. Everything
 * stays in this browser; nothing goes to a server. Hydration rule: call only after mount, never
 * read during first render.
 */

const DB_NAME = 'mockuptop';
const DB_VERSION = 1;
export type StoreName = 'media' | 'projects' | 'meta';

let dbPromise: Promise<IDBDatabase> | null = null;

export function deviceDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media');
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => {
      const db = req.result;
      // Release the connection when another tab upgrades the version; reopen on the next call.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error('indexedDB open failed'));
    };
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        let result: T;
        req.onsuccess = () => {
          result = req.result;
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(tx.error ?? req.error ?? new Error('indexedDB tx failed'));
      }),
  );
}

export const idbGet = <T>(store: StoreName, key: string) => run<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
export const idbPut = (store: StoreName, key: string, value: unknown) => run(store, 'readwrite', (s) => s.put(value, key));
export const idbDelete = (store: StoreName, key: string) => run(store, 'readwrite', (s) => s.delete(key));
export const idbKeys = (store: StoreName) => run<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()).then((k) => k.map(String));
export const idbAll = <T>(store: StoreName) => run<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
export const idbClear = (store: StoreName) => run(store, 'readwrite', (s) => s.clear());

/** Quota exhaustion: an error type to report to users. */
export function isQuotaError(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? '';
  return name === 'QuotaExceededError' || /quota/i.test(String((e as Error)?.message ?? ''));
}
