import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { contextFor, createGroup, joinGroup, settled } from "../helpers/app";
import { db } from "../helpers/db";

// The Pot (card nights), the brief's example: Asha (host) and Ravi on Loopin,
// Chirag and Dev just names. Takes, put-backs, a ₹100 slip caught and fixed,
// finish → A +600, B −300, C −200, D −100, three payments; Ravi pays and it shows.
test("a Teen Patti game from first take to settled", async ({ browser }) => {
  const asha = await signUp("Asha", testEmail("pot-asha"));
  const ravi = await signUp("Ravi", testEmail("pot-ravi"));
  const A = await (await contextFor(browser, asha)).newPage();
  const R = await (await contextFor(browser, ravi)).newPage();

  const g = await createGroup(A, groupName("Diwali cards"), "The Pot");
  await joinGroup(R, g.invite, g.path);
  const groupId = g.path.split("/").pop()!;
  for (const name of ["Chirag", "Dev"]) await db.member.create({ data: { groupId, name } });

  // The group opens on its games, with what The Pot does.
  await A.goto(g.path);
  await settled(A);
  await expect(A.getByText(/Take money from the pot to play, put back what’s left/)).toBeVisible();
  await A.getByRole("link", { name: /Start a game/ }).click();
  await settled(A);
  await expect(A.locator('input[name="game"][value="teenpatti"]')).toBeChecked(); // Teen Patti first
  await A.locator('input[name="name"]').fill("Diwali night");
  await A.getByRole("button", { name: "Start the game" }).click();
  await A.waitForURL(/\/pot\/[^/?]+\?started=1/);
  const game = new URL(A.url()).pathname;

  const record = async (page: Page, who: string, kind: "take" | "return", amount: string) => {
    const form = page.getByRole("form", { name: "Record money" });
    await form.getByRole("radio", { name: kind === "take" ? "Take from the pot" : "Put back" }).click();
    await form.locator('select[name="memberId"]').selectOption({ label: who });
    await form.getByLabel("Amount").fill(amount);
    await form.getByRole("button", { name: kind === "take" ? "Take from the pot" : "Put back" }).last().click();
    await page.waitForURL(/saved=/);
    await settled(page);
  };
  await record(A, "Asha (you)", "take", "1000");
  await record(A, "Ravi", "take", "2000");
  await record(A, "Chirag", "take", "500");
  await record(A, "Dev", "take", "1000");
  await record(A, "Dev", "take", "500"); // a second buy-in
  await expect(A.locator("[data-pot-taken]")).toHaveText("₹5,000");
  await expect(A.locator("[data-player='Dev']")).toContainText("took ₹1,500 (2×)");

  // Ravi records his own put-back from his phone.
  await R.goto(game);
  await settled(R);
  await record(R, "Ravi (you)", "return", "1700");

  await A.goto(game);
  await settled(A);
  await record(A, "Asha (you)", "return", "1600");
  await record(A, "Chirag", "return", "300");
  await record(A, "Dev", "return", "1300"); // a slip: Dev really put back ₹1,400

  // ₹100 short: flagged, and the game won't finish.
  await expect(A.locator("[data-pot-gap]")).toContainText("₹100 is missing from the pot");
  await A.getByRole("button", { name: /Finish/ }).click();
  await expect(A.getByText(/₹100 is still missing from the pot/)).toBeVisible();

  // Fix the slip: take Dev's line off and put the right amount.
  await A.getByRole("region", { name: "History" }).getByRole("listitem").filter({ hasText: "Dev put back ₹1,300" }).getByRole("button", { name: "Take it off" }).click();
  await A.waitForURL(/removed=1/);
  await settled(A);
  await record(A, "Dev", "return", "1400");
  await expect(A.locator("[data-pot-gap]")).toHaveCount(0);

  await A.getByRole("button", { name: /Finish the game/ }).click();
  await A.waitForURL(/finished=1/);
  await settled(A);
  const net = async (name: string) => Number(await A.locator(`[data-player='${name}']`).getAttribute("data-net"));
  expect([await net("Asha"), await net("Ravi"), await net("Chirag"), await net("Dev")]).toEqual([60000, -30000, -20000, -10000]);
  const pays = A.getByRole("region", { name: "Who pays whom" });
  await expect(pays.locator("[data-transfer]")).toHaveCount(3);
  await expect(pays).toContainText("Ravi pays You");
  await expect(pays).toContainText("₹300");
  await expect(A.locator("[data-still-owed]")).toHaveAttribute("data-still-owed", "60000");

  // Ravi sees it in the group: lost ₹300, and pays Asha in Settle up.
  await R.goto(`${g.path}?tab=games`);
  await settled(R);
  await expect(R.locator("[data-game='done']")).toContainText("you lost");
  await R.goto(`${g.path}/settle`);
  await settled(R);
  await R.locator("form").filter({ has: R.getByLabel(/^Amount (You|Ravi) paid Asha$/) }).getByRole("button", { name: "Mark paid" }).click();
  await R.waitForURL(/settle|tab=/);
  await R.goto(game);
  await settled(R);
  await expect(R.getByRole("region", { name: "Who pays whom" }).locator("[data-transfer='paid']")).toContainText("You pay Asha");
  await expect(R.locator("[data-still-owed]")).toHaveAttribute("data-still-owed", "30000");

  // Only the host finishes or reopens: Ravi doesn't get those buttons.
  await expect(R.getByRole("button", { name: "Reopen game" })).toHaveCount(0);
  await A.context().close();
  await R.context().close();
});
