import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { hashLoginCode, verifyLoginCode } from "@/lib/auth";
import { allow } from "@/lib/rate-limit";
import { safePath } from "@/lib/paths";
import { decodeSession } from "@/lib/session";

// Fixes from the security review.

describe("sign-in codes can't be raced past 5 tries", () => {
  const email = `race-${Date.now()}@example.com`;
  afterAll(async () => {
    await db.loginCode.deleteMany({ where: { email } });
    await db.account.deleteMany({ where: { email } });
  });
  it("50 wrong guesses at once use up the code after 5", async () => {
    await db.loginCode.create({ data: { email, codeHash: hashLoginCode(email, "424242"), expiresAt: new Date(Date.now() + 60_000) } });
    const guesses = Array.from({ length: 50 }, (_, i) => String(100000 + i));
    await Promise.all(guesses.map((g) => verifyLoginCode(email, g)));
    const row = await db.loginCode.findFirstOrThrow({ where: { email } });
    expect(row.attempts).toBeLessThanOrEqual(5);
    // Even the right code no longer works: the 5 tries are used up.
    expect((await verifyLoginCode(email, "424242")).ok).toBe(false);
  });
});

describe("rate limits can't be raced", () => {
  it("20 requests at once against a limit of 5: exactly 5 pass", async () => {
    const key = `race-${Date.now()}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => allow(key, 5, 60)));
    expect(results.filter(Boolean).length).toBe(5);
    await db.rateLimit.delete({ where: { key } });
  });
});

describe("return addresses can't send people to another website", () => {
  it.each([
    ["/groups/abc?tab=x", "/groups/abc?tab=x"],
    ["//evil.com", "/"],
    ["/\\evil.com", "/"],
    ["/\t/evil.com", "/"],
    ["https://evil.com", "/"],
    ["javascript:alert(1)", "/"],
    ["", "/"],
  ])("%j → %j", (input, out) => {
    expect(safePath(input)).toBe(out);
  });
});

describe("old unsigned cookies are no longer accepted", () => {
  it("plain JSON is not a session", async () => {
    expect(await decodeSession(JSON.stringify({ g: "someone-else" }))).toBeNull();
  });
});
