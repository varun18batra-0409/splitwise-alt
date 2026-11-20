import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

// The independent review's fixes for "join without an account":
//   M2 who looks after the group (an account first), M3 removing a guest name always leaves a mark, L2 freeing a name,
//   M5 the privacy wording, L1 what a signed-out visitor can read on the join page. (M1 is in moments-access.test.ts and guest-rules.test.ts,
//   M4 in guest-join.test.ts.)

const state = vi.hoisted(() => ({ cookie: "", ip: "10.77.0.1" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined),
    set: (n: string, v: string) => {
      if (n === "sw_me") state.cookie = v;
    },
    delete: (n: string) => {
      if (n === "sw_me") state.cookie = "";
    },
  }),
  headers: async () => new Headers({ host: "loopin.test", "x-forwarded-for": state.ip }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  RedirectType: { replace: "replace", push: "push" },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/server", async (orig) => ({ ...(await orig<typeof import("next/server")>()), after: () => undefined }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const A = await import("@/app/actions");
const join = await import("@/lib/join");
const { pickAdmin, groupAdminId, isGroupAdmin } = await import("@/lib/group-admin");
const { encodeSession, today } = await import("@/lib/session");
const { GUEST_REFUSAL } = await import("@/lib/guest-words");
const { eraseGroups } = await import("@/lib/purge");
const { undoEvent } = await import("@/lib/undo");
const { saveMoment } = await import("@/lib/moments-db");
const { canDeleteMoment, canUseMomentOnPostcard, loadMomentViewer } = await import("@/lib/moments-access");
const { signInAs, parseConfirmed } = await import("@/lib/identity");
const pause = () => new Promise((r) => setTimeout(r, 15));

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
process.env.MAIL_OUTBOX = "1";
const groupIds: string[] = [];
const accountIds: string[] = [];
let n = 0;
afterAll(async () => {
  state.cookie = "";
  await db.rateLimit.deleteMany({ where: { key: { contains: state.ip } } });
  await eraseGroups(groupIds);
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

async function account(name: string) {
  const a = await db.account.create({ data: { email: `${name.toLowerCase()}-${++n}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return a;
}
const asAccount = async (accountId: string) => {
  state.cookie = await encodeSession({ m: {}, a: accountId, v: 0, t: today() });
};
const asGuest = async (groupId: string, memberId: string, epoch = 0) => {
  state.cookie = await encodeSession({ m: { [groupId]: `${memberId}~${epoch}` }, t: today() });
};
// Runs a server action and returns where it redirected to (every action ends in a redirect).
async function go(fn: (fd: FormData) => Promise<void>, fields: Record<string, string>): Promise<string> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  try {
    await fn(fd);
  } catch (e) {
    const m = String((e as Error).message);
    if (m.startsWith("NEXT_REDIRECT ")) return m.slice("NEXT_REDIRECT ".length);
    throw e;
  }
  return "";
}

// ---------------------------------------------------------------------------------------------------------------
describe("M2: who looks after the group is the live rule; a guest admin is asked to sign in", () => {
  const d = new Date(2026, 0, 1);
  it("pickAdmin: the first claimed person still here, else the first still here; an account is NOT preferred", () => {
    const rows = [
      { id: "cy", claimedAt: d, leftAt: d, accountId: "a1" }, // started it, left
      { id: "gus", claimedAt: d, leftAt: null, accountId: null }, // next to join, a guest
      { id: "ana", claimedAt: d, leftAt: null, accountId: "a2" },
    ];
    expect(pickAdmin(rows)?.id).toBe("gus"); // admin does NOT pass to the later account holder
    expect(pickAdmin(rows.filter((r) => r.id !== "gus"))?.id).toBe("ana");
    expect(pickAdmin([{ id: "y", claimedAt: d, leftAt: null, accountId: null }, { id: "x", claimedAt: d, leftAt: null, accountId: "a1" }])?.id).toBe("y");
    expect(pickAdmin([{ id: "g1", claimedAt: null, leftAt: null, accountId: null }, { id: "g2", claimedAt: d, leftAt: null, accountId: null }])?.id).toBe("g2"); // claimed first
    expect(pickAdmin([{ id: "g1", claimedAt: null, leftAt: null, accountId: null }, { id: "g2", claimedAt: null, leftAt: null, accountId: null }])?.id).toBe("g1"); // nobody claimed: the first still here
  });

  it("creator leaves, next to join is a guest: the guest looks after the group but every admin action is refused with the sign-in message", async () => {
    const ana = await account("Ana");
    const g = await db.group.create({
      data: {
        name: `M2 ${++n} ${stamp}`, inviteCode: `m2-${n}-${stamp}`,
        members: {
          create: [
            { name: "Cy", claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1), leftAt: new Date(2026, 0, 5) },
            { name: "Gus", claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2) }, // a guest
            { name: "Ana", accountId: ana.id, claimedAt: new Date(2026, 0, 3), createdAt: new Date(2026, 0, 3) },
            { name: "Rin", claimedAt: new Date(2026, 0, 4), createdAt: new Date(2026, 0, 4) }, // a guest
          ],
        },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const id = (name: string) => g.members.find((m) => m.name === name)!.id;
    expect(await groupAdminId(g.id)).toBe(id("Gus"));
    expect(await isGroupAdmin(g.id, id("Gus"))).toBe(true);
    expect(await isGroupAdmin(g.id, id("Ana"))).toBe(false);

    // The guest admin cannot do the admin things (here: a new link, and freeing a name): refused with the sign-in message.
    expect(await join.releaseGuestName(g.id, id("Gus"), id("Rin"))).toEqual({ ok: false, error: GUEST_REFUSAL });
    expect((await db.member.findUniqueOrThrow({ where: { id: id("Rin") } })).claimedAt).not.toBeNull();
    // ...and through the real action (remove a person) he is sent to sign in; nothing changes.
    await asGuest(g.id, id("Gus"));
    const removed = await go(A.removePerson, { groupId: g.id, memberId: id("Rin") });
    expect(removed).toContain("signin=general"); // the sign-in sheet note
    expect(await db.member.count({ where: { id: id("Rin") } })).toBe(1);
    await go(A.makeNewInviteLink, { groupId: g.id });
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).inviteCode).toBe(g.inviteCode);
  });

  it("pickAdmin does not read accountId (no account preference)", () => {
    expect(readFileSync("src/lib/group-admin.ts", "utf8")).not.toMatch(/filter\(\(m\) => m\.accountId/);
  });

  it("every place that picks the person who looks after a group passes accountId (the People, Settings, Invite, Move, Pot, Restore and Moments lookups)", () => {
    expect(readFileSync("src/lib/group-admin.ts", "utf8")).toContain("seenAt: true, accountId: true");
    expect(readFileSync("src/lib/pot-db.ts", "utf8")).toContain("addedBy: true, seenAt: true, accountId: true");
    expect(readFileSync("src/lib/group-data.ts", "utf8")).toContain("addedBy: true, seenAt: true, accountId: true");
    // The group screens read members with every column except a few they omit (accountId is kept).
    expect(readFileSync("src/lib/group-data.ts", "utf8")).toContain("omit: { notify: true, addedBy: true, seenAt: true, removedById: true, seenEventsAt: true }");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("M3: removing a name a guest holds always leaves a mark (the real removal action)", () => {
  it("guest joins, the admin removes at once: the row stays, marked removed; the same phone is refused as a new name and on 'That's me'", async () => {
    const varun = await account("Varun");
    const g = await db.group.create({
      data: {
        name: `M3 ${++n} ${stamp}`, inviteCode: `m3-${n}-${stamp}`,
        members: { create: [{ name: "Varun", accountId: varun.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, { name: "Ravi", createdAt: new Date(2026, 0, 2) }] },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const ravi = g.members.find((m) => m.name === "Ravi")!.id;

    // Ben joins through the join action with no account; the phone remembers him.
    state.cookie = "";
    expect(await go(A.joinAsNew, { code: g.inviteCode, name: "Ben" })).toBe(`/groups/${g.id}`);
    const ben = await db.member.findFirstOrThrow({ where: { groupId: g.id, name: "Ben" } });
    expect(ben).toMatchObject({ accountId: null });
    expect(ben.claimedAt).not.toBeNull();
    const benPhone = state.cookie;

    // Varun removes him straight away (no expenses, no anything: before this fix the row was deleted and left no mark).
    await asAccount(varun.id);
    await go(A.removePerson, { groupId: g.id, memberId: ben.id });
    const after = await db.member.findUniqueOrThrow({ where: { id: ben.id } });
    expect(after.removedAt).not.toBeNull();
    expect(after.leftAt).not.toBeNull();
    expect(after.removedById).toBe((await db.member.findFirstOrThrow({ where: { groupId: g.id, name: "Varun" } })).id);

    // The same phone: refused as a new name (no second Ben) and refused on "That's me" for the unclaimed name.
    state.cookie = benPhone;
    expect(await go(A.joinAsNew, { code: g.inviteCode, name: "Ben" })).toBe(`/join/${g.inviteCode}?error=removed&step=name`);
    expect(await go(A.joinAsExisting, { code: g.inviteCode, memberId: ravi })).toBe(`/join/${g.inviteCode}?error=removed&step=name`);
    expect(await db.member.count({ where: { groupId: g.id, name: { startsWith: "Ben" } } })).toBe(1);
    expect((await db.member.findUniqueOrThrow({ where: { id: ravi } })).claimedAt).toBeNull();
  });

  it("a plain name nobody claimed and nobody used is still deleted completely (no mark needed: nobody holds it)", async () => {
    const varun = await account("Varun");
    const g = await db.group.create({
      data: { name: `M3b ${++n} ${stamp}`, inviteCode: `m3b-${n}-${stamp}`, members: { create: [{ name: "Varun", accountId: varun.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, { name: "Ravi", createdAt: new Date(2026, 0, 2) }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    await asAccount(varun.id);
    await go(A.removePerson, { groupId: g.id, memberId: g.members.find((m) => m.name === "Ravi")!.id });
    expect(await db.member.count({ where: { groupId: g.id, name: "Ravi" } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("L2: freeing a name is for people still in the group, and for names still in it", () => {
  async function fixture() {
    const varun = await account("Varun");
    const g = await db.group.create({
      data: {
        name: `L2 ${++n} ${stamp}`, inviteCode: `l2-${n}-${stamp}`,
        members: {
          create: [
            { name: "Varun", accountId: varun.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) },
            { name: "Ben", claimedAt: new Date(2026, 0, 2), createdAt: new Date(2026, 0, 2) },
            { name: "Cat", claimedAt: new Date(2026, 0, 3), createdAt: new Date(2026, 0, 3) },
            { name: "Dan", claimedAt: new Date(2026, 0, 4), createdAt: new Date(2026, 0, 4) },
          ],
        },
      },
      include: { members: true },
    });
    groupIds.push(g.id);
    const id = (name: string) => g.members.find((m) => m.name === name)!.id;
    return { g, V: id("Varun"), B: id("Ben"), C: id("Cat"), D: id("Dan"), varun };
  }
  const snapshot = (id: string) => db.member.findUniqueOrThrow({ where: { id } });

  it("a guest who has left cannot free their own name; one still in can", async () => {
    const f = await fixture();
    await db.member.update({ where: { id: f.B }, data: { leftAt: new Date() } });
    const before = await snapshot(f.B);
    expect(await join.releaseGuestName(f.g.id, f.B, f.B)).toEqual({ ok: false, error: "Only people still in this group can do this." });
    expect(await snapshot(f.B)).toEqual(before); // nothing changed: still claimed, same epoch
    expect((await join.releaseGuestName(f.g.id, f.C, f.C)).ok).toBe(true);
  });

  it("the admin cannot free a name that left or was removed; nothing changes", async () => {
    const f = await fixture();
    await db.member.update({ where: { id: f.B }, data: { leftAt: new Date() } });
    await db.member.update({ where: { id: f.C }, data: { leftAt: new Date(), removedAt: new Date(), removedById: f.V } });
    const [b, c] = [await snapshot(f.B), await snapshot(f.C)];
    const events = await db.groupEvent.count({ where: { groupId: f.g.id } });
    expect(await join.releaseGuestName(f.g.id, f.V, f.B)).toMatchObject({ ok: false });
    expect(await join.releaseGuestName(f.g.id, f.V, f.C)).toMatchObject({ ok: false });
    expect(await snapshot(f.B)).toEqual(b);
    expect(await snapshot(f.C)).toEqual(c);
    expect(await db.groupEvent.count({ where: { groupId: f.g.id } })).toBe(events);
    // A name still in the group is freed as before.
    expect((await join.releaseGuestName(f.g.id, f.V, f.D)).ok).toBe(true);
  });

  it("a removed person is refused as the caller too", async () => {
    const f = await fixture();
    await db.member.update({ where: { id: f.C }, data: { leftAt: new Date(), removedAt: new Date(), removedById: f.V } });
    expect(await join.releaseGuestName(f.g.id, f.C, f.C)).toMatchObject({ ok: false });
    expect((await snapshot(f.C)).claimedAt).not.toBeNull();
  });

  it("a guest admin is still refused for others with the sign-in line", async () => {
    const f = await fixture();
    await db.member.update({ where: { id: f.V }, data: { leftAt: new Date() } }); // Varun leaves: Ben (first guest) looks after the group
    expect(await join.releaseGuestName(f.g.id, f.B, f.C)).toEqual({ ok: false, error: GUEST_REFUSAL });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("M5: the privacy page says blocks do not cover people who joined without an account", () => {
  const page = readFileSync("src/app/privacy/page.tsx", "utf8").replace(/\s+/g, " ");
  it("the Block bullet says it in full, and the Moments bullet points at it", () => {
    expect(page).toContain("Blocking works between Loopin accounts. Someone in your group who joined without an account isn’t covered by a block, so if you need distance from someone, ask whoever looks after the group to remove them.");
    const moments = page.slice(page.indexOf("<strong>Moments:</strong>"));
    expect(moments.slice(0, moments.indexOf("</li>"))).toContain("someone in your group who joined without an account isn’t covered by a block");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("L1: a signed-out visitor never reads a full name on the join page", () => {
  const src = readFileSync("src/app/join/[code]/page.tsx", "utf8");
  const signedOut = src.slice(src.indexOf("{!account ? ("), src.indexOf(") : (\n        <>\n          <hr")).replace("<Avatar name={m.name} />", ""); // the avatar draws only an initial
  it("every name shown in the signed-out part goes through publicName", () => {
    expect(signedOut).not.toMatch(/\{(asMember|m)\.name\}/);
    expect(signedOut).toContain("publicName(asMember.name)");
    expect(signedOut).toContain("publicName(m.name)");
  });
  it("?as= is honoured signed out only when it is the name the open invitation for ?e= was sent for; otherwise it is ignored", () => {
    expect(src).toContain("reservedOk ? unclaimed.find((m) => m.id === asId) : null");
    expect(src).toContain("const reservedOk = !account && asId && invitedEmail ? (await openInviteEmails(group.id, asId)).includes(invitedEmail.trim().toLowerCase()) : false;");
    // The old reading (a claimable name picked by ?as= alone) is gone.
    expect(src).not.toContain("(account || reservedOk ? unclaimed : claimable).find");
  });
  it("the list of names for a signed-out visitor leaves out every name that was ever invited by email, closed or not", () => {
    expect(src).toContain("invitedNameRows(group.id, { forGuest: !account })");
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("undoing a join (or an add) of a name a guest holds marks it removed instead of deleting it", () => {
  it("the real undo path: the admin undoes Ben's 'joined the group'; the row stays, marked removed; the same phone is refused on both ways in", async () => {
    const varun = await account("Varun");
    const g = await db.group.create({
      data: { name: `U1 ${++n} ${stamp}`, inviteCode: `u1-${n}-${stamp}`, members: { create: [{ name: "Varun", accountId: varun.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, { name: "Ravi", createdAt: new Date(2026, 0, 2) }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    const ravi = g.members.find((m) => m.name === "Ravi")!.id;
    const V = g.members.find((m) => m.name === "Varun")!.id;
    const r = (await join.joinNewAsGuest(g.inviteCode, "Ben")) as { memberId: string };
    // A guest's own join line no longer carries an undo (see the next describe); this line is written the way an older one was.
    const line0 = await db.groupEvent.findFirstOrThrow({ where: { groupId: g.id, actorId: r.memberId, text: "joined the group" } });
    const line = await db.groupEvent.update({ where: { id: line0.id }, data: { undo: JSON.stringify({ type: "members_remove", memberIds: [r.memberId] }) } });
    const epoch = (await db.member.findUniqueOrThrow({ where: { id: r.memberId } })).grantEpoch;
    await db.pushSubscription.create({ data: { memberId: r.memberId, endpoint: `https://push.test/${stamp}-${++n}`, p256dh: "k", auth: "a" } });

    expect((await undoEvent(line.id, V)).ok).toBe(true);
    const row = await db.member.findUniqueOrThrow({ where: { id: r.memberId } }); // still there
    expect(row.removedAt).not.toBeNull();
    expect(row.leftAt).not.toBeNull();
    expect(row.removedById).toBe(V);
    expect(row.grantEpoch).toBe(epoch + 1);
    expect(await db.pushSubscription.count({ where: { memberId: r.memberId } })).toBe(0);
    expect(await db.groupEvent.count({ where: { groupId: g.id, kind: "members_removed" } })).toBe(1);

    // The same phone (it still holds the name) is refused as a new name and on "That's me".
    expect(await join.joinNewAsGuest(g.inviteCode, "Ben", r.memberId)).toMatchObject({ ok: false, reason: "removed", adminName: "Varun" });
    expect(await join.joinExistingAsGuest(g.inviteCode, ravi, r.memberId)).toMatchObject({ ok: false, reason: "removed" });
    expect((await db.member.findUniqueOrThrow({ where: { id: ravi } })).claimedAt).toBeNull();
  });

  it("a guest's own 'joined the group' line has no undo, so no Undo is offered and they cannot mark themselves removed", async () => {
    const varun = await account("Varun");
    const g = await db.group.create({
      data: { name: `U3 ${++n} ${stamp}`, inviteCode: `u3-${n}-${stamp}`, members: { create: [{ name: "Varun", accountId: varun.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }] } },
    });
    groupIds.push(g.id);
    const r = (await join.joinNewAsGuest(g.inviteCode, "Ben")) as { memberId: string };
    const line = await db.groupEvent.findFirstOrThrow({ where: { groupId: g.id, actorId: r.memberId, text: "joined the group" } });
    expect(line.undo).toBe("");
    const res = await undoEvent(line.id, r.memberId, undefined, { guestRules: true });
    expect(res.ok).toBe(false);
    const row = await db.member.findUniqueOrThrow({ where: { id: r.memberId } });
    expect(row.removedAt).toBeNull();
    expect(row.leftAt).toBeNull();
  });

  it("a name nobody holds (added by an admin, never claimed) is still deleted by the undo, as before", async () => {
    const varun = await account("Varun");
    const g = await db.group.create({
      data: { name: `U2 ${++n} ${stamp}`, inviteCode: `u2-${n}-${stamp}`, members: { create: [{ name: "Varun", accountId: varun.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, { name: "Ravi", createdAt: new Date(2026, 0, 2) }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    const ravi = g.members.find((m) => m.name === "Ravi")!.id;
    const { removeMembers } = await import("@/lib/undo");
    expect((await removeMembers(g.id, g.members.find((m) => m.name === "Varun")!.id, [ravi])).ok).toBe(true);
    expect(await db.member.count({ where: { id: ravi } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("L9: a freed name does not hand the earlier holder's moments to whoever takes it next", () => {
  const photo = (groupId: string, memberId: string) => ({
    groupId, memberId, accountId: null as string | null, caption: "", takenOn: "", type: "image/webp", width: 1, height: 1, blobKey: "", thumbKey: "", data: new Uint8Array(3) as Uint8Array<ArrayBuffer>, thumbData: new Uint8Array(3) as Uint8Array<ArrayBuffer>,
  });
  it("Ben adds a moment; Varun frees the name; Cat takes it: she cannot delete Ben's moment, can delete her own, and after she signs in only hers is hers (postcards included)", async () => {
    const varun = await account("Varun");
    const g = await db.group.create({
      data: { name: `L9 ${++n} ${stamp}`, inviteCode: `l9-${n}-${stamp}`, type: "trip", tripStart: "2026-03-10", tripEnd: "2026-03-14", members: { create: [{ name: "Varun", accountId: varun.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }] } },
      include: { members: true },
    });
    groupIds.push(g.id);
    const V = g.members[0].id;
    const ben = (await join.joinNewAsGuest(g.inviteCode, "Ben")) as { memberId: string };
    await pause();
    expect((await saveMoment(photo(g.id, ben.memberId))).ok).toBe(true);
    const old = await db.moment.findFirstOrThrow({ where: { authorId: ben.memberId } });
    const factsOf = (m: { groupId: string; authorId: string; authorAccountId: string; createdAt: Date }) => ({ groupId: m.groupId, authorId: m.authorId, authorAccountId: m.authorAccountId, createdAt: m.createdAt });
    // Ben can delete his own while he holds the name.
    expect(canDeleteMoment(await loadMomentViewer(g.id, ben.memberId), factsOf(old))).toBe(true);

    await pause();
    expect((await join.releaseGuestName(g.id, V, ben.memberId)).ok).toBe(true);
    await pause();
    // Cat takes the freed name through "That's me".
    expect(await join.joinExistingAsGuest(g.inviteCode, ben.memberId)).toEqual({ ok: true, memberId: ben.memberId });
    await pause();
    expect(canDeleteMoment(await loadMomentViewer(g.id, ben.memberId), factsOf(old))).toBe(false); // the earlier holder's moment is not hers
    expect((await saveMoment(photo(g.id, ben.memberId))).ok).toBe(true);
    const mine = await db.moment.findFirstOrThrow({ where: { authorId: ben.memberId, id: { not: old.id } } });
    expect(canDeleteMoment(await loadMomentViewer(g.id, ben.memberId), factsOf(mine))).toBe(true);
    expect(canDeleteMoment(await loadMomentViewer(g.id, V), factsOf(old))).toBe(true); // whoever looks after the group still can

    // She signs in: only the moment she added becomes hers.
    const cat = await account("Cat");
    const epoch = (await db.member.findUniqueOrThrow({ where: { id: ben.memberId } })).grantEpoch;
    await asGuest(g.id, ben.memberId, epoch);
    await signInAs(cat.id, { confirmed: parseConfirmed([ben.memberId]) });
    expect((await db.member.findUniqueOrThrow({ where: { id: ben.memberId } })).accountId).toBe(cat.id);
    expect((await db.moment.findUniqueOrThrow({ where: { id: old.id } })).authorAccountId).toBe(""); // still the earlier holder's: no account on it
    expect((await db.moment.findUniqueOrThrow({ where: { id: mine.id } })).authorAccountId).toBe(cat.id);
    const catViewer = await loadMomentViewer(g.id, ben.memberId);
    expect(canUseMomentOnPostcard(catViewer, { groupId: g.id, authorId: old.authorId, authorAccountId: "", createdAt: old.createdAt })).toBe(false);
    expect(canUseMomentOnPostcard(catViewer, { groupId: g.id, authorId: mine.authorId, authorAccountId: cat.id, createdAt: mine.createdAt })).toBe(true);
    expect(canDeleteMoment(catViewer, factsOf(old))).toBe(false); // an account matches by account: the old moment has none
  });

  it("a guest who never lost the name still gets every moment they added when they sign in", async () => {
    const varun = await account("Varun");
    const g = await db.group.create({
      data: { name: `L9b ${++n} ${stamp}`, inviteCode: `l9b-${n}-${stamp}`, type: "trip", tripStart: "2026-03-10", tripEnd: "2026-03-14", members: { create: [{ name: "Varun", accountId: varun.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }] } },
    });
    groupIds.push(g.id);
    const ben = (await join.joinNewAsGuest(g.inviteCode, "Ben")) as { memberId: string };
    await pause();
    expect((await saveMoment(photo(g.id, ben.memberId))).ok).toBe(true);
    const bea = await account("Bea");
    await asGuest(g.id, ben.memberId, 0);
    await signInAs(bea.id, { confirmed: parseConfirmed([ben.memberId]) });
    expect((await db.moment.findFirstOrThrow({ where: { authorId: ben.memberId } })).authorAccountId).toBe(bea.id);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe("the moment upload limit is per person: the account when there is one, the member otherwise", () => {
  it("the route keys the limit like the group photo route does", () => {
    const src = readFileSync("src/app/api/moment/route.ts", "utf8");
    expect(src).toContain("accountId ? `moment:a:${accountId}` : `moment:m:${viewer.memberId}`");
    expect(src).not.toContain("allow(`moment:${viewer.memberId}`");
  });
});
