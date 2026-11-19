import { afterAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Speed stage 3: the Balances tab draws exactly the same page whether its numbers come from every expense and share (the full method)
// or from the database's one statement (the summary). The saved rate is faked so the "≈" lines are drawn too.
vi.mock("@/lib/rate-cache", async (orig) => ({ ...(await orig<typeof import("@/lib/rate-cache")>()), displayRate: async () => ({ ok: true, rate: "2.8", date: "2026-11-10" }) }));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));

const { db } = await import("@/lib/db");
const { eraseGroups } = await import("@/lib/purge");
const { loadBalancesSummary, loadGroupView } = await import("@/lib/group-data");
const { balancesDataFull, balancesDataSummary, buildGroupView, buildSummaryView } = await import("@/app/groups/[id]/_components/view");
const { BalancesTab } = await import("@/app/groups/[id]/_components/BalancesTab");
const { PeopleTab } = await import("@/app/groups/[id]/_components/PeopleTab");

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
afterAll(async () => {
  await eraseGroups(groupIds);
});

const d = (n: number, h = 10) => new Date(Date.UTC(2026, 10, n, h));
async function trip() {
  const g = await db.group.create({
    data: {
      name: `HTML ${stamp}`, inviteCode: `html-${stamp}`, currency: "INR", cardMarkupBp: 300,
      members: { create: ["A", "B", "C", "D"].map((name, i) => ({ name, createdAt: new Date(Date.UTC(2026, 9, 1, 10, i)) })) },
    },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  groupIds.push(g.id);
  const [A, B, C, D] = g.members.map((m) => m.id);
  const ex = (description: string, amount: number, paidById: string, shares: [string, number][], day: number, more: Record<string, unknown> = {}) =>
    db.expense.create({
      data: {
        groupId: g.id, description, splitType: "exact", amount, originalAmount: amount, convertedAmount: amount, paidById, createdById: paidById, createdAt: d(day), category: "food",
        shares: { create: shares.map(([memberId, amt]) => ({ memberId, amount: amt })) }, ...more,
      },
    });
  await ex("Hotel", 100000, A, [[A, 33334], [B, 33333], [C, 33333]], 1);
  await ex("Dinner", 50000, B, [A, B, C, D].map((m) => [m, 12500] as [string, number]), 2, { payers: JSON.stringify([{ m: B, a: 30000 }, { m: C, a: 20000 }]) });
  await ex("Returned jacket", 9000, D, [[A, 4500], [D, 4500]], 3, { kind: "refund" });
  await ex("Deleted taxi", 70000, C, [[A, 35000], [C, 35000]], 4, { deletedAt: d(4, 11), deletedById: C });
  await ex("Shopping abroad", 10300, A, [[B, 5150], [D, 5150]], 5, { markupAmount: 300, markupBp: 300, originalCurrency: "THB", exchangeRate: "2.8", paymentMethod: "card", rateSource: "api" });
  await ex("Boat", 10000, B, [[A, 10000]], 6, { payers: JSON.stringify([{ m: B, a: 5000 }, { m: C, a: 5000 }]) });
  await db.payment.create({ data: { groupId: g.id, fromId: B, toId: A, amount: 20000, createdById: B, createdAt: d(5, 12) } });
  await db.payment.create({ data: { groupId: g.id, fromId: D, toId: C, amount: 5000, createdById: D, createdAt: d(5, 13) } });
  return { gid: g.id, A, B, C, D };
}

describe("Balances: the same page from the full method and from the summary", () => {
  for (const who of ["A", "D"] as const) {
    for (const why of [undefined, "D", "B"] as const) {
      it(`viewed by ${who}, ${why ? `with the ${why} Why? open` : "nothing open"}`, async () => {
        const t = await trip();
        const me = t[who];
        const open = why ? t[why] : undefined;
        const full = (await loadGroupView(t.gid, { viewer: me, events: false }))!;
        const fv = await buildGroupView(full, me, "Asia/Kolkata");
        const summary = (await loadBalancesSummary(t.gid, me, { why: open }))!;
        const sv = await buildSummaryView(summary, me, "Asia/Kolkata");

        const html = (v: typeof fv, data: ReturnType<typeof balancesDataFull>) => renderToStaticMarkup(createElement(BalancesTab, { v, data, why: open }));
        const before = html(fv, balancesDataFull(fv));
        const after = html(sv, balancesDataSummary(summary));
        expect(after).toBe(before);
        // It really drew the numbers (not two empty pages): A's balance 389.66 (38966 paise), the Thai baht card, the 5 expenses.
        expect(before).toContain('data-balance="₹389.66"');
        expect(before).toContain("spent across 5 expenses");
        expect(before).toContain("THB expenses");

        const people = (v: typeof fv, data: ReturnType<typeof balancesDataFull>) => renderToStaticMarkup(createElement(PeopleTab, { v, data, why: open }));
        expect(people(sv, balancesDataSummary(summary))).toBe(people(fv, balancesDataFull(fv)));
      });
    }
  }
});
