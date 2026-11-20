import { spentAmount } from "@/lib/payers";
import { loadGroupView } from "@/lib/group-data";
import { foreignLedgers, type Ledger } from "@/lib/currency-ledgers";
import { resolveSecondary } from "@/lib/secondary";
import { after } from "next/server";
import { displayRate } from "@/lib/rate-cache";
import { convertAmount } from "@/lib/conversion";
import { formatMoney } from "@/lib/money";
import { isGroupAdmin } from "@/lib/group-admin";
import { leaverUndoChecks, type CanUndo, type UndoViewer } from "@/lib/undo";
import { db } from "@/lib/db";
import { parseUndo } from "@/lib/events";
import { moveOutPaymentIds } from "@/lib/payment-change";

// Everything the group screen shows, worked out once and shared by its parts
// (summary, Activity, Balances, Charts).

type Loaded = NonNullable<Awaited<ReturnType<typeof loadGroupView>>>;
export type Group = Loaded["group"];
export type GroupExpense = Group["expenses"][number];
export type GroupEvent = Group["events"][number];

export type GroupView = Loaded & {
  myId: string;
  tz: string; // the viewer's time zone
  spent: number; // group currency, incl. markup
  ledgers: Ledger[]; // per foreign currency, without markup
  hasMarkup: boolean;
  secondary: string | null; // ≈ currency (only when it has no expenses of its own)
  secondaryRate: { rate: string; date: string } | null;
  money: (minor: number) => string;
  nameOf: (memberId: string) => string; // "You" for me
  signed: (minor: number, currency: string) => string;
  eq: (minor: number) => string | null; // "≈ THB 908"
  expenseById: Map<string, GroupExpense>;
  eventById: Map<string, GroupEvent>;
  leaverChecks: Map<string, CanUndo>; // for someone who has left: Undo of their own leave / move-out lines, judged on the FULL history (what the server does)
  undoViewer: UndoViewer; // who is looking, as canUndo wants them (the full member list, not the leaver-scoped one)
  moveOutIds: Set<string>; // this group's flat move-out final payments: the only payments that still say "waiting" for Got it / Not received
  acrossNames: Map<string, string[]>; // a payment recorded across several groups: the names of those groups (so Delete can say it takes them all off)
};

export async function buildGroupView(data: Loaded, myId: string, tz: string): Promise<GroupView> {
  const { group, expenses } = data;
  const money = (p: number) => formatMoney(p, group.currency);
  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const signed = (minor: number, cur: string) =>
    minor > 0 ? `+${formatMoney(minor, cur)}` : minor < 0 ? `−${formatMoney(-minor, cur)}` : formatMoney(0, cur);

  const ledgers = foreignLedgers(expenses, group.currency, group.members.map((m) => m.id));
  const secondaryRaw = resolveSecondary(group.secondaryCurrency, group.currency, expenses);
  const secondary = secondaryRaw && !ledgers.some((l) => l.currency === secondaryRaw) ? secondaryRaw : null;
  // Saved rate only: the screen never waits for the internet (a stale rate refreshes after it's sent).
  const rate = secondary ? await displayRate(group.currency, secondary, after) : null;
  const secondaryRate = rate?.ok ? { rate: rate.rate, date: rate.date } : null;
  const eq = (minor: number): string | null => {
    if (!secondary || !secondaryRate) return null;
    const v = convertAmount(Math.abs(minor), group.currency, secondary, secondaryRate.rate);
    return v === null ? null : `≈ ${formatMoney(v, secondary)}`;
  };

  // A payment recorded across several groups (the all-groups Settle page) names its parts in its first "recorded" line.
  const acrossParts = new Map<string, string[]>();
  for (const ev of group.events) {
    if (ev.kind !== "payment_recorded" || !ev.paymentId) continue;
    const u = parseUndo(ev.undo);
    if (u?.type === "payment_delete" && u.across && u.across.parts.length > 1) acrossParts.set(ev.paymentId, u.across.parts.map((x) => x.groupId));
  }
  const acrossGroupIds = [...new Set([...acrossParts.values()].flat())];
  const acrossGroups = acrossGroupIds.length ? await db.group.findMany({ where: { id: { in: acrossGroupIds } }, select: { id: true, name: true } }) : [];
  const acrossNames = new Map([...acrossParts].map(([pid, gids]) => [pid, gids.map((gid) => acrossGroups.find((x) => x.id === gid)?.name).filter((n): n is string => Boolean(n))] as [string, string[]]));
  const moveOutIds = await moveOutPaymentIds(db, [group.id]);

  const undoViewer: UndoViewer = { id: myId, isAdmin: await isGroupAdmin(group.id, myId), closed: group.closed, members: group.members, payments: group.payments.map((x) => ({ id: x.id, fromId: x.fromId, toId: x.toId, deletedById: x.deletedById })), guest: group.members.find((m) => m.id === myId)?.accountId === null, claimedAt: group.members.find((m) => m.id === myId)?.claimedAt ?? null };
  return {
    ...data,
    tz,
    myId,
    spent: expenses.reduce((s, e) => s + spentAmount(e), 0),
    ledgers,
    hasMarkup: expenses.some((e) => e.markupAmount > 0),
    secondary,
    secondaryRate,
    money,
    nameOf,
    signed,
    eq,
    expenseById: new Map(group.expenses.map((e) => [e.id, e])),
    eventById: new Map(group.events.map((ev) => [ev.id, ev])),
    undoViewer,
    moveOutIds,
    acrossNames,
    leaverChecks: data.leaver && !data.leaver.removed ? await leaverUndoChecks(group.id, undoViewer, new Date()) : new Map(),
  };
}
