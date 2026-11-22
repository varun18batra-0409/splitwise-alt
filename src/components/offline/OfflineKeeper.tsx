"use client";

import { useEffect } from "react";
import { openStore } from "@/lib/offline/idb";
import { dropSnapshot, saveSnapshot } from "@/lib/offline/store";
import type { Snapshot } from "@/lib/offline/snapshot-types";

// On a group page, online: keep the small copy of this group on the phone (so the group and its Add screen can open with no signal).
// With no copy to keep (the person left, or the group is closed or a pair) the old copy is removed. The copy was worked out by the server.
export function OfflineKeeper({ groupId, memberId, snapshot }: { groupId: string; memberId: string; snapshot: Snapshot | null }) {
  useEffect(() => {
    if (typeof indexedDB === "undefined") return;
    const kv = openStore();
    void (snapshot ? saveSnapshot(kv, snapshot) : dropSnapshot(kv, groupId, memberId)).catch(() => {
      /* storage unavailable (a private window): the app works as it always did */
    });
  }, [groupId, memberId, snapshot]);
  return null;
}
