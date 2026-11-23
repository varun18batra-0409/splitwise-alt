import { afterAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { db } from "@/lib/db";
import { memorySuffixes, isMemoryDay } from "@/lib/countdown";
import { sendMemoryLane } from "@/lib/countdown-db";
import { cronRefusedWithoutSecret } from "@/lib/cron-auth";
import { scrubPersonal } from "@/lib/scrub";
import { MAIL_SEND_LIMIT_MS, MAIL_TIMEOUTS, isOutOfTime, withDeadline } from "@/lib/mail";
import { PUSH_TIMEOUT_MS } from "@/lib/push";
import { cleanOldNotifyLog, NOTIFY_LOG_CLEANABLE_PREFIXES } from "@/lib/notify-cleanup";
import { logJobFailure } from "@/lib/daily-job";
import { sendMonthlySummaries } from "@/lib/home/insights-db";
import { quickFromCounts, quickReactions } from "@/lib/reactions";
import { markSentByOldPath } from "@/lib/nudge-zones";
import { loadMyGroups, loadMyGroupsSearch } from "@/lib/group-data";
import { recap, recapRows } from "@/lib/search";
import { candidateIdsQuery, canPrefilter, categoryKeysMatching, membersMatching, prefilterWords, searchWords } from "@/lib/search-prefilter";
import { ACTIVITY_PAGE, buildActivity, filterActivity, shownExpenseIds } from "@/lib/activity";

// Phone sends are counted, not made (everything else in the push module is real).
const mocks = vi.hoisted(() => ({ sendPushTo: vi.fn(async (_ids: string[], _p: unknown, _item?: string) => 1) }));
vi.mock("@/lib/push", async (orig) => ({ ...(await orig<typeof import("@/lib/push")>()), sendPushTo: mocks.sendPushTo }));

// Review of 23 Nov 2026, the reliability batch (R4-R16, S4). Each block says which finding it covers.
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
// Letters only: the scrubber would (rightly) turn a long run of digits in the stamp into "[number]".
const tag = Array.from({ length: 10 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join("");
const groupIds: string[] = [];
const noteKeys: string[] = [];
afterAll(async () => {
  await db.reaction.deleteMany({ where: { expense: { groupId: { in: groupIds } } } });
  await db.expenseShare.deleteMany({ where: { expense: { groupId: { in: groupIds } } } });
  await db.expense.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.groupEvent.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.member.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.notifyLog.deleteMany({ where: { OR: [{ key: { in: noteKeys } }, ...groupIds.map((id) => ({ key: { contains: id } }))] } });
  await db.errorLog.deleteMany({ where: { message: { contains: tag } } });
});

describe("R16: a trip that began on 29 Feb has its memory on 28 Feb in years without one", () => {
  it("2027 has no 29 Feb: on 27 Feb to 1 Mar the endings looked for include -02-29", () => {
    // Hand-worked: the days looked at on 28 Feb 2027 are 27 Feb, 28 Feb, 1 Mar.
    expect(memorySuffixes(["2027-02-27", "2027-02-28", "2027-03-01"]).sort()).toEqual(["-02-27", "-02-28", "-02-29", "-03-01"]);
  });
  it("2028 is a leap year: nothing extra is looked for, and 28 Feb is not the anniversary", () => {
    expect(memorySuffixes(["2028-02-27", "2028-02-28", "2028-02-29"]).sort()).toEqual(["-02-27", "-02-28", "-02-29"]);
    expect(isMemoryDay("2024-02-29", "2028-02-28")).toBe(false);
    expect(isMemoryDay("2024-02-29", "2028-02-29")).toBe(true);
  });
  it("28 Feb in 2027 is the anniversary of 29 Feb 2024; 2100 and 2000 follow the century rule", () => {
    expect(isMemoryDay("2024-02-29", "2027-02-28")).toBe(true);
    expect(isMemoryDay("2024-02-29", "2027-03-01")).toBe(false);
    expect(isMemoryDay("2020-02-29", "2100-02-28")).toBe(true); // 2100 is not a leap year
    expect(isMemoryDay("2020-02-29", "2000-02-28")).toBe(false); // 2000 is
    expect(isMemoryDay("2024-02-28", "2027-02-28")).toBe(true); // an ordinary 28 Feb trip is unchanged
  });
  it("end to end: the 29 Feb 2024 trip is told on 28 Feb 2027 (once), not on 28 Feb 2028", async () => {
    const g = await db.group.create({ data: { name: `Leap ${stamp}`, type: "trip", currency: "INR", tripStart: "2024-02-29", tripEnd: "2024-03-02", inviteCode: `leap-${stamp}`, members: { create: [{ name: "A" }, { name: "B" }] } } });
    groupIds.push(g.id);
    await sendMemoryLane(new Date("2028-02-28T04:30:00Z")); // 10:00 in India
    expect(await db.notifyLog.count({ where: { key: `memory:${g.id}:2028-02-28` } })).toBe(0);
    await sendMemoryLane(new Date("2027-02-28T04:30:00Z"));
    expect(await db.notifyLog.count({ where: { key: `memory:${g.id}:2027-02-28` } })).toBe(1);
    await sendMemoryLane(new Date("2027-02-28T04:35:00Z"));
    expect(await db.notifyLog.count({ where: { key: `memory:${g.id}:2027-02-28` } })).toBe(1);
  });
});

describe("S4 / R15: no CRON_SECRET on a live server means refuse", () => {
  it("refuses only when there is no secret AND it is production", () => {
    expect(cronRefusedWithoutSecret(undefined, "production")).toBe(true);
    expect(cronRefusedWithoutSecret("", "production")).toBe(true);
    expect(cronRefusedWithoutSecret("s3cret", "production")).toBe(false);
    expect(cronRefusedWithoutSecret(undefined, "development")).toBe(false);
    expect(cronRefusedWithoutSecret(undefined, "test")).toBe(false);
  });
  it("the daily route really answers 401 in production with no secret", async () => {
    const saved = { s: process.env.CRON_SECRET, n: process.env.NODE_ENV };
    delete process.env.CRON_SECRET;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      const { GET } = await import("@/app/api/cron/daily/route");
      expect((await GET(new Request("http://x/api/cron/daily"))).status).toBe(401);
      const { GET: evening } = await import("@/app/api/cron/evening/route");
      expect((await evening(new Request("http://x/api/cron/evening"))).status).toBe(401);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = saved.n ?? "test";
      if (saved.s !== undefined) process.env.CRON_SECRET = saved.s;
    }
  });
});

describe("R6: a slow mail server cannot hold a request for minutes", () => {
  it("connecting, hello and a silent connection give up in seconds; a whole send in 10", () => {
    expect(MAIL_TIMEOUTS).toEqual({ connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 8000 });
    expect(MAIL_SEND_LIMIT_MS).toBe(10_000);
  });
  it("withDeadline: a result inside the time comes through; one that never comes is cut off", async () => {
    await expect(withDeadline(Promise.resolve(7), 1000)).resolves.toBe(7);
    await expect(withDeadline(new Promise<number>(() => undefined), 30)).rejects.toThrow("timeout");
    await expect(withDeadline(Promise.reject(new Error("refused")), 1000)).rejects.toThrow("refused"); // a real error is not hidden
  });
  it("nodemailer's own timeout, and a failure once the message was being sent, count as out of time; an idle-drop does not", () => {
    expect(isOutOfTime({ code: "ETIMEDOUT" }, 100)).toBe(true);
    expect(isOutOfTime({ code: "ESOCKET", command: "DATA" }, 100)).toBe(true);
    expect(isOutOfTime(new Error("timeout"), 100)).toBe(true);
    expect(isOutOfTime({ code: "ECONNRESET" }, 100)).toBe(false);
    expect(isOutOfTime({ code: "ECONNRESET" }, 10_000)).toBe(true); // ten seconds used up, whatever the error
    expect(isOutOfTime({ code: "ECONNRESET" }, 9_999)).toBe(false);
  });
});

describe("R11: evening failures are written to the error log", () => {
  it("logJobFailure writes one row the morning email reads, and never throws", async () => {
    expect(await logJobFailure("cron/evening", `evening catch-up failed: bills ${tag}`)).toBe(true);
    const row = await db.errorLog.findFirstOrThrow({ where: { message: { contains: tag } } });
    expect([row.path, row.message]).toEqual(["cron/evening", `evening catch-up failed: bills ${tag}`]);
    expect(await logJobFailure("x", "y".repeat(500))).toBe(true); // long text is cut to 200
    await db.errorLog.deleteMany({ where: { path: "x", message: "[id]" } });
  });
  it("what is stored passes the scrubber: no email address, phone number or long id (RL4)", async () => {
    await logJobFailure("cron/evening", `evening job failed: send to ana@example.com 98765 43210 token ${"a".repeat(30)} ${tag}`);
    const row = await db.errorLog.findFirstOrThrow({ where: { message: { contains: tag } }, orderBy: { createdAt: "desc" } });
    expect(row.message).toBe(`evening job failed: send to [email] [number] token [id] ${tag}`);
  });
});

describe("R12: old 'already sent' notes are cleaned, one-time markers stay", () => {
  it("with 'now' in 2020, only notes older than 60 days of that and on the allowed list go", async () => {
    const now = new Date("2020-06-30T00:00:00Z"); // cut-off: 1 May 2020
    const old = new Date("2020-03-01T00:00:00Z"); // 121 days before
    const recent = new Date("2020-06-10T00:00:00Z"); // 20 days before
    const mk = (k: string, createdAt: Date) => {
      noteKeys.push(k);
      return db.notifyLog.create({ data: { key: k, createdAt } });
    };
    await Promise.all([
      mk(`countdown:${stamp}:1`, old), // goes
      mk(`summary:${stamp}:2020-02`, old), // goes
      mk(`memory:${stamp}:2020-03-01:m:x`, old), // goes
      mk(`countdown:${stamp}:2`, recent), // too new: stays
      mk(`trip-from-goal:${stamp}`, old), // one-time marker: stays
      mk(`trip-from-goal-made:${stamp}:t`, old), // stays
      mk(`invite-note:${stamp}`, old), // stays
      mk(`zones-live-${stamp}`, old), // not on the list: stays
    ]);
    const removed = await cleanOldNotifyLog(now);
    expect(removed).toBeGreaterThanOrEqual(3);
    const left = (await db.notifyLog.findMany({ where: { key: { contains: stamp } }, select: { key: true } })).map((r) => r.key).sort();
    expect(left).toEqual([`countdown:${stamp}:2`, `invite-note:${stamp}`, `trip-from-goal-made:${stamp}:t`, `trip-from-goal:${stamp}`, `zones-live-${stamp}`].sort());
  });
  // Kept as a source check on purpose: running the whole daily route would send the real admin email and run every part against the shared test database.
  it("the list never contains a one-time marker, and the daily job runs it", () => {
    for (const p of NOTIFY_LOG_CLEANABLE_PREFIXES) expect(p).not.toMatch(/^(zones-live|bill-asks-live|invite-note|trip-from-goal|mail-)/);
    expect(readFileSync("src/app/api/cron/daily/route.ts", "utf8")).toContain('part("cleanup-notify", () => cleanOldNotifyLog(now))');
  });
});

describe("R10 / RL1: the monthly summary gets a second chance on the 2nd, and never sends twice to the same person", () => {
  async function flat(tag: string) {
    const g = await db.group.create({ data: { name: `Sum ${tag} ${stamp}`, type: "home", currency: "INR", inviteCode: `sum-${tag}-${stamp}`, members: { create: [{ name: "X" }, { name: "Y" }] } }, include: { members: true } });
    groupIds.push(g.id);
    // February 2027 has spending, so there is a summary to send: Rent 1,000.00 split between X and Y.
    await db.expense.create({ data: { groupId: g.id, description: "Rent", amount: 100000, splitType: "equal", paidById: g.members[0].id, spentAt: new Date("2027-02-10T06:00:00Z"), shares: { create: g.members.map((m) => ({ memberId: m.id, amount: 50000 })) } } });
    return g;
  }
  const sentTo = () => mocks.sendPushTo.mock.calls.map((c) => c[0]);
  it("a group the 1st never reached is claimed on the 2nd (10:00 India), but not on the 3rd", async () => {
    const g = await flat("a");
    await sendMonthlySummaries(new Date("2027-03-03T04:30:00Z")); // the 3rd: nothing
    expect(await db.notifyLog.count({ where: { key: `summary:${g.id}:2027-02` } })).toBe(0);
    await sendMonthlySummaries(new Date("2027-03-02T04:30:00Z")); // the 2nd: picked up
    expect(await db.notifyLog.count({ where: { key: `summary:${g.id}:2027-02` } })).toBe(1);
  });
  it("a group already done on the 1st is not claimed again on the 2nd", async () => {
    const g = await flat("b");
    await db.notifyLog.create({ data: { key: `summary:${g.id}:2027-02`, state: "done", createdAt: new Date("2027-03-01T04:30:00Z") } });
    mocks.sendPushTo.mockClear();
    await sendMonthlySummaries(new Date("2027-03-02T04:30:00Z"));
    const row = await db.notifyLog.findUniqueOrThrow({ where: { key: `summary:${g.id}:2027-02` } });
    expect([row.state, row.createdAt.toISOString()]).toEqual(["done", "2027-03-01T04:30:00.000Z"]);
    expect(sentTo().filter((ids) => g.members.some((m) => ids.includes(m.id)))).toEqual([]);
  });
  it("a stale claim is taken over on the 2nd, and X (already marked as sent on the 1st) gets nothing again; Y gets it once", async () => {
    const g = await flat("c");
    const [x, y] = g.members;
    const key = `summary:${g.id}:2027-02`;
    await db.notifyLog.create({ data: { key, state: "claimed", createdAt: new Date("2027-03-01T04:30:00Z") } }); // crashed after X
    await markSentByOldPath(key, [x.id], new Date("2027-03-01T04:30:05Z"));
    mocks.sendPushTo.mockClear();
    await sendMonthlySummaries(new Date("2027-03-02T04:30:00Z"));
    const mine = sentTo().filter((ids) => ids.some((id) => id === x.id || id === y.id));
    expect(mine).toEqual([[y.id]]);
    expect((await db.notifyLog.findUniqueOrThrow({ where: { key } })).state).toBe("done");
  });
  it("control: the same stale claim with nobody marked sends to both", async () => {
    const g = await flat("d");
    const key = `summary:${g.id}:2027-02`;
    await db.notifyLog.create({ data: { key, state: "claimed", createdAt: new Date("2027-03-01T04:30:00Z") } });
    mocks.sendPushTo.mockClear();
    await sendMonthlySummaries(new Date("2027-03-02T04:30:00Z"));
    const ours = new Set(g.members.map((m) => m.id));
    expect(sentTo().filter((ids) => ids.some((id) => ours.has(id))).map((ids) => ids[0]).sort()).toEqual(g.members.map((m) => m.id).sort());
  });
});

describe("R9: the Activity tab reads reactions for the rows on the page only", () => {
  it("the quick row from counts is the same as from every reaction", () => {
    // Hand-worked: 🔥 x3, 😂 x1, a non-reaction word x5 (ignored) -> 🔥, 😂, then the usual six fill: 😭 🙄 😍 👏.
    const list = [..."🔥🔥🔥".match(/./gu)!, "😂", ...Array(5).fill("hello")].map((emoji) => ({ emoji }));
    expect(quickReactions(list)).toEqual(["🔥", "😂", "😭", "🙄", "😍", "👏"]);
    expect(quickFromCounts(new Map([["🔥", 3], ["😂", 1], ["hello", 5]]))).toEqual(["🔥", "😂", "😭", "🙄", "😍", "👏"]);
    // A tie is broken by the fixed order (😂 comes before 🔥 in the list).
    expect(quickFromCounts(new Map([["🔥", 2], ["😂", 2]])).slice(0, 2)).toEqual(["😂", "🔥"]);
    expect(quickFromCounts(new Map())).toEqual(["😂", "🔥", "😭", "🙄", "😍", "👏"]);
  });
  it("the page of 60 newest rows is the only one whose reactions are read; the tally over the group gives the same quick row", async () => {
    const g = await db.group.create({ data: { name: `React ${stamp}`, type: "home", currency: "INR", inviteCode: `re-${stamp}`, members: { create: [{ name: "A" }, { name: "B" }] } }, include: { members: true } });
    groupIds.push(g.id);
    const [a, b] = g.members;
    // 130 expenses, oldest first, one minute apart: "E1" is the oldest, "E130" the newest.
    for (let i = 1; i <= 130; i++) {
      await db.expense.create({ data: { groupId: g.id, description: `E${i}`, amount: 100, splitType: "equal", paidById: a.id, createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)), shares: { create: [{ memberId: a.id, amount: 100 }] } } });
    }
    const all = await db.expense.findMany({ where: { groupId: g.id }, include: { shares: true }, orderBy: { createdAt: "desc" } });
    const view = { group: { members: g.members, expenses: all, payments: [], events: [] }, myId: a.id, moveOutIds: new Set<string>() };
    const ids = shownExpenseIds(view, {});
    expect(ACTIVITY_PAGE).toBe(60);
    expect(ids).toHaveLength(60);
    expect(ids).toEqual(all.slice(0, 60).map((e) => e.id)); // E130 down to E71
    expect(shownExpenseIds(view, {}, 100)).toHaveLength(100); // "Show more"
    expect(shownExpenseIds(view, { q: "e12" })).toHaveLength(11); // E12, E120-E129 (hand count: 1 + 10); E12x all fit on the page
    // Reactions: one on the newest, one on the oldest; only the newest is read for the page; the tally counts both.
    const [newest, oldest] = [all[0], all[129]];
    await db.reaction.create({ data: { expenseId: newest.id, memberId: b.id, emoji: "🔥" } });
    await db.reaction.create({ data: { expenseId: oldest.id, memberId: b.id, emoji: "🔥" } });
    await db.reaction.create({ data: { expenseId: oldest.id, memberId: a.id, emoji: "🎉" } });
    const rows = await db.reaction.findMany({ where: { expenseId: { in: ids } }, select: { expenseId: true, memberId: true, emoji: true } });
    expect(rows.map((r) => r.expenseId)).toEqual([newest.id]);
    const tally = await db.reaction.groupBy({ by: ["emoji"], where: { expense: { groupId: g.id } }, _count: { _all: true } });
    const everyRow = await db.reaction.findMany({ where: { expense: { groupId: g.id } }, select: { emoji: true } });
    // Hand-worked: 🔥 x2, 🎉 x1 -> 🔥, 🎉, then the usual six: 😂 😭 🙄 😍.
    const fromTally = quickFromCounts(new Map(tally.map((t) => [t.emoji, t._count._all])));
    expect(fromTally).toEqual(["🔥", "🎉", "😂", "😭", "🙄", "😍"]);
    expect(fromTally).toEqual(quickReactions(everyRow));
  });
});

describe("R8: search reads only the expenses that could match, and finds the same ones", () => {
  it("words, and when the database may pre-filter (plain keyboard characters only)", () => {
    expect(searchWords("  Pizza   NIGHT ")).toEqual(["pizza", "night"]);
    expect(canPrefilter(["pizza"])).toBe(true);
    expect(canPrefilter(["café"])).toBe(false);
    expect(canPrefilter([])).toBe(false);
    expect(canPrefilter(["50%_off"])).toBe(true);
    // The same word twice is one word; nine different words is too many for the database to be asked.
    expect(prefilterWords(["a", "b", "a"])).toEqual(["a", "b"]);
    expect(canPrefilter(["a", "a", "a", "a", "a", "a", "a", "a", "a", "a"])).toBe(true);
    expect(canPrefilter(["a", "b", "c", "d", "e", "f", "g", "h"])).toBe(true);
    expect(canPrefilter(["a", "b", "c", "d", "e", "f", "g", "h", "i"])).toBe(false);
  });
  it("categories and people a word can mean", () => {
    // Food is "Bites & Sips" with the plain words "food drinks"; the old name 'drinks' maps to it.
    expect(categoryKeysMatching("sips").sort()).toEqual(["drinks", "food"]);
    expect(categoryKeysMatching("zzzz")).toEqual([]);
    const members = [{ id: "a", name: "Asha" }, { id: "r", name: "Ravi" }];
    expect(membersMatching("ash", members, "r")).toEqual(["a"]);
    expect(membersMatching("you", members, "r")).toEqual(["r"]); // the viewer's own row reads "Ravi you"
    expect(membersMatching("you", members, "a")).toEqual(["a"]);
  });

  it("every expense the full look-through finds is among the candidates, for many kinds of words", async () => {
    const g = await db.group.create({ data: { name: `Search ${stamp}`, type: "home", currency: "INR", inviteCode: `se-${stamp}`, members: { create: [{ name: "Asha" }, { name: "Ravi" }] } }, include: { members: true } });
    groupIds.push(g.id);
    const [asha, ravi] = g.members.sort((a, b) => a.name.localeCompare(b.name));
    const mk = (description: string, o: { paidById: string; shares: string[]; category?: string; notes?: string; kind?: string; deleted?: boolean }) =>
      db.expense.create({
        data: { groupId: g.id, description, amount: 10000, splitType: "equal", paidById: o.paidById, category: o.category ?? "other", notes: o.notes ?? "", kind: o.kind ?? "expense", deletedAt: o.deleted ? new Date() : null, shares: { create: o.shares.map((memberId) => ({ memberId, amount: 5000 })) } },
      });
    const e = {
      pizza: await mk("Pizza night", { paidById: asha.id, shares: [asha.id, ravi.id], category: "food" }),
      taxi: await mk("Taxi", { paidById: ravi.id, shares: [ravi.id], category: "transport", notes: "airport run" }),
      rent: await mk("Rent", { paidById: asha.id, shares: [asha.id], category: "accommodation" }),
      cafe: await mk("Café déjà", { paidById: asha.id, shares: [asha.id] }),
      gone: await mk("Pizza old", { paidById: asha.id, shares: [asha.id], category: "food", deleted: true }),
      game: await mk("Rummy", { paidById: ravi.id, shares: [ravi.id], kind: "pot" }),
      odd: await mk("Mystery", { paidById: asha.id, shares: [asha.id], category: "zz-unknown" }),
    };
    const candidates = async (q: string) => {
      const query = candidateIdsQuery(g.id, searchWords(q), g.members, asha.id)!;
      return new Set((await db.$queryRaw<{ id: string }[]>(query)).map((r) => r.id));
    };
    // Hand-worked: "pizza" matches the title of e.pizza; always kept: the non-plain title (cafe), the card game (game), the unknown category (odd).
    expect(await candidates("pizza")).toEqual(new Set([e.pizza.id, e.cafe.id, e.game.id, e.odd.id]));
    // "airport" is in a note.
    expect(await candidates("airport")).toEqual(new Set([e.taxi.id, e.cafe.id, e.game.id, e.odd.id]));
    // "ravi": paid or shared by Ravi: pizza (he shares), taxi, game.
    expect(await candidates("ravi")).toEqual(new Set([e.pizza.id, e.taxi.id, e.game.id, e.cafe.id, e.odd.id]));
    // "sips" is the food category: pizza (food); the deleted food one is never read.
    expect(await candidates("sips")).toEqual(new Set([e.pizza.id, e.cafe.id, e.game.id, e.odd.id]));
    // Two words must both fit one expense.
    expect(await candidates("pizza airport")).toEqual(new Set([e.cafe.id, e.game.id, e.odd.id]));

    // The property that matters: whatever the real look-through matches, the database candidates contain.
    const all = await db.expense.findMany({ where: { groupId: g.id, deletedAt: null }, include: { shares: true } });
    const nameOf = (id: string) => g.members.find((m) => m.id === id)?.name ?? "";
    const searchName = (id: string) => (id === asha.id ? `${nameOf(id)} you` : nameOf(id));
    for (const q of ["pizza", "PIZZA night", "ravi", "asha", "you", "ash you", "food", "sips", "drinks", "transport", "airport", "rent", "stay", "some", "someone", "e", "a", "zz", "mystery", "caf", "rummy", "game", "nothingmatches", "pizza ravi", "taxi asha"]) {
      const found = filterActivity(buildActivity(all, [], asha.id, [], new Set()), { q }, searchName).map((i) => i.id);
      const cand = await candidates(q);
      for (const id of found) expect(cand.has(id), `"${q}" finds ${id}`).toBe(true);
    }
    // The Search screen's own numbers (rows found, count, spent, my share) are the same from the pre-filtered loader and the full one.
    const memberships = { [g.id]: asha.id };
    const figures = async (load: (q: string) => Promise<Awaited<ReturnType<typeof loadMyGroups>>>, q: string) => {
      const groups = await load(q);
      const rows = groups.flatMap((x) => {
        const sn = (id: string) => (id === x.myId ? `${x.group.members.find((m) => m.id === id)?.name ?? ""} you` : (x.group.members.find((m) => m.id === id)?.name ?? "Someone"));
        return filterActivity(buildActivity(x.expenses, x.payments, x.myId, [], new Set()), { q }, sn).map((item) => ({ item, g: x }));
      });
      const shown = rows.sort((m, n) => n.item.date.getTime() - m.item.date.getTime() || (m.item.id < n.item.id ? -1 : 1));
      return { ids: shown.map((r) => r.item.id), sum: recap(recapRows(shown, ({ item, g: gg }) => gg.expenses.find((e) => e.id === item.id)?.shares.find((sh) => sh.memberId === gg.myId)?.amount ?? 0)) };
    };
    const nine = "a b c d e f g h i";
    for (const q of ["pizza", "ravi", "sips", "PIZZA pizza", "taxi taxi asha", "café", nine, "pizza airport", "nothingmatches", "you"]) {
      const full = await figures((qq) => loadMyGroups(memberships), q);
      const pre = await figures((qq) => loadMyGroupsSearch(memberships, qq), q);
      expect(pre, q).toEqual(full);
    }
    // Hand count for "pizza": the full ledger holds 6 live expenses, the pre-filtered read only the 4 that could match, and both find 1 (pizza), 10000 spent, my share 5000.
    expect((await loadMyGroups(memberships))[0].expenses).toHaveLength(6);
    expect((await loadMyGroupsSearch(memberships, "pizza"))[0].expenses).toHaveLength(4);
    const one = await figures((qq) => loadMyGroupsSearch(memberships, qq), "pizza");
    expect(one.ids).toEqual([e.pizza.id]);
    expect(one.sum.count).toBe(1);
    // Nine different words, a word with an accent, or none: the full read (same 6 expenses).
    expect((await loadMyGroupsSearch(memberships, nine))[0].expenses).toHaveLength(6);
    expect((await loadMyGroupsSearch(memberships, "café"))[0].expenses).toHaveLength(6);
    // And it really is smaller than everything: a word that fits nothing leaves only the always-kept ones.
    expect((await candidates("nothingmatches")).size).toBe(3);
  });
});

describe("R4 / R5: the backup leaves out the database's own tables and is written in pages", () => {
  const run = async (setup: (c: ReturnType<typeof createClient>) => Promise<void>) => {
    const dir = mkdtempSync(join(tmpdir(), "lp-bk-"));
    const src = `file:${join(dir, "src.db")}`;
    const c = createClient({ url: src });
    await setup(c);
    c.close();
    const file = join(dir, "backup.json");
    const out = execFileSync("node", ["scripts/backup.mjs", file], { env: { ...process.env, TURSO_DATABASE_URL: src, TURSO_AUTH_TOKEN: "" } }).toString();
    return { dir, file, out, json: JSON.parse(readFileSync(file, "utf8")) as { takenAt: string; indexes: string[]; tables: Record<string, { schema: string; rows: Record<string, unknown>[] }> } };
  };

  it("leaves out libsql_% and _cf_% tables (and their indexes), like turso-sync", async () => {
    const r = await run(async (c) => {
      await c.execute('CREATE TABLE "Group" ("id" TEXT PRIMARY KEY, "name" TEXT)');
      await c.execute('CREATE TABLE "libsql_wasm_func_table" ("name" TEXT PRIMARY KEY, "body" TEXT)');
      await c.execute('CREATE TABLE "_cf_KV" ("key" TEXT PRIMARY KEY, "value" BLOB)');
      await c.execute('CREATE INDEX "libsql_idx" ON "libsql_wasm_func_table" ("body")');
      await c.execute('CREATE INDEX "Group_name" ON "Group" ("name")');
      await c.execute({ sql: 'INSERT INTO "Group" VALUES (?, ?)', args: ["g1", "Goa"] });
      await c.execute({ sql: 'INSERT INTO "libsql_wasm_func_table" VALUES (?, ?)', args: ["f", "x"] });
    });
    expect(Object.keys(r.json.tables)).toEqual(["Group"]);
    expect(r.json.indexes).toEqual(['CREATE INDEX "Group_name" ON "Group" ("name")']);
    expect(r.out).toContain("Backed up 1 tables, 1 rows.");
  });

  it("a table longer than one page comes out whole and in order (hand count: 1,203 rows over 3 pages of 500)", async () => {
    const r = await run(async (c) => {
      await c.execute('CREATE TABLE "Big" ("id" INTEGER PRIMARY KEY, "t" TEXT, "photo" BLOB)');
      await c.execute('CREATE TABLE "Empty" ("id" TEXT PRIMARY KEY)');
      await c.batch(Array.from({ length: 1203 }, (_, i) => ({ sql: 'INSERT INTO "Big" VALUES (?, ?, ?)', args: [i + 1, `row ${i + 1} “q”`, i === 1202 ? new Uint8Array([1, 2, 255]) : null] })));
    });
    const rows = r.json.tables.Big.rows;
    expect(rows).toHaveLength(1203);
    expect(rows.map((x) => x.id)).toEqual(Array.from({ length: 1203 }, (_, i) => i + 1));
    expect(rows[1202]).toEqual({ id: 1203, t: "row 1203 “q”", photo: { $b64: Buffer.from([1, 2, 255]).toString("base64") } });
    expect(r.json.tables.Empty.rows).toEqual([]);
    expect(r.out).toContain("Backed up 2 tables, 1203 rows.");
    // and the whole file restores
    const log = execFileSync("node", ["scripts/restore.mjs", r.file, `file:${join(r.dir, "out.db")}`]).toString();
    expect(log).toContain("Big: 1203 rows");
  });

  it("an empty target is judged by the backup's own skip list: leftover _prisma and libsql_ tables do not block a restore (RL5)", async () => {
    const r = await run(async (c) => {
      await c.execute('CREATE TABLE "Group" ("id" TEXT PRIMARY KEY)');
      await c.execute({ sql: 'INSERT INTO "Group" VALUES (?)', args: ["g1"] });
    });
    const target = join(r.dir, "target.db");
    const t = createClient({ url: `file:${target}` });
    await t.execute('CREATE TABLE "_prisma_migrations" ("id" TEXT PRIMARY KEY)');
    await t.execute('CREATE TABLE "libsql_wasm_func_table" ("name" TEXT)');
    t.close();
    const log = execFileSync("node", ["scripts/restore.mjs", r.file, `file:${target}`]).toString();
    expect(log).toContain("Restore complete and verified");
  });

  it("the file is written as it goes: pages are already on disk before the read ends, and no read is bigger than a page", async () => {
    const { backup, PAGE_ROWS } = await import("../scripts/backup.mjs");
    const dir = mkdtempSync(join(tmpdir(), "lp-stream-"));
    const file = join(dir, "b.json");
    const total = 1203; // hand count: 500 + 500 + 203
    const asked: string[] = [];
    let sizeAtCommit = -1;
    const tx = {
      execute: async (q: string | { sql: string; args: number[] }) => {
        const sql = typeof q === "string" ? q : q.sql;
        asked.push(sql);
        if (/FROM sqlite_master WHERE type = 'table'/.test(sql)) return { columns: ["name", "sql"], rows: [["Big", 'CREATE TABLE "Big" ("id" INTEGER PRIMARY KEY)']] };
        if (/FROM sqlite_master WHERE type = 'index'/.test(sql)) return { columns: ["sql"], rows: [] };
        const after = (q as { args: number[] }).args[0];
        const ids = Array.from({ length: total }, (_, i) => i + 1).filter((i) => i > after).slice(0, PAGE_ROWS);
        return { columns: ["__rowid", "id"], rows: ids.map((i) => [i, i]) };
      },
      commit: async () => {
        sizeAtCommit = readFileSync(file).length;
      },
    };
    const r = await backup({ transaction: async () => tx }, file);
    expect(PAGE_ROWS).toBe(500);
    expect(r).toEqual({ tables: 1, rows: total });
    expect(asked.filter((x) => x.includes("LIMIT 500"))).toHaveLength(3); // three pages, never the whole table in one read
    expect(sizeAtCommit).toBeGreaterThan(total * 8); // the rows were on disk before the transaction ended
    expect(JSON.parse(readFileSync(file, "utf8")).tables.Big.rows).toHaveLength(total);
  });
});
});

describe("RM5: the scrubber hides personal details but leaves error codes and dates readable", () => {
  it("keeps ALL-CAPS codes of letters, digits and underscores", () => {
    expect(scrubPersonal("SQLITE_CONSTRAINT_UNIQUE")).toBe("SQLITE_CONSTRAINT_UNIQUE");
    expect(scrubPersonal("failed: ERR_SSL_WRONG_VERSION_NUMBER_1234 at step")).toBe("failed: ERR_SSL_WRONG_VERSION_NUMBER_1234 at step");
  });
  it("keeps ISO dates, but still hides phone numbers next to them", () => {
    expect(scrubPersonal("run for 2026-11-23 failed")).toBe("run for 2026-11-23 failed");
    expect(scrubPersonal("call +91 98765 43210 on 2026-11-23")).toBe("call [number] on 2026-11-23");
    expect(scrubPersonal("9876543210")).toBe("[number]");
    expect(scrubPersonal("2026-11-23-5551234")).toBe("[number]"); // a longer digit run is not a date
  });
  it("still hides emails and long ids or tokens (lower-case or mixed)", () => {
    expect(scrubPersonal("to ana@example.com failed")).toBe("to [email] failed");
    expect(scrubPersonal(`id ${"a".repeat(30)} and cmabc12345defghij67890klmnop`)).toBe("id [id] and [id]");
    expect(scrubPersonal("Bearer Zx_AbCdEfGhIjKlMnOpQrStUvWxYz")).toBe("Bearer [id]");
  });
});
