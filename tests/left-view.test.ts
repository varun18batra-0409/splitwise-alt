import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { loadGroup, loadNotifications } from "@/lib/group-data";
import { leaverCut, scopeBalances, scopeForLeaver, ownShareDetails } from "@/lib/left-view";
import { readableWhere } from "@/lib/left-view-db";
import { netBalances } from "@/lib/balances";
import { logEvent, touchedByExpense } from "@/lib/events";
import { groupCsv } from "@/lib/csv";
import { saveExpense, type SaveExpenseInput } from "@/lib/save-expense";
import type { RateAnswer } from "@/lib/rate-cache";

// Someone who left sees the group only up to the day they left, plus later changes to their own share.
// Nobody's balance changes because of who can see what.
//
// Hand-worked (₹ in paise). A, R and M share equally.
//   Dinner 90000 paid by A, shared A, R, M: 30000 each.
//   R pays A 30000: R's balance is 0. R leaves (12 Nov).
//   Then Taxi 60000 paid by M, shared A and M: 30000 each (15 Nov).
//   Then A edits Dinner to take R out: A 45000, M 45000 (14 Nov).
// Whole ledger:
//   A = 90000 - 45000 (Dinner) - 30000 (Taxi) - 30000 (paid by R) = -15000
//   M = 60000 - 45000 - 30000 = -15000
//   R = +30000
//   sum = 0
// R sees Dinner, the payment R to A and the "changed Dinner" event, but not Taxi or its event, and
// his balance, worked out from only what he sees, is +30000 (the same as the whole ledger).

const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const groupIds: string[] = [];
const at = (day: string, time = "10:00") => new Date(`2026-11-${day}T${time}:00Z`);

async function ledger(label: string) {
  const g = await db.group.create({
    data: {
      name: `Left ${label} ${stamp}`, inviteCode: `lv-${label}-${stamp}`, currency: "INR",
      members: { create: [{ name: "A", createdAt: at("01") }, { name: "R", createdAt: at("01", "10:01") }, { name: "M", createdAt: at("01", "10:02") }] },
    },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
  groupIds.push(g.id);
  const [A, R, M] = g.members.map((m) => m.id);
  const mkExpense = (description: string, amount: number, paidById: string, shares: Record<string, number>, createdAt: Date) =>
    db.expense.create({
      data: { groupId: g.id, description, splitType: "equal", amount, originalAmount: amount, convertedAmount: amount, paidById, createdById: paidById, createdAt, shares: { create: Object.entries(shares).map(([memberId, amt]) => ({ memberId, amount: amt })) } },
    });
  const event = (kind: "expense_added" | "expense_edited" | "payment_recorded", text: string, actorId: string, createdAt: Date, touches: string[], ref: { expenseId?: string; paymentId?: string }, details: string[] = []) =>
    db.groupEvent.create({ data: { groupId: g.id, actorId, kind, text, createdAt, touches: touches.join(","), details: JSON.stringify(details), expenseId: ref.expenseId ?? null, paymentId: ref.paymentId ?? null } });

  const dinner = await mkExpense("Dinner", 90000, A, { [A]: 30000, [R]: 30000, [M]: 30000 }, at("10"));
  await event("expense_added", "added Dinner (₹900.00)", A, at("10"), [A, R, M], { expenseId: dinner.id });
  const pay = await db.payment.create({ data: { groupId: g.id, fromId: R, toId: A, amount: 30000, createdAt: at("12", "10:00"), createdById: R } });
  await event("payment_recorded", "recorded a payment", R, at("12", "10:00"), [R, A], { paymentId: pay.id });
  // R leaves at noon on 12 Nov.
  await db.member.update({ where: { id: R }, data: { leftAt: at("12", "12:00") } });
  // A takes R out of Dinner (14 Nov): the change touches A, R and M.
  const before = { paidById: A, amount: 90000, shares: [{ memberId: A, amount: 30000 }, { memberId: R, amount: 30000 }, { memberId: M, amount: 30000 }] };
  const after = { paidById: A, amount: 90000, shares: [{ memberId: A, amount: 45000 }, { memberId: M, amount: 45000 }] };
  await db.expenseShare.deleteMany({ where: { expenseId: dinner.id } });
  await db.expenseShare.createMany({ data: after.shares.map((s) => ({ expenseId: dinner.id, ...s })) });
  const touched = touchedByExpense(before, after);
  const edit = await event("expense_edited", "changed Dinner", A, at("14"), touched, { expenseId: dinner.id }, ["R’s share: ₹300.00 → ₹0.00", "A’s share: ₹300.00 → ₹450.00", "M’s share: ₹300.00 → ₹450.00"]);
  // Taxi (15 Nov) is shared by A and M only.
  const taxi = await mkExpense("Taxi", 60000, M, { [A]: 30000, [M]: 30000 }, at("15"));
  const taxiEv = await event("expense_added", "added Taxi (₹600.00)", M, at("15"), touchedByExpense(null, { paidById: M, amount: 60000, shares: [{ memberId: A, amount: 30000 }, { memberId: M, amount: 30000 }] }), { expenseId: taxi.id });
  return { g, A, R, M, dinner, taxi, pay, edit, taxiEv, touched };
}

afterAll(async () => {
  await db.group.deleteMany({ where: { id: { in: groupIds } } });
});

describe("which events a change touches", () => {
  it("an edit touches only those whose money in or share changed", () => {
    const b = { paidById: "A", amount: 90000, shares: [{ memberId: "A", amount: 30000 }, { memberId: "R", amount: 30000 }, { memberId: "M", amount: 30000 }] };
    const a = { paidById: "A", amount: 90000, shares: [{ memberId: "A", amount: 45000 }, { memberId: "M", amount: 45000 }] };
    expect(touchedByExpense(b, a).sort()).toEqual(["A", "M", "R"]);
    // Only a new name: nobody's money moved.
    expect(touchedByExpense(b, { ...b })).toEqual([]);
    // Only M and R swap what they owe: A is untouched.
    const swapped = { ...b, shares: [{ memberId: "A", amount: 30000 }, { memberId: "R", amount: 20000 }, { memberId: "M", amount: 40000 }] };
    expect(touchedByExpense(b, swapped).sort()).toEqual(["M", "R"]);
    // Added or deleted: everyone in it.
    expect(touchedByExpense(null, b).sort()).toEqual(["A", "M", "R"]);
    expect(touchedByExpense(b, null).sort()).toEqual(["A", "M", "R"]);
  });
});

describe("the hand-worked example", () => {
  it("whole ledger: A -15000, M -15000, R +30000, sum 0", async () => {
    const s = await ledger("full");
    const full = await loadGroup(s.g.id);
    expect(full!.net).toEqual({ [s.A]: -15000, [s.M]: -15000, [s.R]: 30000 });
    expect(Object.values(full!.net).reduce((n, x) => n + x, 0)).toBe(0);
  });

  it("R sees Dinner, the payment and the 'changed Dinner' event, not Taxi or its event; his balance is the full ledger's", async () => {
    const s = await ledger("view");
    const seen = await loadGroup(s.g.id, { viewer: s.R });
    expect(seen!.leaver).toMatchObject({ removed: false });
    expect(seen!.group.expenses.map((e) => e.description)).toEqual(["Dinner"]);
    expect(seen!.group.payments.map((p) => p.id)).toEqual([s.pay.id]);
    expect(seen!.group.events.map((e) => e.text).sort()).toEqual(["added Dinner (₹900.00)", "changed Dinner", "recorded a payment"]);
    // Only his own balance, from the FULL ledger, and only the payments he is part of.
    expect(seen!.net).toEqual({ [s.R]: 30000 });
    expect(seen!.transfers.every((t) => t.from === s.R || t.to === s.R)).toBe(true);
    expect(seen!.transfers.reduce((n, t) => n + t.amount, 0)).toBe(30000); // A pays R 15000, M pays R 15000
    // The same balance worked out from only the rows he can see.
    const rows = netBalances([s.A, s.R, s.M], seen!.expenses, seen!.payments);
    expect(rows[s.R]).toBe(30000);
    // After he left, only his own share is shown from the change.
    const changed = seen!.group.events.find((e) => e.text === "changed Dinner")!;
    expect(JSON.parse(changed.details)).toEqual(["R’s share: ₹300.00 → ₹0.00"]);
    // Everyone else still sees everything, and nobody's balance moved.
    const asA = await loadGroup(s.g.id, { viewer: s.A });
    expect(asA!.leaver).toBeNull();
    expect(asA!.group.expenses.map((e) => e.description).sort()).toEqual(["Dinner", "Taxi"]);
    expect(asA!.net).toEqual({ [s.A]: -15000, [s.M]: -15000, [s.R]: 30000 });
  });

  it("someone removed by the admin gets the same view", async () => {
    const s = await ledger("removed");
    await db.member.update({ where: { id: s.R }, data: { removedAt: at("12", "12:00"), removedById: s.A } });
    const seen = await loadGroup(s.g.id, { viewer: s.R, events: false });
    expect(seen!.leaver).toMatchObject({ removed: true });
    expect(seen!.group.expenses.map((e) => e.description)).toEqual(["Dinner"]);
    expect(seen!.net).toEqual({ [s.R]: 30000 });
    expect(seen!.group.events).toEqual([]); // events: false is respected
  });

  it("Alerts: the same cut", async () => {
    const s = await ledger("alerts");
    const { items } = await loadNotifications({ [s.g.id]: s.R });
    const texts = items.map((i) => i.event.text);
    expect(texts).toContain("changed Dinner");
    expect(texts).toContain("added Dinner (₹900.00)");
    expect(texts).not.toContain("added Taxi (₹600.00)");
  });

  it("the spreadsheet export shows the same rows", async () => {
    const s = await ledger("csv");
    const me = await db.member.findUniqueOrThrow({ where: { id: s.R } });
    const scope = (await readableWhere(s.g.id, me))!;
    const [expenses, payments] = await Promise.all([
      db.expense.findMany({ where: { groupId: s.g.id, AND: [scope.expenses] }, include: { shares: true } }),
      db.payment.findMany({ where: { groupId: s.g.id, AND: [scope.payments] } }),
    ]);
    expect(expenses.map((e) => e.description)).toEqual(["Dinner"]);
    expect(payments.map((p) => p.id)).toEqual([s.pay.id]);
    const members = await db.member.findMany({ where: { groupId: s.g.id }, orderBy: { createdAt: "asc" } });
    const csv = groupCsv({ name: "Left", currency: "INR" }, members, expenses, payments);
    expect(csv).toContain("Dinner");
    expect(csv).not.toContain("Taxi");
    // Someone still in the group has no limit.
    expect(await readableWhere(s.g.id, await db.member.findUniqueOrThrow({ where: { id: s.A } }))).toBeNull();
  });

  it("a real edit through saveExpense records who it touched", async () => {
    const g = await db.group.create({ data: { name: `Left real ${stamp}`, inviteCode: `lv-real-${stamp}`, currency: "INR", members: { create: [{ name: "A" }, { name: "R" }, { name: "M" }] } }, include: { members: true } });
    groupIds.push(g.id);
    const id = (n: string) => g.members.find((m) => m.name === n)!.id;
    const rate = async (): Promise<RateAnswer> => ({ ok: true, rate: "1", date: "2026-11-10" });
    const input = (over: Partial<SaveExpenseInput> = {}): SaveExpenseInput => ({
      groupId: g.id, name: "Dinner", category: "", amount: "900", currency: "INR", paidById: id("A"), forMode: "everyone", selected: [], onePersonId: "",
      splitType: "equal", exact: {}, percent: {}, paymentMethod: "cash", markupChoice: "group", markupCustom: "", rateMode: "auto", manualRate: "", ...over,
    });
    const first = await saveExpense(input(), id("A"), rate);
    if (!first.ok) throw new Error(first.error);
    const added = await db.groupEvent.findFirstOrThrow({ where: { expenseId: first.id, kind: "expense_added" } });
    expect(added.touches.split(",").sort()).toEqual([id("A"), id("M"), id("R")].sort());
    // Edit: Dinner now only for A and M. 300 each becomes 450 for A and M and 0 for R: all three moved.
    const second = await saveExpense(input({ expenseId: first.id, forMode: "selected", selected: [id("A"), id("M")], rateMode: "keep" }), id("A"), rate);
    if (!second.ok) throw new Error(second.error);
    const ev = await db.groupEvent.findFirstOrThrow({ where: { expenseId: first.id, kind: "expense_edited" } });
    expect(ev.touches.split(",").sort()).toEqual([id("A"), id("M"), id("R")].sort());
    // A payment touches the two people in it.
    const payment = await db.payment.create({ data: { groupId: g.id, fromId: id("R"), toId: id("A"), amount: 100 } });
    const pid = await logEvent(db, { groupId: g.id, actorId: id("R"), kind: "payment_recorded", text: "recorded a payment", paymentId: payment.id });
    expect((await db.groupEvent.findUniqueOrThrow({ where: { id: pid } })).touches.split(",").sort()).toEqual([id("A"), id("R")].sort());
  });
});

describe("the rule, on its own", () => {
  const d = (s: string) => new Date(s);
  const ex = (id: string, createdAt: string, paidById: string, shareIds: string[], payers?: string) => ({ id, createdAt: d(createdAt), paidById, payers, shares: shareIds.map((memberId) => ({ memberId })) });
  const cut = d("2026-11-12T12:00:00Z");

  it("leaverCut: leftAt, or removedAt, or nothing", () => {
    expect(leaverCut({ leftAt: null })).toBeNull();
    expect(leaverCut({ leftAt: cut })).toEqual({ leftAt: cut, removed: false });
    expect(leaverCut({ leftAt: cut, removedAt: cut })).toEqual({ leftAt: cut, removed: true });
  });

  it("expenses: before the cut, or they are in it now (payer, several payers, share), or a later change touched them", () => {
    const out = scopeForLeaver(
      {
        expenses: [
          ex("early", "2026-11-10T00:00:00Z", "A", ["A"]), // before: shown
          ex("late-without", "2026-11-14T00:00:00Z", "A", ["A", "M"]), // after, not them: hidden
          ex("late-share", "2026-11-14T00:00:00Z", "A", ["A", "R"]), // after, has a share: shown
          ex("late-payer", "2026-11-14T00:00:00Z", "R", ["A"]), // after, they paid: shown
          ex("late-payers", "2026-11-14T00:00:00Z", "A", ["A"], JSON.stringify([{ m: "A", a: 500 }, { m: "R", a: 500 }])), // after, one of several payers: shown
          ex("late-touched", "2026-11-14T00:00:00Z", "A", ["A", "M"]), // after, but a change touched them: shown
        ],
        payments: [
          { id: "p-early", createdAt: d("2026-11-11T00:00:00Z"), fromId: "A", toId: "M" },
          { id: "p-late-hidden", createdAt: d("2026-11-14T00:00:00Z"), fromId: "A", toId: "M" },
          { id: "p-late-to", createdAt: d("2026-11-14T00:00:00Z"), fromId: "A", toId: "R" },
          { id: "p-late-from", createdAt: d("2026-11-14T00:00:00Z"), fromId: "R", toId: "M" },
        ],
        events: [
          { id: "e-early", createdAt: d("2026-11-10T00:00:00Z"), touches: "", expenseId: null, paymentId: null },
          { id: "e-late-plain", createdAt: d("2026-11-14T00:00:00Z"), touches: "A,M", expenseId: "late-without", paymentId: null },
          { id: "e-late-touch", createdAt: d("2026-11-14T00:00:00Z"), touches: "A,R", expenseId: "late-touched", paymentId: null },
          { id: "e-late-settings", createdAt: d("2026-11-14T00:00:00Z"), touches: "", expenseId: null, paymentId: null }, // renamed the group: not theirs
          { id: "e-old-style-in", createdAt: d("2026-11-14T00:00:00Z"), touches: "", expenseId: "late-share", paymentId: null }, // written before touches were kept; the expense is about them now
          { id: "e-old-style-out", createdAt: d("2026-11-14T00:00:00Z"), touches: "", expenseId: "late-without", paymentId: null },
        ],
      },
      "R",
      cut,
    );
    expect(out.expenses.map((e) => e.id)).toEqual(["early", "late-share", "late-payer", "late-payers", "late-touched"]);
    expect(out.payments.map((p) => p.id)).toEqual(["p-early", "p-late-to", "p-late-from"]);
    expect(out.events.map((e) => e.id)).toEqual(["e-early", "e-late-touch", "e-old-style-in"]);
  });

  it("scopeBalances: only their own number and the payments they are in", () => {
    const r = scopeBalances({ A: -15000, M: -15000, R: 30000 }, [{ from: "A", to: "R", amount: 15000 }, { from: "M", to: "R", amount: 15000 }, { from: "A", to: "M", amount: 1 }], "R");
    expect(r.net).toEqual({ R: 30000 });
    expect(r.transfers.map((t) => t.from)).toEqual(["A", "M"]);
  });

  it("own-share lines only", () => {
    expect(JSON.parse(ownShareDetails(JSON.stringify(["Amount: ₹1 → ₹2", "R’s share: ₹300.00 → ₹0.00", "A’s share: ₹1 → ₹2"]), "R"))).toEqual(["R’s share: ₹300.00 → ₹0.00"]);
    expect(ownShareDetails("not json", "R")).toBe("[]");
  });
});

describe("what a leaver sees always adds up to what they are owed", () => {
  // A small seeded generator, so a failure can be replayed.
  function rng(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }
  it("for 300 random ledgers, the balance from visible rows equals the whole-ledger balance", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const ids = ["m0", "m1", "m2", "m3"];
      const leaver = ids[Math.floor(r() * 4)];
      const cutTime = 1000 + Math.floor(r() * 1000);
      const expenses = Array.from({ length: 1 + Math.floor(r() * 8) }, (_, i) => {
        const who = ids.filter(() => r() < 0.6);
        const sharers = who.length ? who : [ids[0]];
        const amount = 100 * (1 + Math.floor(r() * 90));
        const base = Math.floor(amount / sharers.length);
        const shares = sharers.map((memberId, k) => ({ memberId, amount: base + (k === 0 ? amount - base * sharers.length : 0) }));
        const paidById = ids[Math.floor(r() * 4)];
        // Some are deleted (they must not count in either view).
        return { id: `e${i}`, createdAt: new Date(1000 + Math.floor(r() * 2000)), paidById, amount, payers: "", kind: "expense", shares, deletedAt: r() < 0.15 ? new Date(0) : null };
      });
      const payments = Array.from({ length: Math.floor(r() * 4) }, (_, i) => {
        const from = ids[Math.floor(r() * 4)];
        const to = ids[(ids.indexOf(from) + 1 + Math.floor(r() * 3)) % 4];
        return { id: `p${i}`, createdAt: new Date(1000 + Math.floor(r() * 2000)), fromId: from, toId: to, amount: 100 * (1 + Math.floor(r() * 20)), deletedAt: r() < 0.15 ? new Date(0) : null };
      });
      const live = <T extends { deletedAt: Date | null }>(xs: T[]) => xs.filter((x) => !x.deletedAt);
      const whole = netBalances(ids, live(expenses), live(payments));
      const seen = scopeForLeaver({ expenses, payments, events: [] }, leaver, new Date(cutTime));
      const part = netBalances(ids, live(seen.expenses), live(seen.payments));
      expect(part[leaver], `seed ${seed}`).toBe(whole[leaver]);
      expect(Object.values(whole).reduce((n, x) => n + x, 0), `seed ${seed}`).toBe(0);
    }
  });
});
