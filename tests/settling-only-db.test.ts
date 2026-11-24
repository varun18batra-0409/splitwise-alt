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
const { saveExpense, setPaymentDeleted } = await import("@/lib/save-expense");
const { settlingIn } = await import("@/lib/settling-db");
const { SETTLING_SELF, settlingNamed } = await import("@/lib/settling");
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

  it("3. “moved back in” on 15 Dec instead: C is a member again from that day. Dec milk 186,000 -> A 76,000, B 76,000, C 34,000 (17 days x 2,000); Dec rent stays without C; January's rent has C", async () => {
    const f = await flat("backin");
    await toSettling(f);
    await runBillsForGroup(f.gid, at("2026-12-01")); // Nov milk (A 80,000, B 80,000) and Dec rent (A 900,000, B 900,000)
    expect(await f.nets()).toEqual([2_620_000, -2_000_000, -620_000]);
    const r = await moveBackInFor(f.gid, f.c, f.c, "2026-12-15", at("2026-12-15"));
    expect(r.ok).toBe(true);
    expect((await settlingIn(db, f.gid)).size).toBe(0);
    expect((await f.row(f.c)).joinedFrom?.toISOString().slice(0, 10)).toBe("2026-12-15");
    const line = (await f.rows("member_rejoined")).find((e) => e.text.startsWith("moved back in"))!;
    expect(line.text).toBe("moved back in on 15 Dec");
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
    // Asking again does nothing (they are a member now).
    expect((await moveBackInFor(f.gid, f.a, f.c, "2026-12-16", at("2026-12-16"))).ok).toBe(false);
  });

  it("4. the date for moving back in must be after the last day (10 Nov) and a real date", async () => {
    const f = await flat("backdate");
    await toSettling(f);
    expect(await moveBackInFor(f.gid, f.a, f.c, "2026-11-10", at("2026-11-23"))).toMatchObject({ ok: false });
    expect(await moveBackInFor(f.gid, f.a, f.c, "2026-02-30", at("2026-11-23"))).toMatchObject({ ok: false });
    expect(await moveBackInFor(f.gid, f.a, f.b, "2026-11-23", at("2026-11-23"))).toMatchObject({ ok: false }); // B is not settling
    expect((await settlingIn(db, f.gid)).has(f.c)).toBe(true);
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
  it("10. 'Not received' twice (a double tap) writes one bring-back line", async () => {
    const f = await flat("twice");
    const pay = await toSettling(f);
    await Promise.allSettled([rejectPayment(pay.id, f.a), rejectPayment(pay.id, f.a)]); // the same "Not received" again, at the same moment
    expect((await f.rows("member_rejoined")).filter((e) => e.undo.includes('"settling":true'))).toHaveLength(1);
  });

  it("11. a page left open naming C: C is brought back while A is saving, so the save is refused (exact words) and nothing is written", async () => {
    const f = await flat("leftopen");
    // C moved out and is back in the gap (the bring-back line is written after the form was checked, before the write).
    const before = (await f.live()).length;
    const r = await saveExpense(input(f, f.a, { forMode: "selected", selected: [f.a, f.c] }), f.a, rate1, {
      afterRead: async () => {
        await db.groupEvent.create({
          data: { groupId: f.gid, actorId: f.a, kind: "member_rejoined", text: "brought C back into the flat until the ₹100 is sorted", touches: f.c, undo: JSON.stringify({ type: "member_set", memberId: f.c, data: { leftAt: LAST }, settling: true }) },
        });
      },
    });
    expect(r).toEqual({ ok: false, error: settlingNamed("C") });
    expect((await f.live()).length).toBe(before);
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

// One step = one transaction: these read the code, because a lost connection can only be shown by the shape of the write.
describe("settling up only: one step", () => {
  const src = (p: string) => readFileSync(p, "utf8");
  it("15. the bring-back (flag + row + line) is one write inside the caller's transaction; every payment path moves a squared person out again in the same transaction", () => {
    const change = src("src/lib/payment-change.ts");
    expect(change).toMatch(/settling: true \}/);
    expect(change).toMatch(/bringBackLeavers\(tx: Tx/);
    for (const file of ["src/lib/pay-record.ts", "src/lib/pay-link.ts", "src/lib/settle-all.ts", "src/lib/cross-settle-db.ts", "src/lib/convert-claims.ts"]) {
      expect(src(file), file).toMatch(/moveOutAgainIfSquare\(tx,/);
    }
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
