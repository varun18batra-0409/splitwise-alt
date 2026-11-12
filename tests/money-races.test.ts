import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { netBalances } from "@/lib/balances";
import { saveExpense, setExpenseDeleted, setPaymentDeleted, type SaveExpenseInput } from "@/lib/save-expense";
import { changeGroupCurrency } from "@/lib/group-changes";
import { setMember } from "@/lib/people";
import { parseUndo } from "@/lib/events";
import { restoreCurrency, undoEvent } from "@/lib/undo";
import { moveOut } from "@/lib/home/moving-db";
import { GroupChanged, guardGroup, ledgerInTx } from "@/lib/money-guard";
import { overpayLimit, overpayQuestion, recordPaymentCore } from "@/lib/pay-record";
import { settleAcrossCore } from "@/lib/cross-settle-db";
import { applySettleAll, markAllPaid, planKey, settleAllAndClose } from "@/lib/settle-all";
import { loadGroup } from "@/lib/group-data";
import { createPayment } from "@/lib/payments";
import { addPlayerToGame, adjustGap, buyIn, cashOut, countOut, deleteGame, finishGame, GAME_FINISHED, loadGame, markGamePaid, recordMove, removeMove, reopenGame, startGame } from "@/lib/pot-db";
import { parsePlayers, potSummary } from "@/lib/pot";
import type { RateAnswer } from "@/lib/rate-cache";

// Races between two servers: something changes in the gap between "read the group" and "write the money". Each test
// makes its own group, runs the second server's change from inside the first one's `afterRead` hook (the gap), and
// checks that nothing was saved wrong. Amounts are in minor units (paise, cents). Every test ends with the two
// invariants: each expense's shares add up to its amount, and the group's balances add up to zero.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let counter = 0;
const groups: string[] = [];
afterAll(async () => {
  await eraseGroups(groups);
});

const rate80 = async (): Promise<RateAnswer> => ({ ok: true, rate: "80", date: "2026-11-12" });
const rate1 = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-11-12" });
const draft = (groupId: string, paidById: string, over: Partial<SaveExpenseInput> = {}): SaveExpenseInput => ({
  groupId, name: "Dinner", category: "", amount: "900", currency: "INR", paidById, forMode: "everyone",
  selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
  markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
});
const key = (tag: string) => `race-${tag}-${stamp}-${++counter}`;

async function make(names: string[], o: { type?: string; currency?: string } = {}) {
  const n = ++counter;
  const g = await db.group.create({
    data: { name: `Race ${n} ${stamp}`, type: o.type ?? "other", currency: o.currency ?? "INR", inviteCode: `race-${n}-${stamp}`, members: { create: names.map((name) => ({ name })) } },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  groups.push(g.id);
  const ids = Object.fromEntries(g.members.map((m) => [m.name, m.id])) as Record<string, string>;
  return { id: g.id, ids };
}

async function net(groupId: string) {
  const members = await db.member.findMany({ where: { groupId }, select: { id: true } });
  const [expenses, payments] = await Promise.all([
    db.expense.findMany({ where: { groupId, deletedAt: null }, include: { shares: true } }),
    db.payment.findMany({ where: { groupId, deletedAt: null } }),
  ]);
  return netBalances(members.map((m) => m.id), expenses, payments);
}

// The two rules that must hold after every test.
async function invariants(groupId: string) {
  for (const e of await db.expense.findMany({ where: { groupId }, include: { shares: true } })) {
    expect(e.shares.reduce((s, x) => s + x.amount, 0), `shares of ${e.description}`).toBe(e.amount);
  }
  expect(Object.values(await net(groupId)).reduce((s, v) => s + v, 0)).toBe(0);
}

// An expense written straight to the database (a known starting point).
function addExpense(groupId: string, paidById: string, amount: number, shares: [string, number][], description = "Spend") {
  return db.expense.create({
    data: { groupId, description, amount, splitType: "exact", paidById, createdById: paidById, originalAmount: amount, convertedAmount: amount, shares: { create: shares.map(([memberId, a]) => ({ memberId, amount: a })) } },
  });
}
const payNow = (groupId: string, fromId: string, toId: string, amount: number) =>
  db.$transaction((tx) => createPayment(tx, { groupId, fromId, toId, amount, createdById: fromId }));

describe("money-guard: the group is re-checked inside the write", () => {
  it("guardGroup says what changed: deleted, closed, currency, actor left, someone left", async () => {
    const g = await make(["Asha", "Bina"]);
    const guard = (o: Parameters<typeof guardGroup>[2], id = g.id) => db.$transaction((tx) => guardGroup(tx, id, o));
    await expect(guard({ currency: "INR", actorId: g.ids.Asha, involvedIds: [g.ids.Bina] })).resolves.toBeUndefined();
    await expect(guard({ currency: "USD" })).rejects.toMatchObject({ reason: "currency", detail: "INR" });
    await db.member.update({ where: { id: g.ids.Bina }, data: { leftAt: new Date() } });
    await expect(guard({ currency: "INR", involvedIds: [g.ids.Bina] })).rejects.toMatchObject({ reason: "left", detail: "Bina" });
    await db.member.update({ where: { id: g.ids.Asha }, data: { leftAt: new Date() } });
    await expect(guard({ currency: "INR", actorId: g.ids.Asha })).rejects.toMatchObject({ reason: "actor_left" });
    await db.group.update({ where: { id: g.id }, data: { closed: true } });
    await expect(guard({ currency: "INR" })).rejects.toMatchObject({ reason: "closed" });
    await expect(guard({ currency: "INR", allowClosed: true })).resolves.toBeUndefined(); // card-game moves are fine in a closed group
    await db.group.update({ where: { id: g.id }, data: { deletedAt: new Date() } });
    await expect(guard({ currency: "INR", allowClosed: true })).rejects.toBeInstanceOf(GroupChanged);
    await expect(guard({ currency: "INR", allowClosed: true })).rejects.toMatchObject({ reason: "gone" });
  });

  it("ledgerInTx gives the same balances and plan as the screen (hand-worked: ₹900 paid by Asha for both → Bina owes ₹450)", async () => {
    const g = await make(["Asha", "Bina"]);
    await addExpense(g.id, g.ids.Asha, 90000, [[g.ids.Asha, 45000], [g.ids.Bina, 45000]]);
    const l = await db.$transaction((tx) => ledgerInTx(tx, g.id));
    expect(l.net).toEqual({ [g.ids.Asha]: 45000, [g.ids.Bina]: -45000 });
    expect(l.transfers).toEqual([{ from: g.ids.Bina, to: g.ids.Asha, amount: 45000 }]);
    const screen = (await loadGroup(g.id))!;
    expect(screen.net).toEqual(l.net);
    expect(screen.transfers).toEqual(l.transfers);
  });

  it("the pay-link take-back and the move-out undo also call guardGroup", () => {
    const root = path.resolve(__dirname, "..");
    expect(readFileSync(path.join(root, "src/app/pay-link-actions.ts"), "utf8")).toMatch(/guardGroup\(/);
    const moving = readFileSync(path.join(root, "src/lib/home/moving-db.ts"), "utf8");
    expect(moving.slice(moving.indexOf("export async function undoMoveOut"))).toMatch(/guardGroup\(/);
  });

  it("every file that writes money calls guardGroup (so a new writer can't forget it)", () => {
    const root = path.resolve(__dirname, "..");
    for (const f of ["save-expense", "pay-record", "cross-settle-db", "settle-all", "pay-link", "payment-claims", "home/moving-db", "pot-db", "undo", "people", "payment-ok", "home/goals-db"]) {
      expect(readFileSync(path.join(root, "src/lib", `${f}.ts`), "utf8"), f).toMatch(/guardGroup\(/);
    }
  });
});

describe("FIN-01: an expense is never saved in the old currency", () => {
  it("a) the currency changes while the exchange rate is being looked up: refused, nothing saved, no key used", async () => {
    const g = await make(["A", "B"]);
    const k = key("a");
    const lookup = async (): Promise<RateAnswer> => {
      // The other server changes the (still empty) group to USD during the rate lookup.
      expect((await changeGroupCurrency(g.id, g.ids.A, "USD", "1", { expectEmpty: true })).ok).toBe(true);
      return { ok: true, rate: "80", date: "2026-11-12" };
    };
    const r = await saveExpense(draft(g.id, g.ids.A, { amount: "10", currency: "USD" }), g.ids.A, lookup, { requestKey: k });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe("The group's currency changed to USD while you were saving, so nothing was saved. Check the amount and save again.");
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(0);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).currency).toBe("USD");
    expect(await db.requestKey.count({ where: { key: k } })).toBe(0);
    await invariants(g.id);
  });

  it("a) control: no change in the gap, USD 10 at 80 saves ₹800 (80000 paise) split 40000 / 40000", async () => {
    const g = await make(["A", "B"]);
    const r = await saveExpense(draft(g.id, g.ids.A, { amount: "10", currency: "USD" }), g.ids.A, rate80, { requestKey: key("a2") });
    expect(r.ok).toBe(true);
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.id }, include: { shares: true } });
    expect([e.amount, e.baseCurrency, e.originalAmount, e.originalCurrency]).toEqual([80000, "INR", 1000, "USD"]);
    expect(e.shares.map((s) => s.amount).sort()).toEqual([40000, 40000]);
    await invariants(g.id);
  });

  it("b) an edit while the group changes currency is refused; the expense keeps its converted USD amount", async () => {
    const g = await make(["A", "B"]);
    const first = await saveExpense(draft(g.id, g.ids.A), g.ids.A, rate1);
    if (!first.ok) throw new Error(first.error);
    expect((await db.expenseShare.findMany({ where: { expenseId: first.id } })).map((s) => s.amount)).toEqual([45000, 45000]);
    const r = await saveExpense({ ...draft(g.id, g.ids.A, { amount: "1200" }), expenseId: first.id }, g.ids.A, rate1, {
      afterRead: async () => {
        expect((await changeGroupCurrency(g.id, g.ids.A, "USD", "0.012")).ok).toBe(true);
      },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/currency changed to USD/);
    const e = await db.expense.findUniqueOrThrow({ where: { id: first.id }, include: { shares: true } });
    expect(e.amount).toBe(1080); // 90000 × 0.012
    expect(e.shares.map((s) => s.amount)).toEqual([540, 540]);
    await invariants(g.id);
  });

  it("c) the group is closed during a save: refused, nothing saved", async () => {
    const g = await make(["A", "B"]);
    const r = await saveExpense(draft(g.id, g.ids.A), g.ids.A, rate1, { afterRead: async () => void (await db.group.update({ where: { id: g.id }, data: { closed: true } })) });
    expect(r).toEqual({ ok: false, error: "This group was closed while you were saving, so nothing was saved." });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(0);
    await invariants(g.id);
  });

  it("d) the group is deleted during a save: refused, nothing saved", async () => {
    const g = await make(["A", "B"]);
    const r = await saveExpense(draft(g.id, g.ids.A), g.ids.A, rate1, { afterRead: async () => void (await db.group.update({ where: { id: g.id }, data: { deletedAt: new Date() } })) });
    expect(r).toEqual({ ok: false, error: "This group was deleted while you were saving." });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(0);
  });

  it("e) the person saving leaves during the save: refused, nothing saved", async () => {
    const g = await make(["A", "B"]);
    const r = await saveExpense(draft(g.id, g.ids.A), g.ids.A, rate1, { afterRead: async () => void (await db.member.update({ where: { id: g.ids.A }, data: { leftAt: new Date() } })) });
    expect(r).toEqual({ ok: false, error: "You're no longer in this group, so nothing was saved." });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(0);
  });

  it("f) a sharer (B) leaves while a new ₹900 'everyone' expense saves: refused, B's balance stays 0", async () => {
    const g = await make(["A", "B"]);
    const r = await saveExpense(draft(g.id, g.ids.A), g.ids.A, rate1, {
      afterRead: async () => {
        expect((await setMember(g.id, g.ids.A, g.ids.B, { leftAt: new Date().toISOString() })).ok).toBe(true); // B owes nothing yet, so leaving is allowed
      },
    });
    expect(r).toEqual({ ok: false, error: "B just left the group. Check who it's for and save again." });
    expect(await db.expense.count({ where: { groupId: g.id } })).toBe(0);
    expect((await net(g.id))[g.ids.B]).toBe(0);
    await invariants(g.id);
  });

  it("g) the other order: the expense commits first, then B's leave is refused ('B still owes ₹450')", async () => {
    const g = await make(["A", "B"]);
    const r = await setMember(g.id, g.ids.A, g.ids.B, { leftAt: new Date().toISOString() }, false, {
      afterRead: async () => {
        expect((await saveExpense(draft(g.id, g.ids.A), g.ids.A, rate1)).ok).toBe(true); // ₹900 for both: B owes 45000
      },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/^B still owes ₹450\. Settle up first, then leave\.$/);
    expect((await db.member.findUniqueOrThrow({ where: { id: g.ids.B } })).leftAt).toBeNull();
    expect((await net(g.id))[g.ids.B]).toBe(-45000);
    await invariants(g.id);
  });

  it("h) a payment recorded while the currency changes is refused", async () => {
    const g = await make(["A", "B"]);
    await addExpense(g.id, g.ids.A, 90000, [[g.ids.A, 45000], [g.ids.B, 45000]]);
    const out = await recordPaymentCore(
      { groupId: g.id, fromId: g.ids.B, toId: g.ids.A, amount: 45000, currency: "INR", myId: g.ids.B, fp: "fp-h", warnOver: true },
      { afterRead: async () => void (await changeGroupCurrency(g.id, g.ids.A, "USD", "0.012")) },
    );
    expect(out).toEqual({ kind: "refused", error: "The group's currency changed to USD while you were saving, so nothing was saved. Check the amount and save again." });
    expect(await db.payment.count({ where: { groupId: g.id } })).toBe(0);
    await invariants(g.id);
  });

  it("a game started in the gap stops a currency change (the open-game check is inside the write)", async () => {
    const g = await make(["Asha", "Bina"], { type: "pot" });
    const r = await changeGroupCurrency(g.id, g.ids.Asha, "USD", "1", {
      afterRead: async () => {
        const s = await startGame(g.id, g.ids.Asha, { name: "Late game", game: "cards", players: [g.ids.Asha, g.ids.Bina] });
        expect(s.ok).toBe(true);
      },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/Finish \(or delete\) the game that’s still open first/);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).currency).toBe("INR");
  });
});

describe("FIN-02: settle across groups records only the plan the person saw", () => {
  it("a stale plan: Asha owed Bina ₹500; a ₹100 payment lands in the gap; nothing is recorded, balances are Asha −40000 / Bina +40000", async () => {
    // Bina paid ₹1,000 split equally: Asha −50000, Bina +50000. Plan: Asha → Bina 50000.
    const g = await make(["Asha", "Bina"]);
    await addExpense(g.id, g.ids.Bina, 100000, [[g.ids.Asha, 50000], [g.ids.Bina, 50000]], "Dinner");
    const out = await settleAcrossCore([{ groupId: g.id, fromId: g.ids.Asha, toId: g.ids.Bina, amount: 50000 }], { [g.id]: g.ids.Asha }, key("s1"), {
      afterRead: async () => void (await payNow(g.id, g.ids.Asha, g.ids.Bina, 10000)),
    });
    expect(out).toBe("changed");
    const pays = await db.payment.findMany({ where: { groupId: g.id } });
    expect(pays.reduce((s, p) => s + p.amount, 0)).toBe(10000);
    expect(await net(g.id)).toEqual({ [g.ids.Asha]: -40000, [g.ids.Bina]: 40000 });
    await invariants(g.id);
  });

  async function twoGroups() {
    // Trip: Asha paid ₹2,000 for both, so Varun owes Asha 100000. Flat: Varun paid ₹800 for both, so Asha owes Varun 40000.
    const trip = await make(["Varun", "Asha"]);
    const flat = await make(["Varun", "Asha"]);
    await addExpense(trip.id, trip.ids.Asha, 200000, [[trip.ids.Varun, 100000], [trip.ids.Asha, 100000]], "Hotel");
    await addExpense(flat.id, flat.ids.Varun, 80000, [[flat.ids.Varun, 40000], [flat.ids.Asha, 40000]], "Groceries");
    const parts = [
      { groupId: trip.id, fromId: trip.ids.Varun, toId: trip.ids.Asha, amount: 100000 },
      { groupId: flat.id, fromId: flat.ids.Asha, toId: flat.ids.Varun, amount: 40000 },
    ];
    const memberships = { [trip.id]: trip.ids.Varun, [flat.id]: flat.ids.Varun };
    return { trip, flat, parts, memberships };
  }

  it("two groups: only Flat changes in the gap, so neither group gets a payment from this settle", async () => {
    const w = await twoGroups();
    const out = await settleAcrossCore(w.parts, w.memberships, key("s2"), {
      afterRead: async () => void (await payNow(w.flat.id, w.flat.ids.Asha, w.flat.ids.Varun, 10000)),
    });
    expect(out).toBe("changed");
    expect(await db.payment.count({ where: { groupId: w.trip.id } })).toBe(0);
    expect(await db.payment.count({ where: { groupId: w.flat.id } })).toBe(1); // only the one made in the gap
    await invariants(w.trip.id);
    await invariants(w.flat.id);
  });

  it("unchanged: both groups end at 0, and a retry with the same key is 'done' with still exactly 2 payments", async () => {
    const w = await twoGroups();
    const k = key("s3");
    expect(await settleAcrossCore(w.parts, w.memberships, k)).toBe("done");
    expect(Object.values(await net(w.trip.id))).toEqual([0, 0]);
    expect(Object.values(await net(w.flat.id))).toEqual([0, 0]);
    expect(await settleAcrossCore(w.parts, w.memberships, k)).toBe("done");
    expect((await db.payment.count({ where: { groupId: w.trip.id } })) + (await db.payment.count({ where: { groupId: w.flat.id } }))).toBe(2);
  });

  it("an expense edit, a refund, and the group closing in the gap each give 'changed' and record nothing", async () => {
    const gap: Record<string, (g: Awaited<ReturnType<typeof make>>, expenseId: string) => Promise<unknown>> = {
      edit: (g, expenseId) => saveExpense({ ...draft(g.id, g.ids.Bina, { amount: "2000" }), expenseId }, g.ids.Bina, rate1),
      refund: (g) => saveExpense(draft(g.id, g.ids.Asha, { amount: "200", kind: "refund", name: "Money back" }), g.ids.Asha, rate1),
      close: (g) => db.group.update({ where: { id: g.id }, data: { closed: true } }),
    };
    // Hand-worked balances (Asha, Bina) after each change in the gap. Start: Bina paid ₹1,000 for both, so Asha −50000, Bina +50000.
    //   edit to ₹2,000: shares 100000 each → Asha −100000, Bina +100000.
    //   ₹200 money back received by Asha, shared by both (10000 each): Asha owes 20000 back and is credited her own 10000 → Asha −10000;
    //   Bina is credited 10000 → Bina +10000. So Asha −60000, Bina +60000.
    //   closing the group moves no money: Asha −50000, Bina +50000.
    const expected: Record<string, [number, number]> = { edit: [-100000, 100000], refund: [-60000, 60000], close: [-50000, 50000] };
    for (const [name, doGap] of Object.entries(gap)) {
      const g = await make(["Asha", "Bina"]);
      const e = await saveExpense(draft(g.id, g.ids.Bina, { amount: "1000" }), g.ids.Bina, rate1); // Asha owes Bina 50000
      if (!e.ok) throw new Error(e.error);
      const before = await db.payment.count({ where: { groupId: g.id } });
      const out = await settleAcrossCore([{ groupId: g.id, fromId: g.ids.Asha, toId: g.ids.Bina, amount: 50000 }], { [g.id]: g.ids.Asha }, key(`s4${name}`), { afterRead: async () => void (await doGap(g, e.id)) });
      expect(out, name).toBe("changed");
      expect(await db.payment.count({ where: { groupId: g.id } }), name).toBe(before);
      expect(await net(g.id), name).toEqual({ [g.ids.Asha]: expected[name][0], [g.ids.Bina]: expected[name][1] });
      await invariants(g.id);
    }
  });

  it("'Settle everything' with the balances changing in the gap records nothing and does not close the group", async () => {
    const g = await make(["Asha", "Bina"]);
    await addExpense(g.id, g.ids.Bina, 100000, [[g.ids.Asha, 50000], [g.ids.Bina, 50000]]);
    const plan = planKey((await loadGroup(g.id))!.transfers);
    const r = await settleAllAndClose(g.id, g.ids.Asha, plan, { afterRead: async () => void (await payNow(g.id, g.ids.Asha, g.ids.Bina, 10000)) });
    expect(r).toEqual({ ok: false, error: "Balances changed since you opened this. Check the updated list and try again." });
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).closed).toBe(false);
    expect(await db.payment.count({ where: { groupId: g.id } })).toBe(1);
    await invariants(g.id);
  });

  it("'Mark all paid' from Settle up with the balances changing in the gap records nothing more", async () => {
    const g = await make(["Asha", "Bina"]);
    await addExpense(g.id, g.ids.Bina, 100000, [[g.ids.Asha, 50000], [g.ids.Bina, 50000]]);
    const r = await markAllPaid(g.id, g.ids.Asha, [{ from: g.ids.Asha, to: g.ids.Bina, amount: 50000 }], "", true, undefined, {
      afterRead: async () => void (await payNow(g.id, g.ids.Asha, g.ids.Bina, 10000)),
    });
    expect(r.ok).toBe(false);
    expect(await db.payment.count({ where: { groupId: g.id } })).toBe(1);
    await invariants(g.id);
  });
});

describe("FIN-04: the 'more than what's owed' warning looks at both people", () => {
  it("overpayLimit: the smaller of what the payer owes and what the person paid is owed, and which side sets it", () => {
    expect(overpayLimit({ a: -100000, b: 50000, c: 50000 }, "a", "b")).toEqual({ limit: 50000, side: "to" });
    expect(overpayLimit({ a: -30000, b: 50000, c: -20000 }, "a", "b")).toEqual({ limit: 30000, side: "from" });
    expect(overpayLimit({ a: -50000, b: 0, c: 50000 }, "a", "b")).toEqual({ limit: 0, side: "to" });
    expect(overpayLimit({ a: -50000, b: 50000 }, "a", "b")).toEqual({ limit: 50000, side: "from" }); // a tie counts as the payer
  });

  it("the words: recipient side, recipient already square, payer side (₹600 against a limit of ₹500)", () => {
    const o = { typed: 60000, limit: 50000, currency: "INR", fromName: "Asha", toName: "Bina" };
    expect(overpayQuestion({ ...o, side: "to" })).toBe("Bina is owed ₹500. Recording ₹600 means Bina will owe Asha ₹100 back. Record it anyway?");
    expect(overpayQuestion({ ...o, limit: 0, side: "to" })).toBe("Bina isn't owed anything right now, so Bina would owe Asha ₹600 back. Record it anyway?");
    expect(overpayQuestion({ ...o, side: "from" })).toBe("This is ₹100 more than what's owed. Record it anyway?");
    expect(overpayQuestion({ ...o, typed: 50000, side: "to" })).toBeNull();
  });

  // Asha −100000, Bina +50000, Chirag +50000.
  async function world() {
    const g = await make(["Asha", "Bina", "Chirag"]);
    await addExpense(g.id, g.ids.Bina, 50000, [[g.ids.Asha, 50000]], "A");
    await addExpense(g.id, g.ids.Chirag, 50000, [[g.ids.Asha, 50000]], "B");
    expect(await net(g.id)).toEqual({ [g.ids.Asha]: -100000, [g.ids.Bina]: 50000, [g.ids.Chirag]: 50000 });
    return g;
  }
  const pay = (g: { id: string; ids: Record<string, string> }, to: string, amount: number, warnOver: boolean, afterRead?: () => Promise<void>) =>
    recordPaymentCore({ groupId: g.id, fromId: g.ids.Asha, toId: g.ids[to], amount, currency: "INR", myId: g.ids.Asha, fp: `fp-${++counter}`, warnOver }, { afterRead });

  it("paying Bina ₹600 warns with limit 50000 (her side); 'Record anyway' gives Asha −40000, Bina −10000, Chirag +50000", async () => {
    const g = await world();
    expect(await pay(g, "Bina", 60000, true)).toEqual({ kind: "over", limit: 50000, side: "to" });
    expect(await db.payment.count({ where: { groupId: g.id } })).toBe(0);
    expect((await pay(g, "Bina", 60000, false)).kind).toBe("done");
    expect(await net(g.id)).toEqual({ [g.ids.Asha]: -40000, [g.ids.Bina]: -10000, [g.ids.Chirag]: 50000 });
    await invariants(g.id);
  });

  it("paying Bina exactly ₹500 gives no warning: Asha −50000, Bina 0, Chirag +50000", async () => {
    const g = await world();
    expect((await pay(g, "Bina", 50000, true)).kind).toBe("done");
    expect(await net(g.id)).toEqual({ [g.ids.Asha]: -50000, [g.ids.Bina]: 0, [g.ids.Chirag]: 50000 });
    await invariants(g.id);
  });

  it("Bina already square (0): paying her ₹100 warns with limit 0", async () => {
    const g = await make(["Asha", "Bina", "Chirag"]);
    await addExpense(g.id, g.ids.Chirag, 50000, [[g.ids.Asha, 50000]]);
    expect(await pay(g, "Bina", 10000, true)).toEqual({ kind: "over", limit: 0, side: "to" });
  });

  it("payer side: Asha −30000, Bina +50000; paying 40000 warns with limit 30000, side 'from'", async () => {
    const g = await make(["Asha", "Bina", "Chirag"]);
    await addExpense(g.id, g.ids.Bina, 50000, [[g.ids.Asha, 30000], [g.ids.Chirag, 20000]]);
    expect(await pay(g, "Bina", 40000, true)).toEqual({ kind: "over", limit: 30000, side: "from" });
  });

  it("stale: a ₹200 payment commits in the gap, so paying 50000 now warns again with the new limit 30000", async () => {
    const g = await world();
    const out = await pay(g, "Bina", 50000, true, async () => void (await payNow(g.id, g.ids.Asha, g.ids.Bina, 20000)));
    expect(out).toEqual({ kind: "over", limit: 30000, side: "to" });
    expect(await db.payment.count({ where: { groupId: g.id } })).toBe(1); // only the one made in the gap
    expect(await net(g.id)).toEqual({ [g.ids.Asha]: -80000, [g.ids.Bina]: 30000, [g.ids.Chirag]: 50000 });
    await invariants(g.id);
  });
});

describe("FIN-03: a game's moves can't land after the game is finished", () => {
  // Asha and Bina buy in 50000 each. `balanced`: Asha takes home 70000, Bina 30000. `binaPlaying`: only Asha has taken home 70000.
  async function game(state: "balanced" | "binaPlaying") {
    const g = await make(["Asha", "Bina", "Xavier", "Yara"], { type: "pot" });
    const { Asha: a, Bina: b } = g.ids;
    const s = await startGame(g.id, a, { name: "Friday", game: "cards", players: [a, b] });
    if (!s.ok) throw new Error(s.error);
    expect((await buyIn(s.id, a, { memberIds: [a, b], amount: "500" })).ok).toBe(true);
    expect((await recordMove(s.id, a, { memberId: a, kind: "return", amount: "700" })).ok).toBe(true);
    if (state === "balanced") expect((await recordMove(s.id, b, { memberId: b, kind: "return", amount: "300" })).ok).toBe(true);
    return { ...g, a, b, gameId: s.id, groupId: g.id };
  }
  const live = async (gameId: string) => db.potMove.findMany({ where: { gameId, deletedAt: null } });
  const gap = async (groupId: string, gameId: string) => potSummary(parsePlayers((await db.potGame.findUniqueOrThrow({ where: { id: gameId } })).players), await live(gameId)).totals.gap;
  const binaFinishes = (w: { gameId: string; a: string; b: string }) => async () => {
    expect((await recordMove(w.gameId, w.b, { memberId: w.b, kind: "return", amount: "300" })).ok).toBe(true);
    expect((await finishGame(w.gameId, w.a)).ok).toBe(true);
  };

  it("finish wins: the buy-in is refused; 4 moves; result ₹200 (payer Asha, share Bina); Asha +20000, Bina −20000; gap 0", async () => {
    const w = await game("balanced");
    const r = await buyIn(w.gameId, w.a, { memberIds: [w.a], amount: "100" }, { afterRead: async () => void (await finishGame(w.gameId, w.a)) });
    expect(r).toEqual({ ok: false, error: GAME_FINISHED });
    expect(await live(w.gameId)).toHaveLength(4);
    const result = await db.expense.findFirstOrThrow({ where: { groupId: w.groupId, kind: "pot" }, include: { shares: true } });
    expect(result.amount).toBe(20000);
    // One winner is stored as the payer (paidById) with no payers list; the list is only for two or more payers.
    expect([result.paidById, result.payers]).toEqual([w.a, ""]);
    expect(result.shares.map((s) => [s.memberId, s.amount])).toEqual([[w.b, 20000]]);
    expect(await net(w.groupId)).toMatchObject({ [w.a]: 20000, [w.b]: -20000 });
    expect(await gap(w.groupId, w.gameId)).toBe(0);
    await invariants(w.groupId);
  });

  it("buy-in wins: the finish says 'Someone just changed this game', the game stays open, gap −10000, no result expense", async () => {
    const w = await game("balanced");
    const f = await finishGame(w.gameId, w.a, { afterRead: async () => void (await buyIn(w.gameId, w.a, { memberIds: [w.a], amount: "100" })) });
    expect(f).toEqual({ ok: false, error: "Someone just changed this game. Check the amounts and finish again." });
    expect((await db.potGame.findUniqueOrThrow({ where: { id: w.gameId } })).status).toBe("open");
    expect(await gap(w.groupId, w.gameId)).toBe(-10000);
    expect(await db.expense.count({ where: { groupId: w.groupId, kind: "pot" } })).toBe(0);
    await invariants(w.groupId);
  });

  it("every other move loses cleanly to a finish that commits first", async () => {
    const cases: [string, "balanced" | "binaPlaying", (w: Awaited<ReturnType<typeof game>>, hook: () => Promise<void>) => Promise<{ ok: boolean; error?: string }>][] = [
      ["record a move", "balanced", (w, h) => recordMove(w.gameId, w.a, { memberId: w.a, kind: "take", amount: "100" }, { afterRead: h })],
      ["take a line back", "balanced", async (w, h) => removeMove((await live(w.gameId))[0].id, w.a, { afterRead: h })],
      ["add a player", "balanced", (w, h) => addPlayerToGame(w.gameId, w.a, "Late Larry", { afterRead: h })],
      ["cash out", "binaPlaying", (w, h) => cashOut(w.gameId, w.a, { memberId: w.b, amount: "300" }, { afterRead: h })],
      ["count out", "binaPlaying", (w, h) => countOut(w.gameId, w.a, [{ memberId: w.b, amount: "300" }], false, { afterRead: h })],
      ["fix the gap", "binaPlaying", (w, h) => adjustGap(w.gameId, w.a, { mode: "one", memberId: w.b }, { afterRead: h })],
    ];
    for (const [name, state, run] of cases) {
      const w = await game(state);
      const hook = state === "balanced" ? async () => void (await finishGame(w.gameId, w.a)) : binaFinishes(w);
      const r = await run(w, hook);
      expect(r, name).toEqual({ ok: false, error: GAME_FINISHED });
      expect((await db.potGame.findUniqueOrThrow({ where: { id: w.gameId } })).status, name).toBe("done");
      expect(await live(w.gameId), name).toHaveLength(4);
      expect(await db.expense.count({ where: { groupId: w.groupId, kind: "pot" } }), name).toBe(1);
      expect(await gap(w.groupId, w.gameId), name).toBe(0);
      await invariants(w.groupId);
    }
  });

  it("other moves that commit first make the finish ask to check again; the game stays open with no result", async () => {
    // Asha took home 100000, Bina still has her 50000 in play but the count adds up (balanced), so a finish is possible.
    const cases: [string, (w: Awaited<ReturnType<typeof game>>) => Promise<unknown>][] = [
      ["cash out", (w) => cashOut(w.gameId, w.a, { memberId: w.b, amount: "0" })],
      ["count out", (w) => countOut(w.gameId, w.a, [{ memberId: w.b, amount: "0" }], false)],
      ["take a line back", async (w) => removeMove((await live(w.gameId))[0].id, w.a)],
      ["record a move", (w) => recordMove(w.gameId, w.a, { memberId: w.b, kind: "return", amount: "0" })],
    ];
    for (const [name, doMove] of cases) {
      const g = await make(["Asha", "Bina"], { type: "pot" });
      const s = await startGame(g.id, g.ids.Asha, { name: "Sat", game: "cards", players: [g.ids.Asha, g.ids.Bina] });
      if (!s.ok) throw new Error(s.error);
      const w = { ...g, a: g.ids.Asha, b: g.ids.Bina, gameId: s.id, groupId: g.id };
      await buyIn(s.id, w.a, { memberIds: [w.a, w.b], amount: "500" });
      await recordMove(s.id, w.a, { memberId: w.a, kind: "return", amount: "1000" });
      const f = await finishGame(w.gameId, w.a, { afterRead: async () => void (await doMove(w)) });
      expect(f, name).toEqual({ ok: false, error: "Someone just changed this game. Check the amounts and finish again." });
      expect((await db.potGame.findUniqueOrThrow({ where: { id: w.gameId } })).status, name).toBe("open");
      expect(await db.expense.count({ where: { groupId: w.groupId, kind: "pot" } }), name).toBe(0);
      await invariants(w.groupId);
    }
  });

  it("delete vs finish: the game is done, not deleted, and its result is still in the balances", async () => {
    const w = await game("balanced");
    const r = await deleteGame(w.gameId, w.a, { afterRead: async () => void (await finishGame(w.gameId, w.a)) });
    expect(r.ok).toBe(false);
    const row = await db.potGame.findUniqueOrThrow({ where: { id: w.gameId } });
    expect([row.status, row.deletedAt]).toEqual(["done", null]);
    expect(row.resultId).not.toBe("");
    expect(await db.expense.count({ where: { id: row.resultId } })).toBe(1);
    expect(await net(w.groupId)).toMatchObject({ [w.a]: 20000, [w.b]: -20000 });
    expect((await loadGame(w.groupId, w.gameId))?.id).toBe(w.gameId);
  });

  it("two buy-ins at the same moment for new players X and Y: both end up in the players list", async () => {
    // Both read the players as [Asha, Bina]; the inner one commits first, the outer one merges instead of overwriting.
    const g = await make(["Asha", "Bina", "Xavier", "Yara"], { type: "pot" });
    const s = await startGame(g.id, g.ids.Asha, { name: "Sunday", game: "cards", players: [g.ids.Asha, g.ids.Bina] });
    if (!s.ok) throw new Error(s.error);
    const r = await buyIn(s.id, g.ids.Asha, { memberIds: [g.ids.Xavier], amount: "100" }, {
      afterRead: async () => void expect((await buyIn(s.id, g.ids.Asha, { memberIds: [g.ids.Yara], amount: "100" })).ok).toBe(true),
    });
    expect(r.ok).toBe(true);
    const players = parsePlayers((await db.potGame.findUniqueOrThrow({ where: { id: s.id } })).players);
    expect([...players].sort()).toEqual([g.ids.Asha, g.ids.Bina, g.ids.Xavier, g.ids.Yara].sort());
    expect(await live(s.id)).toHaveLength(2);
  });

  it("H1: a delete that lands in finish's gap wins: finish is refused, no result expense, balances stay 0", async () => {
    const w = await game("balanced");
    const f = await finishGame(w.gameId, w.a, { afterRead: async () => void expect((await deleteGame(w.gameId, w.a)).ok).toBe(true) });
    expect(f).toEqual({ ok: false, error: "This game was deleted." });
    const row = await db.potGame.findUniqueOrThrow({ where: { id: w.gameId } });
    expect([row.status, row.resultId]).toEqual(["open", ""]);
    expect(row.deletedAt).not.toBeNull();
    expect(await db.expense.count({ where: { groupId: w.groupId, kind: "pot" } })).toBe(0);
    expect(Object.values(await net(w.groupId)).every((v) => v === 0)).toBe(true);
  });

  it("N5: a game reopened in mark-paid's gap: refused, nothing recorded", async () => {
    const w = await game("balanced");
    expect((await finishGame(w.gameId, w.a)).ok).toBe(true);
    const r = await markGamePaid(w.gameId, w.a, "", { afterRead: async () => void expect((await reopenGame(w.gameId, w.a)).ok).toBe(true) });
    expect(r).toEqual({ ok: false, error: "This game was reopened, so check it again." });
    expect(await db.payment.count({ where: { groupId: w.groupId } })).toBe(0);
    expect(Object.values(await net(w.groupId)).every((v) => v === 0)).toBe(true); // the reopened game's result is out of the balances
  });

  it("M4: marking a finished game paid twice at the same moment records one set of payments (Bina → Asha 20000)", async () => {
    const w = await game("balanced");
    expect((await finishGame(w.gameId, w.a)).ok).toBe(true);
    const r = await markGamePaid(w.gameId, w.a, "", { afterRead: async () => void expect((await markGamePaid(w.gameId, w.a)).ok).toBe(true) });
    expect(r).toEqual({ ok: false, error: "Everything in this game is already paid." });
    const pays = await db.payment.findMany({ where: { groupId: w.groupId } });
    expect(pays.map((p) => [p.fromId, p.toId, p.amount])).toEqual([[w.b, w.a, 20000]]);
    expect(Object.values(await net(w.groupId)).every((v) => v === 0)).toBe(true);
  });
});

describe("review fixes: undo, move-out, deletes and redo re-check inside the write", () => {
  it("H2: undoing a currency change is refused when a $10 expense lands in the gap; the group stays USD and nothing is converted back", async () => {
    const g = await make(["A", "B"]);
    expect((await saveExpense(draft(g.id, g.ids.A), g.ids.A, rate1)).ok).toBe(true); // ₹900: 45000 each
    expect((await changeGroupCurrency(g.id, g.ids.A, "USD", "0.012")).ok).toBe(true); // 90000 × 0.012 = 1080 cents, 540 each
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: g.id, kind: "currency_changed" } });
    const p = parseUndo(ev.undo);
    if (p?.type !== "currency_restore") throw new Error("not a currency undo");
    const r = await restoreCurrency(g.id, g.ids.A, p, {
      afterRead: async () => void expect((await saveExpense(draft(g.id, g.ids.A, { name: "Late", amount: "10", currency: "USD" }), g.ids.A, rate1)).ok).toBe(true),
    });
    expect(r.ok).toBe(false);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).currency).toBe("USD");
    const amounts = (await db.expense.findMany({ where: { groupId: g.id }, orderBy: { amount: "asc" } })).map((e) => [e.amount, e.baseCurrency]);
    expect(amounts).toEqual([[1000, "USD"], [1080, "USD"]]); // the new $10 (1000 cents) is untouched; the old one keeps its converted 1080
    await invariants(g.id);
  });

  it("M1: an expense involving the leaver lands in the gap: the move-out is refused and nothing is recorded", async () => {
    const g = await make(["You", "Rohan", "Meera"], { type: "home" });
    await addExpense(g.id, g.ids.You, 90000, [[g.ids.You, 30000], [g.ids.Rohan, 30000], [g.ids.Meera, 30000]], "Groceries"); // Rohan owes 30000
    const r = await moveOut(g.id, g.ids.You, { leaverId: g.ids.Rohan, lastDay: "2026-11-10", requestKey: key("mo") }, new Date("2026-11-12T06:00:00Z"), {
      afterRead: async () => void (await addExpense(g.id, g.ids.Meera, 30000, [[g.ids.Rohan, 30000]], "Cab")), // Rohan now owes 60000
    });
    expect(r).toEqual({ ok: false, error: "Balances just changed. Check the move-out again." });
    expect((await db.member.findUniqueOrThrow({ where: { id: g.ids.Rohan } })).leftAt).toBeNull();
    expect(await db.payment.count({ where: { groupId: g.id } })).toBe(0);
    await invariants(g.id);
  });

  it("M2: deleting an expense while 'Settle everything & close' commits is refused (the group is closed)", async () => {
    const g = await make(["Asha", "Bina"]);
    const e = await addExpense(g.id, g.ids.Bina, 100000, [[g.ids.Asha, 50000], [g.ids.Bina, 50000]]);
    const plan = planKey((await loadGroup(g.id))!.transfers);
    const r = await setExpenseDeleted(e.id, g.ids.Asha, true, { afterRead: async () => void expect((await settleAllAndClose(g.id, g.ids.Asha, plan)).ok).toBe(true) });
    expect(r).toEqual({ ok: false, error: "This group was closed while you were saving, so nothing was saved." });
    expect((await db.expense.findUniqueOrThrow({ where: { id: e.id } })).deletedAt).toBeNull();
    expect(Object.values(await net(g.id))).toEqual([0, 0]); // Asha's 50000 payment to Bina is what was settled
  });

  it("M2: deleting a payment while the group closes is refused too", async () => {
    const g = await make(["Asha", "Bina"]);
    await addExpense(g.id, g.ids.Bina, 100000, [[g.ids.Asha, 50000], [g.ids.Bina, 50000]]);
    const p = await payNow(g.id, g.ids.Asha, g.ids.Bina, 10000);
    const r = await setPaymentDeleted(p.id, g.ids.Asha, true, { afterRead: async () => void (await db.group.update({ where: { id: g.id }, data: { closed: true } })) });
    expect(r.ok).toBe(false);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).deletedAt).toBeNull();
  });

  it("M3: settle-all, undo, a new ₹100 expense, then redo is refused (balances are no longer square)", async () => {
    const g = await make(["Asha", "Bina"]);
    await addExpense(g.id, g.ids.Bina, 100000, [[g.ids.Asha, 50000], [g.ids.Bina, 50000]]);
    const plan = planKey((await loadGroup(g.id))!.transfers);
    expect((await settleAllAndClose(g.id, g.ids.Asha, plan)).ok).toBe(true); // Asha → Bina 50000, group closed
    const ids = (await db.payment.findMany({ where: { groupId: g.id } })).map((p) => p.id);
    expect((await applySettleAll(g.id, g.ids.Asha, ids, false)).ok).toBe(true); // undo: reopened, payments out
    expect((await saveExpense(draft(g.id, g.ids.Bina, { amount: "100" }), g.ids.Bina, rate1)).ok).toBe(true); // 5000 each
    const redo = await applySettleAll(g.id, g.ids.Asha, ids, true);
    expect(redo).toEqual({ ok: false, error: "Balances changed since, so this can't be redone." });
    const row = await db.group.findUniqueOrThrow({ where: { id: g.id } });
    expect(row.closed).toBe(false);
    expect(await db.payment.count({ where: { groupId: g.id, deletedAt: null } })).toBe(0);
    // Asha −50000 − 5000 = −55000, Bina +55000.
    expect(await net(g.id)).toEqual({ [g.ids.Asha]: -55000, [g.ids.Bina]: 55000 });
    await invariants(g.id);
  });

  it("M5: undo is refused when it would put a share back on someone who has since left", async () => {
    const g = await make(["A", "B", "C"]);
    const first = await saveExpense(draft(g.id, g.ids.A), g.ids.A, rate1); // ₹900 for all three: 30000 each
    if (!first.ok) throw new Error(first.error);
    const edit = await saveExpense({ ...draft(g.id, g.ids.A, { forMode: "selected", selected: [g.ids.A, g.ids.B] }), expenseId: first.id }, g.ids.A, rate1); // 45000 each, C out
    if (!edit.ok) throw new Error(edit.error);
    expect((await setMember(g.id, g.ids.A, g.ids.C, { leftAt: new Date().toISOString() })).ok).toBe(true); // C owes nothing now
    const r = await undoEvent(edit.eventId!, g.ids.A);
    expect(r).toEqual({ ok: false, error: "C has left the group, so this can't be undone." });
    expect((await db.expenseShare.findMany({ where: { expenseId: first.id } })).map((x) => x.amount)).toEqual([45000, 45000]);
    await invariants(g.id);
  });

  it("L1: a repeated submit (same key) answers 'duplicate', not the over-the-limit warning", async () => {
    const g = await make(["Asha", "Bina", "Chirag"]);
    await addExpense(g.id, g.ids.Bina, 50000, [[g.ids.Asha, 50000]]);
    const base = { groupId: g.id, fromId: g.ids.Asha, toId: g.ids.Bina, currency: "INR", myId: g.ids.Asha, key: key("l1"), fp: "fp-l1" };
    expect((await recordPaymentCore({ ...base, amount: 50000, warnOver: true })).kind).toBe("done"); // exactly the limit
    expect(await recordPaymentCore({ ...base, amount: 60000, warnOver: true })).toEqual({ kind: "duplicate" });
    expect(await db.payment.count({ where: { groupId: g.id } })).toBe(1);
  });

  it("L2: an edit landing in a currency change's gap gives the calm 'changed' answer, not an error", async () => {
    const g = await make(["A", "B"]);
    const first = await saveExpense(draft(g.id, g.ids.A), g.ids.A, rate1); // ₹900
    if (!first.ok) throw new Error(first.error);
    const r = await changeGroupCurrency(g.id, g.ids.A, "USD", "0.012", {
      afterRead: async () => void expect((await saveExpense({ ...draft(g.id, g.ids.A, { amount: "1200" }), expenseId: first.id }, g.ids.A, rate1)).ok).toBe(true), // 60000 each
    });
    expect(r).toEqual({ ok: false, error: "Something in the group changed just now. Check it and try again." });
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).currency).toBe("INR");
    const e = await db.expense.findUniqueOrThrow({ where: { id: first.id }, include: { shares: true } });
    expect([e.amount, ...e.shares.map((x) => x.amount)]).toEqual([120000, 60000, 60000]);
  });

  it("N1: an expense that landed after the currency change but BEFORE the undo's first read is refused too", async () => {
    const g = await make(["A", "B"]);
    expect((await saveExpense(draft(g.id, g.ids.A), g.ids.A, rate1)).ok).toBe(true); // ₹900
    expect((await changeGroupCurrency(g.id, g.ids.A, "USD", "0.012")).ok).toBe(true); // 1080 cents
    const p = parseUndo((await db.groupEvent.findFirstOrThrow({ where: { groupId: g.id, kind: "currency_changed" } })).undo);
    if (p?.type !== "currency_restore") throw new Error("not a currency undo");
    expect((await saveExpense(draft(g.id, g.ids.A, { name: "Early", amount: "10", currency: "USD" }), g.ids.A, rate1)).ok).toBe(true); // 1000 cents, not in the payload
    const r = await restoreCurrency(g.id, g.ids.A, p);
    expect(r.ok).toBe(false);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).currency).toBe("USD");
    expect((await db.expense.findMany({ where: { groupId: g.id }, orderBy: { amount: "asc" } })).map((e) => e.amount)).toEqual([1000, 1080]);
    await invariants(g.id);
  });

  it("N2: undoing a move-out in a closed flat is refused; balances stay You +30000, Rohan 0, Meera −30000", async () => {
    const g = await make(["You", "Rohan", "Meera"], { type: "home" });
    await addExpense(g.id, g.ids.You, 90000, [[g.ids.You, 30000], [g.ids.Rohan, 30000], [g.ids.Meera, 30000]], "Groceries");
    const out = await moveOut(g.id, g.ids.You, { leaverId: g.ids.Rohan, lastDay: "2026-11-10", requestKey: key("n2") }, new Date("2026-11-12T06:00:00Z"));
    expect(out.ok).toBe(true); // Rohan pays You 30000
    const want = { [g.ids.You]: 30000, [g.ids.Rohan]: 0, [g.ids.Meera]: -30000 };
    expect(await net(g.id)).toEqual(want);
    await db.group.update({ where: { id: g.id }, data: { closed: true } });
    const ev = await db.groupEvent.findFirstOrThrow({ where: { groupId: g.id, kind: "member_left" } });
    const r = await undoEvent(ev.id, g.ids.You);
    expect(r).toEqual({ ok: false, error: "This group is closed. Reopen it to change expenses." });
    expect((await db.member.findUniqueOrThrow({ where: { id: g.ids.Rohan } })).leftAt).not.toBeNull();
    expect(await net(g.id)).toEqual(want);
  });

  it("M1/N8: someone joining in the move-out's gap (nothing owed) does not refuse it", async () => {
    const g = await make(["You", "Rohan", "Meera"], { type: "home" });
    await addExpense(g.id, g.ids.You, 90000, [[g.ids.You, 30000], [g.ids.Rohan, 30000], [g.ids.Meera, 30000]], "Groceries");
    const r = await moveOut(g.id, g.ids.You, { leaverId: g.ids.Rohan, lastDay: "2026-11-10", requestKey: key("n8") }, new Date("2026-11-12T06:00:00Z"), {
      afterRead: async () => void (await db.member.create({ data: { name: "Newbie", groupId: g.id } })),
    });
    expect(r.ok).toBe(true);
    expect(await db.payment.count({ where: { groupId: g.id } })).toBe(1);
  });

  it("N3: a deleted ₹900 Dinner (A/B/C) can't be restored, or its delete undone, once C has left; C stays at 0", async () => {
    const g = await make(["A", "B", "C"]);
    const first = await saveExpense(draft(g.id, g.ids.A), g.ids.A, rate1); // 30000 each
    if (!first.ok) throw new Error(first.error);
    const del = await setExpenseDeleted(first.id, g.ids.A, true);
    if (!del.ok) throw new Error(del.error);
    expect((await net(g.id))[g.ids.C]).toBe(0);
    expect((await setMember(g.id, g.ids.A, g.ids.C, { leftAt: new Date().toISOString() })).ok).toBe(true);
    expect(await setExpenseDeleted(first.id, g.ids.A, false)).toEqual({ ok: false, error: "C has left the group, so this can't be brought back." });
    expect(await undoEvent(del.eventId!, g.ids.A)).toEqual({ ok: false, error: "C has left the group, so this can't be undone." });
    expect((await db.expense.findUniqueOrThrow({ where: { id: first.id } })).deletedAt).not.toBeNull();
    expect((await net(g.id))[g.ids.C]).toBe(0);
  });

  it("N3: a deleted payment between A and C can't be brought back once C has left", async () => {
    const g = await make(["A", "C"]);
    const pay = await payNow(g.id, g.ids.C, g.ids.A, 10000);
    expect((await setPaymentDeleted(pay.id, g.ids.A, true)).ok).toBe(true); // balances 0 again
    expect((await setMember(g.id, g.ids.A, g.ids.C, { leftAt: new Date().toISOString() })).ok).toBe(true);
    expect(await setPaymentDeleted(pay.id, g.ids.A, false)).toEqual({ ok: false, error: "C has left the group, so this can't be brought back." });
    expect((await net(g.id))[g.ids.C]).toBe(0);
  });

  it("N3: undoing an edit that changed C's share (30000 → 20000) is refused once C paid up and left", async () => {
    const g = await make(["A", "B", "C"]);
    const { A, B, C } = g.ids;
    const first = await saveExpense(draft(g.id, A), A, rate1); // 30000 each
    if (!first.ok) throw new Error(first.error);
    const exact = { forMode: "selected" as const, selected: [A, B, C], splitType: "exact" as const, exact: { [A]: "400", [B]: "300", [C]: "200" } };
    const edit = await saveExpense({ ...draft(g.id, A, exact), expenseId: first.id }, A, rate1); // 40000 / 30000 / 20000
    if (!edit.ok) throw new Error(edit.error);
    await payNow(g.id, C, A, 20000); // C owes 20000 and pays it: C is square
    expect((await setMember(g.id, A, C, { leftAt: new Date().toISOString() })).ok).toBe(true);
    expect(await undoEvent(edit.eventId!, A)).toEqual({ ok: false, error: "C has left the group, so this can't be undone." });
    expect((await db.expenseShare.findMany({ where: { expenseId: first.id } })).map((x) => x.amount).sort((a, b) => a - b)).toEqual([20000, 30000, 40000]);
    expect((await net(g.id))[C]).toBe(0);
    await invariants(g.id);
  });

  it("N3: an edit may keep a leaver in the expense if their share and payment stay exactly the same; changing it is refused", async () => {
    const g = await make(["A", "B", "C"]);
    const { A, C } = g.ids;
    const first = await saveExpense(draft(g.id, A), A, rate1); // 30000 each
    if (!first.ok) throw new Error(first.error);
    await payNow(g.id, C, A, 30000); // C is square
    expect((await setMember(g.id, A, C, { leftAt: new Date().toISOString() })).ok).toBe(true);
    // Only the description changes: everyone's share is still 30000. Allowed.
    expect((await saveExpense({ ...draft(g.id, A, { name: "Dinner at Goa" }), expenseId: first.id }, A, rate1)).ok).toBe(true);
    expect((await db.expense.findUniqueOrThrow({ where: { id: first.id } })).description).toBe("Dinner at Goa");
    // The amount changes to ₹1,200 (40000 each): C's share would move. Refused.
    const r = await saveExpense({ ...draft(g.id, A, { name: "Dinner at Goa", amount: "1200" }), expenseId: first.id }, A, rate1);
    expect(r).toEqual({ ok: false, error: "C has left the group, so their share can't change. Ask them to rejoin first." });
    expect((await db.expense.findUniqueOrThrow({ where: { id: first.id } })).amount).toBe(90000);
    expect((await net(g.id))[C]).toBe(0);
    await invariants(g.id);
  });

  it("N3 (balance rule): restoring a Dinner that takes a leaver from +30000 back to 0 is allowed", async () => {
    const g = await make(["A", "B", "C"]);
    const { A, C } = g.ids;
    const first = await saveExpense(draft(g.id, A), A, rate1); // 30000 each
    if (!first.ok) throw new Error(first.error);
    await payNow(g.id, C, A, 30000); // C is square: 0
    expect((await setExpenseDeleted(first.id, A, true)).ok).toBe(true); // C: paid 30000 for nothing = +30000
    expect((await net(g.id))[C]).toBe(30000);
    await db.member.update({ where: { id: C }, data: { leftAt: new Date() } }); // C has left with +30000
    const back = await setExpenseDeleted(first.id, A, false); // C's 30000 share returns: +30000 − 30000 = 0
    expect(back.ok).toBe(true);
    expect((await net(g.id))[C]).toBe(0);
    await invariants(g.id);
  });
});

