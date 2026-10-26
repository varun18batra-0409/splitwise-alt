import { test, expect } from "../fixtures";
import type { Page } from "@playwright/test";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// The Pot (card nights), the brief's example: Asha (host) and Ravi on Loopin,
// Chirag and Dev just names. Buy-in for everyone, top-ups, a cash-out with Neha
// taking the seat, a count table with a ₹100 slip caught and fixed, then
// Calculate & settle → A +600, R −300, C −200, D −100, N 0; Ravi pays and it shows.
test("a Teen Patti game from first take to settled", async ({ browser }) => {
  const asha = await signUp("Asha", testEmail("pot-asha"));
  const ravi = await signUp("Ravi", testEmail("pot-ravi"));
  const A = await (await contextFor(browser, asha)).newPage();
  const R = await (await contextFor(browser, ravi)).newPage();

  const g = await createGroup(A, groupName("Diwali cards"), "The Pot");
  await joinGroup(R, g.invite, g.path);

  // The group opens on its games, with what The Pot does.
  await A.goto(g.path);
  await settled(A);
  await expect(A.getByText(/Take money from the pot to play, put back what’s left/)).toBeVisible();
  await A.getByRole("link", { name: /Start a game/ }).click();
  await settled(A);
  await expect(A.locator('input[name="game"][value="teenpatti"]')).toBeChecked(); // Teen Patti first
  await A.locator('input[name="name"]').fill("Diwali night");
  // Chirag and Dev aren't on Loopin: just their names.
  await A.locator('input[name="newNames"]').fill("Chirag, Deev"); // a typo, fixed below
  await A.getByRole("button", { name: "Start the game" }).click();
  await A.waitForURL(/\/pot\/[^/?]+\?started=1/);
  const game = new URL(A.url()).pathname;
  await settled(A);

  // A spelling slip: tap the name, fix it. (Ravi joined Loopin, so his name isn't editable here.)
  await A.getByRole("button", { name: "Deev: fix the name" }).click();
  await A.getByRole("form", { name: "Fix Deev's name" }).getByLabel("Name").fill("Dev");
  await A.getByRole("form", { name: "Fix Deev's name" }).getByRole("button", { name: "Save" }).click();
  await A.waitForURL(/renamed=1/);
  await settled(A);
  await expect(A.locator("[data-player='Dev']")).toHaveCount(1);
  await expect(A.getByRole("button", { name: "Ravi: fix the name" })).toHaveCount(0);

  // Buy-in: everyone ticked at the start; later, tick just who's topping up.
  const buyIn = async (page: Page, who: "everyone" | string[], amount: string, total: string) => {
    const form = page.getByRole("form", { name: "Buy in" });
    if (who === "everyone") await form.getByRole("button", { name: "Everyone", exact: true }).click();
    else {
      await form.getByRole("button", { name: "Clear", exact: true }).click();
      for (const n of who) await form.locator("label").filter({ hasText: new RegExp(`^${n}`) }).click();
    }
    await form.getByLabel("Amount each").fill(amount);
    await form.locator('button[type="submit"]').click();
    await page.waitForURL(/bought=/);
    await expect(page.locator("[data-pot-taken]")).toHaveText(total);
    await settled(page);
  };
  await expect(A.getByRole("form", { name: "Buy in" }).locator('input[name="memberIds"]:checked')).toHaveCount(4); // all four, ready to go
  await A.getByRole("form", { name: "Buy in" }).getByLabel("Amount each").fill("500");
  await expect(A.getByRole("form", { name: "Buy in" }).locator('button[type="submit"]')).toHaveText("Give ₹500 to 4 players · ₹2,000");
  await buyIn(A, "everyone", "500", "₹2,000");
  await buyIn(A, ["You", "Ravi", "Dev"], "500", "₹3,500"); // a top-up for three
  await buyIn(A, ["Ravi"], "1000", "₹4,500");
  await buyIn(A, ["Dev"], "500", "₹5,000");
  await expect(A.locator("[data-player='Dev']")).toContainText("took ₹1,500 (3×)");

  // Chirag leaves with ₹300; Neha (just a name) takes his seat with ₹500.
  const chirag = A.locator("[data-player='Chirag']");
  await chirag.locator("summary").click();
  await chirag.getByLabel("Leaves with").fill("300");
  await chirag.getByLabel("New player in the seat").fill("Neha");
  await chirag.getByLabel("New player's buy-in").fill("500");
  await chirag.getByRole("button", { name: "Cash out", exact: true }).click();
  await A.waitForURL(/cashed=1/);
  await expect(A.locator("[data-pot-taken]")).toHaveText("₹5,500");
  await expect(A.locator("[data-player='Neha']")).toHaveAttribute("data-playing", "1");
  await expect(A.locator("[data-player='Chirag']")).toHaveAttribute("data-net", "-20000");
  await settled(A);

  // The end: Ravi counts his own from his phone (he isn't the host: it's saved).
  await R.goto(game);
  await settled(R);
  const rc = R.getByRole("form", { name: "Count the money" });
  await rc.getByLabel("You have").fill("1700");
  await rc.getByRole("button", { name: "Save the count" }).click();
  await R.waitForURL(/counted=1/);
  await expect(R.locator("[data-player='Ravi']")).toHaveAttribute("data-net", "-30000");

  // Asha counts the rest in one table: a slip (Dev really has ₹1,400), and it says so before saving.
  await A.goto(game);
  await settled(A);
  const count = A.getByRole("form", { name: "Count the money" });
  await expect(count.locator("[data-count-row]")).toHaveCount(3); // Ravi's done; Asha, Dev, Neha left
  await count.getByLabel("You have").fill("1600");
  await count.getByLabel("Dev has").fill("1300");
  await count.getByLabel("Neha has").fill("500");
  await expect(count.locator("[data-count-check]")).toHaveAttribute("data-count-check", "-10000");
  await expect(count.getByRole("status")).toContainText("₹100 short");
  await count.getByRole("button", { name: /Calculate & settle/ }).click();
  await A.waitForURL(/gap=1/);
  await settled(A);
  await expect(A.locator("[data-pot-gap]")).toContainText("₹100 is missing from the pot");

  // Fix the slip: take Dev's count off and count him again.
  await A.getByRole("region", { name: "History" }).getByRole("listitem").filter({ hasText: "Dev ended with ₹1,300" }).getByRole("button", { name: "Take it off" }).click();
  await A.waitForURL(/removed=1/);
  await settled(A);
  await A.getByRole("form", { name: "Count the money" }).getByLabel("Dev has").fill("1400");
  await expect(A.getByRole("form", { name: "Count the money" }).getByRole("status")).toContainText("Adds up");
  await A.getByRole("form", { name: "Count the money" }).getByRole("button", { name: /Calculate & settle/ }).click();
  await A.waitForURL(/finished=1/);
  await settled(A);
  const net = async (name: string) => Number(await A.locator(`[data-player='${name}']`).getAttribute("data-net"));
  const nets = { Asha: await net("Asha"), Ravi: await net("Ravi"), Chirag: await net("Chirag"), Dev: await net("Dev"), Neha: await net("Neha") };
  expect(nets, `nets were ${JSON.stringify(nets)}`).toEqual({ Asha: 60000, Ravi: -30000, Chirag: -20000, Dev: -10000, Neha: 0 });
  const pays = A.getByRole("region", { name: "Who pays whom" });
  await expect(pays.locator("[data-transfer]")).toHaveCount(3);
  await expect(pays).toContainText("Ravi pays you");
  await expect(pays).toContainText("₹300");
  await expect(A.locator("[data-still-owed]")).toHaveAttribute("data-still-owed", "60000");

  // Dev hands Asha ₹100 at the table: she marks it paid right on the game, and stays there.
  await pays.getByRole("button", { name: "Mark paid: Dev pays you" }).click();
  await A.waitForURL(/\/pot\/[^/?]+\?paid=1/);
  await settled(A);
  await expect(A.getByRole("region", { name: "Who pays whom" }).locator("[data-transfer='paid']").filter({ hasText: "Dev pays you" })).toHaveCount(1);
  await expect(A.locator("[data-still-owed]")).toHaveAttribute("data-still-owed", "50000");

  // Ravi sees it in the group: lost ₹300, and pays Asha in Settle up.
  await R.goto(`${g.path}?tab=games`);
  await settled(R);
  await expect(R.locator("[data-game='done']")).toContainText("you lost");
  await R.goto(`${g.path}/settle`);
  await settled(R);
  await R.locator("form").filter({ has: R.getByLabel(/^Amount (You|Ravi) paid Asha$/) }).getByRole("button", { name: "Mark paid" }).click();
  await R.waitForURL(/paid=1/); // (the settle page is already open: wait for the payment itself)
  await R.goto(game);
  await settled(R);
  await expect(R.getByRole("region", { name: "Who pays whom" }).locator("[data-transfer='paid']").filter({ hasText: "You pay Asha" })).toHaveCount(1);
  await expect(R.locator("[data-still-owed]")).toHaveAttribute("data-still-owed", "20000");

  // Only the host finishes or reopens: Ravi doesn't get those buttons.
  await expect(R.getByRole("button", { name: "Reopen game" })).toHaveCount(0);
  await A.context().close();
  await R.context().close();
});
