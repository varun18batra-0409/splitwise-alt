import { describe, expect, it } from "vitest";
import { fixNeedsOwnRate } from "@/lib/offline/fix-rate";
import { computeTotals } from "@/lib/conversion";
import { W } from "@/lib/offline/words";
import { niceDate } from "@/lib/format";

// "Open and fix" never quietly uses another day's rate: in another currency, on a day before today, the person enters the rate.
describe("Open and fix: when the live rate is not used", () => {
  const today = "2026-11-22";
  it("fix mode + another currency + an earlier day: the person's own rate is needed", () => {
    expect(fixNeedsOwnRate({ isFix: true, foreign: true, day: "2026-11-17", today })).toBe(true);
    expect(fixNeedsOwnRate({ isFix: true, foreign: true, day: "2026-11-21", today })).toBe(true); // yesterday
  });
  it("today, or the group's own currency, or the normal online form (not fix mode): unchanged, the live rate", () => {
    expect(fixNeedsOwnRate({ isFix: true, foreign: true, day: "2026-11-22", today })).toBe(false); // today
    expect(fixNeedsOwnRate({ isFix: true, foreign: false, day: "2026-11-17", today })).toBe(false); // same currency
    expect(fixNeedsOwnRate({ isFix: false, foreign: true, day: "2026-11-17", today })).toBe(false); // the ordinary form, as on live
  });
  it("the note reads as the founder worded it, with the day written as the app writes it", () => {
    expect(W.fixRateNote("17 Nov")).toBe("Enter the rate for 17 Nov (the day of this expense)");
    expect(W.fixRateNote(niceDate("2026-11-17"))).toMatch(/^Enter the rate for 17 Nov( 2026)? \(the day of this expense\)$/);
  });
  it("saving needs the rate: with the box empty the money is not worked out (THB 1,000 gives 'Enter the exchange rate'); typed 2.5 gives 250000 paise", () => {
    const base = { amount: "1000", currency: "THB", baseCurrency: "INR", paymentMethod: "cash" as const, markupBp: 0 };
    const empty = computeTotals({ ...base, rate: "" });
    expect(empty.ok).toBe(false);
    expect(!empty.ok && empty.error).toBe("Enter the exchange rate to convert this amount.");
    const typed = computeTotals({ ...base, rate: "2.5" });
    expect(typed.ok && typed.convertedAmount).toBe(250000); // 100000 satang x 2.5
  });
});
