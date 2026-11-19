import { afterAll, describe, expect, it, vi } from "vitest";

// Speed stage 1 (fewer trips, same results): who looks after a group read from the members already loaded, the move-out payments read
// only when asked, the one-request group basics, and the switcher's two reads side by side.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { loadGroupView, loadSwitchList } = await import("@/lib/group-data");
const { pickAdmin, groupAdminId } = await import("@/lib/group-admin");
const { buildGroupView } = await import("@/app/groups/[id]/_components/view");
const { groupBasics } = await import("@/lib/group-basics");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groupIds: string[] = [];
let seq = 0;
afterAll(async () => {
  await eraseGroups(groupIds);
});
async function group(members: Record<string, unknown>[], extra: Record<string, unknown> = {}) {
  seq += 1;
  const g = await db.group.create({
    data: { name: `S1b ${stamp}-${seq}`, inviteCode: `s1b-${stamp}-${seq}`, ...extra, members: { create: members.map((m, i) => ({ createdAt: new Date(Date.UTC(2026, 9, 1, 10, i)), ...m })) as never[] } },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  groupIds.push(g.id);
  return g;
}

describe("who looks after the group, from the members already loaded", () => {
  it("is the same person the separate read finds: the first one who is here, started it or joined, and has not left", async () => {
    // M1 left. M2 was added by someone and never opened the group (pending: can't look after it). M3 joined (claimed): looks after it.
    const g = await group([
      { name: "M1", claimedAt: new Date(), leftAt: new Date() },
      { name: "M2", addedBy: "someone" },
      { name: "M3", claimedAt: new Date() },
      { name: "M4" },
    ]);
    const m3 = g.members.find((m) => m.name === "M3")!.id;
    const view = (await loadGroupView(g.id, { viewer: m3, events: false }))!;
    expect(pickAdmin(view.group.members)?.id).toBe(m3);
    expect(await groupAdminId(g.id)).toBe(m3);
    // Once M2 opens the group they are no longer pending, but the person who claimed it still looks after it.
    await db.member.update({ where: { id: g.members.find((m) => m.name === "M2")!.id }, data: { seenAt: new Date() } });
    const again = (await loadGroupView(g.id, { viewer: m3, events: false }))!;
    expect(pickAdmin(again.group.members)?.id).toBe(await groupAdminId(g.id));
    expect(pickAdmin(again.group.members)?.id).toBe(m3);
    // Nobody claimed: the first person here who has not left.
    const h = await group([{ name: "X1", leftAt: new Date() }, { name: "X2", addedBy: "x" }, { name: "X3" }, { name: "X4" }]);
    const x3 = h.members.find((m) => m.name === "X3")!.id;
    const hv = (await loadGroupView(h.id, { viewer: x3, events: false }))!;
    expect(pickAdmin(hv.group.members)?.id).toBe(x3);
    expect(await groupAdminId(h.id)).toBe(x3);
    // buildGroupView says the same: only the admin is "isAdmin" in what Undo checks.
    expect((await buildGroupView(hv, x3, "Asia/Kolkata")).undoViewer.isAdmin).toBe(true);
    expect((await buildGroupView(hv, h.members.find((m) => m.name === "X4")!.id, "Asia/Kolkata")).undoViewer.isAdmin).toBe(false);
  });
});

describe("a flat's move-out payments are read only when asked", () => {
  it("moveOuts: false skips the read; by default it is read and the payment is found", async () => {
    const g = await group([{ name: "A", claimedAt: new Date() }, { name: "B" }], { type: "home" });
    const [A, B] = g.members.map((m) => m.id);
    await db.groupEvent.create({
      data: {
        groupId: g.id, actorId: B, kind: "member_left", text: "moved out", details: "[]",
        undo: JSON.stringify({ type: "member_set", memberId: B, data: { leftAt: null }, moveOut: { money: { payments: [{ id: "pay-1" }] } } }),
      },
    });
    const view = (await loadGroupView(g.id, { viewer: A, events: false }))!;
    expect([...(await buildGroupView(view, A, "Asia/Kolkata")).moveOutIds]).toEqual(["pay-1"]);
    expect([...(await buildGroupView(view, A, "Asia/Kolkata", { moveOuts: true })).moveOutIds]).toEqual(["pay-1"]);
    expect((await buildGroupView(view, A, "Asia/Kolkata", { moveOuts: false })).moveOutIds.size).toBe(0);
  });
});

describe("group basics", () => {
  it("id, type and deletedAt; nothing for a group that does not exist", async () => {
    const g = await group([{ name: "A" }], { type: "trip" });
    expect(await groupBasics(g.id)).toEqual({ id: g.id, type: "trip", deletedAt: null });
    const when = new Date();
    await db.group.update({ where: { id: g.id }, data: { deletedAt: when } });
    expect(await groupBasics(g.id)).toEqual({ id: g.id, type: "trip", deletedAt: when });
    expect(await groupBasics("no-such-group")).toBeNull();
  });
});

describe("the group switcher", () => {
  it("lists my other open groups, the one with the latest change first; closed ones, deleted ones and this one are left out", async () => {
    // G1's latest change is on 5 Nov 2026, G2's on 9 Nov 2026 (it also has an older one on 2 Nov), G3 has no change at all. G4 is closed, G5 is deleted.
    const mk = async (name: string, extra: Record<string, unknown> = {}) => group([{ name }], { name: `${name} ${stamp}`, ...extra });
    const g1 = await mk("Sw1");
    const g2 = await mk("Sw2");
    const g3 = await mk("Sw3");
    const g4 = await mk("Sw4", { closed: true });
    const g5 = await mk("Sw5", { deletedAt: new Date() });
    const here = await mk("Here");
    const ev = (groupId: string, actorId: string, day: number) => db.groupEvent.create({ data: { groupId, actorId, kind: "expense_added", text: "added x", details: "[]", createdAt: new Date(Date.UTC(2026, 10, day)) } });
    await ev(g1.id, g1.members[0].id, 5);
    await ev(g2.id, g2.members[0].id, 9);
    await ev(g2.id, g2.members[0].id, 2);
    await ev(g4.id, g4.members[0].id, 20);
    await ev(g5.id, g5.members[0].id, 21);
    const memberships = Object.fromEntries([g1, g2, g3, g4, g5, here].map((g) => [g.id, g.members[0].id]));
    const list = await loadSwitchList(memberships, here.id);
    const names = list.map((x) => x.id);
    expect(names).not.toContain(here.id);
    expect(names).not.toContain(g4.id);
    expect(names).not.toContain(g5.id);
    expect(names).toContain(g1.id);
    expect(names).toContain(g2.id);
    expect(names).toContain(g3.id);
    // Between the two with changes: G2 (9 Nov) before G1 (5 Nov).
    expect(names.indexOf(g2.id)).toBeLessThan(names.indexOf(g1.id));
  });
});
