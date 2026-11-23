import { afterAll, describe, expect, it, vi } from "vitest";

// G36: blocking is all-or-nothing. The block, the note that lets it survive a re-signup, and the end of "Want to go" sharing are one
// transaction; so are unblock and its note. A failure in the middle leaves nothing half done, and a retry works. Throwaway database only.

const flaky = vi.hoisted(() => ({ failMark: false, failUnmark: false }));
vi.mock("@/lib/block-marks", async (orig) => {
  const real = await orig<typeof import("@/lib/block-marks")>();
  return {
    ...real,
    markBlock: async (...a: Parameters<typeof real.markBlock>) => {
      if (flaky.failMark) throw new Error("database busy");
      return real.markBlock(...a);
    },
    unmarkBlock: async (...a: Parameters<typeof real.unmarkBlock>) => {
      if (flaky.failUnmark) throw new Error("database busy");
      return real.unmarkBlock(...a);
    },
  };
});

const { db } = await import("@/lib/db");
const { blockAccount, unblockAccount, hasBlocked } = await import("@/lib/blocks");
const { emailFingerprint } = await import("@/lib/fingerprint");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const accountIds: string[] = [];
const markKeys: string[] = [];
afterAll(async () => {
  await db.appSetting.deleteMany({ where: { key: { in: markKeys } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } }); // blocks and shares go with the accounts
});

async function pair() {
  const a = await db.account.create({ data: { email: `b8-a-${stamp}-${accountIds.length}@example.test`, name: "Asha" } });
  const b = await db.account.create({ data: { email: `b8-b-${stamp}-${accountIds.length}@example.test`, name: "Ben" } });
  accountIds.push(a.id, b.id);
  const key = `blockfp:${emailFingerprint("block", b.email)}:${a.id}`;
  markKeys.push(key);
  return { a, b, key };
}

describe("blocking and unblocking are all-or-nothing", () => {
  it("a failure while making the note: no block row, no shares deleted; the retry succeeds and does everything", async () => {
    const { a, b, key } = await pair();
    // Two shares of "Want to go" lists, one each way.
    await db.wishShare.createMany({ data: [{ ownerId: a.id, friendId: b.id, country: "*" }, { ownerId: b.id, friendId: a.id, country: "JP" }] });

    flaky.failMark = true;
    await expect(blockAccount(a.id, b.id)).rejects.toThrow("database busy");
    flaky.failMark = false;
    expect(await db.block.count({ where: { blockerId: a.id, blockedId: b.id } })).toBe(0);
    expect(await hasBlocked(a.id, b.id)).toBe(false);
    expect(await db.wishShare.count({ where: { OR: [{ ownerId: a.id }, { ownerId: b.id }] } })).toBe(2); // both shares still there
    expect(await db.appSetting.count({ where: { key } })).toBe(0);

    expect(await blockAccount(a.id, b.id)).toBe(true); // retry
    expect(await db.block.count({ where: { blockerId: a.id, blockedId: b.id } })).toBe(1);
    expect(await db.appSetting.count({ where: { key } })).toBe(1);
    expect(await db.wishShare.count({ where: { OR: [{ ownerId: a.id }, { ownerId: b.id }] } })).toBe(0);
  });

  it("a failure while removing the note on unblock: the block stays, and the retry removes both", async () => {
    const { a, b, key } = await pair();
    expect(await blockAccount(a.id, b.id)).toBe(true);
    flaky.failUnmark = true;
    await expect(unblockAccount(a.id, b.id)).rejects.toThrow("database busy");
    flaky.failUnmark = false;
    expect(await db.block.count({ where: { blockerId: a.id, blockedId: b.id } })).toBe(1); // still blocked
    expect(await db.appSetting.count({ where: { key } })).toBe(1);

    await unblockAccount(a.id, b.id);
    expect(await db.block.count({ where: { blockerId: a.id, blockedId: b.id } })).toBe(0);
    expect(await db.appSetting.count({ where: { key } })).toBe(0);
  });

  it("blocking twice is still the same as once", async () => {
    const { a, b, key } = await pair();
    expect(await blockAccount(a.id, b.id)).toBe(true);
    expect(await blockAccount(a.id, b.id)).toBe(true);
    expect(await db.block.count({ where: { blockerId: a.id, blockedId: b.id } })).toBe(1);
    expect(await db.appSetting.count({ where: { key } })).toBe(1);
  });
});
