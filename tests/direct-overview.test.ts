import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Home and Settle with a pair beside a group. Hand-worked (paise):
//   Pair P (Asha and Rohan): Asha paid 120000, equal -> Rohan owes Asha 60000.
//   Group G (Asha and Rohan): Rohan paid 80000, equal -> Asha owes Rohan 40000.
// Home always counts pairs (founder decision, 16 Nov). Never netted: Home shows "owed ₹600" and "owe ₹400" as two lines (net +₹200 in total, never the one line "₹200").
// A rupee pair and a dollar pair with no saved rate are never added together.
vi.mock("@/lib/rate-cache", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-cache")>()), displayRate: async () => ({ ok: false, message: "no rate" }) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { loadOverview, pickCommonCurrency } = await import("@/lib/overview");
const { ensureAccountPair } = await import("@/lib/direct-db");
const { settleAcrossCore } = await import("@/lib/cross-settle-db");
const { moneyPeople, pairPeopleGroup, moneyMode } = await import("@/lib/home/money-card");
const { loadGroupView } = await import("@/lib/group-data");
const { mkAccount, mkSharedGroup, addExpense, wipe, stamp } = await import("./helpers/direct-fixtures");

let A = "", R = "", X = "", Y = "";
let G = { id: "", a: "", r: "" };
let pair = { groupId: "", aRow: "", rRow: "" };
let xPair = { groupId: "", aRow: "" }, yPair = { groupId: "", aRow: "" };
let a2 = "";
let S = "", K = "", T = "";
let sPair = { groupId: "", aRow: "" }, sGroup = { id: "", a: "" }, tPair = { groupId: "", aRow: "" }, tGroup = { id: "", a: "" };

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

  // Sam: Kabir owes Sam 2291600 in a group (Sam paid 4583200, equal) and Sam owes Rohan 60000 directly (Rohan paid 120000, equal).
  S = (await mkAccount("os", "Sam")).id;
  K = (await mkAccount("ok", "Kabir")).id;
  const gk = await mkSharedGroup("ok", [{ id: S, name: "Sam" }, { id: K, name: "Kabir" }]);
  sGroup = { id: gk.id, a: gk.memberOf(S) };
  await addExpense(gk.id, { paidBy: gk.memberOf(S), amount: 4583200, shares: { [gk.memberOf(S)]: 2291600, [gk.memberOf(K)]: 2291600 } });
  const ps = await ensureAccountPair({ id: S }, R, { currency: "INR", myName: "Sam" });
  if (!ps.ok) throw new Error("refused");
  sPair = { groupId: ps.groupId, aRow: ps.myId };
  await addExpense(ps.groupId, { paidBy: ps.otherId, amount: 120000, shares: { [ps.myId]: 60000, [ps.otherId]: 60000 } });

  // Tara: her only group with Rohan is all settled (no money), and she owes Rohan 60000 directly.
  T = (await mkAccount("ot", "Tara")).id;
  const gt = await mkSharedGroup("ot", [{ id: T, name: "Tara" }, { id: R, name: "Rohan" }]);
  tGroup = { id: gt.id, a: gt.memberOf(T) };
  const pt = await ensureAccountPair({ id: T }, R, { currency: "INR", myName: "Tara" });
  if (!pt.ok) throw new Error("refused");
  tPair = { groupId: pt.groupId, aRow: pt.myId };
  await addExpense(pt.groupId, { paidBy: pt.otherId, amount: 120000, shares: { [pt.myId]: 60000, [pt.otherId]: 60000 } });
});
afterAll(async () => {
  await wipe([A, R, a2, X, Y, S, K, T]);
});

const mine = () => ({ [G.id]: G.a, [pair.groupId]: pair.aRow });

describe("a pair beside a group", () => {
  it("10. the pair is its own entry; the group lists, Settle's group items and the group's own money stay the group's", async () => {
    const o = await loadOverview(mine());
    expect(o.all.map((g) => g.group.id)).toEqual([G.id]);
    expect(o.open.map((g) => g.group.id)).toEqual([G.id]);
    expect(o.direct).toHaveLength(1);
    expect(o.direct[0]).toMatchObject({ groupId: pair.groupId, net: 60000, currency: "INR" });
    expect(o.settleItems).toHaveLength(1);
    expect(o.settleItems[0].net).toBe(-40000);
    expect(o.settleItems[0].parts.map((p) => p.groupId)).toEqual([G.id]);
  });

  it("11. Home counts the pair: two lines (owed ₹600, owe ₹400), never one netted line", async () => {
    const on = await loadOverview(mine());
    expect(on.owedLines).toEqual(["₹600"]); // the pair, counted once
    expect(on.oweLines).toEqual(["₹400"]); // the group, counted once
    expect(on.netCommon).toEqual({ value: 20000, converted: false }); // 60000 - 40000
    expect(on.settleItems).toHaveLength(1); // Smart Settle across groups never sees the pair
    expect(on.settleItems[0].net).toBe(-40000);
  });

  it("11b. a pair and a group with different people: each counted once (Kabir 2291600 in a group, owe Rohan 60000 directly)", async () => {
    const o = await loadOverview({ [sGroup.id]: sGroup.a, [sPair.groupId]: sPair.aRow });
    expect(o.owedLines).toEqual(["₹22,916"]);
    expect(o.oweLines).toEqual(["₹600"]);
    expect(o.netCommon).toEqual({ value: 2231600, converted: false }); // 2291600 - 60000
  });

  it("11c. groups all settled, owe Rohan 60000 directly: the card is 'owe' ₹600, never square", async () => {
    const o = await loadOverview({ [tGroup.id]: tGroup.a, [tPair.groupId]: tPair.aRow });
    expect(o.oweLines).toEqual(["₹600"]);
    expect(o.owedLines).toEqual([]);
    expect(o.netCommon).toEqual({ value: -60000, converted: false });
    expect(moneyMode({ owedLines: o.owedLines.length, oweLines: o.oweLines.length, netValue: o.netValue })).toBe("owe");
    const groups = [
      ...o.open.map((g) => ({ groupId: g.group.id, groupName: g.group.name, currency: g.group.currency, myId: g.myId, members: g.group.members, transfers: g.transfers })),
      ...o.direct.map(pairPeopleGroup),
    ];
    const owe = moneyPeople(groups, "owe", o.common, o.toCommon);
    expect(owe.map((p) => p.amount)).toEqual([60000]);
    expect(owe[0].rowKey).toBe(`direct:${tPair.groupId}`); // the button opens /settle#direct-<pair id>
  });

  it("12. never netted: the money card has the two separate people, and one settle can't mix a pair with a group", async () => {
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
    const o = await loadOverview({ [xPair.groupId]: xPair.aRow, [yPair.groupId]: yPair.aRow });
    expect(o.owedLines).toEqual(["₹600"]);
    expect(o.oweLines).toEqual(["$25"]);
    expect(o.netCommon).toBeNull();
    expect(o.netLines).toContain("+₹600");
    expect(o.netLines).toContain("−$25");
  });

  it("13. someone with only a pair (no group) still has Settle entries and a readable pair page", async () => {
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

// The main currency for the "≈" total, worked by hand.
describe("which currency the converted total uses", () => {
  const m = (...e: [string, number][]) => new Map(e);
  it("open groups still decide: USD x2 beats INR x1, even with pairs in INR", () => {
    expect(pickCommonCurrency({ openCounts: m(["USD", 2], ["INR", 1]), closedFirst: "EUR", pairCounts: m(["INR", 5]), pairAbs: [] })).toBe("USD");
  });
  it("no open groups, pairs exist: a closed EUR group is ignored; the pair currency wins", () => {
    expect(pickCommonCurrency({ openCounts: m(), closedFirst: "EUR", pairCounts: m(["INR", 1]), pairAbs: [{ currency: "INR", abs: 60000 }] })).toBe("INR");
  });
  it("no groups at all, no pairs: the closed group's currency, else INR", () => {
    expect(pickCommonCurrency({ openCounts: m(), closedFirst: "EUR", pairCounts: m(), pairAbs: [] })).toBe("EUR");
    expect(pickCommonCurrency({ openCounts: m(), pairCounts: m(), pairAbs: [] })).toBe("INR");
  });
  it("a tie between pairs (1 INR, 1 USD): the user's own currency if tied, else the larger absolute amount", () => {
    const abs = [{ currency: "INR", abs: 60000 }, { currency: "USD", abs: 2500 }];
    expect(pickCommonCurrency({ openCounts: m(), pairCounts: m(["INR", 1], ["USD", 1]), pairAbs: abs, prefer: "USD" })).toBe("USD");
    expect(pickCommonCurrency({ openCounts: m(), pairCounts: m(["INR", 1], ["USD", 1]), pairAbs: abs, prefer: "GBP" })).toBe("INR"); // 60000 > 2500
    expect(pickCommonCurrency({ openCounts: m(), pairCounts: m(["INR", 1], ["USD", 1]), pairAbs: abs })).toBe("INR");
  });
  it("end to end: Dev's INR pair (+60000) and USD pair (-2500) tie; region USD picks USD, none picks INR", async () => {
    const pairs = { [xPair.groupId]: xPair.aRow, [yPair.groupId]: yPair.aRow };
    expect((await loadOverview(pairs, "USD")).common).toBe("USD");
    expect((await loadOverview(pairs)).common).toBe("INR");
  });
});

