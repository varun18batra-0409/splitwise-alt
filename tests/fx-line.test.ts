import { describe, expect, it } from "vitest";
import { dayKey } from "@/lib/dates";
import { fxLine, rateDateLabel, rateSourceLine } from "@/lib/conversion";
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
      "THB 1,000 × 2.50 = ₹2,500 + ₹75 card fee (3%) = ₹2,575",
    );
  });

  it("THB 999 × 2.8367, card 3%: 283386 + 8502 = 291888 (₹2,918.88)", () => {
    // 99900 × 2.8367 = 283386.33 → 283386; 3% of 283386 = 8501.58 → 8502; total 291888 = 2,833.86 × 1.03 = 2,918.88
    expect(fxLine({ ...base, originalAmount: 99900, originalCurrency: "THB", exchangeRate: "2.8367", convertedAmount: 283386, markupBp: 300, markupAmount: 8502, amount: 291888 })).toBe(
      "THB 999 × 2.8367 = ₹2,833.86 + ₹85.02 card fee (3%) = ₹2,918.88",
    );
  });

  it("$1 × 83.12345, card 3%: the converted amount is in the middle so each step checks by hand", () => {
    // 100 cents × 83.12345 = 8312.345 paise → 8312 (₹83.12); 3% of 8312 = 249.36 → 249 (₹2.49); 8312 + 249 = 8561 (₹85.61)
    expect(fxLine({ ...base, originalAmount: 100, originalCurrency: "USD", exchangeRate: "83.12345", convertedAmount: 8312, markupBp: 300, markupAmount: 249, amount: 8561 })).toBe(
      "$1 × 83.12345 = ₹83.12 + ₹2.49 card fee (3%) = ₹85.61",
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

describe("rateDateLabel (the day the rate is for, next to the day of the expense)", () => {
  it("says 'for' only when the rate day is the expense day", () => {
    expect(rateDateLabel({ rateDate: "2026-10-13", expenseDay: "2026-10-13", saved: true }, niceDate)).toBe("Rate saved with this expense for 13 Oct 2026");
    expect(rateDateLabel({ rateDate: "2026-10-13", expenseDay: "2026-10-13" }, niceDate)).toBe("Live rate for 13 Oct 2026");
  });
  it("says plainly when the rate is from another day (expense 13 Oct, rate saved 14 Oct)", () => {
    expect(rateDateLabel({ rateDate: "2026-10-14", expenseDay: "2026-10-13", saved: true }, niceDate)).toBe(
      "Rate saved with this expense, from 14 Oct 2026 (the latest when it was saved)",
    );
    expect(rateDateLabel({ rateDate: "2026-10-11", expenseDay: "2026-10-13" }, niceDate)).toBe("Live rate from 11 Oct 2026, the latest available");
  });
  it("late evening in India: 23:30 IST on 13 Oct is 18:00 UTC on 13 Oct, the same day; 01:00 IST on 14 Oct is still 13 Oct in UTC", () => {
    const lateEvening = new Date("2026-10-13T18:00:00Z"); // 23:30 IST, 13 Oct
    const justAfterMidnight = new Date("2026-10-13T19:30:00Z"); // 01:00 IST, 14 Oct
    expect(dayKey(lateEvening, "Asia/Kolkata")).toBe("2026-10-13");
    expect(dayKey(justAfterMidnight, "Asia/Kolkata")).toBe("2026-10-14");
    // The expense day is read in the person's zone (14 Oct); a rate dated by the UTC clock (13 Oct) is not claimed to be "for" 14 Oct.
    expect(rateDateLabel({ rateDate: justAfterMidnight.toISOString().slice(0, 10), expenseDay: dayKey(justAfterMidnight, "Asia/Kolkata"), saved: true }, niceDate)).toContain("from 13 Oct 2026");
  });
});
