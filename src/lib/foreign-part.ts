import { currencyInfo, formatMoney } from "./money";

// The sub-line under a person's balance when part of it comes from spending in another currency:
// "Includes THB 5,099.17 from Thai baht spends". The currency code is always in the amount (never a bare number);
// the direction (gets / owes) is already on the right of the row, so it is not repeated here.
export function foreignPartLine(parts: { currency: string; amount: number }[]): string {
  const list = parts.filter((p) => p.amount !== 0).map((p) => `${formatMoney(Math.abs(p.amount), p.currency)} from ${currencyInfo(p.currency).name} spends`);
  return list.length ? `Includes ${list.join(" · ")}` : "";
}
