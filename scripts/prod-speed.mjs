// Measures how the LIVE app feels when tapping around (signed out), and what
// the phone waits for on each tap. Read-only: it only opens pages.
import { chromium } from "playwright";
const base = process.env.APP_URL ?? "https://loopinapps.com";
const out = [];
const log = (s) => { console.log(s); out.push(s); };

// 1. Raw server time for a few pages (5 tries each), and where it ran.
for (const p of ["/how-it-works", "/search", "/settle", "/notifications", "/join/does-not-exist"]) {
  const times = [];
  let id = "";
  for (let i = 0; i < 5; i++) {
    const t = performance.now();
    const r = await fetch(base + p, { redirect: "manual" });
    await r.text();
    times.push(Math.round(performance.now() - t));
    id = r.headers.get("x-vercel-id") ?? "";
  }
  log(`server ${p}: ${times.join(", ")} ms  (${id.split("::").slice(0, -1).join(" → ")})`);
}
const rtt = [];
for (let i = 0; i < 5; i++) { const t = performance.now(); await (await fetch(base + "/icon-192.png")).arrayBuffer(); rtt.push(Math.round(performance.now() - t)); }
log(`static file (network only, no server work): ${rtt.join(", ")} ms`);

// 2. Tapping the bottom bar like a person, recording every request.
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
let t0 = performance.now();
const reqs = new Map();
page.on("request", (r) => {
  const h = r.headers();
  const kind = h["next-action"] ? "ACTION" : h["rsc"] ? "PAGE-DATA" : r.resourceType() === "document" ? "PAGE" : "";
  if (kind) reqs.set(r, { kind, url: r.url().replace(base, ""), start: Math.round(performance.now() - t0) });
});
page.on("requestfinished", (r) => { const x = reqs.get(r); if (x) x.end = Math.round(performance.now() - t0); });
await page.goto(base + "/how-it-works", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const loaded = () => page.waitForFunction(() => !document.querySelector('[role="progressbar"]'), null, { timeout: 20000 }).catch(() => {});
for (const label of ["Search", "Settle", "Alerts", "Search", "Settle", "Alerts"]) {
  reqs.clear();
  t0 = performance.now();
  const before = page.url();
  await page.locator("nav").getByRole("link", { name: label }).last().click();
  await page.waitForURL((u) => u.toString() !== before, { timeout: 20000 }).catch(() => {});
  const urlAt = Math.round(performance.now() - t0);
  await loaded();
  const shownAt = Math.round(performance.now() - t0);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  log(`tap ${label}: screen changed after ${urlAt} ms, content shown after ${shownAt} ms`);
  for (const x of reqs.values()) log(`   ${x.kind.padEnd(9)} ${String(x.start).padStart(5)} → ${String(x.end ?? "?").padStart(5)} ms  ${x.url.slice(0, 60)}`);
}
// 3. Two quick taps in a row (the second straight after the first screen appears).
reqs.clear(); t0 = performance.now();
await page.locator("nav").getByRole("link", { name: "Settle" }).last().click();
await page.waitForURL(/settle/);
const a = Math.round(performance.now() - t0);
await page.locator("nav").getByRole("link", { name: "Search" }).last().click();
await page.waitForURL(/search/);
log(`quick taps: Settle after ${a} ms, then Search after ${Math.round(performance.now() - t0)} ms`);
for (const x of reqs.values()) log(`   ${x.kind.padEnd(9)} ${String(x.start).padStart(5)} → ${String(x.end ?? "?").padStart(5)} ms  ${x.url.slice(0, 60)}`);
await browser.close();
const { writeFileSync, mkdirSync } = await import("node:fs");
mkdirSync("screenshots/uat", { recursive: true });
writeFileSync("screenshots/uat/prod-speed.md", "```\n" + out.join("\n") + "\n```\n");
