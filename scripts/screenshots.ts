// Takes phone-sized screenshots of every screen (used by the GitHub check so
// the design can be reviewed). Needs the app running on :3000 and .demo.json.
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, webkit, type Page } from "playwright";
import { SESSION_COOKIE, encodeSession } from "../src/lib/session";
import { guessCategory } from "../src/lib/categories";

import { base, hosted, signInOnTestCopy, withBypass } from "./hosted";
import { assertMomentPhotosDecoded, realPhotos } from "./moment-shots";
const demo = JSON.parse(readFileSync(".demo.json", "utf8"));
// SHOT_ENGINE=webkit: the same screens in Safari's engine (iPhone), saved to screenshots/ios.
// SHOT_ENGINE=desktop: the same screens on a 1440×900 desktop (Chromium, no touch), saved to screenshots/desktop.
const ios = process.env.SHOT_ENGINE === "webkit";
const desktop = process.env.SHOT_ENGINE === "desktop";
const out = ios ? "screenshots/ios" : desktop ? "screenshots/desktop" : "screenshots";
const screen = desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 };
mkdirSync(out, { recursive: true });

async function main() {
const browser = withBypass(await (ios ? webkit : chromium).launch());
const context = await browser.newContext({
  viewport: screen,
  deviceScaleFactor: desktop ? 1 : 2,
  ...(ios ? { isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" } : {}),
  colorScheme: "dark",
  reducedMotion: "reduce", // the Home cards stop sliding, so a picture never catches a card half-way
  locale: "en-IN",
  timezoneId: "Asia/Kolkata",
});
if (hosted) await signInOnTestCopy(context, Object.values(demo.memberships) as string[]);
else
  await context.addCookies([
    { name: SESSION_COOKIE, value: await encodeSession({ m: demo.memberships }), url: base },
  ]);
const page = await context.newPage();

async function shot(name: string, path: string, prepare?: (p: Page) => Promise<void>, fullPage = true) {
  try {
    await page.goto(base + path, { waitUntil: hosted ? "load" : "networkidle", timeout: 30_000 });
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
  // The QR code now sits under "More ways".
  await p.locator("[data-more-ways] > summary").click();
  await p.locator("[data-more-ways] details.group\\/link > summary").click();
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
await shot("21b-insights-week", "/search?p=w", undefined, false);
await shot("21c-insights-spent-year", "/search?v=spent&p=y", undefined, false);
await shot("21d-insights-flat", `/search?g=${demo.flat.id}`);
await shot("22-settle-everything", `${g}/settle`, async (p) => {
  await p.getByText("Other ways to settle").click();
  await p.getByRole("button", { name: /Settle everything/ }).scrollIntoViewIfNeeded();
}, false);
await shot("23-add-expense-differently", `${g}/add`, async (p) => {
  await p.locator("[data-row-paid]").first().click(); // tap the Paid by row to open the payer and split controls
  await p.getByRole("button", { name: /Custom/ }).click();
  await p.locator("[data-more] > button").click(); // More: notes, several payers, spin
  await p.getByRole("button", { name: /Today.*Change/ }).first().click();
  await p.waitForTimeout(300);
});
await shot("28-settle", "/settle");
await shot("35-how-it-works", "/how-it-works", async (p) => {
  // Scroll through once so every photo and app screen has loaded, as it would for a reader.
  const h = await p.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < h; y += 500) {
    await p.evaluate((top) => window.scrollTo(0, top), y);
    await p.waitForTimeout(120);
  }
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(1500);
});
await shot("36-guide-flatmates", "/how-it-works#home", async (p) => {
  await p.locator("#home").scrollIntoViewIfNeeded();
  await p.waitForTimeout(2500);
}, false);
await shot("37-guide-restaurant", "/how-it-works#add", async (p) => {
  await p.locator("#add").scrollIntoViewIfNeeded();
  await p.waitForTimeout(2500);
}, false);
await shot("38-guide-abroad", "/how-it-works#abroad", async (p) => {
  await p.locator("#abroad").scrollIntoViewIfNeeded();
  await p.waitForTimeout(2500);
}, false);
await shot("32-group-settle", `${g}/settle`);
await shot("S1-settle-pass", "/settle"); // all groups
await shot("S2-group-settle-pass", `${g}/settle`);
for (const w of [320] as const) {
  if (desktop) break;
  await page.setViewportSize({ width: w, height: 640 });
  await shot(`n${w}-S1-settle-pass`, "/settle");
  await shot(`n${w}-S2-group-settle-pass`, `${g}/settle`);
  await page.setViewportSize(screen);
}
await shot("29-why", `${g}?tab=balances&why=${demo.trip.me}#why-${demo.trip.me}`);
await shot("30-add-only-some", `${g}/add`, async (p) => {
  await p.locator("[data-row-paid]").first().click(); // tap the Paid by row to open the payer and split controls
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
  await p.getByRole("button", { name: "Details", exact: true }).click();
  await p.waitForTimeout(300);
});
await shot("39-new-group-types", "/groups/new", async (p) => {
  await p.getByRole("button", { name: /^Home/ }).click();
}, false);
await shot("40-couple-split", "/groups/new", async (p) => {
  await p.getByRole("button", { name: /^Couple/ }).click();
  await p.locator('input[name="groupName"]').fill("Us");
  await p.getByRole("button", { name: "Next" }).click();
  await p.getByRole("radio", { name: "By income" }).click();
  await p.getByLabel("You earn a month").fill("110000");
  await p.getByLabel("Your partner earns").fill("90000");
}, false);
await shot("41-add-payers-shares", `${g}/add`, async (p) => {
  await p.locator("#expense-name").fill("Dinner at Bastian");
  await p.getByLabel("Amount", { exact: true }).fill("3000");
  await p.locator("[data-more] > button").click();
  await p.getByRole("switch", { name: /More than one person paid/ }).click();
  await p.locator("[data-row-paid]").first().click(); // tap the Paid by row to open the payer and split controls
  await p.getByRole("button", { name: /Custom/ }).click();
  await p.getByRole("button", { name: "Shares", exact: true }).click();
});
await shot("42-filters", `${g}?tab=activity`, async (p) => {
  await p.getByText("Filter", { exact: true }).click();
});
await shot("43-settings-sharing", `${g}/settings#sharing`);
// Home & Couple (Phase 4)
const f = `/groups/${demo.flat.id}`;
const c = `/groups/${demo.couple.id}`;
await shot("50-flat-month", f);
await shot("G7-flat-overview", f);
await shot("G8-flat-bills", f, async (p) => {
  await p.locator('a[href*="tab=bills"]').first().click(); // from the Overview tile, so the page shows "‹ Overview"
  await p.waitForURL(/tab=bills/);
  await p.waitForTimeout(600);
});
await shot("51-flat-bills", `${f}?tab=bills`);
await shot("52-add-bill", `${f}/bills/new`);
await shot("53-add-bill-electricity", `${f}/bills/new`, async (p) => {
  await p.getByRole("button", { name: "Electricity" }).click();
  await p.waitForTimeout(200);
});
await shot("54-flat-list", `${f}?tab=list`);
await shot("55-flat-budgets", `${f}/budgets`);
await shot("56-flat-deposit", `${f}/deposit`);
await shot("57-move-out", `${f}/people/${demo.flat.kabir}/move`);
await shot("58-flat-settings-reminders", `${f}/settings#settling`);
await shot("59-couple-month", c);
if (demo.couple.goal) await shot("60-couple-goal", `${c}/goals/${demo.couple.goal}`);
await shot("61-new-goal", `${c}/goals/new`);
await shot("15-new-group", "/groups/new");
await shot("25-account", "/account");
await shot("25b-groups", "/groups");
await shot("26-signin", "/signin", undefined, false);
// Sign-in on small phones: Google and the email box must both be on the first screen.
for (const [n, w, h] of [["26b-signin-320x568", 320, 568], ["26c-signin-375x667", 375, 667]] as const) {
  await page.setViewportSize({ width: w, height: h });
  await shot(n, "/signin", undefined, false);
}
await page.setViewportSize(screen);
await shot("27-privacy", "/privacy");
// Narrow phones (320 and 360 wide): the screens people use most and the ones changed lately, with a long name in the
// group, so a reviewer can check nothing is cut off, overlapping or pushed sideways. (Phones only, not desktop.)
if (!desktop && !hosted) {
  const { db } = await import("../src/lib/db");
  const other = await db.member.findFirst({ where: { groupId: demo.trip.id, accountId: null, leftAt: null }, orderBy: { createdAt: "asc" } });
  const was = other?.name;
  if (other) await db.member.update({ where: { id: other.id }, data: { name: "Bhagyalakshmi Venkataraman" } }).catch(() => undefined);
  for (const w of [320, 360] as const) {
    await page.setViewportSize({ width: w, height: w === 320 ? 640 : 780 });
    for (const [n, path] of [
      ["home", "/"],
      ["activity", `${g}?tab=activity`],
      ["balances", `${g}?tab=balances`],
      ["settle", `${g}/settle`],
      ["add", `${g}/add`],
      ["pay", `${g}/pay`],
      ["account", "/account"],
      ["notifications", "/account/notifications"],
      ["support", "/support"],
      ["tour", "/welcome"],
    ] as const) {
      await shot(`n${w}-${n}`, path);
    }
  }
  if (other && was) await db.member.update({ where: { id: other.id }, data: { name: was } }).catch(() => undefined);
  await page.setViewportSize(screen);
}
// Home's money card in every state (phones only). The demo data only shows one of them, so this puts the viewer's money into each
// state in turn, takes Home at 390, 360 and 320, then puts everything back. How:
//   - the viewer's live expenses and payments in the three open groups (trip, flat, couple) are soft-deleted (deletedAt set), so every
//     balance is 0 and Home says "All square". They are restored at the end by clearing deletedAt on exactly those ids;
//   - each state adds one or two plain expenses (one payer, exact shares that add up to the amount, no events, so nothing shows in
//     Alerts or Latest), and they are deleted for good when the next state starts.
// The groups' own balances only come from live expenses and payments (src/lib/balances-db.ts), so this is all the card needs.
// Finally Home is read again and must say exactly what it said before; if not, the run fails.
if (!desktop && !hosted) {
  const { db } = await import("../src/lib/db");
  const tripId = demo.trip.id as string;
  const flatId = demo.flat.id as string;
  const open3 = [tripId, flatId, demo.couple.id as string];
  const members = async (groupId: string) => new Map((await db.member.findMany({ where: { groupId } })).map((m) => [m.name, m.id]));
  const trip = await members(tripId);
  const flat = await members(flatId);
  const [V, A, R, M] = ["Varun", "Asha", "Ravi", "Meera"].map((n) => trip.get(n)!);
  const [FV, FK] = ["Varun", "Kabir"].map((n) => flat.get(n)!);
  const card = () => page.getByRole("region", { name: "Your money" });
  const read = async () => {
    await page.setViewportSize(screen);
    await page.goto(base + "/", { waitUntil: "networkidle", timeout: 30_000 });
    await card().waitFor();
    return `${await card().getAttribute("data-ticket")} | ${(await card().innerText()).replace(/\s+/g, " ").trim()}`;
  };
  const before = await read();

  const hadExpenses = await db.expense.findMany({ where: { groupId: { in: open3 }, deletedAt: null }, select: { id: true } });
  const hadPayments = await db.payment.findMany({ where: { groupId: { in: open3 }, deletedAt: null }, select: { id: true } });
  const made: string[] = [];
  // One expense: `by` paid `amount` paise, split exactly as `shares` (member id, paise) says; the shares add up to the amount.
  const addExpense = async (groupId: string, by: string, shares: [string, number][], description = "Dinner at Jay Fai") => {
    const amount = shares.reduce((t, [, a]) => t + a, 0);
    const e = await db.expense.create({
      data: { groupId, description, amount, splitType: "exact", forMode: "selected", paidById: by, createdById: by, shares: { create: shares.map(([memberId, a]) => ({ memberId, amount: a })) } },
    });
    made.push(e.id);
  };
  const clearMade = async () => {
    if (made.length) await db.expense.deleteMany({ where: { id: { in: made } } }); // their shares go with them
    made.length = 0;
  };
  const problems: string[] = [];
  // [name, how the viewer's money is set up, what the card must say (so a broken setup is noticed, not photographed)]
  const states: [string, () => Promise<void>, { kind: string; has: RegExp }][] = [
    // Asha paid ₹54,122 for a trip bill that is only Varun's share: Varun owes Asha 5412200 paise, nobody else owes anyone.
    ["owe", () => addExpense(tripId, A, [[V, 5412200]], "Boat tickets"), { kind: "one", has: /^one \| .*From To YOU ASH .*₹54,122 .*Pay Asha$/ }],
    // Varun paid ₹22,916 for Kabir's share of the flat: Kabir owes Varun 2291600 paise.
    ["owed-one", () => addExpense(flatId, FV, [[FK, 2291600]], "Rent share"), { kind: "one", has: /^one \| .*From To KAB YOU .*₹22,916 .*Remind Kabir$/ }],
    // Varun paid ₹31,480 for the trip, shared by Asha 12,000 + Ravi 11,000 + Meera 8,480 (1200000 + 1100000 + 848000 = 3148000 paise).
    ["owed-several", () => addExpense(tripId, V, [[A, 1200000], [R, 1100000], [M, 848000]], "Dinner at Jay Fai"), { kind: "one", has: /^one \| .*From To 3 PPL YOU .*₹31,480 .*Remind 3 people$/ }],
    // Both ways, in two groups so nobody is netted: Varun owes Asha ₹4,200 (trip) and Kabir owes Varun ₹22,916 (flat).
    ["both", async () => { await addExpense(tripId, A, [[V, 420000]], "Boat tickets"); await addExpense(flatId, FV, [[FK, 2291600]], "Groceries"); }, { kind: "both", has: /^both \| .*From To KAB YOU .*₹22,916 .*Remind Kabir .*From To YOU ASH .*₹4,200 .*Pay Asha$/ }],
    // Nothing added: every balance is 0.
    ["square", async () => undefined, { kind: "square", has: /^square \| .*All square.*Nobody owes anybody.*SETTLED.*Add an expense$/ }],
  ];
  try {
    await db.expense.updateMany({ where: { id: { in: hadExpenses.map((x) => x.id) } }, data: { deletedAt: new Date() } });
    await db.payment.updateMany({ where: { id: { in: hadPayments.map((x) => x.id) } }, data: { deletedAt: new Date() } });
    for (const [name, setup, want] of states) {
      await clearMade();
      await setup();
      const now = await read();
      if (!want.has.test(now)) problems.push(`home-state-${name} says: ${now}`);
      await page.setViewportSize(screen);
      await shot(`home-state-${name}`, "/");
      await shot(`H1-home-pass-${name}`, "/");
      if (name === "owe" || name === "both") {
        await page.setViewportSize({ width: 320, height: 640 });
        await shot(`n320-H1-home-pass-${name}`, "/");
        await page.setViewportSize(screen);
      }
      for (const w of [360, 320] as const) {
        await page.setViewportSize({ width: w, height: w === 320 ? 640 : 780 });
        await shot(`n${w}-home-state-${name}`, "/");
      }
      // A long first name on the narrowest phone: the button says "Pay Bhagyalakshmi" (cut with "…" only if it cannot fit), the route
      // codes stay whole (BHA), and the amount stays whole.
      if (name === "owe") {
        const asha = await db.member.findUnique({ where: { id: A } });
        await db.member.update({ where: { id: A }, data: { name: "Bhagyalakshmi Venkataraman" } });
        await page.setViewportSize({ width: 320, height: 640 });
        await shot("n320-home-state-owe-longname", "/");
        if (asha) await db.member.update({ where: { id: A }, data: { name: asha.name } });
      }
    }
  } finally {
    await clearMade();
    await db.expense.updateMany({ where: { id: { in: hadExpenses.map((x) => x.id) } }, data: { deletedAt: null } });
    await db.payment.updateMany({ where: { id: { in: hadPayments.map((x) => x.id) } }, data: { deletedAt: null } });
    await db.member.update({ where: { id: A }, data: { name: "Asha" } }).catch(() => undefined);
  }
  const after = await read();
  if (after !== before) problems.push(`Home did not come back after the state shots.\n  before: ${before}\n  after:  ${after}`);
  if (problems.length) throw new Error(`Home money-card states:\n  ${problems.join("\n  ")}`);
  console.log("✓ Home money-card states restored: Home reads the same as before");
  await page.setViewportSize(screen);
}
// Phase 5
await shot("62-trip-report", `${g}/report`);
await shot("63-charts-insights", `${g}?tab=charts`, undefined, false);
await shot("64-switching", "/switching");
await shot("65-import", "/import");
await shot("66-people-not-on-loopin", `${g}/people`);
await shot("67-splash", "/splash", undefined, false);
// The first screen of a small phone (375×667): header, stories, the boarding-pass money card with its one button, the start of the group row.
const wide = page.viewportSize();
await shot("68-home-first-screen", "/", async (p) => {
  await p.setViewportSize({ width: 375, height: 667 });
  await p.waitForTimeout(400);
}, false);
if (wide) await page.setViewportSize(wide);
// The whole Home at 390 (stories, boarding pass, groups, countdown, latest, the month card).
await shot("69-home-full", "/");
// The Home cards, each one (paused, then picked by its dot), at 390 and on the narrowest phone (320).
for (const [prefix, w] of [["69", undefined], ["n320-69", 320]] as const) {
  if (w) await page.setViewportSize({ width: w, height: 640 });
  for (const n of [1, 2, 3, 4]) {
    await shot(`${prefix}-home-card-${n}`, "/", async (p) => {
      await p.getByRole("button", { name: /Pause the highlights/ }).click();
      await p.getByRole("button", { name: new RegExp(`^Show ${n} of`) }).click();
      await p.waitForTimeout(900);
    }, false);
  }
  if (w) await page.setViewportSize(wide ?? screen);
}
// Collect: the organiser's screens, then what someone opening the link sees.
let collectCode = "";
if (!hosted) {
  const { db } = await import("../src/lib/db");
  const acc = await db.account.create({ data: { email: `shots-collect-${Date.now()}@uat.loopin.test`, name: "Varun" } });
  const priya = await db.account.create({ data: { email: `shots-priya-${Date.now()}@uat.loopin.test`, name: "Priya" } });
  const due = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const now = Date.now();
  const at = (minsAgo: number) => new Date(now - minsAgo * 60_000);
  const made = await db.collection.create({
    data: {
      code: `shots${now.toString(36)}`, title: "Teacher’s Day gift", note: "A plant and a card for Mrs Rao", currency: "INR", amount: 30000, dueDate: due,
      upiId: "varun@okicici", accountId: acc.id, organiser: "Varun",
      entries: { create: [
        { name: "Ravi", amount: 30000, status: "confirmed", method: "upi", paidAt: at(300), confirmedAt: at(200) },
        { name: "Meera", amount: 30000, status: "paid", method: "upi", payerKey: "shotsPayerKey0000000001", paidAt: at(20) },
        { name: "Kabir", amount: 30000, status: "confirmed", method: "cash", paidAt: at(100), confirmedAt: at(100) },
        { name: "Zoya", phone: "+919876500001" }, { name: "Arjun", phone: "+919876500002" }, { name: "Priya", accountId: priya.id },
      ] },
    },
  });
  collectCode = made.code;
  await context.addCookies([{ name: SESSION_COOKIE, value: await encodeSession({ m: demo.memberships, a: acc.id }), url: base }]);
  await shot("70-collect-new", "/collect/new");
  await shot("71-collect-organiser", `/c/${collectCode}`);
  await db.accountNote.createMany({
    data: [
      { accountId: acc.id, kind: "collect_ticked", title: "Teacher’s Day gift", body: "Meera says they paid ₹300. Tap to check it off.", url: `/c/${collectCode}` },
      { accountId: acc.id, kind: "collect_added", title: "Diwali fund", body: "Nupur added you: ₹500 each. Tap to pay and tick your name.", url: `/c/${collectCode}`, seenAt: new Date() },
    ],
  });
  await shot("83-alerts-collect", "/notifications?tab=all", undefined, false);
  // A trip in 12 days, for the countdown.
  const ist = (plus: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(now + plus * 86_400_000));
  const goa = await db.group.create({
    data: {
      name: "Goa trip", type: "trip", currency: "INR", inviteCode: `shotsgoa${now.toString(36)}`, cover: "beach", tripStart: ist(12), tripEnd: ist(16),
      members: { create: [{ name: "Varun", accountId: acc.id, claimedAt: new Date() }, { name: "Nupur" }, { name: "Ravi" }, { name: "Meera" }, { name: "Kabir" }] },
    },
  });
  // Every destination photo with its name, to check each one shows the right place.
  {
    const got = JSON.parse(readFileSync("src/generated/photos.json", "utf8")) as Record<string, { src: string }>;
    const tiles = Object.entries(got)
      .filter(([k]) => k.startsWith("place-") || ["cover-paris", "cover-taj", "cover-beach", "cover-mountains", "cover-city", "cover-snow", "cover-road-in"].includes(k))
      .map(([k, v]) => `<figure style="margin:0;width:180px"><img src="${base}${v.src}" style="width:180px;height:130px;object-fit:cover;border-radius:8px"><figcaption style="font:12px sans-serif;color:#ddd;margin-top:4px">${k}</figcaption></figure>`)
      .join("");
    try {
      await page.setContent(`<body style="margin:0;padding:12px;background:#111;display:flex;flex-wrap:wrap;gap:10px;width:780px">${tiles}</body>`, { waitUntil: "load", timeout: 30_000 });
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${out}/82-place-photos.png`, fullPage: true });
      console.log("✓ 82-place-photos");
    } catch (e) {
      console.log("✗ 82-place-photos", String(e).split("\n")[0]);
    }
  }
  await shot("72-home-collecting", "/");
  await shot("76-home-countdown", "/", undefined, false);
  await shot("91-home-share-sheet", "/", async (p) => {
    await p.getByRole("region", { name: "Trip countdown", exact: true }).first().getByRole("button", { name: "Share" }).click();
    await p.getByRole("dialog", { name: "Share the countdown" }).waitFor();
    await p.waitForTimeout(400); // the sheet slides up and fades in (220 ms): take the picture once it's there
  }, false);
  // A second trip further out: Home turns the countdown into a row to swipe.
  await db.group.create({
    data: {
      name: "Manali trip", type: "trip", currency: "INR", inviteCode: `shotsmanali${now.toString(36)}`, cover: "mountains", tripStart: ist(45), tripEnd: ist(50),
      members: { create: [{ name: "Varun", accountId: acc.id, claimedAt: new Date() }, { name: "Nupur" }, { name: "Kabir" }] },
    },
  });
  // One countdown, the other trip as an "Also:" line inside it.
  await shot("84-home-countdown-also", "/", undefined, false);
  await page.setViewportSize({ width: 360, height: 780 });
  await shot("85-home-countdown-also-narrow", "/", undefined, false);
  await page.setViewportSize(screen);
  await shot("77-group-countdown", `/groups/${goa.id}`, undefined, false);
  await shot("77b-group-weather", `/groups/${goa.id}`, async (p) => {
    await p.locator("[data-trip-weather] summary").click();
    await p.waitForTimeout(400);
  }, false);
  await shot("78-countdown-image", `/groups/${goa.id}/countdown-image`, undefined, false);
  await shot("79-settings-trip-dates", `/groups/${goa.id}/settings#trip`, undefined, false);
  await db.group.update({ where: { id: goa.id }, data: { tripStart: ist(3), tripEnd: ist(6) } });
  await shot("80-home-countdown-close", "/", undefined, false);
  await db.group.update({ where: { id: goa.id }, data: { tripStart: ist(-1), tripEnd: ist(3) } });
  await shot("81-group-countdown-during", `/groups/${goa.id}`, undefined, false);
  // Game night: a group with a finished game (the brief's example) and one being played.
  {
    const { startGame, recordMove, finishGame } = await import("../src/lib/pot-db");
    const pot = await db.group.create({
      data: {
        name: "Diwali game night", type: "pot", currency: "INR", inviteCode: `shotspot${now.toString(36)}`,
        members: { create: [{ name: "Varun", accountId: acc.id, claimedAt: new Date() }, { name: "Ravi" }, { name: "Meera" }, { name: "Kabir" }] },
      },
      include: { members: { orderBy: { createdAt: "asc" } } },
    });
    const [v, r, m, k] = ["Varun", "Ravi", "Meera", "Kabir"].map((n) => pot.members.find((x) => x.name === n)!.id);
    const one = await startGame(pot.id, v, { name: "Round 1", game: "cards", players: [v, r, m, k] });
    if (one.ok) {
      for (const [who, a] of [[v, "1000"], [r, "2000"], [m, "500"], [k, "1000"], [k, "500"]] as const) await recordMove(one.id, v, { memberId: who, kind: "take", amount: a });
      for (const [who, a] of [[v, "1600"], [r, "1700"], [m, "300"], [k, "1400"]] as const) await recordMove(one.id, v, { memberId: who, kind: "return", amount: a });
      await finishGame(one.id, v);
    }
    const two = await startGame(pot.id, v, { name: "Round 2", game: "board", players: [v, r, m, k] });
    if (two.ok) {
      for (const [who, a] of [[v, "2000"], [r, "1000"], [m, "1000"], [k, "2000"]] as const) await recordMove(two.id, r, { memberId: who, kind: "take", amount: a, note: who === k ? "second chips in later" : "" });
      await recordMove(two.id, m, { memberId: m, kind: "return", amount: "1500" });
      await recordMove(two.id, v, { memberId: r, kind: "return", amount: "0" });
    }
    await shot("92-pot-games", `/groups/${pot.id}`, undefined, false);
    await shot("G9-pot-group", `/groups/${pot.id}`);
    if (two.ok) await shot("93-pot-live", `/groups/${pot.id}/pot/${two.id}`);
    if (one.ok) await shot("94-pot-done", `/groups/${pot.id}/pot/${one.id}`);
    await shot("95-pot-new-game", `/groups/${pot.id}/pot/new`, undefined, false);
    await shot("96-new-group-menu", "/groups/new", undefined, false);
  }
  // Phase 7–8: Priya added her UPI ID, so Varun gets "Pay ₹1,000 · UPI"; Nupur
  // says she paid Varun ₹500 and he's asked "Got it ✓"; the quick line.
  {
    await db.account.update({ where: { id: priya.id }, data: { upiId: "priya@okhdfcbank", payLink: "https://paypal.me/priya" } });
    const pune = await db.group.create({
      data: {
        name: "Weekend in Pune", type: "trip", currency: "INR", inviteCode: `shotspune${now.toString(36)}`, cover: "city",
        members: { create: [{ name: "Varun", accountId: acc.id, claimedAt: new Date() }, { name: "Priya", accountId: priya.id, claimedAt: new Date() }, { name: "Nupur", claimedAt: new Date() }] },
      },
      include: { members: true },
    });
    const [v, pr, n] = ["Varun", "Priya", "Nupur"].map((x) => pune.members.find((m) => m.name === x)!.id);
    const spent = (description: string, amount: number, paidById: string) =>
      db.expense.create({
        data: {
          groupId: pune.id, description, amount, splitType: "equal", forMode: "everyone", category: guessCategory(description), paidById,
          originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount, createdById: paidById, spentAt: new Date(),
          shares: { create: [v, pr, n].map((memberId) => ({ memberId, amount: amount / 3 })) },
        },
      });
    await spent("Dinner at Malaka Spice", 300000, pr);
    await spent("Cab to Lonavala", 150000, v);
    await db.payment.create({ data: { groupId: pune.id, fromId: n, toId: v, amount: 50000, createdById: n, needsOk: true } });
    await shot("97-settle-pay-and-confirm", `/groups/${pune.id}/settle`);
    await shot("99-add-quick-line", `/groups/${pune.id}/add`, async (p) => {
      await p.getByRole("button", { name: "Type a line" }).click();
      await p.getByLabel("Type the expense in one line").fill("Snacks 450 Priya paid split with Nupur");
      await p.getByRole("button", { name: "Fill", exact: true }).click();
      await p.waitForTimeout(300);
    }, false);

    await shot("99b-add-expense-tidy", `/groups/${pune.id}/add`, undefined, false);
    await shot("99c-add-expense-more-open", `/groups/${pune.id}/add`, async (p) => {
      await p.locator("[data-more] > button").click();
      await p.waitForTimeout(250);
    }, false);

    // The fun layer: reactions, spin the wheel, Wrapped, all square, stories, passport.
    const dinner = await db.expense.findFirst({ where: { groupId: pune.id, description: "Dinner at Malaka Spice" } });
    if (dinner) {
      await db.reaction.createMany({ data: [{ expenseId: dinner.id, memberId: pr, emoji: "🔥" }, { expenseId: dinner.id, memberId: n, emoji: "😂" }, { expenseId: dinner.id, memberId: v, emoji: "🔥" }] });
      await shot("100-reactions", `/groups/${pune.id}?tab=activity&open=${dinner.id}`, undefined, false);
    }
    for (const [d, by, cat] of [["Breakfast at Vohuman", n, "food"], ["Late-night Maggi", pr, "food"], ["Auto to FC Road", v, "transport"]] as const) await spent(d, 90000, by).then((e) => db.expense.update({ where: { id: e.id }, data: { category: cat } }));
    await shot("101-spin-wheel", `/groups/${pune.id}/add`, async (p) => {
      await p.locator("[data-more] > button").click();
      await p.getByRole("button", { name: /Spin for it/ }).click();
      await p.getByRole("dialog", { name: "Spin the wheel" }).getByRole("button", { name: "Spin", exact: true }).click();
      await p.waitForTimeout(4900);
    }, false);
    await shot("101b-spin-wheel-ready", `/groups/${pune.id}/add`, async (p) => {
      await p.locator("[data-more] > button").click();
      await p.getByRole("button", { name: /Spin for it/ }).click();
      await p.waitForTimeout(500);
    }, false);
    await shot("102-wrapped-intro", `/groups/${pune.id}/wrapped`, undefined, false);
    for (const [n, kind] of [["103-wrapped-awards", "awards"], ["114-wrapped-total", "total"], ["115-wrapped-category", "category"], ["116-wrapped-day", "day"], ["117-wrapped-splurge", "splurge"]] as const)
      await shot(n, `/groups/${pune.id}/wrapped`, async (p) => {
        for (let k = 0; k < 7; k++) {
          if ((await p.locator(`[data-wrapped-slide='${kind}']`).count()) > 0) break;
          await p.getByRole("button", { name: "Next" }).click();
          await p.waitForTimeout(250);
        }
        await p.waitForTimeout(1000);
      }, false);
    await shot("104-balances-titles", `/groups/${pune.id}?tab=balances`);
    const lona = await db.group.create({
      data: {
        name: "Lonavala weekend", type: "trip", currency: "INR", inviteCode: `shotslona${now.toString(36)}`, cover: "mountains",
        members: { create: [{ name: "Varun", accountId: acc.id, claimedAt: new Date() }, { name: "Ravi" }] },
      },
      include: { members: true },
    });
    const [lv, lr] = ["Varun", "Ravi"].map((x) => lona.members.find((m) => m.name === x)!.id);
    await db.expense.create({ data: { groupId: lona.id, description: "Villa", amount: 800000, splitType: "equal", forMode: "everyone", category: "accommodation", paidById: lv, originalAmount: 800000, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: 800000, createdById: lv, spentAt: new Date(), shares: { create: [{ memberId: lv, amount: 400000 }, { memberId: lr, amount: 400000 }] } } });
    await db.payment.create({ data: { groupId: lona.id, fromId: lr, toId: lv, amount: 400000, createdById: lr } });
    await shot("105-all-square", `/groups/${lona.id}/square`);
    await shot("105b-all-square-amounts-hidden", `/groups/${lona.id}/square?amounts=0`); // "Hide amounts" on: counts instead of money
    // Stories as a row of circles under the header: gold ring for new, faint for seen.
    await shot("106-home-stories", "/", undefined, false);
    await shot("107-story-open", "/", async (p) => {
      await p.locator("[data-stories] button").first().click();
      await p.waitForTimeout(700);
    }, false);
    await db.account.update({ where: { id: acc.id }, data: { places: JSON.stringify([{ c: "TH" }, { c: "IT" }, { c: "AT" }, { c: "HR" }]) } });
    await shot("108-passport", "/passport", undefined, false);
    // 108 shows the one-time question; from here Varun has said Show.
    await db.account.update({ where: { id: acc.id }, data: { passportChoiceAt: new Date() } });
    await shot("109-passport-open", "/passport?book=1", async (p) => {
      await p.getByRole("button", { name: "Open your passport" }).click();
      await p.waitForTimeout(800);
    }, false);
    await shot("110-passport-stamps", "/passport?book=1", async (p) => {
      await p.getByRole("button", { name: "Open your passport" }).click();
      await p.waitForTimeout(800);
      await p.getByRole("button", { name: "Next page" }).click();
      await p.waitForTimeout(700);
    }, false);
    await shot("111-passport-been", "/passport?book=1", async (p) => {
      await p.getByRole("button", { name: "Open your passport" }).click();
      await p.waitForTimeout(800);
      const pages = await p.locator("[data-page]").count();
      for (let k = 1; k < pages - 1; k++) {
        await p.getByRole("button", { name: "Next page" }).click();
        await p.waitForTimeout(150);
      }
      await p.waitForTimeout(700);
    }, false);
    await shot("112-passport-index", "/passport?book=1", async (p) => {
      await p.getByRole("button", { name: "Open your passport" }).click();
      await p.waitForTimeout(800);
      const pages = await p.locator("[data-page]").count();
      for (let k = 1; k < pages; k++) {
        await p.getByRole("button", { name: "Next page" }).click();
        await p.waitForTimeout(150);
      }
      await p.waitForTimeout(700);
    }, false);
    // Postcards: one from Meera (received, a Goa photo), one sent back (a print), the composer.
    const meera = await db.account.create({ data: { email: `shots-meera-${Date.now()}@uat.loopin.test`, name: "Meera", passportChoiceAt: new Date() } });
    await db.member.create({ data: { groupId: lona.id, name: "Meera", accountId: meera.id, claimedAt: new Date() } });
    // R3, Want to go: Varun wants Japan and Iceland, Meera wants Japan and Peru. Varun shows Japan to Meera: 108b. Meera then shows
    // her whole list to Varun, so Japan is a match: 108c.
    for (const c of ["JP", "IS"]) await db.wishPlace.create({ data: { accountId: acc.id, country: c } });
    for (const c of ["JP", "PE"]) await db.wishPlace.create({ data: { accountId: meera.id, country: c } });
    await db.wishShare.create({ data: { ownerId: acc.id, friendId: meera.id, country: "JP" } });
    await shot("108b-want-to-go", "/passport?tab=want", undefined, false);
    await db.wishShare.create({ data: { ownerId: meera.id, friendId: acc.id, country: "*" } });
    await shot("108c-want-to-go-match", "/passport?tab=want", undefined, false);
    const got = await db.postcard.create({
      data: { fromId: meera.id, toId: acc.id, groupId: lona.id, front: "photo:/photos/place-goa.jpg", words: "Goa", lettering: "classic", message: "Wish you were here. The beach shack turned out to be the fancy dinner, Ravi forgot the rules of every card game, and we watched the sun go down three evenings in a row. Same time next year?", hand: "caveat", stamp: "c:IN", paper: "cream", look: "golden:70", touches: "seal,flower", address: JSON.stringify(["Varun", "the flat that never has milk", "Bengaluru"]), place: "Goa" },
    });
    await db.postcard.create({
      data: { fromId: acc.id, toId: meera.id, groupId: lona.id, front: "print:hills", words: "Lonavala", lettering: "italic", message: "Thank you for planning all of it.", hand: "homemade", stamp: "t:mountains", paper: "airmail", address: JSON.stringify(["Meera", "", ""]), place: "Lonavala", reaction: "miss", reactedAt: new Date() },
    });
    const sealedCard = await db.postcard.create({
      data: { fromId: meera.id, toId: acc.id, groupId: lona.id, front: "print:beach", words: "Goa", message: "Open this on New Year's.", stamp: "r:newyear", opensAt: new Date(Date.now() + 60 * 86_400_000), address: "[]", place: "Goa" },
    });
    await shot("128-postcard-received", `/postcards/${got.id}`, async (p) => {
      await p.waitForTimeout(1200);
    }, false);
    await shot("129-postcard-back", `/postcards/${got.id}`, async (p) => {
      await p.locator("[data-postcard-flip]").click();
      await p.waitForTimeout(1300);
    }, false);
    await shot("129b-postcard-seal-back", `/postcards/${got.id}`, async (p) => {
      await p.getByRole("region", { name: "Seal it back" }).scrollIntoViewIfNeeded();
      await p.waitForTimeout(800);
    }, false);
    await shot("129c-postcard-sealed", `/postcards/${sealedCard.id}`, async (p) => {
      await p.waitForTimeout(900);
    }, false);
    await shot("129d-stamp-album", "/postcards/stamps", async (p) => {
      await p.waitForTimeout(900);
    });
    await shot("150-category-food", "/search?c=food", async (p) => {
      await p.locator("[data-category-filter]").waitFor();
      await p.waitForTimeout(600);
    });
    await shot("130-postcards-shelf", "/postcards", async (p) => {
      await p.waitForTimeout(1000);
    });
    await shot("131-postcard-compose", `/postcards/new?group=${lona.id}`, async (p) => {
      await p.waitForTimeout(1200);
    }, false);
    await shot("132-postcard-compose-back", `/postcards/new?group=${lona.id}`, async (p) => {
      await p.getByRole("tab", { name: "Note" }).click();
      await p.getByRole("textbox", { name: "Your message" }).fill("Remember the bus that never came? Best wrong turn ever. Same time next year?");
      await p.waitForTimeout(1300);
    }, false);
    await shot("133-postcard-compose-send", `/postcards/new?group=${lona.id}`, async (p) => {
      await p.getByRole("tab", { name: "Send" }).click();
      await p.waitForTimeout(600);
    }, false);
    await shot("130b-postcard-front-colour", `/postcards/new?group=${lona.id}`, async (p) => {
      await p.getByRole("button", { name: "Gold words" }).click();
      await p.locator("[data-tones]").scrollIntoViewIfNeeded();
      await p.waitForTimeout(1200);
    }, false);
    await shot("131b-postcard-looks", `/postcards/new?group=${lona.id}`, async (p) => {
      await p.getByRole("button", { name: "Look: Faded 70s" }).click();
      await p.getByRole("button", { name: "Top", exact: true }).click();
      await p.getByRole("button", { name: "Pressed flower" }).click();
      await p.locator("[data-looks]").scrollIntoViewIfNeeded();
      await p.waitForTimeout(1300);
    }, false);
    await shot("133b-postcard-sealed-choice", `/postcards/new?group=${lona.id}`, async (p) => {
      await p.getByRole("tab", { name: "Note" }).click();
      await p.getByRole("textbox", { name: "Your message" }).fill("Open this on New Year's.");
      await p.getByRole("tab", { name: "Send" }).click();
      await p.getByRole("button", { name: "New Year’s Day" }).click();
      await p.locator("[data-opens]").scrollIntoViewIfNeeded();
      await p.waitForTimeout(800);
    }, false);
    await shot("132c-postcard-wax-seal", `/postcards/new?group=${lona.id}`, async (p) => {
      await p.getByRole("tab", { name: "Note" }).click();
      await p.getByRole("textbox", { name: "Your message" }).fill("Remember the bus that never came? Best wrong turn ever.");
      await p.getByRole("button", { name: "Wax seal" }).click();
      await p.getByRole("button", { name: "Coffee ring" }).click();
      await p.getByRole("button", { name: "Gold wax", exact: true }).click();
      await p.getByRole("button", { name: "Seal design: Crest" }).click();
      await p.locator("[data-seal-picker]").scrollIntoViewIfNeeded();
      await p.waitForTimeout(1200);
    }, false);
    await shot("131c-postcard-front-touches", `/postcards/new?group=${lona.id}`, async (p) => {
      await p.getByRole("button", { name: "Tape" }).click();
      await p.getByRole("button", { name: "Pressed flower" }).click();
      await p.locator("[data-touches-front]").scrollIntoViewIfNeeded();
      await p.waitForTimeout(1200);
    }, false);
    await shot("132b-postcard-colours", `/postcards/new?group=${lona.id}`, async (p) => {
      await p.getByRole("tab", { name: "Note" }).click();
      await p.getByRole("textbox", { name: "Your message" }).fill("Remember the bus that never came? Best wrong turn ever. Same time next year?");
      await p.getByRole("button", { name: "Sepia ink" }).click();
      await p.getByRole("button", { name: "Sage paper" }).click();
      await p.locator("[data-papers]").scrollIntoViewIfNeeded();
      await p.waitForTimeout(1300);
    }, false);
    await shot("134-account-postcards", "/account", async (p) => {
      await p.locator("[data-postcards-link]").scrollIntoViewIfNeeded();
      await p.waitForTimeout(800);
    }, false);
    await shot("118-passport-picture", "/passport/image", undefined, false);
    await shot("118d-passport-share-sheet", "/passport", async (p) => {
      await p.getByRole("button", { name: "Share", exact: true }).click();
      await p.waitForTimeout(800);
    }, false);
    await db.account.update({ where: { id: priya.id }, data: { passportChoiceAt: new Date(), places: JSON.stringify([{ c: "JP" }, { c: "FR" }, { c: "GR" }, { c: "TH" }, { c: "AE" }, { c: "ID" }]) } });
    await shot("123-friends-passports", "/passport/friends", undefined, false);
    await shot("124-friend-passport", `/passport/friends/${priya.id}`, async (p) => {
      await p.getByRole("button", { name: "Open your passport" }).click();
      await p.waitForTimeout(800);
      await p.getByRole("button", { name: "Next page" }).click();
      await p.waitForTimeout(800);
    }, false);
    await shot("125-our-passports", `/groups/${pune.id}/passports`, undefined, false);
    await shot("125b-our-passports-only-you", `/groups/${pune.id}/passports`, async (p) => {
      await p.locator("[data-compare-tab='you']").click();
      await p.waitForTimeout(300);
    }, false);
    await shot("119-story-pot", "/", async (p) => {
      const pot = p.locator("[data-stories] [data-story='pot'] button");
      if (await pot.count()) await pot.first().click();
      await p.waitForTimeout(900);
    }, false);
    await shot("120-story-pot-table", "/", async (p) => {
      const pot = p.locator("[data-stories] [data-story='pot'] button");
      if (await pot.count()) await pot.first().click();
      await p.waitForTimeout(500);
      await p.getByRole("button", { name: "Next" }).click();
      await p.waitForTimeout(900);
    }, false);
    await shot("121-story-trip-2", "/", async (p) => {
      await p.locator("[data-stories] [data-story='trip'] button").first().click();
      await p.waitForTimeout(500);
      await p.getByRole("button", { name: "Next" }).click();
      await p.waitForTimeout(900);
    }, false);
    await shot("122-story-trip-3", "/", async (p) => {
      await p.locator("[data-stories] [data-story='trip'] button").first().click();
      await p.waitForTimeout(500);
      for (let k = 0; k < 2; k++) {
        await p.getByRole("button", { name: "Next" }).click();
        await p.waitForTimeout(300);
      }
      await p.waitForTimeout(900);
    }, false);
    // A contact sheet of the country photos in use, for review (countries with no photo show the drawn ring the passport uses).
    {
      const { COUNTRY_SLOT, countryPhoto } = await import("../src/lib/country-photos");
      const { countryOf } = await import("../src/lib/geo");
      const tiles = Object.keys(COUNTRY_SLOT).map((c) => ({ c, name: countryOf(c)?.name ?? c, src: countryPhoto(c) }));
      const html = `<body style="margin:0;background:#0d0d0f;color:#f4f2ec;font:12px sans-serif"><div style="display:grid;grid-template-columns:repeat(8,1fr);gap:8px;padding:12px">${tiles
        .map((t) => `<div>${t.src ? `<img src="${base}${t.src}" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px">` : `<div style="aspect-ratio:1;border-radius:10px;background:#efe8d6"></div>`}<div>${t.c} ${t.name}${t.src ? "" : " (no photo)"}</div></div>`)
        .join("")}</div></body>`;
      await page.setViewportSize({ width: 1200, height: 900 });
      await page.goto(base + "/");
      await page.setContent(html, { waitUntil: "load" });
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${out}/country-photos-contact-sheet.png`, fullPage: true });
      await page.setViewportSize(screen);
      console.log("✓ country-photos-contact-sheet");
    }
    await shot("113-passport-pick", "/passport", async (p) => {
      await p.getByRole("button", { name: "Add visited place" }).click();
      const sheet = p.getByRole("dialog", { name: "Add countries" });
      await sheet.getByRole("checkbox", { name: "Albania" }).check();
      await sheet.getByRole("checkbox", { name: "Andorra" }).check();
      await p.waitForTimeout(300);
    }, false);

    // --- Narrow phones (320 and 360): the postcard editor (Front and Note), Our passports and Wrapped ---
    {
      const before = page.viewportSize();
      for (const w of [320, 360] as const) {
        await page.setViewportSize({ width: w, height: w === 320 ? 640 : 780 });
        await shot(`n${w}-postcard-front`, `/postcards/new?group=${lona.id}`, async (p) => {
          await p.waitForTimeout(1200);
        }, false);
        await shot(`n${w}-postcard-note`, `/postcards/new?group=${lona.id}`, async (p) => {
          await p.getByRole("tab", { name: "Note" }).click();
          await p.getByRole("textbox", { name: "Your message" }).fill("Remember the bus that never came? Best wrong turn ever. Same time next year?");
          await p.waitForTimeout(1300);
        }, false);
        await shot(`n${w}-our-passports`, `/groups/${pune.id}/passports`, undefined, false);
        await shot(`n${w}-wrapped-intro`, `/groups/${pune.id}/wrapped`, undefined, false);
        await shot(`n${w}-wrapped-total`, `/groups/${pune.id}/wrapped`, async (p) => {
          for (let k = 0; k < 7; k++) {
            if ((await p.locator("[data-wrapped-slide='total']").count()) > 0) break;
            await p.getByRole("button", { name: "Next" }).click();
            await p.waitForTimeout(250);
          }
          await p.waitForTimeout(800);
        }, false);
        await shot(`n${w}-passport`, "/passport");
        await shot(`n${w}-want-to-go`, "/passport?tab=want"); // a match, a list and Add | Share
      }
      if (before) await page.setViewportSize(before);
    }

    // --- Passport Been tab (part P1): full, and long names, at 320 / 360 / 390 ---
    {
      const before = page.viewportSize();
      for (const w of [320, 360, 390] as const) {
        await page.setViewportSize({ width: w, height: 780 });
        await shot(`P1-been-full-${w}`, "/passport?all=1");
      }
      // Long names: a country with a long name, and two long city stops at home.
      await db.account.update({ where: { id: acc.id }, data: { homeCountry: "IN" } });
      await db.group.create({
        data: {
          name: "Balkans", type: "trip", currency: "EUR", inviteCode: `shotsbalk${now.toString(36)}`, tripStart: "2026-06-02", tripEnd: "2026-06-09", tripPlace: "Sarajevo, Mostar", tripCountry: "BA",
          members: { create: [{ name: "Varun", accountId: acc.id, claimedAt: new Date() }, { name: "Ravi" }] },
        },
      });
      await db.group.create({
        data: {
          name: "South tip", type: "trip", currency: "INR", inviteCode: `shotssouth${now.toString(36)}`, tripStart: "2026-07-01", tripEnd: "2026-07-04", tripPlace: "Thiruvananthapuram, Kanyakumari", tripCountry: "IN",
          members: { create: [{ name: "Varun", accountId: acc.id, claimedAt: new Date() }, { name: "Ravi" }] },
        },
      });
      for (const w of [320, 360, 390] as const) {
        await page.setViewportSize({ width: w, height: 780 });
        await shot(`P1-been-long-names-${w}`, "/passport?all=1");
      }
      await shot("P1-passport-book", "/passport?book=1", undefined, false);
      if (before) await page.setViewportSize(before);
    }
  }
}
// ===== MOMENTS (part M1): the strip, Our moments, the add form, the viewer, the report page and a Home story frame, at 320 / 360 / 390 =====
// A trip group made straight in the database with three people; each state is photographed as the person who sees it. (Local copy only.)
if (!hosted) {
  const { db } = await import("../src/lib/db");
  const tag = Date.now().toString(36);
  const acct = (n: string) => db.account.create({ data: { email: `shots-mo-${n.toLowerCase()}-${tag}@uat.loopin.test`, name: n } });
  const [varu, nupur, riya] = [await acct("Varu"), await acct("Nupur"), await acct("Riya")];
  // Real photos of the trip's place (the build's downloaded Thailand pictures), sent through the same form and /api/moment route a phone
  // uses (the form shrinks them to 1600 / 480 px). Never the app icon or a hand-made file: those hide real picture problems.
  const photos = realPhotos("thailand");
  let turn = 0;
  const nextPhoto = () => photos[turn++ % photos.length];
  const trip = async (name: string, riyaLeft?: Date, place = "Phuket") =>
    db.group.create({
      data: {
        name, type: "trip", currency: "THB", inviteCode: `shotsmo${tag}${Math.random().toString(36).slice(2, 6)}`, tripStart: "2026-11-10", tripEnd: "2026-11-14", tripPlace: place, tripCountry: "TH",
        members: {
          create: [
            { name: "Varu", accountId: varu.id, claimedAt: new Date(), createdAt: new Date(Date.now() - 5000) },
            { name: "Nupur", accountId: nupur.id, claimedAt: new Date(), createdAt: new Date(Date.now() - 4000) },
            { name: "Riya", accountId: riya.id, claimedAt: new Date(), createdAt: new Date(Date.now() - 3000), ...(riyaLeft ? { leftAt: riyaLeft } : {}) },
          ],
        },
      },
      include: { members: true },
    });
  const mins = (m: number) => new Date(Date.now() - m * 60_000);
  const uploaders = new Map<string, Page>();
  const uploader = async (acc: { id: string }) => {
    let up = uploaders.get(acc.id);
    if (!up) {
      const c = await browser.newContext({ viewport: screen, deviceScaleFactor: 1, ...(ios ? { isMobile: true, hasTouch: true } : {}), colorScheme: "dark", locale: "en-IN", timezoneId: "Asia/Kolkata" });
      await c.addCookies([{ name: SESSION_COOKIE, value: await encodeSession({ m: {}, a: acc.id, v: 0 }), url: base }]);
      up = await c.newPage();
      uploaders.set(acc.id, up);
    }
    return up;
  };
  // Adds one moment the way a person does (the real form), then sets its "when" so the list reads like a real trip.
  const put = async (g: Awaited<ReturnType<typeof trip>>, by: "Varu" | "Nupur" | "Riya", acc: { id: string }, caption: string, takenOn: string, at: Date) => {
    const up = await uploader(acc);
    await up.goto(`${base}/groups/${g.id}/moments/new`, { waitUntil: "networkidle", timeout: 30_000 });
    await up.getByLabel("Choose a photo").setInputFiles(nextPhoto());
    await up.locator('img[alt="Your photo"]').waitFor({ timeout: 20_000 });
    if (caption) await up.getByPlaceholder("The boat we almost missed").fill(caption);
    if (takenOn) await up.getByRole("button", { name: `Day ${Number(takenOn.slice(8)) - 9}`, exact: true }).click();
    await up.getByRole("button", { name: "Add moment" }).click();
    await up.waitForURL(/\/moments$/, { timeout: 30_000 });
    const row = await db.moment.findFirstOrThrow({ where: { groupId: g.id, authorId: g.members.find((m) => m.name === by)!.id, caption }, orderBy: { createdAt: "desc" }, select: { id: true } });
    return db.moment.update({ where: { id: row.id }, data: { createdAt: at } });
  };
  const lone = await trip("Goa long weekend", undefined, "Goa");
  const thai = await trip("Thailand trip");
  const first = await put(thai, "Nupur", nupur, "The boat we almost missed 😂", "2026-11-12", mins(12));
  await put(thai, "Riya", riya, "Worth the early alarm.", "2026-11-11", mins(90));
  await put(thai, "Varu", varu, "Sunset at Railay", "2026-11-10", mins(200));
  await put(thai, "Nupur", nupur, "Noodles at midnight", "2026-11-13", mins(300));
  await put(thai, "Riya", riya, "Last one from the pier", "2026-11-14", mins(400));
  for (const [by, emoji] of [["Varu", "😂"], ["Riya", "😂"], ["Nupur", "❤️"]] as const) await db.momentReaction.create({ data: { momentId: first.id, memberId: thai.members.find((m) => m.name === by)!.id, emoji } });
  const single = await trip("Krabi weekend", undefined, "Krabi");
  await put(single, "Nupur", nupur, "The boat we almost missed 😂", "2026-11-12", mins(12));
  const crowd = await trip("Phi Phi islands", undefined, "Phi Phi");
  const lines = ["Longtail boats at dawn", "Cold coconut, finally", "Monkey beach", "Riya vs the waves", "Snorkel day", "Dinner on the sand", "Last ferry back", "The view from the hostel"];
  for (let i = 0; i < lines.length; i++) await put(crowd, i % 2 ? "Nupur" : "Riya", i % 2 ? nupur : riya, lines[i], `2026-11-${10 + (i % 5)}`, mins(30 + i * 90));
  const gone = await trip("Koh Samui, Riya left", mins(60)); // Riya left an hour ago
  await put(gone, "Nupur", nupur, "Before she left", "2026-11-11", mins(300));
  await put(gone, "Nupur", nupur, "After she left (hidden from Riya)", "2026-11-12", mins(10));
  for (const up of uploaders.values()) await up.context().close();
  const longCaption = "A caption of exactly eighty characters, to see how it wraps on a small phone!!!!"; // 80

  const shots = async (who: { id: string }, widths: readonly number[], list: [string, string, ((p: Page) => Promise<void>)?, boolean?][]) => {
    const c = await browser.newContext({ viewport: screen, deviceScaleFactor: desktop ? 1 : 2, ...(ios ? { isMobile: true, hasTouch: true } : {}), colorScheme: "dark", reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata" });
    await c.addCookies([{ name: SESSION_COOKIE, value: await encodeSession({ m: {}, a: who.id, v: 0 }), url: base }]);
    const p = await c.newPage();
    for (const w of widths) {
      await p.setViewportSize({ width: w, height: 780 });
      for (const [name, path, prepare, full] of list) {
        try {
          await p.goto(base + path, { waitUntil: "networkidle", timeout: 30_000 });
          await p.waitForTimeout(700);
          if (prepare) await prepare(p).catch((e) => console.log("  (could not prepare", name, String(e).split("\n")[0], ")"));
          await assertMomentPhotosDecoded(p, `M1-${name}-${w}`); // fails the screenshot (✗) if any moment picture did not draw
          await p.screenshot({ path: `${out}/M1-${name}-${w}.png`, fullPage: full ?? true });
          console.log("✓", `M1-${name}-${w}`);
        } catch (e) {
          console.log("✗", `M1-${name}-${w}`, String(e).split("\n")[0]);
        }
      }
    }
    await c.close();
  };
  const W = [320, 360, 390] as const;
  const photo = async (p: Page) => {
    await p.getByLabel("Choose a photo").setInputFiles(photos[0]);
    await p.locator('img[alt="Your photo"]').waitFor();
  };
  await shots(varu, W, [
    ["strip-empty", `/groups/${lone.id}`, undefined, false],
    ["strip-with-moments", `/groups/${thai.id}`, undefined, false],
    ["moments-one", `/groups/${single.id}/moments`, undefined, true],
    ["moments-many", `/groups/${crowd.id}/moments`, undefined, true],
    ["moments", `/groups/${thai.id}/moments`, undefined, true],
    ["add-empty", `/groups/${thai.id}/moments/new`, undefined, false],
    ["add-photo", `/groups/${thai.id}/moments/new`, async (p) => {
      await photo(p);
      await p.getByPlaceholder("The boat we almost missed").fill("The boat we almost missed 😂");
      await p.getByRole("button", { name: "Day 3", exact: true }).click();
    }, true],
    ["add-80-characters", `/groups/${thai.id}/moments/new`, async (p) => {
      await photo(p);
      await p.getByPlaceholder("The boat we almost missed").fill(longCaption);
      await p.getByRole("button", { name: "Day 5", exact: true }).click();
    }, true],
    ["viewer", `/groups/${thai.id}/moments/${first.id}`, undefined, true],
    ["viewer-reactions", `/groups/${thai.id}/moments/${first.id}`, async (p) => {
      await p.locator("[data-reactions] summary[aria-label='React']").click();
    }, true],
    ["home-story-circles", "/", undefined, false],
    ["home-story-frame", "/", async (p) => {
      await p.locator("[data-story='moment']").first().click();
      await p.waitForTimeout(900);
    }, false],
  ]);
  // As the author, the "⋯" menu has Delete; as someone else it has Report and Block.
  await shots(nupur, W, [["menu-author", `/groups/${thai.id}/moments/${first.id}`, async (p) => { await p.locator("[data-moment-menu] summary").click(); }, true]]);
  await shots(riya, W, [
    ["menu-other", `/groups/${thai.id}/moments/${first.id}`, async (p) => { await p.locator("[data-moment-menu] summary").click(); }, true],
    ["report", `/report?kind=moment&id=${first.id}&back=${encodeURIComponent(`/groups/${thai.id}/moments/${first.id}`)}`, undefined, true],
  ]);
  // Riya left an hour ago: she sees "Before she left", no Add button, and not the newer moment.
  await shots(riya, W, [["leaver", `/groups/${gone.id}/moments`, undefined, true]]);

  // ===== GROUP PAGE (batch R4): Overview / Expenses / People / Memories, Trip recap, the left view =====
  // Same trips as above, plus a few expenses so the pass, Recent expenses and People have something to say. Names: G*-name at 390, and
  // n320-G*-name / n360-G*-name for the narrow phones (the same pattern as the other narrow shots).
  const ymd = (plus: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + plus * 86_400_000));
  // One equal expense (amount in minor units, divisible by 3 so the shares add up exactly), paid by `by`, `ago` minutes ago.
  const spend = async (g: Awaited<ReturnType<typeof trip>>, description: string, amount: number, by: string, ago: number) => {
    const paidById = g.members.find((m) => m.name === by)!.id;
    const when = mins(ago);
    await db.expense.create({
      data: {
        groupId: g.id, description, amount, splitType: "equal", forMode: "everyone", category: guessCategory(description), paidById,
        originalAmount: amount, originalCurrency: g.currency, baseCurrency: g.currency, convertedAmount: amount, createdById: paidById, spentAt: when, createdAt: when,
        shares: { create: g.members.map((m) => ({ memberId: m.id, amount: amount / g.members.length })) },
      },
    });
  };
  // Thailand trip: Nupur paid more than Varu, so Varu owes (a boarding pass with a Pay button).
  await spend(thai, "Dinner at the night market", 450000, "Nupur", 200);
  await spend(thai, "Longtail boat to Railay", 240000, "Varu", 260);
  await spend(thai, "Hotel in Phuket", 1500000, "Nupur", 400);
  await spend(thai, "Grab to the pier", 90000, "Riya", 90);
  // A trip that has ended, with moments and enough expenses for the Memories tab to say so. Made on the same dates as the others so the
  // Day chips work, then moved back into the past (the moments' days move with it).
  const over = await trip("Phuket, trip over", undefined, "Phuket");
  {
    uploaders.clear(); // the earlier uploader pages were closed above
    const old = 36_000; // minutes: about 25 days ago
    const up = [["Nupur", nupur, "Sunrise from the viewpoint", "2026-11-10"], ["Riya", riya, "The best pad thai of the trip", "2026-11-11"], ["Varu", varu, "Everyone on the ferry", "2026-11-12"], ["Nupur", nupur, "Goodbye, Phuket", "2026-11-14"]] as const;
    for (let i = 0; i < up.length; i++) await put(over, up[i][0], up[i][1], up[i][2], up[i][3], mins(old + i * 60));
    for (const u of uploaders.values()) await u.context().close();
    uploaders.clear();
    await spend(over, "Hotel in Phuket", 1500000, "Nupur", old + 600);
    await spend(over, "Dinner at the night market", 450000, "Varu", old + 500);
    await spend(over, "Longtail boat to Railay", 240000, "Riya", old + 400);
    const start = ymd(-30);
    await db.group.update({ where: { id: over.id }, data: { tripStart: start, tripEnd: ymd(-26) } });
    for (const m of await db.moment.findMany({ where: { groupId: over.id }, select: { id: true, takenOn: true } }))
      if (m.takenOn) await db.moment.update({ where: { id: m.id }, data: { takenOn: ymd(-30 + (Number(m.takenOn.slice(8)) - 10)) } });
  }
  // The group where Riya left an hour ago: a few expenses from before she left, so her view has a pass and rows.
  await spend(gone, "Hotel in Koh Samui", 900000, "Nupur", 500);
  await spend(gone, "Boat to the island", 300000, "Riya", 450);

  const gshots = async (who: { id: string }, list: { name: string; path: string; prepare?: (p: Page) => Promise<void>; full?: boolean; widths?: readonly number[] }[]) => {
    const c = await browser.newContext({ viewport: screen, deviceScaleFactor: desktop ? 1 : 2, ...(ios ? { isMobile: true, hasTouch: true } : {}), colorScheme: "dark", reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata" });
    await c.addCookies([{ name: SESSION_COOKIE, value: await encodeSession({ m: {}, a: who.id, v: 0 }), url: base }]);
    const p = await c.newPage();
    for (const s of list) {
      for (const w of s.widths ?? [390]) {
        const name = w === 390 ? s.name : `n${w}-${s.name}`;
        try {
          await p.setViewportSize({ width: w, height: 780 });
          await p.goto(base + s.path, { waitUntil: "networkidle", timeout: 30_000 });
          await p.waitForTimeout(800);
          if (s.prepare) await s.prepare(p).catch((e) => console.log("  (could not prepare", name, String(e).split("\n")[0], ")"));
          await assertMomentPhotosDecoded(p, name);
          await p.screenshot({ path: `${out}/${name}.png`, fullPage: s.full ?? true });
          console.log("✓", name);
        } catch (e) {
          console.log("✗", name, String(e).split("\n")[0]);
        }
      }
    }
    await c.close();
  };
  const gt = `/groups/${thai.id}`;
  await gshots(varu, [
    { name: "G1-trip-overview", path: gt, widths: [390, 320, 360] },
    { name: "G2-trip-expenses", path: `${gt}?tab=activity` },
    { name: "G3-trip-people", path: `${gt}?tab=balances` },
    { name: "G4-trip-memories", path: `${gt}?tab=memories`, widths: [390, 360] },
    { name: "G5-trip-recap", path: `${gt}?tab=charts` },
    { name: "G6-trip-memories-after", path: `/groups/${over.id}?tab=memories` },
  ]);
  // Home's Memories polaroids (under the story circles) with the moments above, at 390 and the narrowest phone (320), then one tapped open:
  // the moment big, Back going home. The same Home with no moments is 01-home / 69-home-full (no Memories row at all).
  await gshots(varu, [
    {
      name: "H2-home-memories",
      path: "/",
      widths: [390, 320],
      full: false,
      prepare: async (p) => {
        await p.locator("[data-memories-row]").waitFor({ timeout: 10_000 });
        await p.locator("[data-memories-row]").scrollIntoViewIfNeeded();
      },
    },
    {
      name: "H2b-home-memory-open",
      path: "/",
      full: false,
      prepare: async (p) => {
        await p.locator("[data-memory]").first().click();
        await p.waitForURL(/\/moments\/[^/]+\?from=home/, { timeout: 15_000 });
        await p.waitForTimeout(600);
      },
    },
  ]);
  // Riya left an hour ago: her tabs (Overview / Expenses / People / Memories) with the "You left on" banner, and Memories up to that day.
  await gshots(riya, [
    { name: "G10-leaver-view", path: `/groups/${gone.id}` },
    { name: "G10b-leaver-people", path: `/groups/${gone.id}?tab=balances` },
    { name: "G10c-leaver-memories", path: `/groups/${gone.id}?tab=memories` },
  ]);
}
// The "I've paid" link from a Remind, as the person who owes sees it (no sign-in).
let payPath = "";
try {
  await page.goto(`${base}${g}/settle`, { waitUntil: "load" });
  const href = await page.locator("[data-remind]").first().getAttribute("href", { timeout: 5000 });
  const res = href ? await page.request.get(base + href, { maxRedirects: 0 }) : null;
  payPath = res ? new URL(res.headers()["x-pay-link"] ?? "", base).pathname : "";
} catch (e) {
  console.log("  (no pay link:", String(e).split("\n")[0], ")");
}
await shot("85b-invite-card", `${g}/invite`, undefined, false);
await context.clearCookies();
await shot("16-join", `/join/${demo.trip.invite}`);
await shot("16b-join-preview", `/join/${demo.trip.invite}/card`, undefined, false);
if (payPath.startsWith("/p/")) {
  await shot("126-paid-link", payPath);
  await shot("127-paid-link-gone", "/p/AAAAAAAAAAAAAAAAAAAAAA", undefined, false);
}
await shot("24-tour-1", "/", undefined, false);
if (collectCode) {
  await shot("73-collect-payer", `/c/${collectCode}`);
  await shot("74-collect-signin-first", "/collect/new", undefined, false);
  await context.addCookies([{ name: "lp_payer", value: "shotsPayerKey0000000001", url: `${base}/c/` }]);
  await shot("75-collect-payer-ticked", `/c/${collectCode}`);
}
for (const n of [2, 3, 4, 5, 6]) {
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

// A visitor from the US, as a person would: the tour, then signed in, a new
// group in dollars, an expense, the profile and Home. (Local copy only.)
if (!hosted) {
  const { db } = await import("@/lib/db");
  const email = "shots-us@example.com";
  const old = await db.account.findUnique({ where: { email } });
  if (old) await db.member.updateMany({ where: { accountId: old.id }, data: { accountId: null } });
  const acc = await db.account.upsert({ where: { email }, update: { name: "Varu" }, create: { email, name: "Varu" } });
  const us = await browser.newContext({
    viewport: screen,
    deviceScaleFactor: desktop ? 1 : 2,
    ...(ios ? { isMobile: true, hasTouch: true } : {}),
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "America/New_York",
    extraHTTPHeaders: { "accept-language": "en-US,en;q=0.9" },
  });
  const p = await us.newPage();
  const snap = async (name: string, fullPage = true) => {
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${out}/${name}.png`, fullPage });
    console.log("✓", name);
  };
  const step = async (name: string, run: () => Promise<void>, fullPage = true) => {
    try {
      await run();
      await snap(name, fullPage);
    } catch (e) {
      console.log("✗", name, String(e).split("\n")[0]);
    }
  };
  await step("80-us-tour-2", async () => {
    await p.goto(base + "/", { waitUntil: "networkidle" });
    await p.getByRole("button", { name: /Next/ }).click();
  }, false);
  await step("81-us-tour-6", async () => {
    for (let k = 0; k < 4; k++) { // already on slide 2: four more taps reach slide 6 (the last)
      await p.getByRole("button", { name: /Next/ }).click();
      await p.waitForTimeout(450);
    }
  }, false);
  await us.addCookies([
    { name: SESSION_COOKIE, value: await encodeSession({ m: {}, a: acc.id }), url: base },
    { name: "lp_tour", value: "1", url: base },
  ]);
  await step("82-us-home-new", async () => {
    await p.goto(base + "/", { waitUntil: "networkidle" });
  });
  let groupPath = "";
  await step("83-us-new-group", async () => {
    await p.goto(base + "/groups/new", { waitUntil: "networkidle" });
    await p.getByRole("button", { name: /^Trip/ }).click();
    await p.locator('input[name="groupName"]').fill("NYC weekend");
  });
  await step("84-us-group-created", async () => {
    await p.getByRole("button", { name: /Create group/ }).click();
    await p.waitForURL(/\/invite\?new=1/);
    groupPath = new URL(p.url()).pathname.replace(/\/invite$/, "");
  });
  await step("85-us-add-expense", async () => {
    await p.goto(base + groupPath + "/add", { waitUntil: "networkidle" });
    await p.locator("#expense-name").fill("Pizza dinner");
    await p.getByLabel("Amount", { exact: true }).fill("48.50");
  });
  await step("86-us-group", async () => {
    await p.getByRole("button", { name: "Save expense" }).click();
    await p.waitForURL(/tab=activity/);
  });
  await step("87-us-profile", async () => {
    await p.goto(base + "/account", { waitUntil: "networkidle" });
  });
  await step("88-us-profile-edit", async () => {
    await p.getByText("Edit name").click();
  }, false);
  await step("89-us-home", async () => {
    await p.goto(base + "/", { waitUntil: "networkidle" });
  });
  await step("90-us-group-settings", async () => {
    await p.goto(base + groupPath + "/settings", { waitUntil: "networkidle" });
  }, false);
  await us.close();
}
await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
