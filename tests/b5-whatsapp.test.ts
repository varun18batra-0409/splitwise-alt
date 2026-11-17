import { describe, expect, it } from "vitest";
import { waPhone } from "@/lib/whatsapp";

describe("B5 waPhone", () => {
  it("rupee groups: 10 digits get 91, a leading 0 goes", () => {
    expect(waPhone("98765 43210", true)).toBe("919876543210");
    expect(waPhone("098765 43210", true)).toBe("919876543210");
  });
  it("a + or 00 means the number already has its country code", () => {
    for (const india of [true, false]) {
      expect(waPhone("+44 7700 900123", india)).toBe("447700900123");
      expect(waPhone("0091 98765 43210", india)).toBe("919876543210");
      expect(waPhone("12345", india)).toBe("");
    }
  });
  it("outside rupee groups, a number with no + opens WhatsApp with no chat picked", () => {
    expect(waPhone("07700 900123", false)).toBe("");
  });
});
