import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { dayGroups, loadGroupPostcards, postcardVisible, tripStampCard } from "@/lib/group-memories";

// R4: a group's Memories tab. Pure checks first (hand-worked dates), then the postcards (throwaway database rows).

const trip = { start: "2026-10-08", end: "2026-10-12" }; // 8, 9, 10, 11, 12 Oct: Day 1 to Day 5
const card = (id: string, takenOn: string, createdAt: string) => ({ id, takenOn, createdAt: new Date(createdAt) });
const label = (c: ReturnType<typeof card>[], today = "2026-10-10", t = trip, tz = "Asia/Kolkata") => dayGroups(c, t.start, t.end, tz, today).map((d) => d.label);

describe("moments by day", () => {
  it("taken on 2026-10-08: Day 1 · 8 Oct", () => {
    expect(label([card("a", "2026-10-08", "2026-10-09T10:00:00Z")])).toEqual(["Day 1 · 8 Oct"]);
  });
  it("no day given, added 2026-10-10 20:00 UTC: in Asia/Kolkata (UTC+5:30) it is 01:30 on 11 Oct, so Day 4 · 11 Oct", () => {
    expect(label([card("a", "", "2026-10-10T20:00:00Z")])).toEqual(["Day 4 · 11 Oct"]);
    // The same moment in UTC is still 10 Oct: Day 3.
    expect(label([card("a", "", "2026-10-10T20:00:00Z")], "2026-10-10", trip, "UTC")).toEqual(["Day 3 · 10 Oct"]);
  });
  it("added 20 Oct, after the trip: just the date, 20 Oct", () => {
    expect(label([card("a", "", "2026-10-20T08:00:00Z")], "2026-10-21")).toEqual(["20 Oct"]);
  });
  it("a trip with no dates: just the date, 8 Oct", () => {
    expect(label([card("a", "2026-10-08", "2026-10-08T09:00:00Z")], "2026-10-10", { start: "", end: "" })).toEqual(["8 Oct"]);
  });
  it("a trip with a start and no end is one day: Day 1 · 8 Oct, and the next day is just 9 Oct", () => {
    expect(label([card("a", "2026-10-08", "2026-10-08T09:00:00Z"), card("b", "2026-10-09", "2026-10-09T09:00:00Z")], "2026-10-08", { start: "2026-10-08", end: "" })).toEqual(["9 Oct", "Day 1 · 8 Oct"]);
  });
  it("several moments on one day share one heading", () => {
    const g = dayGroups([card("a", "2026-10-09", "2026-10-09T07:00:00Z"), card("b", "2026-10-09", "2026-10-09T08:00:00Z")], trip.start, trip.end, "UTC", "2026-10-10");
    expect(g).toHaveLength(1);
    expect(g[0].label).toBe("Day 2 · 9 Oct");
    expect(g[0].cards.map((c) => c.id)).toEqual(["b", "a"]); // while the trip is on: newest first
  });
  const three = [card("one", "2026-10-08", "2026-10-08T07:00:00Z"), card("two", "2026-10-09", "2026-10-09T07:00:00Z"), card("three", "2026-10-10", "2026-10-10T07:00:00Z")];
  it("while the trip is on, the newest day is first", () => {
    expect(label(three, "2026-10-10")).toEqual(["Day 3 · 10 Oct", "Day 2 · 9 Oct", "Day 1 · 8 Oct"]);
  });
  it("once the trip is over (13 Oct), Day 1 comes first", () => {
    expect(label(three, "2026-10-13")).toEqual(["Day 1 · 8 Oct", "Day 2 · 9 Oct", "Day 3 · 10 Oct"]);
  });
  it("on the last day itself the trip is still on; the day after, it is over", () => {
    expect(label(three, "2026-10-12")[0]).toBe("Day 3 · 10 Oct");
    expect(label(three, "2026-10-13")[0]).toBe("Day 1 · 8 Oct");
  });
});

describe("the trip's passport stamp", () => {
  const thailand = { id: "g1", name: "Thailand trip", tripStart: "2026-05-05", tripEnd: "2026-05-10", tripPlace: "Bangkok, Phuket", tripCountry: "TH", memberCount: 4 };
  it("Thailand 5–10 May 2026: THAILAND / MAY 2026, 5–10 May 2026, 6 days, Relive trip opens the report", () => {
    expect(tripStampCard(thailand, "IN", "2026-11-14")).toEqual({ title: "Thailand", stampText: "THAILAND / MAY 2026", dates: "5–10 May 2026", days: 6, reliveHref: "/groups/g1/report" });
  });
  it("a trip that has not started, or has no dates, has no stamp", () => {
    expect(tripStampCard({ ...thailand, tripStart: "2027-01-05", tripEnd: "2027-01-10" }, "IN", "2026-11-14")).toBeNull();
    expect(tripStampCard({ ...thailand, tripStart: "", tripEnd: "" }, "IN", "2026-11-14")).toBeNull();
  });
  it("someone who left before the trip began did not go: no stamp; leaving during or after keeps it", () => {
    expect(tripStampCard(thailand, "IN", "2026-11-14", new Date("2026-05-01T00:00:00Z"))).toBeNull();
    expect(tripStampCard(thailand, "IN", "2026-11-14", new Date("2026-05-07T00:00:00Z"))?.stampText).toBe("THAILAND / MAY 2026");
  });
});

describe("whose postcards show (pure)", () => {
  it("your own sent card always; a received card unless a block either way; never anyone else's", () => {
    const blocked = new Set(["b"]);
    expect(postcardVisible("me", { fromId: "me", toId: "b" }, blocked)).toBe(true);
    expect(postcardVisible("me", { fromId: "a", toId: "me" }, blocked)).toBe(true);
    expect(postcardVisible("me", { fromId: "b", toId: "me" }, blocked)).toBe(false);
    expect(postcardVisible("me", { fromId: "a", toId: "b" }, blocked)).toBe(false);
  });
});

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];
afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } }); // postcards and blocks go with the accounts
});
const mk = async (name: string) => {
  const a = await db.account.create({ data: { email: `gm-${name}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
};
const mkGroup = async (tag: string, people: { name: string; accountId: string }[]) => {
  const g = await db.group.create({
    data: { name: `gm ${tag} ${stamp}`, type: "trip", inviteCode: `gm-${tag}-${stamp}`, members: { create: people.map((p) => ({ ...p, claimedAt: new Date() })) } },
    include: { members: true },
  });
  groupIds.push(g.id);
  return g;
};
const send = (fromId: string, toId: string, groupId: string, o: { opensAt?: Date } = {}) =>
  db.postcard.create({ data: { fromId, toId, groupId, front: "print:beach", message: "Wish you were here", ...o } });

describe("a group's postcards (database)", () => {
  it("A sends B a card from the group: B and A see it; C, in the same group, sees nothing; a card from another group is not here", async () => {
    const [A, B, C] = [await mk("A"), await mk("B"), await mk("C")];
    const g = await mkGroup("one", [{ name: "A", accountId: A.id }, { name: "B", accountId: B.id }, { name: "C", accountId: C.id }]);
    const other = await mkGroup("two", [{ name: "A", accountId: A.id }, { name: "B", accountId: B.id }]);
    const card = await send(A.id, B.id, g.id);
    await send(A.id, B.id, other.id);
    expect((await loadGroupPostcards(A.id, g.id)).map((p) => [p.id, p.direction, p.who])).toEqual([[card.id, "sent", "B"]]);
    expect((await loadGroupPostcards(B.id, g.id)).map((p) => [p.id, p.direction, p.who])).toEqual([[card.id, "received", "A"]]);
    expect(await loadGroupPostcards(C.id, g.id)).toEqual([]);
  });

  it("B blocks A: B's Memories hides A's card; A still sees the one they sent", async () => {
    const [A, B] = [await mk("A2"), await mk("B2")];
    const g = await mkGroup("block", [{ name: "A2", accountId: A.id }, { name: "B2", accountId: B.id }]);
    const card = await send(A.id, B.id, g.id);
    await db.block.create({ data: { blockerId: B.id, blockedId: A.id } });
    expect(await loadGroupPostcards(B.id, g.id)).toEqual([]);
    expect((await loadGroupPostcards(A.id, g.id)).map((p) => p.id)).toEqual([card.id]);
  });

  it("a received card that is still sealed shows only when it opens: no card row", async () => {
    const [A, B] = [await mk("A3"), await mk("B3")];
    const g = await mkGroup("sealed", [{ name: "A3", accountId: A.id }, { name: "B3", accountId: B.id }]);
    const opens = new Date(Date.now() + 5 * 86_400_000);
    await send(A.id, B.id, g.id, { opensAt: opens });
    const [got] = await loadGroupPostcards(B.id, g.id);
    expect(got.row).toBeNull();
    expect(got.sealedUntil?.getTime()).toBe(opens.getTime());
    const [sent] = await loadGroupPostcards(A.id, g.id);
    expect(sent.row).not.toBeNull(); // the sender wrote it, so they see it
    expect(sent.sealedUntil).toBeNull();
  });

  it("someone removed from the group has no memories at all, postcards included", async () => {
    const [A, B] = [await mk("A4"), await mk("B4")];
    const g = await mkGroup("removed", [{ name: "A4", accountId: A.id }, { name: "B4", accountId: B.id }]);
    await send(A.id, B.id, g.id);
    await db.member.update({ where: { id: g.members.find((m) => m.accountId === B.id)!.id }, data: { removedAt: new Date(), leftAt: new Date() } });
    expect(await loadGroupPostcards(B.id, g.id)).toEqual([]);
    expect((await loadGroupPostcards(A.id, g.id)).length).toBe(1);
  });

  it("someone who left on their own still sees their own postcards", async () => {
    const [A, B] = [await mk("A5"), await mk("B5")];
    const g = await mkGroup("left", [{ name: "A5", accountId: A.id }, { name: "B5", accountId: B.id }]);
    await send(A.id, B.id, g.id);
    await db.member.update({ where: { id: g.members.find((m) => m.accountId === B.id)!.id }, data: { leftAt: new Date() } });
    expect((await loadGroupPostcards(B.id, g.id)).length).toBe(1);
  });
});
