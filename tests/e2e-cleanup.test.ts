import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { cleanUp } from "../e2e/helpers/db";

// AUTO-03: the end-to-end tidy-up must never delete another run's people, or anyone real.
// Real (throwaway) test database; every row here is made by this test and removed at the end.
const stamp = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
const HOUR = 3_600_000;
const mail = (run: string, who: string) => `e2e-${run}-${who}@e2e.loopin.test`;
const OLD = `old${stamp}`;
const LIVE_RUN = `live${stamp}`;
const realEmail = `real-${stamp}@example.test`;

const accountIds: string[] = [];
const groupIds: string[] = [];
async function person(email: string, ageHours: number) {
  const a = await db.account.create({ data: { email, name: "T", createdAt: new Date(Date.now() - ageHours * HOUR) } });
  accountIds.push(a.id);
  return a;
}
async function group(name: string, members: { name: string; accountId: string | null }[]) {
  const g = await db.group.create({ data: { name, inviteCode: `c${stamp}${groupIds.length}`, members: { create: members } } });
  groupIds.push(g.id);
  return g;
}
const exists = async (id: string) => (await db.group.count({ where: { id } })) === 1;
const accountExists = async (id: string) => (await db.account.count({ where: { id } })) === 1;

afterAll(async () => {
  await db.member.deleteMany({ where: { groupId: { in: groupIds } } });
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("e2e cleanUp keeps other runs' and real data", () => {
  it("refuses to run without a run id or an expiry age", async () => {
    await expect(cleanUp({})).rejects.toThrow(/runId or an expiry age/);
    await expect(cleanUp({ olderThanMs: 0 })).rejects.toThrow(/runId or an expiry age/);
  });

  it("expiry clears only old test people; a run still going, and real groups, stay", async () => {
    const stale = await person(mail(OLD, "asha"), 10); // a crashed run from 10 hours ago
    const fresh = await person(mail(LIVE_RUN, "asha"), 0.2); // another run, started 12 minutes ago
    const real = await person(realEmail, 48); // a real-looking person, old, not on the test domain
    const staleGroup = await group(`E2E stale ${stamp}`, [{ name: "Asha", accountId: stale.id }]);
    const freshGroup = await group(`E2E live ${stamp}`, [{ name: "Asha", accountId: fresh.id }]);
    const realGroup = await group(`Flat ${stamp}`, [{ name: "Real", accountId: real.id }]);
    // An old test person who is in a group with a real person: the group must survive.
    const mixed = await group(`Mixed ${stamp}`, [{ name: "Asha", accountId: stale.id }, { name: "Real", accountId: real.id }]);

    const r = await cleanUp({ olderThanMs: 6 * HOUR });
    expect(r.accounts).toBeGreaterThanOrEqual(1);

    expect(await accountExists(stale.id)).toBe(false);
    expect(await exists(staleGroup.id)).toBe(false);
    expect(await accountExists(fresh.id)).toBe(true);
    expect(await exists(freshGroup.id)).toBe(true);
    expect(await accountExists(real.id)).toBe(true);
    expect(await exists(realGroup.id)).toBe(true);
    expect(await exists(mixed.id)).toBe(true);
    expect((await db.member.findMany({ where: { groupId: mixed.id, accountId: real.id } })).length).toBe(1);
  });

  it("a run's own tidy-up touches only that run, even if its people are brand new", async () => {
    const mine = await person(mail(LIVE_RUN, "ravi"), 0);
    const other = await person(mail(`other${stamp}`, "ravi"), 0);
    const myGroup = await group(`E2E mine ${stamp}`, [{ name: "Ravi", accountId: mine.id }]);
    const otherGroup = await group(`E2E other ${stamp}`, [{ name: "Ravi", accountId: other.id }]);

    const r = await cleanUp({ runId: LIVE_RUN });
    expect(r.accounts).toBe(2); // Asha from the previous case and Ravi: both belong to this run id
    expect(await accountExists(mine.id)).toBe(false);
    expect(await exists(myGroup.id)).toBe(false);
    expect(await accountExists(other.id)).toBe(true);
    expect(await exists(otherGroup.id)).toBe(true);
  });
});
