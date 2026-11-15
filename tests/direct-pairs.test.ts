import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { ensureAccountPair, ensureLocalPair, directEntries, hasHistory, filterDirect } from "@/lib/direct-db";
import { accountPairKey, localPairKey } from "@/lib/direct";
import { saveExpense, setExpenseDeleted, type SaveExpenseInput } from "@/lib/save-expense";
import { undoEvent } from "@/lib/undo";
import { loadGroup, loadMyGroupsLight, loadNotifications } from "@/lib/group-data";
import { settleAcrossCore } from "@/lib/cross-settle-db";
import { recordPaymentCore } from "@/lib/pay-record";
import { rejectPayment } from "@/lib/payment-ok";
import { loadNeedsYou } from "@/lib/needs-you";
import type { RateAnswer } from "@/lib/rate-cache";
import { mkAccount, mkSharedGroup, stamp, wipe } from "./helpers/direct-fixtures";

vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));


// Expenses with one person: the hidden two-person group. Hand-worked in paise. A = Asha (first member), R = Rohan (account B).
//   E1: Asha pays 120000, equal -> 60000 each: R -60000.
//   E2: Rohan pays 90000, equal -> 45000 each: R +90000 -45000 = +45000, so R is -60000 +45000 = -15000.
//   E1 edited to 100000 (50000 each): R -50000 +45000 = -5000.
//   E2 deleted: R -50000.  Undo: -5000.  Rohan pays Asha 5000: both 0.

const rate = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-11-15" });
let A = "", B = "", C = "";
let pairId = "", aRow = "", rRow = "";
let e1 = "", e2 = "";
const key = (n: string) => `dp-${stamp}-${n}`; // 16 to 64 letters, digits and dashes

const draft = (over: Partial<SaveExpenseInput>): SaveExpenseInput => ({
  groupId: pairId, name: "Dinner", category: "", amount: "1200", currency: "INR", paidById: aRow, forMode: "everyone",
  selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
  markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
});
const netOf = async (id: string) => (await loadGroup(id))!.net;
const sum = (n: Record<string, number>) => Object.values(n).reduce((s, x) => s + x, 0);

beforeAll(async () => {
  process.env.MAIL_OUTBOX = "1";
  A = (await mkAccount("asha", "Asha")).id;
  B = (await mkAccount("rohan", "Rohan")).id;
  C = (await mkAccount("carl", "Carl")).id;
  await mkSharedGroup("ab", [{ id: A, name: "Asha" }, { id: B, name: "Rohan" }]);
});
afterAll(async () => {
  await db.block.deleteMany({ where: { OR: [{ blockerId: { in: [A, B, C] } }, { blockedId: { in: [A, B, C] } }] } });
  await wipe([A, B, C]);
});

describe("starting a pair", () => {
  it("1. the same pair from both sides, at the same moment, is one group with two members", async () => {
    const [x, y, z] = await Promise.all([
      ensureAccountPair({ id: A }, B, { currency: "INR", myName: "Asha" }),
      ensureAccountPair({ id: A }, B, { currency: "INR", myName: "Asha" }),
      ensureAccountPair({ id: B }, A, { currency: "INR", myName: "Rohan" }),
    ]);
    if (!x.ok || !y.ok || !z.ok) throw new Error("a pair was refused");
    expect(new Set([x.groupId, y.groupId, z.groupId]).size).toBe(1);
    pairId = x.groupId;
    aRow = x.myId;
    rRow = x.otherId;
    expect(z.myId).toBe(rRow); // Rohan's own row, seen from his side
    expect(await db.group.count({ where: { pairKey: accountPairKey(A, B) } })).toBe(1);
    const g = await db.group.findUnique({ where: { id: pairId }, include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } } });
    expect(g!.type).toBe("direct");
    expect(g!.members.map((m) => m.accountId)).toEqual([A, B]); // the one who started is first
    expect(await db.groupEvent.count({ where: { groupId: pairId } })).toBe(0); // nothing is logged, so nobody is told
  });

  it("2. a name only you can see: 'Rohan' and 'rohan ' are the same person", async () => {
    const [x, y] = await Promise.all([ensureLocalPair({ id: A }, "Rohan", { currency: "INR", myName: "Asha" }), ensureLocalPair({ id: A }, "rohan ", { currency: "INR", myName: "Asha" })]);
    if (!x.ok || !y.ok) throw new Error("refused");
    expect(x.groupId).toBe(y.groupId);
    const g = await db.group.findUnique({ where: { id: x.groupId }, include: { members: true } });
    expect(g!.pairKey).toBe(localPairKey(A, "Rohan"));
    expect(g!.members.filter((m) => m.accountId).map((m) => m.accountId)).toEqual([A]); // the other row has no account: only A can ever see it
    expect(await db.group.count({ where: { pairKey: localPairKey(A, "rohan") } })).toBe(1);
  });

  it("someone you share no group with can't be started (and nothing is made)", async () => {
    const r = await ensureAccountPair({ id: A }, C, { currency: "INR", myName: "Asha" });
    expect(r.ok).toBe(false);
    expect(await db.group.count({ where: { pairKey: accountPairKey(A, C) } })).toBe(0);
    expect((await ensureAccountPair({ id: A }, A, { currency: "INR", myName: "Asha" })).ok).toBe(false); // not yourself
  });

  it("someone who blocked you can't be started either", async () => {
    await db.block.create({ data: { blockerId: C, blockedId: A } });
    const shared = await mkSharedGroup("ac", [{ id: A, name: "Asha" }, { id: C, name: "Carl" }]);
    expect(shared.id).toBeTruthy();
    const r = await ensureAccountPair({ id: A }, C, { currency: "INR", myName: "Asha" });
    expect(r.ok).toBe(false);
    await db.block.deleteMany({ where: { blockerId: C } });
  });
});

describe("money in a pair: the ordinary group maths", () => {
  it("3. two saves with the same request key make one expense", async () => {
    const same = draft({ requestKey: key("e1-request") });
    const [r1, r2] = await Promise.all([saveExpense(same, aRow, rate, { requestKey: same.requestKey }), saveExpense(same, aRow, rate, { requestKey: same.requestKey })]);
    expect([r1, r2].some((r) => r.ok)).toBe(true);
    expect(await db.expense.count({ where: { groupId: pairId, deletedAt: null } })).toBe(1);
    e1 = (await db.expense.findFirst({ where: { groupId: pairId } }))!.id;
  });

  it("4. E1 then E2: R is -60000, then -15000; still one pair; shares add up; the two balances add up to 0", async () => {
    let net = await netOf(pairId);
    expect(net[rRow]).toBe(-60000);
    const r2 = await saveExpense(draft({ name: "Taxi", amount: "900", paidById: rRow, requestKey: key("e2-request") }), rRow, rate, { requestKey: key("e2-request") });
    if (!r2.ok) throw new Error(r2.error);
    e2 = r2.id;
    net = await netOf(pairId);
    expect(net[rRow]).toBe(-15000);
    expect(net[aRow]).toBe(15000);
    expect(sum(net)).toBe(0);
    for (const e of await db.expense.findMany({ where: { groupId: pairId }, include: { shares: true } })) {
      expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(e.amount);
    }
    expect(await db.group.count({ where: { pairKey: accountPairKey(A, B) } })).toBe(1);
  });

  it("5. editing E1 to ₹1,000 makes R -5000", async () => {
    const r = await saveExpense(draft({ amount: "1000", expenseId: e1 }), aRow, rate, { requestKey: key("e1-edit-request") });
    if (!r.ok) throw new Error(r.error);
    const net = await netOf(pairId);
    expect(net[rRow]).toBe(-5000);
    expect(sum(net)).toBe(0);
  });

  it("6. deleting E2 makes R -50000; Undo brings -5000 back", async () => {
    const del = await setExpenseDeleted(e2, rRow, true);
    if (!del.ok) throw new Error(del.error);
    expect((await netOf(pairId))[rRow]).toBe(-50000);
    const undone = await undoEvent(del.eventId!, rRow);
    expect(undone.ok).toBe(true);
    const net = await netOf(pairId);
    expect(net[rRow]).toBe(-5000);
    expect(sum(net)).toBe(0);
  });

  it("7. Rohan pays Asha 5000: both 0, 'All settled', and the history is kept (2 expenses + 1 payment)", async () => {
    const out = await settleAcrossCore([{ groupId: pairId, fromId: rRow, toId: aRow, amount: 5000 }], { [pairId]: rRow }, key("settle-request"));
    expect(out).toBe("done");
    const net = await netOf(pairId);
    expect(net[aRow]).toBe(0);
    expect(net[rRow]).toBe(0);
    expect(await db.expense.count({ where: { groupId: pairId, deletedAt: null } })).toBe(2);
    expect(await db.payment.count({ where: { groupId: pairId, deletedAt: null } })).toBe(1);
    const text = (await db.groupEvent.findMany({ where: { groupId: pairId, kind: "payment_recorded" } })).map((e) => e.text).join("|");
    expect(text).not.toContain("Smart Settle across groups"); // a pair's payment is not worded as a cross-group one
  });

  it("8. a settled person is still listed, and the name search 'roh' finds them", async () => {
    const rows = await loadMyGroupsLight({ [pairId]: aRow }, { includeDirect: true });
    const entries = directEntries(rows);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ groupId: pairId, net: 0, shared: true, expenseCount: 2, paymentCount: 1, currency: "INR" });
    expect(entries[0].other.name).toBe("Rohan");
    expect(hasHistory(entries[0])).toBe(true);
    expect(filterDirect(entries, { show: "settled", q: "roh" })).toHaveLength(1);
    expect(filterDirect(entries, { show: "open", q: "roh" })).toHaveLength(0); // settled people are not "open"
    expect(filterDirect(entries, { show: "all", q: "xyz" })).toHaveLength(0);
  });

  it("an empty pair has no history (so Settle and Home leave it out)", async () => {
    const made = await ensureLocalPair({ id: A }, "Empty Eve", { currency: "INR", myName: "Asha" });
    if (!made.ok) throw new Error("refused");
    const entry = directEntries(await loadMyGroupsLight({ [made.groupId]: made.myId }, { includeDirect: true }))[0];
    expect(entry.net).toBe(0);
    expect(hasHistory(entry)).toBe(false);
  });
});

describe("recording a payment in a pair", () => {
  it("9. A records paying B: it counts, B's Needs you shows it, and B's Not received reverses it", async () => {
    const pay = await recordPaymentCore({ groupId: pairId, fromId: aRow, toId: rRow, amount: 3000, currency: "INR", myId: aRow, key: key("pay-b"), fp: "fp-pay-b", warnOver: false });
    expect(pay.kind).toBe("done");
    expect((await netOf(pairId))[aRow]).toBe(3000); // it counts straight away
    const p = (await db.payment.findFirst({ where: { groupId: pairId, deletedAt: null, okAt: null, needsOk: true } }))!;
    expect(p.amount).toBe(3000);
    const needs = await loadNeedsYou({ [pairId]: rRow }, { id: B }, 0);
    const mine = needs.items.find((i) => i.id === `payment:${p.id}`);
    expect(mine?.where).toBe("Direct");
    expect(mine?.href).toBe(`/people/${pairId}`);
    const no = await rejectPayment(p.id, rRow);
    expect(no.ok).toBe(true);
    const net = await netOf(pairId);
    expect(net[aRow]).toBe(0);
    expect(net[rRow]).toBe(0);
    expect(sum(net)).toBe(0);
  });

  it("A records paying a name-only person: nothing waits for anyone", async () => {
    const local = await ensureLocalPair({ id: A }, "Quiet Quinn", { currency: "INR", myName: "Asha" });
    if (!local.ok) throw new Error("refused");
    const r = await recordPaymentCore({ groupId: local.groupId, fromId: local.myId, toId: local.otherId, amount: 1000, currency: "INR", myId: local.myId, key: key("pay-q"), fp: "fp-pay-q", warnOver: false });
    expect(r.kind).toBe("done");
    expect(await db.payment.count({ where: { groupId: local.groupId, needsOk: true } })).toBe(0);
    expect((await netOf(local.groupId))[local.myId]).toBe(1000);
  });
});

describe("what other people are told", () => {
  it("a pair's changes show up as 'Direct' in the other person's updates", async () => {
    const n = await loadNotifications({ [pairId]: rRow });
    expect(n.items.length).toBeGreaterThan(0);
    expect(n.items.every((i) => i.groupName === "Direct" && i.direct)).toBe(true);
    });
});
