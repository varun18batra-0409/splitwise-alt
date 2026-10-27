import { test, expect } from "../fixtures";
import type { Locator } from "@playwright/test";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { addEqualExpense, allowTestCopy, createGroup, settled } from "../helpers/app";

// A finger drag, as the phone sends it: touchstart, a few touchmoves, touchend (Chrome builds real Touch objects).
async function drag(target: Locator, from: "right" | "top", dx: number, dy: number) {
  const box = (await target.boundingBox())!;
  const x = from === "right" ? box.x + box.width - 30 : box.x + box.width / 2;
  const y = from === "right" ? box.y + box.height / 2 : box.y + 30;
  await target.evaluate(
    (el, p) => {
      const touch = (cx: number, cy: number) => new Touch({ identifier: 1, target: el, clientX: cx, clientY: cy });
      const fire = (type: string, cx: number, cy: number) =>
        el.dispatchEvent(
          new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [touch(cx, cy)], changedTouches: [touch(cx, cy)] }),
        );
      fire("touchstart", p.x, p.y);
      for (let i = 1; i <= 10; i++) fire("touchmove", p.x + (p.dx * i) / 10, p.y + (p.dy * i) / 10);
      fire("touchend", p.x + p.dx, p.y + p.dy);
    },
    { x, y, dx, dy },
  );
}

// Swipe an expense to delete it, drag a sheet down to close it, and confetti when a group is all square.
test("Gestures: swipe to delete an expense, drag a sheet closed, confetti on all square", async ({ browser, browserName }) => {
  test.skip(browserName !== "chromium", "Touch drags are built with Chrome's Touch objects (checked on Android).");
  test.setTimeout(120_000);
  const asha = await signUp("Asha", testEmail("swipe-asha"));
  const ctx = await browser.newContext({ storageState: asha.storageState, hasTouch: true, isMobile: true, viewport: { width: 412, height: 839 } });
  await allowTestCopy(ctx);
  const A = await ctx.newPage();

  const g = await createGroup(A, groupName("Swipe test"), "Trip");
  await addEqualExpense(A, g.path, "Snacks", "300");

  // Only Asha in the group: nobody owes anybody, so Settle up says All square, with confetti (once per visit).
  await A.goto(`${g.path}/settle`);
  await settled(A);
  await expect(A.getByText("All square").first()).toBeVisible();
  await expect(A.locator("[data-confetti]")).toHaveCount(1);
  await expect(A.locator("[data-confetti]")).toHaveCount(0, { timeout: 6_000 });
  await A.reload();
  await settled(A);
  await A.waitForTimeout(500);
  await expect(A.locator("[data-confetti]")).toHaveCount(0);

  // Swipe the expense left: Edit and Delete show; the row's details don't open.
  await A.goto(`${g.path}?tab=activity`);
  await settled(A);
  const row = A.locator("li", { hasText: "Snacks" }).first();
  const summary = row.locator("summary").first();
  await drag(summary, "right", -170, 4);
  await expect(row.locator("[data-swipe-row='open']")).toHaveCount(1);
  await expect(row.locator("details")).not.toHaveAttribute("open", "");
  await expect(row.locator("[data-swipe-edit]")).toBeVisible();
  // A short swipe back closes it again.
  await drag(summary, "right", 160, 2);
  await expect(row.locator("[data-swipe-row='closed']")).toHaveCount(1);
  // A small sideways wobble while scrolling doesn't open it.
  await drag(summary, "right", -20, 60);
  await expect(row.locator("[data-swipe-row='closed']")).toHaveCount(1);

  await drag(summary, "right", -170, 0);
  await row.locator("[data-swipe-delete]").click();
  await A.waitForURL(/did=/);
  await expect(A.getByRole("button", { name: "Undo" }).first()).toBeVisible();
  await expect(A.locator("li", { hasText: "Snacks" }).first().locator("[data-swipe-row]")).toHaveCount(0); // deleted rows don't swipe

  // A sheet: drag it down from its top and it closes.
  await A.goto("/passport");
  await settled(A);
  await A.getByRole("button", { name: "+ Add countries" }).click();
  const sheet = A.getByRole("dialog", { name: "Add countries" });
  await expect(sheet).toBeVisible();
  // Dragging lower down (the list) scrolls the list instead of closing.
  await expect(sheet).toHaveAttribute("data-drag-close", "top");
  await drag(sheet, "top", 0, 260);
  await expect(sheet).toHaveCount(0);
  await ctx.close();
});
