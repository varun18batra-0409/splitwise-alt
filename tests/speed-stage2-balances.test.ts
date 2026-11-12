import { afterAll, describe, expect, it, vi } from "vitest";
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
      // (What a leaver sees on Settle is checked against hand-worked numbers, in "someone who left" below: that path
      // is loadGroup itself, so comparing it with loadGroup would prove nothing.)
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
    const page = (await loadGroupSettle(t.gid, t.D))!;
    // By hand, from the trip's notes above: D left on 7 Nov 10:00, so E7 (8 Nov, without D) is hidden and the group's
    // balances are A +41966, B +1017, C -25833, D -17150; D's view keeps only D's own line.
    expect(page.leaver).toEqual({ leftAt: d(7), removed: false });
    expect(planNamed(t.nameOf, page.transfers)).toEqual([
      { from: "D", to: "A", amount: 16133 },
      { from: "D", to: "B", amount: 1017 },
    ]);
    // Five expenses before they left (E1, E2, E3, E5, E6; the deleted E4 doesn't count); E7, after, without them, is not theirs to see.
    expect(page.expenseCount).toBe(5);
    // P1 (20000) and P2 (5000) were recorded before D left; P3 is deleted: 2 payments, 25000.
    expect(page.paymentCount).toBe(2);
    expect(page.paidSoFar).toBe(25000);
    // Debts without Smart Settle, over E1, E2, E3, E5, E6, P1, P2 (positive = first owes second):
    //   A-B: B owes A 33333 + 5150 = 38483, A owes B 7500 + 5000 = 12500, P1 takes off 20000 -> B owes A 5983.
    //   A-C: C owes A 33333, A owes C 5000 + 5000 -> C owes A 23333.   A-D: D owes A 4500 + 5150 = 9650.
    //   B-C: B owes C 5000, C owes B 7500 -> C owes B 2500.   B-D: D owes B 7500.
    //   C-D: D owes C 5000, P2 pays it back -> 0, no debt.   So 5 separate debts.
    expect(page.before).toBe(5);
    // Someone still in sees all six expenses and the plan with E7: C>A 25833, D>A 16133, D>B 1017.
    const a = (await loadGroupSettle(t.gid, t.A))!;
    expect(a.leaver).toBeNull();
    expect(a.expenseCount).toBe(6);
    expect(a.paymentCount).toBe(2);
    expect(a.paidSoFar).toBe(25000);
    expect(planNamed(t.nameOf, a.transfers)).toEqual([
      { from: "C", to: "A", amount: 25833 },
      { from: "D", to: "A", amount: 16133 },
      { from: "D", to: "B", amount: 1017 },
    ]);
    // The independent full loader agrees for the person who is still in.
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

// ---------------------------------------------------------------------------------------------------------------
// Latest when many things share a moment; "Your month" at the turn of a month or year; a closed group; a mix of groups.

// Latest as the Home page builds it from the rows loadHomeRows hands back: buildActivity per open group, newest first, five.
function latestIds(light: Awaited<ReturnType<typeof loadMyGroupsLight>>, rows: Awaited<ReturnType<typeof loadHomeRows>>) {
  return light
    .filter((g) => !g.group.closed)
    .flatMap((g) => {
      const r = rows.recent.get(g.group.id);
      return r ? buildActivity(r.expenses, r.payments, g.myId) : [];
    })
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 5);
}
const halves = (me: string, you: string, amount: number): [string, number][] => [[me, amount / 2], [you, amount / 2]];

describe("Latest when several expenses share the same day", () => {
  it("seven expenses spent at the same moment across two groups give the same five as the whole-history method", async () => {
    const T = iso("2026-11-10T12:00:00Z");
    const min = (n: number) => new Date(T.getTime() + n * 60_000);
    // Group 1 was made first, group 2 later, so group 2 comes first on Home.
    const g1 = await newGroup(["Me", "You"], { createdAt: iso("2026-10-01T10:00:00Z") });
    const g2 = await newGroup(["Me", "You"], { createdAt: iso("2026-10-02T10:00:00Z") });
    const add = (g: typeof g1, description: string, createdAt: Date, spent: boolean) =>
      mkExpense(g.gid, description, 1000, g.ids[0], halves(g.ids[0], g.ids[1], 1000), createdAt, spent ? { spentAt: T } : {});
    // Group 1: three with the chosen day T (added 1, 2, 3 minutes after T), one with no chosen day added exactly at T.
    await add(g1, "g1 s1", min(1), true);
    await add(g1, "g1 s2", min(2), true);
    await add(g1, "g1 s3", min(3), true);
    await add(g1, "g1 plain", T, false);
    // Group 2: three with the chosen day T.
    await add(g2, "g2 s1", min(1), true);
    await add(g2, "g2 s2", min(2), true);
    await add(g2, "g2 s3", min(3), true);
    const memberships = { [g1.gid]: g1.ids[0], [g2.gid]: g2.ids[0] };
    const tz = "Asia/Kolkata";
    const today = todayKey(NOW, tz);

    const old = await oldHome(memberships, tz, today);
    const light = await loadMyGroupsLight(memberships);
    const rows = await loadHomeRows(light, { tz, now: NOW, today });
    const items = latestIds(light, rows);
    expect(items.map((i) => i.id)).toEqual(old.recent);

    // By hand: all seven are dated T. A tie keeps the order the groups are in (group 2 first) and, inside a group,
    // the one added last first. So: g2 s3, g2 s2, g2 s1, then g1 s3, g1 s2. "g1 s1" and "g1 plain" are the two left out.
    expect(items.map((i) => (i.kind === "expense" ? i.title : "payment"))).toEqual(["g2 s3", "g2 s2", "g2 s1", "g1 s3", "g1 s2"]);
  });
});

// One open group, Me and You half and half; returns Home's "Your month" for a moment and zone.
async function monthFor(rowsToAdd: { description: string; amount: number; at: string; more?: Partial<Prisma.ExpenseUncheckedCreateInput> }[], now: Date, tz: string, extra: Partial<Prisma.GroupUncheckedCreateInput> = {}) {
  const g = await newGroup(["Me", "You"], extra);
  for (const r of rowsToAdd) await mkExpense(g.gid, r.description, r.amount, g.ids[0], halves(g.ids[0], g.ids[1], r.amount), iso(r.at), r.more ?? {});
  const memberships = { [g.gid]: g.ids[0] };
  const today = todayKey(now, tz);
  const light = await loadMyGroupsLight(memberships);
  const rows = await loadHomeRows(light, { tz, now, today });
  const month = monthNumbers(rows.monthGroups, (a) => a, "INR", now, tz);
  const lean = await loadMyGroupsLean(memberships);
  const wholeHistory = monthNumbers(lean.map((e) => ({ currency: e.group.currency, myId: e.myId, expenses: e.expenses })), (a) => a, "INR", now, tz);
  expect(month).toEqual(wholeHistory); // never different from reading every row
  return month;
}

describe("Your month at the turn of a month", () => {
  const OCT = [
    { description: "Oct 5", amount: 1000, at: "2026-10-05T12:00:00Z" }, // my half 500
    { description: "Oct 31 noon", amount: 2000, at: "2026-10-31T12:00:00Z" }, // 1000
    { description: "Oct money back", amount: 400, at: "2026-10-15T12:00:00Z", more: { kind: "refund" } }, // takes 200 off, not counted
    { description: "Oct card game", amount: 600, at: "2026-10-20T12:00:00Z", more: { kind: "pot" } }, // never spending
    { description: "Oct deleted", amount: 800, at: "2026-10-25T12:00:00Z", more: { deletedAt: iso("2026-10-26T12:00:00Z") } },
    { description: "Nov 1 noon", amount: 4000, at: "2026-11-01T12:00:00Z" }, // this month's, my half 2000
  ];
  it("on the 3rd Home still looks back at the month that just ended: October, 2 expenses, my share 500 + 1000 - 200 = 1300", async () => {
    const m = (await monthFor(OCT, iso("2026-11-03T08:00:00Z"), "Asia/Kolkata"))!; // 13:30 on 3 Nov in Kolkata
    expect(m.month).toBe("2026-10");
    expect(m.name).toBe("October");
    expect(m.wrapped).toBe(true);
    expect(m.count).toBe(2);
    expect(m.share).toBe(1300);
  });
  it("on the 4th it is this month: November, 1 expense, my share 2000", async () => {
    const m = (await monthFor(OCT, iso("2026-11-04T08:00:00Z"), "Asia/Kolkata"))!;
    expect(m.month).toBe("2026-11");
    expect(m.wrapped).toBe(false);
    expect(m.count).toBe(1);
    expect(m.share).toBe(2000);
  });
  it("on the 1st (3rd in Kiritimati, where it is already tomorrow) it still looks back", async () => {
    // 2026-11-02T10:00Z is 3 Nov 00:00 in Kiritimati (+14), 2 Nov in Kolkata: both still within the first three days.
    for (const tz of ["Pacific/Kiritimati", "Asia/Kolkata"]) {
      const m = (await monthFor(OCT, iso("2026-11-02T10:00:00Z"), tz))!;
      expect(m.month).toBe("2026-10");
      expect(m.share).toBe(1300);
    }
    // One moment later in Kiritimati it is the 4th, and the card switches to November.
    const later = (await monthFor(OCT, iso("2026-11-03T10:00:00Z"), "Pacific/Kiritimati"))!;
    expect(later.month).toBe("2026-11");
  });
});

describe("Your month when December rolls into January", () => {
  // NOW = 2027-01-02T10:00Z: the 2nd of January in Kolkata and Los Angeles, so Home looks back at December 2026.
  const JAN = iso("2027-01-02T10:00:00Z");
  const DEC = [
    { description: "Nov 30", amount: 9000, at: "2026-11-30T09:00:00Z" }, // November everywhere (Kiritimati is already 30 Nov 23:00)
    { description: "Dec 10", amount: 2000, at: "2026-12-10T12:00:00Z" }, // 1000 in December everywhere
    { description: "Dec 31 18:00Z", amount: 3000, at: "2026-12-31T18:00:00Z" }, // 1500: still 31 Dec in Kolkata (23:30) and Los Angeles (10:00)
    { description: "Jan 1 02:00Z", amount: 5000, at: "2027-01-01T02:00:00Z" }, // 2500: 1 Jan in Kolkata (07:30), but 31 Dec in Los Angeles (18:00)
  ];
  it("Kolkata: month 2026-12 named December, 2 expenses, my share 1000 + 1500 = 2500", async () => {
    const m = (await monthFor(DEC, JAN, "Asia/Kolkata"))!;
    expect(m.month).toBe("2026-12");
    expect(m.name).toBe("December");
    expect(m.wrapped).toBe(true);
    expect(m.count).toBe(2);
    expect(m.share).toBe(2500);
  });
  it("Los Angeles: 3 expenses, my share 1000 + 1500 + 2500 = 5000 (the 1 Jan 02:00Z one is still 31 Dec there)", async () => {
    const m = (await monthFor(DEC, JAN, "America/Los_Angeles"))!;
    expect(m.month).toBe("2026-12");
    expect(m.count).toBe(3);
    expect(m.share).toBe(5000);
  });
  it("the window for December reaches into the new year by 14 hours", () => {
    expect(monthWindow("2026-12")).toEqual({ from: iso("2026-11-30T10:00:00Z"), to: iso("2027-01-01T14:00:00Z") });
  });
});

describe("Your month counts a closed group too", () => {
  it("an open group's 1000 and a closed group's 2000 in November: 2 expenses, my share 500 + 1000 = 1500, and the closed one is not in Latest", async () => {
    const open = await newGroup(["Me", "You"]);
    const closed = await newGroup(["Me", "You"], { closed: true, closedAt: iso("2026-11-11T10:00:00Z") });
    await mkExpense(open.gid, "Open lunch", 1000, open.ids[0], halves(open.ids[0], open.ids[1], 1000), iso("2026-11-05T12:00:00Z"));
    await mkExpense(closed.gid, "Closed dinner", 2000, closed.ids[0], halves(closed.ids[0], closed.ids[1], 2000), iso("2026-11-06T12:00:00Z"));
    const memberships = { [open.gid]: open.ids[0], [closed.gid]: closed.ids[0] };
    const tz = "Asia/Kolkata";
    const today = todayKey(NOW, tz); // 13 Nov: the normal month, not a look back
    const light = await loadMyGroupsLight(memberships);
    expect(light.find((g) => g.group.id === closed.gid)!.group.closed).toBe(true);
    const rows = await loadHomeRows(light, { tz, now: NOW, today });
    const m = monthNumbers(rows.monthGroups, (a) => a, "INR", NOW, tz)!;
    expect(m.month).toBe("2026-11");
    expect(m.count).toBe(2);
    expect(m.share).toBe(1500);
    // Same as the whole-history method, which has always counted closed groups here.
    const lean = await loadMyGroupsLean(memberships);
    expect(m).toEqual(monthNumbers(lean.map((e) => ({ currency: e.group.currency, myId: e.myId, expenses: e.expenses })), (a) => a, "INR", NOW, tz));
    // Latest is for open groups only.
    expect(rows.recent.has(closed.gid)).toBe(false);
    expect(latestIds(light, rows).map((i) => (i.kind === "expense" ? i.title : "payment"))).toEqual(["Open lunch"]);
  });
});

describe("loadMyGroupsLight with groups the viewer is in and groups the viewer left, in one call", () => {
  it("each entry matches the whole-history loader, and the hand-worked numbers hold", async () => {
    // X and Z: still in. Y and W: left on 1 Nov, so what the group does afterwards (without them) stays hidden.
    const X = await newGroup(["Me", "You"]);
    await mkExpense(X.gid, "X1", 1000, X.ids[0], halves(X.ids[0], X.ids[1], 1000), iso("2026-11-02T10:00:00Z"));
    await mkExpense(X.gid, "X2", 400, X.ids[1], halves(X.ids[0], X.ids[1], 400), iso("2026-11-03T10:00:00Z"));

    const Y = await newGroup(["Me", "You", "Third"]);
    const [ym, yy, yt] = Y.ids;
    await mkExpense(Y.gid, "Early", 400, yy, [[yy, 200], [ym, 200]], iso("2026-10-20T10:00:00Z"));
    await mkExpense(Y.gid, "Includes me", 600, yy, [[yy, 300], [ym, 300]], iso("2026-11-10T10:00:00Z"));
    await mkExpense(Y.gid, "Later without me", 800, yy, [[yy, 400], [yt, 400]], iso("2026-12-02T10:00:00Z"));
    await db.member.update({ where: { id: ym }, data: { leftAt: iso("2026-11-01T00:00:00Z") } });

    const Z = await newGroup(["Me", "You"]);
    await mkExpense(Z.gid, "Z1", 600, Z.ids[0], halves(Z.ids[0], Z.ids[1], 600), iso("2026-11-04T10:00:00Z"));
    await mkPayment(Z.gid, Z.ids[1], Z.ids[0], 200, iso("2026-11-05T10:00:00Z"));

    const W = await newGroup(["Me", "You"]);
    const [wm, wy] = W.ids;
    await mkExpense(W.gid, "W early", 1000, wy, halves(wy, wm, 1000), iso("2026-10-28T10:00:00Z"));
    await mkExpense(W.gid, "W after", 2000, wy, [[wy, 2000]], iso("2026-11-05T10:00:00Z"));
    await db.member.update({ where: { id: wm }, data: { leftAt: iso("2026-11-01T00:00:00Z") } });

    const memberships = { [X.gid]: X.ids[0], [Y.gid]: ym, [Z.gid]: Z.ids[0], [W.gid]: wm };
    const light = await loadMyGroupsLight(memberships);
    const lean = await loadMyGroupsLean(memberships);
    expect(light).toHaveLength(4);
    for (const l of light) {
      const o = lean.find((e) => e.group.id === l.group.id)!;
      expect(Object.entries(l.net)).toEqual(Object.entries(o.net));
      expect(l.transfers).toEqual(o.transfers);
      expect(l.myBalance).toBe(o.myBalance);
      expect(l.spent).toBe(o.spent);
      expect(l.people).toBe(o.people);
      expect(l.leaver).toEqual(o.leaver);
      expect(l.lastActivity).toEqual(o.lastActivity);
      expect(l.expenseCount).toBe(o.expenses.length);
      expect(l.paymentCount).toBe(o.payments.length);
    }

    // By hand (paise), for the viewer "Me" in each:
    //   X: Me paid 1000 (own half 500) and You paid 400 (Me owes 200): +1000 - 500 - 200 = +300.   Spent 1400, 2 expenses.
    //   Y: Me owes You 200 + 300 = 500 (the later 800 is You and Third): -500.   Left, so sees 2 expenses, spent 400 + 600 = 1000.
    //   Z: Me paid 600 (own half 300) = +300, then You paid back 200: +100.   Spent 600, 1 expense, 1 payment.
    //   W: Me owes You 500: -500 (the later 2000 is You alone).   Left, sees 1 expense, spent 1000.
    const by = Object.fromEntries(light.map((l) => [l.group.id, l]));
    expect([by[X.gid], by[Y.gid], by[Z.gid], by[W.gid]].map((l) => l.myBalance)).toEqual([300, -500, 100, -500]);
    expect([by[X.gid], by[Y.gid], by[Z.gid], by[W.gid]].map((l) => l.spent)).toEqual([1400, 1000, 600, 1000]);
    expect([by[X.gid], by[Y.gid], by[Z.gid], by[W.gid]].map((l) => l.expenseCount)).toEqual([2, 2, 1, 1]);
    expect([by[X.gid], by[Y.gid], by[Z.gid], by[W.gid]].map((l) => l.paymentCount)).toEqual([0, 0, 1, 0]);
    expect([by[X.gid], by[Y.gid], by[Z.gid], by[W.gid]].map((l) => l.leaver !== null)).toEqual([false, true, false, true]);
    expect([by[X.gid], by[Y.gid], by[Z.gid], by[W.gid]].map((l) => l.readable !== null)).toEqual([false, true, false, true]);
  });
});

// Watches db.$transaction without vi.spyOn (restoring a spy on the Prisma client has left $transaction missing
// for later tests before): records each call's first argument and puts the exact original function back.
function watchTx() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = db as any;
  const original = client.$transaction;
  const calls: unknown[] = [];
  Object.defineProperty(client, "$transaction", {
    configurable: true,
    writable: true,
    value: (arg: unknown, ...rest: unknown[]) => {
      calls.push(arg);
      return original.call(db, arg, ...rest);
    },
  });
  return { calls, restore: () => Object.defineProperty(client, "$transaction", { configurable: true, writable: true, value: original }) };
}

describe("the balance reads run as one snapshot (one transaction)", () => {
  it("netBalancesDb: all the reads for two groups go in a single db.$transaction array, and the numbers are the hand-worked ones", async () => {
    const t = await handTrip();
    const u = await handTrip();
    const w = watchTx();
    try {
      const out = await netBalancesDb([t.gid, u.gid]);
      expect(w.calls).toHaveLength(1);
      const queries = w.calls[0] as unknown as unknown[];
      expect(Array.isArray(queries)).toBe(true);
      expect(queries).toHaveLength(3); // sums, several-payer expenses, members: one chunk for both groups
      for (const g of [t, u]) expect(named(g.nameOf, out.get(g.gid)!.net)).toEqual({ A: 38966, B: 4017, C: -25833, D: -17150 });
    } finally {
      w.restore();
    }
  });

  it("netBalancesDb with the members given needs 2 reads in the one transaction; with no groups it opens none", async () => {
    const t = await handTrip();
    const w = watchTx();
    try {
      await netBalancesDb([t.gid], { members: { [t.gid]: t.ids } });
      expect(w.calls).toHaveLength(1);
      expect(w.calls[0] as unknown as unknown[]).toHaveLength(2);
      w.calls.length = 0;
      expect((await netBalancesDb([])).size).toBe(0);
      expect(w.calls).toHaveLength(0);
    } finally {
      w.restore();
    }
  });

  it("settleFactsDb: its 4 reads are one transaction", async () => {
    const t = await handTrip();
    const w = watchTx();
    try {
      const facts = await settleFactsDb(t.gid);
      expect(w.calls).toHaveLength(1);
      expect(w.calls[0] as unknown as unknown[]).toHaveLength(4);
      expect(facts).toEqual({ expenseCount: 5, paymentCount: 2, paidSoFar: 25000, before: 5 });
    } finally {
      w.restore();
    }
  });

  it("loadGroupSettle: the balances and the facts (2 + 4 reads) are in the same single transaction", async () => {
    const t = await handTrip();
    const w = watchTx();
    try {
      const page = (await loadGroupSettle(t.gid, t.A))!;
      expect(w.calls).toHaveLength(1);
      expect(w.calls[0] as unknown as unknown[]).toHaveLength(6);
      expect(planNamed(t.nameOf, page.transfers)).toEqual([
        { from: "C", to: "A", amount: 25833 },
        { from: "D", to: "A", amount: 13133 },
        { from: "D", to: "B", amount: 4017 },
      ]);
      expect({ e: page.expenseCount, p: page.paymentCount, paid: page.paidSoFar, before: page.before }).toEqual({ e: 5, p: 2, paid: 25000, before: 5 });
    } finally {
      w.restore();
    }
  });

  it("db.$transaction is still the real thing afterwards", async () => {
    const t = await handTrip();
    expect(typeof db.$transaction).toBe("function");
    expect((await netBalancesDb([t.gid])).get(t.gid)!.fallback).toBe(false);
  });
});
