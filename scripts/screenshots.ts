// Takes phone-sized screenshots of every screen (used by the GitHub check so
// the design can be reviewed). Needs the app running on :3000 and .demo.json.
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

const base = process.env.APP_URL ?? "http://localhost:3000";
const demo = JSON.parse(readFileSync(".demo.json", "utf8"));
const out = "screenshots";
mkdirSync(out, { recursive: true });

async function main() {
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
  locale: "en-IN",
  timezoneId: "Asia/Kolkata",
});
await context.addCookies([
  { name: "sw_me", value: encodeURIComponent(JSON.stringify(demo.memberships)), url: base },
]);
const page = await context.newPage();

async function shot(name: string, path: string, prepare?: (p: Page) => Promise<void>, fullPage = true) {
  try {
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(900); // let the bar animation finish
    if (prepare) await prepare(page).catch((e) => console.log("  (could not prepare", name, String(e).split("\n")[0], ")"));
    await page.screenshot({ path: `${out}/${name}.png`, fullPage });
    console.log("✓", name);
  } catch (e) {
    console.log("✗", name, String(e).split("\n")[0]);
  }
}

const g = `/groups/${demo.trip.id}`;
await shot("01-home", "/");
await shot("02-group-activity", `${g}?tab=activity`);
await shot("03-group-activity-expanded", `${g}?tab=activity`, async (p) => {
  await p.locator("details summary").nth(1).click();
  await p.waitForTimeout(300);
});
await shot("04-group-balances", `${g}?tab=balances`);
await shot("05-group-balances-person", `${g}?tab=balances`, async (p) => {
  await p.locator("details.group\\/person summary").first().click();
  await p.waitForTimeout(300);
});
await shot("06-group-charts", `${g}?tab=charts`);
await shot("07-group-switcher", g, async (p) => {
  await p.locator("details.group\\/switch summary").click();
  await p.waitForTimeout(300);
}, false);
await shot("08-invite", `${g}/invite`, async (p) => {
  await p.locator("details.group\\/qr summary").click();
  await p.waitForTimeout(300);
});
await shot("09-add-expense", `${g}/add`, undefined, false);
await shot("10-add-expense-typo-foreign", `${g}/add`, async (p) => {
  await p.locator("#expense-name").fill("Dinnr at the night market");
  await p.getByLabel("Amount", { exact: true }).fill("1800");
  await p.getByRole("button", { name: /Currency:/ }).click();
  await p.getByLabel("Search currencies").fill("baht");
  await p.getByRole("button", { name: /THB/ }).first().click();
  await p.waitForTimeout(2500); // live rate
});
await shot("11-edit-expense", `${g}/expenses/${demo.trip.expenseId}/edit`);
await shot("12-record-payment", `${g}/pay`);
await shot("13-settings", `${g}/settings`);
await shot("14-notifications", "/notifications");
await shot("17-people", `${g}/people`, async (p) => {
  await p.locator("details.group\\/p summary").nth(2).click();
  await p.waitForTimeout(300);
});
await shot("18-search", `${g}?tab=activity&q=dinner`);
await shot("19-filter-person", `${g}?tab=activity&cat=food&who=${demo.trip.ravi}`);
await shot("20-search", "/search?m=2026-10");
await shot("21-search-group", `/search?g=${demo.trip.id}&q=dinner`);
await shot("22-settle-everything", `${g}?tab=balances`, async (p) => {
  await p.locator("details.group\\/kill summary").click();
  await p.waitForTimeout(300);
  await p.locator("details.group\\/kill").scrollIntoViewIfNeeded();
}, false);
await shot("23-add-expense-differently", `${g}/add`, async (p) => {
  await p.getByRole("button", { name: /Custom/ }).click();
  await p.getByRole("button", { name: /Add notes/ }).click();
  await p.getByRole("button", { name: /Change/ }).first().click();
  await p.waitForTimeout(300);
});
await shot("28-settle", "/settle");
await shot("35-how-it-works", "/how-it-works");
await shot("32-group-settle", `${g}/settle`);
await shot("29-why", `${g}?tab=balances&why=${demo.trip.me}#why-${demo.trip.me}`);
await shot("30-add-only-some", `${g}/add`, async (p) => {
  await p.getByRole("button", { name: /Only some/ }).click();
  await p.getByRole("button", { name: /Ravi/ }).last().click();
  await p.waitForTimeout(300);
}, false);
await shot("31-currency-details", `${g}/add`, async (p) => {
  await p.locator("#expense-name").fill("Night market dinner");
  await p.getByLabel("Amount", { exact: true }).fill("1800");
  await p.getByRole("button", { name: /Currency:/ }).click();
  await p.getByLabel("Search currencies").fill("baht");
  await p.getByRole("button", { name: /THB/ }).first().click();
  await p.waitForTimeout(2500);
  await p.getByRole("button", { name: /Details/ }).click();
  await p.waitForTimeout(300);
});
await shot("15-new-group", "/groups/new");
await shot("25-account", "/account");
await shot("26-signin", "/signin", undefined, false);
await shot("27-privacy", "/privacy");
await context.clearCookies();
await shot("16-join", `/join/${demo.trip.invite}`);
await shot("24-tour-1", "/", undefined, false);
for (const n of [2, 3, 4, 5]) {
  await shot(`24-tour-${n}`, "/", async (p) => {
    for (let k = 1; k < n; k++) {
      await p.getByRole("button", { name: /Next/ }).click();
      await p.waitForTimeout(450);
    }
    await p.waitForTimeout(900);
  }, false);
}

await context.addCookies([{ name: "lp_tour", value: "1", url: base }]);
await shot("33-start", "/");
await shot("34-signup", "/signin?mode=signup", undefined, false);
await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
