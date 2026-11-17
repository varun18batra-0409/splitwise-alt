import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { settledPercent, settleHeadline } from "@/lib/settle-ui";
import { wrapSlides } from "@/lib/wrapped";
import { reportText, type TripReport } from "@/lib/trip-report";

// Batch B4, step 5 (GP-2): someone who has left only knows their own side. They are "square" (they owe nobody and nobody owes them);
// no screen or shared text says "Nobody owes anybody" or "Everyone's square" for them, because that is a claim about other people's money.
//
// Fixture: Meera pays Dinner ₹12,000 (1200000), split Asha / Ravi / Meera 400000 each. Asha pays Meera 400000, then leaves.
//   Balances: Meera +400000, Ravi -400000, Asha 0 (sum 0). Smart Settle for everyone: Ravi -> Meera 400000.
//   Asha's scoped view: no transfers. Her own payments 400000, left 0 -> 100%. Meera: 400000 paid, 400000 left -> 50%.

const BANNED = [/Nobody owes anybody/i, /Everyone.s square/i, /All square/i];

describe("settleHeadline and the wrapped ending", () => {
  it("a leaver is 'You’re square' in every line, picture and share text", () => {
    const w = settleHeadline({ leaver: true });
    expect(w.headline).toBe("You’re square");
    expect(w.line).toBe("You don’t owe anyone here, and no one owes you.");
    for (const text of [w.headline, w.line, w.nice, w.picture, w.share("Goa trip")]) for (const bad of BANNED) expect(text).not.toMatch(bad);
  });
  it("everyone else keeps the words they have today", () => {
    const w = settleHeadline({ leaver: false });
    expect([w.headline, w.line, w.nice, w.picture]).toEqual(["All square", "Nobody owes anybody here.", "Nobody owes anybody. Nice one.", "Nobody owes anybody."]);
    expect(w.share("Goa trip")).toBe("Goa trip: all square 🎉 Nobody owes anybody.");
  });
  it("Wrapped ends 'You’re square' for a leaver, 'All square' for everyone else", () => {
    const g = { name: "Goa", currency: "INR", tz: "Asia/Kolkata", people: [{ id: "a", name: "Asha" }, { id: "m", name: "Meera" }], expenses: [{ description: "Dinner", amount: 1200000, category: "food", paidById: "m", spentAt: new Date("2026-11-10T12:00:00Z"), createdAt: new Date("2026-11-10T12:00:00Z") }], stillToSettle: 0, myId: "a" };
    const outro = (leaver: boolean) => wrapSlides({ ...g, leaver }).slides.at(-1)!;
    expect(outro(true).headline).toBe("You’re square");
    expect(outro(false).headline).toBe("All square");
  });
  it("the shared trip report says 'Settled up on my side ✅' for a leaver", () => {
    const r: TripReport = { name: "Goa", trip: true, currency: "INR", total: 1200000, count: 1, from: "2026-11-10", to: "2026-11-10", days: 1, perDay: 0, people: 3, perPerson: 400000, categories: [], biggest: null, topPayer: null, busiestDay: null, shares: [], settle: [], viewerLeft: true };
    expect(reportText(r)).toContain("Settled up on my side ✅");
    expect(reportText(r)).not.toContain("All settled");
  });
  it("Asha's progress is 100, Meera's is 50", () => {
    expect(settledPercent(400000, 0)).toBe(100);
    expect(settledPercent(400000, 400000)).toBe(50);
  });
  it("the screens use settleHeadline (source check, so a later edit cannot quietly bring the old words back)", () => {
    for (const f of ["src/app/groups/[id]/settle/page.tsx", "src/app/groups/[id]/square-image/route.tsx", "src/app/groups/[id]/_components/BalancesTab.tsx"]) {
      expect(readFileSync(f, "utf8"), f).toContain("settleHeadline(");
    }
    // the Square page has its own wording function in lib/square.ts (squareWords), a different name from the Settle-up one
    expect(readFileSync("src/app/groups/[id]/square/page.tsx", "utf8")).toContain("squareWords(");
    expect(readFileSync("src/app/groups/[id]/wrapped/page.tsx", "utf8")).toContain("leaver: Boolean(data.leaver)");
    expect(readFileSync("src/app/groups/[id]/wrapped-image/route.tsx", "utf8")).toContain("leaver: Boolean(data.leaver)");
    expect(readFileSync("src/app/groups/[id]/report/page.tsx", "utf8")).toContain("You’re settled ✅");
  });
});

// The database half (throwaway copy only; skipped where there is no Prisma client).
const dbReady = await import("@/lib/db").then(() => true, () => false);
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(f: T) => f }));

describe.skipIf(!dbReady)("a leaver's scoped numbers (database)", () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  let groupId = "";
  afterAll(async () => {
    const { db } = await import("@/lib/db");
    await db.group.deleteMany({ where: { id: groupId } }).catch(() => {});
  });
  it("balances, scoped transfers and settled percent", async () => {
    const { db } = await import("@/lib/db");
    const { loadGroup, loadGroupSettle } = await import("@/lib/group-data");
    const { netBalances } = await import("@/lib/balances");
    const { smartSettle } = await import("@/lib/settle");
    const d = (s: string) => new Date(`${s}T06:00:00Z`);
    const g = await db.group.create({
      data: {
        name: `Leaver words ${stamp}`, type: "trip", currency: "INR", inviteCode: `lw-${stamp}`,
        members: { create: [{ name: "Asha", createdAt: d("2026-11-01") }, { name: "Ravi", createdAt: d("2026-11-01") }, { name: "Meera", createdAt: d("2026-11-01") }] },
      },
      include: { members: true },
    });
    groupId = g.id;
    const id = (n: string) => g.members.find((m) => m.name === n)!.id;
    const [A, R, M] = [id("Asha"), id("Ravi"), id("Meera")];
    await db.expense.create({
      data: {
        groupId, description: "Dinner", splitType: "equal", forMode: "everyone", amount: 1200000, originalAmount: 1200000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 1200000,
        paidById: M, createdById: M, createdAt: d("2026-11-10"), spentAt: d("2026-11-10"),
        shares: { create: [{ memberId: A, amount: 400000 }, { memberId: R, amount: 400000 }, { memberId: M, amount: 400000 }] },
      },
    });
    await db.payment.create({ data: { groupId, fromId: A, toId: M, amount: 400000, createdById: A, createdAt: d("2026-11-11") } });
    await db.member.update({ where: { id: A }, data: { leftAt: d("2026-11-12") } });

    const full = await db.group.findUnique({ where: { id: groupId }, include: { expenses: { include: { shares: true } }, payments: true } });
    const net = netBalances([A, R, M], full!.expenses, full!.payments);
    expect(net).toEqual({ [A]: 0, [R]: -400000, [M]: 400000 });
    expect(Object.values(net).reduce((t, x) => t + x, 0)).toBe(0);
    expect(smartSettle(net)).toEqual([{ from: R, to: M, amount: 400000 }]);

    const asha = await loadGroup(groupId, { events: false, viewer: A });
    expect(asha!.leaver).toBeTruthy();
    expect(asha!.transfers).toEqual([]);
    const meera = await loadGroup(groupId, { events: false, viewer: M });
    expect(meera!.transfers).toEqual([{ from: R, to: M, amount: 400000 }]);

    const ashaS = await loadGroupSettle(groupId, A);
    expect(settledPercent(ashaS!.paidSoFar, ashaS!.transfers.reduce((t, x) => t + x.amount, 0))).toBe(100);
    expect(ashaS!.paidSoFar).toBe(400000); // only payments she is in
    const meeraS = await loadGroupSettle(groupId, M);
    expect(settledPercent(meeraS!.paidSoFar, meeraS!.transfers.reduce((t, x) => t + x.amount, 0))).toBe(50);
  });
  it("a leaver's payment count is their own payments only, the same rows as 'paid so far'", async () => {
    const { db } = await import("@/lib/db");
    const { loadGroupSettle } = await import("@/lib/group-data");
    const g = await db.group.findUnique({ where: { id: groupId }, include: { members: true } });
    const id = (n: string) => g!.members.find((m) => m.name === n)!.id;
    const [A, R, M] = [id("Asha"), id("Ravi"), id("Meera")];
    // Hand-worked: the group now holds 2 payments. Asha -> Meera 4,00,000 paise (Asha is in it) and Ravi -> Meera 1,00,000 (Asha is not).
    await db.payment.create({ data: { groupId, fromId: R, toId: M, amount: 100000, createdById: R, createdAt: new Date("2026-11-11T07:00:00Z") } });
    const asha = await loadGroupSettle(groupId, A);
    expect(asha!.paymentCount).toBe(1); // her own one, not the group's 2
    expect(asha!.paidSoFar).toBe(400000);
    const meera = await loadGroupSettle(groupId, M);
    expect(meera!.paymentCount).toBe(2); // Meera is in both
    expect(meera!.paidSoFar).toBe(500000);
    // Meera: 5,00,000 paid and 3,00,000 still to come = 500000 / 800000 = 62.5, shown as 63.
    expect(settledPercent(meera!.paidSoFar, meera!.transfers.reduce((t, x) => t + x.amount, 0))).toBe(63);
  });
});
