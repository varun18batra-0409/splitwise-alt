import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { setTripDates } from "@/lib/group-setup";
import { sendTripCountdowns } from "@/lib/countdown-db";
import { dayKey, DEFAULT_TIME_ZONE } from "@/lib/dates";

// Trip dates saved from settings (with a history line), and the morning nudge
// going out once per trip and day.
const ids: string[] = [];
const keys: string[] = [];
afterAll(async () => {
  await db.groupEvent.deleteMany({ where: { groupId: { in: ids } } });
  await db.member.deleteMany({ where: { groupId: { in: ids } } });
  await db.group.deleteMany({ where: { id: { in: ids } } });
  await db.notifyLog.deleteMany({ where: { key: { in: keys } } });
});

async function trip(name: string) {
  const g = await db.group.create({ data: { name, type: "trip", currency: "INR", inviteCode: `cd-${Date.now()}-${Math.random()}`, members: { create: [{ name: "Varun" }, { name: "Nupur" }] } }, include: { members: true } });
  ids.push(g.id);
  return g;
}

describe("Trip countdown (real database)", () => {
  it("settings save the dates and note it in the history; bad dates are refused", async () => {
    const g = await trip("Goa trip");
    const me = g.members[0].id;
    expect((await setTripDates(g.id, me, "2026-11-07", "2026-11-03", "2026-10-22")).ok).toBe(false);
    const r = await setTripDates(g.id, me, "2026-11-03", "2026-11-07", "2026-10-22");
    expect(r.ok).toBe(true);
    expect(await db.group.findUnique({ where: { id: g.id }, select: { tripStart: true, tripEnd: true } })).toEqual({ tripStart: "2026-11-03", tripEnd: "2026-11-07" });
    const ev = await db.groupEvent.findFirst({ where: { groupId: g.id, kind: "trip_dates_set" } });
    expect(ev?.text).toBe("set the trip dates: 3 Nov 2026 – 7 Nov 2026");
    expect((await setTripDates(g.id, "someone-else", "2026-11-04", "", "2026-10-22")).ok).toBe(false);
  });

  it("a week before: the trip is picked up once, not twice", async () => {
    const now = new Date();
    const inAWeek = dayKey(new Date(now.getTime() + 7 * 86_400_000), DEFAULT_TIME_ZONE);
    const g = await trip("Manali trip");
    await db.group.update({ where: { id: g.id }, data: { tripStart: inAWeek } });
    keys.push(`countdown:${g.id}:${inAWeek}:7`);
    const first = await sendTripCountdowns(now);
    expect(first.trips).toBeGreaterThanOrEqual(1);
    expect(await db.notifyLog.count({ where: { key: `countdown:${g.id}:${inAWeek}:7` } })).toBe(1);
    await sendTripCountdowns(now);
    expect(await db.notifyLog.count({ where: { key: `countdown:${g.id}:${inAWeek}:7` } })).toBe(1);
  });
});
