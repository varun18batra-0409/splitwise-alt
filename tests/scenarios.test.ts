import { describe, expect, it } from "vitest";
import { buildExpense, type ExpenseDraft } from "@/lib/expense";
import { netBalances } from "@/lib/balances";

// The scenarios from the brief, end to end: draft → saved numbers → balances.
const members = ["me", "a", "b"];
const draft = (over: Partial<ExpenseDraft>): ExpenseDraft => ({
  amount: "3000",
  currency: "THB",
  paidById: "me",
  forMode: "everyone",
  selected: [],
  onePersonId: "",
  splitType: "equal",
  exact: {},
  percent: {},
  paymentMethod: "cash",
  markupChoice: "group",
  markupCustom: "",
  ...over,
});
const ctxTHB = { memberIds: members, baseCurrency: "INR", groupMarkupBp: 300, rate: "2.5" };
const ctxSame = { memberIds: members, baseCurrency: "INR", groupMarkupBp: 300, rate: "1" };

function build(d: ExpenseDraft, ctx = ctxTHB) {
  const r = buildExpense(d, ctx);
  if (!r.ok) throw new Error(r.error);
  return r.expense;
}
const shareMap = (e: ReturnType<typeof build>) => Object.fromEntries(e.shares.map((s) => [s.memberId, s.amount]));

// Invariants that prove nothing is double-counted.
function expectConsistent(e: ReturnType<typeof build>) {
  expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(e.amount);
  expect(e.convertedAmount + e.markupAmount).toBe(e.amount);
  const net = netBalances(members, [e]);
  expect(Object.values(net).reduce((s, v) => s + v, 0)).toBe(0);
}

describe("Scenario 1: shared expense, split equally", () => {
  it("₹3,000 dinner for three: each owes ₹1,000, the other two owe me ₹1,000 each", () => {
    const e = build(draft({ amount: "3000", currency: "INR" }), ctxSame);
    expect(shareMap(e)).toEqual({ me: 100000, a: 100000, b: 100000 });
    expect(netBalances(members, [e])).toEqual({ me: 200000, a: -100000, b: -100000 });
    expectConsistent(e);
  });

  it("THB 3,000 paid in cash at ₹2.50: each share is ₹2,500 (= THB 1,000)", () => {
    const e = build(draft({}));
    expect(e.amount).toBe(750000);
    expect(shareMap(e)).toEqual({ me: 250000, a: 250000, b: 250000 });
    expect(netBalances(members, [e])).toEqual({ me: 500000, a: -250000, b: -250000 });
    expectConsistent(e);
  });
});

describe("Scenario 2: one person pays for another", () => {
  it("THB 3,000 hotel used only by A: A owes me all of it, nobody else is charged", () => {
    const e = build(draft({ forMode: "one", onePersonId: "a" }));
    expect(e.shares).toEqual([{ memberId: "a", amount: 750000 }]);
    expect(netBalances(members, [e])).toEqual({ me: 750000, a: -750000, b: 0 });
    expectConsistent(e);
  });
});

describe("Scenario 3: I pay for selected people, not me", () => {
  it("meal for A and B only: split between them, I'm owed the full amount", () => {
    const e = build(draft({ forMode: "selected", selected: ["a", "b"] }));
    expect(shareMap(e)).toEqual({ a: 375000, b: 375000 });
    expect(netBalances(members, [e])).toEqual({ me: 750000, a: -375000, b: -375000 });
    expectConsistent(e);
  });
});

describe("Scenario 4: unequal splits", () => {
  it("custom amounts in THB, card with 3% markup: markup shared in the same proportions", () => {
    const e = build(draft({ splitType: "exact", exact: { me: "500", a: "1000", b: "1500" }, paymentMethod: "card" }));
    expect(e.amount).toBe(772500); // ₹7,500 + ₹225
    expect(shareMap(e)).toEqual({ me: 128750, a: 257500, b: 386250 });
    expectConsistent(e);
  });

  it("custom amounts that don't add up are rejected", () => {
    const r = buildExpense(draft({ splitType: "exact", exact: { me: "500", a: "1000", b: "1000" } }), ctxTHB);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/THB 2,500.*THB 3,000/);
  });

  it("percentages", () => {
    const e = build(draft({ splitType: "percent", percent: { me: "50", a: "30", b: "20" } }));
    expect(shareMap(e)).toEqual({ me: 375000, a: 225000, b: 150000 });
    expectConsistent(e);
  });

  it("percentages that aren't 100% are rejected", () => {
    expect(buildExpense(draft({ splitType: "percent", percent: { me: "50", a: "30" } }), ctxTHB).ok).toBe(false);
  });

  it("100% to one person via percentages", () => {
    const e = build(draft({ splitType: "percent", percent: { b: "100" } }));
    expect(e.shares).toEqual([{ memberId: "b", amount: 750000 }]);
  });
});

describe("Payment method and markup", () => {
  it("card uses the group default (3%)", () => {
    const e = build(draft({ paymentMethod: "card" }));
    expect([e.convertedAmount, e.markupBp, e.markupAmount, e.amount]).toEqual([750000, 300, 22500, 772500]);
    expectConsistent(e);
  });
  it("per-expense override: custom 2.5%", () => {
    const e = build(draft({ paymentMethod: "card", markupChoice: "custom", markupCustom: "2.5" }));
    expect([e.markupBp, e.markupAmount]).toEqual([250, 18750]);
  });
  it("per-expense override: no markup", () => {
    const e = build(draft({ paymentMethod: "card", markupChoice: "none" }));
    expect(e.markupAmount).toBe(0);
  });
  it("cash and bank transfers never get a markup, even with a group default", () => {
    expect(build(draft({ paymentMethod: "cash" })).markupAmount).toBe(0);
    expect(build(draft({ paymentMethod: "bank" })).markupAmount).toBe(0);
  });
  it("payment method isn't recorded for expenses in the group's own currency", () => {
    const e = build(draft({ currency: "INR", paymentMethod: "card" }), ctxSame);
    expect([e.paymentMethod, e.markupAmount, e.exchangeRate]).toEqual(["", 0, "1"]);
  });
  it("rejects silly custom markups", () => {
    expect(buildExpense(draft({ paymentMethod: "card", markupChoice: "custom", markupCustom: "50" }), ctxTHB).ok).toBe(false);
  });
});

describe("Balances across several expenses", () => {
  it("add up and never double-count", () => {
    const es = [
      build(draft({ paymentMethod: "card" })), // me pays THB 3,000 for everyone (+3%)
      build(draft({ paidById: "a", forMode: "one", onePersonId: "me", amount: "1000" })), // a pays for me
      build(draft({ paidById: "b", amount: "900", currency: "INR" }), ctxSame), // b pays ₹900 for all
    ];
    const net = netBalances(members, es);
    // me: +7725 −2575 −2500 −300 = +2350 ; a: −2575 +2500 −300 = −375 ; b: −2575 +900 −300 = −1975
    expect(net).toEqual({ me: 235000, a: -37500, b: -197500 });
    expect(net.me + net.a + net.b).toBe(0);
  });
});
