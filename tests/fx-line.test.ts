import { describe, expect, it } from "vitest";
import { fxLine, rateSourceLine } from "@/lib/conversion";
import { niceDate } from "@/lib/format";

// The foreign-currency maths in one line. Worked out by hand; the line is shown only when it adds up to the saved total.

const base = { baseCurrency: "INR", markupBp: 0, markupAmount: 0 };

describe("fxLine (C12)", () => {
  it("THB 1,000 × 2.50, cash: ₹2,500", () => {
    // 100000 satang × 2.50 = 250000 paise
    expect(fxLine({ ...base, originalAmount: 100000, originalCurrency: "THB", exchangeRate: "2.50", convertedAmount: 250000, amount: 250000 })).toBe("THB 1,000 × 2.50 = ₹2,500");
  });

  it("same, card 3%: 250000 + 7500 = 257500", () => {
    expect(fxLine({ ...base, originalAmount: 100000, originalCurrency: "THB", exchangeRate: "2.50", convertedAmount: 250000, markupBp: 300, markupAmount: 7500, amount: 257500 })).toBe(
      "THB 1,000 × 2.50 + 3% card fee = ₹2,575",
    );
  });

  it("THB 999 × 2.8367, card 3%: 283386 + 8502 = 291888 (₹2,918.88)", () => {
    // 99900 × 2.8367 = 283386.33 → 283386; 3% of 283386 = 8501.58 → 8502; total 291888 = 2,833.86 × 1.03 = 2,918.88
    expect(fxLine({ ...base, originalAmount: 99900, originalCurrency: "THB", exchangeRate: "2.8367", convertedAmount: 283386, markupBp: 300, markupAmount: 8502, amount: 291888 })).toBe(
      "THB 999 × 2.8367 + 3% card fee = ₹2,918.88",
    );
  });

  it("JPY 5,000 × 0.56 = ₹2,800 (yen have no decimals)", () => {
    expect(fxLine({ ...base, originalAmount: 5000, originalCurrency: "JPY", exchangeRate: "0.56", convertedAmount: 280000, amount: 280000 })).toBe("JPY 5,000 × 0.56 = ₹2,800");
  });

  it("the rate is shown exactly as saved", () => {
    expect(fxLine({ ...base, originalAmount: 100000, originalCurrency: "THB", exchangeRate: "2.5", convertedAmount: 250000, amount: 250000 })).toBe("THB 1,000 × 2.5 = ₹2,500");
  });

  it("maths that doesn't add up is never shown", () => {
    // Saved total 260000 but 1,000 baht × 2.50 is 250000.
    expect(fxLine({ ...base, originalAmount: 100000, originalCurrency: "THB", exchangeRate: "2.50", convertedAmount: 250000, amount: 260000 })).toBeNull();
    // A group-currency change rewrote the converted amount without the pieces matching.
    expect(fxLine({ ...base, originalAmount: 100000, originalCurrency: "THB", exchangeRate: "2.50", convertedAmount: 251000, amount: 251000 })).toBeNull();
    // A fee that is not 3% of the converted amount.
    expect(fxLine({ ...base, originalAmount: 100000, originalCurrency: "THB", exchangeRate: "2.50", convertedAmount: 250000, markupBp: 300, markupAmount: 7000, amount: 257000 })).toBeNull();
    // An unreadable rate.
    expect(fxLine({ ...base, originalAmount: 100000, originalCurrency: "THB", exchangeRate: "abc", convertedAmount: 250000, amount: 250000 })).toBeNull();
  });

  it("an ordinary expense in the group's own currency has no maths line", () => {
    expect(fxLine({ ...base, originalAmount: 50000, originalCurrency: "INR", exchangeRate: "1", convertedAmount: 50000, amount: 50000 })).toBeNull();
  });
});

describe("rateSourceLine", () => {
  it("says where the rate came from", () => {
    expect(rateSourceLine({ rateSource: "api", rateDate: "2026-10-14" }, niceDate)).toBe("Live rate for 14 Oct 2026");
    expect(rateSourceLine({ rateSource: "manual", rateDate: "2026-10-14" }, niceDate)).toBe("Rate entered by hand");
    expect(rateSourceLine({ rateSource: "converted", rateDate: "" }, niceDate)).toBe("Adjusted when the group currency changed");
    expect(rateSourceLine({ rateSource: "same", rateDate: "" }, niceDate)).toBeNull();
  });
});
