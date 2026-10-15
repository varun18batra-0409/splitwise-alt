import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveExpense, setPaymentDeleted, type SaveExpenseInput } from "@/lib/save-expense";
import { undoEvent, canUndo } from "@/lib/undo";
import { updateGroupBasics, changeGroupCurrency } from "@/lib/group-changes";
import { loadGroup } from "@/lib/group-data";
import { logEvent } from "@/lib/events";
import type { RateAnswer } from "@/lib/rate-cache";

// Every kind of change can be undone (and redone), and undo refuses to
// overwrite newer work. Runs against the real database in its own test group.

let groupId = "";
let me = "", a = "", b = "";
const rate = async (): Promise<RateAnswer> => ({ ok: true, rate: "2.5", date: "2026-10-14" });

const input = (over: Partial<SaveExpenseInput>): SaveExpenseInput => ({
  groupId, name: "Dinner", category: "", amount: "900", currency: "INR", paidById: me, forMode: "everyone",
  selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
  markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
});

async function undo(eventId: string | undefined, by = me) {
  const r = await undoEvent(eventId ?? "", by);
  if (!r.ok) throw new Error(r.error);
  return r.eventId;
}
const net = async () => (await loadGroup(groupId))!.net;

beforeAll(async () => {
  const g = await db.group.create({
    data: { name: "Undo test", currency: "INR", inviteCode: `undo-${Date.now()}`, members: { create: [{ name: "Me" }, { name: "A" }, { name: "B" }] } },
    include: { members: true },
  });
  groupId = g.id;
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  [me, a, b] = [id("Me"), id("A"), id("B")];
});

afterAll(async () => {
  await db.groupEvent.deleteMany({ where: { groupId } });
  await db.payment.deleteMany({ where: { groupId } });
  await db.expenseShare.deleteMany({ where: { expense: { groupId } } });
  await db.expense.deleteMany({ where: { groupId } });
  await db.member.deleteMany({ where: { groupId } });
  await db.group.delete({ where: { id: groupId } });
});

describe("undo and redo", () => {
  it("undoing an added expense deletes it (kept in history); redo brings it back", async () => {
    const r = await saveExpense(input({ name: "Snacks", amount: "300" }), me, rate);
    if (!r.ok) throw new Error(r.error);
    expect((await net())[me]).toBe(20000);

    const undoId = await undo(r.eventId);
    expect((await db.expense.findUniqueOrThrow({ where: { id: r.id } })).deletedAt).not.toBeNull();
    expect((await net())[me]).toBe(0);

    await undo(undoId); // redo
    expect((await db.expense.findUniqueOrThrow({ where: { id: r.id } })).deletedAt).toBeNull();
    expect((await net())[me]).toBe(20000);

    const original = await db.groupEvent.findUniqueOrThrow({ where: { id: r.eventId! } });
    expect(original.undoneAt).not.toBeNull();
    expect(original.undoneById).toBe(me);
  });

  it("undoing an edit puts every field back exactly; redo re-applies it", async () => {
    const r = await saveExpense(input({ name: "Taxi", amount: "600" }), me, rate);
    const id = r.ok ? r.id : "";
    const edit = await saveExpense(
      input({ expenseId: id, name: "Airport taxi", amount: "1000", currency: "THB", paidById: a, forMode: "one", onePersonId: b }),
      a,
      rate,
    );
    if (!edit.ok) throw new Error(edit.error);
    expect((await db.expense.findUniqueOrThrow({ where: { id } })).amount).toBe(250000);

    const undoId = await undo(edit.eventId, b); // anyone in the group can undo
    const back = await db.expense.findUniqueOrThrow({ where: { id }, include: { shares: true } });
    expect([back.description, back.amount, back.originalCurrency, back.paidById, back.forMode]).toEqual(["Taxi", 60000, "INR", me, "everyone"]);
    expect(back.shares.map((s) => s.amount).sort()).toEqual([20000, 20000, 20000]);

    await undo(undoId); // redo
    const again = await db.expense.findUniqueOrThrow({ where: { id }, include: { shares: true } });
    expect([again.description, again.amount, again.originalCurrency, again.paidById]).toEqual(["Airport taxi", 250000, "THB", a]);
    expect(again.shares).toHaveLength(1);
  });

  it("expenses keep the day they were spent; changing it is logged and can be undone", async () => {
    const { dayKey } = await import("@/lib/dates");
    const r = await saveExpense(input({ name: "Breakfast", amount: "200", date: "2026-10-10" }), me, rate);
    if (!r.ok) throw new Error(r.error);
    expect(dayKey((await db.expense.findUniqueOrThrow({ where: { id: r.id } })).spentAt!)).toBe("2026-10-10");

    const edit = await saveExpense(input({ expenseId: r.id, name: "Breakfast", amount: "200", date: "2026-10-11" }), me, rate);
    if (!edit.ok) throw new Error(edit.error);
    const ev = await db.groupEvent.findUniqueOrThrow({ where: { id: edit.eventId! } });
    expect(JSON.parse(ev.details)).toContain("Date: 10 Oct 2026 → 11 Oct 2026");

    await undo(edit.eventId);
    expect(dayKey((await db.expense.findUniqueOrThrow({ where: { id: r.id } })).spentAt!)).toBe("2026-10-10");

    const bad = await saveExpense(input({ name: "Future", amount: "1", date: "2099-01-01" }), me, rate);
    expect(bad.ok).toBe(false);
  });

  it("notes are saved, logged when changed, kept when not sent, and undone", async () => {
    const r = await saveExpense(input({ name: "Cab", amount: "300", notes: "  Rahul paid the toll  " }), me, rate);
    if (!r.ok) throw new Error(r.error);
    expect((await db.expense.findUniqueOrThrow({ where: { id: r.id } })).notes).toBe("Rahul paid the toll");

    const edit = await saveExpense(input({ expenseId: r.id, name: "Cab", amount: "300", notes: "Toll split too" }), me, rate);
    if (!edit.ok) throw new Error(edit.error);
    const ev = await db.groupEvent.findUniqueOrThrow({ where: { id: edit.eventId! } });
    expect(JSON.parse(ev.details)).toContain("Notes: “Rahul paid the toll” → “Toll split too”");

    await undo(edit.eventId);
    expect((await db.expense.findUniqueOrThrow({ where: { id: r.id } })).notes).toBe("Rahul paid the toll");

    // An edit that doesn't send notes leaves them alone.
    await saveExpense(input({ expenseId: r.id, name: "Cab ride", amount: "300" }), me, rate);
    expect((await db.expense.findUniqueOrThrow({ where: { id: r.id } })).notes).toBe("Rahul paid the toll");
  });

  it("refuses to undo an older change once the expense was changed again", async () => {
    const r = await saveExpense(input({ name: "Lunch", amount: "300" }), me, rate);
    const id = r.ok ? r.id : "";
    const e1 = await saveExpense(input({ expenseId: id, name: "Lunch", amount: "450" }), me, rate);
    await saveExpense(input({ expenseId: id, name: "Lunch", amount: "600" }), me, rate);
    const res = await undoEvent(e1.ok ? e1.eventId! : "", me);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("changed again");
  });

  it("deleted payments can be restored, and recording a payment can be undone", async () => {
    const p = await db.payment.create({ data: { groupId, fromId: a, toId: me, amount: 10000, createdById: a } });
    const recorded = await logEvent(db, { groupId, actorId: a, kind: "payment_recorded", text: "recorded A paid Me ₹100", paymentId: p.id, undo: { type: "payment_delete", paymentId: p.id } });
    const before = (await net())[a];

    await undo(recorded);
    expect((await net())[a]).toBe(before - 10000); // payment no longer counts

    const del = await db.groupEvent.findFirstOrThrow({ where: { paymentId: p.id, kind: "payment_deleted" } });
    await undo(del.id); // restore
    expect((await net())[a]).toBe(before);

    // Direct restore also works after a delete.
    await setPaymentDeleted(p.id, me, true);
    expect((await setPaymentDeleted(p.id, me, false)).ok).toBe(true);
    expect((await db.payment.findUniqueOrThrow({ where: { id: p.id } })).deletedAt).toBeNull();
  });

  it("group renames and markup changes can be undone and redone", async () => {
    const r = await updateGroupBasics(groupId, a, { name: "Bangkok", markupBp: 300 });
    if (!r.ok) throw new Error(r.error);
    const events = await db.groupEvent.findMany({ where: { groupId, kind: { in: ["group_renamed", "markup_changed"] } } });
    for (const ev of events) await undo(ev.id);
    let g = await db.group.findUniqueOrThrow({ where: { id: groupId } });
    expect([g.name, g.cardMarkupBp]).toEqual(["Undo test", 0]);

    const redoRename = await db.groupEvent.findFirstOrThrow({ where: { groupId, kind: "group_renamed", undoneAt: null }, orderBy: { createdAt: "desc" } });
    await undo(redoRename.id);
    g = await db.group.findUniqueOrThrow({ where: { id: groupId } });
    expect(g.name).toBe("Bangkok");
  });

  it("a currency change can be undone exactly, but not after money changed again", async () => {
    const before = await loadGroup(groupId);
    const snapshot = before!.group.expenses.map((e) => [e.id, e.amount, e.shares.map((s) => s.amount).sort()]).sort();

    const c = await changeGroupCurrency(groupId, me, "USD", "0.012");
    if (!c.ok) throw new Error(c.error);
    await undo(c.eventId);
    const after = await loadGroup(groupId);
    expect(after!.group.currency).toBe("INR");
    expect(after!.group.expenses.map((e) => [e.id, e.amount, e.shares.map((s) => s.amount).sort()]).sort()).toEqual(snapshot);

    // Change again, then add an expense: undoing the currency change is now refused.
    const c2 = await changeGroupCurrency(groupId, me, "USD", "0.012");
    await saveExpense(input({ name: "Coffee", amount: "5", currency: "USD" }), me, rate);
    const res = await undoEvent(c2.ok ? c2.eventId! : "", me);
    expect(res.ok).toBe(false);
  });

  it("adding people can be undone only while they aren't used anywhere", async () => {
    const m = await db.member.create({ data: { name: "Guest", groupId } });
    const ev = await logEvent(db, { groupId, actorId: me, kind: "members_added", text: "added Guest", undo: { type: "members_remove", memberIds: [m.id] } });
    const removed = await undo(ev);
    expect(await db.member.findUnique({ where: { id: m.id } })).toBeNull();
    await undo(removed); // redo: Guest is back with the same identity
    expect((await db.member.findUniqueOrThrow({ where: { id: m.id } })).name).toBe("Guest");

    // Once Guest is in an expense, removing them is refused.
    const latestAdd = await db.groupEvent.findFirstOrThrow({ where: { groupId, kind: "members_added", undoneAt: null }, orderBy: { createdAt: "desc" } });
    await saveExpense(input({ name: "Pizza", amount: "10", currency: "USD", forMode: "one", onePersonId: m.id }), me, rate);
    const res = await undoEvent(latestAdd.id, me);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Guest");
  });

  it("closing a group can be undone", async () => {
    await db.group.update({ where: { id: groupId }, data: { closed: true, closedAt: new Date() } });
    const ev = await logEvent(db, { groupId, actorId: me, kind: "group_closed", text: "closed the group", undo: { type: "group_set", data: { closed: false, closedAt: null } } });
    await undo(ev);
    expect((await db.group.findUniqueOrThrow({ where: { id: groupId } })).closed).toBe(false);
  });

  it("every undo is logged and notifies the others", async () => {
    const all = await db.groupEvent.findMany({ where: { groupId } });
    expect(all.some((e) => e.text.startsWith("undid a change"))).toBe(true);
    expect(all.filter((e) => e.undoneAt).length).toBeGreaterThan(5);
    // Undone events can't be undone twice.
    const done = all.find((e) => e.undoneAt)!;
    expect(canUndo(done, all).ok).toBe(false);
  });
});
