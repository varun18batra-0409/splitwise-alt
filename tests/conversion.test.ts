import { describe, expect, it } from "vitest";
import { cleanRateText, computeTotals, convertAmount, markupAmountOf, markupApplies, parseRate, rateToString } from "@/lib/conversion";

describe("the example from the brief", () => {
  it("THB 3,000 at ₹2.50 with a 3% card markup = ₹7,725", () => {
    const t = computeTotals({ amount: "3000", currency: "THB", baseCurrency: "INR", rate: "2.5", paymentMethod: "card", markupBp: 300 });
    expect(t).toEqual({
      ok: true,
      originalAmount: 300000, // THB 3,000.00
      convertedAmount: 750000, // ₹7,500
      markupBp: 300,
      markupAmount: 22500, // ₹225
      total: 772500, // ₹7,725
      exchangeRate: "2.5",
    });
  });
});

describe("card markup only applies to foreign card payments", () => {
  const base = { amount: "3000", currency: "THB", baseCurrency: "INR", rate: "2.5", markupBp: 300 } as const;
  it("cash: no markup", () => {
    const t = computeTotals({ ...base, paymentMethod: "cash" });
    expect(t.ok && [t.markupAmount, t.total]).toEqual([0, 750000]);
  });
  it("bank / UPI: no markup", () => {
    const t = computeTotals({ ...base, paymentMethod: "bank" });
    expect(t.ok && t.markupAmount).toBe(0);
  });
  it("card in the group's own currency: no markup", () => {
    const t = computeTotals({ ...base, currency: "INR", paymentMethod: "card" });
    expect(t.ok && [t.convertedAmount, t.markupAmount, t.total, t.exchangeRate]).toEqual([300000, 0, 300000, "1"]);
    expect(markupApplies("INR", "INR", "card")).toBe(false);
  });
  it("markup is part of the total exactly once", () => {
    const t = computeTotals({ ...base, paymentMethod: "card" });
    expect(t.ok && t.total).toBe(t.ok && t.convertedAmount + t.markupAmount);
  });
});

describe("convertAmount", () => {
  it("handles currencies without decimals", () => {
    expect(convertAmount(1500, "JPY", "INR", "0.56")).toBe(84000); // ¥1,500 → ₹840
    expect(convertAmount(250000, "VND", "INR", "0.00368")).toBe(92000); // ₫250,000 → ₹920
    expect(convertAmount(100000, "INR", "JPY", "1.7857")).toBe(1786); // ₹1,000 → ¥1,786 (rounded)
  });
  it("rounds to the nearest paisa (halves round up)", () => {
    expect(convertAmount(1, "THB", "INR", "2.5")).toBe(3); // 2.5 paise → 3
    expect(convertAmount(1, "THB", "INR", "2.49")).toBe(2);
  });
  it("returns the same amount when currencies match", () => {
    expect(convertAmount(12345, "INR", "INR", "anything")).toBe(12345);
  });
});

describe("markupAmountOf", () => {
  it("works out percentages exactly", () => {
    expect(markupAmountOf(750000, 300)).toBe(22500);
    expect(markupAmountOf(750000, 350)).toBe(26250); // 3.5%
    expect(markupAmountOf(333, 300)).toBe(10); // 9.99 → 10
    expect(markupAmountOf(750000, 0)).toBe(0);
  });
});

describe("rates as exact text", () => {
  it("parses typed rates", () => {
    expect(parseRate("2.8367")).toEqual({ n: 28367n, scale: 10000n });
    expect(parseRate("0")).toBeNull();
    expect(parseRate("-1")).toBeNull();
    expect(parseRate("abc")).toBeNull();
  });
  it("reads a comma typed as the decimal point, and thousands commas", () => {
    expect(cleanRateText("2,84")).toBe("2.84");
    expect(cleanRateText("0,012")).toBe("0.012");
    expect(cleanRateText("16,000")).toBe("16000");
    expect(cleanRateText("1,234.5")).toBe("1234.5");
    expect(cleanRateText(" 2.84 ")).toBe("2.84");
    expect(parseRate("2,84")).toEqual({ n: 284n, scale: 100n });
  });
  it("turns API numbers into clean text", () => {
    expect(rateToString(2.8367)).toBe("2.8367");
    expect(rateToString(0.00368)).toBe("0.00368");
    expect(rateToString(25)).toBe("25");
    expect(rateToString(0.000000062)).toBe("0.000000062");
  });
  it("asks for a rate when one is missing", () => {
    const t = computeTotals({ amount: "100", currency: "VND", baseCurrency: "INR", rate: "", paymentMethod: "cash", markupBp: 0 });
    expect(t.ok).toBe(false);
  });
});
