import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// SEQ-FEAT-01: the 30-day erase and Restore can't both win. The erase starts with a conditional write limited to groups that are
// STILL deleted before the cutoff; Restore is a conditional write limited to the 30-day window. The build step no longer erases.
const mocks = vi.hoisted(() => ({ del: vi.fn(async (..._a: unknown[]) => undefined) }));
vi.mock("@vercel/blob", () => ({ put: vi.fn(), del: mocks.del, get: vi.fn(async () => null) }));

const { db } = await import("@/lib/db");
const { eraseExpiredGroups, eraseGroups, restoreIfInWindow } = await import("@/lib/purge");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const DAY = 86_400_000;
const groupIds: string[] = [];
const saved = { VERCEL: process.env.VERCEL, TOKEN: process.env.BLOB_READ_WRITE_TOKEN };
let n = 0;

beforeAll(() => {
  process.env.VERCEL = "1";
  process.env.BLOB_READ_WRITE_TOKEN = "test-token";
});
afterAll(async () => {
  if (saved.VERCEL === undefined) delete process.env.VERCEL;
  else process.env.VERCEL = saved.VERCEL;
  if (saved.TOKEN === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = saved.TOKEN;
  await db.blobTrash.deleteMany({ where: { key: { contains: stamp } } });
  await db.paymentClaim.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.potGame.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});
beforeEach(() => {
  mocks.del.mockReset();
  mocks.del.mockRejectedValue(new Error("storage is down")); // so the keys stay on the to-delete list where the test can see them
});

async function group(daysAgoDeleted: number | null) {
  n++;
  const g = await db.group.create({
    data: {
      name: `PW ${stamp} ${n}`,
      inviteCode: `pw-${n}-${stamp}`,
      deletedAt: daysAgoDeleted === null ? null : new Date(Date.now() - daysAgoDeleted * DAY),
      members: { create: [{ name: "Ann" }, { name: "Ben" }] },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  return g;
}

describe("erasing groups deleted over 30 days ago", () => {
  it("an expired group with a game, a claim, a receipt and a photo leaves no rows; both file keys are queued", async () => {
    const g = await group(31);
    const [ann, ben] = g.members;
    const photoKey = `group/pw-${stamp}`;
    const receiptKey = `receipt/pw-${stamp}`;
    await db.groupPhoto.create({ data: { groupId: g.id, data: new Uint8Array(), blobKey: photoKey } });
    await db.receipt.create({ data: { groupId: g.id, data: new Uint8Array(), blobKey: receiptKey } });
    await db.potGame.create({ data: { groupId: g.id, name: "Friday", hostId: ann.id, players: JSON.stringify([ann.id, ben.id]) } });
    await db.paymentClaim.create({ data: { groupId: g.id, fromId: ann.id, toId: ben.id, amount: 5000 } });

    expect(await eraseExpiredGroups(new Date(), 1000)).toBeGreaterThanOrEqual(1);

    expect(await db.group.findUnique({ where: { id: g.id } })).toBeNull();
    expect(await db.member.count({ where: { groupId: g.id } })).toBe(0);
    expect(await db.potGame.count({ where: { groupId: g.id } })).toBe(0);
    expect(await db.paymentClaim.count({ where: { groupId: g.id } })).toBe(0);
    expect(await db.receipt.count({ where: { groupId: g.id } })).toBe(0);
    expect(await db.groupPhoto.count({ where: { groupId: g.id } })).toBe(0);
    const keys = (await db.blobTrash.findMany({ where: { key: { contains: stamp } } })).map((r) => r.key).sort();
    expect(keys).toEqual([photoKey, receiptKey].sort());
  });

  it("a group restored after the list was read is left alone by the erase", async () => {
    const g = await group(31);
    const cutoff = new Date(Date.now() - 30 * DAY);
    // The erase has read its list (this group is on it)... then somebody presses Restore... then the erase runs.
    const ids = [g.id];
    await db.group.update({ where: { id: g.id }, data: { deletedAt: null, deletedById: "" } });
    const erased = await eraseGroups(ids, { onlyDeletedBefore: cutoff });
    expect(erased).toBe(0);
    expect(await db.group.findUnique({ where: { id: g.id } })).not.toBeNull();
    expect(await db.member.count({ where: { groupId: g.id } })).toBe(2);
  });

  it("a group deleted 10 days ago, or never deleted, is not erased by the daily erase", async () => {
    const recent = await group(10);
    const live = await group(null);
    const erased = await eraseGroups([recent.id, live.id], { onlyDeletedBefore: new Date(Date.now() - 30 * DAY) });
    expect(erased).toBe(0);
    expect(await db.group.count({ where: { id: { in: [recent.id, live.id] } } })).toBe(2);
  });

  it("without the cutoff it still erases exactly the groups it is given (how the tests and admin tools clean up)", async () => {
    const live = await group(null);
    expect(await eraseGroups([live.id])).toBe(1);
    expect(await db.group.findUnique({ where: { id: live.id } })).toBeNull();
  });
});

describe("Restore is limited to the 30-day window", () => {
  it("brings back a group deleted 10 days ago, once", async () => {
    const g = await group(10);
    expect(await restoreIfInWindow(db, g.id)).toBe(true);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).deletedAt).toBeNull();
    expect(await restoreIfInWindow(db, g.id)).toBe(false); // already alive: nothing to do
  });

  it("refuses a group deleted 31 days ago", async () => {
    const g = await group(31);
    expect(await restoreIfInWindow(db, g.id)).toBe(false);
    expect((await db.group.findUniqueOrThrow({ where: { id: g.id } })).deletedAt).not.toBeNull();
  });

  it("a restore that gets in before the erase leaves the group alive; one that comes after it finds nothing", async () => {
    // Deleted 29.9 days ago: the window is open and the erase's cutoff (30 days) does not reach it. Either order, the group is whole.
    const g = await group(29.9);
    expect(await restoreIfInWindow(db, g.id)).toBe(true);
    expect(await eraseGroups([g.id], { onlyDeletedBefore: new Date(Date.now() - 30 * DAY) })).toBe(0);
    expect(await db.member.count({ where: { groupId: g.id } })).toBe(2);
    // Past the window the erase wins, and a later restore changes nothing.
    const old = await group(31);
    expect(await eraseGroups([old.id], { onlyDeletedBefore: new Date(Date.now() - 30 * DAY) })).toBe(1);
    expect(await restoreIfInWindow(db, old.id)).toBe(false);
  });
});

describe("the build step no longer erases groups", () => {
  it("prisma/upgrade-data.mjs has no group purge", () => {
    const src = readFileSync("prisma/upgrade-data.mjs", "utf8");
    expect(src).not.toMatch(/db\.group\.delete\b/);
    expect(src).not.toMatch(/deletedAt:\s*\{\s*lt:/);
  });
});
