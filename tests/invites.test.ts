import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addRegistered, freeName, inviteByEmail, searchPeople } from "@/lib/invites";

// Adding people: only real (signed-up) people can be added directly; everyone
// else gets an invitation. Name search only finds people you already know.

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

  it("finds friends by name, but strangers only by their exact email", async () => {
    const ms = { [g1]: meG1, [g2]: meG2 };
    expect((await searchPeople(ms, g2, "joe")).map((f) => f.name)).toEqual(["Joey"]);
    expect(await searchPeople(ms, g2, "sheld")).toEqual([]); // not someone I know
    const exact = await searchPeople(ms, g2, mail("sheldon"));
    expect(exact.map((f) => [f.name, f.known])).toEqual([["Sheldon", false]]);
    expect(await searchPeople(ms, g2, "chandler")).toEqual([]); // never suggests yourself
  });

  it("adds someone on Loopin straight away, with a notification and an email", async () => {
    const r = await addRegistered(g2, meG2, joey, "https://loopin.test");
    expect(r.ok && r.name).toBe("Joey");
    const m = await db.member.findFirst({ where: { groupId: g2, accountId: joey } });
    expect(m?.claimedAt).not.toBeNull();
    const ev = await db.groupEvent.findFirst({ where: { groupId: g2, kind: "members_added" } });
    expect(ev?.text).toBe("added Joey to the group");
    expect(await db.outbox.count({ where: { to: mail("joey"), subject: { contains: "added you to Euro trip" } } })).toBe(1);
    const again = await addRegistered(g2, meG2, joey, "https://loopin.test");
    expect(again).toEqual({ ok: false, error: "Joey is already in this group." });
    const ms = { [g1]: meG1, [g2]: meG2 };
    expect((await searchPeople(ms, g2, "joe"))[0].inGroup).toBe(true);
  });

  it("emails an invitation to people not on Loopin; they are NOT members until they join", async () => {
    const r = await inviteByEmail(g2, meG2, `${mail("circuit")}, not-an-email, ${mail("rancho")}`, "https://loopin.test");
    expect(r.invited).toEqual([mail("circuit")]);
    expect(r.added).toEqual(["Rancho"]); // already on Loopin: added directly
    expect(r.bad).toEqual(["not-an-email"]);
    expect(await db.member.count({ where: { groupId: g2 } })).toBe(3); // Chandler, Joey, Rancho
    expect(await db.invite.count({ where: { groupId: g2, email: mail("circuit"), acceptedAt: null } })).toBe(1);
    const sent = await db.outbox.findFirst({ where: { to: mail("circuit") } });
    expect(sent?.text).toContain(`/join/euro-${stamp}?e=`);
  });

  it("says so when an invitation email couldn't be sent (instead of claiming it went)", async () => {
    const before = process.env.MAIL_OUTBOX;
    process.env.MAIL_OUTBOX = "0"; // no mail set up in tests → sending fails
    try {
      const r = await inviteByEmail(g2, meG2, mail("nomail"), "https://loopin.test");
      expect(r.invited).toEqual([]);
      expect(r.bad[0]).toContain(mail("nomail"));
      expect(r.bad[0]).toContain("share the invite link");
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
