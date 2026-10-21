import { test, expect } from "../fixtures";
import type { BrowserContext, Page } from "@playwright/test";
import { bypassHeaders, testEmail, groupName } from "../env";
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

test("a group's own photo: upload it in settings; it shows on the group and Home, only for people in the group", async ({ browser }) => {
  const g = await createGroup(page, groupName("Photo"), "Trip");
  await page.goto(`${g.path}/settings`);
  await settled(page);
  // The picture row scrolls sideways and stays where you leave it; the page itself never moves sideways.
  const row = page.locator("fieldset", { has: page.locator("legend", { hasText: "Picture" }) }).locator(":scope > div").first();
  // Scrolled to a point between two pictures: it must stay there, not spring back.
  const target = await row.evaluate((el) => {
    const t = Math.floor((el.scrollWidth - el.clientWidth) / 2);
    el.scrollTo({ left: t });
    return t;
  });
  expect(target, "the picture row has more pictures than fit (it can scroll)").toBeGreaterThan(5);
  await page.waitForTimeout(800);
  expect(Math.abs((await row.evaluate((el) => el.scrollLeft)) - target), "the picture row stays where it was scrolled").toBeLessThanOrEqual(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "the page isn't wider than the phone").toBe(true);
  // A small real picture (a 64×48 PNG drawn here), picked as if from the phone's gallery.
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 48;
    const x = c.getContext("2d")!;
    x.fillStyle = "#2a7"; x.fillRect(0, 0, 64, 48);
    x.fillStyle = "#fc3"; x.fillRect(16, 12, 32, 24);
    const b: Blob = await new Promise((r) => c.toBlob((v) => r(v!), "image/png"));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
  await page.getByLabel("Upload your own photo").setInputFiles({ name: "beach.png", mimeType: "image/png", buffer: Buffer.from(png) });
  await expect(page.getByText("Saved for the group")).toBeVisible({ timeout: 20_000 });

  await page.goto(g.path);
  await settled(page);
  const src = await page.locator('header img[src*="/api/group-photo/"]').first().getAttribute("src");
  expect(src, "the group's own photo is at the top of the group").toBeTruthy();
  const own = await page.request.get(src!);
  expect(own.status()).toBe(200);
  expect(own.headers()["content-type"]).toMatch(/^image\/(webp|jpeg|png)$/);

  // Someone not in the group can't see it.
  const stranger = await browser.newContext({ extraHTTPHeaders: bypassHeaders });
  const r = await stranger.request.get(new URL(src!, page.url()).toString());
  expect(r.status()).toBe(404);
  await stranger.close();

  // Not a picture → refused.
  const bad = await page.request.post(`${g.path.replace("/groups/", "/api/group-photo/")}`, {
    data: "<svg onload=alert(1)>",
    headers: { "Content-Type": "image/png", Origin: new URL(page.url()).origin },
  });
  expect(bad.status()).toBe(415);
});
