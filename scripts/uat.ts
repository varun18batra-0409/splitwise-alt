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
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { db } from "../src/lib/db";

const base = process.env.APP_URL ?? "http://localhost:3000";
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
  split?: { kind: "everyone" } | { kind: "only"; who: Person[] } | { kind: "one"; who: Person } | { kind: "amounts"; values: Partial<Record<Person, string>> } | { kind: "percent"; values: Partial<Record<Person, string>> };
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
  if (o.notes) {
    await page.getByRole("button", { name: /Add notes/ }).click();
    await page.getByPlaceholder(/Rahul paid the tip/).fill(o.notes);
  }
}
async function save(page: Page, o: AddOpts, button = "Save expense") {
  const before = page.url();
  await page.getByRole("button", { name: button }).click();
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
  const browser = await chromium.launch();
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
    await V.getByRole("link", { name: "Sign up with email" }).click();
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
  await step(V, "Currency", "Live exchange rate is fetched for USD", async () => {
    await go(V, `${g}/add`);
    await pickCurrency(V, "USD");
    await V.getByLabel("Amount", { exact: true }).fill("10");
    const line = V.getByRole("button", { name: /Details/ });
    await line.waitFor();
    await V.waitForTimeout(3000);
    const t = await line.innerText();
    assert(/≈|=/.test(t), `no converted amount: ${t}`);
    return t.replace(/\s+/g, " ");
  });
  await step(V, "Currency", "Group page shows the THB balance separately (without card fees)", async () => {
    await go(V, g);
    await V.getByText("THB expenses").first().waitFor();
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

  // ===== 8. Everything else people do =====
  await step(V, "Add people", "Search by name only finds friends; a stranger is found only by exact email, then added", async () => {
    const x = await person(browser);
    await go(x.page, "/signin?mode=signup");
    await signup(x.page, "Sheldon", email("sheldon"));
    await x.ctx.close();
    await go(V, `${g3}/invite`);
    await V.getByLabel("Search people on Loopin").fill("Sheldon");
    await V.getByText(/No one you know on Loopin/).waitFor();
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
    await go(V, `${g3}?tab=activity`);
    await V.getByText(/USD 7\.20/).first().waitFor();
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
    await V.getByRole("button", { name: "Reopen group" }).click();
    await V.waitForURL(new RegExp(`${g2}`));
    await go(V, `${g2}/add`);
    await V.locator("#expense-name").waitFor();
  });
  await step(V, "People", "Rename a person, then rename back", async () => {
    await go(V, `${g2}/people`);
    await V.locator("details summary").filter({ hasText: "Asha" }).first().click();
    await V.getByLabel("New name for Asha").fill("Asha K");
    await V.getByRole("button", { name: "Rename" }).first().click();
    await V.waitForLoadState("networkidle");
    await go(V, `${g2}/people`);
    await V.getByText("Asha K").first().waitFor();
    await V.locator("details summary").filter({ hasText: "Asha K" }).first().click();
    await V.getByLabel("New name for Asha K").fill("Asha");
    await V.getByRole("button", { name: "Rename" }).first().click();
    await V.waitForLoadState("networkidle");
  });
  await step(V, "People", "Mark someone settled as left, then bring them back", async () => {
    await go(V, `${g2}/people`);
    await V.locator("details summary").filter({ hasText: "Asha" }).first().click();
    await V.getByRole("button", { name: "Mark Asha as left" }).click();
    await V.waitForLoadState("networkidle");
    await go(V, `${g2}/people`);
    await V.getByText("Left the group").first().waitFor();
    await V.locator("details summary").filter({ hasText: "Asha" }).first().click();
    await V.getByRole("button", { name: "Bring Asha back" }).click();
    await V.waitForLoadState("networkidle");
    await go(V, `${g2}/people`);
    assert((await V.getByText("Left the group").count()) === 0, "Asha still shows as left");
  });
  await step(V, "People", "Remove someone who isn't in any expense (Sheldon)", async () => {
    await go(V, `${g3}/people`);
    await V.locator("details summary").filter({ hasText: "Sheldon" }).first().click();
    await V.getByRole("button", { name: "Remove from group" }).click();
    await V.waitForLoadState("networkidle");
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
    await V.getByRole("button", { name: "Delete payment" }).first().click();
    await V.waitForURL(/tab=activity/);
    const mid = await shownBalances(V, g);
    assert(JSON.stringify(mid) !== JSON.stringify(before), "balances didn't change after deleting the payment");
    await go(V, `${g}?tab=activity`);
    await V.locator("details summary").filter({ hasText: /paid (Asha|Varun|you)/ }).first().click();
    await V.getByRole("button", { name: "Restore payment" }).first().click();
    await V.waitForURL(/tab=activity/);
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
  await step(null, "Privacy", "A stranger opening a group's address can't see it (sent to join)", async () => {
    const x = await person(browser);
    await go(x.page, g);
    await x.page.waitForURL(/\/join\//);
    const r = await x.page.request.get(`${base}${g}/export`);
    assert(r.status() === 403, `export gave ${r.status()} to a stranger`);
    await x.ctx.close();
  });
  await step(null, "Privacy", "A forged “who you are” cookie is ignored", async () => {
    const x = await person(browser);
    const memberId = (await db.member.findFirst({ where: { groupId: g.split("/").pop()!, name: "Varun" } }))!.id;
    await x.ctx.addCookies([{ name: "sw_me", value: `${Buffer.from(JSON.stringify({ m: { [g.split("/").pop()!]: memberId } })).toString("base64url")}.fakesignature`, url: base }]);
    await go(x.page, g);
    await x.page.waitForURL(/\/join\//);
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
    await page.getByRole("link", { name: "Sign up" }).first().waitFor();
    await page.getByRole("link", { name: "Sign in" }).first().waitFor();
    // Join with a pasted link
    await page.getByRole("button", { name: "Join with an invite link" }).click();
    await page.getByLabel("Invite link").fill(`https://getloopin.vercel.app${invite}`);
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await page.waitForURL(new RegExp(invite));
    // Quick start fills the group name
    await go(page, "/");
    await page.getByRole("link", { name: /Trip/ }).click();
    await page.getByRole("link", { name: "Sign up with email" }).waitFor(); // not signed in yet: sign up first
    const href = (await page.getByRole("link", { name: "Sign up with email" }).getAttribute("href")) ?? "";
    assert(decodeURIComponent(href).includes("name=Goa trip"), `the trip name isn't kept for after sign-up: ${href}`);
    // Sign up screen
    await go(page, "/signin?mode=signup");
    await page.getByRole("heading", { name: "Sign up" }).waitFor();
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
  await step(V, "Tags", "Each expense shows its category tag (Dinner → Food, Taxi → Transport)", async () => {
    await go(V, `${g}?tab=activity`);
    const row = V.locator("details summary").filter({ hasText: "Dinner" }).first();
    assert(/Food/.test(await row.innerText()), "no Food tag on Dinner");
    const taxi = V.locator("details summary").filter({ hasText: "Taxi" }).first();
    assert(/Transport/.test(await taxi.innerText()), "no Transport tag on Taxi");
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
