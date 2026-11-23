import { afterAll, describe, expect, it, vi } from "vitest";

// A12: "Not set" can be chosen again in passport settings, and the one-time default must then leave it alone. The choice is written
// as a one-time key (home-cleared:<account id>), so no schema change. Throwaway database.

const who = vi.hoisted(() => ({ account: null as null | { id: string; homeCountry: string } }));
vi.mock("@/lib/identity", () => ({ getAccount: async () => who.account }));
vi.mock("@/lib/fresh-redirect", () => ({ redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); } }));
vi.mock("@/lib/flash", () => ({ flashTo: async (p: string) => String(p) }));

const { db } = await import("@/lib/db");
const { setHomeCountryAction } = await import("@/app/passport-actions");
const { ensureHomeCountry } = await import("@/lib/passport-db");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { in: accountIds.map((id) => `home-cleared:${id}`) } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});
const submit = async (country: string) => {
  const f = new FormData();
  f.set("country", country);
  await setHomeCountryAction(f).catch((e) => { if (!/NEXT_REDIRECT/.test(String(e))) throw e; });
};

describe("clearing the home country", () => {
  it("India saved, then 'Not set': it stays empty even though the person has two rupee flats; choosing India again works", async () => {
    const a = await db.account.create({ data: { email: `ch-${stamp}@example.test`, name: "Asha", homeCountry: "IN" } });
    accountIds.push(a.id);
    for (let i = 0; i < 2; i++) {
      const g = await db.group.create({ data: { name: `CH ${i} ${stamp}`, type: "home", currency: "INR", inviteCode: `ch-${i}-${stamp}`, members: { create: [{ name: "Asha", accountId: a.id, claimedAt: new Date() }] } } });
      groupIds.push(g.id);
    }
    who.account = { id: a.id, homeCountry: "IN" };
    await submit("");
    const cleared = await db.account.findUniqueOrThrow({ where: { id: a.id } });
    expect(cleared.homeCountry).toBe("");
    expect(await db.requestKey.count({ where: { key: `home-cleared:${a.id}` } })).toBe(1); // the note was written together with the blanking
    expect((await ensureHomeCountry(cleared)).homeCountry).toBe("");
    expect((await db.account.findUniqueOrThrow({ where: { id: a.id } })).homeCountry).toBe("");
    await submit("TH");
    expect((await db.account.findUniqueOrThrow({ where: { id: a.id } })).homeCountry).toBe("TH");
  });
  it("a made-up country changes nothing", async () => {
    const a = await db.account.create({ data: { email: `ch2-${stamp}@example.test`, name: "Bo", homeCountry: "IN" } });
    accountIds.push(a.id);
    who.account = { id: a.id, homeCountry: "IN" };
    await submit("ZZZ");
    expect((await db.account.findUniqueOrThrow({ where: { id: a.id } })).homeCountry).toBe("IN");
  });
});
