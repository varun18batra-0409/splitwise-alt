// Exploratory checks beyond the original checklist (10 Nov 2026), on the
// throwaway copy only. Each check records what it saw; nothing here is
// assumed. Writes audit-out/explore.json and screenshots.
import { chromium, type Page } from "playwright";
import { OUT, save as saveJson, db, base } from "./common";

type Row = { id: string; area: string; what: string; expected: string; actual: string; status: "Pass" | "Fail" | "Info"; evidence: string };
const rows: Row[] = [];
const stamp = Date.now();
const email = (n: string) => `${n.toLowerCase()}-${stamp}@explore.loopin.test`;
const HOSTILE = `Goa"><img src=x onerror="window.__x=1"><script>window.__x=2</script>`;
const HOSTILE_NAME = `Bo<svg onload="window.__x=3">`;
const LONG = "Supercalifragilisticexpialidocious".repeat(2).slice(0, 60);

async function go(page: Page, path: string) {
  await page.goto(base + path, { waitUntil: "load", timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
  await page.waitForTimeout(250);
}
async function signup(page: Page, name: string, address = email(name)) {
  await go(page, "/signin");
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
  await page.locator('input[name="code"]').fill(code);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/signedin=1/);
}
async function check(id: string, area: string, what: string, expected: string, fn: () => Promise<{ ok: boolean | null; actual: string; page?: Page }>) {
  const r: Row = { id, area, what, expected, actual: "", status: "Info", evidence: "" };
  try {
    const x = await fn();
    r.actual = x.actual.slice(0, 600);
    r.status = x.ok === null ? "Info" : x.ok ? "Pass" : "Fail";
    if (x.page) {
      r.evidence = `evidence/${id}.png`;
      await x.page.screenshot({ path: `${OUT}/${r.evidence}`, fullPage: true }).catch(() => (r.evidence = ""));
    }
  } catch (e) {
    r.status = "Fail";
    r.actual = "ERROR " + String((e as Error).message ?? e).split("\n")[0].slice(0, 300);
  }
  rows.push(r);
  console.log(r.status === "Pass" ? "✓" : r.status === "Fail" ? "✗" : "·", id, what, "→", r.actual.slice(0, 160));
}

async function main() {
  await db.rateLimit.deleteMany({});
  const browser = await chromium.launch();
  const ctx = async (w = 390) => {
    const c = await browser.newContext({ viewport: { width: w, height: 844 }, locale: "en-IN", timezoneId: "Asia/Kolkata", colorScheme: "dark" });
    const p = await c.newPage();
    p.setDefaultTimeout(30_000);
    return p;
  };
  const dialogs: string[] = [];
  const A = await ctx(), B = await ctx(), C = await ctx(), S = await ctx(360);
  for (const p of [A, B, C, S]) p.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss().catch(() => undefined); });
  await signup(A, "Anil");
  await signup(B, HOSTILE_NAME, email("bo"));
  await signup(C, "Chet");

  // A group whose name and people try to run script.
  await go(A, "/groups/new");
  await A.locator('input[name="groupName"]').fill(HOSTILE);
  await A.locator('select[name="currency"]').selectOption("INR");
  await A.getByRole("button", { name: /Create group/ }).click();
  await A.waitForURL(/\/invite\?new=1/);
  const g = new URL(A.url()).pathname.replace(/\/invite$/, "");
  const code = /\/join\/([A-Za-z0-9_-]+)/.exec(await A.content())![1];
  for (const p of [B, C]) {
    await go(p, `/join/${code}`);
    await p.getByRole("button", { name: /^Join / }).click();
    await p.waitForURL(new RegExp(`${g}$`));
  }
  await go(A, `${g}/add`);
  await A.locator("#expense-name").fill(`Dinner <img src=x onerror="window.__x=4">`);
  await A.getByLabel("Amount", { exact: true }).fill("900");
  await A.getByRole("button", { name: "Save expense" }).click();
  await A.waitForURL(/tab=activity/);

  const pages = ["", "?tab=balances", "?tab=charts", "/settle", "/invite", "/people", "/settings", "/report", "/wrapped", "/passports", "/pay"];
  await check("EXP-01", "Security", "Script in a group name, a person's name and an expense name never runs (11 group screens + Home, Alerts, Search)", "No pop-ups; window.__x stays unset; names shown as plain text", async () => {
    const hits: string[] = [];
    for (const path of [...pages.map((p) => g + p), "/", "/notifications", `/search?q=${encodeURIComponent("Dinner")}`]) {
      await go(A, path);
      const x = await A.evaluate(() => (window as unknown as { __x?: number }).__x);
      const bad = await A.evaluate(() => document.querySelectorAll("img[onerror], svg[onload], script:not([src]):not([nonce]):not([type='application/ld+json'])").length);
      if (x !== undefined || bad) hits.push(`${path}: __x=${x} elements=${bad}`);
    }
    return { ok: hits.length === 0 && dialogs.length === 0, actual: hits.length || dialogs.length ? `${hits.join("; ")} dialogs=${dialogs.length}` : "No script ran on any screen; names shown as text", page: A };
  });
  await check("EXP-02", "Security", "The public join page for that group (not signed in) shows the name as text", "No pop-up; page title is the literal text", async () => {
    const P = await ctx();
    P.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss().catch(() => undefined); });
    await go(P, `/join/${code}`);
    const x = await P.evaluate(() => (window as unknown as { __x?: number }).__x);
    const title = await P.title();
    return { ok: x === undefined && title.includes("<img"), actual: `__x=${x}; title=${title.slice(0, 120)}`, page: P };
  });
  await check("EXP-03", "Security", "Invite and share-picture endpoints with a hostile group name answer without errors", "Pictures render (200, image/png) or are refused (404), never 500", async () => {
    const out: string[] = [];
    for (const path of [`/join/${code}/card`, `${g}/square-image`, `${g}/countdown-image`, `${g}/wrapped-image`]) {
      const r = await A.request.get(base + path);
      out.push(`${path.replace(g, "/groups/:id").replace(code, ":code")} ${r.status()} ${r.headers()["content-type"] ?? ""}`);
    }
    return { ok: out.every((x) => !/ 5\d\d /.test(x)), actual: out.join("; ") };
  });

  // Long names on a small phone.
  await go(A, `${g}/settings`);
  await A.locator('input[name="name"]').fill(LONG);
  await A.getByRole("button", { name: "Save settings" }).click();
  await A.waitForURL(/saved=settings/);
  await check("EXP-04", "Responsive", "A 60-letter group name with no spaces on a 360 px phone: no sideways scroll on 8 screens", "No page wider than the screen", async () => {
    const S2 = await browser.newContext({ viewport: { width: 360, height: 760 }, colorScheme: "dark", storageState: await A.context().storageState() });
    const P = await S2.newPage();
    const wide: string[] = [];
    for (const path of ["/", g, `${g}?tab=balances`, `${g}/settle`, `${g}/invite`, `${g}/people`, `${g}/settings`, `${g}/report`]) {
      await go(P, path);
      const w = await P.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (w > 2) wide.push(`${path.replace(g, "/groups/:id")} +${w}px`);
    }
    return { ok: wide.length === 0, actual: wide.length ? wide.join("; ") : "No sideways scroll", page: P };
  });

  // Someone who left tries to change things.
  await go(C, `${g}/people`);
  const leave = C.getByRole("button", { name: /^Leave/ });
  let left = false;
  if (await leave.count()) {
    await leave.first().click();
    await C.waitForLoadState("load");
    left = Boolean(await db.member.findFirst({ where: { groupId: g.split("/").pop()!, name: "Chet", leftAt: { not: null } } }));
  }
  if (!left) {
    const m = await db.member.findFirst({ where: { groupId: g.split("/").pop()!, name: "Chet" } });
    if (m) await db.member.update({ where: { id: m.id }, data: { leftAt: new Date() } });
  }
  const exp = await db.expense.findFirstOrThrow({ where: { groupId: g.split("/").pop()! } });
  await check("EXP-05", "Security", "Someone who left the group opens an expense and taps Delete", "Refused: “You left this group…”; the expense stays", async () => {
    await go(C, `${g}/expenses/${exp.id}/edit`);
    const del = C.getByRole("button", { name: "Delete expense" });
    if (!(await del.count())) return { ok: true, actual: "No Delete button offered to someone who left", page: C };
    await del.click();
    await C.waitForLoadState("load");
    await C.waitForTimeout(800);
    const after = await db.expense.findUniqueOrThrow({ where: { id: exp.id } });
    const text = (await C.locator("main").innerText().catch(() => "")).replace(/\s+/g, " ");
    return { ok: !after.deletedAt, actual: after.deletedAt ? "The expense WAS deleted by someone who had left" : `Not deleted. Screen says: ${(/You left this group[^.]*\./.exec(text) ?? [""])[0] || text.slice(0, 120)}`, page: C };
  });
  await check("EXP-06", "Security", "Someone who left records a payment on the payment screen", "Refused; no payment saved", async () => {
    const gid = g.split("/").pop()!;
    const before = await db.payment.count({ where: { groupId: gid } });
    await go(C, `${g}/pay`);
    if (!(await C.locator('input[name="amount"]').count())) return { ok: true, actual: "Payment screen not offered", page: C };
    await C.locator("label").filter({ hasText: /^You/ }).first().click().catch(() => undefined);
    await C.locator("label[data-to]").filter({ hasText: "Anil" }).first().click().catch(() => undefined);
    await C.locator('input[name="amount"]').fill("10");
    await C.getByRole("button", { name: "Record payment" }).click();
    await C.waitForLoadState("load");
    await C.waitForTimeout(800);
    const over = C.locator('input[name="over"]');
    if (await over.count()) {
      await over.check({ force: true });
      await C.getByRole("button", { name: "Record payment" }).click();
      await C.waitForLoadState("load");
      await C.waitForTimeout(800);
    }
    const after = await db.payment.count({ where: { groupId: gid } });
    return { ok: after === before, actual: after > before ? "A payment WAS recorded by someone who had left" : "No payment saved", page: C };
  });

  // Invite emails from one person.
  await check("EXP-07", "Abuse", "One person sends 25 invite emails in a row", "After 20 in a day, the rest are refused with a clear note (the app's whole daily email allowance is small)", async () => {
    const list = Array.from({ length: 25 }, (_, i) => `spam${i}-${stamp}@explore.loopin.test`);
    for (const chunk of [list.slice(0, 20), list.slice(20)]) {
      await go(A, `${g}/invite`);
      await A.getByLabel("Email addresses to invite").fill(chunk.join(", "));
      await A.getByRole("button", { name: "Invite", exact: true }).click();
      await A.waitForLoadState("load");
      await A.waitForTimeout(800);
    }
    const sent = await db.outbox.count({ where: { to: { in: list } } });
    const text = (await A.locator("main").innerText()).replace(/\s+/g, " ");
    return { ok: sent <= 20, actual: `${sent} of 25 invite emails queued` + (/invite emails today/.test(text) ? "; note shown" : ""), page: A };
  });

  // Being added by a stranger who knows your email.
  await check("EXP-08", "Privacy", "A stranger who knows your email adds you to their group, then opens Friends’ passports", "Your passport isn't shown to them until you open that group", async () => {
    const vEmail = email("victim");
    const V = await ctx();
    await signup(V, "Vicky", vEmail);
    const acc = await db.account.findUniqueOrThrow({ where: { email: vEmail } });
    await db.account.update({ where: { id: acc.id }, data: { places: JSON.stringify([{ c: "TH", city: "Phuket" }, { c: "JP", city: "Kyoto" }]) } });
    const X = await ctx();
    await signup(X, "Xavier");
    await go(X, "/groups/new");
    await X.locator('input[name="groupName"]').fill("Totally normal group");
    await X.locator('select[name="currency"]').selectOption("INR");
    await X.getByRole("button", { name: /Create group/ }).click();
    await X.waitForURL(/\/invite\?new=1/);
    await X.getByLabel("Email addresses to invite").fill(vEmail);
    await X.getByRole("button", { name: "Invite", exact: true }).click();
    await X.waitForLoadState("load");
    await go(X, "/passport/friends");
    const t = (await X.locator("main").innerText()).replace(/\s+/g, " ");
    const shows = /Vicky/.test(t) && /(Thailand|Japan|2 countr)/i.test(t);
    return { ok: !shows, actual: shows ? "The stranger can see Vicky's countries" : `Vicky's passport not shown (${/Vicky/.test(t) ? "name listed without countries" : "not listed"})`, page: X };
  });

  // Keyboard only.
  await check("EXP-09", "Accessibility", "Keyboard only on Add expense: every stop shows where focus is", "Each focused control has a visible focus ring", async () => {
    await go(A, `${g}/add`);
    const noRing: string[] = [];
    for (let i = 0; i < 30; i++) {
      await A.keyboard.press("Tab");
      const r = await A.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || (cs.boxShadow && cs.boxShadow !== "none");
        return { ring, label: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30) };
      });
      if (r && !r.ring) noRing.push(r.label);
    }
    return { ok: noRing.length === 0, actual: noRing.length ? `${noRing.length} of 30 stops without a visible ring: ${[...new Set(noRing)].slice(0, 8).join(", ")}` : "All 30 stops show a ring", page: A };
  });

  // A big group: 40 people, 2,000 expenses.
  await check("EXP-10", "Performance", "A big group (40 people, 2,000 expenses, 300 payments): server time for the group, Balances and Settle up", "Each under 3 s on the test machine", async () => {
    const me = await db.account.findUniqueOrThrow({ where: { email: email("Anil") } });
    const big = await db.group.create({ data: { name: "Big trip", currency: "INR", inviteCode: `big-${stamp}`, members: { create: Array.from({ length: 40 }, (_, i) => ({ name: `P${i}`, claimedAt: new Date() })) } }, include: { members: true } });
    await db.member.update({ where: { id: big.members[0].id }, data: { accountId: me.id } });
    const ids = big.members.map((m) => m.id);
    for (let k = 0; k < 2000; k += 200) {
      await db.$transaction(Array.from({ length: 200 }, (_, j) => {
        const i = k + j, payer = ids[i % 40], who = ids.filter((_, x) => (x + i) % 3 === 0);
        const amt = 1000 + ((i * 7919) % 500000);
        const each = Math.floor(amt / who.length), rest = amt - each * who.length;
        return db.expense.create({ data: { groupId: big.id, description: `E${i}`, amount: amt, originalAmount: amt, originalCurrency: "INR", baseCurrency: "INR", convertedAmount: amt, exchangeRate: "1", paidById: payer, createdById: payer, forMode: "selected", splitType: "equal", shares: { create: who.map((m, x) => ({ memberId: m, amount: each + (x < rest ? 1 : 0) })) } } });
      }));
    }
    await db.payment.createMany({ data: Array.from({ length: 300 }, (_, i) => ({ groupId: big.id, fromId: ids[i % 40], toId: ids[(i + 7) % 40], amount: 500 + i, createdById: ids[i % 40] })) });
    const times: string[] = [];
    let worst = 0;
    for (const path of [`/groups/${big.id}`, `/groups/${big.id}?tab=balances`, `/groups/${big.id}/settle`, "/"]) {
      const t0 = Date.now();
      const r = await A.request.get(base + path);
      const ms = Date.now() - t0;
      worst = Math.max(worst, ms);
      times.push(`${path.replace(big.id, ":big")} ${r.status()} ${ms} ms`);
    }
    await go(A, `/groups/${big.id}?tab=balances`);
    const sum = Object.values((await (await import("../../src/lib/group-data")).loadGroup(big.id))!.net).reduce((s, x) => s + x, 0);
    return { ok: worst < 3000 && sum === 0, actual: `${times.join("; ")}; balances add up to ${sum}`, page: A };
  });

  // Sign-in codes.
  await check("EXP-11", "Security", "Guessing a sign-in code: 6 wrong tries, then the right one", "Refused after 5 wrong tries; a new code is needed", async () => {
    const who = email("guess");
    const P = await ctx();
    await go(P, "/signin");
    await P.locator('input[name="email"]').fill(who);
    const since = new Date(Date.now() - 1000);
    await P.getByRole("button", { name: "Email me a code" }).click();
    await P.waitForURL(/sent=1/);
    let right = "";
    for (let i = 0; i < 40 && !right; i++) {
      const row = await db.outbox.findFirst({ where: { to: who, createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
      right = row ? (/\b(\d{6})\b/.exec(row.subject)?.[1] ?? "") : "";
      if (!right) await P.waitForTimeout(250);
    }
    const wrong = right === "000000" ? "111111" : "000000";
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      await P.locator('input[name="code"]').fill(wrong);
      await P.getByRole("button", { name: "Sign in" }).click();
      await P.waitForLoadState("load");
      seen.push(((/(That code isn.t right|Too many wrong tries)/.exec((await P.locator("main").innerText()).replace(/\s+/g, " ")) ?? ["?"])[0]));
    }
    await P.locator('input[name="code"]').fill(right);
    await P.getByRole("button", { name: "Sign in" }).click();
    await P.waitForLoadState("load");
    const signedIn = /signedin=1/.test(P.url());
    return { ok: !signedIn && seen.slice(5).every((s) => /Too many/.test(s)), actual: `${seen.join(" / ")}; right code afterwards: ${signedIn ? "ACCEPTED" : "refused"}`, page: P };
  });

  // The join page lists names not yet taken.
  await check("EXP-12", "Privacy", "What a stranger with the invite link sees before joining", "Group name and first names only; no money", async () => {
    const P = await ctx();
    await go(P, `/join/${code}`);
    const t = (await P.locator("main").innerText()).replace(/\s+/g, " ");
    return { ok: !/₹\s?\d/.test(t), actual: t.slice(0, 300), page: P };
  });

  await browser.close();
  saveJson("explore.json", rows);
  console.log(`EXPLORE: ${rows.filter((r) => r.status === "Pass").length} pass, ${rows.filter((r) => r.status === "Fail").length} fail, ${rows.filter((r) => r.status === "Info").length} info`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  saveJson("explore.json", rows);
  process.exit(1);
});
