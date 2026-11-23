import { afterAll, describe, expect, it, vi } from "vitest";

// M5: an "I've paid" link reads who owes whom in the same member order as the page does. The settle plan's exact-match pass depends on
// that order, so reading the members in another order could refuse a payment the page showed.
// Hand-worked: X owes 50,000 (to P), Y owes 50,000 (to Q), P is owed 50,000, Q is owed 50,000.
// Page order (oldest first): X, Y, P, Q. The first debtor X is matched with the first creditor of the same size: P. So X -> P and Y -> Q;
// X -> Q is 0. The rows are inserted Q, P, X, Y: reading them in that order would have matched X with Q.

vi.mock("@/lib/push", async (orig) => ({ ...(await orig<typeof import("@/lib/push")>()), sendPushTo: async () => 1 }));
process.env.MAIL_OUTBOX = "1";
const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { loadGroup } = await import("@/lib/group-data");
const { owedInTx, payLinkFor, readPayLink, recordLinkPayment } = await import("@/lib/pay-link");
const { checkBooks } = await import("./helpers/money-invariants");

const groups: string[] = [];
afterAll(async () => {
  await eraseGroups(groups);
});

describe("owedInTx matches the page whatever order the rows were written in", () => {
  it("X -> P 50,000, Y -> Q 50,000, X -> Q 0; recording X -> P succeeds; X and P end at 0 (Y still owes Q)", async () => {
    const g = await db.group.create({
      data: { name: "Order", type: "trip", currency: "INR", inviteCode: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, members: { create: [
        { name: "Q", createdAt: new Date(2026, 0, 4), claimedAt: new Date() },
        { name: "P", createdAt: new Date(2026, 0, 3), claimedAt: new Date() },
        { name: "X", createdAt: new Date(2026, 0, 1), claimedAt: new Date() },
        { name: "Y", createdAt: new Date(2026, 0, 2), claimedAt: new Date() },
      ] } },
      include: { members: true },
    });
    groups.push(g.id);
    const id = (n: string) => g.members.find((m) => m.name === n)!.id;
    const [X, Y, P, Q] = [id("X"), id("Y"), id("P"), id("Q")];
    const mk = (paidById: string, ower: string) =>
      db.expense.create({ data: { groupId: g.id, description: "Dinner", amount: 50000, paidById, createdById: paidById, splitType: "exact", forMode: "selected", category: "food", originalAmount: 50000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 50000, shares: { create: [{ memberId: ower, amount: 50000 }] } } });
    await mk(P, X);
    await mk(Q, Y);
    const net = await checkBooks(g.id);
    expect([net[X], net[Y], net[P], net[Q]]).toEqual([-50000, -50000, 50000, 50000]);

    const page = (await loadGroup(g.id, { events: false }))!.transfers;
    expect(page).toEqual([{ from: X, to: P, amount: 50000 }, { from: Y, to: Q, amount: 50000 }]);
    const owed = (a: string, b: string) => db.$transaction((tx) => owedInTx(tx, g.id, a, b));
    expect([await owed(X, P), await owed(Y, Q), await owed(X, Q), await owed(Y, P)]).toEqual([50000, 50000, 0, 0]);

    const token = await payLinkFor(g.id, X, P, X);
    const s = await readPayLink(token);
    if (s.kind !== "owes") throw new Error("expected owes");
    expect(s.amount).toBe(50000);
    expect(await recordLinkPayment({ link: s.link, amount: s.amount, currency: "INR", toName: "P" })).toBe(true);
    const after = await checkBooks(g.id);
    expect([after[X], after[Y], after[P], after[Q]]).toEqual([0, -50000, 0, 50000]);
  });
});
