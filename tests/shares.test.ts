import { describe, expect, it } from "vitest";
import { computeSplit, parseShares, splitShares } from "@/lib/split";
import { buildExpense } from "@/lib/expense";

// Shares: "1.2 / 1 / 1" (a bigger room pays a bit more), exact to the paisa.

describe("splitShares", () => {
  it("shares ₹3,000 as 1.2 / 1 / 1", () => {
    const r = splitShares(300000, [
      { memberId: "a", weight: 120 },
      { memberId: "b", weight: 100 },
      { memberId: "c", weight: 100 },
    ]);
    expect(r).toEqual({ ok: true, shares: [{ memberId: "a", amount: 112500 }, { memberId: "b", amount: 93750 }, { memberId: "c", amount: 93750 }] });
  });
  it("never loses a paisa", () => {
    const r = splitShares(100, [
      { memberId: "a", weight: 100 },
      { memberId: "b", weight: 100 },
      { memberId: "c", weight: 100 },
    ]);
    expect(r.ok && r.shares.map((s) => s.amount)).toEqual([34, 33, 33]);
  });
  it("leaves out someone with 0 shares, and refuses when nobody has any", () => {
    const r = splitShares(1000, [
      { memberId: "a", weight: 100 },
      { memberId: "b", weight: 0 },
    ]);
    expect(r.ok && r.shares).toEqual([{ memberId: "a", amount: 1000 }]);
    expect(splitShares(1000, [{ memberId: "a", weight: 0 }])).toEqual({ ok: false, error: "Give at least one person a share." });
  });
});

describe("parseShares", () => {
  it("reads shares as hundredths", () => {
    expect(parseShares("1.25")).toBe(125);
    expect(parseShares("2")).toBe(200);
    expect(parseShares("0")).toBe(0);
    expect(parseShares("1.255")).toBeNull();
    expect(parseShares("-1")).toBeNull();
    expect(parseShares("25")).toBeNull();
  });
});

describe("shares through computeSplit and buildExpense", () => {
  it("computeSplit handles splitType shares", () => {
    const r = computeSplit({
      total: 300000, originalAmount: 300000, originalCurrency: "INR", splitType: "shares",
      participants: ["a", "b", "c"], exact: {}, percent: {}, shares: { a: "1.2", b: "1", c: "1" },
    });
    expect(r.ok && r.shares.map((s) => s.amount)).toEqual([112500, 93750, 93750]);
  });
  it("a typo in shares is refused with a clear message", () => {
    const r = computeSplit({
      total: 300000, originalAmount: 300000, originalCurrency: "INR", splitType: "shares",
      participants: ["a", "b"], exact: {}, percent: {}, shares: { a: "abc", b: "1" },
    });
    expect(r).toEqual({ ok: false, error: "Shares must be a number from 0 to 20, like 1 or 1.5." });
  });
  it("a whole expense saves with shares (couple 55 / 45 on ₹1,000)", () => {
    const r = buildExpense(
      {
        amount: "1000", currency: "INR", paidById: "a", forMode: "everyone", selected: [], onePersonId: "",
        splitType: "shares", exact: {}, percent: {}, shares: { a: "0.55", b: "0.45" }, paymentMethod: "cash", markupChoice: "group", markupCustom: "",
      },
      { memberIds: ["a", "b"], baseCurrency: "INR", groupMarkupBp: 0, rate: "1" },
    );
    expect(r.ok && r.expense.shares).toEqual([{ memberId: "a", amount: 55000 }, { memberId: "b", amount: 45000 }]);
    expect(r.ok && r.expense.splitType).toBe("shares");
  });
});
