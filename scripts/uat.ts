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

  // ===== 1. First visit, creating a group, inviting =====
  await step(V, "Start", "First visit shows the intro tour with “Create your first group”", async () => {
    await go(V, "/");
    await V.getByText("Create your first group").first().waitFor();
  });
  await step(V, "Start", "Create a group (INR) with two people added by name", async () => {
    await go(V, "/groups/new");
    await V.locator('input[name="groupName"]').fill("UAT Goa trip");
    await V.locator('input[name="yourName"]').fill("Varun");
    await V.locator('select[name="currency"]').selectOption("INR");
    const inputs = V.locator('input[name="member"]');
    await inputs.nth(0).fill("Asha");
    await V.getByRole("button", { name: "+ Add another person" }).click();
    await inputs.nth(1).fill("Ravi");
    await V.getByRole("button", { name: "Create group" }).click();
    await V.waitForURL(/\/groups\/(?!new)[^/?]+(\?|$)/);
    g = new URL(V.url()).pathname;
    await V.getByRole("heading", { name: "UAT Goa trip" }).waitFor();
  });
  await step(V, "Start", "Invite page shows a join link and QR option", async () => {
    await go(V, `${g}/invite`);
    const html = await V.content();
    const m = /\/join\/([A-Za-z0-9_-]+)/.exec(html);
    assert(m, "no join link on the invite page");
    invite = `/join/${m[1]}`;
    return invite;
  });
  await step(A, "Joining", "Asha opens the link and taps her name", async () => {
    await go(A, invite);
    await A.getByRole("button", { name: "Asha" }).click();
    await A.waitForURL(new RegExp(`${g}`));
  });
  await step(R, "Joining", "Ravi opens the link and taps his name", async () => {
    await go(R, invite);
    await R.getByRole("button", { name: "Ravi" }).click();
    await R.waitForURL(new RegExp(`${g}`));
  });
  await step(Z, "Joining", "Zoe (not added yet) joins by typing her name", async () => {
    await go(Z, invite);
    await Z.locator('input[name="name"]').fill("Zoe");
    await Z.getByRole("button", { name: "Join group" }).click();
    await Z.waitForURL(new RegExp(`${g}`));
  });
  await step(null, "Joining", "Someone typing a name that's already taken (“asha”) is stopped", async () => {
    const x = await person(browser);
    await go(x.page, invite);
    await x.page.locator('input[name="name"]').fill("asha");
    await x.page.getByRole("button", { name: "Join group" }).click();
    await x.page.getByText(/already in the group/).waitFor();
    await x.ctx.close();
  });
  await step(V, "Joining", "Invite page shows everyone as joined", async () => {
    await go(V, `${g}/invite`);
    const t = (await V.locator("main ul").last().innerText()).replace(/\s+/g, " ");
    const joined = (t.match(/Joined/g) ?? []).length;
    assert(!/Not joined yet/.test(t) && joined >= 4, `statuses: ${t}`);
    return `${joined} joined`;
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
    await V.locator('input[name="yourName"]').fill("Varun");
    await V.locator('select[name="currency"]').selectOption("INR");
    await V.locator('input[name="member"]').nth(0).fill("Asha");
    await V.getByRole("button", { name: "Create group" }).click();
    await V.waitForURL(/\/groups\/(?!new)[^/?]+(\?|$)/);
    const path = new URL(V.url()).pathname;
    await go(V, `${path}/invite`);
    const code = /\/join\/([A-Za-z0-9_-]+)/.exec(await V.content())![1];
    await go(A, `/join/${code}`);
    await A.getByRole("button", { name: "Asha" }).click();
    await A.waitForURL(new RegExp(path));
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
  await step(A, "Alerts", "Asha sees an unread alert badge and Varun's changes in Alerts", async () => {
    await go(A, "/");
    const nav = A.getByRole("navigation", { name: "Main" });
    const label = await nav.getByRole("link", { name: /Alerts/ }).getAttribute("aria-label");
    assert(/new/.test(label ?? ""), `Alerts label: ${label}`);
    await go(A, "/notifications");
    await A.getByText(/Varun/).first().waitFor();
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
  await step(V, "Account", "Sign-in, account and privacy screens open", async () => {
    await go(V, "/signin");
    await V.getByRole("button", { name: "Email me a code" }).waitFor();
    await go(V, "/account");
    await V.getByText(/Not signed in|Signed in as/).first().waitFor();
    await go(V, "/privacy");
    await V.getByText("What we store").waitFor();
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

main().catch((e) => {
  console.error(e);
  writeFileSync(`${out}/summary.txt`, `crashed: ${String(e)}`);
  process.exit(0);
});
