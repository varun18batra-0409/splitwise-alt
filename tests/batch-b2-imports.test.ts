import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { looseAmount, parseImport, type ColumnMap } from "@/lib/import-formats";
import { balanceGapText, balancesOf, parseSplitwiseCsv, planRow, previewText, MAX_IMPORT_ROWS, readCsv } from "@/lib/splitwise-csv";
import { groupCsv, myDataCsv } from "@/lib/csv";
import { parseQuickLine } from "@/lib/quickline";
import { analyzeName, editDistance, editDistanceWithin, guessCategory } from "@/lib/categories";

// Batch B2 (16 Nov line review): spreadsheet imports and the quick line. Hand-worked numbers are in each test; every import is also checked
// for the money rules: each expense's payers and shares add up to its amount, each row's nets add up to 0, and so do everyone's balances.

function ok(text: string, opts: { map?: ColumnMap; currency?: string } = {}) {
  const p = parseImport(text, opts);
  if (!p.ok) throw new Error(p.error);
  return p;
}
// Asserts the money rules over a whole parsed file and returns each person's balance by name.
function checked(p: ReturnType<typeof ok>) {
  const plans = p.rows.map(planRow);
  const sum = (xs: { a: number }[]) => xs.reduce((t, x) => t + x.a, 0);
  for (const r of p.rows) expect(r.nets.reduce((t, x) => t + x, 0)).toBe(0);
  for (const pl of plans) {
    if (pl.type === "expense") {
      expect(pl.payers.length).toBeGreaterThan(0);
      expect(pl.amount).toBeGreaterThan(0);
      expect(sum(pl.payers)).toBe(pl.amount);
      expect(sum(pl.shares)).toBe(pl.amount);
    } else expect(pl.amount).toBeGreaterThan(0);
  }
  const net = balancesOf(plans, p.people.length);
  expect(net.reduce((t, x) => t + x, 0)).toBe(0);
  return Object.fromEntries(p.people.map((n, i) => [n, net[i]]));
}

describe("LM-3: one clear number per cell", () => {
  it("'500 x 2', '1e3' and '1,234.567' (rupees) can't be read; they are not turned into other numbers", () => {
    expect(looseAmount("500 x 2", "INR")).toBeNull(); // was 5002
    expect(looseAmount("1e3", "INR")).toBeNull(); // was 13
    expect(looseAmount("1,234.567", "INR")).toBeNull(); // 3 decimals, rupees have 2: was rounded to 1234.57
    expect(looseAmount("12/03", "INR")).toBeNull(); // was 1203
    expect(looseAmount("1.234", "INR")).toBeNull(); // 1.234 or 1,234? Not guessed
    expect(looseAmount("1,2,3", "INR")).toBeNull();
    expect(looseAmount("1 234", "INR")).toBeNull();
  });
  it("what was already read stays read: typographic minus, Rs., brackets, Indian grouping, zeros after the point in yen", () => {
    expect(looseAmount("−40", "EUR")).toBe(-4000); // U+2212
    expect(looseAmount("Rs.500", "INR")).toBe(50000);
    expect(looseAmount("Rs -40", "INR")).toBe(-4000);
    expect(looseAmount("₹1,23,456.50", "INR")).toBe(12345650);
    expect(looseAmount("1,234,567", "INR")).toBe(123456700);
    expect(looseAmount("500.00", "JPY")).toBe(500);
    expect(looseAmount("1.50", "JPY")).toBeNull(); // half a yen can't be placed
    expect(looseAmount(".5", "INR")).toBe(50);
    expect(looseAmount("1.005", "INR")).toBeNull();
    expect(looseAmount("0", "INR")).toBe(0);
  });
  it("in a file: the three unreadable lines are skipped with a reason, '−40' is money back of 4000, and the good line imports", () => {
    // Hand-worked: Dinner 100.00 paid by Asha for Ravi = +10000 / -10000. "−40" is money back: Asha −4000 / Ravi +4000. Net: Asha +6000, Ravi −6000.
    const text = ["Title,Amount,Paid by,Paid for", "A,500 x 2,Asha,Ravi", "B,1e3,Asha,Ravi", 'C,"1,234.567",Asha,Ravi', "D,−40,Asha,Ravi", "E,100,Asha,Ravi"].join("\n");
    const p = ok(text);
    expect(p.skipped).toEqual([2, 3, 4].map((line) => ({ line, reason: "the amount couldn’t be read" })));
    expect(p.rows.map((r) => r.line)).toEqual([5, 6]);
    expect(p.rows[0].cost).toBe(4000);
    expect(checked(p)).toEqual({ Asha: 6000, Ravi: -6000 });
  });
});

describe("LM-4: a Loopin 'just you' line is skipped, the rest imports", () => {
  const head = "Date,Type,Description,Notes,Category,Paid by,Amount (INR),Original amount,Original currency,Exchange rate,Card markup (INR),Paid with,Status,Asha's share (INR),Ravi's share (INR)";
  const line = (desc: string, paid: string, amount: string, a: string, r: string) => ["2026-10-18", "Expense", desc, "", "Other", paid, amount, "", "", "", "", "", "", a, r].join(",");
  it("'Asha paid 400, Asha's share 400' changes nobody's balance: skipped with a reason, no crash; the dinner (1000 split 500/500) imports", () => {
    const p = ok([head, line("Sunscreen", "Asha", "400.00", "400.00", ""), line("Dinner", "Asha", "1000.00", "500.00", "500.00")].join("\r\n"));
    expect(p.skipped).toEqual([{ line: 2, reason: "it didn’t change anyone’s balance" }]);
    expect(p.rows).toHaveLength(1);
    expect(checked(p)).toEqual({ Asha: 50000, Ravi: -50000 }); // paise: Asha paid 100000, her own share 50000
    expect(previewText(p).expenses).toBe(1);
  });
  it("a Loopin file of only 'just you' lines says so instead of crashing", () => {
    const p = parseImport([head, line("Sunscreen", "Asha", "400.00", "400.00", "")].join("\r\n"));
    expect(p).toMatchObject({ ok: false, error: "None of the 1 lines could be read (it didn’t change anyone’s balance)." });
  });
});

describe("MB-8: yen 0.5 / -0.5 is skipped, not a crash", () => {
  it("the rounding turns [0.5, -0.5] into [0, 0]: skipped; the 1000-yen lunch (500 / -500) imports and adds up", () => {
    const text = ["Date,Description,Category,Cost,Currency,Asha,Ravi", "2026-09-01,Half,General,0.50,JPY,0.5,-0.5", "2026-09-02,Lunch,Dining out,1000,JPY,500,-500"].join("\r\n");
    const p = parseSplitwiseCsv(text);
    if (!p.ok) throw new Error(p.error);
    expect(p.skipped).toEqual([{ line: 2, reason: "it didn’t change anyone’s balance" }]);
    expect(p.rows).toHaveLength(1);
    const plans = p.rows.map(planRow);
    expect(plans.every((x) => x.type === "expense" && x.payers.length > 0)).toBe(true);
    // Lunch 1000: Asha paid 1000, her own share 500, Ravi's 500.
    expect(balancesOf(plans, 2)).toEqual([500, -500]);
    const via = parseImport(text); // the same through the shared entry point
    expect(via.ok && via.rows).toHaveLength(1);
  });
});

describe("LM-6: 'Share (Asha)' is Asha", () => {
  it("headers 'Share (Asha)' and 'Share (Ravi)': 2 people, Asha paid 100.00 and each owes 50.00 → Asha +5000, Ravi −5000", () => {
    const p = ok("Title,Amount,Paid by,Share (Asha),Share (Ravi)\nDinner,100,Asha,50,50\n");
    expect(p.people).toEqual(["Asha", "Ravi"]);
    expect(p.rows[0].nets).toEqual([5000, -5000]);
    expect(checked(p)).toEqual({ Asha: 5000, Ravi: -5000 });
  });
  it("'Asha's share (INR)' and 'Ravi owes' still give plain names", () => {
    const p = ok("Title,Amount,Paid by,Asha's share (INR),Ravi owes\nDinner,100,Asha,50,50\n");
    expect(p.people).toEqual(["Asha", "Ravi"]);
  });
});

describe("LM-5: who 'everyone' means", () => {
  // Choice: where the file names the people (a 'for' column or share columns), Zoe is included even if she never paid (already so);
  // for plain 'Equally between everyone' the file names nobody else, so it means everyone who paid, and the option now says so.
  it("Asha paid 300.00 for Asha, Ravi and Zoe (Zoe never paid) in a 'for' column: 30000 / 3 = 10000 each → Asha +20000, Ravi −10000, Zoe −10000", () => {
    const p = ok('Title,Amount,Paid by,Paid for\nDinner,300,Asha,"Asha, Ravi, Zoe"\n');
    expect(p.people).toEqual(["Asha", "Ravi", "Zoe"]);
    expect(checked(p)).toEqual({ Asha: 20000, Ravi: -10000, Zoe: -10000 });
  });
  it("the same with Zoe's own share column ticked (100.00 each)", () => {
    const p = ok("Title,Amount,Paid by,Asha share,Ravi share,Zoe share\nDinner,300,Asha,100,100,100\n");
    expect(checked(p)).toEqual({ Asha: 20000, Ravi: -10000, Zoe: -10000 });
  });
  it("'everyone' with nobody else named: Asha and Ravi paid at some point, Zoe didn't, so the 300.00 dinner is 150.00 each (+15000 / −15000), and the screen says 'everyone who paid'", () => {
    const text = "Title,Amount,Paid by\nDinner,300,Asha\nCab,100,Ravi\n";
    const p = ok(text, { map: { date: -1, description: 0, amount: 1, paidBy: 2, split: "everyone" } });
    expect(p.people).toEqual(["Asha", "Ravi"]);
    // Dinner +15000/−15000, Cab −5000/+5000 → Asha +10000, Ravi −10000
    expect(checked(p)).toEqual({ Asha: 10000, Ravi: -10000 });
    expect(readFileSync("src/components/SplitwiseImport.tsx", "utf8")).toContain("Equally between everyone who paid");
  });
});

describe("LM-8: columns past the header, and a Loopin file over the line limit", () => {
  const text = "Title,Amount,Paid by,A share,B share,Note\nDinner,100,Asha,50,50,x\n";
  const base: ColumnMap = { date: -1, description: 0, amount: 1, paidBy: 2, split: "shares" };
  it("column 9 on a 6-column file is a message, never a crash (share, amount, paid-by and for columns)", () => {
    const PAST = { ok: false, error: "One of the columns picked isn’t in this file. Pick the columns again." };
    expect(parseImport(text, { map: { ...base, shareCols: [3, 9] } })).toMatchObject(PAST);
    expect(parseImport(text, { map: { ...base, split: "everyone", amount: 9 } })).toMatchObject(PAST);
    expect(parseImport(text, { map: { ...base, split: "everyone", paidBy: 9 } })).toMatchObject(PAST);
    expect(parseImport(text, { map: { ...base, split: "column", forCol: 9 } })).toMatchObject(PAST);
    // columns that are only labels (date, description, type) past the end just read as empty
    const p = ok(text, { map: { ...base, shareCols: [3, 4], description: 9, date: 9, type: 9 } });
    expect(checked(p)).toEqual({ Asha: 10000, A: -5000, B: -5000 }); // 100.00 paid by Asha; the A and B columns hold 50.00 each
    expect(p.rows[0].description).toBe("Expense");
  });
  const head = "Date,Type,Description,Notes,Category,Paid by,Amount (INR),Original amount,Original currency,Exchange rate,Card markup (INR),Paid with,Status,Asha's share (INR),Ravi's share (INR)";
  const row = (i: number) => `2026-10-18,Expense,Item ${i},,Other,Asha,10.00,,,,,,,5.00,5.00`;
  it(`a Loopin file with more than ${MAX_IMPORT_ROWS} lines is refused; exactly ${MAX_IMPORT_ROWS} is read`, () => {
    const many = [head, ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => row(i))].join("\r\n");
    expect(parseImport(many)).toMatchObject({ ok: false, error: "That’s more than 5,000 lines. Export one group at a time." });
    const edge = [head, ...Array.from({ length: MAX_IMPORT_ROWS }, (_, i) => row(i))].join("\r\n");
    const p = ok(edge);
    expect(p.rows).toHaveLength(MAX_IMPORT_ROWS);
    // each line: Asha paid 1000 paise, 500 each → 5000 lines: Asha +2,500,000, Ravi −2,500,000
    expect(checked(p)).toEqual({ Asha: 2_500_000, Ravi: -2_500_000 });
  });
});

describe("LM-9: deleted lines carry no money in an export", () => {
  const members = [{ id: "me", name: "Varun" }, { id: "a", name: "Asha" }];
  const exp = (description: string, amount: number, deletedAt: Date | null) => ({
    description, category: "food", amount, paidById: "me", originalAmount: amount, originalCurrency: "INR", exchangeRate: "1", markupAmount: 0, paymentMethod: "",
    createdAt: new Date("2026-10-01T10:00:00Z"), spentAt: null, deletedAt, shares: [{ memberId: "me", amount: amount / 2 }, { memberId: "a", amount: amount / 2 }],
  });
  it("group spreadsheet: a live 120000 and a deleted 50000 → the Amount and share columns add up to 120000 only; the 50000 is in Notes", () => {
    const csv = groupCsv({ name: "Goa", currency: "INR" }, members, [exp("Dinner", 120000, null), exp("Mistake", 50000, new Date())], [
      { fromId: "a", toId: "me", amount: 70000, createdAt: new Date("2026-10-02T10:00:00Z"), deletedAt: new Date() },
    ]);
    const rows = readCsv(csv.slice(1)).filter((r) => r.length > 1).slice(1);
    const col = (i: number) => rows.reduce((t, r) => t + Math.round(Number(r[i] || 0) * 100), 0);
    expect(col(6)).toBe(120000); // Amount
    expect(col(13)).toBe(60000); // Varun's share
    expect(col(14)).toBe(60000); // Asha's share
    const gone = rows.find((r) => r[2] === "Mistake")!;
    expect(gone[3]).toBe("Deleted (it was 500.00)");
    expect(gone[12]).toBe("Deleted");
    expect(rows.find((r) => r[1] === "Payment")![3]).toBe("Deleted (it was 700.00)");
  });
  it("'all my data': Amount and 'Your balance change' also skip deleted lines", () => {
    const csv = myDataCsv(null, [{ name: "Goa", currency: "INR", type: "trip", closed: false, myId: "me", members, expenses: [exp("Dinner", 120000, null), exp("Mistake", 50000, new Date())], payments: [] }], new Date("2026-10-05T10:00:00Z"));
    const rows = readCsv(csv.slice(1)).filter((r) => r[0] === "Goa");
    const col = (i: number) => rows.reduce((t, r) => t + Math.round(Number(r[i] || 0) * 100), 0);
    expect(col(8)).toBe(120000); // Amount
    expect(col(10)).toBe(60000); // Your share
    expect(col(11)).toBe(60000); // Your balance change: paid 120000, own share 60000
    expect(rows.find((r) => r[4] === "Mistake")![5]).toBe("Deleted (it was 500.00)");
  });
  it("a deleted line is still skipped when the file is brought back in", () => {
    const csv = groupCsv({ name: "Goa", currency: "INR" }, members, [exp("Dinner", 120000, null), exp("Mistake", 50000, new Date())], []);
    const p = ok(csv);
    expect(p.rows.map((r) => r.description)).toEqual(["Dinner"]);
    expect(p.skipped).toEqual([{ line: 3, reason: "it was deleted" }]);
    expect(checked(p)).toEqual({ Varun: 60000, Asha: -60000 });
  });
});

describe("LM-10: the quick line finds the amount", () => {
  const M = [{ id: "me", name: "Varun" }, { id: "r", name: "Ravi" }];
  it("'Dinner for 4 2400' is 240000 paise (₹2,400), not ₹4", () => {
    const r = parseQuickLine("Dinner for 4 2400", M, "me");
    expect(r.amount).toBe("2400");
    expect(Math.round(Number(r.amount) * 100)).toBe(240000);
  });
  it("'2 beers 600 Ravi paid' is 60000 paise (₹600), paid by Ravi", () => {
    const r = parseQuickLine("2 beers 600 Ravi paid", M, "me");
    expect(r.amount).toBe("600");
    expect(Math.round(Number(r.amount) * 100)).toBe(60000);
    expect(r.paidById).toBe("r");
    expect(r.name).toBe("2 beers");
  });
  it("a sign wins over size, and one number still works as before", () => {
    expect(parseQuickLine("Cab for 3 ₹240", M, "me").amount).toBe("240");
    expect(parseQuickLine("Asha paid 1.2k for groceries", M, "me").amount).toBe("1200");
    expect(parseQuickLine("Dinner 2400", M, "me").amount).toBe("2400");
    expect(parseQuickLine("Dinner", M, "me").amount).toBe("");
  });
});

describe("CB-5: the balance message shows the real gap", () => {
  it("a gap of 120000 paise says ₹1,200, and no 'slightly' or 'rounding'", () => {
    const msg = balanceGapText([220000, -220000], [100000, -100000], ["Asha", "Ravi"], "INR")!;
    expect(msg).toContain("₹1,200");
    expect(msg).toContain("Asha");
    expect(msg).not.toMatch(/slightly|rounding/i);
  });
  it("a gap of 1 paise is called rounding; no gap gives no message", () => {
    expect(balanceGapText([100001, -100001], [100000, -100000], ["Asha", "Ravi"], "INR")).toMatch(/rounding/);
    expect(balanceGapText([100000, -100000], [100000, -100000], ["Asha", "Ravi"], "INR")).toBeNull();
  });
  it("end to end: Dinner 2000 paid by Asha for Asha and Ravi (nets ±100000), but the file's Total balance row says ±220000 → the gap is 120000 → '₹1,200'", () => {
    const p = parseSplitwiseCsv(["Date,Description,Category,Cost,Currency,Asha,Ravi", "2026-09-01,Dinner,General,2000.00,INR,1000.00,-1000.00", "2026-10-20,Total balance, , ,INR,2200.00,-2200.00"].join("\r\n"));
    if (!p.ok) throw new Error(p.error);
    const net = balancesOf(p.rows.map(planRow), 2);
    expect(net).toEqual([100000, -100000]);
    expect(balanceGapText(p.expected!, net, p.people, p.currency)).toContain("₹1,200");
  });
  it("the screen and the import log use the helper, not the old words", () => {
    for (const f of ["src/components/SplitwiseImport.tsx", "src/lib/splitwise-import.ts"]) expect(readFileSync(f, "utf8")).not.toMatch(/differ slightly/);
  });
});

describe("LM-7: guessing categories is fast and gives the same answers", () => {
  it("the quick bounded edit distance equals the full one whenever it is within the limit (and says limit+1 otherwise)", () => {
    let seed = 11;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    const word = () => Array.from({ length: rnd(9) }, () => "abc"[rnd(3)]).join("");
    for (let t = 0; t < 4000; t++) {
      const a = word(), b = word();
      for (const limit of [1, 2]) {
        const full = editDistance(a, b);
        expect(editDistanceWithin(a, b, limit)).toBe(full <= limit ? full : limit + 1);
      }
    }
  });
  it("typos are still found and offered (same answers as before)", () => {
    expect(analyzeName("Dinnr at the market")).toEqual({ category: "food", suggestion: { wrong: "Dinnr", right: "Dinner" } });
    expect(guessCategory("Zorblax thing")).toBe("other");
  });
  it("5,000 different unknown descriptions are guessed in well under the old ~23 seconds", () => {
    const w = ["zorblax", "quimby", "flarn", "wibble", "snorgle", "plink", "dobrik", "mentor", "gizmo", "lantern"];
    const t0 = Date.now();
    for (let i = 0; i < 5000; i++) guessCategory(`${w[i % 10]} ${w[(i * 7) % 10]} ${i}`);
    expect(Date.now() - t0).toBeLessThan(12_000);
  });
});
