import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// A pair is hidden from every group screen and from everything that asks "do these two share a group?", and it has no settings.
// Setup: Asha and Rohan share the ordinary group G and also have the pair P (Asha paid 120000: Rohan owes 60000).
vi.mock("@/lib/rate-cache", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-cache")>()), displayRate: async () => ({ ok: false, message: "no rate" }) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { ensureAccountPair, ensureLocalPair, pickableGroups, isDirectGroup } = await import("@/lib/direct-db");
const { loadMyGroups, loadMyGroupsLean, loadSwitchList, loadDeletedGroups } = await import("@/lib/group-data");
const { loadOverview } = await import("@/lib/overview");
const { updateSharing, setTripDates } = await import("@/lib/group-setup");
const { saveAllSettings } = await import("@/lib/settings-save");
const { changeGroupCurrency, updateGroupBasics } = await import("@/lib/group-changes");
const { setMember, renameMember } = await import("@/lib/people");
const { canSeePassport } = await import("@/lib/passport-db");
const { loopinFriends } = await import("@/lib/collect");
const { mkAccount, mkSharedGroup, addExpense, wipe } = await import("./helpers/direct-fixtures");

let A = "", R = "", L = "";
let G = { id: "", a: "", r: "" };
let P = { groupId: "", aRow: "", rRow: "" };
let Q = { groupId: "", aRow: "", rRow: "" }; // a pair with a person who shares nothing else with Asha: Lena
let local = { groupId: "", myId: "", otherId: "" };

beforeAll(async () => {
  A = (await mkAccount("xa", "Asha")).id;
  R = (await mkAccount("xr", "Rohan")).id;
  L = (await mkAccount("xl", "Lena")).id;
  const g = await mkSharedGroup("xg", [{ id: A, name: "Asha" }, { id: R, name: "Rohan" }]);
  G = { id: g.id, a: g.memberOf(A), r: g.memberOf(R) };
  const p = await ensureAccountPair({ id: A }, R, { currency: "INR", myName: "Asha" });
  if (!p.ok) throw new Error("refused");
  P = { groupId: p.groupId, aRow: p.myId, rRow: p.otherId };
  await addExpense(P.groupId, { paidBy: P.aRow, amount: 120000, shares: { [P.aRow]: 60000, [P.rRow]: 60000 } });
  // Lena: shares a group with Asha for a moment so the pair can be made, then leaves it. Only the pair is left between them.
  const gl = await mkSharedGroup("xl", [{ id: A, name: "Asha" }, { id: L, name: "Lena" }]);
  const q = await ensureAccountPair({ id: A }, L, { currency: "INR", myName: "Asha" });
  if (!q.ok) throw new Error("refused");
  Q = { groupId: q.groupId, aRow: q.myId, rRow: q.otherId };
  await db.group.update({ where: { id: gl.id }, data: { deletedAt: new Date() } });
  const lo = await ensureLocalPair({ id: A }, "Nameonly Nia", { currency: "INR", myName: "Asha" });
  if (!lo.ok) throw new Error("refused");
  local = lo;
});
afterAll(async () => {
  await wipe([A, R, L]);
});

const mine = () => ({ [G.id]: G.a, [P.groupId]: P.aRow, [Q.groupId]: Q.aRow, [local.groupId]: local.myId });

describe("19. screens that list groups never show a pair", () => {
  it("loadMyGroups and loadMyGroupsLean return only G; includeDirect is the one way to see pairs", async () => {
    expect((await loadMyGroups(mine())).map((g) => g.group.id)).toEqual([G.id]);
    expect((await loadMyGroupsLean(mine())).map((g) => g.group.id)).toEqual([G.id]);
    const withPairs = (await loadMyGroups(mine(), { includeDirect: true })).map((g) => g.group.id);
    expect(withPairs).toContain(P.groupId);
  });

  it("the overview's group lists, the switcher, the picker and Deleted groups leave pairs out", async () => {
    const o = await loadOverview(mine());
    expect(o.all.map((g) => g.group.id)).toEqual([G.id]);
    expect(o.open.map((g) => g.group.id)).toEqual([G.id]);
    expect(o.closed).toEqual([]);
    expect(o.directAll.map((d) => d.groupId)).toEqual(expect.arrayContaining([P.groupId, local.groupId]));
    expect((await loadSwitchList(mine(), "none")).map((g) => g.id)).toEqual([G.id]);
    expect((await pickableGroups(mine())).map((g) => g.id)).toEqual([G.id]);
    await db.group.update({ where: { id: P.groupId }, data: { deletedAt: new Date() } });
    expect((await loadDeletedGroups(mine())).map((g) => g.id)).not.toContain(P.groupId);
    await db.group.update({ where: { id: P.groupId }, data: { deletedAt: null } });
    expect(await isDirectGroup(P.groupId)).toBe(true);
    expect(await isDirectGroup(G.id)).toBe(false);
  });

  it("a pair is not 'a group you share': passport and Collect friends only count real groups", async () => {
    const lena = await canSeePassport(A, L);
    expect(lena.ok).toBe(false);
    expect((lena as { reason?: string }).reason).toBe("stranger");
    const friends = (await loopinFriends(A)).map((f) => f.id);
    expect(friends).toContain(R); // through G
    expect(friends).not.toContain(L); // only a pair (and a group that is gone)
  });
});

describe("20. a pair has no settings, no leaving, and no deleting by the back door", () => {
  it("changing sharing, dates, name and the whole settings form are refused, and nothing changes", async () => {
    const before = await db.group.findUnique({ where: { id: P.groupId } });
    expect((await updateSharing(P.groupId, P.aRow, { type: "trip", weights: {} })).ok).toBe(false);
    expect((await setTripDates(P.groupId, P.aRow, "2026-12-01", "2026-12-05", "2026-11-15")).ok).toBe(false);
    expect((await updateGroupBasics(P.groupId, P.aRow, { name: "Renamed" })).ok).toBe(false);
    expect((await saveAllSettings(P.groupId, P.aRow, { name: "Renamed" }, "2026-11-15")).ok).toBe(false);
    const after = await db.group.findUnique({ where: { id: P.groupId } });
    expect(after).toEqual(before);
  });

  it("leaving or removing the other person is refused, so the pair stays two people", async () => {
    const left = await setMember(P.groupId, P.aRow, P.aRow, { leftAt: new Date().toISOString() });
    const removed = await setMember(P.groupId, P.aRow, P.rRow, { leftAt: new Date().toISOString() });
    expect(left.ok).toBe(false);
    expect(removed.ok).toBe(false);
    const rows = await db.member.findMany({ where: { groupId: P.groupId } });
    expect(rows).toHaveLength(2);
    expect(rows.every((m) => m.leftAt === null && m.removedAt === null)).toBe(true);
  });

  it("the currency can't be changed once the pair has money", async () => {
    const r = await changeGroupCurrency(P.groupId, P.aRow, "USD", "0.012", { expectEmpty: true });
    expect(r.ok).toBe(false);
    expect((await db.group.findUnique({ where: { id: P.groupId } }))!.currency).toBe("INR");
    const plain = await changeGroupCurrency(P.groupId, P.aRow, "USD", "0.012");
    expect(plain.ok).toBe(false);
  });

  it("an empty pair may change currency once, before its first expense", async () => {
    const r = await changeGroupCurrency(Q.groupId, Q.aRow, "USD", "", { expectEmpty: true });
    expect(r.ok).toBe(true);
    expect((await db.group.findUnique({ where: { id: Q.groupId } }))!.currency).toBe("USD");
  });

  it("renaming a name only you can see: allowed once, refused when you already have that name, and an account holder's name is theirs", async () => {
    const other = await ensureLocalPair({ id: A }, "Other Olly", { currency: "INR", myName: "Asha" });
    if (!other.ok) throw new Error("refused");
    const clash = await renameMember(other.groupId, other.myId, other.otherId, "Nameonly Nia");
    expect(clash.ok).toBe(false);
    expect((clash as { error: string }).error).toBe("You already have someone called Nameonly Nia.");
    expect((await db.group.findUnique({ where: { id: other.groupId } }))!.pairKey).toBe(`local:${A}|other olly`);
    const fine = await renameMember(other.groupId, other.myId, other.otherId, "Olivia");
    expect(fine.ok).toBe(true);
    expect((await db.group.findUnique({ where: { id: other.groupId } }))!.pairKey).toBe(`local:${A}|olivia`);
    const theirName = await renameMember(P.groupId, P.aRow, P.rRow, "Someone Else");
    expect(theirName.ok).toBe(false);
  });
});
