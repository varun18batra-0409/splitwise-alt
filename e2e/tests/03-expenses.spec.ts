import { test, expect } from "../fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { testEmail, groupName } from "../env";
import { signUp, type TestUser } from "../helpers/auth";
import { addEqualExpense, contextFor, createGroup, joinGroup, openEdit, openSplit, readBalances, settled } from "../helpers/app";

// 3 and 4. Three people in one trip: an equal split, then an edit.
// The tests in this file run in order and share the group.
test.describe.configure({ mode: "serial" });

let alice: TestUser, bob: TestUser, cara: TestUser;
let A: Page, B: Page;
const contexts: BrowserContext[] = [];
let group = { path: "", invite: "" };

test.beforeAll(async ({ browser }) => {
  alice = await signUp("Alice", testEmail("alice"));
  bob = await signUp("Bob", testEmail("bob"));
  cara = await signUp("Cara", testEmail("cara"));
  const [ca, cb, cc] = await Promise.all([alice, bob, cara].map((u) => contextFor(browser, u)));
  contexts.push(ca, cb, cc);
  A = await ca.newPage();
  B = await cb.newPage();
  const C = await cc.newPage();
  group = await createGroup(A, groupName("Three friends"));
  await joinGroup(B, group.invite, group.path);
  await joinGroup(C, group.invite, group.path);
});

test.afterAll(async () => {
  for (const c of contexts) await c.close();
});

test("equal split across three people: ₹900 dinner → Alice gets ₹600, Bob and Cara owe ₹300 each", async () => {
  await addEqualExpense(A, group.path, "Dinner", "900");
  await expect(A.locator('li[id^="item-"] details > summary').filter({ hasText: "Dinner" }).first()).toBeVisible();

  const seenByAlice = await readBalances(A, group.path);
  expect(seenByAlice).toEqual({ Alice: 60000, Bob: -30000, Cara: -30000 });
  // Bob sees the same numbers from his phone.
  const seenByBob = await readBalances(B, group.path);
  expect(seenByBob).toEqual(seenByAlice);
  expect(Object.values(seenByAlice).reduce((a, b) => a + b, 0)).toBe(0);
});

test("must-fail check: a wrong expected balance is caught", async () => {
  // Marked as expected to fail: if this ever "passes", the checks have gone blind.
  test.fail();
  const shown = await readBalances(A, group.path);
  expect(shown.Alice).toBe(60100); // deliberately ₹1 off
});

test("edit the amount (₹900 → ₹1,200): balances recalculate to +₹800 / −₹400 / −₹400", async () => {
  await openEdit(A, group.path, "Dinner");
  await A.getByLabel("Amount", { exact: true }).fill("1200");
  await openSplit(A);
  await A.getByRole("button", { name: "Everyone equally" }).click();
  await A.getByRole("button", { name: "Save changes" }).click();
  await A.waitForURL(/tab=activity/);
  await settled(A);
  await expect(A.locator('li[id^="item-"] details > summary').filter({ hasText: "Dinner" }).first()).toContainText("1,200");

  expect(await readBalances(A, group.path)).toEqual({ Alice: 80000, Bob: -40000, Cara: -40000 });
  expect(await readBalances(B, group.path)).toEqual({ Alice: 80000, Bob: -40000, Cara: -40000 });
});

test("Insights add up: your share and group spend match what was entered, and Home's month card agrees", async () => {
  // Bob adds a ₹300 taxi for all three: Alice's part is ₹100. With the ₹1,200 dinner (her part ₹400): ₹500.
  await addEqualExpense(B, group.path, "Taxi", "300");
  const gid = group.path.split("/").pop();
  await A.goto(`/search?g=${gid}`);
  await settled(A);
  await expect(A.locator("[data-insights-total]"), "Insights: Alice's share this month").toHaveText("₹500");
  // Alice paid the ₹1,200 dinner: your share ₹500 (the big number; not repeated below), you paid ₹1,200, so the others owe her ₹700.
  await expect(A.getByLabel("What you paid, and where that leaves you")).toContainText("₹1,200");
  await expect(A.getByLabel("What you paid, and where that leaves you")).toContainText("₹700");
  await expect(A.locator("[data-recap-ministats]")).toHaveAttribute("data-recap-ministats", "2");
  await A.goto(`/search?g=${gid}&v=spent`);
  await settled(A);
  await expect(A.locator("[data-insights-total]"), "Insights: the group's spending this month").toHaveText("₹1,500");
  // Everything together (no group picked) is the same here: Alice is only in this group.
  await A.goto("/search");
  await settled(A);
  await expect(A.locator("[data-insights-total]")).toHaveText("₹500");
  // Home's "your month" card (it looks back at last month in a month's first three days).
  const dayOfMonth = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric" }).format(new Date()));
  if (dayOfMonth > 3) {
    await A.goto("/");
    await settled(A);
    await expect(A.locator("[data-month-share]")).toHaveText("₹500");
  }
});

// The amount box always holds the plain typed amount ("1500"): it never changes format on focus or blur, so the browser never rewrites
// it under the cursor. These are the real ways people edit it; each ends with exactly "2000" in the box and ₹2,000 saved.
async function saveEditedAs(page: Page, name: string, shown: string) {
  await openSplit(page);
  await page.getByRole("button", { name: "Everyone equally" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/tab=activity/);
  await settled(page);
  const row = page.locator('li[id^="item-"] details > summary').filter({ hasText: name }).first();
  await expect(row).toContainText(shown);
  await expect(row).not.toContainText("15002000");
  await expect(row).not.toContainText("1,500");
}

test("editing a ₹1,500 expense, desktop-style: press and release the mouse on the box, select all, type 2000 → ₹2,000", async () => {
  await addEqualExpense(A, group.path, "Hotel press", "1500");
  await openEdit(A, group.path, "Hotel press");
  const amount = A.getByLabel("Amount", { exact: true });
  await expect(amount).toHaveValue("1500"); // the same plain text focused or not
  const box = (await amount.boundingBox())!;
  await A.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await A.mouse.down();
  await A.waitForTimeout(150); // a real press lasts a moment
  await A.mouse.up();
  await expect(amount).toBeFocused();
  await expect(amount).toHaveValue("1500"); // nothing rewrote it under the cursor
  await A.keyboard.press("ControlOrMeta+A");
  await A.keyboard.type("2000");
  await expect(amount).toHaveValue("2000");
  await saveEditedAs(A, "Hotel press", "2,000");
});

test("editing a ₹1,500 expense with the keyboard: Tab into the box, select all, type 2000 → ₹2,000", async () => {
  await addEqualExpense(A, group.path, "Hotel tab", "1500");
  await openEdit(A, group.path, "Hotel tab");
  const amount = A.getByLabel("Amount", { exact: true });
  await expect(amount).toHaveValue("1500");
  // Walk back from the name box with Shift+Tab until the amount box has focus: a keyboard arrival, no mouse.
  await A.locator("#expense-name").focus();
  let arrived = false;
  for (let i = 0; i < 10 && !arrived; i++) {
    await A.keyboard.press("Shift+Tab");
    arrived = await A.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Amount");
  }
  expect(arrived, "the amount box can be reached with the keyboard").toBe(true);
  await expect(amount).toHaveValue("1500");
  await A.keyboard.press("ControlOrMeta+A");
  await A.keyboard.type("2000");
  await expect(amount).toHaveValue("2000");
  await saveEditedAs(A, "Hotel tab", "2,000");
});

test("editing a ₹1,500 expense by hand: click at the end, Backspace four times, type 2000 → ₹2,000", async () => {
  await addEqualExpense(A, group.path, "Hotel back", "1500");
  await openEdit(A, group.path, "Hotel back");
  const amount = A.getByLabel("Amount", { exact: true });
  await expect(amount).toHaveValue("1500");
  const box = (await amount.boundingBox())!;
  await amount.click({ position: { x: box.width - 1, y: box.height / 2 } }); // the end of the text
  await expect(amount).toHaveValue("1500");
  for (let i = 0; i < 4; i++) await A.keyboard.press("Backspace");
  await expect(amount).toHaveValue("");
  await A.keyboard.type("2000");
  await expect(amount).toHaveValue("2000");
  await saveEditedAs(A, "Hotel back", "2,000");
});

test("group screens show exact amounts with paise from 1,000 up: ₹3,001.50 split three ways → owes ₹1,000.50", async () => {
  // Bob pays ₹3,001.50 for all three: each share is ₹1,000.50, so Alice and Cara each owe exactly ₹1,000.50 and Bob gets ₹2,001.
  const g = await createGroup(A, groupName("Paise check"));
  await joinGroup(B, g.invite, g.path);
  const C = await contexts[2].newPage();
  await joinGroup(C, g.invite, g.path);
  await B.goto(`${g.path}/add`);
  await settled(B);
  await B.locator("#expense-name").fill("Villa");
  await B.getByLabel("Amount", { exact: true }).fill("3001.50");
  await openSplit(B);
  await B.getByRole("button", { name: "Everyone equally" }).click();
  await B.getByRole("button", { name: "Save expense" }).click();
  await B.waitForURL(/tab=activity/);
  await settled(B);

  // Alice's Balances tab: the By person rows and the ticket read exactly (never ₹1,001).
  await A.goto(`${g.path}?tab=balances`);
  await settled(A);
  const rows = A.locator("details.group\\/person > summary");
  await expect(rows.filter({ hasText: "Bob" })).toContainText("gets ₹2,001");
  await expect(rows.filter({ hasText: "Cara" })).toContainText("owes ₹1,000.50");
  await expect(rows.filter({ hasText: "Alice" })).toContainText("owes ₹1,000.50");
  await expect(A.locator("[data-net-balance]").first()).toContainText("₹1,000.50");
  // The activity row says ₹3,001.50, not ₹3,002.
  await A.goto(`${g.path}?tab=activity`);
  await settled(A);
  await expect(A.locator('li[id^="item-"]').filter({ hasText: "Villa" }).first()).toContainText("₹3,001.50");
  // The People page says the same exact figures (never ₹1,001).
  await A.goto(`${g.path}/people`);
  await settled(A);
  await expect(A.locator("details > summary").filter({ hasText: "Cara" }).first()).toContainText("owes ₹1,000.50");
  await expect(A.locator("details > summary").filter({ hasText: "Bob" }).first()).toContainText("gets ₹2,001");
  await expect(A.locator("details > summary").filter({ hasText: "Cara" }).first()).not.toContainText("₹1,001");
  await C.close();
});

test("a flat (Home group) shows the exact balance on This month: owes ₹1,000.50, not ₹1,001", async () => {
  // Bob pays ₹2,001 for the two of them: Alice's half is ₹1,000.50.
  const flat = await createGroup(A, groupName("Flat exact"), "Home");
  await joinGroup(B, flat.invite, flat.path);
  await addEqualExpense(B, flat.path, "Rent top-up", "2001");
  await A.goto(flat.path);
  await settled(A);
  const line = A.locator("[data-balance-line]").first();
  await expect(line).toHaveText("₹1,000.50");
  await expect(A.getByText(/Overall you owe/).first()).toContainText("₹1,000.50");
  await expect(A.getByText(/Overall you owe/).first()).not.toContainText("₹1,001");
});
