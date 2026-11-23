import { afterAll, describe, expect, it, vi } from "vitest";

// L22: a bill that failed in the morning run is reported as failed AND deferred, so the evening run tries it again.
// Throwaway database. Money in paise, worked out by hand.
//
// Two flats, each with Rent 800,000 paid by Asha, split equally: 400,000 + 400,000. In "Broken", saving the expense breaks (a dropped
// connection) in the morning; in "Fine" it works. Evening: both are tried again; Fine is already added, so it is not added twice.

const fake = vi.hoisted(() => ({ breakFor: "" }));
vi.mock("@/lib/save-expense", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/save-expense")>();
  return {
    ...real,
    saveExpense: async (...args: Parameters<typeof real.saveExpense>) => {
      if (fake.breakFor && args[0].groupId === fake.breakFor) throw new Error("connection dropped");
      return real.saveExpense(...args);
    },
  };
});

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { runClaimedParts, runDeferredParts, finishDailyRun, markDailyStarted } = await import("@/lib/daily-job");
const { checkBooks } = await import("./helpers/money-invariants");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const morning = new Date("2031-03-01T06:00:00Z"); // 11:30 in India
const evening = new Date("2031-03-01T16:00:00Z"); // 21:30 in India, the same day

afterAll(async () => {
  await db.notifyLog.deleteMany({ where: { key: { contains: "2031-03-01" } } });
  await eraseGroups(groupIds);
});

async function flat(label: string) {
  const g = await db.group.create({
    data: { name: `L22 ${label} ${stamp}`, type: "home", currency: "INR", inviteCode: `l22-${label}-${stamp}`, members: { create: [{ name: "Asha", createdAt: new Date(2026, 0, 1) }, { name: "Ravi", createdAt: new Date(2026, 0, 2) }] } },
    include: { members: true },
  });
  groupIds.push(g.id);
  const asha = g.members.find((m) => m.name === "Asha")!.id;
  const ravi = g.members.find((m) => m.name === "Ravi")!.id;
  const bill = await db.bill.create({ data: { groupId: g.id, name: "Rent", nature: "fixed", amount: 800000, day: 1, startMonth: "2031-03", payer: asha, split: JSON.stringify({ mode: "equal", ids: [] }) } });
  return { id: g.id, asha, ravi, bill };
}
const rents = (gid: string) => db.expense.findMany({ where: { groupId: gid, description: "Rent", deletedAt: null }, include: { shares: true } });

describe("L22: a failed bill is retried that evening and reported", () => {
  it("one bill breaks, one is fine: 'bills' is failed and deferred; the evening run adds the broken one; the fine one is added exactly once", async () => {
    const broken = await flat("broken");
    const fine = await flat("fine");
    fake.breakFor = broken.id;
    const failed: string[] = [];
    let report: Awaited<ReturnType<typeof runClaimedParts>>;
    try {
      report = await runClaimedParts(morning, () => false, failed, ["bills"]);
    } finally {
      fake.breakFor = "";
    }
    expect(failed).toEqual(["bills"]);
    expect(report.deferred).toEqual(["bills"]);
    expect(report.results.bills).toEqual({ error: "failed" });
    // The fine flat was added in the morning; the broken one was not.
    expect(await rents(fine.id)).toHaveLength(1);
    expect(await rents(broken.id)).toHaveLength(0);

    // The morning writes down what it left, then the evening runs just that.
    await markDailyStarted(morning);
    expect(await finishDailyRun(morning, report.deferred)).toBe(true);
    const eveningFailed: string[] = [];
    const catchUp = await runDeferredParts(evening, () => false, eveningFailed);
    expect(eveningFailed).toEqual([]);
    expect(catchUp.deferred).toEqual([]);

    const done = await rents(broken.id);
    expect(done).toHaveLength(1);
    expect(done[0].amount).toBe(800000);
    expect(done[0].shares.map((s) => s.amount)).toEqual([400000, 400000]);
    expect(await checkBooks(broken.id)).toEqual({ [broken.asha]: 400000, [broken.ravi]: -400000 });
    // The fine flat still has exactly one Rent: 800,000 = 400,000 + 400,000.
    const once = await rents(fine.id);
    expect(once).toHaveLength(1);
    expect(await checkBooks(fine.id)).toEqual({ [fine.asha]: 400000, [fine.ravi]: -400000 });
  });
});
