import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// SB-3 with a database (a throwaway copy only; web-push is a stand-in). The day-end trip message arrives in each person's evening,
// or the next morning. Bali trip, 15-20 Nov 2026, rupees. Three people:
//   Ira: no zone yet (old path: India day, evening run only)   Bina: Asia/Makassar (UTC+8)   Leo: Europe/London (UTC+0)
// Expenses: Bina paid 300000 at 2026-11-17 04:00Z; Ira paid 120000 at 06:00Z. Together 420000 paise = 4200 rupees.
// 300000 / 420000 = 0.714, at least 0.6, so the line names Bina. 17 Nov is day 3 of 6.
const mocks = vi.hoisted(() => ({ send: vi.fn(async (_s: { endpoint: string }, _p?: unknown, _o?: unknown) => ({})) }));
vi.mock("web-push", () => ({ default: { sendNotification: mocks.send, generateVAPIDKeys: () => ({ publicKey: "pub", privateKey: "priv" }) } }));

import { db } from "@/lib/db";
import { GOOD_AUTH, GOOD_P256DH, goodEndpoint } from "./helpers/push-keys";
import { sendDayPulse } from "@/lib/countdown-db";

const stamp = Date.now();
let gid = "";
let hadKeys = true;
const ep = (n: string) => goodEndpoint(`${n}-${stamp}`);
const bodies = () => mocks.send.mock.calls.map((c) => ({ endpoint: c[0].endpoint, body: (JSON.parse(String(c[1])) as { body: string }).body }));
const TEXT = "Day 3 in Bali: ₹4,200 gone, Bina’s carrying the team 😅";

async function person(name: string, zone: string) {
  const acc = await db.account.create({ data: { email: `${name}-${stamp}@example.com`, name, timeZone: zone } });
  const mem = await db.member.create({ data: { groupId: gid, name, accountId: acc.id } });
  await db.pushSubscription.create({ data: { memberId: mem.id, endpoint: ep(name), p256dh: GOOD_P256DH, auth: GOOD_AUTH } });
  return mem.id;
}

beforeAll(async () => {
  hadKeys = Boolean(await db.appSetting.findUnique({ where: { key: "vapid" } }));
  // The switch-over moment is long past, so old records never count as "before it".
  await db.notifyLog.deleteMany({ where: { key: "zones-live" } });
  await db.notifyLog.create({ data: { key: "zones-live", state: "done", createdAt: new Date("2026-01-01T00:00:00Z") } });
  const g = await db.group.create({ data: { name: "Bali trip", type: "trip", currency: "INR", tripStart: "2026-11-15", tripEnd: "2026-11-20", inviteCode: `pulse-${stamp}` } });
  gid = g.id;
  const ira = await person("Ira", "");
  const bina = await person("Bina", "Asia/Makassar");
  await person("Leo", "Europe/London");
  await db.expense.create({ data: { groupId: gid, description: "Boat", amount: 300000, splitType: "equal", paidById: bina, createdAt: new Date("2026-11-17T04:00:00Z") } });
  await db.expense.create({ data: { groupId: gid, description: "Lunch", amount: 120000, splitType: "equal", paidById: ira, createdAt: new Date("2026-11-17T06:00:00Z") } });
});
beforeEach(() => mocks.send.mockClear());
afterAll(async () => {
  if (!hadKeys) await db.appSetting.deleteMany({ where: { key: "vapid" } });
  await db.notifyLog.deleteMany({ where: { key: { startsWith: `pulse:${gid}` } } });
  await db.expense.deleteMany({ where: { groupId: gid } });
  await db.member.deleteMany({ where: { groupId: gid } });
  await db.group.deleteMany({ where: { id: gid } });
  await db.account.deleteMany({ where: { email: { contains: String(stamp) } } });
});

describe("SB-3: the day-end trip message", () => {
  it("evening run (16:00Z 17 Nov): Ira and Leo get it; Bina (00:00 for her) does not", async () => {
    await sendDayPulse(new Date("2026-11-17T16:00:00Z"), () => false, { run: "evening" });
    expect(bodies().filter((b) => b.body === TEXT).map((b) => b.endpoint).sort()).toEqual([ep("Ira"), ep("Leo")].sort());
    expect(bodies()).toHaveLength(2);
  });
  it("morning run (00:30Z 18 Nov): Bina gets her 17 Nov; Ira and Leo get nothing", async () => {
    await sendDayPulse(new Date("2026-11-18T00:30:00Z"), () => false, { run: "morning" });
    expect(bodies()).toEqual([{ endpoint: ep("Bina"), body: TEXT }]);
  });
  it("running both again sends nothing new: one each in total", async () => {
    await sendDayPulse(new Date("2026-11-17T16:00:00Z"), () => false, { run: "evening" });
    await sendDayPulse(new Date("2026-11-18T00:30:00Z"), () => false, { run: "morning" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
