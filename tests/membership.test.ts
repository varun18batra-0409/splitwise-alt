import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// "Joined" vs "pending", and what pending people don't get: the group's look-after role
// and phone notifications. (Passports, postcards, collections and search have their own tests.)

const sendNotification = vi.fn(async () => ({ statusCode: 201 }));
vi.mock("web-push", () => ({
  default: {
    sendNotification,
    generateVAPIDKeys: () => ({ publicKey: "BPublic", privateKey: "private" }),
  },
}));

const { db } = await import("@/lib/db");
const { isPending, JOINED } = await import("@/lib/membership");
const { pickAdmin, groupAdminId } = await import("@/lib/group-admin");
const { sendPushTo, sendEventPush } = await import("@/lib/push");

const d = new Date("2026-11-01T00:00:00Z");

describe("isPending", () => {
  it("added by someone else and never opened: pending; everything else: joined", () => {
    expect(isPending({ addedBy: "", seenAt: null })).toBe(false); // started it, joined by link, or took a name
    expect(isPending({ addedBy: "m1", seenAt: null })).toBe(true);
    expect(isPending({ addedBy: "m1", seenAt: d })).toBe(false); // opened the group since
    expect(isPending({ addedBy: "", seenAt: d })).toBe(false);
  });
  it("JOINED matches the same two cases", () => {
    expect(JOINED.OR).toEqual([{ addedBy: "" }, { seenAt: { not: null } }]);
  });
});

describe("pickAdmin skips pending people", () => {
  it("a force-added person with a claimedAt can't become the admin", () => {
    const rows = [
      { id: "creator", claimedAt: null, leftAt: d, addedBy: "", seenAt: null }, // started the group, has left
      { id: "forced", claimedAt: d, leftAt: null, addedBy: "creator", seenAt: null }, // put in, never opened
      { id: "joined", claimedAt: d, leftAt: null, addedBy: "creator", seenAt: d },
    ];
    expect(pickAdmin(rows)?.id).toBe("joined");
    // Without the pending row's problem: the older rule would have picked "forced".
    expect(pickAdmin(rows.slice(0, 2))).toBeUndefined();
  });
  it("rows without the new fields work as before", () => {
    expect(pickAdmin([{ id: "a", claimedAt: d, leftAt: d }, { id: "b", claimedAt: d, leftAt: null }])?.id).toBe("b");
  });
});

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let groupId = "";
const ids: Record<string, string> = {};
const endpoint = (name: string) => `https://push.example/${stamp}/${name}`;

beforeAll(async () => {
  const g = await db.group.create({
    data: {
      name: `Membership ${stamp}`,
      inviteCode: `mem-${stamp}`,
      members: {
        create: [
          { name: "Asha", claimedAt: d, createdAt: new Date("2026-11-01T00:00:00Z") },
          { name: "Ben", claimedAt: d, addedBy: "x", seenAt: d, createdAt: new Date("2026-11-01T00:00:01Z") },
          { name: "Pia", claimedAt: d, addedBy: "x", createdAt: new Date("2026-11-01T00:00:02Z") }, // pending
        ],
      },
    },
    include: { members: true },
  });
  groupId = g.id;
  for (const m of g.members) {
    ids[m.name] = m.id;
    await db.pushSubscription.create({ data: { memberId: m.id, endpoint: endpoint(m.name), p256dh: "p", auth: "a" } });
  }
});
afterAll(async () => {
  await db.group.deleteMany({ where: { id: groupId } });
});

describe("the group's admin comes from the database too", () => {
  it("is the first joined person, never the pending one", async () => {
    expect(await groupAdminId(groupId)).toBe(ids.Asha);
    // Asha leaves: Ben (joined) takes over, not Pia (pending).
    await db.member.update({ where: { id: ids.Asha }, data: { leftAt: d } });
    expect(await groupAdminId(groupId)).toBe(ids.Ben);
    await db.member.update({ where: { id: ids.Asha }, data: { leftAt: null } });
  });
});

describe("phone notifications skip pending people", () => {
  it("sendPushTo: Asha and Ben get it, Pia doesn't", async () => {
    sendNotification.mockClear();
    const sent = await sendPushTo([ids.Asha, ids.Ben, ids.Pia], { title: "t", body: "b", url: "/u", tag: `tag-${stamp}` });
    expect(sent).toBe(2);
    const to = sendNotification.mock.calls.map((c) => (c as unknown as [{ endpoint: string }])[0].endpoint).sort();
    expect(to).toEqual([endpoint("Asha"), endpoint("Ben")]);
  });

  it("a change in the group: everyone but the person who did it, and not Pia", async () => {
    const ev = await db.groupEvent.create({ data: { groupId, actorId: ids.Asha, kind: "expense_added", text: "added Tea" } });
    sendNotification.mockClear();
    expect(await sendEventPush(ev.id)).toBe(1);
    const to = sendNotification.mock.calls.map((c) => (c as unknown as [{ endpoint: string }])[0].endpoint);
    expect(to).toEqual([endpoint("Ben")]);
    // Once Pia opens the group she is included.
    await db.member.update({ where: { id: ids.Pia }, data: { seenAt: d } });
    sendNotification.mockClear();
    expect(await sendEventPush(ev.id)).toBe(2);
  });
});
