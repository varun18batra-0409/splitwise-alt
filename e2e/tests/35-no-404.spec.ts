import { test, expect } from "../fixtures";
import { testEmail, groupName } from "../env";
import { signUp } from "../helpers/auth";
import { addEqualExpense, contextFor, createGroup, joinGroup, settled } from "../helpers/app";

// No dead ends: start from Home and the main screens of a trip and a card
// group, follow every link inside the app, and fail if any of them is a
// "not found" page or an error. Run on every release.
test("every link in the app opens a real screen (no 404s)", async ({ browser }) => {
  test.setTimeout(240_000);
  const asha = await signUp("Asha", testEmail("crawl-asha"));
  const ravi = await signUp("Ravi", testEmail("crawl-ravi"));
  const ctx = await contextFor(browser, asha);
  const page = await ctx.newPage();
  const R = await (await contextFor(browser, ravi)).newPage();

  // Something in every kind of screen: a trip with an expense, and a Pot group.
  const trip = await createGroup(page, groupName("Goa trip"), "Trip");
  await joinGroup(R, trip.invite, trip.path);
  await addEqualExpense(page, trip.path, "Dinner", "1200");
  await addEqualExpense(page, trip.path, "Cab", "600");
  const pot = await createGroup(page, groupName("Card night"), "The Pot");
  await page.goto("/");
  await settled(page);

  const start = [
    "/",
    "/account",
    "/passport",
    "/settle",
    "/search",
    "/notifications",
    "/faq",
    "/how-it-works",
    "/groups/new",
    "/add",
    trip.path,
    `${trip.path}?tab=activity`,
    `${trip.path}?tab=balances`,
    `${trip.path}?tab=charts`,
    `${trip.path}/settle`,
    `${trip.path}/wrapped`,
    `${trip.path}/square`,
    `${trip.path}/settings`,
    pot.path,
    `${pot.path}/pot/new`,
  ];
  const skip = (href: string) =>
    !href.startsWith("/") ||
    href.startsWith("//") ||
    /^\/(api\/auth|_next|signout)/.test(href) ||
    /\/(countdown-image|square-image|wrapped-image|export)(\?|$)/.test(href) ||
    /^\/passport\/image/.test(href);
  const seen = new Set<string>();
  const queue = [...start];
  const bad: string[] = [];
  // Ids differ but screens repeat: visit each shape a few times at most.
  const shapes = new Map<string, number>();
  const shape = (u: string) => u.replace(/[A-Za-z0-9_-]{20,}/g, ":id").replace(/\?.*$/, "");
  while (queue.length && seen.size < 220) {
    const url = queue.shift()!.split("#")[0];
    if (seen.has(url)) continue;
    const sh = shape(url);
    if ((shapes.get(sh) ?? 0) >= 3) continue;
    shapes.set(sh, (shapes.get(sh) ?? 0) + 1);
    seen.add(url);
    const res = await page.request.get(url, { maxRedirects: 5 });
    const html = await res.text();
    if (res.status() >= 400 || /This screen isn’t here any more|That didn’t load/.test(html)) {
      bad.push(`${url} → ${res.status()}`);
      continue;
    }
    for (const m of html.matchAll(/href="([^"]+)"/g)) {
      const href = m[1].replace(/&amp;/g, "&");
      if (!skip(href) && !seen.has(href.split("#")[0])) queue.push(href);
    }
  }
  expect(bad, `dead ends:\n${bad.join("\n")}`).toEqual([]);
  expect(seen.size, "pages checked").toBeGreaterThan(30);
  await ctx.close();
  await R.context().close();
});
