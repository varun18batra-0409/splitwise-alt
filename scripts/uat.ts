// User acceptance test: real people tapping through the real app in a phone
// browser. Four friends share a trip: they join, add expenses every way the
// app allows (equal, only some, one person, amounts, percentages, dates, notes,
// foreign currency with and without card fees), edit, delete, undo, and settle
// up in full and in part. After every step the balances shown in the app are
// checked against an independent calculation.
//
// Needs the app running on :3000. Writes uat/report.md (+ a screenshot of each
// failure) into the screenshots folder. Never fails the build by itself: the
// report says what passed and what didn't.
//
// UAT_PROFILE picks the device it is run as (Exercise A runs all three):
//   android  (default) Chromium, 390×844, touch, en-IN, Asia/Kolkata
//   iphone   WebKit (Safari's engine) with Playwright's "iPhone 14", en-IN, Asia/Kolkata
//   desktop  Chromium, 1440×900, no touch, en-GB, Europe/London
// A step that only makes sense on some devices says so (stepOn) and is reported
// as "not applicable" on the others, never skipped quietly. Besides report.md and
// summary.txt, coverage.md / coverage.json map every step to an area.
import "./test-db-guard"; // first on purpose: refuses to run against the live database (OB-10)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { base, bypass, hosted, withBypass } from "./hosted";
import { assertMomentPhotosDecoded, realPhotos } from "./moment-shots";
import { chromium, webkit, devices, type Browser, type BrowserContext, type BrowserContextOptions, type Page, type Route } from "playwright";
import { db } from "../src/lib/db";
import { netBalances } from "../src/lib/balances";
import { decimalsOf } from "../src/lib/money";
import { dayKey } from "../src/lib/dates";
import { nameFromEmail } from "../src/lib/invites";

const out = "screenshots/uat";
mkdirSync(out, { recursive: true });

// ---------- which device this run is ----------
type Profile = "android" | "iphone" | "desktop";
const ALL_PROFILES: Profile[] = ["android", "iphone", "desktop"];
const PROFILES: Record<Profile, { label: string; engine: "chromium" | "webkit"; locale: string; timezoneId: string; context: BrowserContextOptions }> = {
  android: { label: "Android phone: Chromium, 390×844, touch, en-IN, Asia/Kolkata", engine: "chromium", locale: "en-IN", timezoneId: "Asia/Kolkata", context: { viewport: { width: 390, height: 844 }, hasTouch: true } },
  iphone: { label: "iPhone 14: WebKit (Safari's engine), en-IN, Asia/Kolkata", engine: "webkit", locale: "en-IN", timezoneId: "Asia/Kolkata", context: { ...devices["iPhone 14"] } },
  desktop: { label: "Desktop: Chromium, 1440×900, no touch, en-GB, Europe/London", engine: "chromium", locale: "en-GB", timezoneId: "Europe/London", context: { viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false } },
};
const requested = (process.env.UAT_PROFILE ?? "android").trim().toLowerCase();
if (!ALL_PROFILES.includes(requested as Profile)) {
  console.error(`UAT_PROFILE must be android, iphone or desktop (got “${requested}”).`);
  process.exit(1);
}
const PROFILE = requested as Profile;
const P = PROFILES[PROFILE];

// pass / fail / na ("not applicable": the step is for other devices, and says which).
// "skip" = NOT RUN: a conditional step found nothing to do. It is never counted as a pass (TEST-02).
type Status = "pass" | "fail" | "na" | "skip";
type Result = { n: number; area: string; name: string; status: Status; detail: string; only?: Profile[] };
const results: Result[] = [];
let shotNo = 0;
// A step returns notRun("why") when its situation did not come up (nothing to pay, no key set...).
// It is recorded as "skip" with the reason, listed in the reports, and never counted as passed.
class NotRun {
  constructor(public reason: string) {}
}
const notRun = (reason: string) => new NotRun(reason);
// Older style: a note ending in "(skipped)" is treated as not run too, so it can never slip in as a pass.
const SKIPPED_NOTE = /\(skipped\)\s*$/;

// ---------- an independent model of what everyone should owe ----------
type Person = "Varun" | "Asha" | "Ravi" | "Zoe";
const PEOPLE: Person[] = ["Varun", "Asha", "Ravi", "Zoe"];
type Entry = { key: string; payer: Person; amount: number; shares: Partial<Record<Person, number>>; active: boolean };
const ledger: Entry[] = [];
const payments: { from: Person; to: Person; amount: number; active: boolean; key: string }[] = [];
function expected(): Record<Person, number> {
  const n = Object.fromEntries(PEOPLE.map((p) => [p, 0])) as Record<Person, number>;
  for (const e of ledger.filter((x) => x.active)) {
    n[e.payer] += e.amount;
    for (const [p, s] of Object.entries(e.shares)) n[p as Person] -= s!;
  }
  for (const p of payments.filter((x) => x.active)) {
    n[p.from] += p.amount;
    n[p.to] -= p.amount;
  }
  return n;
}
const equal = (amount: number, who: Person[]) => Object.fromEntries(who.map((p) => [p, amount / who.length])) as Partial<Record<Person, number>>;

// ---------- helpers ----------
const minor = (text: string): number => {
  const m = text.replace(/[^\d.]/g, "");
  return Math.round(parseFloat(m) * 100);
};
const rupees = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

// A step that hangs (a screen that never finishes on the hosted copy) fails on
// its own after two minutes instead of stopping the whole run.
const STEP_LIMIT_MS = 120_000;
// Every page crash (a React error, an uncaught throw), with the step it happened in and the page's address, listed at the end of the run.
let stepNow = "(before the first step)";
const pageCrashes: string[] = [];
async function step(page: Page | null, area: string, name: string, fn: () => Promise<void | string | NotRun>, only?: Profile[], limitMs = STEP_LIMIT_MS) {
  const n = results.length + 1;
  stepNow = `${area} — ${name}`;
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const note = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`still not done after ${limitMs / 1000} s`)), limitMs);
      }),
    ]).finally(() => clearTimeout(timer));
    const why = note instanceof NotRun ? note.reason : typeof note === "string" && SKIPPED_NOTE.test(note) ? note.replace(SKIPPED_NOTE, "").trim() : null;
    if (why !== null) {
      results.push({ n, area, name, status: "skip", detail: `not run: ${why || "no reason given"}`, only });
      console.log("○", area, "—", name, `(not run: ${why})`);
    } else {
      results.push({ n, area, name, status: "pass", detail: typeof note === "string" ? note : "", only });
      console.log("✓", area, "—", name);
    }
  } catch (e) {
    const lines = String((e as Error)?.message ?? e).split("\n").map((l) => l.trim()).filter(Boolean);
    // Database errors put the real reason on their last line ("Invalid `db.x()` invocation … <reason>"), so keep it.
    const head = lines.slice(0, 3).join(" ").slice(0, 400);
    const tail = lines.length > 3 && /invocation/i.test(head) ? ` … ${lines[lines.length - 1].slice(0, 300)}` : "";
    const msg = head + tail + diagnose(page);
    let shot = "";
    if (page) {
      shotNo++;
      shot = `fail-${String(shotNo).padStart(2, "0")}.png`;
      await page.screenshot({ path: `${out}/${shot}`, fullPage: true }).catch(() => (shot = ""));
    }
    results.push({ n, area, name, status: "fail", detail: msg + (shot ? ` (screenshot: ${shot})` : ""), only });
    console.log("✗", area, "—", name, "→", msg);
  }
}
// A step for some devices only. On the others it is listed as "not applicable"
// with the reason, so nothing is ever skipped quietly.
async function stepOn(only: Profile[], why: string, page: Page | null, area: string, name: string, fn: () => Promise<void | string | NotRun>) {
  if (only.includes(PROFILE)) return step(page, area, name, fn, only);
  results.push({ n: results.length + 1, area, name, status: "na", detail: `not applicable on ${PROFILE}: ${why} (runs on ${only.join(", ")})`, only });
  console.log("–", area, "—", name, `(not applicable on ${PROFILE})`);
}
// No Remind link on Settle. If Varun IS owed money, that is a failure; only when nobody owes him is the step genuinely not applicable
// (and then it is recorded as not run, never as a pass). The balance is read from the database rows themselves: the small model in
// `expected()` stopped being updated after "Settle everything & close" and later changes, so it is no longer a fair judge here.
async function noRemind(before: string, groupPath: string): Promise<NotRun> {
  const { netBalances } = await import("../src/lib/balances");
  const grp = await db.group.findUniqueOrThrow({ where: { id: groupPath.split("/").pop()! }, include: { members: true, expenses: { include: { shares: true } }, payments: true } });
  const net = netBalances(grp.members.map((m) => m.id), grp.expenses.filter((e) => !e.deletedAt), grp.payments.filter((p) => !p.deletedAt));
  const varun = grp.members.find((m) => m.name === "Varun")!.id;
  const owed = net[varun] ?? 0;
  assert(!(owed > 0), `${before}Varun is owed ${rupees(owed)} (from the database rows), but Settle shows no Remind link`);
  return notRun(`${before}nobody owes Varun right now, so there was nothing to remind`);
}
// Old and new names for the same time zone (Chrome says Asia/Calcutta, the standard list says Asia/Kolkata).
const ZONE_ALIAS: Record<string, string> = { "Asia/Calcutta": "Asia/Kolkata", "Asia/Saigon": "Asia/Ho_Chi_Minh", "Asia/Katmandu": "Asia/Kathmandu", "Asia/Rangoon": "Asia/Yangon" };
const sameZone = (a: string, b: string) => (ZONE_ALIAS[a] ?? a) === (ZONE_ALIAS[b] ?? b);
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const stamp = Date.now();
// The daily job's key, when the test server has one (like the live app).
const noCronKey = hosted && !process.env.CRON_SECRET;
const cronAuth = (): Record<string, string> => (process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {});
const email = (n: string) => `${n}-${stamp}@uat.loopin.test`;
// Someone added to a group by name is invited: they are in the group at once as a name, and see it on their own Home only after tapping Join.
async function tapJoin(page: Page, groupName: string, groupPath: string) {
  await go(page, "/");
  await page.locator("[data-invitation]").filter({ hasText: groupName }).getByRole("button", { name: "Join", exact: true }).click();
  await page.waitForURL(new RegExp(`${groupPath}$`));
}
// Emails are sent just after the screen changes: wait for one.
async function mailTo(to: string, where: { subject?: { contains: string }; text?: { contains: string } } = {}) {
  for (let i = 0; i < 40; i++) {
    const row = await db.outbox.findFirst({ where: { to, ...where }, orderBy: { createdAt: "desc" } });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

// Sign up / sign in on the email screen; the code is read from the test outbox.
async function signup(page: Page, name: string, address: string, emailFilled = false) {
  await page.waitForURL(/\/signin/);
  await page.locator('input[name="email"]').waitFor();
  const nameBox = page.locator('input[name="name"]');
  if (await nameBox.count()) await nameBox.fill(name);
  if (!emailFilled) await page.locator('input[name="email"]').fill(address);
  const since = new Date(Date.now() - 1000);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.waitForURL(/sent=1/);
  let code = "";
  for (let i = 0; i < 20 && !code; i++) {
    const row = await db.outbox.findFirst({ where: { to: address, subject: { contains: "Loopin code" }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
    code = row ? (/\b(\d{6})\b/.exec(row.subject)?.[1] ?? "") : "";
    if (!code) await page.waitForTimeout(250);
  }
  assert(code, `no sign-in code emailed to ${address}`);
  await page.locator('input[name="code"]').fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/signedin=1/);
}

async function person(browser: Browser): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...P.context, locale: P.locale, timezoneId: P.timezoneId, colorScheme: "dark" });
  // The one-time group-type sheet stays out of the way of the steps (its own step turns it back on).
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("lp-type-sheet-off", "1");
    } catch {
      /* storage blocked */
    }
  });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  page.setDefaultTimeout(hosted ? 30_000 : 15_000); // the test copy can be slow to wake up
  watch(page);
  return { ctx, page };
}

// For failure notes: requests still in flight and the last browser errors on a page.
const pending = new WeakMap<Page, Map<object, string>>();
const lastErrors = new WeakMap<Page, string[]>();
function watch(page: Page) {
  const open = new Map<object, string>();
  const errs: string[] = [];
  pending.set(page, open);
  lastErrors.set(page, errs);
  page.on("request", (r) => open.set(r, `${r.method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`.slice(0, 120)));
  page.on("requestfinished", (r) => open.delete(r));
  page.on("requestfailed", (r) => open.delete(r));
  const keep = (t: string) => {
    errs.push(Array.from(t).slice(0, 160).join(""));
    if (errs.length > 3) errs.shift();
  };
  page.on("pageerror", (e) => {
    keep(`pageerror ${String(e)}`);
    const where = page.url().replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "");
    const line = `${Array.from(String(e)).slice(0, 90).join("")} | on ${where} | in ${Array.from(stepNow).slice(0, 120).join("")}`;
    pageCrashes.push(line);
    console.log("! page crash:", line);
  });
  page.on("console", (m) => {
    if (m.type() === "error") keep(`console ${m.text()}`);
  });
}
function diagnose(page: Page | null): string {
  if (!page) return "";
  const open = [...(pending.get(page)?.values() ?? [])].slice(0, 5);
  const errs = lastErrors.get(page) ?? [];
  return (open.length ? ` [still loading: ${open.join(", ")}]` : "") + (errs.length ? ` [browser errors: ${errs.join(" | ")}]` : "");
}

// Let a navigation that is already under way (a server action's redirect, a router refresh) finish.
// Safari's engine is still moving when the test asks for the next page, which gives
// "Navigation … is interrupted by another navigation".
async function settleNav(page: Page) {
  await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
  if (PROFILE === "iphone") await page.waitForLoadState("networkidle", { timeout: 2_000 }).catch(() => undefined);
}
const slowLoads: string[] = []; // pages whose "load" took over 10 s during a layout sweep (reported, not failed)
// Add people keeps the link, Copy and WhatsApp up top; the rest is behind "More ways to add people", one row each. Opens what is closed.
async function openWay(page: Page, way: "qr" | "search" | "contacts" | "email") {
  const more = page.locator("[data-more-ways]");
  if (!(await more.evaluate((d) => (d as HTMLDetailsElement).open))) await more.locator("> summary").click();
  const row = more.locator(`[data-way="${way}"]`);
  if (!(await row.evaluate((d) => (d as HTMLDetailsElement).open))) await row.locator("> summary").click();
}

async function go(page: Page, path: string, opts: { quick?: boolean } = {}) {
  for (let attempt = 0; ; attempt++) {
    await settleNav(page);
    try {
      // The hosted test copy keeps a connection open (Vercel's preview tools), so the network never goes quiet there.
      // "quick": layout sweeps only measure the page, so wait for load and fonts, not for every poll to finish.
      if (opts.quick) {
        await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 30_000 });
        // Layout only needs the page drawn: wait for load if it comes within 10 s, and say so if it doesn't.
        const loaded = await page.waitForLoadState("load", { timeout: 10_000 }).then(() => true, () => false);
        if (!loaded) slowLoads.push(path);
        // Fonts: at most 5 s (on Safari's engine "fonts ready" can wait on a font that never finishes on this machine).
        await page.evaluate("Promise.race([document.fonts ? document.fonts.ready.then(() => true) : true, new Promise((r) => setTimeout(() => r(false), 5000))])").catch(() => undefined);
        await page.waitForTimeout(300);
      } else if (hosted) await page.goto(base + path, { waitUntil: "load", timeout: 30_000 });
      else await page.goto(base + path, { waitUntil: "networkidle" });
      break;
    } catch (e) {
      // One more try only for the "interrupted" case; any other error is real.
      if (attempt === 0 && /interrupted by another navigation/i.test(String(e))) continue;
      // A page that never goes quiet (a poll still open): the page itself loaded, so carry on and say so.
      if (attempt === 0 && !hosted && /Timeout .*networkidle|waiting until "networkidle"/i.test(String(e))) {
        console.log(`  (note: ${path} never went network-quiet; open: ${[...(pending.get(page)?.values() ?? [])].slice(0, 5).join(", ") || "nothing listed"})`);
        await page.waitForLoadState("load", { timeout: 10_000 }).catch(() => undefined);
        break;
      }
      throw e;
    }
  }
  if (hosted) {
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
    await page.waitForTimeout(600); // let buttons come alive before tapping them
  }
}

// Everyone's balance as the app shows it (Balances tab → By person).
async function shownBalances(page: Page, groupPath: string): Promise<Record<string, number>> {
  await go(page, `${groupPath}?tab=balances`);
  const rows = page.locator("details.group\\/person > summary");
  const n = await rows.count();
  const out: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const t = (await rows.nth(i).innerText()).replace(/\s+/g, " ");
    const name = t.replace(/^[A-Z] /, "").split(" ")[0];
    // The row shows whole rupees from ₹1,000 up; the exact amount is in data-balance, which is what is checked here.
    const exactEl = rows.nth(i).locator("[data-balance]").first();
    const exact = (await exactEl.count()) ? ((await exactEl.getAttribute("data-balance")) ?? "") : "";
    const amt = /(₹[\d,.]+)/.exec(exact);
    const gets = /\bgets\b/.test(t);
    const owes = /\bowes\b/.test(t);
    out[name] = amt && gets ? minor(amt[1]) : amt && owes ? -minor(amt[1]) : 0;
  }
  return out;
}
// "Everyone is square": the rows must really be there first (an empty list, or a missing data-balance that reads as 0, must not pass as "all zero").
function assertAllSquare(got: Record<string, number>, names: string[], what: string) {
  const missing = names.filter((n) => !(n in got));
  assert(missing.length === 0, `${what}: the Balances tab doesn't list ${missing.join(", ")} (it lists ${Object.keys(got).join(", ") || "nobody"})`);
  assert(Object.keys(got).length >= 2, `${what}: only ${Object.keys(got).length} balance row(s) found`);
  assert(Object.values(got).every((x) => x === 0), `${what}: not all square: ${JSON.stringify(got)}`);
}
async function checkBalances(page: Page, groupPath: string) {
  const want = expected();
  const got = await shownBalances(page, groupPath);
  const bad = PEOPLE.filter((p) => Math.abs((got[p] ?? 0) - Math.round(want[p])) > 1);
  assert(
    bad.length === 0,
    `balances differ: ${bad.map((p) => `${p} shows ${rupees(got[p] ?? 0)} expected ${rupees(Math.round(want[p]))}`).join("; ")}`,
  );
  return PEOPLE.map((p) => `${p} ${want[p] >= 0 ? "+" : "−"}${rupees(Math.abs(Math.round(want[p])))}`).join(", ");
}

// ---------- the same independent check, for any group, any people, any currency ----------
// Written separately from the app: each line says who paid what and what each person's share is
// (in the smallest unit: paise, cents, whole yen). Money back is a negative expense paid by
// whoever got it. Shown balances may differ from the exact fraction by one smallest unit (an odd paisa
// goes to someone), and must always add up to exactly nothing.
type GEntry = { payer: string; amount: number; shares: Record<string, number> };
const evenly = (amount: number, who: string[]): Record<string, number> => Object.fromEntries(who.map((p) => [p, amount / who.length]));
function modelNet(people: string[], entries: GEntry[]): Record<string, number> {
  const n: Record<string, number> = Object.fromEntries(people.map((p) => [p, 0]));
  for (const e of entries) {
    n[e.payer] += e.amount;
    for (const [p, s] of Object.entries(e.shares)) n[p] -= s;
  }
  return n;
}
// Balances > By person, in the group's own currency ("gets ₹566.66", "owes JPY 1,267").
async function shownBalancesIn(page: Page, groupPath: string, currency: string): Promise<Record<string, number>> {
  await go(page, `${groupPath}?tab=balances`);
  const rows = page.locator("details.group\\/person > summary");
  const count = await rows.count();
  const d = decimalsOf(currency);
  const result: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    const t = (await rows.nth(i).innerText()).replace(/\s+/g, " ");
    const name = t.replace(/^[A-Z] /, "").split(" ")[0];
    // The row shows whole units from 1,000 up; the exact amount is in data-balance, which is what is checked here.
    const exactEl = rows.nth(i).locator("[data-balance]").first();
    const exact = (await exactEl.count()) ? ((await exactEl.getAttribute("data-balance")) ?? "") : "";
    const m = /\b(gets|owes)\b/.exec(t);
    const num = /([\d,]+(?:\.\d+)?)/.exec(exact);
    const v = m && num ? Math.round(parseFloat(num[1].replace(/,/g, "")) * 10 ** d) : 0;
    result[name] = m ? (m[1] === "gets" ? v : -v) : 0;
  }
  return result;
}
async function checkLedger(page: Page, groupPath: string, people: string[], entries: GEntry[], currency = "INR") {
  const want = modelNet(people, entries);
  const got = await shownBalancesIn(page, groupPath, currency);
  const missing = people.filter((p) => !(p in got));
  assert(missing.length === 0, `the Balances tab doesn't list ${missing.join(", ")} (it lists ${Object.keys(got).join(", ")})`);
  const bad = people.filter((p) => Math.abs(got[p] - Math.round(want[p])) > 1);
  const unit = (v: number) => (v / 10 ** decimalsOf(currency)).toFixed(decimalsOf(currency));
  assert(bad.length === 0, `balances differ: ${bad.map((p) => `${p} shows ${unit(got[p])} expected ${unit(Math.round(want[p]))}`).join("; ")}`);
  const sum = people.reduce((a, p) => a + got[p], 0);
  assert(sum === 0, `the balances shown add up to ${unit(sum)}, not nothing`);
  return people.map((p) => `${p} ${want[p] >= 0 ? "+" : "−"}${unit(Math.abs(Math.round(want[p])))}`).join(", ");
}
// Settle up: the suggested payments (read from the cards) must move exactly what the people who are owed are owed.
async function settleTotal(page: Page, groupPath: string): Promise<{ cards: number; total: number }> {
  await go(page, `${groupPath}/settle`);
  const cards = page.locator("main ul > li[data-transfer-row]");
  const n = await cards.count();
  let total = 0;
  for (let i = 0; i < n; i++) {
    const t = (await cards.nth(i).innerText()).replace(/\s+/g, " ");
    const m = /\b(?:pay|pays) \w+ (?:[A-Z]{3} )?\D?([\d,]+(?:\.\d+)?)/.exec(t);
    assert(m, `can't read the settle card: ${t.slice(0, 120)}`);
    total += parseFloat(m[1].replace(/,/g, ""));
  }
  return { cards: n, total };
}
// The shared test database file answers "busy" when the app writes at the same moment (seen as P2010 "SocketTimeout"):
// try again with a growing pause. Test file only, never live.
async function dbRetry<T>(what: string, run: () => Promise<T>, tries = 12): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await run();
    } catch (e) {
      if (n >= tries || !/P2010|SocketTimeout|SQLITE_BUSY|database is locked|busy/i.test(String(e))) throw e;
      console.log(`  (${what}: the test database was busy, trying again ${n}/${tries - 1})`);
      await new Promise((r) => setTimeout(r, Math.min(750 * n, 5000)));
    }
  }
}
// A group the test sets up directly (like the Tokyo step): Varun plus named people who haven't joined.
async function seedGroup(name: string, others: string[], currency = "INR") {
  const acc = await dbRetry("seed account", () => db.account.findUniqueOrThrow({ where: { email: email("varun") } }));
  const code = `exa-${Math.random().toString(36).slice(2, 8)}-${stamp}`;
  // A retry after a busy answer can't double the group: the invite code is unique, so look for it first.
  const grp = await dbRetry("seed group", async () =>
    (await db.group.findUnique({ where: { inviteCode: code } })) ??
    db.group.create({
      data: { name, currency, type: "other", inviteCode: code, members: { create: [{ name: "Varun", accountId: acc.id, claimedAt: new Date() }, ...others.map((n) => ({ name: n }))] } },
    }));
  return { id: grp.id, path: `/groups/${grp.id}`, code };
}
async function until<T>(what: string, look: () => Promise<T | null | undefined | false>, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await look();
    if (v) return v;
    if (Date.now() > end) throw new Error(`${what} never happened`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

type AddOpts = {
  name: string;
  amount: string;
  payer?: string; // as seen by the person adding (their own name shows as "You")
  me: string;
  currency?: string;
  inGroupCurrency?: boolean; // leave the currency alone: the group's own currency (JPY etc.) is already chosen
  split?: { kind: "everyone" } | { kind: "only"; who: string[] } | { kind: "one"; who: string } | { kind: "amounts"; values: Record<string, string> } | { kind: "percent"; values: Record<string, string> } | { kind: "shares"; values: Record<string, string> };
  method?: "Card" | "Cash" | "Bank / UPI";
  rate?: string;
  markup?: "None" | "2" | "group";
  date?: "Yesterday";
  notes?: string;
  expectError?: RegExp;
};
async function pickCurrency(page: Page, code: string) {
  const btn = page.getByRole("button", { name: /Currency:/ });
  if ((await btn.innerText()).includes(code)) return;
  await btn.click();
  await page.getByLabel("Search currencies").fill(code);
  await page.getByRole("button", { name: new RegExp(`\\b${code}\\b`) }).first().click();
}
async function fillExpense(page: Page, o: AddOpts) {
  const label = (p: string) => (p === o.me ? "You" : p);
  await openSplit(page);
  if (o.payer) await page.getByRole("button", { name: new RegExp(`^(✓ )?${label(o.payer)}$`) }).first().click();
  await page.locator("#expense-name").fill(o.name);
  if (!o.inGroupCurrency) await pickCurrency(page, o.currency ?? "INR");
  await page.getByLabel("Amount", { exact: true }).fill(o.amount);
  if (o.date) {
    await page.getByRole("button", { name: /Today.*Change/ }).click();
    await page.getByRole("button", { name: o.date, exact: true }).click();
  }
  if (o.currency && o.currency !== "INR") {
    await page.getByRole("button", { name: "Details", exact: true }).click(); // the quiet "≈ ₹… with your card's fee" line opens the rate, fee and maths
    await page.getByRole("button", { name: o.method ?? "Card", exact: true }).click();
    if (o.rate) {
      const edit = page.getByRole("button", { name: "Edit rate" });
      await Promise.race([edit.waitFor(), page.getByLabel("Exchange rate").waitFor()]);
      if (await edit.isVisible()) await edit.click();
      await page.getByLabel("Exchange rate").fill(o.rate);
    }
    if ((o.method ?? "Card") === "Card" && o.markup) {
      await page.getByRole("button", { name: "Change", exact: true }).last().click();
      if (o.markup === "None") await page.getByRole("button", { name: "None", exact: true }).click();
      else if (o.markup === "group") await page.getByRole("button", { name: /^Default/ }).click();
      else await page.getByRole("button", { name: `${o.markup}%`, exact: true }).click();
    }
  }
  // Split: always start from "Everyone equally" (the app remembers the last split).
  await openSplit(page);
  await page.getByRole("button", { name: "Everyone equally" }).click();
  const s = o.split ?? { kind: "everyone" };
  if (s.kind === "only") {
    await page.getByRole("button", { name: "Only some" }).click();
    for (const p of s.who) await page.getByRole("button", { name: new RegExp(`^(✓ )?${label(p)}$`) }).last().click();
  } else if (s.kind === "one") {
    // One person is "Only some" with just them tapped (the one row of split choices, 16 Nov).
    await page.getByRole("button", { name: "Only some" }).click();
    await page.getByRole("button", { name: new RegExp(`^(✓ )?${label(s.who)}$`) }).last().click();
  } else if (s.kind === "amounts" || s.kind === "percent") {
    await page.getByRole("button", { name: s.kind === "amounts" ? "Amounts" : "%", exact: true }).click();
    for (const [p, v] of Object.entries(s.values)) {
      await page.getByLabel(`${label(p)} ${s.kind === "amounts" ? "amount" : "percentage"}`).fill(v!);
    }
  }
  if (s.kind === "shares") {
    await page.getByRole("button", { name: "Shares", exact: true }).click();
    for (const [p, v] of Object.entries(s.values)) await page.getByLabel(`${label(p)} shares`).fill(v!);
  }
  if (o.notes) {
    await openMore(page);
    await page.getByPlaceholder(/Rahul paid the tip/).fill(o.notes);
  }
}
// Add expense shows "Who paid?" and "How to split?" as rows of chips, always on screen: nothing to open, just wait for them.
async function openSplit(page: Page) {
  await page.locator("[data-split-row]").waitFor();
}
// Add expense keeps notes, several payers and Spin for it under "More" (closed unless the expense already uses them).
async function openMore(page: Page) {
  const b = page.locator("[data-more] > button");
  if ((await b.getAttribute("aria-expanded")) !== "true") await b.click();
}
async function save(page: Page, o: AddOpts, button = "Save expense") {
  const before = page.url();
  await page.getByRole("button", { name: button }).click();
  // A "Looks like a duplicate" pause (same amount nearby) isn't what most steps test: say it's a different one.
  if (!o.expectError) {
    const dup = page.getByRole("button", { name: "It’s a different one" });
    const done = await Promise.race([
      page.waitForURL(/tab=activity/, { timeout: 20_000 }).then(() => "saved"),
      dup.waitFor({ timeout: 20_000 }).then(() => "dup"),
    ]).catch(() => "timeout");
    if (done === "dup") await dup.click();
  }
  if (o.expectError) {
    await page.locator("p.bg-red-50").first().waitFor();
    const t = await page.locator("p.bg-red-50").first().innerText();
    assert(o.expectError.test(t), `expected error ${o.expectError} but saw “${t}”`);
    assert(page.url() === before, "the form should stay open after an error");
    return t;
  }
  await page.waitForURL(/tab=activity/, { timeout: 20_000 });
}

// ---------- the test ----------
async function main() {
  // The test supplies its own exchange rates, so an outage of the free rate
  // service can't fail steps that aren't about it. (USD → INR is left out on
  // purpose: one step checks the live service.)
  const day = new Date().toISOString().slice(0, 10);
  for (const [base, quote, rate] of [["THB", "INR", "2.5734"], ["INR", "THB", "0.3886"], ["INR", "USD", "0.0119"], ["EUR", "INR", "90.12"]] as const) {
    // The hosted test database now and then drops a connection ("SocketTimeout", seen on several branches in one night): try once more.
    // A second identical rate row, if the first write did land, changes nothing.
    await dbRetry(`${base}→${quote} rate`, () => db.exchangeRate.create({ data: { base, quote, rate, date: day } }));
  }
  // On the private test copy: start with fresh limits (many sign-ups come from this one machine).
  if (hosted) await db.rateLimit.deleteMany({});
  console.log(`UAT profile: ${PROFILE} — ${P.label}`);
  const browser = withBypass(await (P.engine === "webkit" ? webkit : chromium).launch());
  const varun = await person(browser);
  const asha = await person(browser);
  const ravi = await person(browser);
  const zoe = await person(browser);
  const V = varun.page, A = asha.page, R = ravi.page, Z = zoe.page;
  let g = ""; // "/groups/<id>"
  let invite = ""; // "/join/<code>"

  // ===== 1. First visit, signing up, creating a group, adding people =====
  await step(V, "Start", "First visit shows the intro tour with “Create your first group”", async () => {
    await go(V, "/");
    // "Next" is the main button on the early steps; "Create your first group" becomes the main button on the last step.
    await V.locator("[data-tour-next]").first().waitFor();
    for (let i = 0; i < 6; i++) {
      await V.locator("[data-tour-next]").click();
      await V.waitForTimeout(300);
    }
    await V.getByRole("link", { name: "Create your first group" }).waitFor();
  });
  await step(V, "Start", "Creating a group asks you to sign up first (verified email)", async () => {
    await go(V, "/groups/new");
    await V.getByRole("link", { name: "Sign in or sign up" }).click();
    await signup(V, "Varun", email("varun"));
    await V.waitForURL(/\/groups\/new/);
    assert((await V.locator('input[name="yourName"]').inputValue()) === "Varun", "your name isn't filled in from sign-up");
  });
  await step(V, "Start", "There is no way to add people by typing a name", async () => {
    assert((await V.locator('input[name="member"]').count()) === 0, "the new-group form still has name boxes");
    assert((await V.getByText("Add another person").count()) === 0, "“Add another person” is still there");
  });
  await step(V, "Start", "Create a group (INR) → lands on Add people", async () => {
    await V.locator('input[name="groupName"]').fill("UAT Goa trip");
    await V.locator('select[name="currency"]').selectOption("INR");
    await V.getByRole("button", { name: /Create group/ }).click();
    await V.waitForURL(/\/invite\?new=1/);
    g = new URL(V.url()).pathname.replace(/\/invite$/, "");
    await V.getByText("is ready. Now bring your people in").waitFor();
    // The main card has the link, Copy and WhatsApp; the other ways are behind "More ways to add people" (closed to start with).
    assert(!(await V.locator("[data-more-ways]").evaluate((d) => (d as HTMLDetailsElement).open)), "More ways to add people starts open");
    await V.locator("[data-more-ways] > summary").click();
    for (const t of ["Share the link", "Show a QR code", "Search by name or email", "From your contacts", "By email"]) await V.getByText(t, { exact: true }).waitFor();
    // F3: the "(you)" row never says "Not on Loopin yet". F14: WhatsApp and Copy link up front, the rest under More ways to share, WhatsApp as the one cream button.
    assert(!/Not on Loopin yet/.test(await V.locator("li").filter({ hasText: "(you)" }).first().innerText()), "the (you) row says “Not on Loopin yet”");
    await V.locator("[data-more-ways] > summary").waitFor();
    await V.getByRole("button", { name: "Copy link" }).waitFor();
    const wa = await V.locator("[data-invite-whatsapp]").evaluate((el) => getComputedStyle(el).backgroundColor);
    // The one cream main button (green is kept for money only).
    assert(wa === "rgb(244, 242, 236)", `the WhatsApp invite button is ${wa}, not Loopin's cream main button (#f4f2ec)`);
    assert((await V.getByText("Add members yourself").count()) === 0, "old “Add members yourself” still there");
    const m = /\/join\/([A-Za-z0-9_-]+)/.exec(await V.content());
    assert(m, "no join link on the page");
    invite = `/join/${m[1]}`;
    return invite;
  });
  await step(null, "Joining", "Someone opening the link sees Join and “Have a Loopin account? Sign in”, and no name box until they tap Join", async () => {
    const x = await person(browser);
    await go(x.page, invite);
    await x.page.getByRole("link", { name: /^Join / }).waitFor();
    await x.page.getByRole("link", { name: "Sign in", exact: true }).waitFor();
    assert((await x.page.locator('input[name="name"]').count()) === 0, "a name box is offered before tapping Join");
    await x.ctx.close();
  });
  await step(A, "Joining", "Asha opens the link, signs up with her email, and joins", async () => {
    await go(A, invite);
    await A.getByRole("link", { name: "Sign in", exact: true }).click();
    await signup(A, "Asha", email("asha"));
    await A.waitForURL(new RegExp(invite));
    await A.getByRole("button", { name: /^Join / }).click();
    await A.waitForURL(new RegExp(`${g}$`));
  });
  await step(R, "Joining", "Ravi does the same from a WhatsApp message", async () => {
    await go(R, invite);
    await R.getByRole("link", { name: "Sign in", exact: true }).click();
    await signup(R, "Ravi", email("ravi"));
    await R.waitForURL(new RegExp(invite));
    await R.getByRole("button", { name: /^Join / }).click();
    await R.waitForURL(new RegExp(`${g}$`));
  });
  await step(A, "Joining", "Only Varun, who started the group, can delete it, change its currency or remove people: Asha sees a calm note instead", async () => {
    await go(A, `${g}/settings`);
    await A.locator('[data-admin-only="delete"]').waitFor();
    const t = (await A.locator("main").innerText()).replace(/\s+/g, " ");
    assert(/Only Varun, who looks after this group/.test(t), `settings says: ${t.slice(0, 300)}`);
    assert((await A.getByRole("button", { name: /Delete (this )?group/i }).count()) === 0, "Asha is offered Delete group");
    assert((await A.locator('select[name="currency"]').count()) === 0, "Asha can change the currency");
    await go(V, `${g}/settings`);
    assert((await V.locator("[data-admin-only]").count()) === 0, "Varun (the starter) sees the admin-only note");
  });
  await step(V, "Joining", "Add by email: Zoe is in the group at once as a name (“Invited · hasn’t joined yet”) and gets an invitation email", async () => {
    await go(V, `${g}/invite`);
    await openWay(V, "email");
    await V.getByLabel("Email addresses to invite").fill(email("zoe"));
    await V.getByRole("button", { name: "Invite", exact: true }).click();
    await V.waitForURL(/invited=/);
    await V.locator("[data-invited-title]").waitFor();
    await V.getByText("Invited · hasn’t joined yet").first().waitFor();
    assert((await db.member.count({ where: { groupId: g.split("/").pop()!, accountId: null, name: nameFromEmail(email("zoe")) } })) === 1, "no name row for Zoe");
  });
  await step(Z, "Joining", "Zoe taps the link in her email, verifies, and joins as the name she was added with", async () => {
    const mailRow = await mailTo(email("zoe"), { subject: { contains: "added to a group" } });
    assert(mailRow, "no invite email for Zoe");
    const link = /https?:\/\/\S+\/join\/\S+/.exec(mailRow.text)?.[0];
    assert(link, "no link in the email");
    await Z.goto(base + new URL(link).pathname + new URL(link).search, { waitUntil: "networkidle" });
    await Z.getByRole("link", { name: "Continue with email" }).click();
    assert((await Z.locator('input[name="email"]').inputValue()) === email("zoe"), "email not filled in from the invite");
    await signup(Z, "Zoe", email("zoe"), true);
    await Z.waitForURL(/\/join\//);
    await Z.getByRole("button", { name: /^Continue as / }).click();
    await Z.waitForURL(new RegExp(`${g}$`));
  });
  await step(V, "Joining", "Invite emails carry an unsubscribe link: one tap stops them, and the next invite to that address isn't sent", async () => {
    await go(V, `${g}/invite`);
    await openWay(V, "email");
    await V.getByLabel("Email addresses to invite").fill(email("optout"));
    await V.getByRole("button", { name: "Invite", exact: true }).click();
    await V.waitForURL(/invited=/);
    const row = await mailTo(email("optout"));
    const link = /https?:\/\/\S+\/api\/unsubscribe\?\S+/.exec(row?.text ?? "")?.[0];
    assert(link, "no unsubscribe link in the invite email");
    const u = new URL(link);
    const page = await V.request.get(`${base}${u.pathname}${u.search}`, { headers: bypass });
    assert(/Stop invite emails\?/.test(await page.text()), "unsubscribe page didn't ask first");
    const forged = await V.request.post(`${base}${u.pathname}?e=${encodeURIComponent(email("optout"))}&s=wrongsignature`, { headers: bypass });
    assert(/doesn’t work/.test(await forged.text()), "a forged unsubscribe link worked");
    const done = await V.request.post(`${base}${u.pathname}${u.search}`, { headers: bypass });
    assert(/Done/.test(await done.text()), "unsubscribe didn't finish");
    const before = await db.outbox.count({ where: { to: email("optout") } });
    await db.invite.deleteMany({ where: { email: email("optout") } });
    await go(V, `${g}/invite`);
    await openWay(V, "email");
    await V.getByLabel("Email addresses to invite").fill(email("optout"));
    await V.getByRole("button", { name: "Invite", exact: true }).click();
    await V.waitForURL(/invited=|error=/);
    assert((await db.outbox.count({ where: { to: email("optout") } })) === before, "an invite was emailed after unsubscribing");
    // Adding by email put "Optout" names in the group. Take them (and their invitations) out again so the group keeps its 4 people.
    const gid = g.split("/").pop()!;
    await db.invite.deleteMany({ where: { groupId: gid, email: email("optout") } });
    // Each "Invite" by email adds a name ("Optout", then "Optout 2" for the second try): take them all out.
    await db.member.deleteMany({ where: { groupId: gid, accountId: null, name: { startsWith: nameFromEmail(email("optout")) } } });
    assert((await db.member.count({ where: { groupId: gid, name: { startsWith: nameFromEmail(email("optout")) } } })) === 0, "an Optout name is still in the group");
  });
  await step(V, "Joining", "Add people shows everyone as “On Loopin ✓” and no pending invites", async () => {
    await go(V, `${g}/invite`);
    const t = (await V.locator("main ul").last().innerText()).replace(/\s+/g, " ");
    const n = (t.match(/On Loopin ✓/g) ?? []).length;
    assert(n === 4, `statuses: ${t}`);
    // Zoe joined, so her invite is gone (the unsubscribe test's name and invitation were removed again).
    const pending = (await V.locator("main").innerText()).replace(/\s+/g, " ");
    assert(!pending.includes(email("zoe")), "Zoe's invite still pending");
    return `${n} verified members`;
  });
  await step(V, "Joining", "Contacts option is there (share sheet when the phone can't pick contacts)", async () => {
    await go(V, `${g}/invite`);
    await openWay(V, "contacts"); // now one of the rows under “More ways to add people”
    await V.getByRole("button", { name: /from contacts/ }).waitFor();
  });

  // ===== 2. Adding expenses =====
  const add = async (page: Page, o: AddOpts) => {
    await go(page, `${g}/add`);
    await fillExpense(page, o);
    return save(page, o);
  };
  await step(V, "Add", "Equal split between everyone (Varun pays ₹1,200 dinner)", async () => {
    await add(V, { me: "Varun", name: "Dinner", amount: "1200" });
    ledger.push({ key: "Dinner", payer: "Varun", amount: 120000, shares: equal(120000, PEOPLE), active: true });
    return checkBalances(V, g);
  });
  await step(A, "Add", "Someone else paid, only some people (Asha pays ₹400 taxi for Asha + Varun)", async () => {
    await add(A, { me: "Asha", name: "Taxi", amount: "400", split: { kind: "only", who: ["Asha", "Varun"] } });
    ledger.push({ key: "Taxi", payer: "Asha", amount: 40000, shares: equal(40000, ["Asha", "Varun"]), active: true });
    return checkBalances(A, g);
  });
  await step(A, "Add", "Next expense remembers the last split (“same as last time”)", async () => {
    await go(A, `${g}/add`);
    await A.getByText("same as last time").waitFor();
  });
  await step(V, "Add", "Paid by someone else on their behalf: Varun records Ravi paid ₹600 for everyone", async () => {
    await add(V, { me: "Varun", name: "Fuel", amount: "600", payer: "Ravi" });
    ledger.push({ key: "Fuel", payer: "Ravi", amount: 60000, shares: equal(60000, PEOPLE), active: true });
    return checkBalances(V, g);
  });
  await step(V, "Add", "For one person only (₹1,000 tickets, just for Ravi)", async () => {
    await add(V, { me: "Varun", name: "Tickets", amount: "1000", split: { kind: "one", who: "Ravi" } });
    ledger.push({ key: "Tickets", payer: "Varun", amount: 100000, shares: { Ravi: 100000 }, active: true });
    return checkBalances(V, g);
  });
  await step(V, "Add", "Custom amounts that add up (₹1,000 = 100 + 200 + 300 + 400)", async () => {
    await add(V, {
      me: "Varun", name: "Groceries", amount: "1000",
      split: { kind: "amounts", values: { Varun: "100", Asha: "200", Ravi: "300", Zoe: "400" } },
    });
    ledger.push({ key: "Groceries", payer: "Varun", amount: 100000, shares: { Varun: 10000, Asha: 20000, Ravi: 30000, Zoe: 40000 }, active: true });
    return checkBalances(V, g);
  });
  await step(V, "Add", "Custom amounts that DON'T add up are refused", async () => {
    return add(V, {
      me: "Varun", name: "Bad split", amount: "1000",
      split: { kind: "amounts", values: { Varun: "100", Asha: "100", Ravi: "100", Zoe: "100" } },
      expectError: /add up|left|more|less|total/i,
    });
  });
  await step(Z, "Add", "Percentages (Zoe pays ₹2,000 hotel, 50% Varun / 50% Zoe)", async () => {
    await add(Z, { me: "Zoe", name: "Hotel", amount: "2000", split: { kind: "percent", values: { Varun: "50", Zoe: "50" } } });
    ledger.push({ key: "Hotel", payer: "Zoe", amount: 200000, shares: { Varun: 100000, Zoe: 100000 }, active: true });
    return checkBalances(Z, g);
  });
  await step(V, "Add", "Percentages that don't make 100% are refused", async () => {
    return add(V, { me: "Varun", name: "Bad %", amount: "500", split: { kind: "percent", values: { Varun: "50", Asha: "20" } }, expectError: /100|percent|%/i });
  });
  await step(V, "Add", "Yesterday's date and a note (₹400 coffee)", async () => {
    await add(V, { me: "Varun", name: "Coffee", amount: "400", date: "Yesterday", notes: "Filter coffee at the beach" });
    ledger.push({ key: "Coffee", payer: "Varun", amount: 40000, shares: equal(40000, PEOPLE), active: true });
    await go(V, `${g}?tab=activity`);
    await V.getByText("Yesterday").first().waitFor();
    await V.getByText("Filter coffee at the beach").first().waitFor({ state: "attached" });
    return checkBalances(V, g);
  });
  await step(V, "Add", "Wrong amounts are refused (letters, zero); an empty name still saves, as “Expense”", async () => {
    await go(V, `${g}/add`);
    await fillExpense(V, { me: "Varun", name: "Junk", amount: "abc" });
    await save(V, { me: "Varun", name: "", amount: "", expectError: /amount/i });
    await V.getByLabel("Amount", { exact: true }).fill("0");
    await save(V, { me: "Varun", name: "", amount: "", expectError: /amount/i });
    // Now the part the title promises: a good amount and no name really saves, and the saved name is "Expense".
    const o = { me: "Varun", name: "", amount: "10" };
    await go(V, `${g}/add`);
    await fillExpense(V, o);
    await save(V, o);
    const gid = g.split("/").pop()!;
    const saved = await db.expense.findFirst({ where: { groupId: gid, amount: 1000, deletedAt: null }, orderBy: { createdAt: "desc" } });
    assert(saved?.description === "Expense", `the empty name was saved as “${saved?.description}”, not “Expense”`);
    ledger.push({ key: "Expense", payer: "Varun", amount: 1000, shares: equal(1000, PEOPLE), active: true });
    return checkBalances(V, g);
  });
  await step(V, "Add", "Double-tapping Save adds the expense only once", async () => {
    await go(V, `${g}/add`);
    await fillExpense(V, { me: "Varun", name: "Water", amount: "200" });
    await V.getByRole("button", { name: "Save expense" }).dblclick();
    await V.waitForURL(/tab=activity/, { timeout: 20_000 });
    ledger.push({ key: "Water", payer: "Varun", amount: 20000, shares: equal(20000, PEOPLE), active: true });
    const count = await V.locator("text=Water").count();
    assert(count >= 1, "Water not in the list");
    return checkBalances(V, g);
  });

  // ===== 3. Editing, clashes, delete, undo =====
  const editPath = async (page: Page, name: string) => {
    await go(page, `${g}?tab=activity&q=${encodeURIComponent(name)}`);
    await page.locator('li[id^="item-"] details > summary').filter({ hasText: name }).first().click(); // not the filter chip, which shows the search word too
    const href = await page.getByRole("link", { name: "Edit or delete" }).first().getAttribute("href");
    assert(href, `no edit link for ${name}`);
    return href;
  };
  await step(V, "Edit", "Edit an amount (Coffee ₹400 → ₹800) and balances follow", async () => {
    const href = await editPath(V, "Coffee");
    await go(V, href);
    await V.getByLabel("Amount", { exact: true }).fill("800");
    await openSplit(V);
    await V.getByRole("button", { name: "Everyone equally" }).click();
    await V.getByRole("button", { name: "Save changes" }).click();
    await V.waitForURL(/tab=activity/);
    const e = ledger.find((x) => x.key === "Coffee")!;
    e.amount = 80000;
    e.shares = equal(80000, PEOPLE);
    return checkBalances(V, g);
  });
  await step(V, "Edit", "Edit clash: Asha saves first, Varun's older copy is warned, not overwritten", async () => {
    const href = await editPath(V, "Water");
    await go(V, href);
    await go(A, href);
    await A.getByLabel("Amount", { exact: true }).fill("240");
    await openSplit(A);
    await A.getByRole("button", { name: "Everyone equally" }).click();
    await A.getByRole("button", { name: "Save changes" }).click();
    await A.waitForURL(/tab=activity/);
    const e = ledger.find((x) => x.key === "Water")!;
    e.amount = 24000;
    e.shares = equal(24000, PEOPLE);
    await V.getByLabel("Amount", { exact: true }).fill("999");
    await openSplit(V);
    await V.getByRole("button", { name: "Everyone equally" }).click();
    await V.getByRole("button", { name: "Save changes" }).click();
    await V.getByText(/changed this expense a moment ago/).waitFor();
    return checkBalances(V, g);
  });
  await step(V, "Edit", "Delete an expense, then Undo brings it back", async () => {
    const href = await editPath(V, "Tickets");
    await go(V, href);
    await V.getByRole("button", { name: "Delete expense" }).click();
    await V.waitForURL(/tab=activity/);
    ledger.find((x) => x.key === "Tickets")!.active = false;
    const after = await checkBalances(V, g);
    await go(V, `${g}?tab=activity&q=Tickets`);
    await V.locator('li[id^="item-"] details > summary').filter({ hasText: "Tickets" }).first().click();
    await V.getByRole("button", { name: "Restore" }).first().click();
    await V.waitForURL(/did=/);
    ledger.find((x) => x.key === "Tickets")!.active = true;
    return `after delete: ${after}; restored: ${await checkBalances(V, g)}`;
  });
  await step(V, "Edit", "Undo bar right after adding an expense removes it again", async () => {
    await add(V, { me: "Varun", name: "Ice cream", amount: "100" });
    await V.getByRole("status").getByRole("button", { name: "Undo", exact: true }).click();
    await V.waitForURL(/undone=1/);
    return checkBalances(V, g);
  });

  // ===== 4. Foreign currency and card fees =====
  await step(V, "Group settings", "Set the group's card markup to 3%", async () => {
    await go(V, `${g}/settings`);
    await V.locator('input[name="markup"][value="300"]').check({ force: true });
    await V.getByRole("button", { name: "Save settings" }).click();
    await V.waitForURL(/saved=settings/);
  });
  await step(V, "Currency", "Card payment abroad: THB 1,000 at 2.5 with 3% card fee = ₹2,575", async () => {
    await go(V, `${g}/add`);
    await fillExpense(V, { me: "Varun", name: "Beach shack", amount: "1000", currency: "THB", method: "Card", rate: "2.5", markup: "group" });
    const box = await V.locator("dl").innerText();
    assert(/2,575/.test(box), `calculation box shows: ${box.replace(/\s+/g, " ")}`);
    // The fee row on its own ("+ ≈ ₹75"), not the "75" inside "2,575" that was just checked.
    assert(/₹75(\.00)?(?![\d,])/.test(box.replace(/2,575(\.00)?/g, "")), `no ₹75 card fee row in: ${box.replace(/\s+/g, " ")}`);
    await V.getByRole("button", { name: "Hide details" }).click();
    const line = await V.locator("[data-fx-card] [data-fx-line]").innerText();
    assert(/2,575/.test(line) && /3% fee/.test(line), `one quiet line: ${line}`);
    const card = await V.locator("[data-fx-card]").innerText();
    assert(/Details/.test(card), `the foreign line has no Details link: ${card.replace(/\s+/g, " ")}`);
    assert((card.match(/2,575/g) ?? []).length === 1, `the sum is repeated on the foreign line: ${card.replace(/\s+/g, " ")}`);
    await V.getByRole("button", { name: "Details", exact: true }).click();
    const maths = await V.locator("[data-fx-maths]").innerText();
    assert(/Balances stay in INR/.test(maths) && /2,575/.test(maths), `the details lost the maths: ${maths.replace(/\s+/g, " ")}`);
    await V.getByRole("button", { name: "Hide details" }).click();
    await save(V, { me: "Varun", name: "", amount: "" });
    ledger.push({ key: "Beach shack", payer: "Varun", amount: 257500, shares: equal(257500, PEOPLE), active: true });
    return checkBalances(V, g);
  });
  await step(V, "Currency", "Cash abroad has no card fee: THB 400 cash at 2.5 = ₹1,000", async () => {
    await go(V, `${g}/add`);
    await fillExpense(V, { me: "Varun", name: "Street food", amount: "400", currency: "THB", method: "Cash", rate: "2.5" });
    const box = await V.locator("dl").innerText();
    assert(!/markup/i.test(box), "cash shows a card markup line");
    await save(V, { me: "Varun", name: "", amount: "" });
    ledger.push({ key: "Street food", payer: "Varun", amount: 100000, shares: equal(100000, PEOPLE), active: true });
    return checkBalances(V, g);
  });
  await step(A, "Currency", "Card with the fee switched off: THB 200 at 2.5, no markup = ₹500", async () => {
    await go(A, `${g}/add`);
    await fillExpense(A, { me: "Asha", name: "Boat", amount: "200", currency: "THB", method: "Card", rate: "2.5", markup: "None" });
    await save(A, { me: "Asha", name: "", amount: "" });
    ledger.push({ key: "Boat", payer: "Asha", amount: 50000, shares: equal(50000, PEOPLE), active: true });
    return checkBalances(A, g);
  });
  await step(A, "Currency", "Custom 2% fee: THB 1,000 at 2.5 = ₹2,550", async () => {
    await go(A, `${g}/add`);
    await fillExpense(A, { me: "Asha", name: "Spa", amount: "1000", currency: "THB", method: "Card", rate: "2.5", markup: "2" });
    const box = await A.locator("dl").innerText();
    assert(/2,550/.test(box), `calculation box: ${box.replace(/\s+/g, " ")}`);
    await save(A, { me: "Asha", name: "", amount: "" });
    ledger.push({ key: "Spa", payer: "Asha", amount: 255000, shares: equal(255000, PEOPLE), active: true });
    return checkBalances(A, g);
  });
  await step(V, "Currency", "Live exchange rate is fetched for USD (or, if the rate service is down, a rate is asked for)", async () => {
    await go(V, `${g}/add`);
    await pickCurrency(V, "USD");
    await V.getByLabel("Amount", { exact: true }).fill("10");
    const line = V.locator("[data-fx-card] [data-fx-line]");
    const down = V.getByText(/Couldn.t reach the rate service/);
    const which = await Promise.race([line.waitFor().then(() => "live"), down.waitFor().then(() => "down")]);
    if (which === "down") {
      // Not the app's fault: the outside service didn't answer. The right behaviour is to ask for the rate.
      assert(await V.getByPlaceholder("rate").count(), "no box to type the rate");
      return "rate service didn't answer; the app asked for the rate by hand (correct)";
    }
    await V.waitForTimeout(3000);
    const t = await line.innerText();
    assert(/≈|=/.test(t), `no converted amount: ${t}`);
    return t.replace(/\s+/g, " ");
  });
  await step(V, "Currency", "Balances shows the THB balance separately (without card fees)", async () => {
    await go(V, `${g}?tab=balances`);
    await V.getByText("THB expenses").first().waitFor();
  });
  await step(V, "Simple screens", "Group top is short: balance, Settle up and Why? only (details moved to People)", async () => {
    await go(V, g);
    const top = await V.locator("[data-group-balance]").first().innerText(); // the money box
    for (const gone of ["THB expenses", "spent across", "card markup"]) assert(!top.includes(gone), `group top still shows “${gone}”`);
    await V.getByRole("link", { name: "Settle up" }).first().waitFor();
    await V.locator("[data-group-balance]").getByRole("link", { name: "Why?" }).first().waitFor();
  });
  await step(V, "Simple screens", "Balances only explains; paying happens on Settle up (no duplicate buttons)", async () => {
    // How many payments clear everything is the money box's line at the top of the group's Overview, no longer a card of its own on Balances.
    await go(V, g);
    await V.locator("[data-summary-line]").filter({ hasText: /payments? clears? everything/ }).first().waitFor();
    await go(V, `${g}?tab=balances`);
    assert((await V.getByRole("button", { name: "Mark as paid" }).count()) === 0, "Balances still has Mark as paid");
    assert((await V.getByText(/payments? clears? everything/).count()) === 0, "Balances still repeats the payments-clear card");
    await V.getByText("spent across").first().waitFor();
  });
  await step(V, "Simple screens", "Activity has one Filter button that opens search, category and person", async () => {
    await go(V, `${g}?tab=activity`);
    assert(!(await V.getByLabel("Category").isVisible()), "filters showing before tapping Filter");
    await V.locator("[data-filter-open]").click();
    // A bottom sheet: "Show results" is fixed at its bottom, inside the screen (never under the bar).
    await V.locator("[data-filter-sheet]").waitFor();
    // The sheet slides up when it opens: measure once it has settled (up to 3 s), not mid-slide.
    await V.waitForFunction(() => { const r = document.querySelector("[data-filter-submit]")?.getBoundingClientRect(); return !!r && r.bottom <= window.innerHeight; }, undefined, { timeout: 3_000 }).catch(() => undefined);
    const sr = (await V.locator("[data-filter-submit]").boundingBox())!;
    assert(sr.y + sr.height <= (V.viewportSize()?.height ?? 844), "Show results is below the screen");
    await V.getByLabel("Category").selectOption("food");
    await V.getByRole("button", { name: "Show results" }).click();
    await V.waitForURL(/cat=food/);
    await V.getByText(/Filtered · \d+ match/).waitFor();
  });

  // ===== 5. Why? =====
  await step(V, "Why?", "“Why?” lines add up to the balance shown", async () => {
    const want = Math.round(expected().Varun);
    await go(V, g);
    await V.locator("[data-group-balance]").getByRole("link", { name: "Why?" }).click();
    await V.waitForURL(/why=/);
    const panel = V.locator("details[id^='why-'][open]").first();
    await panel.waitFor();
    const t = (await panel.innerText()).replace(/\s+/g, " ");
    const m = /You (get back|owe) (₹[\d,.]+)/.exec(t);
    assert(m, `no total line: ${t.slice(0, 200)}`);
    const shown = (m[1] === "owe" ? -1 : 1) * minor(m[2]);
    assert(Math.abs(shown - want) <= 1, `Why? total ${rupees(shown)} vs expected ${rupees(want)}`);
    assert(/card fees/.test(t), "card fees not mentioned in Why?");
    return t.slice(0, 160);
  });

  // ===== 6. Settling up =====
  // Every payment row on Settle up has the same layout: one filled main button (Open payment app or Remind), one outlined action
  // ("I've paid" / "Mark paid": it records the payment, it counts straight away and the other person is told, nothing waits for anyone)
  // and a "Paid a different amount?" link. There is no amount box on the row any more.
  // F1: the quiet closing actions and "Paid a different amount?" sit under a "More options" link: open the one inside `scope` first.
  const openSettleMore = async (scope: ReturnType<Page["locator"]>) => {
    const d = scope.locator("details[data-more-options]").first();
    if ((await d.count()) && !(await d.evaluate((el) => (el as HTMLDetailsElement).open))) await d.locator("summary").click();
  };
  const settleCards = (page: Page) => page.locator("main ul > li[data-transfer-row]");
  // Record row i's payment so it counts straight away, in full or for another amount: through "Paid a different amount?" (Record a payment).
  const rowRecord = async (page: Page, i: number, o: { amount?: string; dbl?: boolean } = {}) => {
    const card = settleCards(page).nth(i);
    await openSettleMore(card); // the link sits under “More options”, closed until opened
    const other = card.getByRole("link", { name: "Paid a different amount?" });
    assert(await other.count(), "a Settle up row has no “Paid a different amount?” link");
    assert((await card.locator('input[name="amount"]:not([type="hidden"])').count()) === 0, "a Settle up row still has an amount box");
    await other.click();
    await page.waitForURL(/\/pay\?/);
    if (o.amount !== undefined) await page.locator('input[name="amount"]:not([type="hidden"])').fill(o.amount);
    const b = page.getByRole("button", { name: /^Record / });
    if (o.dbl) await b.dblclick();
    else await b.click();
  };
  const cardPeople = async (page: Page, i: number, me: Person): Promise<[Person, Person, number]> => {
    const t = (await settleCards(page).nth(i).innerText()).replace(/\s+/g, " ");
    const m = /^(?:[A-Z] )?(\w+) (?:pay|pays) (\w+) (₹[\d,.]+)/.exec(t); // the card starts with the person's initial
    assert(m, `can't read card: ${t}`);
    const who = (s: string) => (s === "You" || s === "you" ? me : (s as Person));
    return [who(m[1]), who(m[2]), minor(m[3])];
  };
  await step(V, "Settle", "Group page has a “Settle up” button that opens the settle screen", async () => {
    await go(V, g);
    await V.getByRole("link", { name: "Settle up" }).first().click();
    await V.waitForURL(/\/settle/);
    const n = await settleCards(V).count();
    assert(n >= 1 && n <= 3, `${n} payments suggested for 4 people`);
    // One cream button on the whole Settle page: the first of your tickets ("Pay …" / "Remind …"), or "Confirm received" when someone is waiting on you.
    // The other tickets, "Between others" rows and the closing buttons are outlined or quiet. No amount box on any row.
    for (let i = 0; i < n; i++) assert((await settleCards(V).nth(i).locator('input[name="amount"]:not([type="hidden"])').count()) === 0, `row ${i} still has an amount box`);
    const cream = await V.locator("main .pop").count();
    const waitingCream = await V.getByRole("region", { name: "Did you get these?" }).locator(".pop").count();
    if (waitingCream > 0) {
      assert(cream === 1 && waitingCream === 1, `${cream} cream buttons while someone waits on you (want only the first “Confirm received”)`);
    } else {
      assert(cream <= 1, `${cream} cream buttons on Settle up`);
      if (cream === 1) assert((await V.getByRole("region", { name: "Yours" }).locator("li[data-transfer-row]").first().locator(".pop").count()) === 1, "the cream button is not on the first of your tickets");
    }
    assert((await V.locator("[data-settle-actions] .pop").count()) === 0, "a cream closing button under the payments");
    // F1/F18: one wording, "Mark all N paid", quiet and under More options; it counts only other people's payments (never mine).
    const markAll = V.locator("[data-settle-actions]").getByRole("button", { name: /Mark all/ });
    assert((await V.getByRole("button", { name: /^Mark all paid \(\d+\)$/ }).count()) === 0, "the old “Mark all paid (N)” wording is back");
    assert((await V.locator("[data-settle-actions] details[data-more-options]").count()) === 1, "Settle up has no “More options” under the payments");
    await openSettleMore(V.locator("[data-settle-actions]"));
    const mineCount = await settleCards(V).filter({ hasText: /^(?:[A-Z] )?You pay / }).count();
    const m = await markAll.count();
    if (m) assert(new RegExp(`^Mark all ${n - mineCount} paid$`).test(((await markAll.first().innerText()) ?? "").trim()), `Mark all says ${await markAll.first().innerText()} but ${n - mineCount} payments are other people's`);
    // F8: the Pay view (opened from "Pay <name>") is where the payment app lives: an INR UPI payee shows the UPI button and no PayPal link;
    // a payee with a pay link (non-INR) shows that link.
    const payLinks = V.getByRole("region", { name: "Yours" }).getByRole("link", { name: /^Pay / });
    const payCount = await payLinks.count();
    for (let i = 0; i < payCount; i++) {
      await go(V, `${g}/settle`);
      await V.getByRole("region", { name: "Yours" }).getByRole("link", { name: /^Pay / }).nth(i).click();
      await V.locator("[data-pay-view]").waitFor();
      const upi = await V.locator("[data-pay-view] [data-pay='upi']").count();
      const alt = await V.locator("[data-pay-view] [data-pay-alt='paypal'], [data-pay-view] [data-pay='paypal']").count();
      const inr = /₹/.test(await V.locator("[data-pay-amount]").innerText());
      if (inr && upi) assert(alt === 0, "a UPI payee's Pay view still offers PayPal");
      if (!inr && !upi) assert((await V.locator("[data-pay-view] [data-pay]").count()) <= 1, "a pay-link payee's Pay view has more than one main link");
    }
    return `${n} payments suggested`;
  });
  await step(V, "Settle", "Bottom bar “Settle” inside a group goes to the same screen", async () => {
    await go(V, g);
    await V.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settle" }).click();
    await V.waitForURL(/\/groups\/[^/]+\/settle/);
  });
  await step(V, "Settle", "Mark a payment as paid in full", async () => {
    await go(V, `${g}/settle`);
    const [from, to, amt] = await cardPeople(V, 0, "Varun");
    await rowRecord(V, 0);
    await V.waitForURL(/paid=1/);
    payments.push({ from, to, amount: amt, active: true, key: "full" });
    return `${from} → ${to} ${rupees(amt)}; ${await checkBalances(V, g)}`;
  });
  await step(V, "Settle", "Record a part payment (change the amount to less)", async () => {
    await go(V, `${g}/settle`);
    const [from, to, amt] = await cardPeople(V, 0, "Varun");
    const part = Math.floor(amt / 2 / 100) * 100;
    await rowRecord(V, 0, { amount: String(part / 100) });
    await V.waitForURL(/paid=1/);
    payments.push({ from, to, amount: part, active: true, key: "part" });
    return `${from} → ${to} ${rupees(part)} of ${rupees(amt)}; ${await checkBalances(V, g)}`;
  });
  await step(V, "Settle", "A zero or nonsense amount is refused", async () => {
    await go(V, `${g}/settle`);
    await rowRecord(V, 0, { amount: "0" });
    await V.getByText(/more than zero|valid amount/).waitFor();
  });
  await step(V, "Settle", "Double-tapping Record payment records it once", async () => {
    await go(V, `${g}/settle`);
    const [from, to, amt] = await cardPeople(V, 0, "Varun");
    await rowRecord(V, 0, { dbl: true });
    await V.waitForURL(/paid=1/);
    payments.push({ from, to, amount: amt, active: true, key: "dbl" });
    return checkBalances(V, g);
  });
  await step(V, "Settle", "Undo a payment from the bar", async () => {
    await go(V, `${g}/settle`);
    if ((await settleCards(V).count()) === 0) return notRun("nothing left to pay");
    const [from, to, amt] = await cardPeople(V, 0, "Varun");
    await rowRecord(V, 0);
    await V.waitForURL(/paid=1/);
    await V.getByRole("status").getByRole("button", { name: "Undo", exact: true }).click();
    await V.waitForURL(/undone=1/);
    void from; void to; void amt;
    return checkBalances(V, g);
  });
  await step(V, "Settle", "“I’ve paid” counts at once: the balances move and nothing waits for Asha", async () => {
    // Set the situation up first, so this money rule always runs (in the main group Varun is never the one who owes): a small group where
    // Asha paid ₹500 for Varun alone, so Varun owes Asha exactly 50000 paise. If the row is missing now, that is a failure, never "not run".
    const ip = await seedGroup("UAT I’ve paid", ["Asha"]);
    const ashaAcc = await db.account.findUniqueOrThrow({ where: { email: email("asha") } });
    await db.member.updateMany({ where: { groupId: ip.id, name: "Asha" }, data: { accountId: ashaAcc.id, claimedAt: new Date() } });
    const o = { me: "Asha", name: "Setup dinner", amount: "500", split: { kind: "one" as const, who: "Varun" } };
    await go(A, `${ip.path}/add`);
    await fillExpense(A, o);
    await save(A, o);
    const owing: GEntry[] = [{ payer: "Asha", amount: 50000, shares: { Varun: 50000 } }];
    await checkLedger(V, ip.path, ["Varun", "Asha"], owing); // Varun −₹500.00, Asha +₹500.00
    await go(V, `${ip.path}/settle`);
    const mine = settleCards(V).filter({ has: V.locator("[data-i-paid]") });
    assert((await mine.count()) === 1, "Varun owes Asha ₹500 but Settle up has no “I’ve paid” row for him");
    const t = (await mine.first().innerText()).replace(/\s+/g, " ");
    const m = /You pay (\w+) (₹[\d,.]+)/.exec(t);
    assert(m, `can't read the row: ${t}`);
    assert(m[1] === "Asha" && minor(m[2]) === 50000, `the row says “${t}”, not “You pay Asha ₹500”`);
    await mine.first().locator("[data-i-paid]").click();
    await V.waitForURL(/paid=1/);
    // The payment counted at once: both are square (and both names are listed, so an empty page can't pass as "all zero").
    const after = await checkLedger(V, ip.path, ["Varun", "Asha"], [...owing, { payer: "Varun", amount: 50000, shares: { Asha: 50000 } }]);
    // Asha is told, but has nothing to answer: nothing under "Needs you", no question on Settle up.
    await go(A, "/notifications");
    assert((await A.locator('[data-need="claim"]').count()) === 0, "Needs you lists a claim after an I've paid");
    assert((await A.getByText(/says they paid/).count()) === 0, "Alerts still says someone 'says they paid'");
    await go(A, `${ip.path}/settle`);
    assert((await A.locator("[data-waiting='Varun']").count()) === 0, "Asha is asked to confirm a payment that already counts");
    return `Varun −₹500.00, Asha +₹500.00 → ${after}`;
  });
  // Record a payment: From and To are folded away until tapped (the To list starts open when nobody is picked yet).
  const pickFrom = async (page: Page, name: string) => {
    const l = page.locator("label", { hasText: name }).first();
    if (!(await l.isVisible())) await page.locator('[data-pick="from"]').click();
    await l.click();
  };
  const pickTo = async (page: Page, name: string) => {
    const l = page.locator("label[data-to]", { hasText: name });
    if (!(await l.isVisible())) await page.locator('[data-pick="to"]').click();
    await l.click();
  };
  await step(V, "Settle", "Record a different payment on the payment screen (Zoe paid Asha ₹50)", async () => {
    await go(V, `${g}/pay`);
    await pickFrom(V, "Zoe");
    await pickTo(V, "Asha");
    await V.locator('input[name="amount"]:not([type="hidden"])').fill("50");
    await V.getByRole("button", { name: /^Record / }).click();
    await V.waitForURL(/paid=1/);
    payments.push({ from: "Zoe", to: "Asha", amount: 5000, active: true, key: "manual" });
    return checkBalances(V, g);
  });
  await step(V, "Settle", "Paying more than owed (an extra zero) asks first and saves nothing until confirmed", async () => {
    await go(V, `${g}/pay`);
    await pickFrom(V, "Zoe");
    await pickTo(V, "Asha");
    await V.locator('input[name="amount"]:not([type="hidden"])').fill("50000");
    const before = await db.payment.count({ where: { groupId: g.split("/").pop()!, deletedAt: null } });
    await V.getByRole("button", { name: /^Record / }).click();
    await V.locator("[data-over-warning]").waitFor();
    const t = (await V.locator("[data-over-warning]").innerText()).replace(/\s+/g, " ");
    // Two wordings, depending on whether the person paid is owed anything right now (pay-record.ts overpayQuestion).
    assert(/\w+ is owed ₹[\d,.]+\. Recording ₹[\d,.]+ means \w+ will owe \w+ ₹[\d,.]+ back\. Record it anyway\?/.test(t) || /This is ₹[\d,.]+ more than what's owed\. Record it anyway\?/.test(t), `warning says: ${t}`);
    assert((await db.payment.count({ where: { groupId: g.split("/").pop()!, deletedAt: null } })) === before, "a payment was saved before confirming");
    // Cancel (first, and the safe default) saves nothing and takes the warning away.
    await V.locator("[data-over-cancel]").click();
    await V.locator("[data-over-warning]").waitFor({ state: "detached" });
    assert((await db.payment.count({ where: { groupId: g.split("/").pop()!, deletedAt: null } })) === before, "Cancel saved a payment");
  });
  await step(V, "Settle", "You can't record paying yourself", async () => {
    await go(V, `${g}/pay`);
    await pickFrom(V, "Asha");
    const target = V.locator("label[data-to]", { hasText: "Asha" });
    assert(!(await target.isVisible()), "“Asha → Asha” is still offered under Paid to");
    // Even if forced, the server says no.
    // The amount is typed first: the form's radios are controlled by the page, so a choice forced in the DOM must come last or typing resets it.
    await V.locator('input[name="amount"]:not([type="hidden"])').fill("10");
    await V.evaluate(() => {
      const r = document.querySelector<HTMLInputElement>('label[data-to] input[name="toId"]');
      const from = document.querySelector<HTMLInputElement>('input[name="fromId"]:checked');
      if (r && from) r.value = from.value;
      if (r) r.checked = true;
    });
    await V.getByRole("button", { name: /^Record / }).click();
    await V.getByText(/two different people/).waitFor();
  });
  await step(V, "Settle", "Settle everything & close, then reopen", async () => {
    await go(V, `${g}/settle`);
    await openSettleMore(V.locator("[data-settle-actions]"));
    await V.getByRole("button", { name: /Settle everything & close|Close group/ }).click();
    await V.waitForURL(/closed=1/);
    await V.getByText("Closed groups").first().waitFor();
    const got = await shownBalances(V, g);
    assertAllSquare(got, PEOPLE, "after settling everything");
    await go(V, g);
    await V.getByRole("button", { name: "Reopen" }).click();
    await V.waitForURL(new RegExp(g));
  });

  // ===== 7. Across groups =====
  let g2 = "", g3 = "";
  const quickGroup = async (name: string) => {
    await go(V, "/groups/new");
    await V.locator('input[name="groupName"]').fill(name);
    await V.locator('select[name="currency"]').selectOption("INR");
    await V.getByRole("button", { name: /Create group/ }).click();
    await V.waitForURL(/\/invite\?new=1/);
    const path = new URL(V.url()).pathname.replace(/\/invite$/, "");
    // Asha is a friend from the first group: search by name and add.
    await openWay(V, "search");
    await V.getByLabel("Search people on Loopin").fill("Asha");
    await V.getByRole("button", { name: "Add", exact: true }).first().click();
    await V.waitForURL(/invited=/);
    await tapJoin(A, name, path);
    return path;
  };
  await step(V, "Across groups", "Two more groups with Asha: she owes ₹500 in one, Varun owes ₹300 in the other", async () => {
    g2 = await quickGroup("UAT Flat");
    g3 = await quickGroup("UAT Dinner club");
    await go(V, `${g2}/add`);
    await fillExpense(V, { me: "Varun", name: "Rent share", amount: "1000" });
    await save(V, { me: "Varun", name: "", amount: "" });
    await go(A, `${g3}/add`);
    await fillExpense(A, { me: "Asha", name: "Pizza", amount: "600" });
    await save(A, { me: "Asha", name: "", amount: "" });
  });
  await step(V, "Across groups", "Settle screen nets them into ONE payment: Asha pays Varun ₹200", async () => {
    await go(V, "/settle");
    // The new look (15 Nov): a summary card, then one card per person under TO PAY / TO RECEIVE (Varun is owed here).
    assert(await V.locator("[data-settle-summary]").count(), "no summary card on the all-groups Settle up");
    const card = V.locator("[data-settle-card='Asha']");
    const t = (await card.innerText()).replace(/\s+/g, " ");
    assert(/₹200/.test(t), `card says: ${t}`);
    assert(/UAT Flat/.test(t) && /UAT Dinner club/.test(t), `the card doesn't name both groups: ${t}`);
    // "View breakdown" opens in place with each group's part and the total.
    await card.locator("[data-breakdown-toggle]").click();
    const lines = (await card.locator("[data-cross-lines]").innerText()).replace(/\s+/g, " ");
    assert(/UAT Flat: Asha pays you ₹500/.test(lines) && /UAT Dinner club: you pay Asha ₹300/.test(lines), `breakdown lines: ${lines}`);
    assert(/Together: Asha pays you ₹200/.test(await card.locator("[data-cross-total]").innerText()), "breakdown total isn't Asha pays you ₹200");
    assert(/1 payment instead of 2/.test((await card.innerText()).replace(/\s+/g, " ")), "doesn't say 1 payment instead of 2");
    // A payment is recorded at once here, so it never says “I’ve paid”.
    assert((await V.locator("main").getByText("I’ve paid").count()) === 0, "the all-groups Settle screen says “I’ve paid”");
    // "Mark received" (Varun is owed) is in the ⋮ menu and opens the sheet; only confirming it saves anything.
    await card.locator("[data-settle-menu]").click();
    await card.getByRole("link", { name: "Mark received" }).or(card.getByRole("button", { name: "Mark received" })).click();
    const sheet = V.locator("[data-record-sheet]");
    await sheet.waitFor();
    assert(/Mark received/.test(await sheet.innerText()) && /Loopin doesn’t move money/.test(await sheet.innerText()), "the sheet doesn't say what it records");
    await sheet.locator("[data-record-confirm]").click();
    await V.waitForURL(/settle=done/);
    const b2 = await shownBalances(V, g2);
    const b3 = await shownBalances(V, g3);
    assertAllSquare(b2, ["Varun"], "the flat group");
    assertAllSquare(b3, ["Varun"], "the second group");
  });
  await step(V, "Across groups", "All square page: a “Hide amounts” switch blanks the money tile (₹ ••••), and the shared picture follows", async () => {
    await go(V, `${g2}/square`);
    await V.locator("[data-square]").waitFor();
    assert(/₹/.test(await V.locator("main").innerText()), "the square page shows no amount to hide");
    await V.locator("[data-hide-amounts]").click();
    await V.waitForURL(/amounts=0/);
    const t = await V.locator("main").innerText();
    // Hidden now means "₹ ••••" (the sign stays, the figure is blanked) on the same "spent together" tile.
    assert(!/₹\s*\d/.test(t), `amounts still shown: ${t.replace(/\s+/g, " ").slice(0, 200)}`);
    assert(/₹\s*••••/.test(t) && /spent together/.test(t), `the money tile isn't blanked as “₹ ••••”: ${t.replace(/\s+/g, " ").slice(0, 200)}`);
    assert((await V.locator("[data-hide-amounts]").getAttribute("aria-checked")) === "true", "the switch doesn't say it's on");
    for (const q of ["", "?amounts=0"]) {
      const r = await V.request.get(`${base}${g2}/square-image${q}`, { headers: bypass });
      assert(r.ok() && /image\/png/.test(r.headers()["content-type"] ?? ""), `square picture ${q || "(amounts shown)"}: ${r.status()}`);
    }
  });

  // ===== 7b. Couples, shares, several payers, money back, filters, add another, repeat, duplicates =====
  let gc = "";
  const coupleBalances = async () => shownBalances(V, gc);
  await step(V, "Couples", "Create a Couple group with the split worked out from incomes (55 / 45), add Asha", async () => {
    await go(V, "/groups/new");
    await V.getByRole("button", { name: /^Couple/ }).click();
    await V.locator('input[name="groupName"]').fill("UAT Us");
    await V.locator('select[name="currency"]').selectOption("INR"); // the default follows where you are (USD from a US test machine)
    await V.getByRole("button", { name: "Next" }).click();
    await V.getByRole("radio", { name: "By income" }).click();
    await V.getByLabel("You earn a month").fill("110000");
    await V.getByLabel("Your partner earns").fill("90000");
    await V.getByText("55 / 45").first().waitFor();
    await V.getByRole("button", { name: /Use 55 \/ 45/ }).click();
    await V.waitForURL(/\/invite\?new=1/);
    gc = new URL(V.url()).pathname.replace(/\/invite$/, "");
    await openWay(V, "search");
    await V.getByLabel("Search people on Loopin").fill("Asha");
    await V.getByRole("button", { name: "Add", exact: true }).first().click();
    await V.waitForURL(/invited=/);
    await V.waitForURL(/invited=.*did=/, { timeout: 5_000 }).catch(() => undefined); // the redirect may land in two hops
    await settleNav(V);
    const ws = await db.member.findMany({ where: { groupId: gc.split("/").pop()! }, orderBy: { createdAt: "asc" } });
    assert(ws.map((m) => m.splitWeight).join("/") === "55/45", `weights are ${ws.map((m) => m.splitWeight).join("/")}`);
  });
  await step(V, "Couples", "“Our split 55 / 45” is chosen by default: ₹1,000 lunch → Asha owes ₹450", async () => {
    await go(V, `${gc}/add`);
    await openSplit(V); // the Who paid? and How to split? chips are on screen
    const chip = V.getByRole("button", { name: /Our split/ });
    assert((await chip.getAttribute("aria-pressed")) === "true", "Our split isn't selected by default");
    await V.locator("#expense-name").fill("Lunch");
    await V.getByLabel("Amount", { exact: true }).fill("1000");
    await save(V, { me: "Varun", name: "Lunch", amount: "1000" });
    const b = await coupleBalances();
    assert(b.Varun === 45000 && b.Asha === -45000, `balances ${JSON.stringify(b)}`);
  });
  await step(V, "Couples", "Two payers: ₹2,000 dinner, you ₹1,500 + Asha ₹500 → Asha owes ₹850 in all", async () => {
    await go(V, `${gc}/add`);
    await V.locator("#expense-name").fill("Dinner date");
    await V.getByLabel("Amount", { exact: true }).fill("2000");
    await openMore(V);
    await V.getByRole("switch", { name: /More than one person paid/ }).click();
    await V.getByLabel("You paid").fill("1500");
    await V.getByLabel("Asha paid").fill("500");
    await V.getByText(/Adds up to/).first().waitFor();
    await save(V, { me: "Varun", name: "Dinner date", amount: "2000" });
    const b = await coupleBalances();
    assert(b.Varun === 85000, `balances ${JSON.stringify(b)}`);
    const row = (await V.locator("main").innerText()).replace(/\s+/g, " ");
    await go(V, `${gc}?tab=activity`);
    assert(/You \+ Asha paid/.test((await V.locator("main").innerText()).replace(/\s+/g, " ")), `history doesn't say “You + Asha paid” (${row.slice(0, 80)})`);
  });
  await step(V, "Couples", "Money back: Asha got ₹200 back, shared 55 / 45 → Asha owes ₹960", async () => {
    await go(V, `${gc}/add`);
    await V.locator("[data-more] > button").click(); // Money back sits under More (no switch at the top)
    await V.getByRole("switch", { name: "Money back" }).click();
    await openSplit(V);
    await V.getByRole("button", { name: /^(✓ )?Asha$/ }).first().click();
    await V.locator("#expense-name").fill("Refund");
    await V.getByLabel("Amount", { exact: true }).fill("200");
    await save(V, { me: "Varun", name: "Refund", amount: "200" }, "Save money back");
    const b = await coupleBalances();
    assert(b.Varun === 96000, `balances ${JSON.stringify(b)}`);
  });
  await step(V, "Browse", "History filters by type and amount (money back only; ₹1,500 and more)", async () => {
    await go(V, `${gc}?tab=activity&type=refund`);
    let t = await V.locator("main").innerText();
    assert(/Refund/.test(t) && !/Dinner date/.test(t), "type filter wrong");
    await go(V, `${gc}?tab=activity&min=1500`);
    t = await V.locator("main").innerText();
    assert(/Dinner date/.test(t) && !/Lunch/.test(t), "amount filter wrong");
  });
  await step(V, "Add", "Save & add another keeps the split and opens a fresh form", async () => {
    await go(V, `${gc}/add`);
    await V.locator("#expense-name").fill("Groceries");
    await V.getByLabel("Amount", { exact: true }).fill("1000");
    await V.getByRole("button", { name: "Save & add another" }).click();
    await V.waitForURL(/\/add\?again=/);
    await V.getByText(/Saved Groceries/).waitFor();
    assert((await V.locator("#expense-name").inputValue()) === "", "name not cleared");
    await openSplit(V);
    assert((await V.getByRole("button", { name: /Our split/ }).getAttribute("aria-pressed")) === "true", "split not kept");
  });
  await step(V, "Add", "Repeat an expense, see the duplicate warning, then add it anyway", async () => {
    await go(V, `${gc}?tab=activity`);
    await V.locator("details summary").filter({ hasText: "Groceries" }).first().click();
    await V.getByRole("link", { name: "Repeat" }).first().click();
    await V.waitForURL(/\/add\?from=/);
    assert((await V.locator("#expense-name").inputValue()) === "Groceries", "repeat didn't copy the name");
    await V.getByRole("button", { name: "Save expense" }).click();
    await V.getByText(/Looks like “Groceries/).waitFor();
    await V.getByRole("button", { name: "It’s a different one" }).click();
    await V.waitForURL(/tab=activity/);
    const b = await coupleBalances();
    assert(b.Varun === 186000, `balances ${JSON.stringify(b)}`);
  });
  await step(V, "Group settings", "Turn off payment notifications for one group", async () => {
    await go(V, `${gc}/settings`);
    await V.locator('input[name="payments"]').uncheck();
    await V.getByRole("button", { name: "Save settings" }).click(); // one Save for the whole settings page
    await V.waitForURL(/saved=settings/);
    const me = await db.member.findFirst({ where: { groupId: gc.split("/").pop()!, name: "Varun" } });
    assert(JSON.parse(me!.notify).payments === false, "not saved");
  });

  // ===== 8. Everything else people do =====
  await step(V, "Add people", "Search by name only finds friends; a full email gets the same neutral Add (no account revealed) and puts a stranger who is on Loopin in the group as an invited name", async () => {
    const x = await person(browser);
    await go(x.page, "/signin?mode=signup");
    await signup(x.page, "Sheldon", email("sheldon"));
    await x.ctx.close();
    await go(V, `${g3}/invite`);
    await openWay(V, "search");
    await V.getByLabel("Search people on Loopin").fill("Sheldon");
    await V.getByText(/Not someone you share a group with/).waitFor();
    await openWay(V, "search");
    await V.getByLabel("Search people on Loopin").fill(email("sheldon"));
    // The same neutral row for any email (nobody can check who has an account); on Loopin → added straight away.
    await V.locator("[data-add-by-email]").waitFor();
    const results = (await V.locator("ul").filter({ has: V.locator("[data-add-by-email]") }).innerText()).replace(/\s+/g, " ");
    assert(!/On Loopin/.test(results) && /In the group now\. We’ll email an invitation/.test(results), `the reply for a full email should be the neutral row "In the group now. We’ll email an invitation" with no "On Loopin" label, but it says: ${results}`);
    await V.locator("[data-add-by-email]").click();
    await V.waitForURL(/invited=/);
    await V.locator("[data-invited-title]").waitFor();
  });
  await step(A, "Alerts", "Asha sees an unread alert badge and Varun's changes in Alerts", async () => {
    await go(A, "/");
    // The unread count moved from the bottom bar to the bell at the top right of Home (aria-label "Updates (N new)").
    const label = await A.locator("[data-bell]").first().getAttribute("aria-label");
    assert(/new/.test(label ?? ""), `Updates bell label: ${label}`);
    await go(A, "/notifications?tab=all");
    await A.getByText(/Varun/).first().waitFor();
  });
  await step(A, "Alerts", "Asha was told she was added to the new groups", async () => {
    await go(A, "/notifications?tab=all");
    await A.getByText(/added Asha to the group/).first().waitFor();
  });
  await step(V, "Home", "Home opens on ONE slim Net card (about 80px: “Net · you’re owed/you owe” and the net amount once, “Group” and “Non-group” lines only when both exist, or “All square” + “You’re all square”), the whole card is one link to Settle up with no buttons inside, no photo or tint; nothing under it (what needs you is in Updates behind the bell)", async () => {
    await go(V, "/");
    const money = V.locator("[data-balance-card]").first();
    await money.waitFor();
    const kind = await money.getAttribute("data-ticket"); // square | net
    const tone = await money.getAttribute("data-tone");
    const text = (await money.innerText()).replace(/\s+/g, " ").trim();
    assert(!/Add expense|Remind|Review & settle/.test(text), `the money card still has a button's words: ${text}`);
    assert(!/Coming back to you|You owe, to /.test(text), `the money card still has the old wording: ${text}`);
    // The whole card is ONE link to Settle up, with no button, link or photo inside it.
    assert((await money.evaluate((el) => el.tagName)) === "A" && (await money.getAttribute("href")) === "/settle", "the money card is not one link to /settle");
    assert((await money.locator("a, button, img, [data-money-action], [data-money-people], [data-route], [data-mark]").count()) === 0, "the money card has something inside it besides words");
    // Calm dark card: no gradient wash and no coloured border, whatever the state.
    const look = await money.evaluate((el) => ({ bg: getComputedStyle(el).backgroundImage, border: getComputedStyle(el).borderTopWidth }));
    assert(look.bg === "none" && look.border === "0px", `the money card is tinted or outlined (${look.bg}, ${look.border})`);
    const name = (await money.getAttribute("aria-label")) ?? "";
    if (kind === "square") {
      assert(tone === "square" && text === "All square You’re all square", `all-square card: ${tone} ${text}`);
      assert(/^All square/.test(name), `all-square card's name: ${name}`);
    } else {
      assert(kind === "net", `unknown money card kind ${kind}`);
      // Never says All square while money is open: a net card always has a figure.
      assert(!/All square/.test(text), `the card says All square while money is open: ${text}`);
      assert(/^Net · /.test(text), `the card should start with "Net ·": ${text}`);
      const amount = (await money.locator("[data-net-balance]").first().innerText()).trim();
      assert(/\d/.test(amount), `the amount is "${amount}"`);
      assert(text.split(amount).length === 2 || /^[+−]/.test(amount), `the net amount "${amount}" is repeated on the card: ${text}`);
      if (tone === "owe" || tone === "owed") {
        assert(tone === "owe" ? /^Net · you owe\b/.test(text) : /^Net · you’re owed\b/.test(text), `the label doesn't match the ${tone} card: ${text}`);
        assert(name.startsWith(`Net, ${tone === "owe" ? "you owe" : "you’re owed"} `) && name.endsWith("Open Settle up"), `the card's spoken name is "${name}"`);
      }
      // Group / Non-group lines: only both together, each with a sign and a figure.
      const lines = await money.locator("[data-net-line]").allInnerTexts();
      assert(lines.length === 0 || (lines.length === 2 && /^Group .*[+−]/.test(lines[0]) && /^Non-group .*[+−]/.test(lines[1])), `the Group / Non-group lines are: ${lines.join(" | ")}`);
    }
    // Home has no "what needs you" line or section: that lives in Updates behind the bell (the claim to confirm is checked there, around "Needs you").
    assert((await V.locator("[data-needs-you]").count()) === 0, "Home still has a separate Needs you section");
    assert((await V.getByRole("heading", { name: "Needs you" }).count()) === 0, "Home still has a Needs you heading");
    assert((await V.locator("[data-need-line]").count()) === 0, "Home still has the need line");
    assert((await V.locator("[data-need-link]").count()) === 0, "Home still has a need link");
    await V.getByRole("heading", { name: "Your groups" }).waitFor();
    await V.getByRole("link", { name: "See all" }).first().waitFor();
    await V.locator("[data-group-card]").first().waitFor();
    const nav = V.getByRole("navigation", { name: "Main" });
    await nav.waitFor();
    assert(await nav.getByRole("link", { name: "Add expense" }).count(), "the bottom bar lost its “+”");
  });
  await step(V, "Home", "On a small phone (375×667) the header, the money card (one-amount card at most about 200px tall, both-ways about 260px) and its buttons (44px tall) sit inside the first screen above the bottom bar, the Your groups row starts above the bottom bar with “+ New group” and two whole polaroids; the bottom bar's + goes to the group picker or the only group", async () => {
    const was = V.viewportSize();
    await V.setViewportSize({ width: 375, height: 667 });
    await go(V, "/");
    const card = V.locator("[data-balance-card]").first();
    await card.waitFor();
    const box = (await card.boundingBox())!;
    assert(box.y >= 0 && box.y + box.height <= 667, `the money card ends at ${Math.round(box.y + box.height)}px of 667`);
    // The slim Net card: about 80px (at 320 the Group / Non-group lines may drop under the amount, so a little more).
    assert(box.height <= 120, `the money card is ${Math.round(box.height)}px tall (should be about 80)`);
    // At least the first group card starts above the bottom bar.
    const nav = (await V.getByRole("navigation", { name: "Main" }).boundingBox())!;
    const first = (await V.locator("[data-group-card]").first().boundingBox())!;
    assert(first.y < nav.y, `the first group card starts at ${Math.round(first.y)}px, under the bottom bar (${Math.round(nav.y)}px)`);
    assert(box.y + box.height <= nav.y + 1, `the money card ends at ${Math.round(box.y + box.height)}px, under the bottom bar (${Math.round(nav.y)}px)`);
    // Founder, 15 Nov: “+ New group” and TWO whole polaroids fit the first screen (as in the mockup); a third, if any, is just off to the right.
    assert(first.width >= 90 && first.width <= 152, `a group card is ${Math.round(first.width)}px wide (two should fit beside “+ New group”)`);
    const newCard = (await V.locator("[data-group-card-new]").boundingBox())!;
    assert(newCard.x >= 0 && newCard.x + newCard.width <= 375 && first.x + first.width <= 375, "“+ New group” and the first group card aren't both whole on the first screen");
    const cards = await V.locator("[data-group-card]").all();
    if (cards.length > 1) {
      const second = (await cards[1].boundingBox())!;
      assert(second.x + second.width <= 375 + 1, `the second group card isn't whole on the first screen (it spans ${Math.round(second.x)}–${Math.round(second.x + second.width)}px of 375)`);
    }
    // The stories row, when there is one, is above the money card with 80px circles.
    if (await V.locator("[data-stories]").count()) {
      const st = (await V.locator("[data-stories] button").first().boundingBox())!;
      assert(st.y + st.height <= box.y, "the stories row isn't above the money card");
      const ring = (await V.locator("[data-stories] li").first().locator("span").first().boundingBox())!;
      assert(Math.round(ring.width) === 80 && Math.round(ring.height) === 80, `a story circle is ${Math.round(ring.width)}×${Math.round(ring.height)}px`);
    }
    await V.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Add expense" }).click();
    await V.waitForURL((u) => u.pathname === "/add" || /\/groups\/[^/]+\/add$/.test(u.pathname));
    if (was) await V.setViewportSize(was);
  });
  await step(V, "Home", "Home lists each group once: polaroid cards only (no old vertical list, no “Show all N groups”), each open group on one card, and the stories row is absent when there are no stories", async () => {
    await go(V, "/");
    assert((await V.locator("[data-group-line]").count()) === 0, "the old vertical group list is still on Home");
    assert((await V.getByText(/^Show all \d+ groups$/).count()) === 0, "“Show all N groups” is still on Home");
    const hrefs = await V.locator("[data-group-card]").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    assert(hrefs.length > 0 && new Set(hrefs).size === hrefs.length, `group cards: ${hrefs.join(" ")}`);
    // Every card says where you stand in words that are not just a colour.
    for (const t of await V.locator("[data-group-card]").evaluateAll((els) => els.map((e) => ({ tone: e.getAttribute("data-tone"), text: (e as HTMLElement).innerText })))) {
      if (t.tone === "square") assert(/Settled/.test(t.text), `a square card says: ${t.text}`);
      else assert(t.tone === "owed" ? /You’re owed/.test(t.text) : /You owe/.test(t.text), `a ${t.tone} card says: ${t.text}`);
      assert(!/[₹$€£]\s?\d/.test(t.text), `a polaroid repeats an amount: ${t.text}`);
    }
    // One stories row at most, and not again lower down; no row at all when there are no stories.
    assert((await V.locator("[data-stories]").count()) <= 1, "stories show twice on Home");
    if ((await V.locator("[data-story]").count()) === 0) assert((await V.getByRole("region", { name: "Stories" }).count()) === 0, "an empty stories row is showing");
  });
  await step(V, "Home", "F6/F10/F19: FAQ, Privacy and Terms on Home each have a 44px tap area with space between them; Latest says “Payment”, never “Settle-up”; the You page footer has a Privacy link with a 44px target", async () => {
    await go(V, "/");
    const boxes: { x: number; w: number; h: number }[] = [];
    for (const name of ["FAQ", "Privacy", "Terms"]) {
      const l = V.locator("[data-footer-links]").getByRole("link", { name, exact: true });
      await l.waitFor();
      const b = (await l.boundingBox())!;
      assert(b.height >= 43.5 && b.width >= 43.5, `the ${name} link is ${Math.round(b.width)}×${Math.round(b.height)}px (needs 44×44)`);
      boxes.push({ x: b.x, w: b.width, h: b.height });
    }
    for (let i = 1; i < boxes.length; i++) assert(boxes[i].x >= boxes[i - 1].x + boxes[i - 1].w - 0.5, "the footer links overlap each other");
    assert(!/Settle-up\b/.test(await V.locator("main").innerText()), "Home still says “Settle-up” somewhere (Latest should say “Payment”)");
    await go(V, "/account");
    const priv = V.locator("[data-footer-links]").getByRole("link", { name: "Privacy", exact: true });
    await priv.waitFor();
    const pb = (await priv.boundingBox())!;
    assert(pb.height >= 43.5, `the You page Privacy link is ${Math.round(pb.height)}px tall`);
    assert((await priv.getAttribute("href")) === "/privacy", "the You page Privacy link goes elsewhere");
    // F9: "Your share / You paid / You're owed" everywhere, including the Recap on Search (no "My cut", "I paid", "I'm owed").
    await go(V, "/search");
    const recap = await V.locator("main").innerText();
    assert(!/My cut|\bI paid\b|I’m owed|I owe\b/.test(recap), "Search/Recap still says “My cut” / “I paid” / “I’m owed”");
  });
  await step(V, "Home", "F5: an open story's full-screen photo is requested big and sharp (its image address asks for 1920px or wider, quality 90)", async () => {
    await go(V, "/");
    const first = V.locator("[data-stories] button").first();
    if (!(await first.count())) return notRun("no story on Home to open (it depends on trips with dates)");
    await first.click();
    await V.waitForTimeout(700);
    const imgs = (await V.evaluate(
      "Array.from(document.querySelectorAll('img')).filter(function(i){return i.getBoundingClientRect().height > 400}).map(function(i){return i.srcset || i.src})",
    )) as string[];
    if (imgs.length) {
      const widths = [...imgs.join(",").matchAll(/[?&]w=(\d+)/g)].map((m) => Number(m[1]));
      assert(widths.length > 0 && Math.max(...widths) >= 1920, `the story photo is only offered up to ${Math.max(0, ...widths)}px wide`);
      assert(/q=90/.test(imgs.join(",")), "the story photo isn't requested at quality 90");
    }
    await V.keyboard.press("Escape");
  });
  await step(V, "Home", "“+ New group” is the first card in Your groups (dashed, as tall as the polaroids, at least 44px), whatever the number of groups, and one tap opens the new-group page; “See all” stays in the header", async () => {
    await go(V, "/");
    const newCard = V.locator("[data-group-card-new]");
    assert((await newCard.count()) === 1, "there isn't exactly one “+ New group” card on Home");
    const row = V.locator("[data-group-cards]");
    const order = await row.locator("li").evaluateAll((els) => els.map((e) => (e.querySelector("[data-group-card-new]") ? "new" : e.querySelector("[data-group-card]") ? "group" : "end")));
    assert(order[0] === "new", `the first card in the row is ${order[0]}, not “+ New group”`);
    assert(/New group/.test(await newCard.innerText()), "the first card doesn't say New group");
    const nb = (await newCard.boundingBox())!;
    // Polaroids differ in height (a long name wraps to two lines), so the card matches the tallest one in the row.
    const heights = await V.locator("[data-group-card]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    const tallest = Math.max(...heights);
    assert(nb.width >= 44 && nb.height >= 44, `the “+ New group” card is ${Math.round(nb.width)}×${Math.round(nb.height)}px`);
    assert(Math.abs(nb.height - tallest) <= 14, `the “+ New group” card is ${Math.round(nb.height)}px tall, the tallest group card ${Math.round(tallest)}px`);
    assert((await V.getByRole("link", { name: "See all" }).count()) >= 1, "“See all” is gone from the header");
    await newCard.click();
    await V.waitForURL(/\/groups\/new/);
    await go(V, "/");
  });
  await step(V, "Home", "Home order: Latest comes straight after Your groups (only the trip countdown may sit between); closed groups and Recently deleted are not on Home; the “saved on this device” note is below everything but the footer", async () => {
    await go(V, "/");
    const y = async (loc: ReturnType<Page["locator"]>) => ((await loc.count()) ? (await loc.first().boundingBox())!.y : -1);
    const groups = await y(V.getByRole("heading", { name: "Your groups" }));
    const latest = await y(V.getByRole("heading", { name: "Latest" }));
    assert(groups >= 0, "no Your groups heading");
    if (latest >= 0) {
      assert(latest > groups, "Latest is above Your groups");
      const collecting = await y(V.getByRole("heading", { name: "Collecting" }));
      assert(collecting < 0 || collecting > latest, "“Collecting” sits between Your groups and Latest");
      assert((await V.getByText(/^Closed groups \(\d+\)$/).count()) === 0, "closed groups are listed on Home");
      // A plain string, so the test runner's helper names (__name) never reach the page.
      const between = (await V.evaluate(`(() => {
        const hs = Array.from(document.querySelectorAll("h2"));
        const fromH = hs.find((h) => (h.textContent || "").trim() === "Your groups");
        const toH = hs.find((h) => (h.textContent || "").trim() === "Latest");
        const from = fromH && fromH.closest("section"), to = toH && toH.closest("section");
        if (!from || !to) return [];
        const out = [];
        for (let n = from.nextElementSibling; n && n !== to; n = n.nextElementSibling) {
          const h = n.querySelector("h2");
          out.push((n.getAttribute("aria-label") || (h && h.textContent) || n.tagName).trim());
        }
        return out;
      })()`)) as string[];
      const allowed = /^(Coming up|Your trips)$/; // "Your trips" when one of them is already on
      assert(between.every((b) => allowed.test(b)), `between Your groups and Latest: ${between.join(", ")}`);
    }
    const phone = V.getByText(/saved on this device/);
    if (await phone.count()) {
      const footer = await y(V.getByRole("link", { name: "FAQ" }));
      assert((await phone.first().boundingBox())!.y < footer, "the phone-only note is below the footer");
      if (latest >= 0) assert((await phone.first().boundingBox())!.y > latest, "the phone-only note is above Latest");
    }
    assert((await V.getByText(/^(Recently deleted|Hide recently deleted)/).count()) === 0, "Recently deleted is still on Home");
  });
  await step(V, "Home", "On the narrowest phone (320×640, also 360 and 390) the money card has no sideways scroll: nothing is cut off, the amount always shows whole, there is no photo (founder, 15 Nov evening: short card), the buttons keep their words inside, and the card has no tint", async () => {
    const was = V.viewportSize();
    await V.setViewportSize({ width: 320, height: 640 });
    await go(V, "/");
    const card = V.locator("[data-balance-card]").first();
    await card.waitFor();
    for (const w of [320, 360, 390]) {
      await V.setViewportSize({ width: w, height: 700 });
      await go(V, "/");
      await card.waitFor();
      const over = (await card.evaluate((el) => {
        const bad: string[] = [];
        const cr = el.getBoundingClientRect();
        if (cr.right > window.innerWidth + 0.5 || el.scrollWidth > el.clientWidth + 1) bad.push("card");
        el.querySelectorAll("[data-net-balance], [data-net-line], [data-net-label], [data-ticket-context]").forEach((e) => {
                    const r = e.getBoundingClientRect();
          const name = e.hasAttribute("data-net-balance") ? "amount" : e.hasAttribute("data-net-line") ? "line" : "text";
          if (r.right > cr.right + 0.5 || r.left < cr.left - 0.5) bad.push(name);
          // The amount is never the thing that is cut: it fits its own box.
          if (e.hasAttribute("data-net-balance") && (e as HTMLElement).scrollWidth > (e as HTMLElement).clientWidth + 1) bad.push("amount cut");
        });
        return bad;
      })) as string[];
      assert(over.length === 0, `at ${w}px these spill out of the money card: ${over.join(", ")}`);
      assert((await V.evaluate("document.documentElement.scrollWidth <= window.innerWidth")) as boolean, `Home scrolls sideways at ${w}px`);
      assert((await card.locator("[data-card-photo], img").count()) === 0, `at ${w}px the money card still has a photo`);
      const amounts = await card.locator("[data-net-balance]").allInnerTexts();
      assert(amounts.every((t) => /[\d]/.test(t)) && amounts.every((t) => !t.includes("…")), `at ${w}px an amount is cut: ${amounts.join(" | ")}`);
      const bg = await card.evaluate((el) => getComputedStyle(el).backgroundImage);
      assert(bg === "none", `the money card has a wash at ${w}px: ${bg}`);
    }
    if (was) await V.setViewportSize(was);
  });
  await step(V, "Home", "The bottom bar is nearly solid (background alpha 0.9 or more) so words never show through, and big amounts on Home are whole rupees", async () => {
    await go(V, "/");
    const alpha = await V.locator("[data-bottom-nav] > div").first().evaluate((el) => {
      const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(el).backgroundColor);
      if (!m) return 0;
      const p = m[1].split(/[ ,/]+/).filter(Boolean);
      return p.length > 3 ? Number(p[3]) : 1;
    });
    assert(alpha >= 0.9, `the bottom bar background alpha is ${alpha}`);
    const hero = (await V.locator("[data-net-balance]").first().innerText()).trim();
    if (/₹\s?[\d,]{5,}/.test(hero)) assert(!/\.\d\d$/.test(hero), `the money card total isn't rounded: ${hero}`);
    for (const t of await V.locator("[data-group-card]").evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText))) {
      const m = /[₹]\s?([\d,]+)(\.\d\d)?/.exec(t);
      if (m && Number(m[1].replace(/,/g, "")) >= 1000) assert(!m[2], `a polaroid balance isn't rounded: ${t}`);
    }
    // Story labels: one line, at most 10 characters.
    for (const t of await V.locator("[data-story-label]").allInnerTexts()) assert([...t.trim()].length <= 10, `a story label is too long: ${t}`);
  });
  await step(V, "Home", "The ONE sliding row: weather for your next trip first, then the month, a bill due soon, a postcard, your passport and the festival when it is on, so 2 to 6 of them, no two the same, each with words and a button that goes somewhere, with no trip photos", async () => {
    await go(V, "/");
    const slides = V.locator('[aria-roledescription="slide"]');
    const n = await slides.count();
    assert(n >= 2 && n <= 6, `${n} cards`);
    if ((await V.locator("[data-weather-art]").count()) > 0) assert((await slides.first().locator("[data-weather-art]").count()) === 1, "the weather card is not the first card");
    for (const t of await slides.evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText))) assert(!/Wish they were here|spent today|payments? squares? it|Who’s booking what|While you’re in|Where to next/.test(t), `an old trip or filler card is back: ${t}`);
    assert((await V.locator('[aria-roledescription="slide"]').filter({ hasText: "Coming from another app" }).count()) === 0, "the switching card is back on Home");
    const texts = await slides.evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, " ").trim()));
    assert(new Set(texts).size === texts.length, `the same card twice: ${texts.join(" / ")}`);
    for (const t of texts) assert(t.length > 30, `a card with almost nothing on it: “${t}”`);
    const hrefs = await slides.locator("a").evaluateAll((els) => els.map((e) => e.getAttribute("href") ?? ""));
    assert(hrefs.length >= n && hrefs.every((h) => h.startsWith("/")), `buttons: ${hrefs.join(" ")}`);
    return texts.map((t) => t.slice(0, 60)).join(" · ");
  });
  await step(V, "Home", "Tapping an expense in Latest opens it in its group, expanded, with Edit or delete", async () => {
    await go(V, "/");
    const latest = V.locator("section").filter({ has: V.getByRole("heading", { name: "Latest" }) });
    await latest.locator("li a").first().click();
    await V.waitForURL(/tab=activity&open=/);
    const id = new URL(V.url()).searchParams.get("open")!;
    assert(await V.locator(`#item-${id} details[open]`).count(), "the expense isn't opened");
    await V.locator(`#item-${id}`).getByText(/Edit or delete|Restore|Delete payment/).first().waitFor();
  });
  await step(V, "Home", "Messages at the top have a ✕: closing one hides it, and a refresh doesn't bring it back", async () => {
    await go(V, "/?signedin=1");
    const msg = V.getByRole("status").filter({ hasText: /Signed in/ });
    await msg.waitFor();
    await msg.getByRole("button", { name: "Close message" }).click();
    await msg.waitFor({ state: "detached" });
    assert(!/signedin=1/.test(V.url()), `address still has the marker: ${V.url()}`);
    await V.reload({ waitUntil: "load" }); // (the message is drawn by the server; no need to wait for every small picture to finish)
    await V.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
    assert((await V.getByRole("status").filter({ hasText: /Signed in/ }).count()) === 0, "the message came back after a refresh");
  });
  await step(V, "Home", "Bottom bar is hidden while adding an expense", async () => {
    await go(V, `${g}/add`);
    assert((await V.getByRole("navigation", { name: "Main" }).count()) === 0, "bottom bar shows on the add screen");
  });
  await step(V, "Search", "Search finds “Dinner” across groups", async () => {
    await go(V, "/search?q=Dinner");
    await V.getByText("Dinner").first().waitFor();
  });
  await step(V, "Export", "Spreadsheet download contains the expenses", async () => {
    const r = await V.request.get(`${base}${g}/export`, { headers: bypass });
    assert(r.ok(), `status ${r.status()}`);
    assert(/text\/csv/.test(r.headers()["content-type"] ?? ""), "not a CSV");
    const body = await r.text();
    assert(/Dinner/.test(body) && /Beach shack/.test(body), "CSV is missing expenses");
  });
  await step(V, "Group settings", "Change a group's currency (UAT Dinner club INR → USD at 0.012)", async () => {
    await go(V, `${g3}/settings`);
    await V.locator('select[name="currency"]').selectOption("USD");
    await V.getByRole("button", { name: "Save settings" }).click();
    await V.waitForURL(/convert=USD/);
    await V.locator('input[name="rate"]').fill("0.012");
    await V.getByRole("button", { name: /Convert to USD/ }).click();
    await V.waitForURL(/saved=settings/);
    // The group total moved from the top of the group to Balances.
    await go(V, `${g3}?tab=balances`);
    await V.getByText(/(USD\s|\$)7\.20 spent across/).first().waitFor();
  });
  await step(V, "Group settings", "Delete a group: it lands on Your groups with Recently deleted open (not on Home), You links to it, restore brings it back", async () => {
    await go(V, `${g3}/settings`);
    await V.getByRole("button", { name: "Delete group" }).click();
    await V.waitForURL(/\/groups\?deleted=group/);
    await V.getByText("Group deleted. You can restore it here for 30 days.").waitFor();
    const box = await V.locator("[data-recently-deleted]").boundingBox();
    assert(box && box.y < (V.viewportSize()?.height ?? 800), "Recently deleted isn't on the first screen after a delete");
    await V.getByText("Hide recently deleted").waitFor(); // opens on its own right after a delete
    assert((await V.locator("#deleted").count()) === 1, "no #deleted block on Your groups");
    // Home no longer carries it.
    await go(V, "/");
    assert((await V.getByText(/Recently deleted/).count()) === 0, "Recently deleted is still on Home");
    // The You page has a quiet line to it, with the count.
    await go(V, "/account");
    const link = V.locator("[data-deleted-link]");
    await link.waitFor();
    assert(/^Recently deleted groups \(\d+\)/.test((await link.innerText()).trim()), "the You page line has no count");
    assert((await link.boundingBox())!.height >= 44, "the You page line is under 44px tall");
    await link.click();
    await V.waitForURL(/\/groups#deleted/);
    await V.getByText(/^Recently deleted \(\d+\)$/).click(); // closed until tapped
    await V.getByRole("button", { name: "Restore" }).first().click();
    await V.waitForURL(new RegExp(g3));
  });
  await step(V, "People", "Rename someone on the People screen", async () => {
    // A real rename: Zoe becomes "Zoe K", then goes back, and the name is checked on the screen and in the database both times.
    const gid = g.split("/").pop()!;
    const zoe = await db.member.findFirstOrThrow({ where: { groupId: gid, name: "Zoe" } });
    const rename = async (to: string) => {
      await go(V, `${g}/people`);
      await V.locator("details summary").filter({ hasText: /Zoe/ }).first().click(); // the row reads "ZZoe…" (initial circle first)
      const box = V.locator("details[open]").locator('input[name="name"]').first();
      await box.fill(to);
      await box.press("Enter");
      await until(`Zoe renamed to ${to}`, async () => (await db.member.findUnique({ where: { id: zoe.id } }))?.name === to);
      await go(V, `${g}/people`);
      assert(new RegExp(to.replace(/\s+/g, "\\s+")).test(await V.locator("body").innerText()), `“${to}” is not shown on the People screen after the rename`);
    };
    await rename("Zoe K");
    await rename("Zoe"); // back, so the rest of the run still knows her as Zoe
  });
  await step(V, "Account", "Signed in: You page shows the email; Sign in goes to it; privacy page opens", async () => {
    await go(V, "/account");
    await V.getByText(email("varun")).first().waitFor();
    await go(V, "/signin");
    await V.waitForURL(/\/account/);
    await go(V, "/privacy");
    await V.getByText("What we store").waitFor();
  });

  // ===== 10. Everything else people do in a group =====
  const clickAndWait = async (page: Page, target: ReturnType<Page["locator"]>) => {
    const before = page.url();
    await target.click();
    await page.waitForURL((u) => u.href !== before, { timeout: 20_000 });
  };
  const groupNameShown = async (page: Page, path: string) => (await (await go(page, path), page.locator("header h1").first()).innerText());
  await step(V, "Group settings", "Rename a group, then Undo puts the old name back", async () => {
    await go(V, `${g2}/settings`);
    await V.locator('input[name="name"]').fill("UAT Flat renamed");
    await V.getByRole("button", { name: "Save settings" }).click();
    await V.waitForURL(/saved=settings/);
    assert((await groupNameShown(V, g2)).includes("UAT Flat renamed"), "new name not shown");
    await go(V, `${g2}/settings`);
    await V.locator('input[name="name"]').fill("UAT Flat");
    await V.getByRole("button", { name: "Save settings" }).click();
    await V.waitForURL(/did=/);
    await V.getByRole("status").getByRole("button", { name: "Undo", exact: true }).click();
    await V.waitForURL(/undone=1/);
    assert((await groupNameShown(V, g2)).includes("UAT Flat renamed"), "undo didn't restore the name");
  });
  await step(V, "Group settings", "Show amounts in a second currency (USD) next to balances", async () => {
    await go(V, `${g2}/settings`);
    await V.getByRole("radio", { name: /USD/ }).click(); // chips, not a dropdown; USD is one of the popular few
    assert((await V.locator('input[name="secondaryCurrency"]').inputValue()) === "USD", "the second-currency chip didn't set USD");
    await V.getByRole("button", { name: "Save settings" }).click();
    await V.waitForURL(/saved=settings/);
    // The ≈ USD line sits with the balances on the People tab (the Overview pass shows one balance, or "All square").
    await go(V, `${g2}?tab=balances`);
    const t = await V.locator("main").innerText();
    assert(/amounts in USD|USD amounts/.test(t), "no USD shown with the group's balances");
  });
  await step(V, "Close & reopen", "Close a group from settings: it moves to Closed groups and new expenses are paused", async () => {
    await go(V, `${g2}/settings`);
    await V.locator("#close").getByRole("button", { name: "Close group" }).click();
    await V.waitForURL(/closed=1/);
    await V.getByText("Closed groups").first().waitFor();
    await go(V, `${g2}/add`);
    await V.getByText(/This group is closed/).waitFor();
  });
  await step(V, "Close & reopen", "Reopen it from the add screen", async () => {
    await go(V, `${g2}/add`);
    await clickAndWait(V, V.getByRole("button", { name: "Reopen group" }));
    await go(V, `${g2}/add`);
    await V.locator("#expense-name").waitFor();
  });
  await step(V, "People", "Rename a person, then rename back", async () => {
    await go(V, `${g2}/people`);
    await V.locator("details summary").filter({ hasText: "Asha" }).first().click();
    await V.getByLabel("New name for Asha").fill("Asha K");
    await clickAndWait(V, V.getByRole("button", { name: "Rename" }).first());
    await go(V, `${g2}/people`);
    await V.getByText("Asha K").first().waitFor();
    await V.locator("details summary").filter({ hasText: "Asha K" }).first().click();
    await V.getByLabel("New name for Asha K").fill("Asha");
    await clickAndWait(V, V.getByRole("button", { name: "Rename" }).first());
  });
  await step(V, "People", "Remove someone settled up (the admin removes; they show under Removed), then bring them back", async () => {
    await go(V, `${g2}/people`);
    await V.locator("details summary").filter({ hasText: "Asha" }).first().click();
    await clickAndWait(V, V.getByRole("button", { name: "Remove Asha" })); // the confirm is accepted by the dialog handler
    await go(V, `${g2}/people`);
    await V.locator("[data-removed-section]").waitFor();
    assert((await V.locator("[data-removed-section]").getByText("Removed from the group").count()) === 1, "Asha isn't shown as removed");
    assert((await V.getByText("Left the group", { exact: true }).count()) === 0, "a removed person is shown as having left");
    // Asha has an account, so she comes back only by accepting an invitation (the agreed invite-back rule).
    await V.locator("details summary").filter({ hasText: "Asha" }).first().click();
    await V.getByText("They rejoin when they accept your invitation.").first().waitFor();
    await clickAndWait(V, V.getByRole("button", { name: "Invite Asha back" }));
    await go(V, `${g2}/people`);
    assert((await V.locator("[data-removed-section]").count()) === 1, "Asha came back without accepting the invitation");
    // Asha accepts on her Home: now she's back in the group.
    await go(A, "/");
    await A.locator("[data-invitation]").filter({ hasText: "UAT Flat" }).getByRole("button", { name: "Join", exact: true }).click();
    await A.waitForURL(/\/groups\//);
    await go(V, `${g2}/people`);
    assert((await V.locator("[data-removed-section]").count()) === 0, "Asha still shows as removed after accepting");
  });
  await step(V, "People", "Remove someone who isn't in any expense (Sheldon)", async () => {
    await go(V, `${g3}/people`);
    await V.locator("details summary").filter({ hasText: "Sheldon" }).first().click();
    await clickAndWait(V, V.getByRole("button", { name: "Remove Sheldon" })); // the confirm is accepted by the dialog handler
    await go(V, `${g3}/people`);
    assert((await V.getByText("Sheldon").count()) === 0, "Sheldon still listed");
  });
  await step(V, "People", "Someone owing money can't be marked as left until settled: the button is off, and a forged leave is refused with their \"left\" mark still empty", async () => {
    // Its own small group, so the debt is always there (the main group is square by now): Varun pays ₹300 for both, so Kiran owes 15000 paise.
    const og = await seedGroup("UAT Owing", ["Kiran"]);
    const o = { me: "Varun", name: "Dinner out", amount: "300" };
    await go(V, `${og.path}/add`);
    await fillExpense(V, o);
    await save(V, o);
    await checkLedger(V, og.path, ["Varun", "Kiran"], [{ payer: "Varun", amount: 30000, shares: evenly(30000, ["Varun", "Kiran"]) }]);
    await go(V, `${og.path}/people`);
    await V.locator("details summary").filter({ hasText: "Kiran" }).first().click();
    assert(await V.locator("details[open]").getByRole("button", { name: "Remove Kiran" }).isDisabled(), "the remove button isn't disabled while Kiran owes");
    assert((await V.locator("details[open]").getByText("To remove Kiran, settle up first.").count()) === 1, "the line saying what to do first is missing");
    // The server's own rule, not just the greyed button: the same call the form makes.
    const { setMemberLeft } = await import("../src/lib/people");
    const members = await db.member.findMany({ where: { groupId: og.id } });
    const varunId = members.find((m) => m.name === "Varun")!.id;
    const kiranId = members.find((m) => m.name === "Kiran")!.id;
    const refused = await setMemberLeft(og.id, varunId, kiranId, true);
    assert(!refused.ok && /still owes .*Settle up first/.test(refused.error), `the forged leave was not refused the right way: ${JSON.stringify(refused)}`);
    const row = await db.member.findUniqueOrThrow({ where: { id: kiranId } });
    assert(row.leftAt === null && row.removedAt === null, "Kiran's left mark changed although the leave was refused");
    return "greyed, and refused with leftAt still empty";
  });
  await step(V, "Edit", "Change who paid on an expense: balances move by exactly that amount", async () => {
    const before = await shownBalances(V, g);
    await go(V, `${g}?tab=activity&q=Water`);
    await V.locator('li[id^="item-"] details > summary').filter({ hasText: "Water" }).first().click();
    const href = await V.getByRole("link", { name: "Edit or delete" }).first().getAttribute("href");
    await go(V, href!);
    await openSplit(V);
    await V.getByRole("button", { name: /^(✓ )?Asha$/ }).first().click();
    await V.getByRole("button", { name: "Save changes" }).click();
    await V.waitForURL(/tab=activity/);
    const after = await shownBalances(V, g);
    const dv = (after.Varun ?? 0) - (before.Varun ?? 0), da = (after.Asha ?? 0) - (before.Asha ?? 0);
    assert(dv === -24000 && da === 24000, `Varun moved ${dv}, Asha moved ${da} (expected −24000 / +24000)`);
  });
  await step(V, "Payments", "Delete a payment from the history, then restore it", async () => {
    // Only the payer or the person paid is offered "Delete payment", so pick a row Varun is part of: "Ravi paid you" or "You paid Ravi"
    // (a row between two other people, "Ravi paid Asha", has no delete button for him).
    const PAYMENT_OF_MINE = /\bpaid you\b|\bYou paid [A-Za-z]/;
    const before = await shownBalances(V, g);
    await go(V, `${g}?tab=activity`);
    // Pick one live payment of mine and remember WHICH one (its row id). Looking for "the first payment of mine" again after the delete
    // could land on a different row (several payments of Varun's are in this group by now), and that row has nothing to restore.
    const mine = V.locator('li[id^="item-"]').filter({ has: V.locator("details summary").filter({ hasText: PAYMENT_OF_MINE }) }).filter({ hasNotText: "Deleted by" });
    const li = mine.first();
    const rowId = await li.getAttribute("id");
    assert(rowId, "no live payment of Varun's in the history");
    await li.locator("summary").click();
    await clickAndWait(V, li.getByRole("button", { name: "Delete payment" }));
    const mid = await shownBalances(V, g);
    assert(JSON.stringify(mid) !== JSON.stringify(before), "balances didn't change after deleting the payment");
    await go(V, `${g}?tab=activity`);
    const same = V.locator(`li[id="${rowId}"]`);
    assert(/Deleted by/.test(await same.innerText()), "the payment I deleted isn't shown as deleted in the history");
    await same.locator("summary").click();
    await clickAndWait(V, same.getByRole("button", { name: "Restore payment" }));
    const after = await shownBalances(V, g);
    assert(JSON.stringify(after) === JSON.stringify(before), `restore didn't put balances back: ${JSON.stringify(after)} vs ${JSON.stringify(before)}`);
  });
  await step(V, "Browse", "Filter a group's history by category and person", async () => {
    await go(V, `${g}?tab=activity&cat=food`);
    const t = await V.locator("main").innerText();
    assert(/Dinner/.test(t) && !/\bTaxi\b/.test(t), "category filter wrong");
  });
  await step(V, "Browse", "Search by month: the recap shows totals", async () => {
    await go(V, "/search");
    const chip = V.locator("main a").filter({ hasText: /^[A-Z][a-z]{2} 20\d\d$/ }).first();
    await chip.click();
    await V.waitForURL(/m=/);
    await V.getByText("spent").first().waitFor();
  });
  await step(V, "Browse", "Charts tab opens with the group's spending", async () => {
    await go(V, `${g}?tab=charts`);
    assert((await V.locator("main svg, main [role=img]").count()) > 0 || /Food|food/.test(await V.locator("main").innerText()), "no chart content");
  });
  await step(V, "Alerts", "Alerts screen offers phone notifications on/off", async () => {
    await go(V, "/notifications?tab=all");
    await V.getByText("This device", { exact: true }).first().waitFor();
    await V.getByText("What Loopin sends").first().waitFor();
    await V.getByRole("link", { name: /Notifications & email/ }).waitFor();
  });
  await step(R, "Alerts", "Notifications & email: opens from You, an email switch persists after a reload, and with it off an add-to-group email isn't sent; switched back on it is", async () => {
    await go(R, "/account");
    await R.getByRole("link", { name: /Notifications & email/ }).click();
    await R.waitForURL(/\/account\/notifications$/);
    await R.getByRole("heading", { name: "Notifications & email" }).waitFor();
    await R.getByText("This device", { exact: true }).first().waitFor();
    await R.getByText("Sign-in codes and security emails are always sent.").waitFor();
    // Every switch is a tap target of at least 44px.
    for (const sw of await R.locator("[data-switch]").all()) assert(((await sw.boundingBox())?.height ?? 0) >= 43.5, "a notification switch is shorter than 44px");
    const mailSwitch = R.locator('[data-switch="email:groups.added"]');
    assert((await mailSwitch.getAttribute("aria-checked")) === "true", "the add-to-group email starts switched off");
    await mailSwitch.click();
    await R.getByText("Saved", { exact: true }).first().waitFor();
    await R.reload();
    assert((await R.locator('[data-switch="email:groups.added"]').getAttribute("aria-checked")) === "false", "the email switch didn't persist after a reload");
    // A category off greys its items (phone side), and back on again.
    await R.locator('[data-switch="push:payments"]').click();
    await R.getByText("Saved", { exact: true }).first().waitFor();
    assert(await R.locator('[data-switch="push:payments.claimed"]').isDisabled(), "a payments item stayed switchable with Payments off");
    await R.locator('[data-switch="push:payments"]').click();
    await R.getByText("Saved", { exact: true }).first().waitFor();
    // Invite Ravi by email into the dinner club: nothing arrives while it is off.
    const gid3 = g3.split("/").pop()!;
    const invite3 = async () => {
      await go(V, `${g3}/invite`);
      await openWay(V, "email");
      await V.getByLabel("Email addresses to invite").fill(email("ravi"));
      await V.getByRole("button", { name: "Invite", exact: true }).click();
      await V.waitForURL(/invited=|error=/);
    };
    const tidy = async () => {
      await db.invite.deleteMany({ where: { groupId: gid3, email: email("ravi") } });
      await db.member.deleteMany({ where: { groupId: gid3, accountId: null, name: { startsWith: nameFromEmail(email("ravi")) } } });
    };
    await invite3();
    await new Promise((r) => setTimeout(r, 2500));
    assert((await db.outbox.count({ where: { to: email("ravi"), subject: { contains: "added to a group" }, text: { contains: "UAT Dinner club" } } })) === 0, "an add-to-group email was sent with the switch off");
    await tidy();
    await go(R, "/account/notifications");
    await R.locator('[data-switch="email:groups.added"]').click();
    await R.getByText("Saved", { exact: true }).first().waitFor();
    await R.reload();
    assert((await R.locator('[data-switch="email:groups.added"]').getAttribute("aria-checked")) === "true", "the email switch didn't come back on");
    await invite3();
    assert(await mailTo(email("ravi"), { subject: { contains: "added to a group" }, text: { contains: "UAT Dinner club" } }), "no add-to-group email with the switch back on");
    await tidy();
  });
  await step(V, "Add people", "Adding the email of someone already on Loopin gets the same reply as any email; they see an invitation on Home and in Alerts", async () => {
    await go(V, `${g2}/invite`);
    await openWay(V, "email");
    await V.getByLabel("Email addresses to invite").fill(email("ravi"));
    await V.getByRole("button", { name: "Invite", exact: true }).click();
    await V.waitForURL(/invited=/);
    await V.locator("[data-invited-title]").waitFor();
    await V.getByText(/We’re emailing an invitation to/).waitFor();
    await go(R, "/");
    await R.locator("[data-invitation]").filter({ hasText: "UAT Flat" }).getByRole("button", { name: "Not now", exact: true }).waitFor();
    await go(R, "/notifications");
    await R.locator("[data-invitation]").filter({ hasText: "UAT Flat" }).waitFor();
  });
  await step(null, "Privacy", "A stranger opening a group's address sees “Private group”: no name, no join link", async () => {
    const x = await person(browser);
    for (const sub of ["", "/settle", "/add", "/settings", "/invite", "/people"]) {
      await go(x.page, g + sub);
      await x.page.waitForURL(/\/private/);
    }
    const body = await x.page.locator("main").innerText();
    assert(!body.includes("UAT Goa trip") && !body.includes(invite.split("/").pop()!), "private page leaks the group's name or invite code");
    const r = await x.page.request.get(`${base}${g}/export`, { headers: bypass });
    assert(r.status() === 403, `export gave ${r.status()} to a stranger`);
    await x.ctx.close();
  });
  await step(null, "Privacy", "A forged “who you are” cookie is ignored", async () => {
    const x = await person(browser);
    const memberId = (await db.member.findFirst({ where: { groupId: g.split("/").pop()!, name: "Varun" } }))!.id;
    await x.ctx.addCookies([{ name: "sw_me", value: `${Buffer.from(JSON.stringify({ m: { [g.split("/").pop()!]: memberId } })).toString("base64url")}.fakesignature`, url: base }]);
    await go(x.page, g);
    await x.page.waitForURL(/\/private/);
    await x.ctx.close();
  });
  await step(null, "Privacy", "An unsigned, plain “who you are” cookie (the old format) is ignored too", async () => {
    const x = await person(browser);
    const gid = g.split("/").pop()!;
    const memberId = (await db.member.findFirst({ where: { groupId: gid, name: "Varun" } }))!.id;
    await x.ctx.addCookies([{ name: "sw_me", value: encodeURIComponent(JSON.stringify({ m: { [gid]: memberId } })), url: base }]);
    await go(x.page, g);
    await x.page.waitForURL(/\/private/);
    await go(x.page, "/");
    assert(!(await x.page.locator("main").innerText()).includes("UAT Goa trip"), "home page showed Varun's group");
    await x.ctx.close();
  });
  await step(null, "Privacy", "Sign-in can't send you to another website afterwards (back=/\\evil.com)", async () => {
    const x = await person(browser);
    await go(x.page, `/signin?back=${encodeURIComponent("/\\evil.com")}`);
    const back = await x.page.locator('input[name="back"]').first().inputValue().catch(() => "/");
    assert(back === "/", `back became ${back}`);
    await x.ctx.close();
  });
  await step(A, "Account", "Sign out of this device, sign back in: all groups come back", async () => {
    await go(A, "/account");
    await A.getByRole("link", { name: /Sign-in & devices/ }).click();
    await A.waitForURL(/\/account\/sign-in/);
    await A.getByRole("button", { name: "Sign out", exact: true }).click();
    await A.waitForURL(base + "/");
    await go(A, "/signin");
    await signup(A, "Asha", email("asha"));
    await go(A, "/");
    // Home shows its groups as polaroids in a row; past ten there is a “See all” card that opens the full list.
    if (await A.locator("[data-group-card-end='all']").count()) await go(A, "/groups");
    for (const name of ["UAT Goa trip", "UAT Flat"]) await A.getByText(name).first().waitFor();
  });
  await step(null, "Account", "Delete my email & sign-in", async () => {
    const x = await person(browser);
    await go(x.page, "/signin?mode=signup");
    await signup(x.page, "Throwaway", email("throwaway"));
    await go(x.page, "/account");
    await x.page.getByRole("link", { name: /Export your data/ }).click();
    await x.page.waitForURL(/\/account\/data/);
    await x.page.getByRole("button", { name: /Delete my email/ }).click();
    await x.page.waitForURL(/deleted=account/);
    assert((await db.account.count({ where: { email: email("throwaway") } })) === 0, "account still exists");
    await x.ctx.close();
  });

  // ===== 9. Getting the app, help, category tags =====
  const phone = async (ua: string) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ua, locale: "en-IN" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15_000);
    return { ctx, page };
  };
  await step(null, "Get the app", "iPhone (Safari): invite link shows “Get the Loopin app” with Share → Add to Home Screen steps", async () => {
    const { ctx, page } = await phone("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
    await go(page, invite);
    await page.getByText("Get the Loopin app").waitFor();
    await page.getByRole("button", { name: "Get it" }).click();
    await page.getByText("Add to Home Screen").first().waitFor();
    await ctx.close();
  });
  await step(null, "Get the app", "iPhone (Chrome): steps use the Share button by the address bar", async () => {
    const { ctx, page } = await phone("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1");
    await go(page, invite);
    await page.getByRole("button", { name: "Get it" }).click();
    await page.getByText(/next to the address bar/).waitFor();
    await ctx.close();
  });
  await step(null, "Get the app", "Android (Chrome): invite link offers the app; steps mention “Install app”", async () => {
    const { ctx, page } = await phone("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36");
    await go(page, invite);
    await page.getByText("Get the Loopin app").waitFor();
    await page.getByRole("button", { name: /Get it|Install/ }).click();
    await page.getByText(/Install app/).first().waitFor();
    await ctx.close();
  });
  await step(null, "Sign in", "UX-04: the sign-in header is short (about 96px) on a short phone (390×667) and tall on a normal one (390×844), so the small-phone variant works for both width and height", async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 667 }, locale: "en-IN" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15_000);
    try {
      await go(page, "/signin");
      const header = page.locator("[data-signin-header]");
      await header.waitFor();
      const short = (await header.boundingBox())!.height;
      assert(short >= 80 && short <= 130, `the sign-in header is ${Math.round(short)}px tall at 390×667 (should be about 96)`);
      await page.setViewportSize({ width: 390, height: 844 });
      const tall = (await header.boundingBox())!.height;
      assert(tall >= 300, `the sign-in header is ${Math.round(tall)}px tall at 390×844 (should be tall, about 420)`);
      await page.setViewportSize({ width: 320, height: 900 });
      const narrow = (await header.boundingBox())!.height;
      assert(narrow <= 130, `the sign-in header is ${Math.round(narrow)}px tall at 320×900 (a narrow phone should get the short one)`);
    } finally {
      await ctx.close();
    }
  });
  await step(V, "Get the app", "You has the “Get the Loopin app” row (it moved off Home's header) and the service worker is registered (needed to install)", async () => {
    await go(V, "/account");
    await V.getByRole("button", { name: /^(Get it|Install)$/ }).waitFor();
    assert((await V.getByRole("button", { name: "Get the app" }).count()) === 0, "Home's header App button is still there");
    const ok = await V.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration("/")));
    assert(ok, "no service worker registered");
  });
  await step(null, "Get the app", "First-time tour (iPhone) has no “App” button (the tour keeps only Skip); “Get it” on the guide shows how to add it to the Home Screen", async () => {
    const { ctx, page } = await phone("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
    await go(page, "/");
    await page.locator("[data-tour-next]").first().waitFor();
    assert((await page.getByRole("button", { name: "Get the app" }).count()) === 0, "the tour still has an App button in its header");
    // The app card now lives on You and on the guide; on an iPhone it shows the Add to Home Screen steps.
    await go(page, "/how-it-works");
    await page.getByRole("button", { name: /^(Get it|Install)$/ }).click();
    await page.getByText("Add to Home Screen").first().waitFor();
    await ctx.close();
  });
  await step(V, "Navigation", "Inside a group there's a back button to all groups", async () => {
    await go(V, g);
    await V.getByRole("link", { name: "Back to all groups" }).click();
    await V.waitForURL(base + "/");
  });
  await step(null, "Start screen", "Tour → Home shows a start screen: create, join with a link, quick start, sign up / sign in", async () => {
    const { ctx, page } = await phone("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36");
    await go(page, "/");
    // Skip is the way out of the tour (it also remembers the tour was seen); Home then shows the start screen.
    await page.locator("[data-tour-skip]").click();
    await page.waitForURL(/\/groups\/new/);
    await go(page, "/");
    await page.getByRole("heading", { name: "Good times. Shared fairly." }).waitFor();
    await page.getByRole("link", { name: /Already here\? Sign in/ }).first().waitFor();
    // Join with a pasted link
    // (Tapped again if the first tap landed before the page came alive, as a person would.)
    for (let i = 0; i < 4 && !(await page.getByLabel("Invite link").count()); i++) {
      await page.getByRole("button", { name: "Join with a link" }).click();
      await page.getByLabel("Invite link").waitFor({ timeout: 2_000 }).catch(() => undefined);
    }
    await page.getByLabel("Invite link").fill(`https://getloopin.vercel.app${invite}`);
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await page.waitForURL(new RegExp(invite));
    // Quick start fills the group name
    await go(page, "/");
    await page.getByRole("link", { name: /Trip/ }).click();
    await page.waitForURL(/\/groups\/new/); // (Home has its own "Sign in or sign up" link)
    await page.getByRole("link", { name: "Sign in or sign up" }).waitFor(); // not signed in yet: sign up first
    const href = (await page.getByRole("link", { name: "Sign in or sign up" }).getAttribute("href")) ?? "";
    assert(decodeURIComponent(decodeURIComponent(href)).includes("name=Goa trip"), `the trip name isn't kept for after sign-up: ${href}`);
    // One screen for signing up and signing in
    await go(page, "/signin?mode=signup");
    await page.getByRole("heading", { name: "Create your account" }).waitFor();
    await ctx.close();
  });
  await step(V, "Help", "The “How Loopin works” row on You opens the detailed guide (with photos), which links to the 1-minute tour; Home's header has no “?”", async () => {
    await go(V, "/");
    assert((await V.locator('header a[href="/how-it-works"]').count()) === 0, "Home's header still has the ? help button");
    await go(V, "/account");
    await V.getByRole("link", { name: "How Loopin works" }).click();
    await V.waitForURL(/\/how-it-works/);
    await V.getByRole("heading", { name: "Add an expense in seconds" }).waitFor();
    const basics = (await V.locator("[data-basics]").innerText()).replace(/\s+/g, " ");
    assert(/1 Create a group/.test(basics) && /2 Add an expense/.test(basics) && /3 Record a payment/.test(basics), `the guide starts with: ${basics.slice(0, 160)}`);
    await V.waitForTimeout(2500);
    const imgs = await V.locator("main img").count();
    const sizes = await V.evaluate(() =>
      [...document.querySelectorAll("main img")].map((i) => `${(i as HTMLImageElement).src.split("/").pop()}:${(i as HTMLImageElement).naturalWidth}`).join(" "),
    );
    await V.getByRole("link", { name: /1-minute tour/ }).click();
    await V.waitForURL(/\/welcome/);
    return `${imgs} photos on the guide (${sizes})`;
  });
  await step(null, "Help", "The 1-minute tour has 7 slides (make a group, add what you paid, see who owes then settle, every trip becomes a story, send a postcard, keep the little moments, collect your passport), in words that work outside India, and none says “no sign-up”", async () => {
    const { ctx, page } = await person(browser);
    await go(page, "/welcome");
    const seen: string[] = [];
    for (let i = 0; i < 7; i++) {
      seen.push((await page.locator("main").innerText()).replace(/\s+/g, " "));
      const next = page.getByRole("button", { name: /Next/ });
      if (i < 6) {
        await next.click();
        await page.waitForTimeout(500);
      }
    }
    assert((await page.locator("[data-tour-slide]").count()) === 7, `${await page.locator("[data-tour-slide]").count()} slides, not 7 (the tour is 7 slides)`);
    const all = seen.join(" ");
    for (const t of ["Make a group.", "Add what you paid.", "See who owes. Then settle.", "Every trip becomes a story.", "Send a postcard.", "Keep the little moments.", "Collect your passport."]) assert(all.includes(t), `no “${t}” slide`);
    assert(/to the last (paisa|cent)\b/.test(all) && !/paisa or cent/.test(all), "the add slide doesn’t say “to the last paisa” (India) or “to the last cent”");
    assert(/Pay each other however you like/.test(all), "the settle slide doesn’t say “Pay each other however you like”");
    assert(!/no sign-up/i.test(all), "a slide still says “no sign-up”");
    assert(!/UPI|Teen Patti|Poker|Diwali/i.test(all), "a slide has India-only or card-room words");
    assert(!/splitwise/i.test(all), "a slide names another app");
    // The group kinds use the app's own names (as New group), and the last slide has no "Get the Loopin app" card pushing the sign-up line off.
    for (const t of ["Trip", "Home", "Couple", "Game night"]) assert(all.includes(t), `the tour's group kinds miss “${t}”`);
    assert(!/Flat\b|Card night|The Pot/.test(all.replace(/Flat expenses/g, "")), "the tour still says Flat / Card night / The Pot");
    assert(!/Get the Loopin app/.test(all), "the tour has a “Get the Loopin app” card");
    assert((await page.locator("[data-story-lines] li").allTextContents()).length === 3, "the story poster doesn't show its three Wrapped lines");
    // We are on the last step now: "Create your first group" is the main button and "See it again" is small; "Next" is gone.
    assert(await page.getByRole("link", { name: "Create your first group" }).isVisible(), "no “Create your first group” on the last step");
    assert((await page.locator("[data-tour-next]").count()) === 0, "“Next” still shows on the last step");
    assert(await page.locator("[data-tour-again]").isVisible(), "no “See it again” on the last step");
    assert(await page.getByRole("link", { name: "Skip" }).first().isVisible(), "no Skip");
    // Back at the first step: "Next" is the main button, and “Create your first group” isn't offered yet.
    await page.locator("[data-tour-again]").click();
    await page.waitForTimeout(700);
    assert(await page.locator("[data-tour-next]").first().isVisible(), "no “Next” main button");
    assert(!(await page.getByRole("link", { name: "Create your first group" }).isVisible()), "“Create your first group” shows before the last step");
    await ctx.close();
  });
  await step(null, "Help", "The tour moves like stories: tap the right side for next, the left side to go back, and Back / Next buttons at the bottom", async () => {
    const { ctx, page } = await person(browser);
    await go(page, "/welcome");
    const at = async () => (await page.locator("[data-tour-at]").innerText()).trim();
    assert((await at()).startsWith("1 /"), `starts at ${await at()}`);
    assert(await page.locator("[data-tour-back]").isDisabled(), "Back works on the first slide");
    const box = (await page.locator("[data-tour-slide='group']").boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.5);
    await page.waitForTimeout(700);
    assert((await at()).startsWith("2 /"), `tap right → ${await at()}`);
    const box2 = (await page.locator("[data-tour-slide='add']").boundingBox())!;
    await page.mouse.click(box2.x + box2.width * 0.85, box2.y + box2.height * 0.5);
    await page.waitForTimeout(700);
    assert((await at()).startsWith("3 /"), `tap right again → ${await at()}`);
    const box3 = (await page.locator("[data-tour-slide='settle']").boundingBox())!;
    await page.mouse.click(box3.x + box3.width * 0.12, box3.y + box3.height * 0.5);
    await page.waitForTimeout(700);
    assert((await at()).startsWith("2 /"), `tap left → ${await at()}`);
    await page.locator("[data-tour-back]").click();
    await page.waitForTimeout(700);
    assert((await at()).startsWith("1 /"), `Back → ${await at()}`);
    await ctx.close();
  });
  await step(V, "Help", "The guide has Home, Couples, the trip report, stories, Wrapped, the passport and moving over from another app, with real app screens that load", async () => {
    await go(V, "/how-it-works");
    for (const h of ["Home: the flat runs itself", "Couples: your split, not 50/50", "Trip over? The trip in numbers", "Home, told as stories", "Trip over? Watch the Wrapped", "Your trip passport", "Postcards, sealed and stamped", "Coming from another app?"]) await V.getByRole("heading", { name: h }).waitFor();
    assert(!(await V.getByText("Recurring bills are coming soon").count()), "still says recurring bills are coming soon");
    for (const id of ["trips", "home", "couples"]) {
      await V.locator(`#${id}`).scrollIntoViewIfNeeded();
      await V.waitForTimeout(400);
    }
    await V.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await V.waitForTimeout(1500);
    // The pictures load lazily (Safari's engine only starts them near the screen): bring each into view, wait for it to finish, then measure.
    const imgs = V.locator('main img[src*="/guide/"]');
    const count = await imgs.count();
    for (let i = 0; i < count; i++) {
      const img = imgs.nth(i);
      await img.scrollIntoViewIfNeeded();
      await img.evaluate((el) => (el as HTMLImageElement).decode().catch(() => undefined));
      await V.waitForFunction((n) => (document.querySelectorAll('main img[src*="/guide/"]')[n] as HTMLImageElement | undefined)?.complete === true, i, { timeout: 10_000 }).catch(() => undefined);
    }
    const shots = await V.evaluate(() => [...document.querySelectorAll('main img[src*="/guide/"]')].map((i) => (i as HTMLImageElement).naturalWidth));
    assert(shots.length >= 11 && shots.every((w) => w > 0), `guide screens: ${JSON.stringify(shots)}`);
  });
  await step(V, "Tags", "Each expense shows its category: the icon's colour and shape, and the name for screen readers (Dinner → Bites & Sips, Taxi → Wheels & Wings)", async () => {
    await go(V, `${g}?tab=activity`);
    for (const [title, cat, label] of [["Dinner", "food", "Bites & Sips"], ["Taxi", "transport", "Wheels & Wings"]] as const) {
      const row = V.locator("details summary").filter({ hasText: title }).first();
      assert((await row.locator("[data-category]").first().getAttribute("data-category")) === cat, `${title}: icon isn't ${cat}`);
      assert(new RegExp(label).test((await row.locator("[data-category]").first().getAttribute("aria-label")) ?? ""), `${title}: no “${label}” for screen readers`);
    }
  });

  // ===== 9. Home & Couple: bills, list, budgets, reminders, moving out, goals =====
  let gh = "";
  const homeId = () => gh.split("/").pop()!;
  await step(V, "Flat", "Create a Home group: it opens on Overview, with Expenses · People tabs and Bills · Shopping tiles", async () => {
    await go(V, "/groups/new");
    await V.getByRole("button", { name: /^Home/ }).click();
    await V.locator('input[name="groupName"]').fill("UAT Flat 402");
    await V.locator('select[name="currency"]').selectOption("INR");
    await V.getByRole("button", { name: /Create group/ }).click();
    await V.waitForURL(/\/invite\?new=1/);
    gh = new URL(V.url()).pathname.replace(/\/invite$/, "");
    await openWay(V, "search");
    await V.getByLabel("Search people on Loopin").fill("Asha");
    await V.getByRole("button", { name: "Add", exact: true }).first().click();
    await V.waitForURL(/invited=/);
    await tapJoin(A, "UAT Flat 402", gh);
    await go(V, gh);
    const current = await V.locator('a[aria-current="page"]').filter({ hasText: /Overview|Expenses|People/ }).first().innerText();
    assert(current.trim() === "Overview", `opened on “${current}”`);
    for (const t of ["Expenses", "People"]) assert(await V.getByRole("link", { name: t, exact: true }).count(), `no ${t} tab`);
    for (const t of ["Bills", "Shopping"]) assert(await V.getByRole("link", { name: new RegExp(`^${t}`) }).count(), `no ${t} tile`);
    // Every tab's label fits on its tab (nothing cut off or spilling over).
    const spill = await V.evaluate(() =>
      [...document.querySelectorAll('nav[aria-label="Group sections"] a')].filter((a) => a.scrollWidth > a.clientWidth + 1).map((a) => a.textContent),
    );
    assert(spill.length === 0, `labels that don't fit: ${spill.join(", ")}`);
  });
  await step(V, "Flat", "Add Rent (₹30,000 on the 1st, you pay) and Electricity (changes each month, Asha pays)", async () => {
    await go(V, `${gh}/bills/new`);
    await V.getByLabel("Amount", { exact: true }).fill("30000");
    await V.getByRole("button", { name: "Add bill" }).click();
    await V.waitForURL(/tab=bills&saved=bill/);
    await go(V, `${gh}/bills/new`);
    await V.getByRole("button", { name: "Electricity" }).click();
    await V.getByRole("button", { name: "Asha", exact: true }).click();
    await V.getByRole("button", { name: "Add bill" }).click();
    await V.waitForURL(/tab=bills&saved=bill/);
    const t = (await V.locator("main").innerText()).replace(/\s+/g, " ");
    assert(/added automatically on their day/.test(t) && /Rent/.test(t) && /Electricity/.test(t), `Bills tab says: ${t.slice(0, 200)}`);
    // Both start next month when their day has passed; for the test, make them due already.
    const thisMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
    await db.bill.updateMany({ where: { groupId: homeId() }, data: { startMonth: thisMonth, day: 1 } });
  });
  await step(V, "Flat", "The daily job runs twice: Rent is added once, Electricity waits for its amount", async () => {
    if (noCronKey) {
      // No key for the test copy's daily job: run the same job directly instead.
      const { runBillsForGroup } = await import("../src/lib/home/bills-db");
      await runBillsForGroup(homeId());
      await runBillsForGroup(homeId());
    } else for (let i = 0; i < 2; i++) {
      const r = await fetch(`${base}/api/cron/daily`, { headers: cronAuth() });
      assert(r.ok, `daily job answered ${r.status}`);
    }
    const rents = await db.expense.count({ where: { groupId: homeId(), description: "Rent", deletedAt: null } });
    assert(rents === 1, `Rent was added ${rents} times`);
    const elec = await db.expense.count({ where: { groupId: homeId(), description: "Electricity", deletedAt: null } });
    assert(elec === 0, "Electricity was added without an amount");
    await go(A, `${gh}?tab=bills`);
    assert(await A.getByRole("link", { name: "Enter amount" }).count(), "Asha sees no “Enter amount”");
    // Each bill says where it stands: Rent "Added this month" (green); Electricity is marked needs-amount, but shows only its "Enter amount" button (no second pill).
    assert((await A.locator('[data-bill-state="needs-amount"]').count()) === 1, "Electricity is not marked as needing an amount");
    assert((await A.getByText("Needs amount", { exact: true }).count()) === 0, "a “Needs amount” pill shows next to “Enter amount”");
    await go(V, `${gh}?tab=bills`);
    assert((await V.locator('[data-bill-state="recorded"]').filter({ hasText: "Added this month" }).count()) === 1, "Rent has no “Added this month” chip");
    assert((await V.locator('[data-bill-state="needs-amount"]').count()) === 1, "Electricity is not marked as needing an amount");
  });
  await step(A, "Flat", "Asha taps “Enter amount”, types ₹2,840 and saves: Asha owes ₹13,580 in all", async () => {
    await go(A, `${gh}?tab=bills`);
    await A.getByRole("link", { name: "Enter amount" }).click();
    await A.waitForURL(/bill=/);
    await A.getByLabel("Amount", { exact: true }).fill("2840");
    await save(A, { me: "Asha", name: "Electricity", amount: "2840" });
    const b = await shownBalances(V, gh);
    assert(b.Varun === 1358000 && b.Asha === -1358000, `balances ${JSON.stringify(b)}`);
    await go(V, `${gh}?tab=bills`);
    assert((await V.getByRole("link", { name: "Enter amount" }).count()) === 0, "Electricity still waiting");
    assert((await V.locator('[data-bill-state="needs-amount"]').count()) === 0, "Electricity still says “Needs amount”");
    assert((await V.locator('[data-bill-state="recorded"]').count()) === 2, "Rent and Electricity should both say “Added this month”");
  });
  await step(V, "Flat", "Shopping list: add Bread and Milk, tick both, enter ₹1,240 → one Groceries expense", async () => {
    await go(V, `${gh}?tab=list`);
    for (const item of ["Bread", "Milk"]) {
      await V.getByLabel("Add an item").fill(item);
      await V.getByRole("button", { name: "Add", exact: true }).click();
      await V.locator("button[aria-pressed]").filter({ hasText: item }).waitFor();
    }
    for (const [i, item] of ["Bread", "Milk"].entries()) {
      await V.locator('button[aria-pressed="false"]').filter({ hasText: item }).click();
      await V.getByText(`You bought ${i + 1} thing`).waitFor();
    }
    await V.getByLabel("What it cost").fill("1240");
    await V.getByRole("button", { name: "Add expense" }).click();
    await V.waitForURL(/bought=1/);
    const g = await db.expense.findMany({ where: { groupId: homeId(), category: "groceries", deletedAt: null } });
    assert(g.length === 1 && g[0].amount === 124000, `groceries: ${JSON.stringify(g.map((e) => e.amount))}`);
    assert(/Bread/.test(g[0].notes ?? "") && /Milk/.test(g[0].notes ?? ""), `note: ${g[0].notes}`);
  });
  await step(V, "Flat", "A ₹1,500 Groceries budget with ₹1,240 spent shows “₹260 left” (nearly there)", async () => {
    await go(V, `${gh}/budgets`);
    await V.getByLabel("Pantry Run budget").fill("1500");
    await V.getByRole("button", { name: "Save budgets" }).click();
    await V.waitForURL(new RegExp(`${gh}$`));
    const t = (await V.locator("main").innerText()).replace(/\s+/g, " ");
    assert(/Budgets/.test(t) && /₹260(\.00)? left for the month/.test(t), `This month says: ${t.slice(0, 300)}`);
  });
  await step(V, "Flat", "Reminders switch: on the flat's settings (off to start), not on the couple's", async () => {
    await go(V, `${gh}/settings`);
    const box = V.locator('input[name="reminders"]');
    assert((await box.count()) === 1, "no Reminders switch for the flat");
    assert(!(await box.isChecked()), "Reminders are on by default");
    await go(V, `${gc}/settings`);
    assert((await V.locator('input[name="reminders"]').count()) === 0, "the couple has a Reminders switch");
  });
  await step(V, "Couples", "The couple's This month says if you're ahead, behind or even", async () => {
    await go(V, gc);
    const t = (await V.locator("main").innerText()).replace(/\s+/g, " ");
    assert(/Overall you’re ₹[\d,.]+ (ahead|behind)|You’re even/.test(t), `This month says: ${t.slice(0, 200)}`);
  });
  await step(V, "Couples", "Start a savings goal (₹1,00,000) and tap “I set money aside” (₹5,000)", async () => {
    await go(V, `${gc}/goals/new`);
    await V.locator('input[name="name"]').fill("UAT Bali");
    await V.locator('input[name="target"]').fill("100000");
    await V.getByRole("button", { name: "Start goal" }).click();
    await V.waitForURL(/\/goals\/(?!new)[^/?]+$/);
    await V.getByLabel("Amount set aside").fill("5000");
    await V.getByRole("button", { name: "I set money aside" }).click();
    await V.waitForURL(/added=1/);
    await V.getByText(/₹95,000(\.00)? to go/).waitFor();
    assert(await V.getByText("You’ve set aside").count(), "no “You’ve set aside” card");
  });
  // Done while Asha is still in the flat: once she has moved out, deleting a charge she shares is refused on purpose (a leaver keeps the balance she left with).
  await step(V, "Flat", "Delete the automatic Rent from its edit screen: the daily job doesn't add it back", async () => {
    const rent = await db.expense.findFirst({ where: { groupId: homeId(), description: "Rent", deletedAt: null } });
    assert(rent, "no Rent expense");
    await go(V, `${gh}/expenses/${rent.id}/edit`);
    await V.getByRole("button", { name: "Delete expense" }).click();
    await V.waitForURL(/tab=activity/);
    assert(!/[?&]error=/.test(V.url()), `the delete was refused: ${decodeURIComponent(V.url().split("error=")[1] ?? "")}`);
    if (noCronKey) await (await import("../src/lib/home/bills-db")).runBillsForGroup(homeId());
    else await fetch(`${base}/api/cron/daily`, { headers: cronAuth() });
    const live = await db.expense.count({ where: { groupId: homeId(), description: "Rent", deletedAt: null } });
    assert(live === 0, `Rent came back (${live})`);
  });
  await step(V, "Flat", "Asha moves out: final payment shown, she's marked moved out, balances still add up to zero", async () => {
    await go(V, `${gh}/people`);
    await V.locator("details summary").filter({ hasText: "Asha" }).first().click();
    await V.getByRole("link", { name: "Asha is moving out" }).click();
    await V.waitForURL(/\/move/);
    const t = (await V.locator("main").innerText()).replace(/\s+/g, " ");
    assert(/Final payments/.test(t) && /Asha pays you|You pay Asha|all square/i.test(t), `move-out screen says: ${t.slice(0, 300)}`);
    // F12: a short title on one line, deductions in plain colour (no green, no minus sign).
    assert((await V.locator("header h1").first().innerText()).trim() === "Asha moves out", "the move-out title isn't “Asha moves out”");
    const h1 = (await V.locator("header h1").first().boundingBox())!;
    assert(h1.height < 44, `the move-out title wraps (${Math.round(h1.height)}px tall)`);
    for (const d of await V.locator("[data-deduction]").all()) {
      assert(!/[−-]/.test(await d.innerText()) && !/text-owed/.test((await d.getAttribute("class")) ?? ""), "a move-out deduction is green or has a minus sign");
    }
    await V.getByRole("button", { name: /mark as moved out/ }).click();
    await V.waitForURL(/tab=activity/);
    const { loadGroup } = await import("../src/lib/group-data");
    const data = (await loadGroup(homeId()))!;
    const asha = data.group.members.find((m) => m.name === "Asha")!;
    assert(asha.leftAt, "Asha isn't marked as moved out");
    // Someone who left keeps the history but not the invite link or settings.
    await go(A, `${gh}/invite`);
    await A.locator("[data-left-member]").waitFor();
    assert(!/\/join\//.test(await A.locator("main").innerText()), "a person who moved out still sees the invite link");
    await go(A, `${gh}/settings`);
    assert(/\/people/.test(A.url()), `settings stayed open for a person who moved out: ${A.url()}`);
    // And sees the group only up to the day they left: the banner, and no This month / Bills / List tabs.
    await go(A, gh);
    await A.locator("[data-left-banner]").waitFor();
    // Her own move-out (marked by someone else) is hers to undo: the banner says so and carries the Undo or the reason it can't be done.
    assert((await A.locator("[data-left-banner] [data-own-move-out]").count()) === 1, "the person who moved out has no Undo my move-out on her banner");
    for (const t of ["This month", "Bills", "List"]) assert((await A.getByRole("link", { name: t, exact: true }).count()) === 0, `a person who moved out sees the ${t} tab`);
    // On Settle up she gets no Close group / Mark all paid section (the server would refuse it).
    await go(A, `${gh}/settle`);
    assert((await A.locator("[data-settle-actions]").count()) === 0, "a person who moved out is offered Close group / Mark all paid");
    const sum = Object.values(data.net).reduce((a, b) => a + b, 0);
    // CHANGED 16 Nov (A5, OB-3): someone who has left always owes nothing. The square-up is recorded as a payment straight away (it also asks the person
    // paid, when they can answer, whether it arrived), so Asha is at exactly 0, and no "I've paid" note is made.
    const notes = await db.paymentClaim.findMany({ where: { groupId: homeId(), status: "waiting", source: "move_out" } });
    assert(notes.length === 0, `the move-out made ${notes.length} “I've paid” note(s)`);
    assert(sum === 0 && data.net[asha.id] === 0, `net ${JSON.stringify(data.net)}; Asha should be at exactly 0`);
  });

  // ===== 10. More checks: the daily job's key, joining when signed in, bills, deposit, speed =====
  await step(null, "Daily job", "Without the key the daily job is refused; with it, it runs", async () => {
    if (!process.env.CRON_SECRET) return notRun("no key set on this test server");
    const no = await fetch(`${base}/api/cron/daily`);
    assert(no.status === 401, `without the key it answered ${no.status}`);
    const wrong = await fetch(`${base}/api/cron/daily`, { headers: { authorization: "Bearer wrong" } });
    assert(wrong.status === 401, `with a wrong key it answered ${wrong.status}`);
    const yes = await fetch(`${base}/api/cron/daily`, { headers: cronAuth() });
    assert(yes.ok, `with the key it answered ${yes.status}`);
  });
  await step(Z, "Joining", "Zoe, already signed in, opens the flat's invite link, taps Join, and shows on People", async () => {
    await go(V, `${gh}/invite`);
    const m = /\/join\/([A-Za-z0-9_-]+)/.exec(await V.content());
    assert(m, "no join link on the flat's Add people screen");
    await go(Z, `/join/${m[1]}`);
    await Z.getByRole("button", { name: /^Join / }).click();
    await Z.waitForURL(new RegExp(`${gh}(\\?|$)`));
    await go(V, `${gh}/people`);
    assert(await V.locator("details summary").filter({ hasText: "Zoe" }).count(), "Zoe isn't listed on People");
    const zoe = await db.member.findFirst({ where: { groupId: homeId(), name: { startsWith: "Zoe" }, leftAt: null } });
    assert(zoe?.accountId, "Zoe's member row isn't linked to her account");
  });
  await step(V, "Flat", "Pause a bill and start it again from its page", async () => {
    const bill = await db.bill.findFirst({ where: { groupId: homeId(), name: "Electricity" } });
    assert(bill, "no Electricity bill");
    await go(V, `${gh}/bills/${bill.id}`);
    await V.getByRole("button", { name: "Pause", exact: true }).click();
    await V.getByRole("button", { name: "Start again" }).waitFor();
    assert((await db.bill.findUnique({ where: { id: bill.id } }))?.paused, "not paused");
    await V.getByRole("button", { name: "Start again" }).click();
    await V.getByRole("button", { name: "Pause", exact: true }).waitFor();
    assert(!(await db.bill.findUnique({ where: { id: bill.id } }))?.paused, "still paused");
  });
  await step(V, "Flat", "Deposit: you put in ₹40,000; lease over with ₹2,000 kept back → ₹38,000 back to you", async () => {
    await go(V, `${gh}/deposit`);
    const mine = V.locator('input[name^="d_"]').first();
    await mine.fill("40000");
    await V.getByRole("button", { name: "Save deposit" }).click();
    await V.waitForURL(/saved=1/);
    await V.getByLabel("Deductions").fill("2000");
    await V.getByRole("button", { name: "Mark deposit returned" }).click();
    await V.waitForURL(/returned=1/);
    const rows = await db.depositShare.findMany({ where: { deposit: { groupId: homeId() } } });
    assert(rows.length >= 1 && rows.every((r) => r.status === "returned"), `deposit rows ${JSON.stringify(rows.map((r) => r.status))}`);
    const t = (await V.locator("main").innerText()).replace(/\s+/g, " ");
    assert(/₹38,000/.test(t), `deposit page says: ${t.slice(0, 200)}`);
  });
  await step(V, "Export", "The flat's spreadsheet has the bills and the shopping", async () => {
    const r = await V.request.get(`${base}${gh}/export`, { headers: bypass });
    assert(r.ok(), `status ${r.status()}`);
    const body = await r.text();
    assert(/Electricity/.test(body) && /Groceries/i.test(body), "CSV is missing the flat's expenses");
  });
  await step(V, "Speed", "People search answers fast (5 searches, each timed)", async () => {
    await go(V, `${g}/invite`);
    await openWay(V, "search");
    const box = V.getByLabel("Search people on Loopin");
    const times: number[] = [];
    for (const term of ["As", "Ash", "Ra", "Zo", "Rav"]) {
      await box.fill("");
      const t0 = Date.now();
      const resp = V.waitForResponse((r) => r.url().includes("/api/people"));
      await box.fill(term);
      await resp;
      times.push(Date.now() - t0 - 200); // minus the typing pause
    }
    times.sort((a, b) => a - b);
    assert(times[2] < 1500, `median ${times[2]} ms`);
    return `median ${times[2]} ms, slowest ${times[4]} ms`;
  });

  // ===== 11. Gaps found in the full review: split edits, evening out, small payments, the milk calendar, small screens =====
  await step(V, "Edit", "Change the split on an existing expense (Coffee ₹800: everyone → only You + Asha): balances move exactly", async () => {
    const before = await shownBalances(V, g);
    const href = await editPath(V, "Coffee");
    await go(V, href);
    await openSplit(V);
    await V.getByRole("button", { name: "Only some" }).click();
    for (const [who, want] of [["You", true], ["Asha", true], ["Ravi", false], ["Zoe", false]] as const) {
      const b = V.getByRole("button", { name: new RegExp(`^(✓ )?${who}$`) }).last();
      const on = (await b.innerText()).startsWith("✓") || (await b.getAttribute("aria-pressed")) === "true";
      if (on !== want) await b.click();
    }
    await V.getByRole("button", { name: "Save changes" }).click();
    await V.waitForURL(/tab=activity/);
    const after = await shownBalances(V, g);
    const d = (p: string) => (after[p] ?? 0) - (before[p] ?? 0);
    // ₹800 was ₹200 each; now ₹400 for Varun and Asha, nothing for Ravi and Zoe.
    assert(d("Varun") === -20000 && d("Asha") === -20000 && d("Ravi") === 20000 && d("Zoe") === 20000, `moved: ${JSON.stringify({ V: d("Varun"), A: d("Asha"), R: d("Ravi"), Z: d("Zoe") })}`);
  });
  await step(V, "Couples", "“Even out” on This month opens Settle; marking it paid makes you even", async () => {
    await go(V, gc);
    await V.getByRole("link", { name: "Even out" }).click();
    await V.waitForURL(/\/settle/);
    await rowRecord(V, 0);
    await V.waitForURL(/paid=1/);
    await go(V, gc);
    await V.getByText("You’re even").waitFor();
  });
  await step(V, "Couples", "Settle-up minimum ₹50: a ₹45 balance isn't suggested as a payment, but stays in the balances", async () => {
    await go(V, `${gc}/add`);
    await V.locator("#expense-name").fill("Chai");
    await V.getByLabel("Amount", { exact: true }).fill("100");
    await save(V, { me: "Varun", name: "Chai", amount: "100" });
    await go(V, `${gc}/settings`);
    const form = V.locator('form:has(input[name="settleMin"])');
    await form.locator('input[name="settleMin"]').fill("50");
    await V.getByRole("button", { name: "Save settings" }).click();
    await V.waitForURL(/saved=settings/); // one Save for the whole Settings page
    await go(V, `${gc}/settle`);
    await V.getByText(/1 small amount under ₹50(\.00)? left out/).waitFor();
    const b = await shownBalances(V, gc);
    assert(b.Asha === -4500, `balances ${JSON.stringify(b)}`);
    await go(V, `${gc}/settings`);
    await form.locator('input[name="settleMin"]').fill("");
    await V.getByRole("button", { name: "Save settings" }).click();
    await V.waitForURL(/saved=settings/); // one Save for the whole Settings page
  });
  await step(V, "Flat", "Milk (₹60 a day): tap today as “didn’t come” on its calendar and the month's total drops by ₹60", async () => {
    await go(V, `${gh}/bills/new`);
    await V.getByRole("button", { name: "Milk" }).click();
    await V.getByLabel("Amount", { exact: true }).fill("60");
    await V.getByRole("button", { name: "Add bill" }).click();
    await V.waitForURL(/tab=bills&saved=bill/);
    const bill = await db.bill.findFirst({ where: { groupId: homeId(), name: "Milk", deletedAt: null } });
    assert(bill, "no Milk bill");
    await go(V, `${gh}/bills/${bill.id}`);
    const today = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "numeric" }).format(new Date()));
    const days = () => V.locator("#calendar").innerText().then((t) => Number(/(\d+) of \d+ days/.exec(t)?.[1] ?? -1));
    const before = await days();
    await V.getByRole("button", { name: `${today}: came`, exact: true }).click();
    await V.getByRole("button", { name: `${today}: didn’t come` }).waitFor();
    const after = await days();
    assert(after === before - 1, `days came: ${before} → ${after}`);
  });
  await step(null, "Layout", "Small Android phone (320 px), light mode: no screen scrolls sideways", async () => {
    // On the iPhone run this is still an iPhone (Safari's engine with an iPhone's identity), just 320 px wide.
    const ctx = await browser.newContext({ ...(PROFILE === "iphone" ? P.context : {}), viewport: { width: 320, height: 640 }, locale: "en-IN", timezoneId: "Asia/Kolkata", colorScheme: "light" });
    await ctx.addCookies(await varun.ctx.cookies());
    const page = await ctx.newPage();
    page.setDefaultTimeout(15_000);
    watch(page); // so a page that never goes quiet names the request still open
    const pages = [
      "/", g, `${g}?tab=balances`, `${g}?tab=charts`, `${g}/settle`, `${g}/add`, `${g}/settings`, `${g}/people`, `${g}/invite`,
      gh, `${gh}?tab=bills`, `${gh}?tab=list`, `${gh}/bills/new`, `${gh}/budgets`, `${gh}/deposit`, gc, `${gc}/goals/new`,
      "/settle", "/notifications", "/search", "/account", "/how-it-works", "/welcome",
    ];
    const wide: string[] = [];
    const timings: [string, number][] = [];
    const started = Date.now();
    try {
      for (const p of pages) {
        // Never keep going in the background after the step's own time is up (it would slow the steps after it).
        if (Date.now() - started > 280_000) throw new Error(`only ${pages.indexOf(p)} of ${pages.length} screens checked in time; slowest: ${timings.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([q, ms]) => `${q.replace(/[a-z0-9]{20,}/g, ":id")} ${Math.round(ms / 1000)} s`).join(", ")}`);
        const t0 = Date.now();
        console.log(`  (layout 320: opening ${p.replace(/[a-z0-9]{20,}/g, ":id")})`);
        await go(page, p, { quick: true });
        // A page whose script never lets go would hang this forever: give it 10 s and name it.
        const over = await Promise.race([
          page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${p.replace(/[a-z0-9]{20,}/g, ":id")} didn't answer for 10 s (the page may be stuck)`)), 10_000)),
        ]);
        timings.push([p, Date.now() - t0]);
        console.log(`  (layout 320: ${p.replace(/[a-z0-9]{20,}/g, ":id")} ${Math.round((Date.now() - t0) / 1000)} s)`);
        if (over > 1) {
          wide.push(`${p.replace(/[a-z0-9]{20,}/g, ":id")} (+${over}px)`);
          await page.screenshot({ path: `${out}/wide-${wide.length}.png` });
        }
      }
    } finally {
      await ctx.close().catch(() => undefined);
    }
    assert(wide.length === 0, `scrolls sideways: ${wide.join(", ")}`);
    const slow = slowLoads.splice(0).map((p) => p.replace(/[a-z0-9]{20,}/g, ":id"));
    return `${pages.length} screens checked in ${Math.round((Date.now() - started) / 1000)} s${slow.length ? `; still loading after 10 s (measured anyway): ${slow.join(", ")}` : ""}`;
  }, undefined, 300_000);

  await step(null, "Layout", "Sign-in on small phones (320×568 and 375×667): Google and the email box are both on the first screen, no scrolling", async () => {
    const seen: string[] = [];
    for (const [w, h] of [[320, 568], [375, 667]] as const) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "en-IN", timezoneId: "Asia/Kolkata", colorScheme: "dark" });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15_000);
      await go(page, "/signin");
      const email = page.locator('input[name="email"]');
      await email.waitFor();
      const google = page.locator('a[href^="/api/auth/google/start"]');
      const boxes = [await email.boundingBox(), (await google.count()) ? await google.boundingBox() : null];
      for (const b of boxes) if (b) assert(b.y >= 0 && b.y + b.height <= h, `${w}×${h}: a sign-in control sits at ${Math.round(b.y)}–${Math.round(b.y + b.height)}px, past the screen`);
      assert((await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 1, `${w}×${h}: scrolls sideways`);
      seen.push(`${w}×${h}: email box ends at ${Math.round((boxes[0]?.y ?? 0) + (boxes[0]?.height ?? 0))}px`);
      await ctx.close();
    }
    return seen.join("; ");
  });
  await step(V, "Group settings", "Settings has ONE Save; the group's currency is for the person who looks after it (Asha sees it as text, not a dropdown)", async () => {
    await go(V, `${g}/settings`);
    const form = V.locator("form[data-settings-form]");
    assert((await form.locator('button[type="submit"]').count()) === 1, "the settings form has more than one Save button");
    for (const gone of ["Save how you share", "Save notifications"]) assert((await V.getByRole("button", { name: gone }).count()) === 0, `still has “${gone}”`);
    await go(A, `${g}/settings`);
    assert((await A.locator('[data-admin-only="currency"]').count()) === 1, "Asha doesn't see the currency as admin-only text");
    assert((await A.locator('select[name="currency"]').count()) === 0, "Asha has a currency dropdown");
  });

  // ===== 10. More of everyday use =====
  await step(V, "Edit", "Rename an expense (Taxi → Airport taxi): the history says exactly what changed", async () => {
    const href = await editPath(V, "Taxi");
    await go(V, href);
    await V.locator("#expense-name").fill("Airport taxi");
    await V.getByRole("button", { name: "Save changes" }).click();
    await V.waitForURL(/tab=activity/);
    const ev = await db.groupEvent.findFirst({ where: { groupId: g.split("/").pop()!, kind: "expense_edited" }, orderBy: { createdAt: "desc" } });
    assert(ev && /Name: Taxi → Airport taxi/.test(ev.details ?? ""), `history says: ${ev?.text} ${ev?.details}`);
    await go(V, `${g}?tab=activity&q=${encodeURIComponent("Airport taxi")}`);
    await V.locator('li[id^="item-"] details > summary').filter({ hasText: "Airport taxi" }).first().waitFor();
  });
  await step(V, "Flat", "Skip a bill this time: next month's Rent is marked skipped and won't be added", async () => {
    const rent = await db.bill.findFirst({ where: { groupId: homeId(), name: "Rent", deletedAt: null } });
    assert(rent, "no Rent bill");
    await go(V, `${gh}/bills/${rent.id}`);
    await V.getByRole("button", { name: "Skip this time" }).click();
    await V.waitForURL(/saved=1/);
    const skipped = await db.billRun.findMany({ where: { billId: rent.id, status: "skipped" } });
    assert(skipped.length === 1, `skipped runs: ${skipped.map((r) => r.period).join(", ")}`);
  });
  await step(V, "Flat", "A ₹1,000 Groceries budget with ₹1,240 spent shows “₹240 over”", async () => {
    await go(V, `${gh}/budgets`);
    await V.getByLabel("Pantry Run budget").fill("1000");
    await V.getByRole("button", { name: "Save budgets" }).click();
    await V.waitForURL(new RegExp(`${gh}$`));
    await settleNav(V);
    await V.getByText(/₹240(\.00)? over/).first().waitFor();
  });
  await step(V, "Flat", "Note when someone moved in (Zoe, on the 10th): it's recorded on People and in the history", async () => {
    await go(V, `${gh}/people`);
    const zoe = await db.member.findFirst({ where: { groupId: homeId(), name: { startsWith: "Zoe" } } });
    assert(zoe, "Zoe isn't in the flat");
    await V.locator("details summary").filter({ hasText: zoe.name }).first().click();
    const day = `${new Date().toISOString().slice(0, 8)}10`;
    await V.locator(`#in-${zoe.id}`).fill(day);
    await V.locator(`#in-${zoe.id}`).locator("xpath=ancestor::form[1]").getByRole("button", { name: "Save" }).click();
    // Already on /people, so wait for the save itself (not the address).
    let after = await db.member.findUnique({ where: { id: zoe.id } });
    for (let i = 0; i < 40 && after?.joinedFrom?.toISOString().slice(0, 10) !== day; i++) {
      await V.waitForTimeout(250);
      after = await db.member.findUnique({ where: { id: zoe.id } });
    }
    assert(after?.joinedFrom?.toISOString().slice(0, 10) === day, `moved-in date is ${after?.joinedFrom?.toISOString()}`);
    // The history line is written by the same save: give it a moment too (a slow server finishes the date first).
    let ev = await db.groupEvent.findFirst({ where: { groupId: homeId(), text: { contains: "moved in on" } } });
    for (let i = 0; i < 40 && !ev; i++) {
      await V.waitForTimeout(250);
      ev = await db.groupEvent.findFirst({ where: { groupId: homeId(), text: { contains: "moved in on" } } });
    }
    assert(ev, "no “moved in” line in the history");
  });
  await step(V, "Flat", "Set up Maintenance shared by % (you 70, the other 30); Groceries is one of the tiles", async () => {
    await go(V, `${gh}/bills/new`);
    assert(await V.getByRole("button", { name: "Groceries" }).count(), "no Groceries tile");
    await V.getByRole("button", { name: "Society" }).click();
    await V.locator('input[name="name"]').fill("Maintenance");
    await V.getByLabel("Amount", { exact: true }).fill("3000");
    await V.getByRole("button", { name: "By %" }).click();
    const boxes = V.locator('input[name^="p_"]');
    const n = await boxes.count();
    assert(n >= 2, `only ${n} percentage boxes`);
    await V.getByLabel("Your percentage").fill("70");
    for (let i = 0; i < n; i++) {
      const box = boxes.nth(i);
      if ((await box.getAttribute("aria-label")) !== "Your percentage") await box.fill(i === n - 1 || n === 2 ? "30" : "0");
    }
    await V.getByText("Adds up to 100% ✓").waitFor();
    await V.getByRole("button", { name: "Add bill" }).click();
    await V.waitForURL(/tab=bills&saved=bill/);
    const bill = await db.bill.findFirst({ where: { groupId: homeId(), name: "Maintenance", deletedAt: null } });
    const split = JSON.parse(bill?.split ?? "{}");
    assert(split.mode === "percent" && Object.values(split.pct as Record<string, number>).sort((x, y) => y - x).join("/") === "7000/3000", `split saved as ${bill?.split}`);
  });
  await step(V, "Couples", "Change the goal (target ₹80,000), then remove it", async () => {
    const goal = await db.goal.findFirst({ where: { groupId: gc.split("/").pop()!, deletedAt: null }, orderBy: { createdAt: "desc" } });
    assert(goal, "no goal");
    await go(V, `${gc}/goals/${goal.id}`);
    await V.getByText("Change or remove this goal").click();
    await V.getByLabel("Target").fill("80000");
    await V.getByRole("button", { name: "Save changes" }).click();
    await V.getByText(/of ₹80,000/).first().waitFor();
    await V.getByText("Change or remove this goal").click();
    await V.getByRole("button", { name: "Remove goal" }).click();
    await V.waitForURL(new RegExp(`${gc}$`));
    assert((await db.goal.findUnique({ where: { id: goal.id } }))?.deletedAt, "goal not removed");
  });

  // ===== 11. The new address (loopinapps.com) =====
  // Raw requests with the old address as the Host, against the running app.
  const raw = (path: string, host: string, cookie = "") =>
    new Promise<{ status: number; location: string; setCookie: string[] }>((resolve, reject) => {
      const u = new URL(base);
      const send = u.protocol === "https:" ? httpsRequest : httpRequest;
      const req = send({ hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path, method: "GET", headers: { host, ...bypass, ...(cookie ? { cookie } : {}) } }, (res) => {
        res.resume();
        resolve({ status: res.statusCode ?? 0, location: String(res.headers.location ?? ""), setCookie: (res.headers["set-cookie"] as string[]) ?? [] });
      });
      req.on("error", reject);
      req.end();
    });
  await step(null, "New address", "The old address forwards to loopinapps.com, and a signed-in person arrives still signed in after one tap (once)", async () => {
    // Pretending to be the old address only works on a server of our own; on Vercel it would reach the live app.
    if (hosted) return notRun("checked on the GitHub test server only (on Vercel this would reach the live app)");
    const plain = await raw("/how-it-works", "getloopin.vercel.app");
    assert(plain.status === 307 && plain.location === "https://loopinapps.com/how-it-works", `not signed in: ${plain.status} ${plain.location}`);
    const me = (await varun.ctx.cookies()).find((c) => c.name === "sw_me");
    assert(me, "Varun has no sign-in cookie");
    const cookie = `sw_me=${me.value}; lp_tour=1`;
    const first = await raw("/settle", "getloopin.vercel.app", cookie);
    assert(first.status === 307 && /\/api\/move\?to=%2Fsettle$/.test(first.location), `signed in: ${first.status} ${first.location}`);
    const move = await raw("/api/move?to=%2Fsettle", "getloopin.vercel.app", cookie);
    const m = /^https:\/\/loopinapps\.com\/api\/arrive\?t=([A-Za-z0-9_-]+)&to=%2Fsettle$/.exec(move.location);
    assert(move.status === 307 && m, `move: ${move.status} ${move.location}`);
    // Opening the link signs nobody in: it only leads to a "Continue to Loopin as …?" page, which doesn't use the pass up either.
    const arrive = await raw(`/api/arrive?t=${m[1]}&to=%2Fsettle`, "loopinapps.com");
    assert(arrive.status === 303 && new RegExp(`/arrive\\?t=${m[1]}&to=%2Fsettle$`).test(arrive.location), `arrive: ${arrive.status} ${arrive.location}`);
    assert(!arrive.setCookie.some((c) => c.startsWith("sw_me=")), "opening the link signed someone in");
    const look = await raw(`/arrive?t=${m[1]}&to=%2Fsettle`, "loopinapps.com");
    assert(look.status === 200 && !look.setCookie.some((c) => c.startsWith("sw_me=")), `confirm page: ${look.status}`);
    // The tap on "Yes, continue" signs in (once).
    const fresh = await person(browser);
    await go(fresh.page, `/arrive?t=${m[1]}&to=%2Fsettle`);
    await fresh.page.getByText(/Continue to Loopin as/).waitFor();
    await fresh.page.getByRole("button", { name: "Yes, continue" }).click();
    await fresh.page.waitForURL(/\/settle\?moved=1/);
    assert((await fresh.ctx.cookies()).some((c) => c.name === "sw_me" && c.value === me.value), "sign-in not carried over");
    await fresh.ctx.close();
    const again = await person(browser);
    await go(again.page, `/arrive?t=${m[1]}&to=%2Fsettle`);
    await again.page.getByText(/run out or was already used/).waitFor();
    assert(!(await again.ctx.cookies()).some((c) => c.name === "sw_me"), "the pass worked twice");
    await again.ctx.close();
    // A pass sent to someone already signed in never switches who they are (Fable security 8).
    const move2 = await raw("/api/move?to=%2Fsettle", "getloopin.vercel.app", cookie);
    const m2 = /arrive\?t=([A-Za-z0-9_-]+)&/.exec(move2.location);
    assert(m2, `second move: ${move2.status} ${move2.location}`);
    const planted = await raw(`/api/arrive?t=${m2[1]}&to=%2Fsettle`, "loopinapps.com", "sw_me=someone-else");
    assert(planted.status === 303 && planted.location.endsWith("/settle") && !planted.setCookie.some((c) => c.startsWith("sw_me=")), "a pass switched who was signed in");
    const stays = await raw("/api/health", "getloopin.vercel.app");
    assert(stays.status === 200 || stays.status === 429, `the daily job / health stopped working on the old address (${stays.status})`);
  });

  await step(null, "Sign in", "One screen for new and returning people; Continue with Google goes to Google with our app and PKCE; a forged return is refused", async () => {
    const { ctx, page } = await person(browser);
    await go(page, "/signin");
    await page.getByRole("heading", { name: "Continue to Loopin" }).waitFor();
    assert((await page.getByRole("link", { name: "Sign up", exact: true }).count()) === 0, "separate Sign up / Sign in tabs still shown");
    const googleShown = (await page.getByRole("link", { name: "Continue with Google" }).count()) > 0;
    if (hosted && !googleShown) {
      await ctx.close();
      return notRun("Google isn't switched on for the test copy (it is on the live app)");
    }
    const href = (await page.getByRole("link", { name: "Continue with Google" }).getAttribute("href")) ?? "";
    assert(href.startsWith("/api/auth/google/start"), `Google button links to ${href}`);
    await ctx.close();
    const start = await raw("/api/auth/google/start?back=%2Fsettle", new URL(base).host);
    const g = new URL(start.location);
    assert(start.status === 307 && g.origin === "https://accounts.google.com", `start: ${start.status} ${start.location}`);
    const client = g.searchParams.get("client_id") ?? "";
    assert((hosted ? client.endsWith(".apps.googleusercontent.com") : client === (process.env.GOOGLE_CLIENT_ID || "uat-test.apps.googleusercontent.com")) && g.searchParams.get("code_challenge_method") === "S256", `params: ${g.search}`);
    assert(g.searchParams.get("redirect_uri") === `${base}/api/auth/google/callback`, `redirect_uri: ${g.searchParams.get("redirect_uri")}`);
    assert(start.setCookie.some((c) => c.startsWith("lp_g=")), "no sign-in attempt cookie");
    const forged = await raw("/api/auth/google/callback?state=forged&code=x", new URL(base).host, start.setCookie.map((c) => c.split(";")[0]).join("; "));
    assert(forged.status === 303 && /\/signin\?/.test(forged.location) && !forged.setCookie.some((c) => c.startsWith("sw_me=")), `forged return: ${forged.status} ${forged.location}`);
  });

  await step(V, "Joining", "Someone added by name only: “not on Loopin yet” → Invite by email → they open it, sign up, “Continue as Rohit”, and take over the name", async () => {
    const gid = g.split("/").pop()!;
    const rohit = await db.member.create({ data: { groupId: gid, name: "Rohit" } });
    await go(V, `${g}/people`);
    const row = V.locator("details").filter({ hasText: "Rohit" }).first();
    await row.getByText("not on Loopin yet").waitFor();
    await row.locator(":scope > summary").click();
    await row.getByLabel("Rohit’s email").fill(email("rohit"));
    await row.getByRole("button", { name: "Invite", exact: true }).click();
    await V.waitForURL(/invited=/);
    let mail = null as null | { text: string };
    for (let i = 0; i < 20 && !mail; i++) {
      mail = await db.outbox.findFirst({ where: { to: email("rohit") }, orderBy: { createdAt: "desc" } });
      if (!mail) await V.waitForTimeout(250);
    }
    assert(mail, "no invite email");
    const link = /https?:\/\/\S+\/join\/\S+/.exec(mail.text)?.[0] ?? "";
    assert(link.includes(`as=${rohit.id}`), `link: ${link}`);
    const { ctx, page } = await person(browser);
    await page.goto(link.replace(/^https?:\/\/[^/]+/, base), { waitUntil: "networkidle" });
    await page.getByText(/You were added as/).waitFor();
    await page.getByRole("link", { name: /^Continue with email$/i }).click();
    await signup(page, "Rohit", email("rohit"), true);
    await page.getByRole("button", { name: "Continue as Rohit" }).click();
    await page.waitForURL(new RegExp(`/groups/${gid}`));
    const after = await db.member.findUniqueOrThrow({ where: { id: rohit.id } });
    assert(after.accountId, "Rohit's place wasn't taken over");
    await ctx.close();
  });

  await step(V, "Switching", "“Coming from another app?” → pick the exported file → balances checked → Bring it over: a new group with the same expenses, payments and balances", async () => {
    await go(V, "/switching");
    await V.getByRole("heading", { name: /Bring your groups/ }).waitFor();
    await V.getByRole("link", { name: "Bring a group over" }).first().click();
    await V.waitForURL(/\/import/);
    const csv = [
      "Date,Description,Category,Cost,Currency,Varun,Asha S,Kabir",
      "2026-09-01,Dinner,Dining out,900.00,INR,600.00,-300.00,-300.00",
      '2026-09-03,"Hotel, 2 nights",Hotel,3000.00,INR,1000.00,1000.00,-2000.00',
      "2026-09-04,Kabir paid Varun,Payment,500.00,INR,-500.00,0.00,500.00",
      "",
      "2026-10-20,Total balance, , ,INR,1100.00,700.00,-1800.00",
    ].join("\n");
    await V.getByLabel("Spreadsheet to import").setInputFiles({ name: "manali-trip_2026-10-20_export.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await V.getByText("Found 2 expenses and 1 payment in INR").waitFor();
    await V.getByText("1 Sep – 4 Sep 2026").waitFor();
    await V.getByText("gets back ₹1,100").waitFor();
    await V.getByText("owes ₹1,800").waitFor();
    await V.getByText("✓ Matches the file’s own balances").waitFor();
    assert((await V.getByRole("radio", { name: "Varun", exact: true }).getAttribute("aria-checked")) === "true", "you weren't picked from your name");
    assert((await V.locator('input[name="groupName"]').inputValue()) === "Manali trip", "group name not taken from the file name");
    await V.getByRole("radio", { name: "Trip" }).click();
    await V.getByRole("button", { name: "Bring it over" }).click();
    await V.waitForURL(/imported=2\.1\.ok/);
    await V.getByText(/Brought over 2 expenses and 1 payment/).waitFor();
    const gid = new URL(V.url()).pathname.split("/")[2];
    const grp = await db.group.findUniqueOrThrow({ where: { id: gid }, include: { members: true, expenses: { include: { shares: true } }, payments: true } });
    const net = netBalances(grp.members.map((m) => m.id), grp.expenses, grp.payments);
    const by = (n: string) => net[grp.members.find((m) => m.name === n)!.id];
    assert(by("Varun") === 110000 && by("Asha S") === 70000 && by("Kabir") === -180000, `balances: ${JSON.stringify(net)}`);
    assert(grp.type === "trip", "not a trip");
    // Everyone else is "not on Loopin yet", ready to be invited.
    await go(V, `/groups/${gid}/people`);
    await V.getByText("not on Loopin yet").first().waitFor();
  });

  await step(V, "Trips", "Charts shows a few plain-English lines and “Trip report”; the report shares as a picture plus text (no link to the group)", async () => {
    await go(V, `${g}?tab=charts`);
    await V.getByRole("region", { name: "At a glance" }).waitFor();
    await V.getByRole("link", { name: /Trip report, to share/ }).click();
    await V.waitForURL(/\/report$/);
    await V.getByRole("region", { name: "The trip in numbers" }).waitFor();
    const text = await V.getByLabel("Report as text").innerText();
    assert(text.includes("UAT Goa trip") && /Total ₹/.test(text), `report text: ${text.slice(0, 200)}`);
    assert(!/https?:|\/groups\/|\/join\//.test(text), "the shared text has a link in it");
    const popup = V.waitForEvent("popup", { timeout: 5000 }).catch(() => null);
    const [file] = await Promise.all([V.waitForEvent("download"), V.getByRole("button", { name: "Share to WhatsApp" }).click()]);
    assert(/-report\.png$/.test(file.suggestedFilename()), `picture: ${file.suggestedFilename()}`);
    const wa = await popup;
    assert(!wa || wa.url().includes("wa.me") || wa.url().includes("whatsapp"), `opened ${wa?.url()}`);
    await wa?.close();
    const path = await file.path();
    const { statSync } = await import("node:fs");
    assert(path && statSync(path).size > 10_000, "the picture is empty");
  });

  await step(V, "Account", "You → Export your data → Download all my data: one spreadsheet with every group, my share and my balance change", async () => {
    await go(V, "/account");
    await V.getByRole("link", { name: /Export your data/ }).click();
    await V.waitForURL(/\/account\/data/);
    const [file] = await Promise.all([V.waitForEvent("download"), V.getByRole("link", { name: "Download all my data" }).click()]);
    const { readFileSync } = await import("node:fs");
    const body = readFileSync((await file.path())!, "utf8");
    assert(body.includes("Loopin: all your data") && body.includes(email("varun")), "account lines missing");
    assert(body.includes("UAT Goa trip") && body.includes("Manali trip"), "a group is missing");
    assert(body.includes("Your balance change"), "no balance column");
  });

  await stepOn(["android", "desktop"], "needs Chrome's built-in test fingerprint reader, which Safari's engine does not have; check by hand on a real iPhone", null, "Sign in", "Fingerprint / face: turn it on, sign out, sign back in with one touch, then remove it", async () => {
    const { ctx, page } = await person(browser);
    // A virtual fingerprint reader (Chrome's test authenticator).
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    await go(page, "/signin");
    await signup(page, "Pia", email("pia"));
    await go(page, "/account");
    await page.getByRole("link", { name: /Sign-in & devices/ }).click();
    await page.waitForURL(/\/account\/sign-in/);
    await page.getByRole("button", { name: /Turn on fingerprint \/ face sign-in/ }).click();
    const piaId = (await db.account.findUniqueOrThrow({ where: { email: email("pia") } })).id;
    // Wait for the saved key itself: "This device" can already be on the page before the key is saved.
    await until("the passkey being saved", async () => (await db.passkey.count({ where: { accountId: piaId } })) > 0);
    await page.getByText(/Android phone|This device|Mac|Windows computer/).first().waitFor();
    const keys = await db.passkey.count({ where: { accountId: piaId } });
    assert(keys === 1, `passkeys saved: ${keys}`);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.waitForURL(base + "/");
    await go(page, "/signin");
    await page.getByRole("button", { name: /Sign in with fingerprint or face/ }).click();
    await page.waitForURL(/signedin=1/);
    await go(page, "/account");
    await page.getByText(email("pia")).first().waitFor();
    await go(page, "/account/sign-in");
    await page.getByRole("button", { name: "Remove" }).click();
    await page.waitForURL(/removed=passkey/);
    const left = await db.passkey.count({ where: { accountId: (await db.account.findUniqueOrThrow({ where: { email: email("pia") } })).id } });
    assert(left === 0, `passkeys left after Remove: ${left}`);
    await ctx.close();
  });

  // ===== 12. More of what a person would try (from the human checklist) =====
  await step(V, "Add", "Shares: ₹1,200 split 2 : 1 : 1 : 1 : 1 → Varun ₹400, the others ₹200 each", async () => {
    await add(V, { me: "Varun", name: "Boat ride", amount: "1200", split: { kind: "shares", values: { Varun: "2", Asha: "1", Ravi: "1", Zoe: "1" } } }); // Rohit (joined later) keeps 1 share
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.split("/").pop()!, description: "Boat ride" }, include: { shares: { include: { member: true } } } });
    const got = Object.fromEntries(e.shares.map((x) => [x.member.name, x.amount]));
    assert(got.Varun === 40000 && got.Asha === 20000 && got.Ravi === 20000 && got.Zoe === 20000 && got.Rohit === 20000, `shares saved as ${JSON.stringify(got)}`);
  });
  await step(V, "Add", "Split by item: ₹1,180 bar bill, Pizza ₹600 for Varun and Asha, Beer ₹400 for Asha → tax and tip shared by what each had: Varun ₹354, Asha ₹826", async () => {
    const o = { me: "Varun" as Person, name: "Bar bill", amount: "1180" };
    await go(V, `${g}/add`);
    await fillExpense(V, o);
    await V.getByRole("button", { name: "Items", exact: true }).click();
    const box = V.locator("[data-item-split]");
    await box.getByLabel("Item 1", { exact: true }).fill("Pizza");
    await box.getByLabel("Item 1 price").fill("600");
    const first = box.getByRole("group", { name: "Who had item 1" });
    await first.getByRole("button", { name: "You", exact: true }).click();
    await first.getByRole("button", { name: "Asha", exact: true }).click();
    await box.getByRole("button", { name: /Add item/ }).click();
    await box.getByLabel("Item 2", { exact: true }).fill("Beer");
    await box.getByLabel("Item 2 price").fill("400");
    await box.getByRole("group", { name: "Who had item 2" }).getByRole("button", { name: "Asha", exact: true }).click();
    const t = (await box.locator("[data-item-result]").innerText()).replace(/\s+/g, " ");
    assert(/354/.test(t) && /826/.test(t) && /180/.test(t), `item split shows: ${t}`);
    await save(V, o);
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.split("/").pop()!, description: "Bar bill" }, include: { shares: { include: { member: true } } } });
    const got = Object.fromEntries(e.shares.filter((x) => x.amount).map((x) => [x.member.name, x.amount]));
    assert(JSON.stringify(got) === JSON.stringify({ Varun: 35400, Asha: 82600 }) || (got.Varun === 35400 && got.Asha === 82600 && Object.keys(got).length === 2), `item split saved as ${JSON.stringify(got)}`);
    assert(/By item: Pizza .*600.* \(Varun, Asha\); Beer .*400.* \(Asha\)/.test(e.notes ?? ""), `notes: ${e.notes}`);
    // Editing reopens the items (not just the amounts), and saving again doesn't repeat the notes line.
    await go(V, `${g}/expenses/${e.id}/edit`);
    await V.locator("[data-item-split]").waitFor();
    assert((await V.getByLabel("Item 1", { exact: true }).inputValue()) === "Pizza", "editing didn't reopen the items");
    await V.getByRole("button", { name: /Save/ }).first().click();
    await V.waitForURL(/tab=activity/);
    const again = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    assert((again.notes.match(/By item:/g) ?? []).length === 1, `notes repeated the items: ${again.notes}`);
  });
  await step(V, "Add", "A bill photo stays with the expense: Asha can open it, and someone outside the group can't", async () => {
    const o = { me: "Varun" as Person, name: "Lunch bill", amount: "500" };
    await go(V, `${g}/add`);
    await V.locator("[data-bill-scan] input[type=file]").setInputFiles({ name: "bill.png", mimeType: "image/png", buffer: readFileSync("public/icon-512.png") });
    await V.getByRole("button", { name: "Remove the bill photo" }).waitFor();
    await fillExpense(V, o);
    await save(V, o);
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.split("/").pop()!, description: "Lunch bill" } });
    const r = await db.receipt.findFirst({ where: { expenseId: e.id } });
    assert(r, "the bill photo wasn't kept with the expense");
    const seen = await A.request.get(`${base}/api/receipt/${r!.id}`, { headers: bypass });
    assert(seen.status() === 200 && /^image\//.test(seen.headers()["content-type"] ?? ""), `Asha got ${seen.status()}`);
    const x = await person(browser);
    const outside = await x.page.request.get(`${base}/api/receipt/${r!.id}`, { headers: bypass });
    assert(outside.status() === 404, `someone outside the group got ${outside.status()}`);
    await x.ctx.close();
  });
  // UAT-REV-10 (outside review): on a slow connection, the button says Saving…
  // and can't be pressed again, and the expense is saved exactly once.
  await step(V, "Add", "Slow connection: Save shows Saving… and stays off; a second tap adds nothing; saved once", async () => {
    const o = { me: "Varun" as Person, name: "Slow line chai", amount: "45" };
    await go(V, `${g}/add`);
    await fillExpense(V, o);
    // Every request to the server waits 2.5 s.
    const slow = async (route: Route) => {
      if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    };
    await V.route("**/*", slow);
    try {
      const btn = V.getByRole("button", { name: /^(Save expense|Saving…)$/ });
      await btn.click();
      await V.getByRole("button", { name: "Saving…" }).waitFor({ timeout: 2000 });
      assert(await V.getByRole("button", { name: "Saving…" }).isDisabled(), "the button could still be pressed while saving");
      await V.getByRole("button", { name: "Saving…" }).click({ force: true, timeout: 1000 }).catch(() => {});
      const dup = V.getByRole("button", { name: "It’s a different one" });
      const done = await Promise.race([V.waitForURL(/tab=activity/, { timeout: 20_000 }).then(() => "saved"), dup.waitFor({ timeout: 20_000 }).then(() => "dup")]).catch(() => "timeout");
      if (done === "dup") {
        await dup.click();
        await V.waitForURL(/tab=activity/, { timeout: 20_000 });
      }
    } finally {
      await V.unroute("**/*", slow);
    }
    const n = await db.expense.count({ where: { groupId: g.split("/").pop()!, description: "Slow line chai" } });
    assert(n === 1, `saved ${n} times`);
  });
  // NEG-18 (outside review): checked properly this time, signed in and signed out.
  await step(V, "Postcards", "A postcard link that doesn't exist: signed in → 'This screen isn't here'; signed out → sign-in first", async () => {
    const r = await V.goto(`${base}/postcards/not-a-real-card`, { waitUntil: "load" });
    assert(r?.status() === 404, `signed in: status ${r?.status()}`);
    await V.getByText("This screen isn’t here any more").waitFor();
    const x = await person(browser);
    await x.page.goto(`${base}/postcards/not-a-real-card`, { waitUntil: "load" });
    assert(new URL(x.page.url()).pathname === "/signin", `signed out: ended on ${x.page.url()}`);
    await x.ctx.close();
  });
  await step(V, "Edit", "Editing shows the bill photo already kept, with Replace and Remove; Remove takes it off when saved", async () => {
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.split("/").pop()!, description: "Lunch bill" } });
    await go(V, `${g}/expenses/${e.id}/edit`);
    const current = V.locator("[data-bill-current]");
    await current.waitFor();
    await current.getByRole("button", { name: "Replace" }).waitFor();
    await current.getByRole("button", { name: "Remove" }).click();
    await V.getByText("The photo will be removed when you save.").waitFor();
    await V.getByRole("button", { name: "Save changes" }).click();
    await V.waitForURL(/tab=activity/);
    assert(!(await db.receipt.findFirst({ where: { expenseId: e.id } })), "the bill photo is still attached after Remove + save");
  });

  await step(null, "Sign in", "A wrong code is refused with a clear message, and the right one still works", async () => {
    const { ctx, page } = await person(browser);
    const who = email("wrongcode");
    await go(page, "/signin");
    await page.locator('input[name="email"]').fill(who);
    await page.getByRole("button", { name: "Email me a code" }).click();
    await page.waitForURL(/sent=1/);
    let code = "";
    for (let i = 0; i < 40 && !code; i++) {
      const row = await db.outbox.findFirst({ where: { to: who }, orderBy: { createdAt: "desc" } });
      code = row ? (/\b(\d{6})\b/.exec(row.subject)?.[1] ?? "") : "";
      if (!code) await page.waitForTimeout(250);
    }
    assert(code, "no code arrived");
    const wrong = code === "000000" ? "111111" : "000000";
    await page.locator('input[name="code"]').fill(wrong);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByText("That code isn't right").first().waitFor();
    assert(!/signedin=1/.test(page.url()), "signed in with a wrong code");
    await page.locator('input[name="code"]').fill(code);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/signedin=1/);
    await ctx.close();
  });

  await stepOn(["android", "desktop"], "needs Chrome's built-in test fingerprint reader, which Safari's engine does not have; check by hand on a real iPhone", null, "Sign in", "Right after signing in, “Sign in faster next time?” can be closed with ✕ and stays closed", async () => {
    const { ctx, page } = await person(browser);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
    });
    await go(page, "/signin");
    await signup(page, "Omar", email("omar"));
    await page.getByText("Sign in faster next time?").waitFor();
    await page.getByRole("button", { name: "Not now" }).click();
    await go(page, "/?signedin=1");
    await page.waitForTimeout(800);
    assert((await page.getByText("Sign in faster next time?").count()) === 0, "the offer came back after closing it");
    await ctx.close();
  });

  await step(V, "Settle", "Remind opens WhatsApp with the amount and who owes it", async () => {
    await go(V, `${g}/settle`);
    const link = V.getByRole("link", { name: /Remind/ }).first();
    if (!(await link.count())) return noRemind("", g);
    // Remind goes through Loopin (to make the "I've paid" link), then on to WhatsApp.
    const res = await V.request.get(base + ((await link.getAttribute("href")) ?? ""), { maxRedirects: 0 });
    const href = res.headers()["location"] ?? "";
    assert(res.status() === 303 && /^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(href) && /%E2%82%B9|₹/.test(href), `Remind went to: ${res.status()} ${href.slice(0, 120)}`);
  });

  await step(V, "Settle", "When every payment is under the group's minimum, Settle says “Nearly square”", async () => {
    const cid = gc.split("/").pop()!;
    await db.group.update({ where: { id: cid }, data: { settleMin: 100000 } }); // ₹1,000: more than anything owed
    try {
      await go(V, `${gc}/settle`);
      await V.getByText("Nearly square").first().waitFor();
    } finally {
      await db.group.update({ where: { id: cid }, data: { settleMin: 0 } });
    }
  });

  await step(V, "Add people", "The invite screen shows the group's link and a QR code", async () => {
    await go(V, `${g}/invite`);
    await openWay(V, "qr"); // WhatsApp and Copy link are the main ways; the QR is under More ways to add people
    await V.waitForTimeout(500);
    assert((await V.locator("svg").filter({ has: V.locator("path") }).count()) > 0, "no QR code");
    assert(/\/join\//.test(await V.locator("main").innerText()) || (await V.locator('a[href*="/join/"], input[value*="/join/"]').count()) > 0, "no invite link shown");
  });

  await step(V, "Navigation", "The group name at the top switches to another group", async () => {
    await go(V, g);
    const switcher = V.locator("header details, details").first();
    await switcher.locator("summary").click();
    await switcher.locator("ul a").first().click();
    await V.waitForURL((u) => /\/groups\//.test(u.pathname) && !u.pathname.endsWith(g.split("/").pop()!));
  });

  await step(V, "Currency", "A yen group shows no decimals anywhere, and its settle-up minimum reads in whole yen", async () => {
    const acc = await db.account.findUniqueOrThrow({ where: { email: email("varun") } });
    const grp = await db.group.create({
      data: {
        name: "UAT Tokyo", currency: "JPY", type: "home", inviteCode: `tokyo-${stamp}`, settleMin: 100,
        members: { create: [{ name: "Varun", accountId: acc.id, claimedAt: new Date() }, { name: "Kenji" }] },
      },
    });
    await go(V, `/groups/${grp.id}/add`);
    await V.locator("#expense-name").fill("Ramen");
    await V.getByLabel("Amount", { exact: true }).fill("1000");
    await openSplit(V);
    await V.getByRole("button", { name: "Everyone equally" }).click();
    await save(V, { me: "Varun", name: "Ramen", amount: "1000" });
    const t = await V.locator("main").innerText();
    assert(/JPY 500/.test(t), `balance not JPY 500: ${t.slice(0, 200)}`);
    assert(!/JPY [\d,]+\.\d/.test(t), "yen shown with decimals");
    await go(V, `/groups/${grp.id}/settings`);
    assert((await V.locator('input[name="settleMin"]').inputValue()) === "100", "minimum not shown as 100 yen");
  });

  await step(V, "Flat", "A bill whose payer has moved out waits with “Add it”, and Add it comes pre-filled", async () => {
    const data = await db.group.findUniqueOrThrow({ where: { id: homeId() }, include: { members: true } });
    const gone = data.members.find((m) => m.leftAt);
    assert(gone, "nobody has moved out of the flat");
    const thisMonth = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);
    await db.bill.create({ data: { groupId: homeId(), name: "Internet", icon: "internet", nature: "fixed", amount: 99900, day: 1, payer: gone.id, startMonth: thisMonth } });
    await (await import("../src/lib/home/bills-db")).runBillsForGroup(homeId());
    assert((await db.expense.count({ where: { groupId: homeId(), description: "Internet" } })) === 0, "added even though its payer left");
    await go(V, `${gh}?tab=bills`);
    const row = V.locator("li, div").filter({ hasText: "Internet" }).filter({ has: V.getByRole("link", { name: "Add it" }) }).last();
    await row.getByRole("link", { name: "Add it" }).click();
    await V.waitForURL(/\/add\?/);
    assert((await V.getByLabel("Amount", { exact: true }).inputValue()) === "999", "Add it isn't pre-filled with ₹999 (the box holds the grouped digits exactly: 999)");
  });

  await step(V, "Switching", "A file that isn't a known export gets a clear message; a second currency is flagged", async () => {
    await go(V, "/import");
    await V.getByLabel("Spreadsheet to import").setInputFiles({ name: "notes.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Amount\nTea,20\n") });
    await V.getByRole("region", { name: "Which column is which?" }).waitFor(); // an unknown file: asked which column is which
    await V.getByText("Pick the column that says who paid.").waitFor();
    const two = ["Date,Description,Category,Cost,Currency,Varun,Mia", "2026-09-01,Dinner,Dining out,900.00,INR,450.00,-450.00", "2026-09-02,Gelato,Dining out,10.00,EUR,5.00,-5.00"].join("\n");
    await V.getByLabel("Spreadsheet to import").setInputFiles({ name: "rome_export.csv", mimeType: "text/csv", buffer: Buffer.from(two) });
    await V.getByText(/Lines in EUR are left out/).waitFor();
  });

  await step(V, "Trips", "Close the imported trip: Home links to the trip report, which says All settled; Copy as text works", async () => {
    const vacc = await db.account.findUniqueOrThrow({ where: { email: email("varun") } });
    const trip = await db.group.findFirstOrThrow({ where: { name: "Manali trip", members: { some: { accountId: vacc.id } } }, orderBy: { createdAt: "desc" } });
    await go(V, `/groups/${trip.id}/settle`);
    await openSettleMore(V.locator("[data-settle-actions]"));
    await V.getByRole("button", { name: /Settle everything & close|Close group/ }).click();
    await V.waitForURL(/closed=1/);
    await V.getByRole("link", { name: "See the trip report" }).click();
    await V.waitForURL(/\/report$/);
    await V.getByRole("heading", { name: "All settled ✅" }).waitFor();
    await V.context().grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => undefined);
    await V.getByRole("button", { name: "Copy as text" }).click();
    await V.getByRole("status").filter({ hasText: /Copied|Couldn’t copy/ }).waitFor();
  });

  await step(null, "Privacy", "A stranger can't open a group's report, its spreadsheet or someone else's data download", async () => {
    const { ctx, page } = await person(browser);
    await go(page, `${g}/report`);
    await page.getByText(/Private group/).first().waitFor();
    const csv = await page.request.get(`${base}${g}/export`, { headers: bypass });
    assert(csv.status() === 403 || csv.status() === 401, `group spreadsheet answered ${csv.status()}`);
    const mine = await page.request.get(`${base}/api/my-data`, { headers: bypass });
    assert(mine.status() === 401, `my-data answered ${mine.status()} with no sign-in`);
    await ctx.close();
  });

  // ===== Collect: one person gathers money from many =====
  let collectPath = "";
  await step(V, "Collect", "Varun makes a Farewell collection (₹500 each, his UPI), lists Zoya and Kabir, and picks Asha from his Loopin friends", async () => {
    await go(V, "/collect/new");
    await V.getByRole("button", { name: "Farewell", exact: true }).click();
    assert((await V.locator('input[name="title"]').inputValue()).includes("Farewell"), "the quick pick didn't fill the name");
    await V.locator('input[name="amount"]:not([type="hidden"])').fill("500");
    // In rupees (the hosted copy is opened from a US machine, so it starts in dollars).
    await V.getByText("More options").click();
    await V.locator('select[name="currency"]').selectOption("INR");
    await V.locator('input[name="upiId"]').fill("varun@okicici");
    await V.locator('textarea[name="names"]').fill("Zoya\nKabir");
    await V.getByRole("group", { name: "Your Loopin friends" }).getByRole("button", { name: /Asha/ }).click();
    await V.getByRole("button", { name: "Make the link" }).click();
    await V.waitForURL(/\/c\/[A-Za-z0-9_-]+\?new=1/);
    collectPath = new URL(V.url()).pathname;
    await V.getByText("Varun is collecting").waitFor();
    await V.getByText("₹500 each").first().waitFor();
    const due = V.getByRole("region", { name: "Still to pay" });
    for (const n of ["Zoya", "Kabir", "Asha"]) await due.getByRole("listitem").filter({ hasText: n }).first().waitFor();
    await due.getByText("on Loopin").waitFor();
    const p = await V.locator("[data-collection-progress]").innerText();
    // The organiser's summary: nothing checked or said paid yet, 3 x ₹500 = ₹1,500 not paid yet and the goal, and "3 still to pay".
    assert(/₹0\s+checked/.test(p) && /₹0\s+says paid/.test(p) && /₹1,500\s+not paid yet/.test(p) && /Goal: ₹1,500/.test(p) && (await due.getByRole("listitem").count()) === 3, `progress reads “${p.replace(/\s+/g, " ")}”`);
  });

  // Notifications are written just after the page answers: give them a moment.
  async function alertSays(page: Page, re: RegExp) {
    for (let i = 0; i < 6; i++) {
      await go(page, "/notifications?tab=all");
      if (await page.getByText(re).count()) return;
      await page.waitForTimeout(1500);
    }
    throw new Error(`Alerts never showed ${re}`);
  }

  await step(A, "Collect", "Asha (on Loopin) finds it in Alerts: “Varun added you: ₹500 each”", async () => {
    assert(collectPath, "no collection made");
    await alertSays(A, /added you: ₹500 each/);
  });

  await step(null, "Collect", "Zoya opens the link with no sign-up: the UPI button has Varun's ID and ₹500 filled in; she ticks her name", async () => {
    assert(collectPath, "no collection made");
    const { ctx, page } = await person(browser);
    await go(page, collectPath);
    const upi = await page.getByRole("link", { name: "Pay ₹500 with UPI" }).getAttribute("href");
    assert(upi?.startsWith("upi://pay?pa=varun%40okicici&") && upi.includes("am=500.00") && upi.includes("cu=INR"), `UPI link is ${upi}`);
    await page.locator('select[name="entryId"]').selectOption({ label: "Zoya" });
    await page.getByRole("button", { name: /I’ve paid/ }).click();
    await page.waitForURL(/ticked=1/);
    await page.getByText("You’re on the list.", { exact: false }).waitFor();
    const p = await page.locator("[data-collection-progress]").innerText();
    // UX-03: said-paid money is “says paid”, not checked: "Checked ₹0" and "Says paid ₹500" are separate lines.
    const rep = await page.locator("[data-collection-reported]").innerText();
    assert(/1\s+of\s+3\s+say\s+they['’]ve\s+paid/.test(p) && /Checked\s+₹0/.test(p) && /Says\s+paid\s+₹500/.test(rep), `progress reads “${p.replace(/\s+/g, " ")}” / “${rep}”`);
    await ctx.close();
  });

  await step(V, "Collect", "Varun sees “Zoya says paid” in Alerts, taps Confirm received, marks Kabir as paid in cash: 2 of 3, ₹1,000 of ₹1,500", async () => {
    await alertSays(V, /Zoya says they paid ₹500/);
    await go(V, collectPath);
    const paid = V.getByRole("region", { name: "Paid" });
    await paid.getByText("Says paid", { exact: true }).waitFor();
    await paid.getByRole("button", { name: "Confirm received" }).click();
    await V.waitForLoadState("networkidle").catch(() => undefined);
    await paid.getByText("Checked", { exact: true }).waitFor();
    await V.getByRole("region", { name: "Still to pay" }).getByRole("listitem").filter({ hasText: "Kabir" }).getByRole("button", { name: "Paid cash" }).click();
    await V.getByRole("region", { name: "Paid" }).getByText(/Checked · cash/).waitFor();
    const p = await V.locator("[data-collection-progress]").innerText();
    // Zoya ₹500 + Kabir ₹500 (cash) = ₹1,000 checked of a ₹1,500 goal: ₹500 not paid yet, 2 checked, 1 still to pay, nothing said paid.
    assert(/₹1,000\s+checked/.test(p) && /₹0\s+says paid/.test(p) && /₹500\s+not paid yet/.test(p) && /Goal: ₹1,500/.test(p) && (await V.getByRole("region", { name: "Paid" }).getByText(/^Checked/).count()) === 2 && (await V.getByRole("region", { name: "Still to pay" }).getByRole("listitem").count()) === 1 && (await V.locator("[data-collection-reported]").count()) === 0, `progress reads “${p.replace(/\s+/g, " ")}”`);
  });

  await step(V, "Collect", "Varun reminds Asha inside Loopin (bell); a second reminder straight away is refused; Asha sees it in Alerts", async () => {
    await go(V, collectPath);
    await V.getByRole("button", { name: "Remind Asha in Loopin" }).click();
    await V.getByText("Reminder sent in Loopin.").waitFor();
    await V.getByRole("button", { name: "Remind Asha in Loopin" }).click();
    await V.getByText(/reminded them in the last few hours/).waitFor();
    await alertSays(A, /Reminder from Varun/);
  });

  await step(null, "Collect", "Someone else can't change Varun's collection (no organiser buttons; a forged Confirm received is refused)", async () => {
    const { ctx, page } = await person(browser);
    await go(page, collectPath);
    assert((await page.getByRole("button", { name: "Confirm received" }).count()) === 0, "a stranger sees Confirm received");
    assert((await page.getByRole("button", { name: "Close collection" }).count()) === 0, "a stranger sees Close");
    // The buttons are only hidden. Send the organiser's confirm as someone who isn't the organiser (Asha, who is not the organiser here):
    // it must be refused, and no entry may change.
    const code = collectPath.split("/").pop()!;
    const coll = await db.collection.findFirstOrThrow({ where: { code }, include: { entries: true } });
    const state = async () => (await db.collectionEntry.findMany({ where: { collectionId: coll.id }, orderBy: { id: "asc" } })).map((e) => `${e.id}:${e.status}`).join(",");
    const before = await state();
    const target = coll.entries.find((e) => e.status === "paid") ?? coll.entries[0];
    const { organiserAction } = await import("../src/lib/collect");
    const ashaAcc2 = await db.account.findUniqueOrThrow({ where: { email: email("asha") } });
    assert(ashaAcc2.id !== coll.accountId, "the test person is the organiser, so this can't prove anything");
    for (const kind of ["confirm", "cash", "close"] as const) {
      const r = await organiserAction(code, ashaAcc2.id, { kind, entryId: target.id });
      assert(!r.ok, `a forged “${kind}” as a non-organiser was accepted`);
    }
    assert((await state()) === before, "a collection entry changed after the refused forged calls");
    await ctx.close();
  });

  await step(V, "New group", "“What’s it for?” offers Trip, Home, Couple, Game night, Collect and Anything goes; Game night explains itself; Collect opens Collect", async () => {
    await go(V, "/groups/new");
    for (const t of [/^Trip/, /^Home/, /^Couple/, /^Game night/, /^Anything goes/]) assert(await V.getByRole("button", { name: t }).count(), `no ${t} choice`);
    await V.getByRole("button", { name: /^Game night/ }).click();
    await V.getByText(/Loopin works out who came out ahead, who came out behind and who pays whom/).waitFor();
    await V.getByText(/No betting happens in the app/).waitFor();
    await V.getByRole("link", { name: /^Collect/ }).click();
    await V.waitForURL(/\/collect\/new/);
  });

  // ===== Trip countdown =====
  // Days counted where this person is (a London desktop late in the evening is already a day behind India).
  const istDay = (plus: number) => new Intl.DateTimeFormat("en-CA", { timeZone: P.timezoneId }).format(new Date(Date.now() + plus * 86_400_000));
  async function newTrip(page: Page, name: string, start: string) {
    await go(page, "/groups/new");
    await page.getByRole("button", { name: /^Trip/ }).click();
    await page.locator('input[name="groupName"]').fill(name);
    await page.getByText("start the countdown").waitFor(); // the nudge to add dates
    await page.locator('input[name="tripStart"]').fill(start);
    await page.locator('select[name="currency"]').selectOption("INR");
    await page.getByRole("button", { name: /Create group/ }).click();
    await page.waitForURL(/\/invite\?new=1/);
    return new URL(page.url()).pathname.replace(/\/invite$/, "");
  }

  await step(V, "Countdown", "A trip made with a start date in 10 days: the group says “in 10 days”, Home's Coming up shows its countdown card with the trip's picture", async () => {
    const goa = await newTrip(V, `UAT Goa trip ${stamp % 1000}`, istDay(10));
    await go(V, goa);
    await V.locator("[data-countdown-line]").first().filter({ hasText: "in 10 days" }).waitFor();
    await go(V, "/");
    const card = V.locator("[data-trip-pass]").first();
    assert((await card.getAttribute("data-countdown")) === "10", `Home countdown says ${await card.getAttribute("data-countdown")}`);
    assert(await card.locator("img").count(), "no picture on the countdown card");
    assert(/10/.test((await card.locator("[data-countdown-big]").first().textContent()) ?? ""), "the card doesn't say 10 days");
    // Share sits under the polaroid (44px tall, inside the card); no names line; the quiet "12 December · 6 people" line with its dashed curve and pin.
    const share = card.getByRole("button", { name: "Share" });
    const shareBox = (await share.boundingBox())!;
    const polaroidBox = (await card.locator("img").first().boundingBox())!;
    assert(shareBox.height >= 44, `the Share button is ${Math.round(shareBox.height)}px tall`);
    assert(shareBox.y >= polaroidBox.y + polaroidBox.height - 12, "the Share button is not under the polaroid");
    assert(!/(^|\n)with /.test(await card.innerText()), "the card still has the names line");
    const meta = ((await card.locator("[data-trip-meta]").innerText()) ?? "").replace(/\s+/g, " ").trim();
    assert(/^\d{1,2} [A-Z][a-z]+( \d{4})? · \d+ (people|person)$/.test(meta), `the meta line says “${meta}”`);
    assert((await card.locator("[data-trip-meta] svg").count()) === 1, "the meta line has no dashed curve and pin");
    // The sliding row's FIRST card is the weather for the soonest trip that has not started (no separate Before you go section), with no trip photo; a link into the trip.
    assert((await V.locator("[data-before-you-go]").count()) === 0, "Home still has a separate Before you go section");
    const weather = V.locator('[data-highlight^="weather-"]');
    if (await weather.count()) {
      assert((await weather.count()) === 1, "the row should have one weather card");
      const firstId = await V.locator("[data-highlight], [data-month-card]").first().getAttribute("data-highlight");
      assert(/^weather-/.test(firstId ?? ""), "the weather card is not first in the sliding row");
      const words = ((await weather.textContent()) ?? "").replace(/\s+/g, " ");
      assert(/ · SEASONAL WEATHER/.test(words), "the weather card's heading line is wrong");
      assert(/Usually \d+° by day, \d+° at night/.test(words), "the weather card's temperatures are wrong");
      assert((await weather.locator("img").count()) === 0, "the weather card has a photo");
      assert(/^\/groups\//.test((await weather.locator("a").first().getAttribute("href")) ?? ""), "Open the trip goes elsewhere");
    }
  });

  await step(V, "Countdown", "A second trip in 30 days: Coming up is ONE section with two countdown cards, the soonest first; no “Also:” line, no separate cards", async () => {
    await newTrip(V, `UAT Manali trip ${stamp % 1000}`, istDay(30));
    await go(V, "/");
    assert((await V.locator("[data-coming-up]").count()) === 1, "Home should have exactly one Coming up section");
    const passes = V.locator("[data-trip-pass]");
    assert((await passes.count()) >= 2 && (await passes.count()) <= 3, `Coming up has ${await passes.count()} passes`);
    assert((await passes.first().getAttribute("data-countdown")) === "10", "the soonest trip isn't the first pass");
    assert((await V.locator("[data-trip-also]").count()) === 0, "the Also line is still on Home");
    assert((await V.getByRole("heading", { name: "Also coming up" }).count()) === 0 && (await V.locator("[data-trip-row]").count()) === 0, "Home still has separate cards for other trips");
  });

  await step(V, "Groups", "A photo picked while making a group becomes its picture", async () => {
    await go(V, "/groups/new");
    await V.getByRole("button", { name: /^Anything goes/ }).click();
    await V.locator('input[name="groupName"]').fill(`UAT photo group ${stamp % 1000}`);
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    await V.getByLabel("Choose your own photo").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: png });
    await V.getByRole("status").filter({ hasText: "Added" }).waitFor();
    await V.getByRole("button", { name: /Create group/ }).click();
    await V.waitForURL(/\/invite\?new=1/);
    const id = new URL(V.url()).pathname.split("/")[2];
    const r = await V.request.get(`${base}/api/group-photo/${id}`, { headers: bypass });
    assert(r.status() === 200, `group photo answered ${r.status()}`);
  });

  await step(V, "Add", "Type it in one line: “Snacks 600 split with everyone” fills the name, amount and split, and nothing saves until Save", async () => {
    await go(V, `${g}/add`);
    await V.getByRole("group", { name: "Faster entry" }).getByRole("button", { name: "Type a line" }).click();
    await V.getByLabel("Type the expense in one line").fill("Snacks 600 split with everyone");
    await V.getByRole("button", { name: "Fill", exact: true }).click();
    assert((await V.locator("#expense-name").inputValue()) === "Snacks", `name is “${await V.locator("#expense-name").inputValue()}”`);
    assert((await V.getByLabel("Amount", { exact: true }).inputValue()) === "600", "amount not filled (the box holds exactly 600)");
    await V.getByRole("group", { name: "Quick line" }).getByRole("status").filter({ hasText: "Check below" }).waitFor();
  });

  await step(V, "Add", "Add expense is tidy: the currency pill, the amount and the day under it, one Faster entry row (Scan a bill · Speak · Type a line), then What was it?, Who paid and the split; notes, money back, several payers and Spin sit under a closed More; the result for you is one quiet line above Save", async () => {
    await go(V, `${g}/add`);
    await V.getByLabel("Amount", { exact: true }).fill("1200");
    await V.locator("#expense-name").fill("Beach dinner");
    const row = V.getByRole("group", { name: "Faster entry" });
    assert((await row.getByRole("button").allTextContents()).map((t) => t.trim()).join("|").match(/^(Scan a bill|Bill photo)\|Speak\|Type a line$/), "the Faster entry row isn't Scan a bill · Speak · Type a line");
    const y = async (loc: ReturnType<Page["locator"]>) => (await loc.first().boundingBox())!.y;
    const order = [await y(V.getByRole("button", { name: /^(Today|Yesterday)/ })), await y(row), await y(V.locator("#expense-name")), await y(V.getByText("Who paid?")), await y(V.getByText("How to split?"))];
    assert(order.every((v, i) => i === 0 || v > order[i - 1]), `the form order is off: ${order.map(Math.round).join(", ")}`);
    const result = (await V.locator("[data-expense-result]").innerText()).replace(/\s+/g, " ");
    assert(/You (paid|get back|owe)|Just you|Nobody owes|square/.test(result), `the result for you reads: ${result}`);
    assert((await V.locator("[data-fx-card]").count()) === 0, "the foreign-currency line shows on an expense in the group's own currency");
    const more = V.locator("[data-more] > button");
    assert((await more.getAttribute("aria-expanded")) === "false", "More isn't closed to start with");
    assert((await V.getByPlaceholder(/Rahul paid the tip/).count()) === 0, "notes are showing while More is closed");
    await more.click();
    await V.getByPlaceholder(/Rahul paid the tip/).waitFor();
    await V.getByRole("switch", { name: "Money back" }).waitFor();
    await V.getByRole("switch", { name: /More than one person paid/ }).waitFor();
    await V.getByRole("button", { name: /Spin for it/ }).waitFor();
    assert((await V.locator("[data-payer-row]").count()) === 1 && (await V.locator("[data-split-row]").count()) === 1, "Who paid / How to split chips aren't each one scrolling row");
  });
  await step(V, "Add", "Editing an expense that has notes opens More by itself, so nothing is hidden", async () => {
    const e = await db.expense.findFirstOrThrow({ where: { groupId: g.split("/").pop()!, deletedAt: null, NOT: { notes: "" } }, orderBy: { createdAt: "desc" } });
    await go(V, `${g}/expenses/${e.id}/edit`);
    assert((await V.locator("[data-more] > button").getAttribute("aria-expanded")) === "true", "More is closed on an expense that has notes");
    await V.getByPlaceholder(/Rahul paid the tip/).waitFor();
  });
  await step(null, "Words", "No page says another app’s name: the tour, guide, FAQ, switching and import screens", async () => {
    const { ctx, page } = await person(browser);
    for (const path of ["/welcome", "/how-it-works", "/faq", "/switching"]) {
      await go(page, path);
      const text = await page.locator("body").innerText();
      assert(!/splitwise/i.test(text), `${path} still names another app`);
      assert(!/splitwise/i.test(await page.title()), `${path}: the title names another app`);
      assert(!/splitwise/i.test((await page.locator('head meta[name="description"]').first().getAttribute("content").catch(() => "")) ?? ""), `${path}: the description names another app`);
    }
    await go(page, "/");
    assert(!/splitwise/i.test((await page.locator('head meta[name="keywords"]').getAttribute("content").catch(() => "")) ?? ""), "the keywords name another app");
    await ctx.close();
  });
  await step(V, "Words", "Game night: none of poker, teen patti, buy-in, cash out, winnings or bet appears on the group-type chips, the game screens, the FAQ or How Loopin works; the calm line is on the game screen", async () => {
    // Everything a person can read on the page (closed folds too), minus the one allowed sentence.
    const BANNED = /poker|teen\s?patti|buy[\s-]?ins?\b|cash(ed)?[\s-]?outs?|winnings?|\bbets?\b|\bbetting\b|gambl/i;
    // Text nodes a person can read (closed folds too), skipping script, style and template (Next.js data lives in script tags).
    // A plain string, so the test runner's helper names (__name) never reach the page.
    const visibleText = () =>
      V.evaluate(`(() => {
        const out = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) => (n.parentElement && n.parentElement.closest("script, style, template, noscript") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
        });
        for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n.nodeValue || "");
        return out.join(" ");
      })()`) as Promise<string>;
    const clean = async (label: string) => {
      const text = (await visibleText()).replace(/No betting happens in the app\.?/gi, "");
      const bad = BANNED.exec(text);
      assert(!bad, `${label} shows “${bad?.[0]}”`);
    };
    // The group-type chips (New group).
    await go(V, "/groups/new");
    await clean("New group");
    // A Game night group with a game being played.
    await V.getByRole("button", { name: /^Game night/ }).click();
    await V.locator('input[name="groupName"]').fill(`UAT game night ${stamp % 1000}`);
    await V.getByRole("button", { name: /Create group/ }).click();
    await V.waitForURL(/\/pot\/new\?first=1/);
    const groupPath = new URL(V.url()).pathname.replace(/\/pot\/new$/, "");
    await clean("Start a game");
    assert((await V.locator("[data-game-note]").innerText()).includes("Loopin keeps the score of games you play together. No betting happens in the app."), "the calm line is missing on Start a game");
    const kinds = await V.locator('input[name="game"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    assert(kinds.join(",") === "cards,board,any", `game choices are ${kinds.join(",")}`);
    await V.locator('input[name="name"]').fill("Friday night");
    await V.locator('input[name="newNames"]').fill("Chirag, Dev");
    await V.getByRole("button", { name: "Start the game" }).click();
    await V.waitForURL(/\/pot\/[^/?]+\?started=1/);
    await V.getByRole("form", { name: "Chips in" }).waitFor();
    await clean("the game screen");
    assert((await V.locator("[data-game-note]").first().innerText()).includes("No betting happens in the app."), "the calm line is missing on the game screen");
    const game = new URL(V.url()).pathname;
    // Chips in for everyone, then the games list and the Took home fold.
    await V.getByRole("form", { name: "Chips in" }).getByLabel("Amount each").fill("500");
    await V.getByRole("form", { name: "Chips in" }).locator('button[type="submit"]').click();
    await V.waitForURL(/bought=/);
    await clean("the game screen after chips in");
    await go(V, `${groupPath}?tab=games`);
    await clean("the Games tab");
    assert((await V.locator("[data-game-note]").first().innerText()).includes("No betting happens in the app."), "the calm line is missing on the Games tab");
    // The group-type chips in Settings, the header, the FAQ and the guide.
    await go(V, `${groupPath}/settings`);
    await clean("Settings");
    assert((await V.locator("body").innerText()).includes("Game night"), "Settings doesn’t call the group type Game night");
    for (const path of ["/faq", "/how-it-works", game]) {
      await go(V, path);
      await clean(path);
    }
    await go(V, "/faq");
    assert((await visibleText()).includes("What is Game night?"), "the FAQ doesn’t explain Game night");
  });
  await step(V, "Words", "The import screen gives generic export steps and no other app’s name", async () => {
    await go(V, "/import");
    assert(!/splitwise/i.test(await V.locator("body").innerText()), "the import screen names another app");
    await V.getByText("Where’s the export in my app?").click(); // the steps sit in a fold
    await V.getByText(/In your old app|Your old app/).first().waitFor();
  });

  // UPI is shown only to people in India (by design: the You page decides from the phone's language and region), so this runs on the India-region profiles.
  await stepOn(["android", "iphone"], "UPI is shown only in India; this viewer is en-GB in London, who gets the pay-link step below instead", V, "Settle", "Varun adds his UPI ID on the You page; his WhatsApp Remind carries it and an “I’ve paid” link that opens without signing in", async () => {
    await go(V, "/account/pay");
    const pay = V.getByRole("region", { name: "How friends pay you back" });
    await pay.getByLabel("UPI ID (India)").fill("varun@okicici");
    await pay.getByRole("button", { name: "Save pay details" }).click();
    await V.waitForURL(/pay=saved/);
    await settleNav(V);
    await go(V, `${g}/settle`);
    const link = V.locator("[data-remind]").first();
    if (!(await link.count())) return noRemind("the pay details were saved, but ", g);
    const res = await V.request.get(base + ((await link.getAttribute("href")) ?? ""), { maxRedirects: 0 });
    assert(res.status() === 303, `Remind answered ${res.status()}`);
    const wa = decodeURIComponent(res.headers()["location"] ?? "");
    assert(wa.startsWith("https://api.whatsapp.com/send") && wa.includes("UPI: varun@okicici") && /I’ve paid/.test(wa) && /\/p\/[A-Za-z0-9_-]{22}/.test(wa), `Remind text: ${wa.slice(0, 240)}`);
    // The link, on a phone that has never signed in: what's owed, Pay with UPI, I've paid. (Not tapped here: the money check is in the end-to-end tests.)
    const payPath = new URL(res.headers()["x-pay-link"] ?? "").pathname;
    const { ctx, page } = await person(browser);
    await go(page, payPath);
    await page.locator("[data-paylink='owes']").waitFor();
    assert(((await page.locator("[data-pay='upi']").getAttribute("href")) ?? "").startsWith("upi://pay?pa=varun%40okicici"), "no UPI button for Varun");
    assert(/^Pay with UPI$/.test((await page.locator("[data-pay='upi']").innerText()).trim()), "the UPI button isn't “Pay with UPI”");
    assert(/This records a payment made outside Loopin\. Loopin doesn’t move money\./.test(await page.locator("body").innerText()), "the payment line is missing on the I’ve paid page");
    assert(await page.locator("[data-i-paid]").count(), "no I’ve paid button");
    // A made-up link: a friendly page, not an error.
    await go(page, "/p/AAAAAAAAAAAAAAAAAAAAAA");
    await page.locator("[data-paylink='gone']").waitFor();
    await ctx.close();
  });
  await stepOn(["desktop"], "this is the outside-India path (PayPal, Venmo, Revolut, Monzo); in India the UPI step above runs instead", V, "Settle", "Outside India: the You page has no UPI box; Varun saves a PayPal link and the “I’ve paid” page offers PayPal", async () => {
    await go(V, "/account/pay");
    const pay = V.getByRole("region", { name: "How friends pay you back" });
    assert((await pay.getByLabel("UPI ID (India)").count()) === 0, "a UPI box is shown outside India");
    await pay.getByLabel(/PayPal, Venmo, Cash App, Revolut or Monzo link/).fill("paypal.me/varunuat");
    await pay.getByRole("button", { name: "Save pay details" }).click();
    await V.waitForURL(/pay=saved/);
    await settleNav(V);
    await go(V, `${g}/settle`);
    const link = V.locator("[data-remind]").first();
    if (!(await link.count())) return noRemind("the pay details were saved, but ", g);
    const res = await V.request.get(base + ((await link.getAttribute("href")) ?? ""), { maxRedirects: 0 });
    assert(res.status() === 303, `Remind answered ${res.status()}`);
    const payPath = new URL(res.headers()["x-pay-link"] ?? "").pathname;
    const { ctx, page } = await person(browser);
    await go(page, payPath);
    await page.locator("[data-paylink='owes']").waitFor();
    const href = (await page.locator("[data-pay='paypal']").getAttribute("href")) ?? "";
    assert(href.startsWith("https://paypal.me/varunuat/"), `PayPal button goes to ${href}`);
    assert(/^Pay with PayPal$/.test((await page.locator("[data-pay='paypal']").innerText()).trim()), "the button isn't “Pay with PayPal”");
    assert((await page.locator("[data-pay='upi']").count()) === 0, "a UPI button is shown for a PayPal-only person");
    await ctx.close();
  });

  await step(V, "Fun", "React 🔥 to an expense: it shows under the expense; tapping 🔥 again takes it back", async () => {
    const ex = await db.expense.findFirst({ where: { groupId: g.split("/").pop()!, deletedAt: null }, orderBy: { createdAt: "desc" } });
    assert(ex, "the group has no expense to react to, but the steps above add several");
    await go(V, `${g}?tab=activity&open=${ex.id}`);
    const react = V.getByRole("group", { name: "React" }).first();
    await react.getByRole("button", { name: "React 🔥" }).click();
    await V.waitForURL(/open=/);
    await V.locator("[data-reactions*='🔥']").first().waitFor();
    await V.getByRole("group", { name: "React" }).first().getByRole("button", { name: "React 🔥" }).click();
    await V.waitForURL(/open=/);
    await V.waitForTimeout(500);
  });

  await step(V, "Fun", "Spin for it: the wheel lands on someone, and they become the payer", async () => {
    await go(V, `${g}/add`);
    await openMore(V);
    await V.getByRole("button", { name: /Spin for it/ }).click();
    const d = V.getByRole("dialog", { name: "Spin the wheel" });
    await d.getByRole("button", { name: "Spin", exact: true }).click();
    const set = d.getByRole("button", { name: /^Set .+ as payer$/ });
    await set.waitFor({ timeout: 8000 });
    const who = ((await set.textContent()) ?? "").replace(/^Set | as payer$/g, "").replace(/^yourself$/, "You");
    await set.click();
    await openSplit(V); // the Who paid? chips are on screen
    await V.getByRole("button", { name: who, exact: true, pressed: true }).waitFor();
  });

  await step(V, "Fun", "Wrapped: tap through the slides; the last one offers Share", async () => {
    await go(V, `${g}/wrapped`);
    for (let k = 0; k < 8 && !(await V.locator("[data-wrapped-slide='outro']").count()); k++) await V.getByRole("button", { name: "Next" }).click();
    await V.getByRole("button", { name: "Share it" }).waitFor();
  });

  await step(V, "Fun", "Titles: everyone in the group gets a fun title, shown as a small chip under their name on Balances", async () => {
    await go(V, `${g}?tab=balances`);
    const chips = await V.locator("[data-title]").count();
    assert(chips >= 2, `only ${chips} title chips`);
    assert((await V.locator("[data-title-card]").count()) === 0, "the big title cards are back on Balances");
  });

  await step(V, "Fun", "Where to? when making a trip (optional): the trip earns its passport stamp", async () => {
    await go(V, "/groups/new");
    await V.getByRole("button", { name: /^Trip/ }).click();
    await V.locator('input[name="groupName"]').fill(`UAT weekend ${stamp % 1000}`);
    await V.getByText("Add it to get a stamp in everyone’s trip passport.").waitFor();
    await V.getByLabel("Places").fill("Krabi");
    await V.getByLabel("Country").selectOption("TH");
    await V.locator('input[name="tripStart"]').fill(istDay(-2));
    await V.locator('select[name="currency"]').selectOption("INR");
    await V.getByRole("button", { name: /Create group/ }).click();
    await V.waitForURL(/\/invite\?new=1/);
    const trip = new URL(V.url()).pathname.replace(/\/invite$/, "");
    await go(V, `${trip}/settings`);
    assert((await V.getByLabel("Places").inputValue()) === "Krabi", "Where to? wasn't saved");
    await go(V, "/passport");
    await V.locator("[data-been-card='trip']").first().waitFor({ state: "attached" }); // the trip's card (no small stamp on it any more)
  });

  await step(V, "Fun", "Trip passport opens like a booklet, and several countries from before Loopin can be added at once", async () => {
    await go(V, "/account");
    await V.getByRole("link", { name: /Your trip passport/ }).click();
    await V.waitForURL(/\/passport/);
    // The Been cards come first; the booklet opens from the passport art.
    await V.getByRole("link", { name: "Open your passport book" }).click();
    await V.waitForURL(/\/passport\?book=1/);
    await V.getByRole("button", { name: "Open your passport" }).click();
    await V.getByRole("button", { name: "Next page" }).waitFor();
    await go(V, "/passport");
    await V.getByRole("button", { name: "Add a place" }).click();
    const sheet = V.getByRole("dialog", { name: "Add countries" });
    await sheet.getByLabel("Search countries").fill("thai");
    await sheet.getByRole("checkbox", { name: "Thailand" }).check();
    await sheet.getByLabel("Search countries").fill("jap");
    await sheet.getByRole("checkbox", { name: "Japan" }).check();
    await sheet.getByRole("button", { name: "Add 2 countries" }).click();
    await V.waitForURL(/added=2/);
    await go(V, "/passport?all=1"); // every card, however many trips there are
    await V.locator("[data-been-card='hand'][data-country='TH']").waitFor({ state: "attached" });
    await V.locator("[data-been-card='hand'][data-country='JP']").waitFor({ state: "attached" });
    await go(V, "/passport?book=1");
    await V.locator("[data-index-country='JP']").waitFor({ state: "attached" });
  });

  await step(V, "Fun", "Share my passport sends one picture of the open booklet (details, map, every stamp), and nothing else", async () => {
    await go(V, "/passport");
    await V.getByRole("button", { name: "Share", exact: true }).click();
    const sheet = V.getByRole("dialog", { name: "Share your passport" });
    await sheet.getByText("WhatsApp", { exact: true }).waitFor();
    assert((await sheet.locator("[data-album-preview]").count()) === 0, "still offers an album of several pictures");
    const res = await V.request.get(`${base}/passport/image`);
    assert(res.ok() && (res.headers()["content-type"] ?? "").startsWith("image/png") && (await res.body()).length > 40_000, `picture: ${res.status()} ${res.headers()["content-type"]}`);
    await sheet.getByRole("button", { name: "Close" }).click();
  });

  // ----- Passport, Been tab (UAT step 8 of the passport/moments plan) -----
  await step(null, "Fun", "Passport Been tab: Thailand 5–10 May 2026 (6 days) and Goa 13–15 Mar 2026 (3 days) show as cards, and the numbers read 2 countries, 2 trips, 9 days away", async () => {
    const dana = await person(browser);
    try {
      await go(dana.page, "/signin?back=/passport");
      await signup(dana.page, "Dana", email("dana-been"));
      const acc = await db.account.findUniqueOrThrow({ where: { email: email("dana-been") } });
      await db.account.update({ where: { id: acc.id }, data: { homeCountry: "IN", passportChoiceAt: new Date() } });
      const mk = (name: string, start: string, end: string, place: string, country: string, others: string[]) =>
        db.group.create({
          data: {
            name, currency: "INR", type: "trip", inviteCode: `been-${Math.random().toString(36).slice(2, 8)}-${stamp}`, tripStart: start, tripEnd: end, tripPlace: place, tripCountry: country,
            members: { create: [{ name: "Dana", accountId: acc.id, claimedAt: new Date() }, ...others.map((n) => ({ name: n }))] },
          },
        });
      const thai = await mk("Thailand", "2026-05-05", "2026-05-10", "Bangkok, Phuket", "TH", ["Nupur", "Riya", "Dev", "Meera", "Ravi"]); // 6 people
      const goa = await mk("Goa trip", "2026-03-13", "2026-03-15", "Goa", "", ["Nupur", "Riya", "Dev"]); // 4 people
      await go(dana.page, "/passport");
      const row = await dana.page.locator("[data-passport-stats-row]").getAttribute("data-passport-stats-row");
      assert(row === "2|2|9", `the numbers row says ${row}, not 2|2|9`);
      const rowText = (await dana.page.locator("[data-passport-stats-row]").innerText()).replace(/\s+/g, " ");
      for (const w of ["countries", "trips", "days travelled"]) assert(rowText.includes(w), `the numbers row is missing “${w}”: ${rowText}`);
      // One card design for every trip: newest first. Thailand, then Goa.
      const thaiCard = dana.page.locator(`[data-been-card='trip'][data-group='${thai.id}']`);
      const thaiText = (await thaiCard.innerText()).replace(/\s+/g, " ");
      // A card with a photo has no stamp (founder, 17 Nov); a card without one shows the big ring stamp instead.
      const stampWords = async (card: typeof thaiCard, words: string[]) => ((await card.locator("[data-been-panel]").count()) ? words : []);
      for (const w of ["Thailand", "Bangkok · Phuket", "5–10 May · 6 days", ...(await stampWords(thaiCard, ["THAILAND", "MAY 2026"])), "Relive trip"]) assert(thaiText.includes(w), `the Thailand card is missing “${w}”: ${thaiText}`);
      assert((await thaiCard.locator("[data-been-cta]").getAttribute("href")) === `/groups/${thai.id}/report`, "Relive trip doesn't go to the trip");
      const goaCard = dana.page.locator(`[data-been-card='trip'][data-group='${goa.id}']`);
      const goaText = (await goaCard.innerText()).replace(/\s+/g, " ");
      for (const w of ["Goa", "13–15 Mar · 3 days", ...(await stampWords(goaCard, ["INDIA", "MAR 2026"]))]) assert(goaText.includes(w), `the Goa card is missing “${w}”: ${goaText}`);
      const order = await dana.page.locator("[data-been-card='trip']").evaluateAll((els) => els.map((e) => e.getAttribute("data-group")));
      assert(order[0] === thai.id && order[1] === goa.id, `the cards aren't newest first: ${order.join(",")}`);
      assert((await dana.page.getByRole("link", { name: "Open your passport book" }).count()) === 1, "no quiet link to the passport book");
    } finally {
      await dana.ctx.close();
    }
  });

  // =====================================================================
  // Exercise A: what a store reviewer would try. Everything below uses the real
  // screens, and every amount is checked against the independent tally (modelNet,
  // worked out by hand in the comments), never against the app's own sums.
  // =====================================================================
  const raviAcc = await db.account.findUniqueOrThrow({ where: { email: email("ravi") } });
  const ashaAcc = await db.account.findUniqueOrThrow({ where: { email: email("asha") } });
  const mainGid = g.split("/").pop()!;

  // ----- Money: a big group, a refund bigger than a share, yen -----
  const TWELVE = ["Varun", "Meera", "Dev", "Isha", "Neel", "Tara", "Kabir", "Lata", "Omar", "Pia", "Sana", "Yash"];
  let tw = { id: "", path: "", code: "" };
  const twLedger: GEntry[] = [];
  await step(V, "Money", "A big group of 12: a ₹1,200 dinner for everyone is ₹100 each, and all 12 balances are right", async () => {
    tw = await seedGroup("UAT Twelve", TWELVE.slice(1));
    const o = { me: "Varun", name: "Group dinner", amount: "1200" };
    await go(V, `${tw.path}/add`);
    await fillExpense(V, o);
    await save(V, o);
    // By hand: 120000 paise ÷ 12 = 10000 each. Varun paid 120000 and owes 10000: +110000. The other 11 owe 10000: −10000 each (11 × 10000 = 110000).
    twLedger.push({ payer: "Varun", amount: 120000, shares: evenly(120000, TWELVE) });
    const got = await shownBalancesIn(V, tw.path, "INR");
    assert(got.Varun === 110000 && TWELVE.slice(1).every((p) => got[p] === -10000), `balances: ${JSON.stringify(got)}`);
    return checkLedger(V, tw.path, TWELVE, twLedger);
  });
  await step(V, "Money", "In that group, ₹1,000 shared by 12 can't divide evenly: four people carry ₹83.34, eight ₹83.33, and nothing is lost", async () => {
    const o = { me: "Varun", payer: "Meera", name: "Minibus", amount: "1000" };
    await go(V, `${tw.path}/add`);
    await fillExpense(V, o);
    await save(V, o);
    // By hand: 100000 ÷ 12 = 8333 remainder 4 (12 × 8333 = 99996), so four shares are 8334 and eight are 8333: 4×8334 + 8×8333 = 100000.
    const e = await db.expense.findFirstOrThrow({ where: { groupId: tw.id, description: "Minibus" }, include: { shares: true } });
    const amounts = e.shares.map((x) => x.amount).sort((a, b) => a - b);
    assert(amounts.length === 12, `${amounts.length} shares for 12 people`);
    assert(amounts.reduce((a, b) => a + b, 0) === 100000, `shares add up to ${amounts.reduce((a, b) => a + b, 0)}, not 100000`);
    assert(amounts.filter((a) => a === 8334).length === 4 && amounts.filter((a) => a === 8333).length === 8, `shares are ${amounts.join(",")}`);
    twLedger.push({ payer: "Meera", amount: 100000, shares: evenly(100000, TWELVE) });
    return checkLedger(V, tw.path, TWELVE, twLedger);
  });
  await step(V, "Money", "Money back bigger than a share: Meera gets ₹600 back for the minibus, shared by all 12 (₹50 each)", async () => {
    await go(V, `${tw.path}/add`);
    await V.locator("[data-more] > button").click(); // Money back sits under More (no switch at the top)
    await V.getByRole("switch", { name: "Money back" }).click();
    await openSplit(V);
    await V.getByRole("button", { name: /^(✓ )?Meera$/ }).first().click();
    await V.locator("#expense-name").fill("Minibus refund");
    await V.getByLabel("Amount", { exact: true }).fill("600");
    await openSplit(V);
    const everyone = V.getByRole("button", { name: "Everyone equally" });
    if (await everyone.count()) await everyone.click();
    await save(V, { me: "Varun", name: "Minibus refund", amount: "600" }, "Save money back");
    const rf = await db.expense.findFirstOrThrow({ where: { groupId: tw.id, description: "Minibus refund" }, include: { shares: true } });
    assert(rf.kind === "refund" && rf.amount === 60000 && rf.shares.length === 12 && rf.shares.every((x) => x.amount === 5000), `refund saved as ${rf.kind} ${rf.amount} in ${rf.shares.length} shares`);
    // By hand (dinner, minibus, refund), in paise, exact fractions:
    //   Varun   +110000 − 8333.33 + 5000 = +106666.67      Meera  −10000 + 100000 − 8333.33 − 60000 + 5000 = +26666.67
    //   others  −10000 − 8333.33 + 5000  = −13333.33 (each of 10)       sum: 106666.67 + 26666.67 − 133333.33 = 0
    twLedger.push({ payer: "Meera", amount: -60000, shares: evenly(-60000, TWELVE) });
    const want = modelNet(TWELVE, twLedger);
    assert(Math.round(want.Varun) === 106667 && Math.round(want.Meera) === 26667 && Math.round(want.Dev) === -13333, `the tally itself is off: ${JSON.stringify(want)}`);
    return checkLedger(V, tw.path, TWELVE, twLedger);
  });
  await step(V, "Money", "Settle up for 12 people: at most 11 payments, and together they move what the two people who are owed are owed", async () => {
    const { cards, total } = await settleTotal(V, tw.path);
    assert(cards >= 1 && cards <= 11, `${cards} payments suggested for 12 people`);
    // Owed in all: Varun ₹1,066.67 + Meera ₹266.67 = ₹1,333.34 (±1 paisa each for the odd paise).
    const owedPaise = 106667 + 26667;
    assert(Math.abs(Math.round(total * 100) - owedPaise) <= 12, `the payments add up to ₹${total}, expected about ₹${owedPaise / 100}`);
    return `${cards} payments, ₹${total}`;
  });

  const OSAKA = ["Varun", "Kenji", "Mika"];
  const osakaLedger: GEntry[] = [];
  let osaka = { id: "", path: "", code: "" };
  await step(V, "Money", "Yen has no decimals: ¥1,000 shared by 3 is ¥334 + ¥333 + ¥333, then Kenji pays ¥2,400 (¥800 each)", async () => {
    osaka = await seedGroup("UAT Osaka", ["Kenji", "Mika"], "JPY");
    const first = { me: "Varun", name: "Ramen night", amount: "1000", inGroupCurrency: true };
    await go(V, `${osaka.path}/add`);
    await fillExpense(V, first);
    await save(V, first);
    const second = { me: "Varun", payer: "Kenji", name: "Day passes", amount: "2400", inGroupCurrency: true };
    await go(V, `${osaka.path}/add`);
    await fillExpense(V, second);
    await save(V, second);
    // By hand (whole yen): 1000 ÷ 3 = 333 remainder 1, so shares are 334, 333, 333. 2400 ÷ 3 = 800 each.
    //   Varun +1000 − 333.33 − 800 = −133.33     Kenji −333.33 + 2400 − 800 = +1266.67     Mika −333.33 − 800 = −1133.33
    const ramen = await db.expense.findFirstOrThrow({ where: { groupId: osaka.id, description: "Ramen night" }, include: { shares: true } });
    assert(ramen.shares.map((x) => x.amount).sort((a, b) => a - b).join(",") === "333,333,334", `ramen shares: ${ramen.shares.map((x) => x.amount).join(",")}`);
    assert(ramen.amount === 1000, `¥1,000 was stored as ${ramen.amount} (yen have no cents to multiply)`);
    osakaLedger.push({ payer: "Varun", amount: 1000, shares: evenly(1000, OSAKA) }, { payer: "Kenji", amount: 2400, shares: evenly(2400, OSAKA) });
    const note = await checkLedger(V, osaka.path, OSAKA, osakaLedger, "JPY");
    for (const path of [`${osaka.path}?tab=balances`, `${osaka.path}?tab=activity`, `${osaka.path}/settle`]) {
      await go(V, path);
      const text = await V.locator("main").innerText();
      assert(/JPY/.test(text), `${path}: no yen amounts on the screen`);
      assert(!/JPY\s?[\d,]+\.\d/.test(text) && !/¥\s?[\d,]+\.\d/.test(text), `${path}: yen shown with decimals`);
    }
    const { cards, total } = await settleTotal(V, osaka.path);
    // Kenji is owed ¥1,266.67 in all, so the payments carry ¥1,267 (±1 yen each way).
    assert(cards >= 1 && cards <= 2 && Math.abs(total - 1267) <= 2, `${cards} payments, total ¥${total}, expected about ¥1,267`);
    return note;
  });

  // ----- Imports: another app's file with columns to map; Loopin's own spreadsheet back in -----
  await step(V, "Imports", "A plain spreadsheet from some other app: Loopin can't guess who paid, asks which column is which, and the balances come out exactly", async () => {
    await go(V, "/import");
    // Columns Loopin can half-guess: it finds Day, Spent and For, but not “Who” (who paid) or “Thing” (what it was).
    const csv = ["Day,Thing,Spent,Who,For", '2026-10-01,Cab,900,Meera,"Meera, Dev, Isha"', '2026-10-02,Lunch,100.00,Dev,"Meera, Dev, Isha"'].join("\n");
    await V.getByLabel("Spreadsheet to import").setInputFiles({ name: "weekend-sheet.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await V.getByRole("region", { name: "Which column is which?" }).waitFor();
    await V.getByText("Pick the column that says who paid.").waitFor();
    await V.getByLabel("Paid by column").selectOption({ label: "Who" });
    await V.getByLabel("What it was column").selectOption({ label: "Thing" });
    // By hand, in paise. Cab: Meera pays 90000, three share 30000 each → Meera +60000, Dev −30000, Isha −30000.
    // Lunch: Dev pays 10000, three share it: 3334 (the odd paisa goes to the first name listed), 3333, 3333 → Dev +6667, Meera −3334, Isha −3333.
    // Together: Meera +56666, Dev −23333, Isha −33333 (adds up to 0).
    await V.getByText("Found 2 expenses and 0 payments in INR").waitFor();
    await V.getByText("gets back ₹566.66").waitFor();
    await V.getByText("owes ₹233.33").waitFor();
    await V.getByText("owes ₹333.33").waitFor();
    await V.getByRole("radio", { name: "Meera", exact: true }).click();
    await V.getByRole("button", { name: "Bring it over" }).click();
    await V.waitForURL(/imported=2\.0\./);
    const path = new URL(V.url()).pathname;
    const got = await shownBalancesIn(V, path, "INR");
    assert(got.Meera === 56666 && got.Dev === -23333 && got.Isha === -33333, `balances after the import: ${JSON.stringify(got)}`);
    const people = ["Meera", "Dev", "Isha"];
    return checkLedger(V, path, people, [
      { payer: "Meera", amount: 90000, shares: { Meera: 30000, Dev: 30000, Isha: 30000 } },
      { payer: "Dev", amount: 10000, shares: { Meera: 3334, Dev: 3333, Isha: 3333 } },
    ]);
  });
  await step(V, "Imports", "Loopin's own spreadsheet for the 12-person group (with its refund) is brought back in: the copy has the same 12 balances to the paisa", async () => {
    await go(V, `${tw.path}/settings`);
    const [file] = await Promise.all([V.waitForEvent("download"), V.getByRole("link", { name: /Download spreadsheet/ }).click()]);
    const body = readFileSync((await file.path())!);
    assert(/Money back/.test(body.toString("utf8")), "the spreadsheet has no Money back line");
    const before = await shownBalancesIn(V, tw.path, "INR");
    await go(V, "/import");
    await V.getByLabel("Spreadsheet to import").setInputFiles({ name: file.suggestedFilename(), mimeType: "text/csv", buffer: body });
    await V.getByText("Found 3 expenses and 0 payments in INR").waitFor();
    assert((await V.locator("[data-import-balance]").count()) === 12, "the preview doesn't list all 12 people");
    await V.getByLabel("Group name", { exact: true }).fill("UAT Twelve copy");
    await V.getByRole("button", { name: "Bring it over" }).click();
    await V.waitForURL(/imported=3\.0\./);
    const path = new URL(V.url()).pathname;
    const copyId = path.split("/")[2];
    assert((await db.expense.count({ where: { groupId: copyId, kind: "refund" } })) === 1, "the money-back line didn't come back as money back");
    const after = await shownBalancesIn(V, path, "INR");
    const differ = TWELVE.filter((p) => after[p] !== before[p]);
    assert(differ.length === 0, `the copy differs for ${differ.map((p) => `${p}: ${after[p]} vs ${before[p]}`).join("; ")}`);
    return checkLedger(V, path, TWELVE, twLedger);
  });

  // ----- Sharing: the pay link, signed out, from Remind to "I've paid" -----
  await step(V, "Sharing", "The pay link opened by someone who isn't signed in shows exactly what they owe (₹450); “I've paid” counts at once", async () => {
    const pl = await seedGroup("UAT Pay link", ["Rohan"]);
    const o = { me: "Varun", name: "Team dinner", amount: "900" };
    await go(V, `${pl.path}/add`);
    await fillExpense(V, o);
    await save(V, o);
    const ledger: GEntry[] = [{ payer: "Varun", amount: 90000, shares: evenly(90000, ["Varun", "Rohan"]) }]; // Rohan owes 45000
    await checkLedger(V, pl.path, ["Varun", "Rohan"], ledger);
    await go(V, `${pl.path}/settle`);
    const remind = V.locator("[data-remind]").first();
    assert(await remind.count(), "Rohan owes Varun ₹450 but Settle up has no Remind button");
    const res = await V.request.get(base + ((await remind.getAttribute("href")) ?? ""), { maxRedirects: 0 });
    assert(res.status() === 303, `Remind answered ${res.status()}`);
    const payPath = new URL(res.headers()["x-pay-link"] ?? "").pathname;
    const { ctx, page } = await person(browser); // nobody is signed in here
    try {
      await go(page, payPath);
      await page.locator("[data-paylink='owes']").waitFor();
      const shown = (await page.locator("[data-paylink-amount]").innerText()).replace(/\s+/g, "");
      assert(shown === "₹450", `the link shows ${shown}, not ₹450`);
      await page.locator("[data-i-paid]").click();
      await page.waitForURL(/paid=1/);
      // It counts at once: Rohan paid Varun 45000, so both are square, and Varun has nothing to confirm.
      await go(V, `${pl.path}/settle`);
      assert((await V.locator("[data-waiting='Rohan']").count()) === 0, "Varun is asked to confirm a payment that already counts");
      ledger.push({ payer: "Rohan", amount: 45000, shares: { Varun: 45000 } });
      await checkLedger(V, pl.path, ["Varun", "Rohan"], ledger);
      const got = await shownBalancesIn(V, pl.path, "INR");
      assert(got.Varun === 0 && got.Rohan === 0, `after the link payment: ${JSON.stringify(got)}`);
      // The same link now says nothing is owed.
      await go(page, payPath);
      assert((await page.locator("[data-paylink]").first().getAttribute("data-paylink")) !== "owes", "the link still asks for money after it was paid");
    } finally {
      await ctx.close();
    }
  });

  // ----- Sharing: a postcard sealed with wax, a postcard sealed until next year, opened by the other person -----
  async function sendPostcard(page: Page, to: string, message: string, until?: "a year"): Promise<string> {
    await go(page, `/postcards/new?group=${mainGid}`);
    await page.getByRole("button", { name: "Print: Mountains" }).click();
    await page.getByRole("tab", { name: "Note" }).click();
    await page.getByRole("button", { name: "Wax seal", exact: true }).click(); // the tool, then its colours
    await page.getByRole("button", { name: "Gold wax", exact: true }).click();
    await page.getByRole("button", { name: "Message", exact: true }).click();
    await page.getByRole("textbox", { name: "Your message" }).fill(message);
    await page.getByRole("tab", { name: "Send" }).click();
    if (until) {
      await page.getByRole("button", { name: "A year from today" }).click();
      await page.locator("[data-sealed-note]").waitFor();
    }
    await page.locator(`[data-recipient='${to}']`).click();
    await page.getByRole("button", { name: "Send to 1 person" }).click();
    await page.waitForURL(/\/postcards\/[a-z0-9]+\?sent=1/);
    return new URL(page.url()).pathname;
  }
  let cardPath = "";
  let sealedPath = "";
  await step(A, "Sharing", "A postcard with a wax seal: Asha sends it to Ravi, who opens it, turns it over and reads the message", async () => {
    const message = `UAT postcard ${stamp}: the beach shack was the fancy dinner.`;
    cardPath = await sendPostcard(A, "Ravi", message);
    await go(R, cardPath);
    const flip = R.locator("[data-postcard-flip]");
    await flip.click();
    await R.locator("[data-back-message]").waitFor();
    assert((await R.locator("[data-back-message]").innerText()).includes("fancy dinner"), "the message isn't on the back of the card");
    assert(await R.locator("[data-postcard-back] [data-touch='seal']").count(), "the wax seal isn't on the card");
    const card = await db.postcard.findFirstOrThrow({ where: { fromId: ashaAcc.id, toId: raviAcc.id, message: { contains: String(stamp) } } });
    await until("the card being marked as read", async () => (await db.postcard.findUnique({ where: { id: card.id } }))?.readAt);
  });
  await step(R, "Sharing", "A postcard sealed until next year can't be read early; once its day comes (the clock moved on in the test database) it opens", async () => {
    sealedPath = await sendPostcard(A, "Ravi", `UAT sealed ${stamp}: open me later.`, "a year");
    await go(R, sealedPath);
    await R.locator("[data-sealed]").first().waitFor();
    assert((await R.locator("[data-back-message]").count()) === 0, "a sealed postcard shows its message early");
    assert(!(await R.content()).includes("open me later"), "a sealed postcard's words are in the page");
    await db.postcard.update({ where: { id: sealedPath.split("/").pop()! }, data: { opensAt: new Date(Date.now() - 60_000) } });
    await go(R, sealedPath);
    await R.locator("[data-postcard-flip]").click();
    await R.locator("[data-back-message]").waitFor();
    assert((await R.locator("[data-back-message]").innerText()).includes("open me later"), "the opened postcard has the wrong message");
  });
  await step(R, "Sharing", "One-side postcard: Asha sends it, Ravi reads it as one card (no flip), with the message on it", async () => {
    const message = `UAT one side ${stamp}: wrong turn, best day.`;
    await go(A, `/postcards/new?group=${mainGid}`);
    await A.locator('[data-format-choice="oneside"]').click();
    await A.getByRole("button", { name: "Message", exact: true }).click();
    await A.getByRole("textbox", { name: "Your message" }).fill(message);
    await A.locator("[data-next]").click();
    await A.locator("[data-recipient='Ravi']").click();
    await A.getByRole("button", { name: "Send to 1 person" }).click();
    await A.waitForURL(/\/postcards\/[a-z0-9]+\?sent=1/);
    await go(R, new URL(A.url()).pathname);
    await R.locator("[data-postcard-oneside]").first().waitFor();
    assert((await R.locator("[data-postcard-flip]").count()) === 0, "a one-side card can be flipped");
    assert((await R.locator("[data-back-message]").innerText()).includes("wrong turn"), "the message isn't on the one-side card");
    const card = await db.postcard.findFirstOrThrow({ where: { fromId: ashaAcc.id, toId: raviAcc.id, message: { contains: `UAT one side ${stamp}` } } });
    assert(card.format === "oneside", `the card was saved as ${card.format}`);
  });
  await step(Z, "Permissions", "A postcard is for its sender and its receiver only: a third person gets “not found”, and signed out is sent to sign in", async () => {
    assert(cardPath, "no postcard was sent");
    // Zoe must really be signed in first: a signed-out visitor is sent to sign in (a 200 page), which would look like "a third person can see it".
    await go(Z, "/account");
    assert(!/\/signin/.test(Z.url()), "Zoe isn't signed in, so this check would prove nothing");
    assert((await Z.locator('a[href="/signin"], a[href^="/signin?"]').count()) === 0, "Zoe's browser is showing sign-in links, so she is signed out");
    const res = await Z.goto(base + cardPath);
    assert(res?.status() === 404, `a third person got status ${res?.status()}`);
    const x = await person(browser);
    await x.page.goto(base + cardPath);
    await x.page.waitForURL(/\/signin/);
    await x.ctx.close();
  });

  // ----- Safety: report and block (store rules for things people send each other), and the AI question -----
  await step(R, "Safety", "Report and block: Ravi reports Asha's postcard (“We'll look at this within 24 hours”), blocks her from there, her card is gone from his view, and he unblocks from You", async () => {
    assert(cardPath, "no postcard was sent");
    await go(R, cardPath);
    await R.locator("[data-report-link]").click();
    await R.waitForURL(/\/report\?/);
    await R.getByLabel("Spam").check();
    await R.getByRole("button", { name: "Send report" }).click();
    await R.locator("[data-report-done]").waitFor();
    assert((await R.locator("[data-report-done]").innerText()).includes("We’ll look at this within 24 hours."), "the thank-you words are wrong");
    const rep = await db.report.findFirstOrThrow({ where: { reporterId: raviAcc.id, targetAccountId: ashaAcc.id } });
    assert(rep.reason === "spam" && rep.status === "open", "the report wasn't saved as an open spam report");
    // Every page already accepts dialogs (newPage); a second accept would throw, so this one is skipped if already handled.
    R.once("dialog", (d) => void d.accept().catch(() => undefined));
    await R.getByRole("button", { name: /^Block / }).click();
    await R.waitForURL(/\/account\/privacy\?blocked=1/);
    await R.getByText("You’ll still see shared group expenses and balances.").waitFor();
    const gone = await R.goto(base + cardPath);
    assert(gone?.status() === 404, `a blocked person's postcard still opens (status ${gone?.status()})`);
    await go(R, "/account/privacy");
    // Every page already accepts dialogs (newPage); a second accept would throw, so this one is skipped if already handled.
    R.once("dialog", (d) => void d.accept().catch(() => undefined));
    await R.getByRole("button", { name: "Unblock" }).click();
    await R.getByText("Unblocked.").waitFor();
    const back = await R.goto(base + cardPath);
    assert(back?.status() === 200, `after unblocking the postcard doesn't open (status ${back?.status()})`);
  });
  await step(A, "Safety", "AI question: You → Privacy & sharing starts “Not asked yet”; Don't allow records no, Allow records yes; Help & support on You reaches Contact support", async () => {
    await go(A, "/account");
    await A.getByRole("link", { name: /Privacy & sharing/ }).click();
    await A.waitForURL(/\/account\/privacy/);
    await A.locator("[data-ai-setting='unasked']").waitFor();
    await A.getByRole("button", { name: /^Don.t allow$/ }).click();
    await A.locator("[data-ai-setting='no']").waitFor();
    assert((await db.account.findUniqueOrThrow({ where: { id: ashaAcc.id } })).aiConsent === "no", "Don't allow wasn't saved");
    await A.getByRole("button", { name: "Allow", exact: true }).click();
    await A.locator("[data-ai-setting='yes']").waitFor();
    assert((await db.account.findUniqueOrThrow({ where: { id: ashaAcc.id } })).aiConsent === "yes", "Allow wasn't saved");
    await go(A, "/account");
    assert((await A.getByRole("link", { name: /Help & support/ }).getAttribute("href")) === "/support", "You has no Help & support row to Contact support");
  });

  // ----- Sharing: a passport is hidden until its owner says yes -----
  await step(A, "Privacy", "Passport: hidden until the owner chooses. Ravi can't open Asha's before she answers; the question shows once, and Show opens it", async () => {
    await go(R, `/passport/friends/${ashaAcc.id}`);
    await R.getByText("Asha hasn’t shared their passport yet.").waitFor();
    await go(A, "/passport");
    await A.getByText("Show your places to people in your groups?").waitFor();
    await A.getByText("Only people you share a group with can see it. You can change this any time.").waitFor();
    await A.getByRole("button", { name: "Show", exact: true }).click();
    await A.waitForURL(/shared=groups/);
    await go(A, "/passport");
    assert((await A.getByText("Show your places to people in your groups?").count()) === 0, "the passport question came back after Show");
    await go(R, `/passport/friends/${ashaAcc.id}`);
    assert(!/keeps their passport private|hasn.t shared their passport/.test(await R.locator("main").innerText()), "Ravi can't open Asha's passport after she tapped Show");
  });
  await step(A, "Sharing", "Not now keeps a passport hidden and the question never comes back", async () => {
    await go(Z, "/passport");
    await Z.getByText("Show your places to people in your groups?").waitFor();
    await Z.getByRole("button", { name: "Not now" }).click();
    await Z.waitForURL(/shared=private/);
    await go(Z, "/passport");
    assert((await Z.getByText("Show your places to people in your groups?").count()) === 0, "the passport question came back after Not now");
    await go(Z, "/passport?open=who"); // "Who can see it" is a folded row now
    assert((await Z.getByRole("button", { name: "Only me" }).getAttribute("aria-pressed")) === "true", "Not now should leave it on Only me");
  });
  await step(A, "Sharing", "Asha sends her passport to Ravi, who set his own to “Only me”: he gets it, and Asha still can't open his", async () => {
    await go(R, "/passport?open=who");
    await R.getByRole("button", { name: "Only me" }).click();
    await R.getByText("Only you can see your passport now.").waitFor();
    await go(A, "/passport/send");
    await A.locator("[data-passport-recipient='Ravi']").click();
    await A.getByRole("button", { name: "Send in Loopin" }).click();
    await A.waitForURL(/sent=1/);
    await alertSays(R, /Asha sent you their passport/);
    await go(R, `/passport/friends/${ashaAcc.id}`);
    await R.getByRole("heading", { name: /Asha.s passport/ }).waitFor();
    assert(!/keeps their passport private|hasn.t shared their passport/.test(await R.locator("main").innerText()), "Ravi can't open the passport Asha sent him");
    await go(A, `/passport/friends/${raviAcc.id}`);
    await A.getByText("Ravi keeps their passport private.").waitFor();
    assert((await A.locator("[data-country-stamp]").count()) === 0, "a hidden passport shows stamps");
  });
  await step(R, "Privacy", "Someone who hid their passport can't send it either (“change who can see it first”), and turning it back on restores both", async () => {
    try {
      await go(R, "/passport/send");
      await R.locator("[data-passport-recipient='Asha']").click();
      await R.getByRole("button", { name: "Send in Loopin" }).click();
      await R.waitForURL(/error=private/);
      await R.getByText("Your passport isn’t shown to people in your groups yet. Choose who can see it first.").waitFor();
    } finally {
      await go(R, "/passport?open=who");
      await R.getByRole("button", { name: "People in my groups" }).click();
      await R.getByText("People in your groups can see your passport.").waitFor();
    }
    await go(A, `/passport/friends/${raviAcc.id}`);
    assert(!(await A.locator("main").innerText()).includes("keeps their passport private"), "Ravi's passport is still hidden after he turned sharing back on");
  });

  // ----- Permissions: someone who leaves, someone who is removed, and an old link -----
  let rules = "";
  let rulesCode = "";
  let snackId = "";
  await step(V, "Permissions", "Varun starts a new group; Ravi and Zoe join from its link. Ravi, an ordinary member, sees no delete / currency / remove controls", async () => {
    await go(V, "/groups/new");
    await V.locator('input[name="groupName"]').fill(`UAT Rules ${stamp % 1000}`);
    await V.locator('select[name="currency"]').selectOption("INR");
    await V.getByRole("button", { name: /Create group/ }).click();
    await V.waitForURL(/\/invite\?new=1/);
    rules = new URL(V.url()).pathname.replace(/\/invite$/, "");
    const m = /\/join\/([A-Za-z0-9_-]+)/.exec(await V.content());
    assert(m, "no join link on the new group's Add people screen");
    rulesCode = m[1];
    for (const page of [R, Z]) {
      await go(page, `/join/${rulesCode}`);
      await page.getByRole("button", { name: /^Join / }).click();
      await page.waitForURL(new RegExp(`${rules}(\\?|$)`));
    }
    await go(R, `${rules}/settings`);
    await R.locator('[data-admin-only="delete"]').waitFor();
    assert((await R.getByRole("button", { name: /Delete (this )?group/i }).count()) === 0, "an ordinary member is offered Delete group");
    assert((await R.locator('select[name="currency"]').count()) === 0, "an ordinary member can change the currency");
  });
  await step(V, "Money", "“Yesterday” is yesterday where the person is: the saved day, and the time zone the app was told, both match", async () => {
    const o = { me: "Varun", name: "Snack", amount: "100", date: "Yesterday" as const, split: { kind: "one" as const, who: "Varun" } };
    await go(V, `${rules}/add`);
    await fillExpense(V, o);
    await save(V, o);
    const e = await db.expense.findFirstOrThrow({ where: { groupId: rules.split("/").pop()!, description: "Snack" } });
    snackId = e.id;
    const [y, mo, d] = new Intl.DateTimeFormat("en-CA", { timeZone: P.timezoneId }).format(new Date()).split("-").map(Number);
    const yesterday = new Date(Date.UTC(y, mo - 1, d - 1)).toISOString().slice(0, 10);
    assert(e.spentAt && dayKey(e.spentAt, P.timezoneId) === yesterday, `saved as ${e.spentAt?.toISOString()}, expected the day ${yesterday} in ${P.timezoneId}`);
    const tzCookie = (await V.context().cookies()).find((c) => c.name === "tz");
    // Chrome reports India's zone by its old name (Asia/Calcutta); the cookie is URL-encoded (Asia%2FCalcutta). Same zone.
    if (tzCookie) assert(sameZone(decodeURIComponent(tzCookie.value), P.timezoneId), `the app was told the time zone ${tzCookie.value}`);
    return `${yesterday} in ${P.timezoneId}`;
  });
  await step(R, "Permissions", "Ravi leaves the group himself; after that he sees it only up to the day he left", async () => {
    await go(R, `${rules}/people`);
    await R.locator("details summary").filter({ hasText: "Ravi" }).first().click();
    await R.getByRole("button", { name: "Leave group" }).click();
    await until("Ravi leaving", () => db.member.findFirst({ where: { groupId: rules.split("/").pop()!, accountId: raviAcc.id, leftAt: { not: null } } }));
    await go(R, rules);
    await R.locator("[data-left-banner]").waitFor();
  });
  await step(R, "Permissions", "After Ravi left, Varun adds a new expense: Ravi doesn't see it, and still sees what was there before he left", async () => {
    // Varun pays for himself only, so nobody owes anything and Zoe can still be removed later (removing needs a square balance).
    const o = { me: "Varun", name: "Late dinner", amount: "90", split: { kind: "one" as const, who: "Varun" } };
    await go(V, `${rules}/add`);
    await fillExpense(V, o);
    await save(V, o);
    await go(R, `${rules}?tab=activity`);
    await R.getByText("Snack").first().waitFor(); // what was there before he left is still shown, so an empty page can't pass as "hidden"
    assert((await R.getByText("Late dinner").count()) === 0, "Ravi (who left) can see an expense added after he left");
    await go(R, rules);
    assert((await R.getByText("Late dinner").count()) === 0, "Ravi (who left) sees the later expense on the group's front page");
  });
  await step(R, "Permissions", "A leaver trying to edit: the Add screen says he left and offers no Save, and Varun's old expense opens read-only", async () => {
    const gid = rules.split("/").pop()!;
    const before = await db.expense.findUniqueOrThrow({ where: { id: snackId } });
    const count = await db.expense.count({ where: { groupId: gid } });
    await go(R, `${rules}/add`);
    await R.getByText(/You left this group/).waitFor();
    assert((await R.getByRole("button", { name: /Save expense/ }).count()) === 0 && (await R.locator("#expense-name").count()) === 0, "a leaver is offered the Add form");
    await go(R, `${rules}/expenses/${snackId}/edit`);
    assert((await R.locator("#expense-name").count()) === 0 && (await R.getByRole("button", { name: /^Save/ }).count()) === 0, "a leaver is offered the Edit form");
    const after = await db.expense.findUniqueOrThrow({ where: { id: snackId } });
    assert(after.description === before.description && after.amount === before.amount && (await db.expense.count({ where: { groupId: gid } })) === count, "something changed in the group after the leaver tried");
    // The screens only hide the forms. Send the same save calls the forms make, as Ravi: both must be refused and change nothing.
    const { saveExpense } = await import("../src/lib/save-expense");
    const members = await db.member.findMany({ where: { groupId: gid } });
    const ravi = members.find((m) => m.accountId === raviAcc.id)!.id;
    const varun = members.find((m) => m.name === "Varun")!.id;
    const rate = (async () => ({ ok: true, rate: "1", date: new Date().toISOString().slice(0, 10) })) as never;
    const form = { groupId: gid, name: "Forged", category: "", amount: "50", currency: "INR", paidById: ravi, forMode: "selected" as const, selected: [ravi, varun], onePersonId: "", splitType: "equal" as const, exact: {}, percent: {}, paymentMethod: "cash" as const, markupChoice: "group" as const, markupCustom: "", rateMode: "auto" as const, manualRate: "" };
    const forgedAdd = await saveExpense(form, ravi, rate);
    assert(!forgedAdd.ok, "a forged Add as the leaver was accepted");
    const forgedEdit = await saveExpense({ ...form, expenseId: snackId, name: "Snack", rateMode: "keep" as const }, ravi, rate);
    assert(!forgedEdit.ok, "a forged Edit as the leaver was accepted");
    const still = await db.expense.findUniqueOrThrow({ where: { id: snackId } });
    assert(still.description === before.description && still.amount === before.amount && (await db.expense.count({ where: { groupId: gid, description: "Forged" } })) === 0, "a refused forged save still changed the group");
  });
  await step(V, "Permissions", "Varun removes Zoe; she can't get back in with the old invite link or the old group address", async () => {
    await go(V, `${rules}/people`);
    await V.locator("details summary").filter({ hasText: "Zoe" }).first().click();
    await clickAndWait(V, V.getByRole("button", { name: "Remove Zoe" }));
    const zoeAcc = await db.account.findUniqueOrThrow({ where: { email: email("zoe") } });
    await until("Zoe being removed", () => db.member.findFirst({ where: { groupId: rules.split("/").pop()!, accountId: zoeAcc.id, removedAt: { not: null } } }));
    await go(Z, `/join/${rulesCode}`);
    await Z.locator("[data-join-removed]").waitFor();
    assert(/removed you from this group/.test(await Z.locator("[data-join-removed]").innerText()), "the old link doesn't say she was removed");
    assert((await Z.getByRole("button", { name: /^Join / }).count()) === 0, "the old link still offers Join to a removed person");
    await go(Z, rules);
    await Z.locator("[data-left-banner]").waitFor();
    assert(/You were removed/.test(await Z.locator("[data-left-banner]").innerText()), "the banner doesn't say she was removed");
    await go(Z, `${rules}/add`);
    assert((await Z.locator("#expense-name").count()) === 0 && (await Z.getByRole("button", { name: /Save expense/ }).count()) === 0, "a removed person is offered the Add form");
    // The page only hides the Join button. Send the join the button would, as Zoe: it must be refused and her removal must stay.
    const { joinExisting, joinNew } = await import("../src/lib/join");
    const zoeRow = await db.member.findFirstOrThrow({ where: { groupId: rules.split("/").pop()!, accountId: zoeAcc.id } });
    const who = { id: zoeAcc.id, name: zoeAcc.name, email: zoeAcc.email };
    const asSelf = await joinExisting(rulesCode, who, zoeRow.id);
    const asNew = await joinNew(rulesCode, who, "Zoe");
    assert(!asSelf.ok && !asNew.ok, `a removed person got back in with a forged join: ${JSON.stringify({ asSelf, asNew })}`);
    const kept = await db.member.findUniqueOrThrow({ where: { id: zoeRow.id } });
    assert(kept.removedAt !== null, "Zoe's removal was undone by the refused join");
  });

  // ----- Layout: no sideways scroll at this device's own size; the desktop column -----
  await step(V, "Regression", "No screen scrolls sideways at this device's own size, including the 12-person and yen groups", async () => {
    const pages = ["/", g, `${g}?tab=balances`, `${g}/settle`, `${g}/add`, `${g}/settings`, `${tw.path}?tab=balances`, `${tw.path}/settle`, `${tw.path}/add`, `${osaka.path}?tab=balances`, `${osaka.path}/settle`, "/import", "/passport", "/account", "/notifications"];
    const wide: string[] = [];
    for (const p of pages) {
      await go(V, p);
      const over = await V.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) {
        // Name what sticks out, so a failure says where to look (the deepest elements past the right edge).
        const culprits = await V.evaluate(() => {
          const W = window.innerWidth;
          const out: string[] = [];
          document.querySelectorAll("body *").forEach((el) => {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.right <= W + 1) return;
            if ([...el.children].some((c) => c.getBoundingClientRect().right > W + 1)) return; // only the innermost
            const hooks = [...el.attributes].filter((a) => a.name.startsWith("data-")).map((a) => a.name).join(" ");
            const up = [...Array(4)].reduce<Element | null>((e) => e?.parentElement ?? null, el);
            const upHooks = up ? [...up.attributes].filter((a) => a.name.startsWith("data-")).map((a) => a.name).join(" ") : "";
            out.push(`<${el.tagName.toLowerCase()} ${hooks}> right ${Math.round(r.right)} "${(el.textContent ?? "").trim().slice(0, 40)}" in [${upHooks}]`);
          });
          return out.slice(0, 4);
        });
        wide.push(`${p.replace(/[a-z0-9]{20,}/g, ":id")} (+${over}px: ${culprits.join(" | ")})`);
      }
    }
    assert(wide.length === 0, `scrolls sideways: ${wide.join(", ")}`);
    return `${pages.length} screens at ${P.context.viewport?.width ?? "?"} px wide`;
  });
  await stepOn(["desktop"], "a wide window only exists on a computer", V, "Regression", "On a 1440 px wide screen the app stays one tidy, centred column (no stretched screens)", async () => {
    await go(V, "/");
    const width = V.viewportSize()!.width;
    const box = (await V.locator("main").first().boundingBox())!;
    assert(box.width <= 460, `the page column is ${Math.round(box.width)} px wide on a ${width} px screen`);
    assert(Math.abs(box.x + box.width / 2 - width / 2) <= 3, `the column is off-centre (starts at ${Math.round(box.x)} px)`);
  });

  // ----- Steps that only make sense on one kind of device -----
  await stepOn(["android"], "the Contact Picker only exists in Chrome on Android; iPhones and computers type the names instead", null, "Sharing", "Android contact picker: “Pick from contacts” adds the chosen names to a collection (the phone's picker is stood in for)", async () => {
    const ctx = await browser.newContext({ ...P.context, locale: P.locale, timezoneId: P.timezoneId });
    try {
      await ctx.addCookies(await varun.ctx.cookies());
      // Plain text scripts: the test runner's compiler adds helper calls to functions that don't exist in the page.
      await ctx.addInitScript({
        content: `window.ContactsManager = class ContactsManager {};
Object.defineProperty(navigator, "contacts", { value: { select: async () => [{ name: ["Priya Contact"], tel: ["+91 98765 43210"] }] }, configurable: true });`,
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15_000);
      await go(page, "/collect/new");
      const names = page.locator('textarea[name="names"]');
      if (!(await names.isVisible())) await page.getByText("More options").click();
      await page.getByRole("button", { name: /Pick from contacts/ }).click();
      await page.getByText(/1 added/).waitFor();
      assert((await names.inputValue()).includes("Priya Contact"), `the names box says “${await names.inputValue()}”`);
    } finally {
      await ctx.close();
    }
  });
  await stepOn(["android"], "phones that buzz are Android phones; iPhones ignore vibration and computers have no motor", null, "Notifications", "Android buzz: tapping Add expense gives the light tap pattern (navigator.vibrate is stood in for and listened to)", async () => {
    const ctx = await browser.newContext({ ...P.context, locale: P.locale, timezoneId: P.timezoneId });
    try {
      await ctx.addCookies(await varun.ctx.cookies());
      await ctx.addInitScript({
        content: `Object.defineProperty(navigator, "vibrate", {
  value: function (pattern) {
    var seen = JSON.parse(localStorage.getItem("__buzz") || "[]");
    seen.push(pattern);
    localStorage.setItem("__buzz", JSON.stringify(seen));
    return true;
  },
  configurable: true,
});`,
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(15_000);
      await go(page, "/");
      await page.waitForTimeout(1000); // the buzz listener is attached when the page comes alive
      await page.locator('a[aria-label="Add expense"][data-haptic]').click(); // a real tap (the buzz only happens on one)
      await page.waitForURL((u) => u.pathname === "/add" || /\/groups\/[^/]+\/add$/.test(u.pathname));
      const seen = JSON.parse(await page.evaluate(() => localStorage.getItem("__buzz") || "[]")) as unknown[];
      assert(seen.length >= 1 && seen[0] === 8, `buzzes heard: ${JSON.stringify(seen)}`);
    } finally {
      await ctx.close();
    }
  });
  await stepOn(["iphone"], "the Add to Home Screen steps are for Safari on an iPhone; Android and computers are shown other steps", null, "Onboarding", "iPhone install hint: real Safari-engine on an iPhone 14 (not a pretend one) shows the “Add to Home Screen” steps from the invite link", async () => {
    const x = await person(browser);
    try {
      assert(/iPhone/.test(await x.page.evaluate(() => navigator.userAgent)), "this browser doesn't say it is an iPhone");
      await go(x.page, invite);
      await x.page.getByText("Get the Loopin app").waitFor();
      await x.page.getByRole("button", { name: "Get it" }).click();
      await x.page.getByText("Add to Home Screen").first().waitFor();
    } finally {
      await x.ctx.close();
    }
  });
  await stepOn(["iphone"], "only iPhones lack vibration while still being phones; the other profiles are checked by the Android buzz step", V, "Regression", "iPhone has no buzz: tapping Add expense still works and the page throws no errors", async () => {
    await go(V, "/");
    const has = await V.evaluate(() => typeof navigator.vibrate);
    const errors: string[] = [];
    const onError = (e: Error) => errors.push(String(e).slice(0, 160));
    V.on("pageerror", onError);
    try {
      await V.locator('a[aria-label="Add expense"][data-haptic]').click();
      await V.waitForURL((u) => u.pathname === "/add" || /\/groups\/[^/]+\/add$/.test(u.pathname));
      await V.waitForTimeout(500);
    } finally {
      V.off("pageerror", onError);
    }
    assert(errors.length === 0, `errors after the tap: ${errors.join(" | ")}`);
    return `navigator.vibrate is ${has}`;
  });

  // ===== MOMENTS (Part M1): a photo and a few words in a trip group; only that group sees them =====
  // Varun looks after "UAT Moments trip"; Asha and Ravi are in it; Zoe is a signed-in stranger to it; a fresh browser is signed out.
  // The group is set up straight in the database (the people are already signed in); every moment is added through the real screens.
  let momentsGroup = "";
  let momentOne = ""; // Varun's, Day 3
  let momentTwo = ""; // Asha's
  let momentPhotoTurn = 0;
  let momentThree = ""; // Asha's, added after Ravi left
  const momentPhotoUrl = (id: string, s: "t" | "f" = "f") => `${base}/api/moment-photo/${id}?s=${s}`;
  const addMomentThroughTheForm = async (who: Page, caption: string, dayLabel: string) => {
    await go(who, `${momentsGroup}/moments/new`);
    // A real place photo (the build's downloaded Thailand pictures), shrunk by the form like a phone would; never a hand-made file.
    const photos = realPhotos("thailand");
    await who.getByLabel("Choose a photo").setInputFiles(photos[momentPhotoTurn++ % photos.length]);
    await who.locator('img[alt="Your photo"]').waitFor();
    await who.getByPlaceholder("The boat we almost missed").fill(caption);
    if (dayLabel) await who.getByRole("button", { name: dayLabel, exact: true }).click();
    await who.getByRole("button", { name: "Add moment" }).click();
    await who.waitForURL(/\/moments$/);
  };
  // The screenshot run before this one adds many moments from this same machine, which uses up the
  // "60 moments an hour from one place" limit. Start the Moments steps with a fresh count (test copy only).
  await db.rateLimit.deleteMany({ where: { key: { startsWith: "moment" } } });
  await step(V, "Moments", "Varun adds a moment (a photo, “The boat we almost missed 😂”, Day 3): it shows in the group's strip and on Our moments", async () => {
    const acc = async (n: string) => (await db.account.findUniqueOrThrow({ where: { email: email(n) } })).id;
    const grp = await db.group.create({
      data: {
        name: "UAT Moments trip", currency: "INR", type: "trip", inviteCode: `mom-${Math.random().toString(36).slice(2, 8)}-${stamp}`, tripStart: "2026-11-10", tripEnd: "2026-11-14",
        members: {
          create: [
            { name: "Varun", accountId: await acc("varun"), claimedAt: new Date(), createdAt: new Date(Date.now() - 4000) },
            { name: "Asha", accountId: await acc("asha"), claimedAt: new Date(), createdAt: new Date(Date.now() - 3000) },
            { name: "Ravi", accountId: await acc("ravi"), claimedAt: new Date(), createdAt: new Date(Date.now() - 2000) },
          ],
        },
      },
    });
    momentsGroup = `/groups/${grp.id}`;
    await go(V, momentsGroup);
    assert((await V.locator("[data-moments-strip='empty']").count()) === 1, "no “Add the first moment” line on the empty group");
    await addMomentThroughTheForm(V, "The boat we almost missed 😂", "Day 3");
    momentOne = (await db.moment.findFirstOrThrow({ where: { groupId: grp.id, caption: "The boat we almost missed 😂" } })).id;
    const row = await db.moment.findUniqueOrThrow({ where: { id: momentOne } });
    assert(row.takenOn === "2026-11-12", `the day saved is ${row.takenOn}, not Day 3 (2026-11-12)`);
    // The closing emoji is glued to the word before it (a non-breaking space), so it never sits alone on a line: read that space as a plain one.
    const page = (await V.locator("main").innerText()).replace(/\u00a0/g, " ");
    assert(page.includes("The boat we almost missed 😂") && page.includes("Day 3"), "Our moments doesn't show the caption and Day 3");
    assert((await V.getByText("Saved with this trip").count()) === 1, "no “Saved with this trip”");
    assert((await assertMomentPhotosDecoded(V, "Our moments")) >= 1, "Our moments shows no moment photo");
    assert((await V.locator("[data-bottom-nav]").count()) === 0, "the tab bar shows on Our moments (the Add button is the one floating bar)");
    await go(V, momentsGroup);
    assert(/Our moments/.test(await V.locator("[data-moments-strip]").innerText()), "no strip on the group page");
    assert((await assertMomentPhotosDecoded(V, "the group's strip")) >= 1, "the strip shows no moment photo");
    const photo = await V.request.get(momentPhotoUrl(momentOne), { headers: bypass });
    assert(photo.status() === 200 && /private, no-cache/.test(photo.headers()["cache-control"] ?? "") && Boolean(photo.headers()["etag"]), `the photo answered ${photo.status()}`);
  });
  await step(A, "Moments", "Asha sees Varun's moment in Home's Memories strip (never in the story circles), adds her own moment, and reacts 😂 to Varun's: the count shows 1", async () => {
    await go(A, "/");
    // Moments are Memories only (founder, 15 Nov): a small polaroid in the strip under the story circles, named for its group; no story circle.
    await A.locator("[data-memories-row] [data-memory]").first().waitFor();
    assert((await A.locator("[data-story='moment']").count()) === 0, "a moment is in the story circles (moments are Memories only)");
    assert(/from UAT Mom/.test((await A.locator("[data-memories-row] [data-memory]").first().getAttribute("aria-label")) ?? ""), "the memory isn’t labelled with its group");
    // One fixed layout (the founder's 15 Nov mockup): the newest moment as one tilted polaroid with its caption, beside "Little moments, shared
    // together.". It never expands. Under it, "View <group> memories →" opens that group's Memories tab; "See all" (only with 2+ memories)
    // opens the Memories page.
    assert((await A.locator("[data-memories-collapsed] [data-memory-lead]").count()) === 1, "Memories doesn't show one polaroid in front");
    assert(/Little moments, shared together/.test(await A.locator("[data-memories-line]").innerText()), "Memories has no line beside the polaroid");
    assert((await A.locator("[data-memories-toggle], [data-memories-grid]").count()) === 0, "Memories still has the old expand toggle or grid");
    const groupLink = A.locator("[data-memories-group-link]");
    assert(/^View .+ memories →$/.test((await groupLink.innerText()).trim()), `the group link reads “${await groupLink.innerText()}”`);
    assert(/UAT Mom/.test(await groupLink.innerText()), "the group link doesn't name the group");
    assert(((await groupLink.boundingBox())?.height ?? 0) >= 44, "the group link is under 44px tall");
    await groupLink.click();
    await A.waitForURL(/\/groups\/[^/?]+\?tab=memories/);
    await A.locator("[data-memories]").waitFor();
    await go(A, "/");
    // "See all" only when there is more than the one memory shown; it opens /memories with All groups lit.
    if ((await db.moment.count({ where: { groupId: momentsGroup.split("/").pop()! } })) > 1) {
      await A.locator("[data-memories-see-all]").click();
      await A.waitForURL(/\/memories$/);
      await A.locator("[data-memories-card]").first().waitFor();
      assert((await A.locator("[data-memories-filter='all'][aria-current='true']").count()) === 1, "All groups isn't lit on the Memories page");
      assert(/UAT Mom/.test(await A.locator("[data-memories-card] [data-memory-group]").first().innerText()), "a Memories card doesn't name its group");
      await go(A, "/");
    } else {
      assert((await A.locator("[data-memories-see-all]").count()) === 0, "See all shows with only one memory");
    }
    await addMomentThroughTheForm(A, "Worth the early alarm.", "");
    momentTwo = (await db.moment.findFirstOrThrow({ where: { groupId: momentsGroup.split("/").pop()!, caption: "Worth the early alarm." } })).id;
    // Now Asha has two memories: Home's "See all" shows and opens the Memories page (All groups lit, newest first: her new one leads).
    await go(A, "/");
    await A.locator("[data-memories-see-all]").click();
    await A.waitForURL(/\/memories$/);
    await A.locator("[data-memories-card]").first().waitFor();
    assert((await A.locator("[data-memories-filter='all'][aria-current='true']").count()) === 1, "All groups isn't lit on the Memories page");
    assert(/Worth the early alarm/.test(await A.locator("[data-memories-card] [data-memory-caption]").first().innerText()), "the Memories page doesn't lead with the newest moment");
    await go(A, `${momentsGroup}/moments/${momentOne}`);
    await A.locator("[data-reactions] summary[aria-label='React']").click();
    await A.getByRole("button", { name: "React 😂", exact: true }).click();
    await A.waitForURL(new RegExp(`/moments/${momentOne}$`));
    const chip = A.locator(`[data-reactions='${momentOne}'] button[aria-pressed='true']`);
    await chip.waitFor();
    assert(/😂\s*1/.test(await chip.innerText()), `the reaction chip reads “${await chip.innerText()}”, not “😂 1”`);
    assert((await assertMomentPhotosDecoded(A, "the big moment")) >= 1, "the big moment shows no photo");
  });
  await step(R, "Moments", "Ravi reports Varun's moment (and sees the thank-you), then blocks Varun: it disappears from his list, his Memories strip, and its photo address answers 404", async () => {
    await go(R, `${momentsGroup}/moments/${momentOne}`);
    await R.locator("[data-moment-menu] summary").click();
    await R.getByRole("link", { name: "Report this moment", exact: true }).click();
    assert((await R.locator("input[name=reason]:checked").count()) === 0, "a reason is already picked on the moment report");
    await R.getByLabel("Spam").check();
    await R.getByRole("button", { name: "Send report" }).click();
    await R.locator("[data-report-done]").waitFor();
    assert((await db.report.count({ where: { kind: "moment", targetId: momentOne } })) === 1, "the moment report wasn't saved");
    await R.getByRole("button", { name: /Block Varun/ }).click();
    await R.waitForURL(/blocked=1/);
    await go(R, `${momentsGroup}/moments`);
    assert((await R.getByText("The boat we almost missed").count()) === 0, "a blocked person's moment is still in the list");
    await go(R, "/");
    assert((await R.locator("[data-story='moment']").count()) === 0, "a moment is in the story circles (moments are Memories only)");
    assert((await R.locator(`[data-memory='${momentOne}']`).count()) === 0, "a blocked person's moment is still in Home's Memories");
    const photo = await R.request.get(momentPhotoUrl(momentOne), { headers: bypass });
    assert(photo.status() === 404, `a blocked person's photo answered ${photo.status()}, not 404`);
    const mine = await R.request.get(momentPhotoUrl(momentTwo), { headers: bypass });
    assert(mine.status() === 200, `Asha's photo answered ${mine.status()} for Ravi (not blocked), not 200`);
  });
  await step(Z, "Moments", "A signed-in outsider and a signed-out browser both get 404 on the photo address and on the page", async () => {
    assert((await Z.request.get(momentPhotoUrl(momentTwo), { headers: bypass })).status() === 404, "an outsider could open the photo");
    const stranger = await Z.goto(base + `${momentsGroup}/moments`);
    assert(stranger?.status() === 404, `an outsider's Our moments answered ${stranger?.status()}`);
    const anon = await person(browser);
    try {
      for (const s of ["f", "t"] as const) assert((await anon.page.request.get(momentPhotoUrl(momentTwo, s), { headers: bypass })).status() === 404, `a signed-out browser could open the ${s} photo`);
      const r = await anon.page.goto(base + `${momentsGroup}/moments`);
      assert(r?.status() === 404, `a signed-out Our moments answered ${r?.status()}`);
    } finally {
      await anon.ctx.close();
    }
  });
  await step(R, "Moments", "Ravi leaves: he still sees older moments with no Add button; Asha's new moment is hidden from him and its address answers 404", async () => {
    // (Leaving itself is covered by the left-view steps; here it is set directly so the step is about moments.)
    await db.member.updateMany({ where: { groupId: momentsGroup.split("/").pop()!, name: "Ravi" }, data: { leftAt: new Date() } });
    await new Promise((r) => setTimeout(r, 1200)); // a moment added now is after he left
    await addMomentThroughTheForm(A, "After Ravi left", "");
    momentThree = (await db.moment.findFirstOrThrow({ where: { groupId: momentsGroup.split("/").pop()!, caption: "After Ravi left" } })).id;
    await go(R, `${momentsGroup}/moments`);
    const text = await R.locator("main").innerText();
    assert(text.includes("Worth the early alarm."), "someone who left no longer sees a moment from before they left");
    assert(!text.includes("After Ravi left"), "someone who left sees a moment added after they left");
    assert((await R.getByRole("link", { name: "Add your moment" }).count()) === 0, "someone who left is offered “Add your moment”");
    const late = await R.request.get(momentPhotoUrl(momentThree), { headers: bypass });
    assert(late.status() === 404, `a moment added after they left answered ${late.status()}, not 404`);
    const early = await R.request.get(momentPhotoUrl(momentTwo), { headers: bypass });
    assert(early.status() === 200, `a moment from before they left answered ${early.status()}, not 200`);
  });
  await step(V, "Moments", "Varun, who looks after the group, removes Asha's moment; Asha deletes her own: each photo is gone for everyone", async () => {
    await go(V, `${momentsGroup}/moments/${momentTwo}`);
    await V.locator("[data-moment-menu] summary").click();
    await V.getByRole("button", { name: "Remove this moment" }).click();
    await V.waitForURL(/removed=1/);
    assert((await db.moment.count({ where: { id: momentTwo } })) === 0, "the admin's remove didn't delete the moment");
    await go(A, `${momentsGroup}/moments/${momentThree}`);
    await A.locator("[data-moment-menu] summary").click();
    await A.getByRole("button", { name: "Delete this moment" }).click();
    await A.waitForURL(/removed=1/);
    assert((await db.moment.count({ where: { id: momentThree } })) === 0, "the author's delete didn't delete the moment");
    for (const id of [momentTwo, momentThree]) assert((await A.request.get(momentPhotoUrl(id), { headers: bypass })).status() === 404, "a deleted moment's photo still opens");
  });

  await browser.close();
  writeReports();
}

// ---------- reports: report.md, summary.txt, coverage.md, coverage.json ----------
// Every step belongs to one area, so a reviewer can see what is covered and what is thin.
const COVER = ["Money", "Onboarding", "Permissions", "Imports", "Sharing", "Notifications", "Privacy", "Regression"] as const;
type Cover = (typeof COVER)[number];
function coverOf(area: string, name: string): Cover {
  if ((COVER as readonly string[]).includes(area)) return area as Cover; // the steps added for Exercise A name their area directly
  switch (area) {
    case "Start": case "Start screen": case "Help": case "Get the app": case "Sign in":
      return "Onboarding";
    case "Joining":
      return /^Only Varun/.test(name) ? "Permissions" : /invit|link|QR|unsubscribe/i.test(name) ? "Sharing" : "Onboarding";
    case "Add people":
      return /neutral|same reply|no account revealed/i.test(name) ? "Privacy" : "Sharing";
    case "Add": case "Edit": case "Currency": case "Why?": case "Across groups": case "Couples": case "Payments":
      return /tidy|opens More by itself/i.test(name) ? "Regression" : "Money";
    case "Settle":
      return /Remind|WhatsApp/i.test(name) ? "Sharing" : "Money";
    case "Collect":
      return /Alerts|bell|reminds/i.test(name) ? "Notifications" : /can't change|forged/i.test(name) ? "Permissions" : /opens the link/i.test(name) ? "Sharing" : "Money";
    case "Flat":
      return /Reminders switch/i.test(name) ? "Notifications" : "Money";
    case "Group settings":
      return /currency|markup/i.test(name) ? "Money" : /notification/i.test(name) ? "Notifications" : "Regression";
    case "People":
      return /remove|leave|owing|left/i.test(name) ? "Permissions" : "Regression";
    case "Alerts":
      return "Notifications";
    case "Export": case "Switching":
      return "Imports";
    case "Trips": case "Postcards":
      return "Sharing";
    case "Fun":
      return /passport|Wrapped|Share/i.test(name) ? "Sharing" : "Regression";
    case "Account":
      return /Delete|Download all my data|privacy/i.test(name) ? "Privacy" : "Onboarding";
    case "Privacy":
    case "Moments":
      return "Privacy";
    default:
      return "Regression";
  }
}

function writeReports() {
  const count = (st: Status) => results.filter((r) => r.status === st).length;
  const passed = count("pass");
  const failed = count("fail");
  const na = count("na");
  const notRunCount = count("skip");
  const mark = (st: Status) => (st === "pass" ? "✅" : st === "fail" ? "❌" : st === "skip" ? "⏭️" : "➖");
  const head = `${passed} passed, ${failed} failed, ${na} not applicable${notRunCount ? `, ${notRunCount} NOT RUN` : ""} · profile: ${PROFILE} (${P.label})`;
  const lines = [
    `# UAT report`,
    ``,
    `Profile: **${PROFILE}**: ${P.label}`,
    ``,
    `${passed} passed · ${failed} failed · ${na} not applicable · ${notRunCount} not run · ${results.length} steps`,
    ``,
    `| | Area | What a person did | Notes |`,
    `|---|---|---|---|`,
    ...results.map((r) => `| ${mark(r.status)} | ${r.area} | ${r.name} | ${r.detail.replace(/\|/g, "/")} |`),
  ];
  if (pageCrashes.length) lines.push(``, `## Page crashes (${pageCrashes.length})`, ``, ...[...new Set(pageCrashes)].map((c) => `- ${c}`));
  writeFileSync(`${out}/report.md`, lines.join("\n"));
  // The first line is read by the CI workflows; failures follow, one per line, starting with ✗.
  writeFileSync(`${out}/summary.txt`, `${head}\n${results.filter((r) => r.status === "fail").map((r) => `✗ ${r.area} — ${r.name}: ${r.detail}`).concat(results.filter((r) => r.status === "skip").map((r) => `○ ${r.area} — ${r.name}: ${r.detail}`)).join("\n")}`);
  console.log(`\nUAT (${PROFILE}): ${passed} passed, ${failed} failed, ${na} not applicable, ${notRunCount} not run`);

  // Coverage: every step mapped to an area.
  const steps = results.map((r) => ({
    n: r.n, area: r.area, coverage: coverOf(r.area, r.name), name: r.name, status: r.status,
    runsOn: r.only ?? ALL_PROFILES, detail: r.detail,
  }));
  const areas = Object.fromEntries(
    COVER.map((a) => {
      const mine = steps.filter((x) => x.coverage === a);
      return [a, { steps: mine.length, passed: mine.filter((x) => x.status === "pass").length, failed: mine.filter((x) => x.status === "fail").length, notApplicable: mine.filter((x) => x.status === "na").length, notRun: mine.filter((x) => x.status === "skip").length }];
    }),
  );
  const thin = COVER.filter((a) => areas[a].steps < 5);
  writeFileSync(
    `${out}/coverage.json`,
    JSON.stringify({ profile: PROFILE, label: P.label, totals: { steps: results.length, passed, failed, notApplicable: na, notRun: notRunCount }, areas, thinAreas: thin, steps }, null, 2),
  );
  const md = [
    `# UAT coverage: ${PROFILE}`,
    ``,
    `${P.label}`,
    ``,
    `${results.length} steps: ${passed} passed, ${failed} failed, ${na} not applicable, ${notRunCount} not run.`,
    ``,
    `| Area | Steps | Passed | Failed | Not applicable | Not run |`,
    `|---|---|---|---|---|---|`,
    ...COVER.map((a) => `| ${a} | ${areas[a].steps} | ${areas[a].passed} | ${areas[a].failed} | ${areas[a].notApplicable} | ${areas[a].notRun} |`),
    ``,
    thin.length ? `Areas with fewer than 5 steps: ${thin.map((a) => `${a} (${areas[a].steps})`).join(", ")}.` : `Every area has at least 5 steps.`,
    ``,
    ...COVER.flatMap((a) => [
      `## ${a}`,
      ``,
      ...(steps.filter((x) => x.coverage === a).length
        ? steps.filter((x) => x.coverage === a).map((x) => `- ${mark(x.status)} ${x.n}. ${x.name}${x.runsOn.length < ALL_PROFILES.length ? ` _(only on ${x.runsOn.join(", ")})_` : ""}`)
        : ["- (no steps)"]),
      ``,
    ]),
  ];
  writeFileSync(`${out}/coverage.md`, md.join("\n"));
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  try {
    writeReports(); // what was done before the crash is still reported
  } catch {
    /* nothing to report yet */
  }
  const done = results.filter((r) => r.status === "pass").length;
  const bad = results.filter((r) => r.status === "fail");
  writeFileSync(`${out}/summary.txt`, `crashed: ${String(e)} · profile: ${PROFILE} · ${done} passed, ${bad.length} failed before it stopped\n${bad.map((r) => `✗ ${r.area} — ${r.name}: ${r.detail}`).join("\n")}`);
  process.exit(0);
});
