import { afterAll, describe, expect, it, vi } from "vitest";

// One "Mark as paid" across several groups is one payment in people's eyes: it is recorded in every group together, and deleted or brought
// back in every group together (or not at all). Only the payer and the person paid can do it. Throwaway database; paise, worked by hand.
//
// Fixture X:
//   Goa (Asha, Ravi, Meera): Dinner 100000 paid by Asha, all of it Ravi's share. Asha +100000, Ravi -100000, Meera 0.
//   Flat (Asha, Ravi):       Milk 40000 paid by Ravi, all of it Asha's share.    Ravi +40000,  Asha -40000.
//   Ravi's one item: -100000 + 40000 = -60000. Parts: Goa Ravi -> Asha 100000; Flat Asha -> Ravi 40000.
//   Ravi (and Asha) are the same people in both groups: each has one account.

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { netBalances } = await import("@/lib/balances");
const { settleAcrossCore } = await import("@/lib/cross-settle-db");
const { setPaymentDeleted } = await import("@/lib/save-expense");
const { changePayment } = await import("@/lib/payment-change");
const { createPayment } = await import("@/lib/payments");
const { setMemberLeft } = await import("@/lib/people");
const { undoEvent } = await import("@/lib/undo");
const { parseUndo } = await import("@/lib/events");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;
const key = () => `xb-${stamp}-${++n}-abcdefgh`;

afterAll(async () => {
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `xb-${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}

async function group(name: string, people: { name: string; accountId: string }[]) {
  const g = await db.group.create({
    data: {
      name: `${name} ${++n} ${stamp}`, type: name === "Goa" ? "trip" : "home", currency: "INR", inviteCode: `xb-${n}-${stamp}`,
      members: { create: people.map((p, i) => ({ name: p.name, splitWeight: 100, createdAt: new Date(2026, 0, i + 1), accountId: p.accountId, claimedAt: new Date(2026, 0, i + 1) })) },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  return { id: g.id, member: id };
}

const spend = (groupId: string, description: string, amount: number, paidById: string, shares: [string, number][]) =>
  db.expense.create({
    data: {
      groupId, description, category: "other", amount, paidById, createdById: paidById, splitType: "exact", forMode: "selected",
      originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount, spentAt: new Date("2026-11-01T12:00:00Z"),
      shares: { create: shares.map(([memberId, a]) => ({ memberId, amount: a })) },
    },
  });

async function netOf(groupId: string) {
  const x = await db.group.findUniqueOrThrow({ where: { id: groupId }, include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } } });
  return netBalances(x.members.map((m) => m.id), x.expenses, x.payments);
}

// Fixture X. `goaAmount` is what Ravi owes Asha in Goa, `flatAmount` what Asha owes Ravi in the Flat (both default to the numbers above).
async function fixtureX(o: { goaAmount?: number; flatAmount?: number; flatSameWay?: boolean } = {}) {
  const [aAcc, rAcc, mAcc] = [await account("Asha"), await account("Ravi"), await account("Meera")];
  const goa = await group("Goa", [{ name: "Asha", accountId: aAcc.id }, { name: "Ravi", accountId: rAcc.id }, { name: "Meera", accountId: mAcc.id }]);
  const flat = await group("Flat", [{ name: "Asha", accountId: aAcc.id }, { name: "Ravi", accountId: rAcc.id }]);
  const [Ag, Rg, Mg] = [goa.member("Asha"), goa.member("Ravi"), goa.member("Meera")];
  const [Af, Rf] = [flat.member("Asha"), flat.member("Ravi")];
  const goaAmount = o.goaAmount ?? 100000;
  const flatAmount = o.flatAmount ?? 40000;
  await spend(goa.id, "Dinner", goaAmount, Ag, [[Rg, goaAmount]]);
  if (o.flatSameWay) await spend(flat.id, "Milk", flatAmount, Af, [[Rf, flatAmount]]); // Ravi owes Asha here too
  else await spend(flat.id, "Milk", flatAmount, Rf, [[Af, flatAmount]]);
  const memberships = { [goa.id]: Rg, [flat.id]: Rf };
  const parts = [
    { groupId: goa.id, fromId: Rg, toId: Ag, amount: goaAmount },
    o.flatSameWay ? { groupId: flat.id, fromId: Rf, toId: Af, amount: flatAmount } : { groupId: flat.id, fromId: Af, toId: Rf, amount: flatAmount },
  ];
  return { goa, flat, Ag, Rg, Mg, Af, Rf, memberships, parts, goaAmount, flatAmount };
}
type X = Awaited<ReturnType<typeof fixtureX>>;

async function recordAll(x: X) {
  expect(await settleAcrossCore(x.parts, x.memberships, key())).toBe("done");
  const goaPay = await db.payment.findFirstOrThrow({ where: { groupId: x.goa.id, deletedAt: null } });
  const flatPay = await db.payment.findFirstOrThrow({ where: { groupId: x.flat.id, deletedAt: null } });
  return { goaPay, flatPay };
}
const live = (gid: string) => db.payment.count({ where: { groupId: gid, deletedAt: null } });
const sum = (v: Record<string, number>) => Object.values(v).reduce((a, b) => a + b, 0);

// The balances before anything is recorded.
async function expectStart(x: X) {
  expect(await netOf(x.goa.id)).toEqual({ [x.Ag]: x.goaAmount, [x.Rg]: -x.goaAmount, [x.Mg]: 0 });
  expect(await netOf(x.flat.id)).toEqual(x.parts[1].fromId === x.Af ? { [x.Rf]: x.flatAmount, [x.Af]: -x.flatAmount } : { [x.Af]: x.flatAmount, [x.Rf]: -x.flatAmount });
}
async function expectAllZero(x: X) {
  expect(Object.values(await netOf(x.goa.id)).every((v) => v === 0)).toBe(true);
  expect(Object.values(await netOf(x.flat.id)).every((v) => v === 0)).toBe(true);
}

describe("X1-X5: recording and deleting one payment across two groups", () => {
  it("X1. Ravi records it: two payments, both counting, all balances 0, both lines carry the same link naming both parts", async () => {
    const x = await fixtureX();
    await expectStart(x);
    const { goaPay, flatPay } = await recordAll(x);
    expect([goaPay.fromId, goaPay.toId, goaPay.amount, goaPay.needsOk]).toEqual([x.Rg, x.Ag, 100000, false]);
    expect([flatPay.fromId, flatPay.toId, flatPay.amount, flatPay.needsOk]).toEqual([x.Af, x.Rf, 40000, false]);
    await expectAllZero(x);
    const evGoa = await db.groupEvent.findFirstOrThrow({ where: { paymentId: goaPay.id, kind: "payment_recorded" } });
    const evFlat = await db.groupEvent.findFirstOrThrow({ where: { paymentId: flatPay.id, kind: "payment_recorded" } });
    const a = parseUndo(evGoa.undo);
    const b = parseUndo(evFlat.undo);
    if (a?.type !== "payment_delete" || b?.type !== "payment_delete" || !a.across || !b.across) throw new Error("no link on the lines");
    expect(a.across.id).toBe(b.across.id);
    expect(a.across.parts.map((p) => p.paymentId).sort()).toEqual([goaPay.id, flatPay.id].sort());
    expect(b.across).toEqual(a.across);
  });

  it("X2. Asha deletes the Goa part: both parts go; Goa Asha +100000 / Ravi -100000; Flat Ravi +40000 / Asha -40000; one 'deleted' line per group", async () => {
    const x = await fixtureX();
    const { goaPay, flatPay } = await recordAll(x);
    const r = await setPaymentDeleted(goaPay.id, x.Ag, true, { memberships: { [x.goa.id]: x.Ag, [x.flat.id]: x.Af } });
    expect(r.ok).toBe(true);
    expect(await live(x.goa.id)).toBe(0);
    expect(await live(x.flat.id)).toBe(0);
    expect(await netOf(x.goa.id)).toEqual({ [x.Ag]: 100000, [x.Rg]: -100000, [x.Mg]: 0 });
    expect(await netOf(x.flat.id)).toEqual({ [x.Rf]: 40000, [x.Af]: -40000 });
    for (const [gid, pid] of [[x.goa.id, goaPay.id], [x.flat.id, flatPay.id]] as const) {
      expect(await db.groupEvent.count({ where: { groupId: gid, kind: "payment_deleted" } })).toBe(1);
      expect((await db.payment.findUniqueOrThrow({ where: { id: pid } })).deletedAt).not.toBeNull();
    }
  });

  it("X3. Ravi tries to restore: refused as a whole (Asha, the one paid in Goa, took it off); Asha's Undo in the Flat brings both back and everything is 0", async () => {
    const x = await fixtureX();
    const { goaPay, flatPay } = await recordAll(x);
    expect((await setPaymentDeleted(goaPay.id, x.Ag, true, { memberships: { [x.goa.id]: x.Ag, [x.flat.id]: x.Af } })).ok).toBe(true);
    const refused = await setPaymentDeleted(goaPay.id, x.Rg, false, { memberships: x.memberships });
    expect(refused.ok).toBe(false);
    expect(await live(x.goa.id)).toBe(0);
    expect(await live(x.flat.id)).toBe(0);
    expect(await netOf(x.flat.id)).toEqual({ [x.Rf]: 40000, [x.Af]: -40000 });
    const flatDeleted = await db.groupEvent.findFirstOrThrow({ where: { groupId: x.flat.id, paymentId: flatPay.id, kind: "payment_deleted" } });
    const back = await undoEvent(flatDeleted.id, x.Af, undefined, { memberships: { [x.goa.id]: x.Ag, [x.flat.id]: x.Af } });
    expect(back.ok).toBe(true);
    expect(await live(x.goa.id)).toBe(1);
    expect(await live(x.flat.id)).toBe(1);
    await expectAllZero(x);
  });

  it("X4. Meera (in Goa only) deletes the Goa part: refused, nothing changes in either group", async () => {
    const x = await fixtureX();
    const { goaPay } = await recordAll(x);
    const r = await setPaymentDeleted(goaPay.id, x.Mg, true);
    expect(r.ok).toBe(false);
    expect(await live(x.goa.id)).toBe(1);
    expect(await live(x.flat.id)).toBe(1);
    await expectAllZero(x);
  });

  it("X5. the Flat is closed, then Asha deletes: refused, Goa unchanged", async () => {
    const x = await fixtureX();
    const { goaPay } = await recordAll(x);
    await db.group.update({ where: { id: x.flat.id }, data: { closed: true } });
    const r = await setPaymentDeleted(goaPay.id, x.Ag, true, { memberships: { [x.goa.id]: x.Ag, [x.flat.id]: x.Af } });
    expect(r.ok).toBe(false);
    expect(await live(x.goa.id)).toBe(1);
    expect(await live(x.flat.id)).toBe(1);
  });
});

describe("X6-X8: someone who left, Ravi's own Undo, and a group that changes mid-way", () => {
  it("X6. Ravi leaves the Flat (at 0), then Asha deletes: Ravi is back in the Flat at +40000, Asha -40000; Goa as in X2", async () => {
    const x = await fixtureX();
    const { goaPay } = await recordAll(x);
    expect((await setMemberLeft(x.flat.id, x.Rf, x.Rf, true)).ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: x.Rf } })).leftAt).not.toBeNull();
    const r = await setPaymentDeleted(goaPay.id, x.Ag, true, { memberships: { [x.goa.id]: x.Ag, [x.flat.id]: x.Af } });
    expect(r.ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: x.Rf } })).leftAt).toBeNull();
    const flatNet = await netOf(x.flat.id);
    expect(flatNet).toEqual({ [x.Rf]: 40000, [x.Af]: -40000 });
    expect(sum(flatNet)).toBe(0);
    expect(await netOf(x.goa.id)).toEqual({ [x.Ag]: 100000, [x.Rg]: -100000, [x.Mg]: 0 });
  });

  it("X7. Ravi Undoes his own recording: both parts go, and both 'recorded' lines are marked undone", async () => {
    const x = await fixtureX();
    const { goaPay, flatPay } = await recordAll(x);
    const ev = await db.groupEvent.findFirstOrThrow({ where: { paymentId: goaPay.id, kind: "payment_recorded" } });
    const r = await undoEvent(ev.id, x.Rg, undefined, { memberships: x.memberships });
    expect(r.ok).toBe(true);
    expect(await live(x.goa.id)).toBe(0);
    expect(await live(x.flat.id)).toBe(0);
    for (const pid of [goaPay.id, flatPay.id]) {
      const line = await db.groupEvent.findFirstOrThrow({ where: { paymentId: pid, kind: "payment_recorded" } });
      expect(line.undoneAt).not.toBeNull();
    }
    await expectStart(x);
  });

  it("X8. the Flat is closed after the checks but before the write (a hook): neither part is deleted", async () => {
    const x = await fixtureX();
    const { goaPay, flatPay } = await recordAll(x);
    const r = await changePayment(goaPay.id, x.Ag, true, {
      memberships: { [x.goa.id]: x.Ag, [x.flat.id]: x.Af },
      afterRead: async () => {
        await db.group.update({ where: { id: x.flat.id }, data: { closed: true } });
      },
    });
    expect(r.ok).toBe(false);
    expect((await db.payment.findUniqueOrThrow({ where: { id: goaPay.id } })).deletedAt).toBeNull();
    expect((await db.payment.findUniqueOrThrow({ where: { id: flatPay.id } })).deletedAt).toBeNull();
    await expectAllZero(x);
  });
});

describe("X9-X11: other shapes", () => {
  it("X9. an even case, 40000 in each group: deleting removes both", async () => {
    const x = await fixtureX({ goaAmount: 40000, flatAmount: 40000 });
    const { goaPay } = await recordAll(x);
    await expectAllZero(x);
    expect((await setPaymentDeleted(goaPay.id, x.Ag, true, { memberships: { [x.goa.id]: x.Ag, [x.flat.id]: x.Af } })).ok).toBe(true);
    expect(await live(x.goa.id)).toBe(0);
    expect(await live(x.flat.id)).toBe(0);
    await expectStart(x);
  });

  it("X10. the same direction (Goa 100000 + Flat 50000, both Ravi -> Asha): deleting removes both and Ravi is back to -150000 in total", async () => {
    const x = await fixtureX({ goaAmount: 100000, flatAmount: 50000, flatSameWay: true });
    const { goaPay } = await recordAll(x);
    await expectAllZero(x);
    expect((await setPaymentDeleted(goaPay.id, x.Ag, true, { memberships: { [x.goa.id]: x.Ag, [x.flat.id]: x.Af } })).ok).toBe(true);
    const goaNet = await netOf(x.goa.id);
    const flatNet = await netOf(x.flat.id);
    expect(goaNet[x.Rg]).toBe(-100000);
    expect(flatNet[x.Rf]).toBe(-50000);
    expect(goaNet[x.Rg] + flatNet[x.Rf]).toBe(-150000);
  });

  it("X11. an older cross-group payment with no link: it deletes alone (the other group's part stays)", async () => {
    const x = await fixtureX();
    const goaPay = await db.$transaction((tx) => createPayment(tx, { groupId: x.goa.id, fromId: x.Rg, toId: x.Ag, amount: 100000, createdById: x.Rg }));
    const flatPay = await db.$transaction((tx) => createPayment(tx, { groupId: x.flat.id, fromId: x.Af, toId: x.Rf, amount: 40000, createdById: x.Rf }));
    for (const [gid, p, actor] of [[x.goa.id, goaPay, x.Rg], [x.flat.id, flatPay, x.Rf]] as const) {
      await db.groupEvent.create({ data: { groupId: gid, actorId: actor, kind: "payment_recorded", text: "settled (Smart Settle across groups)", paymentId: p.id, undo: JSON.stringify({ type: "payment_delete", paymentId: p.id }) } });
    }
    expect((await setPaymentDeleted(goaPay.id, x.Ag, true)).ok).toBe(true);
    expect(await live(x.goa.id)).toBe(0);
    expect(await live(x.flat.id)).toBe(1);
    expect(await netOf(x.goa.id)).toEqual({ [x.Ag]: 100000, [x.Rg]: -100000, [x.Mg]: 0 });
  });
});
