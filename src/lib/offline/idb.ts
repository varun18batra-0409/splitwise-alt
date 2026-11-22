import type { KV, StoreName } from "./store";
import { memoryLock, type Lock } from "./store";

// The phone's storage: one IndexedDB database, "loopin-offline", with three stores (copies of groups, waiting expenses, and who this phone is).
// Browser only. Everything else about keeping things is in store.ts (and tested there).
export const DB_NAME = "loopin-offline";
const STORES: StoreName[] = ["snapshots", "drafts", "meta"];

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no storage"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onerror = () => reject(req.error ?? new Error("no storage"));
    req.onblocked = () => reject(new Error("storage busy"));
    req.onsuccess = () => resolve(req.result);
  });
}

const done = <T,>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

// Resolves when the transaction has really committed (not just when the request was queued).
function tx<T>(db: IDBDatabase, store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("aborted"));
  });
}

export function openStore(): KV {
  let db: Promise<IDBDatabase> | null = null;
  const get = () => (db ??= open().catch((e) => { db = null; throw e; }));
  return {
    async get<T>(store: StoreName, key: string) {
      return (await tx(await get(), store, "readonly", (s) => s.get(key))) as T | undefined;
    },
    async put(store, key, value) {
      await tx(await get(), store, "readwrite", (s) => s.put(value, key));
    },
    async del(store, key) {
      await tx(await get(), store, "readwrite", (s) => s.delete(key));
    },
    async all<T>(store: StoreName) {
      return (await tx(await get(), store, "readonly", (s) => s.getAll())) as T[];
    },
    async wipe() {
      const d = await get();
      for (const s of STORES) await tx(d, s, "readwrite", (st) => st.clear());
    },
  };
}

// Is storage usable at all? (A private window may say no.) Written and read back, then removed.
export async function storageWorks(kv: KV): Promise<boolean> {
  try {
    await kv.put("meta", "probe", { at: Date.now() });
    const ok = Boolean(await kv.get("meta", "probe"));
    await kv.del("meta", "probe");
    return ok;
  } catch {
    return false;
  }
}

// One sender per phone, across tabs: the browser's Web Locks where there are any.
export function phoneLock(): Lock {
  const fallback = memoryLock();
  return (fn) => {
    const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
    if (!locks) return fallback(fn);
    return locks.request("loopin-offline-send", () => fn()) as Promise<Awaited<ReturnType<typeof fn>>>;
  };
}

// Asks the browser to keep this storage (it may refuse; iPhone may ignore it). Called when the first draft is saved.
export function askToKeep(): void {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* not supported */
  }
}

// Sign-out and Delete account: the whole offline database goes. (Also used when the phone's person changes.)
export async function wipePhone(): Promise<void> {
  try {
    await openStore().wipe();
  } catch {
    /* nothing there */
  }
}
