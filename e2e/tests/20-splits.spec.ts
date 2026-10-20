import { test, expect } from "../fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { contextFor, createGroup, joinGroup, openEdit, readBalances, settled } from "../helpers/app";
import { addExpense, expectRefused, fillExpense } from "../helpers/expense";

// Stage 2 · Every way to split, and changing your mind: edit, delete, undo.
// Alice, Bob and Cara share a trip. After every step the balances on screen
// are compared with a separate, hand-written tally of who owes what.
test.describe.configure({ mode: "serial" });

type Who = "Alice" | "Bob" | "Cara";
const tally: Record<Who, number> = { Alice: 0, Bob: 0, Cara: 0 };
// Record an expense in the tally (paise): who paid what, and each person's share.
function record(paid: Partial<Record<Who, number>>, shares: Partial<Record<Who, number>>, sign = 1) {
  for (const [w, a] of Object.entries(paid)) tally[w as Who] += sign * a!;
  for (const [w, a] of Object.entries(shares)) tally[w as Who] -= sign * a!;
}

let ctxs: BrowserContext[] = [];
let A: Page;
let g = { path: "", invite: "" };

async function check() {
  expect(await readBalances(A, g.path)).toEqual(tally);
}

test.beforeAll(async ({ browser }) => {
  const [alice, bob, cara] = [await signUp("Alice", testEmail("s-alice")), await signUp("Bob", testEmail("s-bob")), await signUp("Cara", testEmail("s-cara"))];
  ctxs = await Promise.all([alice, bob, cara].map((u) => contextFor(browser, u)));
  A = await ctxs[0].newPage();
  g = await createGroup(A, groupName("Splits"));
  await joinGroup(await ctxs[1].newPage(), g.invite, g.path);
  await joinGroup(await ctxs[2].newPage(), g.invite, g.path);
});
test.afterAll(async () => {
  for (const c of ctxs) await c.close();
});

test("everyone equally: Alice pays ₹900", async () => {
  await addExpense(A, g.path, { name: "Dinner", amount: "900" });
  record({ Alice: 90000 }, { Alice: 30000, Bob: 30000, Cara: 30000 });
  await check();
});

test("only some: Bob pays ₹400 for Alice and Bob", async () => {
  await addExpense(A, g.path, { name: "Taxi", amount: "400", payer: "Bob", split: { kind: "only", who: ["You", "Bob"] } });
  record({ Bob: 40000 }, { Alice: 20000, Bob: 20000 });
  await check();
});

test("one person: Alice pays ₹300, just for Cara", async () => {
  await addExpense(A, g.path, { name: "Ticket", amount: "300", split: { kind: "one", who: "Cara" } });
  record({ Alice: 30000 }, { Cara: 30000 });
  await check();
});

test("exact amounts: Cara pays ₹1,000 as ₹100 / ₹200 / ₹700", async () => {
  await addExpense(A, g.path, { name: "Groceries", amount: "1000", payer: "Cara", split: { kind: "amounts", values: { You: "100", Bob: "200", Cara: "700" } } });
  record({ Cara: 100000 }, { Alice: 10000, Bob: 20000, Cara: 70000 });
  await check();
});

test("amounts that don't add up are refused, and nothing is saved", async () => {
  await expectRefused(A, g.path, { name: "Wrong", amount: "1000", split: { kind: "amounts", values: { You: "100", Bob: "100", Cara: "100" } } }, /add up/i);
  await check();
});

test("percentages: Alice pays ₹2,000 as 50% / 30% / 20%", async () => {
  await addExpense(A, g.path, { name: "Hotel", amount: "2000", split: { kind: "percent", values: { You: "50", Bob: "30", Cara: "20" } } });
  record({ Alice: 200000 }, { Alice: 100000, Bob: 60000, Cara: 40000 });
  await check();
});

test("percentages that don't make 100% are refused", async () => {
  await expectRefused(A, g.path, { name: "Wrong %", amount: "500", split: { kind: "percent", values: { You: "50", Bob: "20", Cara: "10" } } }, /100/);
  await check();
});

test("shares: Bob pays ₹1,200 as 2 : 1 : 1 (₹600 / ₹300 / ₹300)", async () => {
  await addExpense(A, g.path, { name: "Boat", amount: "1200", payer: "Bob", split: { kind: "shares", values: { You: "2", Bob: "1", Cara: "1" } } });
  record({ Bob: 120000 }, { Alice: 60000, Bob: 30000, Cara: 30000 });
  await check();
});

test("two payers: ₹1,500 paid as Alice ₹1,000 + Bob ₹500, shared equally", async () => {
  await addExpense(A, g.path, { name: "Show", amount: "1500", payers: { You: "1000", Bob: "500" } });
  record({ Alice: 100000, Bob: 50000 }, { Alice: 50000, Bob: 50000, Cara: 50000 });
  await check();
  await A.goto(`${g.path}?tab=activity&q=Show`);
  await expect(A.locator("main")).toContainText(/You \+ Bob paid/);
});

test("money back: Cara got ₹300 back, shared equally (the balances move the other way)", async () => {
  await addExpense(A, g.path, { name: "Refund", amount: "300", moneyBack: true, payer: "Cara" });
  record({ Cara: 30000 }, { Alice: 10000, Bob: 10000, Cara: 10000 }, -1);
  await check();
});

test("a double tap on Save adds it only once", async () => {
  await A.goto(`${g.path}/add`);
  await settled(A);
  await fillExpense(A, { name: "Water", amount: "90" });
  await A.getByRole("button", { name: "Save expense" }).dblclick();
  await A.waitForURL(/tab=activity/);
  record({ Alice: 9000 }, { Alice: 3000, Bob: 3000, Cara: 3000 });
  await check();
  const { db } = await import("../helpers/db");
  expect(await db.expense.count({ where: { groupId: g.path.split("/").pop()!, description: "Water", deletedAt: null } })).toBe(1);
});

test("edit the amount: Dinner ₹900 → ₹1,200", async () => {
  await openEdit(A, g.path, "Dinner");
  await A.getByLabel("Amount", { exact: true }).fill("1200");
  await A.getByRole("button", { name: "Everyone equally" }).click();
  await A.getByRole("button", { name: "Save changes" }).click();
  await A.waitForURL(/tab=activity/);
  record({ Alice: 90000 }, { Alice: 30000, Bob: 30000, Cara: 30000 }, -1);
  record({ Alice: 120000 }, { Alice: 40000, Bob: 40000, Cara: 40000 });
  await check();
});

test("edit who paid: Ticket was Alice's, now Bob paid it", async () => {
  await openEdit(A, g.path, "Ticket");
  await A.getByRole("button", { name: /^(✓ )?Bob$/ }).first().click();
  await A.getByRole("button", { name: "Save changes" }).click();
  await A.waitForURL(/tab=activity/);
  record({ Alice: 30000 }, { Cara: 30000 }, -1);
  record({ Bob: 30000 }, { Cara: 30000 });
  await check();
});

test("edit the split: Taxi from Alice + Bob to everyone", async () => {
  await openEdit(A, g.path, "Taxi");
  await A.getByRole("button", { name: "Everyone equally" }).click();
  await A.getByRole("button", { name: "Save changes" }).click();
  await A.waitForURL(/tab=activity/);
  record({ Bob: 40000 }, { Alice: 20000, Bob: 20000 }, -1);
  record({ Bob: 40000 }, { Alice: 13334, Bob: 13333, Cara: 13333 });
  // (₹400 / 3: one person gets the extra paisa; the screen and the tally may put it on different people.)
  const shown = await readBalances(A, g.path);
  for (const w of ["Alice", "Bob", "Cara"] as Who[]) expect(Math.abs(shown[w] - tally[w])).toBeLessThanOrEqual(1);
  expect(Object.values(shown).reduce((a, b) => a + b, 0)).toBe(0);
  Object.assign(tally, shown); // carry on from exactly what the app shows
});

test("rename: Groceries → Weekly groceries, and the history says exactly that", async () => {
  await openEdit(A, g.path, "Groceries");
  await A.locator("#expense-name").fill("Weekly groceries");
  await A.getByRole("button", { name: "Save changes" }).click();
  await A.waitForURL(/tab=activity/);
  const { db } = await import("../helpers/db");
  const ev = await db.groupEvent.findFirst({ where: { groupId: g.path.split("/").pop()!, kind: "expense_edited" }, orderBy: { createdAt: "desc" } });
  expect(ev?.details ?? "").toContain("Groceries → Weekly groceries");
  await check();
});

test("delete an expense, then Restore brings it back", async () => {
  await openEdit(A, g.path, "Boat");
  await A.getByRole("button", { name: "Delete expense" }).click();
  await A.waitForURL(/tab=activity/);
  record({ Bob: 120000 }, { Alice: 60000, Bob: 30000, Cara: 30000 }, -1);
  await check();
  await A.goto(`${g.path}?tab=activity&q=Boat`);
  await settled(A);
  await A.locator("details summary").filter({ hasText: "Boat" }).first().click();
  await A.getByRole("button", { name: "Restore" }).first().click();
  await A.waitForURL(/did=/);
  record({ Bob: 120000 }, { Alice: 60000, Bob: 30000, Cara: 30000 });
  await check();
});

test("Undo right after adding removes it again", async () => {
  await addExpense(A, g.path, { name: "Ice cream", amount: "150" });
  await A.getByRole("status").getByRole("button", { name: "Undo", exact: true }).click();
  await A.waitForURL(/undone=1/);
  await check(); // unchanged
});

test("Undo a delete from its bar", async () => {
  await openEdit(A, g.path, "Show");
  await A.getByRole("button", { name: "Delete expense" }).click();
  await A.waitForURL(/tab=activity/);
  await A.getByRole("status").getByRole("button", { name: "Undo", exact: true }).click();
  await A.waitForURL(/undone=1/);
  await check(); // back as it was
});

test("must-fail check: a split that's ₹1 off is caught", async () => {
  test.fail();
  const shown = await readBalances(A, g.path);
  expect(shown.Cara).toBe(tally.Cara + 100);
});
