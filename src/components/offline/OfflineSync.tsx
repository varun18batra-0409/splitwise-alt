"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { fetchDone, fetchMe, markSheetSeen, sheetSeen } from "@/lib/offline/client";
import { openStore } from "@/lib/offline/idb";
import { applyMe, draftsFor, dropAllSnapshots, removeConfirmed, snapshotFor } from "@/lib/offline/store";
import { BackOnlineSheet } from "./BackOnlineSheet";

// Mounted once in the layout. On an ordinary (online) page it:
//  1. asks who this phone is in each group (so a copy or waiting expense is only ever shown to its own person);
//  2. asks the server which waiting expenses were already added (a reply that got lost) and removes only those;
//  3. on a group's page, its Add page or Home, opens the "You're back online" sheet when expenses are waiting.
// It does nothing on the offline screen itself. With the switch off it only clears the group copies.
export function OfflineSync({ on }: { on: boolean }) {
  const path = usePathname();
  const kv = useMemo(() => (typeof indexedDB === "undefined" ? null : openStore()), []);
  const lastMe = useRef(0);
  const serverMe = useRef<Record<string, string> | null>(null); // the server's latest answer: who this phone is in each group
  const [sheet, setSheet] = useState<{ groupId: string; name: string; currency: string; tz: string; names: Record<string, string>; me: string } | null>(null);

  useEffect(() => {
    if (!kv || path.startsWith("/offline-app")) return;
    let live = true;
    void (async () => {
      try {
        if (!on) {
          await dropAllSnapshots(kv);
          return;
        }
        // 1. Who am I? (At most once a minute, and always when landing on Home, where a sign-in usually ends up.)
        if (Date.now() - lastMe.current > 60_000 || path === "/") {
          lastMe.current = Date.now();
          const me = await fetchMe();
          if (me && me.on) {
            serverMe.current = me.groups;
            await applyMe(kv, me.groups);
          }
        }
        // 2. Which of the waiting ones did the server already add?
        const mine = await draftsFor(kv);
        if (mine.length) await removeConfirmed(kv, await fetchDone(mine.map((d) => d.key)));
        // 3. The sheet: for this group's page or Add page, or (on Home) the group with the oldest waiting expense.
        if (new URLSearchParams(window.location.search).get("fix")) return; // fixing one on the Add screen: don't interrupt
        // Only the expenses of the person the server says is signed in here now: another person's never flash after a phone changes hands.
        const waiting = (await draftsFor(kv)).filter((d) => d.status !== "refused" && (!serverMe.current || serverMe.current[d.groupId] === d.memberId));
        const inGroup = /^\/groups\/([^/]+)(?:\/add)?\/?$/.exec(path)?.[1];
        const groupId = inGroup && inGroup !== "new" ? inGroup : path === "/" ? waiting[0]?.groupId : undefined;
        if (!groupId || !waiting.some((d) => d.groupId === groupId) || sheetSeen(groupId)) return;
        const snap = await snapshotFor(kv, groupId);
        const first = waiting.find((d) => d.groupId === groupId)!;
        // Without a copy (older than 30 days) the sheet still opens, with what the expense itself remembers.
        const tz = snap?.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (live) setSheet({ groupId, name: snap?.name ?? "this group", currency: snap?.currency ?? first.seen.baseCurrency, tz, names: Object.fromEntries((snap?.members ?? []).map((m) => [m.id, m.name])), me: first.memberId });
      } catch {
        /* storage unavailable: the app works as it always did */
      }
    })();
    return () => {
      live = false;
    };
  }, [kv, on, path]);

  if (!sheet || !kv || path.startsWith("/offline-app")) return null;
  const close = () => {
    markSheetSeen(sheet.groupId);
    setSheet(null);
  };
  return (
    <BackOnlineSheet
      kv={kv}
      groupId={sheet.groupId}
      groupName={sheet.name}
      currency={sheet.currency}
      tz={sheet.tz}
      nameOf={(id) => (id === sheet.me ? "You" : (sheet.names[id] ?? "Someone"))}
      onClose={close}
    />
  );
}
