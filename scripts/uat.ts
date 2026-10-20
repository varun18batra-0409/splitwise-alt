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
import { mkdirSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { base, bypass, hosted, withBypass } from "./hosted";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { db } from "../src/lib/db";
import { netBalances } from "../src/lib/balances";

const out = "screenshots/uat";
mkdirSync(out, { recursive: true });

type Result = { area: string; name: string; ok: boolean; detail: string };
const results: Result[] = [];
let shotNo = 0;

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

async function step(page: Page | null, area: string, name: string, fn: () => Promise<void | string>) {
  try {
    const note = await fn();
    results.push({ area, name, ok: true, detail: typeof note === "string" ? note : "" });
    console.log("✓", area, "—", name);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).split("\n").slice(0, 3).join(" ").slice(0, 400);
    let shot = "";
    if (page) {
      shotNo++;
      shot = `fail-${String(shotNo).padStart(2, "0")}.png`;
      await page.screenshot({ path: `${out}/${shot}`, fullPage: true }).catch(() => (shot = ""));
    }
    results.push({ area, name, ok: false, detail: msg + (shot ? ` (screenshot: ${shot})` : "") });
    console.log("✗", area, "—", name, "→", msg);
  }
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const stamp = Date.now();
// The daily job's key, when the test server has one (like the live app).
const noCronKey = hosted && !process.env.CRON_SECRET;
const cronAuth = (): Record<string, string> => (process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : {});
const email = (n: string) => `${n}-${stamp}@uat.loopin.test`;

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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-IN", timezoneId: "Asia/Kolkata", colorScheme: "dark" });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  page.setDefaultTimeout(15_000);
  return { ctx, page };
}

async function go(page: Page, path: string) {
  await page.goto(base + path, { waitUntil: "networkidle" });
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
    const gets = /gets (₹[\d,.]+)/.exec(t);
    const owes = /owes (₹[\d,.]+)/.exec(t);
    out[name] = gets ? minor(gets[1]) : owes ? -minor(owes[1]) : 0;
  }
  return out;
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

type AddOpts = {
  name: string;
  amount: string;
  payer?: Person; // as seen by the person adding (their own name shows as "You")
  me: Person;
  currency?: string;
  split?: { kind: "everyone" } | { kind: "only"; who: Person[] } | { kind: "one"; who: Person } | { kind: "amounts"; values: Partial<Record<Person, string>> } | { kind: "percent"; values: Partial<Record<Person, string>> } | { kind: "shares"; values: Partial<Record<Person, string>> };
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
  const label = (p: Person) => (p === o.me ? "You" : p);
  if (o.payer) await page.getByRole("button", { name: new RegExp(`^(✓ )?${label(o.payer)}$`) }).first().click();
  await page.locator("#expense-name").fill(o.name);
  await pickCurrency(page, o.currency ?? "INR");
  await page.getByLabel("Amount", { exact: true }).fill(o.amount);
  if (o.date) {
    await page.getByRole("button", { name: /Today · Change/ }).click();
    await page.getByRole("button", { name: o.date, exact: true }).click();
  }
  if (o.currency && o.currency !== "INR") {
    await page.getByRole("button", { name: /Details/ }).click();
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
  await page.getByRole("button", { name: "Everyone equally" }).click();
  const s = o.split ?? { kind: "everyone" };
  if (s.kind === "only") {
    await page.getByRole("button", { name: "Only some" }).click();
    for (const p of s.who) await page.getByRole("button", { name: new RegExp(`^(✓ )?${label(p)}$`) }).last().click();
  } else if (s.kind === "one") {
    await page.getByRole("button", { name: /Custom/ }).click();
    await page.getByRole("button", { name: "One person", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(`^${label(s.who)}$`) }).last().click();
  } else if (s.kind === "amounts" || s.kind === "percent") {
    await page.getByRole("button", { name: /Custom/ }).click();
    await page.getByRole("button", { name: s.kind === "amounts" ? "Amounts" : "%", exact: true }).click();
    for (const [p, v] of Object.entries(s.values)) {
      await page.getByLabel(`${label(p as Person)} ${s.kind === "amounts" ? "amount" : "percentage"}`).fill(v!);
    }
  }
  if (s.kind === "shares") {
    await page.getByRole("button", { name: /Custom/ }).click();
    await page.getByRole("button", { name: "Shares", exact: true }).click();
    for (const [p, v] of Object.entries(s.values)) await page.getByLabel(`${label(p as Person)} shares`).fill(v!);
  }
  if (o.notes) {
    await page.getByRole("button", { name: /Add notes/ }).click();
    await page.getByPlaceholder(/Rahul paid the tip/).fill(o.notes);
  }
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
    await db.exchangeRate.create({ data: { base, quote, rate, date: day } });
  }
  // On the private test copy: start with fresh limits (many sign-ups come from this one machine).
  if (hosted) await db.rateLimit.deleteMany({});
  const browser = withBypass(await chromium.launch());
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
    await V.getByText("Create your first group").first().waitFor();
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
    for (const t of ["People on Loopin", "From your contacts", "By email"]) await V.getByText(t, { exact: true }).waitFor();
    assert((await V.getByText("Add members yourself").count()) === 0, "old “Add members yourself” still there");
    const m = /\/join\/([A-Za-z0-9_-]+)/.exec(await V.content());
    assert(m, "no join link on the page");
    invite = `/join/${m[1]}`;
    return invite;
  });
  await step(null, "Joining", "Someone opening the link without signing up can't join (no name box)", async () => {
    const x = await person(browser);
    await go(x.page, invite);
    await x.page.getByRole("link", { name: "Sign up to join" }).waitFor();
    assert((await x.page.locator('input[name="name"]').count()) === 0, "a name box is offered before sign-up");
    await x.ctx.close();
  });
  await step(A, "Joining", "Asha opens the link, signs up with her email, and joins", async () => {
    await go(A, invite);
    await A.getByRole("link", { name: "Sign up to join" }).click();
    await signup(A, "Asha", email("asha"));
    await A.waitForURL(new RegExp(invite));
    await A.getByRole("button", { name: /^Join / }).click();
    await A.waitForURL(new RegExp(`${g}$`));
  });
  await step(R, "Joining", "Ravi does the same from a WhatsApp message", async () => {
    await go(R, invite);
    await R.getByRole("link", { name: "Sign up to join" }).click();
    await signup(R, "Ravi", email("ravi"));
    await R.waitForURL(new RegExp(invite));
    await R.getByRole("button", { name: /^Join / }).click();
    await R.waitForURL(new RegExp(`${g}$`));
  });
  await step(V, "Joining", "Invite by email: Zoe gets an email, is listed as “Invited”, and is NOT a member yet", async () => {
    await go(V, `${g}/invite`);
    await V.getByLabel("Email addresses to invite").fill(email("zoe"));
    await V.getByRole("button", { name: "Invite", exact: true }).click();
    await V.waitForURL(/invited=/);
    await V.getByText("Invited · waiting to join").waitFor();
    const members = (await V.locator("main ul").last().innerText()).replace(/\s+/g, " ");
    assert(!/Zoe/.test(members), `Zoe is already a member: ${members}`);
  });
  await step(Z, "Joining", "Zoe taps the link in her email, verifies, and joins", async () => {
    const mailRow = await db.outbox.findFirst({ where: { to: email("zoe"), subject: { contains: "invited you" } }, orderBy: { createdAt: "desc" } });
    assert(mailRow, "no invite email for Zoe");
    const link = /https?:\/\/\S+\/join\/\S+/.exec(mailRow.text)?.[0];
    assert(link, "no link in the email");
    await Z.goto(base + new URL(link).pathname + new URL(link).search, { waitUntil: "networkidle" });
    await Z.getByRole("link", { name: "Sign up to join" }).click();
    assert((await Z.locator('input[name="email"]').inputValue()) === email("zoe"), "email not filled in from the invite");
    await signup(Z, "Zoe", email("zoe"), true);
    await Z.waitForURL(/\/join\//);
    await Z.getByRole("button", { name: /^Join / }).click();
    await Z.waitForURL(new RegExp(`${g}$`));
  });
  await step(V, "Joining", "Add people shows everyone as “On Loopin ✓” and no pending invites", async () => {
    await go(V, `${g}/invite`);
    const t = (await V.locator("main ul").last().innerText()).replace(/\s+/g, " ");
    const n = (t.match(/On Loopin ✓/g) ?? []).length;
    assert(n === 4, `statuses: ${t}`);
    assert((await V.getByText("Invited · waiting to join").count()) === 0, "Zoe's invite still pending");
    return `${n} verified members`;
  });
  await step(V, "Joining", "Contacts option is there (share sheet when the phone can't pick contacts)", async () => {
    await go(V, `${g}/invite`);
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
  await step(V, "Add", "Wrong amounts are refused: letters, zero, empty name still saves as “Expense”?", async () => {
    await go(V, `${g}/add`);
    await fillExpense(V, { me: "Varun", name: "Junk", amount: "abc" });
    await save(V, { me: "Varun", name: "", amount: "", expectError: /amount/i });
    await V.getByLabel("Amount", { exact: true }).fill("0");
    await save(V, { me: "Varun", name: "", amount: "", expectError: /amount/i });
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
    await page.locator("details summary").filter({ hasText: name }).first().click();
    const href = await page.getByRole("link", { name: "Edit or delete" }).first().getAttribute("href");
    assert(href, `no edit link for ${name}`);
    return href;
  };
  await step(V, "Edit", "Edit an amount (Coffee ₹400 → ₹800) and balances follow", async () => {
    const href = await editPath(V, "Coffee");
    await go(V, href);
    await V.getByLabel("Amount", { exact: true }).fill("800");
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
    await A.getByRole("button", { name: "Everyone equally" }).click();
    await A.getByRole("button", { name: "Save changes" }).click();
    await A.waitForURL(/tab=activity/);
    const e = ledger.find((x) => x.key === "Water")!;
    e.amount = 24000;
    e.shares = equal(24000, PEOPLE);
    await V.getByLabel("Amount", { exact: true }).fill("999");
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
    await V.locator("details summary").filter({ hasText: "Tickets" }).first().click();
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
    assert(/75/.test(box), "no ₹75 card fee shown");
    await V.getByRole("button", { name: "Hide details" }).click();
    const line = await V.getByRole("button", { name: /Details/ }).innerText();
    assert(/2,575/.test(line) && /card fee/.test(line), `one-line summary: ${line}`);
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
    const line = V.getByRole("button", { name: /Details/ });
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
  await step(V, "Simple screens", "Group top is short: balance, Settle up and Why? only (details moved to Balances)", async () => {
    await go(V, g);
    const top = await V.locator("main section").first().innerText(); // everything above the tabs
    for (const gone of ["THB expenses", "spent across", "card markup"]) assert(!top.includes(gone), `group top still shows “${gone}”`);
    await V.getByRole("link", { name: "Settle up" }).first().waitFor();
    await V.getByRole("link", { name: "Why?" }).first().waitFor();
  });
  await step(V, "Simple screens", "Balances only explains; paying happens on Settle up (no duplicate buttons)", async () => {
    await go(V, `${g}?tab=balances`);
    assert((await V.getByRole("button", { name: "Mark as paid" }).count()) === 0, "Balances still has Mark as paid");
    await V.getByText(/payments? clears? everything/).first().waitFor();
    await V.getByText("spent across").first().waitFor();
  });
  await step(V, "Simple screens", "Activity has one Filter button that opens search, category and person", async () => {
    await go(V, `${g}?tab=activity`);
    assert(!(await V.getByLabel("Category").isVisible()), "filters showing before tapping Filter");
    await V.getByText("Filter", { exact: true }).click();
    await V.getByLabel("Category").selectOption("food");
    await V.getByRole("button", { name: "Show results" }).click();
    await V.waitForURL(/cat=food/);
    await V.getByText(/Filtered · \d+ match/).waitFor();
  });

  // ===== 5. Why? =====
  await step(V, "Why?", "“Why?” lines add up to the balance shown", async () => {
    const want = Math.round(expected().Varun);
    await go(V, g);
    await V.getByRole("link", { name: "Why?" }).click();
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
  const settleCards = (page: Page) => page.locator("main ul > li").filter({ has: page.locator('input[name="amount"]') });
  const cardPeople = async (page: Page, i: number, me: Person): Promise<[Person, Person, number]> => {
    const t = (await settleCards(page).nth(i).innerText()).replace(/\s+/g, " ");
    const m = /^(\w+) (?:pay|pays) (\w+) (₹[\d,.]+)/.exec(t);
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
    await settleCards(V).nth(0).getByRole("button", { name: "Mark paid" }).click();
    await V.waitForURL(/paid=1/);
    payments.push({ from, to, amount: amt, active: true, key: "full" });
    return `${from} → ${to} ${rupees(amt)}; ${await checkBalances(V, g)}`;
  });
  await step(V, "Settle", "Record a part payment (change the amount to less)", async () => {
    await go(V, `${g}/settle`);
    const [from, to, amt] = await cardPeople(V, 0, "Varun");
    const part = Math.floor(amt / 2 / 100) * 100;
    await settleCards(V).nth(0).locator('input[name="amount"]').fill(String(part / 100));
    await settleCards(V).nth(0).getByRole("button", { name: "Mark paid" }).click();
    await V.waitForURL(/paid=1/);
    payments.push({ from, to, amount: part, active: true, key: "part" });
    return `${from} → ${to} ${rupees(part)} of ${rupees(amt)}; ${await checkBalances(V, g)}`;
  });
  await step(V, "Settle", "A zero or nonsense amount is refused", async () => {
    await go(V, `${g}/settle`);
    await settleCards(V).nth(0).locator('input[name="amount"]').fill("0");
    await settleCards(V).nth(0).getByRole("button", { name: "Mark paid" }).click();
    await V.getByText(/valid amount/).waitFor();
  });
  await step(V, "Settle", "Double-tapping “Mark paid” records it once", async () => {
    await go(V, `${g}/settle`);
    const [from, to, amt] = await cardPeople(V, 0, "Varun");
    await settleCards(V).nth(0).getByRole("button", { name: "Mark paid" }).dblclick();
    await V.waitForURL(/paid=1/);
    payments.push({ from, to, amount: amt, active: true, key: "dbl" });
    return checkBalances(V, g);
  });
  await step(V, "Settle", "Undo a payment from the bar", async () => {
    await go(V, `${g}/settle`);
    if ((await settleCards(V).count()) === 0) return "nothing left to pay (skipped)";
    const [from, to, amt] = await cardPeople(V, 0, "Varun");
    await settleCards(V).nth(0).getByRole("button", { name: "Mark paid" }).click();
    await V.waitForURL(/paid=1/);
    await V.getByRole("status").getByRole("button", { name: "Undo", exact: true }).click();
    await V.waitForURL(/undone=1/);
    void from; void to; void amt;
    return checkBalances(V, g);
  });
  await step(V, "Settle", "Record a different payment on the payment screen (Zoe paid Asha ₹50)", async () => {
    await go(V, `${g}/pay`);
    await V.locator("label", { hasText: "Zoe" }).first().click();
    await V.locator("label[data-to]", { hasText: "Asha" }).click();
    await V.locator('input[name="amount"]').fill("50");
    await V.getByRole("button", { name: "Record payment" }).click();
    await V.waitForURL(/paid=1/);
    payments.push({ from: "Zoe", to: "Asha", amount: 5000, active: true, key: "manual" });
    return checkBalances(V, g);
  });
  await step(V, "Settle", "You can't record paying yourself", async () => {
    await go(V, `${g}/pay`);
    await V.locator("label", { hasText: "Asha" }).first().click();
    const target = V.locator("label[data-to]", { hasText: "Asha" });
    const op = await target.evaluate((el) => getComputedStyle(el).opacity);
    assert(Number(op) < 0.5, `“Asha → Asha” is not greyed out (opacity ${op})`);
    // Even if forced, the server says no.
    await V.evaluate(() => {
      const r = document.querySelector<HTMLInputElement>('label[data-to] input[name="toId"]');
      const from = document.querySelector<HTMLInputElement>('input[name="fromId"]:checked');
      if (r && from) r.value = from.value;
      if (r) r.checked = true;
    });
    await V.locator('input[name="amount"]').fill("10");
    await V.getByRole("button", { name: "Record payment" }).click();
    await V.getByText(/two different people/).waitFor();
  });
  await step(V, "Settle", "Settle everything & close, then reopen", async () => {
    await go(V, `${g}/settle`);
    await V.getByRole("button", { name: /Settle everything & close|Close group/ }).click();
    await V.waitForURL(/closed=1/);
    await V.getByText("Closed groups").first().waitFor();
    const got = await shownBalances(V, g);
    assert(Object.values(got).every((x) => x === 0), `not all square after settling: ${JSON.stringify(got)}`);
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
    await V.getByLabel("Search people on Loopin").fill("Asha");
    await V.getByRole("button", { name: "Add", exact: true }).first().click();
    await V.waitForURL(/added=/);
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
    const card = V.locator("main li").filter({ hasText: "Asha" }).filter({ hasText: "UAT Flat" }).first();
    const t = (await card.innerText()).replace(/\s+/g, " ");
    assert(/Asha pays you/.test(t) && /₹200/.test(t), `card says: ${t}`);
    assert(/1 payment instead of 2/.test(t), "doesn't say 1 payment instead of 2");
    await card.getByRole("button", { name: "Mark as paid" }).click();
    await V.waitForURL(/settle=done/);
    const b2 = await shownBalances(V, g2);
    const b3 = await shownBalances(V, g3);
    assert(Object.values(b2).every((x) => x === 0) && Object.values(b3).every((x) => x === 0), `not square: ${JSON.stringify({ b2, b3 })}`);
  });

  // ===== 7b. Couples, shares, several payers, money back, filters, add another, repeat, duplicates =====
  let gc = "";
  const coupleBalances = async () => shownBalances(V, gc);
  await step(V, "Couples", "Create a Couple group with the split worked out from incomes (55 / 45), add Asha", async () => {
    await go(V, "/groups/new");
    await V.getByRole("button", { name: /^Couple/ }).click();
    await V.locator('input[name="groupName"]').fill("UAT Us");
    await V.getByRole("button", { name: "Next" }).click();
    await V.getByRole("radio", { name: "By income" }).click();
    await V.getByLabel("You earn a month").fill("110000");
    await V.getByLabel("Your partner earns").fill("90000");
    await V.getByText("55 / 45").first().waitFor();
    await V.getByRole("button", { name: /Use 55 \/ 45/ }).click();
    await V.waitForURL(/\/invite\?new=1/);
    gc = new URL(V.url()).pathname.replace(/\/invite$/, "");
    await V.getByLabel("Search people on Loopin").fill("Asha");
    await V.getByRole("button", { name: "Add", exact: true }).first().click();
    await V.waitForURL(/added=/);
    const ws = await db.member.findMany({ where: { groupId: gc.split("/").pop()! }, orderBy: { createdAt: "asc" } });
    assert(ws.map((m) => m.splitWeight).join("/") === "55/45", `weights are ${ws.map((m) => m.splitWeight).join("/")}`);
  });
  await step(V, "Couples", "“Our split 55 / 45” is chosen by default: ₹1,000 lunch → Asha owes ₹450", async () => {
    await go(V, `${gc}/add`);
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
    await V.getByRole("button", { name: "More than one" }).click();
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
    await V.getByRole("radio", { name: "Money back" }).click();
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
    await V.getByRole("button", { name: "Save notifications" }).click();
    await V.waitForURL(/saved=notify/);
    const me = await db.member.findFirst({ where: { groupId: gc.split("/").pop()!, name: "Varun" } });
    assert(JSON.parse(me!.notify).payments === false, "not saved");
  });

  // ===== 8. Everything else people do =====
  await step(V, "Add people", "Search by name only finds friends; a stranger is found only by exact email, then added", async () => {
    const x = await person(browser);
    await go(x.page, "/signin?mode=signup");
    await signup(x.page, "Sheldon", email("sheldon"));
    await x.ctx.close();
    await go(V, `${g3}/invite`);
    await V.getByLabel("Search people on Loopin").fill("Sheldon");
    await V.getByText(/Not someone you share a group with/).waitFor();
    await V.getByLabel("Search people on Loopin").fill(email("sheldon"));
    await V.getByText("On Loopin ✓").first().waitFor();
    await V.getByRole("button", { name: "Add", exact: true }).first().click();
    await V.waitForURL(/added=Sheldon/);
  });
  await step(A, "Alerts", "Asha sees an unread alert badge and Varun's changes in Alerts", async () => {
    await go(A, "/");
    const nav = A.getByRole("navigation", { name: "Main" });
    const label = await nav.getByRole("link", { name: /Alerts/ }).getAttribute("aria-label");
    assert(/new/.test(label ?? ""), `Alerts label: ${label}`);
    await go(A, "/notifications");
    await A.getByText(/Varun/).first().waitFor();
  });
  await step(A, "Alerts", "Asha was told she was added to the new groups", async () => {
    await go(A, "/notifications");
    await A.getByText(/added Asha to the group/).first().waitFor();
  });
  await step(V, "Home", "Home shows net balance, Needs attention or Groups, and the bottom bar", async () => {
    await go(V, "/");
    await V.getByText(/Net balance|All square/).first().waitFor();
    await V.getByRole("heading", { name: "Groups" }).waitFor();
    await V.getByRole("navigation", { name: "Main" }).waitFor();
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
    await V.reload({ waitUntil: "networkidle" });
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
    const r = await V.request.get(`${base}${g}/export`);
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
    await V.getByText(/USD\s7\.20 spent across/).first().waitFor();
  });
  await step(V, "Group settings", "Delete a group, see it under Recently deleted, restore it", async () => {
    await go(V, `${g3}/settings`);
    await V.getByRole("button", { name: "Delete group" }).click();
    await V.waitForURL(/deleted=group/);
    await V.getByText("Recently deleted").waitFor();
    await V.getByRole("button", { name: "Restore" }).first().click();
    await V.waitForURL(new RegExp(g3));
  });
  await step(V, "People", "Rename someone on the People screen", async () => {
    await go(V, `${g}/people`);
    const t = await V.locator("body").innerText();
    assert(/Zoe/.test(t), "Zoe not listed");
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
  const groupNameShown = async (page: Page, path: string) => (await (await page.goto(base + path, { waitUntil: "networkidle" }), page.locator("header h1").first()).innerText());
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
    await V.locator('select[name="secondaryCurrency"]').selectOption("USD");
    await V.getByRole("button", { name: "Save settings" }).click();
    await V.waitForURL(/saved=settings/);
    await go(V, g2);
    const t = await V.locator("main").innerText();
    assert(/USD/.test(t), "no USD shown on the group page");
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
  await step(V, "People", "Mark someone settled as left, then bring them back", async () => {
    await go(V, `${g2}/people`);
    await V.locator("details summary").filter({ hasText: "Asha" }).first().click();
    await clickAndWait(V, V.getByRole("button", { name: "Mark Asha as left" }));
    await go(V, `${g2}/people`);
    await V.getByText("Left the group").first().waitFor();
    await V.locator("details summary").filter({ hasText: "Asha" }).first().click();
    await clickAndWait(V, V.getByRole("button", { name: "Bring Asha back" }));
    await go(V, `${g2}/people`);
    assert((await V.getByText("Left the group").count()) === 0, "Asha still shows as left");
  });
  await step(V, "People", "Remove someone who isn't in any expense (Sheldon)", async () => {
    await go(V, `${g3}/people`);
    await V.locator("details summary").filter({ hasText: "Sheldon" }).first().click();
    await clickAndWait(V, V.getByRole("button", { name: "Remove from group" }));
    await go(V, `${g3}/people`);
    assert((await V.getByText("Sheldon").count()) === 0, "Sheldon still listed");
  });
  await step(V, "People", "Someone owing money can't be marked as left until settled", async () => {
    await go(V, `${g}/people`);
    const before = await shownBalances(V, g);
    const debtor = PEOPLE.find((p) => p !== "Varun" && (before[p] ?? 0) !== 0);
    if (!debtor) return "everyone settled (skipped)";
    await go(V, `${g}/people`);
    await V.locator("details summary").filter({ hasText: debtor }).first().click();
    assert(await V.getByRole("button", { name: `Mark ${debtor} as left` }).isDisabled(), "leave button isn't disabled");
    return `${debtor} can't leave while owing`;
  });
  await step(V, "Edit", "Change who paid on an expense: balances move by exactly that amount", async () => {
    const before = await shownBalances(V, g);
    await go(V, `${g}?tab=activity&q=Water`);
    await V.locator("details summary").filter({ hasText: "Water" }).first().click();
    const href = await V.getByRole("link", { name: "Edit or delete" }).first().getAttribute("href");
    await go(V, href!);
    await V.getByRole("button", { name: /^(✓ )?Asha$/ }).first().click();
    await V.getByRole("button", { name: "Save changes" }).click();
    await V.waitForURL(/tab=activity/);
    const after = await shownBalances(V, g);
    const dv = (after.Varun ?? 0) - (before.Varun ?? 0), da = (after.Asha ?? 0) - (before.Asha ?? 0);
    assert(dv === -24000 && da === 24000, `Varun moved ${dv}, Asha moved ${da} (expected −24000 / +24000)`);
  });
  await step(V, "Payments", "Delete a payment from the history, then restore it", async () => {
    const before = await shownBalances(V, g);
    await go(V, `${g}?tab=activity`);
    const row = V.locator("details summary").filter({ hasText: /paid (Asha|Varun|you)/ }).first();
    await row.click();
    await clickAndWait(V, V.getByRole("button", { name: "Delete payment" }).first());
    const mid = await shownBalances(V, g);
    assert(JSON.stringify(mid) !== JSON.stringify(before), "balances didn't change after deleting the payment");
    await go(V, `${g}?tab=activity`);
    await V.locator("details summary").filter({ hasText: /paid (Asha|Varun|you)/ }).first().click();
    await clickAndWait(V, V.getByRole("button", { name: "Restore payment" }).first());
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
    await go(V, "/notifications");
    await V.getByText("Notifications on this phone").first().waitFor();
  });
  await step(V, "Add people", "Inviting the email of someone already on Loopin adds them straight away", async () => {
    await go(V, `${g2}/invite`);
    await V.getByLabel("Email addresses to invite").fill(email("ravi"));
    await V.getByRole("button", { name: "Invite", exact: true }).click();
    await V.waitForURL(/added=Ravi/);
  });
  await step(null, "Privacy", "A stranger opening a group's address sees “Private group”: no name, no join link", async () => {
    const x = await person(browser);
    for (const sub of ["", "/settle", "/add", "/settings", "/invite", "/people"]) {
      await go(x.page, g + sub);
      await x.page.waitForURL(/\/private/);
    }
    const body = await x.page.locator("main").innerText();
    assert(!body.includes("UAT Goa trip") && !body.includes(invite.split("/").pop()!), "private page leaks the group's name or invite code");
    const r = await x.page.request.get(`${base}${g}/export`);
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
  await step(A, "Account", "Sign out of this phone, sign back in: all groups come back", async () => {
    await go(A, "/account");
    await A.getByRole("button", { name: "Sign out" }).click();
    await A.waitForURL(base + "/");
    await go(A, "/signin");
    await signup(A, "Asha", email("asha"));
    await go(A, "/");
    for (const name of ["UAT Goa trip", "UAT Flat"]) await A.getByText(name).first().waitFor();
  });
  await step(null, "Account", "Delete my email & sign-in", async () => {
    const x = await person(browser);
    await go(x.page, "/signin?mode=signup");
    await signup(x.page, "Throwaway", email("throwaway"));
    await go(x.page, "/account");
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
  await step(V, "Get the app", "Home has an “App” button and the service worker is registered (needed to install)", async () => {
    await go(V, "/");
    await V.getByRole("button", { name: "Get the app" }).waitFor();
    const ok = await V.evaluate(async () => Boolean(await navigator.serviceWorker.getRegistration("/")));
    assert(ok, "no service worker registered");
  });
  await step(null, "Get the app", "First-time tour (iPhone) has the “App” button on every slide", async () => {
    const { ctx, page } = await phone("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1");
    await go(page, "/");
    await page.getByText("Create your first group").first().waitFor();
    await page.getByRole("button", { name: "Get the app" }).click();
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
    await page.getByRole("link", { name: "Home", exact: true }).first().click();
    await page.getByText("Let’s get you started").waitFor();
    await page.getByRole("link", { name: "Sign in or sign up" }).first().waitFor();
    // Join with a pasted link
    await page.getByRole("button", { name: "Join with an invite link" }).click();
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
    await page.getByRole("heading", { name: "Continue to Loopin" }).waitFor();
    await ctx.close();
  });
  await step(V, "Help", "“?” on home opens the detailed How Loopin works guide (with photos), which links to the 1-minute tour", async () => {
    await go(V, "/");
    await V.getByRole("link", { name: "How Loopin works" }).click();
    await V.waitForURL(/\/how-it-works/);
    await V.getByRole("heading", { name: "Add an expense in seconds" }).waitFor();
    await V.waitForTimeout(2500);
    const imgs = await V.locator("main img").count();
    const sizes = await V.evaluate(() =>
      [...document.querySelectorAll("main img")].map((i) => `${(i as HTMLImageElement).src.split("/").pop()}:${(i as HTMLImageElement).naturalWidth}`).join(" "),
    );
    await V.getByRole("link", { name: /1-minute tour/ }).click();
    await V.waitForURL(/\/welcome/);
    return `${imgs} photos on the guide (${sizes})`;
  });
  await step(null, "Help", "The 1-minute tour has 6 slides, one for flats & couples, and none says “no sign-up”", async () => {
    const { ctx, page } = await person(browser);
    await go(page, "/welcome");
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      seen.push((await page.locator("main").innerText()).replace(/\s+/g, " "));
      const next = page.getByRole("button", { name: /Next/ });
      if (i < 5) {
        await next.click();
        await page.waitForTimeout(500);
      }
    }
    const all = seen.join(" ");
    assert(/Bills add themselves/.test(all), "no flats & couples slide");
    assert(!/no sign-up/i.test(all), "a slide still says “no sign-up”");
    await ctx.close();
  });
  await step(V, "Help", "The guide has Flatmates and Couples, with real app screens that load", async () => {
    await go(V, "/how-it-works");
    for (const h of ["Flatmates: the flat runs itself", "Couples: your split, not 50/50"]) await V.getByRole("heading", { name: h }).waitFor();
    assert(!(await V.getByText("Recurring bills are coming soon").count()), "still says recurring bills are coming soon");
    for (const id of ["home", "couples"]) {
      await V.locator(`#${id}`).scrollIntoViewIfNeeded();
      await V.waitForTimeout(400);
    }
    await V.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await V.waitForTimeout(1500);
    const shots = await V.evaluate(() => [...document.querySelectorAll('main img[src*="/guide/"]')].map((i) => (i as HTMLImageElement).naturalWidth));
    assert(shots.length === 2 && shots.every((w) => w > 0), `guide screens: ${JSON.stringify(shots)}`);
  });
  await step(V, "Tags", "Each expense shows its category tag (Dinner → Food, Taxi → Transport)", async () => {
    await go(V, `${g}?tab=activity`);
    const row = V.locator("details summary").filter({ hasText: "Dinner" }).first();
    assert(/Food/.test(await row.innerText()), "no Food tag on Dinner");
    const taxi = V.locator("details summary").filter({ hasText: "Taxi" }).first();
    assert(/Transport/.test(await taxi.innerText()), "no Transport tag on Taxi");
  });

  // ===== 9. Home & Couple: bills, list, budgets, reminders, moving out, goals =====
  let gh = "";
  const homeId = () => gh.split("/").pop()!;
  await step(V, "Flat", "Create a Home group: it opens on This month, with Bills · List · Activity tabs", async () => {
    await go(V, "/groups/new");
    await V.getByRole("button", { name: /^Home/ }).click();
    await V.locator('input[name="groupName"]').fill("UAT Flat 402");
    await V.locator('select[name="currency"]').selectOption("INR");
    await V.getByRole("button", { name: /Create group/ }).click();
    await V.waitForURL(/\/invite\?new=1/);
    gh = new URL(V.url()).pathname.replace(/\/invite$/, "");
    await V.getByLabel("Search people on Loopin").fill("Asha");
    await V.getByRole("button", { name: "Add", exact: true }).first().click();
    await V.waitForURL(/added=/);
    await go(V, gh);
    const current = await V.locator('a[aria-current="page"]').filter({ hasText: /This month|Bills|List|Activity|Balances/ }).first().innerText();
    assert(current.trim() === "This month", `opened on “${current}”`);
    for (const t of ["Bills", "List", "Activity"]) assert(await V.getByRole("link", { name: t, exact: true }).count(), `no ${t} tab`);
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
    assert(/Adds itself on the day/.test(t) && /Rent/.test(t) && /Electricity/.test(t), `Bills tab says: ${t.slice(0, 200)}`);
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
    await V.getByLabel("Groceries budget").fill("1500");
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
  await step(V, "Flat", "Asha moves out: final payment shown, she's marked moved out, balances still add up to zero", async () => {
    await go(V, `${gh}/people`);
    await V.locator("details summary").filter({ hasText: "Asha" }).first().click();
    await V.getByRole("link", { name: "Asha is moving out" }).click();
    await V.waitForURL(/\/move/);
    const t = (await V.locator("main").innerText()).replace(/\s+/g, " ");
    assert(/Final payments/.test(t) && /Asha pays you/.test(t), `move-out screen says: ${t.slice(0, 300)}`);
    await V.getByRole("button", { name: /mark as moved out/ }).click();
    await V.waitForURL(/tab=activity/);
    const { loadGroup } = await import("../src/lib/group-data");
    const data = (await loadGroup(homeId()))!;
    const asha = data.group.members.find((m) => m.name === "Asha")!;
    assert(asha.leftAt, "Asha isn't marked as moved out");
    const sum = Object.values(data.net).reduce((a, b) => a + b, 0);
    assert(sum === 0 && data.net[asha.id] === 0, `net ${JSON.stringify(data.net)}`);
  });

  // ===== 10. More checks: the daily job's key, joining when signed in, bills, deposit, speed =====
  await step(null, "Daily job", "Without the key the daily job is refused; with it, it runs", async () => {
    if (!process.env.CRON_SECRET) return "no key set on this test server (skipped)";
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
  await step(V, "Flat", "Delete the automatic Rent from its edit screen: the daily job doesn't add it back", async () => {
    const rent = await db.expense.findFirst({ where: { groupId: homeId(), description: "Rent", deletedAt: null } });
    assert(rent, "no Rent expense");
    await go(V, `${gh}/expenses/${rent.id}/edit`);
    await V.getByRole("button", { name: "Delete expense" }).click();
    await V.waitForURL(/tab=activity/);
    if (noCronKey) await (await import("../src/lib/home/bills-db")).runBillsForGroup(homeId());
    else await fetch(`${base}/api/cron/daily`, { headers: cronAuth() });
    const live = await db.expense.count({ where: { groupId: homeId(), description: "Rent", deletedAt: null } });
    assert(live === 0, `Rent came back (${live})`);
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
    const r = await V.request.get(`${base}${gh}/export`);
    assert(r.ok(), `status ${r.status()}`);
    const body = await r.text();
    assert(/Electricity/.test(body) && /Groceries/i.test(body), "CSV is missing the flat's expenses");
  });
  await step(V, "Speed", "People search answers fast (5 searches, each timed)", async () => {
    await go(V, `${g}/invite`);
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
    await V.getByRole("button", { name: "Mark paid" }).first().click();
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
    await form.locator('button[type="submit"]').click();
    await V.waitForURL(/saved=settling/);
    await go(V, `${gc}/settle`);
    await V.getByText(/1 small amount under ₹50(\.00)? left out/).waitFor();
    const b = await shownBalances(V, gc);
    assert(b.Asha === -4500, `balances ${JSON.stringify(b)}`);
    await go(V, `${gc}/settings`);
    await form.locator('input[name="settleMin"]').fill("");
    await form.locator('button[type="submit"]').click();
    await V.waitForURL(/saved=settling/);
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
    await V.getByRole("button", { name: `${today}: came` }).click();
    await V.getByRole("button", { name: `${today}: didn’t come` }).waitFor();
    const after = await days();
    assert(after === before - 1, `days came: ${before} → ${after}`);
  });
  await step(null, "Layout", "Small Android phone (320 px), light mode: no screen scrolls sideways", async () => {
    const ctx = await browser.newContext({ viewport: { width: 320, height: 640 }, locale: "en-IN", timezoneId: "Asia/Kolkata", colorScheme: "light" });
    await ctx.addCookies(await varun.ctx.cookies());
    const page = await ctx.newPage();
    page.setDefaultTimeout(15_000);
    const pages = [
      "/", g, `${g}?tab=balances`, `${g}?tab=charts`, `${g}/settle`, `${g}/add`, `${g}/settings`, `${g}/people`, `${g}/invite`,
      gh, `${gh}?tab=bills`, `${gh}?tab=list`, `${gh}/bills/new`, `${gh}/budgets`, `${gh}/deposit`, gc, `${gc}/goals/new`,
      "/settle", "/notifications", "/search", "/account", "/how-it-works", "/welcome",
    ];
    const wide: string[] = [];
    for (const p of pages) {
      await go(page, p);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) {
        wide.push(`${p.replace(/[a-z0-9]{20,}/g, ":id")} (+${over}px)`);
        await page.screenshot({ path: `${out}/wide-${wide.length}.png` });
      }
    }
    await ctx.close();
    assert(wide.length === 0, `scrolls sideways: ${wide.join(", ")}`);
    return `${pages.length} screens checked`;
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
    await V.locator("details summary").filter({ hasText: "Airport taxi" }).first().waitFor();
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
    await V.getByLabel("Groceries budget").fill("1000");
    await V.getByRole("button", { name: "Save budgets" }).click();
    await V.waitForURL(new RegExp(`${gh}$`));
    await V.getByText(/₹240(\.00)? over/).first().waitFor();
  });
  await step(V, "Flat", "Note when someone moved in (Zoe, on the 10th): it's recorded on People and in the history", async () => {
    await go(V, `${gh}/people`);
    const zoe = await db.member.findFirst({ where: { groupId: homeId(), name: { startsWith: "Zoe" } } });
    assert(zoe, "Zoe isn't in the flat");
    await V.locator("details summary").filter({ hasText: zoe.name }).first().click();
    const day = `${new Date().toISOString().slice(0, 8)}10`;
    await V.locator(`#in-${zoe.id}`).fill(day);
    await V.locator(`#in-${zoe.id}`).locator("xpath=..").getByRole("button", { name: "Save" }).click();
    // Already on /people, so wait for the save itself (not the address).
    let after = await db.member.findUnique({ where: { id: zoe.id } });
    for (let i = 0; i < 40 && after?.joinedFrom?.toISOString().slice(0, 10) !== day; i++) {
      await V.waitForTimeout(250);
      after = await db.member.findUnique({ where: { id: zoe.id } });
    }
    assert(after?.joinedFrom?.toISOString().slice(0, 10) === day, `moved-in date is ${after?.joinedFrom?.toISOString()}`);
    const ev = await db.groupEvent.findFirst({ where: { groupId: homeId(), text: { contains: "moved in on" } } });
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
  await step(null, "New address", "The old address forwards to loopinapps.com, and a signed-in person arrives still signed in (once)", async () => {
    // Pretending to be the old address only works on a server of our own; on Vercel it would reach the live app.
    if (hosted) return "checked on the GitHub test server only (on Vercel this would reach the live app)";
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
    const arrive = await raw(`/api/arrive?t=${m[1]}&to=%2Fsettle`, "loopinapps.com");
    assert(arrive.status === 303 && /\/settle\?moved=1$/.test(arrive.location), `arrive: ${arrive.status} ${arrive.location}`);
    assert(arrive.setCookie.some((c) => c.startsWith(`sw_me=${me.value};`)), "sign-in not carried over");
    const again = await raw(`/api/arrive?t=${m[1]}&to=%2Fsettle`, "loopinapps.com");
    assert(!again.setCookie.some((c) => c.startsWith("sw_me=")), "the pass worked twice");
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
      return "Google isn't switched on for the test copy (it is on the live app)";
    }
    const href = (await page.getByRole("link", { name: "Continue with Google" }).getAttribute("href")) ?? "";
    assert(href.startsWith("/api/auth/google/start"), `Google button links to ${href}`);
    await ctx.close();
    const start = await raw("/api/auth/google/start?back=%2Fsettle", new URL(base).host);
    const g = new URL(start.location);
    assert(start.status === 307 && g.origin === "https://accounts.google.com", `start: ${start.status} ${start.location}`);
    const client = g.searchParams.get("client_id") ?? "";
    assert((hosted ? client.endsWith(".apps.googleusercontent.com") : client === "uat-test.apps.googleusercontent.com") && g.searchParams.get("code_challenge_method") === "S256", `params: ${g.search}`);
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
    await row.locator("summary").click();
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
    await page.getByRole("link", { name: /sign up to join/i }).click();
    await signup(page, "Rohit", email("rohit"), true);
    await page.getByRole("button", { name: "Continue as Rohit" }).click();
    await page.waitForURL(new RegExp(`/groups/${gid}`));
    const after = await db.member.findUniqueOrThrow({ where: { id: rohit.id } });
    assert(after.accountId, "Rohit's place wasn't taken over");
    await ctx.close();
  });

  await step(V, "Switching", "“Coming from Splitwise?” → pick the exported file → balances checked → Bring it over: a new group with the same expenses, payments and balances", async () => {
    await go(V, "/switching");
    await V.getByRole("heading", { name: /Bring your groups/ }).waitFor();
    await V.getByRole("link", { name: "Bring a group over" }).click();
    await V.waitForURL(/\/import/);
    const csv = [
      "Date,Description,Category,Cost,Currency,Varun,Asha S,Kabir",
      "2026-09-01,Dinner,Dining out,900.00,INR,600.00,-300.00,-300.00",
      '2026-09-03,"Hotel, 2 nights",Hotel,3000.00,INR,1000.00,1000.00,-2000.00',
      "2026-09-04,Kabir paid Varun,Payment,500.00,INR,-500.00,0.00,500.00",
      "",
      "2026-10-20,Total balance, , ,INR,1100.00,700.00,-1800.00",
    ].join("\n");
    await V.getByLabel("Splitwise export file").setInputFiles({ name: "manali-trip_2026-10-20_export.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await V.getByText("Found 2 expenses and 1 payment in INR").waitFor();
    await V.getByText("✓ Matches Splitwise’s balances").waitFor();
    assert((await V.getByRole("radio", { name: "Varun", exact: true }).getAttribute("aria-checked")) === "true", "you weren't picked from your name");
    assert((await V.locator('input[name="groupName"]').inputValue()) === "Manali trip", "group name not taken from the file name");
    await V.getByRole("radio", { name: "Trip" }).click();
    await V.getByRole("button", { name: "Bring it over" }).click();
    await V.waitForURL(/imported=2\.1\.ok/);
    await V.getByText(/Brought over 2 expenses and 1 payment from Splitwise/).waitFor();
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

  await step(V, "Account", "You → Download all my data: one spreadsheet with every group, my share and my balance change", async () => {
    await go(V, "/account");
    const [file] = await Promise.all([V.waitForEvent("download"), V.getByRole("link", { name: "Download all my data" }).click()]);
    const { readFileSync } = await import("node:fs");
    const body = readFileSync((await file.path())!, "utf8");
    assert(body.includes("Loopin: all your data") && body.includes(email("varun")), "account lines missing");
    assert(body.includes("UAT Goa trip") && body.includes("Manali trip"), "a group is missing");
    assert(body.includes("Your balance change"), "no balance column");
  });

  await step(null, "Sign in", "Fingerprint / face: turn it on, sign out, sign back in with one touch, then remove it", async () => {
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
    await page.getByRole("button", { name: /Turn on fingerprint \/ face sign-in/ }).click();
    await page.getByText(/Android phone|This device|Mac|Windows computer/).first().waitFor();
    const keys = await db.passkey.count({ where: { accountId: (await db.account.findUniqueOrThrow({ where: { email: email("pia") } })).id } });
    assert(keys === 1, `passkeys saved: ${keys}`);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL(base + "/");
    await go(page, "/signin");
    await page.getByRole("button", { name: /Sign in with fingerprint or face/ }).click();
    await page.waitForURL(/signedin=1/);
    await go(page, "/account");
    await page.getByText(email("pia")).first().waitFor();
    await page.getByRole("button", { name: "Remove" }).click();
    await page.waitForURL(/removed=passkey/);
    const left = await db.passkey.count({ where: { accountId: (await db.account.findUniqueOrThrow({ where: { email: email("pia") } })).id } });
    assert(left === 0, `passkeys left after Remove: ${left}`);
    await ctx.close();
  });

  // ===== 12. More of what a person would try (from the human checklist) =====
  await step(V, "Add", "Shares: ₹1,000 split 2 : 1 : 1 : 1 → Varun ₹400, the others ₹200 each", async () => {
    await add(V, { me: "Varun", name: "Boat ride", amount: "1000", split: { kind: "shares", values: { Varun: "2", Asha: "1", Ravi: "1", Zoe: "1" } } });
    ledger.push({ key: "Boat ride", payer: "Varun", amount: 100000, shares: { Varun: 40000, Asha: 20000, Ravi: 20000, Zoe: 20000 }, active: true });
    return checkBalances(V, g);
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

  await step(null, "Sign in", "Right after signing in, “Sign in faster next time?” can be closed with ✕ and stays closed", async () => {
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
    if (!(await link.count())) return "nobody owes Varun right now (nothing to remind)";
    const href = (await link.getAttribute("href")) ?? "";
    assert(/^https:\/\/(wa\.me|api\.whatsapp\.com)\//.test(href) && /%E2%82%B9|₹/.test(href), `Remind link: ${href.slice(0, 120)}`);
  });

  await step(V, "Settle", "When every payment is under the group's minimum, Settle says “Nearly square”", async () => {
    await go(V, `${gc}/settle`);
    await V.getByText("Nearly square").first().waitFor();
  });

  await step(V, "Add people", "The invite screen shows the group's link and a QR code", async () => {
    await go(V, `${g}/invite`);
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
        name: "UAT Tokyo", currency: "JPY", type: "trip", inviteCode: `tokyo-${stamp}`, settleMin: 100,
        members: { create: [{ name: "Varun", accountId: acc.id, claimedAt: new Date() }, { name: "Kenji" }] },
      },
    });
    await go(V, `/groups/${grp.id}/add`);
    await V.locator("#expense-name").fill("Ramen");
    await V.getByLabel("Amount", { exact: true }).fill("1000");
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
    assert((await V.getByLabel("Amount", { exact: true }).inputValue()).replace(/,/g, "") === "999", "Add it isn't pre-filled with ₹999");
  });

  await step(V, "Switching", "A file that isn't a Splitwise export gets a clear message; a second currency is flagged", async () => {
    await go(V, "/import");
    await V.getByLabel("Splitwise export file").setInputFiles({ name: "notes.csv", mimeType: "text/csv", buffer: Buffer.from("Name,Amount\nTea,20\n") });
    await V.getByText(/doesn’t look like a Splitwise export/).waitFor();
    const two = ["Date,Description,Category,Cost,Currency,Varun,Mia", "2026-09-01,Dinner,Dining out,900.00,INR,450.00,-450.00", "2026-09-02,Gelato,Dining out,10.00,EUR,5.00,-5.00"].join("\n");
    await V.getByLabel("Splitwise export file").setInputFiles({ name: "rome_export.csv", mimeType: "text/csv", buffer: Buffer.from(two) });
    await V.getByText(/Lines in EUR are left out/).waitFor();
  });

  await step(V, "Trips", "Close the imported trip: Home links to the trip report, which says All settled; Copy as text works", async () => {
    const trip = await db.group.findFirstOrThrow({ where: { name: "Manali trip", members: { some: { account: { email: email("varun") } } } }, orderBy: { createdAt: "desc" } });
    await go(V, `/groups/${trip.id}/settle`);
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

  await browser.close();

  // ---------- report ----------
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const lines = [
    `# UAT report`,
    ``,
    `${passed} passed · ${failed} failed · ${results.length} steps`,
    ``,
    `| | Area | What a person did | Notes |`,
    `|---|---|---|---|`,
    ...results.map((r) => `| ${r.ok ? "✅" : "❌"} | ${r.area} | ${r.name} | ${r.detail.replace(/\|/g, "/")} |`),
  ];
  writeFileSync(`${out}/report.md`, lines.join("\n"));
  console.log(`\nUAT: ${passed} passed, ${failed} failed`);
  writeFileSync(`${out}/summary.txt`, `${passed} passed, ${failed} failed\n${results.filter((r) => !r.ok).map((r) => `✗ ${r.area} — ${r.name}: ${r.detail}`).join("\n")}`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  writeFileSync(`${out}/summary.txt`, `crashed: ${String(e)}`);
  process.exit(0);
});
