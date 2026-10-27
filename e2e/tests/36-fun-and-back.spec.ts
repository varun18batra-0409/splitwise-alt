import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { addEqualExpense, contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// The fun screens, the way a person moves through them: in, around, and back
// out with the phone's Back button, plus taking things away again (a country
// from the passport, a card game).
test("titles, Wrapped, the passport and a card game: in, around, back out, and deleting", async ({ browser }) => {
  test.setTimeout(180_000);
  const asha = await signUp("Asha", testEmail("fun-asha"));
  const ravi = await signUp("Ravi", testEmail("fun-ravi"));
  const page = await (await contextFor(browser, asha)).newPage();
  page.on("dialog", (d) => d.accept()); // "Delete this game?" → yes
  const R = await (await contextFor(browser, ravi)).newPage();

  const trip = await createGroup(page, groupName("Goa trip"), "Trip");
  await joinGroup(R, trip.invite, trip.path);
  for (const [n, a] of [["Dinner", "1200"], ["Cab", "600"], ["Snacks", "300"], ["Villa", "6000"]]) await addEqualExpense(page, trip.path, n, a);

  // Everyone has a title, as cards on Balances.
  await page.goto(`${trip.path}?tab=balances`);
  await settled(page);
  await expect(page.locator("[data-title-card]")).toHaveCount(2);

  // A friend's passport, from Balances: only for people in the group, and only if they share it.
  await page.locator("summary", { hasText: "Ravi" }).first().click();
  const link = page.locator("[data-passport-link]").first();
  await expect(link).toBeVisible();
  const ravisPassport = (await link.getAttribute("href"))!;
  await link.click();
  await page.waitForURL(/\/passport\/friends\/[^/?]+\?from=/);
  await expect(page.getByRole("button", { name: "Open your passport" })).toBeVisible();
  await R.goto("/passport");
  await settled(R);
  await R.getByRole("button", { name: "Only me" }).click();
  await R.waitForURL(/shared=private/);
  await page.goto(ravisPassport);
  await settled(page);
  await expect(page.getByText("Ravi keeps their passport private.")).toBeVisible();
  const cara = await signUp("Cara", testEmail("fun-cara"));
  const C = await (await contextFor(browser, cara)).newPage();
  await C.goto(ravisPassport);
  await C.waitForURL(/\/private/);
  await R.goto("/passport");
  await settled(R);
  await R.getByRole("button", { name: "People in my groups" }).click();
  await R.waitForURL(/shared=groups/);
  // Friends' passports: from your own passport, everyone you've shared a group with.
  await page.goto("/passport");
  await settled(page);
  await page.locator("[data-friends-link]").click();
  await page.waitForURL(/\/passport\/friends$/);
  await page.getByRole("link", { name: /Ravi/ }).click();
  await page.waitForURL(/\/passport\/friends\/[^/]+$/);
  const ravisPage = new URL(page.url()).pathname;
  await expect(page.getByRole("button", { name: "Open your passport" })).toBeVisible();
  // His trip with Asha is still going, so friends don't see it yet: the passport is empty → nudge him (Alerts only).
  await page.getByRole("button", { name: "👋 Nudge Ravi" }).click();
  await page.waitForURL(/nudged=1/);
  await R.goto("/notifications");
  await settled(R);
  await expect(R.getByText(/Asha wants to see where you’ve been/)).toBeVisible();
  // A second nudge straight away is refused politely.
  await page.goto(ravisPage);
  await settled(page);
  await page.getByRole("button", { name: "👋 Nudge Ravi" }).click();
  await expect(page.getByText("You nudged them recently")).toBeVisible();
  await page.goBack();
  await page.waitForURL(/\/passport\/friends$/);
  // Cara shares no group with Ravi: his passport isn't there for her, even by its address.
  await C.goto(ravisPage);
  await expect(C.getByText("You can’t open this passport")).toBeVisible();
  await C.goto("/passport/friends");
  await settled(C);
  await expect(C.getByText("No friends here yet")).toBeVisible();

  // Wrapped from Charts, through to the end, then Back lands on the group again.
  await page.goto(`${trip.path}?tab=charts`);
  await settled(page);
  await page.getByRole("link", { name: /Watch the Wrapped/ }).click();
  await page.waitForURL(/\/wrapped$/);
  await expect(page.locator("[data-wrapped-slide='intro']")).toBeVisible();
  for (let k = 0; k < 8 && !(await page.locator("[data-wrapped-slide='outro']").count()); k++) await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("button", { name: "Share it" })).toBeVisible();
  await page.goBack();
  await page.waitForURL((u) => u.pathname === trip.path);

  // Spin for it on Add expense picks a payer.
  await page.goto(`${trip.path}/add`);
  await settled(page);
  await page.getByRole("button", { name: /Spin for it/ }).click();
  const wheel = page.getByRole("dialog", { name: "Spin the wheel" });
  await wheel.getByRole("button", { name: "Spin", exact: true }).click();
  await wheel.getByRole("button", { name: /^Set .+ as payer$/ }).click({ timeout: 8000 });
  await expect(wheel).toHaveCount(0);

  // The passport from the You page: open it, turn a page, add two countries, take one away.
  await page.goto("/account");
  await settled(page);
  await page.getByRole("link", { name: /Your trip passport/ }).click();
  await page.waitForURL(/\/passport$/);
  await page.getByRole("button", { name: "Open your passport" }).click();
  await page.getByRole("button", { name: "Next page" }).click();
  await page.getByRole("button", { name: "+ Add countries" }).click();
  const sheet = page.getByRole("dialog", { name: "Add countries" });
  await sheet.getByLabel("Search countries").fill("ital");
  await sheet.getByRole("checkbox", { name: "Italy" }).check();
  await sheet.getByLabel("Search countries").fill("japan");
  await sheet.getByRole("checkbox", { name: "Japan" }).check();
  await sheet.getByLabel("Search countries").fill("");
  await expect(sheet.getByRole("button", { name: "Add 2 countries" })).toBeVisible();
  await sheet.getByRole("button", { name: "Add 2 countries" }).click();
  await page.waitForURL(/added=2/);
  await expect(page.locator("[data-index-country='IT']")).toHaveCount(1);
  await page.getByRole("button", { name: "Remove Italy" }).click();
  await page.waitForURL((u) => u.pathname === "/passport" && !u.search.includes("added"));
  await expect(page.locator("[data-index-country='IT']")).toHaveCount(0);
  await expect(page.locator("[data-index-country='JP']")).toHaveCount(1);
  // Already-added countries are ticked and can't be added twice.
  await page.getByRole("button", { name: "+ Add countries" }).click();
  await sheet.getByLabel("Search countries").fill("japan");
  await expect(sheet.getByRole("checkbox", { name: "Japan" })).toBeDisabled();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);

  // A card game, started and deleted: it leaves the games list.
  const pot = await createGroup(page, groupName("Card night"), "The Pot");
  await page.goto(`${pot.path}/pot/new`);
  await settled(page);
  await page.locator('input[name="name"]').fill("Quick round");
  await page.locator('input[name="newNames"]').fill("Chirag");
  await page.getByRole("button", { name: "Start the game" }).click();
  await page.waitForURL(/\/pot\/[^/?]+\?started=1/);
  await settled(page);
  await page.getByRole("button", { name: "Delete game" }).click();
  await page.waitForURL(new RegExp(`${pot.path}\\?tab=games`));
  await settled(page);
  await expect(page.getByText("Quick round")).toHaveCount(0);
});
