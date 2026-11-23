import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// VA3-2: money with one person (no group) shows in Home's Latest, labelled with their name. Nothing else on Home reads pairs for this:
// "Your month" stays as it was. Hand-worked (paise): Asha paid Lunch 60000 with Rohan, shared 30000 each; the pair row says Rohan owes Asha 30000.
// Money checks at the end: shares add up to the amount, the two balances add up to 0.
vi.mock("@/lib/rate-cache", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-cache")>()), displayRate: async () => ({ ok: false, message: "no rate" }) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

const { db } = await import("@/lib/db");
const { loadOverview } = await import("@/lib/overview");
const { loadHomeRows } = await import("@/lib/home/home-data");
const { ensureAccountPair } = await import("@/lib/direct-db");
const { buildActivity } = await import("@/lib/activity");
const { pairPath } = await import("@/lib/direct");
const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { ActivityRow } = await import("@/components/ActivityRow");
const { mkAccount, mkSharedGroup, addExpense, wipe } = await import("./helpers/direct-fixtures");
const { checkBooks } = await import("./helpers/money-invariants");

let A = "", R = "";
let pair = { groupId: "", aRow: "", rRow: "" };
beforeAll(async () => {
  A = (await mkAccount("pla", "Asha")).id;
  R = (await mkAccount("plr", "Rohan")).id;
  await mkSharedGroup("pl", [{ id: A, name: "Asha" }, { id: R, name: "Rohan" }]);
  const p = await ensureAccountPair({ id: A }, R, { currency: "INR", myName: "Asha" });
  if (!p.ok) throw new Error("refused");
  pair = { groupId: p.groupId, aRow: p.myId, rRow: p.otherId };
  const e = await addExpense(pair.groupId, { paidBy: pair.aRow, amount: 60000, shares: { [pair.aRow]: 30000, [pair.rRow]: 30000 } });
  await db.expense.update({ where: { id: e.id }, data: { description: "Lunch" } });
});
afterAll(async () => {
  await wipe([A, R]);
});

describe("whole units on Home's Latest", () => {
  it("a ₹48.50 row reads ₹49 on Home (whole) and ₹48.50 in a group; the exact amount stays in the row", async () => {
    const e = await addExpense(pair.groupId, { paidBy: pair.aRow, amount: 4850, shares: { [pair.aRow]: 2425, [pair.rRow]: 2425 } });
    await db.expense.update({ where: { id: e.id }, data: { description: "Coffee" } });
    try {
      const full = await db.expense.findUniqueOrThrow({ where: { id: e.id }, include: { shares: true } });
      const item = buildActivity([full], [], pair.aRow, [], new Set())[0];
      const render = (whole: boolean) => renderToStaticMarkup(React.createElement(ActivityRow, { item, currency: "INR", nameOf: (id: string) => (id === pair.aRow ? "You" : "Rohan"), whole }));
      const text = (html: string) => [...html.matchAll(/>([^<]+)</g)].map((m) => m[1]).join(" ");
      expect(text(render(true))).toContain("₹49");
      expect(text(render(true))).not.toContain("48.50");
      expect(text(render(false))).toContain("₹48.50");
      expect(render(true)).toContain("48.50"); // the exact amount is still there (tooltip)
      const net = await checkBooks(pair.groupId); // Lunch 30,000 + Coffee 2,425: Rohan owes Asha 32,425
      expect([net[pair.aRow], net[pair.rRow]]).toEqual([32425, -32425]);
    } finally {
      await db.expense.delete({ where: { id: e.id } }); // so no other test sees it
    }
  });
});

describe("Home's Latest with a person", () => {
  it("Lunch ₹600 with Rohan is in Latest, labelled Rohan, opening their page; the month card does not read pairs", async () => {
    const o = await loadOverview({ [pair.groupId]: pair.aRow });
    expect(o.pairRows.map((g) => g.group.id)).toEqual([pair.groupId]);
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const rows = await loadHomeRows(o.all, { tz: "UTC", now, today }, o.pairRows);
    const mine = rows.recent.get(pair.groupId);
    expect(mine?.expenses.map((e) => e.description)).toEqual(["Lunch"]);
    const entry = o.pairRows[0];
    const items = buildActivity(mine!.expenses, mine!.payments, entry.myId, [], new Set());
    expect(items.map((i) => i.title)).toEqual(["Lunch"]);
    const other = entry.group.members.find((m) => m.id !== entry.myId);
    expect(other?.name).toBe("Rohan");
    // The row opens the person's page: the link is made by the same function Home uses, checked against a literal built from the id by hand.
    expect(pairPath(entry.group.id)).toBe("/people/" + pair.groupId);
    // Without the pairs, Latest is exactly as before (nothing from the pair).
    const without = await loadHomeRows(o.all, { tz: "UTC", now, today });
    expect(without.recent.has(pair.groupId)).toBe(false);
    // "Your month" never saw the pair either way.
    expect(rows.monthGroups).toHaveLength(o.all.length); // one entry per ordinary group, none for the pair
    const net = await checkBooks(pair.groupId);
    expect([net[pair.aRow], net[pair.rRow]]).toEqual([30000, -30000]);
  });
});
