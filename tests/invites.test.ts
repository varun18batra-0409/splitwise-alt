import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addRegistered, freeName, inviteByEmail, inviteMemberId, inviteRowLabel, nameFromEmail, newInviteToken, searchPeople } from "@/lib/invites";
import { groupPeople, setMemberLeft, setMember } from "@/lib/people";

// Adding people: everyone added by email (or found by name) is in the group at once as a name and
// is invited; their account is linked only when they join. The adder gets the same reply whether or
// not the email is on Loopin. Name search only finds people you already know.

const stamp = Date.now();
const mail = (n: string) => `${n}-${stamp}@example.com`;
let joey = "", rancho = "", stranger = "";
let g1 = "", g2 = "", meG1 = "", meG2 = "";

beforeAll(async () => {
  process.env.MAIL_OUTBOX = "1";
  const me = await db.account.create({ data: { email: mail("me"), name: "Chandler" } });
  joey = (await db.account.create({ data: { email: mail("joey"), name: "Joey" } })).id;
  rancho = (await db.account.create({ data: { email: mail("rancho"), name: "Rancho" } })).id;
  stranger = (await db.account.create({ data: { email: mail("sheldon"), name: "Sheldon" } })).id;
  // An older group where I already know Joey and Rancho.
  const old = await db.group.create({
    data: {
      name: "Old trip", currency: "INR", inviteCode: `old-${stamp}`,
      members: { create: [{ name: "Chandler", accountId: me.id }, { name: "Joey", accountId: joey }, { name: "Rancho", accountId: rancho }] },
    },
    include: { members: true },
  });
  g1 = old.id;
  meG1 = old.members.find((m) => m.name === "Chandler")!.id;
  const fresh = await db.group.create({
    data: { name: "Euro trip", currency: "EUR", inviteCode: `euro-${stamp}`, members: { create: [{ name: "Chandler", accountId: me.id }] } },
    include: { members: true },
  });
  g2 = fresh.id;
  meG2 = fresh.members[0].id;
});

afterAll(async () => {
  for (const id of [g1, g2]) await db.group.delete({ where: { id } }).catch(() => {});
  await db.invite.deleteMany({ where: { groupId: { in: [g1, g2] } } });
  await db.account.deleteMany({ where: { email: { contains: String(stamp) } } });
  await db.outbox.deleteMany({ where: { to: { contains: String(stamp) } } });
});

describe("adding people", () => {
  it("never reuses a name in the group", () => {
    expect(freeName(["Joey", "Rancho"], "Joey")).toBe("Joey 2");
    expect(freeName(["Joey", "joey 2"], "Joey")).toBe("Joey 3");
    expect(freeName([], "  ")).toBe("Friend");
  });

  it("finds friends by name; a stranger's email reveals nothing (the screen offers a neutral Add for any email)", async () => {
    const ms = { [g1]: meG1, [g2]: meG2 };
    expect((await searchPeople(ms, g2, "joe")).map((f) => f.name)).toEqual(["Joey"]);
    expect(await searchPeople(ms, g2, "sheld")).toEqual([]); // not someone I know
    expect(await searchPeople(ms, g2, mail("sheldon"))).toEqual([]); // no "Sheldon is on Loopin" by email
    expect(await searchPeople(ms, g2, "chandler")).toEqual([]); // never suggests yourself
  });

  // C18: names only. Never an email in a result, never a match on part of an email.
  it("search results carry no email, and typing part of an email finds nobody", async () => {
    const ms = { [g1]: meG1, [g2]: meG2 };
    const found = await searchPeople(ms, g2, "joe");
    expect(found).toHaveLength(1);
    expect(Object.keys(found[0])).not.toContain("email");
    expect(JSON.stringify(found)).not.toContain("example.com");
    expect(JSON.stringify(found)).not.toContain(String(stamp)); // not even the start of an email
    expect(await searchPeople(ms, g2, "gmail")).toEqual([]);
    expect(await searchPeople(ms, g2, "example.com")).toEqual([]);
    expect(await searchPeople(ms, g2, `joey-${stamp}`)).toEqual([]); // the start of Joey's email is not a name
    expect(await searchPeople(ms, g2, mail("joey"))).toEqual([]); // a full email of someone I know isn't matched either
    expect((await searchPeople(ms, g2, "rancho")).map((f) => f.name)).toEqual(["Rancho"]);
  });

  it("a typed invite email is shown only to the person who invited; everyone else sees who invited", () => {
    const inv = { email: "kabir@example.com", invitedById: "m-chandler" };
    expect(inviteRowLabel(inv, "m-chandler", "Chandler")).toBe("kabir@example.com");
    expect(inviteRowLabel(inv, "m-joey", "Chandler")).toBe("Invited by Chandler");
  });

  it("someone with no name of their own is shown by the name they have in the group you share, not their email", async () => {
    const ghost = await db.account.create({ data: { email: `qwerty-${stamp}@gmail.com`, name: "" } });
    await db.member.create({ data: { groupId: g1, name: "Pinky", accountId: ghost.id } });
    const ms = { [g1]: meG1, [g2]: meG2 };
    const byGroupName = await searchPeople(ms, g2, "pink");
    expect(byGroupName.map((f) => f.name)).toEqual(["Pinky"]);
    expect(await searchPeople(ms, g2, "qwerty")).toEqual([]); // the start of their email doesn't find them
  });

  // REVERSED ON PURPOSE (Batch B): adding someone used to put their account straight into the group.
  // Now they are in the group at once as a NAME ONLY (so they can be split with) and are invited;
  // the account is linked only when they tap Join (see tests/invitations.test.ts).
  it("adding someone on Loopin by name puts a name in the group at once and invites them; their account isn't on the row", async () => {
    const r = await addRegistered(g2, meG2, joey, "https://loopin.test");
    expect(r.ok && r.name).toBe("Joey");
    const m = await db.member.findFirstOrThrow({ where: { groupId: g2, name: "Joey" } });
    expect(m.accountId).toBeNull();
    expect(m.claimedAt).toBeNull();
    expect(m.addedBy).toBe(""); // a plain name, like a friend added by name
    const inv = await db.invite.findFirstOrThrow({ where: { groupId: g2, email: mail("joey") } });
    expect(inv.memberId).toBe(m.id); // the name row is the invitation's own column, not part of the token
    expect(inv.token.length).toBeGreaterThanOrEqual(20);
    expect(inv.token).not.toContain(m.id);
    expect(inv.token).not.toContain(".");
    expect(inv.acceptedAt).toBeNull();
    expect(inv.declinedAt).toBeNull();
    const ev = await db.groupEvent.findFirst({ where: { groupId: g2, kind: "members_added" } });
    expect(ev?.text).toBe("added Joey to the group");
    expect(await db.outbox.count({ where: { to: mail("joey"), subject: { contains: "added you to Euro trip" } } })).toBe(1);
    expect(await db.accountNote.count({ where: { accountId: joey, kind: "group_invite" } })).toBe(1);
    // Asked again before he joined: the same name, a fresh invitation (no second Joey).
    const again = await addRegistered(g2, meG2, joey, "https://loopin.test");
    expect(again.ok).toBe(true);
    expect(await db.member.count({ where: { groupId: g2, name: { startsWith: "Joey" } } })).toBe(1);
    // Search shows him as "Invited", not "In group".
    const ms = { [g1]: meG1, [g2]: meG2 };
    const found = (await searchPeople(ms, g2, "joe"))[0];
    expect(found.inGroup).toBe(false);
    expect(found.invited).toBe(true);
  });

  it("an email gets the same reply whether it is on Loopin, unknown, already in the group, or your own", async () => {
    // Sheldon is already a real member of the group.
    await db.member.create({ data: { groupId: g2, name: "Sheldon", accountId: stranger, claimedAt: new Date() } });
    const before = await db.member.count({ where: { groupId: g2 } });
    const cases = {
      registered: mail("rancho"), // on Loopin
      unknown: mail("circuit"), // nobody
      existing: mail("sheldon"), // already in the group
      own: mail("me"), // the person adding
    };
    const reply: Record<string, Awaited<ReturnType<typeof inviteByEmail>>> = {};
    for (const [k, email] of Object.entries(cases)) reply[k] = await inviteByEmail(g2, meG2, email, "https://loopin.test");
    // The same shape for all four: one person listed under the email typed, nothing refused.
    for (const [k, r] of Object.entries(reply)) {
      expect(r.bad, k).toEqual([]);
      expect(Object.keys(r).sort(), k).toEqual(["bad", "people"]); // the same reply for all four (no Undo bar for any of them)
      expect(r.people.length, k).toBe(1);
      expect(r.people[0].email, k).toBe(cases[k as keyof typeof cases]);
      // The name comes from the email only (never from the account), so it says nothing about who has one.
      expect(r.people[0].name, k).toMatch(/^[A-Z][a-z]+( \d+)?$/); // number-only parts of the email are dropped (a " 2" only if the name is taken)
      expect(r.people[0].name.split(" ")[0].toLowerCase(), k).toBe(k === "own" ? "me" : { registered: "rancho", unknown: "circuit", existing: "sheldon" }[k]);
    }
    // A name row for the two new people only.
    expect(await db.member.count({ where: { groupId: g2 } })).toBe(before + 2);
    for (const k of ["registered", "unknown"] as const) {
      const m = await db.member.findFirstOrThrow({ where: { groupId: g2, name: reply[k].people[0].name } });
      expect(m.accountId).toBeNull();
      expect(await db.invite.count({ where: { groupId: g2, email: cases[k], acceptedAt: null } })).toBe(1);
    }
    // Nothing is sent to someone who is already in, or to yourself.
    for (const k of ["existing", "own"] as const) {
      expect(await db.invite.count({ where: { groupId: g2, email: cases[k] } }), k).toBe(0);
      expect(await db.outbox.count({ where: { to: cases[k], subject: { contains: "Euro trip" } } }), k).toBe(0);
    }
    // The invitation email goes to both new people; the Alerts note + phone push only to the one with an account.
    for (const k of ["registered", "unknown"] as const) expect(await db.outbox.count({ where: { to: cases[k], subject: { contains: "added you to Euro trip" } } }), k).toBe(1);
    expect(await db.accountNote.count({ where: { accountId: rancho, kind: "group_invite" } })).toBe(1);
    expect(await db.accountNote.count({ where: { kind: "group_invite", accountId: { in: [stranger] } } })).toBe(0);
    const sent = await db.outbox.findFirstOrThrow({ where: { to: cases.unknown } });
    expect(sent.text).toContain(`/join/euro-${stamp}?e=`);
    // Only a badly typed address is an error.
    const bad = await inviteByEmail(g2, meG2, "not-an-email", "https://loopin.test");
    expect(bad.bad).toEqual(["not-an-email"]);
    expect(bad.people).toEqual([]);
  });

  it("an invitation is still in place when the email couldn't be sent (the person is in the group either way)", async () => {
    const before = process.env.MAIL_OUTBOX;
    process.env.MAIL_OUTBOX = "0"; // no mail set up in tests → sending fails
    try {
      const r = await inviteByEmail(g2, meG2, mail("nomail"), "https://loopin.test");
      expect(r.bad).toEqual([]);
      expect(r.people.map((p) => p.email)).toEqual([mail("nomail")]);
      expect(await db.invite.count({ where: { groupId: g2, email: mail("nomail") } })).toBe(1);
    } finally {
      process.env.MAIL_OUTBOX = before;
    }
  });

  it("refuses people who aren't in the group", async () => {
    const r = await addRegistered(g2, "not-a-member", stranger, "https://loopin.test");
    expect(r.ok).toBe(false);
  });
});

describe("inviting someone who was added by name only", () => {
  it("emails a link that opens on their name, and refuses people already on Loopin", async () => {
    const { inviteToClaim } = await import("@/lib/invites");
    const g = await db.group.create({
      data: { name: "Old flat", currency: "INR", inviteCode: `claim-${stamp}`, members: { create: [{ name: "Chandler", accountId: (await db.account.findUniqueOrThrow({ where: { email: mail("me") } })).id }, { name: "Rohit" }] } },
      include: { members: true },
    });
    const me = g.members.find((m) => m.name === "Chandler")!;
    const rohit = g.members.find((m) => m.name === "Rohit")!;
    const r = await inviteToClaim(g.id, me.id, rohit.id, mail("rohit"), "https://loopinapps.com");
    expect(r).toEqual({ ok: true, email: mail("rohit") });
    const sent = await db.outbox.findFirstOrThrow({ where: { to: mail("rohit") }, orderBy: { createdAt: "desc" } });
    expect(sent.text).toContain(`/join/claim-${stamp}?e=`);
    expect(sent.text).toContain(`as=${rohit.id}`);
    expect(sent.subject).toContain("Old flat");
    expect(await inviteToClaim(g.id, me.id, me.id, mail("x"), "https://loopinapps.com")).toEqual({ ok: false, error: "That person is already on Loopin." });
    expect((await inviteToClaim(g.id, me.id, rohit.id, "not-an-email", "https://loopinapps.com")).ok).toBe(false);
    await db.group.delete({ where: { id: g.id } });
  });
});

describe("a name made from an email address", () => {
  it("drops parts that are only digits, keeps digits stuck to a word, and falls back to Friend", () => {
    expect(nameFromEmail("zoe-1794422699068@uat.loopin.test")).toBe("Zoe");
    expect(nameFromEmail("ravi.kumar@gmail.com")).toBe("Ravi Kumar");
    expect(nameFromEmail("ravi.kumar88@gmail.com")).toBe("Ravi Kumar88");
    expect(nameFromEmail("1234@x.com")).toBe("Friend");
    expect(nameFromEmail("  @x.com")).toBe("Friend");
    expect(nameFromEmail("a_12.b+34@x.com")).toBe("A B");
  });
});

describe("tokens are random; the name row is the invitation's own column", () => {
  it("two tokens never match and carry no member id; an older 'id.random' token still reads back its row", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(inviteMemberId({ memberId: "row1", token: a })).toBe("row1");
    expect(inviteMemberId({ memberId: "", token: "row2.abcdef" })).toBe("row2"); // test-only older format
    expect(inviteMemberId({ memberId: "", token: a })).toBe("");
  });
});

// Someone the admin removed can be brought back only by the admin, by every route (search, name, email).
describe("a removed person can't be added back by anyone but the admin", () => {
  let gid = "", asha = "", sam = "", ravi = "";
  let aAcc = "", sAcc = "", rAcc = "";
  const em = (n: string) => `rm-${n}-${stamp}@example.com`;
  const origin = "https://loopin.test";
  const raviRow = () => db.member.findUniqueOrThrow({ where: { id: ravi } });

  beforeAll(async () => {
    aAcc = (await db.account.create({ data: { email: em("asha"), name: "Asha" } })).id;
    sAcc = (await db.account.create({ data: { email: em("sam"), name: "Sam" } })).id;
    rAcc = (await db.account.create({ data: { email: em("ravi"), name: "Ravi" } })).id;
    const g = await db.group.create({
      data: {
        name: "Flat R", type: "home", currency: "INR", inviteCode: `rmflat-${stamp}`,
        members: {
          create: [
            { name: "Asha", accountId: aAcc, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, // started it: looks after it
            { name: "Sam", accountId: sAcc, claimedAt: new Date() },
            { name: "Ravi", accountId: rAcc, claimedAt: new Date() },
          ],
        },
      },
      include: { members: true },
    });
    gid = g.id;
    asha = g.members.find((m) => m.name === "Asha")!.id;
    sam = g.members.find((m) => m.name === "Sam")!.id;
    ravi = g.members.find((m) => m.name === "Ravi")!.id;
    expect((await setMemberLeft(gid, asha, ravi, true)).ok).toBe(true); // the admin removes Ravi (all square, so allowed)
  });
  afterAll(async () => {
    await db.invite.deleteMany({ where: { groupId: gid } });
    await db.group.delete({ where: { id: gid } }).catch(() => {});
    await db.account.deleteMany({ where: { id: { in: [aAcc, sAcc, rAcc] } } });
  });

  it("search: Sam sees Ravi as Removed with no Add; Asha (who looks after the group) may bring him back", async () => {
    const asSam = (await searchPeople({ [gid]: sam }, gid, "ravi"))[0];
    expect(asSam).toMatchObject({ name: "Ravi", removed: true, mayAdd: false, inGroup: false });
    const asAsha = (await searchPeople({ [gid]: asha }, gid, "ravi"))[0];
    expect(asAsha).toMatchObject({ name: "Ravi", removed: true, mayAdd: true, inGroup: false });
  });

  it("Sam adding Ravi from the search result is refused, and nothing changes", async () => {
    const r = await addRegistered(gid, sam, rAcc, origin);
    expect(r).toEqual({ ok: false, error: "Only the person who looks after the group can bring Ravi back." });
    expect(await raviRow()).toMatchObject({ removedById: asha });
    expect((await raviRow()).leftAt).not.toBeNull();
    expect((await raviRow()).removedAt).not.toBeNull();
    expect(await db.invite.count({ where: { groupId: gid } })).toBe(0);
  });

  it("Sam adding Ravi by email gets the usual quiet reply, and Ravi stays removed (no invitation, no new name)", async () => {
    const before = await db.member.count({ where: { groupId: gid } });
    const r = await inviteByEmail(gid, sam, em("ravi"), origin);
    expect(r.bad).toEqual([]);
    expect(r.people.map((p) => p.email)).toEqual([em("ravi")]);
    expect((await raviRow()).removedAt).not.toBeNull();
    expect((await raviRow()).leftAt).not.toBeNull();
    expect(await db.member.count({ where: { groupId: gid } })).toBe(before);
    expect(await db.invite.count({ where: { groupId: gid } })).toBe(0);
  });

  it("a half-written removal (removed, but 'left' empty) is still not an 'already in the group' for Sam", async () => {
    await db.member.update({ where: { id: ravi }, data: { leftAt: null } });
    const r = await addRegistered(gid, sam, rAcc, origin);
    expect(r).toEqual({ ok: false, error: "Only the person who looks after the group can bring Ravi back." });
    expect((await raviRow()).removedAt).not.toBeNull();
    // The screen lists him once, under Removed, never in the main list too.
    const { active, left, removed } = groupPeople(await db.member.findMany({ where: { groupId: gid } }));
    expect(active.map((m) => m.name).sort()).toEqual(["Asha", "Sam"]);
    expect(left).toEqual([]);
    expect(removed.map((m) => m.name)).toEqual(["Ravi"]);
    // Sam can't bring him back from People either.
    expect(await setMemberLeft(gid, sam, ravi, false)).toEqual({ ok: false, error: "Only the person who looks after this group can bring back someone they removed." });
  });

  it("Asha brings him back by search: leftAt, removedAt and removedById are all cleared; People lists him once", async () => {
    const r = await addRegistered(gid, asha, rAcc, origin);
    expect(r.ok && r.name).toBe("Ravi");
    expect(await raviRow()).toMatchObject({ leftAt: null, removedAt: null, removedById: "" });
    const { active, left, removed } = groupPeople(await db.member.findMany({ where: { groupId: gid } }));
    expect(active.map((m) => m.name).sort()).toEqual(["Asha", "Ravi", "Sam"]);
    expect([left.length, removed.length]).toEqual([0, 0]);
    expect(await db.member.count({ where: { groupId: gid, accountId: rAcc } })).toBe(1); // no second row
    expect(await db.invite.count({ where: { groupId: gid } })).toBe(0); // brought back as himself: no invitation needed
  });

  it("Asha brings him back by email too (removed again first); a repeat does nothing more", async () => {
    expect((await setMemberLeft(gid, asha, ravi, true)).ok).toBe(true);
    const r = await inviteByEmail(gid, asha, em("ravi"), origin);
    expect(r.people.map((p) => p.email)).toEqual([em("ravi")]);
    expect(await raviRow()).toMatchObject({ leftAt: null, removedAt: null, removedById: "" });
    const again = await inviteByEmail(gid, asha, em("ravi"), origin);
    expect(again.people.length).toBe(1);
    expect(await db.member.count({ where: { groupId: gid, accountId: rAcc } })).toBe(1);
  });

  it("setMember: bringing back a removed person whose 'left' mark is missing clears the removal (admin); a no-op change is still a no-op", async () => {
    expect((await setMemberLeft(gid, asha, ravi, true)).ok).toBe(true);
    await db.member.update({ where: { id: ravi }, data: { leftAt: null } }); // half-written
    const back = await setMember(gid, asha, ravi, { leftAt: null });
    expect(back.ok).toBe(true);
    expect(await raviRow()).toMatchObject({ leftAt: null, removedAt: null, removedById: "" });
    // Nothing to change now: ok, no new history line.
    const events = await db.groupEvent.count({ where: { groupId: gid } });
    expect(await setMember(gid, asha, ravi, { leftAt: null })).toEqual({ ok: true });
    expect(await db.groupEvent.count({ where: { groupId: gid } })).toBe(events);
  });
});
