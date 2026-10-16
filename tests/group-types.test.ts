import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { GROUP_TYPES, isGroupType, ratioFromIncomes, weightsLabel, parseWeight } from "@/lib/group-types";
import { createGroupFor, updateSharing } from "@/lib/group-setup";
import { addRegistered } from "@/lib/invites";

// Group types (Trip · Home · Couple · Other) and the group's own split.

const stamp = Date.now();
const made: string[] = [];
afterAll(async () => {
  for (const id of made) await db.group.delete({ where: { id } }).catch(() => {});
  await db.account.deleteMany({ where: { email: { contains: `gt-${stamp}` } } });
});

describe("group types", () => {
  it("has the four types, each with a name hint", () => {
    expect(GROUP_TYPES.map((t) => t.id)).toEqual(["trip", "home", "couple", "other"]);
    for (const t of GROUP_TYPES) expect(t.namePlaceholder.length).toBeGreaterThan(0);
    expect(isGroupType("home")).toBe(true);
    expect(isGroupType("business")).toBe(false);
  });
});

describe("couple ratio from incomes", () => {
  it("works out whole percents that add to 100", () => {
    expect(ratioFromIncomes(110000, 90000)).toEqual([55, 45]);
    expect(ratioFromIncomes(1, 2)).toEqual([33, 67]);
    expect(ratioFromIncomes(0, 0)).toEqual([50, 50]);
    expect(ratioFromIncomes(1, 0)).toEqual([99, 1]); // nobody pays 0% or 100% of a shared home
  });
});

describe("split labels and typed weights", () => {
  it("labels uneven splits and stays quiet for equal ones", () => {
    expect(weightsLabel([55, 45])).toBe("55 / 45");
    expect(weightsLabel([120, 100, 100])).toBe("1.2 / 1 / 1");
    expect(weightsLabel([150, 100])).toBe("1.5 / 1");
    expect(weightsLabel([100, 100])).toBe("");
    expect(weightsLabel([100])).toBe("");
  });
  it("reads shares as hundredths", () => {
    expect(parseWeight("1.2")).toBe(120);
    expect(parseWeight("0")).toBe(0);
    expect(parseWeight("55")).toBe(5500);
    expect(parseWeight("-1")).toBeNull();
    expect(parseWeight("1.255")).toBeNull();
    expect(parseWeight("abc")).toBeNull();
    expect(parseWeight("21")).toBeNull(); // more than 20 shares is a typo
  });
});

describe("creating a group of each type", () => {
  it("a couple created at 55 / 45 gives the creator 55 and whoever joins 45", async () => {
    const me = await db.account.create({ data: { email: `me-gt-${stamp}@example.com`, name: "Varun" } });
    const riya = await db.account.create({ data: { email: `riya-gt-${stamp}@example.com`, name: "Riya" } });
    const g = await createGroupFor(me, { type: "couple", name: "Us", yourName: "Varun", currency: "INR", ratio: 55 });
    made.push(g.id);
    expect(g.type).toBe("couple");
    expect(g.joinWeight).toBe(45);
    expect(g.members[0].splitWeight).toBe(55);
    const added = await addRegistered(g.id, g.members[0].id, riya.id, "https://example.com");
    expect(added.ok).toBe(true);
    const partner = await db.member.findFirst({ where: { groupId: g.id, accountId: riya.id } });
    expect(partner?.splitWeight).toBe(45);
  });

  it("a home starts equal, and an unknown type becomes Other", async () => {
    const me = await db.account.findFirstOrThrow({ where: { email: `me-gt-${stamp}@example.com` } });
    const home = await createGroupFor(me, { type: "home", name: "Flat 402", yourName: "Varun", currency: "INR" });
    const odd = await createGroupFor(me, { type: "business", name: "X", yourName: "Varun", currency: "INR" });
    made.push(home.id, odd.id);
    expect(home.type).toBe("home");
    expect(home.members[0].splitWeight).toBe(100);
    expect(home.joinWeight).toBe(100);
    expect(odd.type).toBe("other");
  });
});

describe("changing how costs are shared", () => {
  it("saves new weights and the type, and tells the group", async () => {
    const me = await db.account.findFirstOrThrow({ where: { email: `me-gt-${stamp}@example.com` } });
    const g = await createGroupFor(me, { type: "other", name: "Flat", yourName: "Varun", currency: "INR" });
    made.push(g.id);
    const other = await db.member.create({ data: { name: "Asha", groupId: g.id } });
    const meId = g.members[0].id;
    const r = await updateSharing(g.id, meId, { type: "home", weights: { [meId]: "1.2", [other.id]: "1" } });
    expect(r.ok).toBe(true);
    const after = await db.group.findUniqueOrThrow({ where: { id: g.id }, include: { members: true } });
    expect(after.type).toBe("home");
    expect(after.members.find((m) => m.id === meId)?.splitWeight).toBe(120);
    const ev = await db.groupEvent.findFirst({ where: { groupId: g.id, kind: "split_changed" } });
    expect(ev?.text).toContain("1.2 / 1");
  });
  it("refuses a split where nobody pays anything", async () => {
    const me = await db.account.findFirstOrThrow({ where: { email: `me-gt-${stamp}@example.com` } });
    const g = await createGroupFor(me, { type: "home", name: "Flat B", yourName: "Varun", currency: "INR" });
    made.push(g.id);
    const r = await updateSharing(g.id, g.members[0].id, { type: "home", weights: { [g.members[0].id]: "0" } });
    expect(r.ok).toBe(false);
  });
  it("only people in the group can change it", async () => {
    const me = await db.account.findFirstOrThrow({ where: { email: `me-gt-${stamp}@example.com` } });
    const g = await createGroupFor(me, { type: "home", name: "Flat C", yourName: "Varun", currency: "INR" });
    made.push(g.id);
    const r = await updateSharing(g.id, "someone-else", { type: "home", weights: {} });
    expect(r.ok).toBe(false);
  });
});
