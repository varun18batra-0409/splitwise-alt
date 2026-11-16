import { describe, expect, it } from "vitest";
import { membersAsOf, membershipSpan, overlapped, peopleShown, sharedGroupRow } from "@/lib/left-view";
import { tripOver } from "@/lib/passport";
import { coverFor, coverSeenBy, photoAfterCut } from "@/lib/covers";
import { tagMatches } from "@/lib/http-cache";
import { squareNumbers } from "@/lib/square";

// Someone who left sees the group only as it was while they were in it. These are the pure rules (no database), so they always run:
// who was in a group at the same time (SA-1, SB-1, SB-5), head counts (GP-7), the group photo (SA-4, SB-16, D-5), caching (OP-11)
// and when a trip with no end day counts as over (SB-14).
//
// The Goa trip: Meera joins 1 Jan, Asha joins 5 Jan and leaves 20 Jan, Ravi joins 1 Mar.

const day = (s: string) => new Date(`${s}T10:00:00Z`);
const row = (id: string, groupId: string, joined: string, left: string | null = null, removed: string | null = null) => ({
  id, groupId, createdAt: day(joined), claimedAt: null as Date | null, seenAt: null as Date | null, leftAt: left ? day(left) : null, removedAt: removed ? day(removed) : null,
});
const meera = row("meera", "goa", "2026-01-01");
const asha = row("asha", "goa", "2026-01-05", "2026-01-20");
const ravi = row("ravi", "goa", "2026-03-01");

describe("who was in the group at the same time", () => {
  it("Asha and Ravi never overlapped; Asha and Meera did; so did Ravi and Meera", () => {
    expect(overlapped(membershipSpan(asha), membershipSpan(ravi))).toBe(false);
    expect(overlapped(membershipSpan(ravi), membershipSpan(asha))).toBe(false);
    expect(overlapped(membershipSpan(asha), membershipSpan(meera))).toBe(true);
    expect(overlapped(membershipSpan(ravi), membershipSpan(meera))).toBe(true);
  });
  it("the day one left counts as overlapping with the day the other joined", () => {
    const late = row("late", "goa", "2026-01-20");
    expect(overlapped(membershipSpan(asha), membershipSpan(late))).toBe(true);
  });
  it("a minute's grace: two things saved in the same breath still overlap, a day apart does not", () => {
    const left = { from: day("2026-01-05"), to: day("2026-01-20") };
    expect(overlapped(left, { from: new Date(day("2026-01-20").getTime() + 30_000), to: null })).toBe(true);
    expect(overlapped(left, { from: new Date(day("2026-01-20").getTime() + 86_400_000), to: null })).toBe(false);
  });
  it("someone who has not left is in until the end of time", () => {
    expect(membershipSpan(meera).to).toBeNull();
    expect(overlapped(membershipSpan(meera), membershipSpan(row("far", "goa", "2099-01-01")))).toBe(true);
  });
  it("a removed person's span ends the day they were removed", () => {
    const rex = row("rex", "goa", "2026-01-02", "2026-02-15", "2026-02-15");
    expect(membershipSpan(rex).to).toEqual(day("2026-02-15"));
  });
  it("joining means: claimed the name, else first opened the group, else was added", () => {
    const m = { ...row("x", "goa", "2026-01-01"), claimedAt: day("2026-02-01"), seenAt: day("2026-01-15") };
    expect(membershipSpan(m).from).toEqual(day("2026-02-01"));
    expect(membershipSpan({ ...m, claimedAt: null }).from).toEqual(day("2026-01-15"));
    expect(membershipSpan({ ...m, claimedAt: null, seenAt: null }).from).toEqual(day("2026-01-01"));
  });
  it("passport friends / canSeePassport / postcard people: Asha and Ravi are strangers, in both directions", () => {
    expect(sharedGroupRow([ravi], [asha])).toBeNull();
    expect(sharedGroupRow([asha], [ravi])).toBeNull();
    expect(sharedGroupRow([meera], [asha])?.id).toBe("meera");
    expect(sharedGroupRow([ravi], [meera])?.id).toBe("ravi");
  });
  it("two groups: a second group they were both in is enough", () => {
    const ashaFlat = row("asha-flat", "flat", "2026-02-01");
    const raviFlat = row("ravi-flat", "flat", "2026-03-05");
    expect(sharedGroupRow([ravi, raviFlat], [asha, ashaFlat])?.id).toBe("ravi-flat");
  });
  it("rows in different groups never overlap with each other", () => {
    expect(sharedGroupRow([row("a", "g1", "2026-01-01")], [row("b", "g2", "2026-01-01")])).toBeNull();
  });
  it("Our passports roster for Asha lists Asha and Meera only; Ravi's lists Ravi and Meera only", () => {
    const all = [meera, asha, ravi];
    const rosterOf = (me: (typeof all)[number]) => all.filter((m) => m.id === me.id || overlapped(membershipSpan(me), membershipSpan(m))).map((m) => m.id);
    expect(rosterOf(asha)).toEqual(["meera", "asha"]);
    expect(rosterOf(ravi)).toEqual(["meera", "ravi"]);
  });
  it("faces and people on Asha's own Goa card: Meera only, 2 people (Asha and Meera), never Ravi", () => {
    const others = [meera, ravi].filter((m) => overlapped(membershipSpan(asha), membershipSpan(m)));
    expect(others.map((m) => m.id)).toEqual(["meera"]);
    expect(others.length + 1).toBe(2);
  });
});

describe("head counts as the leaver knew the group (GP-7)", () => {
  // Meera, Asha (the viewer, left 20 Jan), Kabir (joined 2 Jan, still in) and Ravi (joined 1 Mar, still in).
  const m = (id: string, joined: string, left: string | null = null) => ({ id, createdAt: day(joined), leftAt: left ? day(left) : null, removedAt: null as Date | null });
  const members = [m("meera", "2026-01-01"), m("asha", "2026-01-05", "2026-01-20"), m("kabir", "2026-01-02"), m("ravi", "2026-03-01"), m("old", "2026-01-01", "2026-01-10")];
  const cut = day("2026-01-20");
  it("a leaver counts themselves and who was there when they left: 3 (Asha, Meera, Kabir), not 2 and not 4", () => {
    // 'old' left on 10 Jan, before Asha did, so he is not counted; Ravi joined later, so he is not counted.
    expect(peopleShown(members, "asha", cut).map((x) => x.id).sort()).toEqual(["asha", "kabir", "meera"]);
    expect(peopleShown(members, "asha", cut).length).toBe(3);
  });
  it("someone who left after the leaver still counts as there", () => {
    const withLater = [...members, m("later", "2026-01-03", "2026-02-01")];
    expect(peopleShown(withLater, "asha", cut).map((x) => x.id)).toContain("later");
  });
  it("someone still in the group: today's people (the ones who have not left)", () => {
    expect(peopleShown(members, "meera", null).map((x) => x.id).sort()).toEqual(["kabir", "meera", "ravi"]);
  });
  it("membersAsOf alone drops the leaver's own listing (leftAt kept), which is why Wrapped keeps the viewer by id", () => {
    const shown = membersAsOf(members, "asha", cut);
    expect(shown.find((x) => x.id === "asha")!.leftAt).not.toBeNull();
    expect(peopleShown(members, "asha", cut).some((x) => x.id === "asha")).toBe(true);
  });
  it("Dinner 3,000 split 1,000 each: per person is 3,000 / 3 = 1,000 (not 3,000 / 2 = 1,500)", () => {
    const people = peopleShown(members, "asha", cut).length;
    const dinner = [{ createdAt: day("2026-01-10"), amount: 3000, kind: "expense", deletedAt: null, spentAt: null, paidById: "asha", shares: [{ memberId: "asha", amount: 1000 }, { memberId: "meera", amount: 1000 }, { memberId: "kabir", amount: 1000 }] }];
    expect(dinner[0].shares.reduce((n, s) => n + s.amount, 0)).toBe(3000);
    expect(Math.round(3000 / people)).toBe(1000);
    expect(people).toBe(3);
    // The square tiles use the same head count.
    const n = squareNumbers({ expenses: dinner as never, payments: [], people, tripStart: "", tripEnd: "" });
    expect(n.people).toBe(3);
    expect(n.each).toBe(1000); // "each" = 3,000 / 3
  });
});

describe("the group photo (SA-4, SB-16, D-5)", () => {
  const asha20 = { leftAt: day("2026-01-20"), removedAt: null };
  it("a photo put up after Asha left is not hers to see; one from before is", () => {
    expect(photoAfterCut(day("2026-03-02"), asha20)).toBe(true);
    expect(photoAfterCut(day("2026-01-10"), asha20)).toBe(false);
  });
  it("Rex, removed 15 Feb: a photo from 10 Feb is fine, one from 2 Mar is not", () => {
    const rex = { leftAt: day("2026-02-15"), removedAt: day("2026-02-15") };
    expect(photoAfterCut(day("2026-02-10"), rex)).toBe(false);
    expect(photoAfterCut(day("2026-03-02"), rex)).toBe(true);
  });
  it("a member who is still in sees every photo", () => {
    expect(photoAfterCut(day("2030-01-01"), { leftAt: null, removedAt: null })).toBe(false);
  });
  it("D-5: a leaver gets the default cover for the group's type when the photo changed after they left", () => {
    const g = { id: "goa", type: "trip", cover: "own", coverAt: day("2026-03-02") };
    expect(coverFor(g)).toEqual({ kind: "own", src: `/api/group-photo/goa?v=${g.coverAt.getTime()}` });
    expect(coverFor(g, false, day("2026-01-20"))).toEqual({ kind: "beach" }); // a trip's default
    expect(coverSeenBy(g, day("2026-01-20"))).toMatchObject({ cover: "", coverAt: null });
    expect(coverFor({ ...g, type: "home" }, false, day("2026-01-20"))).toEqual({ kind: "city" });
  });
  it("D-5: the photo they saw stays when it was put up before they left; other covers are left alone; members are unaffected", () => {
    const before = { id: "goa", type: "trip", cover: "own", coverAt: day("2026-01-10") };
    expect(coverFor(before, false, day("2026-01-20")).kind).toBe("own");
    const picked = { id: "goa", type: "trip", cover: "mountain", coverAt: day("2026-03-02") };
    expect(coverFor(picked, false, day("2026-01-20")).kind).toBe("mountain");
    expect(coverSeenBy(picked, day("2026-01-20"))).toBe(picked);
    expect(coverFor({ id: "goa", type: "trip", cover: "own", coverAt: day("2026-03-02") }, false, null).kind).toBe("own");
  });
});

describe("keeping a photo on the phone (OP-11, SA-4)", () => {
  it("If-None-Match: exact, several, weak, and the star", () => {
    const tag = '"g-goa-1767000000000"';
    expect(tagMatches(tag, tag)).toBe(true);
    expect(tagMatches(`"x", ${tag}`, tag)).toBe(true);
    expect(tagMatches(`W/${tag}`, tag)).toBe(true);
    expect(tagMatches("*", tag)).toBe(true);
    expect(tagMatches('"g-goa-1"', tag)).toBe(false);
    expect(tagMatches(null, tag)).toBe(false);
  });
});

describe("a trip with no end day (SB-14)", () => {
  // Starts 2026-11-10, no end. Latest spending the owner may see: 2026-11-14.
  const trip = { tripStart: "2026-11-10", tripEnd: "" };
  it("spending on 14 Nov: hidden on 16 and 17, shown on 18", () => {
    expect(tripOver(trip, "2026-11-14", "2026-11-16")).toBe(false);
    expect(tripOver(trip, "2026-11-14", "2026-11-17")).toBe(false);
    expect(tripOver(trip, "2026-11-14", "2026-11-18")).toBe(true);
  });
  it("no spending at all: hidden on 13 Nov, shown on 14 Nov (3 days after the start)", () => {
    expect(tripOver(trip, undefined, "2026-11-13")).toBe(false);
    expect(tripOver(trip, undefined, "2026-11-14")).toBe(true);
  });
  it("spending before the start day does not pull the date back", () => {
    expect(tripOver(trip, "2026-11-01", "2026-11-13")).toBe(false);
  });
  it("a trip with an end day is over the day after it (unchanged)", () => {
    expect(tripOver({ tripStart: "2026-11-10", tripEnd: "2026-11-12" }, "2026-11-14", "2026-11-12")).toBe(false);
    expect(tripOver({ tripStart: "2026-11-10", tripEnd: "2026-11-12" }, undefined, "2026-11-13")).toBe(true);
  });
  it("an undated trip: over three days after the latest spending, or at once with none (unchanged)", () => {
    const undated = { tripStart: "", tripEnd: "" };
    expect(tripOver(undated, undefined, "2026-11-16")).toBe(true);
    expect(tripOver(undated, "2026-11-14", "2026-11-17")).toBe(false);
    expect(tripOver(undated, "2026-11-14", "2026-11-18")).toBe(true);
  });
});
