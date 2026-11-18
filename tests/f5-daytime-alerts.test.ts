import { afterAll, describe, expect, it, vi } from "vitest";

// FB-11: budget alerts and bill "enter the amount" asks wait for each person's daytime (06:00-22:00 where they are),
// once per person, like the trip countdowns. The daily job runs at 00:30 and 16:00 UTC; on 17 Nov 2026 (winter):
//
//   person            00:30 UTC run          16:00 UTC run
//   Asha (India)      06:00 (day)            21:30 (day)
//   Ben (Berlin, +1)  01:30 (night)          17:00 (day)
const mocks = vi.hoisted(() => ({ sendPushTo: vi.fn(async (_ids: string[], _p: unknown) => 1) }));
vi.mock("@/lib/push", async (orig) => ({ ...(await orig<typeof import("@/lib/push")>()), sendPushTo: mocks.sendPushTo }));

const { db } = await import("@/lib/db");
const { checkBudgets } = await import("@/lib/home/budgets-db");
const { runBillsForGroup } = await import("@/lib/home/bills-db");
const { sendBillAsks } = await import("@/lib/home/bill-asks");
const { runClaimedParts } = await import("@/lib/daily-job");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const RUN1 = new Date("2026-11-17T00:30:00Z");
const RUN2 = new Date("2026-11-17T16:00:00Z");
const never = () => false;
const groupIds: string[] = [];

afterAll(async () => {
  const runs = await db.billRun.findMany({ where: { bill: { groupId: { in: groupIds } } }, select: { id: true } });
  await db.notifyLog.deleteMany({ where: { OR: [...groupIds.map((id) => ({ key: { contains: id } })), ...runs.map((r) => ({ key: { contains: r.id } }))] } });
  for (const id of groupIds) await db.group.delete({ where: { id } }).catch(() => {});
});

const sentTo = (id: string) => mocks.sendPushTo.mock.calls.filter((c) => (c[0] as string[]).includes(id)).map((c) => (c[1] as { body: string }).body);

async function flat(tag: string, extra: Record<string, unknown> = {}) {
  const g = await db.group.create({
    data: {
      name: `F5 ${tag} ${stamp}`, type: "home", currency: "INR", inviteCode: `f5-${tag}-${stamp}`, ...extra,
      members: { create: [{ name: "Asha", timeZone: "Asia/Kolkata" }, { name: "Ben", timeZone: "Europe/Berlin" }] },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { id: g.id, asha: g.members.find((m) => m.name === "Asha")!.id, ben: g.members.find((m) => m.name === "Ben")!.id };
}

describe("budget alerts wait for daytime", () => {
  it("groceries budget 1000000, spent 850000: Asha at 00:30Z (06:00), Ben at 16:00Z (17:00), nobody twice", async () => {
    const g = await flat("budget");
    await db.budget.create({ data: { groupId: g.id, category: "groceries", amount: 1_000_000 } });
    await db.expense.create({
      data: {
        groupId: g.id, description: "Big shop", category: "groceries", amount: 850_000, paidById: g.asha, createdById: g.asha, splitType: "equal", forMode: "everyone",
        originalAmount: 850_000, originalCurrency: "INR", baseCurrency: "INR", exchangeRate: "1", rateDate: "2026-11-16", rateSource: "same",
        convertedAmount: 850_000, paymentMethod: "cash", markupBp: 0, markupAmount: 0, spentAt: RUN1, shares: { create: [{ memberId: g.asha, amount: 850_000 }] },
      },
    });
    const text = "Pantry Run is at 85% of this month’s budget (₹8,500 of ₹10,000)."; // "groceries" is shown as Pantry Run
    mocks.sendPushTo.mockClear();
    // Through the daily job's part: it must report "deferred" because Ben was left for the evening run.
    const report = await runClaimedParts(RUN1, never, [], ["budgets"]);
    expect(report.deferred).toContain("budgets");
    expect(sentTo(g.asha)).toEqual([text]);
    expect(sentTo(g.ben)).toEqual([]);
    // 16:00Z: Ben gets it once; Asha is not told again, even if it runs twice.
    const held = { deferred: false };
    expect(await checkBudgets(g.id, RUN2, { held })).toEqual(["groceries:80"]);
    expect(await checkBudgets(g.id, RUN2, { held })).toEqual([]);
    expect(sentTo(g.ben)).toEqual([text]);
    expect(sentTo(g.asha)).toEqual([text]);
    expect(held.deferred).toBe(false);
  });

  it("release day: an alert the live (old) code already sent to the whole group is not sent again to zoned people", async () => {
    const g = await flat("budget-release");
    await db.budget.create({ data: { groupId: g.id, category: "groceries", amount: 1_000_000 } });
    await db.expense.create({
      data: {
        groupId: g.id, description: "Big shop", category: "groceries", amount: 850_000, paidById: g.asha, createdById: g.asha, splitType: "equal", forMode: "everyone",
        originalAmount: 850_000, originalCurrency: "INR", baseCurrency: "INR", exchangeRate: "1", rateDate: "2026-11-16", rateSource: "same",
        convertedAmount: 850_000, paymentMethod: "cash", markupBp: 0, markupAmount: 0, spentAt: RUN1, shares: { create: [{ memberId: g.asha, amount: 850_000 }] },
      },
    });
    // What the live code leaves behind: one finished group record for November's 80% alert, and no per-person marks.
    // Dated long after any zones switch-over moment, so only the "old group record" rule can cover it.
    await db.notifyLog.create({ data: { key: `budget:${g.id}:groceries:2026-11:80`, state: "done", createdAt: new Date("2099-01-01T00:00:00Z") } });
    mocks.sendPushTo.mockClear();
    expect(await checkBudgets(g.id, RUN2, { held: { deferred: false } })).toEqual([]);
    expect(sentTo(g.asha)).toEqual([]);
    expect(sentTo(g.ben)).toEqual([]);
  });

  it("people with no zone yet keep the group's one record (once, to all of them)", async () => {
    const g = await db.group.create({ data: { name: `F5 old ${stamp}`, inviteCode: `f5-old-${stamp}`, members: { create: [{ name: "Old1" }, { name: "Old2" }] }, budgets: { create: [{ category: "food", amount: 100_000 }] } }, include: { members: true } });
    groupIds.push(g.id);
    await db.expense.create({
      data: {
        groupId: g.id, description: "Dinner", category: "food", amount: 90_000, paidById: g.members[0].id, createdById: g.members[0].id, splitType: "equal", forMode: "everyone",
        originalAmount: 90_000, originalCurrency: "INR", baseCurrency: "INR", exchangeRate: "1", rateDate: "2026-11-16", rateSource: "same",
        convertedAmount: 90_000, paymentMethod: "cash", markupBp: 0, markupAmount: 0, spentAt: RUN1, shares: { create: [{ memberId: g.members[0].id, amount: 90_000 }] },
      },
    });
    mocks.sendPushTo.mockClear();
    // It is night in India (e.g. 20:00Z = 01:30 IST): nothing goes, and the run says it is waiting.
    const night = new Date("2026-11-17T20:00:00Z");
    const held = { deferred: false };
    expect(await checkBudgets(g.id, night, { legacy: false, held })).toEqual([]);
    expect(held.deferred).toBe(true);
    expect(mocks.sendPushTo).not.toHaveBeenCalled();
    // In India's daytime the group is told once.
    expect(await checkBudgets(g.id, RUN1, { legacy: true })).toEqual(["food:80"]);
    expect(await checkBudgets(g.id, RUN1, { legacy: true })).toEqual([]);
    expect(mocks.sendPushTo).toHaveBeenCalledTimes(1);
  });
});

describe("bill asks wait for daytime", () => {
  const ask = "Electricity is due. Enter the amount when you have the bill.";
  it("Electricity (amount varies), payer Ben: nothing at 00:30Z, once at 16:00Z; Asha's bill is asked at once and not again", async () => {
    const g = await flat("bill");
    const mk = (name: string, payer: string) => db.bill.create({ data: { groupId: g.id, name, category: "bills", nature: "varies", amount: 0, day: 5, startMonth: "2026-11", payer } });
    await mk("Electricity", g.ben);
    await mk("Water", g.asha);
    mocks.sendPushTo.mockClear();
    expect(await runBillsForGroup(g.id, RUN1)).toMatchObject({ waiting: 2 });
    // Ben: 01:30 in Berlin, nothing. Asha: 06:00 in India, asked at once.
    expect(sentTo(g.ben)).toEqual([]);
    expect(sentTo(g.asha)).toEqual(["Water is due. Enter the amount when you have the bill."]);
    const first = await sendBillAsks(RUN1, never);
    expect(first.deferred).toBe(true); // Ben is waited for
    expect(sentTo(g.ben)).toEqual([]);
    // 16:00Z: 17:00 in Berlin. Once, however often it runs.
    const second = await sendBillAsks(RUN2, never);
    await sendBillAsks(RUN2, never);
    await runBillsForGroup(g.id, RUN2);
    expect(second.sent).toBeGreaterThanOrEqual(1);
    expect(sentTo(g.ben)).toEqual([ask]);
    expect(sentTo(g.asha)).toEqual(["Water is due. Enter the amount when you have the bill."]); // not asked again
  });

  it("a month that is already finished is never asked again", async () => {
    const g = await flat("billdone");
    const b = await db.bill.create({ data: { groupId: g.id, name: "Wifi", category: "bills", nature: "varies", amount: 0, day: 5, startMonth: "2026-11", payer: g.ben } });
    await runBillsForGroup(g.id, RUN1);
    await db.billRun.updateMany({ where: { billId: b.id }, data: { status: "skipped" } });
    mocks.sendPushTo.mockClear();
    await sendBillAsks(RUN2, never);
    expect(sentTo(g.ben)).toEqual([]);
  });
});
