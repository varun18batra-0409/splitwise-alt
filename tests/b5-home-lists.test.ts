import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { gamesForStories, homeBills, potIdsToShow, recentGames, sortBillsByNextDue } from "@/lib/home/home-lists";

// OP-8 and GP-9: Home's lists keep the right rows, and no game story for a group the viewer left.
describe("B5 gamesForStories (GP-9)", () => {
  it("drops a game in a group the viewer left, keeps the rest", () => {
    const rows = [{ id: "a", groupId: "g1" }, { id: "b", groupId: "g2" }, { id: "c", groupId: "gone" }];
    const open = [{ group: { id: "g1" }, leaver: null }, { group: { id: "g2" }, leaver: { leftAt: new Date(1) } }];
    expect(gamesForStories(rows, open).map((r) => r.id)).toEqual(["a"]);
  });
});

describe("M4: which groups' games Home looks at", () => {
  it("potIdsToShow keeps current pot groups only: not a pot you left, not a flat or a trip", () => {
    const open = [
      { group: { id: "p1", type: "pot" }, leaver: null },
      { group: { id: "p2", type: "pot" }, leaver: { leftAt: new Date(1) } },
      { group: { id: "t1", type: "trip" }, leaver: null },
    ];
    expect(potIdsToShow(open)).toEqual(["p1"]);
  });
});

describe("L4: bills by days until they are next due", () => {
  // Today is the 25th of November 2026 in India (12:00Z is 17:30 in Kolkata). Days until each, worked by hand:
  //   day 25: today = 0.   day 26: 1.   day 31 (November has 30): the 30th = 5.   day 3: 3 December = 5 (to 30 Nov) + 3 = 8.
  const now = new Date("2026-11-25T12:00:00Z");
  const bill = (id: string, day: number, extra: Record<string, unknown> = {}) => ({ id, day, every: 1, startMonth: "2026-01", endMonth: "", paused: false, tz: "Asia/Kolkata", nature: "fixed", ...extra });
  it("on the 25th, the bill due on the 26th comes before the one due on the 3rd (the database order by day put the 3rd first)", () => {
    const got = sortBillsByNextDue([bill("a-third", 3), bill("b-26th", 26)], now);
    expect(got.map((b) => b.id)).toEqual(["b-26th", "a-third"]);
  });
  it("today, the 26th, the month's last day and the 3rd, in that order; ties by id; a paused or ended bill last", () => {
    const rows = [bill("e", 3), bill("d", 31), bill("g-paused", 26, { paused: true }), bill("c", 26), bill("b2", 25), bill("b1", 25), bill("f-ended", 10, { endMonth: "2026-10" })];
    expect(sortBillsByNextDue(rows, now).map((b) => b.id)).toEqual(["b1", "b2", "c", "d", "e", "f-ended", "g-paused"]);
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

  it("M4: 10 recent games in a pot the viewer left and 2 in a current one: Home gets the 2 current ones", async () => {
    const left = await mk("pot");
    const current = await mk("pot");
    const now = Date.now();
    for (let i = 0; i < 10; i++) await db.potGame.create({ data: { groupId: left, name: `Left ${i}`, hostId: "h", status: "done", finishedAt: new Date(now - (i + 1) * 60_000) } }); // newest
    for (let i = 0; i < 2; i++) await db.potGame.create({ data: { groupId: current, name: `Now ${i}`, hostId: "h", status: "done", finishedAt: new Date(now - (i + 1) * 3600_000) } }); // older
    const open = [{ group: { id: left, type: "pot" }, leaver: { leftAt: new Date() } }, { group: { id: current, type: "pot" }, leaver: null }];
    const before = await recentGames([left, current], new Date(now - 3 * 86_400_000));
    expect(before.filter((g) => g.groupId === current)).toHaveLength(0); // the old way: the left group filled all ten places
    const got = await recentGames(potIdsToShow(open), new Date(now - 3 * 86_400_000));
    expect(got.map((g) => g.name).sort()).toEqual(["Now 0", "Now 1"]);
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
