import { test, expect } from "../fixtures";
import { testEmail, groupName, baseURL } from "../env";
import { signUp, signInto } from "../helpers/auth";
import { allowTestCopy, contextFor, createGroup, settled } from "../helpers/app";

// Stage 1 · Signing in and your account.
test.describe.configure({ mode: "serial" });

test("sign out of this phone, sign back in: your groups come back", async ({ browser }) => {
  const email = testEmail("returner");
  const user = await signUp("Rita", email);
  const ctx = await contextFor(browser, user);
  const page = await ctx.newPage();
  const name = groupName("Comeback");
  await createGroup(page, name);

  await page.goto("/account");
  await settled(page);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.goto("/");
  await expect(page.getByText(name)).toHaveCount(0);

  await signInto(ctx, "Rita", email);
  await page.goto("/");
  await settled(page);
  await expect(page.getByText(name).first()).toBeVisible();
  await ctx.close();
});

test("someone outside a group sees “Private group” (no name, no join code), and can’t download it", async ({ browser, page, context }) => {
  const owner = await signUp("Omar", testEmail("owner-private"));
  const octx = await contextFor(browser, owner);
  const g = await createGroup(await octx.newPage(), groupName("Private"));
  await octx.close();

  await allowTestCopy(context);
  for (const sub of ["", "/settle", "/people"]) {
    await page.goto(g.path + sub);
    await page.waitForURL(/\/private/);
  }
  await expect(page.getByRole("heading", { name: "Private group" })).toBeVisible();
  const body = await page.locator("main").innerText();
  expect(body).not.toContain(groupName("Private"));
  expect(body).not.toContain(g.invite.split("/").pop()!);
  const csv = await page.request.get(`${baseURL}${g.path}/export`, { headers: (await import("../env")).bypassHeaders });
  expect(csv.status()).toBe(403);
});

test("fingerprint / face: turn it on, sign out, sign back in with one touch, remove it", async ({ browser }) => {
  const email = testEmail("passkey");
  const user = await signUp("Pia", email);
  const ctx = await contextFor(browser, user);
  const page = await ctx.newPage();
  // Chrome's built-in test fingerprint reader (always says "yes, it's you").
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  await page.goto("/account");
  await settled(page);
  await page.getByRole("button", { name: /Turn on fingerprint \/ face sign-in/ }).click();
  // The phone appears in the list (named from the browser: a Pixel → "Android phone").
  // (It saves, then the page reloads; on the hosted copy that can take a while.)
  const added = page.getByText("Android phone").first();
  const problem = page.locator('p[role="alert"]');
  await expect(added.or(problem).first()).toBeVisible({ timeout: 45_000 });
  if (await problem.count()) throw new Error(`Turning it on said: ${await problem.first().innerText()}`);
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(1);

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL((u) => u.pathname === "/");
  await page.goto("/signin");
  await settled(page);
  await page.getByRole("button", { name: /Sign in with fingerprint or face/ }).click();
  await page.waitForURL(/signedin=1/);
  await page.goto("/account");
  await expect(page.getByText(email)).toBeVisible();

  await page.getByRole("button", { name: "Remove" }).click();
  await page.waitForURL(/removed=passkey/);
  await expect(page.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await ctx.close();
});

test("Continue with Google starts Google's sign-in safely (when switched on)", async ({ page, context }) => {
  await allowTestCopy(context);
  await page.goto("/signin");
  await settled(page);
  const google = page.getByRole("link", { name: "Continue with Google" });
  test.skip((await google.count()) === 0, "Google sign-in isn't switched on for this copy (no Google key in its settings).");
  const r = await page.request.get(`${baseURL}/api/auth/google/start?back=%2F`, { maxRedirects: 0, headers: (await import("../env")).bypassHeaders });
  expect(r.status()).toBe(307);
  const to = new URL(r.headers()["location"] ?? "");
  expect(to.origin).toBe("https://accounts.google.com");
  expect(to.searchParams.get("code_challenge_method")).toBe("S256");
  expect(to.searchParams.get("redirect_uri")).toBe(`${baseURL}/api/auth/google/callback`);
});

test("delete my email & sign-in (a test account on the test copy only)", async ({ browser }) => {
  const email = testEmail("leaver");
  const user = await signUp("Lee", email);
  const ctx = await contextFor(browser, user);
  const page = await ctx.newPage();
  await page.goto("/account");
  await settled(page);
  await page.getByRole("button", { name: /Delete my email/ }).click();
  await page.waitForURL(/deleted=account/);
  await expect(page.getByText(/Your email and sign-in were deleted/)).toBeVisible();
  const { db } = await import("../helpers/db");
  expect(await db.account.count({ where: { email } })).toBe(0);
  await ctx.close();
});
