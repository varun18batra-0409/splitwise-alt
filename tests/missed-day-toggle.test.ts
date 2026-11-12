import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { toggleMissedDayFor } from "@/lib/home/bill-setup";

// INV-04: tapping a day on a daily bill's calendar is a compare-and-set. Two taps at the same moment on
// different days must both stay (neither overwrites the other).
//
// Hand-worked: the list starts empty. Tap 3 and tap 5 together -> {"2026-11":[3,5]}. Tap 3 again -> [5].

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let groupId = "";
let me = "";
let billId = "";

const missedNow = async () => (JSON.parse((await db.bill.findUniqueOrThrow({ where: { id: billId } })).missed) as Record<string, number[]>)["2026-11"] ?? [];

afterAll(async () => {
  if (groupId) await db.group.delete({ where: { id: groupId } }).catch(() => {});
});

describe("missed-day taps", () => {
  it("setup", async () => {
    const g = await db.group.create({
      data: { name: `Milk flat ${stamp}`, type: "home", currency: "INR", inviteCode: `md-${stamp}`, members: { create: [{ name: "Asha" }, { name: "Ravi" }] } },
      include: { members: true },
    });
    groupId = g.id;
    me = g.members[0].id;
    billId = (await db.bill.create({ data: { groupId, name: "Milk", nature: "daily", amount: 4800, startMonth: "2026-11", payer: me } })).id;
    expect(await missedNow()).toEqual([]);
  });

  it("two taps at once on days 3 and 5 both stay: [3, 5]", async () => {
    const [a, b] = await Promise.all([toggleMissedDayFor(groupId, me, billId, "2026-11", 3), toggleMissedDayFor(groupId, me, billId, "2026-11", 5)]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(await missedNow()).toEqual([3, 5]);
  });

  it("tapping a marked day again clears just that day: [5]", async () => {
    expect((await toggleMissedDayFor(groupId, me, billId, "2026-11", 3)).ok).toBe(true);
    expect(await missedNow()).toEqual([5]);
  });

  it("a month that has been added can't be changed", async () => {
    await db.billRun.create({ data: { billId, period: "2026-11", status: "added" } });
    const r = await toggleMissedDayFor(groupId, me, billId, "2026-11", 9);
    expect(r).toEqual({ ok: false, error: "That month has already been added." });
    expect(await missedNow()).toEqual([5]);
  });
});
