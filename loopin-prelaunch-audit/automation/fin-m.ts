// FIN-M01 … FIN-M24: the financial test cases written for human testers,
// executed by a script that taps through the real app in four phone browsers
// (four separate people), on the throwaway copy started inside the GitHub job.
// Expected values are the hand-worked answers from the UAT workbook, typed in
// here; they are not computed from Loopin's own code. Writes
// audit-out/fin-m.json and a screenshot per case into audit-out/evidence.
import { chromium, type Browser, type Page } from "playwright";
import { OUT, save as saveJson, db, base } from "./common";

type Who = "Anil" | "Bina" | "Chet" | "Dina"; // personas A, B, C, D
const A: Who = "Anil", B: Who = "Bina", C: Who = "Chet", D: Who = "Dina";
type Row = { id: string; scenario: string; checks: { what: string; expected: string; actual: string; pass: boolean }[]; status: "Pass" | "Fail"; error: string; evidence: string; adapted: string };
const rows: Row[] = [];
const pages = {} as Record<Who, Page>;
const stamp = Date.now();
const email = (n: string) => `${n.toLowerCase()}-${stamp}@fin.loopin.test`;
const minor = (t: string) => Math.round(parseFloat(t.replace(/[^\d.]/g, "")) * 100);
const rs = (p: number) => `${p < 0 ? "−" : p > 0 ? "+" : ""}₹${(Math.abs(p) / 100).toFixed(2)}`;

// Some screens keep a request open (photos, background refresh), so "network idle" may never come:
// wait for the page to load, give it a moment to settle, and move on.
async function go(page: Page, path: string) {
  await page.goto(base + path, { waitUntil: "load", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
  await page.waitForTimeout(300);
}

async function signup(page: Page, name: string) {
  await go(page, "/signin");
  const address = email(name);
  const nameBox = page.locator('input[name="name"]');
  if (await nameBox.count()) await nameBox.fill(name);
  await page.locator('input[name="email"]').fill(address);
  const since = new Date(Date.now() - 1000);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page.waitForURL(/sent=1/);
  let code = "";
  for (let i = 0; i < 40 && !code; i++) {
    const row = await db.outbox.findFirst({ where: { to: address, subject: { contains: "Loopin code" }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
    code = row ? (/\b(\d{6})\b/.exec(row.subject)?.[1] ?? "") : "";
    if (!code) await page.waitForTimeout(250);
  }
  if (!code) throw new Error(`no code for ${name}`);
  await page.locator('input[name="code"]').fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/signedin=1/);
  // A name chosen at sign-up is what the groups show.
}

// A creates an INR group; the others join from its invite link.
async function group(name: string, others: Who[]): Promise<string> {
  const P = pages[A];
  await go(P, "/groups/new");
  await P.locator('input[name="groupName"]').fill(name);
  await P.locator('select[name="currency"]').selectOption("INR");
  if (await P.locator('input[name="yourName"]').count()) await P.locator('input[name="yourName"]').fill(A);
  await P.getByRole("button", { name: /Create group/ }).click();
  await P.waitForURL(/\/invite\?new=1/);
  const g = new URL(P.url()).pathname.replace(/\/invite$/, "");
  const m = /\/join\/([A-Za-z0-9_-]+)/.exec(await P.content());
  if (!m) throw new Error("no invite link");
  for (const o of others) {
    await go(pages[o], `/join/${m[1]}`);
    await pages[o].getByRole("button", { name: /^Join / }).click();
    await pages[o].waitForURL(new RegExp(`${g}$`));
  }
  return g;
}

async function balances(page: Page, g: string): Promise<Record<string, number>> {
  await go(page, `${g}?tab=balances`);
  const rowsL = page.locator("details.group\\/person > summary");
  const out: Record<string, number> = {};
  for (let i = 0; i < (await rowsL.count()); i++) {
    const t = (await rowsL.nth(i).innerText()).replace(/\s+/g, " ");
    const name = t.replace(/^[A-Z] /, "").split(" ")[0];
    const gets = /gets (₹[\d,.]+)/.exec(t), owes = /owes (₹[\d,.]+)/.exec(t);
    out[name === "You" ? "?" : name] = gets ? minor(gets[1]) : owes ? -minor(owes[1]) : 0;
  }
  return out;
}

type Split = { kind: "everyone" } | { kind: "only"; who: Who[] } | { kind: "one"; who: Who } | { kind: "amounts" | "percent" | "shares"; values: Partial<Record<Who, string>> };
type Opts = { me: Who; name: string; amount: string; payer?: Who; split?: Split; currency?: string; method?: "Card" | "Cash"; rate?: string; markup?: "None" | "2" | "group" };
async function pickCurrency(page: Page, code: string) {
  const btn = page.getByRole("button", { name: /Currency:/ });
  if ((await btn.innerText()).includes(code)) return;
  await btn.click();
  await page.getByLabel("Search currencies").fill(code);
  await page.getByRole("button", { name: new RegExp(`\\b${code}\\b`) }).first().click();
}
async function fill(page: Page, o: Opts) {
  const label = (p: Who) => (p === o.me ? "You" : p);
  if (o.payer) await page.getByRole("button", { name: new RegExp(`^(✓ )?${label(o.payer)}$`) }).first().click();
  await page.locator("#expense-name").fill(o.name);
  await pickCurrency(page, o.currency ?? "INR");
  await page.getByLabel("Amount", { exact: true }).fill(o.amount);
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
  if (await page.getByRole("button", { name: "Everyone equally" }).count()) await page.getByRole("button", { name: "Everyone equally" }).click();
  const s = o.split ?? { kind: "everyone" };
  if (s.kind === "only") {
    await page.getByRole("button", { name: "Only some" }).click();
    for (const p of s.who) await page.getByRole("button", { name: new RegExp(`^(✓ )?${label(p)}$`) }).last().click();
  } else if (s.kind === "one") {
    await page.getByRole("button", { name: /Custom/ }).click();
    await page.getByRole("button", { name: "One person", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(`^${label(s.who)}$`) }).last().click();
  } else if (s.kind !== "everyone") {
    await page.getByRole("button", { name: /Custom/ }).click();
    const tab = { amounts: "Amounts", percent: "%", shares: "Shares" }[s.kind];
    const suffix = { amounts: "amount", percent: "percentage", shares: "shares" }[s.kind];
    await page.getByRole("button", { name: tab, exact: true }).click();
    for (const [p, v] of Object.entries(s.values)) await page.getByLabel(`${label(p as Who)} ${suffix}`).fill(v!);
  }
}
async function submit(page: Page, button = "Save expense") {
  await page.getByRole("button", { name: button }).click();
  const dup = page.getByRole("button", { name: "It’s a different one" });
  const r = await Promise.race([page.waitForURL(/tab=activity/, { timeout: 20_000 }).then(() => "ok"), dup.waitFor({ timeout: 20_000 }).then(() => "dup")]).catch(() => "timeout");
  if (r === "dup") await dup.click();
  await page.waitForURL(/tab=activity/, { timeout: 20_000 });
}
async function add(g: string, o: Opts) {
  const P = pages[o.me];
  await go(P, `${g}/add`);
  await fill(P, o);
  await submit(P);
}
async function record(g: string, me: Who, from: Who, to: Who, amount: string) {
  const P = pages[me];
  await go(P, `${g}/pay`);
  await P.locator("label", { hasText: from === me ? "You" : from }).first().click();
  await P.locator("label[data-to]", { hasText: to === me ? "You" : to }).click();
  await P.locator('input[name="amount"]').fill(amount);
  await P.getByRole("button", { name: "Record payment" }).click();
}
const gid = (g: string) => g.split("/").pop()!;

// One case: run fn; each check() compares a value with the hand-worked answer.
async function tc(id: string, scenario: string, fn: (check: (what: string, expected: string, actual: string) => void) => Promise<{ page: Page; adapted?: string } | void>) {
  const row: Row = { id, scenario, checks: [], status: "Pass", error: "", evidence: "", adapted: "" };
  rows.push(row);
  const check = (what: string, expected: string, actual: string) => {
    row.checks.push({ what, expected, actual, pass: expected === actual });
  };
  try {
    const r = await fn(check);
    if (r && r.adapted) row.adapted = r.adapted;
    if (r) {
      row.evidence = `evidence/${id}.png`;
      await r.page.screenshot({ path: `${OUT}/${row.evidence}`, fullPage: true }).catch(() => (row.evidence = ""));
    }
  } catch (e) {
    row.error = String((e as Error).message ?? e).split("\n")[0].slice(0, 300);
    const shot = `evidence/${id}-error.png`;
    for (const p of Object.values(pages)) {
      if (p.url().includes(base)) {
        await p.screenshot({ path: `${OUT}/${shot}`, fullPage: true }).catch(() => undefined);
        break;
      }
    }
    row.evidence = shot;
  }
  if (row.error || row.checks.some((c) => !c.pass) || row.checks.length === 0) row.status = "Fail";
  console.log(row.status === "Pass" ? "✓" : "✗", id, scenario, row.error, row.checks.filter((c) => !c.pass).map((c) => `${c.what}: expected ${c.expected}, got ${c.actual}`).join("; "));
}
const show = (b: Record<string, number>, who: Who[]) => who.map((w) => `${w} ${rs(b[w] ?? 0)}`).join(" · ");

async function main() {
  const day = new Date().toISOString().slice(0, 10);
  for (const [b0, q, r] of [["THB", "INR", "2.5734"], ["USD", "INR", "83.40"], ["JPY", "INR", "0.55"]] as const) await db.exchangeRate.create({ data: { base: b0, quote: q, rate: r, date: day } }).catch(() => undefined);
  await db.rateLimit.deleteMany({});
  const browser: Browser = await chromium.launch();
  for (const w of [A, B, C, D]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "en-IN", timezoneId: "Asia/Kolkata" });
    pages[w] = await ctx.newPage();
    pages[w].setDefaultTimeout(30_000);
    pages[w].on("dialog", (d) => d.accept());
    await signup(pages[w], w);
  }
  const PA = pages[A];

  await tc("FIN-M01", "Equal split ₹1,000 between A, B, C (rounding)", async (check) => {
    const g = await group("FIN M01", [B, C]);
    await add(g, { me: A, name: "Lunch", amount: "1000" });
    const b = await balances(PA, g);
    check("A gets ₹666.66 or ₹666.67 (one person carries the extra paisa)", "true", String(b[A] === 66666 || b[A] === 66667));
    check("B and C each owe ₹333.33 or ₹333.34", "true", String([b[B], b[C]].every((x) => x === -33333 || x === -33334)));
    check("Balances add up to ₹0", "0", String(b[A] + b[B] + b[C]));
    const e = await db.expense.findFirstOrThrow({ where: { groupId: gid(g), description: "Lunch" }, include: { shares: true } });
    check("Shares add up to exactly ₹1,000", "100000", String(e.shares.reduce((s, x) => s + x.amount, 0)));
    await go(pages[B], g);
    const t = (await pages[B].locator("main").innerText()).replace(/\s+/g, " ");
    check("B's group screen says B owes ₹333.33/₹333.34", "true", String(/owe/i.test(t) && /₹333\.3[34]/.test(t)));
    return { page: pages[B] };
  });
  await tc("FIN-M02", "Exact amounts ₹2,500 paid by C: A ₹1,000, B ₹500, C ₹1,000", async (check) => {
    const g = await group("FIN M02", [B, C]);
    await add(g, { me: A, name: "Hotel", amount: "2500", payer: C, split: { kind: "amounts", values: { [A]: "1000", [B]: "500", [C]: "1000" } } });
    const b = await balances(PA, g);
    check("Balances", "Anil −₹1000.00 · Bina −₹500.00 · Chet +₹1500.00", show(b, [A, B, C]));
    return { page: PA };
  });
  await tc("FIN-M03", "Percentages 40/35/25 of ₹1,000 paid by B", async (check) => {
    const g = await group("FIN M03", [B, C]);
    await add(g, { me: A, name: "Fuel", amount: "1000", payer: B, split: { kind: "percent", values: { [A]: "40", [B]: "35", [C]: "25" } } });
    const b = await balances(PA, g);
    check("Balances", "Anil −₹400.00 · Bina +₹650.00 · Chet −₹250.00", show(b, [A, B, C]));
    return { page: PA };
  });
  await tc("FIN-M04", "Shares 2:1:1 of ₹1,200", async (check) => {
    const g = await group("FIN M04", [B, C]);
    await add(g, { me: A, name: "Villa", amount: "1200", split: { kind: "shares", values: { [A]: "2", [B]: "1", [C]: "1" } } });
    const b = await balances(PA, g);
    check("Balances", "Anil +₹600.00 · Bina −₹300.00 · Chet −₹300.00", show(b, [A, B, C]));
    return { page: PA };
  });
  await tc("FIN-M05", "Two payers: ₹3,000, A paid ₹2,000 and B ₹1,000, equal between 3", async (check) => {
    const g = await group("FIN M05", [B, C]);
    await go(PA, `${g}/add`);
    await PA.locator("#expense-name").fill("Dinner");
    await PA.getByLabel("Amount", { exact: true }).fill("3000");
    await PA.getByRole("button", { name: "More than one" }).click();
    await PA.getByLabel("You paid").fill("2000");
    await PA.getByLabel(`${B} paid`).fill("1000");
    await PA.getByText(/Adds up to/).first().waitFor();
    await submit(PA);
    const b = await balances(PA, g);
    check("Balances", "Anil +₹1000.00 · Bina ₹0.00 · Chet −₹1000.00", show(b, [A, B, C]));
    return { page: PA };
  });
  await tc("FIN-M06", "Only some: ₹400 taxi for A and B", async (check) => {
    const g = await group("FIN M06", [B, C]);
    await add(g, { me: A, name: "Taxi", amount: "400", split: { kind: "only", who: [A, B] } });
    const b = await balances(PA, g);
    check("Balances", "Anil +₹200.00 · Bina −₹200.00 · Chet ₹0.00", show(b, [A, B, C]));
    return { page: PA };
  });
  await tc("FIN-M07", "For one person: ₹300 ticket just for C", async (check) => {
    const g = await group("FIN M07", [B, C]);
    await add(g, { me: A, name: "Ticket", amount: "300", split: { kind: "one", who: C } });
    const b = await balances(PA, g);
    check("Balances", "Anil +₹300.00 · Bina ₹0.00 · Chet −₹300.00", show(b, [A, B, C]));
    return { page: PA };
  });
  await tc("FIN-M08", "Money back: hotel refunds ₹900 to A, shared by 3", async (check) => {
    const g = await group("FIN M08", [B, C]);
    await go(PA, `${g}/add`);
    await PA.getByRole("radio", { name: "Money back" }).click();
    await PA.locator("#expense-name").fill("Hotel refund");
    await PA.getByLabel("Amount", { exact: true }).fill("900");
    await submit(PA, "Save money back");
    const b = await balances(PA, g);
    check("Balances", "Anil −₹600.00 · Bina +₹300.00 · Chet +₹300.00", show(b, [A, B, C]));
    return { page: PA };
  });
  await tc("FIN-M09", "THB 1,000 by card at 2.5 with 3% card fee, equal 4", async (check) => {
    const g = await group("FIN M09", [B, C, D]);
    await go(PA, `${g}/settings`);
    await PA.locator('input[name="markup"][value="300"]').check({ force: true });
    await PA.getByRole("button", { name: "Save settings" }).click();
    await PA.waitForURL(/saved=settings/);
    await go(PA, `${g}/add`);
    await fill(PA, { me: A, name: "Spa", amount: "1000", currency: "THB", method: "Card", rate: "2.5", markup: "group" });
    const box = (await PA.locator("dl").innerText()).replace(/\s+/g, " ");
    check("Total shown on the form", "true", String(/2,575\.00|2,575/.test(box)));
    await submit(PA);
    const b = await balances(PA, g);
    check("Balances", "Anil +₹1931.25 · Bina −₹643.75 · Chet −₹643.75 · Dina −₹643.75", show(b, [A, B, C, D]));
    const t = (await PA.locator("main").innerText()).replace(/\s+/g, " ");
    check("THB amounts shown without the card fee (THB 250 each)", "true", String(/(THB|฿) ?250/.test(t)));
    return { page: PA };
  });
  await tc("FIN-M10", "THB 400 cash at 2.5 has no card fee", async (check) => {
    const g = await group("FIN M10", [B, C, D]);
    await add(g, { me: A, name: "Market", amount: "400", currency: "THB", method: "Cash", rate: "2.5" });
    const b = await balances(PA, g);
    check("Balances", "Anil +₹750.00 · Bina −₹250.00 · Chet −₹250.00 · Dina −₹250.00", show(b, [A, B, C, D]));
    return { page: PA };
  });

  // FIN-M11 → FIN-M14: one group, in sequence (as the workbook describes).
  let gs = "";
  await tc("FIN-M11", "Sequence: two expenses and a part payment", async (check) => {
    gs = await group("FIN M11", [B, C, D]);
    await add(gs, { me: A, name: "Groceries", amount: "4000" });
    await add(gs, { me: B, name: "Snacks", amount: "1200", split: { kind: "only", who: [A, B, C] } });
    await record(gs, C, C, A, "500");
    await pages[C].waitForURL(/paid=1/);
    const b = await balances(PA, gs);
    check("Balances", "Anil +₹2100.00 · Bina −₹200.00 · Chet −₹900.00 · Dina −₹1000.00", show(b, [A, B, C, D]));
    check("Sum is ₹0", "0", String(b[A] + b[B] + b[C] + b[D]));
    return { page: PA, adapted: "C's ₹500 is recorded with “Record a different payment” (C → A ₹500) rather than by editing the amount on a Settle card; same payment either way." };
  });
  await tc("FIN-M12", "Edit E1 from ₹4,000 to ₹2,000; balances recalculate", async (check) => {
    const e = await db.expense.findFirstOrThrow({ where: { groupId: gid(gs), description: "Groceries" } });
    await go(PA, `${gs}/expenses/${e.id}/edit`);
    await PA.getByLabel("Amount", { exact: true }).fill("2000");
    await PA.getByRole("button", { name: "Everyone equally" }).click();
    await PA.getByRole("button", { name: "Save changes" }).click();
    await PA.waitForURL(/tab=activity/);
    const b = await balances(PA, gs);
    check("Balances", "Anil +₹600.00 · Bina +₹300.00 · Chet −₹400.00 · Dina −₹500.00", show(b, [A, B, C, D]));
    await go(pages[D], gs);
    const t = (await pages[D].locator("main").innerText()).replace(/\s+/g, " ");
    check("D sees “You owe ₹500”", "true", String(/owe/i.test(t) && /₹500(\.00)?(?!\d)/.test(t)));
    return { page: pages[D] };
  });
  await tc("FIN-M13", "Delete E2, then restore it", async (check) => {
    const e = await db.expense.findFirstOrThrow({ where: { groupId: gid(gs), description: "Snacks" } });
    await go(PA, `${gs}/expenses/${e.id}/edit`);
    await PA.getByRole("button", { name: "Delete expense" }).click();
    await PA.waitForURL(/tab=activity/);
    const mid = await balances(PA, gs);
    check("After delete (hand-worked: without Snacks)", "Anil +₹1000.00 · Bina −₹500.00 · Chet ₹0.00 · Dina −₹500.00", show(mid, [A, B, C, D]));
    await go(PA, `${gs}?tab=activity&q=Snacks`);
    await PA.locator("details summary").filter({ hasText: "Snacks" }).first().click();
    await PA.getByRole("button", { name: "Restore" }).first().click();
    await PA.waitForURL(/did=/);
    const b = await balances(PA, gs);
    check("After restore (back to FIN-M12)", "Anil +₹600.00 · Bina +₹300.00 · Chet −₹400.00 · Dina −₹500.00", show(b, [A, B, C, D]));
    return { page: PA };
  });
  await tc("FIN-M14", "Overpayment: record ₹5,000 when D owes ₹500", async (check) => {
    const before = await db.payment.count({ where: { groupId: gid(gs), deletedAt: null } });
    const PD = pages[D];
    await record(gs, D, D, A, "5000");
    await PD.locator("[data-over-warning]").waitFor();
    const w = (await PD.locator("[data-over-warning]").innerText()).replace(/\s+/g, " ");
    check("A warning appears before saving", "true", String(/more than/i.test(w)));
    check("Nothing saved before confirming", String(before), String(await db.payment.count({ where: { groupId: gid(gs), deletedAt: null } })));
    await PD.locator('input[name="over"]').check({ force: true });
    await PD.getByRole("button", { name: "Record payment" }).click();
    await PD.waitForURL(/paid=1/);
    const b = await balances(PA, gs);
    check("After confirming: balance flips", "Anil −₹4400.00 · Bina +₹300.00 · Chet −₹400.00 · Dina +₹4500.00", show(b, [A, B, C, D]));
    return { page: PA };
  });
  await tc("FIN-M15", "Part payment ₹200 of ₹500", async (check) => {
    const g = await group("FIN M15", [B, C, D]);
    await add(g, { me: A, name: "Groceries", amount: "2000" });
    await record(g, D, D, A, "200");
    await pages[D].waitForURL(/paid=1/);
    const b = await balances(PA, g);
    check("Balances", "Anil +₹1300.00 · Bina −₹500.00 · Chet −₹500.00 · Dina −₹300.00", show(b, [A, B, C, D]));
    return { page: PA, adapted: "Run in its own group (A paid ₹2,000 for 4, so D owed ₹500) because FIN-M14 had already flipped D's balance in the sequence group." };
  });
  await tc("FIN-M16", "Smart Settle suggests the fewest payments", async (check) => {
    const g = await group("FIN M16", [B, C, D]);
    await add(g, { me: A, name: "Boat", amount: "1000", split: { kind: "only", who: [B, D] } });
    const b0 = await balances(PA, g);
    check("Starting balances", "Anil +₹1000.00 · Bina −₹500.00 · Chet ₹0.00 · Dina −₹500.00", show(b0, [A, B, C, D]));
    await go(PA, `${g}/settle`);
    const cards = PA.locator("main ul > li").filter({ has: PA.locator('input[name="amount"]') });
    const texts = [] as string[];
    for (let i = 0; i < (await cards.count()); i++) texts.push((await cards.nth(i).innerText()).replace(/\s+/g, " ").slice(0, 60));
    check("Exactly 2 payments suggested (B → A ₹500, D → A ₹500)", "2 true", `${texts.length} ${texts.every((t) => /500/.test(t) && /(Bina|Dina)/.test(t))}`);
    while ((await cards.count()) > 0) {
      await cards.nth(0).getByRole("button", { name: "Mark paid" }).click();
      await PA.waitForURL(/paid=1/);
      await go(PA, `${g}/settle`);
    }
    const b = await balances(PA, g);
    check("Everyone ₹0 after both are marked paid", "Anil ₹0.00 · Bina ₹0.00 · Chet ₹0.00 · Dina ₹0.00", show(b, [A, B, C, D]));
    return { page: PA };
  });
  await tc("FIN-M17", "₹10 between 3 then settle: nobody left with a paisa", async (check) => {
    const g = await group("FIN M17", [B, C]);
    await add(g, { me: A, name: "Chai", amount: "10", payer: C });
    const b0 = await balances(PA, g);
    check("Before settling (₹3.33/₹3.34 shares)", "true", String(b0[C] === 667 || b0[C] === 666));
    await go(PA, `${g}/settle`);
    const cards = PA.locator("main ul > li").filter({ has: PA.locator('input[name="amount"]') });
    while ((await cards.count()) > 0) {
      await cards.nth(0).getByRole("button", { name: "Mark paid" }).click();
      await PA.waitForURL(/paid=1/);
      await go(PA, `${g}/settle`);
    }
    const b = await balances(PA, g);
    check("All ₹0.00", "Anil ₹0.00 · Bina ₹0.00 · Chet ₹0.00", show(b, [A, B, C]));
    return { page: PA };
  });
  await tc("FIN-M18", "Split by item ₹1,180", async (check) => {
    const g = await group("FIN M18", [B]);
    await go(PA, `${g}/add`);
    await fill(PA, { me: A, name: "Bar bill", amount: "1180" });
    await PA.getByRole("button", { name: /Custom/ }).click();
    await PA.getByRole("button", { name: "Items", exact: true }).click();
    const box = PA.locator("[data-item-split]");
    await box.getByLabel("Item 1", { exact: true }).fill("Pizza");
    await box.getByLabel("Item 1 price").fill("600");
    const first = box.getByRole("group", { name: "Who had item 1" });
    await first.getByRole("button", { name: "You", exact: true }).click();
    await first.getByRole("button", { name: B, exact: true }).click();
    await box.getByRole("button", { name: /Add item/ }).click();
    await box.getByLabel("Item 2", { exact: true }).fill("Beer");
    await box.getByLabel("Item 2 price").fill("400");
    await box.getByRole("group", { name: "Who had item 2" }).getByRole("button", { name: B, exact: true }).click();
    const t = (await box.locator("[data-item-result]").innerText()).replace(/\s+/g, " ");
    check("Form shows A ₹354, B ₹826, extras ₹180", "true", String(/354/.test(t) && /826/.test(t) && /180/.test(t)));
    await submit(PA);
    const b = await balances(PA, g);
    check("Balances", "Anil +₹826.00 · Bina −₹826.00", show(b, [A, B]));
    const e = await db.expense.findFirstOrThrow({ where: { groupId: gid(g), description: "Bar bill" } });
    check("Notes list the items and the shared extras", "true", String(/By item: Pizza .*600.* \(Anil, Bina\); Beer .*400.* \(Bina\)/.test(e.notes ?? "") && /180/.test(e.notes ?? "")));
    return { page: PA };
  });
  let onecard = "";
  await tc("FIN-M19", "Settle across groups nets into one payment", async (check) => {
    const gx = await group("FIN M19 X", [B]);
    const gy = await group("FIN M19 Y", [B]);
    await add(gx, { me: A, name: "Rent", amount: "1000" });
    await add(gy, { me: B, name: "Pizza", amount: "600" });
    const PB = pages[B];
    await go(PB, "/settle");
    const card = PB.locator("main li").filter({ hasText: A }).filter({ hasText: "FIN M19" }).first();
    const t = (await card.innerText()).replace(/\s+/g, " ");
    check("One line: B pays A ₹200", "true", String(/pay Anil/i.test(t) && /₹200/.test(t)));
    onecard = t.slice(0, 120);
    await card.getByRole("button", { name: "Mark as paid" }).click();
    await PB.waitForURL(/settle=done/);
    const bx = await balances(PA, gx), by = await balances(PA, gy);
    check("Group X square", "Anil ₹0.00 · Bina ₹0.00", show(bx, [A, B]));
    check("Group Y square", "Anil ₹0.00 · Bina ₹0.00", show(by, [A, B]));
    return { page: PB, adapted: `Card text: “${onecard}”` };
  });
  await tc("FIN-M20", "Typing amounts: commas, decimals, too many decimals", async (check) => {
    const g = await group("FIN M20", [B, C, D]);
    const err = async () => (await PA.locator("p.bg-red-50").first().waitFor({ timeout: 8000 }).then(() => PA.locator("p.bg-red-50").first().innerText()).catch(() => "")).replace(/\s+/g, " ");
    await add(g, { me: A, name: "Big one", amount: "1,23,456.78" });
    let e = await db.expense.findFirst({ where: { groupId: gid(g), description: "Big one" } });
    check("“1,23,456.78” saves as ₹1,23,456.78", "12345678", String(e?.amount ?? "not saved"));
    await add(g, { me: A, name: "Comma decimal", amount: "12,50" });
    e = await db.expense.findFirst({ where: { groupId: gid(g), description: "Comma decimal" } });
    check("“12,50” is treated as ₹12.50", "1250", String(e?.amount ?? "not saved"));
    await go(PA, `${g}/add`);
    await fill(PA, { me: A, name: "Too precise", amount: "10.555" });
    await PA.getByRole("button", { name: "Save expense" }).click();
    const m1 = await err();
    check("“10.555” refused with a message", "true", String(m1.length > 0 && !(await db.expense.findFirst({ where: { groupId: gid(g), description: "Too precise" } }))));
    await go(PA, `${g}/add`);
    await fill(PA, { me: A, name: "Yen", amount: "1500.5", currency: "JPY", method: "Cash", rate: "0.55" });
    await PA.getByRole("button", { name: "Save expense" }).click();
    const m2 = await err();
    check("JPY 1500.5 refused (yen has no decimals)", "true", String(m2.length > 0 && !(await db.expense.findFirst({ where: { groupId: gid(g), description: "Yen" } }))));
    return { page: PA, adapted: `Messages seen: “${m1.slice(0, 80)}” / “${m2.slice(0, 80)}”. The 1,23,456.78 and 12,50 cases are checked by what is saved, not by the on-screen echo.` };
  });
  await tc("FIN-M21", "Largest allowed amount", async (check) => {
    const g = await group("FIN M21", [B]);
    await add(g, { me: A, name: "Car", amount: "20000000" });
    const e = await db.expense.findFirst({ where: { groupId: gid(g), description: "Car" } });
    check("₹2,00,00,000 saves", "2000000000", String(e?.amount ?? "not saved"));
    await go(PA, `${g}/add`);
    await fill(PA, { me: A, name: "Car plus", amount: "20000000.01" });
    await PA.getByRole("button", { name: "Save expense" }).click();
    const m = await PA.locator("p.bg-red-50").first().waitFor({ timeout: 8000 }).then(() => PA.locator("p.bg-red-50").first().innerText()).catch(() => "");
    check("₹2,00,00,000.01 refused with a message", "true", String(m.length > 0 && !(await db.expense.findFirst({ where: { groupId: gid(g), description: "Car plus" } }))));
    return { page: PA, adapted: `The first expense is kept rather than deleted before the second try (the limit is per expense). Message: “${m.replace(/\s+/g, " ").slice(0, 100)}”` };
  });
  await tc("FIN-M22", "Couple 55/45 split", async (check) => {
    await go(PA, "/groups/new");
    await PA.getByRole("button", { name: /^Couple/ }).click();
    await PA.locator('input[name="groupName"]').fill("FIN M22");
    await PA.locator('select[name="currency"]').selectOption("INR");
    await PA.getByRole("button", { name: "Next" }).click();
    await PA.getByRole("radio", { name: "By income" }).click();
    await PA.getByLabel("You earn a month").fill("110000");
    await PA.getByLabel("Your partner earns").fill("90000");
    await PA.getByRole("button", { name: /Use 55 \/ 45/ }).click();
    await PA.waitForURL(/\/invite\?new=1/);
    const g = new URL(PA.url()).pathname.replace(/\/invite$/, "");
    const m = /\/join\/([A-Za-z0-9_-]+)/.exec(await PA.content());
    await go(pages[B], `/join/${m![1]}`);
    await pages[B].getByRole("button", { name: /^Join / }).click();
    await pages[B].waitForURL(new RegExp(`${g}$`));
    await go(PA, `${g}/add`);
    const chip = PA.getByRole("button", { name: /Our split/ });
    check("“Our split 55 / 45” preselected", "true", String(await chip.getAttribute("aria-pressed")));
    await PA.locator("#expense-name").fill("Lunch");
    await PA.getByLabel("Amount", { exact: true }).fill("1000");
    await submit(PA);
    const b = await balances(PA, g);
    check("B owes ₹450", "Anil +₹450.00 · Bina −₹450.00", show(b, [A, B]));
    return { page: PA, adapted: "B joins from the couple's invite link." };
  });
  await tc("FIN-M23", "Custom 2% card fee", async (check) => {
    const g = await group("FIN M23", [B, C, D]);
    await add(g, { me: A, name: "Dinner", amount: "1000", currency: "THB", method: "Card", rate: "2.5", markup: "2" });
    const b = await balances(PA, g);
    check("Balances", "Anil +₹1912.50 · Bina −₹637.50 · Chet −₹637.50 · Dina −₹637.50", show(b, [A, B, C, D]));
    return { page: PA };
  });
  await tc("FIN-M24", "USD with 4-decimal rate rounds half-up", async (check) => {
    const g = await group("FIN M24", [B, C, D]);
    await go(PA, `${g}/add`);
    await fill(PA, { me: A, name: "Museum", amount: "19.99", currency: "USD", method: "Cash", rate: "83.4567" });
    const box = (await PA.locator("dl").innerText()).replace(/\s+/g, " ");
    check("Total shown ₹1,668.30", "true", String(/1,668\.30/.test(box)));
    await submit(PA);
    const b = await balances(PA, g);
    check("A gets ₹1,251.22 or ₹1,251.23", "true", String(b[A] === 125122 || b[A] === 125123));
    check("Others owe ₹417.07 or ₹417.08", "true", String([b[B], b[C], b[D]].every((x) => x === -41707 || x === -41708)));
    check("Sum is ₹0", "0", String(b[A] + b[B] + b[C] + b[D]));
    return { page: PA };
  });

  await browser.close();
  saveJson("fin-m.json", rows);
  const pass = rows.filter((r) => r.status === "Pass").length;
  console.log(`FIN-M: ${pass} pass, ${rows.length - pass} fail of ${rows.length}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  saveJson("fin-m.json", rows);
  process.exit(1);
});
