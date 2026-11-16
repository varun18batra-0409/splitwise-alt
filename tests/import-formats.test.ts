import { describe, expect, it } from "vitest";
import { currencyCell, detectFormat, guessColumns, looseAmount, looseDate, nameKey, nameText, parseImport, splitNames } from "@/lib/import-formats";
import { balancesOf, planRow } from "@/lib/splitwise-csv";

// Bringing a group over from any app's spreadsheet.

const nets = (text: string, opts = {}) => {
  const p = parseImport(text, opts);
  if (!p.ok) throw new Error(p.error);
  return { p, net: Object.fromEntries(p.people.map((n, i) => [n, balancesOf(p.rows.map(planRow), p.people.length)[i]])) };
};

describe("reading what people type", () => {
  it("amounts in any common spelling", () => {
    expect(looseAmount("1,234.50", "INR")).toBe(123450);
    expect(looseAmount("₹ 500", "INR")).toBe(50000);
    expect(looseAmount("$12", "USD")).toBe(1200);
    expect(looseAmount("-40", "EUR")).toBe(-4000);
    expect(looseAmount("(40)", "EUR")).toBe(-4000);
    expect(looseAmount("1.234,50", "EUR")).toBe(123450);
    expect(looseAmount("12,5", "EUR")).toBe(1250);
    expect(looseAmount("abc", "INR")).toBeNull();
  });
  it("dates as people write them (day first when unclear)", () => {
    expect(looseDate("2026-10-18")).toBe("2026-10-18");
    expect(looseDate("18/10/2026")).toBe("2026-10-18");
    expect(looseDate("03/04/2026")).toBe("2026-04-03");
    expect(looseDate("10/18/2026")).toBe("2026-10-18");
    expect(looseDate("18-10-26")).toBe("2026-10-18");
    expect(looseDate("18 Oct 2026")).toBe("2026-10-18");
    expect(looseDate("Oct 18, 2026")).toBe("2026-10-18");
    expect(looseDate("31/02/2026")).toBe("");
  });
  it("names in one cell", () => {
    expect(splitNames("Asha, Ravi & Zoe")).toEqual(["Asha", "Ravi", "Zoe"]);
    expect(splitNames("Asha and Ravi; Zoe")).toEqual(["Asha", "Ravi", "Zoe"]);
  });
});

describe("telling files apart", () => {
  it("knows Splitwise, Loopin, and everything else", () => {
    expect(detectFormat("Date,Description,Category,Cost,Currency,A,B\n2026-01-01,Tea,General,2,INR,1,-1")).toMatchObject({ ok: true, format: "splitwise" });
    expect(detectFormat("Date,Type,Description,Notes,Category,Paid by,Amount (INR),Status,A's share (INR)\n2026-01-01,Expense,Tea,,Other,A,2.00,,2.00")).toMatchObject({ ok: true, format: "loopin" });
    expect(detectFormat("Title,Amount,Paid by\nTea,20,A")).toMatchObject({ ok: true, format: "generic" });
  });
  it("explains the all-my-data download", () => {
    const d = detectFormat("Loopin: all your data\nExported,2026-10-20\n\nGroup,Group type\n");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.error).toMatch(/Download spreadsheet/);
  });
  it("guesses columns from their names", () => {
    expect(guessColumns(["Title", "Amount", "Currency", "Date", "Paid by", "Paid for"])).toMatchObject({ description: 0, amount: 1, date: 3, paidBy: 4, split: "column", forCol: 5 });
    expect(guessColumns(["Date", "What", "Cost", "Who paid", "Asha's share", "Ravi's share"])).toMatchObject({ description: 1, amount: 2, paidBy: 3, split: "shares", shareCols: [4, 5] });
    expect(guessColumns(["Name", "Amount"])).toMatchObject({ paidBy: -1 });
  });
});

describe("a Loopin group spreadsheet", () => {
  const head = "Date,Type,Description,Notes,Category,Paid by,Amount (INR),Original amount,Original currency,Exchange rate,Card markup (INR),Paid with,Status,Varun's share (INR),Nupur's share (INR),Mansi's share (INR)";
  const file = [
    head,
    "2026-10-18,Expense,Flight,,Transport,Nupur,40500.00,,,,,,,,,40500.00",
    "2026-10-18,Expense,Return,,Transport,Nupur,25000.00,,,,,,,12500.00,12500.00,",
    "2026-10-19,Expense,Hotel,,Accommodation,Varun 6000.00 + Mansi 3000.00,9000.00,,,,,,,3000.00,3000.00,3000.00",
    "2026-10-19,Money back,Refund,,Other,Varun,-300.00,,,,,,,-100.00,-100.00,-100.00",
    "2026-10-20,Payment,Mansi paid Nupur,,,Mansi,1000.00,,,,,,,,,",
    "2026-10-20,Expense,Old,,Other,Varun,50.00,,,,,,Deleted,50.00,,",
  ].join("\r\n");
  it("brings back every expense, payer, share, refund and payment", () => {
    const { p, net } = nets(file);
    expect(p.people).toEqual(["Varun", "Nupur", "Mansi"]);
    expect(p.rows).toHaveLength(5); // the deleted one is left out
    // Nupur: +40500 +25000 −12500 −3000 +100 −1000; Varun: −12500 +6000 −3000 −300+100; Mansi: −40500 +3000 −3000 +100 +1000
    expect(net).toEqual({ Varun: -970000, Nupur: 4910000, Mansi: -3940000 });
    expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
    expect(p.rows[4]).toMatchObject({ payment: true });
  });

  // Fable F27: Loopin's own export, brought in again, keeps money back as
  // money back and a card game's result as a card game.
  it("keeps money back and card games as they were", () => {
    const f = [
      head,
      "2026-10-19,Money back,Refund,,Other,Varun,-300.00,,,,,,,-100.00,-100.00,-100.00",
      "2026-10-21,Card game,Diwali night,,Other,Nupur,500.00,,,,,,,300.00,,200.00",
    ].join("\r\n");
    const { p, net } = nets(f);
    expect(p.rows.map((r) => r.kind)).toEqual(["refund", "pot"]);
    const plans = p.rows.map(planRow);
    // Money back, by hand: Varun got ₹300 back, shared by all three → the
    // same lines as in Loopin: Varun "paid" 300, each share 100, marked refund.
    expect(plans[0]).toMatchObject({ type: "expense", kind: "refund", amount: 30000, payers: [{ i: 0, a: 30000 }] });
    expect(plans[0].type === "expense" && plans[0].shares).toEqual([{ i: 0, a: 10000 }, { i: 1, a: 10000 }, { i: 2, a: 10000 }]);
    expect(plans[1]).toMatchObject({ type: "expense", kind: "pot", amount: 50000, payers: [{ i: 1, a: 50000 }] });
    // Balances, by hand. Money back: Varun owes Nupur and Mansi ₹100 each
    // (Varun −200, Nupur +100, Mansi +100). Card game: Nupur won ₹500 from
    // Varun 300 and Mansi 200. Total: Varun −500, Nupur +600, Mansi −100.
    expect(net).toEqual({ Varun: -50000, Nupur: 60000, Mansi: -10000 });
  });
});

describe("another app's spreadsheet", () => {
  it("equal splits between the people named in a column", () => {
    const { p, net } = nets('Title,Amount,Currency,Date,Paid by,Paid for\nDinner,90,EUR,18/10/2026,Lea,"Lea, Max, Tom"\nTaxi,30,EUR,19/10/2026,Max,"Max, Tom"\n');
    expect(p.currency).toBe("EUR");
    expect(p.rows.map((r) => r.date)).toEqual(["2026-10-18", "2026-10-19"]);
    expect(net).toEqual({ Lea: 6000, Max: -1500, Tom: -4500 });
  });
  it("each person's own share column", () => {
    const { net } = nets("Date,What,Cost,Who paid,Asha's share,Ravi's share\n2026-10-01,Rent,30000,Asha,18000,12000\n");
    expect(net).toEqual({ Asha: 1200000, Ravi: -1200000 });
  });
  it("equally between everyone, when nothing says otherwise", () => {
    const { net } = nets("Item,Price,Payer\nPizza,600,Kim\nCola,90,Lee\nCake,300,Jo\n");
    expect(net).toEqual({ Kim: 27000, Lee: -24000, Jo: -3000 });
  });
  it("a line marked as a payment is a payment", () => {
    const { p } = nets("Description,Amount,Paid by,For,Type\nSettling up,500,Kim,Lee,Payment\nLunch,400,Lee,\"Kim, Lee\",Expense\n");
    expect(p.rows[0].payment).toBe(true);
    expect(planRow(p.rows[0])).toMatchObject({ type: "payment", amount: 50000 });
  });
  it("asks rather than guessing wrong", () => {
    const p = parseImport("Name,Amount\nTea,20\n");
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.error).toMatch(/who paid/);
  });
  it("lines it can't read are listed, not silently dropped", () => {
    const { p } = nets("Item,Price,Payer\nPizza,600,Kim\nOops,abc,Lee\nCola,90,\n");
    expect(p.rows).toHaveLength(1);
    expect(p.skipped.map((s) => s.reason)).toEqual(["the amount couldn’t be read", "nobody is named as paying"]);
  });

  it("reads Type \"Game result\" (what Loopin exports now) as a game result, same as the old \"Card game\"", () => {
    const head = "Date,Type,Description,Notes,Category,Paid by,Amount (INR),Original amount,Original currency,Exchange rate,Card markup (INR),Paid with,Status,Varun's share (INR),Nupur's share (INR),Mansi's share (INR)";
    const row = (type: string) => [head, `2026-10-21,${type},Diwali night,,Other,Nupur,500.00,,,,,,,300.00,,200.00`].join("\r\n");
    expect(nets(row("Game result")).p.rows.map((r) => r.kind)).toEqual(["pot"]);
    expect(nets(row("Card game")).p.rows.map((r) => r.kind)).toEqual(["pot"]);
    // Same numbers either way, by hand: Nupur +500, Varun −300, Mansi −200.
    expect(nets(row("Game result")).net).toEqual(nets(row("Card game")).net);
  });
});

describe("another app's file with several currencies (LC-05)", () => {
  const file = "Title,Amount,Currency,Paid by,For\nDinner,100,INR,A,\"A, B\"\nTaxi,10,USD,C,\"A, C\"\n";
  it("leaves the other-currency row out and lists it", () => {
    const p = parseImport(file);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.currency).toBe("INR");
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].cost).toBe(10000); // 100 rupees, in paise
    expect(p.skipped).toEqual([{ line: 3, reason: "in USD" }]);
    expect(p.otherCurrencies).toEqual(["USD"]);
    // C only appears in the left-out row, so C isn't added as a person.
    expect(p.people).toEqual(["A", "B"]);
  });
});

describe("money back in another app's file (LC-06)", () => {
  it("a negative row that isn't a payment is a refund with the right effect", () => {
    const { p, net } = nets("Title,Amount,Paid by,For\nRefund,-100,A,B\n");
    expect(p.rows[0].kind).toBe("refund");
    expect(p.rows[0].payment).toBe(false);
    // A got ₹100 back that B shared in: A −10000 paise, B +10000 paise; they sum to 0.
    expect(net).toEqual({ A: -10000, B: 10000 });
    expect(Object.values(net).reduce((a, b) => a + b, 0)).toBe(0);
    // Spending goes DOWN by 10000 (a refund subtracts): the plan is marked refund with amount 10000.
    const plan = planRow(p.rows[0]);
    expect(plan).toMatchObject({ type: "expense", kind: "refund", amount: 10000 });
  });
  it("a positive row is an ordinary expense (no kind)", () => {
    const { p } = nets("Title,Amount,Paid by,For\nDinner,100,A,B\n");
    expect(p.rows[0].kind).toBeUndefined();
  });
});

describe("currency written as a symbol (LC-05)", () => {
  it("Rs, ₹, Rs. and INR rows in one file are all rupees: 4 rows, nothing skipped", () => {
    const file = "Title,Amount,Currency,Paid by,For\nA,100,Rs,Kim,Lee\nB,200,₹,Kim,Lee\nC,300,Rs.,Kim,Lee\nD,400,INR,Kim,Lee\n";
    const p = parseImport(file);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.currency).toBe("INR");
    expect(p.rows.map((r) => r.cost)).toEqual([10000, 20000, 30000, 40000]);
    expect(p.skipped).toEqual([]);
    expect(p.otherCurrencies).toEqual([]);
  });
  it("a file whose currency column is all $ is read as dollars, not skipped", () => {
    const p = parseImport("Title,Amount,Currency,Paid by,For\nA,10,$,Kim,Lee\nB,20,$,Kim,Lee\n");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.currency).toBe("USD");
    expect(p.rows.map((r) => r.cost)).toEqual([1000, 2000]);
  });
  it("a £ row in an INR file is left out as GBP; a word we can't read ('rupees') is left out and listed as written, never imported by guessing", () => {
    const p = parseImport("Title,Amount,Currency,Paid by,For\nA,10,INR,Kim,Lee\nB,20,INR,Kim,Lee\nC,30,£,Kim,Lee\nD,40,rupees,Kim,Lee\nE,50,,Kim,Lee\n");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    // Rows A and B (10, 20 rupees) and E (an empty cell: the file's own currency, 50 rupees) are imported.
    expect(p.rows.map((r) => r.cost)).toEqual([1000, 2000, 5000]);
    expect(p.skipped).toEqual([{ line: 4, reason: "in GBP" }, { line: 5, reason: "in “rupees”" }]);
    expect(p.otherCurrencies).toEqual(["GBP", "rupees"]);
  });
  it("an INR file with ₹ and ฿ rows imports the ₹ rows and lists the ฿ row as THB", () => {
    const p = parseImport("Title,Amount,Currency,Paid by,For\nA,100,₹,Kim,Lee\nB,200,₹,Kim,Lee\nC,300,฿,Kim,Lee\n");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.currency).toBe("INR");
    expect(p.rows.map((r) => r.cost)).toEqual([10000, 20000]); // 100 and 200 rupees in paise
    expect(p.skipped).toEqual([{ line: 4, reason: "in THB" }]);
    expect(p.otherCurrencies).toEqual(["THB"]);
  });
  it("other common symbols are read: A$ S$ RM Rp ¥ HK$ C$", () => {
    expect(["A$", "S$", "RM", "Rp", "¥", "HK$", "C$"].map((x) => currencyCell(x).code)).toEqual(["AUD", "SGD", "MYR", "IDR", "JPY", "HKD", "CAD"]);
    expect(currencyCell("baht")).toEqual({ code: "", text: "baht" });
    expect(currencyCell("  ")).toEqual({ code: "", text: "" });
  });
  it("'$' means the file's own dollar currency: an AUD file imports its $ rows as Australian dollars", () => {
    const p = parseImport("Title,Amount,Currency,Paid by,For\nA,10,AUD,Kim,Lee\nB,20,AUD,Kim,Lee\nC,30,$,Kim,Lee\n");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.currency).toBe("AUD");
    expect(p.rows.map((r) => r.cost)).toEqual([1000, 2000, 3000]);
    expect(p.skipped).toEqual([]);
    // Picked in the box: an all-$ file read as AUD.
    const q = parseImport("Title,Amount,Currency,Paid by,For\nA,10,$,Kim,Lee\nB,20,$,Kim,Lee\n", { currency: "AUD" });
    expect(q.ok && q.currency).toBe("AUD");
    expect(q.ok && q.rows.map((r) => r.cost)).toEqual([1000, 2000]);
  });
  it("one stray SGD row doesn't turn many '$' rows into Singapore dollars: the file is USD and the SGD row is left out", () => {
    const p = parseImport("Title,Amount,Currency,Paid by,For\nA,10,$,Kim,Lee\nB,20,$,Kim,Lee\nC,30,$,Kim,Lee\nD,40,SGD,Kim,Lee\n");
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.currency).toBe("USD");
    expect(p.rows.map((r) => r.cost)).toEqual([1000, 2000, 3000]); // $10, $20, $30 in cents
    expect(p.skipped).toEqual([{ line: 5, reason: "in SGD" }]);
  });
  it("'¥' follows a yuan file when CNY is picked (and is yen otherwise)", () => {
    const q = parseImport("Title,Amount,Currency,Paid by,For\nA,12.50,¥,Kim,Lee\n", { currency: "CNY" });
    expect(q.ok && q.currency).toBe("CNY");
    expect(q.ok && q.rows.map((r) => r.cost)).toEqual([1250]); // 12.50 yuan in fen
    expect(currencyCell("¥").code).toBe("JPY");
    expect(currencyCell("¥", "CNY").code).toBe("CNY");
  });
  it("'$' in an INR file is US dollars, so those rows are left out as USD", () => {
    const p = parseImport("Title,Amount,Currency,Paid by,For\nA,10,INR,Kim,Lee\nB,20,INR,Kim,Lee\nC,30,$,Kim,Lee\n");
    expect(p.ok && p.skipped).toEqual([{ line: 4, reason: "in USD" }]);
  });
});


// ---- 16 Nov line review: LM-1 (names matched one way) and LM-2 ("Rs." read as money) ----

describe("LM-2: amounts written with Rs., INR, /- and typographic minus signs", () => {
  // paise: the dot of "Rs." is never a decimal point, so "Rs.500" is 500 rupees, not 50 paise.
  const table: [string, string, number | null][] = [
    ["Rs.500", "INR", 50000],
    ["Rs. 1,200", "INR", 120000],
    ["Rs. 500/-", "INR", 50000],
    ["500 Rs.", "INR", 50000],
    ["INR 1,234.50", "INR", 123450],
    ["−40", "EUR", -4000], // U+2212, the typographic minus
    ["–40", "EUR", -4000], // an en-dash at the start
    ["(40)", "EUR", -4000], // unchanged
    ["1.234,50", "EUR", 123450], // unchanged
    ["₹ 500", "INR", 50000], // unchanged
    ["abc", "INR", null], // unchanged: no digits at all
    ["", "INR", 0], // unchanged: an empty cell
  ];
  for (const [input, cur, want] of table) {
    it(`${JSON.stringify(input)} in ${cur} is ${want}`, () => {
      expect(looseAmount(input, cur)).toBe(want);
    });
  }
});

describe("LM-1: one way to match names, so a share is never silently dropped", () => {
  // Hand-worked: Asha paid 100.00 (10000 paise). Shares: Asha 50 and "Ravi  Kumar" (two spaces in the header) 50.
  // Before: the header's two spaces were kept as typed, the person was stored with one space, and the lookup missed (index -1), so Ravi's 5000 vanished:
  // nets [5000, 0] and the group was out by 5000. Now: nets [5000, -5000], an expense of 10000 with shares 5000 / 5000.
  it("a double space in a share column's name still finds the person", () => {
    const { p, net } = nets("Title,Amount,Paid by,Asha's share,Ravi  Kumar's share\nDinner,100,Asha,50,50\n");
    expect(p.people).toEqual(["Asha", "Ravi Kumar"]);
    expect(p.rows[0].nets).toEqual([5000, -5000]);
    expect(net).toEqual({ Asha: 5000, "Ravi Kumar": -5000 });
    const plan = planRow(p.rows[0]);
    expect(plan.type === "expense" && [plan.amount, plan.payers.reduce((t, x) => t + x.a, 0), plan.shares.reduce((t, x) => t + x.a, 0), plan.shares.map((x) => x.a)]).toEqual([10000, 10000, 10000, [5000, 5000]]);
  });

  // Asha paid 300.00 for "Ravi  Kumar": nets [30000, -30000]; Ravi's share is the whole 30000 (before, the unmatched name fell back to "everyone").
  it("a double space in the 'paid for' column finds the person, and it is not turned into 'everyone'", () => {
    const { p, net } = nets("Title,Amount,Paid by,Paid for\nCab,300,Asha,Ravi  Kumar\n");
    expect(p.people).toEqual(["Asha", "Ravi Kumar"]);
    expect(p.rows[0].nets).toEqual([30000, -30000]);
    expect(net).toEqual({ Asha: 30000, "Ravi Kumar": -30000 });
  });

  it("a non-breaking space is a space, in every column", () => {
    // Cab: Asha pays 300 for Ravi Kumar (+30000 / -30000). Taxi: Ravi Kumar (typed with a non-breaking space) pays 60 for Asha (+6000 / -6000).
    const { p, net } = nets("Title,Amount,Paid by,Paid for\nCab,300,Asha,Ravi Kumar\nTaxi,60,Ravi\u00a0Kumar,Asha\n");
    expect(p.people).toEqual(["Asha", "Ravi Kumar"]);
    expect(net).toEqual({ Asha: 24000, "Ravi Kumar": -24000 });
  });

  it("case and edge spaces don't matter either", () => {
    const { p } = nets("Title,Amount,Paid by,Paid for\nCab,300,asha,  RAVI   kumar \nTaxi,60,Ravi Kumar,ASHA\n");
    expect(p.people).toHaveLength(2);
    expect(p.skipped).toEqual([]);
  });

  it("a 41-letter name is cut to 40 in the stored name and matches itself everywhere", () => {
    const long = "N".repeat(41);
    expect(nameText(long)).toBe("N".repeat(40));
    expect(nameKey(long)).toBe("n".repeat(40));
    const { p, net } = nets(`Title,Amount,Paid by,Paid for\nCab,300,Asha,${long}\nTaxi,60,${long},Asha\n`);
    expect(p.people).toEqual(["Asha", "N".repeat(40)]);
    expect(p.skipped).toEqual([]);
    expect(net).toEqual({ Asha: 24000, ["N".repeat(40)]: -24000 });
  });

  it("two different long names with the same first 40 letters can't be told apart: the file is refused, not mixed up", () => {
    const a = `${"X".repeat(40)}a`;
    const b = `${"X".repeat(40)}b`;
    const r = parseImport(`Title,Amount,Paid by,Paid for\nCab,300,Asha,${a}\nTaxi,60,${b},Asha\n`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/same for the first 40 letters/);
  });

  it("in a Loopin spreadsheet too: a double-spaced name in the header, the paid-by cell and a payment all match", () => {
    const head = "Date,Type,Description,Notes,Category,Paid by,Amount (INR),Original amount,Original currency,Exchange rate,Card markup (INR),Paid with,Status,Asha's share (INR),Ravi  Kumar's share (INR)";
    const file = [head, "2026-10-18,Expense,Dinner,,Food,Ravi  Kumar,100.00,,,,,,,50.00,50.00", "2026-10-19,Payment,Asha paid Ravi  Kumar,,,Asha,20.00,,,,,,,,"].join("\r\n");
    const { p, net } = nets(file);
    expect(p.skipped).toEqual([]);
    // Dinner: Ravi +5000 (paid 10000, own share 5000), Asha -5000. Payment: Asha paid Ravi 2000: Asha +2000, Ravi -2000.
    expect(net).toEqual({ Asha: -3000, "Ravi Kumar": 3000 });
  });

  it("two people whose header names match once cleaned up (a Loopin file) are refused", () => {
    const head = "Date,Type,Description,Notes,Category,Paid by,Amount (INR),Original amount,Original currency,Exchange rate,Card markup (INR),Paid with,Status,Asha's share (INR),ASHA 's share (INR)";
    const r = parseImport([head, "2026-10-18,Expense,Dinner,,Food,Asha,100.00,,,,,,,50.00,50.00"].join("\r\n"));
    expect(r.ok).toBe(false);
  });

  it("a name that isn't one of the people is a skipped line, never a quiet drop (Loopin file)", () => {
    const head = "Date,Type,Description,Notes,Category,Paid by,Amount (INR),Original amount,Original currency,Exchange rate,Card markup (INR),Paid with,Status,Asha's share (INR),Ravi's share (INR)";
    const { p } = nets([head, "2026-10-18,Expense,Dinner,,Food,Asha,100.00,,,,,,,50.00,50.00", "2026-10-19,Expense,Lunch,,Food,Zed,100.00,,,,,,,50.00,50.00"].join("\r\n"));
    expect(p.rows).toHaveLength(1);
    expect(p.skipped.map((x) => x.reason)).toEqual(["“Zed” isn’t one of the people"]);
  });

  it("an empty 'paid for' cell still means everyone", () => {
    const { net } = nets("Title,Amount,Paid by,Paid for\nSnacks,90,Asha,\nTaxi,30,Ravi,Asha\n");
    // Snacks: everyone in the file (Asha, Ravi) 4500 each: Asha +4500, Ravi -4500. Taxi: Ravi +3000, Asha -3000.
    expect(net).toEqual({ Asha: 1500, Ravi: -1500 });
  });
});
