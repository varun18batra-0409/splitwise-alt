import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// M-2: recording, deleting or bringing back payments has a per-person limit of 60 changes an hour, with a clear message.
// (The payment-alert limit for blocked pairs is tested with the blocking tests in policy-report-block.test.ts.)
const { db } = await import("@/lib/db");
const { payChangeOk, PAY_CHANGE_LIMIT_TEXT, PAY_CHANGES_PER_HOUR } = await import("@/lib/pay-limit");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const keys: string[] = [];
afterAll(async () => {
  await db.rateLimit.deleteMany({ where: { key: { in: keys } } });
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
    // removePayment, restorePayment, recordCustomPayment, settleEverything and settleAcrossGroups
    expect(actions.match(/payChangeOk\(/g)?.length).toBe(5);
    expect(actions.indexOf("payChangeOk(memberships[groupId])")).toBeLessThan(actions.indexOf("await deletePayment("));
    expect(actions.indexOf("payChangeOk(myId))) back(")).toBeLessThan(actions.indexOf("await recordPaymentCore("));
    expect(readFileSync("src/app/pay-actions.ts", "utf8")).toContain("payChangeOk(myId)");
    expect(readFileSync("src/app/settle/page.tsx", "utf8")).toContain('notice === "busy"');
  });
});
