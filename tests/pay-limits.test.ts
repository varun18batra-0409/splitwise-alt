import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// M-2: recording, deleting or bringing back payments has a per-person limit of 60 changes an hour, with a clear message.
// (The payment-alert limit for blocked pairs is tested with the blocking tests in policy-report-block.test.ts.)
const { db } = await import("@/lib/db");
const { payChangeOk, PAY_CHANGE_LIMIT_TEXT, PAY_CHANGES_PER_HOUR, isPaymentChangeEvent } = await import("@/lib/pay-limit");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const keys: string[] = [];
afterAll(async () => {
  await db.rateLimit.deleteMany({ where: { key: { in: keys } } });
});

describe("which history lines count as payment changes (for Undo and Redo)", () => {
  it("payments, whole settle-ups and anything pointing at payments count; expenses and people do not", () => {
    expect(isPaymentChangeEvent({ kind: "payment_recorded" })).toBe(true);
    expect(isPaymentChangeEvent({ kind: "payment_deleted", paymentId: "p1" })).toBe(true);
    expect(isPaymentChangeEvent({ kind: "payment_restored" })).toBe(true);
    expect(isPaymentChangeEvent({ kind: "group_settled_closed" })).toBe(true);
    expect(isPaymentChangeEvent({ kind: "something_else", undo: '{"type":"payments_set","paymentIds":["a","b"]}' })).toBe(true);
    expect(isPaymentChangeEvent({ kind: "something_else", undo: '{"type":"x","paymentId":"a"}' })).toBe(true);
    expect(isPaymentChangeEvent({ kind: "expense_added", undo: '{"type":"expense_delete","expenseId":"e1"}' })).toBe(false);
    expect(isPaymentChangeEvent({ kind: "members_added", undo: "" })).toBe(false);
    expect(isPaymentChangeEvent({ kind: "expense_edited", paymentId: null, undo: null })).toBe(false);
  });
});

describe("payment changes per person", () => {
  it("the 60th change in an hour is allowed, the 61st is refused, and another person is not affected", async () => {
    expect(PAY_CHANGES_PER_HOUR).toBe(60);
    const me = `pl-${stamp}-a`;
    const other = `pl-${stamp}-b`;
    keys.push(`pay-change:${me}`, `pay-change:${other}`);
    for (let i = 1; i <= 60; i++) expect(await payChangeOk(me), `change ${i}`).toBe(true);
    expect(await payChangeOk(me)).toBe(false);
    expect((await db.rateLimit.findUnique({ where: { key: `pay-change:${me}` } }))?.count).toBe(60);
    expect(await payChangeOk(other)).toBe(true);
  });

  it("the message is the plain one", () => {
    expect(PAY_CHANGE_LIMIT_TEXT).toBe("Too many changes in a short time. Try again in a few minutes.");
  });

  it("every place that records, deletes or restores a payment checks it before changing anything", () => {
    const actions = readFileSync("src/app/actions.ts", "utf8");
    // removePayment, restorePayment, undoChange (payment events only), recordCustomPayment, settleEverything and settleAcrossGroups
    expect(actions.match(/payChangeOk\(/g)?.length).toBe(6);
    expect(actions.indexOf("isPaymentChangeEvent(ev) && memberships[groupId] && !(await payChangeOk(")).toBeLessThan(actions.indexOf("await undoEvent("));
    expect(actions.indexOf("payChangeOk(memberships[groupId])")).toBeLessThan(actions.indexOf("await deletePayment("));
    expect(actions.indexOf("payChangeOk(myId))) back(")).toBeLessThan(actions.indexOf("await recordPaymentCore("));
    const pay = readFileSync("src/app/pay-actions.ts", "utf8");
    expect(pay.match(/payChangeOk\(myId\)/g)?.length).toBe(2); // "Not received" and "Mark all paid"
    expect(pay.indexOf("payChangeOk(myId)")).toBeLessThan(pay.indexOf("await rejectPayment("));
    const pot = readFileSync("src/app/pot-actions.ts", "utf8");
    expect(pot.indexOf("payChangeOk(myId)")).toBeLessThan(pot.indexOf("await markGamePaid("));
    expect(readFileSync("src/app/settle/page.tsx", "utf8")).toContain('notice === "busy"');
  });
});
