import { afterAll, describe, expect, it, vi } from "vitest";

// "I've paid" notes (claims): two rules tightened on 16 Nov (line review).
//   MB-2: someone who has LEFT can't be moved by a confirm. Confirming a note records a payment, so if the payer or the person paid has left, the
//         payment may only leave their balance where it was, or at 0 (no exceptions: a move-out no longer makes notes, see
//         tests/move-out-claims.test.ts). A note that can't be confirmed is closed ("expired") so it doesn't hang around.
//   MB-7: a payment closes a waiting note as "covered" only when it is AT LEAST the note's amount. A smaller one used to close the whole note,
//         so the rest could never be confirmed. And when a covering payment is taken off ("Not received", delete), the note is waiting again.
// Throwaway database; paise, worked out by hand. Cast: Asha (A), Ravi (R), Meera (M), all joined.

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { netBalances } = await import("@/lib/balances");
const { createPayment } = await import("@/lib/payments");
const { confirmClaim, makeClaim } = await import("@/lib/payment-claims");
const { rejectPayment } = await import("@/lib/payment-ok");
const { setPaymentDeleted } = await import("@/lib/save-expense");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groups: string[] = [];
let counter = 0;
afterAll(async () => {
  await eraseGroups(groups);
});

// A group where `amount` was paid by Asha for Ravi alone (Ravi owes Asha `amount`).
async function world(amount: number) {
  const n = ++counter;
  const g = await db.group.create({
    data: {
      name: `Claims rules ${n} ${stamp}`, currency: "INR", inviteCode: `cr-${n}-${stamp}`,
      members: { create: [{ name: "Asha", claimedAt: new Date() }, { name: "Ravi", claimedAt: new Date() }, { name: "Meera", claimedAt: new Date() }] },
    },
    include: { members: true },
  });
  groups.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  const [a, r, m] = [id("Asha"), id("Ravi"), id("Meera")];
  const exp = await db.expense.create({
    data: { groupId: g.id, description: "Spend", amount, splitType: "equal", paidById: a, createdById: a, originalAmount: amount, convertedAmount: amount, shares: { create: [{ memberId: r, amount }] } },
  });
  const net = async () => {
    const [members, expenses, payments] = await Promise.all([
      db.member.findMany({ where: { groupId: g.id }, select: { id: true } }),
      db.expense.findMany({ where: { groupId: g.id, deletedAt: null }, include: { shares: true } }),
      db.payment.findMany({ where: { groupId: g.id, deletedAt: null } }),
    ]);
    return netBalances(members.map((x) => x.id), expenses, payments);
  };
  const payCount = () => db.payment.count({ where: { groupId: g.id, deletedAt: null } });
  const claim = async () => {
    const c = await makeClaim({ groupId: g.id, fromId: r, toId: a, actorId: r, source: "app" });
    if (!c.ok) throw new Error(c.error);
    return c.claimId;
  };
  const status = async (claimId: string) => (await db.paymentClaim.findUniqueOrThrow({ where: { id: claimId } })).status;
  return { gid: g.id, a, r, m, exp, net, payCount, claim, status };
}
const sum = (n: Record<string, number>) => Object.values(n).reduce((x, y) => x + y, 0);

describe("MB-2: confirming a note can't move someone who has left", () => {
  it("Dinner 50000 (Ravi's share), Ravi's note is 50000; Dinner is then edited so Ravi owes nothing and he leaves: Asha's 'Confirm anyway' is refused, the note closes, nothing recorded", async () => {
    const w = await world(50000);
    const claimId = await w.claim();
    // The Dinner is edited: Ravi's share 0 (Asha now has it all). Ravi 0, Asha 0. Then Ravi leaves, square.
    await db.expenseShare.deleteMany({ where: { expenseId: w.exp.id } });
    await db.expenseShare.create({ data: { expenseId: w.exp.id, memberId: w.a, amount: 50000 } });
    await db.member.update({ where: { id: w.r }, data: { leftAt: new Date() } });
    expect(await w.net()).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });
    // Confirming would put Ravi at +50000 (0 + 50000: not where he was, not 0): refused, with the "confirm anyway" tap too.
    expect(await confirmClaim(claimId, w.a, { over: true })).toEqual({ ok: false, error: "Ravi has left the group, so this can’t be confirmed." });
    expect(await w.status(claimId)).toBe("expired");
    expect(await w.payCount()).toBe(0);
    expect(await w.net()).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });
  });

  it("a leaver who owes exactly the note's amount may be confirmed to 0 (-50000 + 50000 = 0): allowed", async () => {
    const w = await world(50000);
    const claimId = await w.claim();
    await db.member.update({ where: { id: w.r }, data: { leftAt: new Date() } }); // left owing 50000 (Ravi -50000, Asha +50000)
    expect((await confirmClaim(claimId, w.a)).ok).toBe(true);
    const n = await w.net();
    expect(n).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });
    expect(sum(n)).toBe(0);
    expect(await w.payCount()).toBe(1);
  });

  it("a PART note for a leaver (20000 of -50000 would leave -30000) is refused: a leaver may only end where they were, or at 0 (no exception for any note)", async () => {
    const w = await world(50000);
    await db.member.update({ where: { id: w.r }, data: { leftAt: new Date() } });
    const part = await db.paymentClaim.create({ data: { groupId: w.gid, fromId: w.r, toId: w.a, amount: 20000, currency: "INR", source: "app", status: "waiting", slot: "" } });
    expect(await confirmClaim(part.id, w.a, { over: true })).toEqual({ ok: false, error: "Ravi has left the group, so this can’t be confirmed." });
    expect(await w.status(part.id)).toBe("expired");
    expect(await w.net()).toEqual({ [w.a]: 50000, [w.r]: -50000, [w.m]: 0 });
    // A note that goes PAST 0 is refused too: 70000 on a leaver at -50000 would leave Ravi at +20000.
    const past = await db.paymentClaim.create({ data: { groupId: w.gid, fromId: w.r, toId: w.a, amount: 70000, currency: "INR", source: "app", status: "waiting", slot: "" } });
    expect((await confirmClaim(past.id, w.a, { over: true })).ok).toBe(false);
    expect(await w.status(past.id)).toBe("expired");
    expect(await w.net()).toEqual({ [w.a]: 50000, [w.r]: -50000, [w.m]: 0 });
  });

  it("nobody has left: nothing changes (a normal confirm)", async () => {
    const w = await world(50000);
    const claimId = await w.claim();
    expect((await confirmClaim(claimId, w.a)).ok).toBe(true);
    expect(await w.net()).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });
  });
});

describe("MB-7: a smaller payment doesn't close a bigger note", () => {
  it("Hotel 500000 (Ravi's share), Ravi's note is 500000; Asha records receiving 50000: the note stays waiting, Ravi owes 450000, and confirming says 'more than owed' by 50000", async () => {
    const w = await world(500000);
    const claimId = await w.claim();
    await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.r, toId: w.a, amount: 50000, createdById: w.a }));
    expect(await w.status(claimId)).toBe("waiting");
    expect(await w.net()).toEqual({ [w.a]: 450000, [w.r]: -450000, [w.m]: 0 });
    const asked = await confirmClaim(claimId, w.a);
    expect(asked).toEqual({ ok: false, error: "More than what’s owed.", over: 50000 }); // 500000 claimed - 450000 owed
    expect(await w.payCount()).toBe(1);
  });

  it("a payment equal to the note covers it (500000 = 500000), and confirming then records nothing more", async () => {
    const w = await world(500000);
    const claimId = await w.claim();
    await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.r, toId: w.a, amount: 500000, createdById: w.a }));
    expect(await w.status(claimId)).toBe("covered");
    expect((await confirmClaim(claimId, w.a)).ok).toBe(false);
    expect(await w.payCount()).toBe(1);
  });

  it("a smaller payment that is deleted and then restored doesn't close the note either", async () => {
    const w = await world(500000);
    const claimId = await w.claim();
    const small = await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.r, toId: w.a, amount: 50000, createdById: w.m }));
    expect((await setPaymentDeleted(small.id, w.m, true)).ok).toBe(true);
    expect((await setPaymentDeleted(small.id, w.m, false)).ok).toBe(true);
    expect(await w.status(claimId)).toBe("waiting");
  });

  it("Meera records Ravi's 500000 (the note is covered); Asha taps 'Not received': the note is waiting again; Asha confirms: nets 0 / 0 / 0 and exactly one payment counts", async () => {
    const w = await world(500000);
    const claimId = await w.claim();
    const meera = await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.r, toId: w.a, amount: 500000, createdById: w.m, needsOk: true }));
    expect(await w.status(claimId)).toBe("covered");
    expect(await w.net()).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });
    expect((await rejectPayment(meera.id, w.a)).ok).toBe(true);
    expect(await w.net()).toEqual({ [w.a]: 500000, [w.r]: -500000, [w.m]: 0 });
    const back = await db.paymentClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect([back.status, back.slot, back.paymentId]).toEqual(["waiting", "", ""]);
    expect((await confirmClaim(claimId, w.a)).ok).toBe(true);
    const n = await w.net();
    expect(n).toEqual({ [w.a]: 0, [w.r]: 0, [w.m]: 0 });
    expect(sum(n)).toBe(0);
    expect(await w.payCount()).toBe(1); // Meera's is off; the confirmed one counts
  });

  it("the note is NOT reopened when another note for the same pair is already waiting (only one may wait)", async () => {
    const w = await world(500000);
    const claimId = await w.claim();
    const meera = await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.r, toId: w.a, amount: 500000, createdById: w.m, needsOk: true }));
    expect(await w.status(claimId)).toBe("covered");
    const other = await db.paymentClaim.create({ data: { groupId: w.gid, fromId: w.r, toId: w.a, amount: 500000, currency: "INR", source: "app", status: "waiting", slot: "" } });
    expect((await rejectPayment(meera.id, w.a)).ok).toBe(true);
    expect(await w.status(claimId)).toBe("covered");
    expect(await w.status(other.id)).toBe("waiting");
  });

  it("deleting the covering payment from Activity also reopens the note", async () => {
    const w = await world(500000);
    const claimId = await w.claim();
    const p = await db.$transaction((tx) => createPayment(tx, { groupId: w.gid, fromId: w.r, toId: w.a, amount: 500000, createdById: w.m }));
    expect(await w.status(claimId)).toBe("covered");
    expect((await setPaymentDeleted(p.id, w.m, true)).ok).toBe(true);
    expect(await w.status(claimId)).toBe("waiting");
    expect(await w.net()).toEqual({ [w.a]: 500000, [w.r]: -500000, [w.m]: 0 });
  });
});
