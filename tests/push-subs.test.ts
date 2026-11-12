import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { savePushFor, validSub } from "@/lib/push-subs";
import { GOOD_AUTH, GOOD_P256DH, goodEndpoint } from "./helpers/push-keys";

// Opening the app keeps notifications on for every group, without a write per group each time.
const P2 = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 5)]).toString("base64url");
const A2 = Buffer.alloc(16, 3).toString("base64url");
describe("phone notifications for all my groups", () => {
  const ids: string[] = [];
  const ms: Record<string, string> = {};
  const sub = { endpoint: goodEndpoint(`${Date.now()}`), keys: { p256dh: GOOD_P256DH, auth: GOOD_AUTH } };
  beforeAll(async () => {
    for (let i = 0; i < 3; i++) {
      const g = await db.group.create({ data: { name: `Push ${i}`, currency: "INR", inviteCode: `push-${Date.now()}-${i}`, members: { create: [{ name: "Me" }] } }, include: { members: true } });
      ids.push(g.id);
      ms[g.id] = g.members[0].id;
    }
  });
  afterAll(async () => {
    await db.group.deleteMany({ where: { id: { in: ids } } });
  });

  it("adds the missing groups once, updates changed keys, and does nothing when all is current", async () => {
    expect(await savePushFor(ms, sub)).toEqual({ ok: true, groups: 3, added: 3 });
    expect(await savePushFor(ms, sub)).toEqual({ ok: true, groups: 3, added: 0 });
    await savePushFor(ms, { ...sub, keys: { p256dh: P2, auth: A2 } });
    const rows = await db.pushSubscription.findMany({ where: { endpoint: sub.endpoint } });
    expect(rows.length).toBe(3);
    expect(rows.every((r) => r.p256dh === P2 && r.auth === A2)).toBe(true);
  });

  it("ignores someone else's member ids in a forged list", async () => {
    expect(await savePushFor({ [ids[0]]: ms[ids[1]] }, sub)).toEqual({ ok: true, groups: 0, added: 0 });
  });

  it("refuses anything that isn't a real push subscription", () => {
    expect(validSub({ endpoint: "http://x", keys: { p256dh: "a", auth: "b" } })).toBeNull();
    expect(validSub(null)).toBeNull();
    expect(validSub(sub)).toEqual(sub);
  });
});
