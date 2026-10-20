import { test, expect } from "../fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { contextFor, createGroup, settled, shownGroupName } from "../helpers/app";

// Stage 1 · Groups: each kind, rename + undo, close + reopen, delete + restore.
test.describe.configure({ mode: "serial" });

let ctx: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  const user = await signUp("Gita", testEmail("groups"));
  ctx = await contextFor(browser, user);
  page = await ctx.newPage();
});
test.afterAll(async () => ctx?.close());

test("a Home group opens on This month, with Bills · List · Activity", async () => {
  const g = await createGroup(page, groupName("Flat"), "Home");
  await page.goto(g.path);
  await settled(page);
  await expect(page.locator('a[aria-current="page"]')).toHaveText("This month");
  for (const t of ["Bills", "List", "Activity"]) await expect(page.getByRole("link", { name: t, exact: true })).toBeVisible();
});

test("a Couple group: split worked out from incomes (₹1,10,000 / ₹90,000 → 55 / 45)", async () => {
  await page.goto("/groups/new");
  await settled(page);
  await page.getByRole("button", { name: /^Couple/ }).click();
  await page.locator('input[name="groupName"]').fill(groupName("Us"));
  await page.locator('select[name="currency"]').selectOption("INR");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("radio", { name: "By income" }).click();
  await page.getByLabel("You earn a month").fill("110000");
  await page.getByLabel("Your partner earns").fill("90000");
  await expect(page.getByText("55 / 45").first()).toBeVisible();
  await page.getByRole("button", { name: /Use 55 \/ 45/ }).click();
  await page.waitForURL(/\/invite\?new=1/);
});

test("rename a group, then Undo puts the old name back", async () => {
  const name = groupName("Rename me");
  const g = await createGroup(page, name);
  await page.goto(`${g.path}/settings`);
  await settled(page);
  await page.locator('input[name="name"]').fill(`${name} 2`);
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.waitForURL(/did=/);
  expect(await shownGroupName(page, g.path)).toBe(`${name} 2`);

  await page.goto(`${g.path}/settings`);
  await settled(page);
  await page.locator('input[name="name"]').fill(`${name} 3`);
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.waitForURL(/did=/);
  await page.getByRole("status").getByRole("button", { name: "Undo", exact: true }).click();
  await page.waitForURL(/undone=1/);
  expect(await shownGroupName(page, g.path)).toBe(`${name} 2`);
});

test("close a group: it moves to Closed groups and adding is paused; reopen it", async () => {
  const name = groupName("Close me");
  const g = await createGroup(page, name);
  await page.goto(`${g.path}/settings`);
  await settled(page);
  await page.locator("#close").getByRole("button", { name: "Close group" }).click();
  await page.waitForURL(/closed=1/);
  // Right after closing, the Closed groups list is open (its button reads "Hide closed groups").
  await expect(page.getByText("Hide closed groups")).toBeVisible();
  await expect(page.locator("li").filter({ hasText: name }).first()).toBeVisible();
  await page.goto(`${g.path}/add`);
  await settled(page);
  await expect(page.getByText(/This group is closed/)).toBeVisible();
  await page.getByRole("button", { name: "Reopen group" }).click();
  await page.waitForURL((u) => !u.pathname.endsWith("/add") || u.search.length > 0);
  await page.goto(`${g.path}/add`);
  await settled(page);
  await expect(page.locator("#expense-name")).toBeVisible();
});

test("delete a group: it's under Recently deleted (opened with a tap) and Restore brings it back", async () => {
  const name = groupName("Delete me");
  const g = await createGroup(page, name);
  await page.goto(`${g.path}/settings`);
  await settled(page);
  await page.getByRole("button", { name: "Delete group" }).click();
  await page.waitForURL(/deleted=group/);
  // Right after deleting it opens on its own; on a later visit it's a closed button.
  await expect(page.getByText("Hide recently deleted")).toBeVisible();
  await page.goto("/");
  await settled(page);
  const pill = page.getByText(/^Recently deleted \(\d+\)$/);
  await expect(pill).toBeVisible();
  await expect(page.getByRole("button", { name: "Restore" }).first()).toBeHidden();
  await pill.click();
  const row = page.locator("li").filter({ hasText: name });
  await row.getByRole("button", { name: "Restore" }).click();
  await page.waitForURL(new RegExp(g.path));
  expect(await shownGroupName(page, g.path)).toBe(name);
});
