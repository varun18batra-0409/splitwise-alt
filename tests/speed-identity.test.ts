import { afterAll, describe, expect, it, vi } from "vitest";

// Speed step 8: "which groups am I in" (getMemberships) reads the account and the cookie's names side by side, then reads the account's
// member rows ONCE (it used to be two reads, with the history check in between). The groups a person is in must not change.
//
// Hand-worked. Account "Ada" has these rows:
//   G1  she started it                          (addedBy empty)         -> in
//   G2  she took a name herself                 (addedBy empty)         -> in
//   G3  Ben added her, she opened it            (addedBy Ben, seenAt)   -> in
//   G4  Ben added her, never opened it, but she added an expense there (history proves it) -> in, and seenAt is set now
//   G5  Ben added her, never opened it, nothing she did                  -> OUT (pending)
//   G6  Ben added her, never opened it, only a repeat-bill line in her name (done FOR her) -> OUT
//   G7  two rows of hers in one group (names "Ada" and "Ada 2"), both joined -> in, once
// A guest phone (no account) keeps only its cookie's names (epoch must match), and a name linked to an account is "linked away".
const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined),
    set: (n: string, v: string) => {
      if (n === "sw_me") state.cookie = v;
    },
    delete: () => undefined,
  }),
  headers: async () => new Headers({ host: "loopin.test" }),
}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { encodeSession, today } = await import("@/lib/session");
const { getMemberships, getLinkedAwayGroups, grantValue } = await import("@/lib/identity");
const { JOINED, confirmUsedPending } = await import("@/lib/membership");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const groups: string[] = [];
const accounts: string[] = [];

async function group(tag: string, members: Record<string, unknown>[]) {
  const g = await db.group.create({ data: { name: `Id ${tag} ${stamp}`, inviteCode: `id-${tag}-${stamp}`, members: { create: members as never[] } }, include: { members: true } });
  groups.push(g.id);
  return g;
}
afterAll(async () => {
  await db.groupEvent.deleteMany({ where: { groupId: { in: groups } } });
  await db.expenseShare.deleteMany({ where: { expense: { groupId: { in: groups } } } });
  await db.expense.deleteMany({ where: { groupId: { in: groups } } });
  await db.member.deleteMany({ where: { groupId: { in: groups } } });
  await db.group.deleteMany({ where: { id: { in: groups } } });
  await db.account.deleteMany({ where: { id: { in: accounts } } });
});

// What it did before: confirm the pending ones, then read the joined rows; the first row for a group wins.
async function before(accountId: string): Promise<Record<string, string>> {
  await confirmUsedPending(accountId);
  const mine = await db.member.findMany({ where: { accountId, ...JOINED }, select: { id: true, groupId: true } });
  const out: Record<string, string> = {};
  for (const m of mine) if (!out[m.groupId]) out[m.groupId] = m.id;
  return out;
}

describe("getMemberships for a signed-in person", () => {
  it("the same groups as before, and a pending person who used the group is confirmed", async () => {
    const acc = await db.account.create({ data: { email: `ada-${stamp}@example.test`, name: "Ada" } });
    accounts.push(acc.id);
    const ben = { name: "Ben", claimedAt: new Date() };
    const seen = new Date();
    const g1 = await group("g1", [{ name: "Ada", accountId: acc.id, claimedAt: new Date() }, ben]);
    const g2 = await group("g2", [{ name: "Ada", accountId: acc.id }, ben]);
    const g3 = await group("g3", [ben, { name: "Ada", accountId: acc.id, addedBy: "ben", seenAt: seen }]);
    const g4 = await group("g4", [ben, { name: "Ada", accountId: acc.id, addedBy: "ben" }]);
    const g5 = await group("g5", [ben, { name: "Ada", accountId: acc.id, addedBy: "ben" }]);
    const g6 = await group("g6", [ben, { name: "Ada", accountId: acc.id, addedBy: "ben" }]);
    const g7 = await group("g7", [{ name: "Ada", accountId: acc.id }, { name: "Ada 2", accountId: acc.id }, ben]);
    const mine = (g: { members: { name: string; id: string }[] }, name = "Ada") => g.members.find((m) => m.name === name)!.id;

    // G4: she added an expense herself. G6: only a repeat-bill line in her name.
    const e = await db.expense.create({ data: { groupId: g4.id, description: "Tea", splitType: "equal", amount: 100, originalAmount: 100, convertedAmount: 100, paidById: mine(g4), createdById: mine(g4), shares: { create: [{ memberId: mine(g4), amount: 100 }] } } });
    await db.groupEvent.create({ data: { groupId: g4.id, actorId: mine(g4), kind: "expense_added", text: "added Tea (₹1.00)", expenseId: e.id, details: "[]", undo: "" } });
    await db.groupEvent.create({ data: { groupId: g6.id, actorId: mine(g6), kind: "expense_added", text: "added Rent (₹1.00) · repeat bill", details: "[]", undo: "" } });

    state.cookie = await encodeSession({ m: {}, a: acc.id, v: 0, t: today() });
    const now = await getMemberships();
    expect(now).toEqual({ [g1.id]: mine(g1), [g2.id]: mine(g2), [g3.id]: mine(g3), [g4.id]: mine(g4), [g7.id]: now[g7.id] });
    expect([mine(g7), mine(g7, "Ada 2")]).toContain(now[g7.id]); // two rows in one group: one of them, once
    expect(Object.keys(now)).toHaveLength(5);
    expect(now[g5.id]).toBeUndefined(); // pending, nothing she did
    expect(now[g6.id]).toBeUndefined(); // pending, only done for her
    // G4 is now remembered as joined (seenAt set); G5 and G6 stay pending.
    expect((await db.member.findUniqueOrThrow({ where: { id: mine(g4) } })).seenAt).not.toBeNull();
    expect((await db.member.findUniqueOrThrow({ where: { id: mine(g5) } })).seenAt).toBeNull();
    expect((await db.member.findUniqueOrThrow({ where: { id: mine(g6) } })).seenAt).toBeNull();
    // Exactly what the old two-read method gives.
    expect(await before(acc.id)).toEqual(now);
    // And again (G4 is now simply joined).
    expect(await getMemberships()).toEqual(now);
  });

  it("a guest phone and a name linked to an account", async () => {
    const acc = await db.account.create({ data: { email: `link-${stamp}@example.test`, name: "Linked" } });
    accounts.push(acc.id);
    const g = await group("guest", [{ name: "Gus" }, { name: "Linked", accountId: acc.id }]);
    const gus = g.members.find((m) => m.name === "Gus")!;
    const linked = g.members.find((m) => m.name === "Linked")!;
    // Right epoch: in. Wrong epoch: out. No account on the phone.
    state.cookie = await encodeSession({ m: { [g.id]: grantValue(gus.id, gus.grantEpoch) }, t: today() });
    expect(await getMemberships()).toEqual({ [g.id]: gus.id });
    state.cookie = await encodeSession({ m: { [g.id]: grantValue(gus.id, gus.grantEpoch + 1) }, t: today() });
    expect(await getMemberships()).toEqual({});
    // A cookie name that is linked to an account, on a phone not signed in as that account: linked away, not a membership.
    state.cookie = await encodeSession({ m: { [g.id]: grantValue(linked.id, 0) }, t: today() });
    expect(await getMemberships()).toEqual({});
    expect(await getLinkedAwayGroups()).toEqual([g.id]);
    // Signed in as that account: in (from the cookie's name and from the account's rows alike), once.
    state.cookie = await encodeSession({ m: { [g.id]: grantValue(linked.id, 0) }, a: acc.id, v: 0, t: today() });
    expect(await getMemberships()).toEqual({ [g.id]: linked.id });
    expect(await getLinkedAwayGroups()).toEqual([]);
  });

  it("a sign-in that has ended (wrong session version) is a guest phone again", async () => {
    const acc = await db.account.create({ data: { email: `ended-${stamp}@example.test`, name: "Ended" } });
    accounts.push(acc.id);
    await group("ended", [{ name: "Ended", accountId: acc.id }]);
    state.cookie = await encodeSession({ m: {}, a: acc.id, v: 5, t: today() });
    expect(await getMemberships()).toEqual({});
  });
});
