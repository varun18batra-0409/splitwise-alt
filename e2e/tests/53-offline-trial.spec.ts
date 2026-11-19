import type { Browser, BrowserContext, Page } from "@playwright/test";
import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { contextFor, createGroup, settled } from "../helpers/app";

// TRIAL (branch phase-offline-trial, never released): can one saved, generic offline screen open with no signal?
// Uses context.setOffline on Android (Chromium) and iPhone (WebKit). See the offline plan, steps 2a and 2d.
const VALUE = "trial-value-4242";
const EXPECTED_FAILURE = /Failed to load resource|net::ERR|Failed to fetch|NetworkError|Load failed|Beacon API cannot load|fetch failed|The Internet connection appears to be offline|network connection was lost|ERR_INTERNET_DISCONNECTED/i;

async function setup(browser: Browser, tag: string, testInfo: { project: { name: string } }) {
  const user = await signUp("Asha", testEmail(`off-${tag}`));
  const ctx = await contextFor(browser, user);
  const page = await ctx.newPage();
  const trip = await createGroup(page, groupName("Offline trial"), "Trip");
  await page.goto(trip.path);
  await settled(page);
  // The service worker is in charge of this page, and the offline screen is saved.
  const sw = await page
    .waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!sw) {
    // Make sure it is not just slow: one reload, so the active worker takes the page.
    await page.reload();
    await settled(page);
  }
  const controlled = await page.evaluate(() => !!navigator.serviceWorker?.controller);
  if (!controlled) {
    test.info().annotations.push({ type: "service-worker", description: `${testInfo.project.name}: no service worker controls the page` });
    test.skip(true, `Service workers do not run in this browser engine in CI (${testInfo.project.name}): not testable here, check on a real device.`);
  }
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const keys = (await caches.keys()).filter((k) => k.startsWith("loopin-shell-"));
          if (!keys.length) return "no cache";
          const c = await caches.open(keys.sort().pop()!);
          const reqs = await c.keys();
          const paths = reqs.map((r) => new URL(r.url).pathname);
          return paths.includes("/offline-app") && paths.some((p) => p.endsWith(".js")) ? "ready" : `partial: ${paths.length}`;
        }),
      { timeout: 30_000, message: "the offline screen and its script files are saved" },
    )
    .toBe("ready");
  await page.evaluate(
    (v) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("loopin-offline-trial", 1);
        open.onupgradeneeded = () => open.result.createObjectStore("kv");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction("kv", "readwrite");
          tx.objectStore("kv").put(v, "test");
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
    VALUE,
  );
  return { user, ctx, page, trip };
}

// Records anything the browser logs as an error on this page, apart from network failures (expected with no signal).
function watchErrors(page: Page) {
  const bad: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") console.log(`TRIAL console ${m.type()}: ${m.text().slice(0, 160)}`);
    if (m.type() === "error" && !EXPECTED_FAILURE.test(m.text())) bad.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("pageerror", (e) => {
    if (!EXPECTED_FAILURE.test(e.message)) bad.push(`pageerror: ${e.message.slice(0, 200)}`);
  });
  return bad;
}

async function expectOfflineScreen(page: Page, bad: string[], want: RegExp) {
  await expect(page.locator("[data-offline-app]")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("[data-offline-value]")).toHaveText(VALUE);
  await expect(page.locator("[data-offline-net]")).toHaveText(/offline/i);
  await expect(page.locator("[data-offline-where]")).toHaveText(want);
  const text = await page.locator("body").innerText();
  expect(text, "not the service worker's plain message").not.toContain("Loopin needs the internet");
  expect(text, "not the app's error screen").not.toMatch(/That didn’t load|Application error|Try again/);
  expect(bad, "no console errors other than network failures").toEqual([]);
}

async function off(ctx: BrowserContext, on: boolean) {
  await ctx.setOffline(on);
}

test("offline screen: saved by the service worker, reached from a full load and a Link tap, notices coming back online", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, trip } = await setup(browser, "main", testInfo);
  const id = trip.path.split("/").pop()!;
  const bad = watchErrors(page);

  // Online, the service worker passes real pages through (crash-safe: the network is used).
  const online = await page.goto("/privacy");
  expect(online?.status()).toBe(200);
  await page.goto(trip.path);
  await settled(page);
  await expect(page.locator("[data-add-expense]")).toBeVisible();
  // Give Next time to prefetch what it wants to, as a person's phone would.
  await page.waitForTimeout(2_000);

  await off(ctx, true);

  // 1. A Link tap on the real group page (Add expense).
  bad.length = 0;
  await page.evaluate(() => ((window as unknown as { __marker: number }).__marker = 1));
  await page.locator("[data-add-expense]").click();
  await expect(page.locator("[data-offline-app]"), "Link tap ends on the offline screen").toBeVisible({ timeout: 25_000 });
  console.log(`TRIAL link tap -> ${page.url()}`);
  expect(page.url()).toContain("/offline-app");
  await expectOfflineScreen(page, bad, /g=/);
  const afterTap = await page.evaluate(() => ({ url: location.pathname + location.search, markerSurvived: (window as unknown as { __marker?: number }).__marker === 1 }));
  console.log(`TRIAL after tap ${JSON.stringify(afterTap)} (markerSurvived false = a full page load, not an in-page switch)`);
  // What the saved copy carries: its page rule and whether the page's scripts match it.
  const saved = await page.evaluate(async () => {
    const name = (await caches.keys()).filter((k) => k.startsWith("loopin-shell-")).sort().pop()!;
    const c = await caches.open(name);
    const r = (await c.match("/offline-app"))!;
    const html = await r.text();
    const csp = r.headers.get("content-security-policy") ?? "";
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1] ?? "";
    return { files: (await c.keys()).length, cspHasNonce: !!nonce, htmlUsesNonce: !!nonce && html.includes(`nonce="${nonce}"`), cspHeaders: csp.slice(0, 80) };
  });
  console.log(`TRIAL saved copy ${JSON.stringify(saved)}`);
  expect(saved.cspHasNonce && saved.htmlUsesNonce, "the saved page keeps its own matching script key").toBe(true);

  // 2. Full page load of the add screen, then the group.
  for (const [path, want] of [
    [`${trip.path}/add`, new RegExp(`g=${id}&s=add`)],
    [trip.path, new RegExp(`g=${id}$`)],
    [`${trip.path}?tab=expenses`, new RegExp(`g=${id}$`)],
  ] as const) {
    bad.length = 0;
    await page.goto(path);
    await expectOfflineScreen(page, bad, want);
    expect(new URL(page.url()).pathname).toBe("/offline-app");
  }

  // 3. A Link on the offline screen itself (nothing prefetched): back to the group, which goes to the offline screen again.
  bad.length = 0;
  await page.goto(`${trip.path}/add`);
  await expectOfflineScreen(page, bad, new RegExp(`g=${id}&s=add`));
  await page.locator("[data-offline-link]").click();
  await expect(page.locator("[data-offline-where]")).toHaveText(new RegExp(`g=${id}$`), { timeout: 25_000 });
  await expectOfflineScreen(page, bad, new RegExp(`g=${id}$`));

  // 4. A fresh page (cold start, same phone): still served from the saved copy.
  const cold = await ctx.newPage();
  const coldBad = watchErrors(cold);
  await cold.goto(`${trip.path}/add`);
  await expectOfflineScreen(cold, coldBad, new RegExp(`g=${id}&s=add`));
  await cold.close();

  // 5. Pages that are not groups keep today's plain message (and the browser's own error page never shows).
  await page.goto("/faq");
  await expect(page.locator("body")).toContainText("Loopin needs the internet");

  // 6. Back online: the page notices through /api/ping.
  await page.goto(`${trip.path}/add`);
  await expectOfflineScreen(page, bad, new RegExp(`g=${id}&s=add`));
  await off(ctx, false);
  await expect(page.locator("[data-offline-net]")).toHaveText(/back online/i, { timeout: 20_000 });
  const ping = await page.evaluate(async () => {
    const r = await fetch("/api/ping", { cache: "no-store" });
    return { status: r.status, cache: r.headers.get("cache-control"), body: await r.text() };
  });
  expect(ping).toEqual({ status: 200, cache: "no-store", body: "ok" });
  // And a real page loads again.
  const res = await page.goto(`${trip.path}/add`);
  expect(res?.status()).toBe(200);
  await expect(page.locator("[data-offline-app]")).toHaveCount(0);
  await ctx.close();
});

test("AppRefresh (coming back to the app) does not break the offline screen", async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  const { ctx, page, trip } = await setup(browser, "refresh", testInfo);
  const id = trip.path.split("/").pop()!;
  await off(ctx, true);
  const bad = watchErrors(page);
  await page.goto(`${trip.path}/add`);
  await expectOfflineScreen(page, bad, new RegExp(`g=${id}&s=add`));
  // Pretend the phone was in the background for 30 seconds, then came back (what AppRefresh listens for).
  await page.evaluate(() => {
    let state = "hidden";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
    const real = Date.now;
    Date.now = () => real() + 30_000;
    state = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(4_000);
  const text = await page.locator("body").innerText();
  console.log(`TRIAL appRefresh body=${JSON.stringify(text.slice(0, 200))} url=${page.url()}`);
  await expect(page.locator("[data-offline-app]")).toBeVisible();
  await expect(page.locator("[data-offline-value]")).toHaveText(VALUE);
  expect(text).not.toMatch(/That didn’t load|Application error|Try again|Loopin needs the internet/);
  expect(bad, "no console errors other than network failures").toEqual([]);
  await ctx.close();
});

test("the push and notification parts of sw.js are still there", async ({ request }) => {
  const sw = await (await request.get("/sw.js")).text();
  for (const needle of ['addEventListener("push"', 'addEventListener("notificationclick"', "showNotification", "openWindow", "clients.claim()", "skipWaiting()"]) {
    expect(sw, needle).toContain(needle);
  }
});
