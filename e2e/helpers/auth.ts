// Signing a test person in through the real sign-in screen.
//
// This runs in its own browser, outside the test's recorded trace, so the
// 6-digit code never appears in a trace, screenshot or report. The test then
// carries on in a traced browser with the signed-in cookies.
import { chromium, devices, type BrowserContextOptions } from "@playwright/test";
import { baseURL, bypassHeaders, appHost } from "../env";
import { latestCode } from "./db";

export type TestUser = { name: string; email: string; storageState: BrowserContextOptions["storageState"] };

export async function signUp(name: string, email: string): Promise<TestUser> {
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ ...devices["Pixel 7"], locale: "en-IN", timezoneId: "Asia/Kolkata" });
    if (Object.keys(bypassHeaders).length) {
      await ctx.route((u) => u.host === appHost, (r) => r.continue({ headers: { ...r.request().headers(), ...bypassHeaders } }));
    }
    const page = await ctx.newPage();
    page.setDefaultTimeout(45_000);
    await page.goto(`${baseURL}/signin`);
    await page.locator('input[name="name"]').fill(name);
    await page.locator('input[name="email"]').fill(email);
    const since = new Date(Date.now() - 2_000);
    await page.getByRole("button", { name: "Email me a code" }).click();
    await page.waitForURL(/sent=1/);
    const code = await latestCode(email, since);
    await page.locator('input[name="code"]').fill(code);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/signedin=1/);
    const storageState = await ctx.storageState();
    await ctx.close();
    return { name, email, storageState };
  } catch (e) {
    // Re-thrown without any page content (which could include the code).
    throw new Error(`Sign-in through the app failed for ${email}: ${String((e as Error).message).split("\n")[0].replace(/\b\d{6}\b/g, "######")}`);
  } finally {
    await browser.close();
  }
}
