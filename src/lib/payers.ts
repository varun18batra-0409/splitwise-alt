import { allocateByWeights } from "./split";

// Who paid for an expense. Usually one person (`paidById`, nothing else
// saved); with more than one payer, `payers` holds each person's part as JSON
// `[{"m": memberId, "a": paise}]`, adding up to the expense's total.
//
// Every place that counts money goes through moneyLines(), so more than one
// payer — and money back (refunds), where the signs flip — is right everywhere.

export type Payer = { memberId: string; amount: number };
type PaidLike = { paidById: string; amount?: number; payers?: string | null };
type LinesLike = PaidLike & { kind?: string | null; shares: { memberId: string; amount: number }[] };

export function parsePayers(json?: string | null): Payer[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return [];
    return v
      .filter((x) => x && typeof x.m === "string" && Number.isSafeInteger(x.a) && x.a > 0)
      .map((x) => ({ memberId: x.m as string, amount: x.a as number }));
  } catch {
    return [];
  }
}

// What's saved: "" for a single payer, else the list.
export function payersJson(payers: Payer[]): string {
  const real = payers.filter((p) => p.amount > 0);
  return real.length < 2 ? "" : JSON.stringify(real.map((p) => ({ m: p.memberId, a: p.amount })));
}

export function payersOf(e: PaidLike): Payer[] {
  const list = parsePayers(e.payers);
  if (!list.length) return [{ memberId: e.paidById, amount: e.amount ?? 0 }];
  // Never trust a list that doesn't add up to the total: keep the proportions.
  const sum = list.reduce((s, p) => s + p.amount, 0);
  return e.amount === undefined || sum === e.amount ? list : allocateByWeights(e.amount, list.map((p) => ({ memberId: p.memberId, weight: p.amount })));
}

export function payerIds(e: PaidLike): string[] {
  return payersOf(e).map((p) => p.memberId);
}

// Who goes up (credits) and who goes down (debits) because of this expense.
// Money back (a refund) is the same expense with the signs flipped: whoever
// got the money owes it to the people it's shared with.
export function moneyLines(e: LinesLike): { credits: Payer[]; debits: Payer[] } {
  const payers = payersOf(e);
  const shares = e.shares.map((s) => ({ memberId: s.memberId, amount: s.amount }));
  return e.kind === "refund" ? { credits: shares, debits: payers } : { credits: payers, debits: shares };
}

// The same payers in another total (e.g. the expense's own currency, without markup).
export function scalePayers(payers: Payer[], total: number): Payer[] {
  const sum = payers.reduce((s, p) => s + p.amount, 0);
  if (sum === total) return payers;
  return allocateByWeights(total, payers.map((p) => ({ memberId: p.memberId, weight: p.amount })));
}

// "You + Asha"
export function payersLabel(payers: Payer[], who: (id: string) => string): string {
  return payers.map((p) => who(p.memberId)).join(" + ");
}

// How much an expense adds to "spent": money back takes it away again. A card
// game's result (The Pot) moves money between players but isn't spending.
export function spentAmount(e: { amount: number; kind?: string | null }): number {
  if (e.kind === "pot") return 0;
  return e.kind === "refund" ? -e.amount : e.amount;
}

// "Who owes whom" for one expense: each person's share is owed to the payers in
// proportion to what they paid; then netted per pair. (Money back: whoever got
// it owes the others.) Pairs are listed in the order people appear in the shares.
export function expensePairs(e: LinesLike): { from: string; to: string; amount: number }[] {
  const { credits, debits } = moneyLines(e);
  const net = new Map<string, number>(); // "a|b": a owes b
  const order: string[] = [];
  const add = (from: string, to: string, amount: number) => {
    if (from === to || amount === 0) return;
    const key = `${from}|${to}`;
    const back = `${to}|${from}`;
    if (net.has(back)) net.set(back, net.get(back)! - amount);
    else {
      if (!net.has(key)) order.push(key);
      net.set(key, (net.get(key) ?? 0) + amount);
    }
  };
  for (const d of debits) {
    const parts = credits.length === 1 ? [{ memberId: credits[0].memberId, amount: d.amount }] : allocateByWeights(d.amount, credits.map((c) => ({ memberId: c.memberId, weight: c.amount })));
    for (const p of parts) add(d.memberId, p.memberId, p.amount);
  }
  return order
    .map((k) => {
      const [a, b] = k.split("|");
      const v = net.get(k) ?? 0;
      return v >= 0 ? { from: a, to: b, amount: v } : { from: b, to: a, amount: -v };
    })
    .filter((p) => p.amount > 0);
}
