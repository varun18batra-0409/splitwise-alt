import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { noteTripPlace, placeTag, pruneUnknownPlaces } from "@/lib/unknown-places";

// The real counting and clean-up, on the throwaway test database (never the live one).
// Place names are letters only, made unique per run so tests never collide.
const stamp = Array.from(String(Date.now()), (d) => "abcdefghij"[Number(d)]).join("");
const lisbon = `lisbon${stamp}`;
const secret = "test-secret";
const names = [lisbon, `old${stamp}`, "goa"];

afterAll(async () => {
  await db.unknownPlaceSeen.deleteMany({ where: { place: { in: names } } });
  await db.unknownPlace.deleteMany({ where: { place: { in: names } } });
});

const groupsOf = async (place: string) => (await db.unknownPlace.findUnique({ where: { place } }))?.groups;

describe("unknown places counting", () => {
  it("the same account saving twice counts once; two accounts twice; a third makes it reportable", async () => {
    await noteTripPlace("acc-a", lisbon, "", { secret });
    await noteTripPlace("acc-a", lisbon, "", { secret });
    expect(await groupsOf(lisbon)).toBe(1);
    await noteTripPlace("acc-b", lisbon, "", { secret });
    expect(await groupsOf(lisbon)).toBe(2);
    expect(await db.unknownPlace.count({ where: { place: lisbon, groups: { gte: 3 } } })).toBe(0);
    await noteTripPlace("acc-c", lisbon, "", { secret });
    expect(await groupsOf(lisbon)).toBe(3);
    expect(await db.unknownPlace.count({ where: { place: lisbon, groups: { gte: 3 } } })).toBe(1);
  });
  it("stores a hash, never the account id", async () => {
    const tags = (await db.unknownPlaceSeen.findMany({ where: { place: lisbon } })).map((r) => r.tag);
    expect(tags.sort()).toEqual(["acc-a", "acc-b", "acc-c"].map((a) => placeTag(secret, a, lisbon)).sort());
    expect(tags.join()).not.toContain("acc-");
  });
  it("a place that has a photo is not recorded", async () => {
    await noteTripPlace("acc-a", "Goa", "", { secret });
    expect(await groupsOf("goa")).toBeUndefined();
  });
});

describe("unknown places clean-up", () => {
  it("removes places not seen for a year, and places that now have a photo, with their tags", async () => {
    const old = `old${stamp}`;
    const longAgo = new Date(Date.now() - 400 * 86_400_000);
    await db.unknownPlace.create({ data: { place: old, groups: 4, firstSeen: longAgo, lastSeen: longAgo } });
    await db.unknownPlaceSeen.create({ data: { place: old, tag: "t1" } });
    await db.unknownPlace.create({ data: { place: "goa", groups: 5 } }); // a photo exists now
    await db.unknownPlaceSeen.create({ data: { place: "goa", tag: "t2" } });
    const removed = await pruneUnknownPlaces();
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await groupsOf(old)).toBeUndefined();
    expect(await groupsOf("goa")).toBeUndefined();
    expect(await db.unknownPlaceSeen.count({ where: { place: { in: [old, "goa"] } } })).toBe(0);
    // a recent place with no photo stays, with its tags
    expect(await groupsOf(lisbon)).toBe(3);
    expect(await db.unknownPlaceSeen.count({ where: { place: lisbon } })).toBe(3);
  });
});
