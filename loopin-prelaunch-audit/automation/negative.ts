// What happens when things go wrong: bad amounts, scripts typed into names,
// double taps, no internet, slow internet, a lost session, dead links. Every
// case records what the person sees (screenshot) and what was saved.
import { chromium, type Page } from "playwright";
import { OUT, base, cookieFor, db, demo, save } from "./common";

const T = demo.trip.id;
const count = (description: string) => db.expense.count({ where: { groupId: T, description, deletedAt: null } });

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark", locale: "en-IN", timezoneId: "Asia/Kolkata" });
  await ctx.addCookies([await cookieFor({ [T]: demo.trip.me }), { name: "lp_tour", value: "1", url: base }]);
  const rows: Record<string, unknown>[] = [];
  let dialogs = 0;
  ctx.on("page", (p) => p.on("dialog", (d) => { dialogs++; d.dismiss().catch(() => {}); }));
  const shot = async (page: Page, id: string) => {
    const f = `evidence/negative__${id}.png`;
    await page.screenshot({ path: `${OUT}/${f}` }).catch(() => {});
    return f;
  };
  const visibleError = (page: Page) => page.evaluate(() => [...document.querySelectorAll('[role="alert"], p.bg-red-50, .text-red-600, [aria-invalid="true"]')].map((e) => (e as HTMLElement).innerText || e.getAttribute("name") || "").filter(Boolean).join(" | ").slice(0, 200));
  async function tryAdd(id: string, scenario: string, name: string, amount: string, opts: { double?: boolean; offline?: boolean; dropSession?: boolean } = {}) {
    const page = await ctx.newPage();
    page.on("dialog", (d) => { dialogs++; d.dismiss().catch(() => {}); });
    const before = await count(name);
    let note = "";
    try {
      await page.goto(`${base}/groups/${T}/add`, { waitUntil: "load" });
      await page.locator("#expense-name").fill(name);
      await page.getByLabel("Amount", { exact: true }).fill(amount);
      if (opts.dropSession) await ctx.clearCookies({ name: "sw_me" });
      if (opts.offline) await ctx.setOffline(true);
      const btn = page.getByRole("button", { name: "Save expense" });
      if (opts.double) {
        await btn.dblclick({ timeout: 5000 }).catch(() => {});
        await btn.click({ timeout: 2000 }).catch(() => {});
      } else await btn.click({ timeout: 5000 }).catch((e) => (note = String(e).slice(0, 120)));
      await page.waitForTimeout(opts.offline ? 4000 : 2500);
      const dup = page.getByRole("button", { name: "It’s a different one" });
      if (await dup.count()) note += " duplicate-warning shown;";
    } catch (e) {
      note += String(e).slice(0, 160);
    }
    const evidence = await shot(page, id);
    const err = await visibleError(page).catch(() => "");
    if (opts.offline) await ctx.setOffline(false);
    if (opts.dropSession) await ctx.addCookies([await cookieFor({ [T]: demo.trip.me })]);
    const after = await count(name);
    rows.push({ id, scenario, input: { name: name.slice(0, 60), amount }, saved: after - before, url: new URL(page.url()).pathname.replace(/[A-Za-z0-9_-]{20,}/g, ":id") + new URL(page.url()).search.slice(0, 60), userSees: err || (await page.evaluate(() => document.body.innerText.slice(0, 160)).catch(() => "")), note, evidence });
    await page.close();
  }
  await tryAdd("NEG-01", "Amount left empty", "Audit empty amount", "");
  await tryAdd("NEG-02", "Negative amount", "Audit negative", "-50");
  await tryAdd("NEG-03", "Letters as amount", "Audit letters", "abc");
  await tryAdd("NEG-04", "Zero amount", "Audit zero", "0");
  await tryAdd("NEG-05", "Huge amount (₹999 crore)", "Audit huge", "9999999999");
  await tryAdd("NEG-06", "Script typed into the name", `<img src=x onerror=alert(1)>Audit XSS`, "120");
  await tryAdd("NEG-07", "Very long name (300 letters)", `Audit long ${"x".repeat(290)}`, "50");
  await tryAdd("NEG-08", "Emoji and accents in the name", "Audit café 🍕 naïve", "75");
  await tryAdd("NEG-09", "Double-tap on Save", "Audit double tap", "200", { double: true });
  await tryAdd("NEG-10", "Save with no internet", "Audit offline", "300", { offline: true });
  await tryAdd("NEG-11", "Session cookie lost before saving", "Audit no session", "90", { dropSession: true });
  // NEG-06b: is the script shown as text where the expense is listed?
  {
    const page = await ctx.newPage();
    await page.goto(`${base}/groups/${T}`, { waitUntil: "load" });
    const shown = await page.evaluate(() => document.body.innerText.includes("<img src=x onerror=alert(1)>Audit XSS"));
    rows.push({ id: "NEG-06b", scenario: "Script name shown back as plain text in Activity (no script ran)", shownAsText: shown, dialogsFired: dialogs, evidence: await shot(page, "NEG-06b") });
    await page.close();
  }
  // NEG-12: a group name with a script and emoji.
  {
    const page = await ctx.newPage();
    await page.goto(`${base}/groups/new`, { waitUntil: "load" });
    rows.push({ id: "NEG-12", scenario: "New group screen opens (name field present)", hasName: await page.locator('input[name="groupName"]').count(), evidence: await shot(page, "NEG-12") });
    await page.close();
  }
  // NEG-13..16: dead and wrong links.
  for (const [id, path, scenario] of [
    ["NEG-13", "/join/EXPIRED00", "Invite link that doesn't exist / expired"],
    ["NEG-14", `/groups/${T}/expenses/not-a-real-expense/edit`, "Edit link for an expense that doesn't exist"],
    ["NEG-15", "/groups/not-a-real-group", "Group link that doesn't exist"],
    ["NEG-16", "/c/NOPE1234", "Collection link that doesn't exist"],
    ["NEG-17", "/p/not-a-real-token", "Payment link that doesn't exist"],
    ["NEG-18", "/postcards/not-a-real-card", "Postcard link that doesn't exist"],
  ] as const) {
    const page = await ctx.newPage();
    const r = await page.goto(base + path, { waitUntil: "load" }).catch(() => null);
    rows.push({ id, scenario, status: r?.status(), url: new URL(page.url()).pathname, userSees: (await page.evaluate(() => document.body.innerText.slice(0, 160))).replace(/\s+/g, " "), evidence: await shot(page, id) });
    await page.close();
  }
  // NEG-19: slow internet: every page waits 3 s. What shows meanwhile?
  {
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: "load" });
    await page.route("**/*", async (route) => {
      if (route.request().resourceType() === "document" || route.request().url().includes("_rsc")) await new Promise((r) => setTimeout(r, 3000));
      await route.continue().catch(() => {});
    });
    const link = page.locator(`a[href="/groups/${T}"]`).first();
    const t0 = Date.now();
    if (await link.count()) await link.click().catch(() => {});
    await page.waitForTimeout(1200);
    const during = await shot(page, "NEG-19-during");
    await page.waitForURL(new RegExp(T), { timeout: 15000 }).catch(() => {});
    rows.push({ id: "NEG-19", scenario: "Slow internet (3 s per page): feedback while waiting", msToArrive: Date.now() - t0, evidence: during });
    await page.close();
  }
  // NEG-20: no internet on Home.
  {
    const page = await ctx.newPage();
    await page.goto(`${base}/`, { waitUntil: "load" });
    await ctx.setOffline(true);
    await page.reload().catch(() => {});
    await page.waitForTimeout(1500);
    rows.push({ id: "NEG-20", scenario: "Open/refresh Home with no internet", userSees: (await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => "browser offline page")).replace(/\s+/g, " "), evidence: await shot(page, "NEG-20") });
    await ctx.setOffline(false);
    await page.close();
  }
  // NEG-21/22: wrong file type and too-big photo for a bill (straight to the upload address, as the app sends it).
  for (const [id, scenario, bytes, want] of [
    ["NEG-21", "Bill photo that isn't a picture (a text file)", Buffer.from("just some text, not a photo"), 415],
    ["NEG-22", "Bill photo over the 1.5 MB limit", Buffer.alloc(1_600_000, 0xff), 413],
  ] as const) {
    const before = await db.receipt.count({ where: { groupId: T } });
    const r = await ctx.request.post(`${base}/api/receipt?group=${T}`, { data: bytes, headers: { origin: base } }).catch(() => null);
    rows.push({ id, scenario, status: r?.status(), expectedStatus: want, stored: (await db.receipt.count({ where: { groupId: T } })) - before, userSees: (await r?.text().catch(() => ""))?.slice(0, 160) });
  }
  // NEG-23: split by item where the items add up to more than the bill.
  {
    const page = await ctx.newPage();
    const name = "Audit items over";
    const before = await count(name);
    await page.goto(`${base}/groups/${T}/add`, { waitUntil: "load" });
    await page.locator("#expense-name").fill(name);
    await page.getByLabel("Amount", { exact: true }).fill("500");
    await page.getByRole("button", { name: /Custom/ }).click().catch(() => {});
    await page.getByRole("button", { name: "Items", exact: true }).click().catch(() => {});
    await page.getByLabel("Item 1", { exact: true }).fill("Thali").catch(() => {});
    await page.getByLabel("Item 1 price").fill("800").catch(() => {});
    await page.getByRole("group", { name: "Who had item 1" }).getByRole("button").nth(1).click().catch(() => {});
    await page.getByRole("button", { name: "Save expense" }).click().catch(() => {});
    await page.waitForTimeout(1500);
    rows.push({ id: "NEG-23", scenario: "Split by item: items (₹800) more than the bill (₹500)", saved: (await count(name)) - before, userSees: await visibleError(page).catch(() => ""), evidence: await shot(page, "NEG-23") });
    await page.close();
  }
  // NEG-24: two phones edit the same expense; the second save must not silently overwrite the first.
  {
    const e = await db.expense.create({ data: { groupId: T, description: "Audit edit race", amount: 60000, originalAmount: 60000, convertedAmount: 60000, originalCurrency: "INR", baseCurrency: "INR", exchangeRate: "1", paidById: demo.trip.me, splitType: "equal", shares: { create: [{ memberId: demo.trip.me, amount: 30000 }, { memberId: demo.trip.ravi, amount: 30000 }] } } }).catch((err) => ({ id: "", err: String(err).slice(0, 160) }) as { id: string; err?: string });
    if (e.id) {
      const a = await ctx.newPage();
      const b = await ctx.newPage();
      await a.goto(`${base}/groups/${T}/expenses/${e.id}/edit`, { waitUntil: "load" });
      await b.goto(`${base}/groups/${T}/expenses/${e.id}/edit`, { waitUntil: "load" });
      await a.getByLabel("Amount", { exact: true }).fill("700");
      await a.getByRole("button", { name: /^Save/ }).first().click().catch(() => {});
      await a.waitForTimeout(2000);
      await b.getByLabel("Amount", { exact: true }).fill("900");
      await b.getByRole("button", { name: /^Save/ }).first().click().catch(() => {});
      await b.waitForTimeout(2000);
      const now = await db.expense.findUnique({ where: { id: e.id }, select: { originalAmount: true } });
      rows.push({ id: "NEG-24", scenario: "Two phones edit the same expense (₹600 → ₹700 on one, ₹900 on the other, older screen)", finalAmount: now?.originalAmount, userSees: await visibleError(b).catch(() => ""), evidence: await shot(b, "NEG-24") });
      await a.close();
      await b.close();
    } else rows.push({ id: "NEG-24", scenario: "Two phones edit the same expense", error: (e as { err?: string }).err });
  }
  rows.push({ id: "NEG-XSS-DIALOGS", scenario: "Browser alert pop-ups fired during all tests (should be 0)", dialogsFired: dialogs });
  await browser.close();
  save("negative.json", rows);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
