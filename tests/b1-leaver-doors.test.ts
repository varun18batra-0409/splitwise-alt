import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createPayment } from "@/lib/payments";
import { parseUndo } from "@/lib/events";
import { setExpenseDeleted, saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import { moveOut, moveOutPreview, setMoveInFor, MOVE_OUT_CLOSED } from "@/lib/home/moving-db";
import { addWaitingBill, billExpenseInput, runBillsForGroup } from "@/lib/home/bills-db";
import { billCommand, saveBillFor, toggleMissedDayFor } from "@/lib/home/bill-setup";
import { moveOutConfirm } from "@/lib/move-confirm";
import { revertExpense, undoEvent } from "@/lib/undo";
import { openGameFor } from "@/lib/pot-db";
import { moneySig } from "@/lib/money-guard";
import { checkBooks } from "./helpers/money-invariants";

// Money batch B1, part 1: the doors a person who has left must not get through. Everything is paise, worked by hand.
// After every step checkBooks() asserts the three rules: balances add to 0, each expense's shares add to its amount, and
// everyone who has left is at exactly 0.
//
// Flat: Asha, Ravi, Meera (created in that order, 100 each). Milk is a daily bill at 4800 a day, shared equally.

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let counter = 0;
const groupIds: string[] = [];
const accountIds: string[] = [];
afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
  await db.account.deleteMany({ where: { id: { in: accountIds } } });
});

const equal = JSON.stringify({ mode: "equal" });
const key = (label: string) => `b1-${label}-${++counter}-${stamp}`;
const rate = async () => ({ ok: true as const, rate: "1", date: "2026-11-16" });

async function world(label: string, o: { names?: string[]; accounts?: string[]; type?: string; closed?: boolean } = {}) {
  const n = ++counter;
  const names = o.names ?? ["Asha", "Ravi", "Meera"];
  const acc: Record<string, string> = {};
  for (const name of o.accounts ?? []) {
    const a = await db.account.create({ data: { email: `b1-${label}-${name.toLowerCase()}-${n}-${stamp}@example.test`, name } });
    accountIds.push(a.id);
    acc[name] = a.id;
  }
  const g = await db.group.create({
    data: {
      name: `B1 ${label} ${n}`, type: o.type ?? "home", currency: "INR", closed: o.closed ?? false, inviteCode: `b1-${n}-${stamp}`,
      members: {
        create: names.map((name, i) => ({
          name, splitWeight: 100, createdAt: new Date(2026, 0, i + 1),
          ...(acc[name] ? { accountId: acc[name], claimedAt: new Date(2026, 0, i + 1) } : {}),
        })),
      },
    },
    include: { members: true },
  });
  groupIds.push(g.id);
  const id = (name: string) => g.members.find((m) => m.name === name)!.id;
  return { gid: g.id, id };
}
type World = Awaited<ReturnType<typeof world>>;

const milk = (w: World, payer: string, over: Record<string, unknown> = {}) =>
  db.bill.create({ data: { groupId: w.gid, name: "Milk", category: "groceries", nature: "daily", amount: 4800, startMonth: "2026-11", payer, split: equal, missed: "{}", ...over } });
const charge = (gid: string, paidById: string, shareOf: string, amount: number, description: string) =>
  db.expense.create({
    data: {
      groupId: gid, description, amount, paidById, createdById: paidById, splitType: "exact", forMode: "selected", category: "other",
      originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount,
      shares: { create: [{ memberId: shareOf, amount }] },
    },
  });
const pay = (gid: string, from: string, to: string, amount: number) => db.$transaction((tx) => createPayment(tx, { groupId: gid, fromId: from, toId: to, amount, createdById: from }));
const nets = async (w: World, ...who: string[]) => {
  const n = await checkBooks(w.gid);
  return who.map((x) => n[w.id(x)]);
};
const events = (gid: string, kind: string) => db.groupEvent.findMany({ where: { groupId: gid, kind }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
const T3 = (desc: string) => `${desc} was changed after the move-out, so this can’t be undone. Ask someone in the flat to undo that change first.`;

// Ravi moves out on 13 Nov with "Add it now": the Milk charge is 13 days × 4800 ÷ 3 = 20800, paid by Asha, and Ravi pays Asha 20800.
async function raviOut(w: World) {
  const bill = await milk(w, w.id("Asha"));
  const r = await moveOut(w.gid, w.id("Asha"), { leaverId: w.id("Ravi"), lastDay: "2026-11-13", addDaily: true, requestKey: key("ravi") }, new Date("2026-11-13T06:00:00Z"));
  if (!r.ok) throw new Error(r.error);
  const ch = await db.expense.findFirstOrThrow({ where: { groupId: w.gid, description: { contains: "Ravi" } }, include: { shares: true } });
  return { bill, ch, eventId: r.eventId! };
}

describe("1. D3-1: deleting a charge a leaver is in is refused, with no exception", () => {
  it("charge 20800 paid by Asha for Ravi's share, Ravi paid it back, Ravi left: Meera's delete is refused, nothing changes", async () => {
    const w = await world("d31");
    const ch = await charge(w.gid, w.id("Asha"), w.id("Ravi"), 20800, "Milk · 1–13 Nov (Ravi’s share)");
    await pay(w.gid, w.id("Ravi"), w.id("Asha"), 20800);
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([0, 0, 0]);
    await db.member.update({ where: { id: w.id("Ravi") }, data: { leftAt: new Date("2026-11-13T12:00:00Z") } });
    // Taking the charge away would leave Ravi at +20800 (his payment with nothing to pay for).
    expect(await setExpenseDeleted(ch.id, w.id("Meera"), true)).toEqual({ ok: false, error: "Ravi has left the group, so this can't be deleted. Ask them to rejoin first." });
    expect((await db.expense.findUniqueOrThrow({ where: { id: ch.id } })).deletedAt).toBeNull();
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([0, 0, 0]);
  });
});

describe("2. FB-3: a charge the leaver paid goes to this month's payer", () => {
  it("Ravi out with Add it now (charge 20800 to Asha, Ravi pays 20800); then Asha out without it: Asha pays Meera 20800, the charge is Meera's, one line; the month end is 123200", async () => {
    const w = await world("fb3");
    const { ch } = await raviOut(w);
    expect(ch.amount).toBe(20800); // 13 × 4800 ÷ 3
    expect(ch.paidById).toBe(w.id("Asha"));
    expect((await db.payment.findMany({ where: { groupId: w.gid } })).map((p) => [p.fromId, p.toId, p.amount])).toEqual([[w.id("Ravi"), w.id("Asha"), 20800]]);
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([0, 0, 0]);

    // Asha moves out on the 20th. The preview already shows the hand-on, and the confirm question says so.
    const now = new Date("2026-11-20T06:00:00Z");
    const p = await moveOutPreview(w.gid, w.id("Asha"), "2026-11-20", now, w.id("Asha"));
    if (!p.ok) throw new Error(p.error);
    expect(p.payments).toEqual([{ from: w.id("Asha"), to: w.id("Meera"), amount: 20800 }]);
    expect(p.handovers).toEqual([{ desc: "Milk · 1–13 Nov (Ravi’s share)", amount: 20800, to: w.id("Meera"), sharerId: w.id("Ravi"), billName: "Milk" }]);
    expect(moveOutConfirm({ leaverName: "Asha", payments: [{ from: w.id("Asha"), to: w.id("Meera"), amount: 20800 }], nameOf: (id) => (id === w.id("Asha") ? "Asha" : "Meera"), money: (n) => `₹${n / 100}`, handovers: [{ amount: 20800, sharerName: "Ravi", billName: "Milk", toName: "Meera" }] })).toBe(
      "Final payments: Asha pays Meera ₹208. They are recorded as paid and everyone is told. This includes ₹208 Asha was paid for Ravi’s share of Milk, which goes to Meera, who now pays Milk. Mark Asha as moved out?",
    );
    const r = await moveOut(w.gid, w.id("Asha"), { leaverId: w.id("Asha"), lastDay: "2026-11-20", requestKey: key("asha"), expectKey: p.expectKey }, now);
    expect(r.ok).toBe(true);
    expect((await db.payment.findMany({ where: { groupId: w.gid, deletedAt: null }, orderBy: { createdAt: "asc" } })).map((x) => [x.fromId, x.toId, x.amount])).toEqual([
      [w.id("Ravi"), w.id("Asha"), 20800],
      [w.id("Asha"), w.id("Meera"), 20800],
    ]);
    expect((await db.expense.findUniqueOrThrow({ where: { id: ch.id } })).paidById).toBe(w.id("Meera"));
    const lines = (await events(w.gid, "expense_edited")).filter((e) => e.text.includes("now paid"));
    expect(lines.map((e) => [e.text, e.actorId])).toEqual([["Meera now paid Milk · 1–13 Nov (Ravi’s share)", w.id("Asha")]]);
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([0, 0, 0]);

    // The month ends: 30 × 4800 − 20800 = 123200, paid and shared by Meera alone (the only one left). No second "now paid" line.
    expect((await runBillsForGroup(w.gid, new Date("2026-12-01T06:00:00Z"))).added).toBe(1);
    const m = await db.expense.findFirstOrThrow({ where: { groupId: w.gid, description: "Milk" }, include: { shares: true } });
    expect(m.amount).toBe(123200);
    expect(m.paidById).toBe(w.id("Meera"));
    expect(m.shares.map((s) => [s.memberId, s.amount])).toEqual([[w.id("Meera"), 123200]]);
    expect(m.amount + ch.amount).toBe(144000);
    expect((await events(w.gid, "expense_edited")).filter((e) => e.text.includes("now paid"))).toHaveLength(1);
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([0, 0, 0]);
  });

  it("Asha undoes her move-out before the month is added: the charge is hers again, her payment is gone, Ravi is untouched, all 0", async () => {
    const w = await world("fb3undo");
    const { ch } = await raviOut(w);
    const r = await moveOut(w.gid, w.id("Asha"), { leaverId: w.id("Asha"), lastDay: "2026-11-20", requestKey: key("asha") }, new Date("2026-11-20T06:00:00Z"));
    if (!r.ok) throw new Error(r.error);
    expect((await db.expense.findUniqueOrThrow({ where: { id: ch.id } })).paidById).toBe(w.id("Meera"));
    const ev = await db.groupEvent.findUniqueOrThrow({ where: { id: r.eventId! } });
    expect(JSON.parse(ev.undo).moveOut.chargePayers).toEqual([{ expenseId: ch.id, before: w.id("Asha"), after: w.id("Meera") }]);
    expect((await undoEvent(ev.id, w.id("Asha"))).ok).toBe(true);
    expect((await db.expense.findUniqueOrThrow({ where: { id: ch.id } })).paidById).toBe(w.id("Asha"));
    expect(await db.payment.count({ where: { groupId: w.gid, deletedAt: null } })).toBe(1); // only Ravi's
    expect((await db.member.findUniqueOrThrow({ where: { id: w.id("Asha") } })).leftAt).toBeNull();
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([0, 0, 0]);
    expect((await db.member.findUniqueOrThrow({ where: { id: w.id("Ravi") } })).leftAt).not.toBeNull();
  });

  it("the move-out undo is refused if the handed charge was paid by someone else since", async () => {
    const w = await world("fb3clash");
    const { ch } = await raviOut(w);
    const r = await moveOut(w.gid, w.id("Asha"), { leaverId: w.id("Asha"), lastDay: "2026-11-20", requestKey: key("asha") }, new Date("2026-11-20T06:00:00Z"));
    if (!r.ok) throw new Error(r.error);
    await db.expense.update({ where: { id: ch.id }, data: { paidById: w.id("Ravi") } }); // behind the app's back
    const u = await undoEvent(r.eventId!, w.id("Meera"));
    expect(u).toEqual({ ok: false, error: T3("Milk · 1–13 Nov (Ravi’s share)") });
    expect((await db.member.findUniqueOrThrow({ where: { id: w.id("Asha") } })).leftAt).not.toBeNull();
  });

  it("backstop: a charge whose payer has left stays theirs when the month is added (no change, no line), and they stay at 0", async () => {
    const w = await world("fb3back");
    const { ch, bill } = await raviOut(w);
    await db.member.update({ where: { id: w.id("Asha") }, data: { leftAt: new Date("2026-11-20T12:00:00Z") } }); // left by another road, charge still hers
    await db.bill.update({ where: { id: bill.id }, data: { payer: w.id("Meera") } });
    expect((await runBillsForGroup(w.gid, new Date("2026-12-01T06:00:00Z"))).added).toBe(1);
    expect((await db.expense.findUniqueOrThrow({ where: { id: ch.id } })).paidById).toBe(w.id("Asha"));
    expect((await events(w.gid, "expense_edited")).filter((e) => e.text.includes("now paid"))).toHaveLength(0);
    // Milk: 30 × 4800 − 20800 = 123200, paid and shared by Meera alone: 0. Asha: +20800 − 20800 = 0.
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([0, 0, 0]);
  });
});

describe("3. FB-5: a bill added after the move-out blocks undoing it", () => {
  // Rent 900000 paid by Ravi, shared by all three: November added at 300000 each (Ravi +600000, Asha −300000, Meera −300000).
  async function rentFlat(label: string, accounts: string[] = []) {
    const w = await world(label, { accounts });
    const rent = await db.bill.create({ data: { groupId: w.gid, name: "Rent", category: "bills", nature: "fixed", amount: 900000, day: 1, startMonth: "2026-11", payer: w.id("Ravi"), split: JSON.stringify({ mode: "group", ids: [] }) } });
    expect((await runBillsForGroup(w.gid, new Date("2026-11-02T06:00:00Z"))).added).toBe(1);
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([-300000, 600000, -300000]);
    // Asha moves out on the 30th: nothing freed (all 30 days), she pays Ravi 300000.
    const r = await moveOut(w.gid, w.id("Asha"), { leaverId: w.id("Asha"), lastDay: "2026-11-30", requestKey: key("rent") }, new Date("2026-11-30T06:00:00Z"));
    if (!r.ok) throw new Error(r.error);
    expect(r.payments).toEqual([{ from: w.id("Asha"), to: w.id("Ravi"), amount: 300000 }]);
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([0, 300000, -300000]);
    return { w, rent, eventId: r.eventId! };
  }

  it("December is added without Asha (450000 each, Ravi and Meera): Ravi's undo is refused with the plain sentence, nothing changes; Asha's own says gone for good", async () => {
    const { w, eventId } = await rentFlat("fb5");
    expect((await runBillsForGroup(w.gid, new Date("2026-12-01T06:00:00Z"))).added).toBe(1);
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([0, 750000, -750000]); // +300000 + 450000, −300000 − 450000
    const u = await undoEvent(eventId, w.id("Ravi"));
    expect(u).toEqual({ ok: false, error: "Rent for December was added after the move-out, so the move-out can’t be undone." });
    expect((await db.member.findUniqueOrThrow({ where: { id: w.id("Asha") } })).leftAt).not.toBeNull();
    expect((await db.groupEvent.findUniqueOrThrow({ where: { id: eventId } })).undoneAt).toBeNull();
    expect(await db.payment.count({ where: { groupId: w.gid, deletedAt: null } })).toBe(1);
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([0, 750000, -750000]);
    // Asha herself (plain name here, so she may undo her own) is told only that it can't be undone any more.
    expect(await undoEvent(eventId, w.id("Asha"))).toEqual({ ok: false, error: "This move-out can’t be undone any more." });
  });

  it("the same with Asha signed in: her own undo says 'This move-out can’t be undone any more.'", async () => {
    const { w, eventId } = await rentFlat("fb5acc", ["Asha"]);
    expect((await runBillsForGroup(w.gid, new Date("2026-12-01T06:00:00Z"))).added).toBe(1);
    expect(await undoEvent(eventId, w.id("Asha"))).toEqual({ ok: false, error: "This move-out can’t be undone any more." });
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([0, 750000, -750000]);
  });

  it("a December run still being added (claimed after the move-out): 'being added right now, try again in a minute'; a run for a bill Asha was never in does not block", async () => {
    const { w, rent, eventId } = await rentFlat("fb5adding");
    await db.billRun.create({ data: { billId: rent.id, period: "2026-12", status: "adding", claimedAt: new Date(Date.now() + 60_000) } });
    expect(await undoEvent(eventId, w.id("Ravi"))).toEqual({ ok: false, error: "Rent for December is being added right now. Try again in a minute." });
    // A bill shared only by Ravi and Meera was never going to include Asha: its later run is no reason to refuse.
    await db.billRun.deleteMany({ where: { billId: rent.id, period: "2026-12" } });
    const other = await db.bill.create({ data: { groupId: w.gid, name: "Cook", category: "bills", nature: "fixed", amount: 100000, day: 1, startMonth: "2026-11", payer: w.id("Ravi"), split: JSON.stringify({ mode: "some", ids: [w.id("Ravi"), w.id("Meera")] }) } });
    await db.billRun.create({ data: { billId: other.id, period: "2026-12", status: "adding", claimedAt: new Date(Date.now() + 60_000) } });
    expect((await undoEvent(eventId, w.id("Ravi"))).ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: w.id("Asha") } })).leftAt).toBeNull();
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([-300000, 600000, -300000]);
  });
});

describe("4. FB-6: moving-in dates", () => {
  const now = new Date("2026-11-16T06:00:00Z");
  const writes = async (w: World) => [
    await db.groupEvent.count({ where: { groupId: w.gid } }),
    (await db.member.findMany({ where: { groupId: w.gid }, orderBy: { createdAt: "asc" } })).map((m) => m.joinedFrom?.toISOString() ?? null),
  ];

  it("each refusal says why and writes nothing", async () => {
    const w = await world("fb6");
    const meera = w.id("Meera");
    const before = await writes(w);
    expect(await setMoveInFor(w.gid, meera, w.id("Ravi"), "2030-01-01", now)).toEqual({ ok: false, error: "The moving-in date can’t be later than the end of next month." });
    expect(await setMoveInFor(w.gid, meera, w.id("Ravi"), "2026-02-31", now)).toEqual({ ok: false, error: "That date isn’t valid." });
    expect(await setMoveInFor(w.gid, meera, w.id("Ravi"), "1999-12-31", now)).toEqual({ ok: false, error: "That date isn’t valid." });
    expect(await setMoveInFor(w.gid, meera, w.id("Ravi"), "5 Nov", now)).toEqual({ ok: false, error: "That date isn’t valid." });
    // The last day allowed is the end of next month (31 Dec 2026): the 1st of January is one day too far.
    expect(await setMoveInFor(w.gid, meera, w.id("Ravi"), "2027-01-01", now)).toEqual({ ok: false, error: "The moving-in date can’t be later than the end of next month." });
    expect(await writes(w)).toEqual(before);

    await db.member.update({ where: { id: w.id("Ravi") }, data: { leftAt: new Date("2026-11-10T12:00:00Z") } });
    expect(await setMoveInFor(w.gid, meera, w.id("Ravi"), "2026-11-05", now)).toEqual({ ok: false, error: "Ravi has left the flat, so their moving-in date can’t change." });

    const trip = await world("fb6trip", { type: "trip" });
    expect(await setMoveInFor(trip.gid, trip.id("Meera"), trip.id("Ravi"), "2026-11-05", now)).toEqual({ ok: false, error: "Moving-in dates are only for flats." });
    const closed = await world("fb6closed", { closed: true });
    expect(await setMoveInFor(closed.gid, closed.id("Meera"), closed.id("Ravi"), "2026-11-05", now)).toEqual({ ok: false, error: "This group is closed. Reopen it first." });
    expect(await db.groupEvent.count({ where: { groupId: trip.gid } })).toBe(0);
    expect(await db.groupEvent.count({ where: { groupId: closed.gid } })).toBe(0);
    expect((await db.member.findUniqueOrThrow({ where: { id: closed.id("Ravi") } })).joinedFrom).toBeNull();
  });

  it("2026-11-05 saves one line with a move_in_set undo, and undoing it puts the date back to none", async () => {
    const w = await world("fb6ok");
    const r = await setMoveInFor(w.gid, w.id("Meera"), w.id("Ravi"), "2026-11-05", now);
    if (!r.ok) throw new Error(r.error);
    expect((await db.member.findUniqueOrThrow({ where: { id: w.id("Ravi") } })).joinedFrom?.toISOString()).toBe("2026-11-05T12:00:00.000Z");
    const lines = await events(w.gid, "bill_changed");
    expect(lines).toHaveLength(1);
    expect(parseUndo(lines[0].undo)).toEqual({ type: "move_in_set", memberId: w.id("Ravi"), joinedFrom: null });
    expect((await undoEvent(r.eventId!, w.id("Meera"))).ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: w.id("Ravi") } })).joinedFrom).toBeNull();
    await checkBooks(w.gid);
  });

  it("changed again since: the first change can't be undone until the newer one is; the newer one goes back to the date before", async () => {
    const w = await world("fb6again");
    const first = await setMoveInFor(w.gid, w.id("Meera"), w.id("Ravi"), "2026-11-05", now);
    const second = await setMoveInFor(w.gid, w.id("Meera"), w.id("Ravi"), "2026-11-07", now);
    if (!first.ok || !second.ok) throw new Error("setup");
    expect(await undoEvent(first.eventId!, w.id("Meera"))).toMatchObject({ ok: false });
    expect((await db.member.findUniqueOrThrow({ where: { id: w.id("Ravi") } })).joinedFrom?.toISOString()).toBe("2026-11-07T12:00:00.000Z");
    expect((await undoEvent(second.eventId!, w.id("Meera"))).ok).toBe(true);
    expect((await db.member.findUniqueOrThrow({ where: { id: w.id("Ravi") } })).joinedFrom?.toISOString()).toBe("2026-11-05T12:00:00.000Z");
  });
});

describe("5. FB-7: the move-out undo needs each daily charge exactly as it was written", () => {
  it("the charge deleted behind the app's back, or edited 20800 → 15000: refused with the plain sentence; Ravi stays left, his payment stays", async () => {
    const w = await world("fb7");
    const { ch, eventId } = await raviOut(w);
    const refused = async () => {
      expect(await undoEvent(eventId, w.id("Meera"))).toEqual({ ok: false, error: T3("Milk · 1–13 Nov (Ravi’s share)") });
      expect((await db.member.findUniqueOrThrow({ where: { id: w.id("Ravi") } })).leftAt).not.toBeNull();
      expect(await db.payment.count({ where: { groupId: w.gid, deletedAt: null } })).toBe(1);
      expect((await db.groupEvent.findUniqueOrThrow({ where: { id: eventId } })).undoneAt).toBeNull();
    };
    await db.expense.update({ where: { id: ch.id }, data: { deletedAt: new Date() } });
    await refused();
    await db.expense.update({ where: { id: ch.id }, data: { deletedAt: null, amount: 15000, originalAmount: 15000, convertedAmount: 15000, shares: { updateMany: { where: { memberId: w.id("Ravi") }, data: { amount: 15000 } } } } });
    await refused();
    // Put back exactly as written, the undo goes through (20800 comes off Asha, Ravi's payment is taken off, all 0).
    await db.expense.update({ where: { id: ch.id }, data: { amount: 20800, originalAmount: 20800, convertedAmount: 20800, shares: { updateMany: { where: { memberId: w.id("Ravi") }, data: { amount: 20800 } } } } });
    expect((await undoEvent(eventId, w.id("Meera"))).ok).toBe(true);
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([0, 0, 0]);
  });
});

describe("6. FB-8: a month with a move-out share charged can't be changed underneath it", () => {
  it("days up to the 13th can't be toggled (day 5 refused, day 20 fine); the price can't change (name can); the month can't be skipped; month end 118400 = 59200 + 59200", async () => {
    const w = await world("fb8");
    const { bill, ch } = await raviOut(w);
    expect(ch.amount).toBe(20800);
    const asha = w.id("Asha");
    expect(await toggleMissedDayFor(w.gid, asha, bill.id, "2026-11", 5)).toEqual({ ok: false, error: "Ravi’s share of Milk up to 13 Nov was charged when they moved out, so those days can’t change." });
    expect(await toggleMissedDayFor(w.gid, asha, bill.id, "2026-11", 13)).toMatchObject({ ok: false });
    expect((await db.bill.findUniqueOrThrow({ where: { id: bill.id } })).missed).toBe("{}");
    expect(await toggleMissedDayFor(w.gid, asha, bill.id, "2026-11", 20)).toEqual({ ok: true, id: bill.id });
    expect(JSON.parse((await db.bill.findUniqueOrThrow({ where: { id: bill.id } })).missed)).toEqual({ "2026-11": [20] });

    const edit = (over: Record<string, string>) => saveBillFor(w.gid, asha, { billId: bill.id, template: "milk", name: "Milk", nature: "daily", amount: "48", day: "31", payer: asha, split: "equal", ids: [], ...over });
    expect(await edit({ amount: "50" })).toEqual({ ok: false, error: "A move-out share of this month’s Milk was charged at the current price, so the price, type and split can’t change until this month is added." });
    expect((await db.bill.findUniqueOrThrow({ where: { id: bill.id } })).amount).toBe(4800);
    expect(await edit({ split: "group" })).toMatchObject({ ok: false });
    expect(await edit({ name: "Milk run" })).toEqual({ ok: true, id: bill.id }); // the name (and who pays) can still change
    expect((await db.bill.findUniqueOrThrow({ where: { id: bill.id } })).name).toBe("Milk run");

    expect(await billCommand(w.gid, asha, bill.id, "skip", new Date("2026-11-16T06:00:00Z"))).toEqual({ ok: false, error: "A move-out share of this month’s Milk run was already charged, so this month can’t be skipped." });
    expect(await db.billRun.count({ where: { billId: bill.id } })).toBe(0);

    // Month end: 29 days (the 20th missed) × 4800 = 139200 − 20800 = 118400, shared by Asha and Meera: 59200 each.
    await runBillsForGroup(w.gid, new Date("2026-12-01T06:00:00Z"));
    const m = await db.expense.findFirstOrThrow({ where: { groupId: w.gid, description: "Milk run" }, include: { shares: true } });
    expect(m.amount).toBe(118400);
    expect(m.shares.map((s) => s.amount).sort()).toEqual([59200, 59200]);
    // Asha: +20800 (the charge) −20800 (Ravi's payment) +118400 (Milk run) −59200 (her share) = +59200. Ravi 0. Meera −59200.
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([59200, 0, -59200]);
  });

  it("a day toggled in the gap between reading and writing the move-out: 'A bill changed just now', no charge, no payment, Ravi still here", async () => {
    const w = await world("fb8gap");
    const bill = await milk(w, w.id("Asha"));
    const r = await moveOut(
      w.gid, w.id("Asha"), { leaverId: w.id("Ravi"), lastDay: "2026-11-13", addDaily: true, requestKey: key("gap") }, new Date("2026-11-13T06:00:00Z"),
      { afterRead: async () => void (await toggleMissedDayFor(w.gid, w.id("Asha"), bill.id, "2026-11", 5)) },
    );
    expect(r).toEqual({ ok: false, error: "A bill changed just now. Check it and try again." });
    expect(await db.expense.count({ where: { groupId: w.gid } })).toBe(0);
    expect(await db.payment.count({ where: { groupId: w.gid } })).toBe(0);
    expect((await db.member.findUniqueOrThrow({ where: { id: w.id("Ravi") } })).leftAt).toBeNull();
    expect(JSON.parse((await db.bill.findUniqueOrThrow({ where: { id: bill.id } })).prepaid)).toEqual({});
    await checkBooks(w.gid);
  });
});

describe("7. FB-9: a closed flat takes no move-out", () => {
  it("Groceries 90000 paid by You, 30000 each: the preview and the move-out both say reopen first; nothing is recorded", async () => {
    const w = await world("fb9", { names: ["You", "Rohan", "Meera"], closed: true });
    await db.expense.create({
      data: {
        groupId: w.gid, description: "Groceries", amount: 90000, paidById: w.id("You"), createdById: w.id("You"), splitType: "exact", forMode: "selected",
        originalAmount: 90000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 90000,
        shares: { create: ["You", "Rohan", "Meera"].map((n) => ({ memberId: w.id(n), amount: 30000 })) },
      },
    });
    const text = "This flat is closed. Reopen it first, then mark the move-out.";
    expect(MOVE_OUT_CLOSED).toBe(text);
    const now = new Date("2026-11-16T06:00:00Z");
    expect(await moveOutPreview(w.gid, w.id("Rohan"), "2026-11-16", now, w.id("You"))).toEqual({ ok: false, error: text });
    expect(await moveOut(w.gid, w.id("You"), { leaverId: w.id("Rohan"), lastDay: "2026-11-16", requestKey: key("closed") }, now)).toEqual({ ok: false, error: text });
    expect(await db.payment.count({ where: { groupId: w.gid } })).toBe(0);
    expect((await db.member.findUniqueOrThrow({ where: { id: w.id("Rohan") } })).leftAt).toBeNull();
    expect(await nets(w, "You", "Rohan", "Meera")).toEqual([60000, -30000, -30000]);
    // And a flat that is closed in the gap between reading and writing: the move-out says it was closed, nothing is saved.
    await db.group.update({ where: { id: w.gid }, data: { closed: false } });
    const r = await moveOut(w.gid, w.id("You"), { leaverId: w.id("Rohan"), lastDay: "2026-11-16", requestKey: key("closed2") }, now, { afterRead: async () => void (await db.group.update({ where: { id: w.gid }, data: { closed: true } })) });
    expect(r).toEqual({ ok: false, error: "This group was closed while you were saving, so nothing was saved." });
    expect((await db.member.findUniqueOrThrow({ where: { id: w.id("Rohan") } })).leftAt).toBeNull();
    expect(await db.payment.count({ where: { groupId: w.gid } })).toBe(0);
  });
});

describe("8. FB-12: Skip loses to a bill that was added in the gap", () => {
  it("Electricity waiting; Skip is racing the 'Enter amount' (150000 split 3, Asha pays): Skip is told it was just added; the bill stays added", async () => {
    const w = await world("fb12");
    const elec = await db.bill.create({ data: { groupId: w.gid, name: "Electricity", category: "bills", nature: "varies", amount: 0, day: 5, startMonth: "2026-11", payer: w.id("Asha"), split: equal } });
    await db.billRun.create({ data: { billId: elec.id, period: "2026-11", status: "waiting" } });
    const members = await db.member.findMany({ where: { groupId: w.gid }, orderBy: { createdAt: "asc" } });
    const input: SaveExpenseInput = { ...billExpenseInput(elec, w.gid, "INR", "2026-11", 150000, w.id("Asha"), members), date: "2026-11-05" };
    const r = await billCommand(w.gid, w.id("Ravi"), elec.id, "skip", new Date("2026-11-16T06:00:00Z"), {
      afterRead: async () => {
        const added = await addWaitingBill(input, w.id("Asha"), rate, { billId: elec.id, period: "2026-11" }, key("elec"));
        expect(added.ok).toBe(true);
      },
    });
    expect(r).toEqual({ ok: false, error: "Electricity was just added, so it wasn’t skipped. You’ll find it in Activity." });
    const run = await db.billRun.findUniqueOrThrow({ where: { billId_period: { billId: elec.id, period: "2026-11" } } });
    expect(run.status).toBe("added");
    expect(run.expenseId).not.toBe("");
    expect((await db.groupEvent.findMany({ where: { groupId: w.gid, kind: "bill_changed" } })).filter((e) => e.text.includes("skipped"))).toHaveLength(0);
    expect(await nets(w, "Asha", "Ravi", "Meera")).toEqual([100000, -50000, -50000]);
  });
});

describe("11. D3-5: undoing an edit needs the person undoing to still be in the group", () => {
  it("Dinner 30000 paid by A, 10000 each; A edits it to 60000; B's undo while B has just left: refused, 60000 stays", async () => {
    const w = await world("d35", { names: ["A", "B", "C"], type: "trip" });
    const [A, B] = [w.id("A"), w.id("B")];
    const draft = (amount: string, expenseId?: string): SaveExpenseInput => ({
      groupId: w.gid, name: "Dinner", category: "", amount, currency: "INR", paidById: A, forMode: "everyone", selected: [], onePersonId: "", splitType: "equal",
      exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...(expenseId ? { expenseId } : {}),
    });
    const first = await saveExpense(draft("300"), A, rate);
    if (!first.ok) throw new Error(first.error);
    expect(await nets(w, "A", "B", "C")).toEqual([20000, -10000, -10000]);
    const edit = await saveExpense(draft("600", first.id), A, rate);
    if (!edit.ok) throw new Error(edit.error);
    expect(await nets(w, "A", "B", "C")).toEqual([40000, -20000, -20000]);
    const p = parseUndo((await db.groupEvent.findUniqueOrThrow({ where: { id: edit.eventId! } })).undo);
    if (p?.type !== "expense_revert") throw new Error("not a revert");
    const r = await revertExpense(first.id, p.before, B, { afterRead: async () => void (await db.member.update({ where: { id: B }, data: { leftAt: new Date() } })) });
    expect(r).toEqual({ ok: false, error: "You're no longer in this group, so nothing was saved." });
    expect((await db.expense.findUniqueOrThrow({ where: { id: first.id } })).amount).toBe(60000);
    const shares = await db.expenseShare.findMany({ where: { expenseId: first.id } });
    expect(shares.map((s) => s.amount)).toEqual([20000, 20000, 20000]);
    await checkBooks(w.gid, { legacy: [B] }); // B was set to "left" behind the app's back, owing 20000: the only exception
  });
});

describe("helpers", () => {
  it("openGameFor names an open game the person has live chips in, and nothing for a finished, deleted or untouched one", async () => {
    const w = await world("opengame", { type: "trip" });
    const [A, B] = [w.id("Asha"), w.id("Ravi")];
    const game = await db.potGame.create({ data: { groupId: w.gid, name: "Friday teen patti", players: JSON.stringify([A, B]), hostId: A } });
    expect(await openGameFor(db, w.gid, A)).toBeNull();
    const mv = await db.potMove.create({ data: { gameId: game.id, memberId: A, kind: "take", amount: 50000, createdById: A } });
    expect(await openGameFor(db, w.gid, A)).toBe("Friday teen patti");
    expect(await openGameFor(db, w.gid, B)).toBeNull();
    await db.potMove.update({ where: { id: mv.id }, data: { deletedAt: new Date() } });
    expect(await openGameFor(db, w.gid, A)).toBeNull();
    await db.potMove.update({ where: { id: mv.id }, data: { deletedAt: null } });
    await db.potGame.update({ where: { id: game.id }, data: { status: "done" } });
    expect(await openGameFor(db, w.gid, A)).toBeNull();
    await db.potGame.update({ where: { id: game.id }, data: { status: "open", deletedAt: new Date() } });
    expect(await openGameFor(db, w.gid, A)).toBeNull();
  });

  it("moneySig sees who is in each share and each payment, not only the amounts", () => {
    const ex = (memberId: string) => [{ id: "e1", amount: 100, payers: "", deletedAt: null, shares: [{ id: "s1", amount: 100, memberId }] }];
    expect(moneySig(ex("a"), [])).not.toBe(moneySig(ex("b"), []));
    const pay = (toId: string) => [{ id: "p1", amount: 5, deletedAt: null, fromId: "a", toId }];
    expect(moneySig([], pay("b"))).not.toBe(moneySig([], pay("c")));
    expect(moneySig(ex("a"), pay("b"))).toBe(moneySig(ex("a"), pay("b")));
  });
});
