import { test, expect } from "../fixtures";
import { allowTestCopy, settled } from "../helpers/app";

// 1. A first-time visitor: the tour, the start screen, and the main links.
test.beforeEach(async ({ context }) => allowTestCopy(context));

test("first visit shows the tour, then a start screen with the main ways in", async ({ page }) => {
  await page.goto("/");
  await settled(page);
  await expect(page.getByText("Create your first group").first()).toBeVisible();
  // The tour's Home button (src/components/IntroTour.tsx, aria-label "Home").
  await page.getByRole("link", { name: "Home", exact: true }).first().click();
  await expect(page.getByText("Let’s get you started")).toBeVisible();
  await expect(page.getByRole("link", { name: "Create a group" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Join with an invite link" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in or sign up" }).first()).toBeVisible();
});

test("key pages open from Home: guide, sign in, Splitwise, privacy", async ({ page }) => {
  await page.goto("/");
  await settled(page);
  await page.getByRole("link", { name: "Home", exact: true }).first().click();
  await expect(page.getByText("Let’s get you started")).toBeVisible();

  await page.getByRole("link", { name: "How Loopin works" }).first().click();
  await expect(page).toHaveURL(/\/how-it-works$/);
  await expect(page.getByRole("heading", { name: "Coming from another app?" })).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: /Coming from another app\?/ }).click();
  await expect(page).toHaveURL(/\/switching$/);
  await expect(page.getByRole("heading", { name: "Bring your groups. Keep your balances." })).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "Sign in or sign up" }).first().click();
  await expect(page).toHaveURL(/\/signin/);
  await expect(page.getByRole("heading", { name: "Continue to Loopin" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();

  await page.goto("/privacy");
  await expect(page.locator("main")).toContainText(/data/i);
});

test("FAQ: opens from the You page; questions open on tap; the data answer links to the privacy details", async ({ page }) => {
  await page.goto("/account");
  await settled(page);
  await page.getByRole("link", { name: "FAQ" }).click();
  await expect(page).toHaveURL(/\/faq$/);
  await expect(page.getByRole("heading", { name: "Questions, answered" })).toBeVisible();
  expect(await page.locator("details").count()).toBeGreaterThanOrEqual(15);
  const data = page.locator("details").filter({ hasText: "How do you handle my data?" });
  await data.locator("summary").click();
  await data.getByRole("link", { name: "Full privacy details" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await expect(page.getByText("What we store")).toBeVisible();
});
