import { describe, expect, it } from "vitest";
import { detectFormat, guessColumns, looseAmount, looseDate, parseImport, splitNames } from "@/lib/import-formats";
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
});
