import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { loadGroup, loadGroupView, loadMyGroups, loadMyGroupsLean, loadMyGroupsLight } from "@/lib/group-data";
import { spentAmount } from "@/lib/payers";

// MA-3 against a real (throwaway) database: the Goa trip of tests/leaver-as-of.test.ts, in paise (rupees x 100), read through every
// loader a leaver's screens use. Ravi left on 1 Nov. Hotel was edited and Snacks deleted after that.
//   Ravi sees: Hotel Rs 12,000, Snacks Rs 600 (not deleted), Taxi Rs 900: spent Rs 13,500 over 3 expenses, and his balance is 0.
//   The full ledger: Asha +14,700, Priya -14,700, Ravi 0 (sum 0). (Rs 14,700 = 1,470,000 paise.)
// Needs the generated database client, so it runs where the other database tests run.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const at = (md: string, time = "10:00") => new Date(`2026-${md}T${time}:00Z`);
const RS = 100;

async function goa(label: string) {
  const g = await db.group.create({
    data: {
      name: `Goa ${label} ${stamp}`, inviteCode: `ao-${label}-${stamp}`, currency: "INR",
      members: { create: [{ name: "Asha", createdAt: at("10-27") }, { name: "Ravi", createdAt: at("10-27", "10:01") }, { name: "Priya", createdAt: at("10-27", "10:02") }] },
    },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  groupIds.push(g.id);
  const [A, R, P] = g.members.map((m) => m.id);
  const mk = (description: string, amount: number, paidById: string, shares: Record<string, number>, createdAt: Date, extra: Record<string, unknown> = {}) =>
    db.expense.create({
      data: { groupId: g.id, description, splitType: "exact", amount, originalAmount: amount, convertedAmount: amount, paidById, createdById: paidById, createdAt, shares: { create: Object.entries(shares).map(([memberId, amt]) => ({ memberId, amount: amt })) }, ...extra },
    });
  const ev = (kind: string, text: string, actorId: string, createdAt: Date, touches: string[], ref: { expenseId?: string; paymentId?: string }, undo = "") =>
    db.groupEvent.create({ data: { groupId: g.id, actorId, kind, text, createdAt, touches: touches.join(","), expenseId: ref.expenseId ?? null, paymentId: ref.paymentId ?? null, undo } });

  const hotelBefore = { description: "Hotel", category: "other", amount: 12000 * RS, splitType: "exact", forMode: "selected", paidById: A, payers: "", kind: "expense", notes: "", shares: [{ memberId: A, amount: 6000 * RS }, { memberId: P, amount: 6000 * RS }] };
  const hotel = await mk("Hotel + Priya's flight", 25000 * RS, A, { [A]: 10000 * RS, [P]: 15000 * RS }, at("10-28"), { editedAt: at("11-05") });
  const snacks = await mk("Snacks", 600 * RS, P, { [A]: 300 * RS, [P]: 300 * RS }, at("10-29"), { deletedAt: at("11-06"), deletedById: P });
  const taxi = await mk("Taxi", 900 * RS, P, { [A]: 300 * RS, [R]: 300 * RS, [P]: 300 * RS }, at("10-30"));
  const pay = await db.payment.create({ data: { groupId: g.id, fromId: R, toId: P, amount: 300 * RS, createdAt: at("10-31"), createdById: R } });
  await ev("expense_added", "added Hotel", A, at("10-28"), [A, P], { expenseId: hotel.id });
  await ev("expense_added", "added Snacks", P, at("10-29"), [A, P], { expenseId: snacks.id });
  await ev("expense_added", "added Taxi", P, at("10-30"), [A, R, P], { expenseId: taxi.id });
  await ev("payment_recorded", "recorded a payment", R, at("10-31"), [R, P], { paymentId: pay.id });
  await db.member.update({ where: { id: R }, data: { leftAt: at("11-01", "12:00") } });
  await ev("expense_edited", "changed Hotel", A, at("11-05"), [A, P], { expenseId: hotel.id }, JSON.stringify({ type: "expense_revert", expenseId: hotel.id, before: hotelBefore }));
  await ev("expense_deleted", "deleted Snacks", P, at("11-06"), [A, P], { expenseId: snacks.id }, JSON.stringify({ type: "expense_restore", expenseId: snacks.id }));
  return { g, A, R, P, hotel, snacks, taxi, pay };
}

afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

describe("Goa as of 1 Nov, through every loader", () => {
  it("the full ledger is Asha +14,700, Priya -14,700, Ravi 0 (sum 0)", async () => {
    const s = await goa("full");
    const full = await loadGroup(s.g.id);
    expect(full!.net).toEqual({ [s.A]: 14700 * RS, [s.P]: -14700 * RS, [s.R]: 0 });
    expect(Object.values(full!.net).reduce((n, x) => n + x, 0)).toBe(0);
  });

  it("loadGroupView: Ravi sees Hotel as it was, Snacks not deleted, Taxi: 13,500 over 3; his balance is 0", async () => {
    const s = await goa("view");
    const v = await loadGroupView(s.g.id, { viewer: s.R });
    const hotel = v!.group.expenses.find((e) => e.id === s.hotel.id)!;
    expect(hotel.description).toBe("Hotel");
    expect(hotel.amount).toBe(12000 * RS);
    expect(hotel.shares.map((x) => x.amount).sort((a, b) => a - b)).toEqual([6000 * RS, 6000 * RS]);
    expect(hotel.editedAt).toBeNull();
    expect(v!.group.expenses.find((e) => e.id === s.snacks.id)!.deletedAt).toBeNull();
    expect(v!.expenses.length).toBe(3);
    expect(v!.expenses.reduce((n, e) => n + spentAmount(e), 0)).toBe(13500 * RS);
    expect(v!.net).toEqual({ [s.R]: 0 });
  });

  it("loadMyGroups, loadMyGroupsLean and loadMyGroupsLight agree: 13,500, 3 expenses, balance 0", async () => {
    const s = await goa("lists");
    const m = { [s.g.id]: s.R };
    const [full] = await loadMyGroups(m);
    const [lean] = await loadMyGroupsLean(m);
    const [light] = await loadMyGroupsLight(m);
    for (const e of [full, lean]) {
      expect(e.spent).toBe(13500 * RS);
      expect(e.expenses.length).toBe(3);
      expect(e.myBalance).toBe(0);
    }
    expect(light.spent).toBe(13500 * RS);
    expect(light.expenseCount).toBe(3);
    expect(light.myBalance).toBe(0);
  });

  it("someone still in the group (Priya) sees today's rows and today's totals", async () => {
    const s = await goa("member");
    const [light] = await loadMyGroupsLight({ [s.g.id]: s.P });
    expect(light.spent).toBe(25900 * RS); // Hotel 25,000 + Taxi 900 (Snacks is deleted)
    expect(light.expenseCount).toBe(2);
  });

  it("M1: a photo-only change after he left does not hide Hotel: still 1,350,000 over 3, in every loader", async () => {
    const s = await goa("photo");
    // Put Hotel back as it was and make the only change after he left a bill-photo change (edited stamp, no saved 'before').
    await db.groupEvent.deleteMany({ where: { groupId: s.g.id, kind: "expense_edited" } });
    await db.expenseShare.deleteMany({ where: { expenseId: s.hotel.id } });
    await db.expenseShare.createMany({ data: [{ expenseId: s.hotel.id, memberId: s.A, amount: 6000 * RS }, { expenseId: s.hotel.id, memberId: s.P, amount: 6000 * RS }] });
    await db.expense.update({ where: { id: s.hotel.id }, data: { description: "Hotel", amount: 12000 * RS, originalAmount: 12000 * RS, convertedAmount: 12000 * RS, editedAt: at("11-05") } });
    await db.groupEvent.create({ data: { groupId: s.g.id, actorId: s.A, kind: "expense_edited", text: "changed the bill photo on Hotel", createdAt: at("11-05"), expenseId: s.hotel.id } });
    const v = await loadGroupView(s.g.id, { viewer: s.R });
    expect(v!.expenses.length).toBe(3);
    expect(v!.expenses.reduce((n, e) => n + spentAmount(e), 0)).toBe(13500 * RS);
    const m = { [s.g.id]: s.R };
    const [full] = await loadMyGroups(m);
    const [lean] = await loadMyGroupsLean(m);
    const [light] = await loadMyGroupsLight(m);
    expect([full.spent, lean.spent, light.spent]).toEqual([13500 * RS, 13500 * RS, 13500 * RS]);
    expect([full.expenses.length, lean.expenses.length, light.expenseCount]).toEqual([3, 3, 3]);
  });

  it("M3: the group page and Home's loaders give the same numbers for Ravi", async () => {
    const s = await goa("same");
    const v = await loadGroupView(s.g.id, { viewer: s.R });
    const [light] = await loadMyGroupsLight({ [s.g.id]: s.R });
    expect(light.spent).toBe(v!.expenses.reduce((n, e) => n + spentAmount(e), 0));
    expect(light.expenseCount).toBe(v!.expenses.length);
    expect(light.myBalance).toBe(0);
  });
});
