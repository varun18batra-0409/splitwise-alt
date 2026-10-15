import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { decodeSession, encodeSession, parseLegacy } from "@/lib/session";
import { cleanEmail, deleteAccount, hashLoginCode, verifyLoginCode } from "@/lib/auth";
import { allow } from "@/lib/rate-limit";
import { dayKey, parseDay, todayKey, isTimeZone } from "@/lib/dates";
import { dayLabel } from "@/lib/activity";
import { inPeriod, monthKey } from "@/lib/search";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { loadDeletedGroups, loadGroup, loadMyGroups } from "@/lib/group-data";
import { countryFromLanguages, currencyForCountry, defaultCurrency } from "@/lib/region";
import { computeStats } from "@/lib/stats";
import type { RateAnswer } from "@/lib/rate-cache";

// Phase 1: safer identity, sign-in codes, spam limits, global dates,
// edit clashes, double taps, deleting groups, region currency and stats.

describe("signed identity cookie", () => {
  it("round-trips and refuses anything tampered with", async () => {
    const raw = await encodeSession({ m: { g1: "m1" }, a: "acc1" });
    expect(await decodeSession(raw)).toEqual({ m: { g1: "m1" }, a: "acc1" });
    const [payload, sig] = raw.split(".");
    const forged = Buffer.from(JSON.stringify({ m: { g1: "someone-else" } })).toString("base64url");
    expect(await decodeSession(`${forged}.${sig}`)).toBeNull();
    expect(await decodeSession(`${payload}.${sig.slice(0, -2)}xx`)).toBeNull();
    expect(await decodeSession("garbage")).toBeNull();
    expect(await decodeSession(undefined)).toBeNull();
  });

  it("reads the old unsigned cookie so nobody loses their groups", () => {
    const old = JSON.stringify({ g1: "m1", g2: "m2" });
    expect(parseLegacy(old)).toEqual({ m: { g1: "m1", g2: "m2" } });
    expect(parseLegacy(encodeURIComponent(old))).toEqual({ m: { g1: "m1", g2: "m2" } });
    expect(parseLegacy("nope")).toBeNull();
  });
});

describe("email sign-in codes", () => {
  const email = `test-${Date.now()}@example.com`;
  afterAll(async () => {
    const acc = await db.account.findUnique({ where: { email } });
    if (acc) await deleteAccount(acc.id);
    await db.loginCode.deleteMany({ where: { email } });
  });

  it("cleans emails", () => {
    expect(cleanEmail("  Asha@Example.COM ")).toBe("asha@example.com");
    expect(cleanEmail("not-an-email")).toBeNull();
  });

  it("accepts the right code once, and locks after too many wrong tries", async () => {
    await db.loginCode.create({ data: { email, codeHash: hashLoginCode(email, "123456"), expiresAt: new Date(Date.now() + 60_000) } });
    expect((await verifyLoginCode(email, "000000")).ok).toBe(false);
    const ok = await verifyLoginCode(email.toUpperCase(), "123 456");
    expect(ok.ok).toBe(true);
    expect((await verifyLoginCode(email, "123456")).ok).toBe(false); // used up

    await db.loginCode.create({ data: { email, codeHash: hashLoginCode(email, "654321"), expiresAt: new Date(Date.now() + 60_000) } });
    for (let i = 0; i < 5; i++) await verifyLoginCode(email, "111111");
    const locked = await verifyLoginCode(email, "654321");
    expect(locked).toEqual({ ok: false, error: "Too many wrong tries. Ask for a new code." });
  });

  it("refuses expired codes", async () => {
    await db.loginCode.create({ data: { email, codeHash: hashLoginCode(email, "222222"), expiresAt: new Date(Date.now() - 1000) } });
    expect((await verifyLoginCode(email, "222222")).ok).toBe(false);
  });
});

describe("rate limits", () => {
  it("allows up to the limit in a window, then again after it", async () => {
    const key = `test:${Date.now()}`;
    const t0 = new Date();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await allow(key, 3, 60, t0));
    expect(results).toEqual([true, true, true, false]);
    expect(await allow(key, 3, 60, new Date(t0.getTime() + 61_000))).toBe(true);
    await db.rateLimit.delete({ where: { key } });
  });
});

describe("dates around the world", () => {
  const now = new Date("2026-10-14T20:00:00Z"); // 15 Oct in India and Tokyo, 14 Oct in Los Angeles

  it("today depends on where you are", () => {
    expect(todayKey(now, "Asia/Kolkata")).toBe("2026-10-15");
    expect(todayKey(now, "Asia/Tokyo")).toBe("2026-10-15");
    expect(todayKey(now, "America/Los_Angeles")).toBe("2026-10-14");
  });

  it("a chosen day is the same day for everyone", () => {
    const d = parseDay("2026-10-12", now)!;
    expect(d.toISOString()).toBe("2026-10-12T12:00:00.000Z");
    for (const tz of ["Asia/Kolkata", "Asia/Tokyo", "America/Los_Angeles", "Europe/London", "Pacific/Auckland", "America/New_York"]) {
      expect(dayKey(d, tz)).toBe("2026-10-12");
    }
  });

  it("labels and month filters follow the viewer's zone", () => {
    const moment = new Date("2026-10-31T20:00:00Z");
    expect(monthKey(moment, "Asia/Kolkata")).toBe("2026-11");
    expect(monthKey(moment, "America/Los_Angeles")).toBe("2026-10");
    expect(inPeriod(moment, { month: "2026-10" }, "America/Los_Angeles")).toBe(true);
    expect(dayLabel(new Date("2026-10-14T18:00:00Z"), now, "America/Los_Angeles")).toBe("Today");
    expect(dayLabel(new Date("2026-10-14T18:00:00Z"), now, "Asia/Kolkata")).toBe("Yesterday");
  });

  it("ignores made-up time zones", () => {
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("Europe/Paris")).toBe(true);
    expect(dayKey(now, "Mars/Olympus")).toBe("2026-10-15");
  });
});

describe("starting currency from region", () => {
  it("uses the hosting's country, then the phone's language region", () => {
    expect(currencyForCountry("gb")).toBe("GBP");
    expect(currencyForCountry("DE")).toBe("EUR");
    expect(currencyForCountry("ZZ")).toBeNull();
    expect(countryFromLanguages("en-GB,en;q=0.9")).toBe("GB");
    expect(countryFromLanguages("en")).toBeNull();
    const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
    expect(defaultCurrency(h({ "x-vercel-ip-country": "US", "accept-language": "en-IN" }))).toBe("USD");
    expect(defaultCurrency(h({ "accept-language": "ja-JP" }))).toBe("JPY");
    expect(defaultCurrency(h({}))).toBe("INR");
  });
});

describe("edit clashes, double taps and deleting groups", () => {
  let groupId = "";
  let me = "", a = "";
  const rate = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-10-14" });
  const input = (over: Partial<SaveExpenseInput>): SaveExpenseInput => ({
    groupId, name: "Lunch", category: "", amount: "600", currency: "INR", paidById: me, forMode: "everyone",
    selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
    markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
  });

  beforeAll(async () => {
    const g = await db.group.create({
      data: { name: "Phase 1 test", currency: "INR", inviteCode: `p1-${Date.now()}`, members: { create: [{ name: "Me" }, { name: "A" }] } },
      include: { members: true },
    });
    groupId = g.id;
    me = g.members.find((m) => m.name === "Me")!.id;
    a = g.members.find((m) => m.name === "A")!.id;
  });
  afterAll(async () => {
    await db.group.delete({ where: { id: groupId } }).catch(() => {});
  });

  it("a second tap within seconds doesn't add the expense twice", async () => {
    const one = await saveExpense(input({ name: "Taxi" }), me, rate, { ignoreDoubleTap: true });
    const two = await saveExpense(input({ name: "Taxi" }), me, rate, { ignoreDoubleTap: true });
    expect(one.ok && two.ok && one.id === two.id).toBe(true);
    expect(await db.expense.count({ where: { groupId, description: "Taxi" } })).toBe(1);
  });

  it("warns instead of overwriting someone else's newer edit", async () => {
    const r = await saveExpense(input({ name: "Brunch" }), me, rate);
    if (!r.ok) throw new Error(r.error);
    const e = await db.expense.findUniqueOrThrow({ where: { id: r.id } });
    const seen = (e.editedAt ?? e.createdAt).toISOString();
    await new Promise((res) => setTimeout(res, 5));
    const theirs = await saveExpense(input({ expenseId: r.id, name: "Brunch", amount: "700", rateMode: "keep", baseVersion: seen }), a, rate);
    expect(theirs.ok).toBe(true);
    const mine = await saveExpense(input({ expenseId: r.id, name: "Brunch", amount: "800", rateMode: "keep", baseVersion: seen }), me, rate);
    expect(mine).toEqual({ ok: false, error: "A changed this expense a moment ago. Go back and open it again to see the latest version." });
    expect((await db.expense.findUniqueOrThrow({ where: { id: r.id } })).amount).toBe(70000);
  });

  it("a deleted group disappears, can be restored, and refuses new expenses", async () => {
    await db.group.update({ where: { id: groupId }, data: { deletedAt: new Date(), deletedById: a } });
    expect(await loadGroup(groupId)).toBeNull();
    expect((await loadMyGroups({ [groupId]: me })).length).toBe(0);
    expect(await loadDeletedGroups({ [groupId]: me })).toEqual([{ id: groupId, name: "Phase 1 test", deletedBy: "A", daysLeft: 30 }]);
    expect((await saveExpense(input({ name: "After" }), me, rate)).ok).toBe(false);
    const later = new Date(Date.now() + 31 * 86_400_000);
    expect(await loadDeletedGroups({ [groupId]: me }, later)).toEqual([]);
    await db.group.update({ where: { id: groupId }, data: { deletedAt: null, deletedById: "" } });
    expect(await loadGroup(groupId)).not.toBeNull();
  });
});

describe("private stats", () => {
  it("works out the key numbers from the app's own data", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    const ago = (days: number, mins = 0) => new Date(now.getTime() - days * 86_400_000 + mins * 60_000);
    const s = computeStats(
      {
        groups: [
          { id: "g1", createdAt: ago(40), deletedAt: null, closed: false },
          { id: "g2", createdAt: ago(3), deletedAt: null, closed: false },
          { id: "g3", createdAt: ago(35), deletedAt: null, closed: false },
          { id: "gx", createdAt: ago(10), deletedAt: ago(1), closed: false },
        ],
        members: [
          { groupId: "g1", claimedAt: ago(40) },
          { groupId: "g1", claimedAt: ago(39) },
          { groupId: "g2", claimedAt: ago(3) },
        ],
        expenses: [
          { groupId: "g1", createdAt: ago(40, 10) },
          { groupId: "g2", createdAt: ago(3, 30) },
        ],
        events: [
          { groupId: "g1", createdAt: ago(2), kind: "expense_added" },
          { groupId: "g2", createdAt: ago(3, 30), kind: "expense_added" },
        ],
        balancesSettled: { g1: true, g2: false, g3: true },
        accounts: 2,
      },
      now,
    );
    expect(s.totalGroups).toBe(3);
    expect(s.weeklyActive).toBe(2);
    expect(s.newGroups7).toBe(1);
    expect(s.medianMinutesToFirstExpense).toBe(10);
    expect(s.invitePct).toBe(33);
    expect(s.retention4w).toEqual({ pct: 50, of: 2 });
    expect(s.settledPct).toBe(50);
    expect(s.deletedGroups).toBe(1);
  });
});
