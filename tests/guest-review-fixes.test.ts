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
describe("M2: who looks after the group prefers someone with an account", () => {
  const d = new Date(2026, 0, 1);
  it("pickAdmin: the earliest joined member WITH an account; guests only if nobody with an account is left; rows that don't say count as having one", () => {
    const rows = [
      { id: "cy", claimedAt: d, leftAt: d, accountId: "a1" }, // started it, left
      { id: "gus", claimedAt: d, leftAt: null, accountId: null }, // next to join, a guest
      { id: "ana", claimedAt: d, leftAt: null, accountId: "a2" },
    ];
    expect(pickAdmin(rows)?.id).toBe("ana");
    expect(pickAdmin(rows.filter((r) => r.id !== "ana"))?.id).toBe("gus"); // nobody with an account is left: today's rule
    expect(pickAdmin([{ id: "x", claimedAt: d, leftAt: null }, { id: "y", claimedAt: d, leftAt: null, accountId: null }])?.id).toBe("x"); // no accountId given: as before
    expect(pickAdmin([{ id: "g1", claimedAt: null, leftAt: null, accountId: null }, { id: "g2", claimedAt: d, leftAt: null, accountId: null }])?.id).toBe("g2"); // today's claimed-first rule among guests
  });

  it("creator leaves, next to join is a guest, then a member with an account: the account member looks after the group and can remove people, make a link and free names", async () => {
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
    expect(await groupAdminId(g.id)).toBe(id("Ana"));
    expect(await isGroupAdmin(g.id, id("Ana"))).toBe(true);
    expect(await isGroupAdmin(g.id, id("Gus"))).toBe(false);

    // The guest who joined earlier cannot do the admin things (here: a new link, and freeing a name).
    expect(await join.newInviteLink(g.id, id("Gus"))).toEqual({ ok: false, error: join.NEW_LINK_ADMIN_ONLY });
    expect(await join.releaseGuestName(g.id, id("Gus"), id("Rin"))).toMatchObject({ ok: false });
    expect((await db.member.findUniqueOrThrow({ where: { id: id("Rin") } })).claimedAt).not.toBeNull();

    // Ana, with an account, can: free a name, make a new link, and remove a person (through the real action).
    expect((await join.releaseGuestName(g.id, id("Ana"), id("Rin"))).ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: id("Rin") } })).claimedAt).toBeNull();
    expect((await join.newInviteLink(g.id, id("Ana"))).ok).toBe(true);
    await asAccount(ana.id);
    await go(A.removePerson, { groupId: g.id, memberId: id("Rin") });
    expect(await db.member.count({ where: { id: id("Rin") } })).toBe(0); // never used and never claimed: deleted completely, as before

    // With Ana gone too, only guests are left: today's rule picks Gus, but his powers still need an account.
    await db.member.update({ where: { id: id("Ana") }, data: { leftAt: new Date() } });
    expect(await groupAdminId(g.id)).toBe(id("Gus"));
    expect(await join.releaseGuestName(g.id, id("Gus"), id("Gus"))).toMatchObject({ ok: true }); // his own name: always his
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
