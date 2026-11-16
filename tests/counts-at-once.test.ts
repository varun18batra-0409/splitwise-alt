import { afterAll, describe, expect, it, vi } from "vitest";

// Batch C: every payment counts the moment it is recorded. Nobody waits for anyone, and only the payer and the person paid can delete it
// (whoever recorded it for others can Undo it for 10 minutes). Throwaway database; amounts in paise, every number worked by hand.
//
// Fixture G (a trip): Meera (looks after it), Asha, Ravi, all joined. Dinner 120000 paid by Ravi, 40000 each.
//   Start:                       Ravi +80000, Asha -40000, Meera -40000   (sum 0)
//   After Asha pays Ravi 40000:  Ravi +40000, Asha 0,      Meera -40000   (this is "G1")
//
// After every step: each group's balances add up to 0, every expense's shares add up to its amount, and everyone who has left is at exactly 0.

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
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
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { netBalances } = await import("@/lib/balances");
const { recordPaymentCore } = await import("@/lib/pay-record");
const { setPaymentDeleted } = await import("@/lib/save-expense");
const { markAllPaid, settleAllAndClose, planKey } = await import("@/lib/settle-all");
const { setMemberLeft } = await import("@/lib/people");
const { undoEvent } = await import("@/lib/undo");
const { partiesToTell } = await import("@/lib/payment-claims");
const { receiverOnlyText } = await import("@/lib/refused-payment");
const { waitingForMe, confirmPayment, rejectPayment } = await import("@/lib/payment-ok");
const { loadNeedsYou } = await import("@/lib/needs-you");
const { buildActivity } = await import("@/lib/activity");
const { payLinkFor, readPayLink } = await import("@/lib/pay-link");
const { moveOut } = await import("@/lib/home/moving-db");
const { ensureLocalPair } = await import("@/lib/direct-db");
const { parseUndo } = await import("@/lib/events");
const { markAsMoveOut } = await import("./helpers/move-out-marks");
const L = await import("@/app/pay-link-actions");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;
const key = () => `cao-${stamp}-${++n}-abcdefgh`;
const NOW = new Date("2026-11-10T06:00:00Z");

afterAll(async () => {
  state.cookie = "";
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `cao-${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}

// The fixture. `kind` "trip" or "home". People are created in the order given, so the first looks after the group.
async function world(kind: "trip" | "home" = "trip", names: string[] = ["Meera", "Asha", "Ravi"]) {
  const accounts = await Promise.all(names.map((nm) => account(nm)));
  const g = await db.group.create({
    data: {
      name: `Cao ${kind} ${++n} ${stamp}`, type: kind, currency: "INR", inviteCode: `cao-${n}-${stamp}`,
      members: { create: names.map((nm, i) => ({ name: nm, splitWeight: 100, createdAt: new Date(2026, 0, i + 1), accountId: accounts[i].id, claimedAt: new Date(2026, 0, i + 1) })) },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  const expense = (description: string, amount: number, paidById: string, shares: [string, number][]) =>
    db.expense.create({
      data: {
        groupId: g.id, description, category: "other", amount, paidById, createdById: paidById, splitType: "exact", forMode: "selected",
        originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount, spentAt: new Date("2026-11-01T12:00:00Z"),
        shares: { create: shares.map(([memberId, a]) => ({ memberId, amount: a })) },
      },
    });
  const net = async () => {
    const x = await db.group.findUniqueOrThrow({ where: { id: g.id }, include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } } });
    return netBalances(x.members.map((m) => m.id), x.expenses, x.payments);
  };
  const payments = () => db.payment.findMany({ where: { groupId: g.id, deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const row = (memberId: string) => db.member.findUniqueOrThrow({ where: { id: memberId } });
  const events = (kind: string) => db.groupEvent.findMany({ where: { groupId: g.id, kind }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const check = async () => {
    for (const e of await db.expense.findMany({ where: { groupId: g.id }, include: { shares: true } })) {
      expect(e.shares.reduce((s, x) => s + x.amount, 0), `shares of ${e.description}`).toBe(e.amount);
    }
    const nets = await net();
    expect(Object.values(nets).reduce((a, b) => a + b, 0)).toBe(0);
    const gone = await db.member.findMany({ where: { groupId: g.id, OR: [{ leftAt: { not: null } }, { removedAt: { not: null } }] } });
    for (const m of gone) expect(nets[m.id] ?? 0, `${m.name} has left, so should be at 0`).toBe(0);
  };
  return { gid: g.id, id, expense, net, payments, row, events, check };
}
type World = Awaited<ReturnType<typeof world>>;

// Fixture G with its three people and the dinner.
async function fixtureG() {
  const w = await world();
  const [M, A, R] = [w.id("Meera"), w.id("Asha"), w.id("Ravi")];
  await w.expense("Dinner", 120000, R, [[M, 40000], [A, 40000], [R, 40000]]);
  expect(await w.net()).toEqual({ [M]: -40000, [A]: -40000, [R]: 80000 });
  return { w, M, A, R };
}

// Record a payment by hand (the Record a payment form). Returns the payment and its history line.
async function record(w: World, from: string, to: string, amount: number, by = from) {
  const r = await recordPaymentCore({ groupId: w.gid, fromId: from, toId: to, amount, currency: "INR", myId: by, key: key(), fp: `fp-${key()}`, warnOver: false });
  if (r.kind !== "done") throw new Error(`not recorded: ${JSON.stringify(r)}`);
  const pay = await db.payment.findFirstOrThrow({ where: { groupId: w.gid, fromId: from, toId: to, amount, deletedAt: null }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const ev = await db.groupEvent.findFirstOrThrow({ where: { id: r.did } });
  return { pay, ev };
}
// G1: Asha pays Ravi 40000.
async function g1() {
  const f = await fixtureG();
  const made = await record(f.w, f.A, f.R, 40000);
  expect(await f.w.net()).toEqual({ [f.M]: -40000, [f.A]: 0, [f.R]: 40000 });
  return { ...f, ...made };
}
const startNet = (f: { M: string; A: string; R: string }) => ({ [f.M]: -40000, [f.A]: -40000, [f.R]: 80000 });
const g1Net = (f: { M: string; A: string; R: string }) => ({ [f.M]: -40000, [f.A]: 0, [f.R]: 40000 });
const leave = (w: World, member: string) => setMemberLeft(w.gid, member, member, true);
const ageEvent = (eventId: string, minutes: number) => db.groupEvent.update({ where: { id: eventId }, data: { createdAt: new Date(Date.now() - minutes * 60_000) } });
const eventOf = (paymentId: string, kind: string) => db.groupEvent.findFirstOrThrow({ where: { paymentId, kind }, orderBy: { createdAt: "desc" } });

describe("G1-G5: a recorded payment counts at once, and only its two people can change it", () => {
  it("G1. Asha records paying Ravi 40000: one payment that asks nobody, no note, Ravi +40000, Asha 0, Meera -40000; nothing waits for Ravi", async () => {
    const { w, M, A, R, pay } = await g1();
    expect([pay.fromId, pay.toId, pay.amount, pay.needsOk, pay.okAt]).toEqual([A, R, 40000, false, null]);
    expect(await w.payments()).toHaveLength(1);
    expect(await db.paymentClaim.count({ where: { groupId: w.gid } })).toBe(0);
    expect(await w.net()).toEqual({ [M]: -40000, [A]: 0, [R]: 40000 });
    expect(await waitingForMe(w.gid, R)).toEqual([]);
    expect((await loadNeedsYou({ [w.gid]: R }, null, 0, NOW)).items).toEqual([]);
    expect(partiesToTell(A, A, R)).toEqual([R]); // Asha did it, so Ravi is told (not Asha)
    await w.check();
  });

  it("G2. Meera (who looks after the group) deletes it: refused with the plain words, nothing changes", async () => {
    const { w, M, A, R, pay } = await g1();
    expect(await setPaymentDeleted(pay.id, M, true)).toEqual({ ok: false, error: "Only Asha or Ravi can change this payment." });
    expect(await w.net()).toEqual(g1Net({ M, A, R }));
    expect(await w.payments()).toHaveLength(1);
    await w.check();
  });

  it("G3. Ravi deletes it: back to the start, deletedBy Ravi", async () => {
    const { w, M, A, R, pay } = await g1();
    expect((await setPaymentDeleted(pay.id, R, true)).ok).toBe(true);
    expect(await w.net()).toEqual(startNet({ M, A, R }));
    expect((await db.payment.findUniqueOrThrow({ where: { id: pay.id } })).deletedById).toBe(R);
    await w.check();
  });

  it("G4. after Ravi deletes: Asha's Undo and Meera's Restore are refused, Ravi's Undo brings it back (balances as G1)", async () => {
    const { w, M, A, R, pay } = await g1();
    expect((await setPaymentDeleted(pay.id, R, true)).ok).toBe(true);
    const deletedEv = await eventOf(pay.id, "payment_deleted");
    expect((await undoEvent(deletedEv.id, A)).ok).toBe(false); // only Ravi can bring it back
    // Ravi took it off, so only Ravi can bring it back: Asha (the payer) and Meera (not in the payment) are both told exactly that, the same words.
    expect(await setPaymentDeleted(pay.id, M, false)).toEqual({ ok: false, error: receiverOnlyText("Ravi") });
    expect(await setPaymentDeleted(pay.id, A, false)).toEqual({ ok: false, error: receiverOnlyText("Ravi") });
    expect(await w.net()).toEqual(startNet({ M, A, R }));
    expect((await undoEvent(deletedEv.id, R)).ok).toBe(true);
    expect(await w.net()).toEqual(g1Net({ M, A, R }));
    await w.check();
  });

  it("G5. Asha deletes her own payment: back to the start; Ravi's Restore then works, balances as G1", async () => {
    const { w, M, A, R, pay } = await g1();
    expect((await setPaymentDeleted(pay.id, A, true)).ok).toBe(true);
    expect(await w.net()).toEqual(startNet({ M, A, R }));
    expect((await setPaymentDeleted(pay.id, R, false)).ok).toBe(true);
    expect(await w.net()).toEqual(g1Net({ M, A, R }));
    await w.check();
  });
});

describe("G6-G9: a newer payment, and people who have left", () => {
  it("G6 (H2). Ravi deletes, Asha records 40000 again, Ravi restores the first: refused; exactly one live Asha -> Ravi payment; balances as G1", async () => {
    const { w, M, A, R, pay } = await g1();
    expect((await setPaymentDeleted(pay.id, R, true)).ok).toBe(true);
    await record(w, A, R, 40000);
    const again = await setPaymentDeleted(pay.id, R, false);
    expect(again.ok).toBe(false); // it would count Asha's 40000 twice
    expect((await w.payments()).filter((p) => p.fromId === A && p.toId === R)).toHaveLength(1);
    expect(await w.net()).toEqual(g1Net({ M, A, R }));
    await w.check();
  });

  it("G7 (H1). Asha leaves at 0, then Ravi deletes her payment: Asha is back (leftAt empty), Ravi +80000, Asha -40000, Meera -40000; both lines are written", async () => {
    const { w, M, A, R, pay } = await g1();
    expect((await leave(w, A)).ok).toBe(true);
    expect((await w.row(A)).leftAt).not.toBeNull();
    expect((await setPaymentDeleted(pay.id, R, true)).ok).toBe(true);
    expect((await w.row(A)).leftAt).toBeNull();
    expect(await w.net()).toEqual(startNet({ M, A, R }));
    expect(await w.events("payment_deleted")).toHaveLength(1);
    expect(await w.events("member_rejoined")).toHaveLength(1);
    await w.check();
  });

  it("G8. Meera also pays Ravi 40000 (all 0), Ravi leaves, Asha deletes hers: Ravi is back, Ravi +40000, Asha -40000, Meera 0", async () => {
    const { w, M, A, R, pay } = await g1();
    await record(w, M, R, 40000);
    expect(await w.net()).toEqual({ [M]: 0, [A]: 0, [R]: 0 });
    expect((await leave(w, R)).ok).toBe(true);
    expect((await setPaymentDeleted(pay.id, A, true)).ok).toBe(true);
    expect((await w.row(R)).leftAt).toBeNull();
    expect(await w.net()).toEqual({ [M]: 0, [A]: -40000, [R]: 40000 });
    await w.check();
  });

  it("G9 (Q2). Asha leaves, then deletes her own payment: allowed; she is back; Ravi +80000, Asha -40000, Meera -40000", async () => {
    const { w, M, A, R, pay } = await g1();
    expect((await leave(w, A)).ok).toBe(true);
    expect((await setPaymentDeleted(pay.id, A, true)).ok).toBe(true);
    expect((await w.row(A)).leftAt).toBeNull();
    expect(await w.net()).toEqual(startNet({ M, A, R }));
    await w.check();
  });

  it("G9b (Q5). Asha was removed by Meera (the admin) at 0, then Ravi deletes her payment: she comes back too, no left or removed mark", async () => {
    const { w, M, A, R, pay } = await g1();
    expect((await setMemberLeft(w.gid, M, A, true)).ok).toBe(true);
    expect((await w.row(A)).removedAt).not.toBeNull();
    expect((await setPaymentDeleted(pay.id, R, true)).ok).toBe(true);
    const asha = await w.row(A);
    expect([asha.leftAt, asha.removedAt]).toEqual([null, null]);
    expect(await w.net()).toEqual(startNet({ M, A, R }));
    await w.check();
  });
});

describe("G10-G12: payments recorded for other people", () => {
  it("G10. Meera records 'Asha paid Ravi 40000': it counts (as G1); Meera can't delete it directly, Asha can", async () => {
    const { w, M, A, R } = await fixtureG();
    const { pay } = await record(w, A, R, 40000, M);
    expect(await w.net()).toEqual(g1Net({ M, A, R }));
    expect(await setPaymentDeleted(pay.id, M, true)).toEqual({ ok: false, error: "Only Asha or Ravi can change this payment." });
    expect((await setPaymentDeleted(pay.id, A, true)).ok).toBe(true);
    expect(await w.net()).toEqual(startNet({ M, A, R }));
    await w.check();
  });

  it("G10b (Q1-B). Meera's Undo of what she recorded works inside 10 minutes; after 10 minutes it is refused (only Asha or Ravi can delete then)", async () => {
    const a = await fixtureG();
    const first = await record(a.w, a.A, a.R, 40000, a.M);
    expect((await undoEvent(first.ev.id, a.M)).ok).toBe(true);
    expect(await a.w.net()).toEqual(startNet(a));
    await a.w.check();

    const b = await fixtureG();
    const late = await record(b.w, b.A, b.R, 40000, b.M);
    await ageEvent(late.ev.id, 11);
    const refused = await undoEvent(late.ev.id, b.M);
    expect(refused.ok).toBe(false);
    expect(await b.w.net()).toEqual(g1Net(b));
    expect(await b.w.payments()).toHaveLength(1);
    expect((await setPaymentDeleted(late.pay.id, b.A, true)).ok).toBe(true); // Asha still can
    await b.w.check();
  });

  it("G11. Meera does Settle everything (Asha -> Ravi 40000, Meera -> Ravi 40000): everyone 0, group closed; Asha's Undo refused, Meera's late Undo refused, Ravi's works: reopened, balances back to the start", async () => {
    const { w, M, A, R } = await fixtureG();
    const plan = planKey([{ from: A, to: R, amount: 40000 }, { from: M, to: R, amount: 40000 }]);
    const done = await settleAllAndClose(w.gid, M, plan);
    if (!done.ok || !done.eventId) throw new Error(done.ok ? "no event" : done.error);
    const pays = await w.payments();
    expect(pays.map((p) => [p.fromId, p.toId, p.amount, p.needsOk]).sort()).toEqual([[A, R, 40000, false], [M, R, 40000, false]].sort());
    expect(await w.net()).toEqual({ [M]: 0, [A]: 0, [R]: 0 });
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).closed).toBe(true);
    await w.check();

    expect((await undoEvent(done.eventId, A)).ok).toBe(false); // she is in only one of the two payments
    await ageEvent(done.eventId, 11);
    expect((await undoEvent(done.eventId, M)).ok).toBe(false); // Meera recorded them, but the 10 minutes are over
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).closed).toBe(true);
    expect((await undoEvent(done.eventId, R)).ok).toBe(true); // Ravi is in both
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).closed).toBe(false);
    expect(await w.net()).toEqual(startNet({ M, A, R }));
    expect(await w.payments()).toHaveLength(0);
    await w.check();
  });

  it("G11b (Q1-B). the same, but Meera Undoes straight away: it works", async () => {
    const { w, M, A, R } = await fixtureG();
    const done = await settleAllAndClose(w.gid, M, planKey([{ from: A, to: R, amount: 40000 }, { from: M, to: R, amount: 40000 }]));
    if (!done.ok || !done.eventId) throw new Error("not settled");
    expect((await undoEvent(done.eventId, M)).ok).toBe(true);
    expect(await w.net()).toEqual(startNet({ M, A, R }));
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).closed).toBe(false);
    await w.check();
  });

  it("G12. Ravi marks both payments paid: neither asks anyone; Asha's Undo is refused, Ravi's works", async () => {
    const { w, M, A, R } = await fixtureG();
    const done = await markAllPaid(w.gid, R, [{ from: A, to: R, amount: 40000 }, { from: M, to: R, amount: 40000 }], "", true);
    if (!done.ok || !done.eventId) throw new Error(done.ok ? "no event" : done.error);
    const pays = await w.payments();
    expect(pays).toHaveLength(2);
    expect(pays.every((p) => p.needsOk === false)).toBe(true);
    expect(await w.net()).toEqual({ [M]: 0, [A]: 0, [R]: 0 });
    expect((await undoEvent(done.eventId, A)).ok).toBe(false);
    expect(await w.payments()).toHaveLength(2);
    expect((await undoEvent(done.eventId, R)).ok).toBe(true);
    expect(await w.net()).toEqual(startNet({ M, A, R }));
    await w.check();
  });
});

describe("G13-G14: the pay link and a pair", () => {
  const owing = async (w: World, asha: string, ravi: string, by: string) => {
    const token = await payLinkFor(w.gid, asha, ravi, by);
    const form = new FormData();
    form.set("token", token);
    return { token, form };
  };
  const tap = (action: (f: FormData) => Promise<void>, form: FormData) =>
    action(form).catch((err: Error) => {
      if (!/^NEXT_REDIRECT/.test(String(err.message))) throw err;
      return err.message;
    });

  it("G13. Pay link Asha -> Ravi: one payment of 40000 that asks nobody, state 'paid'; the take-back makes it 'owes' 40000 again", async () => {
    const { w, M, A, R } = await fixtureG();
    // Asha owes Ravi 40000 in the plan: Meera -> Ravi 40000 as well; the link is for Asha's part.
    const { token, form } = await owing(w, A, R, M);
    const before = await readPayLink(token);
    expect(before).toMatchObject({ kind: "owes", amount: 40000 });
    await tap(L.iPaidAction, form);
    const pays = await w.payments();
    expect(pays.map((p) => [p.fromId, p.toId, p.amount, p.needsOk])).toEqual([[A, R, 40000, false]]);
    expect(await db.paymentClaim.count({ where: { groupId: w.gid } })).toBe(0);
    expect(await readPayLink(token)).toMatchObject({ kind: "paid", amount: 40000 });
    await tap(L.undoIPaidAction, form);
    expect(await w.payments()).toHaveLength(0);
    expect(await readPayLink(token)).toMatchObject({ kind: "owes", amount: 40000 });
    expect(await w.net()).toEqual(startNet({ M, A, R }));
    await w.check();
  });

  it("G13b. If Asha has left (she was at 0 after paying), the take-back from the link is refused and nothing changes", async () => {
    const { w, M, A, R } = await fixtureG();
    const { token, form } = await owing(w, A, R, M);
    await tap(L.iPaidAction, form);
    expect((await leave(w, A)).ok).toBe(true);
    await tap(L.undoIPaidAction, form);
    expect(await w.payments()).toHaveLength(1);
    expect((await w.row(A)).leftAt).not.toBeNull();
    expect(await readPayLink(token)).toMatchObject({ kind: "paid" });
    expect(await w.net()).toEqual({ [M]: -40000, [A]: 0, [R]: 40000 });
    await w.check();
  });

  it("G14. A pair: A records paying R 60000 (one part, so no 'across'); it counts; R's delete brings the pair back to where it was", async () => {
    const acc = await account("PairPia");
    const p = await ensureLocalPair({ id: acc.id }, "Rohan", { currency: "INR", myName: "Pia" });
    if (!p.ok) throw new Error("refused");
    groupIds.push(p.groupId);
    const nets = async () => {
      const x = await db.group.findUniqueOrThrow({ where: { id: p.groupId }, include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } } });
      return netBalances(x.members.map((m) => m.id), x.expenses, x.payments);
    };
    const before = await nets();
    const r = await recordPaymentCore({ groupId: p.groupId, fromId: p.myId, toId: p.otherId, amount: 60000, currency: "INR", myId: p.myId, key: key(), fp: `fp-${key()}`, warnOver: false });
    expect(r.kind).toBe("done");
    const pay = await db.payment.findFirstOrThrow({ where: { groupId: p.groupId, deletedAt: null } });
    expect(pay.needsOk).toBe(false);
    expect((await nets())[p.myId]).toBe(60000);
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: p.groupId, paymentId: pay.id, kind: "payment_recorded" } });
    expect(parseUndo(ev.undo)).toEqual({ type: "payment_delete", paymentId: pay.id }); // no "across"
    expect((await setPaymentDeleted(pay.id, p.otherId, true)).ok).toBe(true);
    expect(await nets()).toEqual(before);
  });
});

describe("older rows, and the one thing that still asks", () => {
  it("a needsOk row that is not a move-out payment: Got it and Not received are refused; it is not in waitingForMe, Needs you, or 'waiting' in Activity; its balance counts", async () => {
    const { w, M, A, R } = await fixtureG();
    const old = await db.payment.create({ data: { groupId: w.gid, fromId: A, toId: R, amount: 40000, createdById: A, needsOk: true } });
    expect(await w.net()).toEqual(g1Net({ M, A, R }));
    expect((await confirmPayment(old.id, R)).ok).toBe(false);
    expect((await rejectPayment(old.id, R)).ok).toBe(false);
    expect(await waitingForMe(w.gid, R)).toEqual([]);
    expect((await loadNeedsYou({ [w.gid]: R }, null, 0, NOW)).items).toEqual([]);
    const rows = await db.payment.findMany({ where: { groupId: w.gid } });
    const statusOf = (asks?: Set<string>) => {
      const item = buildActivity([], rows, R, [], asks).find((i) => i.kind === "payment");
      return item && item.kind === "payment" ? item.status : "no item";
    };
    expect(statusOf()).toBeUndefined();
    expect(statusOf(new Set())).toBeUndefined(); // not a move-out payment: never "waiting"
    expect(statusOf(new Set([old.id]))).toBe("waiting"); // (what a move-out payment reads like)
    // The same row, once a move-out line names it, is asked about.
    await markAsMoveOut(w.gid, A, [old.id]);
    expect((await waitingForMe(w.gid, R)).map((p) => p.id)).toEqual([old.id]);
    expect((await confirmPayment(old.id, R)).ok).toBe(true);
  });

  it("H2 on a move-out. Asha moves out (payment Asha -> Ravi 40000 asks Ravi); Ravi says Not received (Asha is back at -40000); Asha records 40000 again; Ravi's Undo of the Not received is refused: Ravi +40000, Asha 0, Meera -40000, exactly one live payment", async () => {
    const { w, M, A, R } = await (async () => {
      const x = await world("home", ["Asha", "Ravi", "Meera"]);
      const [a, r, m] = [x.id("Asha"), x.id("Ravi"), x.id("Meera")];
      await x.expense("Groceries", 120000, r, [[a, 40000], [r, 40000], [m, 40000]]);
      return { w: x, M: m, A: a, R: r };
    })();
    expect(await w.net()).toEqual({ [A]: -40000, [R]: 80000, [M]: -40000 });
    const left = await moveOut(w.gid, A, { leaverId: A, lastDay: "2026-11-10", requestKey: key() }, NOW);
    expect(left.ok).toBe(true);
    const pay = (await w.payments())[0];
    expect([pay.fromId, pay.toId, pay.amount, pay.needsOk]).toEqual([A, R, 40000, true]);
    const no = await rejectPayment(pay.id, R);
    if (!no.ok || !no.eventId) throw new Error("not rejected");
    expect((await w.row(A)).leftAt).toBeNull();
    expect(await w.net()).toEqual({ [A]: -40000, [R]: 80000, [M]: -40000 });
    await record(w, A, R, 40000);
    expect(await w.net()).toEqual({ [A]: 0, [R]: 40000, [M]: -40000 });
    const undo = await undoEvent(no.eventId, R);
    expect(undo.ok).toBe(false); // it would count Asha's 40000 twice
    expect(await w.net()).toEqual({ [A]: 0, [R]: 40000, [M]: -40000 });
    expect((await w.payments()).filter((p) => p.fromId === A && p.toId === R)).toHaveLength(1);
    await w.check();
  });
});
