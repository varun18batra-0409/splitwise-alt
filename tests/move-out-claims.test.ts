import { afterAll, describe, expect, it, vi } from "vitest";

// FB-1 / AS-2 / OB-3 (16 Nov line review), with FB-4 and FB-2.
//
// FB-1: someone who owed money could move themselves out of the flat, and the debt was marked "paid" with nobody confirming it: the person
//   owed had no way to say "not received". Now, when the person squaring up is the one PAYING and the person paid has joined (can tap
//   Confirm received), the final payment is an "I've paid" note (a claim, source "move_out"): it counts only when that person confirms it.
//   A name nobody has joined can't confirm anything, so that payment is recorded at once, as before.
// OB-3: the same thing seen from the other side: an admin marks the leaver out when THEY owe the leaver; their payment to the leaver is a note too.
// FB-4: the move-out page posts the payments it showed (expectKey); if they changed since, the move-out is refused.
// FB-2: a bill's freed share is shared only among people still in the flat (someone who moved out earlier keeps exactly what they had).
// Throwaway database; amounts in paise, every number worked by hand.

vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { netBalances } = await import("@/lib/balances");
const { moveOut, moveOutPreview, MOVE_OUT_KEY_CHANGED, MOVE_OUT_WAITING_NOTE, transfersKey } = await import("@/lib/home/moving-db");
const { confirmClaim, declineClaim, makeClaim } = await import("@/lib/payment-claims");
const { undoEvent } = await import("@/lib/undo");
const { moveOutConfirm } = await import("@/lib/move-confirm");
const { PAIR_NO_MOVE_OUT } = await import("@/lib/direct-guard");
const { ensureLocalPair } = await import("@/lib/direct-db");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;
const NOW = new Date("2026-11-10T06:00:00Z");
const NOW20 = new Date("2026-11-20T06:00:00Z");
const key = () => `moc-${stamp}-${++n}-abcdefgh`;

afterAll(async () => {
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `moc-${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}

// A flat. `people`: name and whether they have joined (an account and a "joined" time) or are only a name.
async function flat(people: { name: string; joined: boolean }[]) {
  const accounts = await Promise.all(people.map((p) => (p.joined ? account(p.name) : Promise.resolve(null))));
  const g = await db.group.create({
    data: {
      name: `Move claims ${++n} ${stamp}`, type: "home", currency: "INR", inviteCode: `moc-${n}-${stamp}`,
      members: {
        create: people.map((p, i) => ({
          name: p.name, splitWeight: 100, createdAt: new Date(2026, 0, i + 1),
          ...(accounts[i] ? { accountId: accounts[i]!.id, claimedAt: new Date(2026, 0, i + 1) } : {}),
        })),
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  const expense = (description: string, amount: number, paidById: string, shares: [string, number][]) =>
    db.expense.create({
      data: {
        groupId: g.id, description, category: "other", amount, paidById, createdById: paidById, splitType: "equal", forMode: "selected",
        originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount, spentAt: new Date("2026-11-01T12:00:00Z"),
        shares: { create: shares.map(([memberId, a]) => ({ memberId, amount: a })) },
      },
    });
  // A bill's expense for a month (so a move-out re-splits it).
  const billExpense = async (name: string, amount: number, paidById: string, shares: [string, number][]) => {
    const e = await expense(name, amount, paidById, shares);
    const b = await db.bill.create({ data: { groupId: g.id, name, nature: "fixed", amount, day: 1, startMonth: "2026-11", payer: paidById } });
    await db.billRun.create({ data: { billId: b.id, period: "2026-11", status: "added", expenseId: e.id } });
    return e;
  };
  const net = async () => {
    const x = await db.group.findUniqueOrThrow({ where: { id: g.id }, include: { members: true, expenses: { where: { deletedAt: null }, include: { shares: true } }, payments: { where: { deletedAt: null } } } });
    return netBalances(x.members.map((m) => m.id), x.expenses, x.payments);
  };
  const sharesOf = async (expenseId: string) => Object.fromEntries((await db.expenseShare.findMany({ where: { expenseId } })).map((s) => [s.memberId, s.amount]));
  const payments = () => db.payment.findMany({ where: { groupId: g.id, deletedAt: null } });
  const claims = () => db.paymentClaim.findMany({ where: { groupId: g.id }, orderBy: { createdAt: "asc" } });
  const row = (memberId: string) => db.member.findUniqueOrThrow({ where: { id: memberId } });
  return { gid: g.id, id, expense, billExpense, net, sharesOf, payments, claims, row };
}
const sum = (x: Record<string, number>) => Object.values(x).reduce((a, b) => a + b, 0);
const out = (gid: string, actor: string, leaver: string, extra: { lastDay?: string; expectKey?: string } = {}, now = NOW) =>
  moveOut(gid, actor, { leaverId: leaver, lastDay: extra.lastDay ?? "2026-11-10", requestKey: key(), ...(extra.expectKey !== undefined ? { expectKey: extra.expectKey } : {}) }, now);

// F2: Asha and Ravi, both joined. Groceries 1200000 paid by Ravi, all of it Asha's share: Ravi +1200000, Asha -1200000.
async function f2() {
  const f = await flat([{ name: "Asha", joined: true }, { name: "Ravi", joined: true }]);
  const [A, R] = [f.id("Asha"), f.id("Ravi")];
  await f.expense("Groceries", 1200000, R, [[A, 1200000]]);
  expect(await f.net()).toEqual({ [A]: -1200000, [R]: 1200000 });
  return { f, A, R };
}

describe("FB-1: moving yourself out while you owe someone who has joined", () => {
  it("1. Asha moves out owing 1200000: no payment, one waiting note Asha -> Ravi, she is marked as left, balances unchanged", async () => {
    const { f, A, R } = await f2();
    const r = await out(f.gid, A, A);
    expect(r.ok).toBe(true);
    expect(await f.payments()).toHaveLength(0);
    const cs = await f.claims();
    expect(cs).toHaveLength(1);
    expect([cs[0].fromId, cs[0].toId, cs[0].amount, cs[0].status, cs[0].source]).toEqual([A, R, 1200000, "waiting", "move_out"]);
    expect((await f.row(A)).leftAt).not.toBeNull();
    const nets = await f.net();
    expect(nets).toEqual({ [A]: -1200000, [R]: 1200000 });
    expect(sum(nets)).toBe(0);
    // The history says what happened, in words that don't claim it was paid.
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.gid, kind: "member_left" } });
    expect(ev.details).toContain("Asha says they paid Ravi ₹12,000.00 (waiting for Ravi to confirm)");
    expect(await db.groupEvent.count({ where: { groupId: f.gid, kind: "payment_claimed" } })).toBe(1);
    expect(await db.groupEvent.count({ where: { groupId: f.gid, kind: "payment_recorded" } })).toBe(0);
  });

  it("2. Ravi says 'Not received': the note is declined, nothing was paid, balances unchanged", async () => {
    const { f, A, R } = await f2();
    expect((await out(f.gid, A, A)).ok).toBe(true);
    const c = (await f.claims())[0];
    expect((await declineClaim(c.id, R)).ok).toBe(true);
    expect((await f.claims())[0].status).toBe("declined");
    expect(await f.payments()).toHaveLength(0);
    expect(await f.net()).toEqual({ [A]: -1200000, [R]: 1200000 });
  });

  it("3. Ravi confirms instead: one payment of 1200000, confirmed, balances 0 / 0 (Asha has left, and ends at 0: allowed)", async () => {
    const { f, A, R } = await f2();
    expect((await out(f.gid, A, A)).ok).toBe(true);
    const c = (await f.claims())[0];
    expect((await confirmClaim(c.id, R)).ok).toBe(true);
    const pays = await f.payments();
    expect(pays).toHaveLength(1);
    expect([pays[0].fromId, pays[0].toId, pays[0].amount, pays[0].needsOk, pays[0].okAt !== null]).toEqual([A, R, 1200000, true, true]);
    const nets = await f.net();
    expect(nets).toEqual({ [A]: 0, [R]: 0 });
    expect(sum(nets)).toBe(0);
  });

  it("4. Ravi is only a name (no account, never joined): nobody could confirm, so the payment is recorded at once, no note, balances 0 / 0 (unchanged behaviour)", async () => {
    const f = await flat([{ name: "Asha", joined: true }, { name: "Ravi", joined: false }]);
    const [A, R] = [f.id("Asha"), f.id("Ravi")];
    await f.expense("Groceries", 1200000, R, [[A, 1200000]]);
    expect((await out(f.gid, A, A)).ok).toBe(true);
    const pays = await f.payments();
    expect(pays.map((p) => [p.fromId, p.toId, p.amount])).toEqual([[A, R, 1200000]]);
    expect(await f.claims()).toHaveLength(0);
    expect(await f.net()).toEqual({ [A]: 0, [R]: 0 });
  });

  it("5. OB-3: Varun marks Asha out when Varun owes HER 80000: a note Varun -> Asha, not a counted payment; Asha (who has left) confirms: 0 / 0", async () => {
    const f = await flat([{ name: "Asha", joined: true }, { name: "Varun", joined: true }]);
    const [A, V] = [f.id("Asha"), f.id("Varun")];
    await f.expense("Cab", 80000, A, [[V, 80000]]); // Asha +80000, Varun -80000
    expect(await f.net()).toEqual({ [A]: 80000, [V]: -80000 });
    expect((await out(f.gid, V, A)).ok).toBe(true);
    expect(await f.payments()).toHaveLength(0);
    const cs = await f.claims();
    expect(cs.map((c) => [c.fromId, c.toId, c.amount, c.status])).toEqual([[V, A, 80000, "waiting"]]);
    expect(await f.net()).toEqual({ [A]: 80000, [V]: -80000 });
    expect((await confirmClaim(cs[0].id, A)).ok).toBe(true); // the receiver confirms even though she has left
    expect(await f.net()).toEqual({ [A]: 0, [V]: 0 });
  });

  it("6. two people are owed: Asha owes Ravi 40000 and Meera 30000 -> two notes; each confirm brings her closer to 0 and never past it", async () => {
    const f = await flat([{ name: "Asha", joined: true }, { name: "Ravi", joined: true }, { name: "Meera", joined: true }]);
    const [A, R, M] = [f.id("Asha"), f.id("Ravi"), f.id("Meera")];
    await f.expense("Milk", 40000, R, [[A, 40000]]);
    await f.expense("Gas", 30000, M, [[A, 30000]]);
    expect(await f.net()).toEqual({ [A]: -70000, [R]: 40000, [M]: 30000 });
    expect((await out(f.gid, A, A)).ok).toBe(true);
    const cs = await f.claims();
    expect(cs.map((c) => [c.fromId, c.toId, c.amount]).sort()).toEqual([[A, R, 40000], [A, M, 30000]].sort());
    expect(await f.payments()).toHaveLength(0);
    const toRavi = cs.find((c) => c.toId === R)!;
    const toMeera = cs.find((c) => c.toId === M)!;
    expect((await confirmClaim(toRavi.id, R)).ok).toBe(true); // Asha -70000 -> -30000: closer to 0, allowed for a move-out note
    expect(await f.net()).toEqual({ [A]: -30000, [R]: 0, [M]: 30000 });
    expect((await confirmClaim(toMeera.id, M)).ok).toBe(true);
    const done = await f.net();
    expect(done).toEqual({ [A]: 0, [R]: 0, [M]: 0 });
    expect(sum(done)).toBe(0);
  });

  it("7. a waiting 'I've paid' already involves the person: the move-out is refused, nothing changes (and the preview says so)", async () => {
    const { f, A, R } = await f2();
    const made = await makeClaim({ groupId: f.gid, fromId: A, toId: R, actorId: A, source: "app" });
    expect(made.ok).toBe(true);
    const r = await out(f.gid, A, A);
    expect(r).toEqual({ ok: false, error: MOVE_OUT_WAITING_NOTE });
    expect((await f.row(A)).leftAt).toBeNull();
    expect(await f.claims()).toHaveLength(1);
    expect(await f.payments()).toHaveLength(0);
    expect(await moveOutPreview(f.gid, A, "2026-11-10", NOW, A)).toEqual({ ok: false, error: MOVE_OUT_WAITING_NOTE });
    // Also when the note is the other way round (Ravi says he paid Asha): it involves her too.
    const g2 = await f2();
    await db.paymentClaim.create({ data: { groupId: g2.f.gid, fromId: g2.R, toId: g2.A, amount: 100, currency: "INR", source: "app", status: "waiting", slot: "" } });
    expect(await out(g2.f.gid, g2.A, g2.A)).toEqual({ ok: false, error: MOVE_OUT_WAITING_NOTE });
  });

  it("the preview and the confirm question say the payment waits for the person paid (and plain payments keep their old words)", async () => {
    const { f, A, R } = await f2();
    const p = await moveOutPreview(f.gid, A, "2026-11-10", NOW, A);
    if (!p.ok) throw new Error(p.error);
    expect(p.payments).toEqual([{ from: A, to: R, amount: 1200000 }]);
    expect(p.waits).toEqual([`${A}>${R}`]);
    const nameOf = (id: string) => (id === A ? "You" : "Ravi");
    const money = (x: number) => `₹${x / 100}`;
    expect(moveOutConfirm({ leaverName: "you", payments: [{ from: A, to: R, amount: 1200000, waits: true }], nameOf, money })).toBe(
      "Final payments: You pay Ravi ₹12000 (Ravi confirms it before it counts). Everyone is told. Mark yourself as moved out?",
    );
    expect(moveOutConfirm({ leaverName: "you", payments: [{ from: A, to: R, amount: 1200000 }], nameOf, money })).toBe(
      "Final payments: You pay Ravi ₹12000. They are recorded as paid and everyone is told. Mark yourself as moved out?",
    );
    // Seen by someone else (no `actorId`): nothing waits, as the actor isn't the one paying.
    const other = await moveOutPreview(f.gid, A, "2026-11-10", NOW);
    if (!other.ok) throw new Error(other.error);
    expect(other.waits).toEqual([]);
  });
});

describe("FB-1: the full flat (rent, Wi-Fi, a note, undo)", () => {
  // Meera, Ravi, Asha: Rent 900000 paid by Meera (300000 each); Wi-Fi 100000 paid by Asha (33334 / 33333 / 33333).
  //   Before: Meera +566666, Ravi -333333, Asha -233333.
  //   Asha moves out on 10 Nov (10 of 30 days): she keeps floor(300000 x 10 / 30) = 100000 of the rent and floor(33333 x 10 / 30) = 11111 of Wi-Fi.
  //   Rent: 200000 freed, 100000 each to Meera and Ravi. Wi-Fi: 22222 freed, split 33334 : 33333 -> Meera 11111, Ravi 11111 (Ravi has the larger remainder).
  //   After: Meera +455555, Ravi -444444, Asha -11111, and the note Asha -> Meera 11111 (Meera is the only one owed).
  async function world() {
    const f = await flat([{ name: "Meera", joined: true }, { name: "Ravi", joined: true }, { name: "Asha", joined: true }]);
    const [M, R, S] = [f.id("Meera"), f.id("Ravi"), f.id("Asha")];
    const rent = await f.billExpense("Rent", 900000, M, [[M, 300000], [R, 300000], [S, 300000]]);
    const wifi = await f.billExpense("Wi-Fi", 100000, S, [[M, 33334], [R, 33333], [S, 33333]]);
    expect(await f.net()).toEqual({ [M]: 566666, [R]: -333333, [S]: -233333 });
    const r = await out(f.gid, S, S);
    if (!r.ok) throw new Error(r.error);
    expect(await f.sharesOf(rent.id)).toEqual({ [M]: 400000, [R]: 400000, [S]: 100000 });
    expect(await f.sharesOf(wifi.id)).toEqual({ [M]: 44445, [R]: 44444, [S]: 11111 });
    expect(await f.net()).toEqual({ [M]: 455555, [R]: -444444, [S]: -11111 });
    expect((await f.claims()).map((c) => [c.fromId, c.toId, c.amount, c.status])).toEqual([[S, M, 11111, "waiting"]]);
    expect(await f.payments()).toHaveLength(0);
    return { f, M, R, S, rent, wifi, moveOutEventId: r.eventId! };
  }

  it("8a. Asha undoes before anyone confirms: the note is withdrawn, shares are back (300000 x 3 and 33334 / 33333 / 33333), balances are the starting ones", async () => {
    const { f, M, R, S, rent, wifi, moveOutEventId } = await world();
    expect((await undoEvent(moveOutEventId, S)).ok).toBe(true);
    expect((await f.claims())[0].status).toBe("withdrawn");
    expect(await f.sharesOf(rent.id)).toEqual({ [M]: 300000, [R]: 300000, [S]: 300000 });
    expect(await f.sharesOf(wifi.id)).toEqual({ [M]: 33334, [R]: 33333, [S]: 33333 });
    const back = await f.net();
    expect(back).toEqual({ [M]: 566666, [R]: -333333, [S]: -233333 });
    expect(sum(back)).toBe(0);
    expect((await f.row(S)).leftAt).toBeNull();
    const rejoined = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.gid, kind: "member_rejoined" } });
    expect(rejoined.details).toContain("Taken back: Asha said they paid Meera ₹111.11");
  });

  it("8b. Meera confirms first, then Asha undoes: the payment stays (real money); shares go back; Meera +555555, Ravi -333333, Asha -222222", async () => {
    const { f, M, R, S, rent, wifi, moveOutEventId } = await world();
    const c = (await f.claims())[0];
    expect((await confirmClaim(c.id, M)).ok).toBe(true);
    expect(await f.net()).toEqual({ [M]: 444444, [R]: -444444, [S]: 0 });
    expect((await undoEvent(moveOutEventId, S)).ok).toBe(true);
    expect((await f.claims())[0].status).toBe("confirmed"); // not withdrawn
    expect(await f.payments()).toHaveLength(1); // its payment stays
    expect(await f.sharesOf(rent.id)).toEqual({ [M]: 300000, [R]: 300000, [S]: 300000 });
    expect(await f.sharesOf(wifi.id)).toEqual({ [M]: 33334, [R]: 33333, [S]: 33333 });
    const after = await f.net();
    expect(after).toEqual({ [M]: 555555, [R]: -333333, [S]: -222222 }); // the start, less Asha's 11111 that Meera confirmed getting
    expect(sum(after)).toBe(0);
  });
});

describe("FB-4: the move-out refuses payments that are not the ones the person saw", () => {
  it("9. the key is for Asha -> Ravi 1200000; Ravi then adds Cab 30000 shared by Asha; the old key is refused, nothing recorded; the new key works", async () => {
    const { f, A, R } = await f2();
    const p = await moveOutPreview(f.gid, A, "2026-11-10", NOW, A);
    if (!p.ok) throw new Error(p.error);
    expect(p.expectKey).toBe(transfersKey([{ from: A, to: R, amount: 1200000 }]));
    expect(p.expectKeyDaily).toBe(p.expectKey); // no daily bills here
    await f.expense("Cab", 30000, R, [[A, 30000]]); // Asha now owes 1230000
    expect(await out(f.gid, A, A, { expectKey: p.expectKey })).toEqual({ ok: false, error: MOVE_OUT_KEY_CHANGED });
    expect((await f.row(A)).leftAt).toBeNull();
    expect(await f.claims()).toHaveLength(0);
    expect(await f.payments()).toHaveLength(0);
    // Looking again gives the new key, and that goes through.
    const again = await moveOutPreview(f.gid, A, "2026-11-10", NOW, A);
    if (!again.ok) throw new Error(again.error);
    expect(again.payments).toEqual([{ from: A, to: R, amount: 1230000 }]);
    expect((await out(f.gid, A, A, { expectKey: again.expectKey })).ok).toBe(true);
    expect((await f.claims()).map((c) => c.amount)).toEqual([1230000]);
  });

  it("an empty key is a key too (a square person has no payments), and no key at all (older callers) skips the check", async () => {
    const f = await flat([{ name: "Asha", joined: true }, { name: "Ravi", joined: true }]);
    const [A, R] = [f.id("Asha"), f.id("Ravi")];
    expect(transfersKey([])).toBe("");
    expect((await out(f.gid, A, A, { expectKey: "" })).ok).toBe(true);
    expect((await f.row(A)).leftAt).not.toBeNull();
    expect(R).toBeTruthy();
  });

  it("the move-out action refuses a form that has no key at all (a page opened before this change)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/bill-actions.ts", "utf8");
    expect(src).toContain('formData.get(addDaily ? "expectKeyDaily" : "expectKey")');
    expect(src).toContain("if (expectKey === null)");
    const page = readFileSync("src/app/groups/[id]/people/[memberId]/move/page.tsx", "utf8");
    expect(page).toContain('name="expectKey"');
    expect(page).toContain('name="expectKeyDaily"');
  });
});

describe("FB-2: the freed share of a bill goes only to people still in the flat", () => {
  it("10. Rent 3000000 paid by A, shares A 1200000 / B 1000000 / C 800000: C leaves, then B leaves; C keeps exactly 266666 and the shares always add up", async () => {
    const f = await flat([{ name: "A", joined: false }, { name: "B", joined: false }, { name: "C", joined: false }]);
    const [A, B, C] = [f.id("A"), f.id("B"), f.id("C")];
    const rent = await f.billExpense("Rent", 3000000, A, [[A, 1200000], [B, 1000000], [C, 800000]]);
    const total = async () => Object.values(await f.sharesOf(rent.id)).reduce((x, y) => x + y, 0);
    expect(await f.net()).toEqual({ [A]: 1800000, [B]: -1000000, [C]: -800000 });

    // C leaves on 10 Nov (actor A): keeps floor(800000 x 10 / 30) = 266666; 533334 freed, split 1200000 : 1000000 -> A 290909, B 242425 (B has the larger remainder).
    expect((await out(f.gid, A, C, {}, NOW20)).ok).toBe(true);
    expect(await f.sharesOf(rent.id)).toEqual({ [A]: 1490909, [B]: 1242425, [C]: 266666 });
    expect(await total()).toBe(3000000);
    // C owed 266666: he pays A (recorded at once: C is not the actor and nobody can confirm a plain name's side): C 0, A +1509091 - 266666 = +1242425.
    expect(await f.net()).toEqual({ [A]: 1242425, [B]: -1242425, [C]: 0 });

    // B leaves on 20 Nov (actor A): keeps floor(1242425 x 20 / 30) = 828283; 414142 freed -> ALL to A (C has left): A 1905051. C stays at 266666.
    expect((await out(f.gid, A, B, { lastDay: "2026-11-20" }, NOW20)).ok).toBe(true);
    expect(await f.sharesOf(rent.id)).toEqual({ [A]: 1905051, [B]: 828283, [C]: 266666 });
    expect(await total()).toBe(3000000);
    // B owed 828283 and paid A: everyone 0. (Before B's payment: A +828283, B -828283, C 0.)
    const done = await f.net();
    expect(done).toEqual({ [A]: 0, [B]: 0, [C]: 0 });
    expect(sum(done)).toBe(0);
    const pays = (await f.payments()).map((p) => [p.fromId, p.toId, p.amount]).sort();
    expect(pays).toEqual([[C, A, 266666], [B, A, 828283]].sort());
  });
});

describe("guards that must not weaken", () => {
  it("a pair (two people, no group) still refuses moving out, with or without a key", async () => {
    const a = await account("PairAsha");
    const p = await ensureLocalPair({ id: a.id }, "Rohan", { currency: "INR", myName: "PairAsha" });
    if (!p.ok) throw new Error("refused");
    groupIds.push(p.groupId);
    expect(await moveOut(p.groupId, p.myId, { leaverId: p.myId, lastDay: "2026-11-10", requestKey: key() }, NOW)).toEqual({ ok: false, error: PAIR_NO_MOVE_OUT });
    expect(await moveOut(p.groupId, p.myId, { leaverId: p.otherId, lastDay: "2026-11-10", requestKey: key(), expectKey: "" }, NOW)).toEqual({ ok: false, error: PAIR_NO_MOVE_OUT });
    expect(await moveOutPreview(p.groupId, p.myId, "2026-11-10", NOW, p.myId)).toEqual({ ok: false, error: PAIR_NO_MOVE_OUT });
    expect(await db.member.count({ where: { groupId: p.groupId, leftAt: { not: null } } })).toBe(0);
    expect(await db.paymentClaim.count({ where: { groupId: p.groupId } })).toBe(0);
  });
});
