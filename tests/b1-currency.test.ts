import { describe, expect, it } from "vitest";
import { netBalances } from "@/lib/balances";
import { keepSquareAtZero, rebaseExpense, rebasePayment, type SquareExpense, type SquarePayment } from "@/lib/rebase";
import { convertAmount } from "@/lib/conversion";
import { allocateByWeights } from "@/lib/split";
import { payersJson } from "@/lib/payers";
import { initialFromExpense } from "@/lib/expense-initial";
import { parseAmount } from "@/lib/money";

// Money batch B1, part 2: changing the group's currency must keep everyone who is settled up (or has left) at exactly 0.
// Everything is in minor units. The pure tests come first (no database); the database tests are below the marker.
//
// Hand-worked examples E1-E4 (the group is in rupees, so 100 rupees = 10000 paise):
//  E1 Dinner 10000 paid by A, shares A 3334, R 3333, C 3333; R and C each paid A 3333; everyone at 0. USD at 0.0119:
//     the total is 10000 x 0.0119 = 119 cents; shared 3334:3333:3333 that is 40, 40, 39. Each payment 3333 x 0.0119 = 39.66 -> 40.
//     A = +119 - 40 - 40 - 40 = -1, R = -40 + 40 = 0, C = -39 + 40 = +1. A must go up 1 and C down 1:
//     move one cent from A's share to C's: shares A 39, R 40, C 40, payments 40 and 40: A = 119 - 39 - 80 = 0, R = 0, C = -40 + 40 = 0.
//  E2 The same dinner, only C paid A 3333 (A +3333, R -3333, C 0), and C has left. JPY at 1.7: total 170, shares 57, 57, 56
//     (3334:3333:3333), payment 3333 x 1.7 / 100 = 56.66 -> 57. A = 170 - 57 - 57 = +56, R = -57, C = -56 + 57 = +1.
//     C must go down 1: move one yen from A's share to C's: A 56, R 57, C 57: A = 170 - 56 - 57 = +57, R = -57, C = -57 + 57 = 0.
//  E3 Taxi 10000 paid by A for R 3334, C 3333, D 3333; each repaid A. USD 0.0119: total 119, shares 40, 40, 39 (R, C, D); payments
//     3334 x 0.0119 = 39.67 -> 40, 3333 -> 40, 3333 -> 40. A = 119 - 120 = -1, D = -39 + 40 = +1. A has no share to move, so:
//     D's payment to A goes 40 -> 39: A = 119 - 119 = 0, D = -39 + 39 = 0.
//  E4 The same shape for 1 rupee (100 paise, shares 34, 33, 33). JPY 1.7: total 1.7 -> 2 yen, shares 1, 1, 0, payments
//     34 x 1.7 / 100 = 0.58 -> 1, 0.56 -> 1, 0.56 -> 1. A = 2 - 3 = -1, D = +1. No payment is at least 2 and A has no share,
//     so nothing can move: refused (the group stays in rupees).

type Row = { id: string; paidById: string; payers?: { memberId: string; amount: number }[]; kind?: "expense" | "refund"; at: number; shares: [string, number][]; itemSplit?: boolean };
type Pay = { id: string; from: string; to: string; amount: number; at: number };

function run(people: { id: string; left?: boolean }[], rows: Row[], pays: Pay[], newBase: string, rate: string) {
  const before: SquareExpense[] = rows.map((r) => ({
    id: r.id, createdAt: r.at, kind: r.kind ?? "expense", paidById: r.paidById, payers: r.payers ? payersJson(r.payers) : "",
    amount: r.shares.reduce((s, x) => s + x[1], 0), itemSplit: r.itemSplit,
    shares: r.shares.map(([memberId, amount], i) => ({ id: `${r.id}-s${i}`, memberId, amount })),
  }));
  const beforePays: SquarePayment[] = pays.map((p) => ({ id: p.id, createdAt: p.at, fromId: p.from, toId: p.to, amount: p.amount }));
  const after: SquareExpense[] = [];
  for (const e of before) {
    const r = rebaseExpense(
      { originalAmount: e.amount, originalCurrency: "INR", exchangeRate: "1", markupBp: 0, markupAmount: 0, payers: e.payers, shares: e.shares },
      "INR", newBase, rate,
    );
    if (!r) return { null: true as const, before, after, beforePays, afterPays: [] as SquarePayment[], result: null };
    after.push({ ...e, amount: r.amount, payers: r.payers, shares: e.shares.map((s) => ({ ...s, amount: r.shares.find((x) => x.id === s.id)!.amount })) });
  }
  const afterPays: SquarePayment[] = [];
  for (const p of beforePays) {
    const a = rebasePayment(p.amount, "INR", newBase, rate);
    if (a === null || a <= 0) return { null: true as const, before, after, beforePays, afterPays, result: null };
    afterPays.push({ ...p, amount: a });
  }
  const result = keepSquareAtZero({
    members: people.map((p) => ({ id: p.id, left: Boolean(p.left) })),
    before: { expenses: before, payments: beforePays },
    after: { expenses: after, payments: afterPays },
    convert: (a) => rebasePayment(a, "INR", newBase, rate),
  });
  return { null: false as const, before, after, beforePays, afterPays, result };
}
const netsOf = (ids: string[], rows: SquareExpense[], pays: SquarePayment[], result: { shares: Record<string, number>; payments: Record<string, number> } | null) =>
  netBalances(
    ids,
    rows.map((e) => ({ ...e, shares: e.shares.map((s) => ({ memberId: s.memberId, amount: result ? result.shares[s.id] : s.amount })) })),
    pays.map((p) => ({ ...p, amount: result ? result.payments[p.id] : p.amount })),
  );

describe("1. keepSquareAtZero: the hand-worked examples", () => {
  it("E1: shares A 40, R 40, C 39 -> A 39, R 40, C 40; payments stay 40, 40; everyone 0", () => {
    const rows: Row[] = [{ id: "d", paidById: "A", at: 1, shares: [["A", 3334], ["R", 3333], ["C", 3333]] }];
    const pays: Pay[] = [{ id: "p1", from: "R", to: "A", amount: 3333, at: 2 }, { id: "p2", from: "C", to: "A", amount: 3333, at: 3 }];
    const r = run([{ id: "A" }, { id: "R" }, { id: "C" }], rows, pays, "USD", "0.0119");
    expect(r.after[0].amount).toBe(119);
    expect(r.after[0].shares.map((s) => s.amount)).toEqual([40, 40, 39]);
    expect(r.afterPays.map((p) => p.amount)).toEqual([40, 40]);
    expect(netsOf(["A", "R", "C"], r.after, r.afterPays, null)).toEqual({ A: -1, R: 0, C: 1 });
    expect(r.result!.shares).toEqual({ "d-s0": 39, "d-s1": 40, "d-s2": 40 });
    expect(r.result!.payments).toEqual({ p1: 40, p2: 40 });
    expect(netsOf(["A", "R", "C"], r.after, r.afterPays, r.result)).toEqual({ A: 0, R: 0, C: 0 });
  });

  it("E2: C has left and was +1 yen; one yen of A's share moves to C: A +57, R -57, C 0", () => {
    const rows: Row[] = [{ id: "d", paidById: "A", at: 1, shares: [["A", 3334], ["R", 3333], ["C", 3333]] }];
    const pays: Pay[] = [{ id: "p", from: "C", to: "A", amount: 3333, at: 2 }];
    const r = run([{ id: "A" }, { id: "R" }, { id: "C", left: true }], rows, pays, "JPY", "1.7");
    expect(r.after[0].amount).toBe(170);
    expect(r.after[0].shares.map((s) => s.amount)).toEqual([57, 57, 56]);
    expect(r.afterPays.map((p) => p.amount)).toEqual([57]);
    expect(netsOf(["A", "R", "C"], r.after, r.afterPays, null)).toEqual({ A: 56, R: -57, C: 1 });
    expect(r.result!.shares).toEqual({ "d-s0": 56, "d-s1": 57, "d-s2": 57 });
    expect(r.result!.payments).toEqual({ p: 57 });
    expect(netsOf(["A", "R", "C"], r.after, r.afterPays, r.result)).toEqual({ A: 57, R: -57, C: 0 });
  });

  it("E3: A has no share, so D's payment to A goes 40 -> 39 and everyone is 0", () => {
    const rows: Row[] = [{ id: "t", paidById: "A", at: 1, shares: [["R", 3334], ["C", 3333], ["D", 3333]] }];
    const pays: Pay[] = [{ id: "p1", from: "R", to: "A", amount: 3334, at: 2 }, { id: "p2", from: "C", to: "A", amount: 3333, at: 3 }, { id: "p3", from: "D", to: "A", amount: 3333, at: 4 }];
    const r = run([{ id: "A" }, { id: "R" }, { id: "C" }, { id: "D" }], rows, pays, "USD", "0.0119");
    expect(r.after[0].shares.map((s) => s.amount)).toEqual([40, 40, 39]);
    expect(r.afterPays.map((p) => p.amount)).toEqual([40, 40, 40]);
    expect(netsOf(["A", "R", "C", "D"], r.after, r.afterPays, null)).toEqual({ A: -1, R: 0, C: 0, D: 1 });
    expect(r.result!.payments).toEqual({ p1: 40, p2: 40, p3: 39 });
    expect(r.result!.shares).toEqual({ "t-s0": 40, "t-s1": 40, "t-s2": 39 });
    expect(netsOf(["A", "R", "C", "D"], r.after, r.afterPays, r.result)).toEqual({ A: 0, R: 0, C: 0, D: 0 });
  });

  it("E4: the same for 1 rupee has no move at all: null (refused)", () => {
    const rows: Row[] = [{ id: "t", paidById: "A", at: 1, shares: [["R", 34], ["C", 33], ["D", 33]] }];
    const pays: Pay[] = [{ id: "p1", from: "R", to: "A", amount: 34, at: 2 }, { id: "p2", from: "C", to: "A", amount: 33, at: 3 }, { id: "p3", from: "D", to: "A", amount: 33, at: 4 }];
    const r = run([{ id: "A" }, { id: "R" }, { id: "C" }, { id: "D" }], rows, pays, "JPY", "1.7");
    expect(r.after[0].amount).toBe(2);
    expect(r.after[0].shares.map((s) => s.amount)).toEqual([1, 1, 0]);
    expect(r.afterPays.map((p) => p.amount)).toEqual([1, 1, 1]);
    expect(netsOf(["A", "R", "C", "D"], r.after, r.afterPays, null)).toEqual({ A: -1, R: 0, C: 0, D: 1 });
    expect(r.result).toBeNull();
  });

  it("money back (a refund) nudges the other way: its shares are credits", () => {
    // Refund of 10000 paid out by A (A gets the money), shared A 3334, R 3333, C 3333; R and C each pay A 3333 back... nets before:
    // credits are the shares, debits the payer: A = +3334 - 10000 = -6666, R = +3333, C = +3333; payments R->A 3333, C->A 3333 give
    // A = -6666 - 6666... so use payments the other way: A pays R 3333 and C 3333: A = -6666 + 6666 = 0, R = 3333 - 3333 = 0, C = 0.
    const rows: Row[] = [{ id: "f", paidById: "A", kind: "refund", at: 1, shares: [["A", 3334], ["R", 3333], ["C", 3333]] }];
    const pays: Pay[] = [{ id: "p1", from: "A", to: "R", amount: 3333, at: 2 }, { id: "p2", from: "A", to: "C", amount: 3333, at: 3 }];
    const ids = ["A", "R", "C"];
    const r = run(ids.map((id) => ({ id })), rows, pays, "USD", "0.0119");
    expect(netsOf(ids, r.before, r.beforePays, null)).toEqual({ A: 0, R: 0, C: 0 });
    // After plain converting: total 119, shares 40, 40, 39 (A, R, C), payments 40, 40: A = 40 - 119 + 80 = +1, R = 40 - 40 = 0, C = 39 - 40 = -1.
    expect(netsOf(ids, r.after, r.afterPays, null)).toEqual({ A: 1, R: 0, C: -1 });
    // A must come down 1 and C up 1: C's share 39 -> 40 and A's 40 -> 39 (a refund's share is a credit).
    expect(r.result!.shares).toEqual({ "f-s0": 39, "f-s1": 40, "f-s2": 40 });
    expect(netsOf(ids, r.after, r.afterPays, r.result)).toEqual({ A: 0, R: 0, C: 0 });
  });

  it("a card game's result is never touched; item-split expenses are used only when nothing else works", () => {
    // Two plain-looking dinners; the item-split one is listed first but must be tried last. Both could carry the move from A to C.
    const rows: Row[] = [
      { id: "i", paidById: "A", at: 1, itemSplit: true, shares: [["A", 3334], ["R", 3333], ["C", 3333]] },
      { id: "d", paidById: "A", at: 2, shares: [["A", 3334], ["R", 3333], ["C", 3333]] },
    ];
    const pays: Pay[] = [
      { id: "p1", from: "R", to: "A", amount: 6666, at: 3 },
      { id: "p2", from: "C", to: "A", amount: 6666, at: 4 },
    ];
    const ids = ["A", "R", "C"];
    const r = run(ids.map((id) => ({ id })), rows, pays, "USD", "0.0119");
    expect(r.result).not.toBeNull();
    expect(netsOf(ids, r.after, r.afterPays, r.result)).toEqual({ A: 0, R: 0, C: 0 });
    // the item-split dinner's shares are unchanged from plain converting
    expect(["i-s0", "i-s1", "i-s2"].map((k) => r.result!.shares[k])).toEqual(r.after[0].shares.map((s) => s.amount));
  });
});

// A small seeded random generator (mulberry32), so a failure can be replayed.
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A random group: people, expenses of every kind, and payments that settle some people exactly to 0 (the people who may have left).
function randomGroup(rnd: () => number, o: { people: number; expenses: number; amountMax?: number }) {
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const ids = Array.from({ length: o.people }, (_, i) => `m${i}`);
  const rows: Row[] = [];
  for (let i = 0; i < o.expenses; i++) {
    const total = int(5000, o.amountMax ?? 5_000_000);
    const kindRoll = rnd();
    const group = ids.filter(() => rnd() < 0.7);
    const people = group.length ? group : [ids[0]];
    const paidById = ids[int(0, ids.length - 1)];
    let shares: [string, number][];
    if (kindRoll < 0.5) {
      shares = allocateByWeights(total, people.map((memberId) => ({ memberId, weight: 1 }))).map((x) => [x.memberId, x.amount]);
    } else {
      // exact: random weights, summed to the total
      shares = allocateByWeights(total, people.map((memberId) => ({ memberId, weight: int(1, 1000) }))).map((x) => [x.memberId, x.amount]);
    }
    const row: Row = { id: `e${i}`, paidById, at: i, shares: shares.filter(([, a]) => a > 0) };
    if (kindRoll > 0.9) row.kind = "refund";
    else if (kindRoll > 0.75 && ids.length > 1) {
      const other = ids.find((x) => x !== paidById)!;
      const first = int(1, total - 1);
      row.payers = [{ memberId: paidById, amount: first }, { memberId: other, amount: total - first }];
    }
    rows.push(row);
  }
  const pays: Pay[] = [];
  const netNow = () => netBalances(ids, rows.map((r) => ({ paidById: r.paidById, amount: r.shares.reduce((s, x) => s + x[1], 0), payers: r.payers ? payersJson(r.payers) : "", kind: r.kind, shares: r.shares.map(([memberId, amount]) => ({ memberId, amount })) })), pays.map((p) => ({ fromId: p.from, toId: p.to, amount: p.amount })));
  // Settle about half the people exactly to 0, against whoever is owed (or owes) the most.
  for (const m of ids) {
    if (rnd() < 0.5) continue;
    const n = netNow();
    const mine = n[m];
    if (mine === 0) continue;
    const other = ids.filter((x) => x !== m && (mine < 0 ? n[x] > 0 : n[x] < 0)).sort((x, y) => Math.abs(n[y]) - Math.abs(n[x]))[0];
    if (!other) continue;
    pays.push(mine < 0 ? { id: `p${pays.length}`, from: m, to: other, amount: -mine, at: 1000 + pays.length } : { id: `p${pays.length}`, from: other, to: m, amount: mine, at: 1000 + pays.length });
  }
  const before = netNow();
  const people = ids.map((id) => ({ id, left: before[id] === 0 && rnd() < 0.4 }));
  return { people, rows, pays, before };
}

describe("2. keepSquareAtZero: a seeded property test", () => {
  const rates: [string, string][] = [["USD", "0.0119"], ["JPY", "1.7731"], ["KWD", "0.0037"], ["VND", "300"]];

  it("200 random groups: when it gives an answer, every expense still adds up, payments are at least 1, everyone fixed is on target, balances add to 0; refusals are rare", () => {
    const rnd = seeded(20261116);
    let nulls = 0;
    let total = 0;
    let fixedChecked = 0;
    for (let g = 0; g < 200; g++) {
      const group = randomGroup(rnd, { people: 2 + Math.floor(rnd() * 5), expenses: 1 + Math.floor(rnd() * 30) });
      const [cur, rate] = rates[g % rates.length];
      const ids = group.people.map((p) => p.id);
      const r = run(group.people, group.rows, group.pays, cur, rate);
      total++;
      if (r.null || !r.result) { nulls++; continue; }
      for (const e of r.after) expect(e.shares.reduce((s, x) => s + r.result!.shares[x.id], 0), `group ${g}: shares add up`).toBe(e.amount);
      for (const p of r.afterPays) expect(r.result.payments[p.id], `group ${g}: payment stays at least 1`).toBeGreaterThanOrEqual(1);
      const net = netsOf(ids, r.after, r.afterPays, r.result);
      expect(Object.values(net).reduce((a, b) => a + b, 0), `group ${g}: adds to 0`).toBe(0);
      for (const p of group.people) {
        if (group.before[p.id] === 0 || p.left) {
          expect(net[p.id], `group ${g}: ${p.id} is fixed`).toBe(r.result.targets[p.id]);
          if (group.before[p.id] === 0) expect(net[p.id]).toBe(0);
          fixedChecked++;
        }
      }
    }
    expect(fixedChecked).toBeGreaterThan(100); // the generator really did produce people at 0
    expect(nulls / total).toBeLessThanOrEqual(0.01);
  });

  it("300 expenses among 20 people converts and squares in under 2 seconds", () => {
    const rnd = seeded(77);
    const group = randomGroup(rnd, { people: 20, expenses: 300 });
    const start = performance.now();
    const r = run(group.people, group.rows, group.pays, "USD", "0.0119");
    const ms = performance.now() - start;
    expect(r.null).toBe(false);
    expect(ms).toBeLessThan(2000);
    if (r.result) {
      const net = netsOf(group.people.map((p) => p.id), r.after, r.afterPays, r.result);
      expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
    }
  });
});

describe("limits: MA-7", () => {
  it("an expense or a payment over the largest amount is refused by the conversion itself", () => {
    const ex = { originalAmount: 750_000_000, originalCurrency: "INR", exchangeRate: "1", markupBp: 0, markupAmount: 0, payers: "", shares: [{ id: "a", memberId: "A", amount: 375_000_000 }, { id: "b", memberId: "B", amount: 375_000_000 }] };
    expect(rebaseExpense(ex, "INR", "VND", "300")).toBeNull(); // 750,000,000 paise = 7,500,000 rupees x 300 = 2,250,000,000 dong, over 2,000,000,000
    expect(rebaseExpense(ex, "INR", "VND", "260")!.amount).toBe(1_950_000_000);
    expect(rebasePayment(750_000_000, "INR", "VND", "300")).toBeNull();
    expect(rebasePayment(750_000_000, "INR", "VND", "260")).toBe(1_950_000_000);
    expect(convertAmount(750_000_000, "INR", "VND", "300")).toBe(2_250_000_000); // the plain conversion alone would have allowed it
  });
});

// @db-begin (everything below needs the test database)
import { afterAll } from "vitest";
import { db } from "@/lib/db";
import { changeGroupCurrency, CURRENCY_PAYMENT_TEXT, CURRENCY_ROUNDING_TEXT } from "@/lib/group-changes";
import { setMember } from "@/lib/people";
import { undoEvent } from "@/lib/undo";
import { checkBooks } from "./helpers/money-invariants";

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let counter = 0;
const groupIds: string[] = [];
afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

async function world(label: string, names: string[]) {
  const n = ++counter;
  const g = await db.group.create({
    data: {
      name: `B1c ${label} ${n}`, type: "trip", currency: "INR", inviteCode: `b1c-${n}-${stamp}`,
      members: { create: names.map((name, i) => ({ name, splitWeight: 100, createdAt: new Date(2026, 0, i + 1) })) },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { gid: g.id, id: (name: string) => g.members.find((m) => m.name === name)!.id };
}
type World = Awaited<ReturnType<typeof world>>;

const expense = (w: World, paidBy: string, description: string, shares: [string, number][], at: number) => {
  const amount = shares.reduce((s, x) => s + x[1], 0);
  return db.expense.create({
    data: {
      groupId: w.gid, description, amount, paidById: w.id(paidBy), createdById: w.id(paidBy), splitType: "exact", forMode: "selected", category: "other",
      originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount, createdAt: new Date(2026, 1, 1, 0, 0, at),
      shares: { create: shares.map(([name, a]) => ({ memberId: w.id(name), amount: a })) },
    },
    include: { shares: true },
  });
};
const payment = (w: World, from: string, to: string, amount: number, at: number) =>
  db.payment.create({ data: { groupId: w.gid, fromId: w.id(from), toId: w.id(to), amount, createdById: w.id(from), createdAt: new Date(2026, 1, 1, 0, 1, at) } });
const shareAmounts = async (w: World, description: string) => (await db.expenseShare.findMany({ where: { expense: { groupId: w.gid, description } }, orderBy: { id: "asc" }, include: { member: true } })).map((s) => [s.member.name, s.amount]);
const payAmounts = async (w: World) => (await db.payment.findMany({ where: { groupId: w.gid }, orderBy: { createdAt: "asc" } })).map((p) => p.amount);
const dinner = (w: World) => expense(w, "A", "Dinner", [["A", 3334], ["R", 3333], ["C", 3333]], 1);

describe("3. E1 through the database, then undo", () => {
  it("USD 0.0119: shares 39/40/40, payments 40/40, all 0; undo puts back 3334/3333/3333 and 3333/3333 exactly, all 0", async () => {
    const w = await world("e1", ["A", "R", "C"]);
    await dinner(w);
    await payment(w, "R", "A", 3333, 1);
    await payment(w, "C", "A", 3333, 2);
    expect(await checkBooks(w.gid)).toEqual({ [w.id("A")]: 0, [w.id("R")]: 0, [w.id("C")]: 0 });
    const r = await changeGroupCurrency(w.gid, w.id("A"), "USD", "0.0119");
    if (!r.ok) throw new Error(r.error);
    expect(await shareAmounts(w, "Dinner")).toEqual(expect.arrayContaining([["A", 39], ["R", 40], ["C", 40]]));
    expect((await db.expense.findFirstOrThrow({ where: { groupId: w.gid } })).amount).toBe(119);
    expect(await payAmounts(w)).toEqual([40, 40]);
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0, 0]);
    const u = await undoEvent(r.eventId!, w.id("A"));
    expect(u.ok).toBe(true);
    expect(await shareAmounts(w, "Dinner")).toEqual(expect.arrayContaining([["A", 3334], ["R", 3333], ["C", 3333]]));
    expect((await db.expense.findFirstOrThrow({ where: { groupId: w.gid } })).amount).toBe(10000);
    expect(await payAmounts(w)).toEqual([3333, 3333]);
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0, 0]);
  });
});

describe("4. E2 through the database with C gone", () => {
  it("only C paid A 3333; C leaves (0); JPY 1.7 works and C stays 0; undo gives A +3333, R -3333, C 0", async () => {
    const w = await world("e2", ["A", "R", "C"]);
    await dinner(w);
    await payment(w, "C", "A", 3333, 1);
    const start = await checkBooks(w.gid);
    expect([start[w.id("A")], start[w.id("R")], start[w.id("C")]]).toEqual([3333, -3333, 0]);
    expect((await setMember(w.gid, w.id("A"), w.id("C"), { leftAt: new Date().toISOString() })).ok).toBe(true);
    const r = await changeGroupCurrency(w.gid, w.id("A"), "JPY", "1.7");
    if (!r.ok) throw new Error(r.error);
    const net = await checkBooks(w.gid);
    expect([net[w.id("A")], net[w.id("R")], net[w.id("C")]]).toEqual([57, -57, 0]);
    expect(await payAmounts(w)).toEqual([57]);
    const u = await undoEvent(r.eventId!, w.id("A"));
    expect(u.ok).toBe(true);
    const back = await checkBooks(w.gid);
    expect([back[w.id("A")], back[w.id("R")], back[w.id("C")]]).toEqual([3333, -3333, 0]);
    expect(await shareAmounts(w, "Dinner")).toEqual(expect.arrayContaining([["A", 3334], ["R", 3333], ["C", 3333]]));
    expect(await payAmounts(w)).toEqual([3333]);
  });
});

describe("5. undoing a currency change can't put a leaver off 0", () => {
  it("C owed 33 before, was 0 after the change, left; the undo would put C back at -33: refused, JPY unchanged", async () => {
    const w = await world("restore", ["A", "B", "C"]);
    await expense(w, "A", "Dinner", [["A", 3334], ["B", 3333], ["C", 3333]], 1);
    await payment(w, "C", "A", 3300, 1);
    const before = await checkBooks(w.gid, { legacy: [] });
    // A +3366 (3334 paid-for-others 6666 - 3300 payment), B -3333, C -33 (-3333 + 3300).
    expect([before[w.id("A")], before[w.id("B")], before[w.id("C")]]).toEqual([3366, -3333, -33]);
    const r = await changeGroupCurrency(w.gid, w.id("A"), "JPY", "1.7");
    if (!r.ok) throw new Error(r.error);
    // total 170: shares 57, 57, 56; the payment 3300 x 1.7 / 100 = 56.1 -> 56. A = 170 - 57 - 56 = 57, B = -57, C = -56 + 56 = 0. Nobody was square: no moves.
    expect(await shareAmounts(w, "Dinner")).toEqual(expect.arrayContaining([["A", 57], ["B", 57], ["C", 56]]));
    expect(await payAmounts(w)).toEqual([56]);
    const after = await checkBooks(w.gid);
    expect([after[w.id("A")], after[w.id("B")], after[w.id("C")]]).toEqual([57, -57, 0]);
    await db.member.update({ where: { id: w.id("C") }, data: { leftAt: new Date() } });
    const u = await undoEvent(r.eventId!, w.id("A"));
    expect(u).toEqual({ ok: false, error: "C has left the group since, so the currency change can’t be undone. Change the currency again instead." });
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).currency).toBe("JPY");
    expect(await payAmounts(w)).toEqual([56]);
    await checkBooks(w.gid);
  });
});

describe("6. MA-7 and MB-6 refusals write nothing", () => {
  it("750000000 split 375000000 each: VND at 300 would be 2,250,000,000 (refused, still rupees); at 260 it is 1,950,000,000 (fine)", async () => {
    const w = await world("limit", ["A", "B"]);
    await expense(w, "A", "Big", [["A", 375_000_000], ["B", 375_000_000]], 1);
    const no = await changeGroupCurrency(w.gid, w.id("A"), "VND", "300");
    expect(no).toEqual({ ok: false, error: "That rate makes some amounts too small or too large. Check it." });
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).currency).toBe("INR");
    expect((await db.expense.findFirstOrThrow({ where: { groupId: w.gid } })).amount).toBe(750_000_000);
    expect(await db.groupEvent.count({ where: { groupId: w.gid, kind: "currency_changed" } })).toBe(0);
    const yes = await changeGroupCurrency(w.gid, w.id("A"), "VND", "260");
    expect(yes.ok).toBe(true);
    expect((await db.expense.findFirstOrThrow({ where: { groupId: w.gid } })).amount).toBe(1_950_000_000);
    await checkBooks(w.gid);
  });

  it("a payment that would be over the largest amount has its own sentence", async () => {
    const w = await world("limit-pay", ["A", "B"]);
    await payment(w, "B", "A", 750_000_000, 1);
    const no = await changeGroupCurrency(w.gid, w.id("A"), "VND", "300");
    expect(no).toEqual({ ok: false, error: CURRENCY_PAYMENT_TEXT });
    expect(CURRENCY_PAYMENT_TEXT).toBe("That rate makes a payment too small or too large. Check it.");
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).currency).toBe("INR");
    expect(await payAmounts(w)).toEqual([750_000_000]);
  });

  it("MB-6: the 1-rupee taxi (E4) is refused with the rounding sentence; the group stays in rupees and nothing is written", async () => {
    const w = await world("e4", ["A", "R", "C", "D"]);
    await expense(w, "A", "Taxi", [["R", 34], ["C", 33], ["D", 33]], 1);
    await payment(w, "R", "A", 34, 1);
    await payment(w, "C", "A", 33, 2);
    await payment(w, "D", "A", 33, 3);
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0, 0, 0]);
    const no = await changeGroupCurrency(w.gid, w.id("A"), "JPY", "1.7");
    expect(no).toEqual({ ok: false, error: CURRENCY_ROUNDING_TEXT });
    expect(CURRENCY_ROUNDING_TEXT).toBe("At this rate, rounding would leave someone who’s settled up with a tiny balance, so the currency wasn’t changed. Try a slightly different rate.");
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).currency).toBe("INR");
    expect(await payAmounts(w)).toEqual([34, 33, 33]);
    expect(await db.groupEvent.count({ where: { groupId: w.gid, kind: "currency_changed" } })).toBe(0);
    // A slightly different rate works: at 30 the total is 100 x 30 / 100 = 30 yen, shares 10, 10, 10, each payment 10: all exactly 0.
    const other = await changeGroupCurrency(w.gid, w.id("A"), "JPY", "30");
    expect(other.ok).toBe(true);
    await checkBooks(w.gid);
  });
});

// M1: a card fee kept after the group's currency changed survives a later edit.
// Hand-worked: $100 on a card (10,000 cents) at 83.5 with a 3% fee, group in rupees: 835,000 paise + 25,050 fee = 860,050, 430,025 each for A and B.
// The group switches to dollars at 0.012: the dollar part stays 10,000 cents; the fee 25,050 x 0.012 = 300.6 -> 301 cents; the total is 10,301
// (A 5,151, B 5,150: 5,150.5 each, the odd cent to the first). Opening the expense to edit only the name must start from 10,301, not 10,000.
describe("M1: a kept card fee survives an edit", () => {
  const rebased = rebaseExpense(
    { originalAmount: 10000, originalCurrency: "USD", exchangeRate: "83.5", markupBp: 300, markupAmount: 25050, shares: [{ id: "s0", memberId: "A", amount: 430025 }, { id: "s1", memberId: "B", amount: 430025 }] },
    "INR", "USD", "0.012",
  )!;
  it("the change keeps the fee: amount 10,301, shares add up to it", () => {
    expect(rebased.convertedAmount).toBe(10000);
    expect(rebased.markupAmount).toBe(301);
    expect(rebased.amount).toBe(10301);
    expect(rebased.shares.map((s) => s.amount).sort()).toEqual([5150, 5151]);
    expect(rebased.shares.reduce((n, s) => n + s.amount, 0)).toBe(10301);
  });
  const saved = (over: object = {}) => ({
    description: "Dinner", category: "food", notes: "", amount: rebased.amount, originalAmount: 10000, originalCurrency: "USD", baseCurrency: "USD", exchangeRate: "1", rateDate: "",
    paymentMethod: "card", markupBp: 300, markupAmount: rebased.markupAmount, splitType: "equal", forMode: "everyone", paidById: "A", payers: "", kind: "expense", spentAt: new Date("2026-11-01T12:00:00Z"),
    createdAt: new Date("2026-11-01T12:00:00Z"), editedAt: null, shares: [{ memberId: "A", amount: rebased.shares[0].amount }, { memberId: "B", amount: rebased.shares[1].amount }], ...over,
  });
  const ctx = { groupMarkupBp: 300, groupWeights: { A: 100, B: 100 }, tz: "Asia/Kolkata", today: "2026-11-23" };
  it("the edit form starts from 10,301 (103.01), not 10,000, and the exact amounts still add up to it", () => {
    const i = initialFromExpense(saved(), ctx, "edit");
    expect(parseAmount(i.amount, "USD")).toBe(10301);
    expect(Object.values(i.exact).map((v) => parseAmount(v, "USD")!).reduce((n, x) => n + x, 0)).toBe(10301);
  });
  it("an ordinary dollar expense with no kept fee still starts from what was typed", () => {
    const i = initialFromExpense(saved({ amount: 10000, markupAmount: 0 }), ctx, "edit");
    expect(parseAmount(i.amount, "USD")).toBe(10000);
  });
});
