import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { buildStories } = await import("@/lib/home/stories");
const { loadMomentStoryGroups } = await import("@/lib/moments-db");
const { momentPageStories } = await import("@/lib/moments-stories");

// Moments in Home's story circles: one circle per group, lit again by each new moment, never showing what the viewer may not see.
const now = new Date("2026-11-13T12:00:00Z");
const base = { now, trips: [], games: [], squared: [], collections: [], memories: [], wrapped: [] };
const frame = (id: string, kicker: string, head = "", line = "") => ({ id, thumb: `/api/moment-photo/${id}?s=t`, full: `/api/moment-photo/${id}?s=f`, kicker, head, line });

describe("the story built from moments", () => {
  it("is one circle per group, with the small copy as its picture and each photo as a frame", () => {
    const [s] = buildStories({ ...base, moments: [{ groupId: "g1", groupName: "Thailand trip", newestId: "m2", at: new Date("2026-11-13T11:00:00Z"), frames: [frame("m2", "Nupur added a moment", "The boat we almost missed 😂", "Day 3"), frame("m1", "You added a moment")] }] });
    expect(s).toMatchObject({ kind: "moment", label: "Thailand", short: "Moments", cta: "See our moments", href: "/groups/g1/moments", photo: "/api/moment-photo/m2?s=t", headline: "Nupur added a moment", line: "2 new moments" });
    expect(s.frames).toEqual([
      { kind: "photo", photo: "/api/moment-photo/m2?s=f", kicker: "Nupur added a moment", head: "The boat we almost missed 😂", line: "Day 3" },
      { kind: "photo", photo: "/api/moment-photo/m1?s=f", kicker: "You added a moment", head: "", line: undefined },
    ]);
  });

  it("changes its id when a new moment arrives, so the circle lights up again", () => {
    const one = buildStories({ ...base, moments: [{ groupId: "g1", groupName: "Goa", newestId: "m1", at: now, frames: [frame("m1", "Riya added a moment")] }] })[0];
    const two = buildStories({ ...base, moments: [{ groupId: "g1", groupName: "Goa", newestId: "m2", at: now, frames: [frame("m2", "Riya added a moment"), frame("m1", "Riya added a moment")] }] })[0];
    expect(one.id).toBe("moment-g1-m1");
    expect(two.id).toBe("moment-g1-m2");
    expect(one.id).not.toBe(two.id);
  });

  it("says nothing about the photo itself: only the person's own words and day, and a plain count", () => {
    const [s] = buildStories({ ...base, moments: [{ groupId: "g1", groupName: "Goa", newestId: "m1", at: now, frames: [frame("m1", "Riya added a moment")] }] });
    expect(s.line).toBe("A new moment");
    expect(JSON.stringify(s.frames)).not.toMatch(/sunset|beach|smile|view|selfie/i);
  });

  it("no moments, no story; the existing stories are untouched when the input has none", () => {
    expect(buildStories({ ...base, moments: [] })).toEqual([]);
    expect(buildStories({ ...base })).toEqual([]);
  });
});

describe("the circles at the top of Our moments", () => {
  const card = (id: string, who: string, me: boolean, days: number) => ({
    id, groupId: "g1", authorId: `m-${who}`, authorAccountId: `a-${who}`, authorName: me ? "You" : who, authorInitial: who[0], authorIsMe: me, caption: `from ${who}`, takenOn: "", day: "Day 2",
    width: 1600, height: 1200, createdAt: new Date(now.getTime() - days * 86_400_000), thumb: `/t/${id}`, full: `/f/${id}/`, reactions: [],
  });
  it("the trip first, then one circle per person with a moment in the last 7 days", () => {
    const cards = [card("m3", "Nupur", false, 0.1), card("m2", "Riya", false, 2), card("m1", "Nupur", false, 6), card("old", "Zed", false, 9)];
    const s = momentPageStories(cards, "g1", "Thailand trip", now);
    expect(s.map((x) => x.label)).toEqual(["Thailand", "Nupur", "Riya"]);
    expect(s[0].frames).toHaveLength(3);
    expect(s[1].frames).toHaveLength(2);
    expect(s.find((x) => x.label === "Zed")).toBeUndefined();
  });
  it("nothing in the last week: no circles", () => {
    expect(momentPageStories([card("old", "Zed", false, 9)], "g1", "Goa", now)).toEqual([]);
  });
});

// ---- with the database: who the Home loader leaves out ----
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
const hours = (h: number) => new Date(Date.now() - h * 3_600_000);
const empty = () => new Uint8Array();
async function account(name: string) {
  const a = await db.account.create({ data: { email: `ms-${name}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}
afterAll(async () => {
  await db.moment.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.block.deleteMany({ where: { OR: [{ blockerId: { in: accountIds } }, { blockedId: { in: accountIds } }] } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("Home's moment stories from the database", () => {
  async function crew(label: string) {
    const [me, nupur, riya, lou, rex] = await Promise.all(["Me", "Nupur", "Riya", "Lou", "Rex"].map((n) => account(`${n}${label}`)));
    const g = await db.group.create({
      data: {
        name: `Thailand ${label} ${stamp}`, inviteCode: `ms-${label}-${stamp}`, type: "trip", tripStart: "2026-11-10", tripEnd: "2026-11-14",
        members: {
          create: [
            { name: "Me", accountId: me.id, claimedAt: new Date(), createdAt: new Date(2026, 0, 1) },
            { name: "Nupur", accountId: nupur.id, claimedAt: new Date(), createdAt: new Date(2026, 0, 2) },
            { name: "Riya", accountId: riya.id, claimedAt: new Date(), createdAt: new Date(2026, 0, 3) },
            { name: "Lou", accountId: lou.id, claimedAt: new Date(), createdAt: new Date(2026, 0, 4), leftAt: hours(30) },
            { name: "Rex", accountId: rex.id, claimedAt: new Date(), createdAt: new Date(2026, 0, 5), leftAt: hours(30), removedAt: hours(30), removedById: "x" },
            { name: "Guest", createdAt: new Date(2026, 0, 6), claimedAt: new Date() },
          ],
        },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const mem = (n: string) => g.members.find((m) => m.name === n)!.id;
    const add = (by: string, acc: { id: string }, caption: string, createdAt: Date, takenOn = "") =>
      db.moment.create({ data: { groupId: g.id, authorId: mem(by), authorAccountId: acc.id, caption, takenOn, data: empty(), thumbData: empty(), createdAt } });
    return { g, me, nupur, riya, lou, rex, mem, add };
  }

  it("the newest first, 'You added a moment' for your own, the day from the trip, and only the last 3 days", async () => {
    const c = await crew("a");
    const old = await c.add("Nupur", c.nupur, "too old", hours(80));
    const a = await c.add("Nupur", c.nupur, "The boat", hours(5), "2026-11-12");
    const b = await c.add("Me", c.me, "mine", hours(2));
    const [s] = await loadMomentStoryGroups({ [c.g.id]: c.mem("Me") });
    expect(s.groupId).toBe(c.g.id);
    expect(s.newestId).toBe(b.id);
    expect(s.frames.map((f) => [f.id, f.kicker, f.head, f.line])).toEqual([
      [b.id, "You added a moment", "mine", ""],
      [a.id, "Nupur added a moment", "The boat", "Day 3"],
    ]);
    expect(s.frames.some((f) => f.id === old.id)).toBe(false);
    expect(s.frames[0].thumb).toBe(`/api/moment-photo/${b.id}?s=t`);
  });

  it("leaves out blocked authors (either way)", async () => {
    const c = await crew("b");
    await c.add("Nupur", c.nupur, "from Nupur", hours(3));
    const r = await c.add("Riya", c.riya, "from Riya", hours(4));
    await db.block.create({ data: { blockerId: c.me.id, blockedId: c.nupur.id } });
    let [s] = await loadMomentStoryGroups({ [c.g.id]: c.mem("Me") });
    expect(s.frames.map((f) => f.id)).toEqual([r.id]);
    await db.block.deleteMany({ where: { blockerId: c.me.id } });
    await db.block.create({ data: { blockerId: c.riya.id, blockedId: c.me.id } }); // Riya blocked me
    [s] = await loadMomentStoryGroups({ [c.g.id]: c.mem("Me") });
    expect(s.frames.map((f) => f.head)).toEqual(["from Nupur"]);
    // Only blocked authors: no circle at all.
    await db.block.create({ data: { blockerId: c.me.id, blockedId: c.nupur.id } });
    expect(await loadMomentStoryGroups({ [c.g.id]: c.mem("Me") })).toEqual([]);
  });

  it("people who left or were removed get no circle; a guest name does", async () => {
    const c = await crew("c");
    await c.add("Nupur", c.nupur, "fresh", hours(1));
    expect(await loadMomentStoryGroups({ [c.g.id]: c.mem("Lou") })).toEqual([]);
    expect(await loadMomentStoryGroups({ [c.g.id]: c.mem("Rex") })).toEqual([]);
    const guest = await loadMomentStoryGroups({ [c.g.id]: c.mem("Guest") });
    expect(guest).toHaveLength(1);
    expect(guest[0].frames[0].kicker).toBe("Nupur added a moment");
  });

  it("a deleted group, a group that isn't a trip, and a group you aren't in give nothing; at most the newest 6 frames", async () => {
    const c = await crew("d");
    for (let i = 0; i < 8; i++) await c.add("Nupur", c.nupur, `m${i}`, hours(1 + i / 10));
    expect((await loadMomentStoryGroups({ [c.g.id]: c.mem("Me") }))[0].frames).toHaveLength(6);
    expect(await loadMomentStoryGroups({})).toEqual([]);
    await db.group.update({ where: { id: c.g.id }, data: { deletedAt: new Date() } });
    expect(await loadMomentStoryGroups({ [c.g.id]: c.mem("Me") })).toEqual([]);
    await db.group.update({ where: { id: c.g.id }, data: { deletedAt: null, type: "home" } });
    expect(await loadMomentStoryGroups({ [c.g.id]: c.mem("Me") })).toEqual([]);
  });
});
