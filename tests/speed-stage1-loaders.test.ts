import { afterAll, describe, expect, it } from "vitest";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { eraseGroups } from "@/lib/purge";
import { eventsFrom, loadGroup, loadGroupView, loadMyGroups, loadMyGroupsLean } from "@/lib/group-data";
import { canUndo } from "@/lib/undo";

// Speed fixes 2 and 4: the group screens skip the history (events) when they don't show it, and read
// fewer columns. Every balance, Smart Settle plan, leaver view and Undo answer must be exactly what the
// full loaders give. Money is in paise.
//
// Cast: A, R and M. R leaves on 12 Nov and is the "leaver" below.
//   Dinner 90000 paid by A, shared 30000 each.
//   Hotel in Thai baht: paid by M, 103000 (incl. 3000 card fee), shared A and M 51500 each. Rate saved on it.
//   Boat 60000 paid by A 40000 + M 20000, shared A, R, M 20000 each.
//   Refund 9000 received by M, shared A 4500, M 4500.
//   Taxi 30000 paid by M, shared A and M, then DELETED.
//   R pays A 10000.
// Balances (+ = owed), worked out one expense at a time:
//   A: Dinner +90000-30000, Hotel -51500, Boat +40000-20000, Refund +4500, R's payment -10000   = +23000
//   R: Dinner -30000, Boat -20000, paid A +10000                                              = -40000
//   M: Dinner -30000, Hotel +103000-51500, Boat +20000-20000, Refund +4500-9000               = +17000
//   (23000 - 40000 + 17000 = 0)

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
afterAll(async () => {
  await eraseGroups(groupIds);
});
const at = (day: string, time = "10:00") => new Date(`2026-11-${day}T${time}:00Z`);

async function world() {
  const g = await db.group.create({
    data: {
      name: `Speed ${stamp}`, inviteCode: `sp-${stamp}-${Math.random().toString(36).slice(2, 6)}`, currency: "INR",
      members: { create: [{ name: "A", createdAt: at("01") }, { name: "R", createdAt: at("01", "10:01") }, { name: "M", createdAt: at("01", "10:02") }] },
    },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  groupIds.push(g.id);
  const [A, R, M] = g.members.map((m) => m.id);
  const mk = (description: string, amount: number, paidById: string, shares: Record<string, number>, createdAt: Date, extra: Partial<Prisma.ExpenseUncheckedCreateInput> = {}) =>
    db.expense.create({
      data: { groupId: g.id, description, splitType: "equal", amount, originalAmount: amount, convertedAmount: amount, paidById, createdById: paidById, createdAt, shares: { create: Object.entries(shares).map(([memberId, amt]) => ({ memberId, amount: amt })) }, ...extra },
    });
  const dinner = await mk("Dinner", 90000, A, { [A]: 30000, [R]: 30000, [M]: 30000 }, at("10"));
  const hotel = await mk("Hotel", 103000, M, { [A]: 51500, [M]: 51500 }, at("11"), { originalAmount: 36000, originalCurrency: "THB", exchangeRate: "2.8", rateSource: "api", rateDate: "2026-11-11", paymentMethod: "card", markupBp: 300, markupAmount: 3000 });
  await db.payment.create({ data: { groupId: g.id, fromId: R, toId: A, amount: 10000, createdById: R, createdAt: at("12", "09:00") } });
  const boat = await mk("Boat", 60000, A, { [A]: 20000, [R]: 20000, [M]: 20000 }, at("15"), { payers: JSON.stringify([{ m: A, a: 40000 }, { m: M, a: 20000 }]) });
  const refund = await mk("Returned jacket", 9000, M, { [A]: 4500, [M]: 4500 }, at("16"), { kind: "refund" });
  const taxi = await mk("Taxi", 30000, M, { [A]: 15000, [M]: 15000 }, at("17"), { deletedAt: at("17", "11:00"), deletedById: M });
  // R left on 12 Nov, after the dinner, the hotel and their payment.
  await db.member.update({ where: { id: R }, data: { leftAt: at("12", "12:00") } });
  // The history, with real undo text. Each event is about one expense, so a newer change to the same expense blocks undoing an older one.
  const ev = (kind: string, text: string, actorId: string, createdAt: Date, expenseId: string, undo: unknown, touches: string[]) =>
    db.groupEvent.create({ data: { groupId: g.id, actorId, kind, text, createdAt, expenseId, undo: JSON.stringify(undo), touches: touches.join(","), details: "[]" } });
  const e1 = await ev("expense_added", "added Dinner (₹900.00)", A, at("10"), dinner.id, { type: "expense_delete", expenseId: dinner.id }, [A, R, M]);
  const e2 = await ev("expense_added", "added Hotel (₹1,030.00)", M, at("11"), hotel.id, { type: "expense_delete", expenseId: hotel.id }, [A, M]);
  const e3 = await ev("expense_edited", "changed Dinner", A, at("13"), dinner.id, { type: "expense_delete", expenseId: dinner.id }, [A, M]);
  const e4 = await ev("expense_added", "added Boat (₹600.00)", A, at("15"), boat.id, { type: "expense_delete", expenseId: boat.id }, [A, R, M]);
  const e5 = await ev("expense_added", "added Returned jacket", M, at("16"), refund.id, { type: "expense_delete", expenseId: refund.id }, [A, M]);
  const e6 = await ev("expense_deleted", "deleted Taxi", M, at("17", "11:00"), taxi.id, { type: "expense_restore", expenseId: taxi.id }, [A, M]);
  return { gid: g.id, A, R, M, events: [e1, e2, e3, e4, e5, e6] };
}

const without = <T extends object>(o: T, keys: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const EXPENSE_OMITTED: string[] = []; // Activity shows each saved rate's source and day, so expenses keep every column
const MEMBER_OMITTED = ["notify", "addedBy", "seenAt", "removedById", "seenEventsAt"];
const GROUP_OMITTED = ["inviteCode", "joinWeight"];

describe("the balances the screens show", () => {
  it("are the hand-worked numbers and add up to zero", async () => {
    const w = await world();
    const d = (await loadGroup(w.gid))!;
    expect(d.net).toEqual({ [w.A]: 23000, [w.R]: -40000, [w.M]: 17000 });
    expect(Object.values(d.net).reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe("fix 2: leaving the history out changes nothing else", () => {
  it("someone still in the group: same rows, balances and plan; only the history is empty", async () => {
    const w = await world();
    for (const viewer of [undefined, w.A, w.M]) {
      const full = (await loadGroup(w.gid, { viewer }))!;
      const lean = (await loadGroup(w.gid, { viewer, events: false }))!;
      expect(lean.net).toEqual(full.net);
      expect(lean.transfers).toEqual(full.transfers);
      expect(lean.leaver).toEqual(full.leaver);
      expect(lean.expenses).toEqual(full.expenses);
      expect(lean.payments).toEqual(full.payments);
      expect(lean.group.expenses).toEqual(full.group.expenses);
      expect(lean.group.members).toEqual(full.group.members);
      expect(lean.group.events).toEqual([]);
      expect(full.group.events.length).toBe(6);
    }
  });

  it("the leaver view is unchanged: R sees only their own balance and payments, and the same rows", async () => {
    const w = await world();
    const full = (await loadGroup(w.gid, { viewer: w.R }))!;
    const lean = (await loadGroup(w.gid, { viewer: w.R, events: false }))!;
    expect(full.leaver).not.toBeNull();
    expect(lean.leaver).toEqual(full.leaver);
    expect(lean.net).toEqual({ [w.R]: -40000 }); // their own line, from the whole ledger
    expect(lean.net).toEqual(full.net);
    expect(lean.transfers).toEqual(full.transfers);
    expect(lean.transfers.every((t) => t.from === w.R || t.to === w.R)).toBe(true);
    expect(lean.expenses.map((e) => e.id)).toEqual(full.expenses.map((e) => e.id));
    expect(lean.payments.map((p) => p.id)).toEqual(full.payments.map((p) => p.id));
    // R left on 12 Nov: Dinner, Hotel (before), Boat (shared with R) are theirs; the refund and taxi (A and M only, after) are not.
    expect(lean.expenses.map((e) => e.description).sort()).toEqual(["Boat", "Dinner", "Hotel"]);
  });

  it("the Undo bar gets the same answer from 'that change and the ones after it' as from the whole history", async () => {
    const w = await world();
    const full = (await loadGroup(w.gid, { viewer: w.A }))!.group.events;
    const answers: boolean[] = [];
    for (const e of w.events) {
      const from = await eventsFrom(w.gid, e.id);
      const a = canUndo(full.find((x) => x.id === e.id)!, full);
      const b = canUndo(from.find((x) => x.id === e.id)!, from);
      expect(b).toEqual(a);
      answers.push(a.ok);
    }
    // By hand: the first Dinner change (e1) is blocked by the later edit (e3); the others have nothing newer on their expense or payment.
    expect(answers).toEqual([false, true, true, true, true, true]);
  });

  it("an unknown or foreign change id gives nothing", async () => {
    const w = await world();
    const other = await world();
    expect(await eventsFrom(w.gid, "nope")).toEqual([]);
    expect(await eventsFrom(w.gid, other.events[0].id)).toEqual([]); // belongs to another group
  });

  it("the Undo bar is still wired on the Balances, Charts and Settle pages", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("src/app/groups/[id]/page.tsx", "utf8");
    expect(page).toContain('sp.tab === "balances" || sp.tab === "charts"');
    expect(page).toContain("events: false");
    expect(page).toContain("eventsFrom(group.id, sp.did)");
    expect(page).toContain("canUndo(justDid, undoEvents)");
    const settle = readFileSync("src/app/groups/[id]/settle/page.tsx", "utf8");
    expect(settle).toContain("loadGroupSettle(id"); // stage 2: no events, and no expense rows either (the leaver's Undo bar loads its own)
    expect(settle).toContain("eventsFrom(group.id, sp.did)");
    expect(settle).toContain("canUndo(justDid, undoEvents)");
  });
});

describe("fix 4: the read-only loaders return the same data minus unused columns", () => {
  it("loadGroupView = loadGroup for balances, plan, leaver and every row", async () => {
    const w = await world();
    for (const viewer of [undefined, w.A, w.R]) {
      for (const events of [undefined, false]) {
        const opts = { viewer, events };
        const full = (await loadGroup(w.gid, opts))!;
        const view = (await loadGroupView(w.gid, opts))!;
        expect(view.net).toEqual(full.net);
        expect(view.transfers).toEqual(full.transfers);
        expect(view.leaver).toEqual(full.leaver);
        expect(view.expenses.map((e) => without(e, EXPENSE_OMITTED))).toEqual(full.expenses.map((e) => without(e, EXPENSE_OMITTED)));
        expect(view.payments).toEqual(full.payments);
        expect(view.group.expenses.map((e) => without(e, EXPENSE_OMITTED))).toEqual(full.group.expenses.map((e) => without(e, EXPENSE_OMITTED)));
        expect(view.group.members.map((m) => without(m, MEMBER_OMITTED))).toEqual(full.group.members.map((m) => without(m, MEMBER_OMITTED)));
        expect(view.group.events).toEqual(full.group.events);
        expect(without(view.group, ["expenses", "members", "payments", "events", ...GROUP_OMITTED])).toEqual(without(full.group, ["expenses", "members", "payments", "events", ...GROUP_OMITTED]));
      }
    }
  });

  it("the omitted columns really are left out, and the money columns are kept", async () => {
    const w = await world();
    const view = (await loadGroupView(w.gid))!;
    const e = view.group.expenses.find((x) => x.description === "Hotel")!;
    expect(e.rateSource).toBe("api"); // kept: Activity shows where a saved rate came from
    expect(e).toMatchObject({ amount: 103000, markupAmount: 3000, originalCurrency: "THB", exchangeRate: "2.8", payers: "" });
    expect("inviteCode" in view.group).toBe(false);
    expect("notify" in view.group.members[0]).toBe(false);
    expect(view.group.members.map((m) => m.name)).toEqual(["A", "R", "M"]); // same order as loadGroup
  });

  it("a deleted group is still not found", async () => {
    const w = await world();
    await db.group.update({ where: { id: w.gid }, data: { deletedAt: new Date() } });
    expect(await loadGroupView(w.gid)).toBeNull();
    expect(await loadGroup(w.gid)).toBeNull();
  });

  it("loadMyGroupsLean = loadMyGroups for me as a member and as someone who left", async () => {
    const w = await world();
    for (const me of [w.A, w.R, w.M]) {
      const memberships = { [w.gid]: me };
      const full = await loadMyGroups(memberships);
      const lean = await loadMyGroupsLean(memberships);
      expect(lean).toHaveLength(1);
      expect(full).toHaveLength(1);
      const [f, l] = [full[0], lean[0]];
      expect(l.net).toEqual(f.net);
      expect(l.transfers).toEqual(f.transfers);
      expect(l.myBalance).toBe(f.myBalance);
      expect(l.spent).toBe(f.spent);
      expect(l.people).toBe(f.people);
      expect(l.leaver).toEqual(f.leaver);
      expect(l.lastActivity).toEqual(f.lastActivity);
      expect(l.myId).toBe(f.myId);
      const drop = ["rateSource", "rateDate", "exchangeRate", "paymentMethod"];
      expect(l.expenses.map((e) => without(e, drop))).toEqual(f.expenses.map((e) => without(e, drop)));
      expect(l.payments).toEqual(f.payments);
      expect(without(l.group, ["expenses", "payments", ...GROUP_OMITTED])).toEqual(without(f.group, ["expenses", "payments", ...GROUP_OMITTED]));
      expect(l.group.expenses.map((e) => without(e, drop))).toEqual(f.group.expenses.map((e) => without(e, drop)));
      expect(l.group.payments).toEqual(f.group.payments);
    }
    // By hand for A: owed 23000.
    expect((await loadMyGroupsLean({ [w.gid]: w.A }))[0].myBalance).toBe(23000);
    // R left: their balance is still the whole ledger's -40000.
    expect((await loadMyGroupsLean({ [w.gid]: w.R }))[0].myBalance).toBe(-40000);
  });
});
