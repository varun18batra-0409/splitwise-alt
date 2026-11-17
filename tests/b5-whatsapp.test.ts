import { describe, expect, it } from "vitest";
import { waPhone } from "@/lib/whatsapp";
import { nudgeLink } from "@/lib/nudge";

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
  it("M3: an 11-digit number starting with 0 is never turned into +91 outside rupee groups", () => {
    expect(waPhone("09876543210", false)).toBe(""); // 0 + 10 digits: would have been 919876543210
    expect(waPhone("09876543210", true)).toBe("919876543210"); // only with india: drop the 0 (leaves 10 digits), add 91
  });
  it("M3: the reminder link reads the number by the group's currency", () => {
    const gbp = nudgeLink("07700 900123", "Sam", "£20", "Flat", { currency: "GBP" });
    expect(gbp.startsWith("https://api.whatsapp.com/send?text=")).toBe(true); // no phone= at all
    expect(gbp).not.toContain("phone=");
    expect(nudgeLink("098765 43210", "Asha", "₹500", "Goa", { currency: "INR" }).startsWith("https://api.whatsapp.com/send?phone=919876543210&text=")).toBe(true);
    expect(nudgeLink("098765 43210", "Asha", "$5", "Goa", { currency: "USD" })).not.toContain("phone=");
    expect(nudgeLink("+44 7700 900123", "Sam", "£20", "Flat", { currency: "GBP" })).toContain("phone=447700900123&"); // a + number works anywhere
    expect(nudgeLink("098765 43210", "Asha", "₹500", "Goa")).not.toContain("phone="); // currency unknown: nothing guessed
  });
});
