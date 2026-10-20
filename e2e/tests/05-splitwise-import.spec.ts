import { test, expect } from "../fixtures";
import { existsSync, readFileSync } from "node:fs";
import { testEmail } from "../env";
import { signUp } from "../helpers/auth";
import { contextFor, readBalances, settled, toPaise } from "../helpers/app";

// 5. Import the supplied Splitwise export and check what came across.
//
// The file has real names and amounts, so it is NOT kept in this (public)
// repository. The workflow writes it from the GitHub secret
// E2E_SPLITWISE_CSV_B64 and points E2E_SPLITWISE_CSV at it.
//
// Expected, checked by hand against the supplied file (export.csv, 20 Oct 2026):
// 4 expenses (Test ₹5,000, Test 2 ₹300, Test 5 ₹3,000, Test 6 ₹2,510) totalling
// ₹10,810, not counting the "Total balance" row. That row says Nupur MDI
// +105.00 and Varun Batra −105.00, and the four rows add up to the same.
// In Splitwise a plus means "gets money back", so Nupur gets ₹105 and Varun
// owes ₹105. (The brief had the signs the other way round; the file wins.)
const EXPECTED = { expenses: 4, total: 1_081_000, balances: { "Nupur MDI": 10_500, "Varun Batra": -10_500 } };

const file = process.env.E2E_SPLITWISE_CSV ?? "";

test("import the supplied Splitwise CSV: 4 expenses, ₹10,810, Nupur MDI gets ₹105 / Varun Batra owes ₹105", async ({ browser }) => {
  test.skip(!file || !existsSync(file), "BLOCKED: the Splitwise CSV wasn't supplied (secret E2E_SPLITWISE_CSV_B64 / E2E_SPLITWISE_CSV).");
  const csv = readFileSync(file, "utf8");

  // First, the file itself (a plain reading, separate from the app's importer):
  // the expense rows, their total, and Splitwise's own "Total balance" row.
  const rows = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const head = splitCsvLine(rows[0]);
  const people = head.slice(5);
  const body = rows.slice(1).map(splitCsvLine);
  const lines = body.filter((c) => c[1]?.trim().toLowerCase() !== "total balance");
  const expenses = lines.filter((c) => c[2]?.trim().toLowerCase() !== "payment");
  const total = expenses.reduce((s, c) => s + toPaise(c[3] ?? "0"), 0);
  const summary = body.find((c) => c[1]?.trim().toLowerCase() === "total balance");
  const fromFile = Object.fromEntries(people.map((p, i) => [p.trim(), Math.round(parseFloat(summary?.[5 + i] ?? "0") * 100)]));
  expect.soft(expenses.length, "expense rows in the file").toBe(EXPECTED.expenses);
  expect.soft(total, "total of the expense rows in the file (paise)").toBe(EXPECTED.total);
  expect(fromFile, "Splitwise's own Total balance row").toEqual(EXPECTED.balances);

  // Then the app: sign up as Varun Batra, bring the group over, check it.
  const user = await signUp("Varun Batra", testEmail("importer"));
  const ctx = await contextFor(browser, user);
  const page = await ctx.newPage();
  await page.goto("/import");
  await settled(page);
  await page.getByLabel("Spreadsheet to import").setInputFiles({ name: "splitwise-export.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText(new RegExp(`Found ${EXPECTED.expenses} expenses? and \\d+ payments? in INR`))).toBeVisible();
  await expect(page.getByText("✓ Matches the file’s own balances")).toBeVisible();
  await expect(page.getByRole("radio", { name: "Varun Batra", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.locator('input[name="groupName"]').fill(`E2E import ${Date.now()}`);
  await page.getByRole("button", { name: "Bring it over" }).click();
  await page.waitForURL(/imported=/);
  await expect(page.getByText(new RegExp(`Brought over ${EXPECTED.expenses} expenses`))).toBeVisible();

  const path = new URL(page.url()).pathname;
  expect(await readBalances(page, path)).toEqual(EXPECTED.balances);

  // The total spent: the group report's big number.
  await page.goto(`${path}/report`);
  await settled(page);
  await expect(page.getByRole("region", { name: "The trip in numbers" })).toContainText("₹10,810");
  await ctx.close();
});

// A comma-separated line, with "quoted, values".
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cell); cell = ""; }
    else cell += ch;
  }
  out.push(cell);
  return out;
}

// A made-up Splitwise export kept in the repository (fictional people), so the
// importer is always exercised even before the real file is supplied.
// By hand: Asha paid a ₹1,200 dinner for both, Kabir paid a ₹400 taxi for
// both, Kabir paid Asha ₹100 → Asha +₹300, Kabir −₹300; 2 expenses, ₹1,600.
test("import a sample Splitwise export (fictional people): 2 expenses + 1 payment, Asha +₹300 / Kabir −₹300", async ({ browser }) => {
  const user = await signUp("Asha Rao", testEmail("sample-importer"));
  const ctx = await contextFor(browser, user);
  const page = await ctx.newPage();
  await page.goto("/import");
  await settled(page);
  await page.getByLabel("Spreadsheet to import").setInputFiles("e2e/data/splitwise-sample.csv");
  await expect(page.getByText("Found 2 expenses and 1 payment in INR")).toBeVisible();
  await expect(page.getByText("✓ Matches the file’s own balances")).toBeVisible();
  await page.locator('input[name="groupName"]').fill(`E2E sample import ${Date.now()}`);
  await page.getByRole("button", { name: "Bring it over" }).click();
  await page.waitForURL(/imported=2\.1\.ok/);
  const path = new URL(page.url()).pathname;
  expect(await readBalances(page, path)).toEqual({ "Asha Rao": 30000, "Kabir Sen": -30000 });
  await page.goto(`${path}/report`);
  await settled(page);
  await expect(page.getByRole("region", { name: /in numbers/ })).toContainText("₹1,600");
  await ctx.close();
});

// A Loopin group spreadsheet (Settings → Download spreadsheet) comes back in as it was.
// By hand: Ann paid a ₹1,000 flight shared equally with Ben → Ann +₹500, Ben −₹500.
test("a Loopin group spreadsheet is brought over as it was: Ann +₹500 / Ben −₹500", async ({ browser }) => {
  const user = await signUp("Ann", testEmail("loopin-file"));
  const ctx = await contextFor(browser, user);
  const page = await ctx.newPage();
  await page.goto("/import");
  await settled(page);
  const loopinStyle =
    "Date,Type,Description,Notes,Category,Paid by,Amount (INR),Original amount,Original currency,Exchange rate,Card markup (INR),Paid with,Status,Ann's share (INR),Ben's share (INR)\r\n" +
    "2026-10-18,Expense,Flight,,Transport,Ann,1000.00,,,,,,,500.00,500.00\r\n";
  await page.getByLabel("Spreadsheet to import").setInputFiles({ name: "goa-expenses.csv", mimeType: "text/csv", buffer: Buffer.from(loopinStyle) });
  await expect(page.getByText("Read as: Loopin spreadsheet")).toBeVisible();
  await expect(page.getByText("Found 1 expense and 0 payments in INR")).toBeVisible();
  await page.getByRole("button", { name: "Bring it over" }).click();
  await page.waitForURL(/imported=1\.0\.na/);
  expect(await readBalances(page, new URL(page.url()).pathname)).toEqual({ Ann: 50000, Ben: -50000 });
  await ctx.close();
});

// Any other app's file (here, a Tricount-style one in euros): Loopin guesses
// which column is which, the person can change it, and it comes across.
// By hand: Lea paid €90 dinner for Lea, Max, Tom (€30 each); Max paid €30 taxi
// for Max, Tom (€15 each) → Lea +€60, Max −€15, Tom −€45.
test("another app's spreadsheet: columns guessed, people found, balances right (Lea +€60 / Max −€15 / Tom −€45)", async ({ browser }) => {
  const user = await signUp("Lea", testEmail("other-app"));
  const ctx = await contextFor(browser, user);
  const page = await ctx.newPage();
  await page.goto("/import");
  await settled(page);
  const other = 'Title,Amount,Currency,Date,Paid by,Paid for\r\nDinner,90,EUR,18/10/2026,Lea,"Lea, Max, Tom"\r\nTaxi,30,EUR,19/10/2026,Max,"Max, Tom"\r\n';
  await page.getByLabel("Spreadsheet to import").setInputFiles({ name: "lisbon.csv", mimeType: "text/csv", buffer: Buffer.from(other) });
  await expect(page.getByText("Read as: spreadsheet from another app")).toBeVisible();
  const cols = page.getByRole("region", { name: "Which column is which?" });
  await expect(cols.getByLabel("Paid by column")).toHaveValue("4");
  await expect(cols.getByLabel("Amount column")).toHaveValue("1");
  await expect(cols.getByLabel("How each one was shared")).toHaveValue("column");
  await expect(cols.getByLabel("Currency of the amounts")).toHaveValue("EUR");
  await expect(page.getByText("Found 2 expenses and 0 payments in EUR")).toBeVisible();
  await page.getByRole("button", { name: "Bring it over" }).click();
  await page.waitForURL(/imported=2\.0\.na/);
  expect(await readBalances(page, new URL(page.url()).pathname)).toEqual({ Lea: 6000, Max: -1500, Tom: -4500 });
  await ctx.close();
});

// A file with no "who paid" column can't be guessed: it asks, rather than guessing wrong.
test("a file without a “paid by” column asks which column is which instead of guessing", async ({ browser }) => {
  const user = await signUp("Nia", testEmail("no-payer"));
  const ctx = await contextFor(browser, user);
  const page = await ctx.newPage();
  await page.goto("/import");
  await settled(page);
  await page.getByLabel("Spreadsheet to import").setInputFiles({ name: "notes.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Amount\r\nTea,20\r\n") });
  await expect(page.getByRole("region", { name: "Which column is which?" })).toBeVisible();
  await expect(page.locator('p[role="alert"]')).toContainText("Pick the column that says who paid.");
  await expect(page.getByRole("button", { name: "Bring it over" })).toHaveCount(0);
  await ctx.close();
});
