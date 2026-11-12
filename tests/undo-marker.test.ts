import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { parseUndo } from "@/lib/events";
import { revertExpense, undoEvent } from "@/lib/undo";
import { setExpenseDeleted } from "@/lib/save-expense";
import type { RateAnswer } from "@/lib/rate-cache";

// INV-01: the "undone" mark is saved in the same transaction as the reversal, never before it.
//
// Hand-worked: Dinner ₹1,000 (100000) paid by Asha, split equally between Asha and Bina: 50000 each.
// It is then edited to ₹600 (60000): 30000 each. Undoing that edit puts 100000 / 50000 / 50000 back.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groups: string[] = [];
const rate = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-11-12" });
const draft = (groupId: string, paidById: string, over: Partial<SaveExpenseInput> = {}): SaveExpenseInput => ({
  groupId, name: "Dinner", category: "", amount: "1000", currency: "INR", paidById, forMode: "everyone",
  selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
  markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
});

afterAll(async () => {
  await db.groupEvent.deleteMany({ where: { groupId: { in: groups } } });
  await db.expenseShare.deleteMany({ where: { expense: { groupId: { in: groups } } } });
  await db.expense.deleteMany({ where: { groupId: { in: groups } } });
  await db.member.deleteMany({ where: { groupId: { in: groups } } });
  await db.group.deleteMany({ where: { id: { in: groups } } });
});

async function edited() {
  const g = await db.group.create({
    data: { name: `Undo marker ${stamp}-${groups.length}`, currency: "INR", inviteCode: `um-${groups.length}-${stamp}`, members: { create: [{ name: "Asha" }, { name: "Bina" }] } },
    include: { members: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  groups.push(g.id);
  const asha = g.members.find((m) => m.name === "Asha")!.id;
  const bina = g.members.find((m) => m.name === "Bina")!.id;
  const first = await saveExpense(draft(g.id, asha), asha, rate);
  if (!first.ok) throw new Error(first.error);
  const edit = await saveExpense({ ...draft(g.id, asha, { amount: "600" }), expenseId: first.id }, asha, rate);
  if (!edit.ok || !edit.eventId) throw new Error("edit failed");
  return { groupId: g.id, asha, bina, expenseId: first.id, eventId: edit.eventId, addedEventId: first.eventId! };
}
const sharesOf = async (expenseId: string) => Object.fromEntries((await db.expenseShare.findMany({ where: { expenseId } })).map((s) => [s.memberId, s.amount]));

describe("the undone mark and the reversal are saved together", () => {
  it("a reversal that throws leaves no mark and no change: the edit can still be undone afterwards", async () => {
    const w = await edited();
    expect(await sharesOf(w.expenseId)).toEqual({ [w.asha]: 30000, [w.bina]: 30000 });
    const ev = await db.groupEvent.findUniqueOrThrow({ where: { id: w.eventId } });
    const p = parseUndo(ev.undo);
    if (p?.type !== "expense_revert") throw new Error("not a revert");
    const before = await db.expense.findUniqueOrThrow({ where: { id: w.expenseId } });
    // A version with an unreadable date: the write inside the transaction throws after the mark and the old shares were touched.
    await expect(revertExpense(w.expenseId, { ...p.before, spentAt: "not a date" }, w.asha, { mark: { eventId: w.eventId, actorId: w.asha } })).rejects.toThrow();
    expect((await db.groupEvent.findUniqueOrThrow({ where: { id: w.eventId } })).undoneAt).toBeNull(); // no mark
    expect(await sharesOf(w.expenseId)).toEqual({ [w.asha]: 30000, [w.bina]: 30000 }); // no reversal
    const after = await db.expense.findUniqueOrThrow({ where: { id: w.expenseId } });
    expect([after.amount, after.editedAt?.getTime()]).toEqual([before.amount, before.editedAt?.getTime()]);
    // And a normal undo then works: 100000 split 50000 / 50000.
    const ok = await undoEvent(w.eventId, w.asha);
    expect(ok.ok).toBe(true);
    expect(await sharesOf(w.expenseId)).toEqual({ [w.asha]: 50000, [w.bina]: 50000 });
    expect((await db.expense.findUniqueOrThrow({ where: { id: w.expenseId } })).amount).toBe(100000);
    expect((await db.groupEvent.findUniqueOrThrow({ where: { id: w.eventId } })).undoneAt).not.toBeNull();
  });

  it("two undos of the same change: one succeeds, the other is told it was already undone", async () => {
    const w = await edited();
    const [a, b] = await Promise.all([undoEvent(w.eventId, w.asha), undoEvent(w.eventId, w.bina)]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const loser = a.ok ? b : a;
    expect(loser.ok).toBe(false);
    expect(await sharesOf(w.expenseId)).toEqual({ [w.asha]: 50000, [w.bina]: 50000 });
    // One reversal event, not two.
    expect(await db.groupEvent.count({ where: { groupId: w.groupId, text: { startsWith: "undid a change to" } } })).toBe(1);
  });
});

describe("someone else already marked it undone (as if from another server)", () => {
  it("an edit's reversal that starts after the mark was set elsewhere fails with 'That change was already undone.' and changes nothing", async () => {
    const w = await edited();
    const p = parseUndo((await db.groupEvent.findUniqueOrThrow({ where: { id: w.eventId } })).undo);
    if (p?.type !== "expense_revert") throw new Error("not a revert");
    const before = await db.expense.findUniqueOrThrow({ where: { id: w.expenseId } });
    await expect(
      revertExpense(w.expenseId, p.before, w.asha, {
        mark: { eventId: w.eventId, actorId: w.asha },
        // The gap between reading and writing: the other server marks it now.
        afterRead: async () => {
          await db.groupEvent.update({ where: { id: w.eventId }, data: { undoneAt: new Date(), undoneById: w.bina } });
        },
      }),
    ).rejects.toThrow("That change was already undone.");
    expect(await sharesOf(w.expenseId)).toEqual({ [w.asha]: 30000, [w.bina]: 30000 }); // still the edited 600
    const after = await db.expense.findUniqueOrThrow({ where: { id: w.expenseId } });
    expect([after.amount, after.editedAt?.getTime()]).toEqual([before.amount, before.editedAt?.getTime()]);
    const ev = await db.groupEvent.findUniqueOrThrow({ where: { id: w.eventId } });
    expect(ev.undoneById).toBe(w.bina); // the other server's mark stands
    expect(await db.groupEvent.count({ where: { groupId: w.groupId, text: { startsWith: "undid a change to" } } })).toBe(0);
  });

  it("a delete's reversal does the same: the expense stays as it is and no second event is written", async () => {
    const w = await edited();
    const eventsBefore = await db.groupEvent.count({ where: { groupId: w.groupId } });
    await expect(
      setExpenseDeleted(w.expenseId, w.asha, true, {
        mark: { eventId: w.addedEventId, actorId: w.asha },
        afterRead: async () => {
          await db.groupEvent.update({ where: { id: w.addedEventId }, data: { undoneAt: new Date(), undoneById: w.bina } });
        },
      }),
    ).rejects.toThrow("That change was already undone.");
    expect((await db.expense.findUniqueOrThrow({ where: { id: w.expenseId } })).deletedAt).toBeNull();
    expect(await db.groupEvent.count({ where: { groupId: w.groupId } })).toBe(eventsBefore);
  });
});

