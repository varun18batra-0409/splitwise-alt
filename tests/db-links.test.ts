import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { deleteAccount } from "@/lib/auth";

// DEF-010: database links on the tables nothing else points to. The database
// itself now refuses a row whose group, person, expense or account doesn't
// exist, and erasing a group or an account leaves nothing behind.

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groups: string[] = [];
const accounts: string[] = [];
afterAll(async () => {
  await eraseGroups(groups).catch(() => undefined);
  for (const a of accounts) await deleteAccount(a).catch(() => undefined);
});

async function setup() {
  const g = await db.group.create({
    data: { name: "Links", inviteCode: `links-${stamp()}`, members: { create: [{ name: "A" }, { name: "B" }] } },
    include: { members: { orderBy: { name: "asc" } } },
  });
  groups.push(g.id);
  const [a, b] = g.members.map((m) => m.id);
  const e = await db.expense.create({
    data: { groupId: g.id, description: "Tea", amount: 200, splitType: "equal", paidById: a, shares: { create: [{ memberId: a, amount: 100 }, { memberId: b, amount: 100 }] } },
  });
  return { g: g.id, a, b, e: e.id };
}

describe("DEF-010: database links", () => {
  it("refuses rows that point at nothing", async () => {
    const { g, a, e } = await setup();
    await expect(db.reaction.create({ data: { expenseId: "no-such-expense", memberId: a, emoji: "🔥" } })).rejects.toThrow();
    await expect(db.reaction.create({ data: { expenseId: e, memberId: "no-such-member", emoji: "🔥" } })).rejects.toThrow();
    await expect(db.invite.create({ data: { groupId: "no-such-group", email: `x-${stamp()}@test.dev`, invitedById: a } })).rejects.toThrow();
    await expect(db.payLink.create({ data: { token: `t-${stamp()}`, groupId: g, fromId: a, toId: "no-such-member", createdById: a, expiresAt: new Date(Date.now() + 86_400_000) } })).rejects.toThrow();
    await expect(db.passkey.create({ data: { id: `cred-${stamp()}`, accountId: "no-such-account", publicKey: "AAAA" } })).rejects.toThrow();
    await expect(db.receipt.create({ data: { groupId: "no-such-group", data: new Uint8Array([1]) } })).rejects.toThrow();
  });

  it("erasing a group leaves no pay links, invites, photo, bill photos or reactions behind", async () => {
    const { g, a, b, e } = await setup();
    await db.reaction.create({ data: { expenseId: e, memberId: b, emoji: "😂" } });
    await db.payLink.create({ data: { token: `t-${stamp()}`, groupId: g, fromId: b, toId: a, createdById: a, expiresAt: new Date(Date.now() + 86_400_000) } });
    await db.invite.create({ data: { groupId: g, email: `inv-${stamp()}@test.dev`, invitedById: a } });
    await db.groupPhoto.create({ data: { groupId: g, data: new Uint8Array([1, 2, 3]) } });
    await db.receipt.create({ data: { groupId: g, expenseId: e, data: new Uint8Array([1]) } });
    await eraseGroups([g]);
    expect(await db.group.count({ where: { id: g } })).toBe(0);
    expect(await db.payLink.count({ where: { groupId: g } })).toBe(0);
    expect(await db.invite.count({ where: { groupId: g } })).toBe(0);
    expect(await db.groupPhoto.count({ where: { groupId: g } })).toBe(0);
    expect(await db.receipt.count({ where: { groupId: g } })).toBe(0);
    expect(await db.reaction.count({ where: { expenseId: e } })).toBe(0);
  });

  it("deleting an account leaves no passkeys, notes or postcards behind", async () => {
    const me = (await db.account.create({ data: { email: `links-me-${stamp()}@test.dev` } })).id;
    const friend = (await db.account.create({ data: { email: `links-fr-${stamp()}@test.dev` } })).id;
    accounts.push(friend);
    await db.passkey.create({ data: { id: `cred-${stamp()}`, accountId: me, publicKey: "AAAA" } });
    await db.accountNote.create({ data: { accountId: me, kind: "collect_added", title: "t", body: "b", url: "/" } });
    await db.postcard.create({ data: { fromId: friend, toId: me, front: "print:beach", message: "Hi" } });
    await db.postcard.create({ data: { fromId: me, toId: friend, front: "print:beach", message: "Hello" } });
    await deleteAccount(me);
    expect(await db.account.count({ where: { id: me } })).toBe(0);
    expect(await db.passkey.count({ where: { accountId: me } })).toBe(0);
    expect(await db.accountNote.count({ where: { accountId: me } })).toBe(0);
    expect(await db.postcard.count({ where: { OR: [{ fromId: me }, { toId: me }] } })).toBe(0);
    // The friend's account is untouched.
    expect(await db.account.count({ where: { id: friend } })).toBe(1);
  });
});
