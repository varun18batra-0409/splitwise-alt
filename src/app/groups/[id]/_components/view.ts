import { loadGroup } from "@/lib/group-data";
import { foreignLedgers, type Ledger } from "@/lib/currency-ledgers";
import { resolveSecondary } from "@/lib/secondary";
import { getRate } from "@/lib/rate-cache";
import { convertAmount } from "@/lib/conversion";
import { formatMoney } from "@/lib/money";

// Everything the group screen shows, worked out once and shared by its parts
// (summary, Activity, Balances, Charts).

type Loaded = NonNullable<Awaited<ReturnType<typeof loadGroup>>>;
export type Group = Loaded["group"];
export type GroupExpense = Group["expenses"][number];
export type GroupEvent = Group["events"][number];

export type GroupView = Loaded & {
  myId: string;
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
};

export async function buildGroupView(data: Loaded, myId: string): Promise<GroupView> {
  const { group, expenses } = data;
  const money = (p: number) => formatMoney(p, group.currency);
  const nameOf = (mid: string) => (mid === myId ? "You" : group.members.find((m) => m.id === mid)?.name ?? "Someone");
  const signed = (minor: number, cur: string) =>
    minor > 0 ? `+${formatMoney(minor, cur)}` : minor < 0 ? `−${formatMoney(-minor, cur)}` : formatMoney(0, cur);

  const ledgers = foreignLedgers(expenses, group.currency, group.members.map((m) => m.id));
  const secondaryRaw = resolveSecondary(group.secondaryCurrency, group.currency, expenses);
  const secondary = secondaryRaw && !ledgers.some((l) => l.currency === secondaryRaw) ? secondaryRaw : null;
  const rate = secondary ? await getRate(group.currency, secondary) : null;
  const secondaryRate = rate?.ok ? { rate: rate.rate, date: rate.date } : null;
  const eq = (minor: number): string | null => {
    if (!secondary || !secondaryRate) return null;
    const v = convertAmount(Math.abs(minor), group.currency, secondary, secondaryRate.rate);
    return v === null ? null : `≈ ${formatMoney(v, secondary)}`;
  };

  return {
    ...data,
    myId,
    spent: expenses.reduce((s, e) => s + e.amount, 0),
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
  };
}
