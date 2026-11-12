import { describe, expect, it } from "vitest";
import { netBalances } from "@/lib/balances";
import { smartSettle } from "@/lib/settle";
import { explainAll, explainBalance } from "@/lib/explain";
import { scopeBalances, scopeForLeaver } from "@/lib/left-view";

// The baseline for the speed work. Today's balance and settle code, on one hand-worked trip.
// Stage 2 (faster balance sums) must give exactly these numbers. Money is in paise.
//
// Four people: A, B, C, D.
//   E1  A paid 100000.   Shares A 33334, B 33333, C 33333.
//   E2  B paid 30000 and C paid 20000.   Shares 12500 each (A, B, C, D).
//   E3  Money back, 9000 received by D.   Shares A 4500, D 4500.
//   E4  C paid 70000. DELETED (never counts).
//   E5  A paid 10300 (300 of it a card fee).   Shares B 5150, D 5150.
//   E6  10000 paid by B and C in equal parts (5000 each).   Shares A 10000.
//   P1  B pays A 20000.   P2  D pays C 5000.   P3  C pays A 99999. DELETED.
//
// Worked out one expense at a time (+ = they are owed, - = they owe):
//        E1      E2      E3     E5     E6      P1      P2     total
//   A  +66666  -12500  +4500  +10300 -10000  -20000          = +38966
//   B  -33333  +17500         -5150  +5000   +20000          =  +4017
//   C  -33333   +7500                +5000           -5000   = -25833
//   D          -12500  -4500  -5150                   +5000   = -17150
//   (38966 + 4017 - 25833 - 17150 = 0)
// Smart Settle: C pays A 25833; D pays A 13133 (38966 - 25833); D pays B 4017. Three payments.

const day = (n: number, h = 10) => new Date(Date.UTC(2026, 10, n, h));
const base = { notes: "", category: "other", markupAmount: 0, kind: "expense" as string, payers: "" as string };
const trip = () => {
  const expenses = [
    { ...base, id: "E1", description: "Hotel", amount: 100000, paidById: "A", createdAt: day(1), shares: [{ memberId: "A", amount: 33334 }, { memberId: "B", amount: 33333 }, { memberId: "C", amount: 33333 }] },
    { ...base, id: "E2", description: "Dinner", amount: 50000, paidById: "B", payers: JSON.stringify([{ m: "B", a: 30000 }, { m: "C", a: 20000 }]), createdAt: day(2), shares: ["A", "B", "C", "D"].map((memberId) => ({ memberId, amount: 12500 })) },
    { ...base, id: "E3", description: "Returned jacket", kind: "refund", amount: 9000, paidById: "D", createdAt: day(3), shares: [{ memberId: "A", amount: 4500 }, { memberId: "D", amount: 4500 }] },
    { ...base, id: "E4", description: "Deleted taxi", amount: 70000, paidById: "C", createdAt: day(4), shares: [{ memberId: "A", amount: 35000 }, { memberId: "C", amount: 35000 }], deletedAt: day(4, 11) },
    { ...base, id: "E5", description: "Shopping abroad", amount: 10300, markupAmount: 300, paidById: "A", createdAt: day(5), shares: [{ memberId: "B", amount: 5150 }, { memberId: "D", amount: 5150 }] },
    { ...base, id: "E6", description: "Boat", amount: 10000, paidById: "B", payers: JSON.stringify([{ m: "B", a: 5000 }, { m: "C", a: 5000 }]), createdAt: day(6), shares: [{ memberId: "A", amount: 10000 }] },
  ];
  const payments = [
    { id: "P1", fromId: "B", toId: "A", amount: 20000, createdAt: day(5, 12) },
    { id: "P2", fromId: "D", toId: "C", amount: 5000, createdAt: day(5, 13) },
    { id: "P3", fromId: "C", toId: "A", amount: 99999, createdAt: day(6, 12), deletedAt: day(6, 13) },
  ];
  return { expenses, payments, live: { expenses: expenses.filter((e) => !("deletedAt" in e)), payments: payments.filter((p) => !("deletedAt" in p)) } };
};
const ids = ["A", "B", "C", "D"];

describe("the hand-worked trip (baseline for the faster balance work)", () => {
  it("balances: A +38966, B +4017, C -25833, D -17150, adding up to zero", () => {
    const { live } = trip();
    const net = netBalances(ids, live.expenses, live.payments);
    expect(net).toEqual({ A: 38966, B: 4017, C: -25833, D: -17150 });
    expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("settle plan: C pays A 25833, D pays A 13133, D pays B 4017", () => {
    const { live } = trip();
    const plan = smartSettle(netBalances(ids, live.expenses, live.payments));
    expect(plan).toEqual([
      { from: "C", to: "A", amount: 25833 },
      { from: "D", to: "A", amount: 13133 },
      { from: "D", to: "B", amount: 4017 },
    ]);
  });

  it("after those three payments everybody is exactly square", () => {
    const { live } = trip();
    const plan = smartSettle(netBalances(ids, live.expenses, live.payments));
    const paid = plan.map((t, i) => ({ id: `S${i}`, fromId: t.from, toId: t.to, amount: t.amount }));
    const after = netBalances(ids, live.expenses, [...live.payments, ...paid]);
    expect(after).toEqual({ A: 0, B: 0, C: 0, D: 0 });
    expect(smartSettle(after)).toEqual([]);
  });

  it("Why? lines add up to the same balances, and explainAll agrees with explainBalance", () => {
    const { live } = trip();
    const nameOf = (id: string) => id;
    const all = explainAll(ids, live.expenses, live.payments);
    const want = { A: 38966, B: 4017, C: -25833, D: -17150 };
    for (const id of ids) {
      const w = explainBalance(id, live.expenses, live.payments, nameOf);
      expect(w.balance).toBe(want[id as keyof typeof want]);
      expect(all[id]).toEqual({ paidTotal: w.paidTotal, shareTotal: w.shareTotal, feeTotal: w.feeTotal, sent: w.sent, received: w.received, balance: w.balance, count: w.lines.length });
    }
    // A by hand: paid 100000 + 10300, share 33334 + 12500 - 4500 + 10000 = 51334 (+ card fee part: none in A's share).
    expect(all.A).toMatchObject({ paidTotal: 110300, shareTotal: 51334, sent: 0, received: 20000, feeTotal: 0 });
    // D by hand: refund of 9000 received counts as -9000 "paid"; shares 12500 - 4500 + 5150 = 13150; sent 5000.
    expect(all.D).toMatchObject({ paidTotal: -9000, shareTotal: 13150, sent: 5000, received: 0 });
    // D's part of the card fee: 300 * 5150 / 10300 = 150.
    expect(all.D.feeTotal).toBe(150);
  });

  it("D, who left after the second dinner, sees their own line (-17150) and only D to A 13133, D to B 4017", () => {
    const { expenses, payments, live } = trip();
    const net = netBalances(ids, live.expenses, live.payments);
    const mine = scopeBalances(net, smartSettle(net), "D");
    expect(mine.net).toEqual({ D: -17150 });
    expect(mine.transfers).toEqual([
      { from: "D", to: "A", amount: 13133 },
      { from: "D", to: "B", amount: 4017 },
    ]);
    // Left on 4 Nov 12:00. E6 (5 Nov onwards, A/B/C only) and payment P1 (B to A) are hidden; E5 and P2 involve D.
    const cut = day(4, 12);
    const seen = scopeForLeaver({ expenses: expenses.map((e) => ({ ...e })), payments, events: [] }, "D", cut);
    expect(seen.expenses.map((e) => e.id)).toEqual(["E1", "E2", "E3", "E4", "E5"]);
    expect(seen.payments.map((p) => p.id)).toEqual(["P2"]);
  });
});

// A bigger, messy trip made from a fixed seed, so the same 400 expenses come out every time.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("explainAll gives explainBalance's totals for everyone", () => {
  it("on a random 400-expense trip with split payers, refunds, card fees and odd payments", () => {
    const rand = mulberry32(2026);
    const int = (n: number) => Math.floor(rand() * n);
    const people = ["p0", "p1", "p2", "p3", "p4", "p5", "p6"];
    const expenses = Array.from({ length: 400 }, (_, i) => {
      const amount = 100 + int(900000);
      const who = people.filter(() => rand() < 0.6);
      const sharers = who.length ? who : [people[0]];
      const each = Math.floor(amount / sharers.length);
      const shares = sharers.map((memberId, k) => ({ memberId, amount: each + (k === 0 ? amount - each * sharers.length : 0) }));
      const paidById = people[int(people.length)];
      const second = people[int(people.length)];
      const split = rand() < 0.2 && second !== paidById;
      const first = Math.floor(amount * 0.3);
      // Every 50th split list doesn't add up to the total: payersOf keeps the proportions.
      const payers = split ? JSON.stringify([{ m: paidById, a: first }, { m: second, a: amount - first - (i % 50 === 0 ? 7 : 0) }]) : "";
      return {
        id: `x${i}`, description: `Item ${i}`, category: "other", amount, markupAmount: rand() < 0.25 ? Math.floor(amount * 0.03) : 0, paidById, payers,
        kind: rand() < 0.08 ? "refund" : "expense", createdAt: new Date(Date.UTC(2026, 9, 1 + (i % 28), i % 24)), shares,
      };
    });
    const payments = Array.from({ length: 90 }, (_, i) => {
      const fromId = people[int(people.length)];
      const toId = people[(people.indexOf(fromId) + 1 + int(people.length - 1)) % people.length];
      return { id: `y${i}`, fromId, toId, amount: 100 + int(50000), createdAt: new Date(Date.UTC(2026, 9, 1 + (i % 28), 12)) };
    });
    const all = explainAll(people, expenses, payments);
    const net = netBalances(people, expenses, payments);
    for (const id of people) {
      const w = explainBalance(id, expenses, payments, (x) => x);
      expect(all[id]).toEqual({ paidTotal: w.paidTotal, shareTotal: w.shareTotal, feeTotal: w.feeTotal, sent: w.sent, received: w.received, balance: w.balance, count: w.lines.length });
      expect(all[id].balance).toBe(net[id]);
    }
  });

  it("reads a payment to yourself the way explainBalance does (sent only)", () => {
    const payments = [{ id: "s", fromId: "p0", toId: "p0", amount: 700, createdAt: new Date(Date.UTC(2026, 9, 1)) }];
    const all = explainAll(["p0", "p1"], [], payments);
    const w = explainBalance("p0", [], payments, (x) => x);
    expect(all.p0).toEqual({ paidTotal: 0, shareTotal: 0, feeTotal: 0, sent: w.sent, received: w.received, balance: w.balance, count: w.lines.length });
    expect(all.p0.sent).toBe(700);
    expect(all.p0.received).toBe(0);
    expect(all.p1.count).toBe(0);
  });
});
