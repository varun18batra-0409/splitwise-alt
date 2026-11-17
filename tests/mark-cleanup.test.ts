import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// The scrambled removal notes go when their group is gone. Block notes NEVER expire (founder decision D-2): the clean-up leaves them alone.
const { db } = await import("@/lib/db");
const { cleanMarks } = await import("@/lib/mark-cleanup");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const keys: string[] = [];
const groupIds: string[] = [];
const key = (k: string) => (keys.push(k), k);
const has = async (k: string) => Boolean(await db.appSetting.findUnique({ where: { key: k } }));
afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: { in: keys } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

describe("daily clean-up of the settings-table notes", () => {
  it("block notes are never removed, however old or odd their value", async () => {
    const old = key(`blockfp:${"a".repeat(60)}old1:blocker-${stamp}`);
    const legacy = key(`blockfp:${"d".repeat(60)}leg1:blocker-${stamp}`);
    await db.appSetting.createMany({ data: [{ key: old, value: "2019-01-01T00:00:00.000Z" }, { key: legacy, value: "1" }] });
    await cleanMarks();
    expect(await has(old)).toBe(true);
    expect(await has(legacy)).toBe(true);
    expect((await db.appSetting.findUniqueOrThrow({ where: { key: legacy } })).value).toBe("1");
  });

  it("removal notes stay while their group exists and go when it is gone", async () => {
    const g = await db.group.create({ data: { name: `Mark ${stamp}`, inviteCode: `mc-${stamp}` } });
    groupIds.push(g.id);
    const live = key(`removed:${g.id}:${"e".repeat(64)}`);
    const dead = key(`removed:no-such-group-${stamp}:${"f".repeat(64)}`);
    await db.appSetting.createMany({ data: [{ key: live, value: "{}" }, { key: dead, value: "{}" }] });
    const r = await cleanMarks();
    expect(r.removed).toBeGreaterThanOrEqual(1);
    expect(await has(live)).toBe(true);
    expect(await has(dead)).toBe(false);
  });

  it("it reads every page in key order: more than one page of dead notes are all removed", async () => {
    const dead = Array.from({ length: 620 }, (_, i) => key(`removed:gone-${stamp}-${String(i).padStart(4, "0")}:${"9".repeat(64)}`));
    await db.appSetting.createMany({ data: dead.map((k) => ({ key: k, value: "{}" })) });
    await cleanMarks();
    expect(await db.appSetting.count({ where: { key: { in: dead } } })).toBe(0);
  });

  it("the daily job runs it, and the privacy page promises no expiry", () => {
    expect(readFileSync("src/app/api/cron/daily/route.ts", "utf8")).toContain('part("cleanup-marks"');
    const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");
    expect(privacy).toContain("it’s erased when they unblock or delete their own account.");
    expect(privacy).not.toContain("after 2 years");
  });
});
