import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeSession, encodeSession } from "@/lib/session";
import { hashLoginCode } from "@/lib/auth";

// On the live app a missing AUTH_SECRET must stop sign-in with a clear error,
// never fall back to the string written in the code. The TURSO-derived key stays.

const KEYS = ["VERCEL_ENV", "AUTH_SECRET", "TURSO_AUTH_TOKEN"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("session key on the live app", () => {
  it("production with neither AUTH_SECRET nor TURSO_AUTH_TOKEN throws a clear error (and names no secret)", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.AUTH_SECRET;
    delete process.env.TURSO_AUTH_TOKEN;
    await expect(encodeSession({ m: {} })).rejects.toThrow(/AUTH_SECRET is missing/);
    await expect(decodeSession("abc.def")).resolves.toBeNull(); // reading a cookie just says "not signed in"
    expect(() => hashLoginCode("a@b.co", "123456")).toThrow(/AUTH_SECRET is missing/);
  });

  it("production with only the Turso token keeps the old derived key, so live sessions stay valid", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.AUTH_SECRET;
    process.env.TURSO_AUTH_TOKEN = "test-token-not-real";
    const raw = await encodeSession({ m: { g: "m" } });
    expect(await decodeSession(raw)).toEqual({ m: { g: "m" } });
    expect(hashLoginCode("a@b.co", "123456")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("outside production the development key still works", async () => {
    delete process.env.VERCEL_ENV;
    delete process.env.AUTH_SECRET;
    delete process.env.TURSO_AUTH_TOKEN;
    expect(await decodeSession(await encodeSession({ m: {} }))).toEqual({ m: {} });
  });
});
