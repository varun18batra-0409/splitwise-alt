import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Home and Settle with a pair beside a group. Hand-worked (paise):
//   Pair P (Asha and Rohan): Asha paid 120000, equal -> Rohan owes Asha 60000.
//   Group G (Asha and Rohan): Rohan paid 80000, equal -> Asha owes Rohan 40000.
// Never netted: Home's switch on shows "owed ₹600" and "owe ₹400" as two lines (net +₹200 in total, never the one line "₹200").
// A rupee pair and a dollar pair with no saved rate are never added together.
vi.mock("@/lib/rate-cache", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-cache")>()), displayRate: async () => ({ ok: false, message: "no rate" }) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { loadOverview } = await import("@/lib/overview");
const { ensureAccountPair } = await import("@/lib/direct-db");
const { settleAcrossCore } = await import("@/lib/cross-settle-db");
const { moneyPeople, pairPeopleGroup } = await import("@/lib/home/money-card");
const { loadGroupView } = await import("@/lib/group-data");
const { mkAccount, mkSharedGroup, addExpense, wipe, stamp } = await import("./helpers/direct-fixtures");

let A = "", R = "", X = "", Y = "";
let G = { id: "", a: "", r: "" };
let pair = { groupId: "", aRow: "", rRow: "" };
let xPair = { groupId: "", aRow: "" }, yPair = { groupId: "", aRow: "" };
let a2 = "";
const save = process.env.HOME_INCLUDES_DIRECT;

beforeAll(async () => {
  A = (await mkAccount("oa", "Asha")).id;
  R = (await mkAccount("or", "Rohan")).id;
  const g = await mkSharedGroup("og", [{ id: A, name: "Asha" }, { id: R, name: "Rohan" }]);
  G = { id: g.id, a: g.memberOf(A), r: g.memberOf(R) };
  await addExpense(G.id, { paidBy: G.r, amount: 80000, shares: { [G.a]: 40000, [G.r]: 40000 } });
  const p = await ensureAccountPair({ id: A }, R, { currency: "INR", myName: "Asha" });
  if (!p.ok) throw new Error("refused");
  pair = { groupId: p.groupId, aRow: p.myId, rRow: p.otherId };
  await addExpense(pair.groupId, { paidBy: pair.aRow, amount: 120000, shares: { [pair.aRow]: 60000, [pair.rRow]: 60000 } });

  // Account two: one rupee pair (Xavi owes 60000) and one dollar pair (owes Yara 2500 cents), no saved rate between them.
  a2 = (await mkAccount("o2", "Dev")).id;
  X = (await mkAccount("ox", "Xavi")).id;
  Y = (await mkAccount("oy", "Yara")).id;
  await mkSharedGroup("ox", [{ id: a2, name: "Dev" }, { id: X, name: "Xavi" }]);
  await mkSharedGroup("oy", [{ id: a2, name: "Dev" }, { id: Y, name: "Yara" }]);
  const px = await ensureAccountPair({ id: a2 }, X, { currency: "INR", myName: "Dev" });
  const py = await ensureAccountPair({ id: a2 }, Y, { currency: "USD", myName: "Dev" });
  if (!px.ok || !py.ok) throw new Error("refused");
  xPair = { groupId: px.groupId, aRow: px.myId };
  yPair = { groupId: py.groupId, aRow: py.myId };
  await addExpense(px.groupId, { paidBy: px.myId, amount: 120000, shares: { [px.myId]: 60000, [px.otherId]: 60000 } });
  await addExpense(py.groupId, { paidBy: py.otherId, amount: 5000, currency: "USD", shares: { [py.myId]: 2500, [py.otherId]: 2500 } });
});
afterAll(async () => {
  if (save === undefined) delete process.env.HOME_INCLUDES_DIRECT;
  else process.env.HOME_INCLUDES_DIRECT = save;
  await wipe([A, R, a2, X, Y]);
});

const mine = () => ({ [G.id]: G.a, [pair.groupId]: pair.aRow });

describe("a pair beside a group", () => {
  it("10. the pair is its own entry; the group lists, Settle's group items and the group's own money stay the group's", async () => {
    delete process.env.HOME_INCLUDES_DIRECT;
    const o = await loadOverview(mine());
    expect(o.all.map((g) => g.group.id)).toEqual([G.id]);
    expect(o.open.map((g) => g.group.id)).toEqual([G.id]);
    expect(o.direct).toHaveLength(1);
    expect(o.direct[0]).toMatchObject({ groupId: pair.groupId, net: 60000, currency: "INR" });
    expect(o.settleItems).toHaveLength(1);
    expect(o.settleItems[0].net).toBe(-40000);
    expect(o.settleItems[0].parts.map((p) => p.groupId)).toEqual([G.id]);
  });

  it("11. switch off: Home is the groups' own numbers; switch on: two lines, never one", async () => {
    delete process.env.HOME_INCLUDES_DIRECT;
    const off = await loadOverview(mine());
    expect(off.owedLines).toEqual([]);
    expect(off.oweLines).toEqual(["₹400"]);
    expect(off.netCommon).toEqual({ value: -40000, converted: false });

    process.env.HOME_INCLUDES_DIRECT = "1";
    const on = await loadOverview(mine());
    expect(on.owedLines).toEqual(["₹600"]);
    expect(on.oweLines).toEqual(["₹400"]);
    expect(on.netCommon).toEqual({ value: 20000, converted: false });
    expect(on.settleItems).toHaveLength(1); // Smart Settle across groups never sees the pair, switch or no switch
    expect(on.settleItems[0].net).toBe(-40000);
  });

  it("12. never netted: the money card has the two separate people, and one settle can't mix a pair with a group", async () => {
    process.env.HOME_INCLUDES_DIRECT = "1";
    const o = await loadOverview(mine());
    const groups = [
      ...o.open.map((g) => ({ groupId: g.group.id, groupName: g.group.name, currency: g.group.currency, myId: g.myId, members: g.group.members, transfers: g.transfers })),
      ...o.direct.map(pairPeopleGroup),
    ];
    const owed = moneyPeople(groups, "owed", o.common, o.toCommon);
    const owe = moneyPeople(groups, "owe", o.common, o.toCommon);
    expect(owed.map((p) => p.amount)).toEqual([60000]);
    expect(owe.map((p) => p.amount)).toEqual([40000]);
    expect([...owed, ...owe].some((p) => p.amount === 20000)).toBe(false);
    expect(owed[0].rowKey).toBe(`direct:${pair.groupId}`);

    const before = await db.payment.count({ where: { groupId: { in: [G.id, pair.groupId] } } });
    const out = await settleAcrossCore(
      [
        { groupId: G.id, fromId: G.a, toId: G.r, amount: 40000 },
        { groupId: pair.groupId, fromId: pair.rRow, toId: pair.aRow, amount: 60000 },
      ],
      mine(),
      `dov-${stamp}-mixed-settle`,
    );
    expect(out).toBe("error");
    expect(await db.payment.count({ where: { groupId: { in: [G.id, pair.groupId] } } })).toBe(before); // a refusal changes nothing
  });

  it("two currencies with no saved rate stay as two amounts, never added", async () => {
    process.env.HOME_INCLUDES_DIRECT = "1";
    const o = await loadOverview({ [xPair.groupId]: xPair.aRow, [yPair.groupId]: yPair.aRow });
    expect(o.owedLines).toEqual(["₹600"]);
    expect(o.oweLines).toEqual(["$25"]);
    expect(o.netCommon).toBeNull();
    expect(o.netLines).toContain("+₹600");
    expect(o.netLines).toContain("−$25");
  });

  it("13. someone with only a pair (no group) still has Settle entries and a readable pair page", async () => {
    process.env.HOME_INCLUDES_DIRECT = "1";
    const o = await loadOverview({ [pair.groupId]: pair.aRow });
    expect(o.all).toHaveLength(0);
    expect(o.direct).toHaveLength(1);
    expect(o.common).toBe("INR");
    expect(o.owedLines).toEqual(["₹600"]);
    const view = await loadGroupView(pair.groupId);
    expect(view).not.toBeNull();
    expect(view!.group.type).toBe("direct");
    // Settle's own list for people comes from `direct`, never from the (empty) group list.
    expect(o.settleItems).toHaveLength(0);
  });
});
