import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// L-1: the scrambled block notes are kept 2 years; removal notes go when their group is gone. No emails are in either.
const { db } = await import("@/lib/db");
const { cleanMarks } = await import("@/lib/mark-cleanup");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const NOW = new Date("2026-11-17T03:00:00Z");
const keys: string[] = [];
const groupIds: string[] = [];
const key = (k: string) => (keys.push(k), k);
const has = async (k: string) => Boolean(await db.appSetting.findUnique({ where: { key: k } }));
afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: { in: keys } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

describe("daily clean-up of block and removal notes", () => {
  it("block notes older than 2 years go; newer ones stay; one with no readable day starts its 2 years now", async () => {
    const old = key(`blockfp:${"a".repeat(60)}old1:blocker-${stamp}`);
    const justUnder = key(`blockfp:${"b".repeat(60)}new1:blocker-${stamp}`);
    const fresh = key(`blockfp:${"c".repeat(60)}new2:blocker-${stamp}`);
    const legacy = key(`blockfp:${"d".repeat(60)}leg1:blocker-${stamp}`);
    await db.appSetting.createMany({
      data: [
        { key: old, value: "2024-11-16T00:00:00.000Z" }, // 2 years and a day before NOW
        { key: justUnder, value: "2024-11-18T00:00:00.000Z" }, // 1 year and 364 days
        { key: fresh, value: "2026-11-01T00:00:00.000Z" },
        { key: legacy, value: "1" },
      ],
    });
    const r = await cleanMarks(NOW);
    expect(r.blocks).toBeGreaterThanOrEqual(1);
    expect(await has(old)).toBe(false);
    expect(await has(justUnder)).toBe(true);
    expect(await has(fresh)).toBe(true);
    expect(await has(legacy)).toBe(true);
    expect((await db.appSetting.findUniqueOrThrow({ where: { key: legacy } })).value).toBe(NOW.toISOString());
  });

  it("removal notes stay while their group exists and go when it is gone", async () => {
    const g = await db.group.create({ data: { name: `Mark ${stamp}`, inviteCode: `mc-${stamp}` } });
    groupIds.push(g.id);
    const live = key(`removed:${g.id}:${"e".repeat(64)}`);
    const dead = key(`removed:no-such-group-${stamp}:${"f".repeat(64)}`);
    await db.appSetting.createMany({ data: [{ key: live, value: "{}" }, { key: dead, value: "{}" }] });
    const r = await cleanMarks(NOW);
    expect(r.removed).toBeGreaterThanOrEqual(1);
    expect(await has(live)).toBe(true);
    expect(await has(dead)).toBe(false);
  });

  it("the daily job runs it", () => {
    expect(readFileSync("src/app/api/cron/daily/route.ts", "utf8")).toContain('part("cleanup-marks"');
  });
});
