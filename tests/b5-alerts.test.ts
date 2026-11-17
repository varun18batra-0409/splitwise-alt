import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// B5 part A, with a database (a throwaway copy only; web-push is a stand-in, nothing leaves this machine):
//  AS-10  the collections switch mutes only collections and passport moments
//  AS-17  inviting an existing account's email to a name-only member writes a token and a "group_invite" card
//  MB-9   a person you share two groups with is listed under both, but is one person to send to
const mocks = vi.hoisted(() => ({ send: vi.fn(async (_s: { endpoint: string }, _p?: unknown, _o?: unknown) => ({})) }));
vi.mock("web-push", () => ({ default: { sendNotification: mocks.send, generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }) } }));

import { db } from "@/lib/db";
import { GOOD_AUTH, GOOD_P256DH, goodEndpoint } from "./helpers/push-keys";
import { sendPushToAccounts } from "@/lib/push";
import { noteItem } from "@/lib/account-notify";
import { inviteToClaim } from "@/lib/invites";
import { loadInvitations } from "@/lib/invitations";
import { canSendTo, postcardPeople } from "@/lib/postcards/people";

const stamp = Date.now();
const groupIds: string[] = [];
let hadKeys = true;

beforeAll(async () => {
  hadKeys = Boolean(await db.appSetting.findUnique({ where: { key: "vapid" } }));
});
beforeEach(() => mocks.send.mockClear());
afterAll(async () => {
  if (!hadKeys) await db.appSetting.deleteMany({ where: { key: "vapid" } });
  await db.accountNote.deleteMany({ where: { account: { email: { contains: String(stamp) } } } });
  await db.invite.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.groupEvent.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.member.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { email: { contains: String(stamp) } } });
});

async function group(name: string, type = "trip") {
  const g = await db.group.create({ data: { name, type, currency: "INR", inviteCode: `b5-${name}-${stamp}-${Math.random()}` } });
  groupIds.push(g.id);
  return g;
}
async function account(key: string, extra: Record<string, unknown> = {}) {
  return db.account.create({ data: { email: `${key}-${stamp}@example.com`, name: key, ...extra } });
}

describe("AS-10: the collections switch", () => {
  it("off: group invites and postcards still arrive; collection and passport messages don't", async () => {
    const g = await group("Switch");
    const acc = await account("switch", { collectPush: false });
    const mem = await db.member.create({ data: { groupId: g.id, name: "Switch", accountId: acc.id } });
    await db.pushSubscription.create({ data: { memberId: mem.id, endpoint: goodEndpoint(`sw-${stamp}`), p256dh: GOOD_P256DH, auth: GOOD_AUTH } });
    const p = { title: "t", body: "b", url: "/", tag: "x" };

    // The note kinds map to these items, so the test goes through the real mapping.
    expect(await sendPushToAccounts([acc.id], p, noteItem("group_invite"))).toBe(1);
    expect(await sendPushToAccounts([acc.id], p, noteItem("postcard"))).toBe(1);
    expect(await sendPushToAccounts([acc.id], p, noteItem("collect_reminder"))).toBe(0);
    expect(await sendPushToAccounts([acc.id], p, noteItem("passport_mark"))).toBe(0);
  });
  it("on: all four arrive", async () => {
    const g = await group("SwitchOn");
    const acc = await account("switchon", { collectPush: true });
    const mem = await db.member.create({ data: { groupId: g.id, name: "On", accountId: acc.id } });
    await db.pushSubscription.create({ data: { memberId: mem.id, endpoint: goodEndpoint(`so-${stamp}`), p256dh: GOOD_P256DH, auth: GOOD_AUTH } });
    const p = { title: "t", body: "b", url: "/", tag: "x" };
    for (const kind of ["group_invite", "postcard", "collect_reminder", "passport_mark"]) expect(await sendPushToAccounts([acc.id], p, noteItem(kind))).toBe(1);
  });
});

describe("AS-17: an email invite for an existing name", () => {
  async function setup(key: string) {
    const g = await group(`Claim ${key}`);
    const inviterAcc = await account(`inviter${key}`);
    const inviter = await db.member.create({ data: { groupId: g.id, name: "Inviter", accountId: inviterAcc.id } });
    const kiran = await db.member.create({ data: { groupId: g.id, name: "Kiran" } }); // a name only
    const kiranAcc = await account(`kiran${key}`);
    return { g, inviterAcc, inviter, kiran, kiranAcc };
  }
  it("writes a token, shows a Join card, writes one group_invite note, and keeps the token when asked again", async () => {
    const s = await setup("a");
    const r = await inviteToClaim(s.g.id, s.inviter.id, s.kiran.id, s.kiranAcc.email, "https://loopin.test");
    expect(r.ok).toBe(true);
    const inv = await db.invite.findUnique({ where: { groupId_email: { groupId: s.g.id, email: s.kiranAcc.email } } });
    expect(inv?.token).toBeTruthy();
    expect(inv?.memberId).toBe(s.kiran.id);
    const cards = await loadInvitations({ id: s.kiranAcc.id, name: s.kiranAcc.name, email: s.kiranAcc.email });
    expect(cards.map((c) => c.groupId)).toContain(s.g.id);
    expect(await db.accountNote.count({ where: { accountId: s.kiranAcc.id, kind: "group_invite" } })).toBe(1);
    await inviteToClaim(s.g.id, s.inviter.id, s.kiran.id, s.kiranAcc.email, "https://loopin.test");
    const again = await db.invite.findUnique({ where: { groupId_email: { groupId: s.g.id, email: s.kiranAcc.email } } });
    expect(again?.token).toBe(inv?.token);
  });
  it("if Kiran blocked the inviter: no note and no Join card", async () => {
    const s = await setup("b");
    await db.block.create({ data: { blockerId: s.kiranAcc.id, blockedId: s.inviterAcc.id } });
    await inviteToClaim(s.g.id, s.inviter.id, s.kiran.id, s.kiranAcc.email, "https://loopin.test");
    expect(await db.accountNote.count({ where: { accountId: s.kiranAcc.id, kind: "group_invite" } })).toBe(0);
    const cards = await loadInvitations({ id: s.kiranAcc.id, name: s.kiranAcc.name, email: s.kiranAcc.email });
    expect(cards).toHaveLength(0);
    await db.block.deleteMany({ where: { blockerId: s.kiranAcc.id } });
  });
});

describe("MB-9: postcard people", () => {
  it("Asha is listed under both shared groups, and is one person to send to", async () => {
    const me = await account("me");
    const asha = await account("asha");
    for (const name of ["Goa", "Manali"]) {
      const g = await group(`PC ${name}`);
      await db.member.create({ data: { groupId: g.id, name: "Me", accountId: me.id } });
      await db.member.create({ data: { groupId: g.id, name: "Asha", accountId: asha.id } });
    }
    const groups = (await postcardPeople(me.id)).filter((g) => g.name.startsWith("PC "));
    expect(groups).toHaveLength(2);
    for (const g of groups) expect(g.people.map((p) => p.id)).toEqual([asha.id]);
    expect((await canSendTo(me.id, [asha.id, asha.id])).size).toBe(1);
  });
});
