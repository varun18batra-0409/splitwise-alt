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
  await expect(A.locator("[data-to]").first()).toBeVisible();
  await expect(A.getByRole("progressbar", { name: "Loading" })).toBeHidden();
  // Choose Meera and tap Record straight away (within a second): it must go through.
  await A.locator("[data-to]").filter({ hasText: "Meera" }).click();
  await A.getByRole("button", { name: /^Record/ }).last().click();
  await A.waitForURL(/paid=1/);
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
  const exp = await db.expense.findFirstOrThrow({ where: { groupId: gid, name: "Lunch with bill" } });
  expect(await db.receipt.count({ where: { groupId: gid, expenseId: exp.id } })).toBe(1);
});

test("CB-6: a file that can't be read shows an error, and the import button can still be tapped after a good file", async ({ browser }) => {
  const asha = await signUp("Asha Rao", testEmail("b5-import"));
  const A = await (await contextFor(browser, asha)).newPage();
  await A.goto("/import");
  await settled(A);
  await A.getByLabel("Spreadsheet to import").setInputFiles({ name: "nonsense.csv", mimeType: "text/csv", buffer: Buffer.from("this is not an export\n") });
  await expect(A.getByRole("alert")).toBeVisible();
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
  await expect(A.locator('input[name="cover"]:checked')).toHaveCount(0);
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
  const search = A.getByLabel("Search people on Loopin");
  await search.fill("Meera");
  await expect(A.getByText("Search is busy. Try again in a minute.")).toBeVisible();
  busy = false;
  await search.fill("Meer");
  await search.fill("Meera");
  // The failure was not remembered: the busy line is gone (a real answer, empty or not, replaces it).
  await expect(A.getByText("Search is busy. Try again in a minute.")).toBeHidden();
});

async function ctxClose(page: import("@playwright/test").Page) {
  await page.context().close();
}
