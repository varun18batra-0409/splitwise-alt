import { describe, expect, it } from "vitest";
import { handleTimeZone, type TzDeps } from "@/lib/tz-request";
import { saveTimeZone } from "@/lib/nudge-zones";

// What POST /api/tz answers: 200 saved, 400 not a real zone, 429 too many, 500 a real failure.
// No database is touched: the answers are faked, and the zone check runs with no people and no account to save to.

const deps = (over: Partial<TzDeps> = {}): TzDeps => ({
  allow: async () => true,
  account: async () => null,
  memberships: async () => ({ g1: "m1" }),
  save: async () => true,
  ...over,
});

describe("POST /api/tz rules", () => {
  it("a good zone is saved: 200 ok", async () => {
    let saved: unknown[] = [];
    const r = await handleTimeZone({ tz: "Europe/London" }, "1.2.3.4", deps({ save: async (...a) => { saved = a; return true; } }));
    expect(r).toEqual({ ok: true, status: 200 });
    expect(saved).toEqual(["Europe/London", null, ["m1"]]);
  });

  it("a bad zone (checked by the real saveTimeZone, which saves nothing here) is 400; so is a missing body", async () => {
    const real = deps({ memberships: async () => ({}), save: (tz, acc, ids) => saveTimeZone(tz, acc, ids) });
    expect(await handleTimeZone({ tz: "Mars/Base" }, "1.2.3.4", real)).toEqual({ ok: false, status: 400 });
    expect(await handleTimeZone({ tz: "x".repeat(500) }, "1.2.3.4", real)).toEqual({ ok: false, status: 400 });
    expect(await handleTimeZone(null, "1.2.3.4", real)).toEqual({ ok: false, status: 400 });
  });

  it("over the limit is 429: per network address first, then per person (the account if signed in, else the first person)", async () => {
    const keys: string[] = [];
    expect(await handleTimeZone({ tz: "Asia/Tokyo" }, "9.9.9.9", deps({ allow: async (k) => { keys.push(k); return false; } }))).toEqual({ ok: false, status: 429 });
    expect(keys).toEqual(["tz:9.9.9.9"]);
    const seen: string[] = [];
    const r = await handleTimeZone({ tz: "Asia/Tokyo" }, "9.9.9.9", deps({ account: async () => ({ id: "acc1" }), allow: async (k) => { seen.push(k); return !k.startsWith("tz-who:"); } }));
    expect(r).toEqual({ ok: false, status: 429 });
    expect(seen).toEqual(["tz:9.9.9.9", "tz-who:acc1"]);
    let saves = 0;
    await handleTimeZone({ tz: "Asia/Tokyo" }, "9.9.9.9", deps({ allow: async (k) => !k.startsWith("tz-who:"), save: async () => { saves++; return true; } }));
    expect(saves).toBe(0); // refused before anything is saved
  });

  it("a real failure is 500, so the phone does not treat it as saved", async () => {
    expect(await handleTimeZone({ tz: "Asia/Tokyo" }, "1.2.3.4", deps({ save: async () => { throw new Error("db down"); } }))).toEqual({ ok: false, status: 500 });
    expect(await handleTimeZone({ tz: "Asia/Tokyo" }, "1.2.3.4", deps({ allow: async () => { throw new Error("db down"); } }))).toEqual({ ok: false, status: 500 });
  });
});
