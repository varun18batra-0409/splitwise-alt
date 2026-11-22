import { dayLabel, type ActivityItem } from "../activity";
import { balanceParts, summaryLine } from "../group-summary-text";
import { recentRows } from "../group-overview";
import { headerTripLine, tripPhase } from "../countdown";
import { todayKey } from "../dates";
import { formatMoney } from "../money";
import { paymentEffectLabel, paymentSubline, paymentTitle } from "../payment-words";
import type { ActivityRowCopy, Snapshot } from "./snapshot-types";

// The small copy of a group that is kept on the phone while online. It is worked out HERE, on the server, from values the group page
// already computed (the balance, the transfers, the newest rows); nothing is calculated on the phone, and the offline screen never adds
// a waiting expense into it. It holds names and your own balance, never a phone number or an email.
type Members = { id: string; name: string; leftAt: Date | null; splitWeight: number }[];
export type SnapshotView = {
  myId: string;
  tz: string;
  leaver: unknown;
  net: Record<string, number>;
  transfers: { from: string; to: string; amount: number }[];
  nameOf: (id: string) => string;
  money: (minor: number) => string;
  eq: (minor: number) => string | null;
  group: {
    id: string;
    name: string;
    type: string;
    currency: string;
    cardMarkupBp: number;
    closed: boolean;
    deletedAt: Date | null;
    tripStart: string;
    tripEnd: string;
    members: Members;
    expenses: Parameters<typeof recentRows>[0];
    payments: Parameters<typeof recentRows>[1];
  };
  moveOutIds?: Set<string>;
};

// One row, as plain words (the same words the group's Recent expenses show).
export function rowCopy(item: ActivityItem, v: Pick<SnapshotView, "nameOf" | "money" | "tz">, now: Date): ActivityRowCopy | null {
  const when = dayLabel(item.date, now, v.tz);
  if (item.kind === "payment") {
    const deleted = item.deletedById !== null;
    return {
      id: item.id,
      title: paymentTitle(v.nameOf(item.fromId), v.nameOf(item.toId), item.status, deleted),
      category: "payment",
      line: paymentSubline(item.status, v.nameOf(item.toId), deleted, deleted ? "Deleted" : ""),
      when,
      effectLabel: paymentEffectLabel(item.status, item.effect, deleted),
      effectAmount: deleted || item.effect === 0 ? "" : v.money(Math.abs(item.effect)),
      tone: deleted || item.effect === 0 ? "none" : item.effect > 0 ? "owed" : "owe",
    };
  }
  if (item.kind !== "expense") return null;
  const shown = item.original ? formatMoney(item.original.amount, item.original.currency) : v.money(item.amount);
  const payers = (item.payerIds ?? [item.paidById]).map(v.nameOf).join(" + ");
  const deleted = item.deletedById !== null;
  const base = { id: item.id, title: item.title, category: item.category, when };
  if (deleted) return { ...base, line: `Deleted · ${shown}`, effectLabel: "deleted", effectAmount: "", tone: "none" };
  const line = `${payers} ${item.refund ? "got back" : "paid"} ${shown}`;
  if (item.effect > 0) return { ...base, line, effectLabel: item.refund ? "you get back" : "you lent", effectAmount: v.money(item.effect), tone: "owed" };
  if (item.effect < 0) return { ...base, line, effectLabel: "you owe", effectAmount: v.money(-item.effect), tone: "owe" };
  const mine = [...(item.payerIds ?? [item.paidById]), ...item.people].some((id) => v.nameOf(id) === "You");
  return { ...base, line, effectLabel: mine ? "your own" : "not involved", effectAmount: "", tone: "none" };
}

// Not kept for someone who left, a closed or deleted group, or a pair (two-person group): those are not added to offline in version 1.
export function buildSnapshot(v: SnapshotView, o: { splitName: string; now?: Date }): Snapshot | null {
  const g = v.group;
  if (v.leaver || g.closed || g.deletedAt || g.type === "direct") return null;
  const now = o.now ?? new Date();
  const mine = v.net[v.myId] ?? 0;
  const hasHistory = g.expenses.length > 0 || g.payments.length > 0;
  const parts = balanceParts(mine, g.currency);
  const active = g.members.filter((m) => !m.leftAt);
  const phase = g.type === "trip" ? tripPhase(g.tripStart, g.tripEnd, todayKey(now, v.tz)) : null;
  const rows = recentRows(g.expenses, g.payments, v.myId, 3, v.moveOutIds)
    .map((r) => rowCopy(r, v, now))
    .filter((r): r is ActivityRowCopy => r !== null);
  return {
    memberId: v.myId,
    groupId: g.id,
    name: g.name,
    type: g.type,
    currency: g.currency,
    cardMarkupBp: g.cardMarkupBp,
    splitName: o.splitName,
    tz: v.tz,
    peopleCount: active.length,
    dayLine: (phase && headerTripLine(phase)) || "",
    members: active.map((m) => ({ id: m.id, name: m.name, splitWeight: m.splitWeight })),
    balance: {
      paise: mine,
      text: parts.text,
      eq: mine !== 0 ? (v.eq(mine) ?? "") : "",
      tone: parts.tone,
      label: parts.label,
      summary: hasHistory ? summaryLine(v) : "",
      canSettle: v.transfers.length > 0 && hasHistory,
    },
    rows,
    savedAt: now.toISOString(),
  };
}
