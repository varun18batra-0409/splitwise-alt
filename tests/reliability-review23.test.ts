import { afterAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { db } from "@/lib/db";
import { memorySuffixes, isMemoryDay } from "@/lib/countdown";
import { sendMemoryLane } from "@/lib/countdown-db";
import { cronRefusedWithoutSecret } from "@/lib/cron-auth";
import { MAIL_SEND_LIMIT_MS, MAIL_TIMEOUTS, withDeadline } from "@/lib/mail";
import { PUSH_TIMEOUT_MS } from "@/lib/push";
import { cleanOldNotifyLog, NOTIFY_LOG_CLEANABLE_PREFIXES } from "@/lib/notify-cleanup";
import { logJobFailure } from "@/lib/daily-job";
import { sendMonthlySummaries } from "@/lib/home/insights-db";
import { quickFromCounts, quickReactions } from "@/lib/reactions";
import { candidateIdsQuery, canPrefilter, categoryKeysMatching, membersMatching, searchWords } from "@/lib/search-prefilter";
import { buildActivity, filterActivity } from "@/lib/activity";

// Review of 23 Nov 2026, the reliability batch (R4-R16, S4). Each block says which finding it covers.
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
  await db.errorLog.deleteMany({ where: { message: { contains: stamp } } });
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
  it("both cron routes ask before doing anything else", () => {
    for (const f of ["src/app/api/cron/daily/route.ts", "src/app/api/cron/evening/route.ts"]) {
      const src = readFileSync(f, "utf8");
      const at = src.indexOf("cronRefusedWithoutSecret(secret)");
      expect(at, f).toBeGreaterThan(0);
      expect(src.slice(at, at + 160), f).toContain("status: 401");
      expect(at, f).toBeLessThan(src.indexOf("sameSecret(req")); // before the secret comparison and the rate limit
    }
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
    expect(readFileSync("src/lib/mail.ts", "utf8")).toContain("...MAIL_TIMEOUTS,");
  });
  it("withDeadline: a result inside the time comes through; one that never comes is cut off", async () => {
    await expect(withDeadline(Promise.resolve(7), 1000)).resolves.toBe(7);
    await expect(withDeadline(new Promise<number>(() => undefined), 30)).rejects.toThrow("timeout");
    await expect(withDeadline(Promise.reject(new Error("refused")), 1000)).rejects.toThrow("refused"); // a real error is not hidden
  });
  it("the send goes through the deadline, and a timeout is not retried", () => {
    const src = readFileSync("src/lib/mail.ts", "utf8");
    expect(src).toContain("withDeadline(transport().sendMail(message), MAIL_SEND_LIMIT_MS - (Date.now() - startedAt))");
    expect(src).toContain("if (overTime) break;");
  });
});

describe("R7: every push send has a 5 second limit", () => {
  it("5000 ms on all three senders", () => {
    expect(PUSH_TIMEOUT_MS).toBe(5000);
    const src = readFileSync("src/lib/push.ts", "utf8");
    expect(src.match(/sendNotification\(/g)).toHaveLength(3);
    expect(src.match(/timeout: PUSH_TIMEOUT_MS,/g)).toHaveLength(3);
  });
});

describe("R11: evening failures are written to the error log", () => {
  it("logJobFailure writes one row the morning email reads, and never throws", async () => {
    expect(await logJobFailure("cron/evening", `evening catch-up failed: bills ${stamp}`)).toBe(true);
    const row = await db.errorLog.findFirstOrThrow({ where: { message: { contains: stamp } } });
    expect([row.path, row.message]).toEqual(["cron/evening", `evening catch-up failed: bills ${stamp}`]);
    expect(await logJobFailure("x", "y".repeat(500))).toBe(true); // long text is cut to 200
    await db.errorLog.deleteMany({ where: { message: { startsWith: "yyyy" } } });
  });
  it("the evening route logs a failed catch-up, failed parts and a crash", () => {
    const src = readFileSync("src/app/api/cron/evening/route.ts", "utf8");
    expect(src.match(/logJobFailure\(/g)!.length).toBeGreaterThanOrEqual(4);
    expect(src).toContain("evening catch-up failed: ${failed.join");
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
  it("the list never contains a one-time marker, and the daily job runs it", () => {
    for (const p of NOTIFY_LOG_CLEANABLE_PREFIXES) expect(p).not.toMatch(/^(zones-live|bill-asks-live|invite-note|trip-from-goal|mail-)/);
    expect(readFileSync("src/app/api/cron/daily/route.ts", "utf8")).toContain('part("cleanup-notify", () => cleanOldNotifyLog(now))');
  });
});

describe("R10: the monthly summary gets a second chance on the 2nd", () => {
  async function flat(tag: string) {
    const g = await db.group.create({ data: { name: `Sum ${tag} ${stamp}`, type: "home", currency: "INR", inviteCode: `sum-${tag}-${stamp}`, members: { create: [{ name: "X" }, { name: "Y" }] } } });
    groupIds.push(g.id);
    return g;
  }
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
    await sendMonthlySummaries(new Date("2027-03-02T04:30:00Z"));
    const row = await db.notifyLog.findUniqueOrThrow({ where: { key: `summary:${g.id}:2027-02` } });
    expect([row.state, row.createdAt.toISOString()]).toEqual(["done", "2027-03-01T04:30:00.000Z"]);
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
  it("the page asks for rows on the shown page, a tally over the group, and keeps the leaver's old read", () => {
    const page = readFileSync("src/app/groups/[id]/page.tsx", "utf8");
    expect(page).toContain("shownExpenseIds(fv, activityFilter");
    expect(page).toContain('db.reaction.groupBy({ by: ["emoji"], where: { expense: { groupId: group.id } }');
    expect(page).toContain("createdAt: { lte: leaver.leftAt }");
    expect(readFileSync("src/app/groups/[id]/_components/ActivityTab.tsx", "utf8")).toContain("reactionTally ? quickFromCounts(reactionTally)");
  });
});

describe("R8: search reads only the expenses that could match, and finds the same ones", () => {
  it("words, and when the database may pre-filter (plain keyboard characters only)", () => {
    expect(searchWords("  Pizza   NIGHT ")).toEqual(["pizza", "night"]);
    expect(canPrefilter(["pizza"])).toBe(true);
    expect(canPrefilter(["café"])).toBe(false);
    expect(canPrefilter([])).toBe(false);
    expect(canPrefilter(["50%_off"])).toBe(true);
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

  it("the file is written as it goes (no whole-database string)", () => {
    const src = readFileSync("scripts/backup.mjs", "utf8");
    expect(src).toContain("writeSync(fd, s)");
    expect(src).not.toMatch(/writeFileSync\(/);
  });
});
