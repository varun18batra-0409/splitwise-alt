import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { tripFromGoalOnce } from "@/lib/goal-trip";

// UISEQ-05: "start a trip from this goal" uses the request-key pattern: claim, store the trip id, release on failure.
// It also never dead-ends: a deleted trip goes to Recently deleted, an erased one lets a new trip be made.
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const goal = (tag: string) => `goal-${tag}-${stamp}`;
const groupIds: string[] = [];
let n = 0;

// A real trip group (the lookup checks whether it still exists).
const realTrip = async () => {
  const g = await db.group.create({ data: { name: `GT ${stamp} ${++n}`, type: "trip", inviteCode: `gt-${n}-${stamp}`, members: { create: [{ name: "Ann" }] } } });
  groupIds.push(g.id);
  return { id: g.id };
};

afterAll(async () => {
  await db.requestKey.deleteMany({ where: { key: { contains: stamp } } });
  await db.notifyLog.deleteMany({ where: { key: { contains: stamp } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

describe("tripFromGoalOnce", () => {
  it("the first tap makes the trip and stores its id; a second tap gets that trip, not a second one", async () => {
    let made = 0;
    const make = async () => (made++, realTrip());
    const first = await tripFromGoalOnce(goal("a"), make);
    if (!("trip" in first)) throw new Error("expected a trip");
    expect(await tripFromGoalOnce(goal("a"), make)).toEqual({ existing: first.trip.id });
    expect(made).toBe(1);
  });

  it("a failed attempt gives the key back, so trying again makes the trip", async () => {
    await expect(tripFromGoalOnce(goal("b"), async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await db.requestKey.count({ where: { key: `trip-from-goal:${goal("b")}` } })).toBe(0);
    const again = await tripFromGoalOnce(goal("b"), realTrip);
    expect("trip" in again).toBe(true);
  });

  it("a tap while the first is still being made is told it is busy and makes nothing", async () => {
    await db.requestKey.create({ data: { key: `trip-from-goal:${goal("c")}`, result: "" } });
    let made = 0;
    const r = await tripFromGoalOnce(goal("c"), async () => (made++, realTrip()));
    expect(r).toEqual({ busy: true });
    expect(made).toBe(0);
  });

  it("a goal that became a trip before request keys existed (old claim only) makes no new trip", async () => {
    await db.notifyLog.create({ data: { key: `trip-from-goal:${goal("legacy")}` } });
    let made = 0;
    const r = await tripFromGoalOnce(goal("legacy"), async () => (made++, realTrip()));
    expect(r).toEqual({ existing: "" }); // trip not known: the caller goes to the group
    expect(made).toBe(0);
  });

  it("after the request key is cleaned up, a tap still goes to the same trip and makes none", async () => {
    let made = 0;
    const make = async () => (made++, realTrip());
    const first = await tripFromGoalOnce(goal("durable"), make);
    if (!("trip" in first)) throw new Error("expected a trip");
    await db.requestKey.deleteMany({ where: { key: `trip-from-goal:${goal("durable")}` } }); // the 7/30-day clean-up
    expect(await tripFromGoalOnce(goal("durable"), make)).toEqual({ existing: first.trip.id });
    expect(made).toBe(1);
  });

  it("a trip that was deleted (still restorable) goes to Recently deleted and makes no new trip", async () => {
    let made = 0;
    const make = async () => (made++, realTrip());
    const first = await tripFromGoalOnce(goal("deleted"), make);
    if (!("trip" in first)) throw new Error("expected a trip");
    await db.group.update({ where: { id: first.trip.id }, data: { deletedAt: new Date(Date.now() - 2 * 86_400_000) } });
    expect(await tripFromGoalOnce(goal("deleted"), make)).toEqual({ deleted: first.trip.id });
    expect(made).toBe(1);
    // Restored: it is the goal's trip again.
    await db.group.update({ where: { id: first.trip.id }, data: { deletedAt: null } });
    expect(await tripFromGoalOnce(goal("deleted"), make)).toEqual({ existing: first.trip.id });
  });

  it("a trip that was erased lets exactly one new trip be made, then the new one is the goal's trip", async () => {
    let made = 0;
    const make = async () => (made++, realTrip());
    const first = await tripFromGoalOnce(goal("erased"), make);
    if (!("trip" in first)) throw new Error("expected a trip");
    await db.group.update({ where: { id: first.trip.id }, data: { deletedAt: new Date(Date.now() - 40 * 86_400_000) } });
    await eraseGroups([first.trip.id]);
    const second = await tripFromGoalOnce(goal("erased"), make);
    if (!("trip" in second)) throw new Error("expected a new trip");
    expect(second.trip.id).not.toBe(first.trip.id);
    expect(made).toBe(2);
    expect(await tripFromGoalOnce(goal("erased"), make)).toEqual({ existing: second.trip.id }); // and no third
    expect(made).toBe(2);
  });
});
