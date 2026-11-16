import { afterAll, describe, expect, it, vi } from "vitest";

// Batch C data step: the "I've paid" notes still waiting on the live app are dealt with once, right after the deploy (the code is
// src/lib/convert-claims.ts, the command is scripts/convert-waiting-claims.ts, and nothing here touches a real database).
// A note that can safely count becomes a counted payment; every other note is closed with a history line asking to record it again.
// Throwaway database; paise, worked by hand.
//
// Fixture: Asha and Ravi. Hotel 50000 paid by Asha, all of it Ravi's share: Asha +50000, Ravi -50000, so Ravi owes Asha 50000.

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { netBalances } = await import("@/lib/balances");
const { convertWaitingClaims, undoConvertedClaims } = await import("@/lib/convert-claims");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
let n = 0;

afterAll(async () => {
  await eraseGroups(groupIds);
});

async function fixture(o: { closed?: boolean; currency?: string; ravi?: { leftAt?: Date } } = {}) {
  const g = await db.group.create({
    data: {
      name: `Convert ${++n} ${stamp}`, type: "trip", currency: o.currency ?? "INR", inviteCode: `cv-${n}-${stamp}`, closed: o.closed ?? false,
      members: { create: [{ name: "Asha", claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, { name: "Ravi", claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2), ...(o.ravi?.leftAt ? { leftAt: o.ravi.leftAt } : {}) }] },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const A = g.members.find((m) => m.name === "Asha")!.id;
  const R = g.members.find((m) => m.name === "Ravi")!.id;
  await db.expense.create({
    data: {
      groupId: g.id, description: "Hotel", category: "other", amount: 50000, paidById: A, createdById: A, splitType: "exact", forMode: "selected",
      originalAmount: 50000, originalCurrency: g.currency, baseCurrency: g.currency, convertedAmount: 50000, spentAt: new Date("2026-11-01T12:00:00Z"),
      shares: { create: [{ memberId: R, amount: 50000 }] },
    },
  });
  const claim = (amount: number, currency = g.currency) => db.paymentClaim.create({ data: { groupId: g.id, fromId: R, toId: A, amount, currency, source: "app", status: "waiting", slot: "" } });
  const net = async () => {
    const x = await db.group.findUniqueOrThrow({ where: { id: g.id }, include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } } });
    return netBalances(x.members.map((m) => m.id), x.expenses, x.payments);
  };
  const payments = () => db.payment.findMany({ where: { groupId: g.id } });
  const events = () => db.groupEvent.findMany({ where: { groupId: g.id } });
  return { gid: g.id, A, R, claim, net, payments, events };
}
const run = (gid: string, apply: boolean) => convertWaitingClaims({ apply, groupIds: [gid], now: new Date("2026-11-20T06:00:00Z") });

describe("converting the notes still waiting", () => {
  it("(1) a note for exactly what is owed (50000) becomes one counted payment from Ravi to Asha; the note is covered and points at it; balances 0 / 0", async () => {
    const f = await fixture();
    const note = await f.claim(50000);
    const s = await run(f.gid, true);
    expect([s.waiting, s.converted, s.expired, s.failed]).toEqual([1, 1, 0, 0]);
    const pays = await f.payments();
    expect(pays).toHaveLength(1);
    expect([pays[0].fromId, pays[0].toId, pays[0].amount, pays[0].needsOk, pays[0].createdById, pays[0].deletedAt]).toEqual([f.R, f.A, 50000, false, f.R, null]);
    const after = await db.paymentClaim.findUniqueOrThrow({ where: { id: note.id } });
    expect([after.status, after.paymentId, after.slot]).toEqual(["covered", pays[0].id, note.id]);
    expect(await f.net()).toEqual({ [f.A]: 0, [f.R]: 0 });
    const line = (await f.events()).find((e) => e.kind === "payment_recorded");
    expect(line?.paymentId).toBe(pays[0].id);
    expect(line?.text).toContain("(from an earlier “I’ve paid”)");
    expect(s.changes).toEqual([{ claimId: note.id, kind: "converted", paymentId: pays[0].id, eventId: line!.id }]);
  });

  it("(2) a note for more than is owed (60000 against 50000) is closed as expired with a 'record it again' line; nothing else changes", async () => {
    const f = await fixture();
    const note = await f.claim(60000);
    const s = await run(f.gid, true);
    expect([s.converted, s.expired, s.reasons]).toEqual([0, 1, { "more-than-owed": 1 }]);
    expect(await f.payments()).toHaveLength(0);
    expect((await db.paymentClaim.findUniqueOrThrow({ where: { id: note.id } })).status).toBe("expired");
    expect(await f.net()).toEqual({ [f.A]: 50000, [f.R]: -50000 });
    const line = (await f.events()).find((e) => e.kind === "payment_note_closed");
    expect(line?.text).toContain("I’ve paid ₹600");
    expect(line?.text).toContain("Record it again if it was paid.");
  });

  it("(3) a closed group: the note is expired (nothing can be recorded in a closed group)", async () => {
    const f = await fixture({ closed: true });
    await f.claim(50000);
    const s = await run(f.gid, true);
    expect([s.converted, s.expired, s.reasons]).toEqual([0, 1, { "group-closed": 1 }]);
    expect(await f.payments()).toHaveLength(0);
  });

  it("(4) a note in USD in a rupee group: expired (the amounts are not in the same money)", async () => {
    const f = await fixture();
    await f.claim(50000, "USD");
    const s = await run(f.gid, true);
    expect([s.converted, s.expired, s.reasons]).toEqual([0, 1, { currency: 1 }]);
    expect(await f.payments()).toHaveLength(0);
  });

  it("(4b) someone has left: expired (a person who has left always shows 0, so nothing is recorded with them)", async () => {
    const f = await fixture({ ravi: { leftAt: new Date("2026-11-05T00:00:00Z") } });
    await f.claim(50000);
    const s = await run(f.gid, true);
    expect([s.converted, s.expired, s.reasons]).toEqual([0, 1, { "person-left": 1 }]);
    expect(await f.payments()).toHaveLength(0);
  });

  it("(5) running it twice: still one payment (the second run finds nothing waiting)", async () => {
    const f = await fixture();
    await f.claim(50000);
    expect((await run(f.gid, true)).converted).toBe(1);
    const again = await run(f.gid, true);
    expect([again.waiting, again.converted, again.expired]).toEqual([0, 0, 0]);
    expect(await f.payments()).toHaveLength(1);
    expect(await f.net()).toEqual({ [f.A]: 0, [f.R]: 0 });
  });

  it("(6) a dry run says what would happen and writes nothing: the note still waits, no payment, no history line", async () => {
    const f = await fixture();
    const note = await f.claim(50000);
    const eventsBefore = (await f.events()).length;
    const s = await run(f.gid, false);
    expect([s.apply, s.waiting, s.converted, s.expired, s.changes]).toEqual([false, 1, 1, 0, []]);
    expect(await f.payments()).toHaveLength(0);
    expect((await db.paymentClaim.findUniqueOrThrow({ where: { id: note.id } })).status).toBe("waiting");
    expect((await f.events()).length).toBe(eventsBefore);
    expect(await f.net()).toEqual({ [f.A]: 50000, [f.R]: -50000 });
  });
});

describe("putting a conversion back", () => {
  it("the undo file's ids put a converted note back: the payment is taken off, the note waits again, the history line is marked undone; a dry run changes nothing", async () => {
    const f = await fixture();
    const note = await f.claim(50000);
    const s = await run(f.gid, true);
    const dry = await undoConvertedClaims(s.changes, { apply: false });
    expect(dry).toEqual({ apply: false, putBack: 1, skipped: 0 });
    expect(await f.payments().then((p) => p.filter((x) => !x.deletedAt))).toHaveLength(1);
    const done = await undoConvertedClaims(s.changes, { apply: true });
    expect(done).toEqual({ apply: true, putBack: 1, skipped: 0 });
    expect((await f.payments()).filter((p) => !p.deletedAt)).toHaveLength(0);
    const back = await db.paymentClaim.findUniqueOrThrow({ where: { id: note.id } });
    expect([back.status, back.paymentId, back.slot]).toEqual(["waiting", "", ""]);
    expect(await f.net()).toEqual({ [f.A]: 50000, [f.R]: -50000 });
    expect((await f.events()).find((e) => e.kind === "payment_recorded")?.undoneAt).not.toBeNull();
    // Putting back twice changes nothing more.
    expect(await undoConvertedClaims(s.changes, { apply: true })).toEqual({ apply: true, putBack: 0, skipped: 1 });
  });
});
