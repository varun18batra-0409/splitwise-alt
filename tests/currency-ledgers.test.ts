import { describe, expect, it } from "vitest";
import { foreignLedgers, originalShares } from "@/lib/currency-ledgers";
import { buildExpense, type ExpenseDraft } from "@/lib/expense";
import { netBalances } from "@/lib/balances";

const members = ["me", "a", "b"];
const draft = (over: Partial<ExpenseDraft>): ExpenseDraft => ({
  amount: "3000", currency: "THB", paidById: "me", forMode: "everyone", selected: [], onePersonId: "",
  splitType: "equal", exact: {}, percent: {}, paymentMethod: "card", markupChoice: "group", markupCustom: "", ...over,
});
function build(d: ExpenseDraft) {
  const r = buildExpense(d, { memberIds: members, baseCurrency: "INR", groupMarkupBp: 300, rate: "2.5" });
  if (!r.ok) throw new Error(r.error);
  return { ...r.expense, shares: r.expense.shares };
}

describe("balances in the foreign currency, without card markup", () => {
  it("THB 3,000 on a card with 3% markup: ₹2,575 each in INR, THB 1,000 each in baht", () => {
    const e = build(draft({}));
    expect(e.shares.map((s) => s.amount)).toEqual([257500, 257500, 257500]); // INR incl. markup
    expect(originalShares(e).map((s) => s.amount)).toEqual([100000, 100000, 100000]); // THB 1,000 each, no markup

    const [thb] = foreignLedgers([e], "INR", members);
    expect(thb.currency).toBe("THB");
    expect(thb.net).toEqual({ me: 200000, a: -100000, b: -100000 }); // owed THB 2,000
    expect(netBalances(members, [e])).toEqual({ me: 515000, a: -257500, b: -257500 }); // owed ₹5,150 incl. markup
  });

  it("custom splits keep their proportions in the original currency", () => {
    const e = build(draft({ splitType: "exact", exact: { me: "500", a: "1000", b: "1500" } }));
    expect(originalShares(e)).toEqual([
      { memberId: "me", amount: 50000 },
      { memberId: "a", amount: 100000 },
      { memberId: "b", amount: 150000 },
    ]);
  });

  it("one ledger per foreign currency; group-currency expenses aren't in them", () => {
    const ledgers = foreignLedgers(
      [build(draft({})), build(draft({ currency: "VND", amount: "300000", paidById: "a" })), build(draft({ currency: "INR", amount: "900" }))],
      "INR",
      members,
    );
    expect(ledgers.map((l) => l.currency).sort()).toEqual(["THB", "VND"]);
    const vnd = ledgers.find((l) => l.currency === "VND")!;
    expect(vnd.net).toEqual({ me: -100000, a: 200000, b: -100000 });
    for (const l of ledgers) expect(Object.values(l.net).reduce((s, v) => s + v, 0)).toBe(0);
  });

  it("always adds up exactly, for many random amounts", () => {
    for (let i = 0; i < 300; i++) {
      const amt = String(1 + Math.floor(Math.random() * 99999));
      const e = build(draft({ amount: amt, paymentMethod: i % 2 ? "card" : "cash" }));
      expect(originalShares(e).reduce((s, x) => s + x.amount, 0)).toBe(e.originalAmount);
    }
  });
});
