import { afterAll, describe, expect, it, vi } from "vitest";

// Batch C part 1: the audit fixes. Every account, email and group below is made fresh for its own test.
// Money is in paise. The numbers are worked out by hand in each test.
//
// The shared cast: Asha (A), Ravi (R), Meera (M), all joined (each can tap Confirm received).

const state = vi.hoisted(() => ({ cookie: "", pushes: [] as { ids: string[]; p: { title: string; body: string; url: string; tag: string } }[], tasks: [] as Promise<unknown>[] }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` }),
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
// `after` runs its job (and the test waits for it), so the pushes a request would send can be seen.
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: (job: () => Promise<unknown>) => void state.tasks.push(Promise.resolve().then(job)) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("@/lib/push", async (orig) => ({
  ...(await orig<typeof import("@/lib/push")>()),
  sendPushTo: async (ids: string[], p: { title: string; body: string; url: string; tag: string }) => {
    state.pushes.push({ ids, p });
    return 1;
  },
}));

process.env.MAIL_OUTBOX = "1";
const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const { eraseGroups } = await import("@/lib/purge");
const { netBalances } = await import("@/lib/balances");
const { loadGroup } = await import("@/lib/group-data");
const { createPayment } = await import("@/lib/payments");
const { confirmClaim, declineClaim, makeClaim, myDeclinedClaims, declinedNote } = await import("@/lib/payment-claims");
const { rejectPayment } = await import("@/lib/payment-ok");
const { markAllPaid, setPaymentsDeleted, settleAllAndClose, applySettleAll, planKey } = await import("@/lib/settle-all");
const { setPaymentDeleted } = await import("@/lib/save-expense");
const { undoEvent } = await import("@/lib/undo");
const { payLinkFor, readPayLink, recordLinkPayment } = await import("@/lib/pay-link");
const { addRegistered, inviteToClaim, searchPeople } = await import("@/lib/invites");
const { overpayHref } = await import("@/lib/money");
const { LEFT_ERROR } = await import("@/lib/active");
const A = await import("@/app/actions");
const P = await import("@/app/pay-actions");
const L = await import("@/app/pay-link-actions");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let counter = 0;
const groups: string[] = [];
const accounts: string[] = [];
afterAll(async () => {
  state.cookie = "";
  await eraseGroups(groups);
  await db.account.deleteMany({ where: { id: { in: accounts } } }).catch(() => undefined);
});

const sum = (n: Record<string, number>) => Object.values(n).reduce((x, y) => x + y, 0);
async function net(gid: string) {
  const members = await db.member.findMany({ where: { groupId: gid }, select: { id: true } });
  const [expenses, payments] = await Promise.all([
    db.expense.findMany({ where: { groupId: gid, deletedAt: null }, include: { shares: true } }),
    db.payment.findMany({ where: { groupId: gid, deletedAt: null } }),
  ]);
  return netBalances(members.map((x) => x.id), expenses, payments);
}
const payCount = (gid: string) => db.payment.count({ where: { groupId: gid, deletedAt: null } });

type Share = [string, number][];
async function addExpense(gid: string, paidById: string, amount: number, shares: Share, description = "Spend") {
  return db.expense.create({
    data: { groupId: gid, description, amount, splitType: "equal", paidById, createdById: paidById, originalAmount: amount, convertedAmount: amount, shares: { create: shares.map(([memberId, a]) => ({ memberId, amount: a })) } },
  });
}

// Asha, Ravi, Meera. `joined: false` leaves Asha as only a name (nobody to tap Confirm received).
async function world(o: { ashaJoined?: boolean; currency?: string } = {}) {
  const n = ++counter;
  const g = await db.group.create({
    data: {
      name: `C1 ${n} ${stamp}`,
      currency: o.currency ?? "INR",
      inviteCode: `c1-${n}-${stamp}`,
      members: { create: [{ name: "Asha", ...(o.ashaJoined === false ? {} : { claimedAt: new Date() }) }, { name: "Ravi", claimedAt: new Date() }, { name: "Meera", claimedAt: new Date() }] },
    },
    include: { members: true },
  });
  groups.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  return { gid: g.id, a: id("Asha"), r: id("Ravi"), m: id("Meera") };
}
type W = Awaited<ReturnType<typeof world>>;
const as = async (w: W, memberId: string) => {
  state.cookie = await encodeSession({ m: { [w.gid]: memberId }, t: today() });
};
async function redirectOf(fn: () => Promise<unknown>): Promise<URL> {
  try {
    await fn();
  } catch (err) {
    const m = /^NEXT_REDIRECT (.*)$/.exec(String((err as Error)?.message));
    if (!m) throw err;
    return new URL(m[1], "http://loopin.test");
  }
  throw new Error("expected a redirect");
}
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const claimOf = async (w: W, from: string, to: string) => {
  const c = await makeClaim({ groupId: w.gid, fromId: from, toId: to, actorId: from, source: "app" });
  if (!c.ok) throw new Error(c.error);
  return c;
};

// The auditor's story: Dinner ₹600 paid by Asha for Asha and Ravi (300 each); Cab ₹300 paid by Meera for Ravi.
//   Asha +60000 −30000 = +30000.  Ravi −30000 −30000 = −60000.  Meera +30000.  (sum 0)
//   Settle up: Ravi → Asha 30000 and Ravi → Meera 30000.
async function auditorWorld() {
  const w = await world();
  await addExpense(w.gid, w.a, 60000, [[w.a, 30000], [w.r, 30000]], "Dinner");
  await addExpense(w.gid, w.m, 30000, [[w.r, 30000]], "Cab");
  expect(await net(w.gid)).toEqual({ [w.a]: 30000, [w.r]: -60000, [w.m]: 30000 });
  return w;
}

describe("1: a payment that is brought back closes a waiting claim, so it never counts twice", () => {
  it("the auditor's story: Not received, Ravi claims, Asha undoes: the claim is covered and confirming records nothing", async () => {
    const w = await auditorWorld();
    // Meera marks Ravi → Asha ₹300 paid (old style: counts at once, Asha is asked).
    const first = await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.r, toId: w.a, amount: 30000, createdById: w.m, needsOk: true }));
    // Asha says Not received: it comes off. Back to A +30000, R −60000, M +30000.
    const rej = await rejectPayment(first.id, w.a);
    expect(rej.ok).toBe(true);
    expect(await net(w.gid)).toEqual({ [w.a]: 30000, [w.r]: -60000, [w.m]: 30000 });
    // Ravi says he paid ₹300 (a claim; no balance moves).
    const c = await claimOf(w, w.r, w.a);
    expect(c.amount).toBe(30000);
    expect(await net(w.gid)).toEqual({ [w.a]: 30000, [w.r]: -60000, [w.m]: 30000 });
    // Asha undoes "Not received": the payment counts again, and the waiting claim is closed as covered.
    expect((await undoEvent(rej.ok ? rej.eventId! : "", w.a)).ok).toBe(true);
    const row = await db.paymentClaim.findUniqueOrThrow({ where: { id: c.claimId } });
    expect([row.status, row.paymentId]).toEqual(["covered", first.id]);
    // After: Asha 30000−30000 = 0, Ravi −60000+30000 = −30000, Meera +30000.
    const after = await net(w.gid);
    expect(after).toEqual({ [w.a]: 0, [w.r]: -30000, [w.m]: 30000 });
    expect(sum(after)).toBe(0);
    // Confirming the covered claim records nothing more.
    const done = await confirmClaim(c.claimId, w.a);
    expect(done.ok).toBe(false);
    expect(await payCount(w.gid)).toBe(1);
    expect(await net(w.gid)).toEqual({ [w.a]: 0, [w.r]: -30000, [w.m]: 30000 });
  });

  it("restoring a deleted payment by hand (Restore) closes the waiting claim too", async () => {
    const w = await auditorWorld();
    const p = await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.r, toId: w.a, amount: 30000, createdById: w.m }));
    expect((await setPaymentDeleted(p.id, w.a, true)).ok).toBe(true);
    const c = await claimOf(w, w.r, w.a);
    expect((await setPaymentDeleted(p.id, w.a, false)).ok).toBe(true);
    expect((await db.paymentClaim.findUniqueOrThrow({ where: { id: c.claimId } })).status).toBe("covered");
    expect((await confirmClaim(c.claimId, w.a)).ok).toBe(false);
    expect(await payCount(w.gid)).toBe(1);
    expect(sum(await net(w.gid))).toBe(0);
  });

  it("redo of Mark all paid closes a claim made while it was undone", async () => {
    // Dinner ₹900 paid by Asha for all three: 30000 each. A +60000, R −30000, M −30000.
    const w = await world();
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    const marked = await markAllPaid(w.gid, w.a, [{ from: w.r, to: w.a, amount: 30000 }], "", true);
    expect(marked.ok).toBe(true);
    expect(await net(w.gid)).toEqual({ [w.a]: 30000, [w.r]: 0, [w.m]: -30000 });
    const ids = (await db.payment.findMany({ where: { groupId: w.gid }, select: { id: true } })).map((x) => x.id);
    expect((await setPaymentsDeleted(w.gid, w.a, ids, true)).ok).toBe(true);
    expect(await net(w.gid)).toEqual({ [w.a]: 60000, [w.r]: -30000, [w.m]: -30000 });
    const c = await claimOf(w, w.r, w.a);
    // Redo: the payment counts again: A +30000, R 0, M −30000, and the claim is covered.
    expect((await setPaymentsDeleted(w.gid, w.a, ids, false)).ok).toBe(true);
    expect((await db.paymentClaim.findUniqueOrThrow({ where: { id: c.claimId } })).status).toBe("covered");
    const after = await net(w.gid);
    expect(after).toEqual({ [w.a]: 30000, [w.r]: 0, [w.m]: -30000 });
    expect(sum(after)).toBe(0);
    expect((await confirmClaim(c.claimId, w.a)).ok).toBe(false);
    expect(await payCount(w.gid)).toBe(1);
  });

  it("redo of Settle everything closes a claim made after the undo", async () => {
    // Same dinner. Settle everything records R→A 30000 and M→A 30000: everyone 0.
    const w = await world();
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    const data = (await loadGroup(w.gid, { events: false }))!;
    const settled = await settleAllAndClose(w.gid, w.a, planKey(data.transfers));
    expect(settled.ok).toBe(true);
    const ids = (await db.payment.findMany({ where: { groupId: w.gid }, select: { id: true } })).map((x) => x.id);
    expect(ids).toHaveLength(2);
    expect(Object.values(await net(w.gid)).every((v) => v === 0)).toBe(true);
    // Undo: reopens, payments off. Ravi claims; then redo.
    expect((await applySettleAll(w.gid, w.a, ids, false)).ok).toBe(true);
    const c = await claimOf(w, w.r, w.a);
    expect((await applySettleAll(w.gid, w.a, ids, true)).ok).toBe(true);
    expect((await db.paymentClaim.findUniqueOrThrow({ where: { id: c.claimId } })).status).toBe("covered");
    expect(await net(w.gid)).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });
    expect(await payCount(w.gid)).toBe(2);
  });

  it("restoring twice changes nothing the second time", async () => {
    const w = await auditorWorld();
    const p = await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.r, toId: w.a, amount: 30000, createdById: w.m }));
    await setPaymentsDeleted(w.gid, w.a, [p.id], true);
    await setPaymentsDeleted(w.gid, w.a, [p.id], false);
    await setPaymentsDeleted(w.gid, w.a, [p.id], false);
    expect(await payCount(w.gid)).toBe(1);
    expect(await net(w.gid)).toEqual({ [w.a]: 0, [w.r]: -30000, [w.m]: 30000 });
  });

  it("confirm checks the claim against what the payer owes THAT person, not their total debt", async () => {
    // Start: A +30000, R −60000, M +30000. Ravi claims R → Asha ₹300 (waiting).
    const w = await auditorWorld();
    const c = await claimOf(w, w.r, w.a);
    // Then Ravi paid ₹200 for Asha's coffee (Asha's share 20000): Ravi +20000, Asha −20000.
    // Now A +10000, R −40000, M +30000. Ravi owes Asha 10000 and Meera 30000. His total debt (40000) is more than the claim (30000),
    // but he owes Asha only 10000, so the claim is 20000 too much.
    await addExpense(w.gid, w.r, 20000, [[w.a, 20000]], "Coffee");
    expect(await net(w.gid)).toEqual({ [w.a]: 10000, [w.r]: -40000, [w.m]: 30000 });
    const asked = await confirmClaim(c.claimId, w.a);
    expect(asked.ok).toBe(false);
    expect(!asked.ok && asked.over).toBe(20000); // 30000 − 10000
    expect(await payCount(w.gid)).toBe(0);
    // Confirming anyway records the ₹300 claimed.
    expect((await confirmClaim(c.claimId, w.a, { over: true })).ok).toBe(true);
    expect(sum(await net(w.gid))).toBe(0);
  });
});

describe("11: a link keeps tracking an older payment that is still waiting", () => {
  it("confirming a claim does not overwrite the link's waiting payment", async () => {
    // Dinner ₹900 by Asha: Ravi owes Asha 30000. An older payment R → A 10000 waits for Asha; the link tracks it.
    const w = await world();
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    const old = await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.r, toId: w.a, amount: 10000, createdById: w.m, needsOk: true }));
    const token = await payLinkFor(w.gid, w.r, w.a, w.a);
    await db.payLink.update({ where: { token }, data: { paymentId: old.id } });
    // Ravi now owes Asha 20000: he claims it and Asha confirms. The new payment is a second one.
    const c = await claimOf(w, w.r, w.a);
    expect(c.amount).toBe(20000);
    const done = await confirmClaim(c.claimId, w.a);
    expect(done.ok).toBe(true);
    expect((await db.payLink.findUniqueOrThrow({ where: { token } })).paymentId).toBe(old.id);
    // Ravi: −30000 + 10000 + 20000 = 0.
    expect((await net(w.gid))[w.r]).toBe(0);
  });

  it("once the older payment is confirmed (nothing waiting), the link follows the new payment", async () => {
    const w = await world();
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    const old = await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.r, toId: w.a, amount: 10000, createdById: w.r, okAt: new Date() }));
    const token = await payLinkFor(w.gid, w.r, w.a, w.a);
    await db.payLink.update({ where: { token }, data: { paymentId: old.id } });
    const c = await claimOf(w, w.r, w.a);
    const done = await confirmClaim(c.claimId, w.a);
    expect(done.ok).toBe(true);
    expect((await db.payLink.findUniqueOrThrow({ where: { token } })).paymentId).toBe(done.ok ? done.paymentId : "x");
  });
});

describe("2 and 3: adding from search and the history line never use the start of an email", () => {
  async function account(label: string, name: string) {
    const n = ++counter;
    const a = await db.account.create({ data: { email: `c1-${label}-${n}-${stamp}@example.test`, name } });
    accounts.push(a.id);
    return a;
  }

  it("a nameless account added from search gets the name the search showed (their name in the shared group)", async () => {
    const me = await account("me", "Chandler");
    const nameless = await account("secretlocal", "");
    // An older group we share: she is "Tinku" there.
    const old = await db.group.create({
      data: { name: `Old ${stamp}-${counter}`, currency: "INR", inviteCode: `c1-old-${counter}-${stamp}`, members: { create: [{ name: "Chandler", accountId: me.id, claimedAt: new Date() }, { name: "Tinku", accountId: nameless.id, claimedAt: new Date() }] } },
      include: { members: true },
    });
    const fresh = await db.group.create({
      data: { name: `Fresh ${stamp}-${counter}`, currency: "INR", inviteCode: `c1-fresh-${counter}-${stamp}`, members: { create: [{ name: "Chandler", accountId: me.id, claimedAt: new Date() }] } },
      include: { members: true },
    });
    groups.push(old.id, fresh.id);
    const meOld = old.members.find((m) => m.name === "Chandler")!.id;
    const meFresh = fresh.members[0].id;
    const found = await searchPeople({ [old.id]: meOld, [fresh.id]: meFresh }, fresh.id, "tink");
    expect(found.map((f) => f.name)).toEqual(["Tinku"]);
    const added = await addRegistered(fresh.id, meFresh, nameless.id, "https://loopin.test");
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.name).toBe("Tinku"); // never "C1-secretlocal-…" from the email
    const row = await db.member.findUniqueOrThrow({ where: { id: added.memberId } });
    expect(row.name).toBe("Tinku");
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: fresh.id, kind: "members_added" } });
    expect(ev.text).toBe("added Tinku to the group");
  });

  it("an account with its own name keeps it", async () => {
    const me = await account("me2", "Chandler");
    const joey = await account("joeymail", "Joey");
    const g = await db.group.create({
      data: { name: `Named ${stamp}-${counter}`, currency: "INR", inviteCode: `c1-named-${counter}-${stamp}`, members: { create: [{ name: "Chandler", accountId: me.id, claimedAt: new Date() }] } },
      include: { members: true },
    });
    groups.push(g.id);
    const added = await addRegistered(g.id, g.members[0].id, joey.id, "https://loopin.test");
    expect(added.ok && added.name).toBe("Joey");
  });

  it("the history line for 'invite by email' for a name-only person shows no email address", async () => {
    const w = await world();
    const named = await db.member.create({ data: { groupId: w.gid, name: "Zoya" } });
    const email = `c1-zoya-${++counter}-${stamp}@example.test`;
    const r = await inviteToClaim(w.gid, w.a, named.id, email, "https://loopin.test");
    expect(r.ok).toBe(true);
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: w.gid, kind: "member_invited" } });
    expect(ev.text).toBe("invited Zoya to join");
    expect(ev.text).not.toContain("@");
    expect(ev.text).not.toContain(email);
  });
});

describe("4: the pay link records a payment when the person owed can't confirm", () => {
  it("name-only Asha: makeClaim says direct, and the link records the payment once (counts now)", async () => {
    // Dinner ₹900 paid by Asha: A +60000, R −30000, M −30000. Asha has not joined.
    const w = await world({ ashaJoined: false });
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    const claim = await makeClaim({ groupId: w.gid, fromId: w.r, toId: w.a, actorId: w.r, source: "link" });
    expect(claim.ok).toBe(false);
    expect(!claim.ok && claim.direct).toBe(true);
    const token = await payLinkFor(w.gid, w.r, w.a, w.a);
    const s = await readPayLink(token);
    expect(s.kind).toBe("owes");
    if (s.kind !== "owes") return;
    // The action itself.
    const url = await redirectOf(() => L.iPaidAction(form({ token })));
    expect(url.pathname).toBe(`/p/${token}`);
    expect(url.searchParams.get("paid")).toBe("1");
    const p = await db.payment.findFirstOrThrow({ where: { groupId: w.gid } });
    expect([p.fromId, p.toId, p.amount, p.createdById, p.needsOk]).toEqual([w.r, w.a, 30000, w.r, false]); // Asha can't answer yet, so nobody is asked
    expect(await net(w.gid)).toEqual({ [w.a]: 30000, [w.r]: 0, [w.m]: -30000 });
    expect((await db.payLink.findUniqueOrThrow({ where: { token } })).paymentId).toBe(p.id);
    expect(await db.paymentClaim.count({ where: { groupId: w.gid } })).toBe(0);
    // The history has the line and an Undo.
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: w.gid, paymentId: p.id } });
    expect(ev.text).toBe("paid Asha ₹300 (from the reminder link)");
    expect(JSON.parse(ev.undo)).toEqual({ type: "payment_delete", paymentId: p.id });
    // A second tap with the old read records nothing more.
    expect(await recordLinkPayment({ link: s.link, amount: s.amount, currency: "INR", toName: "Asha" })).toBe(false);
    expect(await payCount(w.gid)).toBe(1);
  });

  it("a joined Asha still gets a claim, not a payment", async () => {
    const w = await world();
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    const token = await payLinkFor(w.gid, w.r, w.a, w.a);
    await redirectOf(() => L.iPaidAction(form({ token })));
    expect(await payCount(w.gid)).toBe(0);
    expect(await db.paymentClaim.count({ where: { groupId: w.gid, status: "waiting" } })).toBe(1);
  });
});

describe("5: a waiting claim is shown in its own currency", () => {
  it("INR claim, group later changed to USD: the link still says INR 30000", async () => {
    const w = await world();
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    const token = await payLinkFor(w.gid, w.r, w.a, w.a);
    await claimOf(w, w.r, w.a);
    await db.group.update({ where: { id: w.gid }, data: { currency: "USD" } });
    const s = await readPayLink(token);
    expect(s.kind).toBe("said");
    if (s.kind === "gone") return;
    expect(s.amount).toBe(30000);
    expect(s.currency).toBe("INR");
    expect(s.group.currency).toBe("USD");
  });

  it("otherwise the link uses the group's currency", async () => {
    const w = await world({ currency: "USD" });
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    const s = await readPayLink(await payLinkFor(w.gid, w.r, w.a, w.a));
    expect(s.kind === "owes" && s.currency).toBe("USD");
  });
});

describe("9: Not received tells the payer", () => {
  it("a push goes to Ravi, and his Settle up row can show the note until he tries again", async () => {
    const w = await world();
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    const c = await claimOf(w, w.r, w.a);
    state.pushes.length = 0;
    expect((await declineClaim(c.claimId, w.a)).ok).toBe(true);
    await Promise.all(state.tasks.splice(0));
    const toRavi = state.pushes.filter((x) => x.ids.includes(w.r));
    expect(toRavi).toHaveLength(1);
    expect(toRavi[0].p.body).toBe("Asha hasn’t received your ₹300 yet. Check your payment app.");
    expect(toRavi[0].p.url).toBe(`/groups/${w.gid}/settle`);
    expect(declinedNote("Asha", 30000, "INR")).toBe("Asha hasn’t received your ₹300 yet. Check your payment app.");
    // Nobody else is pushed.
    expect(state.pushes.filter((x) => x.ids.includes(w.a) || x.ids.includes(w.m))).toHaveLength(0);
    // The row note: Ravi's latest answer for Asha is "not received".
    expect((await myDeclinedClaims(w.gid, w.r)).map((x) => [x.toId, x.amount])).toEqual([[w.a, 30000]]);
    expect(await myDeclinedClaims(w.gid, w.m)).toEqual([]);
    // Balances didn't move.
    expect(await net(w.gid)).toEqual({ [w.a]: 60000, [w.r]: -30000, [w.m]: -30000 });
    // He says he paid again: the note goes away.
    await claimOf(w, w.r, w.a);
    expect(await myDeclinedClaims(w.gid, w.r)).toEqual([]);
  });
});

describe("10: the 'more than what's owed' page keeps back=settle", () => {
  it("overpayHref adds back=settle only from Settle up", () => {
    const q = { from: "r1", to: "a1", amount: "700", owes: "600" };
    expect(overpayHref("g1", q, true)).toBe("/groups/g1/pay?from=r1&to=a1&amount=700&owes=600&back=settle");
    expect(overpayHref("g1", q, false)).toBe("/groups/g1/pay?from=r1&to=a1&amount=700&owes=600");
  });

  it("Record a payment from Settle up for too much redirects with back=settle", async () => {
    // Ravi owes 60000 in all (auditor's story). He enters ₹700 from Settle up.
    const w = await auditorWorld();
    await as(w, w.r);
    const url = await redirectOf(() => A.recordCustomPayment(form({ groupId: w.gid, fromId: w.r, toId: w.a, amount: "700", back: "settle" })));
    expect(url.pathname).toBe(`/groups/${w.gid}/pay`);
    expect(url.searchParams.get("back")).toBe("settle");
    expect(url.searchParams.get("owes")).toBe("60000");
    expect(await payCount(w.gid)).toBe(0);
    // From the plain Record a payment page there is no back.
    const plain = await redirectOf(() => A.recordCustomPayment(form({ groupId: w.gid, fromId: w.r, toId: w.a, amount: "700" })));
    expect(plain.searchParams.get("back")).toBeNull();
  });
});

describe("8: a leaver can answer a claim but is not offered an Undo they can't use", () => {
  it("Asha leaves, confirms Ravi's claim; undoing it as her is refused", async () => {
    const w = await world();
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    const c = await claimOf(w, w.r, w.a);
    await db.member.update({ where: { id: w.a }, data: { leftAt: new Date() } });
    const done = await confirmClaim(c.claimId, w.a);
    expect(done.ok).toBe(true);
    const undone = await undoEvent(done.ok ? done.eventId! : "", w.a);
    expect(undone.ok).toBe(false);
    expect(await payCount(w.gid)).toBe(1);
  });

  it("the Settle up page shows the Undo bar only to people still in the group", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(`${__dirname}/../src/app/groups/[id]/settle/page.tsx`, "utf8");
    expect(src).toMatch(/const showUndo = justDid && !group\.members\.find\(\(m\) => m\.id === myId\)\?\.leftAt && canUndo/);
  });
});

describe("action guards: who can call claimPaidAction and confirmClaimAction", () => {
  async function setup() {
    const w = await world();
    await addExpense(w.gid, w.a, 90000, [[w.a, 30000], [w.r, 30000], [w.m, 30000]], "Dinner");
    return w;
  }
  const errorOf = (u: URL) => u.searchParams.get("error");

  it("claimPaidAction: only the payer, only while in the group, never for an outsider", async () => {
    const w = await setup();
    const f = () => form({ groupId: w.gid, fromId: w.r, toId: w.a, amount: "30000" });
    // Meera cannot say Ravi paid.
    await as(w, w.m);
    expect(errorOf(await redirectOf(() => P.claimPaidAction(f())))).toMatch(/Only the person paying/);
    // A person who is not in the group at all (a cookie for nobody) is sent away.
    state.cookie = await encodeSession({ m: {}, t: today() });
    expect((await redirectOf(() => P.claimPaidAction(f()))).pathname).toBe("/private");
    expect(await db.paymentClaim.count({ where: { groupId: w.gid } })).toBe(0);
    // Ravi, after leaving, cannot either.
    await as(w, w.r);
    await db.member.update({ where: { id: w.r }, data: { leftAt: new Date() } });
    expect(errorOf(await redirectOf(() => P.claimPaidAction(f())))).toBe(LEFT_ERROR);
    expect(await db.paymentClaim.count({ where: { groupId: w.gid } })).toBe(0);
    await db.member.update({ where: { id: w.r }, data: { leftAt: null } });
    // Ravi can; a wrong amount is refused; the right one makes one claim, and nothing counts yet.
    expect(errorOf(await redirectOf(() => P.claimPaidAction(form({ groupId: w.gid, fromId: w.r, toId: w.a, amount: "29999" }))))).toMatch(/Balances changed/);
    const ok = await redirectOf(() => P.claimPaidAction(f()));
    expect(ok.searchParams.get("claimed")).toBe("1");
    expect(await db.paymentClaim.count({ where: { groupId: w.gid, status: "waiting" } })).toBe(1);
    expect(await net(w.gid)).toEqual({ [w.a]: 60000, [w.r]: -30000, [w.m]: -30000 });
  });

  it("confirmClaimAction: only the person paid; the payer and others are refused and nothing is recorded", async () => {
    const w = await setup();
    const c = await claimOf(w, w.r, w.a);
    const f = () => form({ claimId: c.claimId });
    for (const who of [w.r, w.m]) {
      await as(w, who);
      expect(errorOf(await redirectOf(() => P.confirmClaimAction(f())))).toBe("Only the person who was paid can confirm it.");
    }
    state.cookie = await encodeSession({ m: {}, t: today() });
    expect(errorOf(await redirectOf(() => P.confirmClaimAction(f())))).toBe("Only the person who was paid can confirm it.");
    expect(await payCount(w.gid)).toBe(0);
    // Asha can: A +30000, R 0, M −30000.
    await as(w, w.a);
    expect((await redirectOf(() => P.confirmClaimAction(f()))).searchParams.get("ok")).toBe("1");
    expect(await net(w.gid)).toEqual({ [w.a]: 30000, [w.r]: 0, [w.m]: -30000 });
    expect(await payCount(w.gid)).toBe(1);
  });
});
