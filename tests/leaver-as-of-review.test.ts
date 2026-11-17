import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { asOfCut, BILL_PHOTO_EDIT_PREFIX, hideLaterNotes, isMark, memberMark, memberOfChange, membershipPeriods, membershipSpan, overlapped, PHOTO_ONLY_MARK, scopeBalances, sharedGroupRow } from "@/lib/left-view";
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
  it("the row's end state wins: left now with no line saved closes the open stay", () => {
    expect(membershipPeriods({ ...ashaRow, leftAt: d("02-01") }, [])).toEqual([{ from: d("01-05"), to: d("02-01") }]);
    // (In the group now, last line says left, no line says came back: the old stay stays closed. See the join-link tests below.)
    expect(membershipPeriods(ashaRow, [{ kind: "member_left", createdAt: d("01-20") }], d("06-01"))).toEqual([{ from: d("01-05"), to: d("01-20") }, { from: d("06-01"), to: null }]);
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


describe("second review: rejoining by the join link, move-out undo, marks", () => {
  const ashaRow = { createdAt: d("01-05"), claimedAt: null, seenAt: null, seenEventsAt: null as Date | null, leftAt: null as Date | null, removedAt: null };
  const raviRow = { createdAt: d("03-01"), claimedAt: null, seenAt: null, leftAt: d("03-30") as Date | null, removedAt: null };
  const NOW = d("06-01");
  it("old data: Asha left 20 Jan, came back by the join link with no line saved, Ravi 1-30 Mar: not overlapped (the old stay is not reopened)", () => {
    const h = [{ kind: "member_left", createdAt: d("01-20") }];
    const span = membershipSpan(ashaRow, h, NOW);
    expect(span.periods).toEqual([{ from: d("01-05"), to: d("01-20") }, { from: NOW, to: null }]);
    expect(overlapped(span, membershipSpan(raviRow))).toBe(false);
  });
  it("...and a notifications stamp (seenEventsAt) never starts the new stay: Asha leaves 20 Jan, stamp 15 Mar, Ravi 1-30 Mar, back with no line: no overlap", () => {
    const h = [{ kind: "member_left", createdAt: d("01-20") }];
    const seen = { ...ashaRow, seenEventsAt: d("03-15") }; // markNotificationsSeen stamps this even on a group she has left
    expect(membershipSpan(seen, h, NOW).periods![1].from).toEqual(NOW);
    expect(overlapped(membershipSpan(seen, h, NOW), membershipSpan(raviRow))).toBe(false); // they were never there together
    expect(membershipSpan({ ...ashaRow, seenEventsAt: d("01-10") }, h, NOW).periods![1].from).toEqual(NOW);
  });
  it("new data: the join link now writes a 'rejoined' line with a member_set undo, so the stay starts the day she came back", () => {
    const undo = JSON.stringify({ type: "member_set", memberId: "asha", data: { leftAt: d("01-20").toISOString() } });
    expect(memberOfChange(undo)).toBe("asha");
    const h = [{ kind: "member_left", createdAt: d("01-20") }, { kind: "member_rejoined", createdAt: d("05-05") }];
    expect(overlapped(membershipSpan(ashaRow, h, NOW), membershipSpan(raviRow))).toBe(false);
  });
  it("move out 20 Jan, undo 21 Jan, Ravi joins 1 Mar, Asha leaves 1 Apr: overlapped", () => {
    // The Undo of a move-out writes a 'came back' line with a member mark in its details (no undo, so no redo).
    expect(memberOfChange("", JSON.stringify(["Their deposit is back with them", memberMark("asha")]))).toBe("asha");
    const asha = { ...ashaRow, leftAt: d("04-01") as Date | null };
    const both = [{ kind: "member_left", createdAt: d("01-20") }, { kind: "member_rejoined", createdAt: d("01-21") }];
    expect(membershipPeriods(asha, both, NOW)).toEqual([{ from: d("01-05"), to: d("01-20") }, { from: d("01-21"), to: d("04-01") }]);
    expect(overlapped(membershipSpan(asha, both, NOW), membershipSpan({ ...raviRow, leftAt: null }))).toBe(true);
    // The move-out line itself is marked undone, and memberHistory skips undone lines: only the 'came back' line is left, and nothing breaks.
    expect(overlapped(membershipSpan(asha, [both[1]], NOW), membershipSpan({ ...raviRow, leftAt: null }))).toBe(true);
  });
  it("marks are for the code: recognised, and left out of what people read", () => {
    expect(isMark(PHOTO_ONLY_MARK)).toBe(true);
    expect(isMark("Amount: ₹900 → ₹1,200")).toBe(false);
    expect(readFileSync("src/lib/events.ts", "utf8")).toContain("!isMark(x)"); // parseDetails drops them
  });
  it("only the exact marks are marks: a line that merely starts with @mark: (a member named @mark:Bob) stays visible", () => {
    expect(isMark("@mark:photo-only")).toBe(true);
    expect(isMark("@mark:member=cm0abc_12-X")).toBe(true);
    expect(isMark("@mark:Bob: ₹300")).toBe(false); // a share line for a member named "@mark:Bob"
    expect(isMark("@mark:Bob")).toBe(false);
    expect(isMark("@mark:member=")).toBe(false);
    expect(isMark("@mark:member=a b")).toBe(false);
    expect(isMark("@mark:photo-only extra")).toBe(false);
    // The reader and the writer agree: what memberMark writes is a mark and is read back; a typed look-alike is not.
    expect(isMark(memberMark("asha"))).toBe(true);
    expect(memberOfChange("", JSON.stringify(["@mark:Bob: ₹300", memberMark("asha")]))).toBe("asha");
    expect(memberOfChange("", JSON.stringify(["@mark:member=Bob Jones"]))).toBeNull();
  });
  it("the join link writes the line in the same transaction as clearing leftAt (checked in the source)", () => {
    const src = readFileSync("src/lib/join.ts", "utf8");
    expect(src).toMatch(/\$transaction\(async \(tx\) => \{\s*if \(\(await tx\.member\.updateMany\(\{ where: \{ id: mine\.id, removedAt: null, leftAt \}, data: \{ leftAt: null \}[\s\S]*?logEvent\(tx, \{[^}]*kind: "member_rejoined"/);
  });
  it("a changed reaction emoji takes a new time, so a leaver never sees a change made after they left (checked in the source)", () => {
    const src = readFileSync("src/app/moment-actions.ts", "utf8");
    expect(src).toContain("update: { emoji, createdAt: new Date() }");
    expect(src).toContain("data: { emoji, createdAt: new Date() }");
  });
  it("the square page and picture say nothing about other people's money to a leaver (checked in the source)", () => {
    expect(readFileSync("src/app/groups/[id]/square-image/route.tsx", "utf8")).toMatch(/if \(data\.leaver\) return new Response\([^)]*409/);
    const page = readFileSync("src/app/groups/[id]/square/page.tsx", "utf8");
    expect(page).toContain("You're settled up here");
    // Safety part C review: a leaver gets the neutral line in the heading's place, no confetti, no "All square" heading, and never "Add an expense first."
    expect(page).toContain("{!leaver && <Confetti");
    expect(page).toContain('{leaver ? neutral : "All square"}');
    expect(page).toContain('leaver ? "Nothing to settle for you here." : "Add an expense first."');
    expect(page).toMatch(/\{!leaver && \(\s*<div className="mt-4 w-full">\s*<ShareSheet/);
  });
  it("Home works out each left group's as-of changes once per request, in parallel, and Your month uses them (checked in the source)", () => {
    const db = readFileSync("src/lib/left-view-db.ts", "utf8");
    expect(db).toContain("const asOfChangedOnce = cache(");
    expect(db).toContain("const touchedAfterOnce = cache(");
    const home = readFileSync("src/lib/home/home-data.ts", "utf8");
    expect(home.match(/await asOfChanged\(/g)?.length).toBe(1);
    expect(home).toContain("Promise.all(\n    leaverGroups.map");
    expect(home).toContain("monthList");
  });
  it("the join link writes the line, and the move-out undo carries the mark (checked in the source)", () => {
    expect(readFileSync("src/lib/join.ts", "utf8")).toMatch(/kind: "member_rejoined"[\s\S]*type: "member_set"/);
    expect(readFileSync("src/lib/home/moving-db.ts", "utf8")).toContain("memberMark(memberId)");
  });
});

describe("second review: lines, caps and currency", () => {
  const photoMarked = ev("pm", d("11-05"), "expense_edited", { expenseId: "hotel" }, { text: "", details: JSON.stringify([PHOTO_ONLY_MARK]) });
  const hotelNow = { ...hotelThen, editedAt: d("11-05") };
  it("(a) a photo-only line is recognised by its mark, whatever its words", () => {
    expect(view([hotelNow, snacks, taxi], [photoMarked]).live.length).toBe(3);
  });
  it("(b) 'Settle everything' Undo and Redo count as payment toggles", () => {
    const p1 = { id: "p1", fromId: A, toId: P, amount: 500000, createdAt: d("10-30"), deletedAt: d("11-07") as Date | null, deletedById: P as string | null };
    const undone = ev("u", d("11-07"), "group_reopened", {}, { undo: JSON.stringify({ type: "settle_all", paymentIds: ["p1"], apply: true }) });
    expect(asOfCut({ expenses: [], payments: [p1] }, [undone], R, CUT).payments[0].deletedAt).toBeNull();
    const redone = ev("r", d("11-08"), "group_settled_closed", {}, { undo: JSON.stringify({ type: "settle_all", paymentIds: ["p2"], apply: false }) });
    const p2 = { ...p1, id: "p2", deletedAt: null as Date | null, deletedById: null as string | null };
    expect(asOfCut({ expenses: [], payments: [p2] }, [redone], R, CUT).payments[0].deletedAt).toEqual(CUT); // put back after: it was off that day
  });
  it("(c) past the cap a row restored after he left is not shown as active: no row without him in it is shown", () => {
    const restored = { ...snacks }; // active now; it may have been deleted on his last day and brought back after the list was cut
    expect(view([restored, taxi], [], false).live.map((e) => e.id)).toEqual(["taxi"]);
    expect(asOfCut({ expenses: [], payments: [{ ...pay, id: "other", fromId: A, toId: P }] }, [], R, CUT, { complete: false }).payments).toEqual([]);
  });
  it("(d) a currency switch followed by its undo is no change", () => {
    const edit = ev("e1", d("11-05"), "expense_edited", { expenseId: "hotel" }, { undo: JSON.stringify({ type: "expense_revert", expenseId: "hotel", before: stateOf(hotelThen) }) });
    const usd = ev("c1", d("11-08"), "currency_changed", {}, { details: JSON.stringify(["Currency: INR → USD", "Rate used: 1 INR = 0.012 USD"]) });
    const back = ev("c2", d("11-09"), "currency_changed", {}, { details: JSON.stringify(["Currency: USD → INR", "Every amount is back exactly as it was"]) });
    const edited = { ...hotelThen, description: "Hotel + flight", amount: 2500000, editedAt: d("11-05"), shares: shares("hotel", { [A]: 1000000, [P]: 1500000 }) };
    const h = asOfCut({ expenses: [edited], payments: [] }, [edit, usd, back], R, CUT).expenses[0];
    expect(h.amount).toBe(1200000);
    expect(h.baseCurrency).toBe("INR");
    expect(h.shares.map((x) => x.amount)).toEqual([600000, 600000]);
  });
  it("(e) the group page takes 'touched' from the uncapped database read (checked in the source)", () => {
    const src = readFileSync("src/lib/group-data.ts", "utf8");
    expect(src.match(/touchedAfter\(id, me\.id, cut\.leftAt\)/g)?.length).toBe(2);
  });
});

describe("speed: one pass over the lines, not one per row", () => {
  it("20,000 lines over 2,000 expenses are worked through in under 300 ms", () => {
    const rows: ReturnType<typeof expense>[] = [];
    const events: ReturnType<typeof ev>[] = [];
    for (let i = 0; i < 2000; i++) {
      const id = `x${i}`;
      const row = expense(id, `Item ${i}`, 10000 + i, A, { [A]: 5000 + i, [P]: 5000 }, d("10-20"), { editedAt: d("11-05") });
      rows.push(row);
      const before = stateOf(expense(id, `Item ${i} (old)`, 10000, A, { [A]: 5000, [P]: 5000 }, d("10-20")));
      // ten lines each: an edit with a saved "before", deletes and restores, reactions' neighbours (other kinds), payments' lines
      events.push(ev(`${id}-a`, d("11-05"), "expense_edited", { expenseId: id }, { undo: JSON.stringify({ type: "expense_revert", expenseId: id, before }), text: "", details: "[]" }));
      for (let k = 0; k < 9; k++) events.push(ev(`${id}-${k}`, new Date(d("11-06").getTime() + k * 1000), k % 2 ? "expense_restored" : "expense_deleted", { expenseId: id }));
    }
    const payments = Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, fromId: A, toId: P, amount: 100, createdAt: d("10-25"), deletedAt: null as Date | null, deletedById: null as string | null }));
    const t0 = performance.now();
    const out = asOfCut({ expenses: rows, payments }, events, R, CUT);
    const ms = performance.now() - t0;
    expect(events.length).toBe(20000);
    expect(out.expenses.length).toBe(2000);
    expect(out.expenses[7].description).toBe("Item 7 (old)");
    expect(ms).toBeLessThan(300);
  });
});
