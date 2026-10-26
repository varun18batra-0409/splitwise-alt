import { getCategory } from "./categories";
import { formatMoney } from "./money";
import { payersOf, spentAmount } from "./payers";

// Trip Wrapped: a trip told as a few story slides (how much, where it went, the
// big night, the splurge, everyone's award), and the same awards as fun titles
// on the group's people. Awards are about habits, never about who's poorest.
// Pure, so it can be tested.

export type WrapExpense = {
  description: string;
  amount: number;
  kind?: string | null;
  category: string;
  paidById: string;
  payers?: string | null;
  spentAt?: Date | null;
  createdAt: Date;
  createdById?: string | null;
  deletedAt?: Date | null;
};
export type Award = { memberId: string; title: string; emoji: string; why: string };
export type Slide = { kind: "intro" | "total" | "category" | "day" | "splurge" | "awards" | "outro"; headline: string; line: string; emoji?: string };

const hourIn = (d: Date, tz: string) => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(d)) % 24;
const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);

// Fun titles: each person gets at most one, the strongest first. Needs a few expenses to mean anything.
export function funTitles(expensesIn: WrapExpense[], memberIds: string[], tz: string, currency: string): Award[] {
  const expenses = expensesIn.filter((e) => !e.deletedAt && e.kind !== "pot" && e.kind !== "refund");
  if (expenses.length < 4) return [];
  const money = (n: number) => formatMoney(n, currency);
  const tally = () => new Map<string, number>(memberIds.map((id) => [id, 0]));
  const paidAmount = tally(), paidCount = tally(), food = tally(), night = tally(), added = tally(), rides = tally(), first = tally();
  const byDay = new Map<string, WrapExpense>();
  for (const e of [...expenses].sort((a, b) => (a.spentAt ?? a.createdAt).getTime() - (b.spentAt ?? b.createdAt).getTime())) {
    for (const p of payersOf(e)) {
      paidAmount.set(p.memberId, (paidAmount.get(p.memberId) ?? 0) + p.amount);
      paidCount.set(p.memberId, (paidCount.get(p.memberId) ?? 0) + 1);
      if (e.category === "food") food.set(p.memberId, (food.get(p.memberId) ?? 0) + 1);
      if (e.category === "transport") rides.set(p.memberId, (rides.get(p.memberId) ?? 0) + 1);
    }
    const when = e.createdAt;
    const h = hourIn(when, tz);
    if (e.createdById && (h >= 22 || h < 4)) night.set(e.createdById, (night.get(e.createdById) ?? 0) + 1);
    if (e.createdById) added.set(e.createdById, (added.get(e.createdById) ?? 0) + 1);
    const day = dayIn(e.spentAt ?? e.createdAt, tz);
    if (!byDay.has(day)) {
      byDay.set(day, e);
      first.set(e.paidById, (first.get(e.paidById) ?? 0) + 1);
    }
  }
  const top = (m: Map<string, number>, min: number) => {
    const [id, n] = [...m].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    const tie = [...m].filter(([, v]) => v === n).length > 1;
    return n >= min && !tie ? { id, n } : null;
  };
  const candidates: (Award | null)[] = [
    (() => { const t = top(paidAmount, 1); return t ? { memberId: t.id, title: "The Banker", emoji: "🏦", why: `Paid ${money(t.n)} up front` } : null; })(),
    (() => { const t = top(food, 2); return t ? { memberId: t.id, title: "Snack Lord", emoji: "🍟", why: `Paid for food ${t.n} times` } : null; })(),
    (() => { const t = top(night, 2); return t ? { memberId: t.id, title: "Night Owl", emoji: "🦉", why: `${t.n} expenses added after 10 pm` } : null; })(),
    (() => { const t = top(first, 2); return t ? { memberId: t.id, title: "Always Pays First", emoji: "⚡", why: `First to pay on ${t.n} days` } : null; })(),
    (() => { const t = top(rides, 2); return t ? { memberId: t.id, title: "The Driver", emoji: "🚕", why: `Covered ${t.n} rides` } : null; })(),
    (() => { const t = top(added, 3); return t ? { memberId: t.id, title: "Keeper of Receipts", emoji: "🧾", why: `Added ${t.n} expenses` } : null; })(),
  ];
  const out: Award[] = [];
  for (const a of candidates) if (a && !out.some((x) => x.memberId === a.memberId)) out.push(a);
  return out;
}

export function wrapSlides(g: {
  name: string;
  currency: string;
  tz: string;
  people: { id: string; name: string }[];
  expenses: WrapExpense[];
  tripStart?: string;
  tripEnd?: string;
  stillToSettle: number;
  myId: string;
}): { slides: Slide[]; awards: Award[]; total: number } {
  const expenses = g.expenses.filter((e) => !e.deletedAt && e.kind !== "pot");
  const money = (n: number) => formatMoney(n, g.currency);
  const name = (id: string) => (id === g.myId ? "You" : g.people.find((p) => p.id === id)?.name.split(" ")[0] ?? "Someone");
  const total = expenses.reduce((s, e) => s + (e.kind === "refund" ? -e.amount : spentAmount(e)), 0);
  const spentOnes = expenses.filter((e) => e.kind !== "refund");
  const days = g.tripStart && g.tripEnd ? Math.round((Date.parse(g.tripEnd) - Date.parse(g.tripStart)) / 86_400_000) + 1 : new Set(spentOnes.map((e) => dayIn(e.spentAt ?? e.createdAt, g.tz))).size;
  const slides: Slide[] = [];
  slides.push({ kind: "intro", headline: `${g.name}, wrapped`, line: `${days > 1 ? `${days} days, ` : ""}${g.people.length} of you, ${spentOnes.length} expenses`, emoji: "🎬" });
  if (!spentOnes.length) return { slides, awards: [], total };
  slides.push({ kind: "total", headline: `${money(total)} spent together`, line: `About ${money(Math.round(total / Math.max(1, g.people.length)))} each`, emoji: "💸" });

  const cats = new Map<string, number>();
  for (const e of spentOnes) cats.set(e.category, (cats.get(e.category) ?? 0) + e.amount);
  const ranked = [...cats].sort((a, b) => b[1] - a[1]);
  if (ranked.length && total > 0) {
    const [id, amt] = ranked[0];
    const c = getCategory(id);
    const pct = Math.round((amt / Math.max(1, ranked.reduce((s, x) => s + x[1], 0))) * 100);
    slides.push({ kind: "category", headline: `${c.label} took ${pct}%`, line: ranked[1] ? `Then ${getCategory(ranked[1][0]).label}` : "And not much else", emoji: c.emoji });
  }

  const perDay = new Map<string, number>();
  for (const e of spentOnes) perDay.set(dayIn(e.spentAt ?? e.createdAt, g.tz), (perDay.get(dayIn(e.spentAt ?? e.createdAt, g.tz)) ?? 0) + e.amount);
  if (perDay.size > 1) {
    const [day, amt] = [...perDay].sort((a, b) => b[1] - a[1])[0];
    const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
    slides.push({ kind: "day", headline: `${label} was the big one`, line: `${money(amt)} that day`, emoji: "🌙" });
  }

  const big = [...spentOnes].sort((a, b) => b.amount - a.amount)[0];
  slides.push({ kind: "splurge", headline: `The splurge: ${big.description}`, line: `${money(big.amount)}, paid by ${name(big.paidById)}`, emoji: "🤑" });

  const awards = funTitles(expenses, g.people.map((p) => p.id), g.tz, g.currency);
  if (awards.length) slides.push({ kind: "awards", headline: "And the awards go to…", line: awards.map((a) => `${a.emoji} ${a.title}: ${name(a.memberId)}`).join("\n"), emoji: "🏆" });

  slides.push(
    g.stillToSettle > 0
      ? { kind: "outro", headline: `${money(g.stillToSettle)} still to settle`, line: "Close it out and make it official", emoji: "🤝" }
      : { kind: "outro", headline: "All square 🎉", line: "Same time next year?", emoji: "🎉" },
  );
  return { slides, awards, total };
}
