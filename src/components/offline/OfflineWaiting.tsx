"use client";

import { useCallback } from "react";
import { removeDraft } from "@/lib/offline/store";
import { DraftRow, WaitingCard } from "./DraftRows";
import { useGroupData } from "./useOffline";

// On the group's Overview, online: the expenses waiting on this phone for this group, first in the list, with "On this phone".
// A refused one says why and offers Open and fix. (Offline, the same rows are drawn by the offline group screen.)
export function OfflineWaiting({ groupId, myId, names }: { groupId: string; myId: string; names: Record<string, string> }) {
  const { kv, drafts, reload } = useGroupData(groupId);
  const nameOf = useCallback((id: string) => (id === myId ? "You" : (names[id] ?? "Someone")), [myId, names]);
  if (!drafts.length) return null;
  return (
    <div data-offline-waiting-online>
      <WaitingCard count={drafts.length} />
      <ul className="-mt-2 mb-5 divide-y divide-line border-t border-line">
        {drafts.map((d) => (
          <DraftRow key={d.key} draft={d} nameOf={nameOf} canFix onRemove={(key) => kv && void removeDraft(kv, key).then(reload)} />
        ))}
      </ul>
    </div>
  );
}
