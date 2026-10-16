import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { goalPlan } from "@/lib/home/goals";
import { addGoalEntryFor, saveGoalFor } from "@/lib/home/goals-db";
import { loadGroup } from "@/lib/group-data";

// Savings goals: kept count of only — the money stays in people's own accounts.

describe("goal plan", () => {
  it("Bali by 15 Mar: ₹90,000 left over 4 months is ₹22,500 a month, split 55 / 45", () => {
    const p = goalPlan({ target: 20000000, saved: 11000000, today: "2026-10-16", byDate: "2027-03-15", createdAt: "2026-07-01", weights: { you: 55, riya: 45 } });
    expect(p.left).toBe(9000000);
    expect(p.months).toBe(4);
    expect(p.perMonth).toBe(2250000);
    expect(p.perPerson).toEqual([{ memberId: "you", amount: 1237500 }, { memberId: "riya", amount: 1012500 }]);
    expect(p.onTrack).toBe(true); // ₹27,500 a month so far
  });
  it("no date: no monthly plan; reached: nothing left", () => {
    expect(goalPlan({ target: 1000, saved: 200, today: "2026-10-16", byDate: "", createdAt: "2026-10-01", weights: { a: 100 } }).months).toBe(0);
    const done = goalPlan({ target: 1000, saved: 1500, today: "2026-10-16", byDate: "2027-01-01", createdAt: "2026-10-01", weights: { a: 100 } });
    expect([done.left, done.perMonth, done.onTrack]).toEqual([0, 0, true]);
  });
});

describe("saving towards a goal", () => {
  let groupId = "", you = "", riya = "", goalId = "";
  beforeAll(async () => {
    const g = await db.group.create({
      data: { name: "Us", type: "couple", currency: "INR", inviteCode: `goal-${Date.now()}`, members: { create: [{ name: "You", splitWeight: 55 }, { name: "Riya", splitWeight: 45 }] } },
      include: { members: true },
    });
    groupId = g.id;
    you = g.members.find((m) => m.name === "You")!.id;
    riya = g.members.find((m) => m.name === "Riya")!.id;
  });
  afterAll(async () => {
    await db.group.delete({ where: { id: groupId } }).catch(() => {});
  });
  it("creates a goal", async () => {
    const r = await saveGoalFor(groupId, you, { name: "Bali in March", target: "2000", byDate: "2027-03-15" });
    expect(r.ok).toBe(true);
    if (r.ok) goalId = r.id;
    expect((await saveGoalFor(groupId, you, { name: "", target: "abc", byDate: "" })).ok).toBe(false);
  });
  it("money set aside counts once, never touches balances, and reaching it is noted once", async () => {
    const key = `goal-${Date.now()}-abcdefgh`;
    await addGoalEntryFor(groupId, you, goalId, "1500", key);
    await addGoalEntryFor(groupId, you, goalId, "1500", key);
    expect(await db.goalEntry.count({ where: { goalId } })).toBe(1);
    const net = (await loadGroup(groupId))!.net;
    expect(Object.values(net).every((v) => v === 0)).toBe(true);
    await addGoalEntryFor(groupId, riya, goalId, "600", `goal2-${Date.now()}-abcdefgh`);
    const g = await db.goal.findUniqueOrThrow({ where: { id: goalId } });
    expect(g.reachedAt).not.toBeNull();
    await addGoalEntryFor(groupId, riya, goalId, "100", `goal3-${Date.now()}-abcdefgh`);
    expect(await db.groupEvent.count({ where: { groupId, text: { contains: "reached" } } })).toBe(1);
  });
});
