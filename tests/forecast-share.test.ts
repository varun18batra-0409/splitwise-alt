import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { monthInsights } from "@/lib/home/insights-db";
import { tripReport } from "@/lib/trip-report";

// INV-07: the forecast's "Your share" follows each bill's own split, and the trip report's dates ignore game results.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groups: string[] = [];
afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groups } } });
});

let made = 0;
async function flat(currency: string) {
  const g = await db.group.create({
    data: { name: `Forecast ${currency} ${stamp}`, type: "home", currency, inviteCode: `fc-${currency}-${stamp}-${++made}`, members: { create: [{ name: "A" }, { name: "B" }, { name: "C" }] } },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  groups.push(g.id);
  const id = Object.fromEntries(g.members.map((m) => [m.name, m.id])) as Record<string, string>;
  return { gid: g.id, id, weights: Object.fromEntries(g.members.map((m) => [m.id, m.splitWeight])) };
}
const now = new Date("2026-11-12T06:00:00Z");

describe("forecast 'Your share' uses each bill's own split", () => {
  it("INR: rent 30000 shared by A and B only, Wi-Fi 9000 shared by all three: A's share is 15000 + 3000 = 18000 (not 39000 / 3 = 13000)", async () => {
    const f = await flat("INR");
    await db.bill.create({ data: { groupId: f.gid, name: "Rent", nature: "fixed", amount: 30000, startMonth: "2026-10", payer: f.id.A, split: JSON.stringify({ mode: "some", ids: [f.id.A, f.id.B] }) } });
    await db.bill.create({ data: { groupId: f.gid, name: "Wi-Fi", nature: "fixed", amount: 9000, startMonth: "2026-10", payer: f.id.A, split: JSON.stringify({ mode: "group" }) } });
    const a = await monthInsights(f.gid, [], f.id.A, f.weights, "INR", "Asia/Kolkata", now);
    expect(a.forecast).toEqual({ total: 39000, mine: 18000 });
    // C is not in the rent: only 3000 of the Wi-Fi.
    const c = await monthInsights(f.gid, [], f.id.C, f.weights, "INR", "Asia/Kolkata", now);
    expect(c.forecast).toEqual({ total: 39000, mine: 3000 });
    // Everyone's shares add back up to the total: 18000 + (15000 + 3000) + 3000 = 39000.
    const b = await monthInsights(f.gid, [], f.id.B, f.weights, "INR", "Asia/Kolkata", now);
    expect((a.forecast?.mine ?? 0) + (b.forecast?.mine ?? 0) + (c.forecast?.mine ?? 0)).toBe(39000);
  });

  it("KWD (3 decimals): a bill of 3.000 dinar (3000 fils) shared equally by three is 1000 fils each", async () => {
    const f = await flat("KWD");
    await db.bill.create({ data: { groupId: f.gid, name: "Internet", nature: "fixed", amount: 3000, startMonth: "2026-10", payer: f.id.A, split: JSON.stringify({ mode: "equal" }) } });
    const a = await monthInsights(f.gid, [], f.id.A, f.weights, "KWD", "Asia/Kolkata", now);
    expect(a.forecast).toEqual({ total: 3000, mine: 1000 });
  });

  it("a 'some' bill whose chosen people have all left adds nothing to anyone's share (the real run holds it)", async () => {
    const f = await flat("INR");
    await db.bill.create({ data: { groupId: f.gid, name: "Maid", nature: "fixed", amount: 6000, startMonth: "2026-10", payer: f.id.A, split: JSON.stringify({ mode: "some", ids: [f.id.C] }) } });
    await db.bill.create({ data: { groupId: f.gid, name: "Wi-Fi", nature: "fixed", amount: 9000, startMonth: "2026-10", payer: f.id.A, split: JSON.stringify({ mode: "group" }) } });
    await db.member.update({ where: { id: f.id.C }, data: { leftAt: new Date("2026-11-01T00:00:00Z") } });
    // Only A and B are in the flat now: Wi-Fi 9000 / 2 = 4500 each; the 6000 for C alone is held, so 0 for A.
    const a = await monthInsights(f.gid, [], f.id.A, { [f.id.A]: 100, [f.id.B]: 100 }, "INR", "Asia/Kolkata", now);
    expect(a.forecast).toEqual({ total: 15000, mine: 4500 });
  });

  it("JPY (no decimals): 1000 yen shared by three: 334 / 333 / 333, and every share is whole yen", async () => {
    const f = await flat("JPY");
    await db.bill.create({ data: { groupId: f.gid, name: "Water", nature: "fixed", amount: 1000, startMonth: "2026-10", payer: f.id.A, split: JSON.stringify({ mode: "equal" }) } });
    const shares = [];
    for (const who of ["A", "B", "C"]) shares.push((await monthInsights(f.gid, [], f.id[who], f.weights, "JPY", "Asia/Kolkata", now)).forecast!.mine);
    expect(shares.slice().sort((x, y) => y - x)).toEqual([334, 333, 333]);
    expect(shares.reduce((s, x) => s + x, 0)).toBe(1000);
  });
});

describe("trip report dates leave out game results", () => {
  const d = (s: string) => new Date(`${s}T12:00:00Z`);
  const members = [{ id: "a", name: "A" }, { id: "b", name: "B" }];
  const e = (id: string, day: string, amount: number, kind = "expense") => ({
    id, description: id, amount, kind, category: "food", paidById: "a", spentAt: d(day), createdAt: d(day),
    shares: [{ memberId: "a", amount: amount / 2 }, { memberId: "b", amount: amount / 2 }],
  });
  it("trip 10 to 12 Oct with a card game on 30 Nov: from 10 Oct, to 12 Oct, 3 days, total 3000, 2 expenses", () => {
    const r = tripReport({ name: "Goa", currency: "INR", members, expenses: [e("taxi", "2026-10-10", 1000), e("hotel", "2026-10-12", 2000), e("game", "2026-11-30", 500, "pot")], transfers: [], tz: "Asia/Kolkata" });
    expect([r.from, r.to, r.days]).toEqual(["2026-10-10", "2026-10-12", 3]);
    expect(r.total).toBe(3000); // the game is not spending
    expect(r.count).toBe(2);
    expect(r.perDay).toBe(1000); // 3000 / 3 days, to the rupee
  });
});
