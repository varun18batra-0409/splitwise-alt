import { describe, expect, it } from "vitest";
import { isOldHost, shouldMove } from "@/lib/move-rules";
import { createMovePass, redeemMovePass } from "@/lib/move";
import { encodeSession } from "@/lib/session";

// Loopin moved to loopinapps.com: screens on the old address forward there,
// and a signed-in person's sign-in comes with them via a one-time pass.

describe("what moves to the new address", () => {
  it("screens on the old addresses move; the new address and test copies don't", () => {
    expect(shouldMove("getloopin.vercel.app", "GET", "/")).toBe(true);
    expect(shouldMove("splitwise-alt-bovz.vercel.app", "GET", "/groups/abc")).toBe(true);
    expect(shouldMove("GETLOOPIN.VERCEL.APP:443", "GET", "/")).toBe(true);
    expect(shouldMove("loopinapps.com", "GET", "/")).toBe(false);
    expect(shouldMove("splitwise-alt-bovz-1pvlthkdb-fairshare.vercel.app", "GET", "/")).toBe(false);
    expect(shouldMove("localhost:3000", "GET", "/")).toBe(false);
  });
  it("the daily job, notifications, the background worker and files stay put", () => {
    for (const p of ["/api/cron/daily", "/api/unread", "/sw.js", "/icon-192.png", "/manifest.webmanifest", "/_next/static/x.js"]) {
      expect(shouldMove("getloopin.vercel.app", "GET", p)).toBe(false);
    }
    expect(shouldMove("getloopin.vercel.app", "POST", "/groups/abc")).toBe(false);
    expect(isOldHost(undefined)).toBe(false);
  });
});

describe("the one-time pass", () => {
  it("carries a real sign-in once, and only once", async () => {
    const raw = await encodeSession({ m: { g1: "m1" }, a: "acc1" });
    const t = await createMovePass(raw, true);
    expect(t).toBeTruthy();
    expect(await redeemMovePass(t)).toEqual({ session: raw, tourSeen: true });
    expect(await redeemMovePass(t)).toBeNull();
  });
  it("is refused after two minutes", async () => {
    const raw = await encodeSession({ m: { g1: "m1" } });
    const t = await createMovePass(raw, false);
    expect(await redeemMovePass(t, new Date(Date.now() + 3 * 60_000))).toBeNull();
  });
  it("never carries a forged or missing sign-in, and ignores made-up passes", async () => {
    expect(await createMovePass(undefined, false)).toBeNull();
    expect(await createMovePass("eyJtIjp7fX0.forged", false)).toBeNull();
    expect(await redeemMovePass("not-a-real-pass-123456789")).toBeNull();
    expect(await redeemMovePass("../../etc")).toBeNull();
  });
});
