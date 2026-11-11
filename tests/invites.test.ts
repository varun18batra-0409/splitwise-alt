import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addRegistered, freeName, inviteByEmail, searchPeople } from "@/lib/invites";

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
    expect(inv.token.startsWith(`${m.id}.`)).toBe(true);
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
      expect(r.people.length, k).toBe(1);
      expect(r.people[0].email, k).toBe(cases[k as keyof typeof cases]);
      // The name comes from the email only (never from the account), so it says nothing about who has one.
      expect(r.people[0].name, k).toMatch(/^[A-Z][a-z]+ \d+$/);
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
