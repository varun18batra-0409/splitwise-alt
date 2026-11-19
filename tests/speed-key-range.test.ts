import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { keyStarting } from "@/lib/key-range";
import { coveredByOldGroupRecord } from "@/lib/nudge-zones";
import { deferredToday } from "@/lib/daily-job";
import { DEFAULT_TIME_ZONE, dayKey } from "@/lib/dates";

// Speed step 16: "keys that start with ..." lookups on NotifyLog are written as a key range, so the key's own index is used.
// The answers must be the ones "starts with" gave.
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const made: string[] = [];
const note = async (key: string, state = "done", createdAt?: Date) => {
  made.push(key);
  await db.notifyLog.create({ data: { key, state, ...(createdAt ? { createdAt } : {}) } });
};
afterAll(async () => {
  await db.notifyLog.deleteMany({ where: { key: { in: made } } });
});

describe("keyStarting", () => {
  it("is the prefix up to the biggest character", () => {
    expect(keyStarting("a:")).toEqual({ gte: "a:", lt: "a:\u{10ffff}" });
  });

  it("finds exactly the keys that start with the prefix: longer ones, accents, emoji, underscore and percent signs in the prefix included", async () => {
    const p = `kr_${stamp}%:sent:`; // a "_" and a "%" would be wild cards in a LIKE search; in a range they are just characters
    for (const k of [`${p}m1`, `${p}m2`, `${p}`, `${p}é`, `${p}😀`, `kr_${stamp}%:sent`, `kr_${stamp}%:other:m1`, `krX${stamp}%:sent:m9`, `kr_${stamp}Z:sent:m9`]) await note(k);
    const rows = await db.notifyLog.findMany({ where: { key: keyStarting(p) }, select: { key: true } });
    expect(rows.map((r) => r.key).sort()).toEqual([`${p}`, `${p}m1`, `${p}m2`, `${p}é`, `${p}😀`].sort());
    expect(await db.notifyLog.findFirst({ where: { key: keyStarting(`${p}zzz`) } })).toBeNull();
  });

  it("uses the key's index (a SEARCH, not a full SCAN)", async () => {
    const plan = (await db.$queryRawUnsafe<{ detail: string }[]>(`EXPLAIN QUERY PLAN SELECT "key" FROM "NotifyLog" WHERE "key" >= 'a:' AND "key" < 'a:' || char(1114111)`)).map((r) => r.detail).join(" | ");
    expect(plan).toMatch(/SEARCH/);
    expect(plan).not.toMatch(/SCAN/);
  });
});

describe("the callers give the same answers as before", () => {
  it("coveredByOldGroupRecord: a done record with no per-person marks covers everyone; with a mark it does not", async () => {
    // (see nudge-zones.ts: the old code's record covers everyone; the new code's own record, with marks, covers only people with no zone yet)
    // (Written a minute ahead, so they count as newer than the switch-over moment, which is what the second kind of record is.)
    const later = new Date(Date.now() + 60_000);
    const bare = `kr-bare-${stamp}`;
    await note(bare, "done", later);
    expect(await coveredByOldGroupRecord(bare, new Date(), "m1")).toBe(true);
    const marked = `kr-marked-${stamp}`;
    await note(marked, "done", later);
    await note(`${marked}:sent:m2`, "done", later);
    expect(await coveredByOldGroupRecord(marked, new Date(), "m1")).toBe(false);
    expect(await coveredByOldGroupRecord(`kr-none-${stamp}`, new Date(), "m1")).toBe(false);
  });

  it("deferredToday lists only today's deferred parts", async () => {
    const now = new Date();
    const day = dayKey(now, DEFAULT_TIME_ZONE);
    const before = await deferredToday(now);
    await note(`daily-deferred:${day}:bills`);
    await note(`daily-deferred:1999-01-01:reminders`);
    const after = await deferredToday(now);
    expect(after).toContain("bills");
    expect(after).not.toContain("reminders");
    expect(before).not.toContain("bills");
  });
});
