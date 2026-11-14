import { daysBetween } from "../countdown";

// Home's one "needs you" line under the money card. It folds in everything that waits on you: the things only you can answer (someone says
// they paid you, a bill waiting for its amount, a collection payment to check), a bill that is due soon in your flat, a postcard that has
// arrived, and a group that is square and quiet (ready to close). The most important comes first; several become "… and 2 more".
// What used to be said by the sliding cards at the top of Home (a bill due, a postcard waiting) lives here now, only when it asks something of you.

export type NeedKind = "claim" | "payment" | "collect" | "bill" | "bill-due" | "postcard" | "close";
export type NeedItem = { key: string; kind: NeedKind; text: string; action: string; href: string; orange?: boolean };
export type NeedSummary = { text: string; action: string; href: string; count: number };

// Most important first: money someone says they paid you, then a collection to check, a bill that waits for you, a bill due soon, a postcard,
// and last the quiet "ready to close".
const RANK: Record<NeedKind, number> = { claim: 0, payment: 1, collect: 2, bill: 3, "bill-due": 4, postcard: 5, close: 6 };

export const BILL_DUE_DAYS = 3; // "due soon": today and the next three days

export type DueBill = { groupId: string; billId: string; name: string; group: string; due: string };

const when = (d: number) => (d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);

// Bills due today or within BILL_DUE_DAYS, soonest first. `today` and `due` are days ("2026-11-14").
export function billDueNeeds(bills: DueBill[], today: string): NeedItem[] {
  return bills
    .map((b) => ({ b, days: daysBetween(today, b.due) }))
    .filter((x) => Number.isFinite(x.days) && x.days >= 0 && x.days <= BILL_DUE_DAYS)
    .sort((x, y) => x.days - y.days || x.b.name.localeCompare(y.b.name) || x.b.billId.localeCompare(y.b.billId))
    .map(({ b, days }) => ({ key: `due:${b.billId}:${b.due}`, kind: "bill-due" as const, text: `${b.name} is due ${when(days)}`, action: "See bill", href: `/groups/${b.groupId}/bills/${b.billId}` }));
}

// Postcards that have arrived and are still unread (sealed ones aren't counted by the loader).
export function postcardNeed(count: number): NeedItem | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return { key: "postcards", kind: "postcard", text: count === 1 ? "A postcard is waiting for you" : `${count} postcards are waiting for you`, action: "Open", href: "/postcards" };
}

// The one line. Nothing: null. One: that one. Several payments to confirm and nothing else: "3 payments to confirm" (Alerts lists them). Several
// things that are all answers only you can give: "3 things need you" (Alerts lists them). Anything else: the most important one, "… and N more",
// linking to that one's own place.
export function needLine(items: NeedItem[]): NeedSummary | null {
  if (items.length === 0) return null;
  const sorted = items.map((it, i) => ({ it, i })).sort((a, b) => RANK[a.it.kind] - RANK[b.it.kind] || a.i - b.i).map((x) => x.it);
  if (sorted.length === 1) return { text: sorted[0].text, action: sorted[0].action, href: sorted[0].href, count: 1 };
  const answers = sorted.every((n) => n.kind === "claim" || n.kind === "payment" || n.kind === "collect" || n.kind === "bill");
  if (answers) {
    const money = sorted.every((n) => n.kind === "claim" || n.kind === "payment");
    return { text: money ? `${sorted.length} payments to confirm` : `${sorted.length} things need you`, action: "See them", href: "/notifications", count: sorted.length };
  }
  const top = sorted[0];
  return { text: `${top.text.replace(/\.$/, "")}, and ${sorted.length - 1} more`, action: top.action, href: top.href, count: sorted.length };
}
