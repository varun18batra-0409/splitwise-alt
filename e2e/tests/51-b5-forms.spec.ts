import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { db } from "../helpers/db";
import { contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// B5 part B: forms, trips, pictures. Written against the app's own labels; these specs were NOT run when they were written
// (no browser or test copy in the build sandbox), so the first run on the test copy is the real check.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

test("CA-4: after Record opened the picker, the next tap is not swallowed and the bar hides", async ({ browser }) => {
  test.setTimeout(120_000);
  const asha = await signUp("Asha", testEmail("b5-pay-asha"));
  const meera = await signUp("Meera", testEmail("b5-pay-meera"));
  const A = await (await contextFor(browser, asha)).newPage();
  const M = await (await contextFor(browser, meera)).newPage();
  const g = await createGroup(A, groupName("B5 pay"), "Trip");
  await joinGroup(M, g.invite, g.path);
  const gid = g.path.split("/").pop()!;

  await A.goto(`${g.path}/pay?amount=300`);
  await settled(A);
  // No "To" yet: Record opens the picker instead of sending.
  await A.getByRole("button", { name: /^Record/ }).last().click();
  // (The payer's own chip stays in the list, hidden: they can't pay themselves. So look for Meera's.)
  await expect(A.locator("[data-to]").filter({ hasText: "Meera" })).toBeVisible();
  await expect(A.getByRole("progressbar", { name: "Loading" })).toBeHidden();
  // Choose Meera and tap Record straight away (within a second): it must go through.
  await A.locator("[data-to]").filter({ hasText: "Meera" }).click();
  await A.getByRole("button", { name: /^Record/ }).last().click();
  // The tap went through. Nobody owes anything in this new group, so Loopin first asks "more than what's owed, record it anyway?".
  await A.waitForURL(/paid=1|owes=/);
  if (!/paid=1/.test(A.url())) {
    await expect(A.locator("[data-over-warning]")).toBeVisible();
    await A.locator("[data-over-record]").click();
    await A.waitForURL(/paid=1/);
  }
  expect(await db.payment.count({ where: { groupId: gid, deletedAt: null } })).toBe(1);
  await ctxClose(A);
});

test("CA-5: while the bill photo is going up both Save buttons wait, and the saved expense has the photo", async ({ browser }) => {
  test.setTimeout(120_000);
  const asha = await signUp("Asha", testEmail("b5-scan-asha"));
  const A = await (await contextFor(browser, asha)).newPage();
  const g = await createGroup(A, groupName("B5 scan"), "Trip");
  const gid = g.path.split("/").pop()!;
  await A.route("**/api/receipt?**", async (route) => {
    await new Promise((r) => setTimeout(r, 3000));
    await route.continue();
  });
  await A.goto(`${g.path}/add`);
  await settled(A);
  await A.locator("#expense-name").fill("Lunch with bill");
  await A.getByLabel("Amount", { exact: true }).fill("500");
  await A.getByLabel("Bill photo").setInputFiles({ name: "bill.jpg", mimeType: "image/jpeg", buffer: TINY_JPEG });
  await expect(A.getByRole("button", { name: "Save expense" })).toBeDisabled();
  await expect(A.getByRole("button", { name: "Save & add another" })).toBeDisabled();
  await expect(A.getByRole("button", { name: "Save expense" })).toBeEnabled({ timeout: 15_000 });
  await A.getByRole("button", { name: "Save expense" }).click();
  await A.waitForURL(/tab=activity/);
  const exp = await db.expense.findFirstOrThrow({ where: { groupId: gid, description: "Lunch with bill" } });
  expect(await db.receipt.count({ where: { groupId: gid, expenseId: exp.id } })).toBe(1);
});

test("CB-6: a file that can't be read shows an error, and the import button can still be tapped after a good file", async ({ browser }) => {
  const asha = await signUp("Asha Rao", testEmail("b5-import"));
  const A = await (await contextFor(browser, asha)).newPage();
  await A.goto("/import");
  await settled(A);
  await A.getByLabel("Spreadsheet to import").setInputFiles({ name: "nonsense.csv", mimeType: "text/csv", buffer: Buffer.from("this is not an export\n") });
  // Our own alert (Next also keeps an empty route announcer with role="alert" on every page).
  await expect(A.getByRole("alert").filter({ hasText: "That file has no expenses in it." })).toBeVisible();
  await A.getByLabel("Spreadsheet to import").setInputFiles("e2e/data/splitwise-sample.csv");
  await A.locator('input[name="groupName"]').fill(`B5 import ${Date.now()}`);
  const button = A.getByRole("button", { name: "Bring it over" });
  await expect(button).toBeEnabled();
});

for (const size of [{ width: 360, height: 800 }, { width: 390, height: 844 }]) {
  test(`VD1-2: the emoji picker is fully visible and tappable at ${size.width}x${size.height}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const asha = await signUp("Asha", testEmail(`b5-pick-${size.width}`));
    const A = await (await contextFor(browser, asha)).newPage();
    await A.setViewportSize(size);
    const g = await createGroup(A, groupName("B5 picker"), "Trip");
    const gid = g.path.split("/").pop()!;
    const me = await db.member.findFirstOrThrow({ where: { groupId: gid, name: "Asha" } });
    const acc = await db.account.findFirstOrThrow({ where: { email: asha.email } });
    await db.moment.create({ data: { groupId: gid, authorId: me.id, authorAccountId: acc.id, caption: "Sunset", type: "image/jpeg", width: 1, height: 1, data: TINY_JPEG, thumbData: TINY_JPEG } });
    await A.goto(`${g.path}/moments`);
    await settled(A);
    await A.locator("summary[aria-label='React']").first().click();
    const first = A.getByRole("button", { name: /^React / }).first();
    await expect(first).toBeVisible();
    const b = (await first.boundingBox())!;
    const hit = await A.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return Boolean(el?.closest("[aria-label^='React ']"));
    }, [b.x + b.width / 2, b.y + b.height / 2]);
    expect(hit, "the first emoji is not covered or clipped").toBe(true);
    await first.click();
    await expect(A.locator("[data-reactions]").first()).toContainText("1");
  });
}

test("B8: a trip called NYC weekend shows New York as the hint and saves nothing it was not given", async ({ browser }) => {
  const asha = await signUp("Asha", testEmail("b5-where"));
  const A = await (await contextFor(browser, asha)).newPage();
  const g = await createGroup(A, groupName("NYC weekend"), "Trip");
  const gid = g.path.split("/").pop()!;
  await A.goto(`${g.path}/settings`);
  await settled(A);
  await expect(A.getByLabel("Places")).toHaveAttribute("placeholder", "New York");
  await expect(A.getByRole("option", { name: /United States \(from the name\)/ })).toHaveCount(1);
  await A.getByRole("button", { name: "Save settings" }).click();
  await settled(A);
  const row = await db.group.findUniqueOrThrow({ where: { id: gid }, select: { tripPlace: true, tripCountry: true } });
  expect(row).toEqual({ tripPlace: "", tripCountry: "" });
});

test("VD2-24: a trip with the default cover has no Picture tile ticked, and saving leaves the cover empty", async ({ browser }) => {
  const asha = await signUp("Asha", testEmail("b5-cover"));
  const A = await (await contextFor(browser, asha)).newPage();
  const g = await createGroup(A, groupName("Goa trip"), "Trip");
  const gid = g.path.split("/").pop()!;
  await A.goto(`${g.path}/settings`);
  await settled(A);
  // With a downloaded Goa photo the trip shows that photo, so no drawn tile is ticked. A test copy built without photos shows the
  // drawn trip picture (the beach) instead, and then that one tile is the one ticked. Either way saving must not pin a picture.
  const ticked = A.locator('input[name="cover"]:checked');
  if (await ticked.count()) await expect(ticked).toHaveValue("beach"); // a trip's drawn picture
  await A.getByRole("button", { name: "Save settings" }).click();
  await settled(A);
  expect((await db.group.findUniqueOrThrow({ where: { id: gid }, select: { cover: true } })).cover).toBe("");
});

test("CA-10: a busy search says so, and the same search works once the server answers again", async ({ browser }) => {
  const asha = await signUp("Asha", testEmail("b5-busy-asha"));
  const A = await (await contextFor(browser, asha)).newPage();
  const g = await createGroup(A, groupName("B5 busy"), "Trip");
  let busy = true;
  await A.route("**/api/people?**", (route) => (busy ? route.fulfill({ status: 429, contentType: "application/json", body: "[]" }) : route.continue()));
  await A.goto(`${g.path}/invite`);
  await settled(A);
  // The search sits under "More ways" → "Search by name or email" (invite page, mockup 4).
  await A.locator("[data-more-ways] > summary").click();
  await A.locator('[data-more-ways] [data-way="search"] > summary').click();
  const search = A.getByLabel("Search people on Loopin");
  await search.fill("Meera");
  // (If this fails, say what the list showed instead, and what the box held.)
  await expect(A.getByText("Search is busy. Try again in a minute."), await (async () => {
    await A.waitForTimeout(3000);
    const list = await A.locator("[data-way='search'] ul").allInnerTexts().catch(() => ["(no list)"]);
    return `the list said: ${JSON.stringify(list)}; the box held: ${JSON.stringify(await search.inputValue().catch(() => "?"))}`;
  })()).toBeVisible();
  busy = false;
  await search.fill("Meer");
  await search.fill("Meera");
  // The failure was not remembered: the busy line is gone (a real answer, empty or not, replaces it).
  await expect(A.getByText("Search is busy. Try again in a minute.")).toBeHidden();
});

async function ctxClose(page: import("@playwright/test").Page) {
  await page.context().close();
}
