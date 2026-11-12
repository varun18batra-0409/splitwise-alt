import { describe, expect, it } from "vitest";
import { cleanBill } from "@/lib/ai";

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
  it("a two-decimal currency is still rounded to two (1180.505 rupees would be refused by the form)", () => {
    expect(cleanBill({ is_bill: true, total: 10.126, currency: "INR", items: [] })?.total).toBe(10.13);
  });
});
