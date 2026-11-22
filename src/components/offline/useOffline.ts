"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { openStore, storageWorks } from "@/lib/offline/idb";
import { draftsFor, snapshotFor } from "@/lib/offline/store";
import type { Draft } from "@/lib/offline/types";
import type { Snapshot } from "@/lib/offline/snapshot-types";
import type { KV } from "@/lib/offline/store";

// The phone's own storage, for the screens: the waiting expenses (and the group's copy) for one group, kept fresh.
export function useStore(): { kv: KV | null; works: boolean | null } {
  const kv = useMemo(() => (typeof indexedDB === "undefined" ? null : openStore()), []);
  const [works, setWorks] = useState<boolean | null>(null);
  useEffect(() => {
    if (!kv) {
      setWorks(false);
      return;
    }
    void storageWorks(kv).then(setWorks);
  }, [kv]);
  return { kv, works };
}

export function useGroupData(groupId: string | null): { kv: KV | null; works: boolean | null; drafts: Draft[]; snapshot: Snapshot | undefined; loaded: boolean; reload: () => Promise<void> } {
  const { kv, works } = useStore();
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(async () => {
    if (!kv || !groupId) return;
    try {
      setDrafts(await draftsFor(kv, groupId));
      setSnapshot(await snapshotFor(kv, groupId));
    } catch {
      /* storage unavailable: nothing to show */
    }
    setLoaded(true);
  }, [kv, groupId]);
  useEffect(() => {
    if (works === null) return;
    if (!works) {
      setLoaded(true);
      return;
    }
    void reload();
  }, [works, reload]);
  return { kv, works, drafts, snapshot, loaded, reload };
}
