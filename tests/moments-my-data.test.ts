import { readFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { myDataCsv } from "@/lib/csv";
import { loadMyDataExtra } from "@/lib/my-data-extra";

// "Download my data" holds the moments you added (text only, no photos), and nothing written by other people.
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
const now = new Date("2026-11-12T10:00:00Z");
const empty = () => new Uint8Array();

async function account(name: string) {
  const a = await db.account.create({ data: { email: `mdm-${name}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}
afterAll(async () => {
  await db.moment.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("download my data: moments", () => {
  it("has the moments you added, with the group, your words, the day and a link, and none of other people's", async () => {
    const me = await account("Mia");
    const other = await account("Otto");
    const trip = await db.group.create({
      data: {
        name: `Moments data ${stamp}`, inviteCode: `mdm-${stamp}`, type: "trip", tripStart: "2026-03-10", tripEnd: "2026-03-14",
        members: { create: [{ name: "Mia", accountId: me.id, claimedAt: new Date() }, { name: "Otto", accountId: other.id, claimedAt: new Date() }] },
      },
      include: { members: true },
    });
    groupIds.push(trip.id);
    const mia = trip.members.find((m) => m.name === "Mia")!.id;
    const otto = trip.members.find((m) => m.name === "Otto")!.id;
    const mk = (by: string, acc: string, caption: string, takenOn: string, createdAt: Date) =>
      db.moment.create({ data: { groupId: trip.id, authorId: by, authorAccountId: acc, caption, takenOn, data: empty(), thumbData: empty(), createdAt } });
    const first = await mk(mia, me.id, "The boat we almost missed 😂", "2026-03-12", new Date("2026-03-12T09:00:00Z"));
    await mk(mia, me.id, "=1+1", "", new Date("2026-03-13T09:00:00Z"));
    await mk(otto, other.id, "Otto's secret words", "2026-03-11", new Date("2026-03-11T09:00:00Z"));

    const extra = await loadMyDataExtra(me, { [trip.id]: mia }, { [trip.id]: trip.name }, now, "UTC");
    expect(extra.moments.map((m) => [m.group, m.caption, m.day])).toEqual([
      [trip.name, "The boat we almost missed 😂", "Day 3"],
      [trip.name, "=1+1", ""],
    ]);
    expect(extra.moments[0].link).toBe(`/groups/${trip.id}/moments/${first.id}`);

    const csv = myDataCsv({ email: me.email, name: "Mia", createdAt: now }, [], now, "UTC", [], extra);
    expect(csv).toContain("Moments you added (text only, no photos)");
    expect(csv).toContain("The boat we almost missed 😂");
    expect(csv).toContain("2026-03-12");
    expect(csv).toContain("'=1+1"); // a spreadsheet formula is made harmless
    expect(csv).not.toContain("Otto's secret words");
    expect(csv).not.toContain(other.email);
  });

  it("nobody else's moments, and an empty list when you added none", async () => {
    const lonely = await account("Lena");
    const extra = await loadMyDataExtra(lonely, {}, {}, now, "UTC");
    expect(extra.moments).toEqual([]);
  });

  it("the privacy page names it, and the download route needs no other change", () => {
    const privacy = readFileSync("src/app/privacy/page.tsx", "utf8");
    expect(privacy).toContain("the moments you added");
    const route = readFileSync("src/app/api/my-data/route.ts", "utf8");
    expect(route).toContain("loadMyDataExtra");
  });
});
