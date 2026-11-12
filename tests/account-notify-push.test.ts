import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Phone messages obey the account's "Notifications & email" choices AND the group's own settings.
// web-push is replaced by a stand-in that records who was sent to; nothing leaves this machine.
const mocks = vi.hoisted(() => ({
  send: vi.fn(async (_s: { endpoint: string }, _p?: unknown, _o?: unknown) => ({})),
}));
vi.mock("web-push", () => ({
  default: { sendNotification: mocks.send, generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }) },
}));

import { db } from "@/lib/db";
import { GOOD_AUTH, GOOD_P256DH, goodEndpoint } from "./helpers/push-keys";
import { sendEventPush, sendPushTo, sendPushToAccounts } from "@/lib/push";

const stamp = Date.now();
const ep = (n: string) => goodEndpoint(`${n}-${stamp}`);
let gid = "";
let hadKeys = true;
const m: Record<string, string> = {};
const a: Record<string, string> = {};

async function person(key: string, prefs: string, notify = "") {
  const acc = await db.account.create({ data: { email: `${key}-${stamp}@example.com`, name: key, notifyPrefs: prefs } });
  a[key] = acc.id;
  const mem = await db.member.create({ data: { groupId: gid, name: key, accountId: acc.id, notify } });
  m[key] = mem.id;
  await db.pushSubscription.create({ data: { memberId: mem.id, endpoint: ep(key), p256dh: GOOD_P256DH, auth: GOOD_AUTH } });
}
const sentTo = () => new Set(mocks.send.mock.calls.map((c) => c[0].endpoint));

beforeAll(async () => {
  hadKeys = Boolean(await db.appSetting.findUnique({ where: { key: "vapid" } }));
  const g = await db.group.create({ data: { name: "Push prefs", currency: "INR", inviteCode: `pp-${stamp}` } });
  gid = g.id;
  await person("actor", "");
  await person("open", ""); // nothing switched off
  await person("noAdded", '{"push":{"expenses.added":false}}'); // one item off
  await person("noExpenses", '{"push":{"expenses":false,"expenses.added":true}}'); // category off beats item on
  await person("groupMuted", "", '{"expenses":false}'); // the group says no, the account says yes
  await person("bothOff", '{"push":{"expenses.added":false}}', '{"expenses":false}');
  // A phone-only member: no account at all.
  const plain = await db.member.create({ data: { groupId: gid, name: "plain" } });
  m.plain = plain.id;
  await db.pushSubscription.create({ data: { memberId: plain.id, endpoint: ep("plain"), p256dh: GOOD_P256DH, auth: GOOD_AUTH } });
});
beforeEach(() => mocks.send.mockClear());
afterAll(async () => {
  if (!hadKeys) await db.appSetting.deleteMany({ where: { key: "vapid" } }); // the stand-in keys made here
  await db.group.delete({ where: { id: gid } }).catch(() => {});
  await db.account.deleteMany({ where: { email: { contains: String(stamp) } } });
});

describe("group changes (sendEventPush)", () => {
  it("an added expense reaches only people who allow it in both places; phone-only members still get it", async () => {
    const ev = await db.groupEvent.create({ data: { groupId: gid, actorId: m.actor, kind: "expense_added", text: "added Lunch (₹300)" } });
    await sendEventPush(ev.id);
    expect(sentTo()).toEqual(new Set([ep("open"), ep("plain")]));
  });
  it("an edited expense is a different item: only the category-off person misses it", async () => {
    const ev = await db.groupEvent.create({ data: { groupId: gid, actorId: m.actor, kind: "expense_edited", text: "changed Lunch" } });
    await sendEventPush(ev.id);
    // noExpenses: category off. groupMuted: the group's "expenses" switch is about new expenses; edits are a separate group switch, so still on.
    expect(sentTo()).toEqual(new Set([ep("open"), ep("noAdded"), ep("groupMuted"), ep("bothOff"), ep("plain")]));
  });
});

describe("messages to particular people (sendPushTo)", () => {
  it("honours the item, and a category off blocks all its items", async () => {
    const ids = [m.open, m.noAdded, m.noExpenses, m.plain];
    await sendPushTo(ids, { title: "t", body: "b", url: "/", tag: "x" }, "expenses.reactions");
    expect(sentTo()).toEqual(new Set([ep("open"), ep("noAdded"), ep("plain")]));
    mocks.send.mockClear();
    await sendPushTo(ids, { title: "t", body: "b", url: "/", tag: "y" }, "expenses.added");
    expect(sentTo()).toEqual(new Set([ep("open"), ep("plain")]));
  });
});

describe("messages to accounts (collections, postcards…)", () => {
  it("honours the account's choice on top of the collections switch", async () => {
    await db.account.update({ where: { id: a.open }, data: { notifyPrefs: '{"push":{"payments":false}}' } });
    await sendPushToAccounts([a.open, a.noAdded], { title: "t", body: "b", url: "/", tag: "c" }, "payments.collect");
    expect(sentTo()).toEqual(new Set([ep("noAdded")]));
    mocks.send.mockClear();
    await db.account.update({ where: { id: a.noAdded }, data: { collectPush: false } });
    await sendPushToAccounts([a.noAdded], { title: "t", body: "b", url: "/", tag: "d" }, "payments.collect");
    expect(sentTo().size).toBe(0);
  });
});
