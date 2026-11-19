import { spentAmount } from "@/lib/payers";
import { loadGroupView, type loadBalancesSummary, type SlimExpense } from "@/lib/group-data";
import { explainAll, type ExpenseLike, type WhySummary } from "@/lib/explain";
import { foreignLedgers, type Ledger } from "@/lib/currency-ledgers";
import { resolveSecondary } from "@/lib/secondary";
import { after } from "next/server";
import { displayRate } from "@/lib/rate-cache";
import { convertAmount } from "@/lib/conversion";
import { formatMoney } from "@/lib/money";
import { pickAdmin } from "@/lib/group-admin";
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

// `moveOuts: false` skips the one read that finds a flat's move-out payments: only Expenses and Overview show them (everyone else leaves it on, as before).
// What the Balances tab (and the header, banners and People link around it) read, and nothing more: no shares on the expenses.
// A full GroupView is one of these too (its expenses have every column), so the same components draw both.
// Screens that read an expense's shares (Expenses, Overview, This month, Charts...) take GroupView, so the compiler keeps them away from this one.
export type LiteView = Omit<GroupView, "expenses" | "group" | "expenseById"> & {
  expenses: SlimExpense[];
  group: Omit<Group, "expenses"> & { expenses: SlimExpense[] };
};

// The Balances tab's own numbers: the "Why?" totals, how many expenses, the rows the fun titles read, and the rows an open "Why?" lists.
export type BalancesData = {
  count: number; // expenses that count
  titleExpenses: SlimExpense[];
  whyTotals: Record<string, WhySummary>;
  whyRows: ExpenseLike[]; // everything explainBalance may read: all the expenses, or (from the summary) just the open person's
};

// The full method: worked out from every expense and share, as it always was.
export function balancesDataFull(v: GroupView): BalancesData {
  return { count: v.expenses.length, titleExpenses: v.expenses, whyTotals: explainAll(v.group.members.map((m) => m.id), v.expenses, v.payments), whyRows: v.expenses };
}

type SummaryLoaded = NonNullable<Awaited<ReturnType<typeof loadBalancesSummary>>>;

// From the database's one statement.
export function balancesDataSummary(s: SummaryLoaded): BalancesData {
  return { count: s.stmt.count, titleExpenses: s.expenses, whyTotals: s.stmt.why, whyRows: s.openRows };
}

// The Balances tab's view for someone still in the group, from loadBalancesSummary: the same figures buildGroupView gives
// (balances, spent, card-fee flag, other-currency parts, the second currency), without loading any share.
// Left out because the Balances tab never reads them: the history, a flat's move-out payments and a leaver's Undo checks.
export async function buildSummaryView(data: SummaryLoaded, myId: string, tz: string): Promise<LiteView> {
  const { group, stmt } = data;
  const money = (p: number) => formatMoney(p, group.currency);
  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const signed = (minor: number, cur: string) =>
    minor > 0 ? `+${formatMoney(minor, cur)}` : minor < 0 ? `−${formatMoney(-minor, cur)}` : formatMoney(0, cur);
  const ledgers = foreignLedgers(stmt.foreign, group.currency, group.members.map((m) => m.id));
  const secondaryRaw = resolveSecondary(group.secondaryCurrency, group.currency, stmt.foreign);
  const secondary = secondaryRaw && !ledgers.some((l) => l.currency === secondaryRaw) ? secondaryRaw : null;
  const rate = secondary ? await displayRate(group.currency, secondary, after) : null;
  const secondaryRate = rate?.ok ? { rate: rate.rate, date: rate.date } : null;
  const eq = (minor: number): string | null => {
    if (!secondary || !secondaryRate) return null;
    const v = convertAmount(Math.abs(minor), group.currency, secondary, secondaryRate.rate);
    return v === null ? null : `≈ ${formatMoney(v, secondary)}`;
  };
  const undoViewer: UndoViewer = { id: myId, isAdmin: pickAdmin(group.members)?.id === myId, closed: group.closed, members: group.members, payments: group.payments.map((x) => ({ id: x.id, fromId: x.fromId, toId: x.toId, deletedById: x.deletedById })) };
  return {
    group: data.group,
    expenses: data.expenses,
    payments: data.payments,
    net: data.net,
    transfers: data.transfers,
    leaver: data.leaver,
    people: data.people,
    tz,
    myId,
    spent: stmt.spent,
    ledgers,
    hasMarkup: stmt.hasMarkup,
    secondary,
    secondaryRate,
    money,
    nameOf,
    signed,
    eq,
    eventById: new Map(),
    undoViewer,
    moveOutIds: new Set<string>(),
    acrossNames: new Map(),
    leaverChecks: new Map(),
  };
}

export async function buildGroupView(data: Loaded, myId: string, tz: string, opts: { moveOuts?: boolean } = {}): Promise<GroupView> {
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
  const moveOutIds = opts.moveOuts === false ? new Set<string>() : await moveOutPaymentIds(db, [group.id]);

  const undoViewer: UndoViewer = { id: myId, isAdmin: pickAdmin(group.members)?.id === myId, closed: group.closed, members: group.members, payments: group.payments.map((x) => ({ id: x.id, fromId: x.fromId, toId: x.toId, deletedById: x.deletedById })), guest: group.members.find((m) => m.id === myId)?.accountId === null, claimedAt: group.members.find((m) => m.id === myId)?.claimedAt ?? null }; // pickAdmin on the members just loaded (same order, no second read)
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
