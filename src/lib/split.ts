import { formatMoney, formatPercent, parseAmount, parsePercent } from "./money";

// Works out how much each person owes for one expense.
// Every result adds up EXACTLY to the total — no paisa is ever lost or invented.

export type Share = { memberId: string; amount: number };
export type SplitResult = { ok: true; shares: Share[] } | { ok: false; error: string };
export type SplitType = "equal" | "exact" | "percent";

const ok = (shares: Share[]): SplitResult => ({ ok: true, shares });
const fail = (error: string): SplitResult => ({ ok: false, error });

function validTotal(total: number) {
  return Number.isSafeInteger(total) && total > 0;
}

// ₹100 among 3 → 3334, 3333, 3333. Leftover paise go to the first people listed.
export function splitEqual(total: number, memberIds: string[]): SplitResult {
  if (!validTotal(total)) return fail("Enter an amount greater than zero.");
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return fail("Pick at least one person to share this.");
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

// Percentages in basis points (100% = 10000). Paise left over after rounding
// down go to whoever lost the most in rounding (the "largest remainder" method).
export function splitPercent(total: number, entries: { memberId: string; basisPoints: number }[]): SplitResult {
  if (!validTotal(total)) return fail("Enter an amount greater than zero.");
  if (entries.some((e) => !Number.isInteger(e.basisPoints) || e.basisPoints < 0)) {
    return fail("Percentages must be zero or more.");
  }
  const sum = entries.reduce((s, e) => s + e.basisPoints, 0);
  if (sum !== 10000) return fail(`The percentages add up to ${formatPercent(sum)}. They need to add up to 100%.`);

  const rows = entries.map((e, i) => ({
    i,
    memberId: e.memberId,
    amount: Math.floor((total * e.basisPoints) / 10000),
    remainder: (total * e.basisPoints) % 10000,
  }));
  let leftover = total - rows.reduce((s, r) => s + r.amount, 0);
  [...rows]
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i)
    .forEach((r) => {
      if (leftover > 0) {
        r.amount += 1;
        leftover -= 1;
      }
    });
  return ok(rows.filter((r) => r.amount > 0).map(({ memberId, amount }) => ({ memberId, amount })));
}

// Turns what was typed on the Add expense screen into shares.
// Used on the phone (live preview) and again on the server (the real check).
export function computeSplit(args: {
  amount: string;
  splitType: SplitType;
  participants: string[]; // used for "equal"
  memberIds: string[]; // everyone in the group, in display order
  exact: Record<string, string>;
  percent: Record<string, string>;
  currency?: string;
}): SplitResult & { total: number | null } {
  const total = parseAmount(args.amount);
  if (total === null) return { ...fail("Enter a valid amount, like 250 or 99.50."), total };

  if (args.splitType === "equal") {
    const chosen = args.memberIds.filter((id) => args.participants.includes(id));
    return { ...splitEqual(total, chosen), total };
  }

  if (args.splitType === "exact") {
    const entries: Share[] = [];
    for (const id of args.memberIds) {
      const raw = (args.exact[id] ?? "").trim();
      if (raw === "" || /^0*(\.0*)?$/.test(raw)) continue;
      const amt = parseAmount(raw);
      if (amt === null) return { ...fail("One of the amounts isn't a valid number."), total };
      entries.push({ memberId: id, amount: amt });
    }
    return { ...splitExact(total, entries, args.currency), total };
  }

  const entries: { memberId: string; basisPoints: number }[] = [];
  for (const id of args.memberIds) {
    const bp = parsePercent(args.percent[id] ?? "");
    if (bp === null) return { ...fail("One of the percentages isn't valid."), total };
    if (bp > 0) entries.push({ memberId: id, basisPoints: bp });
  }
  return { ...splitPercent(total, entries), total };
}
