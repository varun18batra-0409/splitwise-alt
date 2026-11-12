import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { tripFromGoalOnce } from "@/lib/goal-trip";

// UISEQ-05: "start a trip from this goal" uses the request-key pattern: claim, store the trip id, release on failure.
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const goal = (tag: string) => `goal-${tag}-${stamp}`;

afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await db.notifyLog.deleteMany({ where: { key: { contains: stamp } } });
});

describe("tripFromGoalOnce", () => {
  it("the first tap makes the trip and stores its id; a second tap gets that trip, not a second one", async () => {
    let made = 0;
    const make = async () => ({ id: `trip-${++made}` });
    const first = await tripFromGoalOnce(goal("a"), make);
    expect(first).toEqual({ trip: { id: "trip-1" } });
    const second = await tripFromGoalOnce(goal("a"), make);
    expect(second).toEqual({ existing: "trip-1" });
    expect(made).toBe(1);
  });

  it("a failed attempt gives the key back, so trying again makes the trip", async () => {
    await expect(tripFromGoalOnce(goal("b"), async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await db.requestKey.count({ where: { key: `trip-from-goal:${goal("b")}` } })).toBe(0);
    const again = await tripFromGoalOnce(goal("b"), async () => ({ id: "trip-b" }));
    expect(again).toEqual({ trip: { id: "trip-b" } });
  });

  it("a tap while the first is still being made is told it is busy and makes nothing", async () => {
    await db.requestKey.create({ data: { key: `trip-from-goal:${goal("c")}`, result: "" } });
    let made = 0;
    const r = await tripFromGoalOnce(goal("c"), async () => ({ id: `t${++made}` }));
    expect(r).toEqual({ busy: true });
    expect(made).toBe(0);
  });

  it("a goal that became a trip before request keys existed (old claim only) makes no new trip", async () => {
    await db.notifyLog.create({ data: { key: `trip-from-goal:${goal("legacy")}` } });
    let made = 0;
    const r = await tripFromGoalOnce(goal("legacy"), async () => ({ id: `t${++made}` }));
    expect(r).toEqual({ existing: "" }); // trip not known: the caller goes to the group
    expect(made).toBe(0);
  });

  it("after the request key is cleaned up, a tap still goes to the same trip and makes none", async () => {
    let made = 0;
    const make = async () => ({ id: `trip-d${++made}` });
    expect(await tripFromGoalOnce(goal("durable"), make)).toEqual({ trip: { id: "trip-d1" } });
    await db.requestKey.deleteMany({ where: { key: `trip-from-goal:${goal("durable")}` } }); // the 7/30-day clean-up
    expect(await tripFromGoalOnce(goal("durable"), make)).toEqual({ existing: "trip-d1" });
    expect(made).toBe(1);
  });
});
