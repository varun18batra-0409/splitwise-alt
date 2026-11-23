import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accountForEmail } from "@/lib/auth";
import { ensureHomeCountry, loadPassport } from "@/lib/passport-db";
import { buildPassport } from "@/lib/passport";
import { countryForCurrency, ipCountry } from "@/lib/region";
import { homeHighlights } from "@/lib/home/highlights";
import { cleanOldKeys } from "@/lib/offline/key-cleanup";

// The passport's home country is saved once (at sign-up), never guessed from where the phone is. One small default for older
// accounts (ensureHomeCountry). Home unknown: nothing counts as abroad, but stamps still show. Throwaway database.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
let n = 0;
afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(homeCountry = "") {
  const a = await db.account.create({ data: { email: `ph-${++n}-${stamp}@example.test`, name: `P${n}`, homeCountry } });
  accountIds.push(a.id);
  return a;
}
async function groupFor(accountId: string, o: { type?: string; currency?: string; tripStart?: string; tripEnd?: string; tripPlace?: string; tripCountry?: string }) {
  const g = await db.group.create({
    data: { name: `PH ${++n} ${stamp}`, type: o.type ?? "home", currency: o.currency ?? "INR", inviteCode: `ph-${n}-${stamp}`, tripStart: o.tripStart ?? "", tripEnd: o.tripEnd ?? "", tripPlace: o.tripPlace ?? "", tripCountry: o.tripCountry ?? "", members: { create: [{ name: "Me", accountId, claimedAt: new Date() }] } },
  });
  groupIds.push(g.id);
  return g;
}

describe("saved at sign-up, once", () => {
  it("a new account made from India is saved as IN; a second sign-in from Thailand changes nothing", async () => {
    const email = `ph-new-${stamp}@example.test`;
    const first = await accountForEmail(email, undefined, "IN");
    accountIds.push(first.id);
    expect(first.homeCountry).toBe("IN");
    const again = await accountForEmail(email, undefined, "TH");
    expect(again.id).toBe(first.id);
    expect(again.homeCountry).toBe("IN");
  });
  it("a made-up or missing country is saved as unknown", async () => {
    const a = await accountForEmail(`ph-junk-${stamp}@example.test`, undefined, "India!");
    accountIds.push(a.id);
    expect(a.homeCountry).toBe("");
    const b = await accountForEmail(`ph-none-${stamp}@example.test`);
    accountIds.push(b.id);
    expect(b.homeCountry).toBe("");
  });
});

describe("the one-time default for existing accounts", () => {
  it("two rupee flats and a baht trip: India (the trip is not counted)", async () => {
    const a = await account();
    await groupFor(a.id, { currency: "INR" });
    await groupFor(a.id, { currency: "INR" });
    await groupFor(a.id, { type: "trip", currency: "THB", tripStart: "2026-05-01", tripPlace: "Bangkok", tripCountry: "TH" });
    const got = await ensureHomeCountry(a);
    expect(got.homeCountry).toBe("IN");
    expect((await db.account.findUniqueOrThrow({ where: { id: a.id } })).homeCountry).toBe("IN");
  });
  it("euros stay unknown (many countries), as do a tie and no groups", async () => {
    const eu = await account();
    await groupFor(eu.id, { currency: "EUR" });
    expect((await ensureHomeCountry(eu)).homeCountry).toBe("");
    const tie = await account();
    await groupFor(tie.id, { currency: "INR" });
    await groupFor(tie.id, { currency: "GBP" });
    expect((await ensureHomeCountry(tie)).homeCountry).toBe("");
    expect((await ensureHomeCountry(await account())).homeCountry).toBe("");
    expect((await db.account.findUniqueOrThrow({ where: { id: eu.id } })).homeCountry).toBe("");
  });
  it("a saved country is never changed by it", async () => {
    const a = await account("TH");
    await groupFor(a.id, { currency: "INR" });
    expect((await ensureHomeCountry(a)).homeCountry).toBe("TH");
  });
  it("currency to country: rupees India, dollars US, euros none", () => {
    expect(countryForCurrency("INR")).toBe("IN");
    expect(countryForCurrency("USD")).toBe("US");
    expect(countryForCurrency("EUR")).toBeNull();
    expect(countryForCurrency("XXX")).toBeNull();
  });
});

describe("saved India, phone anywhere", () => {
  it("a Goa trip is a city stamp, a Thailand trip a country stamp, and 'First trip abroad' counts Thailand only", async () => {
    const a = await account("IN");
    await groupFor(a.id, { type: "trip", tripStart: "2026-02-01", tripEnd: "2026-02-04", tripPlace: "Goa", tripCountry: "IN" });
    await groupFor(a.id, { type: "trip", tripStart: "2026-05-01", tripEnd: "2026-05-05", tripPlace: "Bangkok", tripCountry: "TH" });
    const p = await loadPassport(a, "2026-11-23");
    expect(p.stamps.map((s) => [s.kind, s.code, s.name]).sort()).toEqual([["city", "IN", "Goa"], ["country", "TH", "Thailand"]]);
    expect(p.stats.abroad).toBe(1);
    expect(p.milestones).toContain("First trip abroad");
    expect(p.marks.some((m) => m.ladder === "abroad")).toBe(true);
  });
});

describe("home unknown: stamps show, nothing is abroad", () => {
  const trip = (groupId: string, name: string, start: string, place = "") => ({ groupId, name, start, end: "", place, country: "", people: 2 });
  it("a Thailand trip is a country stamp and a counted country, with no abroad numbers, milestone, mark or badge", () => {
    const p = buildPassport([trip("a", "Thailand", "2026-05-01", "Bangkok"), trip("b", "Goa", "2026-02-01")], [], "", "2026-11-23");
    expect(p.stamps.map((s) => [s.kind, s.code])).toEqual([["country", "IN"], ["country", "TH"]]);
    expect(p.stats.countries).toBe(2);
    expect(p.stats.abroad).toBe(0);
    expect(p.milestones).not.toContain("First trip abroad");
    expect(p.milestones.some((m) => /abroad/.test(m))).toBe(false);
    expect(p.marks.some((m) => m.ladder === "abroad")).toBe(false);
    expect(p.badges.find((b) => b.id === "first-abroad")?.earned).toBe(false);
    expect(p.badges.find((b) => b.id === "frequent")?.have).toBe(0);
  });
  it("a hand-ticked country does not make 'Been abroad' either", () => {
    const p = buildPassport([], [{ c: "JP" }], "", "2026-11-23");
    expect(p.marks.some((m) => m.ladder === "abroad")).toBe(false);
  });
  it("a friend with no saved home has no abroad mark; with IN saved the same trips do", async () => {
    const none = await account("");
    const saved = await account("IN");
    for (const a of [none, saved]) await groupFor(a.id, { type: "trip", tripStart: "2026-05-01", tripEnd: "2026-05-05", tripPlace: "Bangkok", tripCountry: "TH" });
    const f1 = await loadPassport(none, "2026-11-23", { forFriend: true });
    const f2 = await loadPassport(saved, "2026-11-23", { forFriend: true });
    expect(f1.stats.abroad).toBe(0);
    expect(f1.marks.some((m) => m.ladder === "abroad")).toBe(false);
    expect(f2.stats.abroad).toBe(1);
    expect(f2.marks.some((m) => m.ladder === "abroad")).toBe(true);
  });
});

describe("A9/A10/A12: sign-up country, the passport card, and clearing the home country", () => {
  it("the sign-up country is the network's country only: a phone language never counts, and 'XX' or junk is unknown", () => {
    const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
    expect(ipCountry(h({ "x-vercel-ip-country": "in" }))).toBe("IN");
    expect(ipCountry(h({ "accept-language": "en-GB,en;q=0.9" }))).toBeNull();
    expect(ipCountry(h({ "x-vercel-ip-country": "XX" }))).toBeNull();
    expect(ipCountry(h({ "x-vercel-ip-country": "India" }))).toBeNull();
  });
  it("home unknown: Home's passport card has no 'abroad, plus home' phrase; with a home it does", () => {
    const base = { weather: null, hasMonth: false, season: null, postcardsNew: 0, billsDue: [], passportCountries: 3 };
    const text = (abroad: number | undefined) => JSON.stringify(homeHighlights({ ...base, passportAbroad: abroad } as never));
    expect(text(undefined)).not.toMatch(/abroad, plus home/);
    expect(text(2)).toMatch(/2 abroad, plus home/);
  });
  it("a person who chose 'Not set' is never filled in again by the one-time default", async () => {
    const a = await account();
    await groupFor(a.id, { currency: "INR" });
    await db.requestKey.create({ data: { key: `home-cleared:${a.id}`, result: "1" } });
    expect((await ensureHomeCountry(a)).homeCountry).toBe("");
    expect((await db.account.findUniqueOrThrow({ where: { id: a.id } })).homeCountry).toBe("");
    await db.requestKey.deleteMany({ where: { key: `home-cleared:${a.id}` } });
  });
  it("the daily clean-up keeps the two lasting keys but still removes an old retry key", async () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    const keys = [`home-cleared:${stamp}`, `bill-replaced:${stamp}`, `retry-${stamp}`];
    for (const key of keys) await db.requestKey.create({ data: { key, createdAt: old } });
    await cleanOldKeys();
    const left = (await db.requestKey.findMany({ where: { key: { in: keys } } })).map((r) => r.key).sort();
    expect(left).toEqual([keys[0], keys[1]].sort());
    await db.requestKey.deleteMany({ where: { key: { in: keys } } });
  });
});
