import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { renameMember, setMemberLeft, isMemberUsed } from "@/lib/people";
import { removeMembers, undoEvent } from "@/lib/undo";
import type { RateAnswer } from "@/lib/rate-cache";

// Renaming, removing, leaving and rejoining — all logged and undoable.

let groupId = "";
let me = "", a = "", b = "", typo = "";
const rate = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-10-14" });
const input = (over: Partial<SaveExpenseInput>): SaveExpenseInput => ({
  groupId, name: "Dinner", category: "", amount: "900", currency: "INR", paidById: me, forMode: "everyone",
  selected: [], onePersonId: "", splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash",
  markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
});
const member = (id: string) => db.member.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  const g = await db.group.create({
    data: { name: "People test", currency: "INR", inviteCode: `people-${Date.now()}`, members: { create: [{ name: "Me" }, { name: "Asha" }, { name: "Ravi" }, { name: "Rvai" }] } },
    include: { members: true },
  });
  groupId = g.id;
  const id = (n: string) => g.members.find((m) => m.name === n)!.id;
  [me, a, b, typo] = [id("Me"), id("Asha"), id("Ravi"), id("Rvai")];
});

afterAll(async () => {
  await db.groupEvent.deleteMany({ where: { groupId } });
  await db.payment.deleteMany({ where: { groupId } });
  await db.expenseShare.deleteMany({ where: { expense: { groupId } } });
  await db.expense.deleteMany({ where: { groupId } });
  await db.member.deleteMany({ where: { groupId } });
  await db.group.delete({ where: { id: groupId } });
});

describe("people", () => {
  it("renames someone, refuses a duplicate name, and undo puts the old name back", async () => {
    const r = await renameMember(groupId, me, a, "  Asha  K ");
    if (!r.ok) throw new Error(r.error);
    expect((await member(a)).name).toBe("Asha K");
    const ev = await db.groupEvent.findUniqueOrThrow({ where: { id: r.eventId! } });
    expect(ev.text).toBe("renamed Asha to Asha K");

    const clash = await renameMember(groupId, me, a, "ravi");
    expect(clash.ok).toBe(false);

    const u = await undoEvent(r.eventId!, b);
    expect(u.ok).toBe(true);
    expect((await member(a)).name).toBe("Asha");
  });

  it("removes someone added by mistake (never used), and undo brings them back", async () => {
    expect(await isMemberUsed(typo)).toBe(false);
    const r = await removeMembers(groupId, me, [typo], false);
    if (!r.ok) throw new Error(r.error);
    expect(await db.member.findUnique({ where: { id: typo } })).toBeNull();
    const ev = await db.groupEvent.findUniqueOrThrow({ where: { id: r.eventId! } });
    expect(ev.text).toBe("removed Rvai from the group");
    expect((await undoEvent(r.eventId!, me)).ok).toBe(true);
    expect((await member(typo)).name).toBe("Rvai");
  });

  it("someone who owes money can't leave until settled", async () => {
    const e = await saveExpense(input({ name: "Lunch", amount: "900", forMode: "selected", selected: [me, a, b] }), me, rate);
    expect(e.ok).toBe(true);
    expect(await isMemberUsed(b)).toBe(true);
    const r = await setMemberLeft(groupId, me, b, true);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Ravi still owes ₹300");
    // Removing them completely is refused too.
    expect((await removeMembers(groupId, me, [b], false)).ok).toBe(false);
  });

  it("someone with a zero balance can leave: kept in history, left out of new 'everyone' expenses", async () => {
    // Rvai has never been part of anything, so their balance is zero.
    const r = await setMemberLeft(groupId, typo, typo, true);
    if (!r.ok) throw new Error(r.error);
    expect((await member(typo)).leftAt).not.toBeNull();
    expect((await db.groupEvent.findUniqueOrThrow({ where: { id: r.eventId! } })).text).toBe("left the group");

    const e = await saveExpense(input({ name: "Taxi", amount: "300" }), me, rate);
    if (!e.ok) throw new Error(e.error);
    const shares = await db.expenseShare.findMany({ where: { expenseId: e.id } });
    expect(shares.map((s) => s.memberId).sort()).toEqual([me, a, b].sort());
    expect(shares.every((s) => s.amount === 10000)).toBe(true);

    // People who left can't be picked as the payer of a new expense.
    expect((await saveExpense(input({ name: "Snacks", amount: "100", paidById: typo }), me, rate)).ok).toBe(false);
  });

  it("leaving can be undone (they're back), and redone", async () => {
    const left = await db.groupEvent.findFirstOrThrow({ where: { groupId, kind: "member_left" }, orderBy: { createdAt: "desc" } });
    const u = await undoEvent(left.id, me);
    if (!u.ok) throw new Error(u.error);
    expect((await member(typo)).leftAt).toBeNull();
    expect((await undoEvent(u.eventId!, me)).ok).toBe(true); // redo
    expect((await member(typo)).leftAt).not.toBeNull();

    const back = await setMemberLeft(groupId, me, typo, false);
    if (!back.ok) throw new Error(back.error);
    expect((await member(typo)).leftAt).toBeNull();
    expect((await db.groupEvent.findUniqueOrThrow({ where: { id: back.eventId! } })).text).toBe("brought Rvai back into the group");
  });

  it("an old rename can't be undone after a newer rename of the same person", async () => {
    const r1 = await renameMember(groupId, me, b, "Ravi S");
    await renameMember(groupId, me, b, "Ravi Shah");
    const u = await undoEvent(r1.ok ? r1.eventId! : "", me);
    expect(u.ok).toBe(false);
  });
});
