import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { blockAccount } from "@/lib/blocks";
import { loadAllMemories, loadHomeMemories } from "@/lib/moments-db";
import { chosenGroup, groupMemoriesHref, hasMoreMemories, memoriesBack, memoriesPage, memoryChips, memoryHref, type MemoryGroup } from "@/lib/home/memories";
import type { MomentViewer } from "@/lib/moments-access";
import { readFileSync } from "node:fs";

// The /memories page and Home's "See all": pure helpers first, then the loader on a throwaway database (the same rules as Home).

const src = (p: string) => readFileSync(`${__dirname}/../${p}`, "utf8");
const at = (h: number) => new Date(Date.UTC(2026, 10, 10, h, 0, 0));
const viewer = (o: Partial<MomentViewer> = {}): MomentViewer => ({ groupId: "goa", groupType: "trip", groupDeleted: false, memberId: "m-me", accountId: "acc-me", leftAt: null, removedAt: null, pending: false, isAdmin: false, blocked: new Set<string>(), ...o });
const mo = (id: string, groupId: string, h: number, acc = "acc-x") => ({ id, groupId, authorId: `m-${acc}`, authorAccountId: acc, createdAt: at(h), caption: `cap ${id}` });
const grp = (groupId: string, name: string, moments: MemoryGroup["moments"], v: Partial<MomentViewer> = {}): MemoryGroup => ({ groupId, name, viewer: viewer({ groupId, ...v }), moments });
const thumb = (id: string) => `/api/moment-photo/${id}?s=t`;

describe("pure: See all, links and Back", () => {
  it("See all shows only when there is more than the one memory Home shows", () => {
    expect(hasMoreMemories(0)).toBe(false);
    expect(hasMoreMemories(1)).toBe(false);
    expect(hasMoreMemories(2)).toBe(true);
    expect(hasMoreMemories(10)).toBe(true);
  });
  it("the memory link: from Home as before; from /memories with Back to /memories (and the filter only if it looks like an id)", () => {
    expect(memoryHref("goa", "m1")).toBe("/groups/goa/moments/m1?from=home");
    expect(memoryHref("goa", "m1", "memories")).toBe("/groups/goa/moments/m1?from=memories");
    expect(memoryHref("goa", "m1", "memories", "bali")).toBe("/groups/goa/moments/m1?from=memories&g=bali");
    expect(memoryHref("goa", "m1", "memories", "x&y=1")).toBe("/groups/goa/moments/m1?from=memories");
  });
  it("the group's Memories tab is /groups/<id>?tab=memories", () => {
    expect(groupMemoriesHref("abc123")).toBe("/groups/abc123?tab=memories");
  });
  it("the moment viewer's Back: home, /memories (with a clean filter), or nothing special", () => {
    expect(memoriesBack("home", undefined)).toBe("/");
    expect(memoriesBack("memories", undefined)).toBe("/memories");
    expect(memoriesBack("memories", "bali")).toBe("/memories?g=bali");
    expect(memoriesBack("memories", "a/../b")).toBe("/memories");
    expect(memoriesBack("elsewhere", "bali")).toBeNull();
    expect(memoriesBack(undefined, undefined)).toBeNull();
  });
});

describe("pure: filter chips and the filter", () => {
  const goa = grp("goa", "Goa", [mo("g1", "goa", 1), mo("g2", "goa", 5)]);
  const bali = grp("bali", "Bali", [mo("b1", "bali", 3)]);
  const empty = grp("rome", "Rome", []);
  it("one chip per group with something visible, the newest first; a group with nothing has none", () => {
    expect(memoryChips([bali, goa, empty])).toEqual([{ groupId: "goa", name: "Goa" }, { groupId: "bali", name: "Bali" }]);
  });
  it("a group whose only moments are by a blocked person, or came after the viewer left, has no chip", () => {
    const blocked = grp("a", "A", [mo("a1", "a", 1, "acc-bad")], { blocked: new Set(["acc-bad"]) });
    const late = grp("b", "B", [mo("b1", "b", 9)], { leftAt: at(2) });
    expect(memoryChips([blocked, late])).toEqual([]);
  });
  it("?g= counts only when it is one of the chips; anything else is All groups", () => {
    const chips = memoryChips([goa, bali, empty]);
    expect(chosenGroup(chips, "bali")).toBe("bali");
    expect(chosenGroup(chips, "rome")).toBe("");
    expect(chosenGroup(chips, "someone-elses")).toBe("");
    expect(chosenGroup(chips, undefined)).toBe("");
  });
  it("newest first for All groups; only that group's memories when filtered; an unknown filter shows everything", () => {
    expect(memoriesPage([goa, bali], undefined, thumb).memories.map((m) => m.id)).toEqual(["g2", "b1", "g1"]);
    const only = memoriesPage([goa, bali], "bali", thumb);
    expect(only.selected).toBe("bali");
    expect(only.memories.map((m) => m.id)).toEqual(["b1"]);
    expect(only.chips).toHaveLength(2); // the chips stay, so you can switch
    const unknown = memoriesPage([goa, bali], "nope", thumb);
    expect(unknown.selected).toBe("");
    expect(unknown.memories.map((m) => m.id)).toEqual(["g2", "b1", "g1"]);
  });
  it("the page shows at most the max given (newest)", () => {
    const many = grp("goa", "Goa", Array.from({ length: 150 }, (_, i) => mo(`m${i}`, "goa", 0 + (i % 20), "acc-x")).map((m, i) => ({ ...m, createdAt: new Date(Date.UTC(2026, 10, 1) + i * 1000) })));
    const r = memoriesPage([many], undefined, thumb, 120);
    expect(r.memories).toHaveLength(120);
    expect(r.memories[0].id).toBe("m149");
  });
});

describe("the sources: one loader, one fixed Home row, the page wired to it", () => {
  it("Home and the page share loadMemoryGroups (the member selection, blocks and momentsWhere live once)", () => {
    const d = src("src/lib/moments-db.ts");
    expect(d).toContain("async function loadMemoryGroups");
    expect(d.match(/momentsWhere\(viewer\)/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(d.slice(d.indexOf("export async function loadHomeMemories"), d.indexOf("export async function loadAllMemories"))).toContain("loadMemoryGroups(");
    expect(d.slice(d.indexOf("export async function loadAllMemories"), d.indexOf("async function loadMemoryGroups"))).toContain("loadMemoryGroups(");
    expect(d.slice(d.indexOf("async function loadMemoryGroups"))).toContain("leftAt: null, removedAt: null, ...JOINED");
    expect(d.slice(d.indexOf("async function loadMemoryGroups"))).toContain("blockedEitherWay");
  });
  it("the page uses getMemberships and loadAllMemories, builds photo addresses nowhere itself, and has its hooks", () => {
    const p = src("src/app/memories/page.tsx");
    expect(p).toContain("getMemberships()");
    expect(p).toContain("loadAllMemories(memberships, { groupId: g })");
    expect(p).not.toContain("/api/moment-photo");
    expect(p).not.toContain("db.");
    for (const h of ["data-memories-page", "data-memories-filter", "data-memories-card"]) expect(p).toContain(h);
    expect(p).toContain("All groups");
    expect(p).toContain("No memories yet. Add a moment to a trip and it shows up here.");
    expect(p).toContain('memoryHref(m.groupId, m.id, "memories", selected)');
    expect(p).toContain('back="/"');
  });
  it("Home's polaroid has one fixed layout: no state, no toggle, no grid", () => {
    const ui = src("src/components/MemoryPolaroids.tsx");
    expect(ui).not.toMatch(/useState|memories-toggle|memories-grid|Show less/);
  });
});

// ---------- the loader, on the throwaway database ----------
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];

async function account(label: string) {
  const a = await db.account.create({ data: { email: `mem-${label}-${stamp}@example.test`, name: label } });
  accountIds.push(a.id);
  return a.id;
}
async function group(name: string, members: { name: string; accountId?: string; leftAt?: Date; removedAt?: Date }[]) {
  const g = await db.group.create({
    data: { name, inviteCode: `mem-${stamp}-${groupIds.length}`, type: "trip", members: { create: members.map((m) => ({ name: m.name, accountId: m.accountId ?? null, leftAt: m.leftAt ?? null, removedAt: m.removedAt ?? null })) } },
    include: { members: true },
  });
  groupIds.push(g.id);
  return { id: g.id, member: (n: string) => g.members.find((m) => m.name === n)!.id };
}
const moment = (groupId: string, authorId: string, authorAccountId: string, caption: string, createdAt: Date) =>
  db.moment.create({ data: { groupId, authorId, authorAccountId, caption, createdAt, data: new Uint8Array(), thumbData: new Uint8Array() } });

afterAll(async () => {
  await db.block.deleteMany({ where: { OR: [{ blockerId: { in: accountIds } }, { blockedId: { in: accountIds } }] } });
  await db.moment.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("loadAllMemories: the same access rules as Home", () => {
  it("only current groups, newest first, filtered by ?g=, and never a group you left, were removed from, never joined or that is deleted", async () => {
    const me = await account("me");
    const other = await account("other");
    const bad = await account("bad");
    const goa = await group(`Goa ${stamp} trip`, [{ name: "Me", accountId: me }, { name: "Other", accountId: other }, { name: "Bad", accountId: bad }]);
    const bali = await group(`Bali ${stamp}`, [{ name: "Me", accountId: me }, { name: "Other", accountId: other }]);
    const left = await group(`Left ${stamp}`, [{ name: "Me", accountId: me, leftAt: at(5) }, { name: "Other", accountId: other }]);
    const removed = await group(`Removed ${stamp}`, [{ name: "Me", accountId: me, removedAt: at(5) }, { name: "Other", accountId: other }]);
    const never = await group(`Never ${stamp}`, [{ name: "Other", accountId: other }]); // I was never in this one
    const gone = await group(`Gone ${stamp}`, [{ name: "Me", accountId: me }, { name: "Other", accountId: other }]);
    await db.group.update({ where: { id: gone.id }, data: { deletedAt: at(6) } });

    await moment(goa.id, goa.member("Other"), other, "goa early", at(1));
    await moment(goa.id, goa.member("Other"), other, "goa late", at(8));
    await moment(bali.id, bali.member("Other"), other, "bali mid", at(4));
    await moment(left.id, left.member("Other"), other, "left secret", at(2));
    await moment(removed.id, removed.member("Other"), other, "removed secret", at(2));
    const neverMoment = await moment(never.id, never.member("Other"), other, "never secret", at(3));
    await moment(gone.id, gone.member("Other"), other, "gone secret", at(3));
    await moment(goa.id, goa.member("Bad"), bad, "bad one", at(9));
    await blockAccount(me, bad);

    // The cookie holds a membership per group; a left / removed one is in it too (as on a real phone).
    const memberships = { [goa.id]: goa.member("Me"), [bali.id]: bali.member("Me"), [left.id]: left.member("Me"), [removed.id]: removed.member("Me"), [gone.id]: gone.member("Me") };

    const all = await loadAllMemories(memberships);
    expect(all.memories.map((m) => m.caption)).toEqual(["goa late", "bali mid", "goa early"]); // newest first, no blocked "bad one"
    expect(all.chips.map((c) => c.groupId).sort()).toEqual([goa.id, bali.id].sort());
    expect(all.chips.find((c) => c.groupId === goa.id)?.name).toBe(`Goa ${stamp}`); // "trip" is dropped as on Home
    expect(all.selected).toBe("");
    const dump = JSON.stringify(all);
    for (const secret of ["left secret", "removed secret", "never secret", "gone secret", "bad one", left.id, removed.id, never.id, gone.id]) expect(dump).not.toContain(secret);
    for (const m of all.memories) expect(m.thumb).toBe(`/api/moment-photo/${m.id}?s=t`);

    // ?g= for a group I may see: only that group.
    const onlyBali = await loadAllMemories(memberships, { groupId: bali.id });
    expect(onlyBali.selected).toBe(bali.id);
    expect(onlyBali.memories.map((m) => m.caption)).toEqual(["bali mid"]);
    const onlyGoa = await loadAllMemories(memberships, { groupId: goa.id });
    expect(onlyGoa.memories.map((m) => m.caption)).toEqual(["goa late", "goa early"]);

    // ?g= for a group I left, was removed from, never joined or that is deleted: the All groups result, nothing of theirs.
    for (const g of [left.id, removed.id, never.id, gone.id, "not-a-group"]) {
      const r = await loadAllMemories(memberships, { groupId: g });
      expect(r.selected).toBe("");
      expect(r.memories.map((m) => m.caption)).toEqual(["goa late", "bali mid", "goa early"]);
      expect(JSON.stringify(r)).not.toContain(neverMoment.id);
    }

    // Home gets the same newest memory from the same loader.
    const home = await loadHomeMemories(memberships);
    expect(home.map((m) => m.caption)).toEqual(["goa late", "bali mid", "goa early"]);
  });

  it("no cookie memberships means nothing, whatever ?g= says", async () => {
    const r = await loadAllMemories({}, { groupId: "anything" });
    expect(r).toEqual({ chips: [], selected: "", memories: [] });
  });
});
