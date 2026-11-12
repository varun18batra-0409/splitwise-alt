import { describe, expect, it } from "vitest";
import { foreignPartLine, ledgerSummary } from "@/lib/foreign-part";

describe("F2: the foreign-currency sub-line on Balances", () => {
  it("says which way the foreign part goes, with the currency in the amount", () => {
    expect(foreignPartLine([{ currency: "THB", amount: -509917 }], true)).toBe("Thai baht part: you owe THB 5,099.17");
    expect(foreignPartLine([{ currency: "THB", amount: 509917 }], true)).toBe("Thai baht part: you’re owed THB 5,099.17");
    expect(foreignPartLine([{ currency: "THB", amount: -509917 }])).toBe("Thai baht part: owes THB 5,099.17");
    expect(foreignPartLine([{ currency: "THB", amount: 509917 }])).toBe("Thai baht part: is owed THB 5,099.17");
  });
  it("skips a zero part and joins several currencies", () => {
    expect(foreignPartLine([{ currency: "THB", amount: 0 }])).toBe("");
    expect(foreignPartLine([{ currency: "THB", amount: 100000 }, { currency: "KWD", amount: -1234567 }])).toBe(
      "Thai baht part: is owed THB 1,000 · Kuwaiti dinar part: owes KWD 1,234.567",
    );
  });
  it("the box and the row say the same true thing when the foreign part is the opposite of the overall balance", () => {
    // Owed ₹17,618.19 overall, yet owing THB 5,099.17 in baht alone (the ledger's sign: negative = owes).
    const parts = [{ currency: "THB", amount: -509917 }];
    expect(foreignPartLine(parts, true)).toBe("Thai baht part: you owe THB 5,099.17");
    expect(ledgerSummary(parts, 1761819, "INR")).toBe("In THB alone, you owe THB 5,099.17. Overall you’re owed ₹17,618.19.");
    expect(ledgerSummary(parts, -1761819, "INR")).toBe("In THB alone, you owe THB 5,099.17. Overall you owe ₹17,618.19.");
    expect(ledgerSummary([{ currency: "THB", amount: 0 }], 500, "INR")).toBe("Overall you’re owed ₹5.");
  });
});

import { ADDRESS_MIN_SCALE, addressLineScale, postmarkDateLines, postmarkSvg } from "@/lib/postcards/catalog";

describe("F17: the postcard back", () => {
  it("the postmark date is split so it fits inside the 54-wide inner ring", () => {
    expect(postmarkDateLines("12 NOV 2026")).toEqual(["12 NOV", "2026"]);
    expect(postmarkDateLines("TODAY")).toEqual(["TODAY"]);
    const svg = postmarkSvg("Goa", "12 NOV 2026", "t");
    expect(svg).toContain(">12 NOV<");
    expect(svg).toContain(">2026<");
    // textLength for "12 NOV": 6 characters x 6 = 36, under the 40 cap and well inside 54.
    expect(svg).toContain('textLength="36"');
  });
  it("the address line never shrinks below 62% of the size", () => {
    expect(addressLineScale(5)).toBe(1);
    expect(addressLineScale(10)).toBe(1);
    expect(addressLineScale(20)).toBe(0.62); // 10/20 = 0.5, so the floor applies
    expect(addressLineScale(14)).toBeCloseTo(10 / 14, 5); // 0.714, above the floor
    expect(addressLineScale("the flat that never has milk".length)).toBe(ADDRESS_MIN_SCALE); // 28 letters: 10/28 = 0.36 -> 0.62
    expect(ADDRESS_MIN_SCALE).toBeGreaterThanOrEqual(0.6);
  });
});

import { paymentEffectLabel, paymentSubline, paymentTitle } from "@/lib/payment-words";

describe("UX-02: a payment someone only says they made never reads as received", () => {
  it("an older pending payment (needsOk, no okAt) is a claim", () => {
    expect(paymentTitle("Nupur", "You", "waiting", false)).toBe("Nupur says they paid you");
    expect(paymentSubline("waiting", "You", false, "")).toBe("Waiting for you to confirm");
    expect(paymentEffectLabel("waiting", -50000, false)).toBe("to be confirmed"); // ₹500 to you, not "you received"
    expect(paymentEffectLabel("waiting", 50000, false)).toBe("to be confirmed");
  });
  it("a confirmed or plain payment keeps its words", () => {
    expect(paymentTitle("Nupur", "You", "ok", false)).toBe("Nupur paid you");
    expect(paymentTitle("Nupur", "Ravi", undefined, false)).toBe("Nupur paid Ravi");
    expect(paymentSubline("ok", "You", false, "")).toBe("Confirmed ✓");
    expect(paymentSubline(undefined, "You", false, "")).toBe("Payment"); // F10: was "Settle-up"
    expect(paymentEffectLabel("ok", -50000, false)).toBe("you received");
    expect(paymentEffectLabel(undefined, 50000, false)).toBe("you paid");
    expect(paymentEffectLabel("waiting", 0, false)).toBe("not involved");
  });
  it("a deleted one says so, never 'says they paid'", () => {
    expect(paymentTitle("Nupur", "You", "waiting", true)).toBe("Nupur paid you");
    expect(paymentEffectLabel("waiting", -50000, true)).toBe("deleted");
    expect(paymentSubline("waiting", "You", true, "Deleted by Asha")).toBe("Deleted by Asha");
  });
});
