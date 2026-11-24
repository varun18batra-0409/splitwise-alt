import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Batch 10 (G35): one budget month for the screen and the alerts: the group's zone = the most common zone among people still in the group,
// unknown zones and ties going to India. Delivery hours stay per person (not tested here, unchanged).
// Hand-worked: now = 2026-12-01 01:00 UTC. Los Angeles: 30 Nov 17:00 (November). India: 1 Dec 06:30 (December).
// The ₹1,500 expense is at 2026-11-30 20:00 UTC = 30 Nov 12:00 in Los Angeles (November), and 1 Dec 01:30 in India (December).
// In India the same expense is in December, so an all-India group reads December. Budget groceries ₹1,000 = 100000 paise. In November: spent 150000 = 150% -> both alerts "80" (150000*100 >= 100000*80) and "100" (150000 > 100000).

const pushes = vi.hoisted(() => ({ bodies: [] as string[] }));
vi.mock("@/lib/push", async (orig) => ({
  ...(await orig<typeof import("@/lib/push")>()),
  sendPushTo: async (_ids: string[], msg: { body: string }) => (pushes.bodies.push(msg.body), 0),
}));

const { db } = await import("@/lib/db");
const { checkBudgets, budgetsNow, budgetZoneOf } = await import("@/lib/home/budgets-db");
const { groupZone } = await import("@/lib/home/group-zone");

const NOW = new Date("2026-12-01T01:00:00Z");
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groupIds: string[] = [];

async function group(label: string, zones: string[]) {
  const g = await db.group.create({
    data: { name: `Budget zone ${label}`, type: "couple", currency: "INR", inviteCode: `bz-${label}-${stamp}`, members: { create: zones.map((timeZone, i) => ({ name: `P${i}`, timeZone })) } },
    include: { members: true },
  });
  groupIds.push(g.id);
  const you = g.members[0].id;
  await db.budget.create({ data: { groupId: g.id, category: "groceries", amount: 100000 } });
  await db.expense.create({
    data: {
      groupId: g.id, description: "Big shop", category: "groceries", amount: 150000, paidById: you, createdById: you, splitType: "equal", forMode: "everyone", kind: "expense",
      originalAmount: 150000, originalCurrency: "INR", baseCurrency: "INR", exchangeRate: "1", rateDate: "2026-11-30", rateSource: "same",
      convertedAmount: 150000, paymentMethod: "cash", markupBp: 0, markupAmount: 0, spentAt: new Date("2026-11-30T20:00:00Z"),
      shares: { create: [{ memberId: you, amount: 150000 }] },
    },
  });
  const expenses = await db.expense.findMany({ where: { groupId: g.id, deletedAt: null }, include: { shares: true } });
  return { id: g.id, you, expenses };
}

beforeAll(() => {
  pushes.bodies.length = 0;
});
afterAll(async () => {
  for (const id of groupIds) await db.notifyLog.deleteMany({ where: { key: { startsWith: `budget:${id}:` } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

describe("groupZone: the most common zone, unknowns and ties to India", () => {
  it("picks the majority; a tie, nobody, or unknown/unusable zones go to India", () => {
    const LA = "America/Los_Angeles";
    const IN = "Asia/Kolkata";
    expect(groupZone([LA, LA, IN])).toBe(LA); // 2 of 3
    expect(groupZone([LA, IN])).toBe(IN); // tie
    expect(groupZone([LA, "Europe/London"])).toBe(IN); // tie between two others
    expect(groupZone([])).toBe(IN);
    expect(groupZone(["", "", LA])).toBe(IN); // two unknown count as India (2 of 3)
    expect(groupZone([LA, LA, "", "Not/AZone"])).toBe(IN); // 2 LA, 2 unknown/unusable = India: tie
    expect(groupZone([LA, LA, LA, ""])).toBe(LA);
  });
});

describe("one budget month for the screen and the alerts", () => {
  it("two in Los Angeles and one in India at 01:00 UTC on 1 Dec: screen and alert both use November, and the 1,500 counts in both", async () => {
    const g = await group("la", ["America/Los_Angeles", "America/Los_Angeles", "Asia/Kolkata"]);
    expect(await budgetZoneOf(g.id)).toBe("America/Los_Angeles");
    const screen = await budgetsNow(g.id, g.expenses, g.you, NOW);
    expect(screen).toEqual([{ category: "groceries", spent: 150000, amount: 100000, level: "over" }]);
    expect(await checkBudgets(g.id, NOW)).toEqual(["groceries:80", "groceries:100"]);
    const keys = (await db.notifyLog.findMany({ where: { key: { startsWith: `budget:${g.id}:` } }, select: { key: true } })).map((k) => k.key).sort();
    // People with a zone get their own record (…:m:<member id>), so there can be several keys: every one is November, at 80 and 100.
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(k.startsWith(`budget:${g.id}:groceries:2026-11:`)).toBe(true);
    expect(new Set(keys.map((k) => k.split(":")[4]))).toEqual(new Set(["80", "100"]));
  });

  it("everyone in India (or no zones yet): both use December (the same 1,500 is 1 Dec 01:30 there), and the alert key says 2026-12", async () => {
    const g = await group("in", ["Asia/Kolkata", "", "Asia/Kolkata"]);
    expect(await budgetZoneOf(g.id)).toBe("Asia/Kolkata");
    const screen = await budgetsNow(g.id, g.expenses, g.you, NOW);
    expect(screen).toEqual([{ category: "groceries", spent: 150000, amount: 100000, level: "over" }]);
    expect(await checkBudgets(g.id, NOW)).toEqual(["groceries:80", "groceries:100"]);
    const keys = (await db.notifyLog.findMany({ where: { key: { startsWith: `budget:${g.id}:` } }, select: { key: true } })).map((k) => k.key);
    expect(keys.every((k) => k.includes(":2026-12:"))).toBe(true);
    expect(keys.length).toBeGreaterThan(0);
  });

  it("someone who has left does not vote", async () => {
    const g = await group("left", ["Asia/Kolkata", "America/Los_Angeles", "America/Los_Angeles"]);
    const m = await db.member.findMany({ where: { groupId: g.id }, orderBy: { createdAt: "asc" } });
    await db.member.updateMany({ where: { groupId: g.id, timeZone: "America/Los_Angeles" }, data: { leftAt: new Date() } });
    expect(m).toHaveLength(3);
    expect(await budgetZoneOf(g.id)).toBe("Asia/Kolkata");
  });
});
