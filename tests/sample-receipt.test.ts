import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/money";
import { niceAmount, sampleReceipt, sampleReceiptMinor } from "@/lib/sample-receipt";

// The start screen's sample receipt (VA2-3, VD2-4): the same dinner for 6 and boat tour, in the visitor's own money.
// Hand-worked (30 x units-per-dollar, then a friendly rounding; dinner = 6 x each; total = dinner + boat):
//   USD  each 30,    dinner 180,        boat 240,       total 420
//   INR  (kept)      dinner 3,240,      boat 4,800,     total 8,040
//   EUR  27 -> 25,   dinner 150,        boat 216 -> 220, total 370
//   GBP  24 -> 25,   dinner 150,        boat 192 -> 190, total 340
//   JPY  4,500,      dinner 27,000,     boat 36,000,    total 63,000
describe("sample receipt", () => {
  it("dollars: $180 + $240 = $420, $30 each", () => {
    expect(sampleReceipt("USD")).toEqual({ currency: "USD", each: 30, dinner: 180, boat: 240, total: 420 });
    const m = sampleReceiptMinor("USD");
    expect([formatMoney(m.dinner, "USD"), formatMoney(m.boat, "USD"), formatMoney(m.total, "USD")]).toEqual(["$180", "$240", "$420"]);
  });
  it("rupees keep the original 3,240 / 4,800 / 8,040", () => {
    const m = sampleReceiptMinor("INR");
    expect([formatMoney(m.dinner, "INR"), formatMoney(m.boat, "INR"), formatMoney(m.total, "INR")]).toEqual(["₹3,240", "₹4,800", "₹8,040"]);
  });
  it("euro, pound and yen are round and add up", () => {
    expect(sampleReceipt("EUR")).toMatchObject({ dinner: 150, boat: 220, total: 370 });
    expect(sampleReceipt("GBP")).toMatchObject({ dinner: 150, boat: 190, total: 340 });
    expect(sampleReceipt("JPY")).toMatchObject({ each: 4500, dinner: 27000, boat: 36000, total: 63000 });
  });
  it("whatever the currency, dinner is 6 x each and the total adds up; amounts are whole", () => {
    for (const c of ["USD", "INR", "EUR", "GBP", "AUD", "THB", "IDR", "JPY", "KWD", "BRL", "XYZ", ""]) {
      const r = sampleReceipt(c);
      expect(r.dinner).toBe(r.each * 6);
      expect(r.total).toBe(r.dinner + r.boat);
      expect(Number.isInteger(r.total)).toBe(true);
    }
  });
  it("an unknown currency falls back to dollars; minor units follow the currency's decimals (JPY has none)", () => {
    expect(sampleReceipt("XYZ").currency).toBe("USD");
    expect(sampleReceiptMinor("JPY").total).toBe(63000);
    expect(sampleReceiptMinor("USD").total).toBe(42000);
  });
  it("niceAmount: multiples of 5 under 100, two significant figures above", () => {
    expect([niceAmount(27), niceAmount(2), niceAmount(216), niceAmount(4500), niceAmount(480000)]).toEqual([25, 5, 220, 4500, 480000]);
  });
});
