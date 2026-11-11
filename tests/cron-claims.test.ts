import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The daily job claims its work one group at a time, so a run that runs out of time
// carries on later with the groups it didn't reach, and never repeats the ones it did.

const mocks = vi.hoisted(() => ({ sendPushTo: vi.fn(async (_ids: string[], _p: unknown) => 1) }));
vi.mock("@/lib/push", async (orig) => ({ ...(await orig<typeof import("@/lib/push")>()), sendPushTo: mocks.sendPushTo }));

const { db } = await import("@/lib/db");
const { claimJob, finishJob } = await import("@/lib/push");
const { sendReminders } = await import("@/lib/home/reminders-db");
const { saveExpense } = await import("@/lib/save-expense");
const { makeStop, runClaimedParts, runDeferredParts, recordDeferred, deferredToday, markDailyStarted, markDailyFinished, dailyState, DAILY_BUDGET_MS } = await import("@/lib/daily-job");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const MIN = 60_000;
const T0 = new Date("2026-11-09T04:00:00Z"); // 9:30 India time on Monday 9 Nov 2026
const groupIds: string[] = [];
const keys: string[] = [];
const key = (tag: string) => {
  const k = `test-job:${tag}:${stamp}`;
  keys.push(k);
  return k;
};

afterAll(async () => {
  await db.notifyLog.deleteMany({ where: { OR: [{ key: { in: keys } }, ...groupIds.map((id) => ({ key: { contains: id } }))] } });
  await db.groupEvent.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.expenseShare.deleteMany({ where: { expense: { groupId: { in: groupIds } } } });
  await db.expense.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.member.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

describe("claimJob / finishJob", () => {
  it("claim then claim again: the second is refused", async () => {
    const k = key("twice");
    expect(await claimJob(k, T0)).toBe(true);
    expect(await claimJob(k, T0)).toBe(false);
    expect(await claimJob(k, new Date(T0.getTime() + 9 * MIN))).toBe(false); // still inside the 10 minutes
  });

  it("never finished: 11 minutes later it can be taken over, by one run only, and not again straight after", async () => {
    const k = key("abandoned");
    expect(await claimJob(k, T0)).toBe(true);
    const later = new Date(T0.getTime() + 11 * MIN);
    const both = await Promise.all([claimJob(k, later), claimJob(k, later)]);
    expect(both.filter(Boolean)).toHaveLength(1); // two runs racing for the same abandoned claim
    expect(await claimJob(k, new Date(later.getTime() + 1000))).toBe(false);
  });

  it("after finishJob it is never claimed again, however long ago", async () => {
    const k = key("done");
    expect(await claimJob(k, T0)).toBe(true);
    await finishJob(k);
    expect((await db.notifyLog.findUniqueOrThrow({ where: { key: k } })).state).toBe("done");
    expect(await claimJob(k, new Date(T0.getTime() + 60 * MIN))).toBe(false);
    expect(await claimJob(k, new Date(T0.getTime() + 3 * 86_400_000))).toBe(false);
  });

  it("an old-style row (made before there was a state) reads as done", async () => {
    const k = key("old");
    await db.notifyLog.create({ data: { key: k } });
    expect((await db.notifyLog.findUniqueOrThrow({ where: { key: k } })).state).toBe("done");
    expect(await claimJob(k, new Date(T0.getTime() + 5 * 86_400_000))).toBe(false);
  });
});

describe("the time budget", () => {
  it("stops after 50 seconds and not before", () => {
    let t = 1_000_000;
    const stop = makeStop(DAILY_BUDGET_MS, () => t);
    expect(DAILY_BUDGET_MS).toBe(50_000);
    expect(stop()).toBe(false);
    t += 49_999;
    expect(stop()).toBe(false);
    t += 1;
    expect(stop()).toBe(true);
  });

  it("with no time at all every part is deferred and nothing is claimed or sent", async () => {
    mocks.sendPushTo.mockClear();
    const failed: string[] = [];
    const r = await runClaimedParts(T0, () => true, failed);
    expect(r.deferred).toEqual(["bills", "reminders", "countdowns", "budgets", "summaries", "memories", "postcards", "blob-trash"]);
    expect(failed).toEqual([]);
    expect(mocks.sendPushTo).not.toHaveBeenCalled();
  });
});

describe("reminders, one flat at a time", () => {
  const rate = async () => ({ ok: true as const, rate: "1", date: "2026-11-09" });
  // Each flat: Y owes X ₹500 (X paid ₹1,000, split in two), so on a Monday Y gets one nudge.
  async function flat(tag: string) {
    const g = await db.group.create({
      data: { name: `Flat ${tag} ${stamp}`, type: "home", reminders: true, currency: "INR", inviteCode: `cc-${tag}-${stamp}`, members: { create: [{ name: "X" }, { name: "Y" }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    const x = g.members.find((m) => m.name === "X")!.id;
    const y = g.members.find((m) => m.name === "Y")!.id;
    const r = await saveExpense(
      { groupId: g.id, name: "Rent", category: "", amount: "1000", currency: "INR", paidById: x, forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "" },
      x,
      rate,
    );
    if (!r.ok) throw new Error(r.error);
    return { id: g.id, x, y };
  }
  const sentTo = (f: { x: string; y: string }) => mocks.sendPushTo.mock.calls.filter((c) => c[0].includes(f.y) || c[0].includes(f.x)).length;

  it("time runs out after flat 1: flat 2 is left alone; the next run sends to flat 2 only", async () => {
    const f1 = await flat("one");
    const f2 = await flat("two"); // made after flat 1, so it comes after it in the job's order
    mocks.sendPushTo.mockClear();

    // Run 1: out of time as soon as flat 1 has been sent.
    const first = await sendReminders(T0, () => sentTo(f1) >= 1);
    expect(first.deferred).toBe(true);
    expect(sentTo(f1)).toBe(1);
    expect(sentTo(f2)).toBe(0);
    expect(await db.notifyLog.findUnique({ where: { key: `reminders:2026-11-09:${f1.id}` } })).toMatchObject({ state: "done" });
    expect(await db.notifyLog.findUnique({ where: { key: `reminders:2026-11-09:${f2.id}` } })).toBeNull(); // unclaimed

    // Run 2, a little later with plenty of time: flat 2 gets its nudge, flat 1 is not told again.
    const second = await sendReminders(new Date(T0.getTime() + 12 * MIN));
    expect(second.deferred).toBe(false);
    expect(sentTo(f1)).toBe(1);
    expect(sentTo(f2)).toBe(1);

    // Run 3: nothing left to do.
    await sendReminders(new Date(T0.getTime() + 24 * MIN));
    expect(sentTo(f1)).toBe(1);
    expect(sentTo(f2)).toBe(1);
  });

  // ---- Audit fixes ----

  it("deploy day: the old whole-day claim is already done, so no flat is sent the same reminders again", async () => {
    const f = await flat("legacy");
    const day = new Date("2026-11-16T04:00:00Z"); // a Monday, 9:30 India time
    const legacy = "reminders:2026-11-16";
    keys.push(legacy);
    await db.notifyLog.create({ data: { key: legacy } }); // made by the old code: state reads as done
    mocks.sendPushTo.mockClear();
    const r = await sendReminders(day);
    expect(r).toMatchObject({ sent: 0, skipped: true, deferred: false });
    expect(sentTo(f)).toBe(0);
    expect(await db.notifyLog.findUnique({ where: { key: `reminders:2026-11-16:${f.id}` } })).toBeNull(); // nothing claimed either

    // Without the old row the same day works as usual: one nudge for this flat.
    await db.notifyLog.delete({ where: { key: legacy } });
    await sendReminders(day);
    expect(sentTo(f)).toBe(1);
  });
});

describe("the evening catch-up only finishes what the morning left", () => {
  const rate = async () => ({ ok: true as const, rate: "1", date: "2026-11-23" });
  async function flat(tag: string) {
    const g = await db.group.create({
      data: { name: `Flat ${tag} ${stamp}`, type: "home", reminders: true, currency: "INR", inviteCode: `cd-${tag}-${stamp}`, members: { create: [{ name: "X" }, { name: "Y" }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    const x = g.members.find((m) => m.name === "X")!.id;
    const y = g.members.find((m) => m.name === "Y")!.id;
    const r = await saveExpense(
      { groupId: g.id, name: "Rent", category: "", amount: "1000", currency: "INR", paidById: x, forMode: "everyone", selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "" },
      x,
      rate,
    );
    if (!r.ok) throw new Error(r.error);
    return { id: g.id, x, y };
  }
  const sentTo = (f: { x: string; y: string }) => mocks.sendPushTo.mock.calls.filter((c) => c[0].includes(f.y) || c[0].includes(f.x)).length;
  const evening = new Date("2026-11-23T16:00:00Z"); // Monday 21:30 India time
  const noteKey = (part: string) => `daily-deferred:2026-11-23:${part}`;
  const never = () => false;
  // The morning run began and got to the end (what it left is in the deferred notes, if anything).
  const morningDone = async (at: Date) => {
    await markDailyStarted(at);
    await markDailyFinished(at);
    const day = at.toISOString().slice(0, 10);
    keys.push(`daily-started:${day}`, `daily-finished:${day}`);
  };

  it("nothing was deferred in the morning: the evening does nothing at all (no first-time nudge at 21:30)", async () => {
    const quiet = new Date("2026-11-17T16:00:00Z"); // a day with no morning note
    await morningDone(new Date("2026-11-17T00:30:00Z"));
    const f = await flat("quiet");
    mocks.sendPushTo.mockClear();
    const failed: string[] = [];
    const r = await runDeferredParts(quiet, never, failed);
    expect(r).toEqual({ results: {}, deferred: [] });
    expect(failed).toEqual([]);
    expect(sentTo(f)).toBe(0);
    expect(mocks.sendPushTo).not.toHaveBeenCalled();
  });

  it("the morning ran out of time before reminders: the evening runs reminders only, for the flat not done yet, and crosses it off", async () => {
    await morningDone(new Date("2026-11-23T00:30:00Z"));
    const done = await flat("morning-done");
    const left = await flat("not-yet");
    // The morning already did the first flat.
    const k = `reminders:2026-11-23:${done.id}`;
    expect(await claimJob(k, new Date("2026-11-23T00:30:00Z"))).toBe(true);
    await finishJob(k);
    await recordDeferred(new Date("2026-11-23T00:31:00Z"), ["reminders", "not-a-part"]);
    keys.push(noteKey("reminders"));
    expect(await deferredToday(evening)).toEqual(["reminders"]); // unknown names are not written down

    mocks.sendPushTo.mockClear();
    const failed: string[] = [];
    const r = await runDeferredParts(evening, never, failed);
    expect(Object.keys(r.results)).toEqual(["reminders"]); // bills, countdowns, summaries, memories… were not run
    expect(r.deferred).toEqual([]);
    expect(sentTo(done)).toBe(0); // not repeated
    expect(sentTo(left)).toBe(1); // the one the morning missed
    expect(await deferredToday(evening)).toEqual([]); // finished: crossed off

    // A second evening run has nothing left to do.
    mocks.sendPushTo.mockClear();
    expect(await runDeferredParts(evening, never, failed)).toEqual({ results: {}, deferred: [] });
    expect(mocks.sendPushTo).not.toHaveBeenCalled();
  });

  it("the evening is short of time too: the part stays on the list for next time, and nothing is sent", async () => {
    await recordDeferred(new Date("2026-11-23T00:31:00Z"), ["countdowns"]);
    keys.push(noteKey("countdowns"));
    mocks.sendPushTo.mockClear();
    const r = await runDeferredParts(evening, () => true, []);
    expect(r.deferred).toEqual(["countdowns"]);
    expect(await deferredToday(evening)).toEqual(["countdowns"]);
    expect(mocks.sendPushTo).not.toHaveBeenCalled();
  });

  it("the morning run notes what it deferred or failed (and the night skip counts as left for later)", async () => {
    const failed: string[] = [];
    const night = new Date("2026-11-24T18:00:00Z"); // 23:30 India time: no phone nudges
    const r = await runClaimedParts(night, never, failed, ["reminders", "summaries"]);
    expect(Object.keys(r.results)).toEqual(["reminders", "summaries"]);
    expect(r.deferred).toEqual(["reminders", "summaries"]);
  });
});

// Evening catch-up when the morning's own notes are missing or incomplete.
describe("the evening runs everything when the morning never finished", () => {
  const never = () => false;
  const note = (day: string, what: "started" | "finished") => {
    keys.push(`daily-${what}:${day}`);
  };

  it("started but never finished (crashed): every part runs, then the day counts as done and a second evening run does nothing", async () => {
    const morning = new Date("2026-11-25T00:30:00Z");
    const evening = new Date("2026-11-25T16:00:00Z"); // 21:30 India time
    await markDailyStarted(morning);
    note("2026-11-25", "started");
    note("2026-11-25", "finished");
    expect(await dailyState(evening)).toEqual({ started: true, finished: false });
    const failed: string[] = [];
    const r = await runDeferredParts(evening, never, failed);
    expect(Object.keys(r.results)).toEqual(["bills", "reminders", "countdowns", "budgets", "summaries", "memories", "postcards", "blob-trash"]);
    expect(r.deferred).toEqual([]);
    expect(await dailyState(evening)).toEqual({ started: true, finished: true });
    expect(await runDeferredParts(evening, never, failed)).toEqual({ results: {}, deferred: [] });
  });

  it("never started at all (the morning cron did not fire): every part runs in the evening", async () => {
    const evening = new Date("2026-11-26T16:00:00Z");
    note("2026-11-26", "started");
    note("2026-11-26", "finished");
    expect(await dailyState(evening)).toEqual({ started: false, finished: false });
    const r = await runDeferredParts(evening, never, []);
    expect(Object.keys(r.results).length).toBe(8);
    expect(await dailyState(evening)).toEqual({ started: true, finished: true });
  });

  it("short of time in the evening: the day is not marked finished, so the next run tries everything again", async () => {
    const evening = new Date("2026-11-27T16:00:00Z");
    note("2026-11-27", "started");
    note("2026-11-27", "finished");
    const r = await runDeferredParts(evening, () => true, []);
    expect(r.deferred.length).toBe(8);
    expect(await dailyState(evening)).toEqual({ started: false, finished: false });
  });
});
