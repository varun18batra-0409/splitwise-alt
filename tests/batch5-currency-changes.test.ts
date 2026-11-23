import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { changeGroupCurrency, squareLimit } from "@/lib/group-changes";
import { REVERT_CLASH, historyCheck, restoreCurrency, undoEvent } from "@/lib/undo";
import { parseUndo, parseDetails } from "@/lib/events";
import { loadGroup } from "@/lib/group-data";
import { keepSquareAtZero, type SquareExpense, type SquarePayment } from "@/lib/rebase";
import { initialFromExpense } from "@/lib/expense-initial";
import { checkBooks } from "./helpers/money-invariants";

// Batch 5: currency changes. Throwaway database, every group erased at the end. All amounts are whole minor units (paise, cents), worked out by hand.
//  L19 / L04 / G03: an edit that changes no money keeps the stored shares, payers, amounts and card fee exactly (same rows, same ids).
//  L24: an undo can't mix currencies or overwrite a newer edit (the history is looked at again inside the undo's own write).
//  G25: a currency change may not rewrite a past payment or share by more than rounding: max(2 minor units, 1% of the plain amount, rounded up).

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let counter = 0;
const groupIds: string[] = [];
afterAll(async () => {
  await eraseGroups(groupIds);
});
const lookup = async () => ({ ok: true as const, rate: "1", date: "2026-11-23" });

async function world(label: string, names: string[], cardMarkupBp = 0) {
  const n = ++counter;
  const g = await db.group.create({
    data: {
      name: `B5 ${label} ${n}`, type: "trip", currency: "INR", cardMarkupBp, inviteCode: `b5-${n}-${stamp}`,
      members: { create: names.map((name, i) => ({ name, splitWeight: 100, createdAt: new Date(2026, 0, i + 1) })) },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { gid: g.id, id: (name: string) => g.members.find((m) => m.name === name)!.id };
}
type World = Awaited<ReturnType<typeof world>>;

// An expense written straight to the database (INR, no conversion) with the given shares.
const rawExpense = (w: World, paidBy: string, description: string, shares: [string, number][], at: number) => {
  const amount = shares.reduce((s, x) => s + x[1], 0);
  return db.expense.create({
    data: {
      groupId: w.gid, description, amount, paidById: w.id(paidBy), createdById: w.id(paidBy), splitType: "exact", forMode: "selected", category: "other", paymentMethod: "cash",
      originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount, createdAt: new Date(2026, 1, 1, 0, 0, at),
      shares: { create: shares.map(([name, a]) => ({ memberId: w.id(name), amount: a })) },
    },
    include: { shares: true },
  });
};
const rawPayment = (w: World, from: string, to: string, amount: number, at: number) =>
  db.payment.create({ data: { groupId: w.gid, fromId: w.id(from), toId: w.id(to), amount, createdById: w.id(from), createdAt: new Date(2026, 1, 1, 0, 1, at) } });
const payAmounts = async (w: World) => (await db.payment.findMany({ where: { groupId: w.gid }, orderBy: { createdAt: "asc" } })).map((p) => p.amount);
const shareRows = async (expenseId: string) => (await db.expenseShare.findMany({ where: { expenseId }, orderBy: { id: "asc" }, include: { member: true } })).map((s) => ({ id: s.id, who: s.member.name, amount: s.amount }));
const eventDetails = async (eventId: string) => parseDetails((await db.groupEvent.findUniqueOrThrow({ where: { id: eventId } })).details);

// What the edit form posts when only the name was typed over (everything else as opened).
const post = (w: World, over: Partial<SaveExpenseInput>): SaveExpenseInput => ({
  groupId: w.gid, name: "x", category: "other", amount: "0", currency: "INR", paidById: "", forMode: "everyone", selected: [], onePersonId: "",
  splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "keep", manualRate: "", ...over,
});

// ---------- G25: the limit itself ----------
describe("G25: squareLimit is max(2, 1% of the plain amount rounded up)", () => {
  it("hand-worked: 8,000 -> 80; 9,920 -> 100 (1% is 99.2, rounded up); 201 -> 3; 100 and below -> 2; negatives count by size", () => {
    expect(squareLimit(8000)).toBe(80);
    expect(squareLimit(9920)).toBe(100);
    expect(squareLimit(201)).toBe(3);
    expect(squareLimit(200)).toBe(2);
    expect(squareLimit(100)).toBe(2);
    expect(squareLimit(40)).toBe(2);
    expect(squareLimit(0)).toBe(2);
    expect(squareLimit(-8000)).toBe(80);
  });
});

describe("G25: keepSquareAtZero reports how far each row ended from its plain-converted amount", () => {
  it("the dinner of 10,000 paise at 0.0119: plain shares 40, 40, 39 end 39, 40, 40 -> moved A -1, R 0, C +1; payments (40, 40) not moved", () => {
    const share = (id: string, memberId: string, amount: number) => ({ id, memberId, amount });
    const before: SquareExpense = { id: "d", createdAt: 1, kind: "expense", paidById: "A", payers: "", amount: 10000, shares: [share("s0", "A", 3334), share("s1", "R", 3333), share("s2", "C", 3333)] };
    const after: SquareExpense = { ...before, amount: 119, shares: [share("s0", "A", 40), share("s1", "R", 40), share("s2", "C", 39)] };
    const pays = (a: number): SquarePayment[] => [{ id: "p1", createdAt: 2, fromId: "R", toId: "A", amount: a }, { id: "p2", createdAt: 3, fromId: "C", toId: "A", amount: a }];
    const r = keepSquareAtZero({
      members: [{ id: "A", left: false }, { id: "R", left: false }, { id: "C", left: false }],
      before: { expenses: [before], payments: pays(3333) },
      after: { expenses: [after], payments: pays(40) },
      convert: (a) => a,
    });
    expect(r!.shares).toEqual({ s0: 39, s1: 40, s2: 40 });
    expect(r!.moved).toEqual({ shares: { s0: -1, s1: 0, s2: 1 }, payments: { p1: 0, p2: 0 } });
  });
});

// ---------- L19: rounding case ----------
describe("L19: renaming an expense after a currency change keeps the stored shares and their rows", () => {
  it("Dinner 10,000 paise (A 3,334, B 3,333, C 3,333), B and C paid A 3,333 each; USD at 0.0119 gives shares 39/40/40; renaming to Thali changes nothing else", async () => {
    const w = await world("l19", ["A", "B", "C"]);
    const dinner = await rawExpense(w, "A", "Dinner", [["A", 3334], ["B", 3333], ["C", 3333]], 1);
    await rawPayment(w, "B", "A", 3333, 1);
    await rawPayment(w, "C", "A", 3333, 2);
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0, 0]);

    // Total 10,000 x 0.0119 = 119 cents; plain shares 40, 40, 39; each payment 3,333 x 0.0119 = 39.66 -> 40; A is -1 and C +1, so one cent moves from A to C: 39, 40, 40.
    const change = await changeGroupCurrency(w.gid, w.id("A"), "USD", "0.0119");
    if (!change.ok) throw new Error(change.error);
    const stored = await shareRows(dinner.id);
    expect(stored.map((s) => [s.who, s.amount])).toEqual(expect.arrayContaining([["A", 39], ["B", 40], ["C", 40]]));
    expect((await db.expense.findUniqueOrThrow({ where: { id: dinner.id } })).amount).toBe(119);
    expect(await payAmounts(w)).toEqual([40, 40]);

    // The form as opened: ₹100 (originally typed) shared by amounts. The exact boxes are what the saved shares work out to by weight
    // (10,000 x 39/119 = 3,277.3 and x 40/119 = 3,361.3 twice; 9,999 placed, the last paisa to a biggest leftover): 32.77, 33.62, 33.61.
    // They are taken from the same function the edit screen uses, so this posts exactly what the screen would, whatever the person did not touch.
    const saved = await db.expense.findUniqueOrThrow({ where: { id: dinner.id }, include: { shares: true } });
    const opened = initialFromExpense(saved, { groupMarkupBp: 0, groupWeights: {}, tz: "Asia/Kolkata", today: "2026-11-23" }, "edit");
    expect(opened.amount).toBe("100");
    // Hand-checked: weights 39, 40, 40 over 10,000 paise: 3,277 + 3,361 + 3,361 = 9,999, the odd paisa to the first of the two biggest leftovers (B).
    expect(opened.exact).toEqual({ [w.id("A")]: "32.77", [w.id("B")]: "33.62", [w.id("C")]: "33.61" });
    const r = await saveExpense(
      post(w, {
        expenseId: dinner.id, name: "Thali", amount: opened.amount, currency: opened.currency, paidById: w.id("A"), forMode: "selected", selected: opened.selected,
        splitType: opened.splitType, exact: opened.exact, percent: opened.percent, paymentMethod: "cash",
      }),
      w.id("A"),
      lookup,
    );
    if (!r.ok) throw new Error(r.error);

    const after = await db.expense.findUniqueOrThrow({ where: { id: dinner.id } });
    expect(after.description).toBe("Thali");
    expect(after.amount).toBe(119);
    expect(await shareRows(dinner.id)).toEqual(stored); // the same rows (same ids) with the same amounts
    expect(await payAmounts(w)).toEqual([40, 40]);
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0, 0]);
    expect((await loadGroup(w.gid))!.transfers).toEqual([]); // settle-up has nothing to do
    expect(await eventDetails(r.eventId!)).toEqual(["Name: Dinner → Thali"]);
  });
});

// ---------- G03: card fee kept ----------
// $100 on a card (10,000 cents), 3% fee, rate 83.5: 10,000 x 83.5 = 835,000 paise + fee 25,050 = 860,050; A and B 430,025 each.
// USD at 0.012: the dollars stay 10,000 cents; the fee 25,050 x 0.012 = 300.6 -> 301; amount 10,301; shares 5,151 (the odd cent to the first) and 5,150.
async function feeWorld(label: string) {
  const w = await world(label, ["A", "B"], 300);
  const made = await saveExpense(
    post(w, { name: "Dinner", amount: "100", currency: "USD", paidById: w.id("A"), paymentMethod: "card", markupChoice: "group", rateMode: "manual", manualRate: "83.5" }),
    w.id("A"),
    lookup,
  );
  if (!made.ok) throw new Error(made.error);
  const e = await db.expense.findUniqueOrThrow({ where: { id: made.id } });
  expect([e.originalAmount, e.convertedAmount, e.markupAmount, e.amount]).toEqual([10000, 835000, 25050, 860050]);
  expect((await shareRows(made.id)).map((s) => s.amount)).toEqual([430025, 430025]);
  const change = await changeGroupCurrency(w.gid, w.id("A"), "USD", "0.012");
  if (!change.ok) throw new Error(change.error);
  return { w, id: made.id };
}
// The form as opened after the change: the total is what is typed (103.01), because the fee is part of it now.
const feeForm = (w: World, id: string, over: Partial<SaveExpenseInput> = {}) =>
  post(w, { expenseId: id, name: "Dinner", amount: "103.01", currency: "USD", paidById: w.id("A"), paymentMethod: "card", markupChoice: "group", ...over });

describe("G03: renaming a dinner whose card fee was kept keeps the fee", () => {
  it("amount 10,301, fee 301, dollars 10,000, shares 5,151 / 5,150 before and after a rename; A +5,150, B -5,150; B pays A 5,150 and both are 0", async () => {
    const { w, id } = await feeWorld("g03");
    const before = await db.expense.findUniqueOrThrow({ where: { id } });
    expect([before.amount, before.markupAmount, before.convertedAmount, before.originalAmount]).toEqual([10301, 301, 10000, 10000]);
    const stored = await shareRows(id);
    expect(stored.map((s) => [s.who, s.amount])).toEqual(expect.arrayContaining([["A", 5151], ["B", 5150]]));

    const r = await saveExpense(feeForm(w, id, { name: "Dinner at Goa" }), w.id("A"), lookup);
    if (!r.ok) throw new Error(r.error);
    const after = await db.expense.findUniqueOrThrow({ where: { id } });
    expect(after.description).toBe("Dinner at Goa");
    expect([after.amount, after.markupAmount, after.convertedAmount, after.originalAmount, after.originalCurrency, after.markupBp]).toEqual([10301, 301, 10000, 10000, "USD", 300]);
    expect(await shareRows(id)).toEqual(stored);
    expect(await eventDetails(r.eventId!)).toEqual(["Name: Dinner → Dinner at Goa"]);

    const net = await checkBooks(w.gid);
    expect([net[w.id("A")], net[w.id("B")]]).toEqual([5150, -5150]);
    await rawPayment(w, "B", "A", 5150, 1);
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0]);
  });

  it("(c) a real money edit afterwards still rebuilds: $120 (12,000) gives new shares 6,000 + 6,000 and the fee is gone as before", async () => {
    const { w, id } = await feeWorld("g03c");
    const stored = await shareRows(id);
    const r = await saveExpense(feeForm(w, id, { amount: "120" }), w.id("A"), lookup);
    if (!r.ok) throw new Error(r.error);
    const after = await db.expense.findUniqueOrThrow({ where: { id } });
    expect([after.amount, after.originalAmount, after.markupAmount]).toEqual([12000, 12000, 0]);
    const rows = await shareRows(id);
    expect(rows.map((s) => s.amount)).toEqual([6000, 6000]);
    expect(rows.map((s) => s.id).sort()).not.toEqual(stored.map((s) => s.id).sort()); // rebuilt: new rows
    expect(rows.reduce((n, s) => n + s.amount, 0)).toBe(after.amount);
    await checkBooks(w.gid);
  });
});

// ---------- L24: undo can't mix currencies or overwrite a newer edit ----------
const CURRENCY_MOVED = "Expenses, payments or other money in the group changed after the currency change, so it can’t be undone safely. Change the currency again instead.";
const REVERT_CLASH_TEXT = "Someone changed this expense a moment ago, so it wasn’t undone. Open it again to see the latest version.";

describe("L24: undoing a currency change after a newer edit lands", () => {
  async function converted(label: string) {
    const w = await world(label, ["A", "B"]);
    const e = await rawExpense(w, "A", "Dinner", [["A", 40000], ["B", 40000]], 1); // ₹800
    // 80,000 x 0.0125 = 1,000 cents, 500 each.
    const change = await changeGroupCurrency(w.gid, w.id("A"), "USD", "0.0125");
    if (!change.ok) throw new Error(change.error);
    expect((await db.expense.findUniqueOrThrow({ where: { id: e.id } })).amount).toBe(1000);
    expect((await shareRows(e.id)).map((s) => s.amount)).toEqual([500, 500]);
    return { w, id: e.id, eventId: change.eventId! };
  }
  const editTo12 = (w: World, id: string) =>
    saveExpense(post(w, { expenseId: id, name: "Dinner", amount: "12", currency: "USD", paidById: w.id("A"), rateMode: "auto" }), w.id("A"), lookup);

  it("an edit to $12 (1,200; 600 + 600; new share rows) lands after the checks: the undo is refused, nothing is mixed, and the change is not marked undone", async () => {
    const { w, id, eventId } = await converted("l24-undo");
    const r = await undoEvent(eventId, w.id("A"), undefined, { afterHistory: async () => void expect((await editTo12(w, id)).ok).toBe(true) });
    expect(r).toEqual({ ok: false, error: CURRENCY_MOVED });
    const e = await db.expense.findUniqueOrThrow({ where: { id } });
    expect([e.amount, e.baseCurrency, e.originalCurrency]).toEqual([1200, "USD", "USD"]);
    expect((await shareRows(id)).map((s) => s.amount)).toEqual([600, 600]);
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).currency).toBe("USD");
    expect((await db.groupEvent.findUniqueOrThrow({ where: { id: eventId } })).undoneAt).toBeNull();
    expect(await db.groupEvent.count({ where: { groupId: w.gid, kind: "currency_changed" } })).toBe(1); // no "changed back" line
    const net = await checkBooks(w.gid);
    expect([net[w.id("A")], net[w.id("B")]]).toEqual([600, -600]);
  });

  it("the restore itself also refuses when the expense's share rows are not the ones the change converted (an edit before it started)", async () => {
    const { w, id, eventId } = await converted("l24-rows");
    expect((await editTo12(w, id)).ok).toBe(true); // new share rows, amount 1,200
    const p = parseUndo((await db.groupEvent.findUniqueOrThrow({ where: { id: eventId } })).undo);
    if (p?.type !== "currency_restore") throw new Error("not a currency undo");
    const r = await restoreCurrency(w.gid, w.id("A"), p);
    expect(r).toEqual({ ok: false, error: CURRENCY_MOVED });
    const e = await db.expense.findUniqueOrThrow({ where: { id } });
    expect([e.amount, e.baseCurrency]).toEqual([1200, "USD"]);
    expect((await shareRows(id)).map((s) => s.amount)).toEqual([600, 600]);
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).currency).toBe("USD");
    await checkBooks(w.gid);
  });
});

describe("L24: undoing an edit can't overwrite a newer edit", () => {
  it("X takes 60,000 -> 90,000; Y takes 90,000 -> 120,000 lands after the checks: undoing X is refused and the expense stays 120,000", async () => {
    const w = await world("l24-revert", ["A", "B"]);
    const made = await saveExpense(post(w, { name: "Taxi", amount: "600", paidById: w.id("A"), rateMode: "auto" }), w.id("A"), lookup);
    if (!made.ok) throw new Error(made.error);
    const edit = (amount: string) => saveExpense(post(w, { expenseId: made.id, name: "Taxi", amount, paidById: w.id("A"), rateMode: "auto" }), w.id("A"), lookup);
    expect((await db.expense.findUniqueOrThrow({ where: { id: made.id } })).amount).toBe(60000);
    const x = await edit("900");
    if (!x.ok) throw new Error(x.error);
    expect((await db.expense.findUniqueOrThrow({ where: { id: made.id } })).amount).toBe(90000);

    const r = await undoEvent(x.eventId!, w.id("A"), undefined, { afterHistory: async () => void expect((await edit("1200")).ok).toBe(true) });
    expect(r).toEqual({ ok: false, error: REVERT_CLASH_TEXT });
    expect(REVERT_CLASH).toBe(REVERT_CLASH_TEXT);
    const e = await db.expense.findUniqueOrThrow({ where: { id: made.id } });
    expect(e.amount).toBe(120000);
    expect((await shareRows(made.id)).map((s) => s.amount)).toEqual([60000, 60000]);
    expect((await db.groupEvent.findUniqueOrThrow({ where: { id: x.eventId! } })).undoneAt).toBeNull();
    await checkBooks(w.gid);
  });

  it("with nothing newer in the gap the same undo still works (60,000 comes back)", async () => {
    const w = await world("l24-ok", ["A", "B"]);
    const made = await saveExpense(post(w, { name: "Taxi", amount: "600", paidById: w.id("A"), rateMode: "auto" }), w.id("A"), lookup);
    if (!made.ok) throw new Error(made.error);
    const x = await saveExpense(post(w, { expenseId: made.id, name: "Taxi", amount: "900", paidById: w.id("A"), rateMode: "auto" }), w.id("A"), lookup);
    if (!x.ok) throw new Error(x.error);
    const r = await undoEvent(x.eventId!, w.id("A"), undefined, { afterHistory: async () => undefined });
    expect(r.ok).toBe(true);
    expect((await db.expense.findUniqueOrThrow({ where: { id: made.id } })).amount).toBe(60000);
    await checkBooks(w.gid);
  });
});

// ---------- G25 through the database ----------
// Asha paid a $100 hotel for Ravi only, entered at rate 80: 10,000 cents = 800,000 paise. Ravi paid Asha 800,000. Everyone is 0.
async function hotel(label: string) {
  const w = await world(label, ["Asha", "Ravi"]);
  const e = await db.expense.create({
    data: {
      groupId: w.gid, description: "Hotel", amount: 800000, paidById: w.id("Asha"), createdById: w.id("Asha"), splitType: "equal", forMode: "one", category: "other",
      originalAmount: 10000, originalCurrency: "USD", baseCurrency: "INR", exchangeRate: "80", rateSource: "manual", convertedAmount: 800000, paymentMethod: "cash",
      createdAt: new Date(2026, 1, 1, 0, 0, 1), shares: { create: [{ memberId: w.id("Ravi"), amount: 800000 }] },
    },
  });
  await rawPayment(w, "Ravi", "Asha", 800000, 1);
  expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0]);
  return { w, id: e.id };
}

describe("G25: a currency change may not rewrite a past payment beyond rounding", () => {
  it("big jump: USD at 0.01 turns the hotel back to 10,000 cents but the payment only to 8,000; Ravi would need +2,000 (limit 80): refused, nothing written", async () => {
    const { w, id } = await hotel("g25-big");
    const r = await changeGroupCurrency(w.gid, w.id("Asha"), "USD", "0.01");
    expect(r).toEqual({
      ok: false,
      error: "At this rate, Ravi’s ₹8,000 payment to Asha would have to become $100 (not $80) to keep everyone settled. That’s more than rounding, usually because some expenses were entered in USD at a different rate. Nothing was changed. Check the rate.",
    });
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).currency).toBe("INR");
    expect(await payAmounts(w)).toEqual([800000]);
    const e = await db.expense.findUniqueOrThrow({ where: { id }, include: { shares: true } });
    expect([e.amount, e.baseCurrency, e.shares[0].amount]).toEqual([800000, "INR", 800000]);
    expect(await db.groupEvent.count({ where: { groupId: w.gid, kind: "currency_changed" } })).toBe(0);
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0]);
  });

  it("small, allowed: at 0.0124 the payment converts to 9,920 (800,000 x 0.0124); it must become 10,000, a gap of 80 within the limit of 100 (1% of 9,920 is 99.2, rounded up); listed in Activity; undo restores 800,000 exactly", async () => {
    // (The planner's note said the limit was 99; the code rounds 99.2 up to 100. 80 is allowed either way.)
    const { w, id } = await hotel("g25-small");
    const r = await changeGroupCurrency(w.gid, w.id("Asha"), "USD", "0.0124");
    if (!r.ok) throw new Error(r.error);
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).currency).toBe("USD");
    expect(await payAmounts(w)).toEqual([10000]);
    expect((await db.expense.findUniqueOrThrow({ where: { id } })).amount).toBe(10000);
    const net = await checkBooks(w.gid);
    expect([net[w.id("Asha")], net[w.id("Ravi")]]).toEqual([0, 0]);
    expect(await eventDetails(r.eventId!)).toEqual([
      "Currency: INR → USD",
      "Rate used: 1 INR = 0.0124 USD",
      "Group total: ₹8,000 → $100",
      "Ravi → Asha: ₹8,000 is now $100 (rounded so balances stay settled).",
    ]);

    const u = await undoEvent(r.eventId!, w.id("Asha"));
    if (!u.ok) throw new Error(u.error);
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).currency).toBe("INR");
    expect(await payAmounts(w)).toEqual([800000]);
    const e = await db.expense.findUniqueOrThrow({ where: { id }, include: { shares: true } });
    expect([e.amount, e.baseCurrency, e.exchangeRate, e.shares[0].amount]).toEqual([800000, "INR", "80", 800000]);
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0]);
  });

  it("rounding only: the L19 dinner (a cent moves between shares) and a payment that moves 1 cent are allowed and not listed", async () => {
    const a = await world("g25-l19", ["A", "R", "C"]);
    await rawExpense(a, "A", "Dinner", [["A", 3334], ["R", 3333], ["C", 3333]], 1);
    await rawPayment(a, "R", "A", 3333, 1);
    await rawPayment(a, "C", "A", 3333, 2);
    const ra = await changeGroupCurrency(a.gid, a.id("A"), "USD", "0.0119");
    if (!ra.ok) throw new Error(ra.error);
    expect(await eventDetails(ra.eventId!)).toEqual(["Currency: INR → USD", "Rate used: 1 INR = 0.0119 USD", "Group total: ₹100 → $1.19"]);

    // Taxi 10,000 paid by A for R 3,334, C 3,333, D 3,333, each repaid A. At 0.0119 D's payment goes 40 -> 39 (1 cent): allowed, not listed.
    const b = await world("g25-e3", ["A", "R", "C", "D"]);
    await rawExpense(b, "A", "Taxi", [["R", 3334], ["C", 3333], ["D", 3333]], 1);
    await rawPayment(b, "R", "A", 3334, 1);
    await rawPayment(b, "C", "A", 3333, 2);
    await rawPayment(b, "D", "A", 3333, 3);
    const rb = await changeGroupCurrency(b.gid, b.id("A"), "USD", "0.0119");
    if (!rb.ok) throw new Error(rb.error);
    expect(await payAmounts(b)).toEqual([40, 40, 39]);
    expect(await eventDetails(rb.eventId!)).toEqual(["Currency: INR → USD", "Rate used: 1 INR = 0.0119 USD", "Group total: ₹100 → $1.19"]);
    expect(Object.values(await checkBooks(b.gid))).toEqual([0, 0, 0, 0]);
  });
});

// ---------- H2: the gap is spread over the rows that have room ----------
// A USD expense (entered at rate 80): `shares` are in paise and add up to 800,000 (= $100 at 80).
const usdExpense = (w: World, paidBy: string, description: string, shares: [string, number][], at: number) =>
  db.expense.create({
    data: {
      groupId: w.gid, description, amount: 800000, paidById: w.id(paidBy), createdById: w.id(paidBy), splitType: "exact", forMode: "selected", category: "other",
      originalAmount: 10000, originalCurrency: "USD", baseCurrency: "INR", exchangeRate: "80", rateSource: "manual", convertedAmount: 800000, paymentMethod: "cash",
      createdAt: new Date(2026, 1, 1, 0, 0, at), shares: { create: shares.map(([name, a]) => ({ memberId: w.id(name), amount: a })) },
    },
  });

describe("H2: keepSquareAtZero with a row limit spreads the nudge instead of piling it on the oldest shared expense", () => {
  // Dinner ₹200 (A paid, 10,000 each), Hotel $100 at 80 = 800,000 for R only (A paid), R paid A 810,000: both 0.
  // At 0.0124: Dinner 20,000 x 0.0124 = 248 (124 / 124); Hotel 10,000 (its dollars); payment 810,000 x 0.0124 = 10,044. R = -124 - 10,000 + 10,044 = -80.
  const sh = (id: string, memberId: string, amount: number) => ({ id, memberId, amount });
  const before = {
    expenses: [
      { id: "d", createdAt: 1, kind: "expense", paidById: "A", payers: "", amount: 20000, shares: [sh("s0", "A", 10000), sh("s1", "R", 10000)] },
      { id: "h", createdAt: 2, kind: "expense", paidById: "A", payers: "", amount: 800000, shares: [sh("s2", "R", 800000)] },
    ] as SquareExpense[],
    payments: [{ id: "p", createdAt: 3, fromId: "R", toId: "A", amount: 810000 }] as SquarePayment[],
  };
  const after = {
    expenses: [
      { ...before.expenses[0], amount: 248, shares: [sh("s0", "A", 124), sh("s1", "R", 124)] },
      { ...before.expenses[1], amount: 10000, shares: [sh("s2", "R", 10000)] },
    ] as SquareExpense[],
    payments: [{ ...before.payments[0], amount: 10044 }] as SquarePayment[],
  };
  const input = { members: [{ id: "A", left: false }, { id: "R", left: false }], before, after, convert: (a: number) => a };

  it("without a limit all 80 units land on the Dinner (R's share 124 -> 44, A's 124 -> 204); with it the Dinner gives its 2 and the payment carries the other 78", () => {
    const loose = keepSquareAtZero(input)!;
    expect([loose.shares.s0, loose.shares.s1, loose.payments.p]).toEqual([204, 44, 10044]);
    const spread = keepSquareAtZero(input, { rowLimit: true })!;
    // Dinner limit: 1% of 124 is 1.24, so max(2, 2) = 2: shares 126 / 122. Payment limit: 1% of 10,044 = 100.44 -> 101; it moves 78.
    expect([spread.shares.s0, spread.shares.s1, spread.shares.s2, spread.payments.p]).toEqual([126, 122, 10000, 10122]);
    expect(spread.moved).toEqual({ shares: { s0: 2, s1: -2, s2: 0 }, payments: { p: 78 } });
    // R = -122 - 10,000 + 10,122 = 0; A = (248 - 126) + 10,000 - 10,122 = 0.
    expect(spread.targets).toEqual({ A: 0, R: 0 });
  });

  it("when no row has room (R's only row is one payment, 800,000 -> 8,000, needing +2,000 against a limit of 80) the limited search gives no answer; the unlimited one moves the payment to 10,000", () => {
    const hotel: SquareExpense = { id: "h", createdAt: 1, kind: "expense", paidById: "A", payers: "", amount: 800000, shares: [sh("s2", "R", 800000)] };
    const pay: SquarePayment = { id: "p", createdAt: 2, fromId: "R", toId: "A", amount: 800000 };
    const big = {
      members: [{ id: "A", left: false }, { id: "R", left: false }],
      before: { expenses: [hotel], payments: [pay] },
      after: { expenses: [{ ...hotel, amount: 10000, shares: [sh("s2", "R", 10000)] }], payments: [{ ...pay, amount: 8000 }] },
      convert: (a: number) => a,
    };
    expect(keepSquareAtZero(big, { rowLimit: true })).toBeNull();
    expect(keepSquareAtZero(big)!.payments).toEqual({ p: 10000 });
  });

  it("through the database: allowed; Dinner 126 / 122, Hotel 10,000, payment 8,100 -> 101.22; both 0; Activity lists the payment", async () => {
    const w = await world("h2", ["Asha", "Ravi"]);
    const dinner = await rawExpense(w, "Asha", "Dinner", [["Asha", 10000], ["Ravi", 10000]], 1);
    const hotelRow = await usdExpense(w, "Asha", "Hotel", [["Ravi", 800000]], 2);
    await rawPayment(w, "Ravi", "Asha", 810000, 1);
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0]);
    const r = await changeGroupCurrency(w.gid, w.id("Asha"), "USD", "0.0124");
    if (!r.ok) throw new Error(r.error);
    const dinnerShares = Object.fromEntries((await shareRows(dinner.id)).map((s) => [s.who, s.amount]));
    expect(dinnerShares).toEqual({ Asha: 126, Ravi: 122 });
    expect((await db.expense.findUniqueOrThrow({ where: { id: dinner.id } })).amount).toBe(248);
    expect((await db.expense.findUniqueOrThrow({ where: { id: hotelRow.id } })).amount).toBe(10000);
    expect((await shareRows(hotelRow.id)).map((s) => s.amount)).toEqual([10000]);
    expect(await payAmounts(w)).toEqual([10122]);
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0]);
    expect(await eventDetails(r.eventId!)).toEqual([
      "Currency: INR → USD",
      "Rate used: 1 INR = 0.0124 USD",
      "Group total: ₹8,200 → $102.48",
      "Ravi → Asha: ₹8,100 is now $101.22 (rounded so balances stay settled).",
    ]);
    // Undo puts every row back exactly.
    const u = await undoEvent(r.eventId!, w.id("Asha"));
    if (!u.ok) throw new Error(u.error);
    expect(await payAmounts(w)).toEqual([810000]);
    expect(Object.fromEntries((await shareRows(dinner.id)).map((s) => [s.who, s.amount]))).toEqual({ Asha: 10000, Ravi: 10000 });
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0]);
  });
});

describe("G25: a share that would have to move too far is refused with its own sentence; six moved payments list five lines and 'and 1 more'", () => {
  it("Hotel $100 at 80 (Asha paid; Asha and Ravi 400,000 each) and a Cab ₹8,000 Ravi paid (400,000 each): at 0.01 Ravi would be -1,000, only the Hotel shares can carry it: refused naming Asha's share", async () => {
    const w = await world("g25-share", ["Asha", "Ravi"]);
    const hotelRow = await usdExpense(w, "Asha", "Hotel", [["Asha", 400000], ["Ravi", 400000]], 1);
    await rawExpense(w, "Ravi", "Cab", [["Asha", 400000], ["Ravi", 400000]], 2);
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0]);
    // After plain converting: Hotel 10,000 (5,000 each), Cab 800,000 x 0.01 = 8,000 (4,000 each). Asha = +10,000 - 5,000 - 4,000 = +1,000, Ravi = -1,000.
    // Rows could give 50 (Hotel, 1% of 5,000) + 40 (Cab, 1% of 4,000) = 90 only, so one share would end 1,000 away: Asha's Hotel share 5,000 -> 6,000
    // (Ravi's goes 5,000 -> 4,000: the same size, so the first person in the group is named).
    const r = await changeGroupCurrency(w.gid, w.id("Asha"), "USD", "0.01");
    expect(r).toEqual({
      ok: false,
      error: "At this rate, Asha’s share of Hotel would have to become $60 (not $50) to keep everyone settled. That’s more than rounding, usually because some expenses were entered in USD at a different rate. Nothing was changed. Check the rate.",
    });
    expect((await db.group.findUniqueOrThrow({ where: { id: w.gid } })).currency).toBe("INR");
    expect((await shareRows(hotelRow.id)).map((s) => s.amount)).toEqual([400000, 400000]);
    expect(await db.groupEvent.count({ where: { groupId: w.gid, kind: "currency_changed" } })).toBe(0);
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0]);
  });

  it("six friends each paid Asha 800,000 for their own $100 hotel; at 0.0124 each payment must go 9,920 -> 10,000 (+80, limit 100): allowed; Activity lists five, then 'and 1 more'", async () => {
    const friends = ["Ben", "Cara", "Dev", "Esha", "Farid", "Gita"];
    const w = await world("g25-six", ["Asha", ...friends]);
    for (const [i, f] of friends.entries()) {
      await usdExpense(w, "Asha", `Hotel ${f}`, [[f, 800000]], i + 1);
      await rawPayment(w, f, "Asha", 800000, i + 1);
    }
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0, 0, 0, 0, 0, 0]);
    const r = await changeGroupCurrency(w.gid, w.id("Asha"), "USD", "0.0124");
    if (!r.ok) throw new Error(r.error);
    expect(await payAmounts(w)).toEqual([10000, 10000, 10000, 10000, 10000, 10000]);
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0, 0, 0, 0, 0, 0]);
    const line = (f: string) => `${f} → Asha: ₹8,000 is now $100 (rounded so balances stay settled).`;
    expect(await eventDetails(r.eventId!)).toEqual([
      "Currency: INR → USD",
      "Rate used: 1 INR = 0.0124 USD",
      "Group total: ₹48,000 → $600",
      line("Ben"), line("Cara"), line("Dev"), line("Esha"), line("Farid"),
      "and 1 more",
    ]);
  });
});

// ---------- M1: someone joined since an "everyone" expense ----------
describe("M1: renaming an 'everyone' expense after someone joined includes them, as the form showed", () => {
  it("Dinner ₹900 for A, B, C (30,000 each); D joins; renaming gives 22,500 x 4 = 90,000 and balances add to 0", async () => {
    const w = await world("m1", ["A", "B", "C"]);
    const made = await saveExpense(post(w, { name: "Dinner", amount: "900", paidById: w.id("A"), rateMode: "auto" }), w.id("A"), lookup);
    if (!made.ok) throw new Error(made.error);
    expect((await shareRows(made.id)).map((s) => s.amount)).toEqual([30000, 30000, 30000]);
    const d = await db.member.create({ data: { groupId: w.gid, name: "D", splitWeight: 100, createdAt: new Date(2026, 0, 9) } });
    const r = await saveExpense(post(w, { expenseId: made.id, name: "Dinner at Goa", amount: "900", paidById: w.id("A"), rateMode: "auto" }), w.id("A"), lookup);
    if (!r.ok) throw new Error(r.error);
    const rows = await shareRows(made.id);
    expect(rows.map((s) => s.amount)).toEqual([22500, 22500, 22500, 22500]);
    expect(rows.some((s) => s.who === "D")).toBe(true);
    expect((await db.expense.findUniqueOrThrow({ where: { id: made.id } })).amount).toBe(90000);
    const net = await checkBooks(w.gid);
    expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
    expect([net[w.id("A")], net[d.id]]).toEqual([67500, -22500]); // A paid 90,000 and owes 22,500; D owes 22,500
  });
});

// ---------- M2: one change at a time must rebuild ----------
describe("M2: changing one thing in an edit works the money out again as posted (new rows, new numbers)", () => {
  async function plainWorld() {
    const w = await world("m2", ["A", "B", "C"]);
    const [A, B, C] = [w.id("A"), w.id("B"), w.id("C")];
    let n = 0;
    // A ₹900 dinner for everyone paid by A (30,000 each), then one edit that changes one thing.
    const edit = async (over: Partial<SaveExpenseInput>) => {
      const name = `Dinner ${++n}`;
      const made = await saveExpense(post(w, { name, amount: "900", paidById: A, rateMode: "auto" }), A, lookup);
      if (!made.ok) throw new Error(made.error);
      const before = await shareRows(made.id);
      const r = await saveExpense(post(w, { expenseId: made.id, name, amount: "900", paidById: A, rateMode: "auto", ...over }), A, lookup);
      if (!r.ok) throw new Error(r.error);
      const row = await db.expense.findUniqueOrThrow({ where: { id: made.id } });
      const rows = await shareRows(made.id);
      expect(rows.map((s) => s.id).sort()).not.toEqual(before.map((s) => s.id).sort()); // rebuilt: new rows
      expect(rows.reduce((t, s) => t + s.amount, 0)).toBe(row.amount);
      return { row, rows };
    };
    return { w, A, B, C, edit };
  }

  it("a different payer: B paid", async () => {
    const { w, B, edit } = await plainWorld();
    const { row, rows } = await edit({ paidById: w.id("B") });
    expect([row.paidById, row.amount]).toEqual([B, 90000]);
    expect(rows.map((s) => s.amount)).toEqual([30000, 30000, 30000]);
  });
  it("a different split: by amounts 500 / 250 / 150 gives 50,000 / 25,000 / 15,000", async () => {
    const { w, edit } = await plainWorld();
    const { row, rows } = await edit({ splitType: "exact", exact: { [w.id("A")]: "500", [w.id("B")]: "250", [w.id("C")]: "150" } });
    expect([row.splitType, row.amount]).toEqual(["exact", 90000]);
    expect(Object.fromEntries(rows.map((s) => [s.who, s.amount]))).toEqual({ A: 50000, B: 25000, C: 15000 });
  });
  it("different people: only A and B gives 45,000 each", async () => {
    const { w, edit } = await plainWorld();
    const { row, rows } = await edit({ forMode: "selected", selected: [w.id("A"), w.id("B")] });
    expect([row.forMode, row.amount]).toEqual(["selected", 90000]);
    expect(Object.fromEntries(rows.map((s) => [s.who, s.amount]))).toEqual({ A: 45000, B: 45000 });
  });
  it("money back: the type changes to a refund", async () => {
    const { edit } = await plainWorld();
    const { row } = await edit({ kind: "refund" });
    expect([row.kind, row.amount]).toEqual(["refund", 90000]);
  });

  // $100 on a card in a rupee group at 83.5 with a 3% group fee: 835,000 + 25,050 = 860,050 (430,025 each).
  async function cardWorld() {
    const w = await world("m2-card", ["A", "B"], 300);
    const made = await saveExpense(post(w, { name: "Dinner", amount: "100", currency: "USD", paidById: w.id("A"), paymentMethod: "card", markupChoice: "group", rateMode: "manual", manualRate: "83.5" }), w.id("A"), lookup);
    if (!made.ok) throw new Error(made.error);
    const before = await shareRows(made.id);
    expect((await db.expense.findUniqueOrThrow({ where: { id: made.id } })).amount).toBe(860050);
    const edit = async (over: Partial<SaveExpenseInput>) => {
      const r = await saveExpense(post(w, { expenseId: made.id, name: "Dinner", amount: "100", currency: "USD", paidById: w.id("A"), paymentMethod: "card", markupChoice: "group", rateMode: "keep", ...over }), w.id("A"), lookup);
      if (!r.ok) throw new Error(r.error);
      const row = await db.expense.findUniqueOrThrow({ where: { id: made.id } });
      const rows = await shareRows(made.id);
      expect(rows.map((s) => s.id).sort()).not.toEqual(before.map((s) => s.id).sort());
      expect(rows.reduce((t, s) => t + s.amount, 0)).toBe(row.amount);
      return { row, rows };
    };
    return { w, edit };
  }
  it("a different card fee: 5% of 835,000 = 41,750, total 876,750, 438,375 each", async () => {
    const { edit } = await cardWorld();
    const { row, rows } = await edit({ markupChoice: "custom", markupCustom: "5" });
    expect([row.markupBp, row.markupAmount, row.amount, row.exchangeRate]).toEqual([500, 41750, 876750, "83.5"]);
    expect(rows.map((s) => s.amount)).toEqual([438375, 438375]);
  });
  it("a different rate: 84 gives 840,000 + 3% (25,200) = 865,200, 432,600 each", async () => {
    const { edit } = await cardWorld();
    const { row, rows } = await edit({ rateMode: "manual", manualRate: "84" });
    expect([row.convertedAmount, row.markupAmount, row.amount, row.exchangeRate]).toEqual([840000, 25200, 865200, "84"]);
    expect(rows.map((s) => s.amount)).toEqual([432600, 432600]);
  });
});

// ---------- L4: a words-only edit doesn't stop a currency change being undone ----------
describe("L4: renaming an expense after a currency change doesn't block undoing the currency change", () => {
  const at = (n: number) => new Date(2026, 10, 23, 12, 0, n);
  const line = (id: string, kind: string, n: number, over: object = {}) => ({ id, kind, undo: "", undoneAt: null, expenseId: null, paymentId: null, createdAt: at(n), ...over });
  const currency = line("c", "currency_changed", 1, { undo: JSON.stringify({ type: "currency_restore", currency: "INR", expenses: [], payments: [] }) });

  it("pure: Name / Date / Category / Notes lines only: not blocked; a share, amount or unknown line, or no lines at all: still blocked", () => {
    const edited = (id: string, details: string[] | null, n = 2) => line(id, "expense_edited", n, { expenseId: "x", ...(details ? { details: JSON.stringify(details) } : {}) });
    const check = (e: ReturnType<typeof edited>) => historyCheck(currency, [currency, e]).ok;
    expect(check(edited("e1", ["Name: Dinner → Thali"]))).toBe(true);
    expect(check(edited("e2", ["Name: Dinner → Thali", "Date: 1 Nov → 2 Nov", "Category: Food → Other", "Notes: none → “x”"]))).toBe(true);
    expect(check(edited("e3", ["Name: Dinner → Thali", "Asha’s share: $1.19 → $1.20"]))).toBe(false);
    expect(check(edited("e4", ["Amount: ₹100 → ₹120"]))).toBe(false);
    expect(check(edited("e5", ["Date’s share: $1 → $2"]))).toBe(false); // a person called Date
    expect(check(edited("e6", []))).toBe(false);
    expect(check(edited("e7", null))).toBe(false);
    expect(historyCheck(currency, [currency, line("d", "expense_deleted", 2, { expenseId: "x", details: JSON.stringify(["Name: a → b"]) })]).ok).toBe(false);
  });

  it("through the database: convert (A 39, B 40, C 40), rename Dinner to Thali, then undo the currency change: shares back to 3,334 / 3,333 / 3,333, the new name stays", async () => {
    const w = await world("l4", ["A", "B", "C"]);
    const dinner = await rawExpense(w, "A", "Dinner", [["A", 3334], ["B", 3333], ["C", 3333]], 1);
    await rawPayment(w, "B", "A", 3333, 1);
    await rawPayment(w, "C", "A", 3333, 2);
    const change = await changeGroupCurrency(w.gid, w.id("A"), "USD", "0.0119");
    if (!change.ok) throw new Error(change.error);
    const saved = await db.expense.findUniqueOrThrow({ where: { id: dinner.id }, include: { shares: true } });
    const opened = initialFromExpense(saved, { groupMarkupBp: 0, groupWeights: {}, tz: "Asia/Kolkata", today: "2026-11-23" }, "edit");
    const r = await saveExpense(
      post(w, { expenseId: dinner.id, name: "Thali", amount: opened.amount, currency: opened.currency, paidById: w.id("A"), forMode: "selected", selected: opened.selected, splitType: opened.splitType, exact: opened.exact, percent: opened.percent }),
      w.id("A"),
      lookup,
    );
    if (!r.ok) throw new Error(r.error);
    expect(await eventDetails(r.eventId!)).toEqual(["Name: Dinner → Thali"]);
    const u = await undoEvent(change.eventId!, w.id("A"));
    if (!u.ok) throw new Error(u.error);
    const back = await db.expense.findUniqueOrThrow({ where: { id: dinner.id } });
    expect([back.description, back.amount]).toEqual(["Thali", 10000]);
    expect(Object.fromEntries((await shareRows(dinner.id)).map((s) => [s.who, s.amount]))).toEqual({ A: 3334, B: 3333, C: 3333 });
    expect(await payAmounts(w)).toEqual([3333, 3333]);
    expect(Object.values(await checkBooks(w.gid))).toEqual([0, 0, 0]);
  });
});
