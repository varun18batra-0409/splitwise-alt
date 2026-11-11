import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { markAllPaid } from "@/lib/settle-all";
import { claimKey, cleanKey, fingerprintOf, keyState, KEY_FRESH_MS, newRequestKey, STALE_KEY_ERROR } from "@/lib/once";
import type { RateAnswer } from "@/lib/rate-cache";

// The Back button can bring back a form holding a key that was already used.
// A key means "the same request again" only if the request is for the same thing
// (its fingerprint) and the key is under 2 minutes old; otherwise nothing is saved.
//
// Hand-worked: B paid ₹1,000 (100000) split equally between A and B, so A owes B ₹500 = 50000.

let groupId = "";
let a = "", b = "";
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const keys: string[] = [];
const newKey = (tag: string) => {
  const k = `rk-${tag}-${stamp}-0000`;
  keys.push(k);
  return k;
};
const rate = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-10-14" });
const input = (): SaveExpenseInput => ({
  groupId, name: "Dinner", category: "", amount: "1000", currency: "INR", paidById: b, forMode: "everyone",
  selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
  markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "",
});
const payments = () => db.payment.count({ where: { groupId, deletedAt: null } });

beforeAll(async () => {
  const g = await db.group.create({
    data: { name: "Request key test", currency: "INR", inviteCode: `rk-${stamp}`, members: { create: [{ name: "A" }, { name: "B" }] } },
    include: { members: true },
  });
  groupId = g.id;
  a = g.members.find((m) => m.name === "A")!.id;
  b = g.members.find((m) => m.name === "B")!.id;
  const r = await saveExpense(input(), b, rate);
  if (!r.ok) throw new Error(r.error);
});

afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { in: keys } } });
  await db.groupEvent.deleteMany({ where: { groupId } });
  await db.payment.deleteMany({ where: { groupId } });
  await db.expenseShare.deleteMany({ where: { expense: { groupId } } });
  await db.expense.deleteMany({ where: { groupId } });
  await db.member.deleteMany({ where: { groupId } });
  await db.group.delete({ where: { id: groupId } });
});

describe("fingerprint", () => {
  it("same parts agree; a different amount or a shifted boundary differs", () => {
    expect(fingerprintOf("pay", "g", "a", "b", 50000)).toBe(fingerprintOf("pay", "g", "a", "b", 50000));
    expect(fingerprintOf("pay", "g", "a", "b", 50000)).not.toBe(fingerprintOf("pay", "g", "a", "b", 60000));
    expect(fingerprintOf("ab", "c")).not.toBe(fingerprintOf("a", "bc"));
  });
});

describe("the same key reused (Back button)", () => {
  it("K then K again moments later: the payment is recorded once, second says ok", async () => {
    const K = newKey("same");
    const pick = [{ from: a, to: b, amount: 50000 }];
    const first = await markAllPaid(groupId, a, pick, "", true, K);
    expect(first.ok).toBe(true);
    expect(await payments()).toBe(1);
    const row = await db.requestKey.findUniqueOrThrow({ where: { key: K } });
    expect(row.fingerprint).not.toBe("");
    // 5 seconds later (a retry), same payload.
    expect(await keyState(K, row.fingerprint, new Date(row.createdAt.getTime() + 5_000))).toEqual({ state: "done", result: "paid" });
    const again = await markAllPaid(groupId, a, pick, "", true, K);
    expect(again.ok).toBe(true);
    expect(await payments()).toBe(1);
  });

  it("K with a different amount (₹600 = 60000): stale, nothing saved, still 1 payment", async () => {
    const K = keys[keys.length - 1];
    const r = await markAllPaid(groupId, a, [{ from: a, to: b, amount: 60000 }], "", false, K);
    expect(r).toEqual({ ok: false, error: STALE_KEY_ERROR });
    expect(await payments()).toBe(1);
  });

  it("K with the same payload after 3 minutes: stale, still 1 payment", async () => {
    const K = keys[keys.length - 1];
    await db.requestKey.update({ where: { key: K }, data: { createdAt: new Date(Date.now() - 3 * 60_000) } });
    const r = await markAllPaid(groupId, a, [{ from: a, to: b, amount: 50000 }], "", true, K);
    expect(r).toEqual({ ok: false, error: STALE_KEY_ERROR });
    expect(await payments()).toBe(1);
  });

  it("the edge: just under 2 minutes still counts as the same request; exactly 2 minutes does not", async () => {
    const K = newKey("edge");
    const fp = fingerprintOf("x", 1);
    await db.$transaction((tx) => claimKey(tx, K, "r1", fp));
    const t0 = (await db.requestKey.findUniqueOrThrow({ where: { key: K } })).createdAt.getTime();
    expect((await keyState(K, fp, new Date(t0 + KEY_FRESH_MS - 1))).state).toBe("done");
    expect((await keyState(K, fp, new Date(t0 + KEY_FRESH_MS))).state).toBe("stale");
  });

  it("callers without a fingerprint keep the old behaviour, and old rows (no fingerprint) are 'done'", async () => {
    const K = newKey("old");
    await db.$transaction((tx) => claimKey(tx, K, "r2")); // saved without a fingerprint
    const oldTime = new Date(Date.now() + 10 * 60_000);
    expect(await keyState(K, "", oldTime)).toEqual({ state: "done", result: "r2" });
    expect(await keyState(K, fingerprintOf("anything"), oldTime)).toEqual({ state: "done", result: "r2" });
    expect(await keyState(newKey("none"), fingerprintOf("a"))).toEqual({ state: "new" });
    expect(await keyState(undefined, fingerprintOf("a"))).toEqual({ state: "new" });
  });
});

// The form carries a real key from the first byte of the page (the server makes it; the browser swaps it for a
// fresh one once the screen is up). So a form sent before the screen has finished loading still works.
describe("submitting with the server-made key", () => {
  it("the key the server puts in the page is one the actions accept, and a different one each time", () => {
    const k = newRequestKey();
    expect(cleanKey(k)).toBe(k);
    expect(newRequestKey()).not.toBe(k);
  });

  it("a payment sent with it is recorded once; the same form sent again is not recorded twice", async () => {
    const K = newRequestKey();
    keys.push(K);
    const before = await payments();
    const pick = [{ from: a, to: b, amount: 20000 }];
    expect((await markAllPaid(groupId, a, pick, "", false, cleanKey(K))).ok).toBe(true);
    expect(await payments()).toBe(before + 1);
    expect((await markAllPaid(groupId, a, pick, "", false, cleanKey(K))).ok).toBe(true);
    expect(await payments()).toBe(before + 1);
  });
});
