import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { readFileSync } from "node:fs";
import { canSeePassport, loadPassport, passportFriends, passportRoster, recordPassportChoice, undatedTripFacts } from "@/lib/passport-db";
import { passportNeedsAnswer, passportShared, stampDay } from "@/lib/passport";

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

  it("someone who left sees only people who were in the group by the day they left: Riya leaves 2 Nov, Karan joins 10 Nov, so no Karan", () => {
    const day = (d: string) => new Date(`2026-11-${d}T10:00:00Z`);
    const people = [
      { ...row("asha"), createdAt: day("01") },
      { ...row("riya"), createdAt: day("01"), leftAt: day("02") },
      { ...row("karan"), createdAt: day("10") },
    ];
    expect(passportRoster(people, "riya")!.map((m) => m.id)).toEqual(["asha", "riya"]);
    // A member still in the group sees all three, Karan included.
    expect(passportRoster(people, "asha")!.map((m) => m.id)).toEqual(["asha", "riya", "karan"]);
    // Joined on the very day they left (same moment): counts as there.
    expect(passportRoster([...people, { ...row("same"), createdAt: day("02") }], "riya")!.map((m) => m.id)).toEqual(["asha", "riya", "same"]);
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
    const p = await loadPassport({ id: me.id, homeCountry: "IN", places: "", timeZone: "" }, "2025-01-01");
    const th = p.index.find((c) => c.code === "TH");
    expect(th?.trips).toBe(2); // opened + left; the never-opened one is not counted
    expect(pending.id).not.toBe(opened.id);
    expect(left.id).not.toBe(opened.id);
  });
  it("the faces on your own trip cards: none for a group you were removed from, and only people who joined and weren't removed", async () => {
    const me = await account("LxMe");
    const kim = await account("Kim Lee");
    const pat = await account("Pat");
    const rob = await account("Rob");
    const mk = async (label: string, myRemoved: boolean) => {
      const base = { claimedAt: new Date(), addedBy: "", seenAt: null };
      const g = await db.group.create({
        data: {
          name: `Lx${label} ${stamp}`, type: "trip", inviteCode: `lx-${label}-${stamp}`, tripStart: "2024-03-01", tripEnd: "2024-03-05", tripPlace: "Bangkok", tripCountry: "TH",
          members: {
            create: [
              { ...base, name: "LxMe", accountId: me.id, createdAt: new Date(2024, 0, 1), ...(myRemoved ? { leftAt: new Date(), removedAt: new Date(), removedById: "admin" } : {}) },
              { ...base, name: "Kim Lee", accountId: kim.id, createdAt: new Date(2024, 0, 2) },
              { ...base, name: "Pat", accountId: pat.id, createdAt: new Date(2024, 0, 3), addedBy: "someone-else" }, // never opened it
              { ...base, name: "Rob", accountId: rob.id, createdAt: new Date(2024, 0, 4), leftAt: new Date(), removedAt: new Date(), removedById: "admin" },
            ],
          },
        },
      });
      groupIds.push(g.id);
      return g;
    };
    const inG = await mk("In", false);
    const outG = await mk("Out", true);
    const p = await loadPassport({ id: me.id, homeCountry: "IN", places: "", timeZone: "" }, "2025-01-01");
    expect(p.extras[inG.id]).toEqual({ names: ["Kim"] }); // not Pat (never opened it), not Rob (removed), not me
    expect(p.extras[outG.id]).toBeUndefined(); // removed from this one: no faces at all
    // A friend's view never gets faces.
    const f = await loadPassport({ id: me.id, homeCountry: "IN", places: "", timeZone: "" }, "2025-01-01", { forFriend: true });
    expect(f.extras).toEqual({});
  });
  it("a trip you left before it began is no stamp (and a later trip still is): Thailand left 20 Feb before a 1 Mar start, Japan never left", async () => {
    const me = await account("LbMe");
    const mk = async (label: string, start: string, place: string, country: string, leftAt: Date | null) => {
      const g = await db.group.create({
        data: {
          name: `Lb${label} ${stamp}`, type: "trip", inviteCode: `lb-${label}-${stamp}`, tripStart: start, tripEnd: start, tripPlace: place, tripCountry: country,
          members: { create: [{ name: "LbMe", accountId: me.id, claimedAt: new Date(), addedBy: "", seenAt: null, leftAt }] },
        },
      });
      groupIds.push(g.id);
      return g;
    };
    await mk("TH", "2024-03-01", "Bangkok", "TH", new Date("2024-02-20T12:00:00Z"));
    await mk("JP", "2024-05-01", "Tokyo", "JP", null);
    const p = await loadPassport({ id: me.id, homeCountry: "IN", places: "", timeZone: "" }, "2025-01-01");
    expect(p.index.map((c) => c.code)).toEqual(["JP"]);
    const g = { type: "trip", deletedAt: null, undated: null };
    expect(stampDay({ ...g, tripStart: "2024-03-01", leftAt: new Date("2024-02-20T12:00:00Z") }, "2025-01-01", "UTC")).toBeNull();
    expect(stampDay({ ...g, tripStart: "2024-05-01", leftAt: null }, "2025-01-01", "UTC")).toBe("2024-05-01");
  });
  // An undated trip with two expenses (hand-worked): Lunch added 1 Oct 2024 08:00 UTC, dated 1 Oct, paid by Ada, Ada and Bea in it;
  // Taxi added 8 Oct 2024 09:00 UTC, dated 8 Oct, only Bea in it. Ada left on 5 Oct 12:00 UTC.
  //   Ada sees only what was added up to the day she left, or has her in it: Lunch (1 row, 1 Oct).
  //   Bea sees both rows; the latest by when it was added is Taxi: 8 Oct.
  const undatedTrip = async (label: string, ada: { id: string }, bea: { id: string }) => {
    const g = await db.group.create({
      data: {
        name: `${label} ${stamp}`, type: "trip", inviteCode: `${label}-${stamp}`, tripStart: "", tripEnd: "", tripPlace: "Bangkok", tripCountry: "TH",
        members: {
          create: [
            { name: `${label}Ada`, accountId: ada.id, claimedAt: new Date(), addedBy: "", seenAt: null, leftAt: new Date("2024-10-05T12:00:00Z") },
            { name: `${label}Bea`, accountId: bea.id, claimedAt: new Date(), addedBy: "", seenAt: null },
          ],
        },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const A = g.members.find((m) => m.name === `${label}Ada`)!.id;
    const B = g.members.find((m) => m.name === `${label}Bea`)!.id;
    const spend = (description: string, paidById: string, day: string, addedAt: string, people: string[]) =>
      db.expense.create({
        data: {
          groupId: g.id, description, amount: 1000, paidById, createdById: paidById, splitType: "equal", forMode: "everyone", spentAt: new Date(`${day}T12:00:00Z`), createdAt: new Date(addedAt),
          originalAmount: 1000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 1000,
          shares: { create: people.map((memberId) => ({ memberId, amount: 1000 / people.length })) },
        },
      });
    await spend("Lunch", A, "2024-10-01", "2024-10-01T08:00:00Z", [A, B]);
    await spend("Taxi", B, "2024-10-08", "2024-10-08T09:00:00Z", [B]);
    return { g, A, B };
  };
  const stampOf = (p: Awaited<ReturnType<typeof loadPassport>>, groupId: string) => p.trips.find((t) => t.groupId === groupId)?.start;

  it("an undated trip: Ada (left 5 Oct) is stamped 1 Oct from Lunch, her friend view says the same, Bea (still in) is stamped 8 Oct", async () => {
    const ada = await account("UdAda");
    const bea = await account("UdBea");
    const { g, A, B } = await undatedTrip("UdTH", ada, bea);
    const mine = await loadPassport({ id: ada.id, homeCountry: "IN", places: "", timeZone: "" }, "2025-01-01");
    expect(mine.index.map((c) => c.code)).toContain("TH");
    expect(stampOf(mine, g.id)).toBe("2024-10-01");
    const friend = await loadPassport({ id: ada.id, homeCountry: "IN", places: "", timeZone: "" }, "2025-01-01", { forFriend: true });
    expect(stampOf(friend, g.id)).toBe("2024-10-01");
    const beas = await loadPassport({ id: bea.id, homeCountry: "IN", places: "", timeZone: "" }, "2025-01-01");
    expect(stampOf(beas, g.id)).toBe("2024-10-08");
    // The passport reads these facts (undatedTripFacts) and stamps the same days.
    const facts = await undatedTripFacts([{ groupId: g.id, me: { id: A, leftAt: new Date("2024-10-05T12:00:00Z") } }], "Asia/Kolkata");
    expect(facts.get(g.id)).toEqual({ count: 1, day: "2024-10-01" });
    const beaFacts = await undatedTripFacts([{ groupId: g.id, me: { id: B, leftAt: null } }], "Asia/Kolkata");
    expect(beaFacts.get(g.id)).toEqual({ count: 2, day: "2024-10-08" });
    expect(stampDay({ type: "trip", deletedAt: null, tripStart: "", undated: facts.get(g.id) ?? null, leftAt: new Date("2024-10-05T12:00:00Z") }, "2025-01-01", "Asia/Kolkata")).toBe("2024-10-01");
    // (Home no longer draws a passport card, so it no longer reads these facts itself: the passport is the one place that does.)
  });
  it("an undated trip where the leaver was in nothing: only Taxi (Bea alone, added after Ada left) exists, so Ada has no stamp and no TH in her index", async () => {
    const ada = await account("UhAda");
    const bea = await account("UhBea");
    const g = await db.group.create({
      data: {
        name: `UhTH ${stamp}`, type: "trip", inviteCode: `uh-th-${stamp}`, tripStart: "", tripEnd: "", tripPlace: "Bangkok", tripCountry: "TH",
        members: {
          create: [
            { name: "UhAda", accountId: ada.id, claimedAt: new Date(), addedBy: "", seenAt: null, leftAt: new Date("2024-10-05T12:00:00Z") },
            { name: "UhBea", accountId: bea.id, claimedAt: new Date(), addedBy: "", seenAt: null },
          ],
        },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const [A, B] = [g.members.find((m) => m.name === "UhAda")!.id, g.members.find((m) => m.name === "UhBea")!.id];
    await db.expense.create({
      data: {
        groupId: g.id, description: "Taxi", amount: 1000, paidById: B, createdById: B, splitType: "equal", forMode: "everyone", spentAt: new Date("2024-10-08T12:00:00Z"), createdAt: new Date("2024-10-08T09:00:00Z"),
        originalAmount: 1000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 1000, shares: { create: [{ memberId: B, amount: 1000 }] },
      },
    });
    const p = await loadPassport({ id: ada.id, homeCountry: "IN", places: "", timeZone: "" }, "2025-01-01");
    expect(p.index.map((c) => c.code)).not.toContain("TH");
    const facts = (await undatedTripFacts([{ groupId: g.id, me: { id: A, leftAt: new Date("2024-10-05T12:00:00Z") } }], "Asia/Kolkata")).get(g.id);
    expect(facts).toBeNull();
    expect(stampDay({ type: "trip", deletedAt: null, tripStart: "", undated: facts ?? null, leftAt: new Date("2024-10-05T12:00:00Z") }, "2025-01-01", "Asia/Kolkata")).toBeNull();
  });
  it("Fix 4: a trip you are still in, one expense dated 1 Oct, a payment 20 Oct, a game result 22 Oct and a deleted expense 25 Oct: Home's facts and the passport both say 1 Oct", async () => {
    const me = await account("FxMe");
    const pal = await account("FxPal");
    const g = await db.group.create({
      data: {
        name: `FxTH ${stamp}`, type: "trip", inviteCode: `fx-th-${stamp}`, tripStart: "", tripEnd: "", tripPlace: "Bangkok", tripCountry: "TH",
        members: {
          create: [
            { name: "FxMe", accountId: me.id, claimedAt: new Date(), addedBy: "", seenAt: null },
            { name: "FxPal", accountId: pal.id, claimedAt: new Date(), addedBy: "", seenAt: null },
          ],
        },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const [M, P] = [g.members.find((m) => m.name === "FxMe")!.id, g.members.find((m) => m.name === "FxPal")!.id];
    const exp = (description: string, day: string, extra: { kind?: string; deletedAt?: Date } = {}) =>
      db.expense.create({
        data: {
          groupId: g.id, description, amount: 1000, paidById: M, createdById: M, splitType: "equal", forMode: "everyone", spentAt: new Date(`${day}T12:00:00Z`), createdAt: new Date(`${day}T08:00:00Z`), ...extra,
          originalAmount: 1000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 1000, shares: { create: [{ memberId: M, amount: 500 }, { memberId: P, amount: 500 }] },
        },
      });
    await exp("Dinner", "2024-10-01");
    await db.payment.create({ data: { groupId: g.id, fromId: P, toId: M, amount: 500, createdById: P, createdAt: new Date("2024-10-20T08:00:00Z") } });
    await exp("Game result", "2024-10-22", { kind: "pot" });
    await exp("Deleted", "2024-10-25", { deletedAt: new Date("2024-10-26T08:00:00Z") });
    const facts = (await undatedTripFacts([{ groupId: g.id, me: { id: M, leftAt: null } }], "Asia/Kolkata")).get(g.id);
    expect(facts).toEqual({ count: 1, day: "2024-10-01" });
    const p = await loadPassport({ id: me.id, homeCountry: "IN", places: "", timeZone: "" }, "2025-01-01");
    expect(stampOf(p, g.id)).toBe("2024-10-01");
  });
});

// Batch B4 (VA2-13, VD1-4): Our passports compares everyone by the same rule, the viewer included. A trip with no dates and spending
// today is "still going on", so it is in nobody's comparison until 3 days after the last spending.
describe("Our passports: one rule for everybody (loadComparePassport)", () => {
  it("an undated trip with spending on 16 Nov: neither person has IN on 16 Nov; both have it, shared, on 20 Nov", async () => {
    const { loadComparePassport } = await import("@/lib/passport-db");
    const y = await account("cmpY", {});
    const p = await account("cmpP", {});
    const g = await group("Pune weekend", [{ account: y }, { account: p }]);
    const me = await db.member.findFirst({ where: { groupId: g.id, accountId: y.id } });
    await db.expense.create({
      data: {
        groupId: g.id, description: "Misal", splitType: "equal", forMode: "everyone", amount: 20000, originalAmount: 20000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 20000,
        paidById: me!.id, createdById: me!.id, createdAt: new Date("2026-11-16T06:00:00Z"), spentAt: new Date("2026-11-16T06:00:00Z"),
        shares: { create: (await db.member.findMany({ where: { groupId: g.id } })).map((m) => ({ memberId: m.id, amount: 10000 })) },
      },
    });
    // The home country is where the trip is, so it is a "been" stamp only when the trip counts (here IN from the place "Goa").
    await db.group.update({ where: { id: g.id }, data: { type: "trip", tripPlace: "Goa", tripCountry: "IN" } });
    const accounts = [y, p].map((a) => ({ id: a.id, homeCountry: "", places: "[]", timeZone: "Asia/Kolkata" }));
    const on16 = await Promise.all(accounts.map((a) => loadComparePassport(a, "2026-11-16")));
    expect(on16.map((x) => x.index.map((r) => r.code))).toEqual([[], []]);
    const on20 = await Promise.all(accounts.map((a) => loadComparePassport(a, "2026-11-20"))); // 16 Nov + 3 days = 19 Nov, before today
    expect(on20.map((x) => x.index.map((r) => r.code))).toEqual([["IN"], ["IN"]]);
  });
});
