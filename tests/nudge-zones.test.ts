import { afterAll, describe, expect, it, vi } from "vitest";

// C22: nudges in each person's own time zone. Sixteenth of November 2026 is a Monday; the daily job
// runs at 00:30 and 16:00 UTC. Hand-worked local times (winter, so London is GMT, Los Angeles PST = UTC-8,
// Sydney AEDT = UTC+11, India UTC+5:30):
//
//   zone         00:30 UTC run            16:00 UTC run
//   India        06:00 Mon 16th (day)     21:30 Mon 16th (day)
//   London       00:30 Mon 16th (night)   16:00 Mon 16th (day)
//   Los Angeles  16:30 Sun 15th (day)     08:00 Mon 16th (day)
//   Sydney       11:30 Mon 16th (day)     03:00 Tue 17th (night)

const mocks = vi.hoisted(() => ({ sendPushTo: vi.fn(async (_ids: string[], _p: unknown) => 1) }));
vi.mock("@/lib/push", async (orig) => ({ ...(await orig<typeof import("@/lib/push")>()), sendPushTo: mocks.sendPushTo }));

const { db } = await import("@/lib/db");
const { sendReminders } = await import("@/lib/home/reminders-db");
const { sendTripCountdowns } = await import("@/lib/countdown-db");
const { cleanTimeZone, isNudgeHour, localDays, localHour, addDays } = await import("@/lib/local-time");
const { ZONES_LIVE_KEY, coveredByOldRecord, markSentByOldPath, saveTimeZone, zonesLiveAt, zonesOf } = await import("@/lib/nudge-zones");
const { runClaimedParts, runDeferredParts, finishDailyRun, markDailyStarted } = await import("@/lib/daily-job");
const { periodDueOn } = await import("@/lib/home/bills");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const RUN1 = new Date("2026-11-16T00:30:00Z");
const RUN2 = new Date("2026-11-16T16:00:00Z");
const never = () => false;
const groupIds: string[] = [];
const accountIds: string[] = [];
const keys: string[] = [];
// How many flats have reminders on before this file does anything: it must leave the same number.
const remindersOnBefore = await db.group.count({ where: { reminders: true } });

afterAll(async () => {
  keys.push(ZONES_LIVE_KEY);
  await db.notifyLog.deleteMany({ where: { OR: [{ key: { in: keys } }, ...groupIds.map((id) => ({ key: { contains: id } }))] } });
  await db.bill.deleteMany({ where: { groupId: { in: groupIds } } });
  // The bills part (test H1) adds a real expense for a bill that fell due: it points at its members, so it goes first.
  await db.groupEvent.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.expenseShare.deleteMany({ where: { expense: { groupId: { in: groupIds } } } });
  await db.expense.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.payment.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.member.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
  expect(await db.group.count({ where: { reminders: true } })).toBe(remindersOnBefore);
});

async function account(zone: string) {
  const a = await db.account.create({ data: { email: `tz-${stamp}-${accountIds.length}@example.test`, timeZone: zone } });
  accountIds.push(a.id);
  return a;
}

// Everything sent to these members so far: [{ id, body }].
function sentTo(ids: string[]) {
  return mocks.sendPushTo.mock.calls
    .filter((c) => (c[0] as string[]).some((i) => ids.includes(i)))
    .map((c) => ({ ids: c[0] as string[], body: (c[1] as { body: string }).body }));
}

describe("local time helpers (the plan's table)", () => {
  it("hours: India 6 and 21, London 0 and 16, Los Angeles 16 and 8, Sydney 11 and 3", () => {
    expect([RUN1, RUN2].map((t) => localHour(t, "Asia/Kolkata"))).toEqual([6, 21]);
    expect([RUN1, RUN2].map((t) => localHour(t, "Europe/London"))).toEqual([0, 16]);
    expect([RUN1, RUN2].map((t) => localHour(t, "America/Los_Angeles"))).toEqual([16, 8]);
    expect([RUN1, RUN2].map((t) => localHour(t, "Australia/Sydney"))).toEqual([11, 3]);
  });

  it("daytime is 06:00 up to (not including) 22:00", () => {
    expect([RUN1, RUN2].map((t) => isNudgeHour(t, "Asia/Kolkata"))).toEqual([true, true]);
    expect([RUN1, RUN2].map((t) => isNudgeHour(t, "Europe/London"))).toEqual([false, true]);
    expect([RUN1, RUN2].map((t) => isNudgeHour(t, "America/Los_Angeles"))).toEqual([true, true]);
    expect([RUN1, RUN2].map((t) => isNudgeHour(t, "Australia/Sydney"))).toEqual([true, false]);
    expect(isNudgeHour(new Date("2026-11-16T21:59:00Z"), "UTC")).toBe(true);
    expect(isNudgeHour(new Date("2026-11-16T22:00:00Z"), "UTC")).toBe(false);
    expect(isNudgeHour(new Date("2026-11-16T05:59:00Z"), "UTC")).toBe(false);
  });

  it("today and tomorrow follow the person: at the 16:00 run Los Angeles is on Mon 16 Nov, so tomorrow is 17 Nov", () => {
    expect(localDays(RUN2, "America/Los_Angeles")).toEqual({ yesterday: "2026-11-15", today: "2026-11-16", tomorrow: "2026-11-17" });
    expect(localDays(RUN1, "America/Los_Angeles")).toEqual({ yesterday: "2026-11-14", today: "2026-11-15", tomorrow: "2026-11-16" });
    expect(localDays(RUN2, "Australia/Sydney").today).toBe("2026-11-17");
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
});

describe("a zone sent by a phone is checked before it is kept", () => {
  it("real zone names pass; everything else is refused", () => {
    expect(cleanTimeZone("Europe/London")).toBe("Europe/London");
    expect(cleanTimeZone("  Asia/Kolkata ")).toBe("Asia/Kolkata");
    expect(cleanTimeZone("America/Argentina/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    for (const bad of ["", "   ", "Not/AZone", "Mars", "x".repeat(65), "Europe/London; DROP TABLE", "<script>", "+05:30", 123, null, undefined, {}, ["Europe/London"]]) {
      expect(cleanTimeZone(bad)).toBeNull();
    }
  });

  it("saveTimeZone refuses a bad zone and saves nothing; a good one goes to the account and this phone's people only", async () => {
    const acc = await account("");
    const g = await db.group.create({
      data: { name: "Zone save", type: "home", currency: "INR", inviteCode: `tz-save-${stamp}`, members: { create: [{ name: "Mine", accountId: acc.id }, { name: "Other" }, { name: "Elsewhere" }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    const [mine, other] = g.members;
    expect(await saveTimeZone("Mars/Base", acc.id, [mine.id])).toBe(false);
    expect(await saveTimeZone("a".repeat(500), acc.id, [mine.id])).toBe(false);
    expect((await db.account.findUnique({ where: { id: acc.id } }))?.timeZone).toBe("");
    expect((await db.member.findUnique({ where: { id: mine.id } }))?.timeZone).toBe("");

    expect(await saveTimeZone("Europe/London", acc.id, [mine.id])).toBe(true);
    expect(await saveTimeZone("Europe/London", acc.id, [mine.id])).toBe(true); // sending it again is harmless
    expect((await db.account.findUnique({ where: { id: acc.id } }))?.timeZone).toBe("Europe/London");
    expect((await db.member.findUnique({ where: { id: mine.id } }))?.timeZone).toBe("Europe/London");
    expect((await db.member.findUnique({ where: { id: other.id } }))?.timeZone).toBe(""); // not on this phone

    // Not signed in: only the phone's people.
    expect(await saveTimeZone("Asia/Tokyo", null, [other.id])).toBe(true);
    expect((await db.member.findUnique({ where: { id: other.id } }))?.timeZone).toBe("Asia/Tokyo");
    expect((await db.account.findUnique({ where: { id: acc.id } }))?.timeZone).toBe("Europe/London");
  });

  it("zonesOf: the account's zone wins, then the person's own; a damaged stored zone counts as not known", async () => {
    const acc = await account("America/Los_Angeles");
    const g = await db.group.create({
      data: {
        name: "Zone read",
        type: "home",
        currency: "INR",
        inviteCode: `tz-read-${stamp}`,
        members: { create: [{ name: "A", accountId: acc.id, timeZone: "Asia/Tokyo" }, { name: "B", timeZone: "Europe/London" }, { name: "C" }, { name: "D", timeZone: "Bad/Zone" }] },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const z = await zonesOf(g.members.map((m) => m.id));
    expect(g.members.map((m) => z.get(m.id))).toEqual(["America/Los_Angeles", "Europe/London", "", ""]);
  });
});

describe("old per-group records on the switch-over day", () => {
  // The new code's first run writes "zones-live"; only old records written before it count.
  const liveAt = new Date("2026-01-01T00:30:00Z"); // in the past, so records the later tests write count as "after"
  const setLive = async () => {
    await db.notifyLog.deleteMany({ where: { key: ZONES_LIVE_KEY } });
    await db.notifyLog.create({ data: { key: ZONES_LIVE_KEY, state: "done", createdAt: liveAt } });
  };

  it("a done record from before the switch-over covers; one written after it, a claim in progress, or none does not", async () => {
    await setLive();
    const k = `reminders:2026-11-13:cover-${stamp}`;
    keys.push(k, `${k}-claimed`, `${k}-after`);
    await db.notifyLog.create({ data: { key: k, state: "done", createdAt: new Date("2026-01-01T00:29:00Z") } });
    await db.notifyLog.create({ data: { key: `${k}-claimed`, state: "claimed", createdAt: new Date("2026-01-01T00:29:00Z") } });
    await db.notifyLog.create({ data: { key: `${k}-after`, state: "done", createdAt: new Date("2026-01-01T16:00:00Z") } });
    expect(await coveredByOldRecord(k)).toBe(true);
    expect(await coveredByOldRecord(`${k}-claimed`)).toBe(false);
    expect(await coveredByOldRecord(`${k}-after`)).toBe(false);
    expect(await coveredByOldRecord(`${k}-nothing`)).toBe(false);
  });

  it("the first run writes the switch-over moment once; later runs keep it", async () => {
    await db.notifyLog.deleteMany({ where: { key: ZONES_LIVE_KEY } });
    const k = `reminders:2026-11-13:first-${stamp}`;
    keys.push(k);
    await db.notifyLog.create({ data: { key: k, state: "done", createdAt: new Date("2025-06-01T00:00:00Z") } });
    expect(await coveredByOldRecord(k)).toBe(true); // written long before the first run
    const first = await db.notifyLog.findUniqueOrThrow({ where: { key: ZONES_LIVE_KEY } });
    await coveredByOldRecord(k);
    expect((await db.notifyLog.findUniqueOrThrow({ where: { key: ZONES_LIVE_KEY } })).createdAt).toEqual(first.createdAt);
  });

  it("reminders: someone with a zone is skipped only when the old code already sent their group's nudge", async () => {
    await setLive();
    const day = "2026-11-13";
    const now = new Date(`${day}T10:00:00Z`); // 10:00 in London (winter) and 15:30 in India: daytime for both
    const make = async (tag: string) => {
      const g = await db.group.create({
        data: { name: `Switch ${tag}`, type: "home", currency: "INR", reminders: true, inviteCode: `tz-sw-${tag}-${stamp}`, members: { create: [{ name: "Lon", timeZone: "Europe/London" }] } },
        include: { members: true },
      });
      groupIds.push(g.id);
      await db.bill.create({ data: { groupId: g.id, name: `Rent ${tag}`, startMonth: "2026-11", day: 14, payer: g.members[0].id, nature: "fixed", amount: 100000 } });
      return g;
    };
    const covered = await make("covered");
    const later = await make("later");
    const fresh = await make("fresh");
    keys.push(`reminders:${day}:${covered.id}`, `reminders:${day}:${later.id}`);
    await db.notifyLog.create({ data: { key: `reminders:${day}:${covered.id}`, state: "done", createdAt: new Date("2026-01-01T00:20:00Z") } }); // old code, before the switch-over
    await db.notifyLog.create({ data: { key: `reminders:${day}:${later.id}`, state: "done" } }); // written now, after the switch-over: the new code's old path for people with no zone
    mocks.sendPushTo.mockClear();
    await sendReminders(now, never);
    expect(sentTo([covered.members[0].id])).toEqual([]);
    expect(sentTo([later.members[0].id]).map((s) => s.body)).toEqual([`Rent later is due tomorrow.`]);
    expect(sentTo([fresh.members[0].id]).map((s) => s.body)).toEqual([`Rent fresh is due tomorrow.`]);
  });
});

describe("reminders: 'bill due tomorrow' in each person's own time zone (Mon 16 Nov 2026)", () => {
  it("everyone gets one nudge per local day across the 00:30 and 16:00 UTC runs; no-zone people keep today's way", async () => {
    const la = await account("America/Los_Angeles");
    const g = await db.group.create({
      data: {
        name: "Flat zones",
        type: "home",
        currency: "INR",
        reminders: true,
        settleDay: 0,
        inviteCode: `tz-flat-${stamp}`,
        members: {
          create: [
            { name: "Ind", timeZone: "Asia/Kolkata" },
            { name: "Lon", timeZone: "Europe/London" },
            { name: "LA", accountId: la.id, timeZone: "Asia/Tokyo" }, // the account's zone wins over the phone's old one
            { name: "Syd", timeZone: "Australia/Sydney" },
            { name: "Old" }, // no zone sent yet
          ],
        },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const id = Object.fromEntries(g.members.map((m) => [m.name, m.id])) as Record<"Ind" | "Lon" | "LA" | "Syd" | "Old", string>;
    const bill = (name: string, day: number, payer: string) => db.bill.create({ data: { groupId: g.id, name, startMonth: "2026-11", day, payer, nature: "fixed", amount: 100000 } });
    // Everyone has a bill due Tue 17 Nov; Los Angeles also has one due Mon 16 Nov (their "tomorrow" on Sunday evening).
    for (const n of ["Ind", "Lon", "LA", "Syd", "Old"] as const) await bill(`${n}17`, 17, id[n]);
    await bill("LA16", 16, id.LA);

    mocks.sendPushTo.mockClear();
    await sendReminders(RUN1, never);
    const after1 = (n: keyof typeof id) => sentTo([id[n]]).map((s) => s.body);
    expect(after1("Ind")).toEqual(["Ind17 is due tomorrow."]); // 06:00 Mon: tomorrow is the 17th
    expect(after1("Lon")).toEqual([]); // 00:30 night
    expect(after1("LA")).toEqual(["LA16 is due tomorrow."]); // 16:30 Sun 15th: tomorrow is the 16th
    expect(after1("Syd")).toEqual(["Syd17 is due tomorrow."]); // 11:30 Mon
    expect(after1("Old")).toEqual(["Old17 is due tomorrow."]); // India time, as today

    await sendReminders(RUN2, never);
    await sendReminders(RUN2, never); // a repeat changes nothing
    await sendReminders(RUN1, never);
    expect(after1("Ind")).toEqual(["Ind17 is due tomorrow."]); // second run skipped: already sent for the 16th
    expect(after1("Lon")).toEqual(["Lon17 is due tomorrow."]); // 16:00 Mon: day
    expect(after1("LA")).toEqual(["LA16 is due tomorrow.", "LA17 is due tomorrow."]); // 08:00 Mon: tomorrow is the 17th, a different local day
    expect(after1("Syd")).toEqual(["Syd17 is due tomorrow."]); // 03:00 Tue: night, and nothing due the 18th
    expect(after1("Old")).toEqual(["Old17 is due tomorrow."]); // the flat's record stops the second run

    // The person records, one per person per local day.
    const logged = await db.notifyLog.findMany({ where: { key: { startsWith: "reminders:" }, AND: { key: { contains: g.id } } }, select: { key: true } });
    expect(logged.map((l) => l.key).sort()).toEqual(
      [
        `reminders:2026-11-16:${g.id}`, // the flat, for the person with no zone
        `reminders:2026-11-16:${g.id}:sent:${id.Old}`, // who the old path actually sent to
        `reminders:2026-11-15:${g.id}:m:${id.LA}`,
        `reminders:2026-11-16:${g.id}:m:${id.LA}`,
        `reminders:2026-11-16:${g.id}:m:${id.Ind}`,
        `reminders:2026-11-16:${g.id}:m:${id.Lon}`,
        `reminders:2026-11-16:${g.id}:m:${id.Syd}`,
      ].sort(),
    );
  });

  it("at India's night only people with their own zone are sent to; the rest waits and the part says it is left for later", async () => {
    const g = await db.group.create({
      data: { name: "Night flat", type: "home", currency: "INR", reminders: true, inviteCode: `tz-night-${stamp}`, members: { create: [{ name: "Old" }, { name: "Syd", timeZone: "Australia/Sydney" }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    for (const m of g.members) await db.bill.create({ data: { groupId: g.id, name: `${m.name}17`, startMonth: "2026-11", day: 17, payer: m.id, nature: "fixed", amount: 100000 } });
    const night = new Date("2026-11-16T18:00:00Z"); // 23:30 India, 05:00 Tue 17th in Sydney: also night there, so nobody yet
    mocks.sendPushTo.mockClear();
    const r = await sendReminders(night, never, { legacy: false });
    expect(sentTo(g.members.map((m) => m.id))).toEqual([]);
    // Not asserted: r.deferred. It covers every flat in the database, and another flat's person can be waiting for their
    // daytime (rightly: that is what "deferred" means). Whether one person is waited for is tested on its own below (L1).
    const morning = new Date("2026-11-16T04:00:00Z"); // 15:30 India, 15:00 Sydney Mon 16th
    await sendReminders(morning, never, { legacy: true });
    expect(sentTo(g.members.map((m) => m.id)).map((s) => s.body).sort()).toEqual(["Old17 is due tomorrow.", "Syd17 is due tomorrow."]);
  });
});

describe("trip countdown in each person's own time zone", () => {
  it("a trip on Mon 23 Nov: 7 days to go is each person's own Monday 16 Nov, once, in their daytime", async () => {
    const la = await account("America/Los_Angeles");
    const g = await db.group.create({
      data: {
        name: "Hampi trip",
        type: "trip",
        currency: "INR",
        tripStart: "2026-11-23",
        inviteCode: `tz-trip-${stamp}`,
        members: { create: [{ name: "Old" }, { name: "Lon", timeZone: "Europe/London" }, { name: "LA", accountId: la.id }, { name: "Syd", timeZone: "Australia/Sydney" }] },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const id = Object.fromEntries(g.members.map((m) => [m.name, m.id])) as Record<"Old" | "Lon" | "LA" | "Syd", string>;
    const count = (n: keyof typeof id) => sentTo([id[n]]).length;
    mocks.sendPushTo.mockClear();
    await sendTripCountdowns(RUN1, never);
    // 00:30 UTC: India 16th (7 days), London night, Los Angeles 15th (8 days: no nudge), Sydney 16th (7 days).
    expect([count("Old"), count("Lon"), count("LA"), count("Syd")]).toEqual([1, 0, 0, 1]);
    await sendTripCountdowns(RUN2, never);
    await sendTripCountdowns(RUN2, never);
    // 16:00 UTC: London 16th (7 days), Los Angeles 16th (7 days), Sydney is on the 17th (6 days: no nudge), India already done.
    expect([count("Old"), count("Lon"), count("LA"), count("Syd")]).toEqual([1, 1, 1, 1]);
  });
});

// ---------------------------------------------------------------------------------------------------------
// Part 3 review fixes.

// The switch-over moment, pinned in the past so the records these tests write count as "after" it.
const pinZonesLive = async () => {
  await db.notifyLog.deleteMany({ where: { key: ZONES_LIVE_KEY } });
  await db.notifyLog.create({ data: { key: ZONES_LIVE_KEY, state: "done", createdAt: new Date("2026-01-01T00:30:00Z") } });
};
const OLD_MEMBER = new Date("2026-01-01T00:00:00Z"); // people who were in the group long before the runs below
const dueBodies = (id: string) => sentTo([id]).map((s) => s.body).filter((b) => b.endsWith("is due tomorrow."));

describe("periodDueOn: the period whose due date is exactly this day (no database)", () => {
  const rule = { day: 16, every: 1, startMonth: "2026-11", endMonth: "", paused: false, tz: "Asia/Kolkata", nature: "fixed" };
  it("the 16th is due on 16 Nov only; every 2 months skips Dec; day 31 means the last day; paused or ended is never due; daily is due on the last day", () => {
    expect(periodDueOn(rule, "2026-11-16")).toBe("2026-11");
    expect(periodDueOn(rule, "2026-11-15")).toBeNull();
    expect(periodDueOn(rule, "2026-10-16")).toBeNull(); // before the start month
    expect(periodDueOn({ ...rule, every: 2 }, "2026-12-16")).toBeNull();
    expect(periodDueOn({ ...rule, every: 2 }, "2027-01-16")).toBe("2027-01");
    expect(periodDueOn({ ...rule, day: 31 }, "2026-11-30")).toBe("2026-11");
    expect(periodDueOn({ ...rule, paused: true }, "2026-11-16")).toBeNull();
    expect(periodDueOn({ ...rule, endMonth: "2026-10" }, "2026-11-16")).toBeNull();
    expect(periodDueOn({ ...rule, nature: "daily" }, "2026-11-30")).toBe("2026-11");
  });

  it("the 30th in February is due on the last day of February (28 in 2027, 29 in 2028), and not the day before", () => {
    const feb = { ...rule, day: 30, startMonth: "2027-01" };
    expect(periodDueOn(feb, "2027-02-28")).toBe("2027-02");
    expect(periodDueOn(feb, "2027-02-27")).toBeNull();
    expect(periodDueOn(feb, "2028-02-29")).toBe("2028-02");
    expect(periodDueOn(feb, "2028-02-28")).toBeNull();
  });

  it("the 31st in a 30-day month is due on the 30th (April, November), and in a 31-day month on the 31st", () => {
    const d31 = { ...rule, day: 31, startMonth: "2027-01" };
    expect(periodDueOn(d31, "2027-04-30")).toBe("2027-04");
    expect(periodDueOn(d31, "2027-04-29")).toBeNull();
    expect(periodDueOn(d31, "2027-05-31")).toBe("2027-05");
    expect(periodDueOn(d31, "2027-05-30")).toBeNull();
  });
});

describe("H1: 'bill due tomorrow' for someone behind India, through the same entry point the cron uses (bills part first)", () => {
  it("Los Angeles (16:30 Sun 15th at RUN1) hears about the bill due Mon 16th exactly once across both runs; India, Sydney and no-zone are unchanged", async () => {
    await pinZonesLive();
    const la = await account("America/Los_Angeles");
    const g = await db.group.create({
      data: {
        name: "Flat H1",
        type: "home",
        currency: "INR",
        reminders: true,
        settleDay: 0,
        inviteCode: `tz-h1-${stamp}`,
        members: { create: [{ name: "LA", accountId: la.id }, { name: "Ind", timeZone: "Asia/Kolkata" }, { name: "Syd", timeZone: "Australia/Sydney" }, { name: "Old" }] },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const id = Object.fromEntries(g.members.map((m) => [m.name, m.id])) as Record<"LA" | "Ind" | "Syd" | "Old", string>;
    const bill = (name: string, day: number, payer: string) => db.bill.create({ data: { groupId: g.id, name, startMonth: "2026-11", day, payer, nature: "fixed", amount: 100000 } });
    const laBill = await bill("LA16", 16, id.LA); // due Mon 16th: Los Angeles's "tomorrow" at RUN1
    for (const n of ["Ind", "Syd", "Old"] as const) await bill(`${n}17`, 17, id[n]);

    mocks.sendPushTo.mockClear();
    // Exactly what the cron runs: bills first, then reminders (the other parts do not matter here).
    const r1 = await runClaimedParts(RUN1, never, [], ["bills", "reminders"]);
    // The bills part really did add the 16th's bill first (India is on the 16th at 00:30 UTC), which is what hid it before.
    expect(await db.billRun.findMany({ where: { billId: laBill.id }, select: { period: true, status: true } })).toEqual([{ period: "2026-11", status: "added" }]);
    expect(r1.results.bills).toBeDefined();
    expect(dueBodies(id.LA)).toEqual(["LA16 is due tomorrow."]);
    expect(dueBodies(id.Ind)).toEqual(["Ind17 is due tomorrow."]);
    expect(dueBodies(id.Syd)).toEqual(["Syd17 is due tomorrow."]);
    expect(dueBodies(id.Old)).toEqual(["Old17 is due tomorrow."]);

    await runClaimedParts(RUN2, never, [], ["bills", "reminders"]);
    await runClaimedParts(RUN2, never, [], ["bills", "reminders"]);
    await runClaimedParts(RUN1, never, [], ["bills", "reminders"]);
    // Los Angeles at RUN2 is Mon 16th 08:00: tomorrow is the 17th and nothing of theirs is due then, so still just the one.
    expect(dueBodies(id.LA)).toEqual(["LA16 is due tomorrow."]);
    expect(dueBodies(id.Ind)).toEqual(["Ind17 is due tomorrow."]);
    expect(dueBodies(id.Syd)).toEqual(["Syd17 is due tomorrow."]); // 03:00 Tue 17th at RUN2: night, nothing due the 18th
    expect(dueBodies(id.Old)).toEqual(["Old17 is due tomorrow."]);
  });
});

describe("M1: the switch-over moment is not after the first run's own old-path records", () => {
  it("zonesLiveAt writes just before the run's start (never later than the real clock) and keeps it", async () => {
    await db.notifyLog.deleteMany({ where: { key: ZONES_LIVE_KEY } });
    const past = new Date("2026-01-01T00:30:00Z");
    expect((await zonesLiveAt(past)).toISOString()).toBe("2026-01-01T00:29:59.999Z");
    expect((await zonesLiveAt(new Date("2027-01-01T00:30:00Z"))).toISOString()).toBe("2026-01-01T00:29:59.999Z"); // kept
    await db.notifyLog.deleteMany({ where: { key: ZONES_LIVE_KEY } });
    const future = await zonesLiveAt(new Date(Date.now() + 10 * 86_400_000));
    expect(future.getTime()).toBeLessThanOrEqual(Date.now()); // a start time ahead of the clock cannot push it into the future
    await pinZonesLive();
  });

  it("first-ever run, trips: the no-zone member is sent under the old record and the Sydney member still gets one", async () => {
    const g = await db.group.create({
      data: { name: "Hampi first", type: "trip", currency: "INR", tripStart: "2026-11-23", inviteCode: `tz-m1t-${stamp}`, members: { create: [{ name: "Old" }, { name: "Syd", timeZone: "Australia/Sydney" }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    await db.notifyLog.deleteMany({ where: { key: ZONES_LIVE_KEY } });
    mocks.sendPushTo.mockClear();
    await sendTripCountdowns(RUN1, never);
    expect(sentTo([g.members[0].id]).length).toBe(1);
    expect(sentTo([g.members[1].id]).length).toBe(1);
    await pinZonesLive();
  });

  it("first-ever run, reminders: same", async () => {
    const g = await db.group.create({
      data: { name: "Flat first", type: "home", currency: "INR", reminders: true, inviteCode: `tz-m1r-${stamp}`, members: { create: [{ name: "Old" }, { name: "Syd", timeZone: "Australia/Sydney" }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    for (const m of g.members) await db.bill.create({ data: { groupId: g.id, name: `${m.name}17`, startMonth: "2026-11", day: 17, payer: m.id, nature: "fixed", amount: 100000 } });
    await db.notifyLog.deleteMany({ where: { key: ZONES_LIVE_KEY } });
    mocks.sendPushTo.mockClear();
    await sendReminders(RUN1, never);
    expect(dueBodies(g.members[0].id)).toEqual(["Old17 is due tomorrow."]);
    expect(dueBodies(g.members[1].id)).toEqual(["Syd17 is due tomorrow."]);
    await pinZonesLive();
  });
});

describe("L1: a zone 1 to 2.5 hours behind UTC (Azores, UTC-1 in winter) gets one nudge per local day", () => {
  it("the 00:30 UTC run is their night, so it asks for the 16:00 run; over two days there is one nudge per local day", async () => {
    await pinZonesLive();
    // Other flats are left alone: everything below is read from the Azores person's own sends.
    const g = await db.group.create({
      data: { name: "Flat Azores", type: "home", currency: "INR", reminders: true, settleDay: 0, inviteCode: `tz-az-${stamp}`, members: { create: [{ name: "Az", timeZone: "Atlantic/Azores" }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    const az = g.members[0].id;
    // Monday 7 Dec 2026. Bills due Tue 8th and Wed 9th: the first is Monday's nudge, the second Tuesday's (their local days).
    await db.bill.create({ data: { groupId: g.id, name: "Az08", startMonth: "2026-12", day: 8, payer: az, nature: "fixed", amount: 100000 } });
    await db.bill.create({ data: { groupId: g.id, name: "Az09", startMonth: "2026-12", day: 9, payer: az, nature: "fixed", amount: 100000 } });
    const days = [
      { morning: new Date("2026-12-07T00:30:00Z"), evening: new Date("2026-12-07T16:00:00Z") }, // Azores: 23:30 Sun 6th, then 15:00 Mon 7th
      { morning: new Date("2026-12-08T00:30:00Z"), evening: new Date("2026-12-08T16:00:00Z") }, // Azores: 23:30 Mon 7th, then 15:00 Tue 8th
    ];
    keys.push(...["2026-12-07", "2026-12-08"].flatMap((d) => [`daily-started:${d}`, `daily-finished:${d}`, `daily-deferred:${d}:reminders`]));
    mocks.sendPushTo.mockClear();
    for (const day of days) {
      await markDailyStarted(day.morning);
      const failed: string[] = [];
      const main = await runClaimedParts(day.morning, never, failed, ["reminders"]);
      expect(dueBodies(az).length).toBe(days.indexOf(day)); // night: nothing new at 00:30 UTC
      expect(main.deferred).toContain("reminders"); // ... but it asks for the 16:00 run (the Azores person is waiting, whatever else is)
      expect(await finishDailyRun(day.morning, main.deferred)).toBe(true);
      await runDeferredParts(day.evening, never, failed);
    }
    expect(dueBodies(az)).toEqual(["Az08 is due tomorrow.", "Az09 is due tomorrow."]);
    await runDeferredParts(days[1].evening, never, []); // a repeat sends nothing more
    expect(dueBodies(az).length).toBe(2);
  });
});

describe("L2: nobody is nudged twice on the day they first send their zone", () => {
  it("someone who got the 06:00 group nudge with no zone and sent their zone afterwards is not sent again; a person who never got it still is", async () => {
    await pinZonesLive();
    const g = await db.group.create({
      data: {
        name: "Flat L2",
        type: "home",
        currency: "INR",
        reminders: true,
        settleDay: 0,
        inviteCode: `tz-l2-${stamp}`,
        members: { create: [{ name: "X", createdAt: OLD_MEMBER }, { name: "Y", timeZone: "Europe/London", createdAt: OLD_MEMBER }] },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const [x, y] = g.members.map((m) => m.id);
    for (const m of g.members) await db.bill.create({ data: { groupId: g.id, name: `${m.name}15`, startMonth: "2026-12", day: 15, payer: m.id, nature: "fixed", amount: 100000 } });
    const run1 = new Date("2026-12-14T00:30:00Z"); // Monday: 06:00 India, midnight London
    const run2 = new Date("2026-12-14T16:00:00Z"); // 21:30 India, 16:00 London
    mocks.sendPushTo.mockClear();
    await sendReminders(run1, never);
    expect(dueBodies(x)).toEqual(["X15 is due tomorrow."]); // the old path, as always
    expect(dueBodies(y)).toEqual([]); // London midnight
    // X's phone now sends its zone (after the group's record was written).
    expect(await saveTimeZone("Asia/Kolkata", null, [x], new Date("2026-12-14T01:00:00Z"))).toBe(true);
    await sendReminders(run2, never);
    expect(dueBodies(x)).toEqual(["X15 is due tomorrow."]); // not a second one
    expect(dueBodies(y)).toEqual(["Y15 is due tomorrow."]); // Y never had it: not skipped
  });
});

describe("L2b: a zone sent in the gap after the cron starts does not lose the nudge", () => {
  it("a London member whose first zone arrives 1 second after RUN1 starts gets exactly one nudge across RUN1 and RUN2", async () => {
    await pinZonesLive();
    const g = await db.group.create({
      data: { name: "Flat L2b", type: "home", currency: "INR", reminders: true, settleDay: 0, inviteCode: `tz-l2b-${stamp}`, members: { create: [{ name: "Gap", createdAt: OLD_MEMBER }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    const gap = g.members[0].id;
    await db.bill.create({ data: { groupId: g.id, name: "Gap17", startMonth: "2026-11", day: 17, payer: gap, nature: "fixed", amount: 100000 } });
    expect(await saveTimeZone("Europe/London", null, [gap], new Date(RUN1.getTime() + 1000))).toBe(true);
    mocks.sendPushTo.mockClear();
    await sendReminders(RUN1, never); // London 00:30: night, nothing yet
    expect(dueBodies(gap)).toEqual([]);
    await sendReminders(RUN2, never); // London 16:00: day
    await sendReminders(RUN2, never);
    expect(dueBodies(gap)).toEqual(["Gap17 is due tomorrow."]);
  });

  it("only people the old path really sent to are skipped: a mark for one member does not cover another", async () => {
    const oldKey = `reminders:2026-11-16:marks-${stamp}`;
    keys.push(oldKey, `${oldKey}:sent:a-${stamp}`);
    await db.notifyLog.create({ data: { key: oldKey, state: "done" } });
    await markSentByOldPath(oldKey, [`a-${stamp}`, `a-${stamp}`]); // twice is harmless
    expect(await coveredByOldRecord(oldKey, RUN2, `a-${stamp}`)).toBe(true);
    expect(await coveredByOldRecord(oldKey, RUN2, `b-${stamp}`)).toBe(false);
  });
});

describe("L4: a zone is saved only for people still in the group", () => {
  it("someone who left, and someone removed, keep no zone from a phone that still lists them", async () => {
    const g = await db.group.create({
      data: {
        name: "Zone left",
        type: "home",
        currency: "INR",
        inviteCode: `tz-left-${stamp}`,
        members: { create: [{ name: "In" }, { name: "Left", leftAt: new Date("2026-10-01T00:00:00Z") }, { name: "Removed", leftAt: new Date("2026-10-01T00:00:00Z"), removedAt: new Date("2026-10-01T00:00:00Z") }] },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    expect(await saveTimeZone("Asia/Tokyo", null, g.members.map((m) => m.id))).toBe(true);
    const zonesNow = await db.member.findMany({ where: { groupId: g.id }, select: { name: true, timeZone: true }, orderBy: { name: "asc" } });
    expect(zonesNow).toEqual([{ name: "In", timeZone: "Asia/Tokyo" }, { name: "Left", timeZone: "" }, { name: "Removed", timeZone: "" }]);
  });
});
