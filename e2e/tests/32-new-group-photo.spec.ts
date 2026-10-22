import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { contextFor, settled } from "../helpers/app";

// "Your photo" while making a group: picked before the group exists, shown in
// the picker straight away, and saved as the group's picture when it's made.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

test("a photo picked on New group becomes the group's picture", async ({ browser }) => {
  const user = await signUp("Isha", testEmail("newphoto"));
  const ctx = await contextFor(browser, user);
  const page = await ctx.newPage();

  await page.goto("/groups/new");
  await settled(page);
  await page.getByRole("button", { name: /^Trip/ }).click();
  await page.locator('input[name="groupName"]').fill(groupName("Photo trip"));
  await page.getByLabel("Choose your own photo").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("status").filter({ hasText: "Added" })).toBeVisible();
  // It's now the chosen picture.
  await expect(page.locator('input[name="cover"][value="own"]')).toBeChecked();
  await page.getByRole("button", { name: /Create group/ }).click();
  await page.waitForURL(/\/invite\?new=1/);
  const id = new URL(page.url()).pathname.split("/")[2];

  // The group's photo is there, for people in the group.
  const res = await page.request.get(`/api/group-photo/${id}`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/^image\/(webp|jpeg|png)$/);
  await ctx.close();
});
