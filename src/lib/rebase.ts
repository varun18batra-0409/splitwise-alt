import { convertAmount, markupAmountOf, parseRate } from "./conversion";
import { allocateByWeights } from "./split";
import { parsePayers, payersJson } from "./payers";
import { netBalances } from "./balances";
import { MAX_MINOR } from "./money";

// Changing a group's currency after expenses exist: every amount is converted
// at one rate (old group currency → new), keeping each expense's ORIGINAL
// amount untouched and every set of shares adding up exactly.

const MAX_DECIMALS = 12;

// "2.8367" × "0.012" = "0.0340404" (exact, rounded to 12 decimals).
export function multiplyRates(a: string, b: string): string | null {
  const x = parseRate(a);
  const y = parseRate(b);
  if (!x || !y) return null;
  const num = x.n * y.n;
  const den = x.scale * y.scale;
  const scale = 10n ** BigInt(MAX_DECIMALS);
  const scaled = (num * scale * 2n + den) / (2n * den); // rounded
  const whole = scaled / scale;
  const frac = (scaled % scale).toString().padStart(MAX_DECIMALS, "0").replace(/0+$/, "");
  const out = frac ? `${whole}.${frac}` : `${whole}`;
  return parseRate(out) ? out : null;
}

type ExpenseIn = {
  originalAmount: number;
  originalCurrency: string;
  exchangeRate: string;
  markupBp: number;
  markupAmount: number;
  payers?: string | null;
  shares: { id: string; memberId: string; amount: number }[];
};

export type RebasedExpense = {
  baseCurrency: string;
  exchangeRate: string;
  rateSource: string;
  convertedAmount: number;
  markupAmount: number;
  amount: number;
  payers: string; // "" for a single payer
  shares: { id: string; amount: number }[];
};

export function rebaseExpense(e: ExpenseIn, oldBase: string, newBase: string, rate: string): RebasedExpense | null {
  let exchangeRate: string;
  let convertedAmount: number;
  let markupAmount: number;

  if (e.originalCurrency === newBase) {
    // Now in the group's own currency: no conversion; any card fee already paid is kept (converted).
    exchangeRate = "1";
    convertedAmount = e.originalAmount;
    const m = convertAmount(e.markupAmount, oldBase, newBase, rate);
    if (m === null) return null;
    markupAmount = m;
  } else {
    const r = e.originalCurrency === oldBase ? rate : multiplyRates(e.exchangeRate, rate);
    if (!r) return null;
    exchangeRate = r;
    const c = convertAmount(e.originalAmount, e.originalCurrency, newBase, r);
    if (c === null || c <= 0) return null;
    convertedAmount = c;
    markupAmount = markupAmountOf(c, e.markupBp);
  }

  const amount = convertedAmount + markupAmount;
  // Too large for the database (and for the app to show): the whole change is refused.
  if (convertedAmount > MAX_MINOR || markupAmount > MAX_MINOR || amount > MAX_MINOR) return null;
  const weights = e.shares.map((s) => ({ memberId: s.id, weight: s.amount }));
  const allocated = allocateByWeights(amount, weights);
  // Keep every share row (some may round to 0 for tiny shares).
  const shares = e.shares.map((s) => ({ id: s.id, amount: allocated.find((a) => a.memberId === s.id)?.amount ?? 0 }));
  // Several payers: their parts are converted the same way, so they still add up to the total.
  const list = parsePayers(e.payers);
  const payers = list.length ? payersJson(allocateByWeights(amount, list.map((p) => ({ memberId: p.memberId, weight: p.amount })))) : "";
  return { baseCurrency: newBase, exchangeRate, rateSource: "converted", convertedAmount, markupAmount, amount, payers, shares };
}

export function rebasePayment(amount: number, oldBase: string, newBase: string, rate: string): number | null {
  const v = convertAmount(amount, oldBase, newBase, rate);
  return v === null || v > MAX_MINOR ? null : v;
}

// ---------- Keeping everyone who is settled up at exactly 0 ----------
//
// Converting every amount on its own rounds each share and each payment separately, so someone who was exactly square
// (or who has left, who must stay at 0) can come out a paisa or two off. keepSquareAtZero() nudges whole minor units
// between shares of the same expense, or between the two sides of a payment, until every such person is back to
// their target. A nudge never changes an expense's total, who paid, or a card game's result.
//
// Fixed = everyone at exactly 0 before, plus everyone who has left (target 0; an old leaver who was not at 0 keeps the
// same sign: target = sign x converted amount). Free = everyone else (they absorb the nudges).
// A "unit move" from u to v makes u's balance +1 and v's -1:
//   (a) an expense (not a card game, not money back) where both have a share and u's is at least 2: u's share -1, v's +1;
//   (a') money back, both have a share, v's share at least 2: v's share -1, u's +1 (a refund's shares are credits);
//   (b) a payment u -> v: +1;   (b') a payment v -> u of at least 2: -1.
// For each fixed person in member order, while their balance is off: pick the shortest chain of unit moves (breadth first,
// ties in member order) from them to someone free or off the opposite way, and apply it. No chain means null.
// Order of rows tried: expenses by (createdAt, id), then payments by (createdAt, id), then expenses split by item last
// (their item lines are never compared to the shares afterwards, but this keeps them exact unless nothing else works).

export type SquareExpense = {
  id: string;
  createdAt: number;
  kind: string | null;
  paidById: string;
  payers: string;
  amount: number;
  itemSplit?: boolean;
  shares: { id: string; memberId: string; amount: number }[];
};
export type SquarePayment = { id: string; createdAt: number; fromId: string; toId: string; amount: number };
export type SquareInput = {
  members: { id: string; left: boolean }[]; // oldest first
  before: { expenses: SquareExpense[]; payments: SquarePayment[] }; // live rows, as they were
  after: { expenses: SquareExpense[]; payments: SquarePayment[] }; // the same rows after plain converting (same ids)
  convert: (minor: number) => number | null; // the group's rate, for an old leaver who was not at 0
};
export type SquareResult = {
  shares: Record<string, number>; // every share row id -> its amount now
  payments: Record<string, number>; // every payment id -> its amount now
  targets: Record<string, number>; // the balance each fixed person must end on
  // How far each row ended from its plain-converted amount (final minus plain): 0 for every row nobody nudged.
  // The caller refuses a change whose nudges are bigger than rounding (see changeGroupCurrency).
  moved: { shares: Record<string, number>; payments: Record<string, number> };
};

type Edge = { t: "e"; u: string; v: string } | { t: "r"; u: string; v: string } | { t: "p+"; p: string } | { t: "p-"; p: string };

export function keepSquareAtZero(input: SquareInput): SquareResult | null {
  const ids = input.members.map((m) => m.id);
  const netBefore = netBalances(ids, input.before.expenses, input.before.payments);
  const shares: Record<string, number> = {};
  const payments: Record<string, number> = {};
  for (const e of input.after.expenses) for (const s of e.shares) shares[s.id] = s.amount;
  for (const p of input.after.payments) payments[p.id] = p.amount;
  const net = netBalances(ids, input.after.expenses, input.after.payments);
  const movedBy = (): SquareResult["moved"] => {
    const out: SquareResult["moved"] = { shares: {}, payments: {} };
    for (const e of input.after.expenses) for (const s of e.shares) out.shares[s.id] = shares[s.id] - s.amount;
    for (const p of input.after.payments) out.payments[p.id] = payments[p.id] - p.amount;
    return out;
  };

  const targets: Record<string, number> = {};
  const need: Record<string, number> = {};
  for (const m of input.members) {
    const b = netBefore[m.id] ?? 0;
    if (b === 0) targets[m.id] = 0;
    else if (m.left) {
      const c = input.convert(Math.abs(b));
      if (c === null) return null;
      targets[m.id] = b < 0 ? -c : c;
    } else continue; // free
    need[m.id] = targets[m.id] - (net[m.id] ?? 0);
  }
  if (Object.values(need).every((n) => n === 0)) return { shares, payments, targets, moved: movedBy() };

  // Which rows could carry a unit from u to v, in the order to try them.
  const edges = new Map<string, Edge[]>();
  const add = (u: string, v: string, e: Edge) => {
    const k = `${u}|${v}`;
    const list = edges.get(k);
    if (list) list.push(e);
    else edges.set(k, [e]);
  };
  const byAge = <T extends { id: string; createdAt: number }>(a: T, b: T) => a.createdAt - b.createdAt || a.id.localeCompare(b.id);
  const live = input.after.expenses.filter((e) => e.kind !== "pot");
  const rowOf = new Map<string, Map<string, string>>(); // expense id -> member id -> share row id
  for (const e of live) {
    const m = new Map<string, string>();
    for (const s of e.shares) if (!m.has(s.memberId)) m.set(s.memberId, s.id);
    rowOf.set(e.id, m);
  }
  const addExpenses = (list: SquareExpense[]) => {
    for (const e of [...list].sort(byAge)) {
      const members = [...rowOf.get(e.id)!.keys()];
      for (const u of members) for (const v of members) if (u !== v) add(u, v, { t: e.kind === "refund" ? "r" : "e", u: rowOf.get(e.id)!.get(u)!, v: rowOf.get(e.id)!.get(v)! });
    }
  };
  addExpenses(live.filter((e) => !e.itemSplit));
  for (const p of [...input.after.payments].sort(byAge)) {
    add(p.fromId, p.toId, { t: "p+", p: p.id });
    add(p.toId, p.fromId, { t: "p-", p: p.id });
  }
  addExpenses(live.filter((e) => e.itemSplit));

  // Is the move u -> v possible on this one row right now? (Returns a function that does it.)
  const usable = (e: Edge): (() => void) | null => {
    if (e.t === "e") return shares[e.u] >= 2 ? () => { shares[e.u] -= 1; shares[e.v] += 1; } : null;
    if (e.t === "r") return shares[e.v] >= 2 ? () => { shares[e.v] -= 1; shares[e.u] += 1; } : null;
    if (e.t === "p+") return payments[e.p] < MAX_MINOR ? () => { payments[e.p] += 1; } : null;
    return payments[e.p] >= 2 ? () => { payments[e.p] -= 1; } : null;
  };
  const move = (u: string, v: string): (() => void) | null => {
    for (const e of edges.get(`${u}|${v}`) ?? []) {
      const f = usable(e);
      if (f) return f;
    }
    return null;
  };

  for (const m of input.members) {
    if (!(m.id in need)) continue;
    while (need[m.id] !== 0) {
      const up = need[m.id] > 0; // up: m must gain, so a chain runs from m to someone who can give
      // Breadth first. prev[x] = the person before x on the chain.
      const prev = new Map<string, string>([[m.id, ""]]);
      let queue = [m.id];
      let end: string | null = null;
      while (queue.length && end === null) {
        const next: string[] = [];
        for (const x of queue) {
          for (const y of ids) {
            if (prev.has(y)) continue;
            if (!(up ? move(x, y) : move(y, x))) continue;
            prev.set(y, x);
            if (!(y in need) || (up ? need[y] < 0 : need[y] > 0)) { end = y; break; }
            next.push(y);
          }
          if (end !== null) break;
        }
        queue = next;
      }
      if (end === null) return null;
      // Walk back from the end, doing each move.
      let y = end;
      while (prev.get(y)) {
        const x = prev.get(y)!;
        const f = up ? move(x, y) : move(y, x);
        if (!f) return null;
        f();
        y = x;
      }
      need[m.id] += up ? -1 : 1;
      if (end in need) need[end] += up ? 1 : -1;
    }
  }

  // The proof: re-add everything.
  const check = netBalances(
    ids,
    input.after.expenses.map((e) => ({ ...e, shares: e.shares.map((s) => ({ memberId: s.memberId, amount: shares[s.id] })) })),
    input.after.payments.map((p) => ({ ...p, amount: payments[p.id] })),
  );
  for (const id of Object.keys(targets)) if ((check[id] ?? 0) !== targets[id]) return null;
  return { shares, payments, targets, moved: movedBy() };
}
