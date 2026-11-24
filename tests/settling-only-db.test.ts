import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { SaveExpenseInput } from "@/lib/save-expense";

// "Settling up only", on the throwaway database. Every number is worked by hand (paise). After every step checkBooks runs: each expense's shares add up
// to its amount, the balances add up to 0, and everyone who has left is at exactly 0.
//
// The story (A, B, C all with accounts; A pays the rent, B pays the milk):
//   Rent 1,800,000 a month (A pays), equal. October groceries 1,200,000 (A pays), equal. Milk 6,000 a day (B pays), equal.
//   Start of Nov (Nov rent in, groceries in): A +2,000,000, B -1,000,000, C -1,000,000.
//   C moves out 10 Nov (B marks it, "add it now" for the milk):
//     Nov rent: C keeps floor(600,000 x 10 / 30) = 200,000; 400,000 is freed, 200,000 each to A and B (shares A 800,000, B 800,000, C 200,000).
//     Milk 1-10 Nov: 10 x 6,000 / 3 = 20,000, charged to C and credited to B.
//     A +1,800,000, B -1,180,000, C -620,000. C pays A 620,000: A +1,180,000, B -1,180,000, C 0.
//   22 Nov A says "Not received": A +1,800,000, B -1,180,000, C -620,000, and C is settling up only (last day 10 Nov).
//   1 Dec runs: Nov milk 30 x 6,000 = 180,000 less C's 20,000 = 160,000 -> A 80,000, B 80,000 (B paid): A +1,720,000, B -1,100,000, C -620,000.
//           Dec rent 1,800,000 (A pays) -> A 900,000, B 900,000 (C is left out): A +2,620,000, B -2,000,000, C -620,000.
//   Dinner 300,000 "everyone" (B pays) -> A 150,000, B 150,000: A +2,470,000, B -1,850,000, C -620,000.
//   1 Jan run: Dec milk 31 x 6,000 = 186,000 (B pays) -> A 93,000, B 93,000: A +2,377,000, B -1,757,000, C -620,000.
//   B pays A 1,757,000; C pays A 620,000: everyone 0, and C is moved out again with last day 10 Nov.

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": "10.98.1.1" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  RedirectType: { replace: "replace", push: "push" },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { moveOut } = await import("@/lib/home/moving-db");
const { moveBackInFor } = await import("@/lib/home/moving-db");
const { runBillsForGroup, billStatuses } = await import("@/lib/home/bills-db");
const { billCommand } = await import("@/lib/home/bill-setup");
const { saveBudgetsFor } = await import("@/lib/home/budgets-db");
const { monthInsights } = await import("@/lib/home/insights-db");
const { rejectPayment } = await import("@/lib/payment-ok");
const { recordPaymentCore } = await import("@/lib/pay-record");
const { saveExpense, setExpenseDeleted, setPaymentDeleted } = await import("@/lib/save-expense");
const { settlingHeld, settlingIn, settlingSelfRefusal } = await import("@/lib/settling-db");
const { squareSettlersNow } = await import("@/lib/settling-run");
const { loadNeedsYou } = await import("@/lib/needs-you");
const { SETTLING_SELF, SETTLING_SELF_MOVED_BACK, settlingNamed, settlingNoManualMoveOut } = await import("@/lib/settling");
const { moveOutPreview } = await import("@/lib/home/moving-db");
const { bringBackLeavers } = await import("@/lib/payment-change");
const { undoEvent } = await import("@/lib/undo");
const { confirmPayment, waitingForMe } = await import("@/lib/payment-ok");
const { setMemberLeft } = await import("@/lib/people");
const { changeGroupCurrency, updateGroupBasics } = await import("@/lib/group-changes");
const { saveDepositFor } = await import("@/lib/home/moving-db");
const { saveGoalFor } = await import("@/lib/home/goals-db");
const { loadMyGroupsLight } = await import("@/lib/group-data");
const { checkBooks } = await import("./helpers/money-invariants");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;
afterAll(async () => {
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});
const at = (day: string) => new Date(`${day}T06:00:00Z`); // 11:30 in India that day
const key = () => `so-${stamp}-${++n}-abcdefgh`;
const LAST = "2026-11-10T12:00:00.000Z";
const rate1 = async () => ({ ok: true as const, rate: "1", date: "2026-11-16" });
const shareMap = (e: { shares: { memberId: string; amount: number }[] }) => Object.fromEntries(e.shares.map((s) => [s.memberId, s.amount]));

type Opts = { milk?: boolean; rent?: boolean };
// A flat of A, B and C. Start of Nov as in the story. `rent` / `milk` switch the two bills on.
async function flat(label: string, o: Opts = {}) {
  const tag = `${label}-${Math.random().toString(36).slice(2, 7)}`;
  const accs = await Promise.all(["A", "B", "C"].map((nm) => db.account.create({ data: { email: `so-${nm}-${tag}-${stamp}@example.test`, name: nm } })));
  accountIds.push(...accs.map((x) => x.id));
  const g = await db.group.create({
    data: {
      name: `Flat ${tag}`, type: "home", currency: "INR", inviteCode: `so-${tag}-${stamp}`,
      members: { create: accs.map((x, i) => ({ name: x.name, accountId: x.id, splitWeight: 100, createdAt: new Date(2026, 0, i + 1), claimedAt: new Date(2026, 0, i + 1) })) },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  const [a, b, c] = [id("A"), id("B"), id("C")];
  const spend = (description: string, amount: number, paidById: string, spentAt: string, category = "other") =>
    db.expense.create({
      data: {
        groupId: g.id, description, category, amount, paidById, createdById: paidById, splitType: "equal", forMode: "everyone",
        originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount, spentAt: new Date(`${spentAt}T12:00:00Z`),
        shares: { create: [a, b, c].map((m) => ({ memberId: m, amount: amount / 3 })) },
      },
    });
  await spend("Groceries", 1_200_000, a, "2026-10-20");
  let rentBillId = "";
  if (o.rent !== false) {
    const rentExpense = await spend("Rent", 1_800_000, a, "2026-11-01");
    const rent = await db.bill.create({ data: { groupId: g.id, name: "Rent", category: "other", nature: "fixed", amount: 1_800_000, day: 1, startMonth: "2026-11", payer: a, split: JSON.stringify({ mode: "group" }), tz: "Asia/Kolkata" } });
    await db.billRun.create({ data: { billId: rent.id, period: "2026-11", status: "added", expenseId: rentExpense.id } });
    rentBillId = rent.id;
  }
  if (o.milk !== false) {
    await db.bill.create({ data: { groupId: g.id, name: "Milk", category: "groceries", nature: "daily", amount: 6000, startMonth: "2026-11", payer: b, split: JSON.stringify({ mode: "equal" }), tz: "Asia/Kolkata" } });
  }
  const rows = (kind: string) => db.groupEvent.findMany({ where: { groupId: g.id, kind }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const live = () => db.expense.findMany({ where: { groupId: g.id, deletedAt: null }, include: { shares: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const nets = async () => {
    const x = await checkBooks(g.id);
    return [x[a], x[b], x[c]];
  };
  const row = (m: string) => db.member.findUniqueOrThrow({ where: { id: m } });
  return { gid: g.id, name: g.name, a, b, c, rentBillId, rows, live, nets, row };
}
type Flat = Awaited<ReturnType<typeof flat>>;

// 10 Nov: B marks C as moved out; C pays A 620,000 and A is asked. 22 Nov: A says "Not received", so C is back, settling up only.
async function toSettling(f: Flat) {
  expect(await f.nets()).toEqual([2_000_000, -1_000_000, -1_000_000]); // start of Nov
  const out = await moveOut(f.gid, f.b, { leaverId: f.c, lastDay: "2026-11-10", addDaily: true, requestKey: key() }, at("2026-11-10"));
  expect(out).toMatchObject({ ok: true });
  expect(await f.nets()).toEqual([1_180_000, -1_180_000, 0]); // C paid A 620,000
  const pay = await db.payment.findFirstOrThrow({ where: { groupId: f.gid, fromId: f.c, toId: f.a, deletedAt: null } });
  expect([pay.amount, pay.needsOk]).toEqual([620_000, true]);
  const rent = (await f.live()).find((e) => e.description === "Rent")!;
  expect(shareMap(rent)).toEqual({ [f.a]: 800_000, [f.b]: 800_000, [f.c]: 200_000 }); // C keeps 600,000 x 10/30
  expect((await rejectPayment(pay.id, f.a)).ok).toBe(true);
  expect((await f.row(f.c)).leftAt).toBeNull();
  expect(await f.nets()).toEqual([1_800_000, -1_180_000, -620_000]);
  return pay;
}

// The same, without the milk bill (and so without the 20,000 milk charge): start A +2,000,000, B -1,000,000, C -1,000,000; the rent re-split frees 400,000
// (200,000 each to A and B), so before paying C is at -600,000, A +1,800,000, B -1,200,000. C pays A 600,000. Then "Not received".
async function moveCOutNoMilk(f: Flat) {
  const out = await moveOut(f.gid, f.b, { leaverId: f.c, lastDay: "2026-11-10", requestKey: key() }, at("2026-11-10"));
  expect(out).toMatchObject({ ok: true });
  const pay = await db.payment.findFirstOrThrow({ where: { groupId: f.gid, fromId: f.c, toId: f.a, deletedAt: null } });
  expect(pay.amount).toBe(600_000);
  expect(await f.nets()).toEqual([1_200_000, -1_200_000, 0]);
  return pay;
}
async function toSettlingNoMilk(f: Flat) {
  const pay = await moveCOutNoMilk(f);
  expect((await rejectPayment(pay.id, f.a)).ok).toBe(true);
  expect(await f.nets()).toEqual([1_800_000, -1_200_000, -600_000]);
  return pay;
}

const input = (f: Flat, by: string, o: Partial<SaveExpenseInput> = {}): SaveExpenseInput => ({
  groupId: f.gid, name: "Dinner", category: "", amount: "3000", currency: "INR", paidById: by, forMode: "everyone", selected: [], onePersonId: "",
  splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...o,
});
const record = (f: Flat, from: string, to: string, amount: number, k = key()) =>
  recordPaymentCore({ groupId: f.gid, fromId: from, toId: to, amount, currency: "INR", myId: from, key: k, fp: `fp-${k}`, warnOver: false });

describe("settling up only: the story, in numbers", () => {
  it("1. Not received -> settling; December leaves C out; C pays and is moved out again with last day 10 Nov; deleting that payment brings C back at -620,000", async () => {
    const f = await flat("story");
    await toSettling(f);
    // The bring-back line carries the hidden flag and the old last day.
    const back = await f.rows("member_rejoined");
    expect(back).toHaveLength(1);
    expect(JSON.parse(back[0].undo)).toEqual({ type: "member_set", memberId: f.c, data: { leftAt: LAST }, settling: true });
    expect((await settlingIn(db, f.gid)).get(f.c)?.leftAt.toISOString()).toBe(LAST);

    // Home counts: C is not counted (A, B = 2).
    const home = await loadMyGroupsLight({ [f.gid]: f.a });
    expect(home[0].people).toBe(2);

    // 1 Dec: Nov milk 160,000 (A 80,000, B 80,000: C's charge stands) and Dec rent 1,800,000 (A 900,000, B 900,000: C is left out).
    await runBillsForGroup(f.gid, at("2026-12-01"));
    const list = await f.live();
    const milk = list.find((e) => e.description === "Milk")!;
    expect([milk.amount, shareMap(milk)]).toEqual([160_000, { [f.a]: 80_000, [f.b]: 80_000 }]);
    const rents = list.filter((e) => e.description === "Rent");
    expect(rents).toHaveLength(2);
    const dec = rents.find((e) => e.spentAt?.toISOString().startsWith("2026-12"))!;
    expect([dec.amount, shareMap(dec)]).toEqual([1_800_000, { [f.a]: 900_000, [f.b]: 900_000 }]);
    expect(await f.nets()).toEqual([2_620_000, -2_000_000, -620_000]);

    // "Everyone" dinner 300,000 paid by B: A 150,000, B 150,000, nothing for C.
    const dinner = await saveExpense(input(f, f.b), f.b, rate1);
    expect(dinner.ok).toBe(true);
    const dn = (await f.live()).find((e) => e.description === "Dinner")!;
    expect(shareMap(dn)).toEqual({ [f.a]: 150_000, [f.b]: 150_000 });
    expect(await f.nets()).toEqual([2_470_000, -1_850_000, -620_000]);

    // 1 Jan: Dec milk 186,000 (B pays): A 93,000, B 93,000. (The rent bill has ended, so January's rent is not added.)
    await db.bill.update({ where: { id: f.rentBillId }, data: { deletedAt: new Date() } });
    await runBillsForGroup(f.gid, at("2027-01-01"));
    const decMilk = (await f.live()).filter((e) => e.description === "Milk").find((e) => e.amount === 186_000)!;
    expect(shareMap(decMilk)).toEqual({ [f.a]: 93_000, [f.b]: 93_000 });
    expect(await f.nets()).toEqual([2_377_000, -1_757_000, -620_000]);
    expect((await settlingIn(db, f.gid)).has(f.c)).toBe(true);

    // B pays A 1,757,000: C is still settling (not square). Then C pays A 620,000: everyone 0, C is moved out again, in the same step.
    expect(await record(f, f.b, f.a, 1_757_000)).toMatchObject({ kind: "done" });
    expect((await f.row(f.c)).leftAt).toBeNull();
    expect(await f.nets()).toEqual([620_000, 0, -620_000]);
    const payKey = key();
    expect(await record(f, f.c, f.a, 620_000, payKey)).toMatchObject({ kind: "done" });
    expect(await f.nets()).toEqual([0, 0, 0]);
    expect((await f.row(f.c)).leftAt?.toISOString()).toBe(LAST);
    expect((await settlingIn(db, f.gid)).size).toBe(0);
    const again = (await f.rows("member_left")).filter((e) => e.text.includes("is square again"));
    expect(again).toHaveLength(1);
    expect(again[0].text).toBe("is square again, so C is moved out again (last day 10 Nov)");
    expect(again[0].actorId).toBe(f.c);
    // The history reads "paid ..." and then "is square again", in that order (the line is written after the payment's own line).
    const lastTwo = (await db.groupEvent.findMany({ where: { groupId: f.gid }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).slice(-2).map((e) => e.kind);
    expect(lastTwo).toEqual(["payment_recorded", "member_left"]);

    // A double tap / retry of the same payment changes nothing: one payment, one line.
    expect(await record(f, f.c, f.a, 620_000, payKey)).toMatchObject({ kind: "duplicate" });
    expect(await db.payment.count({ where: { groupId: f.gid, fromId: f.c, toId: f.a, amount: 620_000, deletedAt: null } })).toBe(1);
    expect((await f.rows("member_left")).filter((e) => e.text.includes("is square again"))).toHaveLength(1);

    // Deleting that payment brings C back again, owing 620,000, settling up only as before.
    const cPay = await db.payment.findFirstOrThrow({ where: { groupId: f.gid, fromId: f.c, toId: f.a, deletedAt: null } });
    expect((await setPaymentDeleted(cPay.id, f.a, true)).ok).toBe(true);
    expect((await f.row(f.c)).leftAt).toBeNull();
    expect(await f.nets()).toEqual([620_000, 0, -620_000]);
    expect((await settlingIn(db, f.gid)).get(f.c)?.leftAt.toISOString()).toBe(LAST);
    expect(await f.rows("member_rejoined")).toHaveLength(2);
  });

  it("2. an older bring-back line with no hidden flag is still found by its words", async () => {
    const f = await flat("oldline");
    await toSettling(f);
    const [line] = await f.rows("member_rejoined");
    const old = JSON.parse(line.undo);
    delete old.settling;
    await db.groupEvent.update({ where: { id: line.id }, data: { undo: JSON.stringify(old) } });
    expect(line.text).toMatch(/^brought C back into .+ until the .+ is sorted$/);
    expect((await settlingIn(db, f.gid)).get(f.c)?.leftAt.toISOString()).toBe(LAST);
  });

  it("3. A marks that C has moved back in on 15 Dec (today): C is a member again from that day, not C themselves. Dec milk 186,000 -> A 76,000, B 76,000, C 34,000 (17 days x 2,000); Dec rent stays without C; January's rent has C", async () => {
    const f = await flat("backin");
    await toSettling(f);
    await runBillsForGroup(f.gid, at("2026-12-01")); // Nov milk (A 80,000, B 80,000) and Dec rent (A 900,000, B 900,000)
    expect(await f.nets()).toEqual([2_620_000, -2_000_000, -620_000]);
    // C can't say it for themselves.
    expect(await moveBackInFor(f.gid, f.c, f.c, at("2026-12-15"))).toEqual({ ok: false, error: "Someone else in the flat needs to mark that you’ve moved back in." });
    expect(await moveBackInFor(f.gid, f.c, f.c, at("2026-12-15"))).toEqual({ ok: false, error: SETTLING_SELF_MOVED_BACK });
    expect((await settlingIn(db, f.gid)).has(f.c)).toBe(true);
    // A can: the day is today (15 Dec), there is no date to pick.
    const r = await moveBackInFor(f.gid, f.a, f.c, at("2026-12-15"));
    expect(r.ok).toBe(true);
    expect((await settlingIn(db, f.gid)).size).toBe(0);
    expect((await f.row(f.c)).joinedFrom?.toISOString().slice(0, 10)).toBe("2026-12-15");
    const line = (await f.rows("member_rejoined")).find((e) => e.text.startsWith("noted"))!;
    expect(line.text).toBe("noted C moved back in on 15 Dec");
    // Everything shown stays as it was; the Dec rent already added without C is not changed.
    expect(await f.nets()).toEqual([2_620_000, -2_000_000, -620_000]);
    // Dec milk (31 days): days 1-14 A and B (100 each, total 200), days 15-31 three ways (total 300); units over 600: A 14x300 + 17x200 = 7,600, B 7,600, C 17x200 = 3,400
    // of 18,600: 186,000 x 7,600 / 18,600 = 76,000, C 34,000.
    // January's rent is 1,800,000 three ways (600,000 each, A paid).
    await runBillsForGroup(f.gid, at("2027-01-01"));
    const list = await f.live();
    const decMilk = list.filter((e) => e.description === "Milk").find((e) => e.amount === 186_000)!;
    expect(shareMap(decMilk)).toEqual({ [f.a]: 76_000, [f.b]: 76_000, [f.c]: 34_000 });
    const jan = list.filter((e) => e.description === "Rent").find((e) => e.spentAt?.toISOString().startsWith("2027-01"))!;
    expect(shareMap(jan)).toEqual({ [f.a]: 600_000, [f.b]: 600_000, [f.c]: 600_000 });
    // A 2,620,000 - 76,000 + 1,200,000 = 3,744,000; B -2,000,000 + 186,000 - 76,000 - 600,000 = -2,490,000; C -620,000 - 34,000 - 600,000 = -1,254,000.
    expect(await f.nets()).toEqual([3_744_000, -2_490_000, -1_254_000]);
  });

  it("4. a second tap (or tapping for someone who is not settling) quietly succeeds and writes nothing; there is no back-dating", async () => {
    const f = await flat("twotaps");
    await toSettling(f);
    expect((await moveBackInFor(f.gid, f.a, f.c, at("2026-11-23"))).ok).toBe(true);
    const lines = (await f.rows("member_rejoined")).length;
    expect(await moveBackInFor(f.gid, f.b, f.c, at("2026-11-23"))).toEqual({ ok: true }); // the second tap: C is a member now
    expect(await moveBackInFor(f.gid, f.a, f.b, at("2026-11-23"))).toEqual({ ok: true }); // B was never settling
    expect((await f.rows("member_rejoined")).length).toBe(lines);
    // The day is today, never an earlier one: C's moving-in date is 23 Nov, not 10 Nov or 11 Nov.
    expect((await f.row(f.c)).joinedFrom?.toISOString().slice(0, 10)).toBe("2026-11-23");
  });
});

describe("settling up only: who can do what", () => {
  it("5. C can't add or edit an expense (exact words); naming C on a new expense is refused (exact words); an 'everyone' expense leaves C out; nothing is saved by a refusal", async () => {
    const f = await flat("refuse");
    await toSettling(f);
    const before = (await f.live()).length;
    const own = await saveExpense(input(f, f.c), f.c, rate1);
    expect(own).toEqual({ ok: false, error: "You moved out, so you can only settle up here." });
    expect(own).toEqual({ ok: false, error: SETTLING_SELF });
    const someone = (await f.live())[0];
    expect(await saveExpense({ ...input(f, f.c), expenseId: someone.id, name: "Changed" }, f.c, rate1)).toEqual({ ok: false, error: SETTLING_SELF });
    const named = await saveExpense(input(f, f.a, { forMode: "selected", selected: [f.a, f.c] }), f.a, rate1);
    expect(named).toEqual({ ok: false, error: "C moved out and is only settling up, so they can’t be in new expenses. If C has moved back in, mark that on People first." });
    expect(named).toEqual({ ok: false, error: settlingNamed("C") });
    const asPayer = await saveExpense(input(f, f.c), f.a, rate1); // paid by C, recorded by A
    expect(asPayer).toEqual({ ok: false, error: settlingNamed("C") });
    expect(await saveExpense(input(f, f.a, { forMode: "one", onePersonId: f.c }), f.a, rate1)).toEqual({ ok: false, error: settlingNamed("C") });
    expect((await f.live()).length).toBe(before);
    // "Everyone" simply doesn't include C: 300,000 paid by A -> A 150,000, B 150,000.
    expect((await saveExpense(input(f, f.a), f.a, rate1)).ok).toBe(true);
    const dn = (await f.live()).find((e) => e.description === "Dinner")!;
    expect(shareMap(dn)).toEqual({ [f.a]: 150_000, [f.b]: 150_000 });
    // A: 1,800,000 + 300,000 - 150,000 = 1,950,000; B -1,180,000 - 150,000 = -1,330,000; C unchanged.
    expect(await f.nets()).toEqual([1_950_000, -1_330_000, -620_000]);
  });

  it("6. C can't change budgets or bills; the others still can", async () => {
    const f = await flat("noedit");
    await toSettling(f);
    expect(await saveBudgetsFor(f.gid, f.c, { groceries: "5000" })).toEqual({ ok: false, error: SETTLING_SELF });
    const bill = await db.bill.findFirstOrThrow({ where: { groupId: f.gid, name: "Milk" } });
    expect(await billCommand(f.gid, f.c, bill.id, "pause", at("2026-11-23"))).toEqual({ ok: false, error: SETTLING_SELF });
    expect((await db.bill.findUniqueOrThrow({ where: { id: bill.id } })).paused).toBe(false);
    expect((await saveBudgetsFor(f.gid, f.a, { groceries: "5000" })).ok).toBe(true);
  });

  it("7. a varying Wi-Fi bill: C is never the payer (taking turns C, A, B starting December) and never asked", async () => {
    const f = await flat("wifi");
    await db.bill.create({ data: { groupId: f.gid, name: "Wi-Fi", category: "other", nature: "varies", amount: 0, day: 5, startMonth: "2026-12", payer: "", rotation: JSON.stringify([f.c, f.a, f.b]), split: JSON.stringify({ mode: "group" }), tz: "Asia/Kolkata" } });
    await toSettling(f);
    const status = (await billStatuses(f.gid, at("2026-11-23"))).find((s) => s.bill.name === "Wi-Fi")!;
    expect(status.period).toBe("2026-12");
    expect(status.payerId).toBe(f.a); // C's turn goes to the next person still in
    // The 5 Dec run: the amount is asked of A, never of C.
    await runBillsForGroup(f.gid, at("2026-12-06"));
    const asks = (await db.notifyLog.findMany({ where: { key: { startsWith: "billask:" } } })).map((x) => x.key);
    expect(asks.filter((k) => k.endsWith(`:m:${f.a}`))).toHaveLength(1);
    expect(asks.filter((k) => k.endsWith(`:m:${f.c}`))).toHaveLength(0);
    expect((await f.nets())[2]).toBe(-620_000);
  });

  it("8. B moves out while C is settling: C takes none of B's freed rent share (C keeps 200,000), and C's balance does not move", async () => {
    const f = await flat("others", { milk: false });
    await toSettlingNoMilk(f);
    // B leaves on 20 Nov: keeps floor(800,000 x 20 / 30) = 533,333; 266,667 is freed and goes to A alone (C is not in the flat).
    const out = await moveOut(f.gid, f.a, { leaverId: f.b, lastDay: "2026-11-20", requestKey: key() }, at("2026-11-23"));
    expect(out).toMatchObject({ ok: true });
    const rent = (await f.live()).find((e) => e.description === "Rent")!;
    expect(shareMap(rent)).toEqual({ [f.a]: 1_066_667, [f.b]: 533_333, [f.c]: 200_000 });
    const [, , cNet] = await f.nets();
    expect(cNet).toBe(-600_000);
    expect((await f.row(f.c)).leftAt).toBeNull();
  });

  it("9. forecast: C's share is 0 and A's December rent is 900,000; the Home people count is 2", async () => {
    const f = await flat("forecast", { milk: false });
    await toSettlingNoMilk(f);
    const expenses = await db.expense.findMany({ where: { groupId: f.gid, deletedAt: null }, include: { shares: true } });
    const weights = { [f.a]: 100, [f.b]: 100, [f.c]: 100 };
    const asA = await monthInsights(f.gid, expenses as never, f.a, weights, "INR", "Asia/Kolkata", at("2026-11-23"));
    expect(asA.forecast?.mine).toBe(900_000);
    const asC = await monthInsights(f.gid, expenses as never, f.c, weights, "INR", "Asia/Kolkata", at("2026-11-23"));
    expect(asC.forecast?.mine).toBe(0);
    const home = await loadMyGroupsLight({ [f.gid]: f.a });
    expect(home[0].people).toBe(2);
  });
});

describe("settling up only: timing", () => {
  it("10. 'Not received' twice, and the bring-back itself run twice: one bring-back line, C's row and balance unchanged by the repeat", async () => {
    const f = await flat("twice");
    const pay = await toSettling(f);
    const isFlagged = (e: { undo: string }) => e.undo.includes('"settling":true');
    expect((await f.rows("member_rejoined")).filter(isFlagged)).toHaveLength(1);
    // The same "Not received" again: refused (the payment is already off), nothing more is written.
    expect((await rejectPayment(pay.id, f.a)).ok).toBe(false);
    // The bring-back code itself, run a second time for someone who is already back (two taps landing at once): it finds C in the flat and writes nothing.
    const again = await db.$transaction((tx) => bringBackLeavers(tx, { groupId: f.gid, groupName: f.name, amountText: "₹6,200", actorId: f.a, people: [f.c] }));
    expect(again).toEqual([]);
    expect((await f.rows("member_rejoined")).filter(isFlagged)).toHaveLength(1);
    expect(await f.nets()).toEqual([1_800_000, -1_180_000, -620_000]);
    expect((await settlingIn(db, f.gid)).get(f.c)?.leftAt.toISOString()).toBe(LAST);
  });

  it("11. a page left open naming C: while A is saving, C moves out, pays, and A says Not received (so C is settling up only): the save is refused (exact words) and nothing is written", async () => {
    const f = await flat("leftopen", { milk: false });
    const before = (await f.live()).length;
    const r = await saveExpense(input(f, f.a, { forMode: "selected", selected: [f.a, f.c] }), f.a, rate1, {
      afterRead: async () => {
        // C was an ordinary member when the page was checked; all of this lands before the write.
        const pay = await moveCOutNoMilk(f); // C pays A 600,000: A +1,200,000, B -1,200,000, C 0
        expect((await rejectPayment(pay.id, f.a)).ok).toBe(true); // A +1,800,000, B -1,200,000, C -600,000, C settling
        expect((await settlingIn(db, f.gid)).has(f.c)).toBe(true);
      },
    });
    expect(r).toEqual({ ok: false, error: settlingNamed("C") });
    expect((await f.live()).length).toBe(before);
    expect(await f.nets()).toEqual([1_800_000, -1_200_000, -600_000]);
  });

  it("12. 'Not received' lands in the middle of the December run (after the group is read): the rent is still A 900,000, B 900,000 only", async () => {
    const f = await flat("midrun", { milk: false });
    const pay = await moveCOutNoMilk(f); // C pays A 600,000: A +1,200,000, B -1,200,000, C 0
    let fired = false;
    await runBillsForGroup(f.gid, at("2026-12-01"), {
      afterRead: async () => {
        if (fired) return;
        fired = true;
        expect((await rejectPayment(pay.id, f.a)).ok).toBe(true);
      },
    });
    expect(fired).toBe(true);
    const rents = (await f.live()).filter((e) => e.description === "Rent");
    const dec = rents.find((e) => e.spentAt?.toISOString().startsWith("2026-12"))!;
    expect([dec.amount, shareMap(dec)]).toEqual([1_800_000, { [f.a]: 900_000, [f.b]: 900_000 }]);
    expect((await f.row(f.c)).leftAt).toBeNull();
    // After "Not received": A +1,800,000, B -1,200,000, C -600,000. Dec rent: A paid 1,800,000 and owes 900,000: A +2,700,000; B -2,100,000; C -600,000.
    expect(await f.nets()).toEqual([2_700_000, -2_100_000, -600_000]);
    // A second run adds nothing.
    await runBillsForGroup(f.gid, at("2026-12-01"));
    expect((await f.live()).filter((e) => e.description === "Rent")).toHaveLength(2);
  });

  it("13. payment and bills at once, both orders, end the same: A +2,000,000, B -2,000,000, C 0 with C moved out again", async () => {
    const one = await flat("order-1", { rent: true, milk: true });
    await toSettling(one);
    await runBillsForGroup(one.gid, at("2026-12-01")); // A +2,620,000, B -2,000,000, C -620,000
    expect(await one.nets()).toEqual([2_620_000, -2_000_000, -620_000]);
    expect(await record(one, one.c, one.a, 620_000)).toMatchObject({ kind: "done" });
    expect(await one.nets()).toEqual([2_000_000, -2_000_000, 0]);
    expect((await one.row(one.c)).leftAt?.toISOString()).toBe(LAST);

    const two = await flat("order-2", { rent: true, milk: true });
    await toSettling(two);
    expect(await record(two, two.c, two.a, 620_000)).toMatchObject({ kind: "done" }); // A +1,180,000, B -1,180,000, C 0, moved out again
    expect((await two.row(two.c)).leftAt?.toISOString()).toBe(LAST);
    await runBillsForGroup(two.gid, at("2026-12-01")); // Nov milk: A -80,000, B +80,000; Dec rent: A +900,000, B -900,000
    expect(await two.nets()).toEqual([2_000_000, -2_000_000, 0]);
  });

  it("14. a run at 2026-11-30T19:00Z (00:30 on 1 Dec in India) is December and leaves C out", async () => {
    const f = await flat("midnight");
    await toSettling(f);
    await runBillsForGroup(f.gid, new Date("2026-11-30T19:00:00Z"));
    const list = await f.live();
    const dec = list.filter((e) => e.description === "Rent").find((e) => e.spentAt?.toISOString().startsWith("2026-12"))!;
    expect(shareMap(dec)).toEqual({ [f.a]: 900_000, [f.b]: 900_000 });
    const milk = list.find((e) => e.description === "Milk")!;
    expect([milk.amount, shareMap(milk)]).toEqual([160_000, { [f.a]: 80_000, [f.b]: 80_000 }]);
    expect(await f.nets()).toEqual([2_620_000, -2_000_000, -620_000]);
  });
});

// A trip: the same person brought back is an ordinary member (only a flat has "settling up only").
async function tripWithLeaver(label: string) {
  const tag = `${label}-${Math.random().toString(36).slice(2, 7)}`;
  const accs = await Promise.all(["A", "B", "C"].map((nm) => db.account.create({ data: { email: `so-t-${nm}-${tag}-${stamp}@example.test`, name: nm } })));
  accountIds.push(...accs.map((x) => x.id));
  const g = await db.group.create({
    data: {
      name: `Trip ${tag}`, type: "trip", currency: "INR", inviteCode: `so-t-${tag}-${stamp}`,
      members: { create: accs.map((x, i) => ({ name: x.name, accountId: x.id, splitWeight: 100, createdAt: new Date(2026, 0, i + 1), claimedAt: new Date(2026, 0, i + 1) })) },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (nm: string) => g.members.find((m) => m.name === nm)!.id;
  const [a, b, c] = [id("A"), id("B"), id("C")];
  // Dinner 60,000 paid by B, all of it C's: B +60,000, C -60,000.
  await db.expense.create({
    data: {
      groupId: g.id, description: "Dinner", category: "other", amount: 60_000, paidById: b, createdById: b, splitType: "exact", forMode: "selected",
      originalAmount: 60_000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 60_000, spentAt: new Date("2026-11-05T12:00:00Z"),
      shares: { create: [{ memberId: c, amount: 60_000 }] },
    },
  });
  return { gid: g.id, a, b, c, nets: async () => { const x = await checkBooks(g.id); return [x[a], x[b], x[c]]; } };
}

describe("settling up only: the review fixes", () => {
  it("17. H2: Undo of 'Not received', and restoring a deleted payment, move C out again when C is square again (last day 10 Nov each time)", async () => {
    const f = await flat("h2a");
    const pay = await toSettling(f); // C -620,000, settling up only
    expect((await settlingIn(db, f.gid)).has(f.c)).toBe(true);
    // A undoes their own "Not received": C's 620,000 counts again, so C is 0 and is moved out again, in that same step.
    const ev = (await f.rows("payment_deleted"))[0];
    expect((await undoEvent(ev.id, f.a)).ok).toBe(true);
    expect(await f.nets()).toEqual([1_180_000, -1_180_000, 0]);
    expect((await f.row(f.c)).leftAt?.toISOString()).toBe(LAST);
    expect((await settlingIn(db, f.gid)).size).toBe(0);
    // A deletes the payment again: C is back, owing 620,000. A restores it: C is square and moved out again.
    expect((await setPaymentDeleted(pay.id, f.a, true)).ok).toBe(true);
    expect((await f.row(f.c)).leftAt).toBeNull();
    expect(await f.nets()).toEqual([1_800_000, -1_180_000, -620_000]);
    expect((await setPaymentDeleted(pay.id, f.a, false)).ok).toBe(true);
    expect(await f.nets()).toEqual([1_180_000, -1_180_000, 0]);
    expect((await f.row(f.c)).leftAt?.toISOString()).toBe(LAST);
    expect((await f.rows("member_left")).filter((e) => e.text.includes("is square again"))).toHaveLength(2);
  });

  it("18. H1: C can't delete or restore an expense, or undo anyone's change to one. C deleting October groceries (1,200,000) would have taken C from -620,000 to -220,000", async () => {
    const f = await flat("h1");
    await toSettling(f); // A +1,800,000, B -1,180,000, C -620,000
    const groceries = (await f.live()).find((e) => e.description === "Groceries")!;
    expect(await setExpenseDeleted(groceries.id, f.c, true)).toEqual({ ok: false, error: SETTLING_SELF });
    expect((await f.live()).some((e) => e.id === groceries.id)).toBe(true);
    expect(await f.nets()).toEqual([1_800_000, -1_180_000, -620_000]);
    // A deletes it (their right): each had 400,000 of it and A paid 1,200,000. A 1,800,000 - 800,000 = 1,000,000; B -1,180,000 + 400,000 = -780,000; C -620,000 + 400,000 = -220,000.
    expect((await setExpenseDeleted(groceries.id, f.a, true)).ok).toBe(true);
    expect(await f.nets()).toEqual([1_000_000, -780_000, -220_000]);
    // C can't bring it back, nor undo A's delete.
    expect(await setExpenseDeleted(groceries.id, f.c, false)).toEqual({ ok: false, error: SETTLING_SELF });
    const del = (await f.rows("expense_deleted"))[0];
    expect(await undoEvent(del.id, f.c)).toEqual({ ok: false, error: SETTLING_SELF });
    expect(await f.nets()).toEqual([1_000_000, -780_000, -220_000]);
    expect((await setExpenseDeleted(groceries.id, f.a, false)).ok).toBe(true);
    expect(await f.nets()).toEqual([1_800_000, -1_180_000, -620_000]);
    // A renames the groceries (C stays in it, nothing moves); C can't undo that edit.
    const edit = await saveExpense(input(f, f.a, { expenseId: groceries.id, name: "October groceries", amount: "12000", forMode: "selected", selected: [f.a, f.b, f.c] }), f.a, rate1);
    expect(edit.ok).toBe(true);
    const edited = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.gid, kind: "expense_edited", expenseId: groceries.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    expect(await undoEvent(edited.id, f.c)).toEqual({ ok: false, error: SETTLING_SELF });
    expect(await f.nets()).toEqual([1_800_000, -1_180_000, -620_000]);
  });

  it("19. H3: someone else's move-out leaves C out of the square-up. With C settling at -600,000, B moves out and pays A 1,200,000; no payment names C; C stays -600,000", async () => {
    const f = await flat("h3b", { milk: false });
    await toSettlingNoMilk(f); // A +1,800,000, B -1,200,000, C -600,000
    // B's last day is 30 Nov (the whole month: nothing freed). B owes 1,200,000 and A is the only one owed among those still in the flat.
    const out = await moveOut(f.gid, f.a, { leaverId: f.b, lastDay: "2026-11-30", requestKey: key() }, at("2026-11-30"));
    expect(out).toMatchObject({ ok: true, payments: [{ from: f.b, to: f.a, amount: 1_200_000 }] });
    expect(await f.nets()).toEqual([600_000, 0, -600_000]);
    expect(await db.payment.count({ where: { groupId: f.gid, deletedAt: null, OR: [{ fromId: f.c }, { toId: f.c }] } })).toBe(0);
    expect((await f.row(f.c)).leftAt).toBeNull();
    expect((await settlingIn(db, f.gid)).has(f.c)).toBe(true);
  });

  it("20. N1: A (owed 1,800,000) moves out while C (owes 620,000) is settling: B, who stays, covers C's part. One payment B pays A 1,800,000 (1,180,000 B's own + 620,000 for C); A 0, B +620,000, C -620,000; C then pays B and is moved out again", async () => {
    const f = await flat("n1");
    await toSettling(f); // A +1,800,000, B -1,180,000, C -620,000 (C settling)
    // Shown before confirming: the line, who covers (B, the only one staying), and the one payment.
    const pre = await moveOutPreview(f.gid, f.a, "2026-11-30", at("2026-11-30"), f.b);
    if (!pre.ok) throw new Error(pre.error);
    expect(pre.cover?.text).toBe("C still owes A ₹6,200. B pays it now, and C then owes B.");
    expect(pre.cover).toMatchObject({ amount: 620_000, coverId: f.b, options: [{ id: f.b, name: "B" }] });
    expect(pre.payments).toEqual([{ from: f.b, to: f.a, amount: 1_800_000 }]);
    const out = await moveOut(f.gid, f.b, { leaverId: f.a, lastDay: "2026-11-30", requestKey: key(), expectKey: pre.expectKey, coverId: f.b }, at("2026-11-30"));
    expect(out).toMatchObject({ ok: true, payments: [{ from: f.b, to: f.a, amount: 1_800_000 }] });
    // A 0 (left at 0); B -1,180,000 + 1,800,000 = +620,000; C -620,000; 0 + 620,000 - 620,000 = 0.
    expect(await f.nets()).toEqual([0, 620_000, -620_000]);
    expect((await f.row(f.a)).leftAt).not.toBeNull();
    expect((await f.row(f.c)).leftAt).toBeNull(); // C is still settling
    expect(await db.payment.count({ where: { groupId: f.gid, deletedAt: null, OR: [{ fromId: f.c }, { toId: f.c }] } })).toBe(0); // nothing names C
    // C now owes B: C pays B 620,000, everyone is 0 and C is moved out again (last day 10 Nov).
    expect(await record(f, f.c, f.b, 620_000)).toMatchObject({ kind: "done" });
    expect(await f.nets()).toEqual([0, 0, 0]);
    expect((await f.row(f.c)).leftAt?.toISOString()).toBe(LAST);
  });

  it("20b. N1: the covering payment is undone with the move-out (its Undo): A back in, B -1,180,000 again, C -620,000", async () => {
    const f = await flat("n1undo");
    await toSettling(f);
    const out = await moveOut(f.gid, f.b, { leaverId: f.a, lastDay: "2026-11-30", requestKey: key() }, at("2026-11-30"));
    expect(out).toMatchObject({ ok: true });
    expect(await f.nets()).toEqual([0, 620_000, -620_000]);
    expect((await undoEvent((out as { eventId: string }).eventId, f.b)).ok).toBe(true);
    expect(await f.nets()).toEqual([1_800_000, -1_180_000, -620_000]);
    expect((await f.row(f.a)).leftAt).toBeNull();
    expect(await db.payment.count({ where: { groupId: f.gid, deletedAt: null } })).toBe(0);
  });

  it("20c. N1: with two staying flatmates the default cover is the one who owes most (B), and the picker can choose the other (D)", async () => {
    const f = await flat("n1pick", { milk: false });
    const d = await db.member.create({ data: { groupId: f.gid, name: "D", createdAt: new Date(2026, 0, 9) } });
    // A 300,000 dinner A paid for A, B, C and D (75,000 each): A +225,000, B, C, D -75,000 more.
    await db.expense.create({
      data: {
        groupId: f.gid, description: "Dinner", category: "other", amount: 300_000, paidById: f.a, createdById: f.a, splitType: "equal", forMode: "everyone",
        originalAmount: 300_000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 300_000, spentAt: new Date("2026-11-03T12:00:00Z"),
        shares: { create: [f.a, f.b, f.c, d.id].map((m) => ({ memberId: m, amount: 75_000 })) },
      },
    });
    // Start: A +2,225,000, B -1,075,000, C -1,075,000, D -75,000. C moves out on 10 Nov: the rent share keeps 200,000 of 600,000, the freed 400,000 goes 200,000 each
    // to A and B (the rent is shared by A, B and C only): A +2,025,000, B -1,275,000, C -675,000, D -75,000. C pays A 675,000, A says "Not received": C settling at -675,000.
    const out = await moveOut(f.gid, f.b, { leaverId: f.c, lastDay: "2026-11-10", requestKey: key() }, at("2026-11-10"));
    expect(out).toMatchObject({ ok: true });
    const pay = await db.payment.findFirstOrThrow({ where: { groupId: f.gid, fromId: f.c, toId: f.a, deletedAt: null } });
    expect(pay.amount).toBe(675_000);
    expect((await rejectPayment(pay.id, f.a)).ok).toBe(true);
    const net = await checkBooks(f.gid);
    expect([net[f.a], net[f.b], net[f.c], net[d.id]]).toEqual([2_025_000, -1_275_000, -675_000, -75_000]);
    // A leaves on 30 Nov. B (-1,275,000) and D (-75,000) pay A 1,350,000 between them; the other 675,000 is C's, covered by the default, B (owes most).
    const pre = await moveOutPreview(f.gid, f.a, "2026-11-30", at("2026-11-30"), f.b);
    if (!pre.ok) throw new Error(pre.error);
    expect(pre.cover?.coverId).toBe(f.b); // the person confirming (B), who stays, covers by default
    expect(pre.cover?.options.map((o) => o.id)).toEqual([f.b, d.id]);
    // Confirmed by someone who is not staying (no one given): the stayer who owes most, B (-1,275,000 against D -75,000).
    const noOne = await moveOutPreview(f.gid, f.a, "2026-11-30", at("2026-11-30"), "");
    if (!noOne.ok) throw new Error(noOne.error);
    expect(noOne.cover?.coverId).toBe(f.b);
    expect(pre.payments).toEqual(expect.arrayContaining([{ from: f.b, to: f.a, amount: 1_950_000 }, { from: d.id, to: f.a, amount: 75_000 }])); // B 1,275,000 + 675,000
    // Picking D instead: D pays A 75,000 + 675,000 = 750,000, B 1,275,000.
    const other = await moveOutPreview(f.gid, f.a, "2026-11-30", at("2026-11-30"), f.b, undefined, d.id);
    if (!other.ok) throw new Error(other.error);
    expect(other.cover?.coverId).toBe(d.id);
    expect(other.cover?.text).toBe("C still owes A ₹6,750. D pays it now, and C then owes D.");
    expect(other.payments).toEqual(expect.arrayContaining([{ from: f.b, to: f.a, amount: 1_275_000 }, { from: d.id, to: f.a, amount: 750_000 }]));
    expect(other.payments).toHaveLength(2);
  });

  it("21. M1: C can't be moved out by hand (by someone else, by their own leave, or in the preview); the bring-back stays", async () => {
    const f = await flat("m1");
    await toSettling(f);
    const words = "C is settling up after moving out, and is moved out again as soon as they’re square.";
    expect(words).toBe(settlingNoManualMoveOut("C"));
    expect(await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-11-23", requestKey: key() }, at("2026-11-23"))).toEqual({ ok: false, error: words });
    expect(await moveOutPreview(f.gid, f.c, "2026-11-23", at("2026-11-23"), f.a)).toEqual({ ok: false, error: words });
    expect(await setMemberLeft(f.gid, f.c, f.c, true)).toEqual({ ok: false, error: words });
    expect(await setMemberLeft(f.gid, f.a, f.c, true)).toEqual({ ok: false, error: words });
    expect((await f.row(f.c)).leftAt).toBeNull();
    expect((await settlingIn(db, f.gid)).get(f.c)?.leftAt.toISOString()).toBe(LAST);
    expect(await f.nets()).toEqual([1_800_000, -1_180_000, -620_000]);
  });

  it("22. M3: C can't change the currency, the card markup, goals or the deposit; A can change the markup", async () => {
    const f = await flat("m3");
    await toSettling(f);
    expect(await changeGroupCurrency(f.gid, f.c, "USD", "0.012")).toEqual({ ok: false, error: SETTLING_SELF });
    expect((await db.group.findUniqueOrThrow({ where: { id: f.gid } })).currency).toBe("INR");
    expect(await updateGroupBasics(f.gid, f.c, { markupBp: 150 })).toEqual({ ok: false, error: SETTLING_SELF });
    expect((await db.group.findUniqueOrThrow({ where: { id: f.gid } })).cardMarkupBp).toBe(0);
    expect(await saveGoalFor(f.gid, f.c, { name: "Sofa", target: "20000", byDate: "" })).toEqual({ ok: false, error: SETTLING_SELF });
    expect(await db.goal.count({ where: { groupId: f.gid } })).toBe(0);
    expect(await saveDepositFor(f.gid, f.c, { heldBy: f.a, amounts: { [f.a]: "1000" } })).toEqual({ ok: false, error: SETTLING_SELF });
    expect(await db.deposit.count({ where: { groupId: f.gid } })).toBe(0);
    expect((await updateGroupBasics(f.gid, f.a, { markupBp: 150 })).ok).toBe(true);
    expect(await settlingSelfRefusal(db, f.gid, f.a)).toBeNull();
    expect(await settlingSelfRefusal(db, f.gid, f.c)).toBe(SETTLING_SELF);
  });

  it("23. H4: a trip leaver who is brought back is an ordinary member (not settling up only)", async () => {
    const t = await tripWithLeaver("trip");
    expect(await t.nets()).toEqual([0, 60_000, -60_000]);
    const paid = await recordPaymentCore({ groupId: t.gid, fromId: t.c, toId: t.b, amount: 60_000, currency: "INR", myId: t.c, key: key(), fp: "so-trip-1", warnOver: false });
    expect(paid.kind).toBe("done");
    expect((await setMemberLeft(t.gid, t.c, t.c, true)).ok).toBe(true); // C leaves the trip at 0
    const pay = await db.payment.findFirstOrThrow({ where: { groupId: t.gid, fromId: t.c, toId: t.b } });
    expect((await setPaymentDeleted(pay.id, t.b, true)).ok).toBe(true); // B deletes it: C is brought back, owing 60,000
    expect(await t.nets()).toEqual([0, 60_000, -60_000]);
    expect((await db.member.findUniqueOrThrow({ where: { id: t.c } })).leftAt).toBeNull();
    expect((await settlingIn(db, t.gid)).size).toBe(0);
    expect(await settlingSelfRefusal(db, t.gid, t.c)).toBeNull();
  });

  it("24. H4: a flat person brought back 4 months ago by the old wording who has been in expenses since is a full member; with nothing since, still settling", async () => {
    const f = await flat("old4", { milk: false });
    await toSettlingNoMilk(f);
    const [line] = await f.rows("member_rejoined");
    const old = JSON.parse(line.undo);
    delete old.settling; // the old line: no hidden flag, found only by its words
    await db.groupEvent.update({ where: { id: line.id }, data: { undo: JSON.stringify(old), createdAt: new Date("2026-07-15T06:00:00Z") } });
    const moved = (await f.rows("member_left"))[0];
    await db.groupEvent.update({ where: { id: moved.id }, data: { createdAt: new Date("2026-07-10T06:00:00Z") } });
    expect((await settlingIn(db, f.gid)).get(f.c)?.flagged).toBe(false);
    expect((await settlingIn(db, f.gid)).has(f.c)).toBe(true); // nothing since: still settling
    // C was in a December expense since (dated after their move-out month): they have been living there.
    await db.expense.create({
      data: {
        groupId: f.gid, description: "Dec dinner", category: "other", amount: 300_000, paidById: f.a, createdById: f.a, splitType: "equal", forMode: "everyone",
        originalAmount: 300_000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 300_000, spentAt: new Date("2026-12-05T12:00:00Z"),
        shares: { create: [f.a, f.b, f.c].map((m) => ({ memberId: m, amount: 100_000 })) },
      },
    });
    expect((await settlingIn(db, f.gid)).size).toBe(0);
  });

  it("25. M4: C pays in full while still in a card game that is open: C is square (0) but is not moved out (they stay settling at 0)", async () => {
    const f = await flat("m4");
    await toSettling(f); // C -620,000
    await db.potGame.create({ data: { groupId: f.gid, name: "Cards", game: "poker", players: JSON.stringify([f.c]), hostId: f.a, moves: { create: [{ memberId: f.c, kind: "take", amount: 1_000, createdById: f.a }] } } });
    expect(await record(f, f.c, f.a, 620_000)).toMatchObject({ kind: "done" });
    expect(await f.nets()).toEqual([1_180_000, -1_180_000, 0]);
    expect((await f.row(f.c)).leftAt).toBeNull();
    expect((await settlingIn(db, f.gid)).has(f.c)).toBe(true);
    // N2(b): by hand, while the game is open: refused (the game's name is said); once it is closed, C (exactly 0) can be moved out, with the ORIGINAL last day.
    const open = await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-11-23", requestKey: key() }, at("2026-11-23"));
    expect(open).toEqual({ ok: false, error: "C is still in a game that’s open (Cards). Finish the game first." });
    await db.potGame.updateMany({ where: { groupId: f.gid }, data: { status: "done", finishedAt: new Date() } });
    // R1: the move-out screen offers it (the existing preview): nothing to pay, their ORIGINAL last day.
    const pre = await moveOutPreview(f.gid, f.c, "2026-11-23", at("2026-11-23"), f.a);
    if (!pre.ok) throw new Error(pre.error);
    expect([pre.settlingSquare, pre.lastDay, pre.payments, pre.cover]).toEqual([true, "2026-11-10", [], null]);
    expect(await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-11-23", requestKey: key() }, at("2026-11-23"))).toEqual({ ok: true, payments: [] });
    expect((await f.row(f.c)).leftAt?.toISOString()).toBe(LAST);
    expect((await settlingIn(db, f.gid)).size).toBe(0);
    expect(await f.nets()).toEqual([1_180_000, -1_180_000, 0]);
  });

  it("26. N2: C is stuck at exactly 0 without a payment: expenses A deletes take C from -600,000 to 0 and C is moved out again (original last day), right after A's delete line", async () => {
    const f = await flat("n2", { milk: false });
    await toSettlingNoMilk(f); // A +1,800,000, B -1,200,000, C -600,000 (groceries 400,000 + rent share 200,000)
    const groceries = (await f.live()).find((e) => e.description === "Groceries")!;
    const rent = (await f.live()).find((e) => e.description === "Rent")!;
    expect((await setExpenseDeleted(groceries.id, f.a, true)).ok).toBe(true);
    // A 1,800,000 - 800,000 = 1,000,000; B -1,200,000 + 400,000 = -800,000; C -600,000 + 400,000 = -200,000. C still owes, so is still settling.
    expect(await f.nets()).toEqual([1_000_000, -800_000, -200_000]);
    expect((await settlingIn(db, f.gid)).has(f.c)).toBe(true);
    expect((await setExpenseDeleted(rent.id, f.a, true)).ok).toBe(true);
    // The rent (A paid 1,800,000; shares A 800,000, B 800,000, C 200,000) comes off: A 1,000,000 - 1,000,000 = 0; B -800,000 + 800,000 = 0; C -200,000 + 200,000 = 0.
    expect(await f.nets()).toEqual([0, 0, 0]);
    expect((await f.row(f.c)).leftAt?.toISOString()).toBe(LAST);
    expect((await settlingIn(db, f.gid)).size).toBe(0);
    const last = (await db.groupEvent.findMany({ where: { groupId: f.gid }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] })).slice(-2);
    expect(last.map((e) => e.kind)).toEqual(["expense_deleted", "member_left"]);
    expect(last[1].text).toBe("is square again, so C is moved out again (last day 10 Nov)");
  });

  it("27. N2: a deleted milk charge that the month-end bill still charges is NOT a reason to move C out: C is exactly 0 but stays settling (the 20,000 days come at month end)", async () => {
    const f = await flat("n2milk");
    await toSettling(f);
    // Take everything else off C by hand so only the 20,000 milk charge is left: groceries and rent deleted by A. C -620,000 + 400,000 + 200,000 = -20,000.
    for (const name of ["Groceries", "Rent"]) {
      const e = (await f.live()).find((x) => x.description === name)!;
      expect((await setExpenseDeleted(e.id, f.a, true)).ok).toBe(true);
    }
    expect((await f.nets())[2]).toBe(-20_000);
    expect((await settlingIn(db, f.gid)).has(f.c)).toBe(true);
    // A deletes the charge: C is 0. The milk for 1-10 Nov will be charged to C at month end, and a person who has left can't be charged, so C stays settling.
    const charge = (await f.live()).find((e) => e.description !== "Milk")!;
    expect((await setExpenseDeleted(charge.id, f.a, true)).ok).toBe(true);
    expect((await f.nets())[2]).toBe(0);
    expect((await f.row(f.c)).leftAt).toBeNull();
    expect((await settlingIn(db, f.gid)).has(f.c)).toBe(true);
    // And by hand: refused in plain words (not square for good yet).
    expect(await moveOut(f.gid, f.a, { leaverId: f.c, lastDay: "2026-11-23", requestKey: key() }, at("2026-11-23"))).toEqual({ ok: false, error: settlingNoManualMoveOut("C") });
    // R1: 1 Dec, the bill run adds November's milk with C's days: 180,000 -> days 1-10 three ways (20,000 each), days 11-30 two ways (60,000 each): A 80,000, B 80,000, C 20,000.
    // December's rent (A pays 1,800,000) is A 900,000, B 900,000. A 900,000 - 80,000 = +820,000; B -900,000 + 180,000 - 80,000 = -800,000; C -20,000.
    await runBillsForGroup(f.gid, at("2026-12-01"));
    expect(await f.nets()).toEqual([820_000, -800_000, -20_000]);
    expect((await settlingIn(db, f.gid)).has(f.c)).toBe(true); // owes again: still settling
    // C pays B 20,000: square, and nothing is held back any more (the month is added), so C is moved out again.
    expect(await record(f, f.c, f.b, 20_000)).toMatchObject({ kind: "done" });
    expect((await f.row(f.c)).leftAt?.toISOString()).toBe(LAST);
  });

  it("27b. R1: the hold ends by itself when the month is skipped: the end of a bill run moves a square C out again", async () => {
    const f = await flat("n2skip");
    await toSettling(f);
    for (const name of ["Groceries", "Rent"]) {
      const e = (await f.live()).find((x) => x.description === name)!;
      expect((await setExpenseDeleted(e.id, f.a, true)).ok).toBe(true);
    }
    const charge = (await f.live()).find((e) => e.description !== "Milk")!;
    expect((await setExpenseDeleted(charge.id, f.a, true)).ok).toBe(true);
    expect((await settlingIn(db, f.gid)).has(f.c)).toBe(true); // held: November's milk still has C's days
    const milk = await db.bill.findFirstOrThrow({ where: { groupId: f.gid, name: "Milk" } });
    await db.billRun.create({ data: { billId: milk.id, period: "2026-11", status: "skipped", reason: "" } }); // the month is skipped
    await runBillsForGroup(f.gid, at("2026-11-23")); // nothing is due, but the end of every run looks for people who can go
    expect((await f.row(f.c)).leftAt?.toISOString()).toBe(LAST);
    expect((await settlingIn(db, f.gid)).size).toBe(0);
  });

  it("28. N3: C pays in full and is moved out again; then someone taps 'has moved back in': 'C is square and has moved out again.' (not a quiet success); a member who is in gets a quiet success", async () => {
    const f = await flat("n3");
    await toSettling(f);
    expect(await record(f, f.c, f.a, 620_000)).toMatchObject({ kind: "done" });
    expect((await f.row(f.c)).leftAt?.toISOString()).toBe(LAST);
    expect(await moveBackInFor(f.gid, f.a, f.c, at("2026-11-24"))).toEqual({ ok: false, error: "C is square and has moved out again." });
    expect(await moveBackInFor(f.gid, f.a, f.b, at("2026-11-24"))).toEqual({ ok: true }); // B is a member: nothing to do
    expect((await f.rows("member_rejoined")).filter((e) => e.text.startsWith("noted"))).toHaveLength(0);
    expect((await f.row(f.c)).leftAt?.toISOString()).toBe(LAST);
  });
});

describe("settling up only: round three (who is asked, which way, what is shown)", () => {
  it("29. R2: A moves out himself while C (620,000) is settling: B covers, but B is not the one confirming, so the covering 620,000 is its own payment that WAITS for B (A is not asked about it)", async () => {
    const f = await flat("r2");
    await toSettling(f); // A +1,800,000, B -1,180,000, C -620,000
    const pre = await moveOutPreview(f.gid, f.a, "2026-11-30", at("2026-11-30"), f.a);
    if (!pre.ok) throw new Error(pre.error);
    // A is leaving, so is not staying: B is the default cover. B's own 1,180,000 goes straight to A; the 620,000 for C is separate and asks B.
    expect(pre.payments).toEqual([{ from: f.b, to: f.a, amount: 1_180_000 }, { from: f.b, to: f.a, amount: 620_000, cover: "from" }]);
    expect(pre.waits).toEqual([`${f.b}>${f.a}:cover`]);
    expect(pre.cover).toMatchObject({ asks: true, coverId: f.b, text: "C still owes A ₹6,200. B pays it now, and C then owes B." });
    const out = await moveOut(f.gid, f.a, { leaverId: f.a, lastDay: "2026-11-30", requestKey: key(), expectKey: pre.expectKey }, at("2026-11-30"));
    expect(out).toMatchObject({ ok: true });
    expect(await f.nets()).toEqual([0, 620_000, -620_000]); // B -1,180,000 + 1,800,000; C -620,000
    const cover = await db.payment.findFirstOrThrow({ where: { groupId: f.gid, fromId: f.b, toId: f.a, amount: 620_000, deletedAt: null } });
    const plain = await db.payment.findFirstOrThrow({ where: { groupId: f.gid, fromId: f.b, toId: f.a, amount: 1_180_000, deletedAt: null } });
    expect([cover.needsOk, plain.needsOk]).toEqual([true, false]);
    // B is asked (as the one covering); A, who is paid, is not asked about this one.
    const forB = await waitingForMe(f.gid, f.b);
    expect(forB.map((r) => [r.id, r.asCoverer])).toEqual([[cover.id, true]]);
    expect(await waitingForMe(f.gid, f.a)).toEqual([]);
    expect(await rejectPayment(cover.id, f.a)).toEqual({ ok: false, error: "Only the person asked to cover this can answer it." });
    // B says yes: it stays, and the line says so.
    expect((await confirmPayment(cover.id, f.b)).ok).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: cover.id } })).okAt).not.toBeNull();
    expect((await f.rows("payment_confirmed")).map((e) => e.text)).toEqual(["agreed to cover ₹6,200 for A ✓"]);
    expect(await f.nets()).toEqual([0, 620_000, -620_000]);
  });

  it("30. R2: B says 'I can't cover it': the covering payment comes off, A is back (settling), A +620,000 owed by C, B 0", async () => {
    const f = await flat("r2no");
    await toSettling(f);
    const out = await moveOut(f.gid, f.a, { leaverId: f.a, lastDay: "2026-11-30", requestKey: key() }, at("2026-11-30"));
    expect(out).toMatchObject({ ok: true });
    const cover = await db.payment.findFirstOrThrow({ where: { groupId: f.gid, fromId: f.b, toId: f.a, amount: 620_000, deletedAt: null } });
    const no = await rejectPayment(cover.id, f.b);
    expect(no.ok).toBe(true);
    // Without the cover: A 1,800,000 - 1,180,000 = +620,000, B -1,180,000 + 1,180,000 = 0, C -620,000. A is brought back, settling.
    expect(await f.nets()).toEqual([620_000, 0, -620_000]);
    expect((await f.row(f.a)).leftAt).toBeNull();
    expect([...(await settlingIn(db, f.gid)).keys()].sort()).toEqual([f.a, f.c].sort());
    expect((await f.rows("payment_deleted")).map((e) => e.text)).toContain("can’t cover ₹6,200 for A, so it’s off the balances");
  });

  // C is owed 3,200,000 and settling; B (who owes it) is the one leaving. Hand-worked, no milk:
  //   start A +2,000,000, B -1,000,000, C -1,000,000; taxi 6,000,000 paid by C (2,000,000 each): A 0, B -3,000,000, C +3,000,000;
  //   C moves out on the 10th: rent keeps 200,000 of 600,000, the freed 400,000 is 200,000 each to A and B: A -200,000, B -3,200,000, C +3,400,000;
  //   A pays C 200,000, B pays C 3,200,000; C says Not received about B's: A 0, B -3,200,000, C +3,200,000 (settling).
  //   D (a name with no account) joins in a 90,000 gas bill D paid, shared D and A: D +45,000, A -45,000.
  async function owedSettling(label: string) {
    const f = await flat(label, { milk: false });
    await db.expense.create({
      data: {
        groupId: f.gid, description: "Taxi", category: "other", amount: 6_000_000, paidById: f.c, createdById: f.c, splitType: "equal", forMode: "everyone",
        originalAmount: 6_000_000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 6_000_000, spentAt: new Date("2026-11-02T12:00:00Z"),
        shares: { create: [f.a, f.b, f.c].map((m) => ({ memberId: m, amount: 2_000_000 })) },
      },
    });
    expect(await f.nets()).toEqual([0, -3_000_000, 3_000_000]);
    expect(await moveOut(f.gid, f.b, { leaverId: f.c, lastDay: "2026-11-10", requestKey: key() }, at("2026-11-10"))).toMatchObject({ ok: true });
    const toC = await db.payment.findFirstOrThrow({ where: { groupId: f.gid, fromId: f.b, toId: f.c, deletedAt: null } });
    expect(toC.amount).toBe(3_200_000);
    expect((await rejectPayment(toC.id, f.c)).ok).toBe(true);
    expect(await f.nets()).toEqual([0, -3_200_000, 3_200_000]);
    const d = await db.member.create({ data: { groupId: f.gid, name: "D", createdAt: new Date(2026, 0, 9) } });
    await db.expense.create({
      data: {
        groupId: f.gid, description: "Gas", category: "other", amount: 90_000, paidById: d.id, createdById: d.id, splitType: "equal", forMode: "selected",
        originalAmount: 90_000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 90_000, spentAt: new Date("2026-11-12T12:00:00Z"),
        shares: { create: [f.a, d.id].map((m) => ({ memberId: m, amount: 45_000 })) },
      },
    });
    const net = await checkBooks(f.gid);
    expect([net[f.a], net[f.b], net[f.c], net[d.id]]).toEqual([-45_000, -3_200_000, 3_200_000, 45_000]);
    return { f, d };
  }

  it("31. R3/S4: B (owes 3,200,000, leaving) with C owed 3,200,000 and settling: D (+45,000) has no account so is never the default; A (the stayer with an account) is, and is ASKED; picking D pays D in one payment (nobody to ask)", async () => {
    const { f, d } = await owedSettling("r3");
    // Nobody confirming. B pays D the real 45,000; the other 3,155,000 (what C is owed) goes to the default A, who is asked to take it on.
    const pre = await moveOutPreview(f.gid, f.b, "2026-11-30", at("2026-11-30"), "");
    if (!pre.ok) throw new Error(pre.error);
    expect(pre.cover).toMatchObject({ coverId: f.a, leaverOwed: false, asks: true, amount: 3_155_000, text: "B still owes C ₹31,550. B pays A now, and A then owes C." });
    expect(pre.payments).toEqual([{ from: f.b, to: d.id, amount: 45_000 }, { from: f.b, to: f.a, amount: 3_155_000, cover: "to" }]);
    expect(pre.waits).toEqual([`${f.b}>${f.a}:cover`]);
    // Picking D (a name nobody has joined, so it can't be asked): one payment of 45,000 + 3,155,000 = 3,200,000.
    const picked = await moveOutPreview(f.gid, f.b, "2026-11-30", at("2026-11-30"), "", undefined, d.id);
    if (!picked.ok) throw new Error(picked.error);
    expect(picked.cover).toMatchObject({ asks: false, text: "B still owes C ₹31,550. B pays D now, and D then owes C." });
    expect(picked.payments).toEqual([{ from: f.b, to: d.id, amount: 3_200_000 }]);
    expect(picked.waits).toEqual([]);
  });

  it("32. R3: the leaver-owes direction end to end: A confirms and covers; B 0, A -3,200,000, C +3,200,000, D 0; then A pays C and C is moved out again", async () => {
    const { f, d } = await owedSettling("r3go");
    const out = await moveOut(f.gid, f.a, { leaverId: f.b, lastDay: "2026-11-30", requestKey: key(), coverId: f.a }, at("2026-11-30"));
    expect(out).toMatchObject({ ok: true });
    // B pays D 45,000 and A 3,155,000: B -3,200,000 + 3,200,000 = 0; D +45,000 - 45,000 = 0; A -45,000 - 3,155,000 = -3,200,000; C +3,200,000.
    expect(await f.nets()).toEqual([-3_200_000, 0, 3_200_000]);
    expect((await checkBooks(f.gid))[d.id]).toBe(0);
    expect(await db.payment.count({ where: { groupId: f.gid, deletedAt: null, OR: [{ fromId: f.c }, { toId: f.c }, { fromId: f.b, toId: f.c }] } })).toBe(1); // only A's old 200,000 to C
    expect(await record(f, f.a, f.c, 3_200_000)).toMatchObject({ kind: "done" });
    expect(await f.nets()).toEqual([0, 0, 0]);
    expect((await f.row(f.c)).leftAt?.toISOString()).toBe(LAST);
  });

  // C exactly 0 and settling, held only because November's milk (with C's 10 days) is still to be billed: everything else was deleted by A (as in test 27).
  async function heldAtZero(label: string) {
    const f = await flat(label);
    await toSettling(f);
    for (const name of ["Groceries", "Rent"]) {
      const e = (await f.live()).find((x) => x.description === name)!;
      expect((await setExpenseDeleted(e.id, f.a, true)).ok).toBe(true);
    }
    const charge = (await f.live()).find((e) => e.description !== "Milk")!;
    expect((await setExpenseDeleted(charge.id, f.a, true)).ok).toBe(true);
    expect((await f.nets())[2]).toBe(0);
    expect((await settlingIn(db, f.gid)).has(f.c)).toBe(true);
    return f;
  }

  it("33. S1: after B says 'I can't cover it', A can't bring the covering payment back (Restore payment or Undo); only B can, and then it counts again", async () => {
    const f = await flat("s1");
    await toSettling(f);
    expect(await moveOut(f.gid, f.a, { leaverId: f.a, lastDay: "2026-11-30", requestKey: key() }, at("2026-11-30"))).toMatchObject({ ok: true });
    const cover = await db.payment.findFirstOrThrow({ where: { groupId: f.gid, fromId: f.b, toId: f.a, amount: 620_000, deletedAt: null } });
    expect((await rejectPayment(cover.id, f.b)).ok).toBe(true);
    expect(await f.nets()).toEqual([620_000, 0, -620_000]); // A back, owed 620,000 by C
    const line = await db.groupEvent.findFirstOrThrow({ where: { groupId: f.gid, kind: "payment_deleted", paymentId: cover.id } });
    expect(JSON.parse(line.undo)).toMatchObject({ type: "payment_restore", byPayer: true });
    // A (who is back in the flat, and so a party to the payment) is refused, on the server, in the same words as the screens.
    expect(await setPaymentDeleted(cover.id, f.a, false)).toEqual({ ok: false, error: "Only B can bring this back: they said they can’t cover it." });
    expect((await undoEvent(line.id, f.a)).ok).toBe(false);
    expect((await db.payment.findUniqueOrThrow({ where: { id: cover.id } })).deletedAt).not.toBeNull();
    expect(await f.nets()).toEqual([620_000, 0, -620_000]);
    // B's own restore works: the 620,000 counts again: A +620,000 - 620,000 = 0, B 0 + 620,000, C -620,000 unchanged. A is square, so moved out again.
    expect((await setPaymentDeleted(cover.id, f.b, false)).ok).toBe(true);
    expect(await f.nets()).toEqual([0, 620_000, -620_000]);
    expect((await f.row(f.a)).leftAt).not.toBeNull();
  });

  it("34. S2: while a bill run is ADDING the month that names C, a square check does not move C out", async () => {
    const f = await heldAtZero("s2");
    const milk = await db.bill.findFirstOrThrow({ where: { groupId: f.gid, name: "Milk" } });
    let looked = 0;
    let leftWhileAdding: Date | null = new Date(0);
    await runBillsForGroup(f.gid, at("2026-12-01"), {
      afterRead: async () => {
        const run = await db.billRun.findUnique({ where: { billId_period: { billId: milk.id, period: "2026-11" } } });
        if (run?.status !== "adding") return;
        looked++;
        await squareSettlersNow(f.gid); // the check an expense edit or a payment would run, in the middle of the run
        leftWhileAdding = (await f.row(f.c)).leftAt;
      },
    });
    expect(looked).toBe(1);
    expect(leftWhileAdding).toBeNull(); // still settling: the month being added charges C's days (as test 27: C -20,000 afterwards)
    expect((await f.nets())[2]).toBe(-20_000);
  });

  it("35. S3: Home's Needs you shows the covering question to B (who is asked) and not to A (who is owed)", async () => {
    const f = await flat("s3");
    await toSettling(f);
    expect(await moveOut(f.gid, f.a, { leaverId: f.a, lastDay: "2026-11-30", requestKey: key() }, at("2026-11-30"))).toMatchObject({ ok: true });
    const pay = (u: Awaited<ReturnType<typeof loadNeedsYou>>) => u.items.filter((i) => i.kind === "payment").map((i) => i.text);
    expect(pay(await loadNeedsYou({ [f.gid]: f.b }, null, 0, at("2026-11-30")))).toEqual(["Can you cover this? A is owed ₹6,200"]);
    expect(pay(await loadNeedsYou({ [f.gid]: f.a }, null, 0, at("2026-11-30")))).toEqual([]);
  });

  it("36. S4: when the leaver owes, the covering flatmate is asked too ('Can you take this on?'): B pays D 45,000 and 3,155,000; D says no, B is back owing 3,155,000", async () => {
    const { f, d } = await owedSettling("s4");
    // D joins (gets an account), so can be asked.
    const accD = await db.account.create({ data: { email: `so-D-s4-${stamp}-${++n}@example.test`, name: "D" } });
    accountIds.push(accD.id);
    await db.member.update({ where: { id: d.id }, data: { accountId: accD.id, claimedAt: new Date(2026, 0, 9) } });
    expect(await moveOut(f.gid, f.a, { leaverId: f.b, lastDay: "2026-11-30", requestKey: key(), coverId: d.id }, at("2026-11-30"))).toMatchObject({ ok: true });
    const cover = await db.payment.findFirstOrThrow({ where: { groupId: f.gid, fromId: f.b, toId: d.id, amount: 3_155_000, deletedAt: null } });
    expect(cover.needsOk).toBe(true);
    const forD = await waitingForMe(f.gid, d.id);
    expect(forD.find((r) => r.id === cover.id)).toMatchObject({ asCoverer: true, coverSide: "to" });
    expect((await waitingForMe(f.gid, f.a)).map((r) => r.id)).not.toContain(cover.id);
    const text = (await loadNeedsYou({ [f.gid]: d.id }, null, 0, at("2026-11-30"))).items.filter((i) => i.kind === "payment").map((i) => i.text);
    expect(text).toContain("Can you take this on? B owed ₹31,550");
    expect(await rejectPayment(cover.id, f.a)).toEqual({ ok: false, error: "Only the person asked to take this on can answer it." });
    expect((await rejectPayment(cover.id, d.id)).ok).toBe(true);
    // The 3,155,000 comes off: A -45,000 (unchanged), B -3,200,000 + 45,000 = -3,155,000 (back in the flat, settling), C +3,200,000, D 45,000 - 45,000 = 0.
    expect(await f.nets()).toEqual([-45_000, -3_155_000, 3_200_000]);
    expect((await checkBooks(f.gid))[d.id]).toBe(0);
    expect((await f.row(f.b)).leftAt).toBeNull();
    expect((await f.rows("payment_deleted")).map((e) => e.text)).toContain("can’t take on ₹31,550 from B, so it’s off the balances");
  });

  it("37. S4: if nobody staying has joined, there is no default cover and nothing is recorded (the refusal says why)", async () => {
    const { f } = await owedSettling("s4none");
    await db.member.update({ where: { id: f.a }, data: { accountId: null } }); // A has no account either: D and A are both just names
    const pre = await moveOutPreview(f.gid, f.b, "2026-11-30", at("2026-11-30"), "");
    expect(pre).toEqual({ ok: false, error: "B can’t be squared up yet: C moved out earlier and is still settling up, and nobody staying has joined Loopin to cover it. Once they’re square, or a flatmate joins, try again." });
    const out = await moveOut(f.gid, f.a, { leaverId: f.b, lastDay: "2026-11-30", requestKey: key() }, at("2026-11-30"));
    expect(out).toMatchObject({ ok: true }); // A is confirming and stays, so A is the default cover (as before)
  });

  it("38. S5: a settling person at 0 is 'held' while a month still to be billed names them, and not once that month is skipped", async () => {
    const f = await heldAtZero("s5");
    expect(await settlingHeld(db, f.gid, f.c)).toBe(true);
    const milk = await db.bill.findFirstOrThrow({ where: { groupId: f.gid, name: "Milk" } });
    await db.billRun.create({ data: { billId: milk.id, period: "2026-11", status: "skipped", reason: "" } });
    expect(await settlingHeld(db, f.gid, f.c)).toBe(false);
  });
});

// One step = one transaction: these read the code, because a lost connection can only be shown by the shape of the write.
describe("settling up only: one step", () => {
  const src = (p: string) => readFileSync(p, "utf8");
  it("15. the bring-back (flag + row + line) is one write inside the caller's transaction; the move-out-again is called from the ONE place every payment is made or put back, in the same transaction", () => {
    const change = src("src/lib/payment-change.ts");
    expect(change).toMatch(/settling: true \}/);
    expect(change).toMatch(/bringBackLeavers\(tx: Tx/);
    const pay = src("src/lib/payments.ts");
    expect(pay).toMatch(/moveOutAgainIfSquare\(tx, p\.groupId, \[p\.fromId, p\.toId\]\)/); // createPayment
    expect(pay).toMatch(/moveOutAgainIfSquare\(tx, g,/); // restorePayments
    // No payment path calls it on its own any more (none can forget it, none can do it twice).
    for (const file of ["src/lib/pay-record.ts", "src/lib/pay-link.ts", "src/lib/settle-all.ts", "src/lib/cross-settle-db.ts", "src/lib/convert-claims.ts", "src/lib/payment-change.ts"]) {
      expect(src(file), file).not.toMatch(/moveOutAgainIfSquare\(/);
    }
    // And they all really use the two shared functions (undo / redo of Settle everything and Mark all paid included).
    expect(src("src/lib/settle-all.ts")).toMatch(/restorePayments\(tx/);
    expect(src("src/lib/payment-change.ts")).toMatch(/restorePayments\(tx/);
    // The move-out itself is written with the same transaction client as the payment (never the shared connection).
    expect(src("src/lib/settling-db.ts")).toMatch(/export async function moveOutAgainIfSquare\(tx: Prisma\.TransactionClient/);
  });

  it("16. the screens that list people leave C out: the Add expense page (people, weights, prefilled waiting bill) and the bill pages", () => {
    const add = src("src/app/groups/[id]/add/page.tsx");
    expect(add).toMatch(/members: group\.members\.filter\(\(m\) => !m\.leftAt && !settling\.has\(m\.id\)\)/);
    expect(add).toMatch(/weights: Object\.fromEntries\(group\.members\.filter\(\(m\) => !m\.leftAt && !settling\.has\(m\.id\)\)/);
    expect(add).toMatch(/withSettlingLeft\(group\.members, settling, \{ dailyMonth: period \}\)/);
    expect(src("src/app/groups/[id]/bills/[billId]/page.tsx")).toMatch(/!settling\.has\(m\.id\)/);
    expect(src("src/app/groups/[id]/bills/new/page.tsx")).toMatch(/!settling\.has\(m\.id\)/);
  });
});
