import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { allowTestCopy, contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// Batch R3: the passport as mockup 14, and Want to go. Checked at 320×640, 360×740 and 390×844.
const PHONES = [
  { w: 320, h: 640 },
  { w: 360, h: 740 },
  { w: 390, h: 844 },
];

test("the first stamp card is above the bottom bar, even with the sharing question and a milestone; the art opens the book", async ({ browser }) => {
  test.setTimeout(240_000);
  const dana = await signUp("Dana", testEmail("r3-dana"));
  const { db } = await import("../helpers/db");
  const acc = await db.account.findFirstOrThrow({ where: { email: dana.email } });
  // India is home. Thailand (5–10 May 2026) and a Goa trip, both over; the sharing question is unanswered (passportChoiceAt empty).
  await db.account.update({ where: { id: acc.id }, data: { homeCountry: "IN", passportChoiceAt: null, passportShare: "groups" } });
  const mk = (name: string, start: string, end: string, place: string, country: string) =>
    db.group.create({
      data: { name: groupName(name), currency: "INR", type: "trip", inviteCode: `r3-${Math.random().toString(36).slice(2, 8)}`, tripStart: start, tripEnd: end, tripPlace: place, tripCountry: country, members: { create: [{ name: "Dana", accountId: acc.id, claimedAt: new Date() }, { name: "Nupur" }] } },
    });
  await mk("Thailand", "2026-05-05", "2026-05-10", "Bangkok, Phuket", "TH");
  await mk("Goa trip", "2026-03-13", "2026-03-15", "Goa", "");

  for (const { w, h } of PHONES) {
    const ctx = await browser.newContext({ storageState: dana.storageState, viewport: { width: w, height: h } });
    await allowTestCopy(ctx);
    const page = await ctx.newPage();
    await page.goto("/passport");
    await settled(page);
    // The sharing question is there (below the stamps), and so is the first card, above the bottom bar.
    await expect(page.locator("[data-passport-ask]")).toBeVisible();
    const card = page.locator("[data-been-card]").first();
    await expect(card).toBeVisible();
    const cardTop = (await card.boundingBox())!.y;
    const navTop = (await page.locator("[data-bottom-nav]").boundingBox())!.y;
    expect(cardTop, `${w}px: the first stamp card starts above the bottom bar`).toBeLessThan(navTop - 40);
    await expect(page.getByRole("heading", { name: "Your stamps" })).toBeVisible();
    // Nothing scrolls sideways.
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${w}px: no sideways scroll`).toBeLessThanOrEqual(1);
    // The art is a 44 px+ link to the book.
    const art = page.getByRole("link", { name: "Open your passport book" });
    const box = (await art.boundingBox())!;
    expect(Math.min(box.width, box.height), `${w}px: the art is a big enough tap target`).toBeGreaterThanOrEqual(44);
    await art.click();
    await page.waitForURL(/\/passport\?book=1/);
    await expect(page.getByRole("button", { name: "Open your passport" })).toBeVisible();
    await ctx.close();
  }
});

async function pageFor(browser: import("@playwright/test").Browser, user: Awaited<ReturnType<typeof signUp>>, w = 390, h = 844): Promise<Page> {
  const ctx = await browser.newContext({ storageState: user.storageState, viewport: { width: w, height: h } });
  await allowTestCopy(ctx);
  return ctx.newPage();
}

async function addJapan(page: Page) {
  await page.goto("/passport?tab=want");
  await settled(page);
  await page.getByRole("button", { name: "Add a place", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Add places" });
  await sheet.getByLabel("Search countries").fill("japan");
  await sheet.getByRole("checkbox", { name: "Japan" }).check();
  await sheet.getByRole("button", { name: "Add 1 place" }).click();
  await page.waitForURL(/wished=1/);
  await expect(page.locator("[data-wish-card='JP']")).toBeVisible();
}

async function shareJapanWith(page: Page, friend: string) {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Share your list" });
  await sheet.getByLabel("What to share").selectOption({ label: "Just Japan" });
  await sheet.getByRole("checkbox", { name: friend }).check();
  await sheet.getByRole("button", { name: "Save" }).click();
  await page.waitForURL(/shared=1/);
}

test("Want to go: add Japan and share it; the friend sees it; both share, then Plan together sends an invitation", async ({ browser }) => {
  test.setTimeout(300_000);
  const ana = await signUp("Ana", testEmail("r3-ana"));
  const ben = await signUp("Ben", testEmail("r3-ben"));
  const A = await pageFor(browser, ana);
  const B = await pageFor(browser, ben);
  const g = await createGroup(A, groupName("Friends"), "Anything Goes");
  await joinGroup(B, g.invite, g.path);

  // Ana's list is private until she shares: "Only you".
  await addJapan(A);
  await expect(A.locator("[data-wish-card='JP'] [data-wish-lock]")).toContainText("Only you");
  await B.goto("/passport?tab=want");
  await settled(B);
  await expect(B.locator("[data-shared-with-me]")).toHaveCount(0);

  // Ana shares Japan with Ben; Ben sees it under "Shared with you", grouped under Ana.
  await shareJapanWith(A, "Ben");
  await expect(A.locator("[data-wish-card='JP'] [data-wish-lock]")).toContainText("Shared with Ben");
  await B.goto("/passport?tab=want");
  await settled(B);
  const shared = B.locator("[data-shared-from='Ana']");
  await expect(shared).toBeVisible();
  await expect(shared.locator("[data-shared-place='JP']")).toContainText("Japan");
  await expect(B.locator("[data-match-card]")).toHaveCount(0); // Ben hasn't shared back: no match for anyone

  // Ben wants Japan too and shows it to Ana: both see "You and … both want to go".
  await addJapan(B);
  await expect(B.locator("[data-match-card]")).toHaveCount(0); // one-sided still
  await shareJapanWith(B, "Ana");
  await expect(B.locator("[data-match-card]")).toContainText("You and Ana both want to go");
  await A.goto("/passport?tab=want");
  await settled(A);
  const match = A.locator("[data-match-card]");
  await expect(match).toContainText("You and Ben both want to go");

  // Plan together: a Japan trip group, Ben invited the normal way (Join / Not now).
  await match.getByRole("button", { name: "Plan together" }).click();
  await A.waitForURL(/\/groups\/[A-Za-z0-9_-]+$/);
  await expect(A.getByRole("heading", { name: "Japan" }).first()).toBeVisible();
  await B.goto("/");
  await settled(B);
  const invite = B.locator("[data-invitation]").filter({ hasText: "Japan" });
  await expect(invite).toBeVisible();
  await expect(invite.getByRole("button", { name: "Join" })).toBeVisible();
  await expect(invite.getByRole("button", { name: "Not now" })).toBeVisible();

  // Back on Ana's list, the match now offers the trip instead of making a second one.
  await A.goto("/passport?tab=want");
  await settled(A);
  await expect(A.locator("[data-match-card]").getByRole("link", { name: "Open your Japan trip" })).toBeVisible();
});

test("Want to go fits 320×640, 360×740 and 390×844 with a match on the page", async ({ browser }) => {
  test.setTimeout(240_000);
  const cy = await signUp("Cy", testEmail("r3-cy"));
  const di = await signUp("Di", testEmail("r3-di"));
  const C = await pageFor(browser, cy);
  const D = await pageFor(browser, di);
  const g = await createGroup(C, groupName("Pair"), "Anything Goes");
  await joinGroup(D, g.invite, g.path);
  await addJapan(C);
  await shareJapanWith(C, "Di");
  await addJapan(D);
  await shareJapanWith(D, "Cy");
  for (const { w, h } of PHONES) {
    const page = await pageFor(browser, cy, w, h);
    await page.goto("/passport?tab=want");
    await settled(page);
    await expect(page.locator("[data-match-card]")).toBeVisible();
    await expect(page.locator("[data-wish-card='JP']")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${w}px: no sideways scroll`).toBeLessThanOrEqual(1);
    const btn = page.getByRole("button", { name: "Plan together" });
    expect((await btn.boundingBox())!.height, `${w}px: Plan together is a 44 px target`).toBeGreaterThanOrEqual(44);
    expect(h).toBeGreaterThan(0);
    await page.context().close();
  }
});
