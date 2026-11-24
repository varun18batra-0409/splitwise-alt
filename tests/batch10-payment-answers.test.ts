import { afterAll, describe, expect, it, vi } from "vitest";

// Batch 10 (L33): "Got it" and "Not received" report what was actually saved. Money display only: the ledger is whatever the winner wrote.
// Scene (hand-worked): Asha and Ravi share a flat; Groceries 1200000 paid by Ravi, all Asha's share: Asha -1200000, Ravi +1200000.
// Asha moves out: one payment Asha -> Ravi of 1200000 that asks Ravi. Confirmed it stays: Asha 0, Ravi 0 (it counts).
// Not received: the payment comes off, Asha is back at -1200000, Ravi +1200000. Either way the balances add up to 0.

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { netBalances } = await import("@/lib/balances");
const { moveOut } = await import("@/lib/home/moving-db");
const { confirmPayment, rejectPayment, SAID_GOT_IT, SAID_NOT_RECEIVED } = await import("@/lib/payment-ok");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;
const NOW = new Date("2026-11-10T06:00:00Z");

afterAll(async () => {
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function scene() {
  const accts = [];
  for (const name of ["Asha", "Ravi"]) {
    const a = await db.account.create({ data: { email: `b10p-${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
    accountIds.push(a.id);
    accts.push(a);
  }
  const g = await db.group.create({
    data: {
      name: `Answers ${n} ${stamp}`, type: "home", currency: "INR", inviteCode: `b10p-${n}-${stamp}`,
      members: { create: accts.map((a, i) => ({ name: a.name, splitWeight: 100, createdAt: new Date(2026, 0, i + 1), accountId: a.id, claimedAt: new Date(2026, 0, i + 1) })) },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const A = g.members.find((m) => m.name === "Asha")!.id;
  const R = g.members.find((m) => m.name === "Ravi")!.id;
  await db.expense.create({
    data: {
      groupId: g.id, description: "Groceries", category: "other", amount: 1200000, paidById: R, createdById: R, splitType: "equal", forMode: "selected",
      originalAmount: 1200000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 1200000, spentAt: new Date("2026-11-01T12:00:00Z"),
      shares: { create: [{ memberId: A, amount: 1200000 }] },
    },
  });
  const moved = await moveOut(g.id, A, { leaverId: A, lastDay: "2026-11-10", requestKey: `b10p-${stamp}-${n}-abcdefgh` }, NOW);
  expect(moved.ok).toBe(true);
  const payment = await db.payment.findFirstOrThrow({ where: { groupId: g.id, deletedAt: null } });
  expect([payment.fromId, payment.toId, payment.amount, payment.needsOk]).toEqual([A, R, 1200000, true]);
  const net = async () => {
    const x = await db.group.findUniqueOrThrow({ where: { id: g.id }, include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } } });
    return netBalances(x.members.map((m) => m.id), x.expenses, x.payments);
  };
  const row = () => db.payment.findUniqueOrThrow({ where: { id: payment.id } });
  const events = (kind: string) => db.groupEvent.count({ where: { groupId: g.id, kind, paymentId: payment.id } });
  return { gid: g.id, A, R, payment, net, row, events };
}
const sum = (x: Record<string, number>) => Object.values(x).reduce((a, b) => a + b, 0);

describe("L33: the loser of 'Got it' / 'Not received' is told what was really saved", () => {
  it("'Not received' lands while 'Got it' is under way: Got it is told 'off the balances'; the ledger is Asha -1200000, Ravi +1200000 (sum 0)", async () => {
    const s = await scene();
    const r = await confirmPayment(s.payment.id, s.R, { afterRead: async () => void expect((await rejectPayment(s.payment.id, s.R)).ok).toBe(true) });
    expect(r).toEqual({ ok: false, error: SAID_NOT_RECEIVED });
    expect(SAID_NOT_RECEIVED).toBe("You already said you didn’t get this, so it’s off the balances.");
    expect((await s.row()).deletedAt).not.toBeNull();
    expect((await s.row()).okAt).toBeNull();
    const nets = await s.net();
    expect(nets).toEqual({ [s.A]: -1200000, [s.R]: 1200000 });
    expect(sum(nets)).toBe(0);
    expect(await s.events("payment_confirmed")).toBe(0);
  });

  it("'Got it' lands while 'Not received' is under way: Not received is told 'it still counts'; the ledger is Asha 0, Ravi 0 (sum 0)", async () => {
    const s = await scene();
    const r = await rejectPayment(s.payment.id, s.R, { afterRead: async () => void expect((await confirmPayment(s.payment.id, s.R)).ok).toBe(true) });
    expect(r).toEqual({ ok: false, error: SAID_GOT_IT });
    expect(SAID_GOT_IT).toBe("You already said you got this, so it still counts. If that was a mistake, delete it from the activity.");
    const p = await s.row();
    expect(p.deletedAt).toBeNull();
    expect(p.okAt).not.toBeNull();
    const nets = await s.net();
    expect(nets).toEqual({ [s.A]: 0, [s.R]: 0 });
    expect(sum(nets)).toBe(0);
    expect(await s.events("payment_deleted")).toBe(0);
    expect((await db.member.findUniqueOrThrow({ where: { id: s.A } })).leftAt).not.toBeNull(); // Asha was not brought back
  });

  it("the same answer twice at once is a retry, not an error: one line in the history each", async () => {
    const a = await scene();
    expect((await confirmPayment(a.payment.id, a.R, { afterRead: async () => void expect((await confirmPayment(a.payment.id, a.R)).ok).toBe(true) })).ok).toBe(true);
    expect(await a.events("payment_confirmed")).toBe(1);
    expect(await a.net()).toEqual({ [a.A]: 0, [a.R]: 0 });

    const b = await scene();
    const r = await rejectPayment(b.payment.id, b.R, { afterRead: async () => void expect((await rejectPayment(b.payment.id, b.R)).ok).toBe(true) });
    expect(r.ok).toBe(true);
    expect(await b.events("payment_deleted")).toBe(1);
    expect(await b.net()).toEqual({ [b.A]: -1200000, [b.R]: 1200000 });
  });

  it("answering again after the fact (no race) keeps its older wording, and the ledger is unchanged", async () => {
    const s = await scene();
    expect((await confirmPayment(s.payment.id, s.R)).ok).toBe(true);
    const late = await rejectPayment(s.payment.id, s.R);
    expect(late).toEqual({ ok: false, error: "You already confirmed this one. Delete it from the activity if it was a mistake." });
    expect(await s.net()).toEqual({ [s.A]: 0, [s.R]: 0 });
  });
});
