// Small helpers that drive Loopin's real screens. Selectors come from the
// app's own labels and roles (see the components named in each comment).
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { appHost, bypassHeaders } from "../env";
import type { TestUser } from "./auth";
import { watchConsole } from "../fixtures";

// A browser profile for a signed-in test user (traced by Playwright as usual).
export async function contextFor(browser: Browser, user: TestUser): Promise<BrowserContext> {
  const ctx = await browser.newContext({ storageState: user.storageState });
  await allowTestCopy(ctx);
  return ctx;
}

// On the private Vercel test copy, every request to it carries the pass.
export async function allowTestCopy(ctx: BrowserContext) {
  watchConsole(ctx);
  if (!Object.keys(bypassHeaders).length) return;
  await ctx.route((u) => u.host === appHost, (r) => r.continue({ headers: { ...r.request().headers(), ...bypassHeaders } }));
}

// Wait until a page's buttons work (tapping before the page "comes alive" does nothing).
export async function settled(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
}

// New group (src/components/NewGroupForm.tsx) → lands on "Add people".
// Returns the group's address and its invite link.
export async function createGroup(page: Page, name: string, type: "Trip" | "Home" | "Anything Goes" | "The Pot" = "Trip"): Promise<{ path: string; invite: string }> {
  await page.goto("/groups/new");
  await settled(page);
  await page.getByRole("button", { name: new RegExp(`^${type}`) }).click();
  await page.locator('input[name="groupName"]').fill(name);
  await page.locator('select[name="currency"]').selectOption("INR");
  await page.getByRole("button", { name: /Create group/ }).click();
  await page.waitForURL(/\/invite\?new=1/);
  const path = new URL(page.url()).pathname.replace(/\/invite$/, "");
  const m = /\/join\/([A-Za-z0-9_-]+)/.exec(await page.content());
  expect(m, "the new group's invite link is on the Add people screen").toBeTruthy();
  return { path, invite: `/join/${m![1]}` };
}

// A signed-in person opens the invite link and taps Join (src/app/join/[code]/page.tsx).
export async function joinGroup(page: Page, invite: string, groupPath: string) {
  await page.goto(invite);
  await settled(page);
  await page.getByRole("button", { name: /^Join / }).click();
  await page.waitForURL(new RegExp(`${groupPath}$`));
}

// Add an expense, paid by the person adding it, split "Everyone equally"
// (src/components/AddExpenseForm.tsx).
export async function addEqualExpense(page: Page, groupPath: string, name: string, amount: string) {
  await page.goto(`${groupPath}/add`);
  await settled(page);
  await page.locator("#expense-name").fill(name);
  await page.getByLabel("Amount", { exact: true }).fill(amount);
  await page.getByRole("button", { name: "Everyone equally" }).click();
  await page.getByRole("button", { name: "Save expense" }).click();
  await afterSave(page);
}

// "Looks like a duplicate?" isn't what these tests are about: say it's a different one.
async function afterSave(page: Page) {
  const dup = page.getByRole("button", { name: "It’s a different one" });
  const done = await Promise.race([
    page.waitForURL(/tab=activity/).then(() => "saved"),
    dup.waitFor().then(() => "dup"),
  ]);
  if (done === "dup") {
    await dup.click();
    await page.waitForURL(/tab=activity/);
  }
}

// Open an expense's edit screen from Activity (Activity row → "Edit or delete").
export async function openEdit(page: Page, groupPath: string, name: string) {
  await page.goto(`${groupPath}?tab=activity&q=${encodeURIComponent(name)}`);
  await settled(page);
  await page.locator("details summary").filter({ hasText: name }).first().click();
  const href = await page.getByRole("link", { name: "Edit or delete" }).first().getAttribute("href");
  expect(href, `an Edit link for “${name}”`).toBeTruthy();
  await page.goto(href!);
  await settled(page);
}

// Balances tab → "By person": each row says "gets ₹X", "owes ₹X" or "settled"
// (src/app/groups/[id]/_components/BalancesTab.tsx). Returns paise per name.
export async function readBalances(page: Page, groupPath: string): Promise<Record<string, number>> {
  await page.goto(`${groupPath}?tab=balances`);
  await settled(page);
  const rows = page.locator("details.group\\/person > summary");
  await expect(rows.first()).toBeVisible();
  const out: Record<string, number> = {};
  for (const row of await rows.all()) {
    const name = (await row.locator(".font-medium").first().innerText()).replace(/ \(you\)$/, "").trim();
    const text = (await row.locator("span.font-display").last().innerText()).replace(/\s+/g, " ");
    const amount = toPaise(/[\d,]+(\.\d+)?/.exec(text)?.[0] ?? "0"); // "gets ₹600" or "owes EUR 15"
    out[name] = text.startsWith("gets") ? amount : text.startsWith("owes") ? -amount : 0;
  }
  return out;
}

export function toPaise(rupees: string): number {
  const n = rupees.replace(/[^\d.]/g, "");
  return Math.round(parseFloat(n || "0") * 100);
}

// The newest email to a test address (invites). Its link is returned without
// the site part, so it opens on whichever copy is being tested.
export async function emailedLink(to: string, since: Date): Promise<string> {
  const { db } = await import("./db");
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const row = await db.outbox.findFirst({ where: { to, createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
    const link = row ? /https?:\/\/\S+\/join\/\S+/.exec(row.text)?.[0] : undefined;
    if (link) {
      const u = new URL(link);
      return u.pathname + u.search;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`No invite email with a join link reached ${to}.`);
}

// The group's name as shown at the top of its screen (GroupHeader's h1).
export async function shownGroupName(page: Page, groupPath: string): Promise<string> {
  await page.goto(groupPath);
  await settled(page);
  return (await page.getByRole("heading", { level: 1 }).first().innerText()).trim();
}
