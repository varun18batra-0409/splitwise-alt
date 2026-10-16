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
  return list.length ? list : [{ memberId: e.paidById, amount: e.amount ?? 0 }];
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

// How much an expense adds to "spent": money back takes it away again.
export function spentAmount(e: { amount: number; kind?: string | null }): number {
  return e.kind === "refund" ? -e.amount : e.amount;
}
