import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// SEC-05: push addresses must be on one of the big push services (https, no login in the address, port 443 or none), with
// keys of the right size (p256dh: 65 bytes starting 0x04; auth: 16 bytes). The check runs again before every send; a bad
// stored row is not sent to, is deleted, and only its host is logged. web-push is a stand-in: nothing leaves this machine.
const mocks = vi.hoisted(() => ({ send: vi.fn(async (_s: { endpoint: string }, _p?: unknown, _o?: unknown) => ({})) }));
vi.mock("web-push", () => ({
  default: { sendNotification: mocks.send, generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }) },
}));

import { db } from "@/lib/db";
import { validSub } from "@/lib/push-subs";
import { sendEventPush, sendPushTo, sendPushToAccounts } from "@/lib/push";
import { copyPushTo } from "@/lib/invites";
import { GOOD_AUTH, GOOD_P256DH } from "./helpers/push-keys";

const keys = { p256dh: GOOD_P256DH, auth: GOOD_AUTH };
const ok = (endpoint: string) => validSub({ endpoint, keys });

describe("which push addresses are accepted", () => {
  it.each([
    "https://fcm.googleapis.com/fcm/send/abc123",
    "https://updates.push.services.mozilla.com/wpush/v2/abc123",
    "https://web.push.apple.com/QabC123",
    "https://db5p.notify.windows.com/?token=abc",
    "https://fcm.googleapis.com:443/fcm/send/abc",
  ])("accepts %s", (e) => {
    expect(ok(e)).toEqual({ endpoint: e, keys });
  });
  it.each([
    "http://fcm.googleapis.com/fcm/send/abc",
    "https://127.0.0.1:8443/internal",
    "https://localhost/x",
    "https://10.0.0.5/x",
    "https://[::1]/x",
    "https://u:p@fcm.googleapis.com/x",
    "https://fcm.googleapis.com:8443/x",
    "https://fcm.googleapis.com.evil.com/x",
    "https://evilnotify.windows.com/x",
    "https://a.b.notify.windows.com/x",
    "not a url",
    "",
  ])("refuses %s", (e) => {
    expect(ok(e)).toBeNull();
  });
  it("refuses keys of the wrong size or kind", () => {
    const e = "https://fcm.googleapis.com/fcm/send/abc";
    const b64 = (n: number, first = 4) => Buffer.concat([Buffer.from([first]), Buffer.alloc(n - 1, 7)]).toString("base64url");
    expect(validSub({ endpoint: e, keys: { p256dh: b64(65), auth: GOOD_AUTH } })).not.toBeNull();
    expect(validSub({ endpoint: e, keys: { p256dh: b64(64), auth: GOOD_AUTH } })).toBeNull(); // 64 bytes
    expect(validSub({ endpoint: e, keys: { p256dh: b64(66), auth: GOOD_AUTH } })).toBeNull();
    expect(validSub({ endpoint: e, keys: { p256dh: b64(65, 3), auth: GOOD_AUTH } })).toBeNull(); // not starting 0x04
    expect(validSub({ endpoint: e, keys: { p256dh: GOOD_P256DH, auth: Buffer.alloc(15, 1).toString("base64url") } })).toBeNull();
    expect(validSub({ endpoint: e, keys: { p256dh: GOOD_P256DH, auth: Buffer.alloc(17, 1).toString("base64url") } })).toBeNull();
    expect(validSub({ endpoint: e, keys: { p256dh: "p1", auth: "a1" } })).toBeNull();
  });
});

describe("a bad stored row is never sent to, and is deleted", () => {
  const stamp = Date.now();
  let gid = "";
  const m: Record<string, string> = {};
  const rows = {
    good: `https://fcm.googleapis.com/fcm/send/good-${stamp}`,
    internal: `https://127.0.0.1:8443/internal/secret-token-${stamp}`,
    shortKey: `https://updates.push.services.mozilla.com/wpush/short-${stamp}`,
  };
  const sentTo = () => mocks.send.mock.calls.map((c) => c[0].endpoint);

  beforeAll(async () => {
    const g = await db.group.create({ data: { name: "Push allow", currency: "INR", inviteCode: `pa-${stamp}` } });
    gid = g.id;
    for (const k of ["good", "internal", "shortKey"]) {
      const mem = await db.member.create({ data: { groupId: gid, name: k } });
      m[k] = mem.id;
      const bad = k === "shortKey" ? { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(63, 7)]).toString("base64url"), auth: GOOD_AUTH } : keys;
      await db.pushSubscription.create({ data: { memberId: mem.id, endpoint: rows[k as keyof typeof rows], ...bad } });
    }
  });
  beforeEach(() => mocks.send.mockClear());
  afterAll(async () => {
    await db.group.delete({ where: { id: gid } }).catch(() => {});
  });

  it("sendPushTo skips and deletes them, and logs only the host", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const n = await sendPushTo([m.good, m.internal, m.shortKey], { title: "t", body: "b", url: "/", tag: "x" }, "expenses.added");
    expect(n).toBe(1);
    expect(sentTo()).toEqual([rows.good]);
    expect(await db.pushSubscription.count({ where: { endpoint: rows.internal } })).toBe(0);
    expect(await db.pushSubscription.count({ where: { endpoint: rows.shortKey } })).toBe(0);
    expect(await db.pushSubscription.count({ where: { endpoint: rows.good } })).toBe(1);
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged).toContain("127.0.0.1");
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("8443/internal");
    warn.mockRestore();
  });

  it("group changes and account messages check again too", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // A bad row that slipped in again (e.g. copied before this rule).
    await db.pushSubscription.create({ data: { memberId: m.internal, endpoint: rows.internal, ...keys } });
    const actor = await db.member.create({ data: { groupId: gid, name: "actor" } });
    const ev = await db.groupEvent.create({ data: { groupId: gid, actorId: actor.id, kind: "expense_added", text: "added Lunch (₹300)" } });
    await sendEventPush(ev.id);
    expect(sentTo()).toEqual([rows.good]);
    expect(await db.pushSubscription.count({ where: { endpoint: rows.internal } })).toBe(0);
    mocks.send.mockClear();
    const acc = await db.account.create({ data: { email: `pa-${stamp}@example.com`, name: "Pa" } });
    await db.member.update({ where: { id: m.internal }, data: { accountId: acc.id } });
    await db.pushSubscription.create({ data: { memberId: m.internal, endpoint: rows.internal, ...keys } });
    expect(await sendPushToAccounts([acc.id], { title: "t", body: "b", url: "/", tag: "c" }, "payments.collect")).toBe(0);
    expect(sentTo()).toEqual([]);
    expect(await db.pushSubscription.count({ where: { endpoint: rows.internal } })).toBe(0);
    await db.account.delete({ where: { id: acc.id } });
    warn.mockRestore();
  });

  it("copying an account's phones to a new group never copies a bad address", async () => {
    const acc = await db.account.create({ data: { email: `pa2-${stamp}@example.com`, name: "Pb" } });
    const a = await db.member.create({ data: { groupId: gid, name: "copyA", accountId: acc.id } });
    const b = await db.member.create({ data: { groupId: gid, name: "copyB", accountId: acc.id } });
    await db.pushSubscription.createMany({ data: [{ memberId: a.id, endpoint: rows.good, ...keys }, { memberId: a.id, endpoint: rows.internal, ...keys }] });
    await copyPushTo(acc.id, b.id);
    const copied = (await db.pushSubscription.findMany({ where: { memberId: b.id } })).map((r) => r.endpoint);
    expect(copied).toEqual([rows.good]);
    await db.account.delete({ where: { id: acc.id } });
  });
});
