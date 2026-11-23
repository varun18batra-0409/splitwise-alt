import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { changeGroupCurrency } from "@/lib/group-changes";
import { squareGameMoves } from "@/lib/pot-currency";
import { potSummary } from "@/lib/pot";
import { payersJson, spentAmount } from "@/lib/payers";
import { checkBooks } from "./helpers/money-invariants";

// M4: the group total leaves out refunds' sign errors and game results. M6: card-game lines match the converted result.
// Everything is in minor units (paise, cents), worked by hand.

describe("M6 (pure): nudging a player's own lines so their net matches the converted result", () => {
  const moves = [
    { id: "a1", memberId: "A", kind: "take", amount: 2, live: true },
    { id: "a2", memberId: "A", kind: "take", amount: 2, live: true },
    { id: "a3", memberId: "A", kind: "take", amount: 2, live: true },
    { id: "b1", memberId: "B", kind: "take", amount: 4, live: true },
    { id: "c1", memberId: "C", kind: "return", amount: 9, live: true },
  ];
  it("A takes 2+2+2 = 6 but the result says A is at -5: one take becomes 1; B -4 and C +9 stay; the gap is 0", () => {
    const out = squareGameMoves(moves, { A: -5, B: -4, C: 9 });
    expect(out).toEqual({ a1: 1 }); // the first of the three equal takes
    const after = moves.map((m) => ({ ...m, amount: out && m.id in out ? out[m.id] : m.amount }));
    const { lines, totals } = potSummary(["A", "B", "C"], after);
    expect(lines.map((l) => l.net)).toEqual([-5, -4, 9]);
    expect(totals.gap).toBe(0);
  });
  it("a player with a return gets the difference added to the largest return; an adjust line is never touched", () => {
    const m = [
      { id: "x1", memberId: "X", kind: "take", amount: 10, live: true },
      { id: "x2", memberId: "X", kind: "return", amount: 4, live: true },
      { id: "x3", memberId: "X", kind: "return", amount: 7, live: true },
      { id: "x4", memberId: "X", kind: "adjust", amount: 1, live: true },
      { id: "y1", memberId: "Y", kind: "take", amount: 3, live: true },
      { id: "y2", memberId: "Y", kind: "return", amount: 3, live: true },
    ];
    // X now +2 (4 + 7 + 1 - 10); the result says +3: the larger return 7 becomes 8. Y is 0 and the result says -3 (so the gap is 3 - 3 = 0): Y's take 3 becomes 6.
    expect(squareGameMoves(m, { X: 3, Y: -3 })).toEqual({ x3: 8, y1: 6 });
  });
  it("nothing can carry the nudge: refused (null)", () => {
    expect(squareGameMoves([{ id: "p", memberId: "P", kind: "take", amount: 1, live: true }, { id: "q", memberId: "Q", kind: "return", amount: 1, live: true }], { P: 0, Q: 0 })).toBeNull();
  });
});

const groupIds: string[] = [];
afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});
async function world(label: string) {
  const g = await db.group.create({
    data: { name: `Cur ${label}`, type: "trip", currency: "INR", inviteCode: `b34-${label}-${Date.now()}`, members: { create: [{ name: "A", createdAt: new Date(2026, 0, 1) }, { name: "B", createdAt: new Date(2026, 0, 2) }, { name: "C", createdAt: new Date(2026, 0, 3) }] } },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  return { gid: g.id, a: id("A"), b: id("B"), c: id("C") };
}
const base = { category: "other", baseCurrency: "INR", originalCurrency: "INR" };

describe("M4: the group total", () => {
  it("1,000,000 spent, 200,000 money back, a 150,000 game result and a deleted 500,000: the total is 800,000 (₹8,000), and the currency line reads ₹8,000 → $96", async () => {
    const w = await world("total");
    const mk = (description: string, amount: number, extra: object, shares: [string, number][]) =>
      db.expense.create({ data: { groupId: w.gid, description, amount, originalAmount: amount, convertedAmount: amount, createdById: w.a, splitType: "exact", forMode: "selected", ...base, ...extra, shares: { create: shares.map(([memberId, a]) => ({ memberId, amount: a })) } } });
    await mk("Stay", 1000000, { paidById: w.a }, [[w.a, 500000], [w.b, 500000]]);
    await mk("Money back", 200000, { paidById: w.b, kind: "refund" }, [[w.a, 150000], [w.b, 50000]]);
    await mk("Teen patti", 150000, { paidById: w.a, kind: "pot", payers: payersJson([{ memberId: w.a, amount: 150000 }]) }, [[w.b, 150000]]);
    await mk("Deleted", 500000, { paidById: w.a, deletedAt: new Date() }, [[w.a, 250000], [w.b, 250000]]);
    const live = await db.expense.findMany({ where: { groupId: w.gid, deletedAt: null }, select: { amount: true, kind: true } });
    expect(live.reduce((n, e) => n + spentAmount(e), 0)).toBe(800000); // what Settings shows: ₹8,000 (it showed ₹13,500)
    // At 0.012: Stay 12,000 cents, money back 2,400: 12,000 - 2,400 = 9,600 cents = $96.
    const r = await changeGroupCurrency(w.gid, w.a, "USD", "0.012");
    expect(r.ok).toBe(true);
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: w.gid, kind: "currency_changed" } });
    expect(JSON.stringify(ev)).toContain("Group total: ₹8,000 → $96");
    await checkBooks(w.gid);
  });
});

describe("M6: card-game lines after a currency change", () => {
  it("A takes 150 + 150 + 150, B takes 300, C returns 750 paise; at 0.012 the result is 9 cents (A 5, B 4, C +9) and the lines match: A -5, B -4, C +9, gap 0", async () => {
    const w = await world("game");
    const game = await db.potGame.create({ data: { groupId: w.gid, name: "Teen patti", hostId: w.a, status: "done", finishedAt: new Date(), players: JSON.stringify([w.a, w.b, w.c]) } });
    const mv = (memberId: string, kind: string, amount: number) => db.potMove.create({ data: { gameId: game.id, memberId, kind, amount, createdById: w.a } });
    for (let i = 0; i < 3; i++) await mv(w.a, "take", 150);
    await mv(w.b, "take", 300);
    await mv(w.c, "return", 750);
    const result = await db.expense.create({
      data: {
        groupId: w.gid, description: "Teen patti", amount: 750, originalAmount: 750, convertedAmount: 750, createdById: w.a, splitType: "exact", forMode: "selected", kind: "pot",
        paidById: w.c, payers: payersJson([{ memberId: w.c, amount: 750 }]), ...base,
        shares: { create: [{ memberId: w.a, amount: 450 }, { memberId: w.b, amount: 300 }] },
      },
    });
    await db.potGame.update({ where: { id: game.id }, data: { resultId: result.id } });
    const r = await changeGroupCurrency(w.gid, w.a, "USD", "0.012");
    expect(r.ok).toBe(true);
    const moves = await db.potMove.findMany({ where: { gameId: game.id } });
    const { lines, totals } = potSummary([w.a, w.b, w.c], moves);
    expect(lines.map((l) => l.net)).toEqual([-5, -4, 9]);
    expect(totals.gap).toBe(0);
    expect(moves.filter((m) => m.memberId === w.a).map((m) => m.amount).sort()).toEqual([1, 2, 2]); // one of A's takes became 1
    const after = await db.expense.findUniqueOrThrow({ where: { id: result.id }, include: { shares: true } });
    expect(after.amount).toBe(9);
    expect(after.shares.map((s) => s.amount).sort()).toEqual([4, 5]);
    // "Mark all paid": A pays C 5 and B pays C 4; everyone ends at exactly 0 (the books balance either way).
    const net = await checkBooks(w.gid);
    expect([net[w.a], net[w.b], net[w.c]]).toEqual([-5, -4, 9]);
    await db.payment.create({ data: { groupId: w.gid, fromId: w.a, toId: w.c, amount: 5, createdById: w.a } });
    await db.payment.create({ data: { groupId: w.gid, fromId: w.b, toId: w.c, amount: 4, createdById: w.b } });
    const settled = await checkBooks(w.gid);
    expect([settled[w.a], settled[w.b], settled[w.c]]).toEqual([0, 0, 0]);
  });
});
