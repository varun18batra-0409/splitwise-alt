import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { balancesOf, dateRangeText, mapCategory, parseSplitwiseCsv, planRow, previewText, readCsv, swAmount } from "@/lib/splitwise-csv";
import { importSplitwise } from "@/lib/splitwise-import";
import { netBalances } from "@/lib/balances";

// Bringing a group over from Splitwise's "Export as spreadsheet" file.

const CSV = [
  "Date,Description,Category,Cost,Currency,Varun Batra,Asha,Ravi",
  "2026-09-01,Dinner,Dining out,900.00,INR,600.00,-300.00,-300.00",
  "2026-09-02,Taxi,Taxi,300.00,INR,-150.00,0.00,150.00",
  '2026-09-03,"Hotel, 2 nights",Hotel,3000.00,INR,1000.00,1000.00,-2000.00',
  "2026-09-04,Asha paid Varun Batra,Payment,100.00,INR,-100.00,100.00,0.00",
  "2026-09-05,Gelato,Dining out,10.00,EUR,5.00,-5.00,0.00",
  "2026-09-06,Nothing,General,0.00,INR,0.00,0.00,0.00",
  "",
  "2026-10-20,Total balance, , ,INR,1350.00,800.00,-2150.00",
  "2026-10-20,Total balance, , ,EUR,5.00,-5.00,0.00",
  "",
].join("\r\n");

describe("reading the file", () => {
  it("reads quotes, commas and line breaks inside quotes", () => {
    expect(readCsv('a,"b, c","d ""e"""\r\n1,"two\nlines",3')).toEqual([
      ["a", "b, c", 'd "e"'],
      ["1", "two\nlines", "3"],
    ]);
  });

  it("reads amounts in each currency's smallest unit", () => {
    expect(swAmount("-12.50", "INR")).toBe(-1250);
    expect(swAmount("1,234.5", "USD")).toBe(123450);
    expect(swAmount("1000.00", "JPY")).toBe(1000);
    expect(swAmount("", "INR")).toBe(0);
    expect(swAmount("abc", "INR")).toBeNull();
    expect(Object.is(swAmount("-0.00", "INR"), 0)).toBe(true);
  });

  it("finds the people, the currency, the lines and Splitwise's own totals", () => {
    const p = parseSplitwiseCsv(CSV);
    if (!p.ok) throw new Error(p.error);
    expect(p.people).toEqual(["Varun Batra", "Asha", "Ravi"]);
    expect(p.currency).toBe("INR");
    expect(p.rows.map((r) => r.description)).toEqual(["Dinner", "Taxi", "Hotel, 2 nights", "Asha paid Varun Batra"]);
    expect(p.otherCurrencies).toEqual(["EUR"]);
    expect(p.skipped.map((s) => s.reason)).toEqual(["in EUR", "it didn’t change anyone’s balance"]);
    expect(p.expected).toEqual([135000, 80000, -215000]);
  });

  it("explains files that aren't a Splitwise export", () => {
    const p = parseSplitwiseCsv("Name,Amount\nTea,20");
    expect(p.ok).toBe(false);
    if (!p.ok) {
      // Generic on purpose (no app name): it still says what file to bring.
      expect(p.error).toMatch(/export it as a spreadsheet \(CSV\)/);
      expect(p.error).toMatch(/pick that file/);
      expect(p.error).not.toMatch(/splitwise/i);
    }
    expect(parseSplitwiseCsv("").ok).toBe(false);
    const dup = parseSplitwiseCsv("Date,Description,Category,Cost,Currency,Asha,asha\n2026-01-01,Tea,General,2,INR,1,-1");
    expect(dup.ok).toBe(false);
  });
});

describe("turning lines into expenses and payments", () => {
  const p = parseSplitwiseCsv(CSV);
  if (!p.ok) throw new Error(p.error);
  const [dinner, taxi, hotel, pay] = p.rows.map(planRow);

  it("one payer comes out exactly as it was", () => {
    expect(dinner).toMatchObject({ type: "expense", amount: 90000, payers: [{ i: 0, a: 90000 }] });
    expect(dinner.type === "expense" && dinner.shares).toEqual([{ i: 0, a: 30000 }, { i: 1, a: 30000 }, { i: 2, a: 30000 }]);
    expect(taxi).toMatchObject({ type: "expense", amount: 30000, payers: [{ i: 2, a: 30000 }] });
    expect(taxi.type === "expense" && taxi.shares).toEqual([{ i: 0, a: 15000 }, { i: 2, a: 15000 }]);
  });

  it("several payers keep the real cost", () => {
    expect(hotel).toMatchObject({ type: "expense", amount: 300000 });
    if (hotel.type !== "expense") throw new Error();
    expect(hotel.payers).toEqual([{ i: 0, a: 150000 }, { i: 1, a: 150000 }]);
    expect(hotel.payers.reduce((s, x) => s + x.a, 0)).toBe(hotel.shares.reduce((s, x) => s + x.a, 0));
  });

  it("payments are payments, from the person who paid", () => {
    expect(pay).toMatchObject({ type: "payment", from: 1, to: 0, amount: 10000 });
  });

  it("balances match Splitwise's total", () => {
    expect(balancesOf(p.rows.map(planRow), 3)).toEqual(p.expected);
  });

  it("maps Splitwise's categories", () => {
    expect(mapCategory("Dining out", "Dinner")).toBe("food");
    expect(mapCategory("Taxi", "x")).toBe("transport");
    expect(mapCategory("Groceries", "x")).toBe("groceries");
    // Loopin's own spreadsheets: today's fun names and the earlier plain ones.
    expect(mapCategory("Bites & Sips", "x")).toBe("food");
    expect(mapCategory("Wheels & Wings", "x")).toBe("transport");
    expect(mapCategory("Beds & Bunks", "x")).toBe("accommodation");
    expect(mapCategory("Thrills & Tickets", "x")).toBe("activities");
    expect(mapCategory("Bills & Bits", "x")).toBe("bills");
    expect(mapCategory("Food & Drinks", "x")).toBe("food");
    expect(mapCategory("Accommodation", "x")).toBe("accommodation");
    expect(mapCategory("Odds & Ends", "Uber to airport")).toBe("transport"); // "other": guessed from the name
    expect(mapCategory("General", "Pizza dinner")).toBe("food");
  });
});

describe("importing into a new group", () => {
  const stamp = Date.now();
  let account = { id: "", name: "" as string | null };
  beforeAll(async () => {
    account = await db.account.create({ data: { email: `sw-${stamp}@example.com`, name: "" } });
  });

  it("brings everything over, with the importer as their own name", async () => {
    const r = await importSplitwise(account, { text: CSV, groupName: "Goa trip", type: "trip", me: 0 });
    if (!r.ok) throw new Error(r.error);
    expect(r).toMatchObject({ expenses: 3, payments: 1, matches: true });
    const g = await db.group.findUniqueOrThrow({
      where: { id: r.groupId },
      include: { members: { orderBy: { name: "asc" } }, expenses: { include: { shares: true } }, payments: true, events: true },
    });
    expect(g).toMatchObject({ name: "Goa trip", type: "trip", currency: "INR" });
    expect(g.members.map((m) => [m.name, !!m.accountId, !!m.claimedAt])).toEqual([
      ["Asha", false, false],
      ["Ravi", false, false],
      ["Varun Batra", true, true],
    ]);
    const id = (n: string) => g.members.find((m) => m.name === n)!.id;
    const net = netBalances(g.members.map((m) => m.id), g.expenses, g.payments);
    expect([net[id("Varun Batra")], net[id("Asha")], net[id("Ravi")]]).toEqual([135000, 80000, -215000]);
    const hotel = g.expenses.find((e) => e.description === "Hotel, 2 nights")!;
    expect(hotel.amount).toBe(300000);
    expect(hotel.category).toBe("accommodation");
    expect(hotel.spentAt?.toISOString()).toBe("2026-09-03T12:00:00.000Z");
    expect(JSON.parse(hotel.payers)).toHaveLength(2);
    for (const e of g.expenses) expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(e.amount);
    expect(g.events.map((e) => e.kind)).toEqual(["group_imported"]);
    // The importer's empty name is filled in from the file.
    expect((await db.account.findUniqueOrThrow({ where: { id: account.id } })).name).toBe("Varun Batra");
  });

  it("refuses without a name, a person or real lines", async () => {
    expect(await importSplitwise(account, { text: CSV, groupName: " ", type: "trip", me: 0 })).toMatchObject({ ok: false });
    expect(await importSplitwise(account, { text: CSV, groupName: "X", type: "trip", me: 7 })).toMatchObject({ ok: false });
    expect(await importSplitwise(account, { text: "nope", groupName: "X", type: "trip", me: 0 })).toMatchObject({ ok: false });
  });
});

// The preview shown before importing: people, dates, counts and where each person ends up.
describe("import preview", () => {
  // By hand (people A, B, C):
  //   Dinner 900, A paid, split 3 ways: each share 300 → A +600, B −300, C −300
  //   Taxi 300, B paid, split 3 ways: each share 100 → A −100, B +200, C −100
  //   C pays A 200: C +200, A −200
  //   A: 600 − 100 − 200 = +300 (paid 900, own share 400 = +500, less the 200 received)
  //   B: −300 + 200 = −100   C: −300 − 100 + 200 = −200   sum 300 − 100 − 200 = 0
  const FILE = [
    "Date,Description,Category,Cost,Currency,A,B,C",
    "2026-10-01,Dinner,Dining out,900.00,INR,600.00,-300.00,-300.00",
    "2026-10-03,Taxi,Taxi,300.00,INR,-100.00,200.00,-100.00",
    "2026-10-05,C paid A,Payment,200.00,INR,-200.00,0.00,200.00",
  ].join("\n");

  it("shows the people, the date range, the counts and each person's balance", () => {
    const parsed = parseSplitwiseCsv(FILE);
    if (!parsed.ok) throw new Error(parsed.error);
    const p = previewText(parsed);
    expect(p.people).toEqual(["A", "B", "C"]);
    expect(p.range).toBe("1 Oct – 5 Oct 2026");
    expect([p.expenses, p.payments]).toEqual([2, 1]);
    expect(p.balances.map((b) => b.net)).toEqual([30000, -10000, -20000]);
    expect(p.balances.map((b) => b.net).reduce((s, x) => s + x, 0)).toBe(0);
    expect(p.balances.map((b) => [b.name, b.tone, b.text])).toEqual([
      ["A", "owed", "gets back ₹300"],
      ["B", "owe", "owes ₹100"],
      ["C", "owe", "owes ₹200"],
    ]);
  });

  it("someone who ends square says so (no ₹0), and the range handles one day and two years", () => {
    const parsed = parseSplitwiseCsv(["Date,Description,Category,Cost,Currency,A,B,C", "2026-12-30,Tea,Dining out,100.00,INR,50.00,-50.00,0.00", "2027-01-02,Cab,Taxi,60.00,INR,-30.00,30.00,0.00"].join("\n"));
    if (!parsed.ok) throw new Error(parsed.error);
    const p = previewText(parsed);
    expect(p.range).toBe("30 Dec 2026 – 2 Jan 2027");
    expect(p.balances.map((b) => b.text)).toEqual(["gets back ₹20", "owes ₹20", "all square"]);
    expect(p.balances[2].amount).toBe("");
    expect(dateRangeText(["2026-10-14", "2026-10-14"])).toBe("14 Oct 2026");
    expect(dateRangeText(["", "nonsense"])).toBe("");
  });

  it("amounts use the group's currency", () => {
    const parsed = parseSplitwiseCsv(["Date,Description,Category,Cost,Currency,A,B", "2026-10-01,Dinner,Dining out,30.00,USD,15.00,-15.00"].join("\n"));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(previewText(parsed).balances.map((b) => b.text)).toEqual(["gets back $15", "owes $15"]);
  });
});
