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
