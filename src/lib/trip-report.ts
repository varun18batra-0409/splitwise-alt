import { payersOf, spentAmount } from "./payers";
import { CATEGORIES, getCategory } from "./categories";
import { dayKey, expenseDate } from "./dates";
import { niceDate } from "./format";
import { decimalsOf, formatMoney } from "./money";
import type { Transfer } from "./settle";

// The trip report (and the short "insight" lines shown on a trip's Charts tab):
// totals, days, per person, top categories, biggest expense, who paid most and
// how to settle. Pure, so it can be tested; no AI, just counting.

type Member = { id: string; name: string; leftAt?: Date | null };
type Expense = {
  id: string;
  description: string;
  amount: number;
  kind?: string | null;
  category: string;
  paidById: string;
  payers?: string | null;
  spentAt?: Date | null;
  createdAt: Date;
  shares: { memberId: string; amount: number }[];
};

export type TripReport = {
  name: string;
  trip: boolean; // a trip (else another kind of group: the wording changes)
  currency: string;
  total: number;
  count: number;
  from: string; // "2026-10-10" ("" when there are no expenses)
  to: string;
  days: number;
  perDay: number;
  people: number;
  perPerson: number; // the average share
  categories: { id: string; label: string; emoji: string; amount: number; pct: number }[]; // biggest first
  biggest: { description: string; amount: number } | null;
  topPayer: { id: string; name: string; amount: number } | null;
  busiestDay: { day: string; amount: number } | null;
  shares: { id: string; name: string; amount: number }[]; // what each person's part came to, biggest first
  settle: { from: string; to: string; amount: number }[]; // names
};

export function tripReport(input: { name: string; type?: string; currency: string; members: Member[]; expenses: Expense[]; transfers: Transfer[]; tz: string }): TripReport {
  const { members, expenses, tz } = input;
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "Someone";
  const total = expenses.reduce((s, e) => s + spentAmount(e), 0);
  const dayList = expenses.map((e) => dayKey(expenseDate(e), tz)).sort();
  const from = dayList[0] ?? "";
  const to = dayList[dayList.length - 1] ?? "";
  const days = from ? Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1 : 0;

  const byCat = new Map<string, number>();
  const paid = new Map<string, number>();
  const share = new Map<string, number>();
  const perDay = new Map<string, number>();
  for (const e of expenses) {
    const sign = e.kind === "refund" ? -1 : 1;
    const cat = getCategory(e.category).id;
    byCat.set(cat, (byCat.get(cat) ?? 0) + spentAmount(e));
    for (const p of payersOf(e)) paid.set(p.memberId, (paid.get(p.memberId) ?? 0) + sign * p.amount);
    for (const s of e.shares) share.set(s.memberId, (share.get(s.memberId) ?? 0) + sign * s.amount);
    const d = dayKey(expenseDate(e), tz);
    perDay.set(d, (perDay.get(d) ?? 0) + spentAmount(e));
  }
  const categories = CATEGORIES.filter((c) => (byCat.get(c.id) ?? 0) > 0)
    .map((c) => ({ id: c.id, label: c.label, emoji: c.emoji, amount: byCat.get(c.id)!, pct: total > 0 ? Math.round((byCat.get(c.id)! * 100) / total) : 0 }))
    .sort((a, b) => b.amount - a.amount);
  const real = expenses.filter((e) => e.kind !== "refund");
  const big = real.reduce<Expense | null>((b, e) => (!b || e.amount > b.amount ? e : b), null);
  const top = [...paid.entries()].filter(([, a]) => a > 0).sort((a, b) => b[1] - a[1])[0];
  const busy = [...perDay.entries()].sort((a, b) => b[1] - a[1])[0];
  const involved = members.filter((m) => (share.get(m.id) ?? 0) !== 0 || (paid.get(m.id) ?? 0) !== 0);
  const people = Math.max(1, involved.length);

  // "About ₹3,450 a day" reads better without paise.
  const unit = 10 ** decimalsOf(input.currency);
  const whole = (x: number) => Math.round(x / unit) * unit;
  return {
    name: input.name,
    trip: (input.type ?? "trip") === "trip",
    currency: input.currency,
    total,
    count: expenses.length,
    from,
    to,
    days,
    perDay: days ? whole(total / days) : 0,
    people: involved.length,
    perPerson: whole(total / people),
    categories,
    biggest: big ? { description: big.description, amount: big.amount } : null,
    topPayer: top ? { id: top[0], name: nameOf(top[0]), amount: top[1] } : null,
    busiestDay: busy && days > 1 ? { day: busy[0], amount: busy[1] } : null,
    shares: involved.map((m) => ({ id: m.id, name: m.name, amount: share.get(m.id) ?? 0 })).sort((a, b) => b.amount - a.amount),
    settle: input.transfers.map((t) => ({ from: nameOf(t.from), to: nameOf(t.to), amount: t.amount })),
  };
}

const shortDate = (d: string) => niceDate(d).replace(/ \d{4}$/, "");
export function dateRange(r: Pick<TripReport, "from" | "to">): string {
  if (!r.from) return "";
  if (r.from === r.to) return niceDate(r.from);
  return r.from.slice(0, 4) === r.to.slice(0, 4) ? `${shortDate(r.from)} – ${niceDate(r.to)}` : `${niceDate(r.from)} – ${niceDate(r.to)}`;
}

// The message that goes to WhatsApp with the picture (or on its own). No link to the group.
export function reportText(r: TripReport): string {
  const m = (x: number) => formatMoney(x, r.currency);
  const lines = [
    r.trip ? `🧳 ${r.name}: the trip in numbers` : `📊 ${r.name}: in numbers`,
    [dateRange(r), r.days > 1 ? `${r.days} days` : "", `${r.count} ${r.count === 1 ? "expense" : "expenses"}`].filter(Boolean).join(" · "),
    `Total ${m(r.total)}${r.people > 1 ? ` · about ${m(r.perPerson)} each` : ""}${r.days > 1 ? ` · ${m(r.perDay)} a day` : ""}`,
  ];
  if (r.categories.length) lines.push(`Went on: ${r.categories.slice(0, 3).map((c) => `${c.emoji} ${c.label} ${c.pct}%`).join(" · ")}`);
  if (r.biggest) lines.push(`Biggest: ${r.biggest.description} (${m(r.biggest.amount)})`);
  if (r.topPayer && r.people > 1) lines.push(`Paid the most: ${r.topPayer.name} (${m(r.topPayer.amount)})`);
  lines.push("");
  if (r.settle.length) {
    lines.push("To settle up:");
    for (const s of r.settle) lines.push(`• ${s.from} pays ${s.to} ${m(s.amount)}`);
  } else lines.push("All settled ✅");
  lines.push("", "Split with Loopin");
  return lines.join("\n");
}

// Up to three short lines for the top of a trip's (or any group's) Charts tab.
export function insightLines(r: TripReport, myId: string): string[] {
  const m = (x: number) => formatMoney(x, r.currency);
  const out: string[] = [];
  if (r.count < 3 || r.total <= 0) return out;
  const top = r.categories[0];
  if (top && top.pct >= 30) out.push(`${top.emoji} ${top.label} is ${top.pct}% of all spending (${m(top.amount)}).`);
  if (r.days > 1) out.push(`About ${m(r.perDay)} a day over ${r.days} days${r.busiestDay ? `; the biggest day was ${shortDate(r.busiestDay.day)} (${m(r.busiestDay.amount)})` : ""}.`);
  if (r.topPayer && r.people > 1) {
    const pct = Math.round((r.topPayer.amount * 100) / r.total);
    out.push(r.topPayer.id === myId ? `You’ve paid ${pct}% of everything so far.` : `${r.topPayer.name} has paid the most: ${pct}% of everything.`);
  }
  return out.slice(0, 3);
}

