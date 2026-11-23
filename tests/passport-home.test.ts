import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { accountForEmail } from "@/lib/auth";
import { ensureHomeCountry, loadPassport } from "@/lib/passport-db";
import { buildPassport } from "@/lib/passport";
import { countryForCurrency } from "@/lib/region";

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
