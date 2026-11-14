import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { addEqualExpense, contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// R4: the group page as the founder's mockup 03. A trip has Overview / Expenses / People / Memories; every old ?tab= address still opens a real
// screen; Memories shows no money; Overview's "Trip recap" opens the charts and the Invite pill opens the invite. On 320, 360 and 390 px phones.
const SIZES = [{ w: 320, h: 640 }, { w: 360, h: 740 }, { w: 390, h: 844 }];

test("a trip's tabs: four tabs, old addresses open, Memories has no money, Trip recap and Invite work", async ({ browser }) => {
  test.setTimeout(240_000);
  const asha = await signUp("Asha", testEmail("tabs-asha"));
  const ravi = await signUp("Ravi", testEmail("tabs-ravi"));
  const page = await (await contextFor(browser, asha)).newPage();
  const R = await (await contextFor(browser, ravi)).newPage();
  const trip = await createGroup(page, groupName("Goa trip"), "Trip");
  await joinGroup(R, trip.invite, trip.path);
  await addEqualExpense(page, trip.path, "Dinner", "1200");
  await addEqualExpense(page, trip.path, "Boat tickets", "600");

  for (const { w, h } of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    await page.goto(trip.path);
    await settled(page);

    // Four tabs, all inside the screen, none cut.
    const bar = page.getByRole("navigation", { name: "Group sections" });
    for (const name of ["Overview", "Expenses", "People", "Memories"]) {
      const link = bar.getByRole("link", { name });
      await expect(link, `${name} at ${w}`).toBeVisible();
      const b = (await link.boundingBox())!;
      expect(b.x, `${name} starts on screen at ${w}`).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, `${name} ends on screen at ${w}`).toBeLessThanOrEqual(w + 1);
      expect(b.height, `${name} is a 44px target at ${w}`).toBeGreaterThanOrEqual(43);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `no sideways scroll at ${w}`).toBe(true);

    // Overview: the money pass, Add expense, the latest expenses, and Trip recap | Group settings at the bottom.
    await expect(bar.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-group-balance]")).toBeVisible();
    await expect(page.locator("[data-group-balance] [data-route-from]")).toHaveCount(1);
    await expect(page.locator("[data-recent-expenses]")).toContainText("Boat tickets");
    await expect(page.locator("[data-group-recap]")).toBeVisible();
    await expect(page.locator("[data-invite-pill]")).toBeVisible(); // the labelled Invite pill
  }

  // Every old address opens a real screen, with the right tab lit.
  const want: [string, string][] = [["?tab=activity", "Expenses"], ["?tab=expenses", "Expenses"], ["?tab=balances", "People"], ["?tab=people", "People"], ["?tab=memories", "Memories"], ["?tab=overview", "Overview"], ["?tab=charts", "Overview"], ["?tab=nonsense", "Overview"]];
  for (const [q, lit] of want) {
    const res = await page.goto(`${trip.path}${q}`);
    expect(res?.status(), q).toBeLessThan(400);
    await settled(page);
    await expect(page.getByRole("navigation", { name: "Group sections" }).locator("[aria-current=page]"), q).toHaveText(lit);
  }

  // Memories: no money and no balance.
  await page.goto(`${trip.path}?tab=memories`);
  await settled(page);
  const mem = page.locator("[data-memories]");
  await expect(mem).toBeVisible();
  expect(await mem.innerText()).not.toContain("₹");
  await expect(page.locator("[data-group-balance]")).toHaveCount(0);
  await expect(page.locator("[data-balance]")).toHaveCount(0);

  // Overview → Trip recap opens the charts (with "‹ Overview" back).
  await page.goto(trip.path);
  await settled(page);
  await page.locator("[data-group-recap]").click();
  await page.waitForURL(/tab=charts/);
  await settled(page);
  await expect(page.locator("[data-recap-back]")).toBeVisible();

  // Invite pill opens the invite screen.
  await page.goto(trip.path);
  await settled(page);
  await page.locator("[data-invite-pill]").click();
  await page.waitForURL(/\/invite/);
});
