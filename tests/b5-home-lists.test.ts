import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gamesForStories, homeBills, recentGames } from "@/lib/home/home-lists";

// OP-8 and GP-9: Home's lists keep the right rows, and no game story for a group the viewer left.
describe("B5 gamesForStories (GP-9)", () => {
  it("drops a game in a group the viewer left, keeps the rest", () => {
    const rows = [{ id: "a", groupId: "g1" }, { id: "b", groupId: "g2" }, { id: "c", groupId: "gone" }];
    const open = [{ group: { id: "g1" }, leaver: null }, { group: { id: "g2" }, leaver: { leftAt: new Date(1) } }];
    expect(gamesForStories(rows, open).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("B5 Home lists (real database)", () => {
  let db: typeof import("@/lib/db").db;
  beforeAll(async () => {
    db = (await import("@/lib/db")).db;
  });
  const ids: string[] = [];
  afterAll(async () => {
    await db.potGame.deleteMany({ where: { groupId: { in: ids } } });
    await db.bill.deleteMany({ where: { groupId: { in: ids } } });
    await db.member.deleteMany({ where: { groupId: { in: ids } } });
    await db.group.deleteMany({ where: { id: { in: ids } } });
  });
  const mk = async (type: string) => {
    const g = await db.group.create({ data: { name: `b5-${type}`, type, currency: "INR", inviteCode: `b5hl-${Date.now()}-${Math.random()}`, members: { create: [{ name: "A" }] } } });
    ids.push(g.id);
    return g.id;
  };

  it("25 bills across two flats: the bill due tomorrow (day 18) is in the list", async () => {
    const f1 = await mk("home");
    const f2 = await mk("home");
    // 24 bills due on the 20th–28th (day-of-month), one on the 18th; the old "take 20" with no order could drop it.
    for (let i = 0; i < 24; i++) await db.bill.create({ data: { groupId: i % 2 ? f1 : f2, name: `Bill ${i}`, day: 20 + (i % 9), startMonth: "2026-11" } });
    const due = await db.bill.create({ data: { groupId: f1, name: "Due tomorrow", day: 18, startMonth: "2026-11" } });
    const got = await homeBills([f1, f2]);
    expect(got.length).toBe(25);
    expect(got[0].id).toBe(due.id); // soonest first
  });

  it("12 games: recentGames gives the 10 newest by finishedAt", async () => {
    const pot = await mk("pot");
    const now = Date.now();
    for (let i = 0; i < 12; i++) await db.potGame.create({ data: { groupId: pot, name: `Game ${i}`, hostId: "h", status: "done", finishedAt: new Date(now - i * 3600_000) } });
    const got = await recentGames([pot], new Date(now - 3 * 86_400_000));
    expect(got.length).toBe(10);
    // Hand-worked: finished 0..9 hours ago are kept, 10 and 11 hours ago are not.
    const oldest = Math.min(...got.map((g) => g.finishedAt!.getTime()));
    expect(oldest).toBe(now - 9 * 3600_000);
  });
});
