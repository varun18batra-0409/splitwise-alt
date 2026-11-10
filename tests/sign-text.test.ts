import { describe, expect, it } from "vitest";
import { signText, verifyText } from "@/lib/session";

describe("signed links (unsubscribe)", () => {
  it("a signature matches only its own text", async () => {
    const s = await signText("unsub:asha@example.com");
    expect(await verifyText("unsub:asha@example.com", s)).toBe(true);
    expect(await verifyText("unsub:ravi@example.com", s)).toBe(false);
    expect(await verifyText("unsub:asha@example.com", "x".repeat(s.length))).toBe(false);
    expect(await verifyText("unsub:asha@example.com", "")).toBe(false);
  });
});
