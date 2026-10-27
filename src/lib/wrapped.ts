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
// What each slide draws (amounts already written out, numbers for the bars).
export type SlideData =
  | { kind: "total"; amount: string; each: string; payers: { name: string; amount: string; share: number }[] }
  | { kind: "category"; pct: number; label: string; emoji: string; rest: { label: string; emoji: string; pct: number }[] }
  | { kind: "day"; days: { label: string; share: number; big: boolean }[]; amount: string; label: string }
  | { kind: "splurge"; description: string; amount: string; payer: string; date: string; category: string }
  | { kind: "awards"; awards: { name: string; title: string; emoji: string; why: string }[] };
export type Slide = { kind: "intro" | "total" | "category" | "day" | "splurge" | "awards" | "outro"; headline: string; line: string; emoji?: string; data?: SlideData };

const hourIn = (d: Date, tz: string) => Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(d)) % 24;
const dayIn = (d: Date, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);

// Fun titles: once a group has a few expenses, everyone gets one, about habits
// (never about who's poorest). The strongest titles go first; a tie goes to whoever
// got there first. Anyone left over gets a friendly one of their own.
export function funTitles(expensesIn: WrapExpense[], memberIds: string[], tz: string, currency: string): Award[] {
  const expenses = expensesIn.filter((e) => !e.deletedAt && e.kind !== "pot" && e.kind !== "refund");
  if (expenses.length < 4 || !memberIds.length) return [];
  const money = (n: number) => formatMoney(n, currency);
  const tally = () => new Map<string, number>(memberIds.map((id) => [id, 0]));
  const paidAmount = tally(), paidCount = tally(), food = tally(), night = tally(), added = tally(), rides = tally(), first = tally(), stays = tally(), fun = tally(), shops = tally(), early = tally(), weekend = tally();
  const reached = new Map<string, number>(); // "title|member" → when they got there (for ties)
  const bump = (m: Map<string, number>, id: string, key: string, at: number, by = 1) => {
    if (!m.has(id)) return;
    m.set(id, (m.get(id) ?? 0) + by);
    reached.set(`${key}|${id}`, at);
  };
  const byDay = new Set<string>();
  for (const e of [...expenses].sort((a, b) => (a.spentAt ?? a.createdAt).getTime() - (b.spentAt ?? b.createdAt).getTime())) {
    const at = (e.spentAt ?? e.createdAt).getTime();
    for (const p of payersOf(e)) {
      bump(paidAmount, p.memberId, "bank", at, p.amount);
      bump(paidCount, p.memberId, "count", at);
      if (e.category === "food") bump(food, p.memberId, "food", at);
      if (e.category === "transport") bump(rides, p.memberId, "rides", at);
      if (e.category === "accommodation") bump(stays, p.memberId, "stays", at);
      if (e.category === "activities") bump(fun, p.memberId, "fun", at);
      if (e.category === "shopping" || e.category === "groceries") bump(shops, p.memberId, "shops", at);
      const wd = new Date(`${dayIn(e.spentAt ?? e.createdAt, tz)}T12:00:00Z`).getUTCDay();
      if (wd === 0 || wd === 6) bump(weekend, p.memberId, "weekend", at);
    }
    const h = hourIn(e.createdAt, tz);
    if (e.createdById && (h >= 22 || h < 4)) bump(night, e.createdById, "night", at);
    if (e.createdById && h >= 5 && h < 9) bump(early, e.createdById, "early", at);
    if (e.createdById) bump(added, e.createdById, "added", at);
    const day = dayIn(e.spentAt ?? e.createdAt, tz);
    if (!byDay.has(day)) {
      byDay.add(day);
      bump(first, e.paidById, "first", at);
    }
  }

  // [key, tally, at least, title, emoji, why]
  const kinds: [string, Map<string, number>, number, string, string, (n: number) => string][] = [
    ["bank", paidAmount, 1, "The Banker", "🏦", (n) => `Paid ${money(n)} up front`],
    ["food", food, 2, "Snack Lord", "🍟", (n) => `Paid for food ${n} times`],
    ["stays", stays, 1, "Stay Boss", "🏨", (n) => (n === 1 ? "Sorted a place to stay" : `Sorted ${n} stays`)],
    ["rides", rides, 2, "The Driver", "🚕", (n) => `Covered ${n} rides`],
    ["fun", fun, 1, "Fun Planner", "🎟️", (n) => (n === 1 ? "Paid for the fun stuff" : `Paid for ${n} outings`)],
    ["night", night, 2, "Night Owl", "🦉", (n) => `${n} expenses added after 10 pm`],
    ["first", first, 2, "Always Pays First", "⚡", (n) => `First to pay on ${n} days`],
    ["added", added, 3, "Keeper of Receipts", "🧾", (n) => `Added ${n} expenses`],
    ["shops", shops, 1, "Shopaholic", "🛍️", (n) => (n === 1 ? "Did the shopping" : `Shopped ${n} times`)],
    ["early", early, 2, "Early Bird", "🌅", (n) => `${n} expenses added before 9 am`],
    ["weekend", weekend, 2, "Weekend Warrior", "🎉", (n) => `${n} weekend expenses paid`],
    ["count", paidCount, 2, "Team Player", "🤝", (n) => `Paid ${n} times`],
  ];
  const out: Award[] = [];
  const has = (id: string) => out.some((x) => x.memberId === id);
  for (const [key, m, min, title, emoji, why] of kinds) {
    const best = [...m]
      .filter(([id, n]) => n >= min && !has(id))
      .sort((a, b) => b[1] - a[1] || (reached.get(`${key}|${a[0]}`) ?? 0) - (reached.get(`${key}|${b[0]}`) ?? 0))[0];
    if (best) out.push({ memberId: best[0], title, emoji, why: why(best[1]) });
  }
  // Everyone else: a title of their own (different ones while they last). Never
  // about money: nobody is singled out for paying less.
  const spare: [string, string, string][] = [
    ["Smooth Operator", "😌", "Kept it easy"],
    ["Chief Vibe Officer", "✨", "Brought the good mood"],
    ["The Wildcard", "🃏", "Nobody saw them coming"],
    ["The Chill One", "🧊", "Never broke a sweat"],
    ["Main Character", "🎬", "Every story has one"],
    ["The Navigator", "🧭", "Always knew the way"],
    ["Good Company", "🤝", "Made it a better trip"],
  ];
  let k = 0;
  for (const id of memberIds) {
    if (has(id)) continue;
    const [title, emoji, why] = spare[k++ % spare.length];
    out.push({ memberId: id, title, emoji, why });
  }
  return out;
}

// The trip's days, when it has dates (at most a month of them).
function tripDays(start?: string, end?: string): string[] | null {
  if (!start) return null;
  const out: string[] = [];
  const last = Date.parse(`${end || start}T00:00:00Z`);
  for (let t = Date.parse(`${start}T00:00:00Z`); t <= last && out.length < 31; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out.length ? out : null;
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
  const paidBy = new Map<string, number>();
  for (const e of spentOnes) for (const p of payersOf(e)) paidBy.set(p.memberId, (paidBy.get(p.memberId) ?? 0) + p.amount);
  const paidSum = [...paidBy.values()].reduce((s, n) => s + n, 0) || 1;
  const each = money(Math.round(total / Math.max(1, g.people.length)));
  slides.push({
    kind: "total",
    headline: `${money(total)} spent together`,
    line: `About ${each} each`,
    emoji: "💸",
    data: { kind: "total", amount: money(total), each, payers: [...paidBy].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ name: name(id), amount: money(n), share: n / paidSum })) },
  });

  const cats = new Map<string, number>();
  for (const e of spentOnes) cats.set(e.category, (cats.get(e.category) ?? 0) + e.amount);
  const ranked = [...cats].sort((a, b) => b[1] - a[1]);
  if (ranked.length && total > 0) {
    const [id, amt] = ranked[0];
    const c = getCategory(id);
    const pct = Math.round((amt / Math.max(1, ranked.reduce((s, x) => s + x[1], 0))) * 100);
    const sum = Math.max(1, ranked.reduce((s, x) => s + x[1], 0));
    slides.push({
      kind: "category",
      headline: `${c.label} took ${pct}%`,
      line: ranked[1] ? `Then ${getCategory(ranked[1][0]).label}` : "And not much else",
      emoji: c.emoji,
      data: { kind: "category", pct, label: c.label, emoji: c.emoji, rest: ranked.slice(1, 4).map(([cid, n]) => ({ label: getCategory(cid).label, emoji: getCategory(cid).emoji, pct: Math.round((n / sum) * 100) })) },
    });
  }

  const perDay = new Map<string, number>();
  for (const e of spentOnes) perDay.set(dayIn(e.spentAt ?? e.createdAt, g.tz), (perDay.get(dayIn(e.spentAt ?? e.createdAt, g.tz)) ?? 0) + e.amount);
  if (perDay.size > 1) {
    const [day, amt] = [...perDay].sort((a, b) => b[1] - a[1])[0];
    const label = new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" });
    // Every day of the trip (or every day something was spent), as bars.
    const span = tripDays(g.tripStart, g.tripEnd);
    const all = span && span.includes(day) ? span : [...perDay.keys()].sort();
    const at = all.indexOf(day);
    const from = Math.max(0, Math.min(at - 10, all.length - 21));
    const keys = all.slice(from, from + 21);
    const top = Math.max(...perDay.values(), 1);
    const short = (k: string) => new Date(`${k}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" });
    slides.push({
      kind: "day",
      headline: `${label} was the big one`,
      line: `${money(amt)} that day`,
      emoji: "🌙",
      data: { kind: "day", amount: money(amt), label: short(day), days: keys.map((k) => ({ label: short(k), share: (perDay.get(k) ?? 0) / top, big: k === day })) },
    });
  }

  const big = [...spentOnes].sort((a, b) => b.amount - a.amount)[0];
  const bigDay = new Date(`${dayIn(big.spentAt ?? big.createdAt, g.tz)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  slides.push({
    kind: "splurge",
    headline: `The splurge: ${big.description}`,
    line: `${money(big.amount)}, paid by ${name(big.paidById)}`,
    emoji: "🤑",
    data: { kind: "splurge", description: big.description, amount: money(big.amount), payer: name(big.paidById), date: bigDay, category: getCategory(big.category).label },
  });

  const awards = funTitles(expenses, g.people.map((p) => p.id), g.tz, g.currency);
  if (awards.length)
    slides.push({
      kind: "awards",
      headline: "And the awards go to…",
      line: awards.map((a) => `${a.emoji} ${a.title}: ${name(a.memberId)}`).join("\n"),
      emoji: "🏆",
      data: { kind: "awards", awards: awards.map((a) => ({ name: name(a.memberId), title: a.title, emoji: a.emoji, why: a.why })) },
    });

  slides.push(
    g.stillToSettle > 0
      ? { kind: "outro", headline: `${money(g.stillToSettle)} still to settle`, line: "Close it out and make it official", emoji: "🤝" }
      : { kind: "outro", headline: "All square 🎉", line: "Same time next year?", emoji: "🎉" },
  );
  return { slides, awards, total };
}
