import { formatMoney, formatPercent, parseAmount, parsePercent } from "./money";

// Works out how much each person is responsible for, for one expense.
// Every result adds up EXACTLY to the total — no paisa is ever lost or invented.

export type Share = { memberId: string; amount: number };
export type SplitResult = { ok: true; shares: Share[] } | { ok: false; error: string };
export type SplitType = "equal" | "exact" | "percent";
export type ForMode = "everyone" | "selected" | "one";

const ok = (shares: Share[]): SplitResult => ({ ok: true, shares });
const fail = (error: string): SplitResult => ({ ok: false, error });

function validTotal(total: number) {
  return Number.isSafeInteger(total) && total > 0;
}

// ₹100 among 3 → 3334, 3333, 3333. Leftover paise go to the first people listed.
export function splitEqual(total: number, memberIds: string[]): SplitResult {
  if (!validTotal(total)) return fail("Enter an amount greater than zero.");
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return fail("Pick at least one person this expense was for.");
  const base = Math.floor(total / ids.length);
  let leftover = total - base * ids.length;
  return ok(ids.map((memberId) => ({ memberId, amount: base + (leftover-- > 0 ? 1 : 0) })));
}

// Everyone's amount is typed in. They must add up to the total.
export function splitExact(total: number, entries: Share[], currency = "INR"): SplitResult {
  if (!validTotal(total)) return fail("Enter an amount greater than zero.");
  if (entries.some((e) => !Number.isSafeInteger(e.amount) || e.amount < 0)) {
    return fail("Each person's amount must be zero or more.");
  }
  const sum = entries.reduce((s, e) => s + e.amount, 0);
  if (sum !== total) {
    return fail(`The amounts add up to ${formatMoney(sum, currency)}, but the total is ${formatMoney(total, currency)}.`);
  }
  return ok(entries.filter((e) => e.amount > 0));
}

// Shares `total` in proportion to whole-number weights. Paise left over after
// rounding down go to whoever lost the most in rounding ("largest remainder").
export function allocateByWeights(total: number, entries: { memberId: string; weight: number }[]): Share[] {
  const weightSum = entries.reduce((s, e) => s + BigInt(e.weight), 0n);
  if (weightSum === 0n) return [];
  const rows = entries.map((e, i) => {
    const raw = BigInt(total) * BigInt(e.weight);
    return { i, memberId: e.memberId, amount: Number(raw / weightSum), remainder: raw % weightSum };
  });
  let leftover = total - rows.reduce((s, r) => s + r.amount, 0);
  [...rows]
    .sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : a.i - b.i))
    .forEach((r) => {
      if (leftover > 0) {
        r.amount += 1;
        leftover -= 1;
      }
    });
  return rows.filter((r) => r.amount > 0).map(({ memberId, amount }) => ({ memberId, amount }));
}

// Percentages in basis points (100% = 10000).
export function splitPercent(total: number, entries: { memberId: string; basisPoints: number }[]): SplitResult {
  if (!validTotal(total)) return fail("Enter an amount greater than zero.");
  if (entries.some((e) => !Number.isInteger(e.basisPoints) || e.basisPoints < 0)) {
    return fail("Percentages must be zero or more.");
  }
  const sum = entries.reduce((s, e) => s + e.basisPoints, 0);
  if (sum !== 10000) return fail(`The percentages add up to ${formatPercent(sum)}. They need to add up to 100%.`);
  return ok(allocateByWeights(total, entries.map((e) => ({ memberId: e.memberId, weight: e.basisPoints }))));
}

// Who the expense was for, in group order.
export function participantsFor(args: {
  forMode: ForMode;
  memberIds: string[];
  selected: string[];
  onePersonId: string;
}): string[] {
  if (args.forMode === "everyone") return args.memberIds;
  if (args.forMode === "one") return args.memberIds.includes(args.onePersonId) ? [args.onePersonId] : [];
  return args.memberIds.filter((id) => args.selected.includes(id));
}

// Turns the "How to split" choices into shares of the FINAL total
// (after currency conversion and any card markup).
// Custom amounts are typed in the expense's own currency and must add up to it;
// they are then scaled to the final total so markup is shared in the same proportions.
export function computeSplit(args: {
  total: number; // final amount in the group's currency
  originalAmount: number; // amount in the expense's currency
  originalCurrency: string;
  splitType: SplitType;
  participants: string[];
  exact: Record<string, string>;
  percent: Record<string, string>;
}): SplitResult {
  const { total, participants } = args;
  if (participants.length === 0) return fail("Pick at least one person this expense was for.");

  // One person, or an equal split.
  if (participants.length === 1 || args.splitType === "equal") return splitEqual(total, participants);

  if (args.splitType === "exact") {
    const entries: Share[] = [];
    for (const id of participants) {
      const raw = (args.exact[id] ?? "").trim();
      if (raw === "" || /^0*(\.0*)?$/.test(raw)) continue;
      const amt = parseAmount(raw, args.originalCurrency);
      if (amt === null) return fail("One of the amounts isn't a valid number.");
      entries.push({ memberId: id, amount: amt });
    }
    const check = splitExact(args.originalAmount, entries, args.originalCurrency);
    if (!check.ok) return check;
    if (total === args.originalAmount) return check; // same currency, no markup
    return ok(allocateByWeights(total, check.shares.map((s) => ({ memberId: s.memberId, weight: s.amount }))));
  }

  const entries: { memberId: string; basisPoints: number }[] = [];
  for (const id of participants) {
    const bp = parsePercent(args.percent[id] ?? "");
    if (bp === null) return fail("One of the percentages isn't valid.");
    if (bp > 0) entries.push({ memberId: id, basisPoints: bp });
  }
  return splitPercent(total, entries);
}
