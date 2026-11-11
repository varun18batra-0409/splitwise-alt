import { afterAll, describe, expect, it, vi } from "vitest";

// Invitations from the invitee's side: Join and Not now, for the new kind (an email invite that put a
// name in the group) and the older kind (added straight in with their account, never opened it).
// Nothing here may change anyone's balance.

const state = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "sw_me" && state.cookie ? { value: state.cookie } : undefined), set: () => undefined, delete: () => undefined }),
}));
// React's per-request cache isn't running here: call straight through.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { inviteByEmail } = await import("@/lib/invites");
const { acceptInvitation, declineInvitation, loadInvitations, invitationFor } = await import("@/lib/invitations");
const { getMemberships } = await import("@/lib/identity");
const { encodeSession, today } = await import("@/lib/session");
const { netBalances } = await import("@/lib/balances");
const { pickAdmin } = await import("@/lib/group-admin");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const accountIds: string[] = [];
process.env.MAIL_OUTBOX = "1";

async function account(name: string) {
  const a = await db.account.create({ data: { email: `inv-${name.toLowerCase()}-${stamp}@example.test`, name } });
  accountIds.push(a.id);
  return { id: a.id, name, email: a.email };
}
async function signedInAs(accountId: string) {
  state.cookie = await encodeSession({ m: {}, a: accountId, v: 0, t: today() });
}

// Asha started "Goa trip" with Meera. Dinner ₹900 (90000) was paid by Asha and shared equally by
// `sharers`. Hand-worked, with three sharers: 30000 each, Asha +60000, the other two −30000, sum 0.
async function trip(label: string) {
  const asha = await account(`Asha${label}`);
  const meera = await account(`Meera${label}`);
  const g = await db.group.create({
    data: {
      name: `Goa ${label}`, inviteCode: `inv-${label}-${stamp}`, type: "trip",
      members: { create: [{ name: "Asha", accountId: asha.id, claimedAt: new Date(2026, 0, 1), createdAt: new Date(2026, 0, 1) }, { name: "Meera", accountId: meera.id, claimedAt: new Date() }] },
    },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  groupIds.push(g.id);
  return { g, asha, meera, ashaId: g.members[0].id, meeraId: g.members[1].id };
}
async function dinner(groupId: string, paidBy: string, sharers: string[]) {
  const each = 90000 / sharers.length;
  await db.expense.create({
    data: { groupId, description: "Dinner", splitType: "equal", amount: 90000, originalAmount: 90000, convertedAmount: 90000, paidById: paidBy, createdById: paidBy, shares: { create: sharers.map((memberId) => ({ memberId, amount: each })) } },
  });
}
async function balances(groupId: string) {
  const g = await db.group.findUniqueOrThrow({ where: { id: groupId }, include: { members: true, expenses: { include: { shares: true } }, payments: true } });
  return netBalances(g.members.map((m) => m.id), g.expenses.filter((e) => !e.deletedAt), g.payments.filter((p) => !p.deletedAt));
}

afterAll(async () => {
  state.cookie = "";
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

describe("an email invitation: Join", () => {
  it("is on the invitee's Home, not in their groups; Join links their name and puts the group in their groups", async () => {
    const t = await trip("A");
    const ravi = await account("Ravi");
    const r = await inviteByEmail(t.g.id, t.ashaId, ravi.email, "https://loopin.test");
    expect(r.people.length).toBe(1);
    const row = await db.member.findFirstOrThrow({ where: { groupId: t.g.id, name: r.people[0].name } });
    // Ravi's name is in the group at once, so Dinner can be split three ways before he has joined.
    await dinner(t.g.id, t.ashaId, [t.ashaId, t.meeraId, row.id]);
    const before = await balances(t.g.id);
    expect(before[t.ashaId]).toBe(60000);
    expect(before[t.meeraId]).toBe(-30000);
    expect(before[row.id]).toBe(-30000);

    await signedInAs(ravi.id);
    const list = await loadInvitations(ravi);
    expect(list.length).toBe(1);
    expect(list[0]).toMatchObject({ groupId: t.g.id, groupName: t.g.name, byName: "Asha", people: 3, used: 1, memberId: row.id });
    expect(await getMemberships()).toEqual({}); // not in his groups yet

    const ans = await acceptInvitation(ravi, list[0].key);
    expect(ans).toEqual({ ok: true, groupId: t.g.id, memberId: row.id });
    const after = await db.member.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.accountId).toBe(ravi.id);
    expect(after.claimedAt).not.toBeNull();
    expect(after.seenAt).not.toBeNull();
    expect((await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: ravi.email } })).acceptedAt).not.toBeNull();
    expect(await getMemberships()).toEqual({ [t.g.id]: row.id }); // now in his groups
    expect(await loadInvitations(ravi)).toEqual([]);
    expect(await balances(t.g.id)).toEqual(before); // joining moved no money
  });

  it("Join works for one's own invitation only, and not twice", async () => {
    const t = await trip("B");
    const zed = await account("Zed");
    const other = await account("Other");
    await inviteByEmail(t.g.id, t.ashaId, zed.email, "https://loopin.test");
    const key = (await loadInvitations(zed))[0].key;
    expect((await acceptInvitation(other, key)).ok).toBe(false); // someone else's token
    expect((await acceptInvitation(zed, "nonsense")).ok).toBe(false);
    expect((await acceptInvitation(zed, key)).ok).toBe(true);
    const again = await acceptInvitation(zed, key); // pressed twice: still lands in the group, no second row
    expect(again.ok).toBe(true);
    expect(await db.member.count({ where: { groupId: t.g.id, accountId: zed.id } })).toBe(1);
  });
});

describe("an email invitation: Not now", () => {
  it("hides the card, keeps the name and every balance, and the group never appears in their groups", async () => {
    const t = await trip("C");
    const kai = await account("Kai");
    const r = await inviteByEmail(t.g.id, t.ashaId, kai.email, "https://loopin.test");
    const row = await db.member.findFirstOrThrow({ where: { groupId: t.g.id, name: r.people[0].name } });
    await dinner(t.g.id, t.ashaId, [t.ashaId, t.meeraId, row.id]);
    const before = await balances(t.g.id);

    await signedInAs(kai.id);
    const key = (await loadInvitations(kai))[0].key;
    expect((await declineInvitation(kai, key)).ok).toBe(true);
    const inv = await db.invite.findFirstOrThrow({ where: { groupId: t.g.id, email: kai.email } });
    expect(inv.declinedAt).not.toBeNull();
    expect(inv.acceptedAt).toBeNull();
    expect(await db.member.findUnique({ where: { id: row.id } })).toMatchObject({ accountId: null, name: r.people[0].name }); // the name row stays
    expect(await loadInvitations(kai)).toEqual([]); // card hidden
    expect(await getMemberships()).toEqual({});
    expect(await balances(t.g.id)).toEqual(before);
    expect(Object.values(await balances(t.g.id)).reduce((s, n) => s + n, 0)).toBe(0);
    // Asked again later: a fresh card.
    await inviteByEmail(t.g.id, t.ashaId, kai.email, "https://loopin.test");
    expect((await loadInvitations(kai)).length).toBe(1);
  });

  it("a name taken out of the group again takes its card with it", async () => {
    const t = await trip("D");
    const lee = await account("Lee");
    const r = await inviteByEmail(t.g.id, t.ashaId, lee.email, "https://loopin.test");
    await db.member.deleteMany({ where: { groupId: t.g.id, name: r.people[0].name } });
    expect(await loadInvitations(lee)).toEqual([]);
  });
});

describe("added straight in the old way (account on the row, never opened the group)", () => {
  async function legacy(label: string, used: boolean) {
    const t = await trip(label);
    const pat = await account(`Pat${label}`);
    const row = await db.member.create({ data: { groupId: t.g.id, name: "Pat", accountId: pat.id, claimedAt: new Date(), addedBy: t.ashaId } });
    if (used) await dinner(t.g.id, t.ashaId, [t.ashaId, t.meeraId, row.id]);
    return { ...t, pat, row };
  }

  it("is not one of their groups; the same Join card shows with how many expenses they're already in", async () => {
    const s = await legacy("E", true);
    await signedInAs(s.pat.id);
    expect(await getMemberships()).toEqual({});
    const inv = await invitationFor(s.pat, s.g.id);
    expect(inv).toMatchObject({ key: `m:${s.row.id}`, byName: "Asha", used: 1, people: 3 });
  });

  it("Join sets seenAt and the group becomes theirs", async () => {
    const s = await legacy("F", false);
    await signedInAs(s.pat.id);
    expect((await acceptInvitation(s.pat, `m:${s.row.id}`)).ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: s.row.id } })).seenAt).not.toBeNull();
    expect(await getMemberships()).toEqual({ [s.g.id]: s.row.id });
    expect(await loadInvitations(s.pat)).toEqual([]);
  });

  it("Not now when the name is in expenses: it becomes a plain name, and every balance stays, summing to 0", async () => {
    const s = await legacy("G", true);
    const before = await balances(s.g.id);
    expect(before[s.row.id]).toBe(-30000);
    await signedInAs(s.pat.id);
    expect((await declineInvitation(s.pat, `m:${s.row.id}`)).ok).toBe(true);
    const row = await db.member.findUniqueOrThrow({ where: { id: s.row.id } });
    expect(row.accountId).toBeNull();
    expect(row.claimedAt).toBeNull();
    expect(row.addedBy).toBe("");
    expect(await balances(s.g.id)).toEqual(before);
    expect(Object.values(await balances(s.g.id)).reduce((n, x) => n + x, 0)).toBe(0);
    expect(await getMemberships()).toEqual({});
    expect(await loadInvitations(s.pat)).toEqual([]);
  });

  it("Not now when the name has no expenses: the name stays, as a plain name", async () => {
    const s = await legacy("H", false);
    await signedInAs(s.pat.id);
    await declineInvitation(s.pat, `m:${s.row.id}`);
    expect(await db.member.findUniqueOrThrow({ where: { id: s.row.id } })).toMatchObject({ accountId: null, addedBy: "" });
  });

  it("someone added this way can't look after the group while pending", async () => {
    const s = await legacy("I", false);
    const members = await db.member.findMany({ where: { groupId: s.g.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    expect(pickAdmin(members)?.id).toBe(s.ashaId);
    // Even when Asha and Meera have left, the pending person is not handed the group.
    const gone = members.map((m) => (m.id === s.row.id ? m : { ...m, leftAt: new Date() }));
    expect(pickAdmin(gone)).toBeUndefined();
  });
});
