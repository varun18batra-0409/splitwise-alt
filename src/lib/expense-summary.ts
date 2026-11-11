import { formatMoney } from "./money";
import type { BuiltExpense } from "./expense";

// The one line above "Save expense": what this will add, who paid and what your share is, so a wrong
// amount or split is seen before it's saved. Pure, so it can be checked by hand.
//
//   everyone pays the same    "₹1,200 · 4 people · ₹300 each"
//   uneven, you paid          "₹100 · 3 people · you paid ₹100; your share ₹33.34"
//   uneven, you paid nothing  "₹100 · 3 people · Asha paid; your share ₹33.33"
//   you're not in it          "₹100 · 3 people · Ravi paid ₹100; not shared with you"
//   money back                "₹600 back · 3 people · ₹200 each"
//   one person                "₹500 · for Ravi only"
//   a foreign amount          every figure gets ≈ ("≈ ₹2,575 · 4 people · ≈ ₹643.75 each")

type Preview = Pick<BuiltExpense, "amount" | "kind" | "paidById" | "payers" | "shares">;

export function expenseSummary(preview: Preview, myId: string, currency: string, names: Record<string, string>, converted = false): string {
  const m = (n: number) => `${converted ? "≈ " : ""}${formatMoney(n, currency)}`;
  const name = (id: string) => (id === myId ? "you" : names[id] ?? "Someone");
  const refund = preview.kind === "refund";
  const total = preview.amount;
  const shares = preview.shares.filter((s) => s.amount > 0);
  const n = shares.length;
  const head = refund ? `${m(total)} back` : m(total);

  if (n === 1) return `${head} · for ${name(shares[0].memberId)} only`;

  const prefix = `${head} · ${n} people`;
  const payers = preview.payers.length ? preview.payers : [{ memberId: preview.paidById, amount: total }];
  const myShare = shares.find((s) => s.memberId === myId)?.amount;
  const myPaid = payers.find((p) => p.memberId === myId)?.amount ?? 0;
  const list = (ids: string[]) => (ids.length <= 1 ? ids.join("") : `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`);
  const payerNames = list(payers.map((p) => name(p.memberId)));

  // Not in it at all (neither paying nor sharing).
  if (myShare === undefined && myPaid === 0) return `${prefix} · ${payerNames} ${refund ? "got" : "paid"} ${m(total)}; not shared with you`;

  // Everyone's share is the same.
  if (n >= 2 && shares.every((s) => s.amount === shares[0].amount)) return `${prefix} · ${m(shares[0].amount)} each`;

  const share = m(myShare ?? 0);
  if (myPaid > 0) return `${prefix} · you ${refund ? "got" : "paid"} ${m(myPaid)}${refund ? " back" : ""}; your share ${share}`;
  return `${prefix} · ${payerNames} ${refund ? "got it back" : "paid"}; your share ${share}`;
}
