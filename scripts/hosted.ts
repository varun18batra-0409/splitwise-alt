// Running the tests against a hosted copy of Loopin (the private test copy on
// Vercel) instead of a server on this machine.
// - Vercel keeps test copies private; the "protection bypass" secret lets the
//   test browser in. It is only ever sent to the test copy's own address.
// - Never the live app: refuses loopinapps.com and the old address.
import type { Browser } from "playwright";

export const base = process.env.APP_URL ?? "http://localhost:3000";
export const hosted = /^https:/.test(base);
const appHost = new URL(base).host;
const secret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "";
// (and skip Vercel's preview toolbar, which keeps a connection open)
export const bypass: Record<string, string> = hosted && secret ? { "x-vercel-protection-bypass": secret, "x-vercel-skip-toolbar": "1" } : {};

if (hosted && /loopinapps\.com$|getloopin\.vercel\.app$|splitwise-alt-bovz\.vercel\.app$/.test(appHost)) {
  console.error(`Refusing to run tests against the live app (${appHost}).`);
  process.exit(1);
}

if (Object.keys(bypass).length) {
  const f = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.host !== appHost) return f(input, init);
    return f(input, { ...init, headers: { ...bypass, ...((init.headers as Record<string, string>) ?? {}) } });
  }) as typeof fetch;
}

// Every new browser profile sends the bypass to the test copy (and nowhere else).
export function withBypass(browser: Browser): Browser {
  if (!Object.keys(bypass).length) return browser;
  const make = browser.newContext.bind(browser);
  browser.newContext = (async (options = {}) => {
    const ctx = await make(options);
    await ctx.route(
      (u) => u.host === appHost,
      (route) => route.continue({ headers: { ...route.request().headers(), ...bypass } }),
    );
    // Also Vercel's pass cookie, for what routes don't catch (the app's service worker, downloads).
    await ctx.request.get(`${base}/api/health`, { headers: { ...bypass, "x-vercel-set-bypass-cookie": "true" } }).catch(() => undefined);
    return ctx;
  }) as Browser["newContext"];
  return browser;
}

// Screenshots and speed checks on the test copy can't make their own sign-in
// cookie (they don't know its signing key), so they sign in the way a person
// does: a test email, the code from the kept email, Sign in.
export async function signInOnTestCopy(ctx: import("playwright").BrowserContext, memberIds: string[], name = "Varun") {
  const { db } = await import("../src/lib/db");
  const email = `shots-${Date.now()}@uat.loopin.test`;
  const acc = await db.account.create({ data: { email, name } });
  await db.member.updateMany({ where: { id: { in: memberIds } }, data: { accountId: acc.id, claimedAt: new Date() } });
  const page = await ctx.newPage();
  await page.goto(`${base}/signin`, { waitUntil: "networkidle" });
  await page.locator('input[name="email"]').fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.waitForURL(/sent=1/);
  let code = "";
  for (let i = 0; i < 40 && !code; i++) {
    const row = await db.outbox.findFirst({ where: { to: email }, orderBy: { createdAt: "desc" } });
    code = row ? (/\b(\d{6})\b/.exec(row.subject)?.[1] ?? "") : "";
    if (!code) await page.waitForTimeout(250);
  }
  if (!code) throw new Error("no sign-in code arrived on the test copy");
  await page.locator('input[name="code"]').fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/signedin=1/);
  await page.close();
}
