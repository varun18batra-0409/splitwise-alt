import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { loadBalancesSummary, loadGroupView } from "@/lib/group-data";
import { explainAll, explainBalance } from "@/lib/explain";
import { foreignLedgers } from "@/lib/currency-ledgers";
import { resolveSecondary } from "@/lib/secondary";
import { funTitles } from "@/lib/wrapped";
import { spentAmount } from "@/lib/payers";
import { smartSettle } from "@/lib/settle";
import { netBalances } from "@/lib/balances";
import { allocateByWeights } from "@/lib/split";
import { saveExpense, setExpenseDeleted, setPaymentDeleted } from "@/lib/save-expense";

// Speed stage 3: the Balances tab for someone still in the group reads one database statement instead of every expense and share.
// Every number must be exactly what the full method gives. Money is in paise. Hand-worked expected numbers are written out below;
// they were worked on paper (see the plan), never computed with the code under test.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let seq = 0;
const groupIds: string[] = [];
afterAll(async () => {
  await eraseGroups(groupIds);
});

async function newGroup(names: string[], extra: Partial<Prisma.GroupUncheckedCreateInput> = {}) {
  seq += 1;
  const g = await db.group.create({
    data: {
      name: `S3 ${stamp}-${seq}`,
      inviteCode: `s3-${stamp}-${seq}-${Math.random().toString(36).slice(2, 6)}`,
      currency: "INR",
      ...extra,
      members: { create: names.map((name, i) => ({ name, createdAt: new Date(Date.UTC(2026, 9, 1, 10, i)) })) },
    },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  groupIds.push(g.id);
  return { gid: g.id, ids: g.members.map((m) => m.id), nameOf: Object.fromEntries(g.members.map((m) => [m.id, m.name])) as Record<string, string> };
}
const mkExpense = (gid: string, description: string, amount: number, paidById: string, shares: [string, number][], createdAt: Date, more: Partial<Prisma.ExpenseUncheckedCreateInput> = {}) =>
  db.expense.create({
    data: {
      groupId: gid, description, splitType: "exact", amount, originalAmount: amount, convertedAmount: amount, paidById, createdById: paidById, createdAt,
      shares: { create: shares.map(([memberId, amt]) => ({ memberId, amount: amt })) },
      ...more,
    },
  });
const mkPayment = (gid: string, fromId: string, toId: string, amount: number, createdAt: Date, more: Partial<Prisma.PaymentUncheckedCreateInput> = {}) =>
  db.payment.create({ data: { groupId: gid, fromId, toId, amount, createdById: fromId, createdAt, ...more } });

// The hand-worked trip (the same one as the speed stage 2 and the plan):
//   E1  A paid 100000.   Shares A 33334, B 33333, C 33333.
//   E2  B paid 30000 and C paid 20000.   Shares 12500 each (A, B, C, D).
//   E3  Money back, 9000 received by D.   Shares A 4500, D 4500.
//   E4  C paid 70000. DELETED.
//   E5  A paid 10300 in THB (300 of it a card fee).   Shares B 5150, D 5150.
//   E6  B and C paid 5000 each.   Share A 10000.
//   P1  B pays A 20000.   P2  D pays C 5000.   P3  C pays A 99999. DELETED.
const d = (n: number, h = 10) => new Date(Date.UTC(2026, 10, n, h));
async function handTrip() {
  const g = await newGroup(["A", "B", "C", "D"]);
  const [A, B, C, D] = g.ids;
  await mkExpense(g.gid, "Hotel", 100000, A, [[A, 33334], [B, 33333], [C, 33333]], d(1));
  await mkExpense(g.gid, "Dinner", 50000, B, [A, B, C, D].map((m) => [m, 12500] as [string, number]), d(2), { payers: JSON.stringify([{ m: B, a: 30000 }, { m: C, a: 20000 }]) });
  await mkExpense(g.gid, "Returned jacket", 9000, D, [[A, 4500], [D, 4500]], d(3), { kind: "refund" });
  await mkExpense(g.gid, "Deleted taxi", 70000, C, [[A, 35000], [C, 35000]], d(4), { deletedAt: d(4, 11), deletedById: C });
  await mkExpense(g.gid, "Shopping abroad", 10300, A, [[B, 5150], [D, 5150]], d(5), { markupAmount: 300, markupBp: 300, originalCurrency: "THB", exchangeRate: "2.8", paymentMethod: "card", rateSource: "api" });
  await mkExpense(g.gid, "Boat", 10000, B, [[A, 10000]], d(6), { payers: JSON.stringify([{ m: B, a: 5000 }, { m: C, a: 5000 }]) });
  await mkPayment(g.gid, B, A, 20000, d(5, 12));
  await mkPayment(g.gid, D, C, 5000, d(5, 13));
  await mkPayment(g.gid, C, A, 99999, d(6, 12), { deletedAt: d(6, 13), deletedById: C });
  return { ...g, A, B, C, D };
}
const byName = <T,>(nameOf: Record<string, string>, o: Record<string, T>) => Object.fromEntries(Object.entries(o).map(([id, v]) => [nameOf[id], v]));
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe("the Balances summary on the hand-worked trip", () => {
  it("balances A +38966, B +4017, C -25833, D -17150; plan C>A 25833, D>A 13133, D>B 4017", async () => {
    const t = await handTrip();
    const s = (await loadBalancesSummary(t.gid, t.A))!;
    expect(s).not.toBeNull();
    expect(byName(t.nameOf, s.net)).toEqual({ A: 38966, B: 4017, C: -25833, D: -17150 });
    expect(Object.keys(s.net).map((id) => t.nameOf[id])).toEqual(["A", "B", "C", "D"]);
    expect(sum(s.net)).toBe(0);
    expect(s.transfers.map((x) => ({ from: t.nameOf[x.from], to: t.nameOf[x.to], amount: x.amount }))).toEqual([
      { from: "C", to: "A", amount: 25833 },
      { from: "D", to: "A", amount: 13133 },
      { from: "D", to: "B", amount: 4017 },
    ]);
  });

  it("Why? totals: paid, share, card fee, sent, received, lines, balance (worked by hand)", async () => {
    // A paid 100000 + 10300 = 110300; share 33334 + 12500 - 4500 (money back) + 10000 = 51334; received 20000 from B; 6 lines
    //   (Hotel, Dinner, Jacket, Shopping, Boat, B's payment). 110300 - 51334 - 20000 = +38966.
    // B paid 30000 + 5000 = 35000; share 33333 + 12500 + 5150 = 50983, of it 150 card fee (300 * 5150 / 10300); sent 20000; 5 lines. = +4017.
    // C paid 20000 + 5000 = 25000; share 33333 + 12500 = 45833; received 5000; 4 lines. = -25833.
    // D paid -9000 (money back counts negative); share 12500 - 4500 + 5150 = 13150, of it 150 fee; sent 5000; 4 lines. = -17150.
    const t = await handTrip();
    const s = (await loadBalancesSummary(t.gid, t.A))!;
    const row = (x: { paidTotal: number; shareTotal: number; feeTotal: number; sent: number; received: number; count: number; balance: number }) => x;
    expect(byName(t.nameOf, s.stmt.why)).toEqual({
      A: row({ paidTotal: 110300, shareTotal: 51334, feeTotal: 0, sent: 0, received: 20000, count: 6, balance: 38966 }),
      B: row({ paidTotal: 35000, shareTotal: 50983, feeTotal: 150, sent: 20000, received: 0, count: 5, balance: 4017 }),
      C: row({ paidTotal: 25000, shareTotal: 45833, feeTotal: 0, sent: 0, received: 5000, count: 4, balance: -25833 }),
      D: row({ paidTotal: -9000, shareTotal: 13150, feeTotal: 150, sent: 5000, received: 0, count: 4, balance: -17150 }),
    });
  });

  it("group totals: 161300 spent across 5 expenses, card-fee flag on; the Thai baht part A +10300, B -5150, C 0, D -5150, THB spent 10300", async () => {
    // Spent: 100000 + 50000 - 9000 (money back) + 10300 + 10000 = 161300. The deleted taxi never counts.
    const t = await handTrip();
    const s = (await loadBalancesSummary(t.gid, t.A))!;
    expect(s.stmt.spent).toBe(161300);
    expect(s.stmt.count).toBe(5);
    expect(s.stmt.hasMarkup).toBe(true);
    const ledgers = foreignLedgers(s.stmt.foreign, "INR", t.ids);
    expect(ledgers).toHaveLength(1);
    expect(ledgers[0].currency).toBe("THB");
    expect(ledgers[0].spent).toBe(10300);
    expect(byName(t.nameOf, ledgers[0].net)).toEqual({ A: 10300, B: -5150, C: 0, D: -5150 });
    expect(resolveSecondary("", "INR", s.stmt.foreign)).toBe("THB");
  });

  it("the slim expense list holds the 5 expenses that count and no shares; payments keep the 3 rows (one deleted)", async () => {
    const t = await handTrip();
    const s = (await loadBalancesSummary(t.gid, t.A))!;
    expect(s.expenses.map((e) => e.description).sort()).toEqual(["Boat", "Dinner", "Hotel", "Returned jacket", "Shopping abroad"]);
    expect("shares" in s.expenses[0]).toBe(false);
    expect(s.group.payments).toHaveLength(3);
    expect(s.payments).toHaveLength(2);
    expect(s.group.members.map((m) => m.name)).toEqual(["A", "B", "C", "D"]);
    expect(s.group.members[0]).toHaveProperty("addedBy"); // kept: it says who looks after the group
  });

  it("settle leaves everyone at exactly zero: after the three plan payments every balance is 0 and the plan is empty", async () => {
    const t = await handTrip();
    const s = (await loadBalancesSummary(t.gid, t.A))!;
    for (const x of s.transfers) await mkPayment(t.gid, x.from, x.to, x.amount, new Date());
    const after = (await loadBalancesSummary(t.gid, t.A))!;
    expect(Object.values(after.net).every((v) => v === 0)).toBe(true);
    expect(after.transfers).toEqual([]);
    expect(Object.values(after.stmt.why).every((w) => w.balance === 0)).toBe(true);
  });

  it("with ?why= it also brings that person's own expenses, and their item list is the same as the full method's", async () => {
    // D is in Dinner (share), Returned jacket (paid and share) and Shopping abroad (share): 3 expenses + the payment to C.
    const t = await handTrip();
    const s = (await loadBalancesSummary(t.gid, t.A, { why: t.D }))!;
    expect(s.openRows.map((e) => e.description).sort()).toEqual(["Dinner", "Returned jacket", "Shopping abroad"]);
    const full = (await loadGroupView(t.gid, { viewer: t.A, events: false }))!;
    const name = (id: string) => t.nameOf[id];
    const mine = explainBalance(t.D, s.openRows, s.payments, name);
    const theirs = explainBalance(t.D, full.expenses, full.payments, name);
    expect(mine).toEqual(theirs);
    expect(mine.lines).toHaveLength(4);
    // Not a member: ignored, nothing extra is read.
    expect((await loadBalancesSummary(t.gid, t.A, { why: "nobody" }))!.openRows).toEqual([]);
  });
});

describe("when the full method is used instead (null)", () => {
  it("someone who left, someone who is not in the group, a card night and a deleted group", async () => {
    const t = await handTrip();
    await db.member.update({ where: { id: t.D }, data: { leftAt: d(7) } });
    expect(await loadBalancesSummary(t.gid, t.D)).toBeNull(); // left: today's scoped view
    expect(await loadBalancesSummary(t.gid, t.A)).not.toBeNull(); // the others are unaffected
    expect(await loadBalancesSummary(t.gid, "someone-else")).toBeNull();
    const pot = await newGroup(["P", "Q"], { type: "pot" });
    expect(await loadBalancesSummary(pot.gid, pot.ids[0])).toBeNull();
    await db.group.update({ where: { id: t.gid }, data: { deletedAt: new Date() } });
    expect(await loadBalancesSummary(t.gid, t.A)).toBeNull();
    expect(await loadBalancesSummary("no-such-group", t.A)).toBeNull();
  });

  it("a person listed twice in one expense: falls back, and the full method still gives its numbers", async () => {
    // Dinner 9000 paid by A, B listed twice (3000 + 3000) and C once (3000). The full method's balances: A +9000, B -6000, C -3000.
    const g = await newGroup(["A", "B", "C"]);
    const [A, B, C] = g.ids;
    await mkExpense(g.gid, "Dinner", 9000, A, [[B, 3000], [B, 3000], [C, 3000]], d(1));
    expect(await loadBalancesSummary(g.gid, A)).toBeNull();
    const full = (await loadGroupView(g.gid, { viewer: A, events: false }))!;
    expect(byName(g.nameOf, full.net)).toEqual({ A: 9000, B: -6000, C: -3000 });
  });

  it("money held by someone who is not a member: falls back", async () => {
    // An expense paid by a person of ANOTHER group.
    const g = await newGroup(["A", "B"]);
    const other = await newGroup(["Z"]);
    await mkExpense(g.gid, "Odd", 1000, other.ids[0], [[g.ids[0], 500], [g.ids[1], 500]], d(1));
    expect(await loadBalancesSummary(g.gid, g.ids[0])).toBeNull();
  });

  it("a payment to yourself: the full method shows a Why? balance that is not the balance, so it falls back", async () => {
    const g = await newGroup(["A", "B"]);
    await mkExpense(g.gid, "Lunch", 1000, g.ids[0], [[g.ids[0], 500], [g.ids[1], 500]], d(1));
    await mkPayment(g.gid, g.ids[1], g.ids[1], 300, d(2));
    expect(await loadBalancesSummary(g.gid, g.ids[0])).toBeNull();
  });

  it("an amount above the whole-number fee limit (100000000 paise) falls back", async () => {
    const g = await newGroup(["A", "B"]);
    await mkExpense(g.gid, "Villa", 100_000_002, g.ids[0], [[g.ids[0], 50_000_001], [g.ids[1], 50_000_001]], d(1));
    expect(await loadBalancesSummary(g.gid, g.ids[0])).toBeNull();
  });
});

describe("edge cases, worked by hand", () => {
  it("card fee rounding: a 10-paise expense paid by A with a 1-paise fee, shares B 5 and C 5: fee B 1, C 1 (half rounds up)", async () => {
    // 1 * 5 / 10 = 0.5, which Math.round (and the database's (2*1*5+10)/(2*10) = 1) takes up to 1. Balances A +10, B -5, C -5.
    const g = await newGroup(["A", "B", "C"]);
    const [A, B, C] = g.ids;
    await mkExpense(g.gid, "Tiny", 10, A, [[B, 5], [C, 5]], d(1), { markupAmount: 1, markupBp: 300, paymentMethod: "card", originalCurrency: "USD" });
    const s = (await loadBalancesSummary(g.gid, A))!;
    expect(s).not.toBeNull();
    expect(byName(g.nameOf, s.net)).toEqual({ A: 10, B: -5, C: -5 });
    expect(sum(s.net)).toBe(0);
    expect(s.stmt.why[B].feeTotal).toBe(1);
    expect(s.stmt.why[C].feeTotal).toBe(1);
    expect(s.stmt.why[A].feeTotal).toBe(0);
    expect(s.stmt.why[B].shareTotal).toBe(5);
  });

  it("fee rounding below the half: 3 paise of fee on 100, share 33 -> 0.99 -> 1; share 10 -> 0.3 -> 0; share 16 -> 0.48 -> 0", async () => {
    const g = await newGroup(["A", "B", "C", "D"]);
    const [A, B, C, D] = g.ids;
    await mkExpense(g.gid, "Fee", 100, A, [[B, 33], [C, 10], [D, 57]], d(1), { markupAmount: 3, markupBp: 300, paymentMethod: "card", originalCurrency: "USD" });
    const s = (await loadBalancesSummary(g.gid, A))!;
    expect(s.stmt.why[B].feeTotal).toBe(1); // 3 * 33 / 100 = 0.99
    expect(s.stmt.why[C].feeTotal).toBe(0); // 3 * 10 / 100 = 0.3
    expect(s.stmt.why[D].feeTotal).toBe(2); // 3 * 57 / 100 = 1.71
  });

  it("a share of 0 gives no line, as in the full method", async () => {
    const g = await newGroup(["A", "B", "C"]);
    await mkExpense(g.gid, "Zero", 1000, g.ids[0], [[g.ids[0], 500], [g.ids[1], 500], [g.ids[2], 0]], d(1));
    const s = (await loadBalancesSummary(g.gid, g.ids[0]))!;
    expect(s.stmt.why[g.ids[2]].count).toBe(0);
    expect(s.stmt.why[g.ids[1]].count).toBe(1);
    expect(s.stmt.why[g.ids[0]].count).toBe(1); // paid and shared: one line
  });

  it("an empty group: everything 0, nothing spent", async () => {
    const g = await newGroup(["A", "B"]);
    const s = (await loadBalancesSummary(g.gid, g.ids[0]))!;
    expect(s.net).toEqual({ [g.ids[0]]: 0, [g.ids[1]]: 0 });
    expect(s.stmt).toMatchObject({ spent: 0, count: 0, hasMarkup: false, foreign: [] });
    expect(s.transfers).toEqual([]);
  });
});

describe("no stale balance: every open reads the database again", () => {
  const rate = async () => ({ ok: true as const, rate: "1", date: "2026-11-10" });
  const input = (gid: string, name: string, amount: string, paidById: string) => ({
    groupId: gid, name, category: "", amount, currency: "INR", paidById, forMode: "everyone" as const, selected: [], onePersonId: "", splitType: "equal" as const,
    exact: {}, percent: {}, paymentMethod: "cash" as const, markupChoice: "group" as const, markupCustom: "", rateMode: "auto" as const, manualRate: "",
  });

  it("save an expense, record a payment, delete both: the new figures show at once each time", async () => {
    // A, B, C. A pays 90.00 for everyone: shares 30.00 each. A +6000, B -3000, C -3000 (paise).
    // B pays A 30.00: A +3000, B 0, C -3000. Delete the payment: back to A +6000, B -3000, C -3000. Delete the expense: all 0.
    const g = await newGroup(["A", "B", "C"]);
    const [A, B, C] = g.ids;
    expect(Object.values((await loadBalancesSummary(g.gid, A))!.net)).toEqual([0, 0, 0]);
    const saved = await saveExpense(input(g.gid, "Dinner", "90", A), A, rate, { requestKey: `s3-${stamp}-1` });
    expect(saved.ok).toBe(true);
    expect((await loadBalancesSummary(g.gid, A))!.net).toEqual({ [A]: 6000, [B]: -3000, [C]: -3000 });
    const p = await mkPayment(g.gid, B, A, 3000, new Date());
    expect((await loadBalancesSummary(g.gid, A))!.net).toEqual({ [A]: 3000, [B]: 0, [C]: -3000 });
    expect((await setPaymentDeleted(p.id, B, true)).ok).toBe(true);
    expect((await loadBalancesSummary(g.gid, A))!.net).toEqual({ [A]: 6000, [B]: -3000, [C]: -3000 });
    const exp = await db.expense.findFirstOrThrow({ where: { groupId: g.gid, description: "Dinner" } });
    expect((await setExpenseDeleted(exp.id, A, true)).ok).toBe(true);
    expect((await loadBalancesSummary(g.gid, A))!.net).toEqual({ [A]: 0, [B]: 0, [C]: 0 });
    // And back (an undo restores it).
    expect((await setExpenseDeleted(exp.id, A, false)).ok).toBe(true);
    const back = (await loadBalancesSummary(g.gid, A))!;
    expect(back.net).toEqual({ [A]: 6000, [B]: -3000, [C]: -3000 });
    expect(back.stmt.count).toBe(1);
    expect(back.stmt.spent).toBe(9000);
  });
});

// ---- Old method vs new method on 50 random groups ----
// A small seeded generator, so a failure can be repeated exactly.
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("the new method equals the full method on 50 random groups", () => {
  it("net, plan, Why? totals, other-currency parts, second currency, spent, count, card-fee flag and fun titles are identical; the rules always hold", async () => {
    const rnd = mulberry(20261119);
    const int = (n: number) => Math.floor(rnd() * n);
    const chance = (p: number) => rnd() < p;
    for (let round = 0; round < 50; round++) {
      const size = 2 + int(5);
      const names = Array.from({ length: size }, (_, i) => `M${i}`);
      const g = await newGroup(names);
      const ids = g.ids;
      const expenses = 3 + int(10);
      for (let i = 0; i < expenses; i++) {
        const amount = 1 + int(5_000_000);
        const paidById = ids[int(size)];
        const shareIds = ids.filter(() => chance(0.6));
        const who = shareIds.length ? shareIds : [ids[int(size)]];
        const shares: [string, number][] = allocateByWeights(amount, who.map((memberId) => ({ memberId, weight: 1 + int(5) }))).map((s) => [s.memberId, s.amount]);
        if (chance(0.1)) shares.push([ids[int(size)], 0]); // a person with a share of 0
        const more: Partial<Prisma.ExpenseUncheckedCreateInput> = { description: `E${i}`, category: ["food", "transport", "accommodation", "activities", "shopping"][int(5)], createdById: ids[int(size)] };
        if (chance(0.25) && size > 1) {
          // several payers; sometimes a list that does not add up (the full method keeps the proportions)
          const [a, b] = [ids[int(size)], ids[(int(size - 1) + 1 + ids.indexOf(paidById)) % size]];
          const first = Math.max(1, Math.floor(amount * (0.2 + rnd() * 0.6)));
          const second = chance(0.2) ? Math.max(1, Math.floor((amount - first) * 0.9)) : amount - first;
          if (a !== b && second > 0) more.payers = JSON.stringify([{ m: a, a: first }, { m: b, a: second }]);
        }
        const kind = chance(0.12) ? "refund" : chance(0.04) ? "pot" : "expense";
        let amountSaved = amount;
        if (chance(0.3)) {
          const cur = chance(0.5) ? "THB" : "USD";
          const original = Math.max(1, Math.round(amount / 2.8));
          more.originalCurrency = cur;
          more.originalAmount = original;
          if (chance(0.5)) { more.markupAmount = Math.round((amount * 3) / 103); more.markupBp = 300; more.paymentMethod = "card"; }
        }
        if (chance(0.1)) { more.deletedAt = d(20); more.deletedById = paidById; }
        more.kind = kind;
        await mkExpense(g.gid, `E${i}`, amountSaved, paidById, shares, new Date(Date.UTC(2026, 10, 1, 8, i)), more);
      }
      for (let i = 0; i < int(6); i++) {
        const from = ids[int(size)];
        const to = ids[(ids.indexOf(from) + 1 + int(size - 1)) % size];
        await mkPayment(g.gid, from, to, 1 + int(200000), new Date(Date.UTC(2026, 10, 2, 8, i)), chance(0.15) ? { deletedAt: d(21), deletedById: from } : {});
      }

      const viewer = ids[0];
      const old = (await loadGroupView(g.gid, { viewer, events: false }))!;
      const now = await loadBalancesSummary(g.gid, viewer);
      expect(now, `round ${round} must not need the full method`).not.toBeNull();
      const s = now!;
      const tag = `round ${round}`;

      expect(Object.entries(s.net), tag).toEqual(Object.entries(old.net));
      expect(s.transfers, tag).toEqual(old.transfers);
      expect(s.stmt.why, tag).toEqual(explainAll(ids, old.expenses, old.payments));
      expect(foreignLedgers(s.stmt.foreign, "INR", ids), tag).toEqual(foreignLedgers(old.expenses, "INR", ids));
      expect(resolveSecondary("", "INR", s.stmt.foreign), tag).toBe(resolveSecondary("", "INR", old.expenses));
      expect(s.stmt.spent, tag).toBe(old.expenses.reduce((a, e) => a + spentAmount(e), 0));
      expect(s.stmt.count, tag).toBe(old.expenses.length);
      expect(s.stmt.hasMarkup, tag).toBe(old.expenses.some((e) => e.markupAmount > 0));
      expect(funTitles(s.expenses, ids, "Asia/Kolkata", "INR"), tag).toEqual(funTitles(old.expenses, ids, "Asia/Kolkata", "INR"));
      expect(s.payments.map((p) => p.id), tag).toEqual(old.payments.map((p) => p.id));
      expect(s.expenses.map((e) => e.id), tag).toEqual(old.expenses.map((e) => e.id));

      // The rules that must always hold.
      expect(sum(s.net), tag).toBe(0);
      for (const id of ids) expect(s.stmt.why[id].balance, `${tag} Why? balance`).toBe(s.net[id]);
      for (const l of foreignLedgers(s.stmt.foreign, "INR", ids)) expect(sum(l.net), `${tag} ${l.currency}`).toBe(0);
      for (const e of old.expenses) expect(e.shares.reduce((a, x) => a + x.amount, 0), tag).toBe(e.amount);
      expect(sum(netBalances(ids, old.expenses, old.payments)), tag).toBe(0);
      expect(smartSettle(s.net), tag).toEqual(s.transfers);
    }
  }, 180_000);
});
