import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Speed stage 3: how many database calls the Balances loaders make, counted from the speed log (LOOPIN_PERF=1 turns it on; it prints one
// line per call). The flag has to be set before the database module loads, hence vi.hoisted.
vi.hoisted(() => {
  process.env.LOOPIN_PERF = "1";
});

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { loadBalancesSummary, loadGroupView } = await import("@/lib/group-data");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
afterAll(async () => {
  await eraseGroups(groupIds);
});

// Counts the "LOOPIN_PERF_Q" lines printed while `run` works. Returns how many calls, and how many rows they read (nested rows count).
async function counted<T>(run: () => Promise<T>) {
  const lines: { m: string; op: string; rows: number }[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    const s = String(a[0]);
    if (s.startsWith("LOOPIN_PERF_Q ")) lines.push(JSON.parse(s.slice("LOOPIN_PERF_Q ".length)));
  });
  try {
    const result = await run();
    return { result, calls: lines.length, rows: lines.reduce((n, l) => n + l.rows, 0), lines };
  } finally {
    spy.mockRestore();
  }
}

let gid = "";
let ids: string[] = [];
beforeAll(async () => {
  // Three people, 40 expenses of 3 shares each (120 shares), 5 payments.
  const g = await db.group.create({
    data: { name: `Calls ${stamp}`, inviteCode: `calls-${stamp}`, currency: "INR", members: { create: ["A", "B", "C"].map((name, i) => ({ name, createdAt: new Date(Date.UTC(2026, 9, 1, 10, i)) })) } },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  gid = g.id;
  groupIds.push(gid);
  ids = g.members.map((m) => m.id);
  for (let i = 0; i < 40; i++) {
    await db.expense.create({
      data: {
        groupId: gid, description: `E${i}`, splitType: "equal", amount: 3000, originalAmount: 3000, convertedAmount: 3000, paidById: ids[i % 3], createdById: ids[i % 3], createdAt: new Date(Date.UTC(2026, 10, 1, 8, i)),
        shares: { create: ids.map((memberId) => ({ memberId, amount: 1000 })) },
      },
    });
  }
  await db.payment.createMany({ data: Array.from({ length: 5 }, (_, i) => ({ groupId: gid, fromId: ids[1], toId: ids[0], amount: 100, createdById: ids[1], createdAt: new Date(Date.UTC(2026, 10, 2, 8, i)) })) });
});

describe("database calls on the Balances tab", () => {
  it("someone still in the group: exactly 2 calls; with ?why= exactly 3", async () => {
    const plain = await counted(() => loadBalancesSummary(gid, ids[0]));
    expect(plain.result).not.toBeNull();
    expect(plain.calls).toBe(2);
    const why = await counted(() => loadBalancesSummary(gid, ids[0], { why: ids[1] }));
    expect(why.calls).toBe(3);
    expect(why.result!.openRows.length).toBeGreaterThan(0);
  });

  it("reads far fewer rows than the full loader (no shares)", async () => {
    // Full: 1 group + 3 members + 40 expenses + 120 shares + 5 payments = 169 rows (one call). Summary: the group with its 3 members,
    // 40 slim expenses and 5 payments = 49, plus the statement's few result rows (about 20).
    const full = await counted(() => loadGroupView(gid, { viewer: ids[0], events: false }));
    const slim = await counted(() => loadBalancesSummary(gid, ids[0]));
    expect(full.rows).toBeGreaterThanOrEqual(169);
    expect(slim.rows).toBeLessThan(full.rows - 100);
    expect(slim.rows).toBeLessThan(80);
  });

  it("someone who left: the summary steps aside (null) and the full loader gives today's view", async () => {
    await db.member.update({ where: { id: ids[2] }, data: { leftAt: new Date(Date.UTC(2026, 10, 3)) } });
    expect(await loadBalancesSummary(gid, ids[2])).toBeNull();
    expect((await loadGroupView(gid, { viewer: ids[2], events: false }))!.leaver).not.toBeNull();
  });
});
