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

test("key pages open from Home: guide, sign in, Splitwise, privacy, terms", async ({ page }) => {
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

  // Terms of use: linked from sign-in, plain English, and clear that Loopin never moves money.
  await page.goto("/signin");
  await page.getByRole("link", { name: "Terms" }).click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { name: "What Loopin is (and isn’t)" })).toBeVisible();
  await expect(page.locator("main")).toContainText("never holds, sends or receives money");
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

test("search engines: robots.txt, sitemap, title, description, share image; private screens kept out", async ({ page, request }) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Sitemap: https://www.loopinapps.com/sitemap.xml");
  expect(robots).toMatch(/Disallow: \/groups/);
  expect(robots).toMatch(/Disallow: \/join/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("https://www.loopinapps.com/how-it-works");
  expect(sitemap).not.toContain("/groups");
  await page.goto("/how-it-works");
  await expect(page).toHaveTitle("How Loopin works · Loopin");
  // In a browser, Next.js may also stream a copy into the page body for a moment; the head is what counts.
  expect(await page.locator('head meta[name="description"]').first().getAttribute("content")).toMatch(/split/i);
  // What a link preview (WhatsApp, which doesn't run scripts) gets: the page as sent, read with scripts off.
  const bot = await page.context().browser()!.newContext({ javaScriptEnabled: false, userAgent: "WhatsApp/2.24.20.80 A" });
  await allowTestCopy(bot);
  const bp = await bot.newPage();
  await bp.goto(new URL("/how-it-works", page.url()).toString());
  expect(await bp.locator('head meta[name="description"]').count(), "description in the head for WhatsApp").toBe(1);
  expect(await bp.locator('head meta[property="og:image"]').count(), "share picture in the head for WhatsApp").toBeGreaterThan(0);
  await bot.close();
  expect(await page.locator('link[rel="canonical"]').first().getAttribute("href")).toBe("https://www.loopinapps.com/how-it-works");
  expect(await page.locator('meta[property="og:image"]').first().getAttribute("content")).toMatch(/opengraph-image/);
  const og = await request.get("/opengraph-image");
  expect(og.ok()).toBe(true);
  expect(og.headers()["content-type"]).toContain("image/png");
});
