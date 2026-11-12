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

// "Who owes whom" for one expense, worked out from each person's net for this expense (what they put in
// minus their share; money back flips it), then matched up debtor to creditor. Working from the nets means
// nobody is shown owing someone they are actually owed by, the pairs are as few as can be, and what each person
// owes or is owed adds up exactly with the balances. Debtors and creditors keep the order they appear in.
export function expensePairs(e: LinesLike): { from: string; to: string; amount: number }[] {
  const { credits, debits } = moneyLines(e);
  const net = new Map<string, number>();
  for (const c of credits) net.set(c.memberId, (net.get(c.memberId) ?? 0) + c.amount);
  for (const d of debits) net.set(d.memberId, (net.get(d.memberId) ?? 0) - d.amount);
  const seen = (list: Payer[]) => [...new Set(list.map((x) => x.memberId))];
  const owe = seen(debits).filter((id) => (net.get(id) ?? 0) < 0).map((id) => ({ id, left: -(net.get(id) ?? 0) }));
  const owed = seen(credits).filter((id) => (net.get(id) ?? 0) > 0).map((id) => ({ id, left: net.get(id) ?? 0 }));
  const out: { from: string; to: string; amount: number }[] = [];
  let j = 0;
  for (const d of owe) {
    while (d.left > 0 && j < owed.length) {
      const pay = Math.min(d.left, owed[j].left);
      out.push({ from: d.id, to: owed[j].id, amount: pay });
      d.left -= pay;
      owed[j].left -= pay;
      if (owed[j].left === 0) j++;
    }
  }
  return out;
}
