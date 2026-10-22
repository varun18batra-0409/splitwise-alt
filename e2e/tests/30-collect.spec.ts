import { test, expect } from "../fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { allowTestCopy, contextFor, settled } from "../helpers/app";

// Collect: an organiser makes a link; someone with no account opens it, pays
// and ticks their name; the organiser checks it off, marks cash, and closes it.
test.describe.configure({ mode: "serial" });

let orgCtx: BrowserContext;
let org: Page;
let link = "";
const title = groupName("Gift");

test.beforeAll(async ({ browser }) => {
  const user = await signUp("Asha", testEmail("collector"));
  orgCtx = await contextFor(browser, user);
  org = await orgCtx.newPage();
});
test.afterAll(async () => orgCtx?.close());

test("the form refuses a bad UPI ID (and keeps what was typed), then makes the link", async () => {
  await org.goto("/collect/new");
  await settled(org);
  await org.locator('input[name="title"]').fill(title);
  await org.locator('input[name="amount"]').fill("300");
  await org.locator('select[name="currency"]').selectOption("INR");
  await org.locator('input[name="upiId"]').fill("not-a-upi-id");
  await org.locator('textarea[name="names"]').fill("Ravi\nMeera");
  await org.getByRole("button", { name: "Make the link" }).click();
  await expect(org.getByRole("alert")).toContainText("UPI ID");
  await expect(org).toHaveURL(/\/collect\/new/);

  await org.locator('input[name="upiId"]').fill("asha@okicici");
  await org.getByRole("button", { name: "Make the link" }).click();
  await org.waitForURL(/\/c\/[A-Za-z0-9_-]+\?new=1/);
  link = new URL(org.url()).pathname;
  await expect(org.locator("[data-collection-title]")).toHaveText(title);
  await expect(org.locator("[data-collection-progress]")).toContainText("0 of 2 paid");
  await expect(org.getByRole("button", { name: "Share the link" })).toBeVisible();
});

test("someone without an account pays by UPI, ticks their name, can undo it", async ({ page, context }) => {
  await allowTestCopy(context);
  await page.goto(link);
  await settled(page);
  await expect(page.getByText("Asha is collecting")).toBeVisible();
  const pay = page.getByRole("link", { name: /Pay ₹300 with UPI/ });
  await expect(pay).toHaveAttribute("href", /^upi:\/\/pay\?pa=asha%40okicici&pn=Asha&am=300\.00&cu=INR&tn=/);
  await expect(page.getByText("asha@okicici", { exact: true })).toBeVisible();

  await page.locator('select[name="entryId"]').selectOption({ label: "Ravi" });
  await page.getByRole("button", { name: "I’ve paid ✓" }).click();
  await page.waitForURL(/ticked=1/);
  await expect(page.getByRole("region", { name: "You're on the list" })).toContainText("Ravi · ₹300");
  await expect(page.locator("[data-collection-progress]")).toContainText("1 of 2 paid");

  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForURL(/undone=1/);
  await expect(page.locator("[data-collection-progress]")).toContainText("0 of 2 paid");

  await page.locator('select[name="entryId"]').selectOption({ label: "Ravi" });
  await page.getByRole("button", { name: "I’ve paid ✓" }).click();
  await page.waitForURL(/ticked=1/);
  await expect(page.locator("[data-collection-progress]")).toContainText("1 of 2 paid");
});

test("the organiser checks Ravi off, marks Meera's cash, sees it on Home, and closes it", async ({ page, context }) => {
  await org.goto(link);
  await settled(org);
  const paid = org.getByRole("region", { name: "Paid", exact: true });
  await expect(paid).toContainText("says paid");
  await paid.getByRole("button", { name: "Got it" }).click();
  await expect(org.getByRole("region", { name: "Paid", exact: true })).toContainText("checked by you");

  await org.getByRole("region", { name: "Still to pay", exact: true }).getByRole("button", { name: "Paid cash" }).click();
  await expect(org.locator("[data-collection-progress]")).toContainText("2 of 2 paid");
  await expect(org.locator("[data-collection-progress]")).toContainText("₹600 of ₹600");

  await org.goto("/");
  await settled(org);
  await expect(org.getByRole("region", { name: "Collections", exact: true })).toContainText(title);

  await org.goto(link);
  await settled(org);
  await org.getByRole("button", { name: "Close collection" }).click();
  await expect(org.getByRole("button", { name: "Reopen collection" })).toBeVisible();

  // A payer can no longer tick.
  await allowTestCopy(context);
  await page.goto(link);
  await settled(page);
  await expect(page.getByText("has closed this collection")).toBeVisible();
  await expect(page.getByRole("button", { name: "I’ve paid ✓" })).toHaveCount(0);
});
