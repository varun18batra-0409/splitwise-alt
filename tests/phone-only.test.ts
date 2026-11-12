import { describe, expect, it } from "vitest";
import { phoneOnlySentence } from "@/lib/phone-only";

// Not signed in: the group is only on this phone. The words are exact.
describe("groups only on this phone", () => {
  it("one group", () => {
    expect(phoneOnlySentence(false)).toBe("This group is saved on this phone. Sign in to keep it if you clear your browser or change phones.");
  });
  it("Home, many groups", () => {
    expect(phoneOnlySentence(true)).toBe("These groups are saved on this phone. Sign in to keep them if you clear your browser or change phones.");
  });
});
