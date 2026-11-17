import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asOfCut, BILL_PHOTO_EDIT_PREFIX, hideLaterNotes, memberOfChange, membershipPeriods, membershipSpan, overlapped, scopeBalances, sharedGroupRow } from "@/lib/left-view";
import { netBalances } from "@/lib/balances";
import { spentAmount } from "@/lib/payers";
import { smartSettle } from "@/lib/settle";

// Follow-ups from the independent review of the leaver view. Pure (no database), amounts in paise (rupees x 100), so they always run.
// The Goa trip again: Ravi left on 1 Nov; Hotel is Rs 12,000 = 1,200,000 paise, Snacks 60,000, Taxi 90,000: spent 1,350,000 over 3.

const d = (day: string, time = "10:00") => new Date(`2026-${day}T${time}:00Z`);
const CUT = d("11-01", "12:00");
const A = "asha";
const R = "ravi";
const P = "priya";
const RS = 100;

type Share = { id: string; expenseId: string; memberId: string; amount: number };
const shares = (eid: string, m: Record<string, number>): Share[] => Object.entries(m).map(([memberId, amount]) => ({ id: `${eid}-${memberId}`, expenseId: eid, memberId, amount }));
const expense = (id: string, description: string, amount: number, paidById: string, sh: Record<string, number>, createdAt: Date, extra: Record<string, unknown> = {}) => ({
  id, description, amount, paidById, payers: "", kind: "expense", category: "other", splitType: "exact", forMode: "selected", notes: "",
  originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", exchangeRate: "1", rateDate: "", rateSource: "same", convertedAmount: amount, paymentMethod: "", markupBp: 0, markupAmount: 0,
  createdAt, spentAt: null as Date | null, editedAt: null as Date | null, deletedAt: null as Date | null, deletedById: null as string | null,
  shares: shares(id, sh), ...extra,
});
const stateOf = (e: ReturnType<typeof expense>) => ({
  description: e.description, category: e.category, amount: e.amount, splitType: e.splitType, forMode: e.forMode, paidById: e.paidById, payers: e.payers, kind: e.kind, notes: e.notes,
  originalAmount: e.originalAmount, originalCurrency: e.originalCurrency, baseCurrency: e.baseCurrency, exchangeRate: e.exchangeRate, rateDate: e.rateDate, rateSource: e.rateSource,
  convertedAmount: e.convertedAmount, paymentMethod: e.paymentMethod, markupBp: e.markupBp, markupAmount: e.markupAmount, shares: e.shares.map((s) => ({ memberId: s.memberId, amount: s.amount })),
});
const ev = (id: string, createdAt: Date, kind: string, ref: { expenseId?: string; paymentId?: string }, extra: Record<string, unknown> = {}) => ({
  id, createdAt, kind, expenseId: ref.expenseId ?? null, paymentId: ref.paymentId ?? null, touches: "", undo: "", text: "", details: "[]", ...extra,
});
const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);

const hotelThen = expense("hotel", "Hotel", 1200000, A, { [A]: 600000, [P]: 600000 }, d("10-28"));
const snacks = expense("snacks", "Snacks", 60000, P, { [A]: 30000, [P]: 30000 }, d("10-29"));
const taxi = expense("taxi", "Taxi", 90000, P, { [A]: 30000, [R]: 30000, [P]: 30000 }, d("10-30"));
const pay = { id: "pay1", fromId: R, toId: P, amount: 30000, createdAt: d("10-31"), deletedAt: null as Date | null, deletedById: null as string | null };
const view = (expenses: ReturnType<typeof expense>[], events: ReturnType<typeof ev>[], complete = true) => {
  const r = asOfCut({ expenses, payments: [pay] }, events, R, CUT, { complete });
  return { ...r, live: r.expenses.filter((e) => !e.deletedAt) };
};

describe("M1: a change to the bill photo only does not hide the row from Ravi", () => {
  const photoEdit = ev("photo", d("11-05"), "expense_edited", { expenseId: "hotel" }, { text: `${BILL_PHOTO_EDIT_PREFIX}Hotel` });
  // The row today: same words and money, but editedAt was stamped by the photo change.
  const hotelNow = { ...hotelThen, editedAt: d("11-05") };
  it("Ravi still sees Hotel 1,200,000, and spent 1,350,000 over 3 expenses", () => {
    const v = view([hotelNow, snacks, taxi], [photoEdit]);
    expect(v.live.length).toBe(3);
    expect(sum(v.live.map((e) => spentAmount(e)))).toBe(1350000);
    const h = v.expenses.find((e) => e.id === "hotel")!;
    expect(h.description).toBe("Hotel");
    expect(h.amount).toBe(1200000);
    expect(h.editedAt).toBeNull(); // not marked as edited, so its notes are not hidden either
  });
  it("a photo change followed by a real edit rolls back to the state before that edit (and before the photo)", () => {
    const real = ev("real", d("11-06"), "expense_edited", { expenseId: "hotel" }, { undo: JSON.stringify({ type: "expense_revert", expenseId: "hotel", before: stateOf(hotelThen) }) });
    const edited = { ...hotelNow, description: "Hotel + flight", amount: 2500000, editedAt: d("11-06"), shares: shares("hotel", { [A]: 1000000, [P]: 1500000 }) };
    const v = view([edited, snacks, taxi], [photoEdit, real]);
    expect(v.expenses.find((e) => e.id === "hotel")!.amount).toBe(1200000);
  });
  it("an edit with no saved 'before' that is NOT a photo change still hides the row", () => {
    const mystery = ev("m", d("11-05"), "expense_edited", { expenseId: "hotel" }, { text: "changed Hotel" });
    expect(view([hotelNow, snacks, taxi], [mystery]).live.map((e) => e.id).sort()).toEqual(["snacks", "taxi"]);
  });
  it("a row stamped as edited after the last photo change (something unlogged) is still hidden", () => {
    const late = { ...hotelThen, editedAt: d("12-20") };
    expect(view([late, snacks, taxi], [photoEdit]).live.map((e) => e.id).sort()).toEqual(["snacks", "taxi"]);
  });
  it("the balances do not move: the full ledger is the same with or without the photo change", () => {
    const ids = [A, R, P];
    const full = netBalances(ids, [hotelNow, snacks, taxi], [pay]);
    expect(full[R]).toBe(0);
    expect(scopeBalances(full, smartSettle(full), R).net).toEqual({ [R]: 0 });
  });
});

describe("M2: leaving and coming back leaves a gap that is not time together", () => {
  // Asha: in 5 Jan, left 20 Jan, brought back automatically on 5 May (the same row, leftAt cleared). Ravi: 1 Mar to 30 Mar.
  const ashaRow = { createdAt: d("01-05"), claimedAt: null, seenAt: null, leftAt: null as Date | null, removedAt: null };
  const raviRow = { createdAt: d("03-01"), claimedAt: null, seenAt: null, leftAt: d("03-30") as Date | null, removedAt: null };
  const ashaHistory = [{ kind: "member_left", createdAt: d("01-20") }, { kind: "member_rejoined", createdAt: d("05-05") }];
  it("with the history, Asha and Ravi never overlapped", () => {
    expect(membershipPeriods(ashaRow, ashaHistory)).toEqual([{ from: d("01-05"), to: d("01-20") }, { from: d("05-05"), to: null }]);
    expect(overlapped(membershipSpan(ashaRow, ashaHistory), membershipSpan(raviRow))).toBe(false);
    expect(overlapped(membershipSpan(raviRow), membershipSpan(ashaRow, ashaHistory))).toBe(false);
    expect(sharedGroupRow([{ ...raviRow, groupId: "goa", id: "r" }], [{ ...ashaRow, groupId: "goa", id: "a" }], (r) => membershipSpan(r, (r as { id?: string }).id === "a" ? ashaHistory : []))).toBeNull();
  });
  it("without the history (the row alone) they would look as if they overlapped: that is the bug this closes", () => {
    expect(overlapped(membershipSpan(ashaRow), membershipSpan(raviRow))).toBe(true);
  });
  it("a stay that really did overlap still counts, in either of Asha's stays", () => {
    const meera = { createdAt: d("05-10"), claimedAt: null, seenAt: null, leftAt: null as Date | null, removedAt: null };
    expect(overlapped(membershipSpan(ashaRow, ashaHistory), membershipSpan(meera))).toBe(true);
    const jan = { createdAt: d("01-10"), claimedAt: null, seenAt: null, leftAt: d("01-15") as Date | null, removedAt: null };
    expect(overlapped(membershipSpan(ashaRow, ashaHistory), membershipSpan(jan))).toBe(true);
  });
  it("the row's end state wins: left now with no line saved closes the open stay; back now with no line saved reopens it", () => {
    expect(membershipPeriods({ ...ashaRow, leftAt: d("02-01") }, [])).toEqual([{ from: d("01-05"), to: d("02-01") }]);
    expect(membershipPeriods(ashaRow, [{ kind: "member_left", createdAt: d("01-20") }])).toEqual([{ from: d("01-05"), to: null }]);
  });
  it("a removal is a 'left' line too: removed 15 Feb, brought back 1 Mar, removed again 20 Mar", () => {
    const row = { ...ashaRow, leftAt: d("03-20"), removedAt: d("03-20") };
    const h = [{ kind: "member_left", createdAt: d("02-15") }, { kind: "member_rejoined", createdAt: d("03-01") }, { kind: "member_left", createdAt: d("03-20") }];
    expect(membershipPeriods(row, h)).toEqual([{ from: d("01-05"), to: d("02-15") }, { from: d("03-01"), to: d("03-20") }]);
  });
  it("which person a history line is about comes from its saved undo text", () => {
    expect(memberOfChange(JSON.stringify({ type: "member_set", memberId: "m1", data: { leftAt: null } }))).toBe("m1");
    expect(memberOfChange("")).toBeNull();
    expect(memberOfChange(JSON.stringify({ type: "expense_revert" }))).toBeNull();
  });
});

describe("M3: one list of changes gives one answer, wherever it is read", () => {
  const hotelEdited = { ...hotelThen, description: "Hotel + flight", amount: 2500000, editedAt: d("11-05"), shares: shares("hotel", { [A]: 1000000, [P]: 1500000 }) };
  const snacksGone = { ...snacks, deletedAt: d("11-06"), deletedById: P };
  const events = [
    ev("e1", d("11-05"), "expense_edited", { expenseId: "hotel" }, { undo: JSON.stringify({ type: "expense_revert", expenseId: "hotel", before: stateOf(hotelThen) }) }),
    ev("e2", d("11-06"), "expense_deleted", { expenseId: "snacks" }),
  ];
  const rows = [hotelEdited, snacksGone, taxi];
  it("the same rows come out whatever order the changes arrive in, and with unrelated lines mixed in", () => {
    const base = view(rows, events);
    const shuffled = view(rows, [events[1], ev("noise", d("11-07"), "expense_added", { expenseId: "later" }), events[0]]);
    expect(shuffled.expenses).toEqual(base.expenses);
    expect(sum(base.live.map((e) => spentAmount(e)))).toBe(1350000);
    expect(base.live.length).toBe(3);
  });
  it("the group page and Home read the same rows through one function, so they give the same numbers", () => {
    // The group page passes every loaded row; Home's lighter loader passes only the rows that changed. Same answer for those rows.
    const all = view(rows, events);
    const changedOnly = asOfCut({ expenses: [hotelEdited, snacksGone], payments: [] }, events, R, CUT).expenses;
    for (const c of changedOnly) expect(all.expenses.find((e) => e.id === c.id)).toEqual(c);
    const homeSpent = sum(changedOnly.filter((e) => !e.deletedAt).map((e) => spentAmount(e))) + spentAmount(taxi);
    expect(homeSpent).toBe(1350000);
  });
  it("past the cap (an incomplete list) a row changed since is hidden, never shown with later content", () => {
    const v = view(rows, [], false);
    expect(v.live.map((e) => e.id)).toEqual(["taxi"]); // Hotel (edited) and Snacks (deleted) can't be told: hidden. Taxi has Ravi in it: kept.
  });
  it("past the cap a row that involves Ravi is never rolled back or hidden", () => {
    const taxiEdited = { ...taxi, amount: 120000, editedAt: d("11-05"), shares: shares("taxi", { [A]: 40000, [R]: 40000, [P]: 40000 }) };
    const v = view([taxiEdited], [ev("t", d("11-05"), "expense_edited", { expenseId: "taxi" }, { undo: JSON.stringify({ type: "expense_revert", expenseId: "taxi", before: stateOf(taxi) }) })], false);
    expect(v.expenses[0]).toEqual(taxiEdited);
  });
});

describe("M4: a currency change after an edit never mixes currencies", () => {
  const usd = (rate: string) => ev("cur", d("11-08"), "currency_changed", {}, { details: JSON.stringify(["Currency: INR → USD", `Rate used: 1 INR = ${rate} USD`, "Group total: x → y"]) });
  const hotelEdited = { ...hotelThen, description: "Hotel + flight", amount: 2500000, editedAt: d("11-05"), shares: shares("hotel", { [A]: 1000000, [P]: 1500000 }) };
  const edit = ev("e1", d("11-05"), "expense_edited", { expenseId: "hotel" }, { undo: JSON.stringify({ type: "expense_revert", expenseId: "hotel", before: stateOf(hotelThen) }) });
  // After the switch every row in the group is in US cents (rate 0.012): the edited Hotel is 2,500,000 x 0.012 = 30,000.
  const inUsd = { ...hotelEdited, amount: 30000, convertedAmount: 30000, baseCurrency: "USD", shares: shares("hotel", { [A]: 12000, [P]: 18000 }) };
  it("Ravi sees Hotel as it was, in US cents: 1,200,000 paise x 0.012 = 14,400 cents (7,200 + 7,200)", () => {
    const v = asOfCut({ expenses: [inUsd], payments: [] }, [edit, usd("0.012")], R, CUT);
    const h = v.expenses[0];
    expect(h.description).toBe("Hotel");
    expect(h.amount).toBe(14400);
    expect(h.baseCurrency).toBe("USD");
    expect(h.shares.map((s) => s.amount)).toEqual([7200, 7200]);
    expect(sum(h.shares.map((s) => s.amount))).toBe(14400);
  });
  it("a currency change made BEFORE the edit is already in the saved state: not converted twice", () => {
    const early = ev("cur0", d("11-03"), "currency_changed", {}, { details: JSON.stringify(["Currency: INR → USD", "Rate used: 1 INR = 0.012 USD"]) });
    const thenUsd = expense("hotel", "Hotel", 14400, A, { [A]: 7200, [P]: 7200 }, d("10-28"), { baseCurrency: "USD", originalCurrency: "USD", originalAmount: 14400, convertedAmount: 14400 });
    const nowUsd = { ...thenUsd, description: "Hotel + flight", amount: 30000, editedAt: d("11-05"), shares: shares("hotel", { [A]: 12000, [P]: 18000 }) };
    const e = ev("e1", d("11-05"), "expense_edited", { expenseId: "hotel" }, { undo: JSON.stringify({ type: "expense_revert", expenseId: "hotel", before: stateOf(thenUsd) }) });
    expect(asOfCut({ expenses: [nowUsd], payments: [] }, [early, e], R, CUT).expenses[0].amount).toBe(14400);
  });
  it("two switches in a row are carried through one after the other", () => {
    const toEur = ev("cur2", d("11-09"), "currency_changed", {}, { details: JSON.stringify(["Currency: USD → EUR", "Rate used: 1 USD = 0.5 EUR"]) });
    const inEur = { ...inUsd, amount: 15000, convertedAmount: 15000, baseCurrency: "EUR", shares: shares("hotel", { [A]: 6000, [P]: 9000 }) };
    const h = asOfCut({ expenses: [inEur], payments: [] }, [edit, usd("0.012"), toEur], R, CUT).expenses[0];
    expect(h.amount).toBe(7200); // 14,400 cents x 0.5
    expect(h.baseCurrency).toBe("EUR");
  });
  it("a switch whose rate can't be read (an Undo of one) hides the row instead of guessing", () => {
    const odd = ev("cur", d("11-08"), "currency_changed", {}, { details: JSON.stringify(["Currency: USD → INR"]) });
    expect(asOfCut({ expenses: [inUsd], payments: [] }, [edit, odd], R, CUT).expenses).toEqual([]);
  });
  it("rows never edited just show their current amounts (the switch already converted them)", () => {
    const converted = { ...taxi, amount: 1080, baseCurrency: "USD" };
    expect(asOfCut({ expenses: [converted], payments: [] }, [usd("0.012")], R, CUT).expenses[0]).toEqual(converted);
  });
});

describe("L1: a saved state without notes / payers / kind never mixes today's fields in", () => {
  const old = (({ notes, payers, kind, ...rest }) => rest)(stateOf(hotelThen));
  const edited = { ...hotelThen, notes: "Booked with Priya's card", payers: JSON.stringify([{ m: A, a: 2500000 }]), kind: "expense", description: "Hotel + flight", amount: 2500000, editedAt: d("11-05"), shares: shares("hotel", { [A]: 1000000, [P]: 1500000 }) };
  const e = ev("e1", d("11-05"), "expense_edited", { expenseId: "hotel" }, { undo: JSON.stringify({ type: "expense_revert", expenseId: "hotel", before: old }) });
  it("notes stay hidden ('changed after you left'), and payers and kind are what they were before those existed", () => {
    const r = asOfCut({ expenses: [edited], payments: [] }, [e], R, CUT).expenses[0] as typeof edited & { notesHidden?: boolean };
    expect(r.notes).toBe("");
    expect(r.notesHidden).toBe(true);
    expect(r.payers).toBe("");
    expect(r.kind).toBe("expense");
    expect(r.amount).toBe(1200000);
    expect(hideLaterNotes([r], CUT)[0].notes).toBe("");
  });
});

describe("L2: 'Mark all paid' and 'Settle everything' lines have no payment id of their own", () => {
  const p1 = { id: "p1", fromId: A, toId: P, amount: 500000, createdAt: d("10-30"), deletedAt: d("11-07") as Date | null, deletedById: P as string | null };
  const p2 = { id: "p2", fromId: P, toId: A, amount: 100000, createdAt: d("10-30"), deletedAt: null as Date | null, deletedById: null as string | null };
  it("a set of payments taken off after he left shows as not taken off; one brought back after shows as it was", () => {
    const off = ev("o", d("11-07"), "payment_deleted", {}, { undo: JSON.stringify({ type: "payments_set", paymentIds: ["p1"], deleted: false }) });
    const on = ev("n", d("11-08"), "payment_restored", {}, { undo: JSON.stringify({ type: "settle_all", paymentIds: ["p2"], apply: false }) });
    const r = asOfCut({ expenses: [], payments: [p1, p2] }, [off, on], R, CUT).payments;
    expect(r.find((p) => p.id === "p1")!.deletedAt).toBeNull();
    expect(r.find((p) => p.id === "p2")!.deletedAt).toEqual(CUT); // was off on his last day, brought back after
  });
});

describe("M5: reactions on expenses (checked in the page's own query)", () => {
  it("the group page asks for only the reactions made by the day a leaver left", () => {
    const page = readFileSync("src/app/groups/[id]/page.tsx", "utf8");
    const q = page.slice(page.indexOf("db.reaction.findMany"), page.indexOf("db.reaction.findMany") + 260);
    expect(q).toContain("createdAt: { lte: leaver.leftAt }");
  });
  it("every screen reads the row changes through the one function (no private windows)", () => {
    for (const f of ["src/lib/group-data.ts", "src/app/groups/[id]/export/route.ts", "src/app/api/my-data/route.ts", "src/lib/left-view-db.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("laterRowEvents(");
      expect(src, f).not.toMatch(/asOfCut\([^)]*\bafter\b/);
    }
  });
});
