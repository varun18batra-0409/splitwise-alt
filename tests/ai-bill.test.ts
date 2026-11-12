import { describe, expect, it } from "vitest";
import { cleanBill, roundTo } from "@/lib/ai";

describe("what the bill reader sends back is checked before it fills the form", () => {
  it("keeps a sensible bill, tidied", () => {
    const b = cleanBill({ is_bill: true, merchant: " Toit ", total: 1180.004, currency: "inr", date: "2026-11-09", items: [{ name: "Pizza", price: 600 }, { name: "", price: 10 }, { name: "Beer", price: -4 }], extras: 180 });
    expect(b).toEqual({ merchant: "Toit", total: 1180, currency: "INR", date: "2026-11-09", items: [{ name: "Pizza", price: 600 }], extras: 180 });
  });
  it("not a bill, or nonsense, fills nothing", () => {
    expect(cleanBill({ is_bill: false })).toBeNull();
    expect(cleanBill(null)).toBeNull();
    expect(cleanBill({ is_bill: true, total: "lots", currency: "rupees", date: "yesterday", items: "x" })).toMatchObject({ total: null, currency: "", date: "", items: [] });
  });
});

describe("three-decimal currencies keep their last digit", () => {
  it("a Kuwaiti dinar total of 1.234 stays 1.234 (1234 fils), not 1.23", () => {
    const b = cleanBill({ is_bill: true, merchant: "Cafe", total: 1.234, currency: "KWD", date: "", items: [{ name: "Tea", price: 0.567 }], extras: 0 });
    expect(b?.total).toBe(1.234);
    expect(Math.round((b?.total ?? 0) * 1000)).toBe(1234);
    expect(b?.items[0].price).toBe(0.567);
  });
  it("a two-decimal currency is rounded to two: INR 12.345 becomes 12.35, 10.126 becomes 10.13", () => {
    expect(cleanBill({ is_bill: true, total: 12.345, currency: "INR", items: [] })?.total).toBe(12.35);
    expect(cleanBill({ is_bill: true, total: 10.126, currency: "INR", items: [] })?.total).toBe(10.13);
  });
  it("a blank currency uses the group's decimals: in a KWD group 1.234 stays 1.234 (1234 fils); in an INR group it is 1.23", () => {
    expect(cleanBill({ is_bill: true, total: 1.234, currency: "", items: [{ name: "Tea", price: 0.567 }] }, "KWD")).toMatchObject({ total: 1.234, items: [{ name: "Tea", price: 0.567 }] });
    expect(cleanBill({ is_bill: true, total: 1.234, currency: "", items: [] }, "INR")?.total).toBe(1.23);
    // What the bill says wins over the group: a USD bill in a KWD group rounds to cents.
    expect(cleanBill({ is_bill: true, total: 1.234, currency: "USD", items: [] }, "KWD")?.total).toBe(1.23);
  });
  it("no currency, or one we don't know, rounds to 2 decimals (1.234 becomes 1.23)", () => {
    expect(cleanBill({ is_bill: true, total: 1.234, currency: "", items: [] })?.total).toBe(1.23);
    expect(cleanBill({ is_bill: true, total: 1.234, currency: "XYZ", items: [] })?.total).toBe(1.23);
  });
  it("roundTo rounds the digits as written: 12.345 -> 12.35 (2 places), 1.2345 -> 1.235 (3 places), 1200.4 -> 1200 (0 places)", () => {
    expect(roundTo(12.345, 2)).toBe(12.35);
    expect(roundTo(1.2345, 3)).toBe(1.235);
    expect(roundTo(1200.4, 0)).toBe(1200);
  });
});
