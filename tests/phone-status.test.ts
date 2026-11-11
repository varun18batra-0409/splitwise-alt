import { describe, expect, it } from "vitest";
import { phoneStatusLabel } from "@/lib/phone-status";

// Alerts, Account and group Settings show what THIS phone allows, apart from what Loopin sends.
describe("This phone", () => {
  it("says Allowed / Blocked in phone settings / Not asked / add to Home Screen first", () => {
    expect(phoneStatusLabel("on", "granted")).toBe("Allowed");
    expect(phoneStatusLabel("denied", "denied")).toBe("Blocked in phone settings");
    expect(phoneStatusLabel("off", "default")).toBe("Not asked yet");
    expect(phoneStatusLabel("ios-install", "none")).toBe("iPhone: add Loopin to your Home Screen first");
  });
  it("allowed by the phone but switched off in Loopin is said plainly", () => {
    expect(phoneStatusLabel("off", "granted")).toBe("Allowed, but turned off in Loopin");
  });
  it("a browser that can't do it says so", () => {
    expect(phoneStatusLabel("unsupported", "none")).toBe("Not available in this browser");
  });
});
