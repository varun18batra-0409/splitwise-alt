import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// FB-16: the budget check reads only this month's expenses (the month widened by 14 hours each way), not the group's whole history.
// The numbers must be exactly what reading everything gave. India time, now = 2026-11-17 11:30 India (06:00 UTC), groceries budget Rs 6,000.

const pushes = vi.hoisted(() => ({ bodies: [] as string[] }));
vi.mock("@/lib/push", async (orig) => ({
  ...(await orig<typeof import("@/lib/push")>()),
  sendPushTo: async (_ids: string[], msg: { body: string }) => (pushes.bodies.push(msg.body), 0),
}));

const { db } = await import("@/lib/db");
const { checkBudgets } = await import("@/lib/home/budgets-db");
const { monthSummary } = await import("@/lib/home/summary");
const { monthWindow, onDate } = await import("@/lib/home/home-data");
const { getCategory } = await import("@/lib/categories");

const NOW = new Date("2026-11-17T06:00:00Z");
let groupId = "", you = "";

type Row = { description: string; amount: number; spentAt: Date | null; createdAt: Date; kind?: string; deletedAt?: Date };
const base = (r: Row) => ({
  groupId, description: r.description, category: "groceries", amount: r.amount, paidById: you, createdById: you, splitType: "equal", forMode: "everyone", kind: r.kind ?? "expense",
  originalAmount: r.amount, originalCurrency: "INR", baseCurrency: "INR", exchangeRate: "1", rateDate: "2026-11-01", rateSource: "same",
  convertedAmount: r.amount, paymentMethod: "cash", markupBp: 0, markupAmount: 0, spentAt: r.spentAt, createdAt: r.createdAt, deletedAt: r.deletedAt ?? null,
  shares: { create: [{ memberId: you, amount: r.amount }] },
});
const at = (s: string) => new Date(s);

// Amounts in paise. Hand-worked November total (India time): 240,000 + 118,000 + 100,000 - 20,000 + 60,000 = 498,000 (Rs 4,980).
const FIXTURE: Row[] = [
  { description: "E1 counts", amount: 240000, spentAt: at("2026-11-03T12:00:00Z"), createdAt: at("2026-11-03T12:00:00Z") },
  { description: "E2 no spent date", amount: 118000, spentAt: null, createdAt: at("2026-11-08T05:00:00Z") },
  { description: "E3 October", amount: 500000, spentAt: at("2026-10-20T12:00:00Z"), createdAt: at("2026-10-20T12:00:00Z") },
  { description: "E4 1 Nov 00:30 India", amount: 100000, spentAt: at("2026-10-31T19:00:00Z"), createdAt: at("2026-10-31T19:00:00Z") },
  { description: "E5 1 Dec 00:30 India", amount: 70000, spentAt: at("2026-11-30T19:00:00Z"), createdAt: at("2026-11-30T19:00:00Z") },
  { description: "E6 refund", amount: 20000, spentAt: at("2026-11-12T12:00:00Z"), createdAt: at("2026-11-12T12:00:00Z"), kind: "refund" },
  { description: "E7 deleted", amount: 90000, spentAt: at("2026-11-05T12:00:00Z"), createdAt: at("2026-11-05T12:00:00Z"), deletedAt: at("2026-11-06T00:00:00Z") },
  { description: "E8 counts", amount: 60000, spentAt: at("2026-11-15T12:00:00Z"), createdAt: at("2026-11-15T12:00:00Z") },
];

beforeAll(async () => {
  const g = await db.group.create({ data: { name: "Budget window", type: "couple", currency: "INR", inviteCode: `bw-${Date.now()}`, members: { create: [{ name: "You" }, { name: "Riya" }] } }, include: { members: true } });
  groupId = g.id;
  you = g.members[0].id;
  await db.budget.create({ data: { groupId, category: "groceries", amount: 600000 } });
  for (const r of FIXTURE) await db.expense.create({ data: base(r) });
});
afterAll(async () => {
  await db.notifyLog.deleteMany({ where: { key: { startsWith: `budget:${groupId}:` } } });
  await db.group.delete({ where: { id: groupId } }).catch(() => {});
});

describe("the budget check reads only this month's window (FB-16)", () => {
  it("the old way (all history, then the India-time month) gives Rs 4,980 = 83%, and the window gives the same", async () => {
    const all = await db.expense.findMany({ where: { groupId, deletedAt: null }, include: { shares: true } });
    expect(all).toHaveLength(7); // E7 is deleted
    const win = monthWindow("2026-11");
    const inWindow = await db.expense.findMany({ where: { groupId, deletedAt: null, ...onDate(win.from, win.to) }, include: { shares: true } });
    // E3 (October) is left out by the database; E5 (1 Dec in India) is inside the widened window and left out by monthSummary.
    expect(inWindow.map((e) => e.description).sort()).toEqual(["E1 counts", "E2 no spent date", "E4 1 Nov 00:30 India", "E5 1 Dec 00:30 India", "E6 refund", "E8 counts"]);
    const oldCat = monthSummary(all, "", "2026-11").byCategory;
    const newCat = monthSummary(inWindow, "", "2026-11").byCategory;
    expect(oldCat).toEqual([{ id: "groceries", amount: 498000 }]);
    expect(newCat).toEqual(oldCat);
    expect(Math.round((498000 * 100) / 600000)).toBe(83);
  });

  it("checkBudgets alerts groceries:80 once, with the message from the hand-worked numbers; a second run sends nothing", async () => {
    expect(await checkBudgets(groupId, NOW)).toEqual(["groceries:80"]);
    expect(pushes.bodies).toEqual([`${getCategory("groceries").label} is at 83% of this month’s budget (₹4,980 of ₹6,000).`]);
    expect(await checkBudgets(groupId, NOW)).toEqual([]);
  });
});
