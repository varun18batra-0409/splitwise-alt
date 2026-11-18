import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// Follow-ups batch 5. Written against the app's own labels; not run where it was written (no browser or test copy there),
// so the first run on the test copy is the real check.

test("SA-8: a postcard the server refuses keeps what was written (no blank composer)", async ({ browser }) => {
  test.setTimeout(120_000);
  const asha = await signUp("Asha", testEmail("fu-pc-asha"));
  const ravi = await signUp("Ravi", testEmail("fu-pc-ravi"));
  const A = await (await contextFor(browser, asha)).newPage();
  const R = await (await contextFor(browser, ravi)).newPage();
  const g = await createGroup(A, groupName("FU postcard"), "Trip");
  await joinGroup(R, g.invite, g.path);

  await A.goto(`/postcards/new?group=${g.path.split("/").pop()}`);
  await settled(A);
  await A.getByRole("tab", { name: "Note" }).click();
  await A.getByRole("textbox", { name: "Your message" }).fill("Hello from Goa");
  await A.getByRole("tab", { name: "Send" }).click();
  await A.locator("[data-recipient='Ravi']").click();
  // Force the refusal: the front says "own photo", and the photo is not a photo.
  await A.evaluate(() => {
    const form = document.querySelector("form")!;
    (form.querySelector("input[name=front]") as HTMLInputElement).value = "own";
    const bad = document.createElement("input");
    bad.type = "hidden";
    bad.name = "photo";
    bad.value = btoa("not a photo at all");
    form.appendChild(bad);
  });
  const here = new URL(A.url()).pathname;
  await A.getByRole("button", { name: "Send to 1 person" }).click();
  await expect(A.getByText("That photo didn’t work. Try another one.")).toBeVisible();
  // Still the same page, still on the same card: the person is still ticked and the words are still there.
  expect(new URL(A.url()).pathname).toBe(here);
  await expect(A.locator("[data-recipient='Ravi']")).toHaveAttribute("aria-pressed", "true");
  await A.getByRole("tab", { name: "Note" }).click();
  await expect(A.getByRole("textbox", { name: "Your message" })).toHaveValue("Hello from Goa");
  await A.context().close();
  await R.context().close();
});
