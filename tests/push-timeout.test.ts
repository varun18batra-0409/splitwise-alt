import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// R7: every phone send carries the 5 second limit, from all three senders. web-push is a stand-in: nothing leaves this machine.
const mocks = vi.hoisted(() => ({ send: vi.fn(async (_s: { endpoint: string }, _p?: unknown, _o?: { timeout?: number; TTL?: number }) => ({})) }));
vi.mock("web-push", () => ({ default: { sendNotification: mocks.send, generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }) } }));

import { db } from "@/lib/db";
import { PUSH_TIMEOUT_MS, sendEventPush, sendPushTo, sendPushToAccounts } from "@/lib/push";
import { GOOD_AUTH, GOOD_P256DH } from "./helpers/push-keys";

const stamp = Date.now();
const endpoint = `https://fcm.googleapis.com/fcm/send/to-${stamp}`;
let gid = "";
let memberId = "";
let accountId = "";
const limits = () => mocks.send.mock.calls.map((c) => c[2]?.timeout);

beforeAll(async () => {
  gid = (await db.group.create({ data: { name: "Push limit", currency: "INR", inviteCode: `pt-${stamp}` } })).id;
  const acc = await db.account.create({ data: { email: `pt-${stamp}@example.com`, name: "Pt" } });
  accountId = acc.id;
  memberId = (await db.member.create({ data: { groupId: gid, name: "Phone", accountId } })).id;
  await db.pushSubscription.create({ data: { memberId, endpoint, p256dh: GOOD_P256DH, auth: GOOD_AUTH } });
});
beforeEach(() => mocks.send.mockClear());
afterAll(async () => {
  await db.group.delete({ where: { id: gid } }).catch(() => {});
  await db.account.delete({ where: { id: accountId } }).catch(() => {});
});

describe("push sends have a 5 second limit", () => {
  it("the limit is 5000 ms", () => expect(PUSH_TIMEOUT_MS).toBe(5000));
  it("sendPushTo", async () => {
    expect(await sendPushTo([memberId], { title: "t", body: "b", url: "/", tag: "x" }, "expenses.added")).toBe(1);
    expect(limits()).toEqual([5000]);
  });
  it("the group-change sender", async () => {
    const actor = await db.member.create({ data: { groupId: gid, name: "actor" } });
    const ev = await db.groupEvent.create({ data: { groupId: gid, actorId: actor.id, kind: "expense_added", text: "added Lunch (₹300)" } });
    await sendEventPush(ev.id);
    expect(limits()).toEqual([5000]);
  });
  it("the account sender", async () => {
    expect(await sendPushToAccounts([accountId], { title: "t", body: "b", url: "/", tag: "c" }, "payments.collect")).toBe(1);
    expect(limits()).toEqual([5000]);
  });
});
