import { describe, expect, it } from "vitest";
import { exactAttrs, homeMoney, overviewAmountsInText, overviewMoney } from "@/lib/money-display";
import { formatMoney } from "@/lib/money";
import { ledgerSummary } from "@/lib/foreign-part";

// Overview screens show whole units from 1,000 up. Display only: the same minor units still format exactly.
// All expected strings below are worked by hand, not produced by the code under test.

describe("overviewMoney: paise dropped from 1,000 whole units, display only", () => {
  it("is the same function Home uses", () => {
    expect(overviewMoney).toBe(homeMoney);
  });
  it("₹17,618.19 (1761819 paise) shows ₹17,618", () => {
    expect(overviewMoney(1761819, "INR")).toBe("₹17,618");
  });
  it("₹999.50 (99950 paise) stays exact, under 1,000", () => {
    expect(overviewMoney(99950, "INR")).toBe("₹999.50");
  });
  it("₹1,000.49 (100049 paise) shows ₹1,000", () => {
    expect(overviewMoney(100049, "INR")).toBe("₹1,000");
  });
  it("−₹1,234.50 (-123450 paise) rounds the size to 1,235 and keeps the sign", () => {
    // formatMoney writes a negative INR amount with a plain hyphen: -₹1,235
    expect(overviewMoney(-123450, "INR")).toBe("-₹1,235");
  });
  it("−₹999.50 stays exact", () => {
    expect(overviewMoney(-99950, "INR")).toBe("-₹999.50");
  });
  it("¥1,234 (JPY has no decimals) is unchanged", () => {
    expect(overviewMoney(1234, "JPY")).toBe("JPY 1,234");
  });
  it("KWD 1,234.567 (1234567 fils, 3 decimals) shows whole: KWD 1,235", () => {
    expect(overviewMoney(1234567, "KWD")).toBe("KWD 1,235");
  });
  it("KWD 999.999 stays exact", () => {
    expect(overviewMoney(999999, "KWD")).toBe("KWD 999.999");
  });
  it("lakh commas are kept: ₹1,23,456.78 -> ₹1,23,457", () => {
    expect(overviewMoney(12345678, "INR")).toBe("₹1,23,457");
  });
});

describe("exactAttrs: the exact amount stays beside a rounded one", () => {
  it("gives the exact figure for title and data-exact", () => {
    expect(exactAttrs(1761819, "INR")).toEqual({ title: "₹17,618.19", "data-exact": "₹17,618.19" });
  });
  it("rounding never changes the stored number", () => {
    const minor = 1761819;
    overviewMoney(minor, "INR");
    expect(formatMoney(minor, "INR")).toBe("₹17,618.19");
  });
});

describe("amounts written into a sentence (screen only)", () => {
  it("drops the paise from 1,000 up and leaves smaller and non-rupee amounts alone", () => {
    expect(overviewAmountsInText("Asha added Dinner ₹1,286.70")).toBe("Asha added Dinner ₹1,287");
    expect(overviewAmountsInText("Total ₹999.50 and ₹17,618.19")).toBe("Total ₹999.50 and ₹17,618");
    expect(overviewAmountsInText("Split changed: ₹300 → ₹1,23,456.78")).toBe("Split changed: ₹300 → ₹1,23,457");
    expect(overviewAmountsInText("Paid THB 5,099.17")).toBe("Paid THB 5,099.17");
  });
  it("the Balances explanation: rounded on screen with a formatter, exact by default", () => {
    const parts = [{ currency: "THB", amount: -509917 }];
    expect(ledgerSummary(parts, 1761819, "INR", overviewMoney)).toBe("In THB alone, you owe THB 5,099. Overall you’re owed ₹17,618.");
    expect(ledgerSummary(parts, 1761819, "INR")).toBe("In THB alone, you owe THB 5,099.17. Overall you’re owed ₹17,618.19.");
  });
});
