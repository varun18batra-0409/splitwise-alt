// Speed as a phone sees it: a mid-range Android (4× slower processor) on
// ordinary 4G (100 ms round trips, 5 Mbps down). For each main screen: how long
// a cold open takes, how much script it downloads, and how long the common
// taps take (opening a group, searching people, saving an expense).
// Needs the app running on :3000 and .demo.json. Writes screenshots/uat/perf.md.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { SESSION_COOKIE, encodeSession } from "../src/lib/session";

const base = process.env.APP_URL ?? "http://localhost:3000";
const demo = JSON.parse(readFileSync(".demo.json", "utf8"));
const out = "screenshots/uat";
mkdirSync(out, { recursive: true });

type Row = { what: string; ms: number; js?: number; requests?: number; note?: string };
const rows: Row[] = [];

async function phone(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 100, downloadThroughput: (5 * 1024 * 1024) / 8, uploadThroughput: (2 * 1024 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
}

// Script bytes and request count for everything the page fetches.
function meter(page: Page) {
  let js = 0;
  let requests = 0;
  const onResponse = async (r: import("playwright").Response) => {
    requests++;
    const type = r.request().resourceType();
    if (type === "script") {
      const len = Number(r.headers()["content-length"] ?? 0);
      js += len || (await r.body().catch(() => Buffer.alloc(0))).length;
    }
  };
  page.on("response", onResponse);
  return () => {
    page.off("response", onResponse);
    return { js, requests };
  };
}

// A first visit: a new tab with nothing cached yet.
async function cold(browser: import("playwright").Browser, cookies: Parameters<import("playwright").BrowserContext["addCookies"]>[0], what: string, path: string, ready: (p: Page) => Promise<unknown>) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-IN", timezoneId: "Asia/Kolkata", colorScheme: "dark" });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  await phone(page);
  const stop = meter(page);
  const t = Date.now();
  try {
    await page.goto(base + path, { waitUntil: "commit" });
    await ready(page);
    const ms = Date.now() - t;
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const m = stop();
    rows.push({ what: `Open ${what} (first visit)`, ms, js: m.js, requests: m.requests });
  } catch (e) {
    rows.push({ what: `Open ${what} (first visit)`, ms: -1, note: `failed: ${String(e).split("\n")[0].slice(0, 120)}` });
  }
  await ctx.close();
}

async function timed(what: string, fn: () => Promise<unknown>, note = "") {
  const t = Date.now();
  try {
    await fn();
    rows.push({ what, ms: Date.now() - t, note });
  } catch (e) {
    rows.push({ what, ms: -1, note: `failed: ${String(e).split("\n")[0].slice(0, 120)}` });
  }
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-IN", timezoneId: "Asia/Kolkata", colorScheme: "dark" });
  const cookies = [
    { name: SESSION_COOKIE, value: await encodeSession({ m: demo.memberships }), url: base },
    { name: "lp_tour", value: "1", url: base },
  ];
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  // Warm the server once (a real server stays warm while people use it).
  for (const p of ["/", `/groups/${demo.trip.id}`, `/groups/${demo.flat.id}`]) await page.goto(base + p);
  await phone(page);

  const g = `/groups/${demo.trip.id}`;
  const f = `/groups/${demo.flat.id}`;
  const main = (p: Page) => p.locator("main").first().waitFor();
  await cold(browser, cookies, "home", "/", (p) => p.getByText(/Groups|Needs attention/).first().waitFor());
  await cold(browser, cookies, "a trip group (Activity)", `${g}?tab=activity`, main);
  await cold(browser, cookies, "a trip group (Balances)", `${g}?tab=balances`, main);
  await cold(browser, cookies, "a flat (This month)", f, (p) => p.getByText(/your share/i).first().waitFor());
  await cold(browser, cookies, "Add expense", `${g}/add`, (p) => p.locator("#expense-name").waitFor());
  await cold(browser, cookies, "Add people", `${g}/invite`, (p) => p.getByLabel("Search people on Loopin").waitFor());
  await cold(browser, cookies, "Settle up", "/settle", main);
  await cold(browser, cookies, "Search", "/search", main);
  await cold(browser, cookies, "Sign in", "/signin", (p) => p.locator('input[name="email"]').waitFor());

  // Taps inside the app (no full reload).
  await page.goto(base + "/");
  await page.getByText(/Groups|Needs attention/).first().waitFor();
  await timed("Tap a group on Home → its screen shows", async () => {
    await page.locator(`a[href^="/groups/${demo.trip.id}"]`).first().click();
    await page.waitForURL(new RegExp(demo.trip.id));
    await page.locator("nav[aria-label='Group sections']").waitFor();
  });
  await timed("Tap Balances tab → shown", async () => {
    await page.getByRole("link", { name: "Balances", exact: true }).click();
    await page.waitForURL(/tab=balances/);
    await page.locator("details.group\\/person").first().waitFor();
  });
  await page.goto(base + g);
  await page.locator("nav[aria-label='Group sections']").waitFor();
  await timed("Tap the + (add expense) → form ready", async () => {
    await page.locator(`a[href="${g}/add"]`).first().click();
    await page.locator("#expense-name").waitFor();
  });
  await timed("Type an expense and Save → back on the group", async () => {
    await page.locator("#expense-name").fill("Perf check coffee");
    await page.getByLabel("Amount", { exact: true }).fill("240");
    await page.getByRole("button", { name: "Save expense" }).click();
    await page.waitForURL(/tab=activity/);
    await page.getByText("Perf check coffee").first().waitFor();
  });
  await page.goto(base + `${g}/invite`);
  await page.getByLabel("Search people on Loopin").waitFor();
  await timed("People search: type “as” → answer back", async () => {
    const answer = page.waitForResponse((r) => r.url().includes("/api/people") && r.url().includes("q=as"));
    await page.getByLabel("Search people on Loopin").pressSequentially("as", { delay: 120 });
    await answer;
  });
  await timed("People search: type 3 more letters → answer back", async () => {
    const answer = page.waitForResponse((r) => r.url().includes("/api/people") && r.url().includes("q=asha"));
    await page.getByLabel("Search people on Loopin").pressSequentially("ha", { delay: 120 });
    await answer;
  });

  await browser.close();

  const kb = (n?: number) => (n === undefined ? "" : `${Math.round(n / 1024)} KB`);
  const lines = [
    "# Speed on a phone (mid-range Android, 4G)",
    "",
    "| What | Time | Script downloaded | Requests | Note |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.what} | ${r.ms < 0 ? "—" : `${(r.ms / 1000).toFixed(2)} s`} | ${kb(r.js)} | ${r.requests ?? ""} | ${r.note ?? ""} |`),
  ];
  writeFileSync(`${out}/perf.md`, lines.join("\n"));
  console.log(lines.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(0);
});
