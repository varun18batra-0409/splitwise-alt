import { afterAll, describe, expect, it, vi } from "vitest";

// Batch B4: the screens that show the same money agree. Throwaway database; amounts in paise, every number worked by hand.
//
// Trip in INR with You (Y), Ravi (R) and Meera (M), all in November 2026:
//   Hotel  ₹9,000 (900000), paid by Y, equal shares of 300000          (accommodation)
//   Dinner ₹3,000 (300000), paid by R, equal shares of 100000          (food)
//   Payment R -> Y 200000
// Balances:  Y 900000 - 400000 - 200000 = +300000;  R 300000 - 400000 + 200000 = +100000;  M -400000;  sum 0.
// Smart Settle: M -> Y 300000 and M -> R 100000.
// Recap, November, "Your share": share 400000, You paid 900000, the difference 500000 ("More than your share", never "You're owed");
//   500000 - 300000 = 200000, which is exactly R's payment. Categories 300000 (75%) + 100000 (25%) = 400000.
// Group total 1200000; the Search summary reads "2 expenses · ₹12,000 spent · my cut ₹4,000"; the Charts category total is 900000 + 300000.
// After both Smart Settle payments every balance is 0 and Home says all square; the Recap is unchanged.

vi.mock("@/lib/rate-cache", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-cache")>()), displayRate: async () => ({ ok: false, message: "no rate" }) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { loadOverview } = await import("@/lib/overview");
const { loadGroup } = await import("@/lib/group-data");
const { netBalances } = await import("@/lib/balances");
const { smartSettle } = await import("@/lib/settle");
const { computeInsights, recapDiffLabel } = await import("@/lib/insights");
const { recap, recapRows } = await import("@/lib/search");
const { tripReport } = await import("@/lib/trip-report");
const { percentsTo100 } = await import("@/lib/money-display");
const { formatMoney } = await import("@/lib/money");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
let groupId = "";
afterAll(async () => {
  await db.group.deleteMany({ where: { id: groupId } }).catch(() => {});
});

const day = (s: string) => new Date(`${s}T06:00:00Z`);

describe("Home, Settle, Balances, Recap, Search and Charts agree", () => {
  it("one trip, seen by every screen", async () => {
    const g = await db.group.create({
      data: { name: `Agree ${stamp}`, type: "trip", currency: "INR", inviteCode: `ag-${stamp}`, members: { create: [{ name: "You" }, { name: "Ravi" }, { name: "Meera" }] } },
      include: { members: true },
    });
    groupId = g.id;
    const id = (n: string) => g.members.find((m) => m.name === n)!.id;
    const [Y, R, M] = [id("You"), id("Ravi"), id("Meera")];
    const exp = (description: string, category: string, amount: number, by: string, each: number) =>
      db.expense.create({
        data: {
          groupId, description, category, splitType: "equal", forMode: "everyone", amount, originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount,
          paidById: by, createdById: by, createdAt: day("2026-11-10"), spentAt: day("2026-11-10"),
          shares: { create: [Y, R, M].map((memberId) => ({ memberId, amount: each })) },
        },
      });
    await exp("Hotel", "accommodation", 900000, Y, 300000);
    await exp("Dinner", "food", 300000, R, 100000);
    await db.payment.create({ data: { groupId, fromId: R, toId: Y, amount: 200000, createdById: R, createdAt: day("2026-11-12") } });

    // Balances, and Smart Settle.
    const load = async () => (await db.group.findUnique({ where: { id: groupId }, include: { expenses: { include: { shares: true } }, payments: true } }))!;
    let full = await load();
    let net = netBalances([Y, R, M], full.expenses, full.payments);
    expect(net).toEqual({ [Y]: 300000, [R]: 100000, [M]: -400000 });
    expect(Object.values(net).reduce((t, x) => t + x, 0)).toBe(0);
    expect(smartSettle(net)).toEqual([{ from: M, to: Y, amount: 300000 }, { from: M, to: R, amount: 100000 }]);

    // Home (owed) = Settle (what people owe You) = Balances total for You = 300000.
    const home = await loadOverview({ [groupId]: Y });
    expect(home.owedLines).toEqual([formatMoney(300000, "INR")]);
    expect(home.settleItems.filter((it) => it.net > 0).reduce((t, it) => t + it.net, 0)).toBe(300000);
    expect(net[Y]).toBe(300000);
    const data = await loadGroup(groupId, { events: false, viewer: Y });
    expect(data!.transfers.filter((t) => t.to === Y).reduce((t, x) => t + x.amount, 0)).toBe(300000);

    // Recap, November.
    const insightGroup = () => ({
      currency: "INR",
      myId: Y,
      expenses: full.expenses.map((e) => ({ id: e.id, amount: e.amount, kind: e.kind, category: e.category, spentAt: e.spentAt, createdAt: e.createdAt, paidById: e.paidById, payers: e.payers, shares: e.shares.map((s) => ({ memberId: s.memberId, amount: s.amount })) })),
    });
    const opts = { now: day("2026-11-16"), tz: "Asia/Kolkata", currency: "INR", toChart: (a: number) => a } as const;
    const mine = computeInsights([insightGroup()], { ...opts, view: "share", grain: "m" });
    expect(mine.bars.at(-1)!.value).toBe(400000); // header
    expect(mine.me).toEqual({ share: 400000, paid: 900000, net: 500000 });
    expect(recapDiffLabel(mine.me.net)).toBe("More than your share");
    expect(recapDiffLabel(mine.me.net)).not.toMatch(/owed/i);
    expect(mine.me.net - net[Y]).toBe(200000); // exactly R's payment (the Recap ignores payments, Home counts them)
    expect(mine.categories).toEqual([{ id: "accommodation", amount: 300000 }, { id: "food", amount: 100000 }]);
    const pcts = percentsTo100(mine.categories.map((c) => c.amount));
    expect(pcts).toEqual([75, 25]);
    expect(mine.categories.reduce((t, c) => t + c.amount, 0)).toBe(400000);
    const spent = computeInsights([insightGroup()], { ...opts, view: "spent", grain: "m" });
    expect(spent.bars.at(-1)!.value).toBe(1200000); // "Group total"

    // Search summary: "2 expenses · ₹12,000 spent · my cut ₹4,000".
    const rows = full.expenses.map((e) => ({ item: { id: e.id, kind: "expense", amount: e.amount, category: e.category, refund: false }, g: { group: { currency: "INR" } } }));
    const sum = recap(recapRows(rows, ({ item }) => full.expenses.find((e) => e.id === item.id)!.shares.find((s) => s.memberId === Y)?.amount ?? 0));
    expect(`${sum.count} expenses · ${formatMoney(sum.totals[0].spent, "INR")} spent · my cut ${formatMoney(sum.totals[0].mine, "INR")}`).toBe("2 expenses · ₹12,000 spent · my cut ₹4,000");

    // Charts: the category total is 900000 + 300000.
    const rep = tripReport({ name: "Agree", currency: "INR", members: g.members, expenses: full.expenses, transfers: smartSettle(net), tz: "Asia/Kolkata" });
    expect(rep.total).toBe(1200000);
    expect(rep.categories.map((c) => c.amount)).toEqual([900000, 300000]);
    expect(rep.categories.reduce((t, c) => t + c.pct, 0)).toBe(100);

    // Record both Smart Settle payments: everything is 0, Home says all square, and the Recap has not moved.
    await db.payment.create({ data: { groupId, fromId: M, toId: Y, amount: 300000, createdById: M, createdAt: day("2026-11-13") } });
    await db.payment.create({ data: { groupId, fromId: M, toId: R, amount: 100000, createdById: M, createdAt: day("2026-11-13") } });
    full = await load();
    net = netBalances([Y, R, M], full.expenses, full.payments);
    expect(net).toEqual({ [Y]: 0, [R]: 0, [M]: 0 });
    const after = await loadOverview({ [groupId]: Y });
    expect(after.owedLines).toEqual([]);
    expect(after.oweLines).toEqual([]);
    expect(after.settleItems).toEqual([]);
    const again = computeInsights([insightGroup()], { ...opts, view: "share", grain: "m" });
    expect(again.bars.at(-1)!.value).toBe(400000);
    expect(again.me).toEqual({ share: 400000, paid: 900000, net: 500000 });
  });
});
