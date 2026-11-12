import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { loadGroup, loadGroupSettle, loadMyGroupsLean, loadMyGroupsLight } from "@/lib/group-data";
import { netBalancesDb, settleFactsDb } from "@/lib/balances-db";
import { netBalances } from "@/lib/balances";
import { pairwiseDebtCount, smartSettle } from "@/lib/settle";
import { planKey, settleAllAndClose } from "@/lib/settle-all";
import { allocateByWeights } from "@/lib/split";
import { buildActivity } from "@/lib/activity";
import { dayKey, todayKey } from "@/lib/dates";
import { monthNumbers } from "@/lib/home/banner";
import { dayWindow, loadHomeRows, monthWindow, wrappedEnded } from "@/lib/home/home-data";

// Speed stage 2: balances added up by the database, and Home reading only the rows it shows.
// Every number must be exactly what the full method gives. Money is in paise.

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
      name: `S2 ${stamp}-${seq}`,
      inviteCode: `s2-${stamp}-${seq}-${Math.random().toString(36).slice(2, 6)}`,
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

// The hand-worked trip from the plan. A, B, C, D (D can leave; "extra" adds an expense D isn't part of, after D left).
//   E1  A paid 100000.   Shares A 33334, B 33333, C 33333.
//   E2  B paid 30000 and C paid 20000.   Shares 12500 each (A, B, C, D).
//   E3  Money back, 9000 received by D.   Shares A 4500, D 4500.
//   E4  C paid 70000. DELETED.
//   E5  A paid 10300 (300 of it a card fee).   Shares B 5150, D 5150.
//   E6  10000 paid by B and C in equal parts.   Shares A 10000.
//   P1  B pays A 20000.   P2  D pays C 5000.   P3  C pays A 99999. DELETED.
//   E7 (extra)  A paid 6000, shares A 3000, B 3000, on 8 Nov. D left on 7 Nov.
// Balances: A +38966, B +4017, C -25833, D -17150 (adding up to zero). Plan: C pays A 25833, D pays A 13133, D pays B 4017.
// With E7: A +41966, B +1017, C -25833, D -17150. Plan: C pays A 25833, D pays A 16133, D pays B 1017.
const d = (n: number, h = 10) => new Date(Date.UTC(2026, 10, n, h));
async function handTrip(opts: { extra?: boolean } = {}) {
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
  if (opts.extra) {
    await mkExpense(g.gid, "After D left", 6000, A, [[A, 3000], [B, 3000]], d(8));
    await db.member.update({ where: { id: D }, data: { leftAt: d(7) } });
  }
  return { ...g, A, B, C, D };
}

const named = (nameOf: Record<string, string>, net: Record<string, number>) => Object.fromEntries(Object.entries(net).map(([id, v]) => [nameOf[id], v]));
const planNamed = (nameOf: Record<string, string>, ts: { from: string; to: string; amount: number }[]) => ts.map((t) => ({ from: nameOf[t.from], to: nameOf[t.to], amount: t.amount }));
const sum = (net: Record<string, number>) => Object.values(net).reduce((a, b) => a + b, 0);

describe("netBalancesDb: the hand-worked trip", () => {
  it("gives A +38966, B +4017, C -25833, D -17150, in member order, and the plan C>A 25833, D>A 13133, D>B 4017", async () => {
    const t = await handTrip();
    const bal = (await netBalancesDb([t.gid])).get(t.gid)!;
    expect(bal.fallback).toBe(false);
    expect(bal.memberIds).toEqual([t.A, t.B, t.C, t.D]);
    expect(named(t.nameOf, bal.net)).toEqual({ A: 38966, B: 4017, C: -25833, D: -17150 });
    expect(Object.keys(bal.net).map((id) => t.nameOf[id])).toEqual(["A", "B", "C", "D"]);
    expect(sum(bal.net)).toBe(0);
    expect(planNamed(t.nameOf, bal.transfers)).toEqual([
      { from: "C", to: "A", amount: 25833 },
      { from: "D", to: "A", amount: 13133 },
      { from: "D", to: "B", amount: 4017 },
    ]);
  });

  it("is exactly the full method: same balances in the same order, same plan, same planKey", async () => {
    const t = await handTrip();
    const full = (await loadGroup(t.gid))!;
    const bal = (await netBalancesDb([t.gid])).get(t.gid)!;
    expect(Object.entries(bal.net)).toEqual(Object.entries(full.net));
    expect(bal.transfers).toEqual(full.transfers);
    expect(planKey(bal.transfers)).toBe(planKey(full.transfers));
    // Handing it the member order (as Home does) changes nothing.
    const given = (await netBalancesDb([t.gid], { members: { [t.gid]: full.group.members.map((m) => m.id) } })).get(t.gid)!;
    expect(given).toEqual(bal);
    // After those three payments everyone is exactly square.
    const paid = bal.transfers.map((x) => ({ fromId: x.from, toId: x.to, amount: x.amount }));
    const after = netBalances(bal.memberIds, full.expenses, [...full.payments, ...paid]);
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });

  it("answers for several groups at once", async () => {
    const [t1, t2] = [await handTrip(), await handTrip({ extra: true })];
    const both = await netBalancesDb([t1.gid, t2.gid]);
    expect(named(t1.nameOf, both.get(t1.gid)!.net)).toEqual({ A: 38966, B: 4017, C: -25833, D: -17150 });
    expect(named(t2.nameOf, both.get(t2.gid)!.net)).toEqual({ A: 41966, B: 1017, C: -25833, D: -17150 });
    expect(planNamed(t2.nameOf, both.get(t2.gid)!.transfers)).toEqual([
      { from: "C", to: "A", amount: 25833 },
      { from: "D", to: "A", amount: 16133 },
      { from: "D", to: "B", amount: 1017 },
    ]);
    expect((await netBalancesDb([])).size).toBe(0);
  });

  it("settle facts: 5 expenses and 2 payments counted, 25000 paid back, 5 debts without Smart Settle (3 with it)", async () => {
    // By hand, pair by pair (+ = first owes second):
    //   A-B: B owes A 33333+5150, A owes B 7500+5000+20000 -> B owes A 5983.   A-C: C owes A 33333, A owes C 5000+5000 -> nonzero.
    //   A-D: D owes A 4500+5150.   B-C: B owes C 5000, C owes B 7500 -> nonzero.   B-D: D owes B 7500.
    //   C-D: D owes C 5000, but D paid C 5000 -> 0.   So 5 debts, and Smart Settle needs 3.
    const t = await handTrip();
    const facts = await settleFactsDb(t.gid);
    expect(facts).toEqual({ expenseCount: 5, paymentCount: 2, paidSoFar: 25000, before: 5 });
    const full = (await loadGroup(t.gid))!;
    expect(facts.before).toBe(pairwiseDebtCount(full.expenses, full.payments));
  });
});

// A small seeded random number generator so the "random" trip is the same every run.
function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// About 400 expenses over 7 people: several payers (some lists that don't add up), refunds, deleted items,
// THB expenses with a 3% card fee, payments (some deleted), and a leaver.
async function randomTrip(seed: number) {
  const rand = mulberry(seed);
  const g = await newGroup(["P0", "P1", "P2", "P3", "P4", "P5", "P6"]);
  const shuffled = () => {
    const a = [...g.ids];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const base = Date.UTC(2026, 9, 1);
  const expenses: Prisma.ExpenseCreateManyInput[] = [];
  const shares: Prisma.ExpenseShareCreateManyInput[] = [];
  for (let i = 0; i < 400; i++) {
    const id = `x${stamp}-${seed}-${i}`;
    const people = shuffled();
    const foreign = rand() < 0.15;
    const original = 1000 + Math.floor(rand() * 50000);
    const converted = foreign ? Math.round(original * 2.8) : original;
    const markup = foreign ? Math.round(converted * 0.03) : 0;
    const amount = converted + markup;
    let payers = "";
    if (rand() < 0.12) {
      const n = 2 + Math.floor(rand() * 2);
      const list = allocateByWeights(amount, people.slice(0, n).map((m) => ({ memberId: m, weight: 1 + Math.floor(rand() * 5) })));
      if (rand() < 0.1 && list[0].amount > 1) list[0] = { ...list[0], amount: list[0].amount - 1 }; // a saved list that doesn't add up
      payers = JSON.stringify(list.filter((p) => p.amount > 0).map((p) => ({ m: p.memberId, a: p.amount })));
    }
    const sharers = people.slice(0, 2 + Math.floor(rand() * 6));
    const at = base + i * 60_000;
    expenses.push({
      id, groupId: g.gid, description: `Item ${i}`, amount, splitType: "exact", originalAmount: original, originalCurrency: foreign ? "THB" : "INR", exchangeRate: foreign ? "2.8" : "1",
      convertedAmount: converted, markupBp: foreign ? 300 : 0, markupAmount: markup, paymentMethod: foreign ? "card" : "", rateSource: foreign ? "api" : "same",
      paidById: people[0], createdById: people[0], createdAt: new Date(at), payers, kind: rand() < 0.08 ? "refund" : "expense", deletedAt: rand() < 0.1 ? new Date(at + 30_000) : null,
    });
    for (const s of allocateByWeights(amount, sharers.map((m) => ({ memberId: m, weight: 1 + Math.floor(rand() * 4) })))) shares.push({ expenseId: id, memberId: s.memberId, amount: s.amount });
  }
  await db.expense.createMany({ data: expenses });
  await db.expenseShare.createMany({ data: shares });
  const pays: Prisma.PaymentCreateManyInput[] = [];
  for (let i = 0; i < 60; i++) {
    const [from, to] = shuffled();
    pays.push({ groupId: g.gid, fromId: from, toId: to, amount: 100 + Math.floor(rand() * 30000), createdById: from, createdAt: new Date(base + i * 90_000), deletedAt: i % 10 === 0 ? new Date(base + i * 90_000 + 1000) : null });
  }
  await db.payment.createMany({ data: pays });
  await db.member.update({ where: { id: g.ids[6] }, data: { leftAt: new Date(base + 200 * 60_000) } });
  return g;
}

describe("netBalancesDb: a random 400-expense trip", () => {
  for (const seed of [7, 2026]) {
    it(`seed ${seed}: same balances in the same order, same plan, same planKey, same settle facts as the full method`, async () => {
      const g = await randomTrip(seed);
      const full = (await loadGroup(g.gid))!;
      // The trip really has the awkward cases in it.
      const rows = full.group.expenses;
      expect(rows.length).toBe(400);
      expect(rows.filter((e) => e.deletedAt).length).toBeGreaterThan(20);
      expect(rows.filter((e) => e.kind === "refund").length).toBeGreaterThan(10);
      expect(rows.filter((e) => e.payers !== "").length).toBeGreaterThan(20);
      expect(rows.filter((e) => e.markupAmount > 0).length).toBeGreaterThan(30);
      expect(full.group.payments.filter((p) => p.deletedAt).length).toBeGreaterThan(3);

      const bal = (await netBalancesDb([g.gid])).get(g.gid)!;
      expect(bal.fallback).toBe(false);
      expect(bal.memberIds).toEqual(full.group.members.map((m) => m.id));
      expect(Object.entries(bal.net)).toEqual(Object.entries(full.net));
      expect(sum(bal.net)).toBe(0);
      expect(bal.transfers).toEqual(full.transfers);
      expect(bal.transfers).toEqual(smartSettle(full.net));
      expect(planKey(bal.transfers)).toBe(planKey(full.transfers));

      const facts = await settleFactsDb(g.gid);
      expect(facts).toEqual({ expenseCount: full.expenses.length, paymentCount: full.payments.length, paidSoFar: full.payments.reduce((t, p) => t + p.amount, 0), before: pairwiseDebtCount(full.expenses, full.payments) });
      // The group Settle page's data is the same too (a member who is still in).
      const page = (await loadGroupSettle(g.gid, g.ids[0]))!;
      expect(page.transfers).toEqual(full.transfers);
      expect(page.before).toBe(facts.before);
      // The leaver (P6) sees their own line and their own payments only, as before.
      const leaver = (await loadGroupSettle(g.gid, g.ids[6]))!;
      const fullLeaver = (await loadGroup(g.gid, { viewer: g.ids[6], events: false }))!;
      expect(leaver.transfers).toEqual(fullLeaver.transfers);
      expect(leaver.expenseCount).toBe(fullLeaver.expenses.length);
      expect(leaver.paymentCount).toBe(fullLeaver.payments.length);
      expect(leaver.before).toBe(pairwiseDebtCount(fullLeaver.expenses, fullLeaver.payments));
      expect(leaver.leaver).toEqual(fullLeaver.leaver);
    });
  }
});

describe("the page and the settle actions agree on the plan", () => {
  it("the plan the Settle page shows is accepted by 'settle everything' (no false 'Balances changed')", async () => {
    const t = await handTrip();
    const page = (await loadGroupSettle(t.gid, t.A))!;
    const full = (await loadGroup(t.gid, { events: false }))!;
    expect(planKey(page.transfers)).toBe(planKey(full.transfers));
    const done = await settleAllAndClose(t.gid, t.A, planKey(page.transfers));
    expect(done.ok).toBe(true);
    const after = (await loadGroup(t.gid))!;
    expect(Object.values(after.net).every((v) => v === 0)).toBe(true);
    expect(after.transfers).toEqual([]);
    expect(after.group.closed).toBe(true);
  });

  it("a stale plan is still refused", async () => {
    const t = await handTrip();
    const page = (await loadGroupSettle(t.gid, t.A))!;
    await mkPayment(t.gid, t.C, t.A, 1000, d(9)); // balances move after the page was drawn
    const done = await settleAllAndClose(t.gid, t.A, planKey(page.transfers));
    expect(done.ok).toBe(false);
  });
});

describe("someone who left", () => {
  it("D sees only their own line and only the payments they are in; later spending without them stays hidden", async () => {
    const t = await handTrip({ extra: true });
    const full = (await loadGroup(t.gid, { viewer: t.D, events: false }))!;
    const page = (await loadGroupSettle(t.gid, t.D))!;
    expect(page.leaver).not.toBeNull();
    expect(page.leaver).toEqual(full.leaver);
    expect(planNamed(t.nameOf, page.transfers)).toEqual([
      { from: "D", to: "A", amount: 16133 },
      { from: "D", to: "B", amount: 1017 },
    ]);
    expect(page.transfers).toEqual(full.transfers);
    // Five expenses before they left (the deleted one doesn't count); the one after, without them, is not theirs to see.
    expect(page.expenseCount).toBe(5);
    expect(page.expenseCount).toBe(full.expenses.length);
    expect(page.paymentCount).toBe(2);
    expect(page.paidSoFar).toBe(25000);
    expect(page.before).toBe(pairwiseDebtCount(full.expenses, full.payments));
    // Someone still in sees all six, and the same plan as D's lines come from.
    const a = (await loadGroupSettle(t.gid, t.A))!;
    expect(a.leaver).toBeNull();
    expect(a.expenseCount).toBe(6);
    expect(a.transfers).toEqual((await loadGroup(t.gid, { viewer: t.A, events: false }))!.transfers);
  });

  it("Home's entries are the same as before for A, D (left) and B", async () => {
    const t = await handTrip({ extra: true });
    for (const me of [t.A, t.D, t.B]) {
      const memberships = { [t.gid]: me };
      const lean = (await loadMyGroupsLean(memberships))[0];
      const light = (await loadMyGroupsLight(memberships))[0];
      expect(light.net).toEqual(lean.net);
      expect(Object.keys(light.net)).toEqual(Object.keys(lean.net));
      expect(light.transfers).toEqual(lean.transfers);
      expect(light.myBalance).toBe(lean.myBalance);
      expect(light.spent).toBe(lean.spent);
      expect(light.people).toBe(lean.people);
      expect(light.leaver).toEqual(lean.leaver);
      expect(light.lastActivity).toEqual(lean.lastActivity);
      expect(light.myId).toBe(lean.myId);
      expect(light.expenseCount).toBe(lean.expenses.length);
      expect(light.paymentCount).toBe(lean.payments.length);
      expect(light.lastPaymentAt?.getTime() ?? null).toBe(lean.payments.length ? Math.max(...lean.payments.map((p) => p.createdAt.getTime())) : null);
      const { expenses: _e, payments: _p, ...rest } = lean.group;
      expect(light.group).toEqual(rest);
    }
    // By hand: D's own line is -17150 whoever looks; A's is +41966.
    expect((await loadMyGroupsLight({ [t.gid]: t.D }))[0].myBalance).toBe(-17150);
    expect((await loadMyGroupsLight({ [t.gid]: t.A }))[0].myBalance).toBe(41966);
    // Spent (not deleted, money back taken off): 100000 + 50000 - 9000 + 10300 + 10000 = 161300 for A (all six: + 6000 = 167300); D (left) misses the last.
    expect((await loadMyGroupsLight({ [t.gid]: t.A }))[0].spent).toBe(167300);
    expect((await loadMyGroupsLight({ [t.gid]: t.D }))[0].spent).toBe(161300);
  });

  it("the random trip's entries match for everyone, the leaver included", async () => {
    const g = await randomTrip(99);
    for (const me of g.ids) {
      const memberships = { [g.gid]: me };
      const lean = (await loadMyGroupsLean(memberships))[0];
      const light = (await loadMyGroupsLight(memberships))[0];
      expect(Object.entries(light.net)).toEqual(Object.entries(lean.net));
      expect(light.transfers).toEqual(lean.transfers);
      expect(light.myBalance).toBe(lean.myBalance);
      expect(light.spent).toBe(lean.spent);
      expect(light.expenseCount).toBe(lean.expenses.length);
      expect(light.paymentCount).toBe(lean.payments.length);
      expect(light.lastActivity).toEqual(lean.lastActivity);
    }
  });
});

describe("the fallback to the full method", () => {
  async function withStranger() {
    const other = await newGroup(["S"]); // S is a member of a different group
    const g = await newGroup(["A", "B"]);
    return { S: other.ids[0], A: g.ids[0], B: g.ids[1], gid: g.gid };
  }
  const check = async (gid: string) => {
    const bal = (await netBalancesDb([gid])).get(gid)!;
    const full = (await loadGroup(gid))!;
    expect(bal.fallback).toBe(true);
    expect(Object.entries(bal.net)).toEqual(Object.entries(full.net));
    expect(bal.transfers).toEqual(full.transfers);
    expect(planKey(bal.transfers)).toBe(planKey(full.transfers));
  };

  it("is used when a share belongs to someone who isn't a member", async () => {
    const x = await withStranger();
    await mkExpense(x.gid, "Odd", 1000, x.A, [[x.A, 500], [x.S, 500]], d(1));
    await check(x.gid);
  });
  it("is used when the payer isn't a member", async () => {
    const x = await withStranger();
    await mkExpense(x.gid, "Odd", 1000, x.S, [[x.A, 500], [x.B, 500]], d(1));
    await check(x.gid);
  });
  it("is used when a several-payers list names a non-member", async () => {
    const x = await withStranger();
    await mkExpense(x.gid, "Odd", 1000, x.A, [[x.A, 500], [x.B, 500]], d(1), { payers: JSON.stringify([{ m: x.A, a: 600 }, { m: x.S, a: 400 }]) });
    await check(x.gid);
  });
  it("is used when a payment involves a non-member", async () => {
    const x = await withStranger();
    await mkExpense(x.gid, "Fine", 1000, x.A, [[x.A, 500], [x.B, 500]], d(1));
    await mkPayment(x.gid, x.S, x.A, 300, d(2));
    await check(x.gid);
  });
  it("is not used for a normal group, and one odd group doesn't change its neighbour", async () => {
    const odd = await withStranger();
    await mkExpense(odd.gid, "Odd", 1000, odd.A, [[odd.A, 500], [odd.S, 500]], d(1));
    const t = await handTrip();
    const both = await netBalancesDb([odd.gid, t.gid]);
    expect(both.get(odd.gid)!.fallback).toBe(true);
    expect(both.get(t.gid)!.fallback).toBe(false);
    expect(named(t.nameOf, both.get(t.gid)!.net)).toEqual({ A: 38966, B: 4017, C: -25833, D: -17150 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Home: Latest, this month and today, near midnight in far-apart time zones.

const iso = (s: string) => new Date(s);
const NOW = iso("2026-11-12T20:00:00Z");
// Kiritimati is UTC+14 and Etc/GMT+12 is UTC-12: the two ends of the clock.
const ZONES = ["Asia/Kolkata", "America/Los_Angeles", "Pacific/Kiritimati", "Etc/GMT+12"];

async function homeWorld() {
  // Main trip: Me and You split everything half and half (all amounts even).
  const main = await newGroup(["Me", "You"], { type: "trip", tripStart: "2026-11-01", tripEnd: "2026-11-30" });
  const [me, you] = main.ids;
  const half = (amount: number): [string, number][] => [[me, amount / 2], [you, amount / 2]];
  const add = (description: string, amount: number, createdAt: string, more: Partial<Prisma.ExpenseUncheckedCreateInput> = {}) => mkExpense(main.gid, description, amount, me, half(amount), iso(createdAt), more);
  // Around the month ends:
  await add("a Oct 31 09:59Z", 1000, "2026-10-31T09:59:00Z");
  await add("b Oct 31 10:01Z", 2000, "2026-10-31T10:01:00Z");
  await add("c Nov 30 09:59Z", 3000, "2026-11-30T09:59:00Z");
  await add("d Nov 30 10:01Z", 4000, "2026-11-30T10:01:00Z");
  await add("e Dec 1 11:30Z", 5000, "2026-12-01T11:30:00Z");
  await add("f spent Nov 5", 800, "2026-12-20T00:00:00Z", { spentAt: iso("2026-11-05T12:00:00Z") });
  // Around the days (today is 12 or 13 Nov depending on the zone):
  await add("t1", 100, "2026-11-12T18:29:00Z");
  await add("t2", 200, "2026-11-12T18:31:00Z");
  await add("t3", 300, "2026-11-13T07:59:00Z");
  await add("t4", 400, "2026-11-13T08:01:00Z");
  await add("t5", 500, "2026-11-11T10:01:00Z");
  await add("t6 spent Nov 12", 600, "2026-09-01T10:00:00Z", { spentAt: iso("2026-11-12T12:00:00Z") });
  // Newest by its own day although added long ago; newest of all but deleted:
  await add("u spent Dec 2", 700, "2026-09-02T10:00:00Z", { spentAt: iso("2026-12-02T12:00:00Z") });
  await add("deleted newest", 777, "2026-12-03T10:00:00Z", { deletedAt: iso("2026-12-03T11:00:00Z"), deletedById: me });
  await mkPayment(main.gid, you, me, 50, iso("2026-11-13T00:00:00Z"));

  // A second open group with money back and a card-game result.
  const other = await newGroup(["Me", "You"], { type: "other" });
  const [om, oy] = other.ids;
  await mkExpense(other.gid, "Refund", 150, om, [[om, 75], [oy, 75]], iso("2026-11-12T19:00:00Z"), { kind: "refund" });
  await mkExpense(other.gid, "Pot", 900, om, [[om, 450], [oy, 450]], iso("2026-11-12T19:00:00Z"), { kind: "pot" });
  await mkExpense(other.gid, "Lunch", 300, oy, [[om, 150], [oy, 150]], iso("2026-11-12T19:30:00Z"));

  // A group I left on 1 Nov: later spending without me must stay hidden.
  const left = await newGroup(["Me", "You", "Third"], { type: "trip", tripStart: "2026-11-01", tripEnd: "2026-11-30" });
  const [lm, ly, lt] = left.ids;
  await mkExpense(left.gid, "Early", 400, ly, [[ly, 200], [lm, 200]], iso("2026-10-20T10:00:00Z"));
  await mkExpense(left.gid, "Includes me", 600, ly, [[ly, 300], [lm, 300]], iso("2026-11-10T10:00:00Z"));
  await mkExpense(left.gid, "Later without me", 800, ly, [[ly, 400], [lt, 400]], iso("2026-12-02T10:00:00Z"));
  await mkPayment(left.gid, ly, lt, 100, iso("2026-11-11T10:00:00Z"));
  await db.member.update({ where: { id: lm }, data: { leftAt: iso("2026-11-01T00:00:00Z") } });

  // A trip that ended on 7 Nov, for its Wrapped card: food 100 + 200, transport 50; the rest doesn't count.
  const ended = await newGroup(["Me", "You"], { type: "trip", tripStart: "2026-11-01", tripEnd: "2026-11-07" });
  const [em, ey] = ended.ids;
  const e = (description: string, amount: number, category: string, more: Partial<Prisma.ExpenseUncheckedCreateInput> = {}) =>
    mkExpense(ended.gid, description, amount, em, [[em, amount / 2], [ey, amount / 2]], iso("2026-11-03T10:00:00Z"), { category, ...more });
  await e("Lunch", 100, "food");
  await e("Dinner", 200, "food");
  await e("Taxi", 50, "transport");
  await e("Card game", 998, "food", { kind: "pot" });
  await e("Money back", 40, "food", { kind: "refund" });
  await e("Deleted", 500, "food", { deletedAt: iso("2026-11-04T10:00:00Z") });

  return {
    main: main.gid, other: other.gid, left: left.gid, ended: ended.gid,
    memberships: { [main.gid]: me, [other.gid]: om, [left.gid]: lm, [ended.gid]: em } as Record<string, string>,
    me,
  };
}

// What Home did before: every group's whole history, filtered in memory.
async function oldHome(memberships: Record<string, string>, tz: string, today: string) {
  const all = await loadMyGroupsLean(memberships);
  const open = all.filter((g) => !g.group.closed);
  const recent = open
    .flatMap((g) => buildActivity(g.expenses, g.payments, g.myId))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 5)
    .map((i) => i.id);
  const month = monthNumbers(all.map((g) => ({ currency: g.group.currency, myId: g.myId, expenses: g.expenses })), (a) => a, "INR", NOW, tz);
  const todayIds = Object.fromEntries(
    open
      .filter((g) => !g.leaver && g.group.type === "trip" && g.group.tripStart)
      .map((g) => [g.group.id, g.expenses.filter((e) => e.kind !== "pot" && e.kind !== "refund" && dayKey(e.spentAt ?? e.createdAt, tz) === today).map((e) => e.id).sort()]),
  );
  return { recent, month, todayIds };
}

describe("Home reads only the rows it shows, and shows what it always showed", () => {
  for (const tz of ZONES) {
    it(`${tz}: Latest, this month and today are the same as from the whole history`, async () => {
      const w = await homeWorld();
      const today = todayKey(NOW, tz);
      const old = await oldHome(w.memberships, tz, today);

      const light = await loadMyGroupsLight(w.memberships);
      const rows = await loadHomeRows(light, { tz, now: NOW, today });

      // Latest: the five newest changes across open groups.
      const recent = light
        .filter((g) => !g.group.closed)
        .flatMap((g) => {
          const r = rows.recent.get(g.group.id);
          return r ? buildActivity(r.expenses, r.payments, g.myId) : [];
        })
        .sort((a, b) => b.date.getTime() - a.date.getTime())
        .slice(0, 5)
        .map((i) => i.id);
      expect(recent).toEqual(old.recent);
      expect(recent).toHaveLength(5);

      // This month.
      const month = monthNumbers(rows.monthGroups, (a) => a, "INR", NOW, tz);
      expect(month).toEqual(old.month);

      // Today's spending on each trip that is on.
      for (const [gid, ids] of Object.entries(old.todayIds)) {
        const got = (rows.today.get(gid) ?? []).filter((e) => e.kind !== "pot" && e.kind !== "refund" && dayKey(e.spentAt ?? e.createdAt, tz) === today).map((e) => e.id).sort();
        expect(got).toEqual(ids);
      }
    });
  }

  it("Latest is by the day an expense was spent on, leaves out deleted ones, and keeps what a leaver may not read hidden", async () => {
    const w = await homeWorld();
    const light = await loadMyGroupsLight(w.memberships);
    const rows = await loadHomeRows(light, { tz: "Asia/Kolkata", now: NOW, today: "2026-11-13" });
    const items = light
      .filter((g) => !g.group.closed)
      .flatMap((g) => {
        const r = rows.recent.get(g.group.id);
        return r ? buildActivity(r.expenses, r.payments, g.myId) : [];
      })
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, 5);
    // By hand, newest first: u (spent 2 Dec, added in Sept), e (1 Dec 11:30), d (30 Nov 10:01), c (30 Nov 09:59), t4 (13 Nov 08:01).
    // Not there: the deleted expense (3 Dec) and "Later without me" (2 Dec 10:00), which the group added after I left.
    expect(items.map((i) => (i.kind === "expense" ? i.title : "payment"))).toEqual(["u spent Dec 2", "e Dec 1 11:30Z", "d Nov 30 10:01Z", "c Nov 30 09:59Z", "t4"]);
  });

  // By hand, in each zone (Me's half of each expense). t1 to t6 (100 + 200 + 300 + 400 + 500 + 600 = 2100) are in November
  // in every zone; "u" is 2 Dec and the deleted one never counts. So the zones differ only by a, b, c, d, e, f:
  //   Kolkata (+5:30): c 3000, d 4000, f 800 are November -> 3 + 6 = 9 expenses, my half (7800 + 2100) / 2 = 4950.
  //   Los Angeles (-8): the same -> 9, 4950.
  //   Kiritimati (+14): b 2000 is already 1 Nov and d 4000 is already 1 Dec; c 3000, f 800 stay -> b, c, f + 6 = 9, (5800 + 2100) / 2 = 3950.
  //   Etc/GMT+12 (-12): e (1 Dec 11:30Z) is still 30 Nov -> c, d, e, f + 6 = 10, (12800 + 2100) / 2 = 7450.
  // Today (12 Nov in LA and GMT+12, 13 Nov in Kolkata and Kiritimati), by amount:
  //   Kolkata {200, 300, 400}   LA {100, 200, 300, 600}   Kiritimati {100, 200, 300, 400}   GMT+12 {100, 200, 300, 400, 600}
  const EXPECT: Record<string, { count: number; share: number; today: number[] }> = {
    "Asia/Kolkata": { count: 9, share: 4950, today: [200, 300, 400] },
    "America/Los_Angeles": { count: 9, share: 4950, today: [100, 200, 300, 600] },
    "Pacific/Kiritimati": { count: 9, share: 3950, today: [100, 200, 300, 400] },
    "Etc/GMT+12": { count: 10, share: 7450, today: [100, 200, 300, 400, 600] },
  };
  for (const tz of ZONES) {
    it(`${tz}: the hand-worked month and today for the main trip`, async () => {
      const w = await homeWorld();
      const today = todayKey(NOW, tz);
      const light = (await loadMyGroupsLight(w.memberships)).filter((g) => g.group.id === w.main);
      const rows = await loadHomeRows(light, { tz, now: NOW, today });
      const month = monthNumbers(rows.monthGroups, (a) => a, "INR", NOW, tz)!;
      expect(month.month).toBe("2026-11");
      expect({ count: month.count, share: month.share }).toEqual({ count: EXPECT[tz].count, share: EXPECT[tz].share });
      const spent = (rows.today.get(w.main) ?? [])
        .filter((e) => dayKey(e.spentAt ?? e.createdAt, tz) === today)
        .map((e) => e.amount)
        .sort((a, b) => a - b);
      expect(spent).toEqual(EXPECT[tz].today);
    });
  }

  it("the wider windows cover a day or month in any zone, and Wrapped reads only the trip that just ended", async () => {
    // 14 hours each way: Kiritimati's 1 Nov 00:00 is 31 Oct 10:00 UTC; GMT+12's end of 30 Nov is 1 Dec 12:00 UTC.
    expect(monthWindow("2026-11")).toEqual({ from: iso("2026-10-31T10:00:00Z"), to: iso("2026-12-01T14:00:00Z") });
    expect(dayWindow("2026-11-13")).toEqual({ from: iso("2026-11-12T10:00:00Z"), to: iso("2026-11-14T14:00:00Z") });

    const w = await homeWorld();
    const tz = "America/Los_Angeles";
    const today = todayKey(NOW, tz);
    const light = await loadMyGroupsLight(w.memberships);
    const ended = light.find((g) => g.group.id === w.ended)!;
    expect(ended.expenseCount).toBe(5); // not deleted: two meals, a taxi, a card game, money back
    expect(wrappedEnded(ended, today)).toBe(5); // ended 7 Nov, today 12 Nov
    expect(wrappedEnded(light.find((g) => g.group.id === w.main)!, today)).toBeNull(); // still on
    expect(wrappedEnded(light.find((g) => g.group.id === w.left)!, today)).toBeNull(); // I left that one
    const rows = await loadHomeRows(light, { tz, now: NOW, today });
    expect([...rows.categories.keys()]).toEqual([w.ended]);
    expect(Object.fromEntries(rows.categories.get(w.ended)!)).toEqual({ food: 300, transport: 50 });
  });

  it("Home with no groups at all reads nothing and breaks nothing", async () => {
    const rows = await loadHomeRows([], { tz: "Asia/Kolkata", now: NOW, today: "2026-11-13" });
    expect(rows.recent.size).toBe(0);
    expect(rows.monthGroups).toEqual([]);
    expect(rows.today.size).toBe(0);
    expect(rows.categories.size).toBe(0);
    expect(await loadMyGroupsLight({})).toEqual([]);
  });
});
