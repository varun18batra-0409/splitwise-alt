import { describe, expect, it } from "vitest";
import { asOfCut, hideLaterNotes, scopeBalances, scopeForLeaver } from "@/lib/left-view";
import { netBalances } from "@/lib/balances";
import { spentAmount } from "@/lib/payers";
import { smartSettle } from "@/lib/settle";

// MA-3: someone who left sees the rows of the group as they were on the day they left. Only what is SHOWN changes:
// balances always come from the full ledger. These tests are pure (no database), so they always run.
//
// The Goa trip (amounts in rupees here; the code works in paise but the sums are the same):
//   Asha, Ravi and Priya.
//   28 Oct  Hotel   12,000 paid by Asha, shared Asha 6,000 / Priya 6,000
//   29 Oct  Snacks     600 paid by Priya, shared Asha 300 / Priya 300
//   30 Oct  Taxi       900 paid by Priya, shared 300 each to Asha, Ravi and Priya
//   31 Oct  payment Ravi -> Priya 300
//   1 Nov   Ravi leaves
//   5 Nov   Asha edits Hotel to "Hotel + Priya's flight", 25,000, shared Asha 10,000 / Priya 15,000
//   6 Nov   Priya deletes Snacks
//
// Ravi sees (as of 1 Nov): Hotel 12,000 (6,000 + 6,000, not edited), Snacks (300 + 300, not deleted), Taxi 900.
//   spent = 12,000 + 600 + 900 = 13,500, with 3 expenses. (Today's state would show 25,900 and 2 expenses.)
// Full ledger today (Snacks is deleted, Hotel is 25,000):
//   Asha  = +25,000 (paid Hotel) - 10,000 (her share) - 300 (Taxi share)            = +14,700
//   Priya = +900 (paid Taxi) - 15,000 - 300                                         = -14,400
//           then she was paid 300 by Ravi, so she is owed 300 less                  = -14,700
//   Ravi  = -300 (Taxi share) + 300 (his payment to Priya)                          = 0
//   sum = 14,700 - 14,700 + 0 = 0

const d = (day: string, time = "10:00") => new Date(`2026-${day}T${time}:00Z`);
const CUT = d("11-01", "12:00");
const A = "asha";
const R = "ravi";
const P = "priya";

type Share = { id: string; expenseId: string; memberId: string; amount: number };
const shares = (eid: string, m: Record<string, number>): Share[] => Object.entries(m).map(([memberId, amount]) => ({ id: `${eid}-${memberId}`, expenseId: eid, memberId, amount }));
const expense = (id: string, description: string, amount: number, paidById: string, sh: Record<string, number>, createdAt: Date, extra: Record<string, unknown> = {}) => ({
  id, description, amount, paidById, payers: "", kind: "expense", category: "other", splitType: "exact", forMode: "selected", notes: "",
  createdAt, spentAt: null as Date | null, editedAt: null as Date | null, deletedAt: null as Date | null, deletedById: null as string | null,
  shares: shares(id, sh), ...extra,
});
const state = (e: ReturnType<typeof expense>) => ({
  description: e.description, category: e.category, amount: e.amount, splitType: e.splitType, forMode: e.forMode, paidById: e.paidById, payers: e.payers, kind: e.kind,
  notes: e.notes, shares: e.shares.map((s) => ({ memberId: s.memberId, amount: s.amount })),
});

// The rows as they are TODAY.
const hotelThen = expense("hotel", "Hotel", 12000, A, { [A]: 6000, [P]: 6000 }, d("10-28"));
const hotel = expense("hotel", "Hotel + Priya's flight", 25000, A, { [A]: 10000, [P]: 15000 }, d("10-28"), { editedAt: d("11-05") });
const snacks = expense("snacks", "Snacks", 600, P, { [A]: 300, [P]: 300 }, d("10-29"), { deletedAt: d("11-06"), deletedById: P });
const taxi = expense("taxi", "Taxi", 900, P, { [A]: 300, [R]: 300, [P]: 300 }, d("10-30"));
const pay = { id: "pay1", fromId: R, toId: P, amount: 300, createdAt: d("10-31"), deletedAt: null as Date | null, deletedById: null as string | null };
const events = [
  { id: "e-hotel-edit", createdAt: d("11-05"), kind: "expense_edited", expenseId: "hotel", paymentId: null, touches: [A, P].join(","), undo: JSON.stringify({ type: "expense_revert", expenseId: "hotel", before: state(hotelThen) }) },
  { id: "e-snacks-del", createdAt: d("11-06"), kind: "expense_deleted", expenseId: "snacks", paymentId: null, touches: [A, P].join(","), undo: JSON.stringify({ type: "expense_restore", expenseId: "snacks" }) },
];
const today = { expenses: [hotel, snacks, taxi], payments: [pay] };
const sumPaise = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

describe("Goa: what Ravi sees as of 1 Nov", () => {
  // Ravi is in Taxi and the payment, so those are his own money; Hotel and Snacks are pre-cut rows without him.
  const scoped = scopeForLeaver({ expenses: today.expenses, payments: today.payments, events }, R, CUT);
  const seen = asOfCut({ expenses: scoped.expenses, payments: scoped.payments }, events, R, CUT);
  const live = seen.expenses.filter((e) => !e.deletedAt);

  it("Hotel is the old Hotel: name, amount and shares from before the edit, not marked as edited", () => {
    const h = seen.expenses.find((e) => e.id === "hotel")!;
    expect(h.description).toBe("Hotel");
    expect(h.amount).toBe(12000);
    expect(h.shares.map((s) => [s.memberId, s.amount])).toEqual([[A, 6000], [P, 6000]]);
    expect(sumPaise(h.shares.map((s) => s.amount))).toBe(12000); // 6,000 + 6,000 = 12,000
    expect(h.editedAt).toBeNull();
    expect(h.deletedAt).toBeNull();
  });
  it("Snacks is shown as not deleted: 300 + 300 = 600", () => {
    const s = seen.expenses.find((e) => e.id === "snacks")!;
    expect(s.deletedAt).toBeNull();
    expect(s.deletedById).toBeNull(); // who deleted it (after he left) is not shown either
    expect(sumPaise(s.shares.map((x) => x.amount))).toBe(600);
  });
  it("Taxi (his own money) is unchanged", () => {
    expect(seen.expenses.find((e) => e.id === "taxi")).toEqual(taxi);
  });
  it("spent = 12,000 + 600 + 900 = 13,500 across 3 expenses (today's state would say 25,900 and 2)", () => {
    expect(live.length).toBe(3);
    expect(sumPaise(live.map((e) => spentAmount(e)))).toBe(13500);
    const nowLive = today.expenses.filter((e) => !e.deletedAt);
    expect(nowLive.length).toBe(2);
    expect(sumPaise(nowLive.map((e) => spentAmount(e)))).toBe(25900);
  });
  it("the same rows come out when the row is the one Home reads (as-of rows keep every other column)", () => {
    const h = seen.expenses.find((e) => e.id === "hotel")!;
    expect(h.id).toBe("hotel");
    expect(h.createdAt).toEqual(d("10-28"));
    expect(h.paidById).toBe(A);
  });
});

describe("balances never change", () => {
  const ids = [A, R, P];
  const full = netBalances(ids, today.expenses.filter((e) => !e.deletedAt), today.payments);
  it("the full ledger: Asha +14,700, Priya -14,700, Ravi 0, sum 0", () => {
    expect(full[A]).toBe(14700); // 25,000 - 10,000 - 300
    expect(full[P]).toBe(-14700); // 900 - 15,000 - 300, then 300 less owed after Ravi paid her
    expect(full[R]).toBe(0); // -300 + 300
    expect(full[A] + full[P] + full[R]).toBe(0);
  });
  it("Ravi's shown balance is the full ledger's (scopeBalances keeps only his), whatever rows are shown", () => {
    const transfers = smartSettle(full);
    const mine = scopeBalances(full, transfers, R);
    expect(mine.net).toEqual({ [R]: 0 });
    // Worked from the as-of rows alone it would be wrong (that is why balances never come from them).
    const scoped = scopeForLeaver({ expenses: today.expenses, payments: today.payments, events }, R, CUT);
    const seen = asOfCut({ expenses: scoped.expenses, payments: scoped.payments }, events, R, CUT);
    // The as-of rows: Hotel 12,000 (Asha 6,000 / Priya 6,000) and Snacks and Taxi, with the payment. Ravi still owes 300 and paid 300.
    expect(netBalances(ids, seen.expenses.filter((e) => !e.deletedAt), seen.payments)[R]).toBe(0);
  });
  it("settling the Smart Settle plan leaves everybody at 0", () => {
    const transfers = smartSettle(full);
    const after = { ...full };
    for (const t of transfers) {
      after[t.from] += t.amount;
      after[t.to] -= t.amount;
    }
    expect(Object.values(after).every((x) => x === 0)).toBe(true);
    // Asha is owed 14,700 and Priya owes 14,700: one payment.
    expect(transfers).toEqual([{ from: P, to: A, amount: 14700 }]);
  });
  it("asOfCut does not modify the rows it is given", () => {
    const before = JSON.stringify(today);
    asOfCut({ expenses: today.expenses, payments: today.payments }, events, R, CUT);
    expect(JSON.stringify(today)).toBe(before);
  });
});

describe("edge rules", () => {
  it("a pre-cut row edited after the cut by a change with no saved 'before' is hidden", () => {
    const old = expense("flight", "Flight", 8000, A, { [A]: 4000, [P]: 4000 }, d("10-27"), { editedAt: d("11-04") });
    const ev = [{ id: "e1", createdAt: d("11-04"), kind: "expense_edited", expenseId: "flight", paymentId: null, touches: "", undo: "" }];
    const r = asOfCut({ expenses: [old], payments: [] }, ev, R, CUT);
    expect(r.expenses).toEqual([]);
  });
  it("a row edited before he left, and never since, is shown as it is", () => {
    const e = expense("tix", "Tickets", 3000, A, { [A]: 1500, [P]: 1500 }, d("10-27"), { editedAt: d("10-30") });
    expect(asOfCut({ expenses: [e], payments: [] }, [], R, CUT).expenses).toEqual([e]);
  });
  it("a row deleted before he left stays deleted; one deleted and brought back after he left was not deleted that day", () => {
    const gone = expense("gone", "Gone", 100, A, { [A]: 50, [P]: 50 }, d("10-27"), { deletedAt: d("10-28"), deletedById: A });
    const back = expense("back", "Back", 200, A, { [A]: 100, [P]: 100 }, d("10-27"));
    const evs = [
      { id: "b1", createdAt: d("11-02"), kind: "expense_deleted", expenseId: "back", paymentId: null, touches: "", undo: "" },
      { id: "b2", createdAt: d("11-03"), kind: "expense_restored", expenseId: "back", paymentId: null, touches: "", undo: "" },
    ];
    const r = asOfCut({ expenses: [gone, back], payments: [] }, evs, R, CUT).expenses;
    expect(r.find((e) => e.id === "gone")!.deletedAt).toEqual(d("10-28"));
    expect(r.find((e) => e.id === "back")!.deletedAt).toBeNull();
  });
  it("a row deleted before he left, then brought back after, shows as deleted on his last day", () => {
    const e = expense("e", "Dinner", 300, A, { [A]: 150, [P]: 150 }, d("10-27")); // brought back after he left: deletedAt is null today
    const evs = [{ id: "r1", createdAt: d("11-03"), kind: "expense_restored", expenseId: "e", paymentId: null, touches: "", undo: "" }];
    const r = asOfCut({ expenses: [e], payments: [] }, evs, R, CUT).expenses[0];
    expect(r.deletedAt).toEqual(CUT);
  });
  it("a payment deleted after he left (not his) shows as not deleted; one that is his own is left alone", () => {
    const other = { id: "p-other", fromId: A, toId: P, amount: 500, createdAt: d("10-30"), deletedAt: d("11-07") as Date | null, deletedById: P as string | null };
    const mine = { id: "p-mine", fromId: R, toId: P, amount: 100, createdAt: d("10-30"), deletedAt: d("11-07") as Date | null, deletedById: P as string | null };
    const evs = [
      { id: "q1", createdAt: d("11-07"), kind: "payment_deleted", expenseId: null, paymentId: "p-other", touches: "", undo: "" },
      { id: "q2", createdAt: d("11-07"), kind: "payment_deleted", expenseId: null, paymentId: "p-mine", touches: [R].join(","), undo: "" },
    ];
    const r = asOfCut({ expenses: [], payments: [other, mine] }, evs, R, CUT).payments;
    expect(r.find((p) => p.id === "p-other")!.deletedAt).toBeNull();
    expect(r.find((p) => p.id === "p-mine")!.deletedAt).toEqual(d("11-07"));
  });
  it("a change after the cut that touched him leaves the row as it is now (his own money)", () => {
    const evs = [{ ...events[0], touches: [A, R, P].join(",") }];
    const r = asOfCut({ expenses: [hotel], payments: [] }, evs, R, CUT).expenses[0];
    expect(r.description).toBe("Hotel + Priya's flight");
  });
  it("notes: a row shown as it was keeps the notes from that day and is not 'notes hidden'", () => {
    const withNote = { ...hotelThen, notes: "Booked online" };
    const edited = { ...hotel, notes: "Priya's flight added" };
    const ev = [{ ...events[0], undo: JSON.stringify({ type: "expense_revert", expenseId: "hotel", before: state(withNote) }) }];
    const r = hideLaterNotes(asOfCut({ expenses: [edited], payments: [] }, ev, R, CUT).expenses, CUT)[0];
    expect(r.notes).toBe("Booked online");
    expect((r as { notesHidden?: boolean }).notesHidden).toBeUndefined();
  });
  it("the earliest change after the cut holds the state on the cut day (two edits)", () => {
    const second = [
      ...events,
      { id: "e-hotel-edit2", createdAt: d("11-08"), kind: "expense_edited", expenseId: "hotel", paymentId: null, touches: "", undo: JSON.stringify({ type: "expense_revert", expenseId: "hotel", before: state(hotel) }) },
    ];
    const r = asOfCut({ expenses: [{ ...hotel, editedAt: d("11-08") }], payments: [] }, second, R, CUT).expenses[0];
    expect(r.amount).toBe(12000);
  });
});
