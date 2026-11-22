import type { Browser, BrowserContext, Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { addEqualExpense, contextFor, createGroup, readBalances, settled } from "../helpers/app";
import { db } from "../helpers/db";

// Add expenses offline (version 1), end to end, on Android (Chrome) and iPhone (Safari's engine).
// Hand-worked money, 6 people (Varun, Asha, Ben, Chitra, Dev, Esha), 1 rupee = 100 paise:
//   Lunch 600 paid by Varun, split 6:   Varun +500.   (60000 - 10000 = +50000 paise)
//   Breakfast 900 added offline by Varun, split 6: +750.   (90000 - 15000 = +75000)
//   Taxi 300 added offline by Varun, split 6:      +250.   (30000 - 5000  = +25000)
//   Asha's own Breakfast 900 (added at 8:40), split 6: Varun owes 150: -150.   (-15000)
//   So Varun ends at 500 + 750 + 250 - 150 = +1350 = 135000 paise, and all six balances add up to 0.
// Two kinds of "no signal": the real one (the browser offline, with the service worker) and a faked one (the "is there a signal?" answer
// is refused), which works the same in both engines and does not need the service worker.

const EXPECTED_FAILURE = /Failed to load resource|net::ERR|Failed to fetch|NetworkError|Load failed|Beacon API cannot load|fetch failed|The Internet connection appears to be offline|network connection was lost|ERR_INTERNET_DISCONNECTED|aborted/i;
const PEOPLE = ["Asha", "Ben", "Chitra", "Dev", "Esha"];

async function setup(browser: Browser, tag: string, opts: { noWorker: boolean }) {
  const user = await signUp("Varun", testEmail(`offadd-${tag}`));
  const ctx = await contextFor(browser, user, { noWorker: opts.noWorker });
  const page = await ctx.newPage();
  const name = groupName("Goa trip");
  const trip = await createGroup(page, name, "Trip");
  const groupId = trip.path.split("/").pop()!;
  for (const [i, n] of PEOPLE.entries()) await db.member.create({ data: { groupId, name: n, createdAt: new Date(Date.now() + (i + 1) * 1000) } });
  await addEqualExpense(page, trip.path, "Lunch", "600");
  await page.goto(trip.path);
  await settled(page);
  await waitForCopy(page, groupId);
  return { user, ctx, page, trip, groupId, name };
}

// The phone has kept a copy of the group (it is written when the group page opens).
async function waitForCopy(page: Page, groupId: string) {
  await expect
    .poll(async () => (await idbRows(page, "snapshots")).some((r) => r.groupId === groupId), { timeout: 30_000, message: "the group's copy is on the phone" })
    .toBe(true);
}
const draftCount = async (page: Page) => (await idbRows(page, "drafts")).length;

// Reads one store of the phone's offline database from inside the page (opened the way the app opens it).
async function idbRows(page: Page, store: "snapshots" | "drafts" | "meta"): Promise<Record<string, unknown>[]> {
  return page.evaluate(
    (name) =>
      new Promise<Record<string, unknown>[]>((resolve, reject) => {
        const open = indexedDB.open("loopin-offline", 1);
        open.onupgradeneeded = () => {
          for (const n of ["snapshots", "drafts", "meta"]) if (!open.result.objectStoreNames.contains(n)) open.result.createObjectStore(n);
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction(name).objectStore(name).getAll();
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
      }),
    store,
  );
}

function watchErrors(page: Page) {
  const bad: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !EXPECTED_FAILURE.test(m.text())) bad.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => {
    if (!EXPECTED_FAILURE.test(e.message)) bad.push(`pageerror: ${e.message.slice(0, 200)}`);
  });
  return bad;
}

async function saveOnPhone(page: Page, what: string, amount: string) {
  await page.locator("#expense-name").fill(what);
  await page.getByLabel("Amount", { exact: true }).fill(amount);
  await page.getByRole("button", { name: "Save on this phone" }).click();
}

const net = async (page: Page) => (await page.locator("[data-net-balance]").first().innerText()).replace(/\s+/g, " ");

test("with the signal refused (faked), expenses are kept on the phone, then added after asking; Different, keep both; balances add up", async ({ browser }) => {
  test.setTimeout(300_000);
  const { ctx, page, trip, groupId, name } = await setup(browser, "fake", { noWorker: true });
  const bad = watchErrors(page);
  const lunchNet = await net(page);
  expect(lunchNet).toMatch(/500/); // Varun +500 (hand-worked above)
  await expect(page.locator("[data-offline-waiting-online]")).toHaveCount(0);

  // No signal: the offline Add screen, with the approved words.
  await page.route("**/api/ping", (r) => r.abort());
  await page.goto(`/offline-app?g=${groupId}&s=add`);
  await expect(page.locator("[data-offline-app]")).toBeVisible();
  await expect(page.locator("[data-offline-net]").first()).toHaveText("Offline");
  await expect(page.getByText("You’re offline. This saves on your phone for now.")).toBeVisible();
  await expect(page.getByText(`The people are the ones ${name} had when you were last online.`)).toBeVisible();
  await expect(page.getByText("When you’re back online, Loopin asks before adding it.")).toBeVisible();
  // Left out in version 1: scanning, speaking, typing a line, items.
  await expect(page.locator("[data-faster-entry]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Items" })).toHaveCount(0);
  await saveOnPhone(page, "Breakfast", "900");
  await page.waitForURL(new RegExp(`${trip.path}$`));
  await expect(page.locator("[data-offline-waiting-online]")).toContainText("1 expense waiting on this phone");
  await expect(page.locator("[data-draft-row]")).toHaveCount(1);
  await expect(page.locator("[data-draft-row]").first()).toContainText("On this phone");
  expect(await net(page), "a waiting expense is not added into the balance").toBe(lunchNet);

  await page.goto(`/offline-app?g=${groupId}&s=add`); // still no signal (faked)
  await saveOnPhone(page, "Taxi", "300");
  await page.waitForURL(new RegExp(`${trip.path}$`));
  expect(await draftCount(page)).toBe(2);

  // Asha already added Breakfast ₹900 at 8:40 this morning (India time).
  const asha = await db.member.findFirstOrThrow({ where: { groupId, name: "Asha" } });
  const today = new Date();
  const at840 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 3, 10)); // 03:10 UTC = 8:40 am in India
  const seeded = await db.expense.create({
    data: {
      groupId, description: "Breakfast", amount: 90000, splitType: "equal", forMode: "everyone", category: "food", originalAmount: 90000, originalCurrency: "INR", baseCurrency: "INR",
      exchangeRate: "1", rateSource: "same", convertedAmount: 90000, paidById: asha.id, createdById: asha.id, createdAt: at840, spentAt: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 12)),
    },
  });
  const members = await db.member.findMany({ where: { groupId } });
  expect(members).toHaveLength(6);
  await db.expenseShare.createMany({ data: members.map((m) => ({ expenseId: seeded.id, memberId: m.id, amount: 15000 })) }); // 90000 / 6

  // The offline group page, with the signal still refused.
  await page.goto(`/offline-app?g=${groupId}`);
  await expect(page.locator("[data-offline-net]").first()).toHaveText("Offline");
  await expect(page.locator("[data-as-of]")).toContainText("when you were last online");
  await expect(page.locator("[data-settle-disabled]")).toHaveText("Settle up when online");
  await expect(page.locator("[data-offline-waiting]")).toContainText("2 expenses waiting on this phone");
  await expect(page.getByText("They count once you’re back online and add them. The amount above doesn’t include them yet.")).toBeVisible();
  await expect(page.locator("[data-draft-row]")).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Recent expenses" })).toBeVisible();
  expect(await net(page)).toBe(lunchNet);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();

  // A second tab says "Not now": nothing is lost.
  const other = await ctx.newPage();
  await other.goto(trip.path);
  await expect(other.locator("[data-back-online]")).toBeVisible();
  await other.locator("[data-sheet-notnow]").click();
  await expect(other.locator("[data-back-online]")).toHaveCount(0);
  expect(await draftCount(other)).toBe(2);
  await other.close();

  // The signal comes back: this page goes to the group by itself, and the sheet opens with the duplicate question.
  await page.unroute("**/api/ping");
  await expect(page).toHaveURL(new RegExp(`${trip.path}$`), { timeout: 30_000 });
  await expect(page.locator("[data-offline-app]")).toHaveCount(0);
  const sheet = page.locator("[data-back-online]");
  await expect(sheet).toBeVisible();
  await expect(sheet.getByText("You’re back online")).toBeVisible();
  await expect(sheet.getByText(`You added 2 expenses while offline. Add them to ${name}?`)).toBeVisible();
  await expect(sheet.locator("[data-sheet-row]")).toHaveCount(2);
  const dup = sheet.locator("[data-sheet-duplicate]");
  await expect(dup).toHaveCount(1);
  await expect(dup).toContainText("Asha added Breakfast");
  await expect(dup).toContainText("at 8:40 am. Is it the same one?");
  await sheet.locator("[data-sheet-keep]").click();
  await expect(dup).toHaveCount(0);
  await sheet.getByRole("button", { name: `Add 2 to ${name}` }).click();
  await expect(sheet).toHaveCount(0, { timeout: 30_000 });

  // Each expense appears exactly once; the money is worked out by the server.
  await page.reload();
  await settled(page);
  await expect(page.locator("[data-offline-waiting-online]")).toHaveCount(0);
  expect(await draftCount(page)).toBe(0);
  const mine = await db.expense.findMany({ where: { groupId, description: { in: ["Breakfast", "Taxi"] } }, include: { shares: true }, orderBy: { createdAt: "asc" } });
  expect(mine.map((e) => e.description).sort()).toEqual(["Breakfast", "Breakfast", "Taxi"]);
  const taxi = mine.find((e) => e.description === "Taxi")!;
  expect(taxi.amount).toBe(30000);
  expect(taxi.shares.map((s) => s.amount)).toEqual([5000, 5000, 5000, 5000, 5000, 5000]);
  for (const e of mine) expect(e.shares.reduce((s, x) => s + x.amount, 0)).toBe(e.amount);
  const balances = await readBalances(page, trip.path);
  expect(balances["Varun"]).toBe(135000); // 500 + 750 + 250 - 150 = 1,350 rupees
  expect(Object.values(balances).reduce((a, b) => a + b, 0)).toBe(0);
  expect(bad, "no console errors other than network failures").toEqual([]);
  await ctx.close();
});

test("a person who says it is the same one removes theirs and nothing is sent", async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page, trip, groupId, name } = await setup(browser, "same", { noWorker: true });
  await page.route("**/api/ping", (r) => r.abort());
  await page.goto(`/offline-app?g=${groupId}&s=add`);
  await saveOnPhone(page, "Breakfast", "900");
  await page.waitForURL(new RegExp(`${trip.path}$`));
  await page.unroute("**/api/ping");
  const asha = await db.member.findFirstOrThrow({ where: { groupId, name: "Asha" } });
  const day = new Date();
  const seeded = await db.expense.create({
    data: {
      groupId, description: "Breakfast", amount: 90000, splitType: "equal", category: "food", originalAmount: 90000, convertedAmount: 90000, paidById: asha.id, createdById: asha.id,
      createdAt: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 3, 10)), spentAt: new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 12)),
    },
  });
  await db.expenseShare.createMany({ data: (await db.member.findMany({ where: { groupId } })).map((m) => ({ expenseId: seeded.id, memberId: m.id, amount: 15000 })) });
  await page.goto(trip.path);
  const sheet = page.locator("[data-back-online]");
  await expect(sheet.locator("[data-sheet-duplicate]")).toBeVisible();
  await sheet.locator("[data-sheet-same]").click();
  await expect(sheet).toHaveCount(0, { timeout: 20_000 }); // nothing left to ask about
  expect(await draftCount(page)).toBe(0);
  expect(await db.expense.count({ where: { groupId, description: "Breakfast" } })).toBe(1);
  void name;
  await ctx.close();
});

test("the offline screen opened WITH a signal goes straight to the real page (Home, the group, its Add page)", async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page, trip, groupId } = await setup(browser, "straight", { noWorker: true });
  for (const [from, to] of [
    [`/offline-app?g=${groupId}&s=add`, `${trip.path}/add`],
    [`/offline-app?g=${groupId}`, trip.path],
    ["/offline-app", "/"],
  ] as const) {
    await page.goto(from);
    await expect(page).toHaveURL(new RegExp(`${to.replace(/\//g, "\\/")}$`), { timeout: 30_000 });
    await expect(page.locator("[data-offline-app]")).toHaveCount(0);
  }
  await ctx.close();
});

test("the offline Home lists the groups you can add to, and the waiting count", async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page, groupId, name } = await setup(browser, "home", { noWorker: true });
  await page.route("**/api/ping", (r) => r.abort());
  await page.goto("/offline-app");
  await expect(page.getByRole("heading", { name: "You’re offline" })).toBeVisible();
  await expect(page.locator("[data-offline-groups]")).toContainText(name);
  await expect(page.locator(`[data-offline-groups] a[href="/groups/${groupId}/add"]`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await ctx.close();
});

test("signing out with an expense waiting warns, then wipes the phone's offline database", async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page, trip, groupId } = await setup(browser, "signout", { noWorker: true });
  await page.route("**/api/ping", (r) => r.abort());
  await page.goto(`/offline-app?g=${groupId}&s=add`);
  await saveOnPhone(page, "Taxi", "300");
  await page.waitForURL(new RegExp(`${trip.path}$`));
  await page.unroute("**/api/ping");
  expect(await draftCount(page)).toBe(1);
  let asked = "";
  page.on("dialog", (d) => {
    asked = d.message(); // the shared fixture accepts it
  });
  await page.goto("/account/sign-in");
  await settled(page);
  await page.getByRole("button", { name: /^Sign out( anyway)?$/ }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/account/sign-in"), { timeout: 30_000 });
  expect(asked).toContain("1 expense is waiting on this phone and hasn’t been added. Signing out removes it from this phone.");
  expect(await draftCount(page)).toBe(0);
  expect((await idbRows(page, "snapshots")).length).toBe(0);
  expect((await idbRows(page, "meta")).length).toBe(0);
  await ctx.close();
});

// ---- the real thing: the browser offline, with the service worker (skipped where the engine does not run one in CI) ----
async function shellKept(page: Page, ctx: BrowserContext, test_: typeof test) {
  const controlled = await page
    .waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!controlled) await page.reload();
  const sw = await page.evaluate(() => !!navigator.serviceWorker?.controller);
  if (!sw) test_.skip(true, "Service workers do not run in this browser engine in CI: check opening the app with no signal on a real phone.");
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const keys = (await caches.keys()).filter((k) => k.startsWith("loopin-shell-"));
          if (!keys.length) return "none";
          const c = await caches.open(keys.sort().pop()!);
          const paths = (await c.keys()).map((r) => new URL(r.url).pathname);
          return paths.includes("/offline-app") && paths.some((p) => p.endsWith(".js")) ? "ready" : `partial ${paths.length}`;
        }),
      { timeout: 40_000, message: "the offline screen and its script files are kept" },
    )
    .toBe("ready");
  void ctx;
}

test("really offline (service worker): the group opens, an expense is saved, and when the signal returns the group opens by itself with the sheet", async ({ browser }) => {
  test.setTimeout(300_000);
  const { ctx, page, trip, groupId, name } = await setup(browser, "real", { noWorker: false });
  await shellKept(page, ctx, test);
  const bad = watchErrors(page);
  const lunchNet = await net(page);
  await page.waitForTimeout(2_000);

  await ctx.setOffline(true);
  await page.goto(trip.path);
  await expect(page.locator("[data-offline-app]")).toBeVisible({ timeout: 25_000 });
  await expect(page.locator("[data-offline-net]").first()).toHaveText("Offline");
  await expect(page.locator("[data-settle-disabled]")).toHaveText("Settle up when online");
  await expect(page.locator("[data-as-of]")).toBeVisible();
  expect(await net(page)).toBe(lunchNet);
  expect(await page.locator("body").innerText()).not.toContain("Loopin needs the internet");

  // The Add expense link on the offline group page: a full page load, served by the service worker.
  await page.locator("[data-add-expense]").click();
  await expect(page.locator("[data-offline-note]")).toBeVisible({ timeout: 25_000 });
  await saveOnPhone(page, "Breakfast", "900");
  await expect(page.locator("[data-offline-waiting]")).toContainText("1 expense waiting on this phone", { timeout: 25_000 });
  await expect(page.locator("[data-draft-row]")).toHaveCount(1);
  expect(await net(page)).toBe(lunchNet);
  // Pages that are not groups keep today's plain message.
  await page.goto("/faq");
  await expect(page.locator("body")).toContainText("Loopin needs the internet");

  // Back online: the offline screen notices (no tap), returns to the group, and the sheet opens.
  await page.goto(trip.path);
  await expect(page.locator("[data-offline-app]")).toBeVisible();
  await ctx.setOffline(false);
  await expect(page).toHaveURL(new RegExp(`${trip.path}$`), { timeout: 40_000 });
  await expect(page.locator("[data-offline-app]")).toHaveCount(0);
  const sheet = page.locator("[data-back-online]");
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await sheet.getByRole("button", { name: `Add 1 to ${name}` }).click();
  await expect(sheet).toHaveCount(0, { timeout: 30_000 });
  expect(await db.expense.count({ where: { groupId, description: "Breakfast" } })).toBe(1);
  expect(bad, "no console errors other than network failures").toEqual([]);
  await ctx.close();
});

test("the offline screen's Try again button goes back by itself the moment a check works", async ({ browser }) => {
  test.setTimeout(240_000);
  const { ctx, page, trip, groupId } = await setup(browser, "retry", { noWorker: true });
  await page.route("**/api/ping", (r) => r.abort());
  await page.goto(`/offline-app?g=${groupId}`);
  await expect(page.locator("[data-offline-net]").first()).toHaveText("Offline");
  await page.unroute("**/api/ping");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page).toHaveURL(new RegExp(`${trip.path}$`), { timeout: 20_000 });
  await ctx.close();
});

test("the push and notification parts of sw.js are still there", async ({ request }) => {
  const sw = await (await request.get("/sw.js")).text();
  for (const needle of ['addEventListener("push"', 'addEventListener("notificationclick"', "showNotification", "openWindow", "clients.claim()", "skipWaiting()"]) {
    expect(sw, needle).toContain(needle);
  }
});
