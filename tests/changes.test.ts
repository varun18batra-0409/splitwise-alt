import { describe, expect, it } from "vitest";
import { diffExpense, type ExpenseSnapshot } from "@/lib/events";
import { multiplyRates, rebaseExpense, rebasePayment } from "@/lib/rebase";

const base: ExpenseSnapshot = {
  description: "Dinner",
  category: "food",
  amount: 90000,
  baseCurrency: "INR",
  originalAmount: 90000,
  originalCurrency: "INR",
  exchangeRate: "1",
  paymentMethod: "",
  markupBp: 0,
  paidById: "me",
  forMode: "everyone",
  splitType: "equal",
  shares: [
    { memberId: "me", amount: 30000 },
    { memberId: "a", amount: 30000 },
    { memberId: "b", amount: 30000 },
  ],
};
const names: Record<string, string> = { me: "Varun", a: "Asha", b: "Ravi" };
const nameOf = (id: string) => names[id];

describe("what changed in an edited expense", () => {
  it("lists every change in plain words", () => {
    const after: ExpenseSnapshot = {
      ...base,
      description: "Dinner at Toit",
      amount: 120000,
      originalAmount: 120000,
      paidById: "a",
      forMode: "selected",
      shares: [
        { memberId: "me", amount: 60000 },
        { memberId: "a", amount: 60000 },
      ],
    };
    expect(diffExpense(base, after, nameOf)).toEqual([
      "Name: Dinner → Dinner at Toit",
      "Amount: ₹900 → ₹1,200",
      "Group total: ₹900 → ₹1,200",
      "Paid by: Varun → Asha",
      "For: everyone → selected people",
      "Varun’s share: ₹300 → ₹600",
      "Asha’s share: ₹300 → ₹600",
      "Ravi’s share: ₹300 → ₹0",
    ]);
  });

  it("reports nothing when nothing changed", () => {
    expect(diffExpense(base, { ...base }, nameOf)).toEqual([]);
  });

  it("mentions rate, payment method and markup for foreign expenses", () => {
    const thb: ExpenseSnapshot = { ...base, originalCurrency: "THB", originalAmount: 300000, exchangeRate: "2.5", paymentMethod: "cash", amount: 750000 };
    const changes = diffExpense(thb, { ...thb, paymentMethod: "card", markupBp: 300, amount: 772500 }, nameOf);
    expect(changes).toContain("Paid with: cash → card");
    expect(changes).toContain("Card markup: 0% → 3%");
    expect(changes).toContain("Group total: ₹7,500 → ₹7,725");
  });
});

describe("changing the group currency", () => {
  it("multiplies rates exactly", () => {
    expect(multiplyRates("2.5", "0.012")).toBe("0.03");
    expect(multiplyRates("2.8367", "0.0119")).toBe("0.03375673");
    expect(multiplyRates("0", "1")).toBeNull();
  });

  it("converts a same-currency expense and keeps shares adding up", () => {
    const r = rebaseExpense(
      { originalAmount: 100000, originalCurrency: "INR", exchangeRate: "1", markupBp: 0, markupAmount: 0,
        shares: [{ id: "s1", memberId: "a", amount: 33334 }, { id: "s2", memberId: "b", amount: 33333 }, { id: "s3", memberId: "c", amount: 33333 }] },
      "INR", "USD", "0.012",
    )!;
    expect([r.baseCurrency, r.exchangeRate, r.convertedAmount, r.markupAmount, r.amount]).toEqual(["USD", "0.012", 1200, 0, 1200]);
    expect(r.shares.reduce((s, x) => s + x.amount, 0)).toBe(1200);
  });

  it("converts a foreign card expense via the combined rate and keeps its markup %", () => {
    // THB 3,000 at ₹2.50 + 3% → ₹7,725. Group switches INR → USD at 0.012.
    const r = rebaseExpense(
      { originalAmount: 300000, originalCurrency: "THB", exchangeRate: "2.5", markupBp: 300, markupAmount: 22500,
        shares: [{ id: "s1", memberId: "a", amount: 386250 }, { id: "s2", memberId: "b", amount: 386250 }] },
      "INR", "USD", "0.012",
    )!;
    expect([r.exchangeRate, r.convertedAmount, r.markupAmount, r.amount]).toEqual(["0.03", 9000, 270, 9270]); // $90 + $2.70
    expect(r.shares.map((s) => s.amount)).toEqual([4635, 4635]);
  });

  it("an expense already in the new currency needs no conversion, but keeps the fee that was paid", () => {
    const r = rebaseExpense(
      { originalAmount: 300000, originalCurrency: "THB", exchangeRate: "2.5", markupBp: 300, markupAmount: 22500,
        shares: [{ id: "s1", memberId: "a", amount: 772500 }] },
      "INR", "THB", "0.4",
    )!;
    expect([r.exchangeRate, r.convertedAmount, r.markupAmount, r.amount]).toEqual(["1", 300000, 9000, 309000]);
  });

  it("converts payments", () => {
    expect(rebasePayment(50000, "INR", "USD", "0.012")).toBe(600);
  });
});
