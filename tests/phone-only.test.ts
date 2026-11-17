import { describe, expect, it } from "vitest";
import { phoneOnlySentence } from "@/lib/phone-only";

// Not signed in: the group is only on this device. The words are exact.
describe("groups only on this device", () => {
  it("one group", () => {
    expect(phoneOnlySentence(false)).toBe("This group is saved on this device. Sign in to keep it if you clear your browser or change devices.");
  });
  it("Home, many groups", () => {
    expect(phoneOnlySentence(true)).toBe("These groups are saved on this device. Sign in to keep them if you clear your browser or change devices.");
  });
});
