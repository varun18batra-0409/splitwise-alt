import { describe, expect, it } from "vitest";
import { amountEcho, amountError, overpayLine, parseAmount, PAYMENT_LINE } from "@/lib/money";

// The words at money moments, and "how Loopin read what you typed". Amounts in paise unless noted.

describe("the payment line", () => {
  it("is exactly the founder's sentence", () => {
    expect(PAYMENT_LINE).toBe("This records a payment made outside Loopin. Loopin doesn't move money.");
  });
});

describe("overpayLine (C134)", () => {
  it("owes ₹300, typed 3000 (300000): ₹2,700 more", () => {
    // 300000 − 30000 = 270000 paise = ₹2,700
    expect(overpayLine(300000, 30000, "INR")).toBe("This is ₹2,700 more than what's owed. Record it anyway?");
  });
  it("owes nothing, typed ₹500: ₹500 more", () => {
    expect(overpayLine(50000, 0, "INR")).toBe("This is ₹500 more than what's owed. Record it anyway?");
  });
  it("Confirm received asks 'Confirm anyway?' instead", () => {
    expect(overpayLine(30000, 20000, "INR", "Confirm anyway?")).toBe("This is ₹100 more than what's owed. Confirm anyway?");
  });
  it("nothing to say when the amount is the debt or less", () => {
    expect(overpayLine(30000, 30000, "INR")).toBeNull();
    expect(overpayLine(10000, 30000, "INR")).toBeNull();
  });
  it("uses the group's own money format", () => {
    expect(overpayLine(150000, 100000, "USD")).toBe("This is $500 more than what's owed. Record it anyway?");
    expect(overpayLine(1500, 1000, "JPY")).toBe("This is JPY 500 more than what's owed. Record it anyway?");
  });
});

describe("amountEcho (C14): how a typed amount was read", () => {
  const cases: [string, string, string | null][] = [
    ["12,50", "INR", "₹12.50"],
    ["12,5", "INR", "₹12.50"],
    ["1,250", "INR", "₹1,250"],
    ["1,25,000", "INR", "₹1,25,000"],
    ["1.250", "INR", null], // refused by parseAmount, so nothing is described (the error line explains)
    ["100.000", "INR", null],
    ["1.000", "JPY", null],
    ["99.50", "INR", "₹99.50"],
    ["0,5", "INR", "₹0.50"],
    ["1500", "INR", null],
    ["₹500", "INR", null],
    ["", "INR", null],
    ["abc", "INR", null],
    ["12,50", "USD", "$12.50"],
    ["12,50", "JPY", null], // not a valid yen amount: the error line explains
  ];
  for (const [typed, cur, shown] of cases) {
    it(`${cur} "${typed}" → ${shown ?? "nothing"}`, () => {
      expect(amountEcho(typed, cur)).toBe(shown);
    });
  }

  it("JPY 12,50 says why (whole numbers), and what it shows matches what would be saved", () => {
    expect(amountError("12,50", "JPY")).toBe("JPY amounts are whole numbers: no decimals.");
    // Whatever is echoed is what parseAmount saves .
    for (const t of ["12,50", "12,5", "1,250", "1,25,000", "0,5"]) {
      const echoed = amountEcho(t, "INR")!;
      const saved = parseAmount(t, "INR")!;
      expect(echoed.replace(/[₹,]/g, "")).toBe((saved / 100).toFixed(saved % 100 ? 2 : 0));
    }
    expect(parseAmount("1.250", "INR")).toBeNull();
  });
});
