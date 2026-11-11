import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { netBalances } from "@/lib/balances";
import { saveExpense, setExpenseDeleted, type SaveExpenseInput } from "@/lib/save-expense";
import { changeGroupCurrency } from "@/lib/group-changes";
import { undoEvent } from "@/lib/undo";
import { finishGame, recordMove, reopenGame, startGame } from "@/lib/pot-db";
import { parsePayers } from "@/lib/payers";
import type { RateAnswer } from "@/lib/rate-cache";

// Independent review (Fable, 11 Nov 2026): tests written to try to break the
// books, separately from the earlier audit's scripts. Each test states the
// behaviour a user would expect; a failure is a finding.

const groups: string[] = [];
afterAll(async () => {
  await eraseGroups(groups);
});
const rate = (r = "1") => async (): Promise<RateAnswer> => ({ ok: true, rate: r, date: "2026-11-11" });
const draft = (groupId: string, paidById: string, over: Partial<SaveExpenseInput> = {}): SaveExpenseInput => ({
  groupId, name: "Dinner", category: "", amount: "900", currency: "INR", paidById, forMode: "everyone",
  selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
  markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
});
async function group(type: string, currency: string, names: string[]) {
  const g = await db.group.create({
    data: { name: `Break ${type}`, type, currency, inviteCode: `fb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, members: { create: names.map((name) => ({ name })) } },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  groups.push(g.id);
  return { id: g.id, ids: names.map((n) => g.members.find((m) => m.name === n)!.id) };
}
async function books(groupId: string) {
  const members = await db.member.findMany({ where: { groupId }, select: { id: true } });
  const [expenses, payments] = await Promise.all([
    db.expense.findMany({ where: { groupId, deletedAt: null }, include: { shares: true } }),
    db.payment.findMany({ where: { groupId, deletedAt: null } }),
  ]);
  return { net: netBalances(members.map((m) => m.id), expenses, payments), expenses, payments };
}
// Every expense's shares (and payers, when more than one) add up to its total, and the group nets to zero.
async function sound(groupId: string) {
  const { net, expenses } = await books(groupId);
  expect(Object.values(net).reduce((s, v) => s + v, 0)).toBe(0);
  for (const e of expenses) {
    expect(e.shares.reduce((s, x) => s + x.amount, 0), `shares of ${e.description}`).toBe(e.amount);
    const p = parsePayers(e.payers);
    if (p.length) expect(p.reduce((s, x) => s + x.amount, 0), `payers of ${e.description}`).toBe(e.amount);
  }
  return net;
}
// Small repeatable random numbers (no Math.random, so a failure can be re-run).
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

describe("changing the group currency converts everything that holds money", () => {
  it("a flat's bill, budget, goal, deposit and settle-up minimum follow the new currency, not just the expenses", async () => {
    const g = await group("home", "INR", ["A", "B"]);
    const [a, b] = g.ids;
    expect((await saveExpense(draft(g.id, a, { name: "Groceries", amount: "2400" }), a, rate())).ok).toBe(true);
    const bill = await db.bill.create({ data: { groupId: g.id, name: "Cook", nature: "fixed", amount: 600000, startMonth: "2026-11", payer: a } });
    await db.budget.create({ data: { groupId: g.id, category: "food", amount: 1500000 } });
    const goal = await db.goal.create({ data: { groupId: g.id, name: "Bali", target: 3200000, entries: { create: [{ memberId: a, amount: 500000 }] } } });
    const dep = await db.deposit.create({ data: { groupId: g.id, shares: { create: [{ memberId: a, amount: 2500000 }, { memberId: b, amount: 2500000 }] } } });
    await db.group.update({ where: { id: g.id }, data: { settleMin: 10000 } });

    // ₹ → $ at 0.012: ₹6,000 should become $72, not $6,000.
    const r = await changeGroupCurrency(g.id, a, "USD", "0.012");
    expect(r.ok).toBe(true);
    expect((await db.group.findUnique({ where: { id: g.id } }))!.currency).toBe("USD");
    const exp = await db.expense.findFirst({ where: { groupId: g.id } });
    expect(exp!.amount).toBe(2880); // the expense is converted: $28.80

    const after = {
      bill: (await db.bill.findUnique({ where: { id: bill.id } }))!.amount,
      budget: (await db.budget.findFirst({ where: { groupId: g.id } }))!.amount,
      goalTarget: (await db.goal.findUnique({ where: { id: goal.id } }))!.target,
      goalEntry: (await db.goalEntry.findFirst({ where: { goalId: goal.id } }))!.amount,
      deposit: (await db.depositShare.findFirst({ where: { depositId: dep.id } }))!.amount,
      settleMin: (await db.group.findUnique({ where: { id: g.id } }))!.settleMin,
    };
    console.log("FABLE currency-change, other money after INR→USD at 0.012:", JSON.stringify(after));
    expect(after).toEqual({ bill: 7200, budget: 18000, goalTarget: 38400, goalEntry: 6000, deposit: 30000, settleMin: 120 });
  });

  // Reviewer L1: buy-ins and returns converted one by one can leave an open
  // game a cent out, so the change waits until the game is finished.
  it("an open card game blocks the change; once finished, its lines follow the new currency", async () => {
    const g = await group("pot", "INR", ["A", "B", "C"]);
    const [a, b, c] = g.ids;
    const s = await startGame(g.id, a, { name: "", game: "poker", players: [a, b, c] });
    if (!s.ok) throw new Error(s.error);
    for (const who of [a, b, c]) expect((await recordMove(s.id, a, { memberId: who, kind: "take", amount: "2000" })).ok).toBe(true);
    const blocked = await changeGroupCurrency(g.id, a, "USD", "0.012");
    expect(blocked.ok).toBe(false);
    expect((await db.group.findUnique({ where: { id: g.id } }))!.currency).toBe("INR");
    for (const [who, back] of [[a, "3000"], [b, "2000"], [c, "1000"]] as const) expect((await recordMove(s.id, a, { memberId: who, kind: "return", amount: back })).ok).toBe(true);
    expect((await finishGame(s.id, a)).ok).toBe(true);
    expect((await changeGroupCurrency(g.id, a, "USD", "0.012")).ok).toBe(true);
    const moves = await db.potMove.findMany({ where: { gameId: s.id, kind: "take" } });
    expect(moves.every((m) => m.amount === 2400)).toBe(true); // ₹2,000 → $24.00
  });

  // Reviewer gap: the host pressing Finish twice at the same moment adds one result.
  it("finishing a game twice at once records the result once", async () => {
    const g = await group("pot", "INR", ["A", "B"]);
    const [a, b] = g.ids;
    const s = await startGame(g.id, a, { name: "Twice", game: "poker", players: [a, b] });
    if (!s.ok) throw new Error(s.error);
    for (const who of [a, b]) expect((await recordMove(s.id, a, { memberId: who, kind: "take", amount: "1000" })).ok).toBe(true);
    expect((await recordMove(s.id, a, { memberId: a, kind: "return", amount: "1500" })).ok).toBe(true);
    expect((await recordMove(s.id, a, { memberId: b, kind: "return", amount: "500" })).ok).toBe(true);
    await Promise.allSettled([finishGame(s.id, a), finishGame(s.id, a)]);
    expect(await db.expense.count({ where: { groupId: g.id, kind: "pot", deletedAt: null } })).toBe(1);
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id, kind: "pot" } });
    expect(e.amount).toBe(50000); // A won ₹500 from B
  });

  // Reviewer H1: money that changes without a history entry (a deposit handed
  // over, a new bill, a buy-in) must block undoing the currency change.
  it("undo is refused once a deposit, bill or goal changed after the currency change; allowed when nothing did", async () => {
    const g = await group("home", "INR", ["A", "B"]);
    const [a, b] = g.ids;
    const dep = await db.deposit.create({ data: { groupId: g.id, shares: { create: [{ memberId: a, amount: 3000000 }, { memberId: b, amount: 3000000 }] } } });
    // Nothing spent yet: the rate must still be asked for (reviewer M2).
    expect((await changeGroupCurrency(g.id, a, "USD", "")).ok).toBe(false);
    const r = await changeGroupCurrency(g.id, a, "USD", "0.012");
    expect(r.ok).toBe(true);
    expect((await db.depositShare.findMany({ where: { depositId: dep.id } })).map((x) => x.amount)).toEqual([36000, 36000]); // ₹30,000 → $360
    // B's deposit is handed to A (as a move-out does, with no money history entry).
    const [sa, sb] = await db.depositShare.findMany({ where: { depositId: dep.id }, orderBy: { memberId: "asc" } });
    await db.depositShare.update({ where: { id: sb.id }, data: { status: "transferred", toMemberId: sa.memberId } });
    await db.depositShare.update({ where: { id: sa.id }, data: { amount: 72000 } });
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: g.id, kind: "currency_changed" }, orderBy: { createdAt: "desc" } });
    const u = await undoEvent(ev.id, a);
    expect(u.ok).toBe(false);
    expect((await db.group.findUnique({ where: { id: g.id } }))!.currency).toBe("USD");
    expect((await db.depositShare.findUnique({ where: { id: sa.id } }))!.amount).toBe(72000); // untouched, nothing lost

    // A second group where nothing else changes: undo works and every amount is back exactly.
    const g2 = await group("home", "INR", ["A", "B"]);
    const bill = await db.bill.create({ data: { groupId: g2.id, name: "Rent", nature: "fixed", amount: 2500000, startMonth: "2026-11", payer: g2.ids[0] } });
    expect((await changeGroupCurrency(g2.id, g2.ids[0], "USD", "0.012")).ok).toBe(true);
    expect((await db.bill.findUnique({ where: { id: bill.id } }))!.amount).toBe(30000); // ₹25,000 → $300
    const ev2 = await db.groupEvent.findFirstOrThrow({ where: { groupId: g2.id, kind: "currency_changed" }, orderBy: { createdAt: "desc" } });
    expect((await undoEvent(ev2.id, g2.ids[0])).ok).toBe(true);
    expect((await db.bill.findUnique({ where: { id: bill.id } }))!.amount).toBe(2500000);
    // …but a bill added after a currency change blocks its undo.
    expect((await changeGroupCurrency(g2.id, g2.ids[0], "THB", "0.4")).ok).toBe(true);
    await db.bill.create({ data: { groupId: g2.id, name: "Maid", nature: "fixed", amount: 150000, startMonth: "2026-11", payer: g2.ids[0] } });
    const ev3 = await db.groupEvent.findFirstOrThrow({ where: { groupId: g2.id, kind: "currency_changed" }, orderBy: { createdAt: "desc" } });
    expect((await undoEvent(ev3.id, g2.ids[0])).ok).toBe(false);
  });
});

describe("currency change and back: nothing drifts", () => {
  it("INR → USD → undo, then INR → JPY → undo, with foreign, refund and two-payer expenses: books stay sound and return exactly", { timeout: 120_000 }, async () => {
    const g = await group("trip", "INR", ["A", "B", "C", "D"]);
    const [a, b, c, d] = g.ids;
    const add = async (who: string, over: Partial<SaveExpenseInput>) => {
      const r = await saveExpense(draft(g.id, who, over), who, rate("2.803"));
      if (!r.ok) throw new Error(r.error);
    };
    await add(a, { name: "Flights", amount: "48000.01" });
    await add(b, { name: "Dinner THB", amount: "3333", currency: "THB", paymentMethod: "card", markupChoice: "custom", markupCustom: "3.5" });
    await add(c, { name: "Thirds", amount: "100", forMode: "selected", selected: [a, b, c] });
    await add(d, { name: "Percent", amount: "999.99", splitType: "percent", percent: { [a]: "33.33", [b]: "33.33", [c]: "33.34", [d]: "0" } });
    await add(a, { name: "Refund", amount: "250.50", kind: "refund" });
    await add(a, { name: "Two payers", amount: "1001", multiPay: true, payers: { [a]: "500.5", [b]: "500.5" } });
    await db.payment.create({ data: { groupId: g.id, fromId: d, toId: a, amount: 123457, createdById: d } });
    const start = await sound(g.id);

    for (const [cur, r] of [["USD", "0.0119"], ["JPY", "1.7731"]] as const) {
      const ch = await changeGroupCurrency(g.id, a, cur, r);
      if (!ch.ok) throw new Error(ch.error);
      await sound(g.id);
      const un = await undoEvent(ch.eventId!, a);
      expect(un.ok, `undo ${cur}`).toBe(true);
      expect(await sound(g.id)).toEqual(start);
      expect((await db.group.findUnique({ where: { id: g.id } }))!.currency).toBe("INR");
    }
  });
});

describe("The Pot: random games", () => {
  it("25 random balanced games: each player's result in the group equals what they put back minus what they took; reopening removes it", { timeout: 240_000 }, async () => {
    const rnd = rng(20261111);
    const g = await group("pot", "INR", ["A", "B", "C", "D", "E"]);
    for (let n = 0; n < 25; n++) {
      const players = g.ids.filter(() => rnd() < 0.8);
      if (players.length < 2) continue;
      const before = (await books(g.id)).net;
      const s = await startGame(g.id, players[0], { name: `G${n}`, game: rnd() < 0.5 ? "poker" : "teenpatti", players });
      if (!s.ok) throw new Error(s.error);
      const took: Record<string, number> = {};
      for (const p of players) {
        const times = 1 + Math.floor(rnd() * 3);
        for (let i = 0; i < times; i++) {
          const amt = (1 + Math.floor(rnd() * 40)) * 50;
          const r = await recordMove(s.id, players[0], { memberId: p, kind: "take", amount: String(amt) });
          if (!r.ok) throw new Error(r.error);
          took[p] = (took[p] ?? 0) + amt * 100;
        }
      }
      // Hand the whole pot back in random pieces (some players get nothing).
      let left = Object.values(took).reduce((x, y) => x + y, 0);
      const back: Record<string, number> = {};
      players.forEach((p, i) => {
        const part = i === players.length - 1 ? left : Math.floor((left * rnd()) / 100) * 100;
        back[p] = part;
        left -= part;
      });
      for (const p of players) {
        if (!back[p]) continue;
        const r = await recordMove(s.id, players[0], { memberId: p, kind: "return", amount: String(back[p] / 100) });
        if (!r.ok) throw new Error(r.error);
      }
      const fin = await finishGame(s.id, players[0]);
      if (!fin.ok) throw new Error(`game ${n}: ${fin.error}`);
      const after = (await books(g.id)).net;
      expect(Object.values(after).reduce((x, y) => x + y, 0)).toBe(0);
      for (const id of g.ids) expect(after[id] - before[id], `game ${n} player`).toBe(players.includes(id) ? (back[id] ?? 0) - took[id] : 0);
      if (rnd() < 0.3) {
        const re = await reopenGame(s.id, players[0]);
        if (!re.ok) throw new Error(re.error);
        expect((await books(g.id)).net).toEqual(before);
        expect((await finishGame(s.id, players[0])).ok).toBe(true);
        expect((await books(g.id)).net).toEqual(after);
      }
    }
  });
});

describe("undoing everything", () => {
  it("60 random adds, edits and deletes, then undo newest-first: every undo that's allowed keeps the books exact", { timeout: 240_000 }, async () => {
    const rnd = rng(7);
    const g = await group("trip", "INR", ["A", "B", "C"]);
    const pick = () => g.ids[Math.floor(rnd() * 3)];
    const live: string[] = [];
    for (let i = 0; i < 60; i++) {
      const roll = rnd();
      if (roll < 0.55 || live.length === 0) {
        const who = pick();
        const r = await saveExpense(draft(g.id, who, { name: `E${i}`, amount: String(1 + Math.floor(rnd() * 99999) / 100), kind: rnd() < 0.15 ? "refund" : "expense" }), who, rate());
        if (!r.ok) throw new Error(r.error);
        live.push(r.id);
      } else if (roll < 0.8) {
        const id = live[Math.floor(rnd() * live.length)];
        const who = pick();
        const r = await saveExpense(draft(g.id, who, { expenseId: id, name: `E${i} edited`, amount: String(1 + Math.floor(rnd() * 99999) / 100), rateMode: "keep" }), who, rate());
        if (!r.ok) throw new Error(r.error);
      } else {
        const id = live.splice(Math.floor(rnd() * live.length), 1)[0];
        const r = await setExpenseDeleted(id, pick(), true);
        if (!r.ok) throw new Error(r.error);
      }
    }
    await sound(g.id);
    const events = await db.groupEvent.findMany({ where: { groupId: g.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    let undone = 0;
    for (const ev of events) {
      const r = await undoEvent(ev.id, g.ids[0]);
      if (r.ok) undone++;
      await sound(g.id); // after every step, allowed or refused
    }
    // Undo goes back one step per expense (a product choice, batch C); what it does must always add up.
    expect(undone).toBeGreaterThan(0);
  });
});

describe("passport privacy: added by someone else, undone, brought back", () => {
  it("someone brought back by undoing an undo is still 'added by someone else' until they open the group", async () => {
    const { addRegistered } = await import("@/lib/invites");
    const { canSeePassport } = await import("@/lib/passport-db");
    const stranger = await db.account.create({ data: { email: `fb-stranger-${Date.now()}@test.dev`, name: "Stranger" } });
    const victim = await db.account.create({ data: { email: `fb-victim-${Date.now()}@test.dev`, name: "Victim" } });
    const g = await db.group.create({ data: { name: "Fb privacy", inviteCode: `fbp-${Date.now()}`, members: { create: [{ name: "Stranger", accountId: stranger.id, claimedAt: new Date() }] } }, include: { members: true } });
    groups.push(g.id);
    const me = g.members[0].id;
    const r = await addRegistered(g.id, me, victim.id, "http://localhost");
    expect(r.ok).toBe(true);
    expect((await canSeePassport(stranger.id, victim.id)).ok).toBe(false);
    const added = await db.groupEvent.findFirst({ where: { groupId: g.id, kind: "members_added" }, orderBy: { createdAt: "desc" } });
    const un = await undoEvent(added!.id, me);
    expect(un.ok).toBe(true);
    const redo = await undoEvent(un.ok ? un.eventId! : "", me);
    expect(redo.ok).toBe(true);
    expect(await db.member.count({ where: { groupId: g.id, accountId: victim.id } })).toBe(1);
    expect((await canSeePassport(stranger.id, victim.id)).ok).toBe(false);
    await db.account.deleteMany({ where: { id: { in: [stranger.id, victim.id] } } }).catch(() => undefined);
  });
});

describe("deposit back: refunds add up to exactly what came back", () => {
  it("A put in 1,000 and B 9,000; 4,000 deducted: 6,000 comes back, A 0 and B 6,000", async () => {
    const { depositRefunds } = await import("@/lib/home/moving");
    const r = depositRefunds([{ memberId: "a", amount: 100000 }, { memberId: "b", amount: 900000 }], 400000, { a: 100, b: 100 });
    expect(r).toEqual([{ memberId: "a", refund: 0 }, { memberId: "b", refund: 600000 }]);
    const three = depositRefunds([{ memberId: "a", amount: 1000 }, { memberId: "b", amount: 5000 }, { memberId: "c", amount: 5000 }], 4500, { a: 100, b: 100, c: 100 });
    expect(three.reduce((s, x) => s + x.refund, 0)).toBe(11000 - 4500);
    expect(three.find((x) => x.memberId === "a")!.refund).toBe(0);
  });
});
