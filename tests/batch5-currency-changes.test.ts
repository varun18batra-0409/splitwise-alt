import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { changeGroupCurrency, squareLimit } from "@/lib/group-changes";
import { REVERT_CLASH, restoreCurrency, undoEvent } from "@/lib/undo";
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
      "Ravi → Asha: ₹8,000 is now $100 (rounded to keep Ravi settled).",
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
