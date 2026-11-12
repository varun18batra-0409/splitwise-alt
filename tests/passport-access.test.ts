import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { canSeePassport, loadPassport, passportFriends, passportRoster, recordPassportChoice } from "@/lib/passport-db";
import { passportNeedsAnswer, passportShared } from "@/lib/passport";

// Who may open whose passport. The rule: both people have really joined a group
// that still exists (leaving later doesn't matter), and the owner hasn't hidden it.
// "Joined" = nobody else added them, or they've opened the group since.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const accountIds: string[] = [];
const groupIds: string[] = [];

async function account(name: string, extra: { passportShare?: string; passportChoiceAt?: Date | null } = {}) {
  // By default the owner has tapped Show (the rule: no recorded answer = hidden).
  const a = await db.account.create({ data: { email: `pa-${name}-${stamp}@example.test`, name, passportChoiceAt: new Date(), ...extra } });
  accountIds.push(a.id);
  return a;
}

type Row = { account: { id: string; name: string }; added?: boolean; seen?: boolean; left?: boolean };
// One group; each row is a person. `added` = put in by someone else; `seen` = they've since opened it.
async function group(name: string, rows: Row[], extra: { deletedAt?: Date } = {}) {
  const g = await db.group.create({
    data: {
      name: `${name} ${stamp}`,
      inviteCode: `pa-${name}-${stamp}`,
      ...extra,
      members: {
        create: rows.map((r) => ({
          name: r.account.name,
          accountId: r.account.id,
          claimedAt: new Date(),
          addedBy: r.added ? "someone-else" : "",
          seenAt: r.added && r.seen ? new Date() : null,
          leftAt: r.left ? new Date() : null,
        })),
      },
    },
  });
  groupIds.push(g.id);
  return g;
}

afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("passport access: both must have joined", () => {
  it("owner joined and viewer joined: allowed", async () => {
    const owner = await account("Owner1");
    const viewer = await account("Viewer1");
    await group("both", [{ account: owner }, { account: viewer }]);
    const r = await canSeePassport(viewer.id, owner.id);
    expect(r.ok).toBe(true);
  });

  it("owner added by someone and never opened the group: a stranger", async () => {
    const owner = await account("Owner2");
    const viewer = await account("Viewer2");
    await group("ownerpending", [{ account: viewer }, { account: owner, added: true }]);
    const r = await canSeePassport(viewer.id, owner.id);
    expect(r).toMatchObject({ ok: false, reason: "stranger" });
  });

  it("viewer added by someone and never opened the group: a stranger", async () => {
    const owner = await account("Owner3");
    const viewer = await account("Viewer3");
    await group("viewerpending", [{ account: owner }, { account: viewer, added: true }]);
    const r = await canSeePassport(viewer.id, owner.id);
    expect(r).toMatchObject({ ok: false, reason: "stranger" });
  });

  it("a pending person is allowed once they open the group (seenAt set)", async () => {
    const owner = await account("Owner4");
    const viewer = await account("Viewer4");
    await group("opens", [{ account: owner }, { account: viewer, added: true }]);
    expect((await canSeePassport(viewer.id, owner.id)).ok).toBe(false);
    await db.member.updateMany({ where: { accountId: viewer.id, addedBy: { not: "" } }, data: { seenAt: new Date() } });
    expect((await canSeePassport(viewer.id, owner.id)).ok).toBe(true);
  });

  it("the owner has left the group since: still allowed (left counts)", async () => {
    const owner = await account("Owner5");
    const viewer = await account("Viewer5");
    await group("ownerleft", [{ account: owner, left: true }, { account: viewer }]);
    expect((await canSeePassport(viewer.id, owner.id)).ok).toBe(true);
  });

  it("the owner chose private: 'private', not a stranger", async () => {
    const owner = await account("Owner6", { passportShare: "private" });
    const viewer = await account("Viewer6");
    await group("private", [{ account: owner }, { account: viewer }]);
    expect(await canSeePassport(viewer.id, owner.id)).toMatchObject({ ok: false, reason: "private" });
  });

  it("the only shared group is deleted: a stranger", async () => {
    const owner = await account("Owner7");
    const viewer = await account("Viewer7");
    await group("gone", [{ account: owner }, { account: viewer }], { deletedAt: new Date() });
    expect(await canSeePassport(viewer.id, owner.id)).toMatchObject({ ok: false, reason: "stranger" });
  });

  it("joined in different groups only: a stranger (the same group is needed)", async () => {
    const owner = await account("Owner8");
    const viewer = await account("Viewer8");
    const other = await account("Other8");
    await group("a", [{ account: owner }, { account: other }]);
    await group("b", [{ account: viewer }, { account: other }]);
    expect(await canSeePassport(viewer.id, owner.id)).toMatchObject({ ok: false, reason: "stranger" });
  });

  it("you can always open your own", async () => {
    const me = await account("Me9");
    expect((await canSeePassport(me.id, me.id)).ok).toBe(true);
  });
});

describe("passport friends list", () => {
  it("leaves out a person whose only shared group is one where the viewer is pending", async () => {
    const viewer = await account("Viewer10");
    const friend = await account("Friend10");
    await group("vp", [{ account: friend }, { account: viewer, added: true }]);
    expect((await passportFriends(viewer.id)).map((f) => f.accountId)).not.toContain(friend.id);
    // Once the viewer opens that group, the friend is listed.
    await db.member.updateMany({ where: { accountId: viewer.id, addedBy: { not: "" } }, data: { seenAt: new Date() } });
    expect((await passportFriends(viewer.id)).map((f) => f.accountId)).toContain(friend.id);
  });

  it("still lists a person through another group where both joined", async () => {
    const viewer = await account("Viewer11");
    const friend = await account("Friend11");
    await group("pend", [{ account: friend }, { account: viewer, added: true }]);
    await group("real", [{ account: friend }, { account: viewer }]);
    const list = await passportFriends(viewer.id);
    const f = list.find((x) => x.accountId === friend.id);
    expect(f?.groups).toEqual([`real ${stamp}`]); // only the group that counts
  });

  it("leaves out a person who was added by someone and never opened the group", async () => {
    const viewer = await account("Viewer12");
    const friend = await account("Friend12");
    await group("fp", [{ account: viewer }, { account: friend, added: true }]);
    expect((await passportFriends(viewer.id)).map((f) => f.accountId)).not.toContain(friend.id);
  });
});

// "Our passports" for one group follows the same rule as canSeePassport.
describe("our passports page: who may open it and who is listed", () => {
  const row = (id: string, extra: { addedBy?: string; seenAt?: Date | null; removedAt?: Date | null } = {}) => ({ id, addedBy: "", seenAt: null as Date | null, removedAt: null as Date | null, ...extra });
  const members = [
    row("asha"),
    row("sam"),
    row("pending", { addedBy: "asha" }), // added by Asha, never opened the group
    row("seen", { addedBy: "asha", seenAt: new Date() }), // added by Asha, has opened it since
    row("removed", { removedAt: new Date() }),
  ];

  it("a joined viewer sees everyone who joined (and themselves), not the pending or the removed", () => {
    expect(passportRoster(members, "sam")!.map((m) => m.id)).toEqual(["asha", "sam", "seen"]);
  });

  it("a pending viewer, a removed viewer, or someone not in the group is sent away (null)", () => {
    expect(passportRoster(members, "pending")).toBeNull();
    expect(passportRoster(members, "removed")).toBeNull();
    expect(passportRoster(members, "nobody")).toBeNull();
  });

  it("someone who left on their own is still listed and still allowed (leaving doesn't count)", () => {
    // (leftAt isn't part of the rule: a person who left has addedBy empty and no removedAt)
    expect(passportRoster([row("asha"), row("ravi")], "asha")!.map((m) => m.id)).toEqual(["asha", "ravi"]);
    expect(passportRoster([row("asha"), row("ravi")], "ravi")).not.toBeNull();
  });

  it("agrees with canSeePassport for a real group: a removed viewer is a stranger there too", async () => {
    const owner = await account("Owner13");
    const viewer = await account("Viewer13");
    const g = await group("roster", [{ account: owner }, { account: viewer }]);
    expect((await canSeePassport(viewer.id, owner.id)).ok).toBe(true);
    const rows = await db.member.findMany({ where: { groupId: g.id }, select: { id: true, accountId: true, addedBy: true, seenAt: true, removedAt: true } });
    const v = rows.find((m) => m.accountId === viewer.id)!;
    expect(passportRoster(rows, v.id)).not.toBeNull();
    await db.member.update({ where: { id: v.id }, data: { removedAt: new Date(), leftAt: new Date() } });
    expect(await canSeePassport(viewer.id, owner.id)).toMatchObject({ ok: false, reason: "stranger" });
    const after = await db.member.findMany({ where: { groupId: g.id }, select: { id: true, accountId: true, addedBy: true, seenAt: true, removedAt: true } });
    expect(passportRoster(after, v.id)).toBeNull();
  });
});

// Ask once, hidden until the person chooses. Hand-worked: "visible" needs BOTH a recorded answer and "groups".
describe("passport: hidden until the owner says yes", () => {
  it("no choice recorded (an account from before the question): hidden to a group-mate", async () => {
    const owner = await account("Owner20", { passportChoiceAt: null }); // passportShare is still the old default "groups"
    const viewer = await account("Viewer20");
    await group("nochoice", [{ account: owner }, { account: viewer }]);
    expect(owner.passportShare).toBe("groups");
    expect(await canSeePassport(viewer.id, owner.id)).toMatchObject({ ok: false, reason: "unanswered" }); // not "private": they have not chosen
    expect(passportShared(owner)).toBe(false);
    expect(passportNeedsAnswer(owner)).toBe(true);
  });

  it("chose Show: visible to a group-mate, still hidden to a stranger", async () => {
    const owner = await account("Owner21", { passportChoiceAt: null });
    const viewer = await account("Viewer21");
    const stranger = await account("Stranger21");
    await group("show", [{ account: owner }, { account: viewer }]);
    await recordPassportChoice(owner.id, true);
    expect((await canSeePassport(viewer.id, owner.id)).ok).toBe(true);
    expect(await canSeePassport(stranger.id, owner.id)).toMatchObject({ ok: false, reason: "stranger" });
    const after = await db.account.findUniqueOrThrow({ where: { id: owner.id } });
    expect(after.passportShare).toBe("groups");
    expect(after.passportChoiceAt).not.toBeNull();
  });

  it("chose Not now: hidden, and the question does not come back", async () => {
    const owner = await account("Owner22", { passportChoiceAt: null });
    const viewer = await account("Viewer22");
    await group("notnow", [{ account: owner }, { account: viewer }]);
    expect(passportNeedsAnswer(owner)).toBe(true); // first visit: asked
    await recordPassportChoice(owner.id, false);
    const after = await db.account.findUniqueOrThrow({ where: { id: owner.id } });
    expect(await canSeePassport(viewer.id, owner.id)).toMatchObject({ ok: false, reason: "private" });
    expect(passportNeedsAnswer(after)).toBe(false); // second visit: not asked
  });

  it("the question appears exactly once: before an answer yes, after Show no, after Not now no", async () => {
    const a = await account("Owner23", { passportChoiceAt: null });
    const b = await account("Owner24", { passportChoiceAt: null });
    expect([a, b].map(passportNeedsAnswer)).toEqual([true, true]);
    await recordPassportChoice(a.id, true);
    await recordPassportChoice(b.id, false);
    const rows = await db.account.findMany({ where: { id: { in: [a.id, b.id] } }, orderBy: { name: "asc" } });
    expect(rows.map(passportNeedsAnswer)).toEqual([false, false]);
  });

  it("switched off before the change (private, no recorded choice): stays hidden and is not asked again", async () => {
    const owner = await account("Owner25", { passportShare: "private", passportChoiceAt: null });
    const viewer = await account("Viewer25");
    await group("oldoff", [{ account: owner }, { account: viewer }]);
    expect(await canSeePassport(viewer.id, owner.id)).toMatchObject({ ok: false, reason: "private" });
    expect(passportNeedsAnswer(owner)).toBe(false);
  });

  it("the Who can see it switch also records the answer (Only me -> groups makes it visible)", async () => {
    const owner = await account("Owner26", { passportShare: "private", passportChoiceAt: null });
    const viewer = await account("Viewer26");
    await group("switch", [{ account: owner }, { account: viewer }]);
    await recordPassportChoice(owner.id, true);
    expect((await canSeePassport(viewer.id, owner.id)).ok).toBe(true);
  });

  it("a removed member is still excluded even though they chose Show", async () => {
    const owner = await account("Owner27");
    const viewer = await account("Viewer27");
    const g = await group("removed", [{ account: owner }, { account: viewer }]);
    await db.member.updateMany({ where: { groupId: g.id, accountId: viewer.id }, data: { removedAt: new Date(), leftAt: new Date() } });
    expect(await canSeePassport(viewer.id, owner.id)).toMatchObject({ ok: false, reason: "stranger" });
  });

  it("the friends list and Our passports use the same rule (passportShared)", () => {
    const now = new Date();
    // [share, choice] -> visible
    expect(passportShared({ passportShare: "groups", passportChoiceAt: now })).toBe(true);
    expect(passportShared({ passportShare: "groups", passportChoiceAt: null })).toBe(false);
    expect(passportShared({ passportShare: "private", passportChoiceAt: now })).toBe(false);
    expect(passportShared({ passportShare: "private", passportChoiceAt: null })).toBe(false);
  });
});

describe("loadPassport counts only trips you really joined", () => {
  const tripGroup = async (name: string, row: Row) => {
    const g = await db.group.create({
      data: {
        name: `${name} ${stamp}`,
        type: "trip",
        inviteCode: `lp-${name}-${stamp}`,
        tripStart: "2024-03-01",
        tripEnd: "2024-03-05",
        tripPlace: "Bangkok",
        tripCountry: "TH",
        members: {
          create: [{
            name: row.account.name,
            accountId: row.account.id,
            claimedAt: new Date(),
            addedBy: row.added ? "someone-else" : "",
            seenAt: row.added && row.seen ? new Date() : null,
            leftAt: row.left ? new Date() : null,
          }],
        },
      },
    });
    groupIds.push(g.id);
    return g;
  };

  it("a trip someone added you to and you never opened is not a stamp; opened, or left later, it is", async () => {
    const me = await account("LpMe");
    const pending = await tripGroup("LpPending", { account: me, added: true, seen: false });
    const opened = await tripGroup("LpOpened", { account: me, added: true, seen: true });
    const left = await tripGroup("LpLeft", { account: me, left: true }); // left after the trip: still counts
    const p = await loadPassport({ id: me.id, homeCountry: "IN", places: "" }, "IN", "2025-01-01");
    const th = p.index.find((c) => c.code === "TH");
    expect(th?.trips).toBe(2); // opened + left; the never-opened one is not counted
    expect(pending.id).not.toBe(opened.id);
    expect(left.id).not.toBe(opened.id);
  });
});
