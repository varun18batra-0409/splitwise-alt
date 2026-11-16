import { afterAll, describe, expect, it, vi } from "vitest";

// Fixes after the second independent review of Batch A5 + C (16 Nov). Throwaway database; paise, every number worked by hand.
//
// H2  a payment across groups is always with ONE other person (the same account in every part), or nothing is written.
// M1  someone an admin REMOVED can't delete or restore payments themselves; the other person in the payment still can.
// M2  a payment across groups never names the other groups to someone who may not be in them.
// M3  the phone message about a payment across groups is worked out per currency, never adding two currencies.
// M4  the move-out block for an old waiting note reads without the old screens.
// L1  a payment that was confirmed still reads "Confirmed" in Activity; "waiting" is only for a move-out payment.
// L4  the recorder's 10-minute Undo counts from the ORIGINAL recording, not from each Undo / Redo line.
// L5  the delete question's words.

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { netBalances } = await import("@/lib/balances");
const { formatMoney } = await import("@/lib/money");
const { settleAcrossCore } = await import("@/lib/cross-settle-db");
const { createPayment } = await import("@/lib/payments");
const { changePayment, deleteQuestion } = await import("@/lib/payment-change");
const { setPaymentDeleted } = await import("@/lib/save-expense");
const { setMemberLeft } = await import("@/lib/people");
const { markAllPaid, setPaymentsDeleted, settleAllAndClose, applySettleAll, planKey } = await import("@/lib/settle-all");
const { acrossBody, acrossRecipients } = await import("@/lib/payment-claims");
const { removedText } = await import("@/lib/active");
const { actorRefusal, canUndo, originAtOf } = await import("@/lib/undo");
const { buildActivity } = await import("@/lib/activity");
const { MOVE_OUT_WAITING_NOTE } = await import("@/lib/home/moving-db");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;
const key = () => `ra2-${stamp}-${++n}-abcdefgh`;

afterAll(async () => {
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `ra2-${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a.id;
}

// People are added in the order given (the first joined one looks after the group). `acc` = their account (same account = same person).
async function group(name: string, type: string, people: { name: string; acc?: string }[]) {
  const g = await db.group.create({
    data: {
      name: `${name} ${++n} ${stamp}`, type, currency: "INR", inviteCode: `ra2-${n}-${stamp}`,
      members: { create: people.map((p, i) => ({ name: p.name, splitWeight: 100, createdAt: new Date(2026, 0, i + 1), ...(p.acc ? { accountId: p.acc, claimedAt: new Date(2026, 0, i + 1) } : {}) })) },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  return { id: g.id, name: g.name, member: id };
}

const spend = (groupId: string, description: string, amount: number, paidById: string, shares: [string, number][]) =>
  db.expense.create({
    data: {
      groupId, description, category: "other", amount, paidById, createdById: paidById, splitType: "exact", forMode: "selected",
      originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount, spentAt: new Date("2026-11-01T12:00:00Z"),
      shares: { create: shares.map(([memberId, a]) => ({ memberId, amount: a })) },
    },
  });

const pay = (groupId: string, fromId: string, toId: string, amount: number, by = fromId) =>
  db.$transaction((tx) => createPayment(tx, { groupId, fromId, toId, amount, createdById: by }));

async function netOf(groupId: string) {
  const x = await db.group.findUniqueOrThrow({ where: { id: groupId }, include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } } });
  return netBalances(x.members.map((m) => m.id), x.expenses, x.payments);
}
const live = (gid: string) => db.payment.count({ where: { groupId: gid, deletedAt: null } });
const removeNow = (memberId: string, by: string) => {
  const when = new Date("2026-11-10T00:00:00Z");
  return db.member.update({ where: { id: memberId }, data: { leftAt: when, removedAt: when, removedById: by } });
};

describe("H2: one payment across groups is with ONE other person", () => {
  it("hand-made parts pairing Ravi's debt to Asha (Goa) with his debt to Bob (Flat) are refused, and nothing is written anywhere", async () => {
    const [ra, as, bo] = [await account("Ravi"), await account("Asha"), await account("Bob")];
    const goa = await group("Goa", "trip", [{ name: "Asha", acc: as }, { name: "Ravi", acc: ra }]);
    const flat = await group("Flat", "home", [{ name: "Bob", acc: bo }, { name: "Ravi", acc: ra }]);
    await spend(goa.id, "Dinner", 100000, goa.member("Asha"), [[goa.member("Ravi"), 100000]]); // Ravi owes Asha 100000
    await spend(flat.id, "Milk", 40000, flat.member("Bob"), [[flat.member("Ravi"), 40000]]); // Ravi owes Bob 40000
    const parts = [
      { groupId: goa.id, fromId: goa.member("Ravi"), toId: goa.member("Asha"), amount: 100000 },
      { groupId: flat.id, fromId: flat.member("Ravi"), toId: flat.member("Bob"), amount: 40000 },
    ];
    const memberships = { [goa.id]: goa.member("Ravi"), [flat.id]: flat.member("Ravi") };
    expect(await settleAcrossCore(parts, memberships, key())).toBe("error");
    expect(await live(goa.id)).toBe(0);
    expect(await live(flat.id)).toBe(0);
    expect(await db.payment.count({ where: { groupId: { in: [goa.id, flat.id] } } })).toBe(0);
    expect(await db.groupEvent.count({ where: { groupId: { in: [goa.id, flat.id] }, kind: "payment_recorded" } })).toBe(0);
    expect(await netOf(goa.id)).toEqual({ [goa.member("Asha")]: 100000, [goa.member("Ravi")]: -100000 }); // exactly as before
  });

  it("the same name and phone in both groups but no account: refused too (nothing proves it is the same person)", async () => {
    const ra = await account("Ravi");
    const mk = async (name: string) => {
      const g = await db.group.create({
        data: { name: `${name} ${++n} ${stamp}`, type: "other", currency: "INR", inviteCode: `ra2-${n}-${stamp}`, members: { create: [{ name: "Ravi", accountId: ra, claimedAt: new Date() }, { name: "Asha", phone: "+91 98765 43210" }] } },
        include: { members: true },
      });
      groupIds.push(g.id);
      return { id: g.id, R: g.members.find((m) => m.name === "Ravi")!.id, A: g.members.find((m) => m.name === "Asha")!.id };
    };
    const [g1, g2] = [await mk("Trip"), await mk("Flat")];
    await spend(g1.id, "Dinner", 100000, g1.A, [[g1.R, 100000]]);
    await spend(g2.id, "Milk", 40000, g2.A, [[g2.R, 40000]]);
    const parts = [
      { groupId: g1.id, fromId: g1.R, toId: g1.A, amount: 100000 },
      { groupId: g2.id, fromId: g2.R, toId: g2.A, amount: 40000 },
    ];
    expect(await settleAcrossCore(parts, { [g1.id]: g1.R, [g2.id]: g2.R }, key())).toBe("error");
    expect((await live(g1.id)) + (await live(g2.id))).toBe(0);
  });
});

describe("M1: someone an admin removed can't delete or restore payments themselves", () => {
  it("single group: the removed payer is refused; Ravi (the other person) deletes it and brings her back owing; her own restore is refused; Ravi can restore", async () => {
    const [me, as, ra] = [await account("Meera"), await account("Asha"), await account("Ravi")];
    const g = await group("Goa", "trip", [{ name: "Meera", acc: me }, { name: "Asha", acc: as }, { name: "Ravi", acc: ra }]);
    const [M, A, R] = [g.member("Meera"), g.member("Asha"), g.member("Ravi")];
    await spend(g.id, "Dinner", 60000, R, [[A, 60000]]); // Asha -60000, Ravi +60000
    const first = await pay(g.id, A, R, 60000); // both 0
    expect((await setMemberLeft(g.id, M, A, true)).ok).toBe(true); // the admin removes her (she is at 0)
    expect((await db.member.findUniqueOrThrow({ where: { id: A } })).removedAt).not.toBeNull();
    // Her own delete is refused, in words, and nothing moves.
    expect(await setPaymentDeleted(first.id, A, true)).toEqual({ ok: false, error: removedText(g.name) });
    expect(removedText(g.name)).toBe(`You were removed from ${g.name}, so you can't change its payments.`);
    expect((await db.payment.findUniqueOrThrow({ where: { id: first.id } })).deletedAt).toBeNull();
    expect(await netOf(g.id)).toEqual({ [M]: 0, [A]: 0, [R]: 0 });
    // Ravi can: it comes off and she is back in the group owing it (Asha -60000, Ravi +60000).
    expect((await setPaymentDeleted(first.id, R, true)).ok).toBe(true);
    const back = await db.member.findUniqueOrThrow({ where: { id: A } });
    expect([back.leftAt, back.removedAt, back.removedById]).toEqual([null, null, ""]);
    expect(await netOf(g.id)).toEqual({ [M]: 0, [A]: -60000, [R]: 60000 });

    // Restore: Asha pays again and takes it off herself (deletedById = Asha), is removed again, and can't bring it back; Ravi can.
    const second = await pay(g.id, A, R, 60000);
    expect((await setPaymentDeleted(second.id, A, true)).ok).toBe(true);
    await removeNow(A, M); // (set directly: she is owing here, which a normal removal would not allow)
    expect(await setPaymentDeleted(second.id, A, false)).toEqual({ ok: false, error: removedText(g.name) });
    expect((await db.payment.findUniqueOrThrow({ where: { id: second.id } })).deletedAt).not.toBeNull();
    expect((await setPaymentDeleted(second.id, R, false)).ok).toBe(true); // Asha ends at 0, so a person who left may have it back
    expect(await netOf(g.id)).toEqual({ [M]: 0, [A]: 0, [R]: 0 });
  });

  it("undo of 'Mark all paid' and of 'Settle everything' is refused to the removed person, in the same words", async () => {
    const [me, as, ra] = [await account("Meera"), await account("Asha"), await account("Ravi")];
    const g1 = await group("Goa", "trip", [{ name: "Meera", acc: me }, { name: "Asha", acc: as }, { name: "Ravi", acc: ra }]);
    const [M1, A1, R1] = [g1.member("Meera"), g1.member("Asha"), g1.member("Ravi")];
    await spend(g1.id, "Dinner", 40000, R1, [[A1, 40000]]);
    expect((await markAllPaid(g1.id, M1, [{ from: A1, to: R1, amount: 40000 }], "", true)).ok).toBe(true);
    const ids1 = (await db.payment.findMany({ where: { groupId: g1.id } })).map((p) => p.id);
    await removeNow(A1, M1);
    expect(await setPaymentsDeleted(g1.id, A1, ids1, true)).toEqual({ ok: false, error: removedText(g1.name) });
    expect(await live(g1.id)).toBe(1);

    const g2 = await group("Flat", "trip", [{ name: "Meera", acc: me }, { name: "Asha", acc: as }, { name: "Ravi", acc: ra }]);
    const [M2, A2, R2] = [g2.member("Meera"), g2.member("Asha"), g2.member("Ravi")];
    await spend(g2.id, "Dinner", 40000, R2, [[A2, 40000]]);
    expect((await settleAllAndClose(g2.id, M2, planKey([{ from: A2, to: R2, amount: 40000 }]))).ok).toBe(true);
    const ids2 = (await db.payment.findMany({ where: { groupId: g2.id } })).map((p) => p.id);
    await removeNow(A2, M2);
    expect(await applySettleAll(g2.id, A2, ids2, false)).toEqual({ ok: false, error: removedText(g2.name) });
    expect((await db.group.findUniqueOrThrow({ where: { id: g2.id } })).closed).toBe(true);
    expect(await live(g2.id)).toBe(1);
  });

  it("the Undo button check says the same (pure): a removed viewer is refused for a payment line, in words that don't need a group name", () => {
    const people = [
      { id: "m", name: "Meera", accountId: "acc-m", leftAt: null, removedAt: null },
      { id: "a", name: "Asha", accountId: "acc-a", leftAt: new Date("2026-11-10T00:00:00Z"), removedAt: new Date("2026-11-10T00:00:00Z") },
      { id: "r", name: "Ravi", accountId: "acc-r", leftAt: null, removedAt: null },
    ];
    const ev = { id: "e1", kind: "payment_recorded", undo: JSON.stringify({ type: "payment_delete", paymentId: "p1" }), undoneAt: null, expenseId: null, paymentId: "p1", createdAt: new Date("2026-11-16T10:00:00Z"), actorId: "r", text: "" };
    const viewer = (id: string) => ({ id, isAdmin: false, closed: false, members: people, payments: [{ id: "p1", fromId: "a", toId: "r", deletedById: null }] });
    const no = canUndo(ev, [ev], new Date("2026-11-16T10:01:00Z"), viewer("a"));
    expect(no).toEqual({ ok: false, reason: "You were removed from this group, so you can't change its payments." });
    expect(canUndo(ev, [ev], new Date("2026-11-16T10:01:00Z"), viewer("r")).ok).toBe(true); // the other person can
  });
});

describe("M1 + M2: one payment across Goa and Flat", () => {
  async function fixture() {
    const [as, ra, me] = [await account("Asha"), await account("Ravi"), await account("Meera")];
    const goa = await group("Goa", "trip", [{ name: "Asha", acc: as }, { name: "Ravi", acc: ra }, { name: "Meera", acc: me }]);
    const flat = await group("Flat", "home", [{ name: "Asha", acc: as }, { name: "Ravi", acc: ra }]);
    const [Ag, Rg, Mg, Af, Rf] = [goa.member("Asha"), goa.member("Ravi"), goa.member("Meera"), flat.member("Asha"), flat.member("Ravi")];
    await spend(goa.id, "Dinner", 100000, Ag, [[Rg, 100000]]); // Ravi owes Asha 100000
    await spend(flat.id, "Milk", 40000, Rf, [[Af, 40000]]); // Asha owes Ravi 40000
    const parts = [
      { groupId: goa.id, fromId: Rg, toId: Ag, amount: 100000 },
      { groupId: flat.id, fromId: Af, toId: Rf, amount: 40000 },
    ];
    expect(await settleAcrossCore(parts, { [goa.id]: Rg, [flat.id]: Rf }, key())).toBe("done");
    const goaPay = await db.payment.findFirstOrThrow({ where: { groupId: goa.id, deletedAt: null } });
    const flatPay = await db.payment.findFirstOrThrow({ where: { groupId: flat.id, deletedAt: null } });
    return { goa, flat, Ag, Rg, Mg, Af, Rf, goaPay, flatPay };
  }

  it("Meera (in Goa only) is refused without being told Flat exists; the removed Asha is refused naming only her own group; Ravi deletes both and Asha is back in Goa", async () => {
    const x = await fixture();
    const meera = await changePayment(x.goaPay.id, x.Mg, true);
    expect(meera).toEqual({ ok: false, error: "This was one payment across groups. Only Ravi or Asha can change it." });
    if (!meera.ok) {
      expect(meera.error).not.toContain(x.flat.name);
      expect(meera.error).not.toContain(x.goa.name);
    }
    expect([await live(x.goa.id), await live(x.flat.id)]).toEqual([1, 1]);

    // Asha was removed from Goa: she can't delete it, and the words name her own group only.
    await removeNow(x.Ag, x.Rg);
    const asha = await changePayment(x.goaPay.id, x.Ag, true, { memberships: { [x.goa.id]: x.Ag, [x.flat.id]: x.Af } });
    expect(asha).toEqual({ ok: false, error: removedText(x.goa.name) });
    expect([await live(x.goa.id), await live(x.flat.id)]).toEqual([1, 1]);

    // Ravi can: both parts go; each group's history line says only "part of one payment across groups".
    const ravi = await changePayment(x.goaPay.id, x.Rg, true, { memberships: { [x.goa.id]: x.Rg, [x.flat.id]: x.Rf } });
    expect(ravi.ok).toBe(true);
    expect([await live(x.goa.id), await live(x.flat.id)]).toEqual([0, 0]);
    const goaLine = await db.groupEvent.findFirstOrThrow({ where: { groupId: x.goa.id, kind: "payment_deleted" } });
    const flatLine = await db.groupEvent.findFirstOrThrow({ where: { groupId: x.flat.id, kind: "payment_deleted" } });
    expect(goaLine.text).toContain("(part of one payment across groups)");
    expect(flatLine.text).toContain("(part of one payment across groups)");
    expect(goaLine.text).not.toContain(x.flat.name);
    expect(flatLine.text).not.toContain(x.goa.name);
    // Asha is back in Goa, owed what she was owed before (Goa: Asha +100000, Ravi -100000; Flat: Ravi +40000, Asha -40000).
    const back = await db.member.findUniqueOrThrow({ where: { id: x.Ag } });
    expect([back.leftAt, back.removedAt]).toEqual([null, null]);
    expect(await netOf(x.goa.id)).toEqual({ [x.Ag]: 100000, [x.Rg]: -100000, [x.Mg]: 0 });
    expect(await netOf(x.flat.id)).toEqual({ [x.Rf]: 40000, [x.Af]: -40000 });
  });

  it("a removed person can't restore the set either (refused, naming her own group), and nothing comes back", async () => {
    const x = await fixture();
    expect((await changePayment(x.goaPay.id, x.Rg, true, { memberships: { [x.goa.id]: x.Rg, [x.flat.id]: x.Rf } })).ok).toBe(true);
    await removeNow(x.Ag, x.Rg);
    const r = await changePayment(x.goaPay.id, x.Ag, false, { memberships: { [x.goa.id]: x.Ag, [x.flat.id]: x.Af } });
    expect(r).toEqual({ ok: false, error: removedText(x.goa.name) });
    expect([await live(x.goa.id), await live(x.flat.id)]).toEqual([0, 0]);
  });
});

describe("M3: the phone message across groups is worked out per currency", () => {
  // Ravi (the actor) pays in three groups: Goa (INR) Ravi -> Asha 100000, Flat (INR) Asha -> Ravi 40000, Trip (USD) Ravi -> Asha 2000.
  const parts = [
    { groupId: "g1", groupName: "Goa", currency: "INR", paymentId: "p1", fromId: "rg", toId: "ag", amount: 100000 },
    { groupId: "g2", groupName: "Flat", currency: "INR", paymentId: "p2", fromId: "af", toId: "rf", amount: 40000 },
    { groupId: "g3", groupName: "Trip", currency: "USD", paymentId: "p3", fromId: "rt", toId: "at", amount: 2000 },
  ];
  const accountOf = (id: string) => (id.startsWith("a") ? "acc-asha" : "acc-ravi");

  it("Asha is told once: ₹1,000 - ₹400 = ₹600 in rupees and $20 in dollars, never 62000 of anything", () => {
    const who = acrossRecipients(parts, ["rg", "rf", "rt"], accountOf);
    expect(who).toEqual([{ key: "acc-asha", memberId: "ag", nets: { INR: 60000, USD: 2000 }, groups: ["Goa", "Flat", "Trip"] }]);
    expect(acrossBody("Ravi", who[0].groups, who[0].nets, formatMoney)).toBe("Ravi recorded a settle-up with you across Goa, Flat and Trip (you get ₹600 and $20). If that’s wrong, open it to delete it.");
  });

  it("opposite ways and nothing", () => {
    expect(acrossBody("Ravi", ["Goa", "Trip"], { INR: 60000, USD: -2000 }, formatMoney)).toContain("(you get ₹600 and you pay $20)");
    expect(acrossBody("Ravi", ["Goa", "Flat"], { INR: -60000 }, formatMoney)).toContain("(you pay ₹600)");
    expect(acrossBody("Ravi", ["Goa", "Flat"], { INR: 0 }, formatMoney)).toContain("(it comes to nothing for you)");
  });
});

describe("M4: the move-out block for an old waiting note", () => {
  it("reads without the old screens", () => {
    expect(MOVE_OUT_WAITING_NOTE).toBe("An older “I’ve paid” is still being sorted. Try again in a few minutes.");
  });
});

describe("L1: Activity keeps showing 'Confirmed' for a confirmed payment, and 'waiting' only for a move-out payment", () => {
  const row = (o: { okAt: Date | null; needsOk: boolean }) => ({ id: "p1", fromId: "a", toId: "r", amount: 100, createdAt: new Date("2026-11-16T10:00:00Z"), deletedAt: null, deletedById: null, createdById: "a", ...o }) as never;
  const status = (r: never, asks?: Set<string>) => {
    const item = buildActivity([], [r], "a", [], asks).find((i) => i.kind === "payment");
    return item && item.kind === "payment" ? item.status : "no item";
  };
  it("okAt set: 'ok', with or without the move-out list", () => {
    const r = row({ okAt: new Date("2026-11-16T11:00:00Z"), needsOk: true });
    expect(status(r)).toBe("ok");
    expect(status(r, new Set())).toBe("ok");
    expect(status(r, new Set(["p1"]))).toBe("ok");
  });
  it("not confirmed: 'waiting' only when it is a move-out payment", () => {
    const r = row({ okAt: null, needsOk: true });
    expect(status(r)).toBeUndefined();
    expect(status(r, new Set())).toBeUndefined();
    expect(status(r, new Set(["p1"]))).toBe("waiting");
  });
});

describe("L4: the recorder's 10-minute Undo counts from the original recording", () => {
  const T0 = new Date("2026-11-16T10:00:00Z");
  const at = (min: number) => new Date(T0.getTime() + min * 60_000);
  const line = (id: string, min: number, undo: object, undoneMin?: number) => ({ id, kind: "payment_recorded", undo: JSON.stringify(undo), undoneAt: undoneMin === undefined ? null : at(undoneMin), expenseId: null, paymentId: "p1", createdAt: at(min), actorId: "m", text: "" });
  const people = ["m", "a", "r"].map((id) => ({ id, name: id.toUpperCase(), accountId: null, leftAt: null, removedAt: null }));
  const viewer = { id: "m", isAdmin: false, closed: false, members: people, payments: [{ id: "p1", fromId: "a", toId: "r", deletedById: null }] };
  // Meera records Asha -> Ravi at 0 min, Undoes it at 9 min, Redoes at 18 min. Each Undo / Redo writes a new line by her.
  const e1 = line("e1", 0, { type: "payment_delete", paymentId: "p1" }, 9);
  const e2 = line("e2", 9, { type: "payment_restore", paymentId: "p1" }, 18);
  const e3 = line("e3", 18, { type: "payment_delete", paymentId: "p1" });

  it("the origin is the oldest line of the same payment", () => {
    expect(originAtOf(e3, [e1, e2, e3]).toISOString()).toBe(at(0).toISOString());
    expect(originAtOf(e2, [e1, e2]).toISOString()).toBe(at(0).toISOString());
  });
  it("a set of payments is matched whatever order the ids are in", () => {
    const a = { undo: JSON.stringify({ type: "payments_set", paymentIds: ["p2", "p1"], deleted: true }), createdAt: at(0) };
    const b = { undo: JSON.stringify({ type: "payments_set", paymentIds: ["p1", "p2"], deleted: false }), createdAt: at(12) };
    expect(originAtOf(b, [a, b]).toISOString()).toBe(at(0).toISOString());
  });
  it("at minute 9.5 she may still Undo her Undo's line (inside 10 minutes of the recording)", () => {
    expect(canUndo(e2, [e1, e2], at(9.5), viewer).ok).toBe(true);
  });
  it("at minute 19 she may NOT Redo again: counted from her own Redo line she would have had until minute 28, counted from the recording it ended at minute 10", () => {
    expect(actorRefusal(e3, viewer, at(19))).toBeNull(); // the old way (the line's own time): the window stretched
    expect(canUndo(e3, [e1, e2, e3], at(19), viewer)).toEqual({ ok: false, reason: "Only A or R can change this payment." });
  });
});

describe("L5: the delete question's words", () => {
  const base = "Delete this payment? Balances will go back to before it was recorded.";
  it("two groups say both, three or more say all of them", () => {
    expect(deleteQuestion({ groupName: "Goa", acrossGroups: ["Goa", "Flat"] })).toBe(`${base} This was one payment across Goa and Flat. Deleting it takes it off in both.`);
    expect(deleteQuestion({ groupName: "Goa", acrossGroups: ["Goa", "Flat", "Trip"] })).toBe(`${base} This was one payment across Goa, Flat and Trip. Deleting it takes it off in all of them.`);
  });
  it("the person who left comes back owing it if they paid, owed it if they were paid", () => {
    expect(deleteQuestion({ groupName: "Goa", leftNames: ["Asha"] })).toBe(`${base} Asha has left, so Asha comes back into Goa, owing it.`);
    expect(deleteQuestion({ groupName: "Goa", leftNames: ["Ravi"], leftPaidNames: ["Ravi"] })).toBe(`${base} Ravi has left, so Ravi comes back into Goa, owed it.`);
    expect(deleteQuestion({ groupName: "Goa", leftNames: ["Asha", "Ravi"], leftPaidNames: ["Ravi"] })).toBe(`${base} Asha and Ravi have left, so they come back into Goa: Asha owing and Ravi owed.`);
    expect(deleteQuestion({ groupName: "Goa", leftNames: ["Asha", "Meera"] })).toBe(`${base} Asha and Meera have left, so they come back into Goa, owing it.`);
  });
});
