import { loadMyGroups } from "./group-data";
import { formatMoney } from "./money";
import { crossSettle } from "./cross-settle";
import { convertAmount } from "./conversion";
import { after } from "next/server";
import { displayRate } from "./rate-cache";

// Everything the home screen and the Settle screen need about all my groups:
// totals, net balance (in one currency when rates are known) and Smart Settle
// across groups.
export async function loadOverview(memberships: Record<string, string>) {
  const all = await loadMyGroups(memberships);
  const open = all.filter((g) => !g.group.closed);
  const closed = all.filter((g) => g.group.closed);

  // Totals per currency across open groups (groups can use different currencies).
  const totals = new Map<string, { owed: number; owe: number }>();
  for (const g of open) {
    const t = totals.get(g.group.currency) ?? { owed: 0, owe: 0 };
    if (g.myBalance > 0) t.owed += g.myBalance;
    if (g.myBalance < 0) t.owe += -g.myBalance;
    totals.set(g.group.currency, t);
  }
  const owedLines = [...totals].filter(([, t]) => t.owed > 0).map(([c, t]) => formatMoney(t.owed, c));
  const oweLines = [...totals].filter(([, t]) => t.owe > 0).map(([c, t]) => formatMoney(t.owe, c));

  // The most used group currency is the "common" one.
  const currencyCount = new Map<string, number>();
  for (const g of open) currencyCount.set(g.group.currency, (currencyCount.get(g.group.currency) ?? 0) + 1);
  const common = [...currencyCount].sort((a, b) => b[1] - a[1])[0]?.[0] ?? all[0]?.group.currency ?? "INR";
  // Saved rates only (never waits for the internet); stale ones refresh after the screen is sent.
  const rates = new Map<string, string | null>(
    await Promise.all(
      [...new Set(all.map((g) => g.group.currency))]
        .filter((cur) => cur !== common)
        .map(async (cur) => {
          const r = await displayRate(cur, common, after);
          return [cur, r.ok ? r.rate : null] as const;
        }),
    ),
  );

  // An amount in the common currency, at the saved rate (null: no rate yet).
  const toCommon = (amount: number, cur: string): number | null => {
    if (cur === common) return amount;
    const rate = rates.get(cur);
    return rate ? convertAmount(amount, cur, common, rate) : null;
  };

  // Net = everything you're owed minus everything you owe.
  const netCommon = ((): { value: number; converted: boolean } | null => {
    let value = 0;
    let converted = false;
    for (const g of open) {
      const b = g.myBalance;
      if (g.group.currency === common || b === 0) {
        value += g.group.currency === common ? b : 0;
        continue;
      }
      const rate = rates.get(g.group.currency);
      const c = rate ? convertAmount(Math.abs(b), g.group.currency, common, rate) : null;
      if (c === null) return null;
      value += Math.sign(b) * c;
      converted = true;
    }
    return { value, converted };
  })();
  const netLines = [...totals].map(([c, t]) => `${t.owed - t.owe >= 0 ? "+" : "−"}${formatMoney(Math.abs(t.owed - t.owe), c)}`);
  const netValue = netCommon ? netCommon.value : [...totals].reduce((a, [, t]) => a + Math.sign(t.owed - t.owe), 0);

  const { items: settleItems, skippedGroups } = crossSettle(
    all.map((g) => ({
      groupId: g.group.id,
      groupName: g.group.name,
      currency: g.group.currency,
      myId: g.myId,
      members: g.group.members,
      transfers: g.transfers,
    })),
    common,
    toCommon,
  );

  // Groups where other people still need to settle with each other.
  const othersPending = all.filter((g) => g.transfers.some((t) => t.from !== g.myId && t.to !== g.myId));

  return { all, open, closed, owedLines, oweLines, common, netCommon, netLines, netValue, settleItems, skippedGroups, othersPending, toCommon };
}
