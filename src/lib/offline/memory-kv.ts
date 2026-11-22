import type { KV, StoreName } from "./store";

// An in-memory stand-in for the phone's storage (used by the tests). Values are copied in and out, like the real thing.
export function memoryKV(opts: { failPuts?: boolean } = {}): KV & { dump(): Record<StoreName, unknown[]> } {
  const data: Record<StoreName, Map<string, string>> = { snapshots: new Map(), drafts: new Map(), meta: new Map() };
  return {
    async get<T>(store: StoreName, key: string) {
      const v = data[store].get(key);
      return v === undefined ? undefined : (JSON.parse(v) as T);
    },
    async put(store, key, value) {
      if (opts.failPuts) throw new Error("storage is full");
      data[store].set(key, JSON.stringify(value));
    },
    async del(store, key) {
      data[store].delete(key);
    },
    async all<T>(store: StoreName) {
      return [...data[store].values()].map((v) => JSON.parse(v) as T);
    },
    async wipe() {
      for (const m of Object.values(data)) m.clear();
    },
    dump() {
      return { snapshots: [...data.snapshots.values()].map((v) => JSON.parse(v)), drafts: [...data.drafts.values()].map((v) => JSON.parse(v)), meta: [...data.meta.values()].map((v) => JSON.parse(v)) };
    },
  };
}
