import { afterAll, describe, expect, it, vi } from "vitest";

// SB-4: the evening note asks the database only for trips that are on today (or have no end and start today); the code check stays.
// Today (India) = 2026-11-17. Trips: A 11-10..11-20 in; B 09-01..09-05 out; C starts 11-17, no end: in; D starts 11-16, no end: out; E starts 11-18: out.

vi.mock("@/lib/push", async (orig) => ({ ...(await orig<typeof import("@/lib/push")>()), sendPushTo: async () => 0 }));

const { db } = await import("@/lib/db");
const { sendDayPulse } = await import("@/lib/countdown-db");

const NOW = new Date("2026-11-17T12:00:00Z"); // 17:30 in India, still the 17th
const TODAY = "2026-11-17";
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const ids: Record<string, string> = {};

const TRIPS: Record<string, { start: string; end: string }> = {
  A: { start: "2026-11-10", end: "2026-11-20" },
  B: { start: "2026-09-01", end: "2026-09-05" },
  C: { start: "2026-11-17", end: "" },
  D: { start: "2026-11-16", end: "" },
  E: { start: "2026-11-18", end: "" },
};

afterAll(async () => {
  const all = Object.values(ids);
  await db.notifyLog.deleteMany({ where: { key: { in: all.map((id) => `pulse:${id}:${TODAY}`) } } });
  await db.expense.deleteMany({ where: { groupId: { in: all } } });
  await db.member.deleteMany({ where: { groupId: { in: all } } });
  await db.group.deleteMany({ where: { id: { in: all } } });
});

describe("evening trip note (SB-4)", () => {
  it("only trips A and C get a note; the same set the old code-only check gave", async () => {
    for (const [name, t] of Object.entries(TRIPS)) {
      const g = await db.group.create({ data: { name: `Pulse ${name} ${stamp}`, type: "trip", currency: "INR", tripStart: t.start, tripEnd: t.end, inviteCode: `pu-${name}-${stamp}`, members: { create: [{ name: "Varun" }, { name: "Nupur" }] } }, include: { members: true } });
      ids[name] = g.id;
      // Something spent today in each one (so the only thing that can keep a trip out is its dates).
      await db.expense.create({ data: { groupId: g.id, description: "Dinner", amount: 120000, splitType: "equal", paidById: g.members[0].id, createdAt: NOW, shares: { create: g.members.map((m) => ({ memberId: m.id, amount: 60000 })) } } });
    }
    // The old rule, on the same fixture: started on or before today, and (end or start) not before today.
    const oldSet = Object.entries(TRIPS).filter(([, t]) => t.start !== "" && t.start <= TODAY && (t.end || t.start) >= TODAY).map(([n]) => n).sort();
    expect(oldSet).toEqual(["A", "C"]);

    await sendDayPulse(NOW);
    const sent: string[] = [];
    for (const [name, id] of Object.entries(ids)) if (await db.notifyLog.findUnique({ where: { key: `pulse:${id}:${TODAY}` } })) sent.push(name);
    expect(sent.sort()).toEqual(["A", "C"]);
  });
});
