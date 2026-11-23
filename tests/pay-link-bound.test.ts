import { afterAll, describe, expect, it, vi } from "vitest";

// Batch 1 of the outside-review fixes: the "I've paid" link is bound to the amount and currency the page showed (G01/L02),
// and "Take it back" removes only the payment that page showed (G10). Money is in paise, worked out by hand in each test.
//
// The cast: Asha (A) and Ravi (R), an INR group.

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
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
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (job: () => Promise<unknown>) => void Promise.resolve().then(job).catch(() => undefined) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

process.env.MAIL_OUTBOX = "1";
const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { payLinkFor, readPayLink } = await import("@/lib/pay-link");
const { checkBooks } = await import("./helpers/money-invariants");
const L = await import("@/app/pay-link-actions");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let counter = 0;
const groups: string[] = [];
afterAll(async () => {
  await eraseGroups(groups);
});

async function world() {
  const n = ++counter;
  const g = await db.group.create({
    data: { name: `PLB ${n} ${stamp}`, currency: "INR", inviteCode: `plb-${n}-${stamp}`, members: { create: [{ name: "Asha", claimedAt: new Date() }, { name: "Ravi", claimedAt: new Date() }] } },
    include: { members: true },
  });
  groups.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  return { gid: g.id, a: id("Asha"), r: id("Ravi") };
}
// An expense paid by `paidById`, with the shares given. The shares must add up to the amount.
async function spend(gid: string, paidById: string, amount: number, shares: [string, number][], description: string) {
  expect(shares.reduce((s, x) => s + x[1], 0)).toBe(amount);
  return db.expense.create({
    data: { groupId: gid, description, amount, splitType: "exact", paidById, createdById: paidById, originalAmount: amount, convertedAmount: amount, shares: { create: shares.map(([memberId, a]) => ({ memberId, amount: a })) } },
  });
}
const livePayments = (gid: string) => db.payment.findMany({ where: { groupId: gid, deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
// Run an action and return where it redirected to.
async function run(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    const m = /^NEXT_REDIRECT (.*)$/.exec(String((err as Error)?.message));
    if (!m) throw err;
    return m[1];
  }
  throw new Error("expected a redirect");
}

describe("G01/L02: 'I've paid' records only the amount and currency the page showed", () => {
  // Dinner 90,000 paid by Asha, Asha 45,000 + Ravi 45,000 = 90,000. Ravi owes 45,000.
  async function dinner() {
    const w = await world();
    await spend(w.gid, w.a, 90000, [[w.a, 45000], [w.r, 45000]], "Dinner");
    const token = await payLinkFor(w.gid, w.r, w.a, w.a);
    const shown = await readPayLink(token);
    expect(shown).toMatchObject({ kind: "owes", amount: 45000, currency: "INR" });
    return { ...w, token };
  }
  // Taxi 40,000 paid by Asha, 20,000 + 20,000 = 40,000. Ravi now owes 45,000 + 20,000 = 65,000.
  const taxi = (w: { gid: string; a: string; r: string }) => spend(w.gid, w.a, 40000, [[w.a, 20000], [w.r, 20000]], "Taxi");

  it("an amount that changed since the page was drawn is refused, and nothing is recorded", async () => {
    const w = await dinner();
    await taxi(w);
    await run(() => L.iPaidAction(form({ token: w.token, amount: "45000", currency: "INR" })));
    expect(await livePayments(w.gid)).toHaveLength(0);
    expect(await db.payLink.findUniqueOrThrow({ where: { token: w.token } })).toMatchObject({ paymentId: "" });
    // Asha +45,000 +20,000 = +65,000 (she paid 90,000 and 40,000, owes 45,000 and 20,000); Ravi -65,000.
    expect(await checkBooks(w.gid)).toEqual({ [w.a]: 65000, [w.r]: -65000 });
  });

  it("the new amount records exactly that, and everyone is at 0", async () => {
    const w = await dinner();
    await taxi(w);
    expect(await run(() => L.iPaidAction(form({ token: w.token, amount: "65000", currency: "INR" })))).toContain(`/p/${w.token}`);
    const pays = await livePayments(w.gid);
    expect(pays.map((p) => [p.fromId, p.toId, p.amount])).toEqual([[w.r, w.a, 65000]]);
    expect(await checkBooks(w.gid)).toEqual({ [w.a]: 0, [w.r]: 0 });
  });

  it("a part-payment recorded since makes the shown amount wrong: refused", async () => {
    const w = await dinner();
    // Ravi pays 5,000 by hand: he now owes 40,000, not the 45,000 the page showed.
    await db.payment.create({ data: { groupId: w.gid, fromId: w.r, toId: w.a, amount: 5000, createdById: w.r } });
    await run(() => L.iPaidAction(form({ token: w.token, amount: "45000", currency: "INR" })));
    expect(await livePayments(w.gid)).toHaveLength(1); // only the hand-recorded one
    // Asha +45,000 - 5,000 = +40,000; Ravi -40,000.
    expect(await checkBooks(w.gid)).toEqual({ [w.a]: 40000, [w.r]: -40000 });
  });

  it("a form drawn in INR is refused after the group switched to USD", async () => {
    const w = await dinner();
    await db.group.update({ where: { id: w.gid }, data: { currency: "USD" } });
    await run(() => L.iPaidAction(form({ token: w.token, amount: "45000", currency: "INR" })));
    expect(await livePayments(w.gid)).toHaveLength(0);
    await checkBooks(w.gid);
  });

  it("a form without the amount or currency (a page opened before this) is refused once", async () => {
    const w = await dinner();
    await run(() => L.iPaidAction(form({ token: w.token })));
    await run(() => L.iPaidAction(form({ token: w.token, amount: "45000" })));
    await run(() => L.iPaidAction(form({ token: w.token, amount: "45,000", currency: "INR" })));
    await run(() => L.iPaidAction(form({ token: w.token, amount: "45000", currency: "inr" })));
    expect(await livePayments(w.gid)).toHaveLength(0);
  });

  it("the same form posted twice gives exactly one payment", async () => {
    const w = await dinner();
    const f = () => form({ token: w.token, amount: "45000", currency: "INR" });
    await run(() => L.iPaidAction(f()));
    await run(() => L.iPaidAction(f()));
    expect(await livePayments(w.gid)).toHaveLength(1);
    expect(await checkBooks(w.gid)).toEqual({ [w.a]: 0, [w.r]: 0 });
  });
});

describe("G10: 'Take it back' removes only the payment its page showed", () => {
  it("an old Done page cannot remove a newer payment; the current page can remove its own", async () => {
    const w = await world();
    // Dinner 90,000, Ravi owes 45,000 and pays it through the link (P1).
    await spend(w.gid, w.a, 90000, [[w.a, 45000], [w.r, 45000]], "Dinner");
    const token = await payLinkFor(w.gid, w.r, w.a, w.a);
    await run(() => L.iPaidAction(form({ token, amount: "45000", currency: "INR" })));
    const p1 = (await db.payLink.findUniqueOrThrow({ where: { token } })).paymentId;
    expect(p1).not.toBe("");
    // A new debt of 20,000 (Asha pays 40,000, 20,000 each), and Ravi pays that through the link too (P2).
    await spend(w.gid, w.a, 40000, [[w.a, 20000], [w.r, 20000]], "Taxi");
    await run(() => L.iPaidAction(form({ token, amount: "20000", currency: "INR" })));
    const p2 = (await db.payLink.findUniqueOrThrow({ where: { token } })).paymentId;
    expect(p2).not.toBe(p1);
    expect(await livePayments(w.gid)).toHaveLength(2);
    // The old page (P1) is refused: P2 still counts and Ravi is at 0.
    await run(() => L.undoIPaidAction(form({ token, paymentId: p1 })));
    expect((await livePayments(w.gid)).map((p) => p.amount)).toEqual([45000, 20000]);
    expect(await checkBooks(w.gid)).toEqual({ [w.a]: 0, [w.r]: 0 });
    // A form with no paymentId (opened before this release) is refused too.
    await run(() => L.undoIPaidAction(form({ token })));
    expect(await livePayments(w.gid)).toHaveLength(2);
    // The current page (P2) takes back P2 only: the link forgets it, and Ravi owes 20,000 again.
    await run(() => L.undoIPaidAction(form({ token, paymentId: p2 })));
    expect((await livePayments(w.gid)).map((p) => p.amount)).toEqual([45000]);
    expect((await db.payLink.findUniqueOrThrow({ where: { token } })).paymentId).toBe("");
    // Ravi's 45,000 still counts; the taxi's 20,000 is owed again: Asha +20,000, Ravi -20,000.
    expect(await checkBooks(w.gid)).toEqual({ [w.a]: 20000, [w.r]: -20000 });
    expect(await readPayLink(token)).toMatchObject({ kind: "owes", amount: 20000 });
  });
});
