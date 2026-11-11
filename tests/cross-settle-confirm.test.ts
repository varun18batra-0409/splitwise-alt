import { afterAll, describe, expect, it, vi } from "vitest";

// "Mark as paid" across groups records every group's part together, or nothing. The screen shows each
// group's part first (crossPreview); if any part changed before the person taps "Record in 2 groups"
// (someone paid or added something in between), nothing at all is recorded and they're told it changed.
//
// By hand: Goa (trip): Asha paid the ₹2,000 hotel for two, so I owe Asha ₹1,000.
//          Flat: I paid ₹800 groceries for two, so Asha owes me ₹400.   Together: I pay Asha ₹600.

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  RedirectType: { replace: "replace", push: "push" },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const { loadMyGroups, loadGroup } = await import("@/lib/group-data");
const { crossSettle, crossPreview } = await import("@/lib/cross-settle");
const { eraseGroups } = await import("@/lib/purge");
const A = await import("@/app/actions");

const ids: string[] = [];
afterAll(async () => {
  state.cookie = "";
  await eraseGroups(ids);
});

async function makeGroup(name: string) {
  const g = await db.group.create({
    data: { name, currency: "INR", inviteCode: `xc-${name}-${Date.now()}-${Math.random()}`, members: { create: [{ name: "Varun", claimedAt: new Date() }, { name: "Asha", phone: "+91 98765 43210" }] } },
    include: { members: true },
  });
  ids.push(g.id);
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  return { id: g.id, me: id("Varun"), asha: id("Asha") };
}
const expense = (groupId: string, paidById: string, amount: number, a: string, b: string) =>
  db.expense.create({
    data: { groupId, description: "x", amount, splitType: "equal", paidById, createdById: paidById, originalAmount: amount, convertedAmount: amount, shares: { create: [{ memberId: a, amount: amount / 2 }, { memberId: b, amount: amount / 2 }] } },
  });
async function setup() {
  const goa = await makeGroup("Goa");
  const flat = await makeGroup("Flat");
  await expense(goa.id, goa.asha, 200000, goa.me, goa.asha);
  await expense(flat.id, flat.me, 80000, flat.me, flat.asha);
  state.cookie = await encodeSession({ m: { [goa.id]: goa.me, [flat.id]: flat.me }, t: today() });
  const mine = await loadMyGroups({ [goa.id]: goa.me, [flat.id]: flat.me });
  const { items } = crossSettle(mine.map((g) => ({ groupId: g.group.id, groupName: g.group.name, currency: g.group.currency, myId: g.myId, members: g.group.members, transfers: g.transfers })), "INR", () => null);
  return { goa, flat, item: items[0] };
}
const form = (parts: unknown) => {
  const f = new FormData();
  f.set("parts", JSON.stringify(parts));
  return f;
};
async function attempt(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    const m = String((err as Error)?.message);
    if (/^NEXT_REDIRECT/.test(m)) return m.replace("NEXT_REDIRECT ", "");
    throw err;
  }
  return "";
}
const count = (gid: string) => db.payment.count({ where: { groupId: gid, deletedAt: null } });
const parts = (item: { parts: { groupId: string; fromId: string; toId: string; amount: number }[] }) => item.parts.map((p) => ({ groupId: p.groupId, fromId: p.fromId, toId: p.toId, amount: p.amount }));

describe("Mark as paid across groups", () => {
  it("the preview names each group's part; recording it leaves both groups at 0 and my net in each at 0", async () => {
    const { goa, flat, item } = await setup();
    expect(crossPreview(item, "INR").text).toBe("Goa: you pay Asha ₹1,000 · Flat: Asha pays you ₹400 · Together: you pay Asha ₹600.");
    expect(crossPreview(item, "INR").button).toBe("Record in 2 groups");
    expect(await attempt(() => A.settleAcrossGroups(form(parts(item))))).toBe("/settle?settle=done");
    for (const g of [goa, flat]) {
      const d = (await loadGroup(g.id))!;
      expect(Object.values(d.net).every((v) => v === 0)).toBe(true);
      expect(d.transfers).toEqual([]);
      expect(await count(g.id)).toBe(1);
    }
  });

  it("a part that changed between the preview and the tap: 'changed', and nothing is recorded in either group", async () => {
    const { goa, flat, item } = await setup();
    // Meanwhile Asha pays ₹100 in the Flat: Asha now owes me ₹300, not ₹400.
    await db.payment.create({ data: { groupId: flat.id, fromId: flat.asha, toId: flat.me, amount: 10000, createdById: flat.asha } });
    expect(await attempt(() => A.settleAcrossGroups(form(parts(item))))).toBe("/settle?settle=changed");
    expect(await count(goa.id)).toBe(0); // the Goa part was fine, but it is all or nothing
    expect(await count(flat.id)).toBe(1); // only the payment made meanwhile
  });

  it("the same part sent twice in one tap is recorded once", async () => {
    const { goa, item } = await setup();
    const p = parts(item);
    expect(await attempt(() => A.settleAcrossGroups(form([...p, p[0]])))).toBe("/settle?settle=done");
    expect(await count(goa.id)).toBe(1);
  });
});
