import { dayKey } from "./dates";

// "Groups you left" on the Your groups page: open groups where my own membership has leftAt or removedAt.
// They are kept for good (no time limit): that is where Rejoin, Undo my move-out and the history download are reached.
// Pure functions, so the words and the order can be tested.

type LeaverEntry = { group: { id: string; type?: string; members: { id: string; name: string }[] }; myId: string; leaver?: { leftAt: Date; removed: boolean } | null };

// The groups I left or was removed from, newest first.
export function leftGroups<T extends { leaver?: { leftAt: Date } | null }>(open: T[]): T[] {
  return open.filter((g) => Boolean(g.leaver)).sort((a, b) => b.leaver!.leftAt.getTime() - a.leaver!.leftAt.getTime());
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// "2026-11-16" -> "16 Nov" (no year: the row is a quiet reminder, and Open shows the full date).
export function shortDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ""}` : iso;
}

// The one quiet line under the name.
//   left:     "You left on 16 Nov"        a flat (type home): "You moved out on 2 Nov"
//   removed:  "Asha removed you on 10 Nov" if the person who removed me is known, else "You were removed on 10 Nov"
export function leftLine(g: LeaverEntry, tz: string, removedBy?: string): string {
  const l = g.leaver!;
  const day = shortDay(dayKey(l.leftAt, tz));
  if (l.removed) {
    const who = removedBy ? g.group.members.find((m) => m.id === removedBy && m.id !== g.myId)?.name : undefined;
    return who ? `${who} removed you on ${day}` : `You were removed on ${day}`;
  }
  return g.group.type === "home" ? `You moved out on ${day}` : `You left on ${day}`;
}
