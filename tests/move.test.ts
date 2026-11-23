import { describe, expect, it } from "vitest";
import { isOldHost, shouldMove } from "@/lib/move-rules";
import { createMovePass, redeemMovePass } from "@/lib/move";
import { encodeSession, decodeSession } from "@/lib/session";
import { db } from "@/lib/db";

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
    const acc = await db.account.create({ data: { email: `mv-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test` } });
    try {
      const raw = await encodeSession({ m: { g1: "m1" }, a: acc.id, v: acc.sessionVersion });
      const t = await createMovePass(raw, true);
      expect(t).toBeTruthy();
      const got = await redeemMovePass(t);
      expect(got?.tourSeen).toBe(true);
      expect(await decodeSession(got!.session)).toMatchObject({ m: { g1: "m1" }, a: acc.id });
      expect(await redeemMovePass(t)).toBeNull();
    } finally {
      await db.account.delete({ where: { id: acc.id } });
    }
  });
  it("stores the decoded sign-in under a fingerprint, never the signed cookie or the token", async () => {
    const raw = await encodeSession({ m: { g1: "m1" } });
    const t = (await createMovePass(raw, false))!;
    const rows = await db.requestKey.findMany({ where: { key: { startsWith: "move:" } } });
    expect(rows.some((r) => r.key.includes(t))).toBe(false);
    expect(rows.some((r) => r.result.includes(raw))).toBe(false);
  });
  it("is refused once 'sign out on other phones' has changed the sign-in version", async () => {
    const acc = await db.account.create({ data: { email: `mv2-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test` } });
    try {
      const t = await createMovePass(await encodeSession({ m: {}, a: acc.id, v: acc.sessionVersion }), false);
      await db.account.update({ where: { id: acc.id }, data: { sessionVersion: { increment: 1 } } });
      expect(await redeemMovePass(t)).toBeNull();
    } finally {
      await db.account.delete({ where: { id: acc.id } });
    }
  });
  it("making a new pass sweeps passes older than two minutes", async () => {
    const old = await createMovePass(await encodeSession({ m: {} }), false);
    await db.requestKey.updateMany({ where: { key: { startsWith: "move:" } }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    await createMovePass(await encodeSession({ m: {} }), false);
    expect(await redeemMovePass(old)).toBeNull();
    expect(await db.requestKey.count({ where: { key: { startsWith: "move:" }, createdAt: { lt: new Date(Date.now() - 2 * 60_000) } } })).toBe(0);
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
