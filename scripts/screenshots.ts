// Takes phone-sized screenshots of every screen (used by the GitHub check so
// the design can be reviewed). Needs the app running on :3000 and .demo.json.
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, webkit, type Page } from "playwright";
import { SESSION_COOKIE, encodeSession } from "../src/lib/session";

import { base, hosted, signInOnTestCopy, withBypass } from "./hosted";
const demo = JSON.parse(readFileSync(".demo.json", "utf8"));
// SHOT_ENGINE=webkit: the same screens in Safari's engine (iPhone), saved to screenshots/ios.
const ios = process.env.SHOT_ENGINE === "webkit";
const out = ios ? "screenshots/ios" : "screenshots";
mkdirSync(out, { recursive: true });

async function main() {
const browser = withBypass(await (ios ? webkit : chromium).launch());
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  ...(ios ? { isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" } : {}),
  colorScheme: "dark",
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
  await p.locator("details.group\\/qr summary").click();
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
  await p.getByRole("button", { name: /Settle everything/ }).scrollIntoViewIfNeeded();
}, false);
await shot("23-add-expense-differently", `${g}/add`, async (p) => {
  await p.getByRole("button", { name: /Custom/ }).click();
  await p.getByRole("button", { name: /Add notes/ }).click();
  await p.getByRole("button", { name: /Change/ }).first().click();
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
await shot("29-why", `${g}?tab=balances&why=${demo.trip.me}#why-${demo.trip.me}`);
await shot("30-add-only-some", `${g}/add`, async (p) => {
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
  await p.getByRole("button", { name: /Details/ }).click();
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
  await p.getByRole("button", { name: "More than one" }).click();
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
await shot("26-signin", "/signin", undefined, false);
await shot("27-privacy", "/privacy");
// Phase 5
await shot("62-trip-report", `${g}/report`);
await shot("63-charts-insights", `${g}?tab=charts`, undefined, false);
await shot("64-switching", "/switching");
await shot("65-import", "/import");
await shot("66-people-not-on-loopin", `${g}/people`);
await shot("67-splash", "/splash", undefined, false);
await shot("68-home-first-screen", "/", undefined, false);
for (const n of [2, 3, 4]) {
  await shot(`69-home-card-${n}`, "/", async (p) => {
    await p.getByRole("button", { name: /Pause the highlights/ }).click();
    await p.getByRole("button", { name: new RegExp(`^Show ${n} of`) }).click();
    await p.waitForTimeout(900);
  }, false);
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
  await shot("83-alerts-collect", "/notifications", undefined, false);
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
      .filter(([k]) => k.startsWith("place-") || ["cover-paris", "cover-taj", "cover-beach", "cover-mountains", "cover-city", "cover-snow", "cover-road"].includes(k))
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
  }, false);
  // A second trip further out: Home turns the countdown into a row to swipe.
  await db.group.create({
    data: {
      name: "Manali trip", type: "trip", currency: "INR", inviteCode: `shotsmanali${now.toString(36)}`, cover: "mountains", tripStart: ist(45), tripEnd: ist(50),
      members: { create: [{ name: "Varun", accountId: acc.id, claimedAt: new Date() }, { name: "Nupur" }, { name: "Kabir" }] },
    },
  });
  await shot("84-home-trips-row", "/", undefined, false);
  // The same on a narrow phone (360 wide, many Androids): nothing squeezed or cut off.
  await page.setViewportSize({ width: 360, height: 780 });
  await shot("85-home-trips-narrow", "/", async (p) => {
    await p.locator("[data-trip-row]").scrollIntoViewIfNeeded();
  }, false);
  // Swiped to the second trip.
  await shot("86-home-trips-swiped", "/", async (p) => {
    const row = p.locator("[data-trip-row]");
    await row.scrollIntoViewIfNeeded();
    await row.evaluate((el) => el.scrollTo({ left: el.clientWidth }));
    await p.waitForTimeout(500);
  }, false);
  await page.setViewportSize({ width: 390, height: 844 });
  await shot("77-group-countdown", `/groups/${goa.id}`, undefined, false);
  await shot("78-countdown-image", `/groups/${goa.id}/countdown-image`, undefined, false);
  await shot("79-settings-trip-dates", `/groups/${goa.id}/settings#trip`, undefined, false);
  await db.group.update({ where: { id: goa.id }, data: { tripStart: ist(3), tripEnd: ist(6) } });
  await shot("80-home-countdown-close", "/", undefined, false);
  await db.group.update({ where: { id: goa.id }, data: { tripStart: ist(-1), tripEnd: ist(3) } });
  await shot("81-group-countdown-during", `/groups/${goa.id}`, undefined, false);
  // The Pot: a card-night group with a finished game (the brief's example) and one being played.
  {
    const { startGame, recordMove, finishGame } = await import("../src/lib/pot-db");
    const pot = await db.group.create({
      data: {
        name: "Diwali card night", type: "pot", currency: "INR", inviteCode: `shotspot${now.toString(36)}`,
        members: { create: [{ name: "Varun", accountId: acc.id, claimedAt: new Date() }, { name: "Ravi" }, { name: "Meera" }, { name: "Kabir" }] },
      },
      include: { members: { orderBy: { createdAt: "asc" } } },
    });
    const [v, r, m, k] = ["Varun", "Ravi", "Meera", "Kabir"].map((n) => pot.members.find((x) => x.name === n)!.id);
    const one = await startGame(pot.id, v, { name: "Round 1", game: "teenpatti", players: [v, r, m, k] });
    if (one.ok) {
      for (const [who, a] of [[v, "1000"], [r, "2000"], [m, "500"], [k, "1000"], [k, "500"]] as const) await recordMove(one.id, v, { memberId: who, kind: "take", amount: a });
      for (const [who, a] of [[v, "1600"], [r, "1700"], [m, "300"], [k, "1400"]] as const) await recordMove(one.id, v, { memberId: who, kind: "return", amount: a });
      await finishGame(one.id, v);
    }
    const two = await startGame(pot.id, v, { name: "Round 2", game: "poker", players: [v, r, m, k] });
    if (two.ok) {
      for (const [who, a] of [[v, "2000"], [r, "1000"], [m, "1000"], [k, "2000"]] as const) await recordMove(two.id, r, { memberId: who, kind: "take", amount: a, note: who === k ? "second buy-in later" : "" });
      await recordMove(two.id, m, { memberId: m, kind: "return", amount: "1500" });
      await recordMove(two.id, v, { memberId: r, kind: "return", amount: "0" });
    }
    await shot("92-pot-games", `/groups/${pot.id}`, undefined, false);
    if (two.ok) await shot("93-pot-live", `/groups/${pot.id}/pot/${two.id}`);
    if (one.ok) await shot("94-pot-done", `/groups/${pot.id}/pot/${one.id}`);
    await shot("95-pot-new-game", `/groups/${pot.id}/pot/new`, undefined, false);
    await shot("96-new-group-menu", "/groups/new", undefined, false);
  }
  // Phase 7–8: Priya added her UPI ID, so Varun gets "Pay ₹1,000 · UPI"; Nupur
  // says she paid Varun ₹500 and he's asked "Got it ✓"; a lunch split by item.
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
          groupId: pune.id, description, amount, splitType: "equal", forMode: "everyone", category: "food", paidById,
          originalAmount: amount, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amount, createdById: paidById, spentAt: new Date(),
          shares: { create: [v, pr, n].map((memberId) => ({ memberId, amount: amount / 3 })) },
        },
      });
    await spent("Dinner at Malaka Spice", 300000, pr);
    await spent("Cab to Lonavala", 150000, v);
    await db.payment.create({ data: { groupId: pune.id, fromId: n, toId: v, amount: 50000, createdById: n, needsOk: true } });
    await shot("97-settle-pay-and-confirm", `/groups/${pune.id}/settle`);
    await shot("98-add-by-item", `/groups/${pune.id}/add`, async (p) => {
      await p.locator("#expense-name").fill("Lunch at Vohuman");
      await p.getByRole("button", { name: /By item/ }).click();
      const items = p.getByRole("group", { name: "Split by item" });
      await items.getByLabel("Item 1 name").fill("Cheese omelette");
      await items.getByLabel("Item 1 price").fill("240");
      await items.locator("[data-item-row='0']").getByRole("button", { name: "You", exact: true }).click();
      await items.getByLabel("Item 2 name").fill("Bun maska + chai");
      await items.getByLabel("Item 2 price").fill("360");
      await items.locator("[data-item-row='1']").getByRole("button", { name: "All", exact: true }).click();
      await items.getByLabel("Service charge").fill("5%");
      await p.waitForTimeout(300);
    });
    await shot("99-add-quick-line", `/groups/${pune.id}/add`, async (p) => {
      await p.getByRole("button", { name: /Type it in one line/ }).click();
      await p.getByLabel("Type the expense in one line").fill("Snacks 450 Priya paid split with Nupur");
      await p.getByRole("button", { name: "Fill", exact: true }).click();
      await p.waitForTimeout(300);
    }, false);
  }
}
await context.clearCookies();
await shot("16-join", `/join/${demo.trip.invite}`);
await shot("24-tour-1", "/", undefined, false);
if (collectCode) {
  await shot("73-collect-payer", `/c/${collectCode}`);
  await shot("74-collect-signin-first", "/collect/new", undefined, false);
  await context.addCookies([{ name: "lp_payer", value: "shotsPayerKey0000000001", url: `${base}/c/` }]);
  await shot("75-collect-payer-ticked", `/c/${collectCode}`);
}
for (const n of [2, 3, 4, 5, 6, 7]) {
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
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
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
  await step("81-us-tour-5", async () => {
    for (let k = 0; k < 3; k++) {
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
