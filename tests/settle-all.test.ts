import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { loadGroup } from "@/lib/group-data";
import { planKey, settleAllAndClose } from "@/lib/settle-all";
import { undoEvent } from "@/lib/undo";
import { cleanPeriod, inPeriod, monthLabel, periodsOf, recap } from "@/lib/search";
import { nudgeLink } from "@/lib/nudge";
import type { RateAnswer } from "@/lib/rate-cache";

// "Settled outside the app": one tap records every Smart Settle payment and
// closes the group; one Undo puts it all back.

let groupId = "";
let me = "", a = "", b = "";
const rate = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-10-14" });
const input = (over: Partial<SaveExpenseInput>): SaveExpenseInput => ({
  groupId, name: "Dinner", category: "", amount: "900", currency: "INR", paidById: me, forMode: "everyone",
  selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
  markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
});

beforeAll(async () => {
  const g = await db.group.create({
    data: { name: "Settle-all test", currency: "INR", inviteCode: `sa-${Date.now()}`, members: { create: [{ name: "Me" }, { name: "A" }, { name: "B" }] } },
    include: { members: true },
  });
  groupId = g.id;
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  [me, a, b] = [id("Me"), id("A"), id("B")];
  await saveExpense(input({ amount: "900" }), me, rate);
  await saveExpense(input({ amount: "300", paidById: a }), a, rate);
});

afterAll(async () => {
  await db.groupEvent.deleteMany({ where: { groupId } });
  await db.payment.deleteMany({ where: { groupId } });
  await db.expenseShare.deleteMany({ where: { expense: { groupId } } });
  await db.expense.deleteMany({ where: { groupId } });
  await db.member.deleteMany({ where: { groupId } });
  await db.group.delete({ where: { id: groupId } });
});

describe("settle everything and close", () => {
  it("refuses a stale plan", async () => {
    const r = await settleAllAndClose(groupId, me, "old-plan");
    expect(r.ok).toBe(false);
  });

  it("records every payment, closes the group, and everyone ends at zero", async () => {
    const before = await loadGroup(groupId);
    expect(before!.transfers.length).toBeGreaterThan(0);
    const r = await settleAllAndClose(groupId, a, planKey(before!.transfers));
    if (!r.ok) throw new Error(r.error);
    const after = await loadGroup(groupId);
    expect(after!.group.closed).toBe(true);
    expect(Object.values(after!.net).every((n) => n === 0)).toBe(true);
    expect(after!.payments).toHaveLength(before!.transfers.length);
    const ev = await db.groupEvent.findUniqueOrThrow({ where: { id: r.eventId! } });
    expect(ev.kind).toBe("group_settled_closed");
    expect(JSON.parse(ev.details).length).toBe(before!.transfers.length);

    // One undo: payments out, group open, balances back.
    const u = await undoEvent(r.eventId!, me);
    if (!u.ok) throw new Error(u.error);
    const undone = await loadGroup(groupId);
    expect(undone!.group.closed).toBe(false);
    expect(undone!.payments).toHaveLength(0);
    expect(undone!.net).toEqual(before!.net);

    // Redo works too.
    expect((await undoEvent(u.eventId!, me)).ok).toBe(true);
    const redone = await loadGroup(groupId);
    expect(redone!.group.closed).toBe(true);
    expect(Object.values(redone!.net).every((n) => n === 0)).toBe(true);
  });
});

describe("search by month and year", () => {
  const d = (s: string) => new Date(s);
  it("labels months and lists periods newest first", () => {
    expect(monthLabel("2026-10")).toBe("Oct 2026");
    expect(periodsOf([d("2026-10-02T10:00:00Z"), d("2025-12-31T20:00:00Z"), d("2026-09-01T10:00:00Z")])).toEqual({
      months: ["2026-10", "2026-09", "2026-01"], // 31 Dec 20:00 UTC is already 1 Jan in India
      years: ["2026"],
    });
  });
  it("filters by month or year, and ignores bad input", () => {
    expect(cleanPeriod("2026", "2026-13")).toEqual({ year: "2026", month: undefined });
    expect(cleanPeriod("2026", "2026-10")).toEqual({ year: undefined, month: "2026-10" });
    expect(inPeriod(d("2026-10-31T20:00:00Z"), { month: "2026-11" })).toBe(true);
    expect(inPeriod(d("2026-05-01T10:00:00Z"), { year: "2026" })).toBe(true);
    expect(inPeriod(d("2025-05-01T10:00:00Z"), { year: "2026" })).toBe(false);
  });
  it("recaps spending, your share and the top category", () => {
    const r = recap([
      { amount: 1000, category: "food", currency: "INR", mine: 500 },
      { amount: 3000, category: "transport", currency: "INR", mine: 1000 },
      { amount: 500, category: "food", currency: "INR", mine: 0 },
    ]);
    expect(r.count).toBe(3);
    expect(r.totals).toEqual([{ currency: "INR", spent: 4500, mine: 1500 }]);
    expect(r.topCategory?.id).toBe("transport"); // by money: 3,000 beats 1,500
  });
});

describe("WhatsApp reminder", () => {
  it("goes straight to their chat when we have the number", () => {
    expect(nudgeLink("+91 98765 43210", "Ravi", "₹500", "Goa")).toMatch(/^https:\/\/wa\.me\/919876543210\?text=Hey%20Ravi/);
    expect(nudgeLink("9876543210", "Ravi", "₹500", "Goa")).toMatch(/^https:\/\/wa\.me\/919876543210\?/);
    expect(nudgeLink("", "Ravi", "₹500", "Goa")).toMatch(/^https:\/\/wa\.me\/\?text=/);
  });
});
