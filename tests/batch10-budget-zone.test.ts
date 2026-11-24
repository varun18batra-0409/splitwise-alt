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
const { checkBudgets, budgetsNow, budgetZoneOf, budgetDaysLeft } = await import("@/lib/home/budgets-db");
const { groupZone, canonicalZone } = await import("@/lib/home/group-zone");

const NOW = new Date("2026-12-01T01:00:00Z");
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groupIds: string[] = [];

// A person is a zone ("" = not known yet), or { tz, joined: false }: a name someone else added who has never opened the group.
type Person = string | { tz: string; joined: false };
async function group(label: string, zones: Person[]) {
  const g = await db.group.create({
    data: { name: `Budget zone ${label}`, type: "couple", currency: "INR", inviteCode: `bz-${label}-${stamp}`, members: { create: zones.map((z, i) => (typeof z === "string" ? { name: `P${i}`, timeZone: z } : { name: `P${i}`, timeZone: z.tz, addedBy: "someone-else" })) } },
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
  for (const id of groupIds) await db.notifyLog.deleteMany({ where: { OR: [{ key: { startsWith: `budget:${id}:` } }, { key: { startsWith: `budget-zone:${id}:` } }] } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

describe("groupZone: the most common known zone, India only when nobody has one or on a tie", () => {
  const LA = "America/Los_Angeles";
  const IN = "Asia/Kolkata";
  it("picks the majority; a tie or nobody goes to India; people with no known zone do not vote", () => {
    expect(groupZone([LA, LA, IN])).toBe(LA); // 2 of 3
    expect(groupZone([LA, IN])).toBe(IN); // tie
    expect(groupZone([LA, "Europe/London"])).toBe(IN); // tie between two others
    expect(groupZone([])).toBe(IN);
    expect(groupZone(["", ""])).toBe(IN); // nobody known
    expect(groupZone(["", "", LA])).toBe(LA); // unknown does not vote: 1 of 1
    expect(groupZone([LA, LA, "", "Not/AZone"])).toBe(LA);
    expect(groupZone([LA, LA, LA, ""])).toBe(LA);
  });

  it("old names of one place are one vote: Asia/Calcutta + Asia/Kolkata + Los Angeles = India (2 of 3)", () => {
    expect(canonicalZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(canonicalZone("US/Pacific")).toBe(LA);
    expect(canonicalZone("US/Eastern")).toBe("America/New_York");
    expect(canonicalZone("Asia/Saigon")).toBe("Asia/Ho_Chi_Minh");
    expect(canonicalZone("Asia/Katmandu")).toBe("Asia/Kathmandu");
    expect(canonicalZone("Not/AZone")).toBeNull();
    expect(groupZone(["Asia/Calcutta", IN, LA])).toBe(IN);
    expect(groupZone(["US/Pacific", LA, "Europe/London"])).toBe(LA); // 2 of 3 (without the alias it would be 1, 1, 1: a tie, so India)
  });
});

describe("one budget month for the screen and the alerts", () => {
  it("two in Los Angeles and one in India at 01:00 UTC on 1 Dec: screen and alert both use November, and the 1,500 counts in both", async () => {
    const g = await group("la", ["America/Los_Angeles", "America/Los_Angeles", "Asia/Kolkata"]);
    expect(await budgetZoneOf(g.id, NOW)).toBe("America/Los_Angeles");
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
    expect(await budgetZoneOf(g.id, NOW)).toBe("Asia/Kolkata");
    const screen = await budgetsNow(g.id, g.expenses, g.you, NOW);
    expect(screen).toEqual([{ category: "groceries", spent: 150000, amount: 100000, level: "over" }]);
    expect(await checkBudgets(g.id, NOW)).toEqual(["groceries:80", "groceries:100"]);
    const keys = (await db.notifyLog.findMany({ where: { key: { startsWith: `budget:${g.id}:` } }, select: { key: true } })).map((k) => k.key);
    expect(keys.every((k) => k.includes(":2026-12:"))).toBe(true);
    expect(keys.length).toBeGreaterThan(0);
  });

  it("a London creator and two names nobody has joined as yet (both listed in India): London", async () => {
    const g = await group("unjoined", ["Europe/London", { tz: "Asia/Kolkata", joined: false }, { tz: "Asia/Kolkata", joined: false }]);
    expect(await budgetZoneOf(g.id, NOW)).toBe("Europe/London");
  });

  it("nobody has a known zone: India. A tie: India", async () => {
    const none = await group("none", ["", ""]);
    expect(await budgetZoneOf(none.id, NOW)).toBe("Asia/Kolkata");
    const tie = await group("tie", ["America/Los_Angeles", "Europe/London"]);
    expect(await budgetZoneOf(tie.id, NOW)).toBe("Asia/Kolkata");
  });

  it("the zone is frozen for the month the first time it is worked out: members changing to India later does not move November", async () => {
    const g = await group("frozen", ["America/Los_Angeles", "America/Los_Angeles", "Asia/Kolkata"]);
    const midNov = new Date("2026-11-15T12:00:00Z");
    expect(await budgetZoneOf(g.id, midNov)).toBe("America/Los_Angeles");
    expect(await db.notifyLog.findUniqueOrThrow({ where: { key: `budget-zone:${g.id}:2026-11` } })).toMatchObject({ state: "America/Los_Angeles" });
    await db.member.updateMany({ where: { groupId: g.id }, data: { timeZone: "Asia/Kolkata" } }); // everyone is in India now
    expect(await budgetZoneOf(g.id, midNov)).toBe("America/Los_Angeles");
    expect(await budgetZoneOf(g.id, NOW)).toBe("America/Los_Angeles"); // 1 Dec 01:00 UTC is still 30 Nov in Los Angeles: still November's zone
    expect(await budgetsNow(g.id, g.expenses, g.you, NOW)).toEqual([{ category: "groceries", spent: 150000, amount: 100000, level: "over" }]); // November, the 1,500 counts
    // Once December really begins there (08:00 UTC on 1 Dec), the frozen November zone no longer reads November, so December is worked out fresh (India now).
    expect(await budgetZoneOf(g.id, new Date("2026-12-01T08:00:00Z"))).toBe("Asia/Kolkata");
  });

  it("'days to go' is counted in the budget zone: 30 Nov in Los Angeles has 0 left; 1 Dec in India has 30", async () => {
    const la = await group("days-la", ["America/Los_Angeles", "America/Los_Angeles"]);
    expect(await budgetDaysLeft(la.id, NOW)).toBe(0);
    const india = await group("days-in", ["Asia/Kolkata"]);
    expect(await budgetDaysLeft(india.id, NOW)).toBe(30);
  });

  it("someone who has left does not vote", async () => {
    const g = await group("left", ["Asia/Kolkata", "America/Los_Angeles", "America/Los_Angeles"]);
    const m = await db.member.findMany({ where: { groupId: g.id }, orderBy: { createdAt: "asc" } });
    await db.member.updateMany({ where: { groupId: g.id, timeZone: "America/Los_Angeles" }, data: { leftAt: new Date() } });
    expect(m).toHaveLength(3);
    expect(await budgetZoneOf(g.id, NOW)).toBe("Asia/Kolkata");
  });
});
