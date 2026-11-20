import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Joining a group without an account ("a guest"): who may do what. A guest may do their own things; changing things for the whole group
// needs a sign-in. Every rule is tried three ways (guest on their own thing, guest on someone else's, a person with an account), and
// every refusal must change NOTHING: the rows, the history lines and the balances are the same afterwards.
//
// The Goa trip, worked by hand (rupees; paise in brackets). Varun (account, looks after the group), Asha (account), Ben (a guest).
//   1. Ben adds Taxi 900.00 (90000), paid by Ben, split equally: 30000 each.
//        Ben +90000 -30000 = +60000 | Varun -30000 | Asha -30000 | sum 0
//   2. Asha adds Dinner 1,200.00 (120000), paid by Asha, split equally: 40000 each.
//        Ben +60000 -40000 = +20000 | Asha -30000 +120000 -40000 = +50000 | Varun -30000 -40000 = -70000 | sum 0
//   3. Ben tries to change Dinner to 1,500.00 and is refused: still +20000 / +50000 / -70000.
//   4. Ben deletes Taxi (his own, allowed): Ben +20000 -60000 = -40000 | Asha +50000 +30000 = +80000 | Varun -70000 +30000 = -40000 | sum 0.
//      He restores it: back to +20000 / +50000 / -70000.
//   5. Settling: Ben records Varun -> Ben 20000 (he is in it, allowed): Varun -50000, Ben 0.
//      Ben tries Varun -> Asha 50000 (he is not in it): refused. Varun records Varun -> Asha 50000: Varun 0, Asha 0. Everyone ends at 0.
//   6. Shares always add up: 30000 x 3 = 90000 and 40000 x 3 = 120000.

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined),
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const rules = await import("@/lib/guest-rules");
const { saveExpense, setExpenseDeleted, setPaymentDeleted } = await import("@/lib/save-expense");
type SaveInput = import("@/lib/save-expense").SaveExpenseInput;
const { recordPaymentCore } = await import("@/lib/pay-record");
const { confirmPayment, rejectPayment, waitingForMe } = await import("@/lib/payment-ok");
const { createPayment } = await import("@/lib/payments");
const { markAsMoveOut } = await import("./helpers/move-out-marks");
const { undoEvent, actorRefusal } = await import("@/lib/undo");
const { netBalances } = await import("@/lib/balances");
const { publicName } = await import("@/lib/names");
const { releaseGuestName } = await import("@/lib/join");
const { getMemberships } = await import("@/lib/identity");
const { encodeSession, today } = await import("@/lib/session");

const { GUEST_REFUSAL, SIGNIN_BODY, SIGNIN_TITLE } = rules;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;

afterAll(async () => {
  state.cookie = "";
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a.id;
}

// Varun looks after the group (first in, with an account), Asha has an account, Ben has none (a guest).
async function goa() {
  const [va, aa] = [await account("Varun"), await account("Asha")];
  const g = await db.group.create({
    data: {
      name: `Goa ${n} ${stamp}`, inviteCode: `gr-${++n}-${stamp}`, type: "trip", currency: "INR",
      members: {
        create: [
          { name: "Varun", accountId: va, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) },
          { name: "Asha", accountId: aa, claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2) },
          { name: "Ben", claimedAt: new Date(2026, 0, 3), createdAt: new Date(2026, 0, 3), seenAt: new Date(2026, 0, 3) },
        ],
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (name: string) => g.members.find((m) => m.name === name)!.id;
  return { g, V: id("Varun"), A: id("Asha"), B: id("Ben") };
}
type Goa = Awaited<ReturnType<typeof goa>>;

const noRate = async () => ({ ok: false, reason: "unavailable", message: "no rate needed" }) as never;
const draft = (f: Goa, name: string, amount: string, paidById: string, expenseId?: string): SaveInput => ({
  groupId: f.g.id, expenseId, name, category: "", amount, currency: "INR", paidById, forMode: "everyone", selected: [], onePersonId: "",
  splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "",
});
const add = async (f: Goa, by: string, name: string, amount: string, paidBy = by) => {
  const r = await saveExpense(draft(f, name, amount, paidBy), by, noRate, { guestRules: true });
  if (!r.ok) throw new Error(r.error);
  return r.id;
};
const bal = async (f: Goa) => {
  const g = await db.group.findUniqueOrThrow({ where: { id: f.g.id }, include: { members: true, expenses: { include: { shares: true } }, payments: true } });
  const b = netBalances(g.members.map((m) => m.id), g.expenses.filter((e) => !e.deletedAt), g.payments.filter((p) => !p.deletedAt));
  return { Varun: b[f.V], Asha: b[f.A], Ben: b[f.B] };
};
// Everything a refusal must leave alone: the expense and payment rows (amount, deleted, last edit), the history lines, the balances.
const snapshot = async (f: Goa) => ({
  expenses: (await db.expense.findMany({ where: { groupId: f.g.id }, orderBy: { id: "asc" }, select: { id: true, amount: true, deletedAt: true, editedAt: true, description: true } })).map((e) => ({ ...e, deletedAt: e.deletedAt?.getTime() ?? null, editedAt: e.editedAt?.getTime() ?? null })),
  payments: (await db.payment.findMany({ where: { groupId: f.g.id }, orderBy: { id: "asc" }, select: { id: true, amount: true, deletedAt: true } })).map((p) => ({ ...p, deletedAt: p.deletedAt?.getTime() ?? null })),
  events: await db.groupEvent.count({ where: { groupId: f.g.id } }),
  balances: await bal(f),
});
const pay = (f: Goa, by: string, from: string, to: string, amount: number) =>
  recordPaymentCore({ groupId: f.g.id, fromId: from, toId: to, amount, currency: "INR", myId: by, fp: `fp-${from}-${to}-${amount}-${++n}`, warnOver: false, guestRules: true });

describe("the refusal sentences", () => {
  it("the general line is exactly the founder's words, and the expense line names the person", () => {
    expect(SIGNIN_TITLE).toBe("Sign in to do this");
    expect(SIGNIN_BODY).toBe("Changing things for the whole group needs a sign-in, so everyone can see who changed what. Your own expenses you can change any time.");
    expect(GUEST_REFUSAL).toBe(`${SIGNIN_TITLE}. ${SIGNIN_BODY}`);
    expect(rules.expenseTitle("Asha")).toBe("Sign in to change Asha’s expense");
    expect(rules.signinWords("expense:Asha")).toEqual({ title: "Sign in to change Asha’s expense", body: SIGNIN_BODY });
    expect(rules.signinWords("general")).toEqual({ title: SIGNIN_TITLE, body: SIGNIN_BODY });
    expect(rules.signinWords("anything else")).toEqual({ title: SIGNIN_TITLE, body: SIGNIN_BODY });
  });
  it("a refusal turns into the code the sheet reads, and back; other errors are not sign-in refusals", () => {
    expect(rules.signinKeyOf(GUEST_REFUSAL)).toBe("general");
    expect(rules.signinKeyOf(rules.expenseRefusal("Asha K."))).toBe("expense:Asha K.");
    expect(rules.signinKeyOf("Type a name.")).toBeNull();
    expect(rules.signinKeyOf(undefined)).toBeNull();
    expect(rules.refusalNotes(GUEST_REFUSAL)).toEqual({ error: GUEST_REFUSAL, signin: "general" });
    expect(rules.refusalNotes("Type a name.")).toEqual({ error: "Type a name." });
  });
  it("the public name list: first name and the first letter of the surname; one word as it is", () => {
    expect(publicName("Asha Kumar")).toBe("Asha K.");
    expect(publicName("  rahul   sharma  ")).toBe("rahul S.");
    expect(publicName("Mary Ann van der Berg")).toBe("Mary B.");
    expect(publicName("Ben")).toBe("Ben");
    expect(publicName("")).toBe("");
  });
});

describe("the pure rules, row by row: guest on their own, guest on another's, a person with an account", () => {
  const took = new Date(2026, 5, 10); // Ben took his name on 10 June
  const before = new Date(2026, 5, 1); // an item from before that: the earlier holder's
  const after = new Date(2026, 5, 20);
  it("changing an expense: own (createdById is the person, not paidById) and added after he took the name", () => {
    expect(rules.expenseEditRefusal(true, "ben", { createdById: "ben", createdAt: after }, undefined, took)).toBeNull(); // guest-own
    expect(rules.expenseEditRefusal(true, "ben", { createdById: "ben", createdAt: took }, undefined, took)).toBeNull(); // the very moment: still his
    expect(rules.expenseEditRefusal(true, "ben", { createdById: "asha", createdAt: after }, "Asha", took)).toBe(rules.expenseRefusal("Asha")); // guest-other
    expect(rules.expenseEditRefusal(false, "varun", { createdById: "asha", createdAt: before }, "Asha", null)).toBeNull(); // account
    expect(rules.expenseEditRefusal(true, "ben", { createdById: "", createdAt: after }, undefined, took)).toBe(GUEST_REFUSAL); // an older row has no owner: not own
    expect(rules.expenseEditRefusal(true, "ben", { createdById: "asha", createdAt: after }, undefined, took)).toBe(GUEST_REFUSAL); // owner's name unknown: the general line
  });
  it("a freed-then-retaken name: the earlier holder's expense is not the new holder's (the first name is still shown)", () => {
    // Ben added Taxi on 1 June; his name was freed and someone took "Ben" on 10 June.
    expect(rules.expenseEditRefusal(true, "ben", { createdById: "ben", createdAt: before }, "Ben", took)).toBe(rules.expenseRefusal("Ben"));
    expect(rules.expenseEditRefusal(true, "ben", { createdById: "ben", createdAt: before }, "Ben", null)).toBe(rules.expenseRefusal("Ben")); // no claim time known: not theirs
    expect(rules.expenseEditRefusal(true, "ben", { createdById: "ben", createdAt: before }, "Ben", undefined)).toBe(rules.expenseRefusal("Ben"));
  });
  it("deleting or restoring a payment: a party to it, recorded after he took the name", () => {
    const pay = (createdAt: Date) => ({ fromId: "ben", toId: "asha", createdAt });
    expect(rules.paymentChangeRefusal(true, "ben", pay(after), took)).toBeNull();
    expect(rules.paymentChangeRefusal(true, "ben", pay(before), took)).toBe(GUEST_REFUSAL); // the earlier holder's payment
    expect(rules.paymentChangeRefusal(true, "ben", pay(after), null)).toBe(GUEST_REFUSAL);
    expect(rules.paymentChangeRefusal(true, "ben", { fromId: "varun", toId: "asha", createdAt: after }, took)).toBe(GUEST_REFUSAL); // not in it
    expect(rules.paymentChangeRefusal(false, "varun", pay(before), null)).toBeNull(); // an account: the usual rule applies elsewhere
  });
  it("recording a payment: the guest must be the payer or the person paid", () => {
    expect(rules.paymentPartyRefusal(true, "ben", "ben", "asha")).toBeNull();
    expect(rules.paymentPartyRefusal(true, "ben", "varun", "ben")).toBeNull();
    expect(rules.paymentPartyRefusal(true, "ben", "varun", "asha")).toBe(GUEST_REFUSAL);
    expect(rules.paymentPartyRefusal(false, "varun", "asha", "ben")).toBeNull();
  });
  it("renaming and leaving: your own is yours, someone else's needs an account", () => {
    expect(rules.renameRefusal(true, "ben", "ben")).toBeNull();
    expect(rules.renameRefusal(true, "ben", "asha")).toBe(GUEST_REFUSAL);
    expect(rules.renameRefusal(false, "varun", "asha")).toBeNull();
  });
  it("card game buy-in and cash-out: only for yourself", () => {
    expect(rules.ownPlayerRefusal(true, "ben", ["ben"])).toBeNull();
    expect(rules.ownPlayerRefusal(true, "ben", ["ben", "asha"])).toBe(GUEST_REFUSAL);
    expect(rules.ownPlayerRefusal(true, "ben", ["asha"])).toBe(GUEST_REFUSAL);
    expect(rules.ownPlayerRefusal(true, "ben", [])).toBe(GUEST_REFUSAL);
    expect(rules.ownPlayerRefusal(false, "varun", ["asha", "ben"])).toBeNull();
  });
  it("undo: a guest undoes only their own lines, written after he took the name", () => {
    expect(rules.undoRefusal(true, "ben", "ben", after, took)).toBeNull();
    expect(rules.undoRefusal(true, "ben", "ben", before, took)).toBe(GUEST_REFUSAL); // a freed-then-retaken name: the earlier holder's line
    expect(rules.undoRefusal(true, "ben", "ben", after, null)).toBe(GUEST_REFUSAL);
    expect(rules.undoRefusal(true, "ben", "asha", after, took)).toBe(GUEST_REFUSAL);
    expect(rules.undoRefusal(true, "ben", undefined, after, took)).toBe(GUEST_REFUSAL);
    expect(rules.undoRefusal(false, "varun", "asha")).toBeNull();
  });
  it("actorRefusal (what the screen asks) gives the same answer as the server for a guest", () => {
    const ev = { id: "e1", kind: "expense_added", undo: "", undoneAt: null, expenseId: "x", paymentId: null, createdAt: after, actorId: "asha" };
    const viewer = { id: "ben", isAdmin: false, closed: false, members: [], guest: true, claimedAt: took };
    expect(actorRefusal(ev, viewer, new Date())).toBe(GUEST_REFUSAL);
    expect(actorRefusal({ ...ev, actorId: "ben" }, viewer, new Date())).toBeNull();
    expect(actorRefusal({ ...ev, actorId: "ben", createdAt: before }, viewer, new Date())).toBe(GUEST_REFUSAL); // written before he took the name
    expect(actorRefusal(ev, { ...viewer, guest: false }, new Date())).toBeNull();
  });
});

describe("the Goa trip, with the rules switched on", () => {
  it("1-6: balances worked by hand, every refusal changes nothing", async () => {
    const f = await goa();
    // 1. Ben adds Taxi 900.00, paid by Ben.
    const taxi = await add(f, f.B, "Taxi", "900");
    expect(await bal(f)).toEqual({ Ben: 60000, Varun: -30000, Asha: -30000 });
    // 2. Asha adds Dinner 1,200.00, paid by Asha.
    const dinner = await add(f, f.A, "Dinner", "1200");
    expect(await bal(f)).toEqual({ Ben: 20000, Asha: 50000, Varun: -70000 });
    // 6. Shares add up to the amount.
    const shares = async (id: string) => (await db.expenseShare.findMany({ where: { expenseId: id } })).map((s) => s.amount);
    expect(await shares(taxi)).toEqual([30000, 30000, 30000]);
    expect(await shares(dinner)).toEqual([40000, 40000, 40000]);

    // 3. Ben tries to change Dinner to 1,500.00: refused with the sentence naming Asha, nothing changes.
    const before = await snapshot(f);
    const edit = await saveExpense(draft(f, "Dinner", "1500", f.A, dinner), f.B, noRate, { guestRules: true });
    expect(edit).toEqual({ ok: false, error: "Sign in to change Asha’s expense. " + SIGNIN_BODY });
    expect(await snapshot(f)).toEqual(before);
    expect(await bal(f)).toEqual({ Ben: 20000, Asha: 50000, Varun: -70000 });
    // ...and he can't delete it either.
    expect(await setExpenseDeleted(dinner, f.B, true, { guestRules: true })).toEqual({ ok: false, error: rules.expenseRefusal("Asha") });
    expect(await snapshot(f)).toEqual(before);

    // 4. Ben deletes Taxi (his own) and restores it.
    expect((await setExpenseDeleted(taxi, f.B, true, { guestRules: true })).ok).toBe(true);
    expect(await bal(f)).toEqual({ Ben: -40000, Asha: 80000, Varun: -40000 });
    expect((await setExpenseDeleted(taxi, f.B, false, { guestRules: true })).ok).toBe(true);
    expect(await bal(f)).toEqual({ Ben: 20000, Asha: 50000, Varun: -70000 });

    // 5. Settle up. Ben records Varun -> Ben 20000 (he is in it).
    expect(await pay(f, f.B, f.V, f.B, 20000)).toMatchObject({ kind: "done" });
    expect(await bal(f)).toEqual({ Ben: 0, Asha: 50000, Varun: -50000 });
    // Ben tries Varun -> Asha 50000 (he is not in it): refused, nothing changes.
    const mid = await snapshot(f);
    expect(await pay(f, f.B, f.V, f.A, 50000)).toEqual({ kind: "refused", error: GUEST_REFUSAL });
    expect(await snapshot(f)).toEqual(mid);
    // Varun (an account) records it.
    expect(await pay(f, f.V, f.V, f.A, 50000)).toMatchObject({ kind: "done" });
    expect(await bal(f)).toEqual({ Ben: 0, Asha: 0, Varun: 0 });
  });

  it("a person with an account changes anyone's expense, as before", async () => {
    const f = await goa();
    const taxi = await add(f, f.B, "Taxi", "900");
    const r = await saveExpense(draft(f, "Taxi", "600", f.B, taxi), f.V, noRate, { guestRules: true });
    expect(r.ok).toBe(true);
    expect(await bal(f)).toEqual({ Ben: 40000, Varun: -20000, Asha: -20000 });
    expect((await setExpenseDeleted(taxi, f.A, true, { guestRules: true })).ok).toBe(true);
  });

  it("the guest's own edit works (guest-own), and calling without the switch keeps the old behaviour for scripts and tests", async () => {
    const f = await goa();
    const taxi = await add(f, f.B, "Taxi", "900");
    expect((await saveExpense(draft(f, "Taxi", "600", f.B, taxi), f.B, noRate, { guestRules: true })).ok).toBe(true);
    const dinner = await add(f, f.A, "Dinner", "1200");
    expect((await saveExpense(draft(f, "Dinner", "900", f.A, dinner), f.B, noRate)).ok).toBe(true); // no guestRules: the lib alone is unchanged
  });

  it("an older expense with no owner is not the guest's (createdById empty)", async () => {
    const f = await goa();
    const old = await db.expense.create({ data: { groupId: f.g.id, description: "Old", amount: 30000, originalAmount: 30000, convertedAmount: 30000, splitType: "equal", forMode: "everyone", paidById: f.B, createdById: "", shares: { create: [f.V, f.A, f.B].map((memberId) => ({ memberId, amount: 10000 })) } } });
    const before = await snapshot(f);
    expect(await setExpenseDeleted(old.id, f.B, true, { guestRules: true })).toEqual({ ok: false, error: GUEST_REFUSAL });
    expect(await snapshot(f)).toEqual(before);
  });

  it("undo: guest-own works, guest-other is refused and changes nothing, an account may undo", async () => {
    const f = await goa();
    const taxi = await add(f, f.B, "Taxi", "900");
    const dinner = await add(f, f.A, "Dinner", "1200");
    const lineOf = async (expenseId: string) => (await db.groupEvent.findFirstOrThrow({ where: { expenseId, kind: "expense_added" } })).id;
    const before = await snapshot(f);
    expect(await undoEvent(await lineOf(dinner), f.B, "Asia/Kolkata", { guestRules: true })).toEqual({ ok: false, error: GUEST_REFUSAL });
    expect(await snapshot(f)).toEqual(before);
    expect((await undoEvent(await lineOf(taxi), f.B, "Asia/Kolkata", { guestRules: true })).ok).toBe(true); // his own line: Taxi goes
    expect((await db.expense.findUniqueOrThrow({ where: { id: taxi } })).deletedAt).not.toBeNull();
    expect((await undoEvent(await lineOf(dinner), f.V, "Asia/Kolkata", { guestRules: true })).ok).toBe(true); // an account, anyone's line
    expect((await db.expense.findUniqueOrThrow({ where: { id: dinner } })).deletedAt).not.toBeNull();
  });
});

describe("a freed-then-retaken name does not inherit what the earlier holder added", () => {
  const wait = () => new Promise((r) => setTimeout(r, 25));
  it("Ben adds Taxi and takes part in a payment; his name is freed and retaken: the new holder can't edit, delete, undo or remove them, but their own new things work", async () => {
    const f = await goa();
    const taxi = await add(f, f.B, "Taxi", "900");
    expect(await pay(f, f.B, f.V, f.B, 20000)).toMatchObject({ kind: "done" });
    const payment = await db.payment.findFirstOrThrow({ where: { groupId: f.g.id } });
    const taxiLine = (await db.groupEvent.findFirstOrThrow({ where: { expenseId: taxi, kind: "expense_added" } })).id;

    // The name is freed and someone else takes "Ben": claimedAt is now later than everything Ben added.
    await wait();
    await db.member.update({ where: { id: f.B }, data: { claimedAt: new Date() } });
    await wait();

    const before = await snapshot(f);
    expect(await saveExpense(draft(f, "Taxi", "600", f.B, taxi), f.B, noRate, { guestRules: true })).toEqual({ ok: false, error: rules.expenseRefusal("Ben") });
    expect(await setExpenseDeleted(taxi, f.B, true, { guestRules: true })).toEqual({ ok: false, error: rules.expenseRefusal("Ben") });
    expect(await undoEvent(taxiLine, f.B, "Asia/Kolkata", { guestRules: true })).toEqual({ ok: false, error: GUEST_REFUSAL });
    expect(await setPaymentDeleted(payment.id, f.B, true, { guestRules: true })).toEqual({ ok: false, error: GUEST_REFUSAL });
    expect(await snapshot(f)).toEqual(before); // nothing changed

    // A payment recorded after he took the name is his: he can delete and restore it. Recording a new one is allowed too.
    expect(await pay(f, f.B, f.B, f.V, 5000)).toMatchObject({ kind: "done" });
    const mine = await db.payment.findFirstOrThrow({ where: { groupId: f.g.id, id: { not: payment.id } } });
    expect((await setPaymentDeleted(mine.id, f.B, true, { guestRules: true })).ok).toBe(true);
    expect((await setPaymentDeleted(mine.id, f.B, false, { guestRules: true })).ok).toBe(true);
    const newer = await add(f, f.B, "Lunch", "300");
    expect((await saveExpense(draft(f, "Lunch", "450", f.B, newer), f.B, noRate, { guestRules: true })).ok).toBe(true);
    expect((await setExpenseDeleted(newer, f.B, true, { guestRules: true })).ok).toBe(true);

    // Someone with an account still changes anything, as before.
    expect((await setExpenseDeleted(taxi, f.V, true, { guestRules: true })).ok).toBe(true);
    // The old payment is still removable by the OTHER person in it (Varun has an account).
    expect((await setPaymentDeleted(payment.id, f.V, true, { guestRules: true })).ok).toBe(true);
  });
});

describe("Got it / Not received on a move-out payment to a guest", () => {
  const wait = () => new Promise((r) => setTimeout(r, 25));
  // Varun moves out; his final payment to Ben (20000 = 200.00 rupees) waits for Ben's answer.
  async function moveOutTo(f: Goa) {
    const pay = await db.$transaction((tx) => createPayment(tx, { groupId: f.g.id, fromId: f.V, toId: f.B, amount: 20000, createdById: f.A, asksReceiver: true }));
    await markAsMoveOut(f.g.id, f.A, [pay.id]);
    return pay;
  }
  it("the name is freed and retaken after the payment: the new holder can neither say Not received nor Got it, and does not see it waiting; nothing changes", async () => {
    const f = await goa();
    const pay = await moveOutTo(f);
    await wait();
    await db.member.update({ where: { id: f.B }, data: { claimedAt: new Date() } });
    const before = await snapshot(f);
    expect(await rejectPayment(pay.id, f.B)).toEqual({ ok: false, error: GUEST_REFUSAL });
    expect(await confirmPayment(pay.id, f.B)).toEqual({ ok: false, error: GUEST_REFUSAL });
    expect(await waitingForMe(f.g.id, f.B)).toEqual([]);
    expect(await snapshot(f)).toEqual(before);
    expect((await db.payment.findUniqueOrThrow({ where: { id: pay.id } })).okAt).toBeNull();
  });
  it("a payment made after the guest took the name still works for them: listed, Got it counts, Not received takes it off", async () => {
    const f = await goa();
    const one = await moveOutTo(f);
    const two = await moveOutTo(f);
    expect((await waitingForMe(f.g.id, f.B)).map((p) => p.id).sort()).toEqual([one.id, two.id].sort());
    expect((await confirmPayment(one.id, f.B)).ok).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: one.id } })).okAt).not.toBeNull();
    expect((await rejectPayment(two.id, f.B)).ok).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: two.id } })).deletedAt).not.toBeNull();
  });
  it("a person with an account is unchanged, and both actions pass refusals through refusalNotes", () => {
    const src = readFileSync("src/app/pay-actions.ts", "utf8");
    for (const name of ["confirmPaymentAction", "rejectPaymentAction"]) {
      const at = src.indexOf(`export async function ${name}`);
      expect(src.slice(at, src.indexOf("\n}\n", at))).toContain("refusalNotes(r.error)");
    }
  });
});

describe("who counts as a guest", () => {
  it("gateGuest: a guest is refused, an account is not, and a stranger id is left to the other checks", async () => {
    const f = await goa();
    expect(await rules.gateGuest(f.B)).toBe(GUEST_REFUSAL);
    expect(await rules.gateGuest(f.A)).toBeNull();
    expect(await rules.gateGuest(f.V)).toBeNull();
    expect(await rules.gateGuest(undefined)).toBeNull();
    expect(await rules.gateGuest("no-such-member")).toBeNull();
    expect(await rules.isGuestMember(f.B)).toBe(true);
  });
});

describe("free this name", () => {
  const holdsOnPhone = async (f: Goa, memberId: string, epoch: number) => {
    state.cookie = await encodeSession({ m: { [f.g.id]: `${memberId}~${epoch}` }, t: today() });
    return (await getMemberships())[f.g.id];
  };

  it("the admin frees Ben's name: epoch up, claimedAt empty, push rows gone, old phone refused, balances the same, a history line", async () => {
    const f = await goa();
    await add(f, f.B, "Taxi", "900");
    await db.pushSubscription.create({ data: { memberId: f.B, endpoint: `https://push.test/${stamp}-${n}`, p256dh: "k", auth: "a" } });
    const epoch = (await db.member.findUniqueOrThrow({ where: { id: f.B } })).grantEpoch;
    expect(await holdsOnPhone(f, f.B, epoch)).toBe(f.B);
    const balances = await bal(f);
    const events = await db.groupEvent.count({ where: { groupId: f.g.id } });

    const r = await releaseGuestName(f.g.id, f.V, f.B);
    expect(r.ok).toBe(true);
    const after = await db.member.findUniqueOrThrow({ where: { id: f.B } });
    expect(after.claimedAt).toBeNull();
    expect(after.accountId).toBeNull();
    expect(after.grantEpoch).toBe(epoch + 1);
    expect(await db.pushSubscription.count({ where: { memberId: f.B } })).toBe(0);
    expect(await holdsOnPhone(f, f.B, epoch)).toBeUndefined(); // the old phone is told it is not in the group (the page sends it to /private)
    expect(await bal(f)).toEqual(balances); // the row and its expenses stay
    expect(await db.groupEvent.count({ where: { groupId: f.g.id } })).toBe(events + 1);
    expect(await db.expense.count({ where: { groupId: f.g.id, createdById: f.B } })).toBe(1);
    // The name is on the join page's list again: no account, never claimed, still in the group.
    expect(after.leftAt).toBeNull();
    expect(after.removedAt).toBeNull();
    // Freeing it twice does nothing the second time.
    expect(await releaseGuestName(f.g.id, f.V, f.B)).toEqual({ ok: false, error: "That name isn’t held by someone without an account." });
  });

  it("the guest frees their own name (Not me)", async () => {
    const f = await goa();
    expect((await releaseGuestName(f.g.id, f.B, f.B)).ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: f.B } })).claimedAt).toBeNull();
  });

  it("an account that does not look after the group cannot free someone else's name; a guest admin cannot either; an account's own name is never freed", async () => {
    const f = await goa();
    const before = await db.member.findUniqueOrThrow({ where: { id: f.B } });
    expect((await releaseGuestName(f.g.id, f.A, f.B)).ok).toBe(false); // Asha has an account but Varun looks after the group
    expect((await releaseGuestName(f.g.id, f.V, f.A)).ok).toBe(false); // Asha holds an account: not a guest name
    expect(await db.member.findUniqueOrThrow({ where: { id: f.B } })).toEqual(before);
    // If the group's admin is a guest, they need an account to do it for someone else.
    const g2 = await db.group.create({ data: { name: `Guest admin ${stamp}-${++n}`, inviteCode: `ga-${n}-${stamp}`, members: { create: [{ name: "Gil", claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, { name: "Gus", claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2) }] } }, include: { members: true } });
    groupIds.push(g2.id);
    const [gil, gus] = [g2.members.find((m) => m.name === "Gil")!.id, g2.members.find((m) => m.name === "Gus")!.id];
    expect(await releaseGuestName(g2.id, gil, gus)).toEqual({ ok: false, error: GUEST_REFUSAL });
    expect((await db.member.findUniqueOrThrow({ where: { id: gus } })).claimedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Every exported server action is in the rules file, and the ones that need a gate really have one.
describe("the scan: every server action and route is in guest-rules.ts", () => {
  const walk = (dir: string, out: string[] = []) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name)) out.push(p);
    }
    return out;
  };
  const serverFiles = walk("src").filter((f) => /^["']use server["'];?\s*$/m.test(readFileSync(f, "utf8")));
  const bodyOf = (src: string, name: string) => {
    const start = src.search(new RegExp(`(^|\\n)(export )?async function ${name}\\b`));
    if (start < 0) return "";
    const rest = src.slice(start + 10);
    const next = rest.search(/\n(export )?(async )?function |\nexport (async )?function |\nasync function /);
    return next < 0 ? src.slice(start) : src.slice(start, start + 10 + next);
  };
  const exported: { name: string; file: string }[] = [];
  for (const f of serverFiles) for (const m of readFileSync(f, "utf8").matchAll(/^export (?:async )?function (\w+)/gm)) exported.push({ name: m[1], file: f });

  it("found the server action files", () => {
    expect(serverFiles.length).toBeGreaterThanOrEqual(15);
    expect(exported.length).toBeGreaterThanOrEqual(100);
  });
  it("every exported server action has a rule, and no rule is for an action that is gone", () => {
    const missing = exported.filter((e) => !(e.name in rules.ACTION_RULES)).map((e) => `${e.name} (${e.file})`);
    expect(missing, `add these to ACTION_RULES in src/lib/guest-rules.ts: ${missing.join(", ")}`).toEqual([]);
    const names = new Set(exported.map((e) => e.name));
    expect(Object.keys(rules.ACTION_RULES).filter((k) => !names.has(k))).toEqual([]);
  });
  it("action names are unique across files (a rule is by name)", () => {
    const seen = new Map<string, string>();
    const dup: string[] = [];
    for (const e of exported) {
      if (seen.has(e.name)) dup.push(e.name);
      seen.set(e.name, e.file);
    }
    expect(dup).toEqual([]);
  });
  it("every action that needs an account, or is own-only, has its gate in its own code (or the helper it goes through)", () => {
    const bad: string[] = [];
    for (const e of exported) {
      const r = rules.ACTION_RULES[e.name];
      if (!r || (r.rule !== "acct" && r.rule !== "own")) continue;
      const src = readFileSync(e.file, "utf8");
      const body = bodyOf(src, e.name);
      if (r.marks?.length) {
        if (!r.marks.some((m) => body.includes(m))) bad.push(`${e.name}: none of ${r.marks.join(", ")} in its code`);
      } else if (r.via) {
        const helper = bodyOf(src, r.via);
        if (!body.includes(`${r.via}(`)) bad.push(`${e.name}: does not call ${r.via}`);
        else if (!rules.GATE_MARKS.some((m) => helper.includes(m))) bad.push(`${e.name}: ${r.via} has no gate`);
      } else bad.push(`${e.name}: needs marks or via in ACTION_RULES`);
    }
    expect(bad).toEqual([]);
  });
  it("the routes that change data have a rule and (when needed) a gate", () => {
    for (const [file, r] of Object.entries(rules.ROUTE_RULES)) {
      const src = readFileSync(file, "utf8");
      expect(src, file).toContain("export async function POST");
      if (r.rule === "acct") expect(r.marks!.some((m) => src.includes(m)), file).toBe(true);
    }
    // Every route file with a POST is listed.
    const posts = walk("src/app/api").filter((f) => /export async function POST/.test(readFileSync(f, "utf8"))).map((f) => f.replace(/\\/g, "/"));
    const unlisted = posts.filter((f) => !(f in rules.ROUTE_RULES) && !/(auth|passkey|cron|unsubscribe|speed|arrive|my-data)/.test(f));
    expect(unlisted, `add these routes to ROUTE_RULES: ${unlisted.join(", ")}`).toEqual([]);
  });
  it("the pages and actions pass the switch: the live expense, undo and payment actions run with guestRules on", () => {
    const actions = readFileSync("src/app/actions.ts", "utf8");
    expect(bodyOf(actions, "addExpense")).toContain("guestRules: true");
    expect(bodyOf(actions, "toggleExpense")).toContain("guestRules: true");
    expect(bodyOf(actions, "undoChange")).toContain("guestRules: true");
    expect(bodyOf(actions, "recordCustomPayment")).toContain("guestRules: true");
  });
  it("deleteMomentAction: the gate's RESULT, not just the word: a guest who looks after the group cannot remove someone else's moment", async () => {
    const { canDeleteMoment } = await import("@/lib/moments-access");
    const viewer = (accountId: string | null) => ({ groupId: "g", groupType: "trip" as const, groupDeleted: false, memberId: "m1", accountId, leftAt: null, removedAt: null, pending: false, isAdmin: true, blocked: new Set<string>() });
    const theirs = { groupId: "g", authorId: "m2", authorAccountId: "acc2", createdAt: new Date() };
    expect(canDeleteMoment(viewer(null), theirs)).toBe(false);
    expect(canDeleteMoment(viewer("acc1"), theirs)).toBe(true);
  });
  it("Smart Settle across groups: every part must include the person (so a guest only settles their own)", () => {
    expect(readFileSync("src/lib/cross-settle-db.ts", "utf8")).toContain("if (!(p.fromId === myId || p.toId === myId)) return \"changed\";");
  });
});
